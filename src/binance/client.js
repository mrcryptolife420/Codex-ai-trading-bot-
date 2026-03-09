import crypto from "node:crypto";

function createQueryString(params = {}) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      const normalized = Array.isArray(value) ? JSON.stringify(value) : `${value}`;
      return [key, normalized];
    });
  const search = new URLSearchParams(pairs);
  return search.toString();
}

function isRetriableStatus(status) {
  return status >= 500 || status === 429;
}

function isRetriableNetworkError(error) {
  return ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EACCES"].includes(error?.cause?.code) || ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(error?.code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUserDataHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-MBX-APIKEY": apiKey } : {})
  };
}

export class BinanceClient {
  constructor({ apiKey, apiSecret, baseUrl, futuresBaseUrl = "https://fapi.binance.com", recvWindow = 5000, logger, fetchImpl, nowFn }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.futuresBaseUrl = futuresBaseUrl.replace(/\/$/, "");
    this.recvWindow = recvWindow;
    this.logger = logger;
    this.fetchImpl = fetchImpl || fetch;
    this.nowFn = nowFn || (() => Date.now());
    this.clockOffsetMs = 0;
    this.maxRetries = 3;
  }

  getStreamBaseUrl() {
    if (this.baseUrl.includes("testnet.binance.vision")) {
      return "wss://stream.testnet.binance.vision";
    }
    return "wss://stream.binance.com:9443";
  }

  getFuturesStreamBaseUrl() {
    if (this.futuresBaseUrl.includes("testnet")) {
      return "wss://stream.binancefuture.com";
    }
    return "wss://fstream.binance.com";
  }

  sign(queryString) {
    return crypto.createHmac("sha256", this.apiSecret).update(queryString).digest("hex");
  }

  getClockOffsetMs() {
    return this.clockOffsetMs;
  }

  async request(method, pathname, params = {}, signed = false, extraHeaders = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        if (signed && (!this.apiKey || !this.apiSecret)) {
          throw new Error("Missing Binance API credentials for signed request.");
        }

        const payload = signed
          ? {
              ...params,
              recvWindow: this.recvWindow,
              timestamp: this.nowFn() + this.clockOffsetMs
            }
          : params;
        const queryString = createQueryString(payload);
        const signature = signed ? this.sign(queryString) : null;
        const url = `${this.baseUrl}${pathname}${queryString ? `?${queryString}` : ""}${signature ? `${queryString ? "&" : "?"}signature=${signature}` : ""}`;

        const response = await this.fetchImpl(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(signed ? { "X-MBX-APIKEY": this.apiKey } : {}),
            ...extraHeaders
          },
          signal: AbortSignal.timeout(10_000)
        });

        const text = await response.text();
        const responsePayload = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const error = new Error(responsePayload?.msg || `Binance request failed with ${response.status}`);
          error.status = response.status;
          error.payload = responsePayload;
          throw error;
        }
        return responsePayload;
      } catch (error) {
        lastError = error;
        const binanceCode = error?.payload?.code;
        if (signed && binanceCode === -1021) {
          await this.syncServerTime(true);
        }
        const shouldRetry = attempt < this.maxRetries && (isRetriableStatus(error.status || 0) || isRetriableNetworkError(error) || binanceCode === -1021);
        if (!shouldRetry) {
          break;
        }
        await sleep(200 * attempt);
      }
    }
    throw lastError;
  }

  async requestToBase(baseUrl, method, pathname, params = {}, extraHeaders = {}) {
    let lastError = null;
    const cleanBaseUrl = `${baseUrl}`.replace(/\/$/, "");
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        const queryString = createQueryString(params);
        const url = `${cleanBaseUrl}${pathname}${queryString ? `?${queryString}` : ""}`;
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...extraHeaders
          },
          signal: AbortSignal.timeout(10_000)
        });
        const text = await response.text();
        const payload = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const error = new Error(payload?.msg || `Binance request failed with ${response.status}`);
          error.status = response.status;
          error.payload = payload;
          throw error;
        }
        return payload;
      } catch (error) {
        lastError = error;
        const shouldRetry = attempt < this.maxRetries && (isRetriableStatus(error.status || 0) || isRetriableNetworkError(error));
        if (!shouldRetry) {
          break;
        }
        await sleep(200 * attempt);
      }
    }
    throw lastError;
  }

  async publicRequest(method, pathname, params = {}) {
    return this.request(method, pathname, params, false);
  }

  async futuresPublicRequest(method, pathname, params = {}) {
    return this.requestToBase(this.futuresBaseUrl, method, pathname, params);
  }

  async signedRequest(method, pathname, params = {}) {
    return this.request(method, pathname, params, true);
  }

  async apiKeyRequest(method, pathname, params = {}) {
    const queryString = createQueryString(params);
    const url = `${this.baseUrl}${pathname}${queryString ? `?${queryString}` : ""}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: buildUserDataHeaders(this.apiKey),
      signal: AbortSignal.timeout(10_000)
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(payload?.msg || `Binance api-key request failed with ${response.status}`);
    }
    return payload;
  }

  async ping() {
    return this.publicRequest("GET", "/api/v3/ping");
  }

  async getServerTime() {
    return this.publicRequest("GET", "/api/v3/time");
  }

  async syncServerTime(force = false) {
    if (!force && this.clockOffsetMs !== 0) {
      return this.clockOffsetMs;
    }
    const response = await this.getServerTime();
    this.clockOffsetMs = Number(response.serverTime || 0) - this.nowFn();
    return this.clockOffsetMs;
  }

  async getExchangeInfo(symbols = []) {
    const params = symbols.length === 1 ? { symbol: symbols[0] } : symbols.length > 1 ? { symbols } : {};
    return this.publicRequest("GET", "/api/v3/exchangeInfo", params);
  }

  async getKlines(symbol, interval, limit = 200) {
    return this.publicRequest("GET", "/api/v3/klines", { symbol, interval, limit });
  }

  async get24hTicker(symbol) {
    return this.publicRequest("GET", "/api/v3/ticker/24hr", { symbol });
  }

  async getBookTicker(symbol) {
    return this.publicRequest("GET", "/api/v3/ticker/bookTicker", { symbol });
  }

  async getOrderBook(symbol, limit = 10) {
    return this.publicRequest("GET", "/api/v3/depth", { symbol, limit });
  }

  async getFuturesPremiumIndex(symbol) {
    return this.futuresPublicRequest("GET", "/fapi/v1/premiumIndex", { symbol });
  }

  async getFuturesOpenInterest(symbol) {
    return this.futuresPublicRequest("GET", "/fapi/v1/openInterest", { symbol });
  }

  async getFuturesOpenInterestHist(symbol, period = "5m", limit = 12) {
    return this.futuresPublicRequest("GET", "/futures/data/openInterestHist", { symbol, period, limit });
  }

  async getFuturesTakerLongShortRatio(symbol, period = "5m", limit = 12) {
    return this.futuresPublicRequest("GET", "/futures/data/takerlongshortRatio", { symbol, period, limit });
  }

  async getFuturesBasis(symbol, period = "5m", limit = 12) {
    return this.futuresPublicRequest("GET", "/futures/data/basis", {
      pair: symbol,
      contractType: "PERPETUAL",
      period,
      limit
    });
  }

  async getFuturesGlobalLongShortAccountRatio(symbol, period = "5m", limit = 12) {
    return this.futuresPublicRequest("GET", "/futures/data/globalLongShortAccountRatio", { symbol, period, limit });
  }

  async getFuturesTopLongShortPositionRatio(symbol, period = "5m", limit = 12) {
    return this.futuresPublicRequest("GET", "/futures/data/topLongShortPositionRatio", { symbol, period, limit });
  }

  async getAccountInfo(omitZeroBalances = false) {
    return this.signedRequest("GET", "/api/v3/account", { omitZeroBalances });
  }

  async getOpenOrders(symbol) {
    return this.signedRequest("GET", "/api/v3/openOrders", symbol ? { symbol } : {});
  }

  async getOpenOrderLists() {
    return this.signedRequest("GET", "/api/v3/openOrderList");
  }

  async getOrderList(params) {
    return this.signedRequest("GET", "/api/v3/orderList", params);
  }

  async getAllOrderLists(params = {}) {
    return this.signedRequest("GET", "/api/v3/allOrderList", params);
  }

  async getOrder(symbol, params) {
    return this.signedRequest("GET", "/api/v3/order", { symbol, ...params });
  }

  async getMyTrades(symbol, params = {}) {
    return this.signedRequest("GET", "/api/v3/myTrades", { symbol, ...params });
  }

  async getCommissionRates(symbol) {
    return this.signedRequest("GET", "/api/v3/account/commission", { symbol });
  }

  async getOrderAmendments(symbol, orderId) {
    return this.signedRequest("GET", "/api/v3/order/amendments", { symbol, orderId });
  }

  async getMyPreventedMatches(symbol, params = {}) {
    return this.signedRequest("GET", "/api/v3/myPreventedMatches", { symbol, ...params });
  }

  async testOrder(params) {
    return this.signedRequest("POST", "/api/v3/order/test", params);
  }

  async placeOrder(params) {
    return this.signedRequest("POST", "/api/v3/order", params);
  }

  async placeOrderListOco(params) {
    return this.signedRequest("POST", "/api/v3/orderList/oco", params);
  }

  async cancelOrder(symbol, params) {
    return this.signedRequest("DELETE", "/api/v3/order", { symbol, ...params });
  }

  async cancelOrderList(params) {
    return this.signedRequest("DELETE", "/api/v3/orderList", params);
  }

  async cancelAllOpenOrders(symbol) {
    return this.signedRequest("DELETE", "/api/v3/openOrders", { symbol });
  }

  async cancelReplaceOrder(params) {
    return this.signedRequest("POST", "/api/v3/order/cancelReplace", params);
  }

  async amendOrderKeepPriority(params) {
    return this.signedRequest("PUT", "/api/v3/order/amend/keepPriority", params);
  }

  async createUserDataListenKey() {
    const response = await this.apiKeyRequest("POST", "/api/v3/userDataStream");
    return response.listenKey;
  }

  async keepAliveUserDataListenKey(listenKey) {
    return this.apiKeyRequest("PUT", "/api/v3/userDataStream", { listenKey });
  }

  async closeUserDataListenKey(listenKey) {
    return this.apiKeyRequest("DELETE", "/api/v3/userDataStream", { listenKey });
  }
}

export function normalizeKlines(rawKlines) {
  return rawKlines.map((entry) => ({
    openTime: Number(entry[0]),
    open: Number(entry[1]),
    high: Number(entry[2]),
    low: Number(entry[3]),
    close: Number(entry[4]),
    volume: Number(entry[5]),
    closeTime: Number(entry[6])
  }));
}

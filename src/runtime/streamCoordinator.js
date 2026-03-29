import { LocalOrderBookEngine } from "../market/localOrderBook.js";
import { mapWithConcurrency } from "../utils/async.js";

function toCombinedStreamPath(streams) {
  return `stream?streams=${streams.join("/")}`;
}

function createRollingStats(limit = 200) {
  return {
    limit,
    items: [],
    push(item) {
      this.items.push(item);
      if (this.items.length > this.limit) {
        this.items.shift();
      }
    }
  };
}

function normalizeForceOrder(payload) {
  const order = payload?.o || payload || {};
  const quantity = Number(order.q || order.l || 0);
  const price = Number(order.ap || order.p || 0);
  const notional = quantity * price;
  return {
    symbol: order.s || payload?.s || null,
    side: order.S || payload?.S || null,
    quantity,
    price,
    notional,
    eventTime: payload?.E || order.T || Date.now()
  };
}

function flattenUserPayload(payload) {
  if (payload?.event) {
    return payload.event;
  }
  return payload;
}

function normalizeExecutionReport(event) {
  return {
    eventType: event.e,
    symbol: event.s,
    side: event.S,
    orderType: event.o,
    executionType: event.x,
    status: event.X,
    orderId: Number(event.i || 0),
    clientOrderId: event.c,
    orderListId: Number(event.g || 0) || null,
    quantity: Number(event.q || 0),
    executedQty: Number(event.z || 0),
    lastExecutedQty: Number(event.l || 0),
    price: Number(event.p || 0),
    lastPrice: Number(event.L || 0),
    cumulativeQuoteQty: Number(event.Z || 0),
    lastQuoteQty: Number(event.Y || 0),
    maker: Boolean(event.m),
    onBook: Boolean(event.w),
    workingTime: Number(event.W || 0),
    creationTime: Number(event.O || event.T || 0),
    transactTime: Number(event.T || event.E || Date.now()),
    selfTradePreventionMode: event.V || event.selfTradePreventionMode || null,
    preventedMatchId: event.v ?? event.preventedMatchId ?? null,
    preventedQuantity: Number(event.A ?? event.preventedQuantity ?? 0),
    lastPreventedQuantity: Number(event.B ?? event.lastPreventedQuantity ?? 0),
    usedSor: Boolean(event.uS ?? event.usedSor ?? false),
    workingFloor: event.k ?? event.workingFloor ?? null,
    pegPriceType: event.gP ?? event.pegPriceType ?? null,
    pegOffsetType: event.gOT ?? event.pegOffsetType ?? null,
    pegOffsetValue: event.gOV ?? event.pegOffsetValue ?? null,
    peggedPrice: Number(event.gp ?? event.peggedPrice ?? 0),
    strategyId: event.j ?? event.strategyId ?? null,
    strategyType: event.J ?? event.strategyType ?? null,
    raw: event,
    at: new Date(event.E || Date.now()).toISOString()
  };
}

function normalizeListStatusEvent(event) {
  return {
    eventType: event.e,
    symbol: event.s || null,
    orderListId: Number(event.g || 0) || null,
    contingencyType: event.c || null,
    listStatusType: event.l || null,
    listOrderStatus: event.L || null,
    listClientOrderId: event.C || null,
    rejectReason: event.r || null,
    transactTime: Number(event.T || event.E || Date.now()),
    orders: Array.isArray(event.O) ? event.O.map((item) => ({
      symbol: item?.s || event.s || null,
      orderId: Number(item?.i || 0) || null,
      clientOrderId: item?.c || null
    })) : [],
    raw: event,
    at: new Date(event.E || Date.now()).toISOString()
  };
}


function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdownSocket(socket) {
  if (!socket) {
    return;
  }
  try {
    if (typeof socket.terminate === "function") {
      socket.terminate();
      return;
    }
    if (typeof socket.close === "function") {
      socket.close();
    }
  } catch {
    // ignore local websocket shutdown failures
  }
}

function toEventTimeMs(value) {
  if (value == null) {
    return Number.NaN;
  }
  if (typeof value === "number") {
    return value;
  }
  return new Date(value).getTime();
}

function summarizeExecutionEvents(events = []) {
  const tradeEvents = events.filter((event) => event.executionType === "TRADE");
  const makerQty = tradeEvents.reduce((total, event) => total + (event.maker ? event.lastExecutedQty : 0), 0);
  const takerQty = tradeEvents.reduce((total, event) => total + (!event.maker ? event.lastExecutedQty : 0), 0);
  const preventedQuantity = events.reduce((total, event) => total + (event.preventedQuantity || 0) + (event.lastPreventedQuantity || 0), 0);
  const workingTimes = events.map((event) => Number(event.workingTime || 0)).filter((value) => value > 0);
  const transactTimes = events.map((event) => Number(event.transactTime || 0)).filter((value) => value > 0);
  const orderStart = workingTimes.length ? Math.min(...workingTimes) : transactTimes.length ? Math.min(...transactTimes) : 0;
  const orderEnd = transactTimes.length ? Math.max(...transactTimes) : 0;
  const workingTimeMs = orderStart && orderEnd && orderEnd >= orderStart ? orderEnd - orderStart : 0;

  return {
    eventCount: events.length,
    makerQty,
    takerQty,
    makerFillRatio: makerQty + takerQty ? makerQty / (makerQty + takerQty) : 0,
    takerFillRatio: makerQty + takerQty ? takerQty / (makerQty + takerQty) : 0,
    preventedQuantity,
    preventedMatchIds: unique(events.map((event) => event.preventedMatchId)),
    usedSor: events.some((event) => event.usedSor),
    workingFloors: unique(events.map((event) => event.workingFloor)),
    pegPriceType: [...events].reverse().find((event) => event.pegPriceType)?.pegPriceType || null,
    pegOffsetType: [...events].reverse().find((event) => event.pegOffsetType)?.pegOffsetType || null,
    pegOffsetValue: [...events].reverse().find((event) => event.pegOffsetValue != null)?.pegOffsetValue ?? null,
    peggedPrice: [...events].reverse().find((event) => event.peggedPrice)?.peggedPrice || 0,
    selfTradePreventionMode: [...events].reverse().find((event) => event.selfTradePreventionMode)?.selfTradePreventionMode || null,
    workingTimeMs,
    strategyIds: unique(events.map((event) => event.strategyId)),
    executionTypes: unique(events.map((event) => event.executionType))
  };
}

export class StreamCoordinator {
  constructor({ client, config, logger }) {
    this.client = client;
    this.config = config;
    this.logger = logger;
    this.orderBook = new LocalOrderBookEngine({ client, config, logger });
    this.state = {
      enabled: config.enableEventDrivenData,
      marketDataMode: config.enableLocalOrderBook ? "json_depth_local_book" : "ticker_trade_only",
      publicStreamConnected: false,
      futuresStreamConnected: false,
      userStreamConnected: false,
      lastPublicMessageAt: null,
      lastFuturesMessageAt: null,
      lastUserMessageAt: null,
      lastError: null,
      listenKey: null,
      localBook: this.orderBook.getSummary(),
      symbols: {}
    };
    this.publicSocket = null;
    this.futuresSocket = null;
    this.userSocket = null;
    this.keepAliveTimer = null;
    this.restartTimers = {
      public: null,
      futures: null,
      user: null
    };
    this.publicRestartPromise = Promise.resolve();
    this.futuresRestartPromise = Promise.resolve();
    this.userRestartPromise = Promise.resolve();
    this.isClosing = false;
    this.setWatchlist(config.watchlist);
    this.setLocalBookUniverse(config.watchlist.slice(0, config.localBookMaxSymbols || config.universeMaxSymbols || config.watchlist.length));
  }

  createSymbolState() {
    return {
      bookTicker: null,
      trades: createRollingStats(this.config.streamTradeBufferSize),
      liquidations: createRollingStats(80),
      userEvents: createRollingStats(120),
      listStatusEvents: createRollingStats(80)
    };
  }

  getBookTickerMaxAgeMs() {
    return Math.max(250, Number(this.config.maxDepthEventAgeMs || 15_000));
  }

  buildLocalBookTicker(localBook) {
    const eventTimeMs = toEventTimeMs(localBook?.lastEventAt);
    if (!localBook?.bestBid || !localBook?.bestAsk || !Number.isFinite(eventTimeMs) || (Date.now() - eventTimeMs) > this.getBookTickerMaxAgeMs()) {
      return null;
    }
    return {
      bid: localBook.bestBid,
      ask: localBook.bestAsk,
      bidQty: localBook.bids?.[0]?.[1] || 0,
      askQty: localBook.asks?.[0]?.[1] || 0,
      mid: localBook.mid,
      eventTime: localBook.lastEventAt
    };
  }

  getFreshBookTicker(bookTicker, localBook) {
    const eventTimeMs = toEventTimeMs(bookTicker?.eventTime);
    if (bookTicker?.bid && bookTicker?.ask && Number.isFinite(eventTimeMs) && (Date.now() - eventTimeMs) <= this.getBookTickerMaxAgeMs()) {
      return bookTicker;
    }
    return this.buildLocalBookTicker(localBook);
  }

  clearPublicBookTickers() {
    for (const bucket of Object.values(this.state.symbols || {})) {
      bucket.bookTicker = null;
    }
  }

  setWatchlist(symbols = []) {
    const normalized = unique(symbols.map((symbol) => `${symbol}`.trim().toUpperCase()));
    const previous = this.state.symbols || {};
    const previousSymbols = Object.keys(previous);
    const changed = normalized.length !== previousSymbols.length || normalized.some((symbol, index) => symbol !== previousSymbols[index]);
    this.config.watchlist = normalized;
    this.state.symbols = Object.fromEntries(normalized.map((symbol) => [symbol, previous[symbol] || this.createSymbolState()]));
    if (changed && this.publicSocket && this.state.enabled) {
      void this.restartPublicStream("watchlist_update").catch((error) => {
        this.state.lastError = error.message;
        this.logger?.warn?.("Public market stream restart failed", { error: error.message });
      });
    }
  }

  setLocalBookUniverse(symbols = []) {
    const previousSymbols = this.orderBook.activeSymbols ? [...this.orderBook.activeSymbols] : [];
    this.orderBook.setActiveSymbols(symbols);
    this.state.localBook = this.orderBook.getSummary();
    const nextSymbols = this.orderBook.activeSymbols ? [...this.orderBook.activeSymbols] : [];
    const addedSymbols = nextSymbols.filter((symbol) => !previousSymbols.includes(symbol));
    if (addedSymbols.length && this.state.enabled && this.config.enableLocalOrderBook) {
      void this.primeLocalBooks(addedSymbols).catch((error) => {
        this.state.lastError = error.message;
        this.logger?.warn?.("Local order book reprime failed", { error: error.message, symbols: addedSymbols });
      });
    }
  }

  async primeLocalBooks(symbols = []) {
    const activeSymbols = unique((symbols || []).filter((symbol) => this.state.symbols[symbol]));
    if (!activeSymbols.length || !this.config.enableLocalOrderBook) {
      return [];
    }

    const results = await mapWithConcurrency(activeSymbols, this.config.marketSnapshotConcurrency || 4, async (symbol) => {
      try {
        await this.orderBook.ensurePrimed(symbol);
        return { symbol, ok: true };
      } catch (error) {
        this.logger?.warn?.("Local order book prime failed", { symbol, error: error.message });
        return { symbol, ok: false, error: error.message };
      }
    });

    this.state.localBook = this.orderBook.getSummary();
    return results;
  }

  getStatus() {
    this.state.localBook = this.orderBook.getSummary();
    return {
      enabled: this.state.enabled,
      marketDataMode: this.state.marketDataMode,
      publicStreamConnected: this.state.publicStreamConnected,
      futuresStreamConnected: this.state.futuresStreamConnected,
      userStreamConnected: this.state.userStreamConnected,
      lastPublicMessageAt: this.state.lastPublicMessageAt,
      lastFuturesMessageAt: this.state.lastFuturesMessageAt,
      lastUserMessageAt: this.state.lastUserMessageAt,
      lastError: this.state.lastError,
      userStreamSessionActive: Boolean(this.state.listenKey),
      localBook: this.state.localBook
    };
  }

  getOrderBookSnapshot(symbol) {
    return this.orderBook.getSnapshot(symbol);
  }

  estimateFill(symbol, side, request) {
    return this.orderBook.estimateFill(symbol, side, request);
  }

  getOrderExecutionTelemetry(symbol, orderIds = []) {
    const bucket = this.state.symbols[symbol];
    if (!bucket) {
      return summarizeExecutionEvents([]);
    }
    const ids = new Set((orderIds || []).map((value) => Number(value || 0)).filter(Boolean));
    const events = bucket.userEvents.items.filter((event) => ids.size === 0 || ids.has(Number(event.orderId || 0)));
    return summarizeExecutionEvents(events);
  }


  getRecentExecutionReports(symbol, { orderIds = [], orderListId = null, maxAgeMs = 180_000 } = {}) {
    const bucket = this.state.symbols[symbol];
    if (!bucket) {
      return [];
    }
    const cutoff = Date.now() - Math.max(0, Number(maxAgeMs || 0));
    const ids = new Set((orderIds || []).map((value) => Number(value || 0)).filter(Boolean));
    return bucket.userEvents.items.filter((event) => {
      const eventTime = Number(event.transactTime || 0);
      if (eventTime && eventTime < cutoff) {
        return false;
      }
      if (ids.size > 0 && !ids.has(Number(event.orderId || 0))) {
        return false;
      }
      if (orderListId != null && Number(event.orderListId || 0) !== Number(orderListId)) {
        return false;
      }
      return true;
    });
  }

  getRecentListStatusEvents(symbol, { orderListId = null, maxAgeMs = 180_000 } = {}) {
    const bucket = this.state.symbols[symbol];
    if (!bucket) {
      return [];
    }
    const cutoff = Date.now() - Math.max(0, Number(maxAgeMs || 0));
    return bucket.listStatusEvents.items.filter((event) => {
      const eventTime = Number(event.transactTime || 0);
      if (eventTime && eventTime < cutoff) {
        return false;
      }
      if (orderListId != null && Number(event.orderListId || 0) !== Number(orderListId)) {
        return false;
      }
      return true;
    });
  }

  getSymbolStreamFeatures(symbol) {
    const bucket = this.state.symbols[symbol];
    const localBook = this.orderBook.getSnapshot(symbol);
    if (!bucket) {
      const latestBookTicker = this.buildLocalBookTicker(localBook);
      return {
        tradeFlowImbalance: 0,
        microTrend: 0,
        latestBookTicker,
        recentTradeCount: 0,
        liquidationCount: 0,
        liquidationNotional: 0,
        liquidationImbalance: 0,
        lastLiquidation: null,
        lastUserEvent: null,
        localBook
      };
    }

    const trades = bucket.trades.items;
    const latestBookTicker = this.getFreshBookTicker(bucket.bookTicker, localBook);
    const buyVolume = trades.reduce((total, trade) => total + (trade.isBuyerMaker ? 0 : trade.quantity), 0);
    const sellVolume = trades.reduce((total, trade) => total + (trade.isBuyerMaker ? trade.quantity : 0), 0);
    const totalVolume = buyVolume + sellVolume;
    const firstPrice = trades[0]?.price || latestBookTicker?.mid || 0;
    const lastPrice = trades.at(-1)?.price || latestBookTicker?.mid || 0;

    const liquidations = bucket.liquidations.items;
    const bullishLiquidations = liquidations.reduce((total, item) => total + (item.side === "BUY" ? item.notional : 0), 0);
    const bearishLiquidations = liquidations.reduce((total, item) => total + (item.side === "SELL" ? item.notional : 0), 0);
    const liquidationTotal = bullishLiquidations + bearishLiquidations;

    return {
      tradeFlowImbalance: totalVolume ? (buyVolume - sellVolume) / totalVolume : 0,
      microTrend: firstPrice ? (lastPrice - firstPrice) / firstPrice : 0,
      latestBookTicker,
      recentTradeCount: trades.length,
      liquidationCount: liquidations.length,
      liquidationNotional: liquidationTotal,
      liquidationImbalance: liquidationTotal ? (bullishLiquidations - bearishLiquidations) / liquidationTotal : 0,
      lastLiquidation: liquidations.at(-1) || null,
      lastUserEvent: bucket.userEvents.items.at(-1) || null,
      localBook
    };
  }

  async waitForPublicStreamOpen(timeoutMs = 1500) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (!this.state.publicStreamConnected && Date.now() < deadline) {
      await sleep(50);
    }
    return this.state.publicStreamConnected;
  }

  getStreamReconnectDelayMs() {
    return Math.max(250, Number(this.config.streamReconnectDelayMs || 1_500));
  }

  clearRestartTimer(kind) {
    if (this.restartTimers[kind]) {
      clearTimeout(this.restartTimers[kind]);
      this.restartTimers[kind] = null;
    }
  }

  scheduleRestart(kind, restart, reason) {
    if (this.isClosing || !this.state.enabled || typeof WebSocket === "undefined") {
      return Promise.resolve();
    }
    this.clearRestartTimer(kind);
    const delayMs = this.getStreamReconnectDelayMs();
    const promiseName = `${kind}RestartPromise`;
    this[promiseName] = this[promiseName]
      .catch(() => {})
      .then(() => new Promise((resolve) => {
        this.restartTimers[kind] = setTimeout(async () => {
          this.restartTimers[kind] = null;
          try {
            await restart();
            this.logger?.info?.(`${kind} stream restarted`, { reason, delayMs });
          } catch (error) {
            this.state.lastError = error.message;
            this.logger?.warn?.(`${kind} stream restart failed`, { reason, error: error.message });
          } finally {
            resolve();
          }
        }, delayMs);
      }));
    return this[promiseName];
  }

  async init() {
    this.isClosing = false;
    if (!this.config.enableEventDrivenData || typeof WebSocket === "undefined") {
      return this.getStatus();
    }

    await this.startPublicStream();
    if (this.config.enableLocalOrderBook) {
      void (async () => {
        await this.waitForPublicStreamOpen(Math.max(250, Number(this.config.localBookBootstrapWaitMs || 0) + 500));
        return this.primeLocalBooks(this.orderBook.activeSymbols ? [...this.orderBook.activeSymbols] : []);
      })().catch(() => {
        // ignore background priming errors here; individual warnings are logged inside the engine
      });
    }
    await this.startFuturesStream();
    if (this.config.botMode === "live" && this.config.binanceApiKey) {
      try {
        await this.startUserStream();
      } catch (error) {
        this.state.lastError = error.message;
        this.logger?.warn?.("User stream failed to start", { error: error.message });
      }
    }

    return this.getStatus();
  }

  handlePublicMessage(payload) {
    const stream = payload.stream || "";
    const data = payload.data || payload;
    const symbol = data.s || stream.split("@")[0]?.toUpperCase();
    if (!symbol || !this.state.symbols[symbol]) {
      return;
    }
    this.state.lastPublicMessageAt = new Date().toISOString();

    if (stream.includes("@bookTicker")) {
      const bid = Number(data.b || data.bidPrice || 0);
      const ask = Number(data.a || data.askPrice || 0);
      this.state.symbols[symbol].bookTicker = {
        bid,
        ask,
        bidQty: Number(data.B || data.bidQty || 0),
        askQty: Number(data.A || data.askQty || 0),
        mid: bid && ask ? (bid + ask) / 2 : bid || ask || 0,
        eventTime: data.E || Date.now()
      };
      return;
    }

    if (stream.includes("@depth")) {
      this.orderBook.handleDepthEvent(symbol, data);
      this.state.localBook = this.orderBook.getSummary();
      return;
    }

    if (stream.includes("@trade")) {
      this.state.symbols[symbol].trades.push({
        price: Number(data.p || 0),
        quantity: Number(data.q || 0),
        isBuyerMaker: Boolean(data.m),
        eventTime: data.E || Date.now()
      });
    }
  }

  handleFuturesMessage(payload) {
    const rawData = payload.data || payload;
    const records = Array.isArray(rawData) ? rawData : [rawData];
    for (const record of records) {
      const normalized = normalizeForceOrder(record);
      if (!normalized.symbol || !this.state.symbols[normalized.symbol]) {
        continue;
      }
      this.state.lastFuturesMessageAt = new Date().toISOString();
      this.state.symbols[normalized.symbol].liquidations.push({
        ...normalized,
        at: new Date(normalized.eventTime || Date.now()).toISOString()
      });
    }
  }

  handleUserMessage(payload) {
    const event = flattenUserPayload(payload);
    const eventType = event.e;
    this.state.lastUserMessageAt = new Date().toISOString();
    if (eventType === "executionReport") {
      const normalized = normalizeExecutionReport(event);
      const symbol = normalized.symbol;
      if (this.state.symbols[symbol]) {
        this.state.symbols[symbol].userEvents.push(normalized);
      }
      return;
    }
    if (eventType === "listStatus") {
      const normalized = normalizeListStatusEvent(event);
      const symbol = normalized.symbol;
      if (this.state.symbols[symbol]) {
        this.state.symbols[symbol].listStatusEvents.push(normalized);
      }
    }
  }

  async startPublicStream() {
    this.clearRestartTimer("public");
    const streams = this.config.watchlist.flatMap((symbol) => {
      const lower = symbol.toLowerCase();
      const base = [`${lower}@bookTicker`, `${lower}@trade`];
      if (this.config.enableLocalOrderBook) {
        base.push(`${lower}@depth@100ms`);
      }
      return base;
    });
    const socket = new WebSocket(`${this.client.getStreamBaseUrl()}/${toCombinedStreamPath(streams)}`);
    this.publicSocket = socket;
    socket.addEventListener("open", () => {
      if (this.publicSocket !== socket) {
        return;
      }
      this.state.publicStreamConnected = true;
      this.logger?.info?.("Public market stream connected", { streams: streams.length });
    });
    socket.addEventListener("message", (event) => {
      if (this.publicSocket !== socket) {
        return;
      }
      try {
        this.handlePublicMessage(JSON.parse(event.data));
      } catch (error) {
        this.state.lastError = error.message;
      }
    });
    socket.addEventListener("close", () => {
      if (this.publicSocket !== socket) {
        return;
      }
      this.state.publicStreamConnected = false;
      this.clearPublicBookTickers();
      this.publicSocket = null;
      void this.scheduleRestart("public", () => this.startPublicStream(), "socket_close");
    });
    socket.addEventListener("error", (error) => {
      if (this.publicSocket !== socket) {
        return;
      }
      this.state.lastError = error.message || "public_stream_error";
      this.state.publicStreamConnected = false;
      this.clearPublicBookTickers();
      this.publicSocket = null;
      void this.scheduleRestart("public", () => this.startPublicStream(), "socket_error");
    });
  }

  async startFuturesStream() {
    this.clearRestartTimer("futures");
    const socket = new WebSocket(`${this.client.getFuturesStreamBaseUrl()}/stream?streams=!forceOrder@arr`);
    this.futuresSocket = socket;
    socket.addEventListener("open", () => {
      if (this.futuresSocket !== socket) {
        return;
      }
      this.state.futuresStreamConnected = true;
      this.logger?.info?.("Futures liquidation stream connected");
    });
    socket.addEventListener("message", (event) => {
      if (this.futuresSocket !== socket) {
        return;
      }
      try {
        this.handleFuturesMessage(JSON.parse(event.data));
      } catch (error) {
        this.state.lastError = error.message;
      }
    });
    socket.addEventListener("close", () => {
      if (this.futuresSocket !== socket) {
        return;
      }
      this.state.futuresStreamConnected = false;
      this.futuresSocket = null;
      void this.scheduleRestart("futures", () => this.startFuturesStream(), "socket_close");
    });
    socket.addEventListener("error", (error) => {
      if (this.futuresSocket !== socket) {
        return;
      }
      this.state.lastError = error.message || "futures_stream_error";
      this.state.futuresStreamConnected = false;
      this.futuresSocket = null;
      void this.scheduleRestart("futures", () => this.startFuturesStream(), "socket_error");
    });
  }

  async startUserStream() {
    this.clearRestartTimer("user");
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    const previousSocket = this.userSocket;
    if (previousSocket) {
      this.userSocket = null;
      try {
        previousSocket.close();
      } catch {
        // ignore local websocket close errors before reconnecting
      }
    }
    const listenKey = await this.client.createUserDataListenKey();
    this.state.listenKey = listenKey;
    const socket = new WebSocket(`${this.client.getStreamBaseUrl()}/ws/${listenKey}`);
    this.userSocket = socket;
    socket.addEventListener("open", () => {
      if (this.userSocket !== socket) {
        return;
      }
      this.state.userStreamConnected = true;
      this.logger?.info?.("User data stream connected");
    });
    socket.addEventListener("message", (event) => {
      if (this.userSocket !== socket) {
        return;
      }
      try {
        this.handleUserMessage(JSON.parse(event.data));
      } catch (error) {
        this.state.lastError = error.message;
      }
    });
    socket.addEventListener("close", () => {
      if (this.userSocket !== socket) {
        return;
      }
      this.state.userStreamConnected = false;
      if (this.state.listenKey === listenKey) {
        this.state.listenKey = null;
      }
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      this.userSocket = null;
      if (this.config.botMode === "live" && this.config.binanceApiKey) {
        void this.scheduleRestart("user", () => this.startUserStream(), "socket_close");
      }
    });
    socket.addEventListener("error", (error) => {
      if (this.userSocket !== socket) {
        return;
      }
      this.state.lastError = error.message || "user_stream_error";
      this.state.userStreamConnected = false;
      if (this.state.listenKey === listenKey) {
        this.state.listenKey = null;
      }
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      this.userSocket = null;
      if (this.config.botMode === "live" && this.config.binanceApiKey) {
        void this.scheduleRestart("user", () => this.startUserStream(), "socket_error");
      }
    });
    this.keepAliveTimer = setInterval(() => {
      this.client.keepAliveUserDataListenKey(listenKey).catch((error) => {
        this.state.lastError = error.message;
      });
    }, 30 * 60 * 1000);
  }

  async stopPublicStream() {
    this.clearRestartTimer("public");
    const socket = this.publicSocket;
    this.publicSocket = null;
    this.state.publicStreamConnected = false;
    this.clearPublicBookTickers();
    if (socket) {
      socket.close();
    }
  }

  async restartPublicStream(reason = "watchlist_update") {
    this.clearRestartTimer("public");
    this.publicRestartPromise = this.publicRestartPromise.catch(() => {}).then(async () => {
      await this.stopPublicStream();
      if (!this.state.enabled || typeof WebSocket === "undefined" || !this.config.watchlist.length) {
        return;
      }
      await this.startPublicStream();
      this.logger?.info?.("Public market stream restarted", {
        reason,
        symbols: this.config.watchlist.length
      });
    });
    return this.publicRestartPromise;
  }

  async close() {
    this.isClosing = true;
    this.clearRestartTimer("public");
    this.clearRestartTimer("futures");
    this.clearRestartTimer("user");
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    const publicSocket = this.publicSocket;
    const futuresSocket = this.futuresSocket;
    const userSocket = this.userSocket;
    this.publicSocket = null;
    this.futuresSocket = null;
    this.userSocket = null;
    shutdownSocket(publicSocket);
    shutdownSocket(futuresSocket);
    shutdownSocket(userSocket);
    this.state.publicStreamConnected = false;
    this.state.futuresStreamConnected = false;
    this.state.userStreamConnected = false;
    this.clearPublicBookTickers();
    if (this.state.listenKey) {
      try {
        await this.client.closeUserDataListenKey(this.state.listenKey);
      } catch {
        // ignore cleanup failures
      }
      this.state.listenKey = null;
    }
  }
}







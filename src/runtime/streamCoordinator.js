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

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    this.setWatchlist(config.watchlist);
    this.setLocalBookUniverse(config.watchlist.slice(0, config.localBookMaxSymbols || config.universeMaxSymbols || config.watchlist.length));
  }

  createSymbolState() {
    return {
      bookTicker: null,
      trades: createRollingStats(this.config.streamTradeBufferSize),
      liquidations: createRollingStats(80),
      userEvents: createRollingStats(120)
    };
  }

  setWatchlist(symbols = []) {
    const normalized = unique(symbols.map((symbol) => `${symbol}`.trim().toUpperCase()));
    this.config.watchlist = normalized;
    const previous = this.state.symbols || {};
    this.state.symbols = Object.fromEntries(normalized.map((symbol) => [symbol, previous[symbol] || this.createSymbolState()]));
  }

  setLocalBookUniverse(symbols = []) {
    this.orderBook.setActiveSymbols(symbols);
    this.state.localBook = this.orderBook.getSummary();
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
      listenKey: this.state.listenKey,
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

  getSymbolStreamFeatures(symbol) {
    const bucket = this.state.symbols[symbol];
    const localBook = this.orderBook.getSnapshot(symbol);
    if (!bucket) {
      return {
        tradeFlowImbalance: 0,
        microTrend: 0,
        latestBookTicker: localBook.bestBid && localBook.bestAsk ? {
          bid: localBook.bestBid,
          ask: localBook.bestAsk,
          bidQty: localBook.bids?.[0]?.[1] || 0,
          askQty: localBook.asks?.[0]?.[1] || 0,
          mid: localBook.mid,
          eventTime: localBook.lastEventAt
        } : null,
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
    const buyVolume = trades.reduce((total, trade) => total + (trade.isBuyerMaker ? 0 : trade.quantity), 0);
    const sellVolume = trades.reduce((total, trade) => total + (trade.isBuyerMaker ? trade.quantity : 0), 0);
    const totalVolume = buyVolume + sellVolume;
    const firstPrice = trades[0]?.price || bucket.bookTicker?.mid || localBook.mid || 0;
    const lastPrice = trades.at(-1)?.price || bucket.bookTicker?.mid || localBook.mid || 0;

    const liquidations = bucket.liquidations.items;
    const bullishLiquidations = liquidations.reduce((total, item) => total + (item.side === "BUY" ? item.notional : 0), 0);
    const bearishLiquidations = liquidations.reduce((total, item) => total + (item.side === "SELL" ? item.notional : 0), 0);
    const liquidationTotal = bullishLiquidations + bearishLiquidations;

    const latestBookTicker = bucket.bookTicker || (localBook.bestBid && localBook.bestAsk
      ? {
          bid: localBook.bestBid,
          ask: localBook.bestAsk,
          bidQty: localBook.bids?.[0]?.[1] || 0,
          askQty: localBook.asks?.[0]?.[1] || 0,
          mid: localBook.mid,
          eventTime: localBook.lastEventAt
        }
      : null);

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

  async init() {
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
    }
  }

  async startPublicStream() {
    const streams = this.config.watchlist.flatMap((symbol) => {
      const lower = symbol.toLowerCase();
      const base = [`${lower}@bookTicker`, `${lower}@trade`];
      if (this.config.enableLocalOrderBook) {
        base.push(`${lower}@depth@100ms`);
      }
      return base;
    });
    const socket = new WebSocket(`${this.client.getStreamBaseUrl()}/${toCombinedStreamPath(streams)}`);
    socket.addEventListener("open", () => {
      this.state.publicStreamConnected = true;
      this.logger?.info?.("Public market stream connected", { streams: streams.length });
    });
    socket.addEventListener("message", (event) => {
      try {
        this.handlePublicMessage(JSON.parse(event.data));
      } catch (error) {
        this.state.lastError = error.message;
      }
    });
    socket.addEventListener("close", () => {
      this.state.publicStreamConnected = false;
    });
    socket.addEventListener("error", (error) => {
      this.state.lastError = error.message || "public_stream_error";
    });
    this.publicSocket = socket;
  }

  async startFuturesStream() {
    const socket = new WebSocket(`${this.client.getFuturesStreamBaseUrl()}/stream?streams=!forceOrder@arr`);
    socket.addEventListener("open", () => {
      this.state.futuresStreamConnected = true;
      this.logger?.info?.("Futures liquidation stream connected");
    });
    socket.addEventListener("message", (event) => {
      try {
        this.handleFuturesMessage(JSON.parse(event.data));
      } catch (error) {
        this.state.lastError = error.message;
      }
    });
    socket.addEventListener("close", () => {
      this.state.futuresStreamConnected = false;
    });
    socket.addEventListener("error", (error) => {
      this.state.lastError = error.message || "futures_stream_error";
    });
    this.futuresSocket = socket;
  }

  async startUserStream() {
    const listenKey = await this.client.createUserDataListenKey();
    this.state.listenKey = listenKey;
    const socket = new WebSocket(`${this.client.getStreamBaseUrl()}/ws/${listenKey}`);
    socket.addEventListener("open", () => {
      this.state.userStreamConnected = true;
      this.logger?.info?.("User data stream connected");
    });
    socket.addEventListener("message", (event) => {
      try {
        this.handleUserMessage(JSON.parse(event.data));
      } catch (error) {
        this.state.lastError = error.message;
      }
    });
    socket.addEventListener("close", () => {
      this.state.userStreamConnected = false;
    });
    socket.addEventListener("error", (error) => {
      this.state.lastError = error.message || "user_stream_error";
    });
    this.keepAliveTimer = setInterval(() => {
      this.client.keepAliveUserDataListenKey(listenKey).catch((error) => {
        this.state.lastError = error.message;
      });
    }, 30 * 60 * 1000);
    this.userSocket = socket;
  }

  async close() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.publicSocket) {
      this.publicSocket.close();
      this.publicSocket = null;
    }
    if (this.futuresSocket) {
      this.futuresSocket.close();
      this.futuresSocket = null;
    }
    if (this.userSocket) {
      this.userSocket.close();
      this.userSocket = null;
    }
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








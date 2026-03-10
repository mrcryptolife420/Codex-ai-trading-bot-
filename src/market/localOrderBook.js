import { clamp } from "../utils/math.js";

function createBucket(limit = 240) {
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

function toLevels(side, descending = false, limit = 20) {
  const entries = [...side.entries()]
    .map(([price, quantity]) => [Number(price), Number(quantity)])
    .filter(([, quantity]) => quantity > 0)
    .sort((left, right) => descending ? right[0] - left[0] : left[0] - right[0]);
  return entries.slice(0, limit);
}

function sumSigned(values) {
  return values.reduce((total, value) => total + value, 0);
}

function sumPositive(values) {
  return values.reduce((total, value) => total + (value > 0 ? value : 0), 0);
}

function sumNegativeAbs(values) {
  return values.reduce((total, value) => total + (value < 0 ? Math.abs(value) : 0), 0);
}

function ratio(numerator, denominator, fallback = 0) {
  return denominator ? numerator / denominator : fallback;
}

function bestPrice(levels) {
  return levels[0]?.[0] || 0;
}

function bestQty(levels) {
  return levels[0]?.[1] || 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function walkLevels(levels, side, { quoteAmount = 0, quantity = 0 } = {}) {
  const targetQty = quantity > 0 ? quantity : 0;
  const targetQuote = quoteAmount > 0 ? quoteAmount : 0;
  let remainingQty = targetQty;
  let remainingQuote = targetQuote;
  let filledQty = 0;
  let spentQuote = 0;

  for (const [price, size] of levels) {
    if (targetQty > 0) {
      if (remainingQty <= 0) {
        break;
      }
      const takeQty = Math.min(size, remainingQty);
      filledQty += takeQty;
      spentQuote += takeQty * price;
      remainingQty -= takeQty;
      continue;
    }

    if (targetQuote > 0) {
      if (remainingQuote <= 0) {
        break;
      }
      const levelNotional = size * price;
      const takeQuote = Math.min(levelNotional, remainingQuote);
      const takeQty = price ? takeQuote / price : 0;
      filledQty += takeQty;
      spentQuote += takeQuote;
      remainingQuote -= takeQuote;
    }
  }

  const target = targetQty > 0 ? targetQty : targetQuote;
  const filled = targetQty > 0 ? filledQty : spentQuote;
  const completionRatio = target > 0 ? clamp(filled / target, 0, 1) : 0;
  const averagePrice = filledQty > 0 ? spentQuote / filledQty : 0;
  const reference = side === "BUY" ? bestPrice(levels) : bestPrice(levels);

  return {
    requestedQuantity: targetQty,
    requestedQuote: targetQuote,
    filledQty,
    spentQuote,
    averagePrice,
    completionRatio,
    referencePrice: reference
  };
}

export class LocalOrderBookEngine {
  constructor({ client, config, logger }) {
    this.client = client;
    this.config = config;
    this.logger = logger;
    this.buckets = new Map();
    this.activeSymbols = new Set();
    this.setActiveSymbols(config.watchlist.slice(0, config.localBookMaxSymbols || config.universeMaxSymbols || config.watchlist.length));
  }

  setActiveSymbols(symbols = []) {
    this.activeSymbols = new Set((symbols || []).map((symbol) => `${symbol}`.trim().toUpperCase()).filter(Boolean));
  }

  isSymbolActive(symbol) {
    return this.activeSymbols.size === 0 || this.activeSymbols.has(`${symbol}`.trim().toUpperCase());
  }

  isWarmupActive(bucket, nowMs = Date.now()) {
    return Boolean(bucket?.warmupUntil && bucket.warmupUntil > nowMs);
  }

  getBucket(symbol) {
    if (!this.buckets.has(symbol)) {
      this.buckets.set(symbol, {
        symbol,
        synced: false,
        primingPromise: null,
        lastUpdateId: 0,
        lastSnapshotAt: null,
        lastEventAt: null,
        resyncCount: 0,
        gapCount: 0,
        missedEvents: 0,
        bids: new Map(),
        asks: new Map(),
        buffer: [],
        deltaHistory: createBucket(240),
        lastDepthSummary: null,
        bootstrapStartedAt: null,
        warmupUntil: null,
        lastResetReason: null
      });
    }
    return this.buckets.get(symbol);
  }

  resetBucket(bucket, reason = "resync") {
    bucket.synced = false;
    bucket.lastUpdateId = 0;
    bucket.bids = new Map();
    bucket.asks = new Map();
    bucket.buffer = [];
    bucket.bootstrapStartedAt = null;
    bucket.warmupUntil = null;
    bucket.lastResetReason = reason;
    bucket.resyncCount += 1;
    bucket.lastDepthSummary = null;
    const logMethod = reason === "warmup_gap" ? "info" : "warn";
    this.logger?.[logMethod]?.("Local order book reset", { symbol: bucket.symbol, reason });
  }

  async waitForInitialBuffer(bucket) {
    const waitMs = Math.max(0, Number(this.config.localBookBootstrapWaitMs || 0));
    if (!waitMs || bucket.buffer.length > 0 || bucket.lastUpdateId > 0) {
      return;
    }
    const startedAt = Date.now();
    bucket.bootstrapStartedAt = bucket.bootstrapStartedAt || startedAt;
    const deadline = startedAt + waitMs;
    while (bucket.buffer.length === 0 && Date.now() < deadline) {
      await sleep(25);
    }
  }

  async ensurePrimed(symbol) {
    const bucket = this.getBucket(symbol);
    if (!this.isSymbolActive(symbol)) {
      return bucket;
    }
    if (bucket.synced) {
      return bucket;
    }
    if (bucket.primingPromise) {
      return bucket.primingPromise;
    }

    bucket.primingPromise = (async () => {
      await this.waitForInitialBuffer(bucket);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const snapshot = await this.client.getOrderBook(symbol, this.config.streamDepthSnapshotLimit);
        bucket.bids = new Map((snapshot.bids || []).map(([price, quantity]) => [`${price}`, Number(quantity)]));
        bucket.asks = new Map((snapshot.asks || []).map(([price, quantity]) => [`${price}`, Number(quantity)]));
        bucket.lastUpdateId = Number(snapshot.lastUpdateId || 0);
        bucket.lastSnapshotAt = new Date().toISOString();
        bucket.lastEventAt = bucket.lastEventAt || bucket.lastSnapshotAt;

        const buffered = bucket.buffer
          .filter((event) => Number(event.u || 0) > bucket.lastUpdateId)
          .sort((left, right) => Number(left.U || left.u || 0) - Number(right.U || right.u || 0));

        if (buffered.length && Number(buffered[0].U || 0) > bucket.lastUpdateId + 1) {
          bucket.missedEvents += 1;
          bucket.gapCount += 1;
          await sleep(40 * (attempt + 1));
          continue;
        }

        bucket.synced = true;
        bucket.buffer = [];
        bucket.bootstrapStartedAt = null;
        bucket.warmupUntil = Date.now() + Math.max(0, Number(this.config.localBookWarmupMs || 0));
        bucket.lastResetReason = null;
        for (const event of buffered) {
          if (!this.applyEvent(bucket, event)) {
            bucket.synced = false;
            break;
          }
        }

        if (bucket.synced) {
          bucket.lastDepthSummary = this.computeDepthSummary(bucket);
          return bucket;
        }
      }

      this.resetBucket(bucket, "prime_failed");
      throw new Error(`Unable to synchronize local order book for ${symbol}.`);
    })().finally(() => {
      bucket.primingPromise = null;
    });

    return bucket.primingPromise;
  }

  applySide(map, updates = []) {
    let deltaNotional = 0;
    for (const [rawPrice, rawQty] of updates) {
      const price = `${rawPrice}`;
      const priceNumber = Number(rawPrice || 0);
      const previousQuantity = Number(map.get(price) || 0);
      const quantity = Number(rawQty || 0);
      deltaNotional += priceNumber * (quantity - previousQuantity);
      if (!quantity) {
        map.delete(price);
      } else {
        map.set(price, quantity);
      }
    }
    return deltaNotional;
  }

  trackDelta(bucket, bidDeltaNotional, askDeltaNotional, event) {
    const signedBid = bidDeltaNotional;
    const signedAsk = -1 * askDeltaNotional;
    bucket.deltaHistory.push({
      at: new Date(event.E || Date.now()).toISOString(),
      bidDeltaNotional,
      askDeltaNotional,
      signedBid,
      signedAsk
    });
  }

  applyEvent(bucket, event) {
    const firstUpdateId = Number(event.U || event.u || 0);
    const finalUpdateId = Number(event.u || event.U || 0);
    if (!bucket.synced) {
      return false;
    }
    if (finalUpdateId <= bucket.lastUpdateId) {
      return true;
    }
    if (firstUpdateId > bucket.lastUpdateId + 1) {
      bucket.gapCount += 1;
      bucket.missedEvents += 1;
      return false;
    }
    const bidDeltaNotional = this.applySide(bucket.bids, event.b || []);
    const askDeltaNotional = this.applySide(bucket.asks, event.a || []);
    bucket.lastUpdateId = finalUpdateId;
    bucket.lastEventAt = new Date(event.E || Date.now()).toISOString();
    this.trackDelta(bucket, bidDeltaNotional, askDeltaNotional, event);
    bucket.lastDepthSummary = this.computeDepthSummary(bucket);
    return true;
  }

  handleDepthEvent(symbol, event) {
    const bucket = this.getBucket(symbol);
    if (!this.isSymbolActive(symbol)) {
      bucket.buffer = [];
      return;
    }
    bucket.buffer.push(event);
    if (bucket.buffer.length > 400) {
      bucket.buffer.shift();
    }

    if (!bucket.synced) {
      void this.ensurePrimed(symbol).catch((error) => {
        bucket.missedEvents += 1;
        this.logger?.warn?.("Local order book prime failed", { symbol, error: error.message });
      });
      return;
    }

    const applied = this.applyEvent(bucket, event);
    if (!applied) {
      const reason = this.isWarmupActive(bucket) ? "warmup_gap" : "sequence_gap";
      this.resetBucket(bucket, reason);
      void this.ensurePrimed(symbol).catch((error) => {
        bucket.missedEvents += 1;
        this.logger?.warn?.("Local order book resync failed", { symbol, error: error.message });
      });
    }
  }

  computeDepthSummary(bucket) {
    const limit = this.config.streamDepthLevels;
    const bids = toLevels(bucket.bids, true, limit);
    const asks = toLevels(bucket.asks, false, limit);
    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 0;
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;
    const topBidQty = bestQty(bids);
    const topAskQty = bestQty(asks);
    const queueImbalance = ratio(topBidQty - topAskQty, topBidQty + topAskQty, 0);
    const bidDepth = bids.reduce((total, [price, quantity]) => total + price * quantity, 0);
    const askDepth = asks.reduce((total, [price, quantity]) => total + price * quantity, 0);
    const totalDepth = bidDepth + askDepth;
    const deltaHistory = bucket.deltaHistory.items;
    const signedValues = deltaHistory.flatMap((item) => [item.signedBid, item.signedAsk]);
    const replenishValues = deltaHistory.map((item) => item.bidDeltaNotional - item.askDeltaNotional);
    const queueRefreshScore = clamp(ratio(sumPositive(replenishValues) - sumNegativeAbs(replenishValues), sumPositive(replenishValues) + sumNegativeAbs(replenishValues), 0), -1, 1);
    const resilienceScore = clamp(ratio(sumSigned(signedValues), Math.abs(sumSigned(signedValues)) + totalDepth * 0.05, 0), -1, 1);
    const rawDepthAgeMs = bucket.lastEventAt ? Date.now() - new Date(bucket.lastEventAt).getTime() : Number.MAX_SAFE_INTEGER;
    const depthAgeMs = Number.isFinite(rawDepthAgeMs) ? Math.max(0, rawDepthAgeMs) : Number.MAX_SAFE_INTEGER;
    const freshnessScore = clamp(1 - depthAgeMs / Math.max(this.config.maxDepthEventAgeMs, 1), 0, 1);
    const warmupRemainingMs = bucket.warmupUntil ? Math.max(0, bucket.warmupUntil - Date.now()) : 0;
    const warmupActive = warmupRemainingMs > 0;
    const depthConfidence = clamp(
      ((bucket.synced ? 0.38 : 0) +
      freshnessScore * 0.3 +
      clamp((bids.length + asks.length) / Math.max(limit * 2, 1), 0, 1) * 0.18 +
      clamp(1 - bucket.gapCount / 4, 0, 1) * 0.14) * (warmupActive ? 0.9 : 1),
      0,
      1
    );

    return {
      synced: bucket.synced,
      lastUpdateId: bucket.lastUpdateId,
      lastSnapshotAt: bucket.lastSnapshotAt,
      lastEventAt: bucket.lastEventAt,
      depthAgeMs,
      bestBid,
      bestAsk,
      mid,
      bids,
      asks,
      queueImbalance,
      bidDepthNotional: bidDepth,
      askDepthNotional: askDepth,
      totalDepthNotional: totalDepth,
      queueRefreshScore,
      resilienceScore,
      depthConfidence,
      resyncCount: bucket.resyncCount,
      gapCount: bucket.gapCount,
      missedEvents: bucket.missedEvents,
      warmupActive,
      warmupRemainingMs,
      lastResetReason: bucket.lastResetReason || null
    };
  }

  getSnapshot(symbol) {
    const bucket = this.getBucket(symbol);
    return bucket.lastDepthSummary || this.computeDepthSummary(bucket);
  }

  estimateFill(symbol, side, request = {}) {
    const snapshot = this.getSnapshot(symbol);
    const levels = side === "BUY" ? snapshot.asks : snapshot.bids;
    const walked = walkLevels(levels, side, request);
    const touch = side === "BUY" ? snapshot.bestAsk : snapshot.bestBid;
    const mid = snapshot.mid || touch || walked.averagePrice || 0;
    const touchSlippageBps = touch ? ((side === "BUY" ? walked.averagePrice - touch : touch - walked.averagePrice) / touch) * 10_000 : 0;
    const midSlippageBps = mid ? ((side === "BUY" ? walked.averagePrice - mid : mid - walked.averagePrice) / mid) * 10_000 : 0;
    return {
      ...walked,
      touch,
      mid,
      touchSlippageBps: Number.isFinite(touchSlippageBps) ? touchSlippageBps : 0,
      midSlippageBps: Number.isFinite(midSlippageBps) ? midSlippageBps : 0,
      depthConfidence: snapshot.depthConfidence,
      queueImbalance: snapshot.queueImbalance,
      queueRefreshScore: snapshot.queueRefreshScore,
      resilienceScore: snapshot.resilienceScore
    };
  }

  getSummary() {
    const activeSymbols = [...this.activeSymbols];
    for (const symbol of activeSymbols) {
      this.getBucket(symbol);
    }
    const trackedSymbols = [...this.buckets.keys()];
    const symbols = activeSymbols.length ? activeSymbols : trackedSymbols;
    const snapshots = symbols.map((symbol) => this.getSnapshot(symbol));
    const healthy = snapshots.filter((item) => item.synced && item.depthAgeMs <= this.config.maxDepthEventAgeMs).length;
    const warming = snapshots.filter((item) => item.warmupActive).length;
    return {
      enabled: this.config.enableLocalOrderBook,
      trackedSymbols: trackedSymbols.length,
      activeSymbols: activeSymbols.length,
      healthySymbols: healthy,
      warmingSymbols: warming,
      totalResyncs: snapshots.reduce((total, item) => total + (item.resyncCount || 0), 0),
      totalGaps: snapshots.reduce((total, item) => total + (item.gapCount || 0), 0),
      averageDepthConfidence: snapshots.length
        ? snapshots.reduce((total, item) => total + (item.depthConfidence || 0), 0) / snapshots.length
        : 0
    };
  }
}
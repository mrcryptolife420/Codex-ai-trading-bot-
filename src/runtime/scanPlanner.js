import { computeOrderBookFeatures } from "../strategy/indicators.js";
import { clamp } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function safeDivide(numerator, denominator, fallback = 0) {
  return denominator ? numerator / denominator : fallback;
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function sumDepthNotional(levels = []) {
  return levels.reduce((total, [price, quantity]) => total + Number(price || 0) * Number(quantity || 0), 0);
}

function buildSyntheticOrderBook({ bid, ask, bidQty, askQty, localBook = null }) {
  if (Array.isArray(localBook?.bids) && localBook.bids.length && Array.isArray(localBook?.asks) && localBook.asks.length) {
    return {
      bids: localBook.bids.slice(0, 10),
      asks: localBook.asks.slice(0, 10)
    };
  }

  return {
    bids: bid && bidQty ? [[bid, bidQty]] : [],
    asks: ask && askQty ? [[ask, askQty]] : []
  };
}

function buildFallbackUniverseSnapshot({ nowIso, symbols = [] }) {
  return {
    generatedAt: nowIso,
    configuredSymbolCount: symbols.length,
    selectedCount: symbols.length,
    eligibleCount: symbols.length,
    selectionRate: symbols.length ? 1 : 0,
    averageScore: 0,
    selectedSymbols: [...symbols],
    selected: symbols.map((symbol) => ({
      symbol,
      score: 0,
      health: "watch",
      spreadBps: 0,
      depthConfidence: 0,
      totalDepthNotional: 0,
      recentTradeCount: 0,
      realizedVolPct: 0,
      reasons: ["universe_selector_disabled"],
      blockers: []
    })),
    skipped: [],
    suggestions: ["Universe selector uitgeschakeld; volledige watchlist wordt geevalueerd."]
  };
}

export function buildLightweightSnapshot({
  symbol,
  config,
  streamFeatures = {},
  localBookSnapshot = null,
  cachedSnapshot = null
}) {
  const localBook = localBookSnapshot || streamFeatures.localBook || null;
  const cachedBook = cachedSnapshot?.book || {};
  const cachedMarket = cachedSnapshot?.market || {};
  const latestBookTicker = streamFeatures.latestBookTicker || (localBook?.bestBid && localBook?.bestAsk
    ? {
        bid: localBook.bestBid,
        ask: localBook.bestAsk,
        bidQty: localBook.bids?.[0]?.[1] || 0,
        askQty: localBook.asks?.[0]?.[1] || 0,
        mid: localBook.mid,
        eventTime: localBook.lastEventAt
      }
    : null);

  const bid = safeNumber(latestBookTicker?.bid, safeNumber(cachedBook.bid, safeNumber(localBook?.bestBid)));
  const ask = safeNumber(latestBookTicker?.ask, safeNumber(cachedBook.ask, safeNumber(localBook?.bestAsk)));
  const bidQty = safeNumber(latestBookTicker?.bidQty, safeNumber(localBook?.bids?.[0]?.[1]));
  const askQty = safeNumber(latestBookTicker?.askQty, safeNumber(localBook?.asks?.[0]?.[1]));
  const syntheticOrderBook = buildSyntheticOrderBook({ bid, ask, bidQty, askQty, localBook });
  const book = computeOrderBookFeatures(
    { bidPrice: bid, askPrice: ask },
    syntheticOrderBook
  );

  const recentTradeCount = safeNumber(streamFeatures.recentTradeCount, safeNumber(cachedSnapshot?.stream?.recentTradeCount));
  const tradeFlowImbalance = safeNumber(streamFeatures.tradeFlowImbalance, safeNumber(cachedSnapshot?.stream?.tradeFlowImbalance));
  const microTrend = safeNumber(streamFeatures.microTrend, safeNumber(cachedSnapshot?.stream?.microTrend));
  const rawDepthNotional = sumDepthNotional(syntheticOrderBook.bids) + sumDepthNotional(syntheticOrderBook.asks);
  const spreadQuality = clamp(1 - safeDivide(book.spreadBps, Math.max((config.maxSpreadBps || 25) * 1.5, 1)), 0, 1);
  const fallbackDepthNotional = Math.max(
    rawDepthNotional,
    safeNumber(cachedBook.totalDepthNotional),
    (config.universeMinDepthUsd || 30000) * (0.18 + spreadQuality * 0.32 + clamp(recentTradeCount / 20, 0, 1) * 0.26)
  );
  const depthConfidence = localBook?.synced
    ? safeNumber(localBook.depthConfidence)
    : clamp(
        (latestBookTicker ? 0.16 : 0.04) +
          spreadQuality * 0.3 +
          clamp(recentTradeCount / 24, 0, 1) * 0.24 +
          (cachedSnapshot ? 0.12 : 0) +
          (bidQty && askQty ? 0.08 : 0),
        0,
        0.82
      );

  book.bid = bid;
  book.ask = ask;
  book.mid = book.mid || (bid && ask ? (bid + ask) / 2 : bid || ask || safeNumber(cachedBook.mid));
  book.tradeFlowImbalance = tradeFlowImbalance;
  book.microTrend = microTrend;
  book.recentTradeCount = recentTradeCount;
  book.localBook = localBook;
  book.localBookSynced = Boolean(localBook?.synced);
  book.queueImbalance = safeNumber(localBook?.queueImbalance, safeNumber(cachedBook.queueImbalance));
  book.queueRefreshScore = safeNumber(localBook?.queueRefreshScore, safeNumber(cachedBook.queueRefreshScore));
  book.resilienceScore = safeNumber(localBook?.resilienceScore, safeNumber(cachedBook.resilienceScore));
  book.depthConfidence = depthConfidence;
  book.depthAgeMs = localBook?.depthAgeMs ?? null;
  book.totalDepthNotional = fallbackDepthNotional;

  const inferredVol = clamp(
    Math.abs(microTrend) * 5.5 + (book.spreadBps / 10000) * 2.5 + (1 - spreadQuality) * 0.012,
    0.0025,
    config.maxRealizedVolPct || 0.07
  );
  const market = {
    ...cachedMarket,
    realizedVolPct: safeNumber(cachedMarket.realizedVolPct, inferredVol),
    volumeZ: safeNumber(cachedMarket.volumeZ, clamp(recentTradeCount / 12 - 1, -2, 3)),
    momentum20: safeNumber(cachedMarket.momentum20, microTrend * 4),
    emaTrendScore: safeNumber(cachedMarket.emaTrendScore, clamp(microTrend * 16, -1, 1)),
    breakoutPct: safeNumber(cachedMarket.breakoutPct, clamp(Math.abs(microTrend) * 3.5, 0, 0.05)),
    structureBreakScore: safeNumber(cachedMarket.structureBreakScore, clamp(microTrend * 14, -1, 1)),
    dominantPattern: cachedMarket.dominantPattern || "none",
    bullishPatternScore: safeNumber(cachedMarket.bullishPatternScore),
    bearishPatternScore: safeNumber(cachedMarket.bearishPatternScore),
    insideBar: safeNumber(cachedMarket.insideBar),
    liquiditySweepLabel: cachedMarket.liquiditySweepLabel || "none",
    structureBreakLabel: cachedMarket.structureBreakLabel || "none"
  };

  return {
    symbol,
    candles: cachedSnapshot?.candles || [],
    market,
    book,
    stream: {
      ...streamFeatures,
      latestBookTicker,
      recentTradeCount,
      tradeFlowImbalance,
      microTrend,
      localBook
    },
    lightweight: true,
    cachedAt: cachedSnapshot?.cachedAt || null
  };
}

export function buildDeepScanPlan({
  config,
  watchlist = [],
  openPositions = [],
  latestDecisions = [],
  shallowSnapshotMap = {},
  universeSelector,
  nowIso = new Date().toISOString()
}) {
  const openPositionSymbols = unique((openPositions || []).map((position) => position.symbol));
  const fallbackSymbols = unique([...openPositionSymbols, ...watchlist]).slice(0, config.universeMaxSymbols || watchlist.length);
  const universeSnapshot = config.enableUniverseSelector && universeSelector
    ? universeSelector.buildSnapshot({
        symbols: watchlist,
        snapshotMap: shallowSnapshotMap,
        openPositions,
        latestDecisions,
        nowIso
      })
    : buildFallbackUniverseSnapshot({ nowIso, symbols: fallbackSymbols });

  const previousAllowed = unique(
    (latestDecisions || [])
      .filter((decision) => decision.allow)
      .slice(0, Math.max(2, Math.ceil((config.marketSnapshotBudgetSymbols || config.universeMaxSymbols || 0) / 4)))
      .map((decision) => decision.symbol)
  );
  const deepScanBudget = Math.max(
    config.universeMaxSymbols || 0,
    config.marketSnapshotBudgetSymbols || 0,
    openPositionSymbols.length
  );
  const localBookBudget = Math.max(
    openPositionSymbols.length,
    config.localBookMaxSymbols || deepScanBudget
  );
  const warmupBudget = Math.max(4, Math.ceil(localBookBudget / 3));
  const selectedSymbols = (universeSnapshot.selectedSymbols || []).length
    ? universeSnapshot.selectedSymbols
    : fallbackSymbols;
  const deepScanSymbols = unique([...openPositionSymbols, ...selectedSymbols, ...previousAllowed]).slice(0, deepScanBudget);
  const localBookSymbols = unique([...openPositionSymbols, ...deepScanSymbols, ...watchlist.slice(0, warmupBudget)]).slice(0, localBookBudget);

  return {
    universeSnapshot,
    deepScanSymbols,
    localBookSymbols
  };
}





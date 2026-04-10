import { normalizeKlines } from "../binance/client.js";
import { classifyRegime } from "../ai/regimeModel.js";
import { buildDataQualitySummary, buildSignalQualitySummary, buildConfidenceBreakdown } from "../strategy/candidateInsights.js";
import { computeMarketFeatures, computeOrderBookFeatures } from "../strategy/indicators.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { buildTrendStateSummary } from "../strategy/trendState.js";
import { buildMarketStateSummary } from "../strategy/marketState.js";
import { mapWithConcurrency } from "../utils/async.js";
import { clamp } from "../utils/math.js";
import { buildTradableUniverse, getSymbolHygieneFlags } from "./watchlistResolver.js";

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function num(value, digits = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : 0;
}

function average(values = [], fallback = 0) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((total, value) => total + value, 0) / usable.length : fallback;
}

function safeDivide(numerator, denominator, fallback = 0) {
  return denominator ? numerator / denominator : fallback;
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function parseIntervalToBars(interval = "15m", minutes = 60) {
  const match = `${interval}`.match(/^(\d+)([mhd])$/i);
  if (!match) {
    return Math.max(1, Math.round(minutes / 15));
  }
  const amount = Number(match[1] || 0);
  const multiplier = match[2].toLowerCase() === "d"
    ? 1440
    : match[2].toLowerCase() === "h"
      ? 60
      : 1;
  return Math.max(1, Math.round(minutes / Math.max(1, amount * multiplier)));
}

function pctChangeFromClose(candles = [], bars = 1) {
  if (!candles.length || candles.length <= bars) {
    return 0;
  }
  const latest = Number(candles.at(-1)?.close || 0);
  const previous = Number(candles.at(-1 - bars)?.close || 0);
  return previous > 0 ? latest / previous - 1 : 0;
}

function normalizeScale(value, values = [], { inverse = false, log = false } = {}) {
  const usable = values
    .map((item) => {
      const numeric = Number(item);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      return log ? Math.log10(Math.max(numeric, 1e-9)) : numeric;
    })
    .filter((item) => item != null);
  const current = Number(value);
  if (!usable.length || !Number.isFinite(current)) {
    return 0;
  }
  const normalizedCurrent = log ? Math.log10(Math.max(current, 1e-9)) : current;
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  if (!(max > min)) {
    return inverse ? 1 : 0.5;
  }
  const scaled = clamp((normalizedCurrent - min) / (max - min), 0, 1);
  return inverse ? 1 - scaled : scaled;
}

function buildSyntheticBookFromTicker(ticker = {}) {
  const bid = Number(ticker.bidPrice || 0);
  const ask = Number(ticker.askPrice || 0);
  const bidQty = Number(ticker.bidQty || 0);
  const askQty = Number(ticker.askQty || 0);
  return {
    bids: bid > 0 && bidQty > 0 ? [[bid, bidQty]] : [],
    asks: ask > 0 && askQty > 0 ? [[ask, askQty]] : []
  };
}

function normalizeOrderBook(orderBook = {}, levelLimit = 20) {
  const bids = arr(orderBook.bids || [])
    .map(([price, quantity]) => [Number(price || 0), Number(quantity || 0)])
    .filter(([price, quantity]) => price > 0 && quantity > 0)
    .slice(0, levelLimit);
  const asks = arr(orderBook.asks || [])
    .map(([price, quantity]) => [Number(price || 0), Number(quantity || 0)])
    .filter(([price, quantity]) => price > 0 && quantity > 0)
    .slice(0, levelLimit);
  return { bids, asks };
}

function buildDeepBookMetrics(book = {}) {
  const bids = arr(book.bids || []);
  const asks = arr(book.asks || []);
  const bidDepth = bids.reduce((total, [price, quantity]) => total + price * quantity, 0);
  const askDepth = asks.reduce((total, [price, quantity]) => total + price * quantity, 0);
  const totalDepthNotional = bidDepth + askDepth;
  const averageBidLevel = bids.length ? bidDepth / bids.length : 0;
  const averageAskLevel = asks.length ? askDepth / asks.length : 0;
  const bidQty = bids[0]?.[1] || 0;
  const askQty = asks[0]?.[1] || 0;
  const bid = bids[0]?.[0] || 0;
  const ask = asks[0]?.[0] || 0;
  const queueRefreshScore = clamp(
    average([
      clamp(Math.min(bids.length, asks.length) / 20, 0, 1),
      clamp(totalDepthNotional / 120000, 0, 1),
      clamp(Math.min(averageBidLevel, averageAskLevel) / 12000, 0, 1)
    ], 0.45),
    0,
    1
  );
  const resilienceScore = clamp(
    average([
      clamp(totalDepthNotional / 180000, 0, 1),
      clamp(Math.min(averageBidLevel, averageAskLevel) / 16000, 0, 1),
      bid > 0 && ask > 0 ? 0.62 : 0.28
    ], 0.5),
    0,
    1
  );
  const depthConfidence = clamp(
    average([
      clamp(Math.min(bids.length, asks.length) / 20, 0, 1),
      clamp(totalDepthNotional / 150000, 0, 1),
      queueRefreshScore,
      resilienceScore
    ], 0.5),
    0.28,
    0.98
  );
  return {
    bid,
    ask,
    bidQty,
    askQty,
    totalDepthNotional,
    queueRefreshScore,
    resilienceScore,
    depthConfidence
  };
}

function buildTickerSnapshot({
  symbol,
  ticker = {},
  candles = [],
  marketFeatures = null,
  orderBook = null,
  bookSource = null
}) {
  const normalizedBook = orderBook ? normalizeOrderBook(orderBook) : buildSyntheticBookFromTicker(ticker);
  const bid = Number(ticker.bidPrice || 0);
  const ask = Number(ticker.askPrice || 0);
  const tradeCount = Number(ticker.count || 0);
  const quoteVolume = Number(ticker.quoteVolume || 0);
  const deepBookMetrics = buildDeepBookMetrics(normalizedBook);
  const baseBook = computeOrderBookFeatures(
    { bidPrice: deepBookMetrics.bid || bid, askPrice: deepBookMetrics.ask || ask },
    normalizedBook
  );
  const depthNotional = deepBookMetrics.totalDepthNotional;
  const market = marketFeatures || (candles.length ? computeMarketFeatures(candles) : {});
  const isDeepBook = Boolean(orderBook);
  return {
    symbol,
    candles,
    market,
    book: {
      ...baseBook,
      bid: deepBookMetrics.bid || bid,
      ask: deepBookMetrics.ask || ask,
      recentTradeCount: tradeCount,
      totalDepthNotional: depthNotional,
      depthConfidence: isDeepBook
        ? deepBookMetrics.depthConfidence
        : clamp(
            (bid > 0 && ask > 0 ? 0.24 : 0) +
              clamp(tradeCount / 4000, 0, 1) * 0.34 +
              clamp(quoteVolume / 20000000, 0, 1) * 0.3,
            0.18,
            0.92
          ),
      localBookSynced: isDeepBook,
      queueRefreshScore: isDeepBook ? deepBookMetrics.queueRefreshScore : clamp(tradeCount / 6000, 0, 1),
      resilienceScore: isDeepBook
        ? deepBookMetrics.resilienceScore
        : clamp(0.4 + clamp(quoteVolume / 12000000, 0, 1) * 0.4 - clamp((baseBook.spreadBps || 0) / 80, 0, 0.3), 0, 1),
      depthAgeMs: isDeepBook ? 0 : null,
      source: bookSource || (isDeepBook ? "deep_order_book" : "ticker_proxy")
    },
    stream: {
      recentTradeCount: tradeCount,
      tradeFlowImbalance: 0,
      microTrend: 0,
      latestBookTicker: {
        bid: deepBookMetrics.bid || bid,
        ask: deepBookMetrics.ask || ask,
        bidQty: deepBookMetrics.bidQty || Number(ticker.bidQty || 0),
        askQty: deepBookMetrics.askQty || Number(ticker.askQty || 0)
      }
    },
    lightweight: !isDeepBook
  };
}

function buildUniverseEntry({ symbolInfo, ticker, quoteAsset = "USDT" }) {
  const hygiene = getSymbolHygieneFlags(symbolInfo.baseAsset, symbolInfo.baseAsset, quoteAsset);
  return {
    symbol: symbolInfo.symbol,
    baseAsset: symbolInfo.baseAsset,
    quoteAsset,
    status: symbolInfo.status,
    quoteVolume: Number(ticker.quoteVolume || 0),
    volume: Number(ticker.volume || 0),
    tradeCount: Number(ticker.count || 0),
    lastPrice: Number(ticker.lastPrice || 0),
    priceChangePct24h: safeDivide(Number(ticker.priceChangePercent || 0), 100, 0),
    weightedAvgPrice: Number(ticker.weightedAvgPrice || 0),
    bidPrice: Number(ticker.bidPrice || 0),
    askPrice: Number(ticker.askPrice || 0),
    bidQty: Number(ticker.bidQty || 0),
    askQty: Number(ticker.askQty || 0),
    spreadBps: Number(ticker.bidPrice || 0) > 0 && Number(ticker.askPrice || 0) > 0
      ? ((Number(ticker.askPrice) - Number(ticker.bidPrice)) / ((Number(ticker.askPrice) + Number(ticker.bidPrice)) / 2)) * 10000
      : 0,
    depthNotional: Number(ticker.bidPrice || 0) * Number(ticker.bidQty || 0) + Number(ticker.askPrice || 0) * Number(ticker.askQty || 0),
    isSpotTradingAllowed: Boolean(symbolInfo.isSpotTradingAllowed ?? true),
    symbolHygiene: {
      invalidTicker: hygiene.invalidTicker,
      quoteWrapped: hygiene.quoteWrapped,
      fiatSuffixWrapped: hygiene.fiatSuffixWrapped
    }
  };
}

function buildTradabilityScores(entries = [], config = {}) {
  const volumes = entries.map((entry) => entry.quoteVolume);
  const tradeCounts = entries.map((entry) => entry.tradeCount);
  const depths = entries.map((entry) => entry.depthNotional);
  const spreads = entries.map((entry) => entry.spreadBps);

  return entries.map((entry) => {
    const liquidityScore = average([
      normalizeScale(entry.quoteVolume, volumes, { log: true }),
      normalizeScale(entry.depthNotional, depths, { log: true })
    ], 0);
    const activityScore = normalizeScale(entry.tradeCount, tradeCounts, { log: true });
    const spreadScore = normalizeScale(entry.spreadBps, spreads, { inverse: true });
    const executionScore = clamp(liquidityScore * 0.46 + spreadScore * 0.34 + activityScore * 0.2, 0, 1);
    const tradabilityScore = clamp(liquidityScore * 0.44 + activityScore * 0.2 + spreadScore * 0.22 + executionScore * 0.14, 0, 1);
    const blockers = [];
    if (!entry.isSpotTradingAllowed) {
      blockers.push("spot_not_allowed");
    }
    if (entry.quoteVolume < Number(config.scannerMinQuoteVolumeUsd || 200000)) {
      blockers.push("low_quote_volume");
    }
    if (entry.tradeCount < Number(config.scannerMinTradeCount24h || 250)) {
      blockers.push("low_trade_count");
    }
    if (entry.spreadBps > Number(config.scannerMaxSpreadBps || Math.max((config.maxSpreadBps || 25) * 2, 35))) {
      blockers.push("wide_spread");
    }
    if (entry.depthNotional < Number(config.scannerMinDepthNotionalUsd || 2500)) {
      blockers.push("thin_top_of_book");
    }
    return {
      ...entry,
      liquidityScore: num(liquidityScore),
      activityScore: num(activityScore),
      spreadQualityScore: num(spreadScore),
      executionScore: num(executionScore),
      tradabilityScore: num(tradabilityScore),
      blockers
    };
  });
}

function extractHistoricalBehavior(candles = [], market = {}) {
  const ret1h = pctChangeFromClose(candles, 4);
  const ret4h = pctChangeFromClose(candles, 16);
  const ret24h = pctChangeFromClose(candles, 96);
  const acceleration = ret1h - safeDivide(ret4h, 4, 0);
  const recentVolumes = candles.slice(-8).map((candle) => Number(candle.volume || 0));
  const baselineVolumes = candles.slice(-32, -8).map((candle) => Number(candle.volume || 0));
  const volumeExpansion = safeDivide(average(recentVolumes), average(baselineVolumes), 1);
  const upperWickPenalty = candles.slice(-12).reduce((total, candle) => {
    const high = Number(candle.high || 0);
    const close = Number(candle.close || 0);
    const open = Number(candle.open || 0);
    const low = Number(candle.low || 0);
    const range = Math.max(high - low, 1e-9);
    const upperWick = high - Math.max(open, close);
    return total + clamp(upperWick / range, 0, 1);
  }, 0) / Math.max(candles.slice(-12).length, 1);
  const downsideRecovery = candles.slice(-20).reduce((total, candle, index, source) => {
    if (index < 4) {
      return total;
    }
    const previous = source[index - 4];
    const prevClose = Number(previous.close || 0);
    const currentClose = Number(candle.close || 0);
    return total + (currentClose >= prevClose ? 1 : 0);
  }, 0) / Math.max(candles.slice(-20).length - 4, 1);
  const continuationTendency = clamp(
    average([
      clamp(ret4h * 8 + 0.5, 0, 1),
      clamp(market.breakoutFollowThroughScore || 0, 0, 1),
      clamp(market.volumeAcceptanceScore || 0, 0, 1),
      clamp(downsideRecovery, 0, 1)
    ], 0.5),
    0,
    1
  );
  const fakeoutRisk = clamp(
    average([
      upperWickPenalty,
      clamp(market.trendExhaustionScore || 0, 0, 1),
      volumeExpansion > 1.8 && ret1h < 0 ? 0.7 : 0.2
    ], 0.3),
    0,
    1
  );
  const overextensionPenalty = clamp(
    average([
      clamp(Math.max(0, ret1h) * 18, 0, 1),
      clamp(Math.max(0, ret4h) * 7, 0, 1),
      clamp(market.trendExhaustionScore || 0, 0, 1)
    ], 0),
    0,
    1
  );
  return {
    ret1h,
    ret4h,
    ret24h,
    acceleration,
    volumeExpansion,
    continuationTendency,
    fakeoutRisk,
    downsideRecovery,
    overextensionPenalty
  };
}

function matchScope(item = {}, scopes = {}) {
  if (!item?.id && !item?.type) {
    return false;
  }
  if (item.type === "family" && scopes.family && item.id === scopes.family) {
    return true;
  }
  if (item.type === "regime" && scopes.regime && item.id === scopes.regime) {
    return true;
  }
  if (item.type === "session" && scopes.session && item.id === scopes.session) {
    return true;
  }
  if (item.type === "condition" && scopes.condition && item.id === scopes.condition) {
    return true;
  }
  return false;
}

function buildBotHistoryContext({
  symbol,
  strategySummary = {},
  regimeSummary = {},
  sessionLabel = null,
  marketStateSummary = {},
  offlineTrainer = {},
  paperLearning = {},
  journal = {}
}) {
  const strategyId = strategySummary.activeStrategy || strategySummary.id || null;
  const familyId = strategySummary.familyId || strategySummary.activeFamily || strategySummary.family || null;
  const regimeId = regimeSummary.regime || null;
  const conditionId = marketStateSummary.phase || marketStateSummary.conditionId || null;
  const directTrades = arr(journal.trades || []).filter((trade) => trade.symbol === symbol).slice(-24);
  const symbolWinRate = safeDivide(directTrades.filter((trade) => (trade.pnlQuote || 0) > 0).length, directTrades.length, 0.5);
  const symbolPnlEdge = clamp(safeDivide(average(directTrades.map((trade) => Number(trade.netPnlPct || 0))), 0.02, 0) * 0.5 + 0.5, 0, 1);
  const symbolCard = arr(offlineTrainer.symbolScorecards || []).find((item) => item.id === symbol || item.symbol === symbol) || null;
  const strategyCard = arr(offlineTrainer.strategyScorecards || []).find((item) => item.id === strategyId) || null;
  const familyCard = arr(offlineTrainer.familyScorecards || []).find((item) => item.id === familyId) || null;
  const regimeCard = arr(offlineTrainer.regimeScorecards || []).find((item) => item.id === regimeId) || null;
  const scopeMatches = arr(paperLearning.scopeReadiness || []).filter((item) => matchScope(item, {
    family: familyId,
    regime: regimeId,
    session: sessionLabel,
    condition: conditionId
  }));
  const reviewQueue = arr(paperLearning.reviewQueue || []);
  const reviewHit = reviewQueue.find((item) =>
    `${item.id || ""}`.includes(symbol) ||
    (strategyId && `${item.id || ""}`.includes(strategyId)) ||
    (familyId && `${item.id || ""}`.includes(familyId)) ||
    (regimeId && `${item.id || ""}`.includes(regimeId))
  ) || null;
  const directCounterfactuals = arr(journal.counterfactuals || [])
    .filter((item) => item.symbol === symbol || item.strategy === strategyId || item.familyId === familyId || item.regime === regimeId)
    .slice(-20);
  const badVetoRate = safeDivide(
    directCounterfactuals.filter((item) => ["bad_veto", "near_miss_winner", "late_veto"].includes(item.outcomeLabel || item.outcome)).length,
    directCounterfactuals.length,
    0
  );
  const goodVetoRate = safeDivide(
    directCounterfactuals.filter((item) => ["good_veto", "fakeout_avoided", "near_miss_loser"].includes(item.outcomeLabel || item.outcome)).length,
    directCounterfactuals.length,
    0
  );
  const governanceBlend = average([
    symbolCard?.governanceScore,
    strategyCard?.governanceScore,
    familyCard?.governanceScore,
    regimeCard?.governanceScore
  ], 0.5);
  const readinessBlend = average(scopeMatches.map((item) => Number(item.effectiveReadinessScore || item.readinessScore || 0)), scopeMatches.length ? undefined : 0.45);
  const reviewImpactBoost = clamp((reviewHit?.impactScore || 0) * 0.35, 0, 0.2);
  const symbolTrapScore = Number(symbolCard?.trapScore || 0);
  const trapWarning = symbolCard?.trapStatus === "trap" ||
    symbolTrapScore >= 0.58 ||
    badVetoRate >= 0.45 ||
    (directTrades.length >= 4 && symbolWinRate < 0.35 && symbolPnlEdge < 0.45);
  const similarityScore = clamp(
    average([
      governanceBlend,
      readinessBlend,
      directTrades.length ? average([symbolWinRate, symbolPnlEdge]) : undefined,
      symbolCard?.sampleConfidence
    ].filter((value) => value != null), 0.5),
    0,
    1
  );
  return {
    botHistoryScore: num(clamp(similarityScore + reviewImpactBoost - (trapWarning ? 0.08 : 0) - symbolTrapScore * 0.06, 0, 1)),
    reviewRelevance: num(clamp((reviewHit ? 0.45 : 0.12) + reviewImpactBoost + badVetoRate * 0.2, 0, 1)),
    learningRelevance: num(clamp(
      average([
        1 - governanceBlend,
        clamp(badVetoRate * 1.4, 0, 1),
        clamp((reviewHit?.impactScore || 0), 0, 1),
        scopeMatches.length ? 1 - readinessBlend : 0.55
      ], 0.5),
      0,
      1
    )),
    historicalTrapWarning: trapWarning
      ? symbolCard?.trapStatus === "trap"
        ? "symbol_history_flags_repeat_trap_behavior"
        : "similar_setups_often_fake_out_or_overrate"
      : null,
    similarSetupVerdict: trapWarning
      ? "historically_trappy"
      : governanceBlend >= 0.62 && readinessBlend >= 0.58
        ? "historically_supported"
        : "history_thin_or_mixed",
    preferredLane: trapWarning
      ? "shadow"
      : governanceBlend >= 0.64 && readinessBlend >= 0.58
        ? "safe"
        : reviewHit
          ? "probe"
          : "probe",
    badVetoRate: num(badVetoRate),
    goodVetoRate: num(goodVetoRate),
    symbolTrapScore: num(symbolTrapScore),
    scopeHits: scopeMatches.length,
    reviewQueueHit: Boolean(reviewHit)
  };
}

function buildLaneAndAction({
  finalScore = 0,
  tradabilityScore = 0,
  executionScore = 0,
  botHistory = {},
  penalties = {},
  confidence = 0
}) {
  const trapPenalty = Number(penalties.fakeoutNoisePenalty || 0) + Number(penalties.overextensionPenalty || 0);
  let recommendedLane = botHistory.preferredLane || "probe";
  if (tradabilityScore >= 0.66 && executionScore >= 0.62 && finalScore >= 0.7 && !botHistory.historicalTrapWarning) {
    recommendedLane = "safe";
  } else if (botHistory.learningRelevance >= 0.58 || trapPenalty >= 0.5 || tradabilityScore < 0.42) {
    recommendedLane = "shadow";
  }

  let recommendedAction = "avoid";
  if (finalScore >= 0.74 && confidence >= 0.62 && recommendedLane !== "shadow") {
    recommendedAction = "strong_candidate";
  } else if (finalScore >= 0.62 && confidence >= 0.54) {
    recommendedAction = "candidate";
  } else if (finalScore >= 0.48 || botHistory.reviewRelevance >= 0.55) {
    recommendedAction = "watch";
  }

  return {
    recommendedLane,
    recommendedAction
  };
}

function buildReasons({
  candidate,
  botHistory = {},
  strategySummary = {},
  regimeSummary = {},
  penalties = {}
}) {
  const bullishReasons = [];
  const bearishReasons = [];
  if (candidate.tradabilityScore >= 0.68) {
    bullishReasons.push("top_universe_tradability");
  }
  if (candidate.executionScore >= 0.62) {
    bullishReasons.push("clean_execution_profile");
  }
  if (candidate.momentumScore >= 0.62) {
    bullishReasons.push("multi_horizon_momentum");
  }
  if (candidate.breakoutContinuationScore >= 0.62) {
    bullishReasons.push("breakout_or_continuation_quality");
  }
  if (candidate.regimeFitScore >= 0.58) {
    bullishReasons.push(`regime_fit_${regimeSummary.regime || "balanced"}`);
  }
  if (botHistory.botHistoryScore >= 0.62) {
    bullishReasons.push("bot_history_supportive");
  }
  if (candidate.bookSource === "deep_order_book") {
    bullishReasons.push("deep_book_confirmed");
  }
  if (strategySummary.activeStrategy) {
    bullishReasons.push(`strategy_${strategySummary.activeStrategy}`);
  }
  if ((candidate.structureContext?.bosStrengthScore || 0) >= 0.52) {
    bullishReasons.push("bos_breakout_supported");
  }
  if ((candidate.structureContext?.fvgRespectScore || 0) >= 0.48) {
    bullishReasons.push("fvg_pullback_support");
  }
  if ((candidate.cvdContext?.confirmationScore || 0) >= 0.5) {
    bullishReasons.push("cvd_confirms_move");
  }
  if ((candidate.liquidationContext?.liquidationMagnetStrength || 0) >= 0.42 && (candidate.liquidationContext?.liquidationMagnetDirection || "") !== "neutral") {
    bullishReasons.push("liquidation_magnet_supportive");
  }
  if ((candidate.gridContext?.entryReady || 0) >= 0.52) {
    bullishReasons.push("range_grid_entry_ready");
  }

  if (penalties.fakeoutNoisePenalty >= 0.36) {
    bearishReasons.push("fakeout_or_noise_risk");
  }
  if (penalties.overextensionPenalty >= 0.34) {
    bearishReasons.push("overextended_move");
  }
  if (candidate.executionScore < 0.46) {
    bearishReasons.push("execution_quality_borderline");
  }
  if (candidate.dataQualityScore < 0.5) {
    bearishReasons.push("degraded_data_context");
  }
  if (botHistory.historicalTrapWarning) {
    bearishReasons.push(botHistory.historicalTrapWarning);
  }
  if ((candidate.structureContext?.bosStrengthScore || 0) < 0.34) {
    bearishReasons.push("weak_bos");
  }
  if ((candidate.structureContext?.fvgFillProgress || 0) >= 0.92) {
    bearishReasons.push("fvg_failed_fill");
  }
  if ((candidate.cvdContext?.divergenceScore || 0) >= 0.42) {
    bearishReasons.push("cvd_divergence");
  }
  if ((candidate.liquidationContext?.liquidationTrapRisk || 0) >= 0.48) {
    bearishReasons.push("liquidation_trap_risk");
  }
  if ((candidate.gridContext?.breakRisk || 0) >= 0.42) {
    bearishReasons.push("range_break_risk");
  }
  bearishReasons.push(...arr(strategySummary.blockers || []).slice(0, 2));
  return {
    bullishReasons: uniq(bullishReasons).slice(0, 6),
    bearishReasons: uniq(bearishReasons).slice(0, 6)
  };
}

async function loadScannerCandles({
  symbol,
  interval,
  limit,
  historyStore,
  client,
  logger
}) {
  let candles = [];
  let source = "unavailable";
  try {
    if (historyStore?.getCandles) {
      candles = arr(await historyStore.getCandles({ symbol, interval, limit }));
      if (candles.length) {
        source = "history_store";
      }
    }
  } catch (error) {
    logger?.warn?.("Scanner history store lookup failed", { symbol, error: error.message });
  }

  if (candles.length < Math.max(24, Math.floor(limit * 0.5))) {
    try {
      const raw = await client.getKlines(symbol, interval, limit);
      const fetchedCandles = normalizeKlines(raw || []);
      if (fetchedCandles.length > candles.length) {
        candles = fetchedCandles;
        source = "binance_klines";
        if (historyStore?.upsertCandles) {
          await historyStore.upsertCandles({ symbol, interval, candles: fetchedCandles }).catch(() => {});
        }
      }
    } catch (error) {
      logger?.warn?.("Scanner kline fetch failed", { symbol, error: error.message });
    }
  }

  return {
    candles,
    source
  };
}

async function enrichScannerEntry({
  entry,
  interval,
  historyLimit,
  historyStore,
  client,
  logger,
  universeSelector,
  sessionLabel,
  offlineTrainer,
  paperLearning,
  journal,
  orderBook = null,
  bookSource = null
}) {
  const history = await loadScannerCandles({
    symbol: entry.symbol,
    interval,
    limit: historyLimit,
    historyStore,
    client,
    logger
  });
  const candles = history.candles || [];
  const marketFeatures = candles.length ? computeMarketFeatures(candles) : {};
  const snapshot = buildTickerSnapshot({
    symbol: entry.symbol,
    ticker: entry,
    candles,
    marketFeatures,
    orderBook,
    bookSource
  });
  const universeScore = universeSelector?.scoreSymbol
    ? universeSelector.scoreSymbol({
        symbol: entry.symbol,
        snapshot,
        hasOpenPosition: false,
        previousDecision: null,
        rotationState: null
      })
    : null;
  const newsSummary = {};
  const regimeSummary = classifyRegime({
    marketFeatures,
    newsSummary,
    streamFeatures: snapshot.stream || {},
    bookFeatures: snapshot.book || {}
  });
  const strategySummary = evaluateStrategySet({
    symbol: entry.symbol,
    marketSnapshot: snapshot,
    newsSummary,
    regimeSummary,
    streamFeatures: snapshot.stream || {}
  });
  const trendStateSummary = buildTrendStateSummary({
    marketFeatures,
    bookFeatures: snapshot.book || {},
    newsSummary,
    timeframeSummary: {}
  });
  const marketStateSummary = buildMarketStateSummary({
    trendStateSummary,
    marketFeatures,
    bookFeatures: snapshot.book || {},
    newsSummary
  });
  const dataQualitySummary = buildDataQualitySummary({
    bookFeatures: snapshot.book || {}
  });
  const signalQualitySummary = buildSignalQualitySummary({
    marketFeatures,
    bookFeatures: snapshot.book || {},
    strategySummary,
    trendStateSummary,
    newsSummary
  });
  const confidenceBreakdown = buildConfidenceBreakdown({
    score: { probability: clamp(Number(strategySummary.fitScore || 0), 0, 1) },
    trendStateSummary,
    signalQualitySummary,
    strategySummary,
    executionPlan: {}
  });
  const behavior = extractHistoricalBehavior(candles, marketFeatures);
  return {
    ...entry,
    historySource: history.source,
    candleCount: candles.length,
    marketFeatures,
    snapshot,
    universeScore,
    regimeSummary,
    strategySummary,
    trendStateSummary,
    marketStateSummary,
    dataQualitySummary,
    signalQualitySummary,
    confidenceBreakdown,
    behavior,
    botHistory: buildBotHistoryContext({
      symbol: entry.symbol,
      strategySummary,
      regimeSummary,
      sessionLabel,
      marketStateSummary,
      offlineTrainer,
      paperLearning,
      journal
    }),
    bookSource: snapshot.book?.source || bookSource || "ticker_proxy",
    deepBookEnriched: Boolean(orderBook)
  };
}

function buildScoreContext(items = [], { historyLimit = 160, oneHourBars = 4, fourHourBars = 16, twentyFourHourBars = 96 } = {}) {
  return {
    historyLimit,
    oneHourBars,
    fourHourBars,
    twentyFourHourBars,
    momentumValues: items.map((item) => average([
      pctChangeFromClose(item.snapshot?.candles || [], twentyFourHourBars),
      pctChangeFromClose(item.snapshot?.candles || [], fourHourBars) * 2.2,
      pctChangeFromClose(item.snapshot?.candles || [], oneHourBars) * 3
    ], 0)),
    breakoutValues: items.map((item) => average([
      item.marketFeatures.breakoutFollowThroughScore,
      item.marketFeatures.volumeAcceptanceScore,
      item.strategySummary.fitScore
    ], 0))
  };
}

function scoreScannerCandidate(item, context = {}) {
  const historyLimit = Number(context.historyLimit || 160);
  const oneHourBars = Number(context.oneHourBars || 4);
  const fourHourBars = Number(context.fourHourBars || 16);
  const twentyFourHourBars = Number(context.twentyFourHourBars || 96);
  const momentumValues = arr(context.momentumValues || []);
  const breakoutValues = arr(context.breakoutValues || []);
  const behavior = {
    ...item.behavior,
    ret1h: pctChangeFromClose(item.snapshot?.candles || [], oneHourBars),
    ret4h: pctChangeFromClose(item.snapshot?.candles || [], fourHourBars),
    ret24h: pctChangeFromClose(item.snapshot?.candles || [], twentyFourHourBars)
  };
  const relativeStrengthScore = normalizeScale(
    average([behavior.ret24h, behavior.ret4h * 2.2, behavior.ret1h * 3], 0),
    momentumValues
  );
  const momentumScore = clamp(
    average([
      clamp(behavior.ret24h * 2.5 + 0.5, 0, 1),
      clamp(behavior.ret4h * 6 + 0.5, 0, 1),
      clamp(behavior.ret1h * 10 + 0.5, 0, 1),
      clamp(behavior.acceleration * 16 + 0.5, 0, 1),
      clamp((behavior.volumeExpansion - 0.8) / 1.6, 0, 1)
    ], 0.5),
    0,
    1
  );
  const breakoutContinuationScore = clamp(
    average([
      normalizeScale(average([
        item.marketFeatures.breakoutFollowThroughScore,
        item.marketFeatures.volumeAcceptanceScore,
        item.strategySummary.fitScore,
        item.marketFeatures.bosStrengthScore,
        item.marketFeatures.cvdConfirmationScore
      ], 0), breakoutValues),
      behavior.continuationTendency,
      clamp(item.marketFeatures.closeLocationQuality || 0, 0, 1),
      clamp(item.marketFeatures.fvgRespectScore || 0, 0, 1),
      clamp(item.marketStructureSummary?.liquidationMagnetStrength || 0, 0, 1)
    ], 0.5),
    0,
    1
  );
  const volatilityQualityScore = clamp(
    average([
      clamp(1 - Math.abs((item.marketFeatures.realizedVolPct || 0.018) - 0.022) / 0.03, 0, 1),
      clamp(item.marketFeatures.trendQualityScore || 0, 0, 1),
      clamp(item.marketFeatures.squeezeReleaseScore || item.marketFeatures.keltnerSqueezeScore || 0.45, 0, 1)
    ], 0.45),
    0,
    1
  );
  const regimeFitScore = clamp(
    average([
      clamp(item.strategySummary.fitScore || 0, 0, 1),
      clamp(item.regimeSummary.confidence || 0, 0, 1),
      clamp(Math.max(item.trendStateSummary.uptrendScore || 0, item.trendStateSummary.downtrendScore || 0, item.trendStateSummary.rangeScore || 0), 0, 1),
      clamp(item.marketStateSummary.tradeableScore || item.marketStateSummary.acceptanceScore || 0.5, 0, 1)
    ], 0.5),
    0,
    1
  );
  const binanceHistoryScore = clamp(
    average([
      behavior.continuationTendency,
      behavior.downsideRecovery,
      1 - behavior.fakeoutRisk,
      1 - clamp(item.marketFeatures.cvdDivergenceScore || 0, 0, 1)
    ], 0.5),
    0,
    1
  );
  const penalties = {
    fakeoutNoisePenalty: num(clamp(behavior.fakeoutRisk, 0, 1)),
    overextensionPenalty: num(clamp(behavior.overextensionPenalty, 0, 1)),
    degradedDataPenalty: num(item.candleCount >= Math.floor(historyLimit * 0.6) ? 0 : clamp(1 - safeDivide(item.candleCount, historyLimit, 0), 0, 0.45))
  };
  const tradabilityScore = clamp(
    average([
      item.tradabilityScore,
      item.universeScore?.score != null ? clamp(item.universeScore.score, 0, 1) : undefined,
      item.snapshot?.book?.depthConfidence
    ].filter((value) => value != null), item.tradabilityScore),
    0,
    1
  );
  const executionScore = clamp(
    average([
      item.executionScore,
      item.universeScore?.executionGuardScore,
      item.universeScore?.spreadStabilityScore,
      clamp(item.snapshot?.book?.queueRefreshScore || 0, 0, 1),
      clamp(item.snapshot?.book?.resilienceScore || 0, 0, 1)
    ].filter((value) => value != null), item.executionScore),
    0,
    1
  );
  const liquidityScore = clamp(
    average([
      item.liquidityScore,
      item.universeScore?.liquidityScore,
      clamp((item.snapshot?.book?.totalDepthNotional || 0) / 120000, 0, 1)
    ].filter((value) => value != null), item.liquidityScore),
    0,
    1
  );
  const dataQualityScore = clamp(item.dataQualitySummary.overallScore || item.dataQualitySummary.confidence || 0.5, 0, 1);
  const confidence = clamp(
    average([
      item.confidenceBreakdown.overallConfidence,
      item.confidenceBreakdown.executionConfidence,
      dataQualityScore,
      item.signalQualitySummary.overallScore,
      clamp(item.marketFeatures.cvdConfidence || 0, 0, 1)
    ], 0.5),
    0,
    1
  );
  const structureContext = {
    bos: item.marketFeatures.bullishBosActive ? "bullish" : item.marketFeatures.bearishBosActive ? "bearish" : "none",
    bosStrengthScore: num(item.marketFeatures.bosStrengthScore || 0),
    fvg: item.marketFeatures.bullishFvgActive ? "bullish" : item.marketFeatures.bearishFvgActive ? "bearish" : "none",
    fvgRespectScore: num(item.marketFeatures.fvgRespectScore || 0),
    fvgFillProgress: num(item.marketFeatures.fvgFillProgress || 0)
  };
  const cvdContext = {
    confirmationScore: num(item.marketFeatures.cvdConfirmationScore || 0),
    divergenceScore: num(item.marketFeatures.cvdDivergenceScore || 0),
    trendAlignment: num(item.marketFeatures.cvdTrendAlignment || 0),
    confidence: num(item.marketFeatures.cvdConfidence || 0)
  };
  const liquidationContext = {
    liquidationMagnetDirection: item.marketStructureSummary?.liquidationMagnetDirection || "neutral",
    liquidationMagnetStrength: num(item.marketStructureSummary?.liquidationMagnetStrength || 0),
    liquidationTrapRisk: num(item.marketStructureSummary?.liquidationTrapRisk || 0),
    squeezeContinuationScore: num(item.marketStructureSummary?.squeezeContinuationScore || 0)
  };
  const gridContext = {
    gridEntrySide: item.marketFeatures.gridEntrySide || "none",
    entryReady: num(Math.max(item.marketFeatures.rangeMeanRevertScore || 0, item.marketFeatures.rangeBoundaryRespectScore || 0)),
    breakRisk: num(Math.max(
      Math.abs(item.marketFeatures.structureShiftScore || 0),
      item.marketStructureSummary?.liquidationTrapRisk || 0,
      (item.marketStateSummary?.phase || "") === "breakout_release" ? 0.7 : 0
    ))
  };
  const finalScore = clamp(
    tradabilityScore * 0.18 +
      liquidityScore * 0.08 +
      executionScore * 0.1 +
      momentumScore * 0.17 +
      relativeStrengthScore * 0.08 +
      breakoutContinuationScore * 0.14 +
      volatilityQualityScore * 0.08 +
      regimeFitScore * 0.11 +
      binanceHistoryScore * 0.08 +
      item.botHistory.botHistoryScore * 0.08 +
      confidence * 0.08 -
      penalties.fakeoutNoisePenalty * 0.08 -
      penalties.overextensionPenalty * 0.06 -
      penalties.degradedDataPenalty * 0.08,
    0,
    1
  );
  const { recommendedLane, recommendedAction } = buildLaneAndAction({
    finalScore,
    tradabilityScore,
    executionScore,
    botHistory: item.botHistory,
    penalties,
    confidence
  });
  const reasons = buildReasons({
    candidate: {
      tradabilityScore,
      executionScore,
      momentumScore,
      breakoutContinuationScore,
      regimeFitScore,
      dataQualityScore,
      bookSource: item.bookSource,
      structureContext,
      cvdContext,
      liquidationContext,
      gridContext
    },
    botHistory: item.botHistory,
    strategySummary: item.strategySummary,
    regimeSummary: item.regimeSummary,
    penalties
  });
  return {
    symbol: item.symbol,
    finalScore: num(finalScore),
    tradabilityScore: num(tradabilityScore),
    liquidityScore: num(liquidityScore),
    executionScore: num(executionScore),
    momentumScore: num(momentumScore),
    relativeStrengthScore: num(relativeStrengthScore),
    breakoutContinuationScore: num(breakoutContinuationScore),
    volatilityQualityScore: num(volatilityQualityScore),
    regimeFitScore: num(regimeFitScore),
    binanceHistoryScore: num(binanceHistoryScore),
    botHistoryScore: num(item.botHistory.botHistoryScore),
    confidence: num(confidence),
    dataQualityScore: num(dataQualityScore),
    signalQualityScore: num(item.signalQualitySummary.overallScore || 0),
    penalties,
    structureContext,
    cvdContext,
    liquidationContext,
    gridContext,
    bullishReasons: reasons.bullishReasons,
    bearishReasons: reasons.bearishReasons,
    recommendedLane,
    recommendedAction,
    learningRelevance: item.botHistory.learningRelevance,
    reviewRelevance: item.botHistory.reviewRelevance,
    historicalTrapWarning: item.botHistory.historicalTrapWarning,
    similarSetupVerdict: item.botHistory.similarSetupVerdict,
    topSetupFamily: item.strategySummary.familyId || item.strategySummary.activeFamily || null,
    topStrategy: item.strategySummary.activeStrategy || null,
    regime: item.regimeSummary.regime || null,
    regimeConfidence: num(item.regimeSummary.confidence || 0),
    ret1h: num(behavior.ret1h),
    ret4h: num(behavior.ret4h),
    ret24h: num(behavior.ret24h),
    volumeExpansion: num(behavior.volumeExpansion),
    spreadBps: num(item.snapshot?.book?.spreadBps ?? item.spreadBps, 2),
    quoteVolume: num(item.quoteVolume, 2),
    tradeCount24h: item.tradeCount || 0,
    historySource: item.historySource,
    candleCount: item.candleCount,
    bookSource: item.bookSource || "ticker_proxy",
    deepBookEnriched: Boolean(item.deepBookEnriched)
  };
}

export async function buildMarketScannerUniverse({
  client,
  config = {},
  logger = null,
  symbols = [],
  quoteAsset = "USDT",
  maxUniverseSize = 500
}) {
  const exchangeInfo = await client.getExchangeInfo();
  const tradableMap = buildTradableUniverse(exchangeInfo, quoteAsset);
  const tickersPayload = await client.publicRequest("GET", "/api/v3/ticker/24hr");
  const tickers = new Map(arr(tickersPayload).map((ticker) => [`${ticker.symbol || ""}`.toUpperCase(), ticker]));
  const requestedSymbols = uniq(symbols.map((symbol) => `${symbol}`.trim().toUpperCase()).filter(Boolean));
  const entries = [];
  let totalTradingSymbols = 0;
  let excludedCount = 0;

  for (const symbolInfo of arr(exchangeInfo?.symbols)) {
    if (symbolInfo.status !== "TRADING") {
      continue;
    }
    totalTradingSymbols += 1;
    if (symbolInfo.quoteAsset !== quoteAsset) {
      continue;
    }
    if (!tradableMap.has(symbolInfo.baseAsset)) {
      continue;
    }
    if (requestedSymbols.length && !requestedSymbols.includes(symbolInfo.symbol)) {
      continue;
    }
    const hygiene = getSymbolHygieneFlags(symbolInfo.baseAsset, symbolInfo.baseAsset, quoteAsset);
    if (hygiene.exclude) {
      excludedCount += 1;
      continue;
    }
    const ticker = tickers.get(symbolInfo.symbol);
    if (!ticker) {
      excludedCount += 1;
      continue;
    }
    entries.push(buildUniverseEntry({ symbolInfo, ticker, quoteAsset }));
  }

  const scoredEntries = buildTradabilityScores(entries, config)
    .filter((entry) => entry.blockers.length < 3)
    .sort((left, right) => right.tradabilityScore - left.tradabilityScore || right.quoteVolume - left.quoteVolume);
  const selected = requestedSymbols.length
    ? scoredEntries
    : scoredEntries.slice(0, Math.max(20, maxUniverseSize));
  const notes = [];
  if (!requestedSymbols.length) {
    notes.push(`Scanner beperkt de Binance ${quoteAsset} universe tot ${selected.length} tradable symbols op basis van quote volume, spread, depth en activiteit.`);
  }
  if (excludedCount > 0) {
    notes.push(`${excludedCount} stable, leveraged, synthetic of malformed pairs zijn uitgesloten.`);
  }

  logger?.info?.("Market scanner universe built", {
    quoteAsset,
    selectedCount: selected.length,
    totalTradingSymbols,
    requestedSymbolCount: requestedSymbols.length
  });

  return {
    generatedAt: new Date().toISOString(),
    quoteAsset,
    requestedSymbolCount: requestedSymbols.length,
    totalTradingSymbols,
    selectedCount: selected.length,
    excludedCount,
    entries: selected,
    notes
  };
}

export async function rankMarketScannerCandidates({
  client,
  config = {},
  logger = null,
  historyStore = null,
  universeSelector = null,
  universe = {},
  offlineTrainer = {},
  paperLearning = {},
  journal = {}
}) {
  const interval = config.scannerHistoryInterval || config.klineInterval || "15m";
  const historyLimit = Math.max(96, Number(config.scannerHistoryLookbackCandles || 160));
  const maxAnalysisSymbols = Math.max(25, Number(config.scannerHistoryAnalysisSymbols || 140));
  const topCandidateLimit = Math.max(10, Number(config.scannerTopCandidateLimit || 40));
  const deepBookLimit = Math.max(0, Number(config.scannerDeepBookSymbols || 30));
  const deepBookLevels = Math.max(10, Number(config.scannerDeepBookLevels || 20));
  const analysisEntries = arr(universe.entries || []).slice(0, maxAnalysisSymbols);
  const sessionLabel = (() => {
    const hour = new Date().getUTCHours();
    if (hour < 8) {
      return "asia";
    }
    if (hour < 16) {
      return "europe";
    }
    return "us";
  })();
  const oneHourBars = parseIntervalToBars(interval, 60);
  const fourHourBars = parseIntervalToBars(interval, 240);
  const twentyFourHourBars = parseIntervalToBars(interval, 1440);
  const enriched = await mapWithConcurrency(
    analysisEntries,
    Math.max(1, Number(config.marketSnapshotConcurrency || 6)),
    async (entry) => enrichScannerEntry({
      entry,
      interval,
      historyLimit,
      historyStore,
      client,
      logger,
      universeSelector,
      sessionLabel,
      offlineTrainer,
      paperLearning,
      journal
    })
  );
  const initialScoreContext = buildScoreContext(enriched, {
    historyLimit,
    oneHourBars,
    fourHourBars,
    twentyFourHourBars
  });

  let ranked = enriched
    .map((item) => scoreScannerCandidate(item, initialScoreContext))
    .sort((left, right) => right.finalScore - left.finalScore || right.tradabilityScore - left.tradabilityScore);

  const deepBookSymbols = ranked.slice(0, Math.min(deepBookLimit, ranked.length)).map((item) => item.symbol);
  if (deepBookSymbols.length && client?.getOrderBook) {
    const deepBookMap = new Map(
      await mapWithConcurrency(
        deepBookSymbols,
        Math.max(1, Math.min(6, Number(config.marketSnapshotConcurrency || 6))),
        async (symbol) => {
          try {
            return [symbol, await client.getOrderBook(symbol, deepBookLevels)];
          } catch (error) {
            logger?.warn?.("Scanner deep book fetch failed", { symbol, error: error.message });
            return [symbol, null];
          }
        }
      )
    );
    const deepEnriched = await mapWithConcurrency(
      enriched,
      Math.max(1, Number(config.marketSnapshotConcurrency || 6)),
      async (item) => {
        const orderBook = deepBookMap.get(item.symbol);
        if (!orderBook) {
          return item;
        }
        return enrichScannerEntry({
          entry: item,
          interval,
          historyLimit,
          historyStore,
          client,
          logger,
          universeSelector,
          sessionLabel,
          offlineTrainer,
          paperLearning,
          journal,
          orderBook,
          bookSource: "deep_order_book"
        });
      }
    );
    const rescoredContext = buildScoreContext(deepEnriched, {
      historyLimit,
      oneHourBars,
      fourHourBars,
      twentyFourHourBars
    });
    ranked = deepEnriched
      .map((item) => scoreScannerCandidate(item, rescoredContext))
      .sort((left, right) => right.finalScore - left.finalScore || right.tradabilityScore - left.tradabilityScore);
  }
  ranked = ranked.slice(0, topCandidateLimit);

  const laneCounts = ranked.reduce((acc, item) => {
    acc[item.recommendedLane] = (acc[item.recommendedLane] || 0) + 1;
    return acc;
  }, {});
  const actionCounts = ranked.reduce((acc, item) => {
    acc[item.recommendedAction] = (acc[item.recommendedAction] || 0) + 1;
    return acc;
  }, {});
  const notes = [];
  if (ranked[0]) {
    notes.push(`${ranked[0].symbol} leidt de scanner met een score van ${ranked[0].finalScore}.`);
  }
  const shadowLead = ranked.find((item) => item.recommendedLane === "shadow");
  if (shadowLead?.historicalTrapWarning) {
    notes.push(`${shadowLead.symbol} blijft interessant maar is naar shadow verschoven door ${shadowLead.historicalTrapWarning}.`);
  }
  if (deepBookSymbols.length) {
    notes.push(`${deepBookSymbols.length} top symbols kregen een tweede-pass deep book check voor betere execution scoring.`);
  }
  const laneCandidates = {
    safe: ranked.filter((item) => item.recommendedLane === "safe").slice(0, 4),
    probe: ranked.filter((item) => item.recommendedLane === "probe").slice(0, 4),
    shadow: ranked.filter((item) => item.recommendedLane === "shadow").slice(0, 4)
  };
  const softSeedSymbols = uniq([
    ...laneCandidates.safe.map((item) => item.symbol),
    ...ranked
      .filter((item) => item.recommendedLane !== "shadow" && ["strong_candidate", "candidate", "watch"].includes(item.recommendedAction))
      .slice(0, Math.max(4, Number(config.scannerSoftSeedCount || 10)))
      .map((item) => item.symbol)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    interval,
    analyzedCount: enriched.length,
    rankedCount: ranked.length,
    deepBookEnrichedCount: ranked.filter((item) => item.deepBookEnriched).length,
    laneCounts,
    actionCounts,
    laneCandidates,
    softSeedSymbols,
    topCandidates: ranked,
    notes
  };
}

export function summarizeMarketScannerRun(run = {}) {
  return {
    generatedAt: run.generatedAt || null,
    quoteAsset: run.quoteAsset || "USDT",
    universe: run.universe ? {
      totalTradingSymbols: run.universe.totalTradingSymbols || 0,
      selectedCount: run.universe.selectedCount || 0,
      excludedCount: run.universe.excludedCount || 0,
      analysisCount: run.universe.analysisCount || 0,
      notes: arr(run.universe.notes || []).slice(0, 4),
      topTradability: arr(run.universe.topTradability || []).slice(0, 8).map((item) => ({
        symbol: item.symbol,
        tradabilityScore: num(item.tradabilityScore || 0),
        quoteVolume: num(item.quoteVolume || 0, 2),
        spreadBps: num(item.spreadBps || 0, 2)
      }))
    } : null,
    laneCounts: { ...(run.laneCounts || {}) },
    actionCounts: { ...(run.actionCounts || {}) },
    rankedCount: run.rankedCount || arr(run.topCandidates || []).length,
    softSeedSymbols: arr(run.softSeedSymbols || []).slice(0, 12),
    topCandidates: arr(run.topCandidates || []).slice(0, 16).map((item) => ({
      symbol: item.symbol,
      finalScore: num(item.finalScore || 0),
      tradabilityScore: num(item.tradabilityScore || 0),
      momentumScore: num(item.momentumScore || 0),
      executionScore: num(item.executionScore || 0),
      regimeFitScore: num(item.regimeFitScore || 0),
      botHistoryScore: num(item.botHistoryScore || 0),
      recommendedLane: item.recommendedLane || "probe",
      recommendedAction: item.recommendedAction || "watch",
      bullishReasons: arr(item.bullishReasons || []).slice(0, 4),
      bearishReasons: arr(item.bearishReasons || []).slice(0, 4),
      topStrategy: item.topStrategy || null,
      topSetupFamily: item.topSetupFamily || null,
      confidence: num(item.confidence || 0),
      bookSource: item.bookSource || "ticker_proxy"
    })),
    topSafeCandidates: arr(run.laneCandidates?.safe || run.topSafeCandidates || []).slice(0, 6).map((item) => ({
      symbol: item.symbol,
      finalScore: num(item.finalScore || 0),
      executionScore: num(item.executionScore || 0),
      recommendedAction: item.recommendedAction || "watch",
      bullishReasons: arr(item.bullishReasons || []).slice(0, 3)
    })),
    topProbeCandidates: arr(run.laneCandidates?.probe || run.topProbeCandidates || []).slice(0, 6).map((item) => ({
      symbol: item.symbol,
      finalScore: num(item.finalScore || 0),
      reviewRelevance: num(item.reviewRelevance || 0),
      recommendedAction: item.recommendedAction || "watch",
      bullishReasons: arr(item.bullishReasons || []).slice(0, 3)
    })),
    topShadowCandidates: arr(run.laneCandidates?.shadow || run.topShadowCandidates || []).slice(0, 6).map((item) => ({
      symbol: item.symbol,
      finalScore: num(item.finalScore || 0),
      historicalTrapWarning: item.historicalTrapWarning || null,
      bearishReasons: arr(item.bearishReasons || []).slice(0, 3)
    })),
    deepBookEnrichedCount: run.deepBookEnrichedCount || 0,
    notes: arr(run.notes || []).slice(0, 4)
  };
}

export async function runMarketScanner({
  client,
  config = {},
  logger = null,
  historyStore = null,
  universeSelector = null,
  offlineTrainer = {},
  paperLearning = {},
  journal = {},
  symbols = []
}) {
  const quoteAsset = "USDT";
  const universe = await buildMarketScannerUniverse({
    client,
    config,
    logger,
    symbols,
    quoteAsset,
    maxUniverseSize: Math.max(20, Number(config.scannerMaxUniverseSize || 500))
  });
  const ranked = await rankMarketScannerCandidates({
    client,
    config,
    logger,
    historyStore,
    universeSelector,
    universe,
    offlineTrainer,
    paperLearning,
    journal
  });
  return {
    generatedAt: ranked.generatedAt || universe.generatedAt,
    quoteAsset,
    universe: {
      totalTradingSymbols: universe.totalTradingSymbols,
      selectedCount: universe.selectedCount,
      excludedCount: universe.excludedCount,
      analysisCount: ranked.analyzedCount || 0,
      topTradability: arr(universe.entries || []).slice(0, 12),
      notes: [...(universe.notes || [])]
    },
    laneCounts: ranked.laneCounts || {},
    actionCounts: ranked.actionCounts || {},
    laneCandidates: ranked.laneCandidates || {},
    softSeedSymbols: ranked.softSeedSymbols || [],
    deepBookEnrichedCount: ranked.deepBookEnrichedCount || 0,
    topCandidates: ranked.topCandidates || [],
    notes: [...(ranked.notes || [])]
  };
}

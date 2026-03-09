import { clamp } from "../utils/math.js";

export const STRATEGY_META = {
  breakout: { label: "Breakout composite", family: "breakout", familyLabel: "Breakout", setupStyle: "breakout_continuation" },
  mean_reversion: { label: "Mean reversion composite", family: "mean_reversion", familyLabel: "Mean reversion", setupStyle: "mean_reversion" },
  trend_following: { label: "Trend following composite", family: "trend_following", familyLabel: "Trend following", setupStyle: "trend_following" },
  ema_trend: { label: "EMA trend", family: "trend_following", familyLabel: "Trend following", setupStyle: "ema_trend" },
  donchian_breakout: { label: "Donchian breakout", family: "breakout", familyLabel: "Breakout", setupStyle: "donchian_breakout" },
  vwap_trend: { label: "VWAP trend", family: "trend_following", familyLabel: "Trend following", setupStyle: "vwap_trend" },
  bollinger_squeeze: { label: "Bollinger squeeze", family: "breakout", familyLabel: "Breakout", setupStyle: "bollinger_squeeze" },
  atr_breakout: { label: "ATR breakout", family: "breakout", familyLabel: "Breakout", setupStyle: "atr_breakout" },
  vwap_reversion: { label: "VWAP reversion", family: "mean_reversion", familyLabel: "Mean reversion", setupStyle: "vwap_reversion" },
  zscore_reversion: { label: "Z-score reversion", family: "mean_reversion", familyLabel: "Mean reversion", setupStyle: "zscore_reversion" },
  liquidity_sweep: { label: "Liquidity sweep", family: "market_structure", familyLabel: "Market structure", setupStyle: "liquidity_sweep" },
  market_structure_break: { label: "Market structure break", family: "market_structure", familyLabel: "Market structure", setupStyle: "market_structure_break" },
  funding_rate_extreme: { label: "Funding rate extreme", family: "derivatives", familyLabel: "Derivatives", setupStyle: "funding_reversion" },
  open_interest_breakout: { label: "Open interest breakout", family: "derivatives", familyLabel: "Derivatives", setupStyle: "open_interest_breakout" },
  orderbook_imbalance: { label: "Orderbook imbalance", family: "orderflow", familyLabel: "Orderflow", setupStyle: "orderbook_imbalance" }
};

function safeValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function ratio(value, min, max) {
  if (max <= min) {
    return 0;
  }
  return clamp((safeValue(value) - min) / (max - min), 0, 1);
}

function signedRatio(value, scale) {
  return clamp((safeValue(value) + scale) / (scale * 2), 0, 1);
}

function average(values = [], fallback = 0) {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((total, value) => total + value, 0) / filtered.length : fallback;
}

function buildStrategy(id, rawScore, rawConfidence, reasons = [], blockers = [], metrics = {}) {
  const meta = STRATEGY_META[id] || {
    label: id,
    family: "hybrid",
    familyLabel: "Hybrid",
    setupStyle: "hybrid_multi_signal"
  };
  const score = clamp(rawScore, 0, 1);
  const confidence = clamp(rawConfidence, 0, 1);
  const fitScore = clamp(score * 0.68 + confidence * 0.32, 0, 1);
  return {
    id,
    label: meta.label,
    family: meta.family,
    familyLabel: meta.familyLabel,
    setupStyle: meta.setupStyle,
    score,
    confidence,
    fitScore,
    rawFitScore: fitScore,
    reasons: reasons.filter(Boolean).slice(0, 6),
    blockers: blockers.filter(Boolean).slice(0, 4),
    metrics
  };
}

function buildInputs(context) {
  const market = context.marketSnapshot?.market || {};
  const book = context.marketSnapshot?.book || {};
  const stream = context.streamFeatures || context.marketSnapshot?.stream || {};
  const regime = context.regimeSummary?.regime || "range";
  const structure = context.marketStructureSummary || {};
  const news = context.newsSummary || {};
  const announcement = context.announcementSummary || {};
  const calendar = context.calendarSummary || {};
  const macro = context.marketSentimentSummary || {};
  const volatility = context.volatilitySummary || {};
  const eventRisk = Math.max(
    safeValue(news.riskScore),
    safeValue(announcement.riskScore),
    safeValue(calendar.riskScore),
    safeValue(macro.riskScore) * 0.9,
    safeValue(volatility.riskScore) * 0.85
  );
  const newsTailwind = signedRatio(
    safeValue(news.sentimentScore) +
      safeValue(news.socialSentiment) * 0.25 +
      safeValue(structure.signalScore) * 0.35 +
      safeValue(macro.contrarianScore) * 0.22 -
      eventRisk * 0.55,
    1
  );
  const orderflow = signedRatio(
    safeValue(book.bookPressure) * 0.72 + safeValue(book.weightedDepthImbalance) * 0.18 + safeValue(stream.tradeFlowImbalance) * 0.22,
    1
  );
  const bullishPattern = clamp(safeValue(market.bullishPatternScore), 0, 1);
  const bearishPattern = clamp(safeValue(market.bearishPatternScore), 0, 1);
  return { market, book, stream, regime, structure, news, announcement, calendar, macro, volatility, eventRisk, newsTailwind, orderflow, bullishPattern, bearishPattern };
}
function applyOptimizer(strategies, optimizerSummary = {}) {
  if (!optimizerSummary || (!optimizerSummary.strategyPriors && !optimizerSummary.familyPriors)) {
    return strategies;
  }
  return strategies.map((strategy) => {
    const strategyPrior = optimizerSummary.strategyPriors?.[strategy.id] || null;
    const familyPrior = optimizerSummary.familyPriors?.[strategy.family] || null;
    const multiplier = clamp((strategyPrior?.multiplier || 1) * (familyPrior?.multiplier || 1), 0.82, 1.18);
    const boost = multiplier - 1;
    const fitScore = clamp(strategy.fitScore * multiplier, 0, 1);
    const reasons = [...strategy.reasons];
    if ((strategyPrior?.tradeCount || 0) > 0) {
      reasons.push(`hist ${strategyPrior.tradeCount} trades @ ${(safeValue(strategyPrior.winRate) * 100).toFixed(0)}% win`);
    } else if ((familyPrior?.tradeCount || 0) > 0) {
      reasons.push(`family ${strategy.familyLabel} ${familyPrior.tradeCount} trades @ ${(safeValue(familyPrior.winRate) * 100).toFixed(0)}% win`);
    }
    return {
      ...strategy,
      fitScore,
      optimizerBoost: boost,
      historicalTradeCount: strategyPrior?.tradeCount || familyPrior?.tradeCount || 0,
      historicalWinRate: strategyPrior?.winRate ?? familyPrior?.winRate ?? null,
      optimizerConfidence: Math.max(strategyPrior?.confidence || 0, familyPrior?.confidence || 0),
      reasons: reasons.slice(0, 6)
    };
  });
}

function buildFamilyRankings(strategies) {
  const byFamily = new Map();
  for (const strategy of strategies) {
    const current = byFamily.get(strategy.family);
    if (!current || strategy.fitScore > current.fitScore) {
      byFamily.set(strategy.family, {
        family: strategy.family,
        familyLabel: strategy.familyLabel,
        strategyId: strategy.id,
        strategyLabel: strategy.label,
        fitScore: strategy.fitScore,
        confidence: strategy.confidence
      });
    }
  }
  return [...byFamily.values()].sort((left, right) => right.fitScore - left.fitScore);
}

function evaluateBreakout(context) {
  const { market, regime, eventRisk, newsTailwind, orderflow, bullishPattern, bearishPattern } = buildInputs(context);
  const regimeFit = regime === "breakout" ? 1 : regime === "high_vol" ? 0.78 : regime === "trend" ? 0.66 : 0.34;
  const breakoutImpulse = ratio(Math.max(safeValue(market.breakoutPct), safeValue(market.donchianBreakoutPct)) * 100, -0.04, 1.65);
  const compression = clamp(1 - safeValue(market.rangeCompression), 0, 1);
  const squeeze = clamp(safeValue(market.bollingerSqueezeScore), 0, 1);
  const participation = ratio(safeValue(market.volumeZ), -0.35, 2.5);
  const followThrough = ratio(safeValue(market.closeLocation), 0.48, 1);
  const structureBreak = ratio(safeValue(market.structureBreakScore), 0.05, 1);
  const score = clamp(regimeFit * 0.18 + breakoutImpulse * 0.16 + compression * 0.08 + squeeze * 0.08 + participation * 0.12 + orderflow * 0.11 + followThrough * 0.08 + structureBreak * 0.08 + bullishPattern * 0.05 + newsTailwind * 0.04 - eventRisk * 0.12 - bearishPattern * 0.08, 0, 1);
  const confidence = clamp(0.28 + average([regimeFit, breakoutImpulse, participation, orderflow, followThrough], 0) * 0.62 - eventRisk * 0.1, 0, 1);
  return buildStrategy("breakout", score, confidence, [
    `regime ${regime}`,
    `breakout ${(safeValue(market.breakoutPct) * 100).toFixed(2)}%`,
    `donchian ${(safeValue(market.donchianBreakoutPct) * 100).toFixed(2)}%`,
    `volume z ${safeValue(market.volumeZ).toFixed(2)}`,
    squeeze > 0.5 ? "squeeze ready" : "limited squeeze"
  ], [
    eventRisk > 0.74 ? "event_risk_headwind" : null,
    safeValue(context.marketSnapshot?.book?.bookPressure) < -0.22 ? "sell_pressure" : null,
    bearishPattern > 0.68 ? "bearish_pattern_conflict" : null
  ], { regimeFit, breakoutImpulse, compression, squeeze, participation });
}

function evaluateMeanReversion(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern } = buildInputs(context);
  const regimeFit = regime === "range" ? 1 : regime === "trend" ? 0.42 : regime === "breakout" ? 0.24 : 0.18;
  const oversold = ratio(50 - safeValue(market.rsi14), 2, 18);
  const discountToVwap = ratio(-safeValue(market.vwapGapPct) * 100, 0.06, 1.8);
  const zscore = ratio(-safeValue(market.priceZScore), 0.18, 2.4);
  const calmVol = clamp(1 - ratio(safeValue(market.realizedVolPct), 0.012, 0.05), 0, 1);
  const reboundPressure = ratio(safeValue(context.marketSnapshot?.book?.bookPressure), -0.08, 0.7);
  const trendDamage = clamp(ratio(-safeValue(market.momentum20) * 100, 0.12, 1.6) * 0.5 + ratio(-safeValue(market.emaGap) * 100, 0.04, 0.9) * 0.35 + bearishPattern * 0.15, 0, 1);
  const score = clamp(regimeFit * 0.24 + oversold * 0.16 + discountToVwap * 0.15 + zscore * 0.12 + reboundPressure * 0.11 + calmVol * 0.08 + bullishPattern * 0.07 + orderflow * 0.05 - trendDamage * 0.15 - eventRisk * 0.09, 0, 1);
  const confidence = clamp(0.26 + average([regimeFit, oversold, discountToVwap, zscore, reboundPressure], 0) * 0.58 - trendDamage * 0.12, 0, 1);
  return buildStrategy("mean_reversion", score, confidence, [
    `regime ${regime}`,
    `rsi ${safeValue(market.rsi14).toFixed(1)}`,
    `vwap ${(safeValue(market.vwapGapPct) * 100).toFixed(2)}%`,
    `z ${safeValue(market.priceZScore).toFixed(2)}`,
    calmVol > 0.5 ? "calm tape" : "vol elevated"
  ], [
    eventRisk > 0.72 ? "event_risk_headwind" : null,
    trendDamage > 0.58 ? "trend_breakdown_risk" : null,
    safeValue(context.marketSnapshot?.book?.bookPressure) < -0.28 ? "rebound_not_confirmed" : null
  ], { regimeFit, oversold, discountToVwap, zscore, reboundPressure });
}

function evaluateTrendFollowing(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern, structure } = buildInputs(context);
  const regimeFit = regime === "trend" ? 1 : regime === "breakout" ? 0.8 : regime === "high_vol" ? 0.46 : 0.32;
  const trendStrength = ratio(safeValue(market.trendStrength) * 100, -0.15, 1.5);
  const momentum = ratio(safeValue(market.momentum20) * 100, -0.1, 1.8);
  const emaStack = ratio(safeValue(market.emaGap) * 100, -0.05, 0.95);
  const persistence = ratio(safeValue(market.trendPersistence), 0.45, 0.98);
  const obvSlope = ratio(safeValue(market.obvSlope), -0.05, 0.42);
  const crowdingRisk = clamp(ratio(Math.abs(safeValue(structure.crowdingBias)), 0.28, 0.88) * 0.55 + ratio(Math.abs(safeValue(structure.fundingRate)) * 10000, 1.2, 6.2) * 0.45, 0, 1);
  const score = clamp(regimeFit * 0.22 + trendStrength * 0.15 + momentum * 0.14 + emaStack * 0.13 + persistence * 0.1 + obvSlope * 0.08 + orderflow * 0.07 + bullishPattern * 0.04 - crowdingRisk * 0.13 - bearishPattern * 0.08 - eventRisk * 0.06, 0, 1);
  const confidence = clamp(0.3 + average([regimeFit, trendStrength, momentum, emaStack, persistence], 0) * 0.6 - crowdingRisk * 0.1, 0, 1);
  return buildStrategy("trend_following", score, confidence, [
    `regime ${regime}`,
    `mom20 ${(safeValue(market.momentum20) * 100).toFixed(2)}%`,
    `ema ${(safeValue(market.emaGap) * 100).toFixed(2)}%`,
    `persist ${safeValue(market.trendPersistence).toFixed(2)}`,
    `obv ${safeValue(market.obvSlope).toFixed(2)}`
  ], [
    eventRisk > 0.74 ? "event_risk_headwind" : null,
    crowdingRisk > 0.64 ? "crowded_trend" : null,
    bearishPattern > 0.64 ? "pattern_reversal_risk" : null
  ], { regimeFit, trendStrength, momentum, emaStack, persistence });
}
function evaluateEmaTrend(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern, structure } = buildInputs(context);
  const regimeFit = regime === "trend" ? 1 : regime === "breakout" ? 0.72 : regime === "high_vol" ? 0.42 : 0.26;
  const emaTrend = ratio(safeValue(market.emaTrendScore) * 100, 0.02, 0.85);
  const emaSlope = ratio(safeValue(market.emaTrendSlopePct) * 100, -0.04, 0.55);
  const persistence = ratio(safeValue(market.trendPersistence), 0.46, 0.98);
  const vwapSupport = ratio(safeValue(market.vwapGapPct) * 100, -0.25, 1.25);
  const obvSlope = ratio(safeValue(market.obvSlope), -0.04, 0.42);
  const crowdingRisk = clamp(ratio(Math.abs(safeValue(structure.crowdingBias)), 0.32, 0.92) * 0.6 + ratio(Math.max(0, safeValue(structure.fundingRate)) * 10000, 1.4, 6.4) * 0.4, 0, 1);
  const score = clamp(regimeFit * 0.22 + emaTrend * 0.17 + emaSlope * 0.15 + persistence * 0.12 + vwapSupport * 0.1 + obvSlope * 0.08 + orderflow * 0.08 + bullishPattern * 0.04 - crowdingRisk * 0.12 - bearishPattern * 0.08 - eventRisk * 0.06, 0, 1);
  const confidence = clamp(0.3 + average([regimeFit, emaTrend, emaSlope, persistence, orderflow], 0) * 0.58 - crowdingRisk * 0.08, 0, 1);
  return buildStrategy("ema_trend", score, confidence, [
    `ema trend ${safeValue(market.emaTrendScore).toFixed(3)}`,
    `ema slope ${(safeValue(market.emaTrendSlopePct) * 100).toFixed(2)}%`,
    `vwap ${(safeValue(market.vwapGapPct) * 100).toFixed(2)}%`,
    `persist ${safeValue(market.trendPersistence).toFixed(2)}`
  ], [
    crowdingRisk > 0.66 ? "crowded_trend" : null,
    bearishPattern > 0.66 ? "pattern_reversal_risk" : null,
    eventRisk > 0.76 ? "event_risk_headwind" : null
  ], { regimeFit, emaTrend, emaSlope, persistence, vwapSupport });
}

function evaluateDonchianBreakout(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern } = buildInputs(context);
  const regimeFit = regime === "breakout" ? 1 : regime === "trend" ? 0.78 : regime === "high_vol" ? 0.5 : 0.28;
  const channelBreak = ratio(safeValue(market.donchianBreakoutPct) * 100, -0.03, 1.7);
  const channelPosition = ratio(safeValue(market.donchianPosition), 0.58, 1);
  const width = clamp(1 - ratio(safeValue(market.donchianWidthPct) * 100, 1.8, 8.5), 0, 1);
  const structureBreak = ratio(safeValue(market.structureBreakScore), 0.05, 1);
  const participation = ratio(safeValue(market.volumeZ), -0.2, 2.7);
  const score = clamp(regimeFit * 0.2 + channelBreak * 0.18 + channelPosition * 0.12 + width * 0.08 + structureBreak * 0.12 + participation * 0.11 + orderflow * 0.1 + bullishPattern * 0.04 - bearishPattern * 0.08 - eventRisk * 0.09, 0, 1);
  const confidence = clamp(0.3 + average([regimeFit, channelBreak, channelPosition, structureBreak, participation], 0) * 0.58, 0, 1);
  return buildStrategy("donchian_breakout", score, confidence, [
    `donchian ${(safeValue(market.donchianBreakoutPct) * 100).toFixed(2)}%`,
    `position ${(safeValue(market.donchianPosition) * 100).toFixed(0)}%`,
    `width ${(safeValue(market.donchianWidthPct) * 100).toFixed(2)}%`,
    `volume z ${safeValue(market.volumeZ).toFixed(2)}`
  ], [
    eventRisk > 0.75 ? "event_risk_headwind" : null,
    bearishPattern > 0.64 ? "pattern_reversal_risk" : null,
    safeValue(context.marketSnapshot?.book?.bookPressure) < -0.18 ? "sell_pressure" : null
  ], { regimeFit, channelBreak, channelPosition, width, structureBreak });
}

function evaluateVwapTrend(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern } = buildInputs(context);
  const regimeFit = regime === "trend" ? 1 : regime === "breakout" ? 0.65 : regime === "range" ? 0.36 : 0.28;
  const vwapSupport = ratio(safeValue(market.vwapGapPct) * 100, -0.15, 1.4);
  const vwapSlope = ratio(safeValue(market.vwapSlopePct) * 100, -0.05, 0.75);
  const momentum = ratio(safeValue(market.momentum20) * 100, -0.08, 1.55);
  const obvSlope = ratio(safeValue(market.obvSlope), -0.04, 0.4);
  const closeLocation = ratio(safeValue(market.closeLocation), 0.52, 1);
  const score = clamp(regimeFit * 0.22 + vwapSupport * 0.16 + vwapSlope * 0.15 + momentum * 0.13 + obvSlope * 0.1 + closeLocation * 0.08 + orderflow * 0.08 + bullishPattern * 0.04 - bearishPattern * 0.08 - eventRisk * 0.06, 0, 1);
  const confidence = clamp(0.28 + average([regimeFit, vwapSupport, vwapSlope, momentum, obvSlope], 0) * 0.6, 0, 1);
  return buildStrategy("vwap_trend", score, confidence, [
    `vwap ${(safeValue(market.vwapGapPct) * 100).toFixed(2)}%`,
    `vwap slope ${(safeValue(market.vwapSlopePct) * 100).toFixed(2)}%`,
    `mom20 ${(safeValue(market.momentum20) * 100).toFixed(2)}%`,
    `obv ${safeValue(market.obvSlope).toFixed(2)}`
  ], [
    bearishPattern > 0.64 ? "pattern_reversal_risk" : null,
    eventRisk > 0.74 ? "event_risk_headwind" : null,
    safeValue(context.marketSnapshot?.book?.spreadBps) > 18 ? "spread_expansion" : null
  ], { regimeFit, vwapSupport, vwapSlope, momentum, obvSlope });
}

function evaluateBollingerSqueeze(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern } = buildInputs(context);
  const regimeFit = regime === "breakout" ? 1 : regime === "high_vol" ? 0.72 : regime === "trend" ? 0.58 : 0.28;
  const squeeze = clamp(safeValue(market.bollingerSqueezeScore), 0, 1);
  const release = ratio(Math.max(safeValue(market.breakoutPct), safeValue(market.donchianBreakoutPct)) * 100, -0.03, 1.5);
  const bandPosition = ratio(safeValue(market.bollingerPosition), 0.6, 1);
  const volume = ratio(safeValue(market.volumeZ), -0.2, 2.4);
  const atrExpansion = ratio(safeValue(market.atrExpansion), -0.08, 0.75);
  const score = clamp(regimeFit * 0.19 + squeeze * 0.18 + release * 0.14 + bandPosition * 0.11 + volume * 0.1 + atrExpansion * 0.09 + orderflow * 0.09 + bullishPattern * 0.04 - bearishPattern * 0.08 - eventRisk * 0.08, 0, 1);
  const confidence = clamp(0.28 + average([regimeFit, squeeze, release, bandPosition, volume], 0) * 0.58, 0, 1);
  return buildStrategy("bollinger_squeeze", score, confidence, [
    `squeeze ${(safeValue(market.bollingerSqueezeScore) * 100).toFixed(0)}%`,
    `band ${(safeValue(market.bollingerPosition) * 100).toFixed(0)}%`,
    `atr exp ${safeValue(market.atrExpansion).toFixed(2)}`,
    `volume z ${safeValue(market.volumeZ).toFixed(2)}`
  ], [
    eventRisk > 0.75 ? "event_risk_headwind" : null,
    bearishPattern > 0.62 ? "pattern_reversal_risk" : null,
    safeValue(context.marketSnapshot?.book?.bookPressure) < -0.16 ? "sell_pressure" : null
  ], { regimeFit, squeeze, release, bandPosition, atrExpansion });
}

function evaluateAtrBreakout(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern, stream } = buildInputs(context);
  const regimeFit = regime === "breakout" ? 1 : regime === "high_vol" ? 0.82 : regime === "trend" ? 0.62 : 0.25;
  const atrExpansion = ratio(safeValue(market.atrExpansion), -0.05, 0.9);
  const breakoutImpulse = ratio(Math.max(safeValue(market.breakoutPct), safeValue(market.donchianBreakoutPct)) * 100, -0.04, 1.7);
  const volume = ratio(safeValue(market.volumeZ), -0.15, 2.6);
  const tradeFlow = ratio(safeValue(stream.tradeFlowImbalance), -0.05, 0.85);
  const closeLocation = ratio(safeValue(market.closeLocation), 0.52, 1);
  const score = clamp(regimeFit * 0.18 + atrExpansion * 0.16 + breakoutImpulse * 0.16 + volume * 0.12 + tradeFlow * 0.1 + closeLocation * 0.08 + orderflow * 0.08 + bullishPattern * 0.04 - bearishPattern * 0.08 - eventRisk * 0.08, 0, 1);
  const confidence = clamp(0.28 + average([regimeFit, atrExpansion, breakoutImpulse, volume, tradeFlow], 0) * 0.58, 0, 1);
  return buildStrategy("atr_breakout", score, confidence, [
    `atr exp ${safeValue(market.atrExpansion).toFixed(2)}`,
    `breakout ${(Math.max(safeValue(market.breakoutPct), safeValue(market.donchianBreakoutPct)) * 100).toFixed(2)}%`,
    `flow ${safeValue(stream.tradeFlowImbalance).toFixed(2)}`,
    `volume z ${safeValue(market.volumeZ).toFixed(2)}`
  ], [
    eventRisk > 0.76 ? "event_risk_headwind" : null,
    bearishPattern > 0.64 ? "pattern_reversal_risk" : null,
    safeValue(context.marketSnapshot?.book?.spreadBps) > 18 ? "spread_expansion" : null
  ], { regimeFit, atrExpansion, breakoutImpulse, volume, tradeFlow });
}

function evaluateVwapReversion(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern } = buildInputs(context);
  const regimeFit = regime === "range" ? 1 : regime === "trend" ? 0.44 : regime === "breakout" ? 0.22 : 0.18;
  const discountToVwap = ratio(-safeValue(market.vwapGapPct) * 100, 0.08, 1.9);
  const oversold = ratio(50 - safeValue(market.rsi14), 2, 18);
  const zscore = ratio(-safeValue(market.priceZScore), 0.2, 2.2);
  const calmVol = clamp(1 - ratio(safeValue(market.realizedVolPct), 0.012, 0.055), 0, 1);
  const bandLocation = ratio(0.5 - safeValue(market.bollingerPosition), 0.05, 0.5);
  const support = ratio(safeValue(context.marketSnapshot?.book?.bookPressure), -0.1, 0.7);
  const score = clamp(regimeFit * 0.22 + discountToVwap * 0.17 + oversold * 0.13 + zscore * 0.13 + bandLocation * 0.08 + calmVol * 0.08 + support * 0.1 + bullishPattern * 0.06 + orderflow * 0.03 - bearishPattern * 0.09 - eventRisk * 0.09, 0, 1);
  const confidence = clamp(0.28 + average([regimeFit, discountToVwap, oversold, zscore, support], 0) * 0.56, 0, 1);
  return buildStrategy("vwap_reversion", score, confidence, [
    `vwap ${(safeValue(market.vwapGapPct) * 100).toFixed(2)}%`,
    `rsi ${safeValue(market.rsi14).toFixed(1)}`,
    `z ${safeValue(market.priceZScore).toFixed(2)}`,
    calmVol > 0.5 ? "calm tape" : "vol elevated"
  ], [
    eventRisk > 0.72 ? "event_risk_headwind" : null,
    bearishPattern > 0.68 ? "pattern_breakdown" : null,
    safeValue(context.marketSnapshot?.book?.bookPressure) < -0.26 ? "support_not_confirmed" : null
  ], { regimeFit, discountToVwap, oversold, zscore, bandLocation });
}

function evaluateZScoreReversion(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern } = buildInputs(context);
  const regimeFit = regime === "range" ? 1 : regime === "high_vol" ? 0.52 : regime === "trend" ? 0.36 : 0.2;
  const zscore = ratio(-safeValue(market.priceZScore), 0.3, 2.6);
  const bandLocation = ratio(0.5 - safeValue(market.bollingerPosition), 0.04, 0.52);
  const discountToVwap = ratio(-safeValue(market.vwapGapPct) * 100, 0.05, 1.7);
  const oversold = ratio(50 - safeValue(market.rsi14), 2, 18);
  const reboundPressure = ratio(safeValue(context.marketSnapshot?.book?.bookPressure), -0.08, 0.72);
  const score = clamp(regimeFit * 0.22 + zscore * 0.19 + bandLocation * 0.12 + discountToVwap * 0.12 + oversold * 0.11 + reboundPressure * 0.11 + bullishPattern * 0.06 + orderflow * 0.03 - bearishPattern * 0.09 - eventRisk * 0.08, 0, 1);
  const confidence = clamp(0.28 + average([regimeFit, zscore, bandLocation, oversold, reboundPressure], 0) * 0.56, 0, 1);
  return buildStrategy("zscore_reversion", score, confidence, [
    `z ${safeValue(market.priceZScore).toFixed(2)}`,
    `band ${(safeValue(market.bollingerPosition) * 100).toFixed(0)}%`,
    `vwap ${(safeValue(market.vwapGapPct) * 100).toFixed(2)}%`,
    `rsi ${safeValue(market.rsi14).toFixed(1)}`
  ], [
    eventRisk > 0.72 ? "event_risk_headwind" : null,
    bearishPattern > 0.68 ? "pattern_breakdown" : null,
    safeValue(context.marketSnapshot?.book?.bookPressure) < -0.26 ? "support_not_confirmed" : null
  ], { regimeFit, zscore, bandLocation, discountToVwap, reboundPressure });
}
function evaluateLiquiditySweep(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern } = buildInputs(context);
  const regimeFit = regime === "range" ? 0.86 : regime === "breakout" ? 0.72 : regime === "high_vol" ? 0.62 : 0.44;
  const sweep = ratio(safeValue(market.liquiditySweepScore), 0.05, 1);
  const reclaim = ratio(safeValue(market.closeLocation), 0.55, 1);
  const lowerWickSignal = ratio(-safeValue(market.wickSkew), 0.04, 0.9);
  const volume = ratio(safeValue(market.volumeZ), -0.2, 2.4);
  const score = clamp(regimeFit * 0.2 + sweep * 0.2 + reclaim * 0.14 + lowerWickSignal * 0.12 + volume * 0.08 + orderflow * 0.1 + bullishPattern * 0.07 - bearishPattern * 0.09 - eventRisk * 0.08, 0, 1);
  const confidence = clamp(0.28 + average([regimeFit, sweep, reclaim, lowerWickSignal, orderflow], 0) * 0.56, 0, 1);
  return buildStrategy("liquidity_sweep", score, confidence, [
    market.liquiditySweepLabel || "none",
    `close loc ${safeValue(market.closeLocation).toFixed(2)}`,
    `wick ${safeValue(market.wickSkew).toFixed(2)}`,
    `volume z ${safeValue(market.volumeZ).toFixed(2)}`
  ], [
    eventRisk > 0.75 ? "event_risk_headwind" : null,
    bearishPattern > 0.66 ? "pattern_breakdown" : null,
    safeValue(context.marketSnapshot?.book?.bookPressure) < -0.2 ? "reclaim_not_confirmed" : null
  ], { regimeFit, sweep, reclaim, lowerWickSignal, volume });
}

function evaluateMarketStructureBreak(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern, structure } = buildInputs(context);
  const regimeFit = regime === "breakout" ? 1 : regime === "trend" ? 0.8 : regime === "high_vol" ? 0.58 : 0.32;
  const structureBreak = ratio(safeValue(market.structureBreakScore), 0.05, 1);
  const donchianPosition = ratio(safeValue(market.donchianPosition), 0.56, 1);
  const volume = ratio(safeValue(market.volumeZ), -0.1, 2.5);
  const oiTailwind = ratio(safeValue(structure.openInterestChangePct) * 100, -0.2, 8);
  const signal = ratio(safeValue(structure.signalScore), -0.1, 0.95);
  const score = clamp(regimeFit * 0.2 + structureBreak * 0.19 + donchianPosition * 0.11 + volume * 0.11 + oiTailwind * 0.1 + signal * 0.09 + orderflow * 0.1 + bullishPattern * 0.04 - bearishPattern * 0.08 - eventRisk * 0.08, 0, 1);
  const confidence = clamp(0.29 + average([regimeFit, structureBreak, donchianPosition, oiTailwind, signal], 0) * 0.57, 0, 1);
  return buildStrategy("market_structure_break", score, confidence, [
    market.structureBreakLabel || "none",
    `donchian ${(safeValue(market.donchianPosition) * 100).toFixed(0)}%`,
    `oi ${(safeValue(structure.openInterestChangePct) * 100).toFixed(2)}%`,
    `signal ${safeValue(structure.signalScore).toFixed(2)}`
  ], [
    eventRisk > 0.76 ? "event_risk_headwind" : null,
    bearishPattern > 0.64 ? "pattern_reversal_risk" : null,
    safeValue(context.marketSnapshot?.book?.bookPressure) < -0.18 ? "sell_pressure" : null
  ], { regimeFit, structureBreak, donchianPosition, oiTailwind, signal });
}

function evaluateFundingRateExtreme(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern, structure, macro } = buildInputs(context);
  const regimeFit = regime === "range" ? 0.88 : regime === "high_vol" ? 0.76 : regime === "trend" ? 0.4 : 0.32;
  const negativeFunding = ratio(-safeValue(structure.fundingRate) * 10000, 0.4, 7);
  const crowdedShorts = ratio(-safeValue(structure.crowdingBias), 0.08, 0.95);
  const squeeze = ratio(safeValue(structure.shortSqueezeScore), 0.08, 1);
  const topTraderShorts = ratio(-safeValue(structure.topTraderImbalance), 0.04, 0.85);
  const reboundPressure = ratio(safeValue(context.marketSnapshot?.book?.bookPressure), -0.04, 0.68);
  const discount = ratio(-safeValue(market.vwapGapPct) * 100, 0.04, 1.6);
  const signal = ratio(safeValue(structure.signalScore), -0.1, 0.9);
  const contrarian = ratio(safeValue(macro.contrarianScore), -0.1, 1);
  const score = clamp(regimeFit * 0.17 + negativeFunding * 0.16 + crowdedShorts * 0.12 + squeeze * 0.14 + topTraderShorts * 0.09 + reboundPressure * 0.09 + discount * 0.07 + signal * 0.08 + contrarian * 0.04 + orderflow * 0.05 + bullishPattern * 0.05 - bearishPattern * 0.08 - eventRisk * 0.07, 0, 1);
  const confidence = clamp(0.27 + average([regimeFit, negativeFunding, crowdedShorts, squeeze, reboundPressure], 0) * 0.56, 0, 1);
  return buildStrategy("funding_rate_extreme", score, confidence, [
    `funding ${safeValue(structure.fundingRate).toFixed(5)}`,
    `squeeze ${safeValue(structure.shortSqueezeScore).toFixed(2)}`,
    `top ${safeValue(structure.topTraderImbalance).toFixed(2)}`,
    `signal ${safeValue(structure.signalScore).toFixed(2)}`
  ], [
    eventRisk > 0.72 ? "event_risk_headwind" : null,
    safeValue(structure.fundingRate) > 0 ? "funding_not_extreme_negative" : null,
    bearishPattern > 0.68 ? "pattern_breakdown" : null
  ], { regimeFit, negativeFunding, crowdedShorts, squeeze, reboundPressure });
}
function evaluateOpenInterestBreakout(context) {
  const { market, regime, eventRisk, orderflow, bullishPattern, bearishPattern, structure, volatility } = buildInputs(context);
  const regimeFit = regime === "breakout" ? 1 : regime === "trend" ? 0.76 : regime === "high_vol" ? 0.56 : 0.24;
  const oiBreak = ratio(safeValue(structure.openInterestChangePct) * 100, 0.3, 8.5);
  const priceBreak = ratio(Math.max(safeValue(market.breakoutPct), safeValue(market.donchianBreakoutPct)) * 100, -0.02, 1.6);
  const takerBias = ratio(safeValue(structure.takerImbalance), -0.04, 0.85);
  const globalBias = ratio(safeValue(structure.globalLongShortImbalance), -0.1, 0.9);
  const leverage = ratio(safeValue(structure.leverageBuildupScore), 0.05, 1);
  const squeezeConflict = ratio(Math.max(safeValue(structure.longSqueezeScore), safeValue(structure.shortSqueezeScore)), 0.08, 1);
  const signal = ratio(safeValue(structure.signalScore), -0.1, 0.9);
  const volume = ratio(safeValue(market.volumeZ), -0.1, 2.6);
  const volPenalty = clamp(ratio(safeValue(volatility.riskScore), 0.48, 1) * 0.5, 0, 0.5);
  const score = clamp(regimeFit * 0.16 + oiBreak * 0.16 + priceBreak * 0.15 + takerBias * 0.1 + globalBias * 0.08 + leverage * 0.11 + signal * 0.08 + volume * 0.08 + orderflow * 0.08 + bullishPattern * 0.04 - squeezeConflict * 0.07 - bearishPattern * 0.08 - eventRisk * 0.07 - volPenalty, 0, 1);
  const confidence = clamp(0.29 + average([regimeFit, oiBreak, priceBreak, leverage, signal], 0) * 0.57 - volPenalty * 0.2, 0, 1);
  return buildStrategy("open_interest_breakout", score, confidence, [
    `oi ${(safeValue(structure.openInterestChangePct) * 100).toFixed(2)}%`,
    `lev ${safeValue(structure.leverageBuildupScore).toFixed(2)}`,
    `global ${safeValue(structure.globalLongShortImbalance).toFixed(2)}`,
    `signal ${safeValue(structure.signalScore).toFixed(2)}`
  ], [
    eventRisk > 0.75 ? "event_risk_headwind" : null,
    bearishPattern > 0.64 ? "pattern_reversal_risk" : null,
    safeValue(structure.openInterestChangePct) < 0 ? "oi_not_expanding" : null,
    safeValue(volatility.riskScore) > 0.82 ? "options_vol_stress" : null
  ], { regimeFit, oiBreak, priceBreak, leverage, signal });
}
function evaluateOrderbookImbalance(context) {
  const { regime, eventRisk, bullishPattern, bearishPattern } = buildInputs(context);
  const book = context.marketSnapshot?.book || {};
  const stream = context.streamFeatures || context.marketSnapshot?.stream || {};
  const regimeFit = regime === "trend" ? 0.78 : regime === "range" ? 0.74 : regime === "breakout" ? 0.68 : 0.46;
  const pressure = ratio(safeValue(book.bookPressure), -0.05, 0.9);
  const weighted = ratio(safeValue(book.weightedDepthImbalance), -0.05, 0.95);
  const micro = ratio(safeValue(book.microPriceEdgeBps), -0.1, 4.2);
  const wall = ratio(safeValue(book.wallImbalance), -0.05, 0.92);
  const spreadEfficiency = clamp(1 - ratio(safeValue(book.spreadBps), 4, 20), 0, 1);
  const tradeFlow = ratio(safeValue(stream.tradeFlowImbalance), -0.06, 0.86);
  const score = clamp(regimeFit * 0.18 + pressure * 0.2 + weighted * 0.14 + micro * 0.13 + wall * 0.1 + spreadEfficiency * 0.08 + tradeFlow * 0.08 + bullishPattern * 0.04 - bearishPattern * 0.08 - eventRisk * 0.07, 0, 1);
  const confidence = clamp(0.3 + average([regimeFit, pressure, weighted, micro, wall], 0) * 0.58, 0, 1);
  return buildStrategy("orderbook_imbalance", score, confidence, [
    `pressure ${safeValue(book.bookPressure).toFixed(2)}`,
    `micro ${safeValue(book.microPriceEdgeBps).toFixed(2)}bps`,
    `wall ${safeValue(book.wallImbalance).toFixed(2)}`,
    `spread ${safeValue(book.spreadBps).toFixed(2)}bps`
  ], [
    eventRisk > 0.72 ? "event_risk_headwind" : null,
    bearishPattern > 0.66 ? "pattern_reversal_risk" : null,
    safeValue(book.spreadBps) > 20 ? "spread_too_wide" : null
  ], { regimeFit, pressure, weighted, micro, wall });
}

export function evaluateStrategySet(context) {
  const baseStrategies = [
    evaluateBreakout(context),
    evaluateMeanReversion(context),
    evaluateTrendFollowing(context),
    evaluateEmaTrend(context),
    evaluateDonchianBreakout(context),
    evaluateVwapTrend(context),
    evaluateBollingerSqueeze(context),
    evaluateAtrBreakout(context),
    evaluateVwapReversion(context),
    evaluateZScoreReversion(context),
    evaluateLiquiditySweep(context),
    evaluateMarketStructureBreak(context),
    evaluateFundingRateExtreme(context),
    evaluateOpenInterestBreakout(context),
    evaluateOrderbookImbalance(context)
  ];
  const strategies = applyOptimizer(baseStrategies, context.optimizerSummary).sort((left, right) => right.fitScore - left.fitScore);
  const familyRankings = buildFamilyRankings(strategies);
  const active = strategies[0];
  const runnerUp = strategies[1] || null;
  const agreementGap = clamp((active?.fitScore || 0) - (runnerUp?.fitScore || 0), 0, 1);
  const optimizerConfidence = Math.max(active?.optimizerConfidence || 0, context.optimizerSummary?.sampleConfidence || 0);
  const confidence = clamp((active?.confidence || 0) * 0.66 + agreementGap * 0.24 + optimizerConfidence * 0.1, 0, 1);
  const optimizerBoost = (active?.fitScore || 0) - (active?.rawFitScore || active?.fitScore || 0);
  return {
    activeStrategy: active?.id || "trend_following",
    strategyLabel: active?.label || "Trend following composite",
    family: active?.family || "trend_following",
    familyLabel: active?.familyLabel || "Trend following",
    setupStyle: active?.setupStyle || "trend_following",
    fitScore: active?.fitScore || 0,
    rawFitScore: active?.rawFitScore || active?.fitScore || 0,
    optimizerBoost,
    score: active?.score || 0,
    confidence,
    agreementGap,
    reasons: [...(active?.reasons || [])],
    blockers: [...(active?.blockers || [])],
    strategies,
    familyRankings,
    strategyMap: Object.fromEntries(strategies.map((strategy) => [strategy.id, strategy])),
    optimizer: context.optimizerSummary || null
  };
}

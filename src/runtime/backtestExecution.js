import { RiskManager } from "../risk/riskManager.js";
import { buildSessionSummary } from "./sessionManager.js";
import { normalizeQuantity, resolveMarketBuyQuantity } from "../binance/symbolFilters.js";

function safePrice(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildSyntheticBook(candle, market, config, options = {}) {
  const latencyBps = Number.isFinite(options.latencyBps)
    ? options.latencyBps
    : Math.max(0.4, (config.backtestLatencyMs || 0) / 1000 * 1.6);
  const spreadBps = Math.max(config.paperSlippageBps * 1.6, 4 + Math.abs(market.momentum5 || 0) * 10_000 * 0.04);
  const mid = safePrice(options.anchorPrice, candle.close);
  const halfSpread = spreadBps / 20_000;
  const depthNotional = config.backtestSyntheticDepthUsd * Math.max(0.35, 1 - (market.realizedVolPct || 0));
  return {
    bid: mid * (1 - halfSpread),
    ask: mid * (1 + halfSpread),
    mid,
    spreadBps,
    depthImbalance: Math.max(-1, Math.min(1, (market.momentum5 || 0) * 90)),
    weightedDepthImbalance: Math.max(-1, Math.min(1, (market.momentum20 || 0) * 70)),
    tradeFlowImbalance: Math.max(-1, Math.min(1, (market.momentum5 || 0) * 120)),
    microTrend: market.momentum5 || 0,
    recentTradeCount: 8,
    bookPressure: Math.max(-1, Math.min(1, (market.momentum20 || 0) * 85)),
    microPriceEdgeBps: latencyBps,
    depthConfidence: Math.max(0.34, 1 - (market.realizedVolPct || 0) * 8),
    totalDepthNotional: depthNotional,
    queueImbalance: Math.max(-1, Math.min(1, (market.momentum5 || 0) * 100)),
    queueRefreshScore: Math.max(0, 0.4 + (market.volumeZ || 0) * 0.08),
    resilienceScore: Math.max(0, 0.45 - (market.realizedVolPct || 0) * 2),
    localBook: {
      synced: true,
      depthConfidence: Math.max(0.34, 1 - (market.realizedVolPct || 0) * 8),
      totalDepthNotional: depthNotional,
      queueImbalance: Math.max(-1, Math.min(1, (market.momentum5 || 0) * 100)),
      queueRefreshScore: Math.max(0, 0.4 + (market.volumeZ || 0) * 0.08),
      resilienceScore: Math.max(0, 0.45 - (market.realizedVolPct || 0) * 2)
    }
  };
}

export function resolveCandleIntervalMinutes(candles = [], index = 0, fallbackMinutes = 15) {
  const current = candles[index] || null;
  const previous = index > 0 ? candles[index - 1] : null;
  const closeDeltaMs = current && previous ? Number(current.closeTime) - Number(previous.closeTime) : NaN;
  if (Number.isFinite(closeDeltaMs) && closeDeltaMs > 0) {
    return Math.max(1, closeDeltaMs / 60_000);
  }
  const openCloseMs = current ? Number(current.closeTime) - Number(current.openTime) : NaN;
  if (Number.isFinite(openCloseMs) && openCloseMs > 0) {
    return Math.max(1, openCloseMs / 60_000);
  }
  return fallbackMinutes;
}

export function resolveCandleOpenTime(candles = [], index = 0, fallbackMinutes = 15) {
  const candle = candles[index] || null;
  if (!candle) {
    return null;
  }
  if (Number.isFinite(Number(candle.openTime))) {
    return Number(candle.openTime);
  }
  const closeTime = Number(candle.closeTime);
  if (!Number.isFinite(closeTime)) {
    return null;
  }
  return closeTime - resolveCandleIntervalMinutes(candles, index, fallbackMinutes) * 60_000;
}

export function resolveEntryExecution(candles = [], signalIndex = 0, market = {}, config = {}, options = {}) {
  const executionCandle = candles[signalIndex + 1] || null;
  if (!executionCandle) {
    return null;
  }
  return {
    candle: executionCandle,
    entryTimeMs: resolveCandleOpenTime(candles, signalIndex + 1),
    book: buildSyntheticBook(executionCandle, market, config, {
      anchorPrice: executionCandle.open,
      latencyBps: options.latencyBps
    })
  };
}

export function resolveExitAnchorPrice({ candle = {}, exitReason = null, position = {}, trailingStopPrice = null }) {
  const candleOpen = safePrice(candle.open, candle.close);
  const candleClose = safePrice(candle.close, candleOpen);
  if (exitReason === "stop_loss") {
    return candleOpen <= safePrice(position.stopLossPrice, candleClose) ? candleOpen : safePrice(position.stopLossPrice, candleClose);
  }
  if (exitReason === "trailing_stop") {
    return candleOpen <= safePrice(trailingStopPrice, candleClose) ? candleOpen : safePrice(trailingStopPrice, candleClose);
  }
  if (exitReason === "take_profit") {
    return candleOpen >= safePrice(position.takeProfitPrice, candleClose) ? candleOpen : safePrice(position.takeProfitPrice, candleClose);
  }
  return candleClose;
}

export function buildExitExecutionBook({ candle = {}, market = {}, config = {}, position = {}, exitReason = null, trailingStopPrice = null, options = {} }) {
  return buildSyntheticBook(candle, market, config, {
    anchorPrice: resolveExitAnchorPrice({ candle, exitReason, position, trailingStopPrice }),
    latencyBps: options.latencyBps
  });
}

function buildNeutralSummary() {
  return {
    riskScore: 0,
    sentimentScore: 0,
    confidence: 0,
    reasons: [],
    blockerReasons: []
  };
}

export function buildSimulationEntryDecision({
  config = {},
  symbol,
  now,
  score = {},
  marketSnapshot = {},
  newsSummary = {},
  strategySummary = {},
  regimeSummary = {},
  trendStateSummary = {},
  marketStateSummary = {},
  journal = {},
  runtime = {},
  balance = { quoteFree: 0 },
  symbolStats = {},
  execution,
  overrides = {}
} = {}) {
  const risk = new RiskManager({ ...config, botMode: "paper" });
  const neutral = buildNeutralSummary();
  const sessionSummary = config.enableSessionLogic
    ? buildSessionSummary({ now, marketSnapshot, marketStructureSummary: neutral, config })
    : { session: "disabled", sessionLabel: "Disabled", sizeMultiplier: 1, thresholdPenalty: 0, reasons: [], blockerReasons: [] };
  const committeeSummary = score.committee || { vetoes: [], confidence: 0, probability: 0.5, netScore: 0, agreement: 1 };
  const portfolioSummary = {
    sizeMultiplier: 1,
    reasons: [],
    maxCorrelation: 0,
    allocatorScore: 0.5,
    ...(overrides.portfolioSummary || {})
  };
  const qualityQuorumSummary = {
    status: "ready",
    quorumScore: 1,
    averageScore: 1,
    observeOnly: false,
    ...(overrides.qualityQuorumSummary || {})
  };
  const venueConfirmationSummary = {
    status: "pending",
    confirmed: false,
    blockerReasons: [],
    ...(overrides.venueConfirmationSummary || {})
  };
  const decision = risk.evaluateEntry({
    symbol,
    score,
    marketSnapshot,
    newsSummary,
    announcementSummary: overrides.announcementSummary || neutral,
    marketStructureSummary: overrides.marketStructureSummary || neutral,
    marketSentimentSummary: overrides.marketSentimentSummary || neutral,
    volatilitySummary: overrides.volatilitySummary || neutral,
    calendarSummary: overrides.calendarSummary || { ...neutral, proximityHours: null },
    committeeSummary,
    rlAdvice: overrides.rlAdvice || { action: "balanced", sizeMultiplier: 1, expectedReward: 0 },
    strategySummary,
    sessionSummary,
    driftSummary: overrides.driftSummary || { severity: 0, reasons: [], blockerReasons: [] },
    selfHealState: overrides.selfHealState || { mode: "normal", sizeMultiplier: 1, thresholdPenalty: 0, issues: [], learningAllowed: true },
    metaSummary: overrides.metaSummary || { action: "allow", reasons: [], sizeMultiplier: 1, thresholdPenalty: 0, score: 0 },
    runtime,
    journal,
    balance,
    symbolStats,
    portfolioSummary,
    regimeSummary,
    thresholdTuningSummary: overrides.thresholdTuningSummary || {},
    parameterGovernorSummary: overrides.parameterGovernorSummary || {},
    capitalLadderSummary: overrides.capitalLadderSummary || {},
    capitalGovernorSummary: overrides.capitalGovernorSummary || {},
    executionCostSummary: overrides.executionCostSummary || {},
    strategyRetirementSummary: overrides.strategyRetirementSummary || {},
    timeframeSummary: overrides.timeframeSummary || { alignmentScore: 0, higherBias: 0, blockerReasons: [] },
    pairHealthSummary: overrides.pairHealthSummary || { score: 1, quarantined: false, reasons: [] },
    symbolRules: overrides.symbolRules || null,
    onChainLiteSummary: overrides.onChainLiteSummary || { liquidityScore: 0.5, stressScore: 0, riskOffScore: 0, marketBreadthScore: 0.5, trendingScore: 0, majorsMomentumScore: 0 },
    qualityQuorumSummary,
    divergenceSummary: overrides.divergenceSummary || { averageScore: 0, blockerReasons: [] },
    trendStateSummary,
    marketStateSummary,
    venueConfirmationSummary,
    exchangeCapabilitiesSummary: overrides.exchangeCapabilitiesSummary || { spotEnabled: true, shortingEnabled: false },
    strategyMetaSummary: score.strategyMeta || overrides.strategyMetaSummary || {},
    nowIso: now.toISOString()
  });
  decision.executionPlan = execution.buildEntryPlan({
    symbol,
    marketSnapshot,
    score,
    decision,
    regimeSummary,
    strategySummary,
    portfolioSummary,
    committeeSummary,
    rlAdvice: decision.rlAdvice || overrides.rlAdvice || { action: "balanced", sizeMultiplier: 1, expectedReward: 0 },
    executionNeuralSummary: score.executionNeural || null,
    strategyMetaSummary: score.strategyMeta || overrides.strategyMetaSummary || {},
    capitalLadderSummary: overrides.capitalLadderSummary || {},
    venueConfirmationSummary,
    sessionSummary
  });
  return decision;
}

export function buildSimulationExitDecision({
  config = {},
  position = {},
  currentPrice = 0,
  marketSnapshot = {},
  nowIso,
  overrides = {}
} = {}) {
  const risk = new RiskManager({ ...config, botMode: "paper" });
  return risk.evaluateExit({
    position,
    currentPrice,
    newsSummary: overrides.newsSummary || { riskScore: 0, sentimentScore: 0 },
    announcementSummary: overrides.announcementSummary || { riskScore: 0 },
    marketStructureSummary: overrides.marketStructureSummary || { riskScore: 0, signalScore: 0, liquidationCount: 0, liquidationImbalance: 0 },
    calendarSummary: overrides.calendarSummary || { riskScore: 0, proximityHours: 999 },
    marketSnapshot,
    exitIntelligenceSummary: overrides.exitIntelligenceSummary || {},
    exitPolicySummary: overrides.exitPolicySummary || {},
    parameterGovernorSummary: overrides.parameterGovernorSummary || {},
    nowIso
  });
}

export function resolveSimulationBuyFill({ quoteAmount = 0, executionPrice = 0, fillEstimate = {}, rules = null } = {}) {
  if (!rules) {
    const executedQuote = Number.isFinite(fillEstimate?.executedQuote) ? fillEstimate.executedQuote : quoteAmount;
    const executedQuantity = Number.isFinite(fillEstimate?.executedQuantity)
      ? fillEstimate.executedQuantity
      : executionPrice > 0
        ? executedQuote / executionPrice
        : 0;
    return {
      quantity: executedQuantity,
      notional: executedQuantity * executionPrice,
      valid: executedQuantity > 0 && executionPrice > 0
    };
  }

  const requestedSize = resolveMarketBuyQuantity(quoteAmount, executionPrice, rules);
  if (!requestedSize.valid) {
    return {
      quantity: 0,
      notional: 0,
      valid: false,
      reason: requestedSize.reason || "quantity_below_minimum"
    };
  }

  const rawExecutedQuantity = Number.isFinite(fillEstimate?.executedQuantity)
    ? fillEstimate.executedQuantity
    : executionPrice > 0
      ? (fillEstimate?.executedQuote || 0) / executionPrice
      : 0;
  let quantity = normalizeQuantity(rawExecutedQuantity, rules, "floor", true);
  if (!quantity && rawExecutedQuantity > 0) {
    quantity = Math.min(
      requestedSize.quantity,
      normalizeQuantity(rawExecutedQuantity, rules, "ceil", true)
    );
  }
  if (!quantity && (fillEstimate?.completionRatio || 0) > 0) {
    quantity = Math.min(
      requestedSize.quantity,
      normalizeQuantity(rules.marketMinQty || rules.minQty || requestedSize.quantity, rules, "ceil", true)
    );
  }
  if (!quantity) {
    return {
      quantity: 0,
      notional: 0,
      valid: false,
      reason: "quantity_below_minimum"
    };
  }
  const notional = quantity * executionPrice;
  if (notional < (rules.minNotional || 0)) {
    return {
      quantity: 0,
      notional,
      valid: false,
      reason: "notional_below_minimum"
    };
  }
  return {
    quantity,
    notional,
    valid: true
  };
}

export function resolveSimulationSellQuantity({ requestedQuantity = 0, availableQuantity = 0, rules = null, allowFullClose = false } = {}) {
  const cappedRequested = Math.max(0, Math.min(requestedQuantity, availableQuantity));
  if (!rules) {
    return {
      quantity: cappedRequested,
      valid: cappedRequested > 0
    };
  }
  let quantity = normalizeQuantity(cappedRequested, rules, "floor", true);
  if (!quantity && allowFullClose) {
    quantity = normalizeQuantity(availableQuantity, rules, "floor", true);
  }
  if (!quantity || quantity <= 0) {
    return {
      quantity: 0,
      valid: false
    };
  }
  return {
    quantity: Math.min(quantity, availableQuantity),
    valid: true
  };
}

import { clamp } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function getStrategyProfile(strategySummary = {}) {
  const active = strategySummary.activeStrategy || null;
  const family = strategySummary.family || null;
  return {
    active,
    family,
    makerBias:
      family === "mean_reversion" ? 0.12 :
      family === "breakout" ? -0.08 :
      family === "orderflow" ? -0.02 :
      family === "market_structure" ? -0.04 : 0,
    patienceBias:
      family === "mean_reversion" ? 1.12 :
      family === "breakout" ? 0.88 :
      family === "orderflow" ? 0.92 :
      family === "trend_following" ? 0.98 : 1,
    trailingBias:
      family === "breakout" ? 1.08 :
      family === "mean_reversion" ? 0.92 :
      family === "orderflow" ? 0.95 : 1.02
  };
}

function buildStrategyTags(symbol, strategy) {
  const text = `${symbol}:${strategy || "hybrid"}`;
  let hash = 17;
  for (const char of text) {
    hash = (hash * 31 + char.charCodeAt(0)) % 900_000;
  }
  return {
    strategyId: 2_026_000_000 + hash,
    strategyType: 2_026_001
  };
}

function summarizeConditionalFields(orderResponses = []) {
  const responses = orderResponses.filter(Boolean);
  return {
    usedSor: responses.some((item) => item.usedSor),
    workingFloors: [...new Set(responses.map((item) => item.workingFloor).filter(Boolean))],
    pegPriceType: [...responses].reverse().find((item) => item.pegPriceType)?.pegPriceType || null,
    pegOffsetType: [...responses].reverse().find((item) => item.pegOffsetType)?.pegOffsetType || null,
    pegOffsetValue: [...responses].reverse().find((item) => item.pegOffsetValue != null)?.pegOffsetValue ?? null,
    peggedPrice: safeNumber([...responses].reverse().find((item) => item.peggedPrice)?.peggedPrice || 0),
    preventedQuantity: responses.reduce((total, item) => total + safeNumber(item.preventedQuantity || 0), 0),
    preventedMatchIds: [...new Set(responses.map((item) => item.preventedMatchId).filter((value) => value != null))]
  };
}

export class ExecutionEngine {
  constructor(config) {
    this.config = config;
  }

  buildEntryPlan({ symbol, marketSnapshot, score, decision, regimeSummary, strategySummary = {}, portfolioSummary, committeeSummary = null, rlAdvice = null, executionNeuralSummary = null }) {
    const spreadBps = marketSnapshot.book.spreadBps || 0;
    const tradeFlow = marketSnapshot.book.tradeFlowImbalance || 0;
    const localBook = marketSnapshot.book.localBook || {};
    const impactEstimate = marketSnapshot.book.entryEstimate || null;
    const expectedImpactBps = Math.max(0, safeNumber(impactEstimate?.touchSlippageBps || Math.abs(impactEstimate?.midSlippageBps || 0) * 0.5));
    const depthConfidence = safeNumber(localBook.depthConfidence || 0);
    const queueImbalance = safeNumber(localBook.queueImbalance || 0);
    const queueRefreshScore = safeNumber(localBook.queueRefreshScore || 0);
    const resilienceScore = safeNumber(localBook.resilienceScore || 0);
    const basePreferMaker =
      this.config.botMode === "live" &&
      this.config.enableSmartExecution &&
      spreadBps >= this.config.makerMinSpreadBps &&
      score.probability < this.config.aggressiveEntryThreshold &&
      regimeSummary.regime !== "event_risk";

    const strategyProfile = getStrategyProfile(strategySummary);
    let strategyMakerBias = strategyProfile.makerBias;
    if (["vwap_reversion", "zscore_reversion", "funding_rate_extreme"].includes(strategyProfile.active)) {
      strategyMakerBias += 0.04;
    }
    if (["donchian_breakout", "atr_breakout", "open_interest_breakout", "market_structure_break"].includes(strategyProfile.active)) {
      strategyMakerBias -= 0.04;
    }

    const rlPreferMakerShift = rlAdvice?.preferMakerBoost || 0;
    const neuralPreferMakerShift = executionNeuralSummary?.preferMakerBoost || 0;
    const committeeTailwind = committeeSummary ? Math.max(0, committeeSummary.netScore || 0) * 0.06 : 0;
    const microstructureTailwind = depthConfidence * 0.18 + queueImbalance * 0.14 + queueRefreshScore * 0.1 + resilienceScore * 0.08 - expectedImpactBps / 28;
    const preferMakerScore = (basePreferMaker ? 0.55 : 0.35) + rlPreferMakerShift + neuralPreferMakerShift + committeeTailwind + strategyMakerBias + microstructureTailwind - (score.probability > this.config.aggressiveEntryThreshold ? 0.18 : 0);
    const preferMaker = preferMakerScore >= 0.5;

    const preferPegged = Boolean(
      preferMaker &&
      this.config.enablePeggedOrders &&
      localBook.synced &&
      depthConfidence >= 0.42 &&
      expectedImpactBps <= this.config.maxPeggedImpactBps
    );

    let pegOffsetValue = null;
    if (preferPegged) {
      if (strategyProfile.family === "mean_reversion") {
        pegOffsetValue = Math.max(1, Math.round(this.config.defaultPegOffsetLevels));
      }
      if (queueImbalance < -0.12) {
        pegOffsetValue = Math.max(pegOffsetValue || 0, Math.round(this.config.defaultPegOffsetLevels));
      }
      if (expectedImpactBps < 0.6 && queueImbalance > 0.1) {
        pegOffsetValue = null;
      }
    }

    let strategyPatienceBias = strategyProfile.patienceBias;
    if (["liquidity_sweep", "orderbook_imbalance"].includes(strategyProfile.active)) {
      strategyPatienceBias *= 0.92;
    }
    const expectedMakerFillPct = clamp(0.34 + depthConfidence * 0.24 + queueImbalance * 0.16 + queueRefreshScore * 0.14 + tradeFlow * 0.1 - expectedImpactBps / 16, 0.08, 0.98);
    const patienceMultiplier = clamp((rlAdvice?.patienceMultiplier || 1) * (executionNeuralSummary?.patienceMultiplier || 1) * strategyPatienceBias * (preferPegged ? 1.08 : 1) * (expectedMakerFillPct >= 0.58 ? 1.12 : 0.92), 0.75, 1.6);
    const makerPatienceMs = Math.round(
      clamp(
        this.config.baseMakerPatienceMs * patienceMultiplier * (1 + Math.max(0, spreadBps / 10)) * (tradeFlow > 0 ? 1.1 : 0.8),
        1200,
        this.config.maxMakerPatienceMs
      )
    );

    const trailingBase = Math.max(1, Math.round(this.config.trailingStopPct * 10_000));
    let strategyTrailingBias = strategyProfile.trailingBias;
    if (["liquidity_sweep", "market_structure_break", "open_interest_breakout"].includes(strategyProfile.active)) {
      strategyTrailingBias *= 1.03;
    }
    const trailingDelta = Math.max(1, Math.round(trailingBase * clamp((rlAdvice?.trailingMultiplier || 1) * strategyTrailingBias, 0.85, 1.18)));
    const entryStyle = preferPegged ? "pegged_limit_maker" : preferMaker ? "limit_maker" : "market";
    const fallbackStyle = preferMaker ? "cancel_replace_market" : "none";
    const strategyTags = buildStrategyTags(symbol, strategySummary.activeStrategy);

    return {
      symbol,
      entryStyle,
      fallbackStyle,
      usePeggedOrder: preferPegged,
      pegPriceType: preferPegged ? "PRIMARY_PEG" : null,
      pegOffsetType: preferPegged && pegOffsetValue != null ? "PRICE_LEVEL" : null,
      pegOffsetValue,
      makerPatienceMs,
      trailingDelta,
      preferMaker,
      allowKeepPriority: preferMaker,
      tradeFlow,
      queueScore: clamp((tradeFlow + (portfolioSummary?.sizeMultiplier || 1) - 1 + (committeeSummary?.agreement || 0) + queueImbalance) / 2.45, -1, 1),
      queueImbalance,
      queueRefreshScore,
      resilienceScore,
      depthConfidence,
      expectedImpactBps,
      expectedSlippageBps: safeNumber(impactEstimate?.midSlippageBps || expectedImpactBps),
      expectedMakerFillPct,
      rlAction: rlAdvice?.action || "balanced",
      rlBucket: rlAdvice?.bucket || null,
      expectedReward: rlAdvice?.expectedReward || 0,
      sizeMultiplier: clamp((rlAdvice?.sizeMultiplier || 1) * (executionNeuralSummary?.sizeMultiplier || 1), 0.6, 1.2),
      executionNeural: executionNeuralSummary
        ? {
            preferMakerBoost: executionNeuralSummary.preferMakerBoost || 0,
            patienceMultiplier: executionNeuralSummary.patienceMultiplier || 1,
            sizeMultiplier: executionNeuralSummary.sizeMultiplier || 1,
            aggressiveness: executionNeuralSummary.aggressiveness || 1,
            confidence: executionNeuralSummary.confidence || 0,
            drivers: [...(executionNeuralSummary.drivers || [])]
          }
        : null,
      strategy: strategySummary.activeStrategy || null,
      strategyFamily: strategySummary.family || null,
      strategyFit: strategySummary.fitScore || 0,
      strategyId: strategyTags.strategyId,
      strategyType: strategyTags.strategyType,
      rationale: [
        `regime:${regimeSummary.regime}`,
        `strategy:${strategySummary.activeStrategy || "hybrid"}`,
        `family:${strategySummary.family || "hybrid"}`,
        `spread_bps:${spreadBps.toFixed(2)}`,
        `probability:${score.probability.toFixed(3)}`,
        `maker:${preferMaker}`,
        `pegged:${preferPegged}`,
        `queue:${queueImbalance.toFixed(3)}`,
        `depth_conf:${depthConfidence.toFixed(3)}`,
        `impact_bps:${expectedImpactBps.toFixed(2)}`,
        `committee:${(committeeSummary?.netScore || 0).toFixed(3)}`,
        `rl:${rlAdvice?.action || "balanced"}`,
        `exec_nn:${(executionNeuralSummary?.confidence || 0).toFixed(3)}`
      ]
    };
  }

  simulatePaperFill({
    marketSnapshot,
    side,
    requestedQuoteAmount = 0,
    requestedQuantity = 0,
    plan = {},
    latencyMs = 0,
    fallbackStyle = null,
    makerFillFloor = this.config.paperMakerFillFloor,
    minPartialFillRatio = this.config.paperPartialFillMinRatio
  }) {
    const book = marketSnapshot.book || {};
    const market = marketSnapshot.market || {};
    const resolvedMakerFillFloor = Number.isFinite(makerFillFloor) ? makerFillFloor : 0.22;
    const resolvedMinPartialFillRatio = Number.isFinite(minPartialFillRatio) ? minPartialFillRatio : 0.35;
    const referencePrice = side === "BUY" ? safeNumber(book.ask, book.mid) : safeNumber(book.bid, book.mid);
    const spreadBps = safeNumber(book.spreadBps);
    const depthConfidence = safeNumber(plan.depthConfidence || book.depthConfidence || book.localBook?.depthConfidence);
    const queueImbalance = safeNumber(plan.queueImbalance || book.queueImbalance || book.localBook?.queueImbalance);
    const queueRefreshScore = safeNumber(plan.queueRefreshScore || book.queueRefreshScore || book.localBook?.queueRefreshScore);
    const tradeFlow = safeNumber(plan.tradeFlow || book.tradeFlowImbalance || book.tradeFlow);
    const volatility = safeNumber(market.realizedVolPct || book.realizedVolPct || 0.01);
    const expectedImpactBps = safeNumber(plan.expectedImpactBps || book.entryEstimate?.touchSlippageBps || book.exitEstimate?.touchSlippageBps || 0.8);
    const expectedMidSlippageBps = safeNumber(plan.expectedSlippageBps || book.entryEstimate?.midSlippageBps || book.exitEstimate?.midSlippageBps || expectedImpactBps * 0.8);
    const isMaker = ["limit_maker", "pegged_limit_maker"].includes(plan.entryStyle);
    const isPegged = plan.entryStyle === "pegged_limit_maker";
    const fallbackMode = fallbackStyle || plan.fallbackStyle || "none";
    const workingTimeMs = isMaker ? Math.round((plan.makerPatienceMs || 0) * clamp(0.72 + depthConfidence * 0.45 - queueImbalance * 0.14, 0.45, 1.2)) : Math.round(latencyMs || 0);
    const latencyBps = clamp((latencyMs / 1000) * (volatility * 520 + spreadBps * 0.05 + Math.abs(tradeFlow) * 1.6), 0, 18);
    const makerCompletion = isMaker
      ? clamp(
          safeNumber(plan.expectedMakerFillPct, 0.32) +
            depthConfidence * 0.18 +
            queueRefreshScore * 0.12 +
            queueImbalance * 0.08 -
            volatility * 2.4 -
            spreadBps / 180 +
            (isPegged ? 0.08 : 0),
          resolvedMakerFillFloor,
          0.98
        )
      : 0;
    const completionRatio = isMaker
      ? clamp(makerCompletion + (fallbackMode === "cancel_replace_market" ? (1 - makerCompletion) * 0.96 : 0), resolvedMinPartialFillRatio, 1)
      : 1;
    const safeCompletionRatio = Number.isFinite(completionRatio)
      ? completionRatio
      : isMaker
        ? resolvedMinPartialFillRatio
        : 1;
    const makerFillRatio = isMaker ? clamp(Math.min(makerCompletion, safeCompletionRatio), 0, 1) : 0;
    const takerFillRatio = clamp(safeCompletionRatio - makerFillRatio, 0, 1);
    const styleImpact = !isMaker ? 1 : isPegged ? 0.22 : 0.38;
    const queuePenaltyBps = isMaker ? clamp((1 - depthConfidence) * 1.4 + Math.max(0, -queueImbalance) * 1.2, 0, 4.5) : 0;
    const executionBps = Math.max(0.01, expectedImpactBps * styleImpact + expectedMidSlippageBps * 0.25 + latencyBps * (isMaker ? 0.55 : 1) + queuePenaltyBps);
    const fillPrice = referencePrice
      ? side === "BUY"
        ? referencePrice * (1 + executionBps / 10_000)
        : referencePrice * (1 - executionBps / 10_000)
      : 0;
    const executedQuote = requestedQuoteAmount > 0 ? requestedQuoteAmount * safeCompletionRatio : requestedQuantity * fillPrice * safeCompletionRatio;
    const executedQuantity = requestedQuantity > 0 ? requestedQuantity * safeCompletionRatio : fillPrice > 0 ? executedQuote / fillPrice : 0;

    return {
      referencePrice,
      fillPrice,
      completionRatio: safeCompletionRatio,
      makerFillRatio,
      takerFillRatio,
      expectedImpactBps: executionBps,
      expectedMidSlippageBps,
      workingTimeMs,
      latencyBps,
      executedQuote,
      executedQuantity,
      notes: [
        `completion:${safeCompletionRatio.toFixed(2)}`,
        `maker:${makerFillRatio.toFixed(2)}`,
        `latency_bps:${latencyBps.toFixed(2)}`,
        `working_ms:${workingTimeMs}`
      ]
    };
  }

  buildExecutionQuality({ marketSnapshot, fillPrice, side }) {
    const referencePrice = side === "BUY" ? marketSnapshot.book.ask : marketSnapshot.book.bid;
    const mid = marketSnapshot.book.mid || referencePrice || 0;
    const slippagePct = mid ? Math.abs(fillPrice - mid) / mid : 0;
    return clamp(1 - slippagePct * 120 - (marketSnapshot.book.spreadBps || 0) / 60, 0, 1);
  }

  buildExecutionAttribution({
    plan,
    marketSnapshot,
    side,
    fillPrice,
    requestedQuoteAmount = 0,
    executedQuote = 0,
    executedQuantity = 0,
    orderResponses = [],
    orderTelemetry = {},
    fillEstimate = null,
    amendmentCount = 0,
    cancelReplaceCount = 0,
    keepPriorityCount = 0,
    brokerMode = "paper"
  }) {
    const referenceTouch = side === "BUY" ? marketSnapshot.book.ask : marketSnapshot.book.bid;
    const referenceMid = marketSnapshot.book.mid || referenceTouch || fillPrice || 0;
    const touchSlippageBps = referenceTouch
      ? ((side === "BUY" ? fillPrice - referenceTouch : referenceTouch - fillPrice) / referenceTouch) * 10_000
      : 0;
    const midSlippageBps = referenceMid
      ? ((side === "BUY" ? fillPrice - referenceMid : referenceMid - fillPrice) / referenceMid) * 10_000
      : 0;
    const responseFields = summarizeConditionalFields(orderResponses);
    const makerRatio = safeNumber(orderTelemetry.makerFillRatio, 0);
    const takerRatio = safeNumber(orderTelemetry.takerFillRatio, makerRatio ? 1 - makerRatio : plan.preferMaker ? 0.35 : 1);
    const preventedQuantity = safeNumber(responseFields.preventedQuantity + (orderTelemetry.preventedQuantity || 0));

    return {
      brokerMode,
      entryStyle: plan.entryStyle,
      fallbackStyle: plan.fallbackStyle,
      preferMaker: Boolean(plan.preferMaker),
      requestedQuoteAmount: safeNumber(requestedQuoteAmount, 0),
      executedQuote: safeNumber(executedQuote, 0),
      executedQuantity: safeNumber(executedQuantity, 0),
      completionRatio: fillEstimate?.completionRatio != null ? safeNumber(fillEstimate.completionRatio, 0) : requestedQuoteAmount > 0 ? clamp(executedQuote / requestedQuoteAmount, 0, 1) : 1,
      expectedImpactBps: safeNumber(plan.expectedImpactBps, 0),
      expectedSlippageBps: safeNumber(plan.expectedSlippageBps, 0),
      realizedTouchSlippageBps: safeNumber(touchSlippageBps, 0),
      realizedMidSlippageBps: safeNumber(midSlippageBps, 0),
      slippageDeltaBps: safeNumber(touchSlippageBps - safeNumber(plan.expectedImpactBps, 0), 0),
      makerFillRatio: clamp(makerRatio, 0, 1),
      takerFillRatio: clamp(takerRatio, 0, 1),
      depthConfidence: safeNumber(plan.depthConfidence, 0),
      queueImbalance: safeNumber(plan.queueImbalance, 0),
      queueRefreshScore: safeNumber(plan.queueRefreshScore, 0),
      resilienceScore: safeNumber(plan.resilienceScore, 0),
      tradeFlow: safeNumber(plan.tradeFlow, 0),
      usedSor: Boolean(responseFields.usedSor || orderTelemetry.usedSor),
      workingFloors: [...new Set([...(responseFields.workingFloors || []), ...(orderTelemetry.workingFloors || [])].filter(Boolean))],
      peggedOrder: Boolean(plan.usePeggedOrder || responseFields.pegPriceType || orderTelemetry.pegPriceType),
      pegPriceType: responseFields.pegPriceType || orderTelemetry.pegPriceType || plan.pegPriceType || null,
      pegOffsetType: responseFields.pegOffsetType || orderTelemetry.pegOffsetType || plan.pegOffsetType || null,
      pegOffsetValue: responseFields.pegOffsetValue ?? orderTelemetry.pegOffsetValue ?? plan.pegOffsetValue ?? null,
      peggedPrice: safeNumber(responseFields.peggedPrice || orderTelemetry.peggedPrice || 0),
      selfTradePreventionMode: orderTelemetry.selfTradePreventionMode || null,
      preventedQuantity,
      preventedMatchCount: [...new Set([...(responseFields.preventedMatchIds || []), ...(orderTelemetry.preventedMatchIds || [])].filter((value) => value != null))].length,
      workingTimeMs: safeNumber(orderTelemetry.workingTimeMs, 0),
      amendmentCount,
      cancelReplaceCount,
      keepPriorityCount,
      strategyId: plan.strategyId || null,
      strategyType: plan.strategyType || null,
      notes: [
        `style:${plan.entryStyle}`,
        `maker_ratio:${clamp(makerRatio, 0, 1).toFixed(2)}`,
        `touch_slippage_bps:${safeNumber(touchSlippageBps, 0).toFixed(2)}`,
        `impact_bps:${safeNumber(plan.expectedImpactBps, 0).toFixed(2)}`,
        `queue:${safeNumber(plan.queueImbalance, 0).toFixed(2)}`,
        `depth_conf:${safeNumber(plan.depthConfidence, 0).toFixed(2)}`,
        ...((orderTelemetry.notes || []).slice(0, 4))
      ]
    };
  }
}

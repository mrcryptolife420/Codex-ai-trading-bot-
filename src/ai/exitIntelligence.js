import { clamp } from "../utils/math.js";
import { minutesBetween } from "../utils/time.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function pushReason(list, condition, value) {
  if (condition) {
    list.push(value);
  }
}

export class ExitIntelligence {
  constructor(config) {
    this.config = config;
  }

  evaluate({
    position,
    marketSnapshot = {},
    newsSummary = {},
    announcementSummary = {},
    marketStructureSummary = {},
    calendarSummary = {},
    timeframeSummary = {},
    marketSentimentSummary = {},
    onChainLiteSummary = {},
    regimeSummary = {},
    strategySummary = {},
    marketConditionSummary = {},
    exitNeuralSummary = {},
    runtime = {},
    journal = {},
    nowIso = new Date().toISOString()
  }) {
    const book = marketSnapshot.book || {};
    const market = marketSnapshot.market || {};
    const currentPrice = safeNumber(book.mid, position.lastMarkedPrice || position.entryPrice);
    const currentValue = currentPrice * safeNumber(position.quantity);
    const totalCost = safeNumber(position.totalCost || position.notional || currentValue, currentValue);
    const pnlPct = totalCost ? (currentValue - totalCost) / totalCost : 0;
    const highestPrice = Math.max(safeNumber(position.highestPrice, position.entryPrice), safeNumber(position.entryPrice, currentPrice));
    const drawdownFromHighPct = highestPrice ? (currentPrice - highestPrice) / highestPrice : 0;
    const heldMinutes = minutesBetween(position.entryAt, nowIso);
    const progressToScaleOut = clamp(
      pnlPct / Math.max(position.scaleOutTrailOffsetPct || this.config.scaleOutTriggerPct || 0.01, 0.004),
      -1,
      2.2
    );
    const timePressure = clamp(heldMinutes / Math.max(this.config.maxHoldMinutes || 1, 1), 0, 1.5);
    const spreadPressure = clamp(safeNumber(book.spreadBps) / Math.max(this.config.exitOnSpreadShockBps || 1, 1), 0, 1.5);
    const bookPressure = safeNumber(book.bookPressure);
    const signalScore = safeNumber(marketStructureSummary.signalScore);
    const riskScore = safeNumber(marketStructureSummary.riskScore);
    const higherBias = safeNumber(timeframeSummary.higherBias);
    const alignmentScore = safeNumber(timeframeSummary.alignmentScore, 0.5);
    const onChainLiquidity = safeNumber(onChainLiteSummary.liquidityScore);
    const onChainStress = safeNumber(onChainLiteSummary.stressScore);
    const conditionId = marketConditionSummary.conditionId || position.marketConditionAtEntry || "unknown_condition";
    const conditionRisk = safeNumber(marketConditionSummary.conditionRisk ?? marketConditionSummary.risk, 0);
    const conditionConfidence = safeNumber(marketConditionSummary.conditionConfidence ?? marketConditionSummary.confidence, 0);
    const conditionTransitionState = marketConditionSummary.conditionTransitionState || marketConditionSummary.transitionState || "stable";
    const strategyFamily = strategySummary.family || position.strategyFamily || position.strategyDecision?.family || position.entryRationale?.strategy?.family || "unknown_family";
    const entrySlipDelta = safeNumber(position.entryExecutionAttribution?.slippageDeltaBps);
    const executionRegretScore = clamp(Math.max(0, entrySlipDelta) / 8 + Math.max(0, -bookPressure) * 0.18, 0, 1);
    const winnerState = pnlPct >= 0.02
      ? "strong_winner"
      : pnlPct >= 0.006
        ? drawdownFromHighPct <= -0.008
          ? "stalled_winner"
          : "thin_winner"
        : pnlPct < 0 && drawdownFromHighPct > -0.004
          ? "loser_rebound"
          : "neutral";
    const continuationFriendly = ["trend_continuation", "breakout_release"].includes(conditionId);
    const failureProne = ["trend_exhaustion", "failed_breakout", "high_vol_event", "low_liquidity_caution"].includes(conditionId);
    const maxHoldMinutes = Math.max(this.config.maxHoldMinutes || 1, 1);
    const earlyHoldWindowMinutes = Math.max(
      15,
      maxHoldMinutes * (
        continuationFriendly
          ? (winnerState === "strong_winner" ? 0.42 : 0.34)
          : failureProne
            ? 0.16
            : 0.18
      )
    );
    const lateHoldWindowMinutes = Math.max(
      45,
      maxHoldMinutes * (
        continuationFriendly
          ? (winnerState === "strong_winner" ? 0.84 : 0.78)
          : failureProne
            ? 0.62
            : 0.72
      )
    );
    const holdingPhase = heldMinutes <= earlyHoldWindowMinutes
      ? "early"
      : heldMinutes >= lateHoldWindowMinutes
        ? "late"
        : "mature";
    const preferredExitStyle = continuationFriendly
      ? "trail"
      : failureProne
        ? "trim"
        : conditionId === "range_acceptance"
          ? "balanced"
          : "balanced";
    const trailTightnessBias = clamp(
      (continuationFriendly ? -0.08 : 0) +
      (failureProne ? 0.1 : 0) +
      (holdingPhase === "late" ? 0.04 : 0) +
      (winnerState === "strong_winner" ? -0.03 : winnerState === "stalled_winner" ? 0.06 : 0),
      -0.18,
      0.18
    );
    const trimBias = clamp(
      (failureProne ? 0.1 : 0) +
      (conditionId === "range_break_risk" ? 0.05 : 0) +
      (holdingPhase === "late" ? 0.04 : 0) +
      (winnerState === "stalled_winner" ? 0.06 : winnerState === "loser_rebound" ? 0.05 : 0),
      -0.18,
      0.18
    );
    const holdTolerance = clamp(
      (continuationFriendly ? 0.09 : 0) +
      (conditionConfidence >= 0.68 ? 0.04 : 0) +
      (failureProne ? -0.08 : 0) +
      (holdingPhase === "early" ? 0.03 : holdingPhase === "late" ? -0.05 : 0),
      -0.18,
      0.18
    );
    const maxHoldBias = clamp(
      (continuationFriendly ? 0.08 : 0) +
      (conditionTransitionState === "building" ? -0.03 : 0) +
      (failureProne ? -0.08 : 0) +
      (winnerState === "strong_winner" ? 0.04 : winnerState === "stalled_winner" ? -0.04 : 0),
      -0.18,
      0.18
    );

    const holdTailwind =
      Math.max(0, pnlPct) * 3.2 +
      Math.max(0, bookPressure) * 0.42 +
      Math.max(0, safeNumber(market.bullishPatternScore)) * 0.16 +
      Math.max(0, signalScore) * 0.26 +
      Math.max(0, safeNumber(newsSummary.sentimentScore)) * 0.12 +
      Math.max(0, safeNumber(marketSentimentSummary.contrarianScore)) * 0.08 +
      Math.max(0, higherBias) * 0.16 +
      onChainLiquidity * 0.12 +
      alignmentScore * 0.08 +
      Math.max(0, holdTolerance) * 0.4 +
      Math.max(0, 0.72 - conditionRisk) * 0.08;

    const exitPressure =
      Math.max(0, -bookPressure) * 0.58 +
      Math.max(0, safeNumber(market.bearishPatternScore)) * 0.2 +
      Math.max(0, safeNumber(newsSummary.riskScore) - 0.42) * 0.34 +
      Math.max(0, safeNumber(announcementSummary.riskScore) - 0.3) * 0.26 +
      Math.max(0, safeNumber(calendarSummary.riskScore) - 0.3) * 0.22 +
      Math.max(0, riskScore - 0.42) * 0.32 +
      Math.max(0, -signalScore) * 0.16 +
      Math.max(0, -drawdownFromHighPct * 22) * 0.24 +
      Math.max(0, spreadPressure - 0.7) * 0.18 +
      Math.max(0, timePressure - 0.75) * 0.12 +
      Math.max(0, onChainStress - 0.35) * 0.18 +
      Math.max(0, 0.45 - alignmentScore) * 0.14 +
      executionRegretScore * 0.14 +
      conditionRisk * 0.14 +
      Math.max(0, trailTightnessBias) * 0.2;

    const trimPressure =
      Math.max(0, progressToScaleOut - 0.8) * 0.28 +
      Math.max(0, -drawdownFromHighPct * 18) * 0.2 +
      Math.max(0, riskScore - 0.35) * 0.18 +
      Math.max(0, safeNumber(newsSummary.riskScore) - 0.34) * 0.12 +
      Math.max(0, safeNumber(calendarSummary.riskScore) - 0.32) * 0.12 +
      Math.max(0, safeNumber(announcementSummary.riskScore) - 0.22) * 0.1 +
      Math.max(0, onChainStress - 0.28) * 0.12 +
      Math.max(0, trimBias) * 0.22;

    const trailPressure =
      Math.max(0, pnlPct) * 1.7 +
      Math.max(0, -drawdownFromHighPct * 24) * 0.22 +
      Math.max(0, riskScore - 0.3) * 0.16 +
      Math.max(0, spreadPressure - 0.55) * 0.1 +
      Math.max(0, safeNumber(book.queueImbalance) < 0 ? Math.abs(safeNumber(book.queueImbalance)) : 0) * 0.08 +
      Math.max(0, executionRegretScore - 0.16) * 0.08 +
      Math.max(0, trailTightnessBias) * 0.24;

    const neuralBlend = clamp(safeNumber(exitNeuralSummary.confidence) * 0.28, 0, 0.28);
    const holdScore = clamp((0.44 + holdTailwind - exitPressure * 0.24) * (1 - neuralBlend) + safeNumber(exitNeuralSummary.holdScore, 0.25) * neuralBlend, 0, 1);
    const trimScore = clamp((0.18 + trimPressure + Math.max(0, pnlPct) * 1.9 - holdTailwind * 0.08) * (1 - neuralBlend) + safeNumber(exitNeuralSummary.trimScore, 0.25) * neuralBlend, 0, 1);
    const trailScore = clamp((0.22 + trailPressure - holdTailwind * 0.05) * (1 - neuralBlend) + safeNumber(exitNeuralSummary.trailScore, 0.25) * neuralBlend, 0, 1);
    const exitScore = clamp(
      (0.26 + exitPressure - holdTailwind * 0.16 + (pnlPct < 0 ? Math.min(Math.abs(pnlPct) * 5.2, 0.18) : 0)) * (1 - neuralBlend) + safeNumber(exitNeuralSummary.exitScore, 0.25) * neuralBlend,
      0,
      1
    );
    const confidence = clamp(
      0.26 +
        (safeNumber(book.depthConfidence) ? 0.12 : 0) +
        (safeNumber(newsSummary.coverage) ? 0.08 : 0) +
        (safeNumber(calendarSummary.coverage) ? 0.06 : 0) +
        (safeNumber(marketStructureSummary.confidence) || safeNumber(marketStructureSummary.liquidationCount) ? 0.14 : 0) +
        Math.min(0.16, Math.abs(pnlPct) * 3) +
        Math.min(0.12, heldMinutes / 480) +
        Math.min(0.1, Math.abs(higherBias) * 0.2) +
        Math.min(0.12, safeNumber(exitNeuralSummary.confidence) * 0.14),
      0.24,
      0.96
    );

    const positiveReasons = [];
    pushReason(positiveReasons, pnlPct > 0.008, "winner_still_working");
    pushReason(positiveReasons, bookPressure > 0.12, "supportive_orderbook");
    pushReason(positiveReasons, signalScore > 0.12, "derivatives_still_supportive");
    pushReason(positiveReasons, safeNumber(newsSummary.sentimentScore) > 0.1, "news_tailwind_alive");
    pushReason(positiveReasons, safeNumber(marketSentimentSummary.contrarianScore) > 0.08, "market_sentiment_support");
    pushReason(positiveReasons, safeNumber(market.bullishPatternScore) > 0.2, "bullish_pattern_context");
    pushReason(positiveReasons, higherBias > 0.16, "higher_timeframe_support");
    pushReason(positiveReasons, onChainLiquidity > 0.58, "stablecoin_liquidity_support");
    pushReason(positiveReasons, safeNumber(exitNeuralSummary.holdScore) > 0.36, "exit_neural_hold_bias");
    pushReason(positiveReasons, continuationFriendly && conditionConfidence >= 0.58, "condition_continuation_support");

    const riskReasons = [];
    pushReason(riskReasons, spreadPressure > 1, "spread_shock_risk");
    pushReason(riskReasons, bookPressure < -0.22, "orderbook_reversal_pressure");
    pushReason(riskReasons, safeNumber(market.bearishPatternScore) > 0.32, "bearish_pattern_stack");
    pushReason(riskReasons, safeNumber(newsSummary.riskScore) > 0.62, "news_risk_spike");
    pushReason(riskReasons, safeNumber(announcementSummary.riskScore) > 0.52, "exchange_notice_risk");
    pushReason(riskReasons, safeNumber(calendarSummary.riskScore) > 0.58, "calendar_event_risk");
    pushReason(riskReasons, riskScore > 0.62, "derivatives_crowding_risk");
    pushReason(riskReasons, safeNumber(marketStructureSummary.liquidationImbalance) < -0.45, "liquidation_sell_wave");
    pushReason(riskReasons, drawdownFromHighPct < -0.012 && pnlPct > 0, "winner_giving_back");
    pushReason(riskReasons, heldMinutes >= this.config.maxHoldMinutes * 0.85, "time_decay_pressure");
    pushReason(riskReasons, alignmentScore < this.config.crossTimeframeMinAlignmentScore, "timeframe_misalignment");
    pushReason(riskReasons, onChainStress > 0.58, "stablecoin_stress_risk");
    pushReason(riskReasons, executionRegretScore > 0.36, "execution_regret_risk");
    pushReason(riskReasons, safeNumber(exitNeuralSummary.exitScore) > 0.42, "exit_neural_exit_bias");
    pushReason(riskReasons, failureProne && conditionRisk >= 0.52, "condition_failure_risk");

    let action = "hold";
    if (exitScore >= this.config.exitIntelligenceExitScore && confidence >= this.config.exitIntelligenceMinConfidence) {
      action = "exit";
    } else if (trimScore >= this.config.exitIntelligenceTrimScore && confidence >= this.config.exitIntelligenceMinConfidence) {
      action = "trim";
    } else if (trailScore >= this.config.exitIntelligenceTrailScore && pnlPct > 0 && confidence >= this.config.exitIntelligenceMinConfidence - 0.04) {
      action = "trail";
    }

    const suggestedStopLossPrice = action === "trail"
      ? Math.max(
          safeNumber(position.stopLossPrice),
          safeNumber(position.entryPrice) * (1 + Math.max(0.0015, pnlPct * 0.35)),
          safeNumber(position.highestPrice) * (1 - Math.max(0.0025, this.config.scaleOutTrailOffsetPct * 1.2))
        )
      : safeNumber(position.stopLossPrice);
    const trimFraction = clamp(0.22 + Math.max(0, trimScore - this.config.exitIntelligenceTrimScore) * 0.6 + Math.max(0, pnlPct) * 1.5, 0.2, 0.55);
    const urgency = clamp(0.18 + exitScore * 0.42 + trimScore * 0.18 + trailScore * 0.12, 0, 1);

    const reason =
      action === "exit"
        ? riskReasons[0] || "exit_ai_signal"
        : action === "trim"
          ? riskReasons[0] || "trim_ai_signal"
          : action === "trail"
            ? riskReasons[0] || "protect_winner"
            : positiveReasons[0] || null;

    return {
      action,
      reason,
      confidence: num(confidence),
      strategyFamily,
      conditionId,
      conditionConfidence: num(conditionConfidence),
      conditionRisk: num(conditionRisk),
      conditionTransitionState,
      holdingPhase,
      earlyHoldWindowMinutes: num(earlyHoldWindowMinutes, 1),
      lateHoldWindowMinutes: num(lateHoldWindowMinutes, 1),
      winnerState,
      preferredExitStyle,
      trailTightnessBias: num(trailTightnessBias),
      trimBias: num(trimBias),
      holdTolerance: num(holdTolerance),
      maxHoldBias: num(maxHoldBias),
      holdScore: num(holdScore),
      trimScore: num(trimScore),
      trailScore: num(trailScore),
      tightenScore: num(trailScore),
      exitScore: num(exitScore),
      pnlPct: num(pnlPct),
      drawdownFromHighPct: num(drawdownFromHighPct),
      heldMinutes: num(heldMinutes, 1),
      progressToScaleOut: num(progressToScaleOut),
      trimFraction: num(trimFraction),
      urgency: num(urgency),
      suggestedStopLossPrice: num(suggestedStopLossPrice, 6),
      shouldTightenStop: action === "trail" && suggestedStopLossPrice > safeNumber(position.stopLossPrice),
      positiveReasons,
      riskReasons,
      nextReviewBias: action === "hold" ? "let_winner_breathe" : action === "trim" ? "de_risk_and_reassess" : action === "trail" ? "trail_and_review" : "close_and_reset",
      runtimeMode: runtime.selfHeal?.mode || "normal",
      realizedTradeCount: Array.isArray(journal?.trades) ? journal.trades.length : 0,
      executionRegretScore: num(executionRegretScore),
      sources: [
        "market_condition",
        "holding_phase",
        "winner_state",
        "exit_neural"
      ],
      neural: {
        confidence: num(safeNumber(exitNeuralSummary.confidence)),
        dominantAction: exitNeuralSummary.dominantAction || null,
        holdScore: num(safeNumber(exitNeuralSummary.holdScore)),
        trimScore: num(safeNumber(exitNeuralSummary.trimScore)),
        trailScore: num(safeNumber(exitNeuralSummary.trailScore)),
        exitScore: num(safeNumber(exitNeuralSummary.exitScore)),
        inputs: { ...(exitNeuralSummary.inputs || {}) },
        drivers: [...(exitNeuralSummary.drivers || [])]
      },
      regime: regimeSummary.regime || position.regimeAtEntry || "range",
      timeframeAlignment: num(alignmentScore),
      onChainStress: num(onChainStress)
    };
  }
}

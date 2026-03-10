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

    const holdTailwind =
      Math.max(0, pnlPct) * 3.2 +
      Math.max(0, bookPressure) * 0.42 +
      Math.max(0, safeNumber(market.bullishPatternScore)) * 0.16 +
      Math.max(0, signalScore) * 0.26 +
      Math.max(0, safeNumber(newsSummary.sentimentScore)) * 0.12;

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
      Math.max(0, timePressure - 0.75) * 0.12;

    const trimPressure =
      Math.max(0, progressToScaleOut - 0.8) * 0.28 +
      Math.max(0, -drawdownFromHighPct * 18) * 0.2 +
      Math.max(0, riskScore - 0.35) * 0.18 +
      Math.max(0, safeNumber(newsSummary.riskScore) - 0.34) * 0.12 +
      Math.max(0, safeNumber(calendarSummary.riskScore) - 0.32) * 0.12 +
      Math.max(0, safeNumber(announcementSummary.riskScore) - 0.22) * 0.1;

    const trailPressure =
      Math.max(0, pnlPct) * 1.7 +
      Math.max(0, -drawdownFromHighPct * 24) * 0.22 +
      Math.max(0, riskScore - 0.3) * 0.16 +
      Math.max(0, spreadPressure - 0.55) * 0.1 +
      Math.max(0, safeNumber(book.queueImbalance) < 0 ? Math.abs(safeNumber(book.queueImbalance)) : 0) * 0.08;

    const holdScore = clamp(0.44 + holdTailwind - exitPressure * 0.24, 0, 1);
    const trimScore = clamp(0.18 + trimPressure + Math.max(0, pnlPct) * 1.9 - holdTailwind * 0.08, 0, 1);
    const trailScore = clamp(0.22 + trailPressure - holdTailwind * 0.05, 0, 1);
    const exitScore = clamp(
      0.26 + exitPressure - holdTailwind * 0.16 + (pnlPct < 0 ? Math.min(Math.abs(pnlPct) * 5.2, 0.18) : 0),
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
        Math.min(0.12, heldMinutes / 480),
      0.24,
      0.96
    );

    const positiveReasons = [];
    pushReason(positiveReasons, pnlPct > 0.008, "winner_still_working");
    pushReason(positiveReasons, bookPressure > 0.12, "supportive_orderbook");
    pushReason(positiveReasons, signalScore > 0.12, "derivatives_still_supportive");
    pushReason(positiveReasons, safeNumber(newsSummary.sentimentScore) > 0.1, "news_tailwind_alive");
    pushReason(positiveReasons, safeNumber(market.bullishPatternScore) > 0.2, "bullish_pattern_context");

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
      realizedTradeCount: Array.isArray(journal?.trades) ? journal.trades.length : 0
    };
  }
}

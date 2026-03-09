import { clamp } from "../utils/math.js";
import { sameUtcDay } from "../utils/time.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function avg(values = []) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function recentTrades(journal, predicate) {
  return [...(journal?.trades || [])]
    .filter((trade) => trade.exitAt && predicate(trade))
    .slice(-30);
}

function sameDayTrades(journal, nowIso) {
  return [...(journal?.trades || [])].filter((trade) => {
    const reference = trade.exitAt || trade.entryAt;
    return reference ? sameUtcDay(reference, nowIso) : false;
  });
}

export class MetaDecisionGate {
  constructor(config) {
    this.config = config;
  }

  evaluate({
    symbol,
    score,
    marketSnapshot,
    newsSummary = {},
    announcementSummary = {},
    marketStructureSummary = {},
    marketSentimentSummary = {},
    volatilitySummary = {},
    calendarSummary = {},
    committeeSummary = {},
    strategySummary = {},
    sessionSummary = {},
    driftSummary = {},
    selfHealState = {},
    portfolioSummary = {},
    journal,
    nowIso
  }) {
    const symbolTrades = recentTrades(journal, (trade) => trade.symbol === symbol);
    const strategyTrades = recentTrades(journal, (trade) => {
      const strategyId = trade.strategyAtEntry || trade.strategyDecision?.activeStrategy || trade.entryRationale?.strategy?.activeStrategy;
      return strategyId && strategyId === strategySummary.activeStrategy;
    });
    const todayTrades = sameDayTrades(journal, nowIso);
    const todayLoss = todayTrades.reduce((total, trade) => total + Math.min(0, trade.pnlQuote || 0), 0);
    const dailyLossFraction = Math.abs(Math.min(0, todayLoss)) / Math.max(this.config.startingCash || 1, 1);
    const todayTradeCount = todayTrades.length;
    const liveTrades = (journal?.trades || []).filter((trade) => trade.exitAt && trade.brokerMode === "live");
    const canaryActive = this.config.botMode === "live" && this.config.enableCanaryLiveMode && liveTrades.length < this.config.canaryLiveTradeCount;

    const historicalEdge =
      avg(symbolTrades.map((trade) => safeNumber(trade.netPnlPct, 0))) * 8 +
      avg(strategyTrades.map((trade) => safeNumber(trade.netPnlPct, 0))) * 10;
    const historyConfidence = clamp(
      Math.log1p(symbolTrades.length + strategyTrades.length) / Math.log(18),
      0,
      1
    );
    const positiveScore =
      (score.probability - this.config.modelThreshold) * 1.2 +
      safeNumber(committeeSummary.netScore, 0) * 0.38 +
      safeNumber(committeeSummary.agreement, 0) * 0.24 +
      safeNumber(strategySummary.fitScore, 0) * 0.3 +
      safeNumber(newsSummary.reliabilityScore, 0) * 0.12 +
      Math.max(0, safeNumber(marketSnapshot?.book?.bookPressure, 0)) * 0.14 +
      Math.max(0, safeNumber(marketStructureSummary.signalScore, 0)) * 0.18 +
      Math.max(0, safeNumber(marketSentimentSummary.contrarianScore, 0)) * 0.1 +
      Math.max(0, historicalEdge);
    const negativeScore =
      Math.max(0, safeNumber(newsSummary.riskScore, 0) - 0.45) * 0.34 +
      Math.max(0, safeNumber(announcementSummary.riskScore, 0) - 0.35) * 0.28 +
      Math.max(0, safeNumber(calendarSummary.riskScore, 0) - 0.35) * 0.24 +
      Math.max(0, safeNumber(volatilitySummary.riskScore, 0) - 0.42) * 0.22 +
      Math.max(0, safeNumber(driftSummary.severity, 0) - 0.2) * 0.34 +
      Math.max(0, safeNumber(sessionSummary.riskScore, 0) - 0.35) * 0.2 +
      Math.max(0, safeNumber(portfolioSummary.maxCorrelation, 0) - 0.55) * 0.2 +
      Math.max(0, safeNumber(marketStructureSummary.longSqueezeScore, 0) - 0.35) * 0.16 +
      Math.max(0, safeNumber(marketStructureSummary.crowdingBias, 0)) * 0.08;
    const metaScore = clamp(0.5 + positiveScore - negativeScore, 0, 1);
    const metaConfidence = clamp(
      0.24 +
        historyConfidence * 0.34 +
        (newsSummary.coverage ? 0.08 : 0) +
        (committeeSummary.agreement ? 0.12 : 0) +
        (strategySummary.activeStrategy ? 0.1 : 0) +
        (marketSnapshot?.book?.depthConfidence ? 0.08 : 0),
      0.18,
      0.96
    );

    const budgetPressure = clamp(todayTradeCount / Math.max(this.config.maxEntriesPerDay || 1, 1), 0, 1.4);
    const dailyBudgetFactor = clamp(
      1 - dailyLossFraction / Math.max(this.config.maxDailyDrawdown || 0.01, 0.01) * 0.65 - budgetPressure * 0.18,
      this.config.dailyRiskBudgetFloor,
      1
    );
    const canarySizeMultiplier = canaryActive ? this.config.canaryLiveSizeMultiplier : 1;
    const sizeMultiplier = clamp(
      (0.56 + metaScore * 0.58) *
        (0.82 + historyConfidence * 0.16) *
        dailyBudgetFactor *
        canarySizeMultiplier *
        (selfHealState.lowRiskOnly ? 0.9 : 1),
      0.16,
      1.12
    );

    const reasons = [];
    if (metaConfidence >= this.config.metaMinConfidence && metaScore < this.config.metaBlockScore) {
      reasons.push("meta_gate_reject");
    } else if (metaScore < this.config.metaCautionScore) {
      reasons.push("meta_gate_caution");
    }
    if (dailyBudgetFactor < 0.999) {
      reasons.push("daily_risk_budget_scaled");
    }
    if (canaryActive) {
      reasons.push("canary_live_sizing");
    }
    if (todayTradeCount >= this.config.maxEntriesPerDay) {
      reasons.push("daily_entry_budget_reached");
    }

    const action =
      reasons.includes("meta_gate_reject") || todayTradeCount >= this.config.maxEntriesPerDay
        ? "block"
        : reasons.includes("meta_gate_caution")
          ? "caution"
          : "pass";

    const thresholdPenalty =
      action === "block"
        ? 0.055
        : action === "caution"
          ? 0.018 + Math.max(0, 0.52 - metaScore) * 0.05
          : 0;

    return {
      action,
      score: Number(metaScore.toFixed(4)),
      confidence: Number(metaConfidence.toFixed(4)),
      thresholdPenalty: Number(thresholdPenalty.toFixed(4)),
      sizeMultiplier: Number(sizeMultiplier.toFixed(4)),
      dailyBudgetFactor: Number(dailyBudgetFactor.toFixed(4)),
      dailyLossFraction: Number(dailyLossFraction.toFixed(4)),
      dailyTradeCount: todayTradeCount,
      canaryActive,
      canaryTradesRemaining: canaryActive
        ? Math.max(0, this.config.canaryLiveTradeCount - liveTrades.length)
        : 0,
      canarySizeMultiplier: Number(canarySizeMultiplier.toFixed(4)),
      historyConfidence: Number(historyConfidence.toFixed(4)),
      notes: [
        `meta_score:${metaScore.toFixed(3)}`,
        `meta_conf:${metaConfidence.toFixed(3)}`,
        `daily_budget:${dailyBudgetFactor.toFixed(3)}`,
        `canary:${canaryActive}`,
        `symbol_hist:${symbolTrades.length}`,
        `strategy_hist:${strategyTrades.length}`
      ],
      reasons
    };
  }
}

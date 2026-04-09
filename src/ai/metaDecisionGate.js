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
    timeframeSummary = {},
    pairHealthSummary = {},
    onChainLiteSummary = {},
    divergenceSummary = {},
    metaNeuralSummary = {},
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
    const tradeQualityMinScore = safeNumber(this.config.tradeQualityMinScore, 0.47);
    const tradeQualityCautionScore = safeNumber(this.config.tradeQualityCautionScore, 0.58);

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
      Math.max(0, safeNumber(pairHealthSummary.score, 0.5) - 0.5) * 0.26 +
      Math.max(0, safeNumber(timeframeSummary.alignmentScore, 0.5) - 0.5) * 0.24 +
      Math.max(0, safeNumber(onChainLiteSummary.liquidityScore, 0) - 0.35) * 0.16 +
      Math.max(0, safeNumber(metaNeuralSummary.probability, 0.5) - 0.5) * 0.32 +
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
      Math.max(0, safeNumber(marketStructureSummary.crowdingBias, 0)) * 0.08 +
      Math.max(0, 0.48 - safeNumber(timeframeSummary.alignmentScore, 0.5)) * 0.22 +
      Math.max(0, 0.5 - safeNumber(pairHealthSummary.score, 0.5)) * 0.2 +
      Math.max(0, safeNumber(onChainLiteSummary.stressScore, 0) - 0.35) * 0.16 +
      Math.max(0, 0.5 - safeNumber(metaNeuralSummary.probability, 0.5)) * 0.34;
    const baseMetaScore = clamp(0.5 + positiveScore - negativeScore, 0, 1);
    const neuralBlend = clamp(safeNumber(metaNeuralSummary.confidence, 0) * 0.26, 0, 0.26);
    const metaScore = clamp(baseMetaScore * (1 - neuralBlend) + safeNumber(metaNeuralSummary.probability, baseMetaScore) * neuralBlend, 0, 1);
    const metaConfidence = clamp(
      0.24 +
        historyConfidence * 0.34 +
        (newsSummary.coverage ? 0.08 : 0) +
        (committeeSummary.agreement ? 0.12 : 0) +
        (strategySummary.activeStrategy ? 0.1 : 0) +
        (marketSnapshot?.book?.depthConfidence ? 0.08 : 0) +
        (timeframeSummary.enabled ? 0.06 : 0) +
        Math.min(0.12, safeNumber(metaNeuralSummary.confidence, 0) * 0.14),
      0.18,
      0.96
    );

    const expectedSlip = safeNumber(marketSnapshot?.book?.entryEstimate?.touchSlippageBps || 0);
    const spreadBps = safeNumber(marketSnapshot?.book?.spreadBps || 0);
    const depthConfidence = safeNumber(marketSnapshot?.book?.depthConfidence || marketSnapshot?.book?.localBook?.depthConfidence || 0);
    const executionReadiness = clamp(0.42 + depthConfidence * 0.3 - expectedSlip / 12 - spreadBps / 120, 0, 1);
    const qualityScore = clamp(
      0.4 +
        (score.calibrationConfidence || 0) * 0.16 +
        (score.confidence || 0) * 0.12 +
        Math.max(0, safeNumber(strategySummary.fitScore, 0) - 0.45) * 0.34 +
        Math.max(0, safeNumber(committeeSummary.agreement, 0) - 0.3) * 0.18 +
        executionReadiness * 0.16 +
        historyConfidence * 0.08 +
        Math.max(0, safeNumber(timeframeSummary.alignmentScore, 0) - 0.4) * 0.12 +
        Math.max(0, safeNumber(pairHealthSummary.score, 0.5) - 0.45) * 0.1 +
        Math.max(0, safeNumber(metaNeuralSummary.probability, 0.5) - 0.5) * 0.18 +
        safeNumber(metaNeuralSummary.confidence, 0) * 0.08 -
        negativeScore * 0.22,
      0,
      1
    );
    const qualityBand = qualityScore >= 0.68 ? "prime" : qualityScore >= tradeQualityCautionScore ? "good" : qualityScore >= tradeQualityMinScore ? "watch" : "weak";
    const lowTimeframeAlignmentCaution =
      timeframeSummary.enabled &&
      safeNumber(timeframeSummary.alignmentScore, 1) < 0.42;

    const budgetPressure = clamp(todayTradeCount / Math.max(this.config.maxEntriesPerDay || 1, 1), 0, 1.4);
    const dailyBudgetFactor = clamp(
      1 - dailyLossFraction / Math.max(this.config.maxDailyDrawdown || 0.01, 0.01) * 0.65 - budgetPressure * 0.18,
      this.config.dailyRiskBudgetFloor,
      1
    );
    const canarySizeMultiplier = canaryActive ? this.config.canaryLiveSizeMultiplier : 1;
    const pairHealthMultiplier = clamp(0.82 + safeNumber(pairHealthSummary.score, 0.5) * 0.3, 0.65, 1.08);
    const timeframeMultiplier = clamp(0.78 + safeNumber(timeframeSummary.alignmentScore, 0.5) * 0.34, 0.7, 1.08);
    const divergencePenalty = (divergenceSummary?.leadBlocker?.status || "") === "blocked"
      ? 0.78
      : (divergenceSummary?.averageScore || 0) >= this.config.divergenceAlertScore
        ? 0.9
        : 1;
    const sizeMultiplier = clamp(
      (0.56 + metaScore * 0.58) *
        (0.82 + historyConfidence * 0.16) *
        (0.82 + qualityScore * 0.12) *
        dailyBudgetFactor *
        canarySizeMultiplier *
        pairHealthMultiplier *
        timeframeMultiplier *
        divergencePenalty *
        (selfHealState.lowRiskOnly ? 0.9 : 1),
      0.16,
      1.12
    );

    const reasons = [];
    if (metaConfidence >= this.config.metaMinConfidence && metaScore < this.config.metaBlockScore) {
      reasons.push("meta_gate_reject");
    } else if (metaScore < this.config.metaCautionScore || lowTimeframeAlignmentCaution) {
      reasons.push("meta_gate_caution");
    }
    if (safeNumber(metaNeuralSummary.confidence, 0) >= this.config.metaMinConfidence && safeNumber(metaNeuralSummary.probability, 0.5) < this.config.metaBlockScore) {
      reasons.push("meta_neural_reject");
    } else if (safeNumber(metaNeuralSummary.confidence, 0) >= this.config.metaMinConfidence - 0.06 && safeNumber(metaNeuralSummary.probability, 0.5) < this.config.metaCautionScore) {
      reasons.push("meta_neural_caution");
    }
    if (qualityScore < tradeQualityMinScore) {
      reasons.push("trade_quality_reject");
    } else if (qualityScore < tradeQualityCautionScore) {
      reasons.push("trade_quality_caution");
    }
    if ((pairHealthSummary.quarantined || false)) {
      reasons.push("pair_health_quarantine");
    }
    if ((timeframeSummary.blockerReasons || []).length) {
      reasons.push(...timeframeSummary.blockerReasons);
    }
    if ((divergenceSummary?.leadBlocker?.status || "") === "blocked") {
      reasons.push("live_paper_divergence_guard");
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
      reasons.includes("meta_gate_reject") || reasons.includes("meta_neural_reject") || reasons.includes("trade_quality_reject") || reasons.includes("pair_health_quarantine") || reasons.includes("live_paper_divergence_guard") || todayTradeCount >= this.config.maxEntriesPerDay
        ? "block"
        : reasons.includes("meta_gate_caution") || reasons.includes("meta_neural_caution") || reasons.includes("trade_quality_caution")
          ? "caution"
          : "pass";
    const hasDirectCautionGate = reasons.includes("meta_gate_caution") || reasons.includes("trade_quality_caution");
    const hasNeuralOnlyCaution = !hasDirectCautionGate && reasons.includes("meta_neural_caution");

    const thresholdPenalty =
      action === "block"
        ? 0.055 + Math.max(0, tradeQualityMinScore - qualityScore) * 0.03
        : action === "caution"
          ? (
            hasNeuralOnlyCaution
              ? safeNumber(this.config.metaNeuralCautionThresholdPenalty, 0.008)
              : 0.018 + Math.max(0, tradeQualityCautionScore - qualityScore) * 0.03
          )
          : 0;

    return {
      action,
      score: Number(metaScore.toFixed(4)),
      confidence: Number(metaConfidence.toFixed(4)),
      qualityScore: Number(qualityScore.toFixed(4)),
      qualityBand,
      qualityReasons: [
        `execution:${executionReadiness.toFixed(3)}`,
        `history:${historyConfidence.toFixed(3)}`,
        `spread:${spreadBps.toFixed(2)}`,
        `expected_slip:${expectedSlip.toFixed(2)}`,
        `pair:${safeNumber(pairHealthSummary.score, 0.5).toFixed(3)}`,
        `tf:${safeNumber(timeframeSummary.alignmentScore, 0.5).toFixed(3)}`
      ],
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
      pairHealthScore: Number(safeNumber(pairHealthSummary.score, 0.5).toFixed(4)),
      timeframeAlignment: Number(safeNumber(timeframeSummary.alignmentScore, 0.5).toFixed(4)),
      neuralProbability: Number(safeNumber(metaNeuralSummary.probability, 0.5).toFixed(4)),
      neuralConfidence: Number(safeNumber(metaNeuralSummary.confidence, 0).toFixed(4)),
      neuralDrivers: [...(metaNeuralSummary.contributions || [])].slice(0, 4),
      notes: [
        `meta_score:${metaScore.toFixed(3)}`,
        `meta_conf:${metaConfidence.toFixed(3)}`,
        `quality:${qualityScore.toFixed(3)}`,
        `daily_budget:${dailyBudgetFactor.toFixed(3)}`,
        `canary:${canaryActive}`,
        `symbol_hist:${symbolTrades.length}`,
        `strategy_hist:${strategyTrades.length}`,
        `pair_health:${safeNumber(pairHealthSummary.score, 0.5).toFixed(3)}`,
        `tf_align:${safeNumber(timeframeSummary.alignmentScore, 0.5).toFixed(3)}`
      ],
      reasons
    };
  }
}

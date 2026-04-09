import { clamp } from "../utils/math.js";

function safeValue(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function getAmbiguityThreshold({
  regime = "range",
  family = "",
  marketConditionId = ""
} = {}) {
  let threshold = 0.62;
  if (["range", "high_vol"].includes(regime)) {
    threshold -= 0.04;
  } else if (regime === "trend") {
    threshold += 0.03;
  }
  if (["breakout", "market_structure", "orderflow"].includes(family)) {
    threshold -= 0.02;
  } else if (family === "mean_reversion") {
    threshold += 0.03;
  }
  if (["failed_breakout", "range_break_risk", "trend_exhaustion"].includes(marketConditionId)) {
    threshold -= 0.02;
  }
  return clamp(threshold, 0.5, 0.75);
}

export function buildDecisionContextConfidence({
  signalQualitySummary = {},
  dataQualitySummary = {},
  confidenceBreakdown = {},
  marketConditionSummary = {},
  score = {}
} = {}) {
  const signalQuality = safeValue(signalQualitySummary.overallScore, 0);
  const dataQuality = safeValue(dataQualitySummary.overallScore, 0);
  const executionConfidence = safeValue(confidenceBreakdown.executionConfidence, 0);
  const modelConfidence = safeValue(score.calibrationConfidence ?? score.confidence, 0);
  const conditionConfidence = safeValue(marketConditionSummary.conditionConfidence, 0);
  const conditionRiskPenalty = safeValue(marketConditionSummary.conditionRisk, 0) * 0.14;
  return clamp(
    signalQuality * 0.26 +
    dataQuality * 0.22 +
    executionConfidence * 0.24 +
    modelConfidence * 0.18 +
    conditionConfidence * 0.1 -
    conditionRiskPenalty,
    0,
    1
  );
}

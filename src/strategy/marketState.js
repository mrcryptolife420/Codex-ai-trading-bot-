import { buildTrendStateSummary } from "./trendState.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

export function buildMarketStateSummary(input = {}) {
  const trendState = input.trendStateSummary || buildTrendStateSummary(input);
  return {
    direction: trendState.direction || "mixed",
    phase: trendState.phase || "mixed_transition",
    trendMaturity: safeNumber(trendState.maturityScore),
    trendExhaustion: safeNumber(trendState.exhaustionScore),
    rangeAcceptance: safeNumber(trendState.rangeAcceptanceScore, trendState.rangeScore),
    trendFailure: safeNumber(input.marketFeatures?.trendFailureScore),
    dataConfidence: safeNumber(trendState.dataConfidenceScore),
    featureCompleteness: safeNumber(trendState.completenessScore),
    uptrendScore: safeNumber(trendState.uptrendScore),
    downtrendScore: safeNumber(trendState.downtrendScore),
    rangeScore: safeNumber(trendState.rangeScore),
    reasons: arr(trendState.reasons).slice(0, 6),
    trendStateSummary: trendState
  };
}

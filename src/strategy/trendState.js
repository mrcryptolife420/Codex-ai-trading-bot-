import { clamp } from "../utils/math.js";

function safeValue(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function average(values = [], fallback = 0) {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((total, value) => total + value, 0) / filtered.length : fallback;
}

export function buildTrendStateSummary({
  marketFeatures = {},
  bookFeatures = {},
  newsSummary = {},
  announcementSummary = {},
  qualityQuorumSummary = {},
  venueConfirmationSummary = {},
  timeframeSummary = {}
} = {}) {
  const uptrendScore = clamp(
    Math.max(0, safeValue(marketFeatures.swingStructureScore)) * 0.24 +
      Math.max(0, safeValue(marketFeatures.momentum20)) * 22 * 0.18 +
      Math.max(0, safeValue(marketFeatures.emaGap)) * 38 * 0.16 +
      Math.max(0, safeValue(marketFeatures.dmiSpread)) * 2.8 * 0.12 +
      safeValue(marketFeatures.upsideAccelerationScore) * 0.08 +
      Math.max(0, safeValue(marketFeatures.trendMaturityScore)) * 0.14 +
      (safeValue(marketFeatures.supertrendDirection) > 0 ? 0.08 : 0),
    0,
    1
  );
  const downtrendScore = clamp(
    Math.max(0, -safeValue(marketFeatures.swingStructureScore)) * 0.24 +
      Math.max(0, -safeValue(marketFeatures.momentum20)) * 22 * 0.18 +
      Math.max(0, -safeValue(marketFeatures.emaGap)) * 38 * 0.16 +
      Math.max(0, -safeValue(marketFeatures.dmiSpread)) * 2.8 * 0.12 +
      safeValue(marketFeatures.downsideAccelerationScore) * 0.08 +
      Math.max(0, safeValue(marketFeatures.trendMaturityScore)) * 0.08 +
      (safeValue(marketFeatures.supertrendDirection) < 0 ? 0.12 : 0),
    0,
    1
  );
  const rangeScore = clamp(
    Math.max(0, 1 - Math.abs(safeValue(marketFeatures.swingStructureScore))) * 0.18 +
      Math.max(0, 1 - Math.min(1, Math.abs(safeValue(marketFeatures.emaGap)) * 95)) * 0.14 +
      Math.max(0, 1 - Math.min(1, Math.abs(safeValue(marketFeatures.dmiSpread)) * 3.4)) * 0.14 +
      Math.max(0, 1 - Math.min(1, Math.abs(safeValue(marketFeatures.vwapGapPct)) * 65)) * 0.12 +
      Math.max(0, 1 - safeValue(marketFeatures.trendMaturityScore)) * 0.14 +
      Math.max(0, 1 - Math.min(1, Math.abs((safeValue(marketFeatures.bollingerPosition, 0.5) || 0.5) - 0.5) * 2.4)) * 0.1 +
      Math.max(0, 1 - Math.min(1, Math.abs(safeValue(bookFeatures.bookPressure)) * 1.8)) * 0.1 +
      Math.max(0, 1 - Math.min(1, safeValue(marketFeatures.realizedVolPct) / 0.05)) * 0.08,
    0,
    1
  );

  const direction = uptrendScore >= 0.56 && uptrendScore > downtrendScore + 0.08
    ? "uptrend"
    : downtrendScore >= 0.56 && downtrendScore > uptrendScore + 0.08
      ? "downtrend"
      : rangeScore >= 0.54
        ? "sideways"
        : "mixed";
  const rangeAcceptanceScore = rangeScore;

  const completenessInputs = [
    marketFeatures.momentum20,
    marketFeatures.emaGap,
    marketFeatures.dmiSpread,
    marketFeatures.trendQualityScore,
    marketFeatures.trendPersistence,
    marketFeatures.swingStructureScore,
    marketFeatures.trendMaturityScore,
    marketFeatures.trendExhaustionScore,
    marketFeatures.realizedVolPct,
    bookFeatures.spreadBps,
    bookFeatures.bookPressure,
    bookFeatures.depthConfidence
  ];
  const completenessScore = clamp(
    completenessInputs.filter((value) => Number.isFinite(value)).length / completenessInputs.length,
    0,
    1
  );

  const quorumScore = safeValue(qualityQuorumSummary.quorumScore, qualityQuorumSummary.averageScore || 0.7);
  const venueHealth = venueConfirmationSummary.confirmed
    ? Math.max(0.72, safeValue(venueConfirmationSummary.averageHealthScore, 0.72))
    : (venueConfirmationSummary.status || "") === "blocked"
      ? 0.18
      : safeValue(venueConfirmationSummary.averageHealthScore, 0.5);
  const newsConfidence = clamp(
    safeValue(newsSummary.confidence, 0.45) * 0.42 +
      Math.min(1, safeValue(newsSummary.providerDiversity, 0) / 3) * 0.16 +
      Math.min(1, safeValue(newsSummary.freshnessScore, 0.4)) * 0.12 +
      Math.min(1, safeValue(announcementSummary.freshnessScore, 0.45)) * 0.1 +
      Math.min(1, safeValue(bookFeatures.depthConfidence, 0.5)) * 0.2,
    0,
    1
  );
  const timeframePenalty = (timeframeSummary.blockerReasons || []).length ? 0.35 : 0;
  const dataConfidenceScore = clamp(
    average([
      completenessScore,
      quorumScore,
      venueHealth,
      newsConfidence,
      clamp(1 - timeframePenalty, 0, 1)
    ], 0.6),
    0,
    1
  );

  const reasons = [];
  const phase = direction === "uptrend"
    ? safeValue(marketFeatures.trendMaturityScore) < 0.34
      ? "early_ignition"
      : safeValue(marketFeatures.trendExhaustionScore) > 0.68
        ? "late_crowded"
        : "healthy_continuation"
    : direction === "downtrend"
      ? safeValue(marketFeatures.trendExhaustionScore) > 0.66 && safeValue(marketFeatures.downsideAccelerationScore) > 0.46
        ? "capitulation_bounce_risk"
        : safeValue(marketFeatures.trendMaturityScore) < 0.34
          ? "early_breakdown"
          : "healthy_downtrend"
      : direction === "sideways"
        ? "range_acceptance"
        : "mixed_transition";
  if (direction === "uptrend") reasons.push("uptrend_structure");
  else if (direction === "downtrend") reasons.push("downtrend_structure");
  else if (direction === "sideways") reasons.push("range_acceptance");
  else reasons.push("mixed_regime");
  if (safeValue(marketFeatures.trendMaturityScore) > 0.62) reasons.push("trend_mature");
  if (safeValue(marketFeatures.trendExhaustionScore) > 0.68) reasons.push("trend_exhausted");
  if (dataConfidenceScore < 0.55) reasons.push("data_confidence_soft");

  return {
    direction,
    uptrendScore,
    downtrendScore,
    rangeScore,
    rangeAcceptanceScore,
    phase,
    maturityScore: clamp(safeValue(marketFeatures.trendMaturityScore), 0, 1),
    exhaustionScore: clamp(safeValue(marketFeatures.trendExhaustionScore), 0, 1),
    completenessScore,
    dataConfidenceScore,
    newsConfidenceScore: newsConfidence,
    reasons
  };
}

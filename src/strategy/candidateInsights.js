import { clamp } from "../utils/math.js";

function safeValue(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function average(values = [], fallback = 0) {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((total, value) => total + value, 0) / filtered.length : fallback;
}

function buildSourceState({
  label,
  coverage = 0,
  freshnessScore = null,
  trustScore = null,
  fallbackSource = null
}) {
  const normalizedCoverage = Math.max(0, safeValue(coverage));
  const normalizedFreshness = clamp(safeValue(freshnessScore, normalizedCoverage > 0 ? 0.5 : 0), 0, 1);
  const normalizedTrust = clamp(safeValue(trustScore, normalizedCoverage > 0 ? 0.5 : 0), 0, 1);
  const status = normalizedCoverage === 0
    ? "missing"
    : normalizedTrust < 0.4 || normalizedFreshness < 0.35
      ? "degraded"
      : "ready";
  return {
    label,
    coverage: normalizedCoverage,
    freshnessScore: normalizedFreshness,
    trustScore: normalizedTrust,
    fallbackSource: fallbackSource || null,
    status
  };
}

export function buildDataQualitySummary({
  newsSummary = {},
  announcementSummary = {},
  marketStructureSummary = {},
  marketSentimentSummary = {},
  volatilitySummary = {},
  onChainLiteSummary = {},
  qualityQuorumSummary = {},
  venueConfirmationSummary = {},
  bookFeatures = {}
} = {}) {
  const sources = [
    buildSourceState({
      label: "news",
      coverage: newsSummary.coverage,
      freshnessScore: newsSummary.freshnessScore,
      trustScore: average([newsSummary.reliabilityScore, newsSummary.confidence], 0.5),
      fallbackSource: (newsSummary.coverage || 0) === 0 ? "model_only" : null
    }),
    buildSourceState({
      label: "announcements",
      coverage: announcementSummary.coverage,
      freshnessScore: announcementSummary.freshnessScore,
      trustScore: average([announcementSummary.confidence, 1 - safeValue(announcementSummary.riskScore)], 0.5),
      fallbackSource: (announcementSummary.coverage || 0) === 0 ? "none" : null
    }),
    buildSourceState({
      label: "market_structure",
      coverage: marketStructureSummary.coverage || ((marketStructureSummary.fundingRate != null || marketStructureSummary.signalScore != null) ? 1 : 0),
      freshnessScore: 0.8,
      trustScore: average([1 - safeValue(marketStructureSummary.riskScore), 0.6 + Math.abs(safeValue(marketStructureSummary.signalScore)) * 0.2], 0.7),
      fallbackSource: "spot_only"
    }),
    buildSourceState({
      label: "volatility",
      coverage: volatilitySummary.coverage,
      freshnessScore: 0.76,
      trustScore: volatilitySummary.confidence,
      fallbackSource: "realized_vol"
    }),
    buildSourceState({
      label: "market_sentiment",
      coverage: marketSentimentSummary.coverage,
      freshnessScore: 0.74,
      trustScore: marketSentimentSummary.confidence,
      fallbackSource: "none"
    }),
    buildSourceState({
      label: "onchain",
      coverage: onChainLiteSummary.coverage,
      freshnessScore: 0.68,
      trustScore: onChainLiteSummary.confidence,
      fallbackSource: "market_breadth"
    }),
    buildSourceState({
      label: "reference_venues",
      coverage: venueConfirmationSummary.venueCount,
      freshnessScore: venueConfirmationSummary.confirmed ? 0.9 : (venueConfirmationSummary.status || "") === "blocked" ? 0.25 : 0.45,
      trustScore: venueConfirmationSummary.averageHealthScore,
      fallbackSource: "local_book"
    }),
    buildSourceState({
      label: "local_book",
      coverage: bookFeatures.totalDepthNotional > 0 ? 1 : 0,
      freshnessScore: bookFeatures.freshnessScore,
      trustScore: bookFeatures.depthConfidence,
      fallbackSource: "rest_book"
    })
  ];

  const readyCount = sources.filter((item) => item.status === "ready").length;
  const degradedCount = sources.filter((item) => item.status === "degraded").length;
  const missingCount = sources.filter((item) => item.status === "missing").length;
  const coverageScore = clamp(readyCount / Math.max(sources.length, 1) + degradedCount / Math.max(sources.length, 1) * 0.45, 0, 1);
  const trustScore = clamp(average(sources.map((item) => item.trustScore), 0.55), 0, 1);
  const freshnessScore = clamp(average(sources.map((item) => item.freshnessScore), 0.55), 0, 1);
  const overallScore = clamp(
    average([
      coverageScore,
      trustScore,
      freshnessScore,
      safeValue(qualityQuorumSummary.quorumScore, qualityQuorumSummary.averageScore || 0.7)
    ], 0.6),
    0,
    1
  );

  return {
    status: qualityQuorumSummary.observeOnly
      ? "observe_only"
      : qualityQuorumSummary.status === "degraded" || degradedCount >= 2
        ? "degraded"
        : missingCount >= 4
          ? "partial"
          : "ready",
    coverageScore,
    trustScore,
    freshnessScore,
    overallScore,
    degradedCount,
    missingCount,
    degradedButAllowed: !qualityQuorumSummary.observeOnly && (qualityQuorumSummary.status === "degraded" || degradedCount > 0),
    sources
  };
}

export function buildSignalQualitySummary({
  marketFeatures = {},
  bookFeatures = {},
  strategySummary = {},
  trendStateSummary = {},
  qualityQuorumSummary = {},
  venueConfirmationSummary = {},
  newsSummary = {}
} = {}) {
  const setupFit = clamp(safeValue(strategySummary.fitScore, strategySummary.rawFitScore || 0), 0, 1);
  const structureQuality = clamp(
    average([
      Math.max(safeValue(trendStateSummary.uptrendScore), safeValue(trendStateSummary.downtrendScore), safeValue(trendStateSummary.rangeScore)),
      safeValue(marketFeatures.trendQualityScore, 0.5),
      1 - safeValue(marketFeatures.trendExhaustionScore, 0),
      safeValue(marketFeatures.bosStrengthScore, 0.45),
      safeValue(marketFeatures.fvgRespectScore, 0.45),
      safeValue(marketFeatures.cvdConfirmationScore, 0.45) - safeValue(marketFeatures.cvdDivergenceScore, 0) * 0.35
    ], 0.5),
    0,
    1
  );
  const replenishmentQuality = clamp(
    average([
      Number.isFinite(bookFeatures.replenishmentScore) ? (bookFeatures.replenishmentScore + 1) / 2 : null,
      Number.isFinite(bookFeatures.queueRefreshScore) ? (bookFeatures.queueRefreshScore + 1) / 2 : null,
      Number.isFinite(bookFeatures.resilienceScore) ? (bookFeatures.resilienceScore + 1) / 2 : null
    ].filter((value) => Number.isFinite(value)), 0.5),
    0,
    1
  );
  const executionViability = clamp(
    average([
      1 - Math.min(1, safeValue(bookFeatures.spreadBps) / 25),
      safeValue(bookFeatures.depthConfidence, 0.4),
      replenishmentQuality,
      venueConfirmationSummary.confirmed ? 0.92 : (venueConfirmationSummary.status || "") === "blocked" ? 0.18 : 0.55
    ], 0.45),
    0,
    1
  );
  const newsCleanliness = clamp(
    average([
      1 - safeValue(newsSummary.riskScore, 0),
      safeValue(newsSummary.reliabilityScore, newsSummary.confidence || 0.5),
      1 - safeValue(newsSummary.socialRisk, 0)
    ], 0.55),
    0,
    1
  );
  const quorumQuality = clamp(
    safeValue(qualityQuorumSummary.quorumScore, qualityQuorumSummary.averageScore || 0.7) - (qualityQuorumSummary.observeOnly ? 0.3 : 0),
    0,
    1
  );
  const overallScore = clamp(average([setupFit, structureQuality, executionViability, newsCleanliness, quorumQuality], 0.5), 0, 1);
  return {
    setupFit,
    structureQuality,
    executionViability,
    newsCleanliness,
    quorumQuality,
    overallScore,
    structureContext: {
      bos: safeValue(marketFeatures.bullishBosActive) > 0
        ? "bullish"
        : safeValue(marketFeatures.bearishBosActive) > 0
          ? "bearish"
          : "none",
      bosStrengthScore: clamp(safeValue(marketFeatures.bosStrengthScore), 0, 1),
      fvg: safeValue(marketFeatures.bullishFvgActive) > 0
        ? "bullish"
        : safeValue(marketFeatures.bearishFvgActive) > 0
          ? "bearish"
          : "none",
      fvgRespectScore: clamp(safeValue(marketFeatures.fvgRespectScore), 0, 1),
      fvgFillProgress: clamp(safeValue(marketFeatures.fvgFillProgress, 1), 0, 1)
    },
    cvdContext: {
      confirmationScore: clamp(safeValue(marketFeatures.cvdConfirmationScore), 0, 1),
      divergenceScore: clamp(safeValue(marketFeatures.cvdDivergenceScore), 0, 1),
      trendAlignment: clamp(safeValue(marketFeatures.cvdTrendAlignment), -1, 1),
      confidence: clamp(safeValue(marketFeatures.cvdConfidence), 0, 1)
    },
    gridContext: {
      rangeWidthPct: safeValue(marketFeatures.rangeWidthPct),
      rangeMeanRevertScore: clamp(safeValue(marketFeatures.rangeMeanRevertScore), 0, 1),
      rangeBoundaryRespectScore: clamp(safeValue(marketFeatures.rangeBoundaryRespectScore), 0, 1),
      gridEntrySide: marketFeatures.gridEntrySide || "none"
    }
  };
}

export function buildConfidenceBreakdown({
  score = {},
  trendStateSummary = {},
  signalQualitySummary = {},
  venueConfirmationSummary = {},
  qualityQuorumSummary = {},
  strategySummary = {},
  executionPlan = {}
} = {}) {
  const marketConfidence = clamp(
    average([
      Math.max(safeValue(trendStateSummary.uptrendScore), safeValue(trendStateSummary.downtrendScore), safeValue(trendStateSummary.rangeScore)),
      signalQualitySummary.structureQuality,
      1 - safeValue(trendStateSummary.exhaustionScore, 0)
    ], 0.5),
    0,
    1
  );
  const dataConfidence = clamp(
    average([
      safeValue(trendStateSummary.dataConfidenceScore, 0.55),
      safeValue(signalQualitySummary.quorumQuality, 0.55),
      safeValue(qualityQuorumSummary.quorumScore, qualityQuorumSummary.averageScore || 0.7)
    ], 0.55),
    0,
    1
  );
  const executionConfidence = clamp(
    average([
      safeValue(signalQualitySummary.executionViability, 0.45),
      venueConfirmationSummary.confirmed ? 0.92 : (venueConfirmationSummary.status || "") === "blocked" ? 0.18 : 0.55,
      safeValue(executionPlan.depthConfidence, 0.45)
    ], 0.45),
    0,
    1
  );
  const modelConfidence = clamp(
    average([
      safeValue(score.calibrationConfidence, 0.4),
      1 - safeValue(score.disagreement, 0),
      safeValue(strategySummary.confidence, 0.45)
    ], 0.45),
    0,
    1
  );
  return {
    marketConfidence,
    dataConfidence,
    executionConfidence,
    modelConfidence,
    overallConfidence: clamp(average([marketConfidence, dataConfidence, executionConfidence, modelConfidence], 0.5), 0, 1)
  };
}

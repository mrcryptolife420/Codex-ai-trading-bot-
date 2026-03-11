import { clamp } from "../utils/math.js";
import { buildMarketStateSummary } from "../strategy/marketState.js";

export function classifyRegime({
  marketFeatures,
  newsSummary,
  streamFeatures = {},
  marketStructureSummary = {},
  announcementSummary = {},
  calendarSummary = {},
  marketSentimentSummary = {},
  volatilitySummary = {},
  bookFeatures = {}
}) {
  const reasons = [];
  let regime = "range";
  let confidence = 0.55;
  const marketState = buildMarketStateSummary({
    marketFeatures,
    bookFeatures,
    newsSummary,
    announcementSummary,
    timeframeSummary: {}
  });

  const freshHighPriorityNotice = (announcementSummary.highPriorityCount || 0) > 0 && (announcementSummary.noticeFreshnessHours || 999) <= 12;
  const eventRisk = Math.max(
    newsSummary.eventRiskScore || 0,
    (announcementSummary.eventRiskScore || 0) * 0.85,
    calendarSummary.riskScore || 0,
    freshHighPriorityNotice ? (announcementSummary.riskScore || 0) : (announcementSummary.riskScore || 0) * 0.55,
    Math.max(0, (marketSentimentSummary.riskScore || 0) - 0.48) * 1.15,
    Math.max(0, (volatilitySummary.riskScore || 0) - 0.52) * 1.05
  );
  const breakoutPressure = Math.max(
    Math.abs(marketFeatures.breakoutPct || 0) * 30,
    Math.abs(marketFeatures.donchianBreakoutPct || 0) * 24,
    Math.abs(streamFeatures.tradeFlowImbalance || 0),
    Math.abs(marketStructureSummary.signalScore || 0),
    Math.abs(bookFeatures.bookPressure || 0)
  );
  const trendStructure = Math.max(
    Math.abs(marketFeatures.swingStructureScore || 0),
    Math.max(marketFeatures.higherHighRate || 0, marketFeatures.lowerLowRate || 0) - 0.5
  );
  const directionalAcceleration = Math.max(
    marketFeatures.upsideAccelerationScore || 0,
    marketFeatures.downsideAccelerationScore || 0
  );
  const persistentTrendSignal =
    Math.abs(marketFeatures.emaGap || 0) * 95 * 0.24 +
    Math.abs(marketFeatures.momentum20 || 0) * 70 * 0.2 +
    Math.max(0, marketFeatures.trendMaturityScore || 0) * 0.22 +
    trendStructure * 0.18 +
    Math.max(0, marketFeatures.trendQualityScore || 0) * 0.16;
  const exhaustionPressure = Math.max(0, marketFeatures.trendExhaustionScore || 0);

  if (eventRisk > 0.72 || freshHighPriorityNotice || (announcementSummary.maxSeverity || 0) > 0.86 || (calendarSummary.urgencyScore || 0) > 0.84) {
    regime = "event_risk";
    confidence = 0.9;
    reasons.push("calendar_or_notice_risk");
  } else if (
    (marketFeatures.realizedVolPct || 0) > 0.035 ||
    Math.abs(streamFeatures.microTrend || 0) > 0.0025 ||
    (marketStructureSummary.liquidationIntensity || 0) > 0.45 ||
    (volatilitySummary.riskScore || 0) > 0.68 ||
    directionalAcceleration > 0.64 ||
    (marketFeatures.bearishPatternScore || 0) > 0.72 ||
    (marketFeatures.bullishPatternScore || 0) > 0.72
  ) {
    regime = "high_vol";
    confidence = 0.84;
    reasons.push("volatility_or_pattern_spike");
  } else if (
    breakoutPressure > 0.42 ||
    ((marketFeatures.insideBar || 0) > 0 && Math.abs(bookFeatures.bookPressure || 0) > 0.24) ||
    ((marketFeatures.squeezeReleaseScore || 0) > 0.58 && directionalAcceleration > 0.42)
  ) {
    regime = "breakout";
    confidence = exhaustionPressure > 0.74 ? 0.74 : 0.8;
    reasons.push("breakout_pressure");
  } else if (
    persistentTrendSignal > 0.42 &&
    trendStructure > 0.14 &&
    marketState.direction !== "sideways" &&
    Math.abs(marketStructureSummary.crowdingBias || 0) < 0.75
  ) {
    regime = "trend";
    confidence = clamp(0.72 + Math.min(0.16, persistentTrendSignal * 0.18) - exhaustionPressure * 0.06 + (marketState.dataConfidence - 0.6) * 0.08, 0.6, 0.9);
    reasons.push("persistent_trend");
  } else {
    reasons.push("mean_reversion_profile");
  }

  if (Math.abs(bookFeatures.bookPressure || 0) > 0.28) {
    reasons.push("orderbook_pressure");
  }
  if ((marketFeatures.dominantPattern || "none") !== "none") {
    reasons.push(`pattern:${marketFeatures.dominantPattern}`);
  }
  if ((newsSummary.socialCoverage || 0) > 0) {
    reasons.push("social_sentiment_context");
  }
  if (Math.abs(marketStructureSummary.fundingRate || 0) > 0.00035) {
    reasons.push("funding_extreme");
  }
  if ((calendarSummary.highImpactCount || 0) > 0 && (calendarSummary.proximityHours || 999) < 24) {
    reasons.push("high_impact_calendar_window");
  }
  if ((announcementSummary.highPriorityCount || 0) > 0) {
    reasons.push("official_exchange_notice");
  }
  if ((marketSentimentSummary.fearGreedValue || 50) <= 25 || (marketSentimentSummary.fearGreedValue || 50) >= 75) {
    reasons.push("macro_sentiment_extreme");
  }
  if ((volatilitySummary.regime || "calm") !== "calm") {
    reasons.push("options_vol_context");
  }
  if ((marketFeatures.downsideAccelerationScore || 0) > 0.58) {
    reasons.push("downside_acceleration");
  } else if ((marketFeatures.upsideAccelerationScore || 0) > 0.58) {
    reasons.push("upside_acceleration");
  }
  if ((marketFeatures.trendMaturityScore || 0) > 0.62) {
    reasons.push("trend_maturity");
  }
  if ((marketFeatures.trendExhaustionScore || 0) > 0.7) {
    reasons.push("trend_exhaustion");
  }
  if (marketState.dataConfidence < 0.55) {
    reasons.push("soft_data_confidence");
  }

  const bias = clamp(
    (marketFeatures.momentum5 || 0) * 10 +
      (marketFeatures.momentum20 || 0) * 8 +
      (marketFeatures.swingStructureScore || 0) * 0.18 +
      ((marketFeatures.upsideAccelerationScore || 0) - (marketFeatures.downsideAccelerationScore || 0)) * 0.16 +
      (marketFeatures.anchoredVwapGapPct || 0) * 18 +
      (newsSummary.sentimentScore || 0) * 0.35 +
      (newsSummary.socialSentiment || 0) * 0.12 +
      (announcementSummary.sentimentScore || 0) * 0.25 +
      (marketSentimentSummary.contrarianScore || 0) * 0.12 +
      (marketStructureSummary.signalScore || 0) * 0.28 +
      (calendarSummary.bullishScore || 0) * 0.12 -
      (calendarSummary.bearishScore || 0) * 0.12 +
      (streamFeatures.tradeFlowImbalance || 0) * 0.2 +
      (bookFeatures.bookPressure || 0) * 0.18 +
      (marketFeatures.bullishPatternScore || 0) * 0.2 -
      (marketFeatures.bearishPatternScore || 0) * 0.24 -
      (volatilitySummary.riskScore || 0) * 0.18 -
      exhaustionPressure * 0.08,
    -1,
    1
  );

  return {
    regime,
    confidence,
    bias,
    reasons,
    trendState: marketState.trendStateSummary,
    marketState
  };
}


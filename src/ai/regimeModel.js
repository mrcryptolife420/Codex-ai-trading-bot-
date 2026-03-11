import { clamp } from "../utils/math.js";

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
    Math.abs(streamFeatures.tradeFlowImbalance || 0),
    Math.abs(marketStructureSummary.signalScore || 0),
    Math.abs(bookFeatures.bookPressure || 0)
  );

  if (eventRisk > 0.72 || freshHighPriorityNotice || (announcementSummary.maxSeverity || 0) > 0.86 || (calendarSummary.urgencyScore || 0) > 0.84) {
    regime = "event_risk";
    confidence = 0.9;
    reasons.push("calendar_or_notice_risk");
  } else if (
    (marketFeatures.realizedVolPct || 0) > 0.035 ||
    Math.abs(streamFeatures.microTrend || 0) > 0.0025 ||
    (marketStructureSummary.liquidationIntensity || 0) > 0.45 ||
    (volatilitySummary.riskScore || 0) > 0.68 ||
    (marketFeatures.bearishPatternScore || 0) > 0.72 ||
    (marketFeatures.bullishPatternScore || 0) > 0.72
  ) {
    regime = "high_vol";
    confidence = 0.84;
    reasons.push("volatility_or_pattern_spike");
  } else if (
    breakoutPressure > 0.42 ||
    (marketFeatures.insideBar || 0) > 0 && Math.abs(bookFeatures.bookPressure || 0) > 0.24
  ) {
    regime = "breakout";
    confidence = 0.8;
    reasons.push("breakout_pressure");
  } else if (
    Math.abs(marketFeatures.emaGap || 0) > 0.004 &&
    Math.abs(marketFeatures.momentum20 || 0) > 0.006 &&
    Math.abs(marketStructureSummary.crowdingBias || 0) < 0.75
  ) {
    regime = "trend";
    confidence = 0.76;
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

  const bias = clamp(
    (marketFeatures.momentum5 || 0) * 10 +
      (marketFeatures.momentum20 || 0) * 8 +
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
      (volatilitySummary.riskScore || 0) * 0.18,
    -1,
    1
  );

  return {
    regime,
    confidence,
    bias,
    reasons
  };
}


import { clamp } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value, 0).toFixed(digits));
}

function push(list, condition, value) {
  if (condition && value) {
    list.push(value);
  }
}

function scoreCandidate(id, score, drivers = [], transitionState = "stable") {
  return { id, score, drivers, transitionState };
}

export function buildMarketConditionSummary({
  marketSnapshot = {},
  regimeSummary = {},
  sessionSummary = {},
  timeframeSummary = {},
  trendStateSummary = {},
  marketStateSummary = {},
  newsSummary = {},
  announcementSummary = {},
  calendarSummary = {},
  volatilitySummary = {},
  marketSentimentSummary = {},
  qualityQuorumSummary = {},
  pairHealthSummary = {},
  venueConfirmationSummary = {}
} = {}) {
  const market = marketSnapshot.market || {};
  const book = marketSnapshot.book || {};
  const regime = regimeSummary.regime || "range";
  const session = sessionSummary.session || "unknown_session";
  const alignment = safeNumber(timeframeSummary.alignmentScore, 0.5);
  const higherBias = safeNumber(timeframeSummary.higherBias, 0);
  const uptrendScore = safeNumber(trendStateSummary.uptrendScore, 0);
  const downtrendScore = safeNumber(trendStateSummary.downtrendScore, 0);
  const exhaustionScore = safeNumber(trendStateSummary.exhaustionScore, 0);
  const rangeAcceptanceScore = safeNumber(trendStateSummary.rangeAcceptanceScore, 0);
  const dataConfidenceScore = safeNumber(trendStateSummary.dataConfidenceScore, 0.5);
  const phase = marketStateSummary.phase || "unknown";
  const trendFailure = safeNumber(marketStateSummary.trendFailure, 0);
  const realizedVolPct = Math.max(0, safeNumber(market.realizedVolPct, 0));
  const spreadBps = Math.max(0, safeNumber(book.spreadBps, 0));
  const bookPressure = safeNumber(book.bookPressure, 0);
  const breakoutPct = Math.abs(safeNumber(market.breakoutPct, 0));
  const breakoutFollowThroughScore = safeNumber(market.breakoutFollowThroughScore, 0);
  const anchoredVwapRejectionScore = safeNumber(market.anchoredVwapRejectionScore, 0);
  const anchoredVwapAcceptanceScore = safeNumber(market.anchoredVwapAcceptanceScore, 0);
  const acceptanceQuality = clamp(
    anchoredVwapAcceptanceScore * 0.45 +
    Math.max(0, 1 - anchoredVwapRejectionScore) * 0.2 +
    Math.max(0, safeNumber(market.closeAcceptanceScore, 0.5)) * 0.2 +
    Math.max(0, safeNumber(market.volumeAcceptanceScore, 0.5)) * 0.15,
    0,
    1
  );
  const liquidityRisk = clamp(
    Math.max(0, spreadBps - 5) / 18 * 0.48 +
    Math.max(0, 0.55 - safeNumber(book.depthConfidence, 0.5)) * 0.26 +
    Math.max(0, 0.56 - safeNumber(pairHealthSummary.score, 0.5)) * 0.14 +
    ((sessionSummary.lowLiquidity || false) ? 0.12 : 0),
    0,
    1
  );
  const eventRisk = clamp(
    Math.max(
      safeNumber(newsSummary.riskScore, 0),
      safeNumber(announcementSummary.riskScore, 0),
      safeNumber(calendarSummary.riskScore, 0),
      safeNumber(volatilitySummary.riskScore, 0)
    ),
    0,
    1
  );
  const sentimentTailwind = clamp(
    safeNumber(newsSummary.sentimentScore, 0) * 0.45 +
    safeNumber(marketSentimentSummary.contrarianScore, 0) * 0.15 +
    safeNumber(bookPressure, 0) * 0.2 +
    safeNumber(higherBias, 0) * 0.2,
    -1,
    1
  );
  const continuationDrivers = [];
  push(continuationDrivers, uptrendScore >= 0.58, "trend_supported");
  push(continuationDrivers, alignment >= 0.58, "timeframes_aligned");
  push(continuationDrivers, breakoutFollowThroughScore >= 0.48 || acceptanceQuality >= 0.56, "acceptance_holding");
  push(continuationDrivers, bookPressure >= 0.08, "orderbook_tailwind");
  const trendContinuationScore = clamp(
    uptrendScore * 0.38 +
    Math.max(0, higherBias) * 0.16 +
    alignment * 0.18 +
    acceptanceQuality * 0.16 +
    Math.max(0, sentimentTailwind) * 0.08 +
    Math.max(0, 0.8 - eventRisk) * 0.04,
    0,
    1
  );
  const exhaustionDrivers = [];
  push(exhaustionDrivers, exhaustionScore >= 0.62, "trend_exhaustion");
  push(exhaustionDrivers, phase === "late_crowded", "late_crowded_phase");
  push(exhaustionDrivers, anchoredVwapRejectionScore >= 0.58, "anchored_rejection");
  push(exhaustionDrivers, Math.max(0, -bookPressure) >= 0.12, "orderbook_reversal");
  const trendExhaustionScore = clamp(
    exhaustionScore * 0.42 +
    Math.max(0, trendFailure) * 0.18 +
    anchoredVwapRejectionScore * 0.16 +
    Math.max(0, -bookPressure) * 0.12 +
    Math.max(0, realizedVolPct - 0.022) / 0.028 * 0.12,
    0,
    1
  );
  const rangeAcceptanceDrivers = [];
  push(rangeAcceptanceDrivers, regime === "range" || phase === "range_acceptance", "range_regime");
  push(rangeAcceptanceDrivers, rangeAcceptanceScore >= 0.52, "range_holding");
  push(rangeAcceptanceDrivers, breakoutFollowThroughScore <= 0.35, "breakout_not_released");
  const rangeAcceptance = clamp(
    Math.max(rangeAcceptanceScore, regime === "range" ? 0.44 : 0) * 0.42 +
    Math.max(0, 0.6 - Math.abs(higherBias)) * 0.16 +
    Math.max(0, 0.58 - breakoutFollowThroughScore) * 0.18 +
    Math.max(0, 0.028 - realizedVolPct) / 0.028 * 0.16 +
    Math.max(0, 0.72 - eventRisk) * 0.08,
    0,
    1
  );
  const rangeBreakRiskDrivers = [];
  push(rangeBreakRiskDrivers, regime === "range" || phase === "range_acceptance", "range_coiling");
  push(rangeBreakRiskDrivers, breakoutPct >= 0.0045, "break_pressure");
  push(rangeBreakRiskDrivers, breakoutFollowThroughScore >= 0.34 && breakoutFollowThroughScore <= 0.6, "release_pending");
  const rangeBreakRisk = clamp(
    (regime === "range" || phase === "range_acceptance" ? 0.24 : 0) +
    Math.min(0.28, breakoutPct * 40) +
    Math.max(0, breakoutFollowThroughScore - 0.28) * 0.28 +
    Math.max(0, realizedVolPct - 0.016) / 0.026 * 0.12 +
    Math.max(0, alignment - 0.45) * 0.08,
    0,
    1
  );
  const breakoutReleaseDrivers = [];
  push(breakoutReleaseDrivers, regime === "breakout" || phase === "breakout_release", "breakout_context");
  push(breakoutReleaseDrivers, breakoutFollowThroughScore >= 0.58, "follow_through_confirmed");
  push(breakoutReleaseDrivers, alignment >= 0.56, "timeframe_support");
  const breakoutRelease = clamp(
    (regime === "breakout" ? 0.24 : 0) +
    breakoutFollowThroughScore * 0.34 +
    acceptanceQuality * 0.18 +
    alignment * 0.14 +
    Math.max(0, bookPressure) * 0.06 +
    Math.min(0.16, breakoutPct * 32) +
    Math.max(0, sentimentTailwind) * 0.08,
    0,
    1
  );
  const failedBreakoutDrivers = [];
  push(failedBreakoutDrivers, breakoutFollowThroughScore <= 0.3, "follow_through_failed");
  push(failedBreakoutDrivers, anchoredVwapRejectionScore >= 0.58, "rejection_confirmed");
  push(failedBreakoutDrivers, trendFailure >= 0.48, "trend_failure");
  const failedBreakout = clamp(
    Math.max(0, 0.4 - breakoutFollowThroughScore) * 0.34 +
    anchoredVwapRejectionScore * 0.22 +
    trendFailure * 0.18 +
    Math.max(0, -bookPressure) * 0.12 +
    Math.max(0, eventRisk - 0.45) * 0.14,
    0,
    1
  );
  const highVolEventDrivers = [];
  push(highVolEventDrivers, eventRisk >= 0.58, "event_risk");
  push(highVolEventDrivers, realizedVolPct >= 0.028, "high_realized_vol");
  push(highVolEventDrivers, regime === "high_vol" || regime === "event_risk", "volatile_regime");
  const highVolEvent = clamp(
    eventRisk * 0.46 +
    Math.min(0.28, realizedVolPct / 0.042) * 0.28 +
    ((regime === "high_vol" || regime === "event_risk") ? 0.18 : 0) +
    Math.max(0, safeNumber(volatilitySummary.riskScore, 0) - 0.45) * 0.08,
    0,
    1
  );
  const lowLiquidityDrivers = [];
  push(lowLiquidityDrivers, liquidityRisk >= 0.44, "thin_liquidity");
  push(lowLiquidityDrivers, safeNumber(qualityQuorumSummary.status === "degraded" ? 1 : 0, 0) > 0, "quality_degraded");
  push(lowLiquidityDrivers, !venueConfirmationSummary.confirmed && (venueConfirmationSummary.status || "") === "blocked", "venue_fragile");
  const lowLiquidityCaution = clamp(
    liquidityRisk * 0.58 +
    Math.max(0, 0.48 - dataConfidenceScore) * 0.16 +
    Math.max(0, 0.54 - safeNumber(qualityQuorumSummary.quorumScore || qualityQuorumSummary.averageScore, 0.5)) * 0.14 +
    ((venueConfirmationSummary.status || "") === "blocked" ? 0.12 : 0),
    0,
    1
  );

  const candidates = [
    scoreCandidate("low_liquidity_caution", lowLiquidityCaution, lowLiquidityDrivers, "caution"),
    scoreCandidate("high_vol_event", highVolEvent, highVolEventDrivers, eventRisk >= 0.72 ? "event" : "building"),
    scoreCandidate("failed_breakout", failedBreakout, failedBreakoutDrivers, "failing"),
    scoreCandidate("breakout_release", breakoutRelease, breakoutReleaseDrivers, breakoutFollowThroughScore >= 0.62 ? "release" : "building"),
    scoreCandidate("trend_exhaustion", trendExhaustionScore, exhaustionDrivers, "reversal_risk"),
    scoreCandidate("trend_continuation", trendContinuationScore, continuationDrivers, "stable"),
    scoreCandidate("range_break_risk", rangeBreakRisk, rangeBreakRiskDrivers, breakoutFollowThroughScore >= 0.42 ? "building" : "stable"),
    scoreCandidate("range_acceptance", rangeAcceptance, rangeAcceptanceDrivers, "stable")
  ]
    .sort((left, right) => right.score - left.score);

  const primary = candidates[0] || scoreCandidate("range_acceptance", 0.32, [], "stable");
  const secondary = candidates[1] || scoreCandidate("range_break_risk", 0.18, [], "stable");
  const confidence = clamp(
    primary.score * 0.62 +
    Math.max(0, primary.score - secondary.score) * 0.32 +
    dataConfidenceScore * 0.06,
    0.28,
    0.96
  );
  const risk = clamp(
    eventRisk * 0.36 +
    liquidityRisk * 0.26 +
    Math.max(0, trendExhaustionScore - 0.45) * 0.14 +
    Math.max(0, failedBreakout - 0.38) * 0.14 +
    Math.max(0, safeNumber(qualityQuorumSummary.observeOnly ? 1 : 0, 0)) * 0.1,
    0,
    1
  );
  const transitionState = primary.transitionState || (Math.abs(primary.score - secondary.score) < 0.08 ? "building" : "stable");
  const posture = primary.id === "trend_continuation" || primary.id === "breakout_release"
    ? "offense"
    : ["trend_exhaustion", "failed_breakout", "high_vol_event", "low_liquidity_caution"].includes(primary.id)
      ? "defense"
      : "balanced";

  return {
    conditionId: primary.id,
    conditionConfidence: num(confidence),
    conditionRisk: num(risk),
    conditionTransitionState: transitionState,
    posture,
    regime,
    session,
    phase,
    drivers: primary.drivers.slice(0, 3),
    notes: [
      `${primary.id} leidt nu boven ${secondary.id}.`,
      transitionState === "stable"
        ? "Marktconditie is voorlopig stabiel genoeg voor condition-aware routing."
        : "Marktconditie zit in een overgang; adaptive keuzes blijven bewust bounded."
    ],
    candidates: candidates.slice(0, 4).map((item) => ({
      id: item.id,
      score: num(item.score),
      transitionState: item.transitionState
    }))
  };
}

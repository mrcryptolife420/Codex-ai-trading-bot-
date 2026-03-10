import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

export function buildTimeframeConsensus({ marketSnapshot = {}, regimeSummary = {}, strategySummary = {}, config = {} } = {}) {
  const lower = marketSnapshot.timeframes?.lower?.market || {};
  const higher = marketSnapshot.timeframes?.higher?.market || {};
  const lowerInterval = marketSnapshot.timeframes?.lower?.interval || config.lowerTimeframeInterval || "5m";
  const higherInterval = marketSnapshot.timeframes?.higher?.interval || config.higherTimeframeInterval || "1h";
  const lowerBias = clamp(
    (lower.emaTrendScore || 0) * 0.45 +
      (lower.momentum20 || 0) * 12 +
      (lower.breakoutPct || 0) * 18 +
      ((lower.supertrendDirection || 0) * 0.18),
    -1,
    1
  );
  const higherBias = clamp(
    (higher.emaTrendScore || 0) * 0.5 +
      (higher.momentum20 || 0) * 14 +
      (higher.breakoutPct || 0) * 20 +
      ((higher.supertrendDirection || 0) * 0.2),
    -1,
    1
  );
  const volatilityGap = Math.abs((lower.realizedVolPct || 0) - (higher.realizedVolPct || 0));
  const directionAgreement = lowerBias === 0 || higherBias === 0
    ? 0.5
    : Math.sign(lowerBias) === Math.sign(higherBias)
      ? 1
      : 0;
  const alignmentScore = clamp(
    directionAgreement * 0.52 +
      (1 - clamp(Math.abs(lowerBias - higherBias), 0, 1)) * 0.28 +
      (1 - clamp(volatilityGap / Math.max(config.crossTimeframeMaxVolGapPct || 0.03, 0.005), 0, 1)) * 0.2,
    0,
    1
  );
  const reasons = [];
  const blockers = [];
  if (directionAgreement >= 1 && Math.abs(higherBias) >= 0.18) {
    reasons.push("higher_tf_confirms_direction");
  }
  if (Math.abs(lowerBias) >= 0.18) {
    reasons.push("lower_tf_trigger_active");
  }
  if (volatilityGap <= Math.max(config.crossTimeframeMaxVolGapPct || 0.03, 0.005) * 0.6) {
    reasons.push("volatility_regimes_aligned");
  }
  const family = strategySummary.family || "";
  if (alignmentScore < (config.crossTimeframeMinAlignmentScore || 0.42) && ["trend_following", "breakout", "market_structure"].includes(family)) {
    blockers.push("cross_timeframe_misalignment");
  }
  if (Math.sign(lowerBias || 0) !== Math.sign(higherBias || 0) && Math.abs(higherBias) >= 0.16) {
    blockers.push("higher_tf_conflict");
  }
  if (regimeSummary.regime === "event_risk" && directionAgreement === 0 && volatilityGap > (config.crossTimeframeMaxVolGapPct || 0.03)) {
    blockers.push("event_regime_tf_noise");
  }
  return {
    enabled: Boolean(config.enableCrossTimeframeConsensus),
    lowerInterval,
    higherInterval,
    lowerBias: num(lowerBias),
    higherBias: num(higherBias),
    alignmentScore: num(alignmentScore),
    directionAgreement,
    volatilityGapPct: num(volatilityGap),
    reasons,
    blockerReasons: blockers,
    summary: blockers.length
      ? `${higherInterval} en ${lowerInterval} liggen niet netjes in lijn.`
      : `${higherInterval} bevestigt ${lowerInterval} voldoende.`
  };
}

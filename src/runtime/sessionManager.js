import { clamp } from "../utils/math.js";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ratio(value, min, max) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= min) {
    return 0;
  }
  if (value >= max) {
    return 1;
  }
  return (value - min) / (max - min);
}

function classifySession(utcHour) {
  if (utcHour >= 22 || utcHour < 2) {
    return { id: "rollover", label: "Rollover" };
  }
  if (utcHour < 8) {
    return { id: "asia", label: "Asia" };
  }
  if (utcHour < 13) {
    return { id: "europe", label: "Europe" };
  }
  if (utcHour < 20) {
    return { id: "us", label: "US" };
  }
  return { id: "late_us", label: "Late US" };
}

export function buildSessionSummary({
  now = new Date(),
  marketSnapshot = {},
  marketStructureSummary = {},
  config
}) {
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const dayOfWeek = now.getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const session = classifySession(utcHour);
  const spreadBps = Number(marketSnapshot.book?.spreadBps || 0);
  const depthNotional = Number(marketSnapshot.book?.totalDepthNotional || 0);
  const depthConfidence = Number(marketSnapshot.book?.depthConfidence || 0);
  const realizedVolPct = Number(marketSnapshot.market?.realizedVolPct || 0);
  const nextFundingMs = marketStructureSummary.nextFundingTime
    ? new Date(marketStructureSummary.nextFundingTime).getTime()
    : null;
  const minutesToFunding = Number.isFinite(nextFundingMs)
    ? (nextFundingMs - now.getTime()) / 60_000
    : null;
  const hoursToFunding = minutesToFunding == null ? null : minutesToFunding / 60;
  const inFundingCaution = minutesToFunding != null && minutesToFunding >= 0 && minutesToFunding <= config.sessionCautionMinutesToFunding;
  const inHardFundingBlock = minutesToFunding != null && minutesToFunding >= 0 && minutesToFunding <= config.sessionHardBlockMinutesToFunding;
  const spreadRisk = ratio(spreadBps, config.sessionLowLiquiditySpreadBps * 0.55, config.sessionLowLiquiditySpreadBps * 1.8);
  const depthRisk = ratio(config.sessionLowLiquidityDepthUsd - depthNotional, 0, config.sessionLowLiquidityDepthUsd);
  const confidenceRisk = clamp(1 - depthConfidence, 0, 1);
  const sessionRisk = session.id === "rollover" ? 0.42 : session.id === "late_us" ? 0.22 : 0.08;
  const volatilityRisk = ratio(realizedVolPct, config.maxRealizedVolPct * 0.55, config.maxRealizedVolPct * 1.4);
  const weekendRisk = isWeekend ? 0.35 : 0;
  const fundingRisk = inFundingCaution ? (inHardFundingBlock ? 0.9 : 0.45) : 0;
  const lowLiquidityScore = clamp(
    spreadRisk * 0.34 +
    depthRisk * 0.28 +
    confidenceRisk * 0.16 +
    sessionRisk * 0.12 +
    volatilityRisk * 0.1,
    0,
    1
  );
  const lowLiquidity = lowLiquidityScore >= 0.58;
  const riskScore = clamp(lowLiquidityScore * 0.54 + weekendRisk * 0.18 + fundingRisk * 0.28, 0, 1);
  let sizeMultiplier = 1;
  let thresholdPenalty = 0;
  const reasons = [];
  const blockerReasons = [];

  if (lowLiquidity) {
    sizeMultiplier *= config.sessionOffHoursRiskMultiplier;
    thresholdPenalty += 0.025;
    reasons.push("low_liquidity_session");
  }
  if (isWeekend) {
    sizeMultiplier *= config.sessionWeekendRiskMultiplier;
    thresholdPenalty += 0.012;
    reasons.push("weekend_flow");
  }
  if (inFundingCaution) {
    sizeMultiplier *= config.sessionFundingRiskMultiplier;
    thresholdPenalty += inHardFundingBlock ? 0.045 : 0.018;
    reasons.push("funding_window");
  }
  if (inHardFundingBlock) {
    if (config.botMode === "paper") {
      reasons.push("funding_settlement_window_watch");
      sizeMultiplier *= 0.82;
      thresholdPenalty += 0.01;
    } else {
      blockerReasons.push("funding_settlement_window");
    }
  }
  if (lowLiquidityScore >= 0.88) {
    blockerReasons.push("extreme_low_liquidity");
  }

  return {
    session: session.id,
    sessionLabel: session.label,
    utcHour: Number(utcHour.toFixed(2)),
    dayOfWeek,
    dayLabel: DAY_LABELS[dayOfWeek],
    isWeekend,
    lowLiquidity,
    lowLiquidityScore: Number(lowLiquidityScore.toFixed(4)),
    riskScore: Number(riskScore.toFixed(4)),
    spreadBps: Number(spreadBps.toFixed(2)),
    totalDepthNotional: Number(depthNotional.toFixed(2)),
    depthConfidence: Number(depthConfidence.toFixed(4)),
    realizedVolPct: Number(realizedVolPct.toFixed(4)),
    minutesToFunding: minutesToFunding == null ? null : Number(minutesToFunding.toFixed(1)),
    hoursToFunding: hoursToFunding == null ? null : Number(hoursToFunding.toFixed(2)),
    inFundingCaution,
    inHardFundingBlock,
    thresholdPenalty: Number(thresholdPenalty.toFixed(4)),
    sizeMultiplier: Number(clamp(sizeMultiplier, 0.35, 1).toFixed(4)),
    reasons,
    blockerReasons
  };
}


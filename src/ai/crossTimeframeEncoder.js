import { clamp } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

export function buildCrossTimeframeEncoding({ marketSnapshot = {}, timeframeSummary = {}, regimeSummary = {}, strategySummary = {} } = {}) {
  const lowerMarket = marketSnapshot.timeframes?.lower?.market || {};
  const higherMarket = marketSnapshot.timeframes?.higher?.market || {};
  const lowerBias = safeNumber(timeframeSummary.lowerBias);
  const higherBias = safeNumber(timeframeSummary.higherBias);
  const alignmentScore = safeNumber(timeframeSummary.alignmentScore, 0.5);
  const directionAgreement = safeNumber(timeframeSummary.directionAgreement, 0.5);
  const volatilityGap = safeNumber(timeframeSummary.volatilityGapPct);
  const lowerTrend = clamp(
    safeNumber(lowerMarket.emaTrendScore) * 0.52 +
      safeNumber(lowerMarket.supertrendDirection) * 0.18 +
      safeNumber(lowerMarket.momentum20) * 10,
    -1,
    1
  );
  const higherTrend = clamp(
    safeNumber(higherMarket.emaTrendScore) * 0.56 +
      safeNumber(higherMarket.supertrendDirection) * 0.2 +
      safeNumber(higherMarket.momentum20) * 12,
    -1,
    1
  );
  const compressionScore = clamp(
    1 - Math.abs(safeNumber(lowerMarket.realizedVolPct) - safeNumber(higherMarket.realizedVolPct)) / 0.04,
    0,
    1
  );
  const breakoutAlignment = clamp(
    Math.sign(safeNumber(lowerMarket.breakoutPct)) === Math.sign(safeNumber(higherMarket.breakoutPct))
      ? Math.abs(safeNumber(lowerMarket.breakoutPct)) * 22 + Math.abs(safeNumber(higherMarket.breakoutPct)) * 18
      : 0,
    0,
    1
  );
  const regimeTrendBias = ["trend", "breakout"].includes(regimeSummary.regime) ? 1 : 0;
  const familyTrendBias = ["trend_following", "breakout", "market_structure"].includes(strategySummary.family) ? 1 : 0;
  const encodedTrend = clamp((lowerTrend * 0.44 + higherTrend * 0.56), -1, 1);
  const drivers = [];
  if (alignmentScore >= 0.62) {
    drivers.push({ name: "alignment", score: num(alignmentScore, 3), direction: "positive" });
  }
  if (Math.abs(encodedTrend) >= 0.18) {
    drivers.push({ name: "trend_stack", score: num(Math.abs(encodedTrend), 3), direction: encodedTrend >= 0 ? "positive" : "negative" });
  }
  if (compressionScore >= 0.58) {
    drivers.push({ name: "vol_compression", score: num(compressionScore, 3), direction: "positive" });
  }
  if (volatilityGap >= 0.02) {
    drivers.push({ name: "vol_gap", score: num(volatilityGap, 3), direction: "negative" });
  }
  return {
    lowerBias: num(lowerBias),
    higherBias: num(higherBias),
    alignmentScore: num(alignmentScore),
    directionAgreement: num(directionAgreement),
    volatilityGapPct: num(volatilityGap),
    lowerTrend: num(lowerTrend),
    higherTrend: num(higherTrend),
    compressionScore: num(compressionScore),
    breakoutAlignment: num(breakoutAlignment),
    encodedTrend: num(encodedTrend),
    regimeTrendBias,
    familyTrendBias,
    inputs: {
      tf_lower_bias: lowerBias,
      tf_higher_bias: higherBias,
      tf_alignment: alignmentScore,
      tf_direction_agreement: directionAgreement,
      tf_vol_gap: volatilityGap,
      tf_lower_trend: lowerTrend,
      tf_higher_trend: higherTrend,
      tf_compression: compressionScore,
      tf_breakout_alignment: breakoutAlignment,
      tf_regime_bias: regimeTrendBias,
      tf_family_bias: familyTrendBias
    },
    drivers,
    summary: alignmentScore >= 0.6
      ? "Timeframes liggen netjes op een lijn."
      : alignmentScore >= 0.45
        ? "Timeframes zijn bruikbaar maar niet volledig synchroon."
        : "Timeframes geven een gemengd of conflicterend beeld."
  };
}

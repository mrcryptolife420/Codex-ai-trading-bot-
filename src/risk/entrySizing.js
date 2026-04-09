function safeValue(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeValue(value, 0).toFixed(digits));
}

export function buildSizingFactorBreakdown({
  sessionSizeMultiplier,
  driftSizeMultiplier,
  selfHealSizeMultiplier,
  metaSizeMultiplier,
  strategyMetaSizeMultiplier,
  venueSizeMultiplier,
  capitalGovernorSizeMultiplier,
  capitalLadderSizeMultiplier,
  retirementSizeMultiplier,
  executionCostSizeMultiplier,
  spotDowntrendPenalty,
  trendStateSizeMultiplier,
  offlineLearningSizeMultiplier
}) {
  const sizingFactors = [
    { id: "session", value: sessionSizeMultiplier },
    { id: "drift", value: driftSizeMultiplier },
    { id: "self_heal", value: selfHealSizeMultiplier },
    { id: "meta", value: metaSizeMultiplier },
    { id: "strategy_meta", value: strategyMetaSizeMultiplier },
    { id: "venue", value: venueSizeMultiplier },
    { id: "capital_governor", value: capitalGovernorSizeMultiplier },
    { id: "capital_ladder", value: capitalLadderSizeMultiplier },
    { id: "retirement", value: retirementSizeMultiplier },
    { id: "execution_cost", value: executionCostSizeMultiplier },
    { id: "downtrend", value: spotDowntrendPenalty },
    { id: "trend_state", value: trendStateSizeMultiplier },
    { id: "offline_learning", value: offlineLearningSizeMultiplier }
  ].map((item) => ({
    ...item,
    effect: num((safeValue(item.value, 1) - 1), 4)
  }));
  return {
    dominantSizingDrag: [...sizingFactors]
      .filter((item) => item.value < 1)
      .sort((left, right) => left.value - right.value)
      .slice(0, 3),
    dominantSizingBoost: [...sizingFactors]
      .filter((item) => item.value > 1)
      .sort((left, right) => right.value - left.value)
      .slice(0, 2)
  };
}

export function evaluatePositionGuards({
  openPositionsInMode = [],
  maxOpenPositions = 0,
  symbol = ""
} = {}) {
  const reasons = [];
  if (openPositionsInMode.length >= maxOpenPositions) {
    reasons.push("max_open_positions_reached");
  }
  const hasOpenPositionForSymbol = openPositionsInMode.some((position) => position.symbol === symbol);
  if (hasOpenPositionForSymbol) {
    reasons.push("position_already_open");
  }
  return {
    reasons,
    hasOpenPositionForSymbol
  };
}

export function shouldBlockAmbiguousSetup({
  riskSensitiveFamily = false,
  ambiguityScore = 0,
  ambiguityThreshold = 1,
  scoreProbability = 0,
  threshold = 1,
  strongTrendGuardOverride = false
} = {}) {
  return Boolean(
    riskSensitiveFamily &&
    ambiguityScore >= ambiguityThreshold &&
    scoreProbability < threshold + 0.06 &&
    !strongTrendGuardOverride
  );
}

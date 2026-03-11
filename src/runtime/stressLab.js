function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, safeNumber(value)));
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function percentile(values = [], ratio = 0.5) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function buildMonteCarloReturns(returns = [], iterations = 96) {
  if (!returns.length) {
    return { p05Pct: 0, p50Pct: 0, p95Pct: 0 };
  }
  const paths = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let pathReturn = 0;
    const horizon = Math.min(6, returns.length);
    for (let step = 0; step < horizon; step += 1) {
      const index = (iteration * 3 + step * 5) % returns.length;
      pathReturn += returns[index];
    }
    paths.push(pathReturn / Math.max(horizon, 1));
  }
  return {
    p05Pct: num(percentile(paths, 0.05)),
    p50Pct: num(percentile(paths, 0.5)),
    p95Pct: num(percentile(paths, 0.95))
  };
}

export function evaluateStrategyStress({ candidate = {}, relatedTrades = [], nowIso = new Date().toISOString() } = {}) {
  const returns = relatedTrades
    .map((trade) => safeNumber(trade.netPnlPct, null))
    .filter((value) => value != null);
  const riskProfile = candidate.riskProfile || {};
  const executionHints = candidate.executionHints || {};
  const stopLossPct = clamp(riskProfile.stopLossPct || 0.018, 0.002, 0.12);
  const trailingStopPct = clamp(riskProfile.trailingStopPct || 0.012, 0.002, 0.08);
  const maxHoldMinutes = Math.max(15, safeNumber(riskProfile.maxHoldMinutes, 360));
  const complexityPenalty = clamp((candidate.complexityScore || 0.3) * 0.12, 0.01, 0.18);
  const makerBias = executionHints.preferMaker ? 0.86 : 1;
  const monteCarlo = buildMonteCarloReturns(returns);
  const scenarios = [
    {
      id: "spread_shock",
      lossPct: num(stopLossPct * 0.72 + complexityPenalty * 0.35 + (executionHints.entryStyle === "market" ? 0.006 : 0.003))
    },
    {
      id: "liquidity_crunch",
      lossPct: num(stopLossPct * 0.94 + (1 - makerBias) * 0.005 + complexityPenalty * 0.28)
    },
    {
      id: "api_outage",
      lossPct: num(stopLossPct * 0.68 + trailingStopPct * 0.55 + Math.min(0.012, maxHoldMinutes / 50_000))
    },
    {
      id: "gap_move",
      lossPct: num(stopLossPct * 1.12 + trailingStopPct * 0.36 + complexityPenalty * 0.22)
    }
  ];
  const worstScenario = [...scenarios].sort((left, right) => (right.lossPct || 0) - (left.lossPct || 0))[0] || { id: "unknown", lossPct: 0 };
  const tailLossPct = Math.max(Math.abs(monteCarlo.p05Pct || 0), worstScenario.lossPct || 0);
  const survivalScore = clamp(
    0.72 +
      average(returns.map((value) => Math.max(-0.03, Math.min(0.03, value))), 0) * 4.5 -
      tailLossPct * 5.8 -
      complexityPenalty,
    0,
    1
  );
  return {
    generatedAt: nowIso,
    status: survivalScore >= 0.62
      ? "ready"
      : survivalScore >= 0.46
        ? "observe"
        : "blocked",
    survivalScore: num(survivalScore),
    tailLossPct: num(tailLossPct),
    worstScenario: worstScenario.id || null,
    monteCarlo,
    scenarios,
    notes: [
      worstScenario.id
        ? `${worstScenario.id} is momenteel het zwakste stress-scenario.`
        : "Nog geen stress-scenario beschikbaar.",
      returns.length
        ? `${returns.length} trade returns voeden de Monte Carlo stresslaag.`
        : "Stressscore draait nog op heuristische defaults zonder trade-history."
    ]
  };
}

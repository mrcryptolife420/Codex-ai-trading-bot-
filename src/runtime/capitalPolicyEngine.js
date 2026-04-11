import { clamp } from "../utils/math.js";
import { buildBudgetState } from "../risk/portfolioOptimizer.js";

function average(values = []) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function topEntries(map = {}, limit = 5) {
  return Object.entries(map)
    .map(([id, value]) => ({ id, multiplier: num(value, 4) }))
    .sort((left, right) => left.multiplier - right.multiplier)
    .slice(0, limit);
}

export function buildCapitalPolicySnapshot({
  journal = {},
  runtime = {},
  capitalGovernor = {},
  capitalLadder = {},
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const budgetState = buildBudgetState(journal, config, nowIso, runtime);
  const worstFactors = topEntries(budgetState.factorBudgetMap, 4);
  const worstClusters = topEntries(budgetState.clusterBudgetMap, 4);
  const worstRegimes = topEntries(budgetState.regimeBudgetMap, 4);
  const worstFamilies = topEntries(budgetState.familyBudgetMap, 4);
  const strategyFamilyScorecards = runtime.offlineTrainer?.strategyScorecards || [];
  const familyKillSwitches = strategyFamilyScorecards
    .filter((item) => (item.status || "") === "cooldown")
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      governanceScore: num(item.governanceScore || 0),
      reason: item.dominantError || "cooldown"
    }));
  const dailyLossBudgetUsage = config.maxDailyDrawdown
    ? clamp((budgetState.dailyLossFraction || 0) / Math.max(config.maxDailyDrawdown, 0.0001), 0, 2)
    : 0;
  const weeklyLossBudgetUsage = clamp(
    (capitalGovernor.weeklyLossFraction || 0) / Math.max(config.capitalGovernorWeeklyDrawdownPct || 0.08, 0.0001),
    0,
    2
  );
  const monthlyLossBudgetUsage = Number.isFinite(capitalGovernor.monthlyLossFraction)
    ? clamp((capitalGovernor.monthlyLossFraction || 0) / Math.max(config.capitalGovernorMonthlyLossBudgetFraction || 0.14, 0.0001), 0, 2)
    : 0;
  const deRiskLevel = clamp(
    1 -
      (average([
        capitalGovernor.sizeMultiplier ?? 1,
        capitalLadder.sizeMultiplier ?? 1,
        budgetState.dailyBudgetFactor ?? 1
      ]) - 0.4) / 0.6,
    0,
    1
  );

  const notes = [
    worstFactors[0] ? `Zwakste factorbudget: ${worstFactors[0].id} x${worstFactors[0].multiplier}.` : null,
    worstRegimes[0] ? `Regimebudget onder druk: ${worstRegimes[0].id} x${worstRegimes[0].multiplier}.` : null,
    familyKillSwitches[0] ? `Strategy-family cooldown: ${familyKillSwitches[0].id}.` : null,
    (capitalGovernor.status || "") === "blocked" ? "Capital governor blokkeert nieuwe entries." : null,
    (capitalGovernor.watchReasons || []).length ? "Capital governor houdt alleen een recovery-watch actief; normale entries mogen beperkt doorgaan." : null,
    (capitalLadder.allowEntries === false) ? "Capital ladder houdt deployment in shadow/probation." : null,
    Number.isFinite(capitalGovernor.monthlyLossFraction) ? null : "Monthly capital-governor budget nog niet beschikbaar in runtime snapshot."
  ].filter(Boolean);

  return {
    generatedAt: nowIso,
    status: (capitalGovernor.status || "") === "blocked"
      ? "blocked"
      : deRiskLevel >= 0.55 || familyKillSwitches.length
        ? "degraded"
        : "ready",
    allowEntries: capitalGovernor.allowEntries !== false && capitalLadder.allowEntries !== false,
    sizeMultiplier: num((capitalGovernor.sizeMultiplier ?? 1) * (capitalLadder.sizeMultiplier ?? 1), 4),
    deRiskLevel: num(deRiskLevel, 4),
    budgets: {
      dailyLossFraction: num(budgetState.dailyLossFraction || 0, 4),
      dailyLossBudgetUsage: num(dailyLossBudgetUsage, 4),
      weeklyLossBudgetUsage: num(weeklyLossBudgetUsage, 4),
      monthlyLossBudgetUsage: num(monthlyLossBudgetUsage, 4),
      drawdownPct: num(budgetState.drawdownPct || 0, 4),
      drawdownBudgetUsage: num(budgetState.drawdownBudgetUsage || 0, 4),
      portfolioCvarPct: num(budgetState.portfolioCvarPct || 0, 4)
    },
    tradingSource: budgetState.tradingSource || null,
    factorBudgets: worstFactors,
    clusterBudgets: worstClusters,
    regimeBudgets: worstRegimes,
    familyBudgets: worstFamilies,
    familyKillSwitches,
    regimeLossStreaks: Object.entries(budgetState.regimeLossStreakMap || {})
      .map(([id, streak]) => ({ id, streak: Number(streak || 0) }))
      .filter((item) => item.streak > 0)
      .sort((left, right) => right.streak - left.streak)
      .slice(0, 6),
    notes
  };
}

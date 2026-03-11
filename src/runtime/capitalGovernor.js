import { clamp } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function sameUtcDay(left, right) {
  return `${left || ""}`.slice(0, 10) === `${right || ""}`.slice(0, 10);
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function computeDrawdownPct(equitySnapshots = []) {
  let peak = 0;
  let maxDrawdown = 0;
  for (const snapshot of equitySnapshots) {
    const equity = safeNumber(snapshot?.equity, 0);
    if (equity <= 0) {
      continue;
    }
    peak = Math.max(peak, equity);
    if (!peak) {
      continue;
    }
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }
  return clamp(maxDrawdown, 0, 1);
}

function buildDailyLedger(journal = {}) {
  const ledger = new Map();
  const add = (at, amount) => {
    const key = `${at || ""}`.slice(0, 10);
    if (!key) {
      return;
    }
    ledger.set(key, safeNumber(ledger.get(key), 0) + safeNumber(amount, 0));
  };

  for (const trade of journal.trades || []) {
    add(trade.exitAt || trade.entryAt, trade.pnlQuote || 0);
  }
  for (const event of journal.scaleOuts || []) {
    add(event.at, event.realizedPnl || 0);
  }

  return [...ledger.entries()]
    .map(([day, pnlQuote]) => ({ day, pnlQuote: num(pnlQuote, 2) }))
    .sort((left, right) => left.day.localeCompare(right.day));
}

function computeRedDayStreak(dailyLedger = []) {
  let streak = 0;
  for (let index = dailyLedger.length - 1; index >= 0; index -= 1) {
    if ((dailyLedger[index].pnlQuote || 0) < 0) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

export function buildCapitalGovernor({
  journal = {},
  runtime = {},
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const dailyLedger = buildDailyLedger(journal);
  const todayPnl = dailyLedger.find((item) => sameUtcDay(item.day, nowIso))?.pnlQuote || 0;
  const recentDays = dailyLedger.slice(-7);
  const weeklyPnl = recentDays.reduce((total, item) => total + safeNumber(item.pnlQuote, 0), 0);
  const startingCash = Math.max(config.startingCash || 1, 1);
  const dailyLossFraction = todayPnl < 0 ? Math.abs(todayPnl) / startingCash : 0;
  const weeklyLossFraction = weeklyPnl < 0 ? Math.abs(weeklyPnl) / startingCash : 0;
  const drawdownPct = computeDrawdownPct((journal.equitySnapshots || []).slice(-240));
  const redDayStreak = computeRedDayStreak(dailyLedger);
  const recoveryTrades = (journal.trades || [])
    .filter((trade) => trade.exitAt)
    .slice(-(config.capitalGovernorRecoveryTrades || 4));
  const recoveryWinRate = recoveryTrades.length
    ? recoveryTrades.filter((trade) => (trade.pnlQuote || 0) > 0).length / recoveryTrades.length
    : 0;
  const recoveryAveragePnl = average(recoveryTrades.map((trade) => safeNumber(trade.netPnlPct, 0)), 0);
  const weeklyBlock = weeklyLossFraction >= safeNumber(config.capitalGovernorWeeklyDrawdownPct, 0.08);
  const streakBlock = redDayStreak >= safeNumber(config.capitalGovernorBadDayStreak, 3);
  const drawdownWatch = drawdownPct >= safeNumber(config.portfolioDrawdownBudgetPct, 0.05) * 0.85;
  const dailyBlock = dailyLossFraction >= safeNumber(config.maxDailyDrawdown, 0.04);
  const recoveryMode = dailyBlock || weeklyBlock || streakBlock || drawdownWatch;
  const releaseReady = recoveryTrades.length >= safeNumber(config.capitalGovernorRecoveryTrades, 4) &&
    recoveryWinRate >= safeNumber(config.capitalGovernorRecoveryMinWinRate, 0.55) &&
    recoveryAveragePnl >= -0.0015;
  const allowEntries = !(dailyBlock || weeklyBlock || streakBlock);
  const minSizeMultiplier = clamp(safeNumber(config.capitalGovernorMinSizeMultiplier, 0.25), 0.05, 1);
  const pressurePenalty =
    dailyLossFraction / Math.max(safeNumber(config.maxDailyDrawdown, 0.04), 0.0001) * 0.28 +
    weeklyLossFraction / Math.max(safeNumber(config.capitalGovernorWeeklyDrawdownPct, 0.08), 0.0001) * 0.36 +
    Math.max(0, redDayStreak - 1) * 0.08 +
    drawdownPct / Math.max(safeNumber(config.portfolioDrawdownBudgetPct, 0.05), 0.0001) * 0.18;
  const recoveryBonus = releaseReady ? 0.18 : 0;
  const sizeMultiplier = allowEntries
    ? clamp(1 - pressurePenalty + recoveryBonus, recoveryMode ? minSizeMultiplier : 0.58, 1)
    : 0;
  const status = !allowEntries
    ? "blocked"
    : recoveryMode
      ? "recovery"
      : "ready";

  return {
    generatedAt: nowIso,
    status,
    allowEntries,
    recoveryMode,
    releaseReady,
    sizeMultiplier: num(sizeMultiplier),
    dailyLossFraction: num(dailyLossFraction),
    weeklyLossFraction: num(weeklyLossFraction),
    drawdownPct: num(drawdownPct),
    redDayStreak,
    recentDayCount: recentDays.length,
    recoveryTradeCount: recoveryTrades.length,
    recoveryWinRate: num(recoveryWinRate),
    recoveryAveragePnl: num(recoveryAveragePnl),
    blockerReasons: [
      ...(dailyBlock ? ["capital_governor_daily_loss_limit"] : []),
      ...(weeklyBlock ? ["capital_governor_weekly_drawdown_limit"] : []),
      ...(streakBlock ? ["capital_governor_red_day_streak"] : [])
    ],
    notes: [
      allowEntries
        ? recoveryMode
          ? `Capital governor draait in recovery met ${num(sizeMultiplier * 100, 1)}% sizing.`
          : "Capital governor ziet geen extra allocatieblokkade."
        : "Capital governor blokkeert nieuwe entries tot het verliesritme afneemt.",
      `Vandaag ${num(dailyLossFraction * 100, 2)}% verliesbudget gebruikt, 7d ${num(weeklyLossFraction * 100, 2)}%.`,
      redDayStreak
        ? `${redDayStreak} opeenvolgende rode dag(en) sturen de recovery-logica aan.`
        : "Geen actuele rode-dagen-streak zichtbaar.",
      recoveryTrades.length
        ? `Recovery window: ${recoveryTrades.length} trades, winrate ${num(recoveryWinRate * 100, 1)}%, avg ${num(recoveryAveragePnl * 100, 2)}%.`
        : "Nog geen recovery trades beschikbaar.",
      releaseReady
        ? "Recovery-release criteria zijn gehaald; sizing mag weer oplopen."
        : "Recovery-release criteria zijn nog niet volledig gehaald."
    ],
    dailyLedger: recentDays.slice(-7)
  };
}

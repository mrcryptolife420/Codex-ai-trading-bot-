import { clamp } from "../utils/math.js";
import { getRuntimeTradingSource, matchesTradingSource } from "../utils/tradingSource.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function sameUtcDay(left, right) {
  return `${left || ""}`.slice(0, 10) === `${right || ""}`.slice(0, 10);
}

function dayKey(value) {
  return `${value || ""}`.slice(0, 10);
}

function shiftUtcDay(referenceDay, deltaDays = 0) {
  const base = new Date(`${referenceDay}T00:00:00.000Z`);
  if (!Number.isFinite(base.getTime())) {
    return "";
  }
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function computeDrawdownPct(equitySnapshots = [], botMode = "paper", tradingSource = null) {
  let peak = 0;
  let maxDrawdown = 0;
  for (const snapshot of equitySnapshots) {
    if (!matchesTradingSource(snapshot, tradingSource, botMode)) {
      continue;
    }
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

function buildDailyLedger(journal = {}, botMode = "paper", tradingSource = null) {
  const ledger = new Map();
  const add = (at, amount) => {
    const key = dayKey(at);
    if (!key) {
      return;
    }
    ledger.set(key, safeNumber(ledger.get(key), 0) + safeNumber(amount, 0));
  };

  for (const trade of journal.trades || []) {
    if (!matchesTradingSource(trade, tradingSource, botMode)) {
      continue;
    }
    add(trade.exitAt || trade.entryAt, trade.pnlQuote || 0);
  }
  for (const event of journal.scaleOuts || []) {
    if (!matchesTradingSource(event, tradingSource, botMode)) {
      continue;
    }
    add(event.at, event.realizedPnl || 0);
  }

  return [...ledger.entries()]
    .map(([day, pnlQuote]) => ({ day, pnlQuote: num(pnlQuote, 2) }))
    .sort((left, right) => left.day.localeCompare(right.day));
}

function buildRecentDayWindow(dailyLedger = [], nowIso = new Date().toISOString(), lookbackDays = 7) {
  const today = dayKey(nowIso);
  if (!today) {
    return [];
  }
  const ledgerMap = new Map(dailyLedger.map((item) => [item.day, safeNumber(item.pnlQuote, 0)]));
  const totalDays = Math.max(1, Math.round(safeNumber(lookbackDays, 7)));
  const window = [];
  for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
    const day = shiftUtcDay(today, -offset);
    const traded = ledgerMap.has(day);
    window.push({
      day,
      pnlQuote: num(ledgerMap.get(day), 2),
      traded
    });
  }
  return window;
}

function computeRedDayStreak(dailyLedger = [], nowIso = new Date().toISOString()) {
  let streak = 0;
  for (let index = dailyLedger.length - 1; index >= 0; index -= 1) {
    const item = dailyLedger[index] || {};
    if (!item.traded) {
      if (sameUtcDay(item.day, nowIso)) {
        continue;
      }
      break;
    }
    if ((item.pnlQuote || 0) < 0) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

function computeRedDayStreakLoss(dailyLedger = [], nowIso = new Date().toISOString()) {
  let lossQuote = 0;
  let streak = 0;
  for (let index = dailyLedger.length - 1; index >= 0; index -= 1) {
    const item = dailyLedger[index] || {};
    if (!item.traded) {
      if (sameUtcDay(item.day, nowIso)) {
        continue;
      }
      break;
    }
    if ((item.pnlQuote || 0) < 0) {
      streak += 1;
      lossQuote += Math.abs(safeNumber(item.pnlQuote, 0));
      continue;
    }
    break;
  }
  return {
    streak,
    lossQuote: num(lossQuote, 2)
  };
}

function resolveLatestClosedTradeAt(journal = {}, botMode = "paper", tradingSource = null) {
  const timestamps = [
    ...(journal.trades || [])
      .filter((trade) => matchesTradingSource(trade, tradingSource, botMode))
      .map((trade) => trade.exitAt || trade.entryAt)
      .filter(Boolean),
    ...(journal.scaleOuts || [])
      .filter((event) => matchesTradingSource(event, tradingSource, botMode))
      .map((event) => event.at)
      .filter(Boolean)
  ]
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left);
  return timestamps.length ? new Date(timestamps[0]).toISOString() : null;
}

export function buildCapitalGovernor({
  journal = {},
  runtime = {},
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const botMode = config.botMode || "paper";
  const tradingSource = getRuntimeTradingSource(runtime, config, botMode);
  const dailyLedger = buildDailyLedger(journal, botMode, tradingSource);
  const recentDays = buildRecentDayWindow(dailyLedger, nowIso, config.capitalGovernorLookbackDays || 7);
  const todayPnl = recentDays.find((item) => sameUtcDay(item.day, nowIso))?.pnlQuote || 0;
  const weeklyPnl = recentDays.reduce((total, item) => total + safeNumber(item.pnlQuote, 0), 0);
  const startingCash = Math.max(config.startingCash || 1, 1);
  const dailyLossFraction = todayPnl < 0 ? Math.abs(todayPnl) / startingCash : 0;
  const weeklyLossFraction = weeklyPnl < 0 ? Math.abs(weeklyPnl) / startingCash : 0;
  const drawdownPct = computeDrawdownPct((journal.equitySnapshots || []).slice(-240), botMode, tradingSource);
  const redDayStreakSummary = computeRedDayStreakLoss(recentDays, nowIso);
  const redDayStreak = redDayStreakSummary.streak;
  const redDayStreakLossQuote = safeNumber(redDayStreakSummary.lossQuote, 0);
  const redDayStreakLossFraction = redDayStreakLossQuote / startingCash;
  const latestTradeAt = resolveLatestClosedTradeAt(journal, botMode, tradingSource);
  const lastClosedTradeAgeHours = latestTradeAt
    ? (new Date(nowIso).getTime() - new Date(latestTradeAt).getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const recoveryContextHours = Math.max(24, safeNumber(config.capitalGovernorRecoveryContextHours, (config.capitalGovernorLookbackDays || 7) * 24));
  const recoveryContextFresh = lastClosedTradeAgeHours <= recoveryContextHours;
  const recoveryTrades = recoveryContextFresh
    ? (journal.trades || [])
    .filter((trade) => matchesTradingSource(trade, tradingSource, botMode))
    .filter((trade) => trade.exitAt)
    .slice(-(config.capitalGovernorRecoveryTrades || 4))
    : [];
  const recoveryWinRate = recoveryTrades.length
    ? recoveryTrades.filter((trade) => (trade.pnlQuote || 0) > 0).length / recoveryTrades.length
    : 0;
  const recoveryAveragePnl = average(recoveryTrades.map((trade) => safeNumber(trade.netPnlPct, 0)), 0);
  const weeklyBlock = weeklyLossFraction >= safeNumber(config.capitalGovernorWeeklyDrawdownPct, 0.08);
  const redDayStreakMinLossFraction = Math.max(
    safeNumber(config.capitalGovernorBadDayStreakMinLossFraction, 0.003),
    Math.max(safeNumber(config.maxDailyDrawdown, 0.04) * 0.08, 0.0005)
  );
  const streakThresholdReached = redDayStreak >= safeNumber(config.capitalGovernorBadDayStreak, 3);
  const streakBlock = streakThresholdReached && redDayStreakLossFraction >= redDayStreakMinLossFraction;
  const streakWatch = streakThresholdReached && !streakBlock;
  const drawdownWatch = recoveryContextFresh && drawdownPct >= safeNumber(config.portfolioDrawdownBudgetPct, 0.05) * 0.85;
  const dailyBlock = dailyLossFraction >= safeNumber(config.maxDailyDrawdown, 0.04);
  const recoveryMode = dailyBlock || weeklyBlock || streakBlock || streakWatch || drawdownWatch;
  const allowProbeEntries = botMode === "paper" && recoveryMode;
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
    allowProbeEntries,
    recoveryMode,
    releaseReady,
    sizeMultiplier: num(sizeMultiplier),
    dailyLossFraction: num(dailyLossFraction),
    weeklyLossFraction: num(weeklyLossFraction),
    drawdownPct: num(drawdownPct),
    redDayStreak,
    redDayStreakLossQuote: num(redDayStreakLossQuote, 2),
    redDayStreakLossFraction: num(redDayStreakLossFraction),
    streakBlockActive: Boolean(streakBlock),
    streakWatchActive: Boolean(streakWatch),
    recentDayCount: recentDays.filter((item) => item.traded).length,
    latestTradeAt,
    lastClosedTradeAgeHours: Number.isFinite(lastClosedTradeAgeHours) ? num(lastClosedTradeAgeHours, 1) : null,
    recoveryTradeCount: recoveryTrades.length,
    recoveryWinRate: num(recoveryWinRate),
    recoveryAveragePnl: num(recoveryAveragePnl),
    tradingSource,
    blockerReasons: [
      ...(dailyBlock ? ["capital_governor_daily_loss_limit"] : []),
      ...(weeklyBlock ? ["capital_governor_weekly_drawdown_limit"] : []),
      ...(streakBlock ? ["capital_governor_red_day_streak"] : [])
    ],
    watchReasons: [
      ...(streakWatch ? ["capital_governor_red_day_streak_watch"] : [])
    ],
    notes: [
      allowEntries
        ? recoveryMode
          ? `Capital governor draait in recovery met ${num(sizeMultiplier * 100, 1)}% sizing.`
          : "Capital governor ziet geen extra allocatieblokkade."
        : botMode === "paper" && allowProbeEntries
          ? "Capital governor blokkeert normale entries, maar laat in paper nog kleine leertrades door."
          : "Capital governor blokkeert nieuwe entries tot het verliesritme afneemt.",
      `Vandaag ${num(dailyLossFraction * 100, 2)}% verliesbudget gebruikt, 7d ${num(weeklyLossFraction * 100, 2)}%.`,
      redDayStreak
        ? streakBlock
          ? `${redDayStreak} opeenvolgende rode dag(en) met ${num(redDayStreakLossFraction * 100, 2)}% cumulatief verlies blokkeren normale entries.`
          : `${redDayStreak} opeenvolgende rode dag(en) met slechts ${num(redDayStreakLossFraction * 100, 2)}% cumulatief verlies houden de governor in recovery, maar niet in hard block.`
        : "Geen actuele rode-dagen-streak zichtbaar.",
      latestTradeAt
        ? `Laatste gesloten trade ${num(lastClosedTradeAgeHours, 1)} uur geleden (${latestTradeAt}).`
        : "Nog geen gesloten trades beschikbaar voor capital-governor context.",
      !recoveryContextFresh && latestTradeAt
        ? "Recovery-context is stale; oude drawdown of verliesreeksen sturen de governor nu niet meer."
        : recoveryTrades.length
        ? `Recovery window: ${recoveryTrades.length} trades, winrate ${num(recoveryWinRate * 100, 1)}%, avg ${num(recoveryAveragePnl * 100, 2)}%.`
        : "Nog geen recovery trades beschikbaar.",
      releaseReady
        ? "Recovery-release criteria zijn gehaald; sizing mag weer oplopen."
        : "Recovery-release criteria zijn nog niet volledig gehaald."
    ],
    dailyLedger: recentDays.slice(-7)
  };
}

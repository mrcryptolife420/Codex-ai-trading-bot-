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

function minutesBetween(start, end) {
  const startMs = new Date(start || 0).getTime();
  const endMs = new Date(end || start || 0).getTime();
  return Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, (endMs - startMs) / 60_000)
    : 0;
}

function hoursBetween(start, end) {
  return minutesBetween(start, end) / 60;
}

function latestTradeTimestamp(trades = []) {
  const latestMs = trades
    .map((trade) => new Date(trade.exitAt || trade.entryAt || 0).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];
  return Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : null;
}

function buildBucket(id, scopeType) {
  return {
    id,
    scopeType,
    tradeCount: 0,
    wins: 0,
    pnlPct: 0,
    capture: 0,
    slippage: 0,
    holdMinutes: 0,
    mfe: 0,
    mae: 0
  };
}

function finalizeBucket(bucket, config) {
  const tradeCount = bucket.tradeCount || 0;
  const winRate = tradeCount ? bucket.wins / tradeCount : 0;
  const avgPnlPct = tradeCount ? bucket.pnlPct / tradeCount : 0;
  const avgCapture = tradeCount ? bucket.capture / tradeCount : 0;
  const avgSlip = tradeCount ? bucket.slippage / tradeCount : 0;
  const avgHoldMinutes = tradeCount ? bucket.holdMinutes / tradeCount : 0;
  const avgMae = tradeCount ? bucket.mae / tradeCount : 0;
  const thresholdShift = clamp(
    (0.5 - winRate) * 0.04 - avgPnlPct * 2.8,
    -(config.parameterGovernorMaxThresholdShift || 0.03),
    config.parameterGovernorMaxThresholdShift || 0.03
  );
  const stopLossMultiplier = clamp(
    1 + Math.max(-0.08, Math.min(0.08, Math.abs(avgMae) > 0.012 ? 0.06 : -0.03)),
    1 - (config.parameterGovernorMaxStopLossMultiplierDelta || 0.14),
    1 + (config.parameterGovernorMaxStopLossMultiplierDelta || 0.14)
  );
  const takeProfitMultiplier = clamp(
    1 + Math.max(-0.1, Math.min(0.12, avgCapture < 0.34 ? 0.08 : -0.03)),
    1 - (config.parameterGovernorMaxTakeProfitMultiplierDelta || 0.18),
    1 + (config.parameterGovernorMaxTakeProfitMultiplierDelta || 0.18)
  );
  const trailingStopMultiplier = clamp(1 + (avgCapture < 0.28 ? -0.08 : 0.04), 0.82, 1.18);
  const scaleOutTriggerMultiplier = clamp(1 + (avgCapture < 0.3 ? -0.06 : 0.05), 0.84, 1.18);
  const scaleOutFractionMultiplier = clamp(1 + (avgCapture < 0.3 ? 0.08 : -0.05), 0.84, 1.18);
  const maxHoldMinutesMultiplier = clamp(1 + (avgHoldMinutes > 320 ? -0.08 : 0.04), 0.82, 1.18);
  const executionAggressivenessBias = clamp(1 + avgSlip / 20, 0.82, 1.16);
  const governanceScore = clamp(
    0.5 +
      (winRate - 0.5) * 0.28 +
      avgPnlPct * 6 +
      avgCapture * 0.12 -
      Math.max(0, avgSlip) * 0.02,
    0,
    1
  );
  return {
    id: bucket.id,
    scopeType: bucket.scopeType,
    tradeCount,
    winRate: num(winRate),
    avgPnlPct: num(avgPnlPct),
    avgCapture: num(avgCapture),
    avgSlippageDeltaBps: num(avgSlip, 2),
    avgHoldMinutes: num(avgHoldMinutes, 1),
    thresholdShift: num(thresholdShift),
    stopLossMultiplier: num(stopLossMultiplier),
    takeProfitMultiplier: num(takeProfitMultiplier),
    trailingStopMultiplier: num(trailingStopMultiplier),
    scaleOutTriggerMultiplier: num(scaleOutTriggerMultiplier),
    scaleOutFractionMultiplier: num(scaleOutFractionMultiplier),
    maxHoldMinutesMultiplier: num(maxHoldMinutesMultiplier),
    executionAggressivenessBias: num(executionAggressivenessBias),
    governanceScore: num(governanceScore),
    status: governanceScore >= 0.6
      ? "ready"
      : governanceScore >= 0.46
        ? "observe"
        : "cooldown"
  };
}

function matchesScope(entry = {}, strategyId = null, regimeId = null) {
  if (!entry) {
    return false;
  }
  return (
    (entry.scopeType === "strategy" && entry.id === strategyId) ||
    (entry.scopeType === "regime" && entry.id === regimeId)
  );
}

export class ParameterGovernor {
  constructor(config) {
    this.config = config;
  }

  buildSnapshot({ journal = {}, nowIso = new Date().toISOString() } = {}) {
    const trades = (journal.trades || []).filter((trade) => trade.exitAt);
    const lookbackHours = safeNumber(this.config.parameterGovernorLookbackHours, 24 * 7);
    const latestTradeAt = latestTradeTimestamp(trades);
    const freshnessHours = latestTradeAt ? hoursBetween(latestTradeAt, nowIso) : null;
    const recentTrades = trades.filter((trade) => {
      if (!trade.exitAt) {
        return false;
      }
      return hoursBetween(trade.exitAt, nowIso) <= lookbackHours;
    });
    const minTrades = this.config.parameterGovernorMinTrades || 4;
    const buckets = new Map();
    const addTrade = (scopeType, id, trade) => {
      if (!id) {
        return;
      }
      const key = `${scopeType}:${id}`;
      if (!buckets.has(key)) {
        buckets.set(key, buildBucket(id, scopeType));
      }
      const bucket = buckets.get(key);
      const mfePct = Math.max(0, safeNumber(trade.mfePct, 0));
      const capture = mfePct > 0 ? clamp((trade.netPnlPct || 0) / mfePct, -1, 1.4) : (trade.netPnlPct || 0) > 0 ? 0.65 : 0.25;
      bucket.tradeCount += 1;
      bucket.wins += (trade.pnlQuote || 0) > 0 ? 1 : 0;
      bucket.pnlPct += trade.netPnlPct || 0;
      bucket.capture += Math.max(0, capture);
      bucket.slippage += safeNumber(trade.entryExecutionAttribution?.slippageDeltaBps, 0);
      bucket.holdMinutes += minutesBetween(trade.entryAt, trade.exitAt);
      bucket.mfe += mfePct;
      bucket.mae += Math.abs(safeNumber(trade.maePct, 0));
    };

    for (const trade of recentTrades) {
      addTrade("strategy", trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || null, trade);
      addTrade("regime", trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || null, trade);
    }

    if (!recentTrades.length) {
      return {
        generatedAt: nowIso,
        tradeCount: trades.length,
        recentTradeCount: 0,
        latestTradeAt,
        freshnessHours: Number.isFinite(freshnessHours) ? num(freshnessHours, 1) : null,
        status: trades.length ? "stale" : "warmup",
        strategyScopes: [],
        regimeScopes: [],
        notes: [
          trades.length
            ? `Parameter governor is stale; laatste gesloten trade is ${num(freshnessHours, 1)}u oud.`
            : "Nog te weinig gesloten trades voor parameter-governor scopes."
        ]
      };
    }

    const scopes = [...buckets.values()]
      .filter((bucket) => bucket.tradeCount >= minTrades)
      .map((bucket) => finalizeBucket(bucket, this.config))
      .sort((left, right) => right.governanceScore - left.governanceScore)
      .slice(0, 12);
    const strategyScopes = scopes.filter((item) => item.scopeType === "strategy").slice(0, 6);
    const regimeScopes = scopes.filter((item) => item.scopeType === "regime").slice(0, 6);
    return {
      generatedAt: nowIso,
      tradeCount: recentTrades.length,
      recentTradeCount: recentTrades.length,
      latestTradeAt,
      freshnessHours: Number.isFinite(freshnessHours) ? num(freshnessHours, 1) : null,
      status: scopes.length ? "active" : "warmup",
      strategyScopes,
      regimeScopes,
      notes: [
        scopes[0]
          ? `${scopes[0].scopeType} ${scopes[0].id} heeft momenteel de sterkste parameter-governor bias.`
          : "Nog te weinig gesloten trades voor parameter-governor scopes."
      ]
    };
  }

  resolve(snapshot = {}, { strategyId = null, regimeId = null } = {}) {
    const scopes = [...(snapshot.strategyScopes || []), ...(snapshot.regimeScopes || [])].filter((item) => matchesScope(item, strategyId, regimeId));
    if (!scopes.length) {
      return {
        active: false,
        thresholdShift: 0,
        stopLossMultiplier: 1,
        takeProfitMultiplier: 1,
        trailingStopMultiplier: 1,
        scaleOutTriggerMultiplier: 1,
        scaleOutFractionMultiplier: 1,
        maxHoldMinutesMultiplier: 1,
        executionAggressivenessBias: 1,
        sources: []
      };
    }
    const avg = (key, fallback = 1) => average(scopes.map((item) => safeNumber(item[key], fallback)), fallback);
    return {
      active: true,
      thresholdShift: num(avg("thresholdShift", 0)),
      stopLossMultiplier: num(avg("stopLossMultiplier", 1)),
      takeProfitMultiplier: num(avg("takeProfitMultiplier", 1)),
      trailingStopMultiplier: num(avg("trailingStopMultiplier", 1)),
      scaleOutTriggerMultiplier: num(avg("scaleOutTriggerMultiplier", 1)),
      scaleOutFractionMultiplier: num(avg("scaleOutFractionMultiplier", 1)),
      maxHoldMinutesMultiplier: num(avg("maxHoldMinutesMultiplier", 1)),
      executionAggressivenessBias: num(avg("executionAggressivenessBias", 1)),
      sources: scopes.map((item) => `${item.scopeType}:${item.id}`)
    };
  }
}

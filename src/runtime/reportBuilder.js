function safeDivide(numerator, denominator, fallback = 0) {
  return denominator ? numerator / denominator : fallback;
}

function sortByPnlDesc(trades) {
  return [...trades].sort((left, right) => (right.pnlQuote || 0) - (left.pnlQuote || 0));
}

function sortByPnlAsc(trades) {
  return [...trades].sort((left, right) => (left.pnlQuote || 0) - (right.pnlQuote || 0));
}

function buildTradeStats(trades) {
  const wins = trades.filter((trade) => trade.netPnlPct > 0);
  const losses = trades.filter((trade) => trade.netPnlPct <= 0);
  const realizedPnl = trades.reduce((total, trade) => total + (trade.pnlQuote || 0), 0);
  const grossProfit = wins.reduce((total, trade) => total + (trade.pnlQuote || 0), 0);
  const grossLossAbs = Math.abs(
    losses.reduce((total, trade) => total + Math.min(trade.pnlQuote || 0, 0), 0)
  );

  return {
    tradeCount: trades.length,
    realizedPnl,
    winRate: safeDivide(wins.length, trades.length),
    averagePnlPct: safeDivide(
      trades.reduce((total, trade) => total + (trade.netPnlPct || 0), 0),
      trades.length
    ),
    profitFactor: grossLossAbs ? grossProfit / grossLossAbs : grossProfit > 0 ? Infinity : 0,
    bestTrade: sortByPnlDesc(trades)[0] || null,
    worstTrade: sortByPnlAsc(trades)[0] || null
  };
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function buildWindowStats(trades, startMs) {
  return buildTradeStats(
    trades.filter((trade) => new Date(trade.exitAt || trade.entryAt || 0).getTime() >= startMs)
  );
}

function buildDrawdown(equitySnapshots) {
  let maxEquity = 0;
  let maxDrawdownPct = 0;
  for (const snapshot of equitySnapshots) {
    maxEquity = Math.max(maxEquity, snapshot.equity || 0);
    if (maxEquity > 0) {
      const drawdownPct = (maxEquity - snapshot.equity) / maxEquity;
      maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    }
  }
  return maxDrawdownPct;
}

function average(values = []) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function buildScaleOutSummary(scaleOuts = []) {
  return {
    count: scaleOuts.length,
    realizedPnl: scaleOuts.reduce((total, item) => total + (item.realizedPnl || 0), 0),
    averageFraction: average(scaleOuts.map((item) => item.fraction || 0))
  };
}

function parseTimestampMs(value) {
  if (!value) {
    return Number.NaN;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function buildRecentEvents(events = [], runtime = {}, now = new Date()) {
  const referenceMs = Math.max(
    parseTimestampMs(runtime.lastCycleAt),
    parseTimestampMs(runtime.lastAnalysisAt),
    parseTimestampMs(runtime.lastPortfolioUpdateAt),
    parseTimestampMs(runtime.health?.lastSuccessAt)
  );

  if (!Number.isFinite(referenceMs)) {
    return [...events].slice(-25).reverse();
  }

  const recentWindowStartMs = Math.min(now.getTime(), referenceMs) - 15 * 60 * 1000;
  return [...events]
    .filter((event) => parseTimestampMs(event.at || event.timestamp || event.createdAt) >= recentWindowStartMs)
    .slice(-25)
    .reverse();
}

function buildExecutionSummary(trades) {
  const entryStyles = {};
  const strategyBuckets = {};
  let totalPreventedQuantity = 0;
  let preventedMatchCount = 0;
  let peggedCount = 0;
  let sorCount = 0;
  const entrySlippages = [];
  const exitSlippages = [];
  const makerRatios = [];
  const expectedEntrySlippages = [];
  const slippageDeltas = [];
  const executionQualityScores = [];

  for (const trade of trades) {
    const entry = trade.entryExecutionAttribution || {};
    const exit = trade.exitExecutionAttribution || {};
    const style = entry.entryStyle || "unknown";
    const strategyId = trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown";
    if (!entryStyles[style]) {
      entryStyles[style] = {
        style,
        tradeCount: 0,
        realizedPnl: 0,
        avgEntryTouchSlippageBps: 0,
        avgMakerFillRatio: 0,
        peggedCount: 0,
        preventedQuantity: 0
      };
    }
    if (!strategyBuckets[strategyId]) {
      strategyBuckets[strategyId] = {
        id: strategyId,
        tradeCount: 0,
        realizedPnl: 0,
        avgExpectedEntrySlippageBps: 0,
        avgEntryTouchSlippageBps: 0,
        avgSlippageDeltaBps: 0,
        avgMakerFillRatio: 0,
        averageExecutionQuality: 0
      };
    }
    entryStyles[style].tradeCount += 1;
    entryStyles[style].realizedPnl += trade.pnlQuote || 0;
    entryStyles[style].avgEntryTouchSlippageBps += entry.realizedTouchSlippageBps || 0;
    entryStyles[style].avgMakerFillRatio += entry.makerFillRatio || 0;
    entryStyles[style].preventedQuantity += entry.preventedQuantity || 0;
    if (entry.peggedOrder) {
      entryStyles[style].peggedCount += 1;
      peggedCount += 1;
    }
    if (entry.usedSor || exit.usedSor) {
      sorCount += 1;
    }

    const strategy = strategyBuckets[strategyId];
    strategy.tradeCount += 1;
    strategy.realizedPnl += trade.pnlQuote || 0;
    strategy.avgExpectedEntrySlippageBps += entry.expectedSlippageBps || entry.expectedImpactBps || 0;
    strategy.avgEntryTouchSlippageBps += entry.realizedTouchSlippageBps || 0;
    strategy.avgSlippageDeltaBps += entry.slippageDeltaBps || ((entry.realizedTouchSlippageBps || 0) - (entry.expectedSlippageBps || entry.expectedImpactBps || 0));
    strategy.avgMakerFillRatio += entry.makerFillRatio || 0;
    strategy.averageExecutionQuality += trade.executionQualityScore || 0;

    totalPreventedQuantity += (entry.preventedQuantity || 0) + (exit.preventedQuantity || 0);
    preventedMatchCount += (entry.preventedMatchCount || 0) + (exit.preventedMatchCount || 0);
    if (entry.expectedSlippageBps != null || entry.expectedImpactBps != null) {
      expectedEntrySlippages.push(entry.expectedSlippageBps || entry.expectedImpactBps || 0);
    }
    if (entry.realizedTouchSlippageBps != null) {
      entrySlippages.push(entry.realizedTouchSlippageBps || 0);
    }
    if (exit.realizedTouchSlippageBps != null) {
      exitSlippages.push(exit.realizedTouchSlippageBps || 0);
    }
    if (entry.slippageDeltaBps != null) {
      slippageDeltas.push(entry.slippageDeltaBps || 0);
    } else if (entry.realizedTouchSlippageBps != null) {
      slippageDeltas.push((entry.realizedTouchSlippageBps || 0) - (entry.expectedSlippageBps || entry.expectedImpactBps || 0));
    }
    if (entry.makerFillRatio != null) {
      makerRatios.push(entry.makerFillRatio || 0);
    }
    if (trade.executionQualityScore != null) {
      executionQualityScores.push(trade.executionQualityScore || 0);
    }
  }

  const styles = Object.values(entryStyles)
    .map((item) => ({
      ...item,
      avgEntryTouchSlippageBps: item.tradeCount ? item.avgEntryTouchSlippageBps / item.tradeCount : 0,
      avgMakerFillRatio: item.tradeCount ? item.avgMakerFillRatio / item.tradeCount : 0
    }))
    .sort((left, right) => right.tradeCount - left.tradeCount);

  const strategies = Object.values(strategyBuckets)
    .map((item) => ({
      ...item,
      avgExpectedEntrySlippageBps: item.tradeCount ? item.avgExpectedEntrySlippageBps / item.tradeCount : 0,
      avgEntryTouchSlippageBps: item.tradeCount ? item.avgEntryTouchSlippageBps / item.tradeCount : 0,
      avgSlippageDeltaBps: item.tradeCount ? item.avgSlippageDeltaBps / item.tradeCount : 0,
      avgMakerFillRatio: item.tradeCount ? item.avgMakerFillRatio / item.tradeCount : 0,
      averageExecutionQuality: item.tradeCount ? item.averageExecutionQuality / item.tradeCount : 0
    }))
    .sort((left, right) => right.realizedPnl - left.realizedPnl)
    .slice(0, 8);

  return {
    avgExpectedEntrySlippageBps: average(expectedEntrySlippages),
    avgEntryTouchSlippageBps: average(entrySlippages),
    avgExitTouchSlippageBps: average(exitSlippages),
    avgSlippageDeltaBps: average(slippageDeltas),
    avgMakerFillRatio: average(makerRatios),
    avgExecutionQualityScore: average(executionQualityScores),
    totalPreventedQuantity,
    preventedMatchCount,
    peggedCount,
    sorCount,
    styles,
    strategies
  };
}

function buildModeStats(trades = [], brokerMode = "paper") {
  const filtered = trades.filter((trade) => (trade.brokerMode || "paper") === brokerMode);
  const stats = buildTradeStats(filtered);
  return {
    ...stats,
    averageExecutionQuality: average(filtered.map((trade) => trade.executionQualityScore || 0))
  };
}

function buildAttributionBuckets(trades = [], keyFn) {
  const buckets = new Map();
  for (const trade of trades) {
    const id = keyFn(trade) || "unknown";
    if (!buckets.has(id)) {
      buckets.set(id, { id, tradeCount: 0, winCount: 0, realizedPnl: 0, pnlPctSum: 0, durationMinutes: 0 });
    }
    const bucket = buckets.get(id);
    bucket.tradeCount += 1;
    bucket.winCount += (trade.pnlQuote || 0) > 0 ? 1 : 0;
    bucket.realizedPnl += trade.pnlQuote || 0;
    bucket.pnlPctSum += trade.netPnlPct || 0;
    if (trade.entryAt && trade.exitAt) {
      bucket.durationMinutes += Math.max(0, (new Date(trade.exitAt).getTime() - new Date(trade.entryAt).getTime()) / 60000);
    }
  }
  return [...buckets.values()]
    .map((bucket) => ({
      id: bucket.id,
      tradeCount: bucket.tradeCount,
      winRate: safeDivide(bucket.winCount, bucket.tradeCount),
      realizedPnl: bucket.realizedPnl,
      averagePnlPct: safeDivide(bucket.pnlPctSum, bucket.tradeCount),
      averageDurationMinutes: safeDivide(bucket.durationMinutes, bucket.tradeCount)
    }))
    .sort((left, right) => right.realizedPnl - left.realizedPnl)
    .slice(0, 8);
}

function topNewsProvider(trade) {
  return trade.entryRationale?.providerBreakdown?.[0]?.name || trade.newsSummary?.providerBreakdown?.[0]?.name || "none";
}

function buildAttributionSummary(trades = []) {
  return {
    strategies: buildAttributionBuckets(trades, (trade) => trade.strategyAtEntry || "unknown"),
    regimes: buildAttributionBuckets(trades, (trade) => trade.regimeAtEntry || "unknown"),
    symbols: buildAttributionBuckets(trades, (trade) => trade.symbol || "unknown"),
    executionStyles: buildAttributionBuckets(trades, (trade) => trade.entryExecutionAttribution?.entryStyle || "unknown"),
    newsProviders: buildAttributionBuckets(trades, topNewsProvider)
  };
}

export function buildPerformanceReport({ journal, runtime, config, now = new Date() }) {
  const trades = [...(journal.trades || [])];
  const scaleOuts = [...(journal.scaleOuts || [])];
  const blockedSetups = [...(journal.blockedSetups || [])];
  const researchRuns = [...(journal.researchRuns || [])];
  const equitySnapshots = [...(journal.equitySnapshots || [])];
  const lookbackTrades = trades.slice(-config.reportLookbackTrades);
  const openExposure = (runtime.openPositions || []).reduce(
    (total, position) => total + (position.notional || position.quantity * position.entryPrice),
    0
  );
  const nowMs = now.getTime();
  const localDayStartMs = startOfLocalDay(now);

  return {
    ...buildTradeStats(lookbackTrades),
    maxDrawdownPct: buildDrawdown(equitySnapshots),
    openExposure,
    openPositions: (runtime.openPositions || []).length,
    recentTrades: lookbackTrades.slice(-25).reverse(),
    executionSummary: buildExecutionSummary(lookbackTrades),
    attribution: buildAttributionSummary(trades),
    scaleOutSummary: buildScaleOutSummary(scaleOuts),
    windows: {
      today: buildWindowStats(trades, localDayStartMs),
      days7: buildWindowStats(trades, nowMs - 7 * 86_400_000),
      days15: buildWindowStats(trades, nowMs - 15 * 86_400_000),
      days30: buildWindowStats(trades, nowMs - 30 * 86_400_000),
      allTime: buildTradeStats(trades)
    },
    modes: {
      paper: buildModeStats(trades, "paper"),
      live: buildModeStats(trades, "live")
    },
    equitySeries: equitySnapshots.slice(-(config.dashboardEquityPointLimit || 240)),
    cycleSeries: [...(journal.cycles || [])].slice(-(config.dashboardCyclePointLimit || 120)),
    recentEvents: buildRecentEvents(journal.events || [], runtime, now),
    recentScaleOuts: scaleOuts.slice(-20).reverse(),
    recentBlockedSetups: blockedSetups.slice(-20).reverse(),
    recentResearchRuns: researchRuns.slice(-8).reverse()
  };
}

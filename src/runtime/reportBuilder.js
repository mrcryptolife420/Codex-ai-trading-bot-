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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function estimateEntryFee(trade = {}) {
  if (Number.isFinite(trade.entryFee)) {
    return Math.max(0, trade.entryFee);
  }
  const grossEntry = (trade.entryPrice || 0) * (trade.quantity || 0);
  return Math.max(0, (trade.totalCost || 0) - grossEntry);
}

function estimateExitFee(trade = {}) {
  const grossExit = (trade.exitPrice || 0) * (trade.quantity || 0);
  const realizedProceeds = Number.isFinite(trade.proceeds) ? trade.proceeds : grossExit;
  return Math.max(0, grossExit - realizedProceeds);
}

function buildExecutionCostBreakdown(trade = {}) {
  const entry = trade.entryExecutionAttribution || {};
  const exit = trade.exitExecutionAttribution || {};
  const notional = Math.max(trade.totalCost || trade.quantity * trade.entryPrice || 0, 1);
  const entryFee = estimateEntryFee(trade);
  const exitFee = estimateExitFee(trade);
  const feeBps = safeDivide(entryFee + exitFee, notional) * 10_000;
  const touchSlippageBps = Math.max(0, entry.realizedTouchSlippageBps || 0) + Math.max(0, exit.realizedTouchSlippageBps || 0);
  const slippageDeltaBps = Math.max(0, entry.slippageDeltaBps || 0) + Math.max(0, exit.slippageDeltaBps || 0);
  const latencyBps = Math.max(0, entry.latencyBps || 0) + Math.max(0, exit.latencyBps || 0);
  const queueBps = Math.max(0, entry.queueDecayBps || 0) + Math.max(0, exit.queueDecayBps || 0);
  const spreadShockBps = Math.max(0, entry.spreadShockBps || 0) + Math.max(0, exit.spreadShockBps || 0);
  const liquidityShockBps = Math.max(0, entry.liquidityShockBps || 0) + Math.max(0, exit.liquidityShockBps || 0);
  return {
    entryFee,
    exitFee,
    totalFees: entryFee + exitFee,
    feeBps,
    touchSlippageBps,
    slippageDeltaBps,
    latencyBps,
    queueBps,
    spreadShockBps,
    liquidityShockBps,
    totalCostBps: feeBps + touchSlippageBps
  };
}

function buildExecutionCostBuckets(trades = [], keyFn, config = {}) {
  const buckets = new Map();
  const warnBps = config.executionCostBudgetWarnBps || 12;
  const blockBps = config.executionCostBudgetBlockBps || 18;
  for (const trade of trades) {
    const id = keyFn(trade) || "unknown";
    if (!buckets.has(id)) {
      buckets.set(id, {
        id,
        tradeCount: 0,
        realizedPnl: 0,
        totalCostBps: 0,
        totalFeeBps: 0,
        totalTouchSlippageBps: 0,
        totalSlippageDeltaBps: 0
      });
    }
    const bucket = buckets.get(id);
    const cost = buildExecutionCostBreakdown(trade);
    bucket.tradeCount += 1;
    bucket.realizedPnl += trade.pnlQuote || 0;
    bucket.totalCostBps += cost.totalCostBps;
    bucket.totalFeeBps += cost.feeBps;
    bucket.totalTouchSlippageBps += cost.touchSlippageBps;
    bucket.totalSlippageDeltaBps += cost.slippageDeltaBps;
  }
  return [...buckets.values()]
    .map((bucket) => {
      const averageTotalCostBps = safeDivide(bucket.totalCostBps, bucket.tradeCount);
      const averageFeeBps = safeDivide(bucket.totalFeeBps, bucket.tradeCount);
      const averageTouchSlippageBps = safeDivide(bucket.totalTouchSlippageBps, bucket.tradeCount);
      const averageSlippageDeltaBps = safeDivide(bucket.totalSlippageDeltaBps, bucket.tradeCount);
      return {
        id: bucket.id,
        tradeCount: bucket.tradeCount,
        realizedPnl: bucket.realizedPnl,
        averageTotalCostBps,
        averageFeeBps,
        averageTouchSlippageBps,
        averageSlippageDeltaBps,
        status: averageTotalCostBps >= blockBps
          ? "blocked"
          : averageTotalCostBps >= warnBps || averageSlippageDeltaBps >= warnBps * 0.35
            ? "caution"
            : "ready"
      };
    })
    .sort((left, right) => (right.averageTotalCostBps || 0) - (left.averageTotalCostBps || 0))
    .slice(0, 8);
}

function buildExecutionCostSummary(trades = [], config = {}) {
  const costs = trades.map((trade) => buildExecutionCostBreakdown(trade));
  const styles = buildExecutionCostBuckets(trades, (trade) => trade.entryExecutionAttribution?.entryStyle || "unknown", config);
  const strategies = buildExecutionCostBuckets(trades, (trade) => trade.strategyAtEntry || "unknown", config);
  const regimes = buildExecutionCostBuckets(trades, (trade) => trade.regimeAtEntry || "unknown", config);
  const averageTotalCostBps = average(costs.map((item) => item.totalCostBps || 0));
  const averageFeeBps = average(costs.map((item) => item.feeBps || 0));
  const averageTouchSlippageBps = average(costs.map((item) => item.touchSlippageBps || 0));
  const averageSlippageDeltaBps = average(costs.map((item) => item.slippageDeltaBps || 0));
  const worstStyle = styles[0] || null;
  const worstStrategy = strategies[0] || null;
  const status = worstStyle?.status === "blocked" || worstStrategy?.status === "blocked"
    ? "blocked"
    : worstStyle?.status === "caution" || worstStrategy?.status === "caution"
      ? "caution"
      : trades.length
        ? "ready"
        : "warmup";
  return {
    status,
    averageTotalCostBps,
    averageFeeBps,
    averageTouchSlippageBps,
    averageSlippageDeltaBps,
    worstStyle: worstStyle?.id || null,
    worstStrategy: worstStrategy?.id || null,
    styles,
    strategies,
    regimes,
    notes: [
      worstStyle
        ? `${worstStyle.id} heeft momenteel de duurste execution-cost profile.`
        : "Nog geen execution-cost budget data beschikbaar.",
      averageFeeBps
        ? `Gemiddelde fee-impact: ${averageFeeBps.toFixed(2)} bps.`
        : "Fee-impact is nog niet zichtbaar in de huidige sample.",
      averageTouchSlippageBps
        ? `Gemiddelde touch slippage: ${averageTouchSlippageBps.toFixed(2)} bps.`
        : "Touch slippage is nog niet zichtbaar in de huidige sample."
    ]
  };
}

function buildPnlDecomposition(trades = []) {
  const breakdowns = trades.map((trade) => {
    const grossMovePnl = ((trade.exitPrice || 0) - (trade.entryPrice || 0)) * (trade.quantity || 0);
    const cost = buildExecutionCostBreakdown(trade);
    return {
      netRealizedPnl: trade.pnlQuote || 0,
      grossMovePnl,
      totalFees: cost.totalFees,
      executionDragEstimate: ((trade.totalCost || 0) * (cost.touchSlippageBps || 0)) / 10_000,
      latencyDragEstimate: ((trade.totalCost || 0) * (cost.latencyBps || 0)) / 10_000,
      queueDragEstimate: ((trade.totalCost || 0) * (cost.queueBps || 0)) / 10_000,
      captureEfficiency: trade.captureEfficiency || 0
    };
  });
  return {
    netRealizedPnl: breakdowns.reduce((total, item) => total + item.netRealizedPnl, 0),
    grossMovePnl: breakdowns.reduce((total, item) => total + item.grossMovePnl, 0),
    totalFees: breakdowns.reduce((total, item) => total + item.totalFees, 0),
    executionDragEstimate: breakdowns.reduce((total, item) => total + item.executionDragEstimate, 0),
    latencyDragEstimate: breakdowns.reduce((total, item) => total + item.latencyDragEstimate, 0),
    queueDragEstimate: breakdowns.reduce((total, item) => total + item.queueDragEstimate, 0),
    averageCaptureEfficiency: average(breakdowns.map((item) => item.captureEfficiency || 0)),
    notes: [
      breakdowns.length
        ? `${breakdowns.length} trades voeden de PnL-decomposition.`
        : "Nog geen trades beschikbaar voor PnL-decomposition.",
      breakdowns.length
        ? "Execution drag is een schatting op basis van slippage- en latency-attributie."
        : "Execution drag schattingen volgen zodra er trades beschikbaar zijn."
    ]
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

export function buildTradeQualityReview(trade = {}) {
  const entry = trade.entryExecutionAttribution || {};
  const rationale = trade.entryRationale || {};
  const signalEdge = (rationale.probability || trade.probabilityAtEntry || 0) - (rationale.threshold || 0);
  const setupScore = clamp(
    0.34 +
      (trade.labelScore || 0.5) * 0.22 +
      Math.max(0, signalEdge) * 1.2 * 0.18 +
      (rationale.strategy?.fitScore || 0) * 0.14 +
      (rationale.meta?.qualityScore || rationale.meta?.score || 0) * 0.12 +
      (rationale.timeframe?.alignmentScore || 0) * 0.08 -
      (rationale.newsRisk || 0) * 0.08 -
      ((rationale.blockerReasons || []).length ? 0.04 : 0),
    0,
    1
  );
  const executionScore = clamp(
    0.34 +
      (trade.executionQualityScore || 0) * 0.32 +
      Math.max(0, 1 - Math.min(Math.abs(entry.slippageDeltaBps || 0) / 8, 1)) * 0.18 +
      Math.max(0, 1 - Math.min((entry.realizedTouchSlippageBps || 0) / 12, 1)) * 0.08 +
      (entry.makerFillRatio || 0) * 0.08,
    0,
    1
  );
  const outcomeScore = clamp(
    0.32 +
      clamp(0.5 + (trade.netPnlPct || 0) * 10, 0, 1) * 0.34 +
      clamp(0.5 + (trade.captureEfficiency || 0) * 0.35, 0, 1) * 0.16 +
      clamp(0.5 + ((trade.mfePct || 0) - Math.abs(trade.maePct || 0)) * 6, 0, 1) * 0.18,
    0,
    1
  );
  const compositeScore = clamp(setupScore * 0.38 + executionScore * 0.28 + outcomeScore * 0.34, 0, 1);
  let verdict = "acceptable";
  if (compositeScore >= 0.74 && (trade.pnlQuote || 0) >= 0) {
    verdict = "great_trade";
  } else if (executionScore < 0.45 && setupScore >= 0.56) {
    verdict = "execution_drag";
  } else if (setupScore < 0.45 && (trade.pnlQuote || 0) <= 0) {
    verdict = "weak_setup";
  } else if (outcomeScore < 0.4 && setupScore >= 0.56) {
    verdict = "follow_through_failed";
  } else if (compositeScore < 0.45) {
    verdict = "needs_review";
  }
  const notes = [];
  if (setupScore >= 0.62) {
    notes.push("setup_quality_strong");
  }
  if (setupScore < 0.45) {
    notes.push("setup_quality_weak");
  }
  if (executionScore < 0.46) {
    notes.push("execution_quality_soft");
  }
  if ((entry.slippageDeltaBps || 0) > 2.5) {
    notes.push("slippage_above_expectation");
  }
  if (outcomeScore < 0.42) {
    notes.push("outcome_capture_soft");
  }
  if ((trade.captureEfficiency || 0) > 0.75) {
    notes.push("capture_efficiency_strong");
  }
  return {
    setupScore: Number(setupScore.toFixed(4)),
    executionScore: Number(executionScore.toFixed(4)),
    outcomeScore: Number(outcomeScore.toFixed(4)),
    compositeScore: Number(compositeScore.toFixed(4)),
    verdict,
    notes: notes.slice(0, 4)
  };
}

function buildTradeQualitySummary(trades = [], counterfactuals = []) {
  const reviews = trades.map((trade) => ({ trade, review: buildTradeQualityReview(trade) }));
  const verdictCounts = {};
  const strategyBuckets = new Map();
  for (const item of reviews) {
    verdictCounts[item.review.verdict] = (verdictCounts[item.review.verdict] || 0) + 1;
    const id = item.trade.strategyAtEntry || item.trade.entryRationale?.strategy?.activeStrategy || "unknown";
    if (!strategyBuckets.has(id)) {
      strategyBuckets.set(id, {
        id,
        tradeCount: 0,
        reviewScore: 0,
        setupScore: 0,
        executionScore: 0,
        outcomeScore: 0,
        winCount: 0,
        realizedPnl: 0,
        falseNegativeCount: 0
      });
    }
    const bucket = strategyBuckets.get(id);
    bucket.tradeCount += 1;
    bucket.reviewScore += item.review.compositeScore;
    bucket.setupScore += item.review.setupScore;
    bucket.executionScore += item.review.executionScore;
    bucket.outcomeScore += item.review.outcomeScore;
    bucket.winCount += (item.trade.pnlQuote || 0) > 0 ? 1 : 0;
    bucket.realizedPnl += item.trade.pnlQuote || 0;
  }
  for (const item of counterfactuals.filter((entry) => entry.outcome === "missed_winner")) {
    const id = item.strategy || item.strategyAtEntry || "blocked_setup";
    if (!strategyBuckets.has(id)) {
      strategyBuckets.set(id, {
        id,
        tradeCount: 0,
        reviewScore: 0,
        setupScore: 0,
        executionScore: 0,
        outcomeScore: 0,
        winCount: 0,
        realizedPnl: 0,
        falseNegativeCount: 0
      });
    }
    strategyBuckets.get(id).falseNegativeCount += 1;
  }
  const strategyScorecards = [...strategyBuckets.values()]
    .map((bucket) => ({
      id: bucket.id,
      tradeCount: bucket.tradeCount,
      winRate: Number(safeDivide(bucket.winCount, bucket.tradeCount).toFixed(4)),
      realizedPnl: Number(bucket.realizedPnl.toFixed(2)),
      avgReviewScore: Number(safeDivide(bucket.reviewScore, bucket.tradeCount).toFixed(4)),
      avgSetupScore: Number(safeDivide(bucket.setupScore, bucket.tradeCount).toFixed(4)),
      avgExecutionScore: Number(safeDivide(bucket.executionScore, bucket.tradeCount).toFixed(4)),
      avgOutcomeScore: Number(safeDivide(bucket.outcomeScore, bucket.tradeCount).toFixed(4)),
      falseNegativeCount: bucket.falseNegativeCount,
      governanceScore: Number(clamp(safeDivide(bucket.reviewScore, bucket.tradeCount, 0.42) * 0.66 + safeDivide(bucket.winCount, bucket.tradeCount, 0.5) * 0.2 + clamp(0.5 + bucket.realizedPnl / Math.max(bucket.tradeCount * 60, 60), 0, 1) * 0.14 - Math.min(bucket.falseNegativeCount, 3) * 0.03, 0, 1).toFixed(4))
    }))
    .sort((left, right) => right.governanceScore - left.governanceScore)
    .slice(0, 8);
  return {
    averageCompositeScore: average(reviews.map((item) => item.review.compositeScore)),
    averageSetupScore: average(reviews.map((item) => item.review.setupScore)),
    averageExecutionScore: average(reviews.map((item) => item.review.executionScore)),
    averageOutcomeScore: average(reviews.map((item) => item.review.outcomeScore)),
    verdictCounts,
    bestTrade: reviews.sort((left, right) => right.review.compositeScore - left.review.compositeScore)[0] || null,
    worstTrade: reviews.sort((left, right) => left.review.compositeScore - right.review.compositeScore)[0] || null,
    strategyScorecards,
    notes: [
      strategyScorecards[0]
        ? `${strategyScorecards[0].id} leidt momenteel in trade quality review.`
        : "Nog geen trade quality review data beschikbaar.",
      verdictCounts.execution_drag
        ? `${verdictCounts.execution_drag} trades verloren kwaliteit door execution.`
        : "Geen duidelijke execution drag in de recente trades.",
      verdictCounts.follow_through_failed
        ? `${verdictCounts.follow_through_failed} trades hadden goede setup maar zwakke follow-through.`
        : "Follow-through ziet er voorlopig stabiel uit."
    ]
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
  const tradeQualityReview = buildTradeQualitySummary(trades, journal.counterfactuals || []);
  const executionCostSummary = buildExecutionCostSummary(lookbackTrades, config);
  const pnlDecomposition = buildPnlDecomposition(lookbackTrades);

  return {
    ...buildTradeStats(lookbackTrades),
    maxDrawdownPct: buildDrawdown(equitySnapshots),
    openExposure,
    openPositions: (runtime.openPositions || []).length,
    recentTrades: lookbackTrades.slice(-25).reverse(),
    executionSummary: buildExecutionSummary(lookbackTrades),
    executionCostSummary,
    pnlDecomposition,
    attribution: buildAttributionSummary(trades),
    tradeQualityReview,
    recentReviews: lookbackTrades.slice(-20).reverse().map((trade) => ({
      id: trade.id,
      symbol: trade.symbol,
      strategy: trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || null,
      pnlQuote: trade.pnlQuote || 0,
      netPnlPct: trade.netPnlPct || 0,
      ...buildTradeQualityReview(trade)
    })),
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

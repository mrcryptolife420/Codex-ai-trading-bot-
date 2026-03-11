import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function buildModeBuckets(trades = []) {
  const buckets = new Map();
  for (const trade of trades) {
    const strategyId = trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown";
    if (!buckets.has(strategyId)) {
      buckets.set(strategyId, { paper: [], live: [] });
    }
    const mode = (trade.brokerMode || "paper") === "live" ? "live" : "paper";
    buckets.get(strategyId)[mode].push(trade);
  }
  return buckets;
}

function summarizeTradeSet(trades = []) {
  return {
    tradeCount: trades.length,
    winRate: average(trades.map((trade) => ((trade.pnlQuote || 0) > 0 ? 1 : 0)), 0),
    avgPnlPct: average(trades.map((trade) => trade.netPnlPct || 0), 0),
    avgExecutionQuality: average(trades.map((trade) => trade.executionQualityScore || 0), 0.5),
    avgSlippageDeltaBps: average(trades.map((trade) => trade.entryExecutionAttribution?.slippageDeltaBps || 0), 0),
    avgMakerFillRatio: average(trades.map((trade) => trade.entryExecutionAttribution?.makerFillRatio || 0), 0),
    realizedPnl: trades.reduce((total, trade) => total + (trade.pnlQuote || 0), 0)
  };
}

export class DivergenceMonitor {
  constructor(config) {
    this.config = config;
  }

  buildSummary({ journal = {}, nowIso = new Date().toISOString() } = {}) {
    const trades = (journal.trades || []).filter((trade) => trade.exitAt);
    const buckets = buildModeBuckets(trades);
    const perStrategy = [];

    for (const [strategyId, modes] of buckets) {
      const paper = summarizeTradeSet(modes.paper || []);
      const live = summarizeTradeSet(modes.live || []);
      const comparable = paper.tradeCount >= this.config.divergenceMinPaperTrades && live.tradeCount >= this.config.divergenceMinLiveTrades;
      const pnlGap = live.avgPnlPct - paper.avgPnlPct;
      const slipGap = live.avgSlippageDeltaBps - paper.avgSlippageDeltaBps;
      const winRateGap = live.winRate - paper.winRate;
      const executionGap = live.avgExecutionQuality - paper.avgExecutionQuality;
      const divergenceScore = comparable
        ? clamp(
            Math.abs(pnlGap) * 14 +
              Math.abs(slipGap) / Math.max(this.config.divergenceAlertSlipGapBps || 3, 1) * 0.34 +
              Math.abs(winRateGap) * 1.1 +
              Math.abs(executionGap) * 0.8,
            0,
            1
          )
        : 0;
      perStrategy.push({
        id: strategyId,
        comparable,
        divergenceScore: num(divergenceScore),
        paper: {
          tradeCount: paper.tradeCount,
          winRate: num(paper.winRate),
          avgPnlPct: num(paper.avgPnlPct),
          avgExecutionQuality: num(paper.avgExecutionQuality),
          avgSlippageDeltaBps: num(paper.avgSlippageDeltaBps, 2),
          avgMakerFillRatio: num(paper.avgMakerFillRatio),
          realizedPnl: num(paper.realizedPnl, 2)
        },
        live: {
          tradeCount: live.tradeCount,
          winRate: num(live.winRate),
          avgPnlPct: num(live.avgPnlPct),
          avgExecutionQuality: num(live.avgExecutionQuality),
          avgSlippageDeltaBps: num(live.avgSlippageDeltaBps, 2),
          avgMakerFillRatio: num(live.avgMakerFillRatio),
          realizedPnl: num(live.realizedPnl, 2)
        },
        gaps: {
          pnlPct: num(pnlGap),
          slipBps: num(slipGap, 2),
          winRate: num(winRateGap),
          executionQuality: num(executionGap)
        },
        status: !comparable
          ? "warming_up"
          : divergenceScore >= this.config.divergenceBlockScore
            ? "blocked"
            : divergenceScore >= this.config.divergenceAlertScore
              ? "watch"
              : "aligned"
      });
    }

    perStrategy.sort((left, right) => right.divergenceScore - left.divergenceScore);
    const comparable = perStrategy.filter((item) => item.comparable);
    const averageScore = average(comparable.map((item) => item.divergenceScore), 0);
    return {
      generatedAt: nowIso,
      strategyCount: perStrategy.length,
      comparableStrategyCount: comparable.length,
      averageScore: num(averageScore),
      blockerCount: perStrategy.filter((item) => item.status === "blocked").length,
      watchCount: perStrategy.filter((item) => item.status === "watch").length,
      leadBlocker: perStrategy.find((item) => item.status === "blocked") || null,
      strategies: perStrategy.slice(0, 10),
      notes: perStrategy.find((item) => item.status === "blocked")
        ? [`${perStrategy.find((item) => item.status === "blocked")?.id} wijkt live te ver af van paper.`]
        : ["Live vs paper gedrag blijft binnen de ingestelde marges."]
    };
  }
}

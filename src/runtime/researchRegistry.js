import { clamp } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function expDecayWeight(at, nowMs) {
  const atMs = new Date(at || 0).getTime();
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return 0.5;
  }
  const ageDays = Math.max(0, (nowMs - atMs) / 86400000);
  return Math.exp(-ageDays / 30);
}

function createSymbolBucket(symbol) {
  return {
    symbol,
    runs: 0,
    experiments: 0,
    totalTrades: 0,
    realizedPnl: 0,
    weightedSharpe: 0,
    weightedWinRate: 0,
    weightTotal: 0,
    maxDrawdownPct: 0,
    leaders: new Set(),
    lastRunAt: null
  };
}

function finalizeBucket(bucket, config) {
  const averageSharpe = bucket.weightTotal ? bucket.weightedSharpe / bucket.weightTotal : 0;
  const averageWinRate = bucket.weightTotal ? bucket.weightedWinRate / bucket.weightTotal : 0;
  const governanceScore = clamp(
    0.45 +
      averageSharpe * 0.18 +
      (averageWinRate - 0.5) * 0.35 +
      Math.max(-0.18, Math.min(0.18, bucket.realizedPnl / 1500)) -
      bucket.maxDrawdownPct * 1.4,
    0,
    1
  );
  const status =
    bucket.totalTrades >= config.researchPromotionMinTrades &&
    averageSharpe >= config.researchPromotionMinSharpe &&
    bucket.maxDrawdownPct <= config.researchPromotionMaxDrawdownPct &&
    bucket.realizedPnl > 0
      ? "promotion_candidate"
      : bucket.totalTrades >= Math.max(3, Math.floor(config.researchPromotionMinTrades / 2)) && averageSharpe > 0
        ? "observe"
        : "hold";

  return {
    symbol: bucket.symbol,
    runs: bucket.runs,
    experiments: bucket.experiments,
    totalTrades: bucket.totalTrades,
    realizedPnl: num(bucket.realizedPnl, 2),
    averageSharpe: num(averageSharpe, 3),
    averageWinRate: num(averageWinRate),
    maxDrawdownPct: num(bucket.maxDrawdownPct),
    governanceScore: num(governanceScore),
    status,
    leaders: [...bucket.leaders].slice(0, 6),
    lastRunAt: bucket.lastRunAt
  };
}

function mapLeaderBucket(items = []) {
  return items.slice(0, 6).map((item) => ({
    id: item.id,
    tradeCount: item.tradeCount || 0,
    realizedPnl: num(item.realizedPnl || 0, 2),
    winRate: num(item.winRate || 0, 4)
  }));
}

function buildStrategyScorecards(runs = []) {
  const map = new Map();
  for (const run of runs) {
    for (const report of run.reports || []) {
      for (const item of report.strategyScorecards || []) {
        if (!map.has(item.id)) {
          map.set(item.id, { id: item.id, tradeCount: 0, realizedPnl: 0, governanceScore: 0, reviewScore: 0, winRate: 0, count: 0 });
        }
        const bucket = map.get(item.id);
        bucket.tradeCount += item.tradeCount || 0;
        bucket.realizedPnl += safeNumber(item.realizedPnl);
        bucket.governanceScore += safeNumber(item.governanceScore);
        bucket.reviewScore += safeNumber(item.averageReviewScore);
        bucket.winRate += safeNumber(item.winRate);
        bucket.count += 1;
      }
    }
  }
  return [...map.values()].map((bucket) => ({
    id: bucket.id,
    tradeCount: bucket.tradeCount,
    realizedPnl: num(bucket.realizedPnl, 2),
    governanceScore: num(bucket.count ? bucket.governanceScore / bucket.count : 0, 4),
    averageReviewScore: num(bucket.count ? bucket.reviewScore / bucket.count : 0, 4),
    averageWinRate: num(bucket.count ? bucket.winRate / bucket.count : 0, 4)
  })).sort((left, right) => right.governanceScore - left.governanceScore).slice(0, 8);
}

export class ResearchRegistry {
  constructor(config) {
    this.config = config;
  }

  buildRegistry({ journal, latestSummary = null, modelBackups = [], nowIso = new Date().toISOString() } = {}) {
    const runs = [...(journal?.researchRuns || [])];
    const nowMs = new Date(nowIso).getTime();
    const bySymbol = new Map();

    for (const run of runs) {
      const weight = expDecayWeight(run.generatedAt || run.lastRunAt, nowMs);
      for (const report of run.reports || []) {
        if (!bySymbol.has(report.symbol)) {
          bySymbol.set(report.symbol, createSymbolBucket(report.symbol));
        }
        const bucket = bySymbol.get(report.symbol);
        bucket.runs += 1;
        bucket.experiments += report.experimentCount || 0;
        bucket.totalTrades += report.totalTrades || 0;
        bucket.realizedPnl += safeNumber(report.realizedPnl);
        bucket.weightedSharpe += safeNumber(report.averageSharpe) * weight;
        bucket.weightedWinRate += safeNumber(report.averageWinRate) * weight;
        bucket.weightTotal += weight;
        bucket.maxDrawdownPct = Math.max(bucket.maxDrawdownPct, safeNumber(report.maxDrawdownPct));
        bucket.lastRunAt = report.generatedAt || run.generatedAt || bucket.lastRunAt;
        for (const experiment of report.experiments || []) {
          for (const leader of experiment.strategyLeaders || []) {
            bucket.leaders.add(leader);
          }
        }
      }
    }

    const leaderboard = [...bySymbol.values()]
      .map((bucket) => finalizeBucket(bucket, this.config))
      .sort((left, right) => right.governanceScore - left.governanceScore)
      .slice(0, 8);

    const promotionCandidates = leaderboard.filter((item) => item.status === "promotion_candidate");
    const observeList = leaderboard.filter((item) => item.status === "observe");
    const strategyScorecards = buildStrategyScorecards(runs);
    const notes = [
      promotionCandidates[0]
        ? `${promotionCandidates[0].symbol} voldoet aan de walk-forward drempels voor paper-promotie.`
        : "Nog geen symbool voldoet aan alle research-promotiedrempels.",
      observeList[0]
        ? `${observeList[0].symbol} verdient extra observatie voordat er promotie volgt.`
        : "Er is nog geen duidelijke observe-kandidaat buiten de promotion pool.",
      modelBackups.length
        ? `${modelBackups.length} stabiele model-snapshots zijn beschikbaar voor rollback.`
        : "Nog geen stabiele model-snapshots beschikbaar voor rollback."
    ];

    return {
      generatedAt: nowIso,
      runCount: runs.length,
      lastRunAt: latestSummary?.generatedAt || runs.at(-1)?.generatedAt || null,
      bestSymbol: latestSummary?.bestSymbol || leaderboard[0]?.symbol || null,
      leaderboard,
      strategyScorecards,
      recentRuns: runs
        .slice(-5)
        .reverse()
        .map((run) => ({
          generatedAt: run.generatedAt || null,
          symbolCount: run.symbolCount || 0,
          bestSymbol: run.bestSymbol || null,
          totalTrades: run.totalTrades || 0,
          realizedPnl: num(run.realizedPnl || 0, 2),
          averageSharpe: num(run.averageSharpe || 0, 3)
        })),
      familyLeaders: mapLeaderBucket(latestSummary?.topFamilies || []),
      regimeLeaders: mapLeaderBucket(latestSummary?.topRegimes || []),
      governance: {
        promotionCandidates,
        observeList,
        blockedCount: Math.max(0, leaderboard.length - promotionCandidates.length - observeList.length),
        stableSnapshotCount: modelBackups.length,
        notes
      }
    };
  }
}

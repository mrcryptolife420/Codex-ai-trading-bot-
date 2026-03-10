import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function buildBucketMap(trades = [], keyFn) {
  const map = new Map();
  for (const trade of trades) {
    const key = keyFn(trade) || "unknown";
    if (!map.has(key)) {
      map.set(key, { id: key, tradeCount: 0, pnl: 0, winCount: 0, quality: 0, label: 0 });
    }
    const bucket = map.get(key);
    bucket.tradeCount += 1;
    bucket.pnl += trade.pnlQuote || 0;
    bucket.winCount += (trade.pnlQuote || 0) > 0 ? 1 : 0;
    bucket.quality += trade.executionQualityScore || 0;
    bucket.label += trade.labelScore || 0;
  }
  return [...map.values()].map((bucket) => ({
    id: bucket.id,
    tradeCount: bucket.tradeCount,
    realizedPnl: num(bucket.pnl, 2),
    winRate: num(bucket.tradeCount ? bucket.winCount / bucket.tradeCount : 0),
    avgExecutionQuality: num(bucket.tradeCount ? bucket.quality / bucket.tradeCount : 0),
    avgLabelScore: num(bucket.tradeCount ? bucket.label / bucket.tradeCount : 0),
    governanceScore: num(clamp(0.46 + (bucket.tradeCount ? bucket.pnl / Math.max(bucket.tradeCount * 80, 1) : 0) + (bucket.tradeCount ? bucket.winCount / bucket.tradeCount - 0.5 : 0), 0, 1))
  })).sort((left, right) => right.governanceScore - left.governanceScore);
}

export class OfflineTrainer {
  constructor(config) {
    this.config = config;
  }

  buildSummary({ journal = {}, dataRecorder = {}, counterfactuals = [], nowIso = new Date().toISOString() } = {}) {
    const trades = (journal.trades || []).filter((trade) => trade.exitAt);
    const learningReadyTrades = trades.filter((trade) => Number.isFinite(trade.labelScore) && trade.rawFeatures && Object.keys(trade.rawFeatures).length > 0);
    const paperTrades = learningReadyTrades.filter((trade) => (trade.brokerMode || "paper") === "paper");
    const liveTrades = learningReadyTrades.filter((trade) => (trade.brokerMode || "paper") === "live");
    const missedWinners = (counterfactuals || []).filter((item) => item.outcome === "missed_winner");
    const blockedCorrectly = (counterfactuals || []).filter((item) => item.outcome === "blocked_correctly");
    const strategies = buildBucketMap(learningReadyTrades, (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy);
    const regimes = buildBucketMap(learningReadyTrades, (trade) => trade.regimeAtEntry || "unknown");
    const readinessScore = clamp(
      0.24 +
        Math.min(0.34, learningReadyTrades.length / 80) +
        Math.min(0.18, (dataRecorder.learningFrames || 0) / 60) +
        Math.min(0.14, missedWinners.length / 20) +
        Math.min(0.1, blockedCorrectly.length / 20),
      0,
      1
    );
    return {
      generatedAt: nowIso,
      learningReadyTrades: learningReadyTrades.length,
      paperTrades: paperTrades.length,
      liveTrades: liveTrades.length,
      learningFrames: dataRecorder.learningFrames || 0,
      decisionFrames: dataRecorder.decisionFrames || 0,
      counterfactuals: {
        total: (counterfactuals || []).length,
        missedWinners: missedWinners.length,
        blockedCorrectly: blockedCorrectly.length,
        averageMissedMovePct: num(average(missedWinners.map((item) => item.realizedMovePct || 0), 0))
      },
      strategies: strategies.slice(0, 8),
      regimes: regimes.slice(0, 6),
      readinessScore: num(readinessScore),
      status: readinessScore >= 0.72 ? "ready" : readinessScore >= 0.52 ? "building" : "warmup",
      notes: [
        learningReadyTrades.length >= 20
          ? "Er is genoeg gesloten trade-data voor regelmatige offline evaluatie."
          : "Nog extra gesloten trades verzamelen voor sterkere offline training.",
        missedWinners.length
          ? `${missedWinners.length} gemiste winnaars kunnen als counterfactual leerdata gebruikt worden.`
          : "Nog geen gemiste winnaars in counterfactual replay.",
        strategies[0]
          ? `${strategies[0].id} leidt momenteel in offline trainer governance.`
          : "Nog geen duidelijke strategy-leider in offline trainer."
      ]
    };
  }
}

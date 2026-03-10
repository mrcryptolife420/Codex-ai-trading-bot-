import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function buildBucketMap(items = [], keyFn, projector = null) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    if (!map.has(key)) {
      map.set(key, { id: key, count: 0, pnl: 0, wins: 0, quality: 0, label: 0, move: 0 });
    }
    const bucket = map.get(key);
    bucket.count += 1;
    bucket.pnl += projector ? projector(item).pnl : item.pnlQuote || 0;
    bucket.wins += projector ? projector(item).win : (item.pnlQuote || 0) > 0 ? 1 : 0;
    bucket.quality += projector ? projector(item).quality : item.executionQualityScore || 0;
    bucket.label += projector ? projector(item).label : item.labelScore || 0;
    bucket.move += projector ? projector(item).move : item.realizedMovePct || 0;
  }
  return [...map.values()].map((bucket) => ({
    id: bucket.id,
    tradeCount: bucket.count,
    realizedPnl: num(bucket.pnl, 2),
    winRate: num(bucket.count ? bucket.wins / bucket.count : 0),
    avgExecutionQuality: num(bucket.count ? bucket.quality / bucket.count : 0),
    avgLabelScore: num(bucket.count ? bucket.label / bucket.count : 0),
    avgMovePct: num(bucket.count ? bucket.move / bucket.count : 0),
    governanceScore: num(clamp(0.46 + (bucket.count ? bucket.pnl / Math.max(bucket.count * 80, 1) : 0) + (bucket.count ? bucket.wins / bucket.count - 0.5 : 0), 0, 1))
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
    const falsePositives = learningReadyTrades.filter((trade) => (trade.labelScore || 0.5) < 0.45 && (trade.pnlQuote || 0) < 0);
    const falseNegatives = missedWinners.filter((item) => (item.realizedMovePct || 0) > 0.01);
    const strategies = buildBucketMap(learningReadyTrades, (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy);
    const regimes = buildBucketMap(learningReadyTrades, (trade) => trade.regimeAtEntry || "unknown");
    const falsePositiveByStrategy = buildBucketMap(falsePositives, (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy);
    const falseNegativeByStrategy = buildBucketMap(falseNegatives, (item) => item.strategy || "blocked_setup", (item) => ({ pnl: 0, win: 1, quality: 0.5, label: 0.8, move: item.realizedMovePct || 0 }));
    const readinessScore = clamp(
      0.24 +
        Math.min(0.3, learningReadyTrades.length / 80) +
        Math.min(0.16, (dataRecorder.learningFrames || 0) / 60) +
        Math.min(0.1, missedWinners.length / 20) +
        Math.min(0.1, blockedCorrectly.length / 20) +
        Math.min(0.1, falsePositives.length / 24),
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
        falseNegatives: falseNegatives.length,
        averageMissedMovePct: num(average(missedWinners.map((item) => item.realizedMovePct || 0), 0))
      },
      falsePositiveTrades: falsePositives.length,
      falseNegativeTrades: falseNegatives.length,
      strategies: strategies.slice(0, 8),
      regimes: regimes.slice(0, 6),
      falsePositiveByStrategy: falsePositiveByStrategy.slice(0, 6),
      falseNegativeByStrategy: falseNegativeByStrategy.slice(0, 6),
      readinessScore: num(readinessScore),
      status: readinessScore >= 0.72 ? "ready" : readinessScore >= 0.52 ? "building" : "warmup",
      notes: [
        learningReadyTrades.length >= 20
          ? "Er is genoeg gesloten trade-data voor regelmatige offline evaluatie."
          : "Nog extra gesloten trades verzamelen voor sterkere offline training.",
        falseNegatives.length
          ? `${falseNegatives.length} gemiste winnaars zijn bruikbaar voor counterfactual training.`
          : "Nog geen duidelijke false negatives in de counterfactual set.",
        falsePositives.length
          ? `${falsePositives.length} false positives tonen waar de meta-gate strenger mag worden.`
          : "False positive set is nog klein; dat is positief voor de huidige gating.",
        strategies[0]
          ? `${strategies[0].id} leidt momenteel in offline trainer governance.`
          : "Nog geen duidelijke strategy-leider in offline trainer."
      ]
    };
  }
}

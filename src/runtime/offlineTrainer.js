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
      map.set(key, { id: key, count: 0, paperCount: 0, liveCount: 0, pnl: 0, wins: 0, quality: 0, label: 0, move: 0 });
    }
    const bucket = map.get(key);
    const view = projector ? projector(item) : {
      pnl: item.pnlQuote || 0,
      win: (item.pnlQuote || 0) > 0 ? 1 : 0,
      quality: item.executionQualityScore || 0,
      label: item.labelScore || 0,
      move: item.realizedMovePct || 0,
      mode: item.brokerMode || "paper"
    };
    bucket.count += 1;
    bucket.paperCount += view.mode === "paper" ? 1 : 0;
    bucket.liveCount += view.mode === "live" ? 1 : 0;
    bucket.pnl += view.pnl;
    bucket.wins += view.win;
    bucket.quality += view.quality;
    bucket.label += view.label;
    bucket.move += view.move;
  }
  return [...map.values()].map((bucket) => ({
    id: bucket.id,
    tradeCount: bucket.count,
    paperTradeCount: bucket.paperCount,
    liveTradeCount: bucket.liveCount,
    realizedPnl: num(bucket.pnl, 2),
    winRate: num(bucket.count ? bucket.wins / bucket.count : 0),
    avgExecutionQuality: num(bucket.count ? bucket.quality / bucket.count : 0),
    avgLabelScore: num(bucket.count ? bucket.label / bucket.count : 0),
    avgMovePct: num(bucket.count ? bucket.move / bucket.count : 0),
    governanceScore: num(clamp(0.46 + (bucket.count ? bucket.pnl / Math.max(bucket.count * 80, 1) : 0) + (bucket.count ? bucket.wins / bucket.count - 0.5 : 0), 0, 1))
  })).sort((left, right) => right.governanceScore - left.governanceScore);
}

function buildDecisionScorecards({
  trades = [],
  falsePositives = [],
  falseNegatives = [],
  keyFn = null,
  falseNegativeKeyFn = null,
  fallbackId = "unknown"
} = {}) {
  const map = new Map();
  const getBucket = (id) => {
    const key = id || fallbackId;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        tradeCount: 0,
        paperTradeCount: 0,
        liveTradeCount: 0,
        winCount: 0,
        pnl: 0,
        executionQuality: 0,
        labelScore: 0,
        falsePositiveCount: 0,
        falseNegativeCount: 0,
        moveSum: 0
      });
    }
    return map.get(key);
  };

  for (const trade of trades) {
    const id = keyFn ? keyFn(trade) : fallbackId;
    const bucket = getBucket(id);
    bucket.tradeCount += 1;
    bucket.paperTradeCount += (trade.brokerMode || "paper") === "paper" ? 1 : 0;
    bucket.liveTradeCount += (trade.brokerMode || "paper") === "live" ? 1 : 0;
    bucket.winCount += (trade.pnlQuote || 0) > 0 ? 1 : 0;
    bucket.pnl += trade.pnlQuote || 0;
    bucket.executionQuality += trade.executionQualityScore || 0;
    bucket.labelScore += trade.labelScore || 0;
    bucket.moveSum += trade.netPnlPct || 0;
  }

  for (const trade of falsePositives) {
    const id = keyFn ? keyFn(trade) : fallbackId;
    const bucket = getBucket(id);
    bucket.falsePositiveCount += 1;
  }

  for (const item of falseNegatives) {
    const id = falseNegativeKeyFn ? falseNegativeKeyFn(item) : fallbackId;
    const bucket = getBucket(id);
    bucket.falseNegativeCount += 1;
    bucket.moveSum += item.realizedMovePct || 0;
  }

  return [...map.values()]
    .map((bucket) => {
      const tradeCount = bucket.tradeCount || 0;
      const winRate = tradeCount ? bucket.winCount / tradeCount : 0;
      const avgExecutionQuality = tradeCount ? bucket.executionQuality / tradeCount : 0;
      const avgLabelScore = tradeCount ? bucket.labelScore / tradeCount : 0;
      const avgMovePct = tradeCount ? bucket.moveSum / tradeCount : 0;
      const falsePositiveRate = tradeCount ? bucket.falsePositiveCount / tradeCount : 0;
      const falseNegativeRate = (tradeCount + bucket.falseNegativeCount) ? bucket.falseNegativeCount / (tradeCount + bucket.falseNegativeCount) : 0;
      const pnlScore = clamp(0.5 + bucket.pnl / Math.max(tradeCount * 60, 60), 0, 1);
      const governanceScore = clamp(
        0.34 +
          (winRate - 0.5) * 0.26 +
          avgExecutionQuality * 0.14 +
          avgLabelScore * 0.16 +
          pnlScore * 0.18 -
          falsePositiveRate * 0.18 -
          falseNegativeRate * 0.1,
        0,
        1
      );
      const status = governanceScore >= 0.62 && tradeCount >= 4
        ? "prime"
        : governanceScore <= 0.42 && tradeCount >= 4
          ? "cooldown"
          : tradeCount >= 2 || bucket.falseNegativeCount > 0
            ? "observe"
            : "warmup";
      return {
        id: bucket.id,
        tradeCount,
        paperTradeCount: bucket.paperTradeCount,
        liveTradeCount: bucket.liveTradeCount,
        winRate: num(winRate),
        realizedPnl: num(bucket.pnl, 2),
        avgExecutionQuality: num(avgExecutionQuality),
        avgLabelScore: num(avgLabelScore),
        avgMovePct: num(avgMovePct),
        falsePositiveCount: bucket.falsePositiveCount,
        falseNegativeCount: bucket.falseNegativeCount,
        falsePositiveRate: num(falsePositiveRate),
        falseNegativeRate: num(falseNegativeRate),
        governanceScore: num(governanceScore),
        dominantError: bucket.falsePositiveCount > bucket.falseNegativeCount
          ? "false_positive_bias"
          : bucket.falseNegativeCount > bucket.falsePositiveCount
            ? "false_negative_bias"
            : "balanced",
        status
      };
    })
    .sort((left, right) => right.governanceScore - left.governanceScore)
    .slice(0, 10);
}

function buildStrategyScorecards(trades = [], falsePositives = [], falseNegatives = []) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown",
    falseNegativeKeyFn: (item) => item.strategy || item.strategyAtEntry || "blocked_setup",
    fallbackId: "unknown"
  });
}

function buildRegimeScorecards(trades = [], falsePositives = [], falseNegatives = []) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown",
    falseNegativeKeyFn: (item) => item.regime || item.regimeAtEntry || "blocked_setup",
    fallbackId: "unknown"
  });
}

function buildBlockerScorecards(counterfactuals = []) {
  const map = new Map();
  const getBucket = (id) => {
    const key = id || "no_explicit_blocker";
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        total: 0,
        goodVetoCount: 0,
        badVetoCount: 0,
        moveSum: 0,
        strategyIds: new Set(),
        regimeIds: new Set()
      });
    }
    return map.get(key);
  };

  for (const item of counterfactuals || []) {
    const reasons = Array.isArray(item.blockerReasons) && item.blockerReasons.length
      ? item.blockerReasons.slice(0, 4)
      : [item.reason || "no_explicit_blocker"];
    for (const reason of reasons) {
      const bucket = getBucket(reason);
      bucket.total += 1;
      bucket.moveSum += item.realizedMovePct || 0;
      if (item.outcome === "blocked_correctly") {
        bucket.goodVetoCount += 1;
      } else if (item.outcome === "missed_winner") {
        bucket.badVetoCount += 1;
      }
      if (item.strategy || item.strategyAtEntry) {
        bucket.strategyIds.add(item.strategy || item.strategyAtEntry);
      }
      if (item.regime || item.regimeAtEntry) {
        bucket.regimeIds.add(item.regime || item.regimeAtEntry);
      }
    }
  }

  return [...map.values()]
    .map((bucket) => {
      const goodVetoRate = bucket.total ? bucket.goodVetoCount / bucket.total : 0;
      const badVetoRate = bucket.total ? bucket.badVetoCount / bucket.total : 0;
      const averageMovePct = bucket.total ? bucket.moveSum / bucket.total : 0;
      const governanceScore = clamp(
        0.5 +
          goodVetoRate * 0.24 -
          badVetoRate * 0.28 -
          Math.max(0, averageMovePct) * 4.5,
        0,
        1
      );
      return {
        id: bucket.id,
        total: bucket.total,
        goodVetoCount: bucket.goodVetoCount,
        badVetoCount: bucket.badVetoCount,
        goodVetoRate: num(goodVetoRate),
        badVetoRate: num(badVetoRate),
        averageMovePct: num(averageMovePct),
        governanceScore: num(governanceScore),
        affectedStrategies: [...bucket.strategyIds].slice(0, 4),
        affectedRegimes: [...bucket.regimeIds].slice(0, 4),
        status: badVetoRate >= 0.45 && bucket.badVetoCount >= 2
          ? "relax"
          : goodVetoRate >= 0.55 && bucket.goodVetoCount >= 2
            ? "keep"
            : "observe"
      };
    })
    .sort((left, right) => {
      const badEdge = right.badVetoRate - left.badVetoRate;
      return Math.abs(badEdge) > 0.001 ? badEdge : right.total - left.total;
    })
    .slice(0, 10);
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
    const falseNegativeByStrategy = buildBucketMap(falseNegatives, (item) => item.strategy || "blocked_setup", (item) => ({ pnl: 0, win: 1, quality: 0.5, label: 0.8, move: item.realizedMovePct || 0, mode: "paper" }));
    const strategyScorecards = buildStrategyScorecards(learningReadyTrades, falsePositives, falseNegatives);
    const regimeScorecards = buildRegimeScorecards(learningReadyTrades, falsePositives, falseNegatives);
    const blockerScorecards = buildBlockerScorecards(counterfactuals);
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
      vetoFeedback: {
        total: (counterfactuals || []).length,
        blockerCount: blockerScorecards.length,
        goodVetoCount: blockedCorrectly.length,
        badVetoCount: missedWinners.length,
        topBlocker: blockerScorecards[0]?.id || null
      },
      falsePositiveTrades: falsePositives.length,
      falseNegativeTrades: falseNegatives.length,
      strategies: strategies.slice(0, 8),
      regimes: regimes.slice(0, 6),
      strategyScorecards,
      regimeScorecards,
      blockerScorecards,
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
        blockerScorecards[0]
          ? `${blockerScorecards[0].id} vraagt momenteel veto-aandacht (${blockerScorecards[0].status}).`
          : "Nog geen veto-feedback met duidelijke blocker-patronen.",
        regimeScorecards[0]
          ? `${regimeScorecards[0].id} is het sterkste regime in offline trainer governance.`
          : "Nog geen duidelijke regime-leider in offline trainer.",
        strategyScorecards[0]
          ? `${strategyScorecards[0].id} leidt momenteel in offline trainer governance.`
          : "Nog geen duidelijke strategy-leider in offline trainer."
      ]
    };
  }
}

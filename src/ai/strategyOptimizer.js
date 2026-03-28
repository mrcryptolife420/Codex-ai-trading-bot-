import { clamp } from "../utils/math.js";
import { STRATEGY_META } from "../strategy/strategyRouter.js";

function safeValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function num(value, digits = 4) {
  return Number(safeValue(value).toFixed(digits));
}

function expDecayWeight(at, nowMs) {
  const atMs = new Date(at || 0).getTime();
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return 0.5;
  }
  const ageDays = Math.max(0, (nowMs - atMs) / 86_400_000);
  return Math.exp(-ageDays / 35);
}

function resolveStrategy(trade) {
  return trade.strategyAtEntry || trade.strategyDecision?.activeStrategy || trade.entryRationale?.strategy?.activeStrategy || null;
}

function resolveFamily(strategyId) {
  return STRATEGY_META[strategyId]?.family || null;
}

function hoursBetween(start, end) {
  const startMs = new Date(start || 0).getTime();
  const endMs = new Date(end || start || 0).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 0;
  }
  return Math.max(0, (endMs - startMs) / 3_600_000);
}

function createBucket(id, label) {
  return {
    id,
    label,
    weightedTrades: 0,
    tradeCount: 0,
    weightedWins: 0,
    weightedLabel: 0,
    weightedPnlPct: 0,
    weightedPnlQuote: 0,
    weightedPositivePnl: 0,
    weightedNegativePnl: 0,
    weightedPaperTrades: 0,
    weightedLiveTrades: 0
  };
}

function finalizeBucket(bucket, config) {
  const alphaPrior = Math.max(0.1, safeValue(config.optimizerBayesPriorAlpha) || 2);
  const betaPrior = Math.max(0.1, safeValue(config.optimizerBayesPriorBeta) || 2);
  const posteriorAlpha = alphaPrior + bucket.weightedWins;
  const posteriorBeta = betaPrior + Math.max(0, bucket.weightedTrades - bucket.weightedWins);
  const posteriorWinRate = posteriorAlpha / Math.max(posteriorAlpha + posteriorBeta, 1e-9);
  const posteriorVariance = (posteriorAlpha * posteriorBeta) /
    Math.max(((posteriorAlpha + posteriorBeta) ** 2) * (posteriorAlpha + posteriorBeta + 1), 1e-9);
  const posteriorUncertainty = Math.sqrt(Math.max(0, posteriorVariance));
  const meanPnlPct = bucket.weightedTrades ? bucket.weightedPnlPct / bucket.weightedTrades : 0;
  const meanPnlQuote = bucket.weightedTrades ? bucket.weightedPnlQuote / bucket.weightedTrades : 0;
  const labelScore = bucket.weightedTrades ? bucket.weightedLabel / bucket.weightedTrades : 0.5;
  const payoffRatio = bucket.weightedNegativePnl > 0
    ? bucket.weightedPositivePnl / bucket.weightedNegativePnl
    : bucket.weightedPositivePnl > 0
      ? 2
      : 1;
  const confidence = clamp(Math.log1p(bucket.weightedTrades) / Math.log(10), 0, 1);
  const sampleSufficiency = clamp(bucket.weightedTrades / 10, 0, 1);
  const pnlScore = clamp(0.5 + meanPnlPct * 8 + meanPnlQuote / 250, 0, 1);
  const payoffScore = clamp(payoffRatio / 3, 0, 1);
  const rewardScore = clamp(
    posteriorWinRate * 0.46 + labelScore * 0.16 + pnlScore * 0.24 + payoffScore * 0.14,
    0,
    1
  );
  const explorationWeight = clamp((safeValue(config.optimizerBayesExploration) || 0.12) * (1 - sampleSufficiency) + posteriorUncertainty * 0.6, 0, 0.35);
  const thompsonScore = clamp(rewardScore + explorationWeight * 0.18 + Math.max(-0.08, Math.min(0.08, meanPnlPct * 4.5)), 0, 1);
  const governanceScore = clamp(rewardScore * 0.74 + posteriorWinRate * 0.12 + confidence * 0.14 - posteriorUncertainty * 0.1, 0, 1);
  const multiplier = clamp(0.9 + (thompsonScore - 0.5) * 0.26 + confidence * 0.05, 0.84, 1.16);
  const thresholdTilt = clamp((thompsonScore - 0.5) * 0.09 * sampleSufficiency, -0.055, 0.055);
  const confidenceTilt = clamp((governanceScore - 0.5) * 0.07 * sampleSufficiency, -0.04, 0.04);
  const sizeBias = clamp(0.88 + (governanceScore - 0.5) * 0.28 + sampleSufficiency * 0.06, 0.72, 1.18);
  const status = governanceScore >= 0.63 && bucket.tradeCount >= 4
    ? "prime"
    : governanceScore <= 0.42 && bucket.tradeCount >= 4
      ? "cooldown"
      : sampleSufficiency >= 0.4
        ? "observe"
        : "warmup";

  return {
    id: bucket.id,
    label: bucket.label,
    tradeCount: bucket.tradeCount,
    weightedTrades: Number(bucket.weightedTrades.toFixed(2)),
    paperWeight: Number(bucket.weightedPaperTrades.toFixed(2)),
    liveWeight: Number(bucket.weightedLiveTrades.toFixed(2)),
    winRate: Number(posteriorWinRate.toFixed(4)),
    avgPnlPct: Number(meanPnlPct.toFixed(4)),
    avgPnlQuote: Number(meanPnlQuote.toFixed(2)),
    rewardScore: Number(rewardScore.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    multiplier: Number(multiplier.toFixed(4)),
    posteriorAlpha: Number(posteriorAlpha.toFixed(3)),
    posteriorBeta: Number(posteriorBeta.toFixed(3)),
    posteriorUncertainty: Number(posteriorUncertainty.toFixed(4)),
    governanceScore: Number(governanceScore.toFixed(4)),
    thompsonScore: Number(thompsonScore.toFixed(4)),
    thresholdTilt: Number(thresholdTilt.toFixed(4)),
    confidenceTilt: Number(confidenceTilt.toFixed(4)),
    sizeBias: Number(sizeBias.toFixed(4)),
    sampleSufficiency: Number(sampleSufficiency.toFixed(4)),
    explorationWeight: Number(explorationWeight.toFixed(4)),
    status
  };
}

function buildTilt(stat, maxMagnitude, sampleScale, field = "thompsonScore") {
  if (!stat || sampleScale <= 0) {
    return 0;
  }
  const baseScore = safeValue(stat[field]);
  const confidence = clamp(safeValue(stat.confidence), 0, 1);
  const rawTilt = (baseScore - 0.5) * (0.35 + confidence * 0.65) * sampleScale;
  return Number(clamp(rawTilt, -maxMagnitude, maxMagnitude).toFixed(4));
}

function buildTiltMap(stats, maxMagnitude, sampleScale, field) {
  return Object.fromEntries(stats.map((item) => [item.id, buildTilt(item, maxMagnitude, sampleScale, field)]));
}

function buildMap(stats, field) {
  return Object.fromEntries(stats.map((item) => [item.id, item[field]]));
}

export class StrategyOptimizer {
  constructor(config) {
    this.config = config;
  }

  buildSnapshot({ journal, nowIso = new Date().toISOString() } = {}) {
    const nowMs = new Date(nowIso).getTime();
    const allTrades = [...(journal?.trades || [])].filter((trade) => trade.exitAt && resolveStrategy(trade));
    const lookbackHours = safeValue(this.config.strategyOptimizerLookbackHours) || 24 * 7;
    const latestTradeAt = [...allTrades].reverse().map((trade) => trade.exitAt || trade.entryAt || null).find(Boolean) || null;
    const freshnessHours = latestTradeAt ? hoursBetween(latestTradeAt, nowIso) : null;
    const trades = allTrades.filter((trade) => hoursBetween(trade.exitAt || trade.entryAt, nowIso) <= lookbackHours);
    const strategyBuckets = new Map();
    const familyBuckets = new Map();
    const regimeBuckets = new Map();

    for (const trade of trades) {
      const strategyId = resolveStrategy(trade);
      const family = resolveFamily(strategyId);
      const regime = trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown";
      const strategyLabel = STRATEGY_META[strategyId]?.label || strategyId;
      const familyLabel = STRATEGY_META[strategyId]?.familyLabel || family || "Unknown";
      const weight = expDecayWeight(trade.exitAt || trade.entryAt, nowMs);
      const labelScore = trade.labelScore ?? (trade.netPnlPct > 0 ? 1 : 0);
      const brokerMode = trade.brokerMode || "paper";

      if (!strategyBuckets.has(strategyId)) {
        strategyBuckets.set(strategyId, createBucket(strategyId, strategyLabel));
      }
      const strategyBucket = strategyBuckets.get(strategyId);
      strategyBucket.tradeCount += 1;
      strategyBucket.weightedTrades += weight;
      strategyBucket.weightedWins += labelScore > 0.5 ? weight : 0;
      strategyBucket.weightedLabel += labelScore * weight;
      strategyBucket.weightedPnlPct += safeValue(trade.netPnlPct) * weight;
      strategyBucket.weightedPnlQuote += safeValue(trade.pnlQuote) * weight;
      strategyBucket.weightedPositivePnl += Math.max(0, safeValue(trade.pnlQuote)) * weight;
      strategyBucket.weightedNegativePnl += Math.abs(Math.min(0, safeValue(trade.pnlQuote))) * weight;
      strategyBucket.weightedPaperTrades += brokerMode === "paper" ? weight : 0;
      strategyBucket.weightedLiveTrades += brokerMode === "live" ? weight : 0;

      if (family) {
        if (!familyBuckets.has(family)) {
          familyBuckets.set(family, createBucket(family, familyLabel));
        }
        const familyBucket = familyBuckets.get(family);
        familyBucket.tradeCount += 1;
        familyBucket.weightedTrades += weight;
        familyBucket.weightedWins += labelScore > 0.5 ? weight : 0;
        familyBucket.weightedLabel += labelScore * weight;
        familyBucket.weightedPnlPct += safeValue(trade.netPnlPct) * weight;
        familyBucket.weightedPnlQuote += safeValue(trade.pnlQuote) * weight;
        familyBucket.weightedPositivePnl += Math.max(0, safeValue(trade.pnlQuote)) * weight;
        familyBucket.weightedNegativePnl += Math.abs(Math.min(0, safeValue(trade.pnlQuote))) * weight;
        familyBucket.weightedPaperTrades += brokerMode === "paper" ? weight : 0;
        familyBucket.weightedLiveTrades += brokerMode === "live" ? weight : 0;
      }

      if (!regimeBuckets.has(regime)) {
        regimeBuckets.set(regime, createBucket(regime, regime));
      }
      const regimeBucket = regimeBuckets.get(regime);
      regimeBucket.tradeCount += 1;
      regimeBucket.weightedTrades += weight;
      regimeBucket.weightedWins += labelScore > 0.5 ? weight : 0;
      regimeBucket.weightedLabel += labelScore * weight;
      regimeBucket.weightedPnlPct += safeValue(trade.netPnlPct) * weight;
      regimeBucket.weightedPnlQuote += safeValue(trade.pnlQuote) * weight;
      regimeBucket.weightedPositivePnl += Math.max(0, safeValue(trade.pnlQuote)) * weight;
      regimeBucket.weightedNegativePnl += Math.abs(Math.min(0, safeValue(trade.pnlQuote))) * weight;
      regimeBucket.weightedPaperTrades += brokerMode === "paper" ? weight : 0;
      regimeBucket.weightedLiveTrades += brokerMode === "live" ? weight : 0;
    }

    const strategyStats = [...strategyBuckets.values()].map((bucket) => finalizeBucket(bucket, this.config)).sort((left, right) => right.thompsonScore - left.thompsonScore);
    const familyStats = [...familyBuckets.values()].map((bucket) => finalizeBucket(bucket, this.config)).sort((left, right) => right.thompsonScore - left.thompsonScore);
    const regimeStats = [...regimeBuckets.values()].map((bucket) => finalizeBucket(bucket, this.config)).sort((left, right) => right.thompsonScore - left.thompsonScore);
    const topStrategy = strategyStats[0] || null;
    const topFamily = familyStats[0] || null;
    const topRegime = regimeStats[0] || null;
    const sampleConfidence = clamp(Math.log1p(trades.length) / Math.log(25), 0, 1);
    const sampleScale = clamp(trades.length >= 6 ? sampleConfidence : sampleConfidence * 0.35, 0, 1);
    const strategyThresholdTilts = buildTiltMap(strategyStats, 0.045, sampleScale, "thompsonScore");
    const familyThresholdTilts = buildTiltMap(familyStats, 0.03, sampleScale * 0.9, "thompsonScore");
    const regimeThresholdTilts = buildTiltMap(regimeStats, 0.025, sampleScale * 0.8, "thompsonScore");
    const strategyConfidenceTilts = buildTiltMap(strategyStats, 0.035, sampleScale * 0.85, "governanceScore");
    const familyConfidenceTilts = buildTiltMap(familyStats, 0.025, sampleScale * 0.8, "governanceScore");
    const regimeConfidenceTilts = buildTiltMap(regimeStats, 0.02, sampleScale * 0.75, "governanceScore");
    const strategySizeBiases = buildMap(strategyStats, "sizeBias");
    const familySizeBiases = buildMap(familyStats, "sizeBias");
    const regimeSizeBiases = buildMap(regimeStats, "sizeBias");
    const thresholdTilt = topStrategy ? strategyThresholdTilts[topStrategy.id] || 0 : 0;
    const confidenceTilt = topFamily ? familyConfidenceTilts[topFamily.id] || 0 : 0;
    const suggestions = [
      topStrategy
        ? `${topStrategy.label} leidt met posterior ${(topStrategy.winRate * 100).toFixed(1)}% en ${topStrategy.tradeCount} trades.`
        : "Nog te weinig strategy-history voor optimizer-suggesties.",
      topFamily
        ? `${topFamily.label} is de sterkste family op basis van de Bayesian governance score.`
        : "Nog geen family-prior beschikbaar.",
      topRegime
        ? `${topRegime.label} scoort als beste regime met Thompson ${topRegime.thompsonScore.toFixed(2)}.`
        : "Nog geen regime-scorecard beschikbaar.",
      trades.length >= 12
        ? `Adaptieve threshold tilt ${thresholdTilt >= 0 ? "-" : "+"}${(Math.abs(thresholdTilt) * 100).toFixed(1)}%, strategy-floor tilt ${confidenceTilt >= 0 ? "-" : "+"}${(Math.abs(confidenceTilt) * 100).toFixed(1)}%.`
        : "Wacht op meer gesloten trades voordat optimizer-tilts zwaar meewegen."
    ];

    if (!trades.length) {
      return {
        generatedAt: nowIso,
        status: allTrades.length ? "stale" : "warmup",
        sampleSize: 0,
        recentTradeCount: 0,
        latestTradeAt,
        freshnessHours: Number.isFinite(freshnessHours) ? num(freshnessHours, 1) : null,
        sampleConfidence: 0,
        strategyPriors: {},
        familyPriors: {},
        regimePriors: {},
        topStrategies: [],
        topFamilies: [],
        topRegimes: [],
        strategyScorecards: [],
        familyScorecards: [],
        regimeScorecards: [],
        thresholdTilt: 0,
        confidenceTilt: 0,
        strategyThresholdTilts: {},
        familyThresholdTilts: {},
        regimeThresholdTilts: {},
        strategyConfidenceTilts: {},
        familyConfidenceTilts: {},
        regimeConfidenceTilts: {},
        strategySizeBiases: {},
        familySizeBiases: {},
        regimeSizeBiases: {},
        suggestions: [
          allTrades.length
            ? `Optimizer-input is stale; laatste gesloten trade is ${num(freshnessHours, 1)}u oud, dus threshold-tilts staan tijdelijk neutraal.`
            : "Nog te weinig gesloten trades voor optimizer-priors."
        ]
      };
    }

    return {
      generatedAt: nowIso,
      status: "active",
      sampleSize: trades.length,
      recentTradeCount: trades.length,
      latestTradeAt,
      freshnessHours: Number.isFinite(freshnessHours) ? num(freshnessHours, 1) : null,
      sampleConfidence: Number(sampleConfidence.toFixed(4)),
      strategyPriors: Object.fromEntries(strategyStats.map((item) => [item.id, item])),
      familyPriors: Object.fromEntries(familyStats.map((item) => [item.id, item])),
      regimePriors: Object.fromEntries(regimeStats.map((item) => [item.id, item])),
      topStrategies: strategyStats.slice(0, 6),
      topFamilies: familyStats.slice(0, 5),
      topRegimes: regimeStats.slice(0, 5),
      strategyScorecards: strategyStats.slice(0, 8),
      familyScorecards: familyStats.slice(0, 6),
      regimeScorecards: regimeStats.slice(0, 6),
      thresholdTilt: Number(thresholdTilt.toFixed(4)),
      confidenceTilt: Number(confidenceTilt.toFixed(4)),
      strategyThresholdTilts,
      familyThresholdTilts,
      regimeThresholdTilts,
      strategyConfidenceTilts,
      familyConfidenceTilts,
      regimeConfidenceTilts,
      strategySizeBiases,
      familySizeBiases,
      regimeSizeBiases,
      suggestions
    };
  }
}

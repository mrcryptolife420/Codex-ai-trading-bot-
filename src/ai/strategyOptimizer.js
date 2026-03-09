import { clamp } from "../utils/math.js";
import { STRATEGY_META } from "../strategy/strategyRouter.js";

function safeValue(value) {
  return Number.isFinite(value) ? value : 0;
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
    weightedNegativePnl: 0
  };
}

function finalizeBucket(bucket) {
  const alpha = 2;
  const beta = 2;
  const winRate = (alpha + bucket.weightedWins) / Math.max(alpha + beta + bucket.weightedTrades, 1);
  const meanPnlPct = bucket.weightedTrades ? bucket.weightedPnlPct / bucket.weightedTrades : 0;
  const meanPnlQuote = bucket.weightedTrades ? bucket.weightedPnlQuote / bucket.weightedTrades : 0;
  const labelScore = bucket.weightedTrades ? bucket.weightedLabel / bucket.weightedTrades : 0.5;
  const payoffRatio = bucket.weightedNegativePnl > 0 ? bucket.weightedPositivePnl / bucket.weightedNegativePnl : bucket.weightedPositivePnl > 0 ? 2 : 1;
  const rewardScore = clamp(
    winRate * 0.55 + labelScore * 0.15 + clamp(0.5 + meanPnlPct * 8, 0, 1) * 0.2 + clamp(payoffRatio / 3, 0, 1) * 0.1,
    0,
    1
  );
  const confidence = clamp(Math.log1p(bucket.weightedTrades) / Math.log(10), 0, 1);
  const multiplier = clamp(0.92 + (rewardScore - 0.5) * 0.22 + confidence * 0.05, 0.86, 1.14);
  return {
    id: bucket.id,
    label: bucket.label,
    tradeCount: bucket.tradeCount,
    weightedTrades: Number(bucket.weightedTrades.toFixed(2)),
    winRate: Number(winRate.toFixed(4)),
    avgPnlPct: Number(meanPnlPct.toFixed(4)),
    avgPnlQuote: Number(meanPnlQuote.toFixed(2)),
    rewardScore: Number(rewardScore.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    multiplier: Number(multiplier.toFixed(4))
  };
}

function buildTilt(stat, maxMagnitude, sampleScale) {
  if (!stat || sampleScale <= 0) {
    return 0;
  }
  const rewardEdge = safeValue(stat.rewardScore) - 0.5;
  const confidence = clamp(safeValue(stat.confidence), 0, 1);
  const rawTilt = rewardEdge * (0.35 + confidence * 0.65) * sampleScale;
  return Number(clamp(rawTilt, -maxMagnitude, maxMagnitude).toFixed(4));
}

function buildTiltMap(stats, maxMagnitude, sampleScale) {
  return Object.fromEntries(stats.map((item) => [item.id, buildTilt(item, maxMagnitude, sampleScale)]));
}

export class StrategyOptimizer {
  constructor(config) {
    this.config = config;
  }

  buildSnapshot({ journal, nowIso = new Date().toISOString() } = {}) {
    const nowMs = new Date(nowIso).getTime();
    const trades = [...(journal?.trades || [])].filter((trade) => trade.exitAt && resolveStrategy(trade));
    const strategyBuckets = new Map();
    const familyBuckets = new Map();

    for (const trade of trades) {
      const strategyId = resolveStrategy(trade);
      const family = resolveFamily(strategyId);
      const strategyLabel = STRATEGY_META[strategyId]?.label || strategyId;
      const familyLabel = STRATEGY_META[strategyId]?.familyLabel || family || "Unknown";
      const weight = expDecayWeight(trade.exitAt || trade.entryAt, nowMs);
      const labelScore = trade.labelScore ?? (trade.netPnlPct > 0 ? 1 : 0);

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
      }
    }

    const strategyStats = [...strategyBuckets.values()].map(finalizeBucket).sort((left, right) => right.rewardScore - left.rewardScore);
    const familyStats = [...familyBuckets.values()].map(finalizeBucket).sort((left, right) => right.rewardScore - left.rewardScore);
    const topStrategy = strategyStats[0] || null;
    const topFamily = familyStats[0] || null;
    const sampleConfidence = clamp(Math.log1p(trades.length) / Math.log(25), 0, 1);
    const sampleScale = clamp(trades.length >= 6 ? sampleConfidence : sampleConfidence * 0.35, 0, 1);
    const strategyThresholdTilts = buildTiltMap(strategyStats, 0.045, sampleScale);
    const familyThresholdTilts = buildTiltMap(familyStats, 0.03, sampleScale * 0.9);
    const strategyConfidenceTilts = buildTiltMap(strategyStats, 0.035, sampleScale * 0.85);
    const familyConfidenceTilts = buildTiltMap(familyStats, 0.025, sampleScale * 0.8);
    const thresholdTilt = topStrategy ? strategyThresholdTilts[topStrategy.id] || 0 : 0;
    const confidenceTilt = topFamily ? familyConfidenceTilts[topFamily.id] || 0 : 0;
    const suggestions = [
      topStrategy
        ? `${topStrategy.label} leidt met ${(topStrategy.winRate * 100).toFixed(1)}% win rate en ${topStrategy.tradeCount} trades.`
        : "Nog te weinig strategy-history voor optimizer-suggesties.",
      topFamily
        ? `${topFamily.label} is de sterkste family op basis van recency-gewogen trade-data.`
        : "Nog geen family-prior beschikbaar.",
      trades.length >= 12
        ? `Adaptieve threshold tilt ${thresholdTilt >= 0 ? "-" : "+"}${(Math.abs(thresholdTilt) * 100).toFixed(1)}%, strategy-floor tilt ${confidenceTilt >= 0 ? "-" : "+"}${(Math.abs(confidenceTilt) * 100).toFixed(1)}%.`
        : "Wacht op meer gesloten trades voordat optimizer-tilts zwaar meewegen."
    ];

    return {
      generatedAt: nowIso,
      sampleSize: trades.length,
      sampleConfidence: Number(sampleConfidence.toFixed(4)),
      strategyPriors: Object.fromEntries(strategyStats.map((item) => [item.id, item])),
      familyPriors: Object.fromEntries(familyStats.map((item) => [item.id, item])),
      topStrategies: strategyStats.slice(0, 6),
      topFamilies: familyStats.slice(0, 5),
      thresholdTilt: Number(thresholdTilt.toFixed(4)),
      confidenceTilt: Number(confidenceTilt.toFixed(4)),
      strategyThresholdTilts,
      familyThresholdTilts,
      strategyConfidenceTilts,
      familyConfidenceTilts,
      suggestions
    };
  }
}

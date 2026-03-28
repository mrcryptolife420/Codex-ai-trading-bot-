import { clamp } from "../utils/math.js";
import { STRATEGY_META } from "../strategy/strategyRouter.js";

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
  return Math.exp(-ageDays / 40);
}

function hoursBetween(start, end) {
  const startMs = new Date(start || 0).getTime();
  const endMs = new Date(end || start || 0).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 0;
  }
  return Math.max(0, (endMs - startMs) / 3_600_000);
}

function resolveStrategyId(trade) {
  return trade.strategyAtEntry || trade.strategyDecision?.activeStrategy || trade.entryRationale?.strategy?.activeStrategy || null;
}

function resolveFamilyId(strategyId) {
  return strategyId ? STRATEGY_META[strategyId]?.family || null : null;
}

function resolveFamilyLabel(strategyId, familyId) {
  return strategyId ? STRATEGY_META[strategyId]?.familyLabel || familyId || "Unknown" : familyId || "Unknown";
}

function createBucket(id, label) {
  return {
    id,
    label,
    tradeCount: 0,
    weightedTrades: 0,
    weightedWins: 0,
    weightedLabel: 0,
    weightedPnlPct: 0,
    weightedPnlQuote: 0,
    weightedPositivePnl: 0,
    weightedNegativePnl: 0
  };
}

function ingestBucket(bucket, trade, weight) {
  const labelScore = trade.labelScore ?? (safeNumber(trade.netPnlPct) > 0 ? 1 : 0);
  bucket.tradeCount += 1;
  bucket.weightedTrades += weight;
  bucket.weightedWins += labelScore > 0.5 ? weight : 0;
  bucket.weightedLabel += labelScore * weight;
  bucket.weightedPnlPct += safeNumber(trade.netPnlPct) * weight;
  bucket.weightedPnlQuote += safeNumber(trade.pnlQuote) * weight;
  bucket.weightedPositivePnl += Math.max(0, safeNumber(trade.pnlQuote)) * weight;
  bucket.weightedNegativePnl += Math.abs(Math.min(0, safeNumber(trade.pnlQuote))) * weight;
}

function finalizeBucket(bucket) {
  const alpha = 2;
  const beta = 2;
  const winRate = (alpha + bucket.weightedWins) / Math.max(alpha + beta + bucket.weightedTrades, 1);
  const avgPnlPct = bucket.weightedTrades ? bucket.weightedPnlPct / bucket.weightedTrades : 0;
  const avgPnlQuote = bucket.weightedTrades ? bucket.weightedPnlQuote / bucket.weightedTrades : 0;
  const labelScore = bucket.weightedTrades ? bucket.weightedLabel / bucket.weightedTrades : 0.5;
  const payoffRatio = bucket.weightedNegativePnl > 0
    ? bucket.weightedPositivePnl / bucket.weightedNegativePnl
    : bucket.weightedPositivePnl > 0 ? 2 : 1;
  const confidence = clamp(Math.log1p(bucket.weightedTrades) / Math.log(12), 0, 1);
  const performanceScore = clamp(
    0.5 +
      (winRate - 0.5) * 0.55 +
      avgPnlPct * 4.6 +
      (labelScore - 0.5) * 0.18 +
      clamp(payoffRatio - 1, -0.5, 2) * 0.08,
    0,
    1
  );
  const edge = (performanceScore - 0.5) * confidence;
  const health = edge > 0.1 ? "hot" : edge > 0.03 ? "warm" : edge < -0.1 ? "cold" : edge < -0.03 ? "cooling" : "neutral";
  return {
    id: bucket.id,
    label: bucket.label,
    tradeCount: bucket.tradeCount,
    weightedTrades: num(bucket.weightedTrades, 2),
    winRate: num(winRate),
    avgPnlPct: num(avgPnlPct),
    avgPnlQuote: num(avgPnlQuote, 2),
    payoffRatio: num(payoffRatio, 3),
    labelScore: num(labelScore),
    confidence: num(confidence),
    performanceScore: num(performanceScore),
    edge: num(edge),
    health
  };
}

function mapToObject(items = []) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export class StrategyAttribution {
  constructor(config) {
    this.config = config;
  }

  buildSnapshot({ journal, nowIso = new Date().toISOString() } = {}) {
    const nowMs = new Date(nowIso).getTime();
    const allTrades = [...(journal?.trades || [])].filter((trade) => trade.exitAt);
    const lookbackHours = safeNumber(this.config.strategyAttributionLookbackHours) || 24 * 7;
    const latestTradeAt = [...allTrades].reverse().map((trade) => trade.exitAt || trade.entryAt || null).find(Boolean) || null;
    const freshnessHours = latestTradeAt ? hoursBetween(latestTradeAt, nowIso) : null;
    const trades = allTrades.filter((trade) => hoursBetween(trade.exitAt || trade.entryAt, nowIso) <= lookbackHours);
    const strategyBuckets = new Map();
    const familyBuckets = new Map();
    const regimeBuckets = new Map();
    const symbolBuckets = new Map();

    for (const trade of trades) {
      const strategyId = resolveStrategyId(trade);
      const familyId = resolveFamilyId(strategyId);
      const regimeId = trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown";
      const symbolId = trade.symbol || "unknown";
      const weight = expDecayWeight(trade.exitAt || trade.entryAt, nowMs);

      if (strategyId) {
        if (!strategyBuckets.has(strategyId)) {
          strategyBuckets.set(strategyId, createBucket(strategyId, STRATEGY_META[strategyId]?.label || strategyId));
        }
        ingestBucket(strategyBuckets.get(strategyId), trade, weight);
      }
      if (familyId) {
        if (!familyBuckets.has(familyId)) {
          familyBuckets.set(familyId, createBucket(familyId, resolveFamilyLabel(strategyId, familyId)));
        }
        ingestBucket(familyBuckets.get(familyId), trade, weight);
      }
      if (!regimeBuckets.has(regimeId)) {
        regimeBuckets.set(regimeId, createBucket(regimeId, regimeId.replaceAll("_", " ")));
      }
      ingestBucket(regimeBuckets.get(regimeId), trade, weight);
      if (!symbolBuckets.has(symbolId)) {
        symbolBuckets.set(symbolId, createBucket(symbolId, symbolId));
      }
      ingestBucket(symbolBuckets.get(symbolId), trade, weight);
    }

    const topStrategies = [...strategyBuckets.values()].map(finalizeBucket).sort((left, right) => right.edge - left.edge);
    const topFamilies = [...familyBuckets.values()].map(finalizeBucket).sort((left, right) => right.edge - left.edge);
    const topRegimes = [...regimeBuckets.values()].map(finalizeBucket).sort((left, right) => right.edge - left.edge);
    const topSymbols = [...symbolBuckets.values()].map(finalizeBucket).sort((left, right) => right.edge - left.edge);

    const suggestions = [
      topStrategies[0]
        ? `${topStrategies[0].label} is de warmste strategie met ${Math.round((topStrategies[0].winRate || 0) * 100)}% win rate.`
        : "Nog te weinig gesloten trades voor strategy-attribution.",
      topFamilies[0]
        ? `${topFamilies[0].label} leidt de family-score met edge ${topFamilies[0].edge.toFixed(3)}.`
        : "Nog geen family-attribution beschikbaar.",
      topRegimes[0]
        ? `Regime ${topRegimes[0].label} is momenteel het sterkst in gesloten trade-history.`
        : "Nog geen regime-attribution beschikbaar."
    ];

    if (!trades.length) {
      return {
        generatedAt: nowIso,
        status: allTrades.length ? "stale" : "warmup",
        sampleSize: 0,
        recentTradeCount: 0,
        latestTradeAt,
        freshnessHours: Number.isFinite(freshnessHours) ? num(freshnessHours, 1) : null,
        topStrategies: [],
        topFamilies: [],
        topRegimes: [],
        topSymbols: [],
        strategyMap: {},
        familyMap: {},
        regimeMap: {},
        symbolMap: {},
        suggestions: [
          allTrades.length
            ? `Strategy-attribution is stale; laatste gesloten trade is ${num(freshnessHours, 1)}u oud, dus boosts staan neutraal.`
            : "Nog te weinig gesloten trades voor strategy-attribution."
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
      topStrategies: topStrategies.slice(0, 6),
      topFamilies: topFamilies.slice(0, 5),
      topRegimes: topRegimes.slice(0, 5),
      topSymbols: topSymbols.slice(0, 5),
      strategyMap: mapToObject(topStrategies),
      familyMap: mapToObject(topFamilies),
      regimeMap: mapToObject(topRegimes),
      symbolMap: mapToObject(topSymbols),
      suggestions
    };
  }

  getAdjustment(snapshot = {}, { symbol = null, strategyId = null, familyId = null, regime = null } = {}) {
    if (!snapshot.sampleSize || snapshot.sampleSize < this.config.strategyAttributionMinTrades) {
      return {
        strategyId,
        familyId,
        regime,
        symbol,
        rankBoost: 0,
        sizeBias: 1,
        confidence: 0,
        reasons: ["attribution_sample_too_small"],
        strategyHealth: "neutral",
        familyHealth: "neutral",
        regimeHealth: "neutral",
        symbolHealth: "neutral"
      };
    }

    const strategy = strategyId ? snapshot.strategyMap?.[strategyId] || null : null;
    const family = familyId ? snapshot.familyMap?.[familyId] || null : null;
    const regimeBucket = regime ? snapshot.regimeMap?.[regime] || null : null;
    const symbolBucket = symbol ? snapshot.symbolMap?.[symbol] || null : null;
    const components = [
      { label: "strategy", weight: 0.45, bucket: strategy },
      { label: "family", weight: 0.25, bucket: family },
      { label: "regime", weight: 0.18, bucket: regimeBucket },
      { label: "symbol", weight: 0.12, bucket: symbolBucket }
    ].filter((item) => item.bucket);

    const weightedEdge = components.reduce((total, item) => total + safeNumber(item.bucket.edge) * item.weight, 0);
    const confidence = average(components.map((item) => safeNumber(item.bucket.confidence)), 0);
    const rankBoost = clamp(weightedEdge * (0.35 + confidence * 0.45), -0.05, 0.05);
    const sizeBias = clamp(1 + weightedEdge * 0.18, 0.92, 1.08);
    const reasons = components
      .filter((item) => Math.abs(safeNumber(item.bucket.edge)) >= 0.03)
      .slice(0, 3)
      .map((item) => `${item.label}_${item.bucket.health}`);

    return {
      strategyId,
      familyId,
      regime,
      symbol,
      rankBoost: num(rankBoost),
      sizeBias: num(sizeBias),
      confidence: num(confidence),
      reasons: reasons.length ? reasons : ["attribution_neutral"],
      strategyHealth: strategy?.health || "neutral",
      familyHealth: family?.health || "neutral",
      regimeHealth: regimeBucket?.health || "neutral",
      symbolHealth: symbolBucket?.health || "neutral"
    };
  }
}

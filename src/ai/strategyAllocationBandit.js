import { clamp } from "../utils/math.js";

const HISTORY_LIMIT = 40;
const MAX_BUCKETS = 320;
const FAMILY_IDS = ["trend_following", "breakout", "mean_reversion", "market_structure", "orderflow", "derivatives"];

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function normalizeId(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseBucketKey(key = "") {
  const [scope, ...rest] = String(key).split(":");
  return { scope, parts: rest };
}

function buildBucketKey(scope, parts = []) {
  return [scope, ...parts.map((part) => normalizeId(part, "unknown"))].join(":");
}

function buildDefaultBucket() {
  return {
    alpha: 3,
    beta: 3,
    trades: 0,
    rewardEma: 0.5,
    avgLabelScore: 0.5,
    avgPnlPct: 0,
    avgExecutionQuality: 0.5,
    avgCaptureEfficiency: 0.5,
    lastTradeAt: null
  };
}

function normalizeBucket(bucket = {}) {
  return {
    alpha: Math.max(0.5, safeNumber(bucket.alpha, 3)),
    beta: Math.max(0.5, safeNumber(bucket.beta, 3)),
    trades: Math.max(0, Math.round(safeNumber(bucket.trades, 0))),
    rewardEma: clamp(safeNumber(bucket.rewardEma, 0.5), 0, 1),
    avgLabelScore: clamp(safeNumber(bucket.avgLabelScore, 0.5), 0, 1),
    avgPnlPct: safeNumber(bucket.avgPnlPct, 0),
    avgExecutionQuality: clamp(safeNumber(bucket.avgExecutionQuality, 0.5), 0, 1),
    avgCaptureEfficiency: clamp(safeNumber(bucket.avgCaptureEfficiency, 0.5), 0, 1),
    lastTradeAt: bucket.lastTradeAt || null
  };
}

function normalizeState(state = {}) {
  return {
    version: 1,
    buckets: Object.fromEntries(
      Object.entries(state.buckets || {}).map(([key, bucket]) => [key, normalizeBucket(bucket)])
    ),
    history: Array.isArray(state.history) ? state.history.slice(-HISTORY_LIMIT) : []
  };
}

function buildInputs(context = {}) {
  const strategySummary = context.strategySummary || {};
  const regimeSummary = context.regimeSummary || {};
  const sessionSummary = context.sessionSummary || {};
  const score = context.score || {};
  const marketSnapshot = context.marketSnapshot || {};
  const market = marketSnapshot.market || {};
  const pairHealthSummary = context.pairHealthSummary || {};
  const timeframeSummary = context.timeframeSummary || {};
  const newsSummary = context.newsSummary || {};
  return {
    family: normalizeId(strategySummary.family, "trend_following"),
    strategy: normalizeId(strategySummary.activeStrategy || strategySummary.strategyLabel, "unknown_strategy"),
    regime: normalizeId(regimeSummary.regime, "range"),
    session: normalizeId(sessionSummary.session, "unknown_session"),
    probability: clamp(safeNumber(score.probability, strategySummary.fitScore || 0.5), 0, 1),
    confidence: clamp(safeNumber(score.confidence, strategySummary.confidence || 0), 0, 1),
    fitScore: clamp(safeNumber(strategySummary.fitScore, 0.5), 0, 1),
    alignment: clamp(safeNumber(timeframeSummary.alignmentScore, 0), -1, 1),
    pairHealth: clamp(safeNumber(pairHealthSummary.score, 0.5), 0, 1),
    realizedVolPct: Math.max(0, safeNumber(market.realizedVolPct, 0)),
    newsRisk: clamp(safeNumber(newsSummary.riskScore, 0), 0, 1)
  };
}

function buildScopeDescriptors(inputs = {}) {
  return [
    {
      id: "family",
      key: buildBucketKey("family", [inputs.family]),
      weight: 0.15,
      label: inputs.family
    },
    {
      id: "family_regime",
      key: buildBucketKey("family_regime", [inputs.regime, inputs.family]),
      weight: 0.22,
      label: `${inputs.regime}:${inputs.family}`
    },
    {
      id: "strategy",
      key: buildBucketKey("strategy", [inputs.strategy]),
      weight: 0.18,
      label: inputs.strategy
    },
    {
      id: "strategy_regime",
      key: buildBucketKey("strategy_regime", [inputs.regime, inputs.strategy]),
      weight: 0.27,
      label: `${inputs.regime}:${inputs.strategy}`
    },
    {
      id: "session_family",
      key: buildBucketKey("session_family", [inputs.session, inputs.family]),
      weight: 0.18,
      label: `${inputs.session}:${inputs.family}`
    }
  ];
}

function computeFreshness(bucket = {}, referenceMs = Date.now(), config = {}) {
  const lastTradeAt = bucket.lastTradeAt ? new Date(bucket.lastTradeAt).getTime() : Number.NaN;
  if (!Number.isFinite(lastTradeAt)) {
    return { ageHours: null, freshness: 0.42 };
  }
  const ageHours = Math.max(0, (referenceMs - lastTradeAt) / 3_600_000);
  const staleAfterHours = Math.max(24, safeNumber(config.strategyAllocationStaleHours, 24 * 7));
  const fadeWindowHours = Math.max(24, safeNumber(config.strategyAllocationFadeHours, 24 * 14));
  if (ageHours <= staleAfterHours) {
    return { ageHours, freshness: 1 };
  }
  return {
    ageHours,
    freshness: clamp(1 - ((ageHours - staleAfterHours) / fadeWindowHours), 0, 1)
  };
}

function scoreBucket(bucket = {}, referenceMs = Date.now(), config = {}) {
  const posterior = clamp(bucket.alpha / Math.max(bucket.alpha + bucket.beta, 1e-9), 0, 1);
  const sampleConfidence = clamp(bucket.trades / Math.max(4, safeNumber(config.strategyAllocationConfidenceTrades, 10)), 0, 1);
  const freshness = computeFreshness(bucket, referenceMs, config);
  const labelBias = (bucket.avgLabelScore - 0.5) * 2;
  const rewardBias = (bucket.rewardEma - 0.5) * 2;
  const pnlBias = clamp(bucket.avgPnlPct / Math.max(0.005, safeNumber(config.strategyAllocationPnlScalePct, 0.018)), -1, 1);
  const executionBias = (bucket.avgExecutionQuality - 0.5) * 2;
  const signal = clamp(
    (labelBias * 0.42) +
    (rewardBias * 0.28) +
    (pnlBias * 0.18) +
    (executionBias * 0.12),
    -1,
    1
  ) * sampleConfidence * freshness.freshness;
  return {
    posterior,
    signal,
    confidence: sampleConfidence * freshness.freshness,
    ageHours: freshness.ageHours
  };
}

function rankBuckets(buckets = {}, scopePrefix, limit = 4, referenceMs = Date.now(), config = {}) {
  return Object.entries(buckets)
    .filter(([key]) => key.startsWith(`${scopePrefix}:`))
    .map(([key, bucket]) => {
      const parsed = parseBucketKey(key);
      const scored = scoreBucket(bucket, referenceMs, config);
      return {
        id: parsed.parts[parsed.parts.length - 1] || key,
        context: parsed.parts.slice(0, -1).join(":") || null,
        posterior: num(scored.posterior, 4),
        confidence: num(scored.confidence, 4),
        signal: num(scored.signal, 4),
        trades: bucket.trades || 0,
        lastTradeAt: bucket.lastTradeAt || null
      };
    })
    .sort((left, right) => Math.abs(right.signal) - Math.abs(left.signal) || right.trades - left.trades)
    .slice(0, limit);
}

export class StrategyAllocationBandit {
  static bootstrapState() {
    return {
      version: 1,
      buckets: {},
      history: []
    };
  }

  constructor(state, config = {}) {
    this.config = config;
    this.state = normalizeState(state);
  }

  getState() {
    return {
      version: 1,
      buckets: { ...this.state.buckets },
      history: [...this.state.history].slice(-HISTORY_LIMIT)
    };
  }

  score(context = {}) {
    const inputs = buildInputs(context);
    const scopeDescriptors = buildScopeDescriptors(inputs);
    const referenceMs = Date.now();
    const scoredScopes = scopeDescriptors.map((descriptor) => {
      const bucket = this.state.buckets[descriptor.key] || buildDefaultBucket();
      const scored = scoreBucket(bucket, referenceMs, this.config);
      return {
        id: descriptor.id,
        key: descriptor.key,
        label: descriptor.label,
        weight: descriptor.weight,
        trades: bucket.trades || 0,
        posterior: num(scored.posterior, 4),
        signal: num(scored.signal, 4),
        confidence: num(scored.confidence, 4),
        ageHours: scored.ageHours == null ? null : num(scored.ageHours, 1)
      };
    });
    const totalWeight = scoredScopes.reduce((sum, item) => sum + item.weight, 0) || 1;
    const weightedSignal = scoredScopes.reduce((sum, item) => sum + (item.signal * item.weight), 0) / totalWeight;
    const weightedConfidence = clamp(
      scoredScopes.reduce((sum, item) => sum + (item.confidence * item.weight), 0) / totalWeight,
      0,
      1
    );
    const totalScopeTrades = scoredScopes.reduce((sum, item) => sum + item.trades, 0);
    const nearThreshold = Math.abs(inputs.probability - 0.5) < 0.07 || Math.abs(inputs.fitScore - 0.5) < 0.07;
    const explorationWeight = clamp(
      (1 - weightedConfidence) * 0.58 +
      (1 - clamp(totalScopeTrades / 18, 0, 1)) * 0.24 +
      (nearThreshold ? 0.12 : 0) +
      (inputs.pairHealth >= 0.58 ? 0.04 : 0) -
      inputs.newsRisk * 0.08,
      0.04,
      0.65
    );
    const fitBoost = clamp(weightedSignal * 0.055, -0.06, 0.06);
    const confidenceBoost = clamp(weightedSignal * 0.04, -0.03, 0.04);
    const thresholdShift = clamp(weightedSignal * -0.024, -0.028, 0.028);
    const sizeMultiplier = clamp(1 + weightedSignal * 0.11 - explorationWeight * 0.025, 0.82, 1.14);
    const marketRisk = clamp(
      (inputs.newsRisk * 0.46) +
      clamp(inputs.realizedVolPct / Math.max(0.01, safeNumber(this.config.strategyAllocationBudgetVolScalePct, 0.032)), 0, 1) * 0.34 +
      Math.max(0, -inputs.alignment) * 0.2,
      0,
      1
    );
    const convictionScore = clamp(
      weightedSignal * 0.42 +
      (weightedConfidence - 0.5) * 0.18 +
      (inputs.fitScore - 0.5) * 0.24 +
      (inputs.probability - 0.5) * 0.26 -
      marketRisk * 0.22,
      -1,
      1
    );
    const budgetMultiplier = clamp(
      1 + convictionScore * 0.18 - explorationWeight * 0.035,
      0.78,
      1.22
    );
    const budgetLane = budgetMultiplier >= 1.06
      ? "conviction"
      : budgetMultiplier <= 0.94
        ? "reduced"
        : "standard";
    const posture = weightedSignal >= 0.08 ? "favor"
      : weightedSignal <= -0.08 ? "cool"
        : "neutral";
    const topFamilies = rankBuckets(this.state.buckets, "family", 4, referenceMs, this.config);
    const topStrategies = rankBuckets(this.state.buckets, "strategy", 4, referenceMs, this.config);
    return {
      preferredFamily: topFamilies[0]?.id || inputs.family,
      preferredStrategy: topStrategies[0]?.id || inputs.strategy,
      activeFamily: inputs.family,
      activeStrategy: inputs.strategy,
      regime: inputs.regime,
      session: inputs.session,
      posture,
      fitBoost: num(fitBoost, 4),
      confidenceBoost: num(confidenceBoost, 4),
      thresholdShift: num(thresholdShift, 4),
      sizeMultiplier: num(sizeMultiplier, 4),
      budgetMultiplier: num(budgetMultiplier, 4),
      budgetLane,
      convictionScore: num(convictionScore, 4),
      marketRisk: num(marketRisk, 4),
      explorationWeight: num(explorationWeight, 4),
      confidence: num(weightedConfidence, 4),
      activeBias: num(weightedSignal, 4),
      scopes: scoredScopes
        .sort((left, right) => Math.abs(right.signal) - Math.abs(left.signal))
        .slice(0, 5),
      topFamilies,
      topStrategies,
      notes: [
        weightedSignal >= 0.08
          ? `Allocator bevoordeelt ${inputs.strategy} binnen ${inputs.regime}.`
          : weightedSignal <= -0.08
            ? `Allocator koelt ${inputs.strategy} binnen ${inputs.regime} voorlopig af.`
            : `Allocator houdt ${inputs.strategy} in ${inputs.regime} neutraal.`,
        budgetLane === "conviction"
          ? "Budget lane staat op conviction; deze context verdient iets meer sizing."
          : budgetLane === "reduced"
            ? "Budget lane staat op reduced; deze context krijgt bewust minder sizing."
            : "Budget lane blijft standaard; sizing blijft dicht bij de basis.",
        explorationWeight >= 0.3
          ? "Exploratiegewicht blijft verhoogd omdat de sample-diepte nog beperkt of oud is."
          : "Allocator leunt hier vooral op recente gesloten trades."
      ]
    };
  }

  updateFromTrade(trade = {}, label = {}) {
    const context = {
      score: {
        probability: trade.entryRationale?.probability || 0.5,
        confidence: trade.entryRationale?.confidence || 0
      },
      strategySummary: trade.entryRationale?.strategy || trade.strategyDecision || {},
      regimeSummary: trade.entryRationale?.regimeSummary || { regime: trade.regimeAtEntry || "range" },
      sessionSummary: trade.entryRationale?.session || { session: trade.sessionAtEntry || "unknown_session" },
      timeframeSummary: trade.entryRationale?.timeframe || {},
      pairHealthSummary: trade.entryRationale?.pairHealth || {},
      newsSummary: { riskScore: trade.entryRationale?.newsRisk || 0 },
      marketSnapshot: {
        market: {
          realizedVolPct: trade.entryRationale?.realizedVolPct || 0
        }
      }
    };
    const inputs = buildInputs(context);
    const labelScore = clamp(safeNumber(label.labelScore, 0.5), 0, 1);
    const rewardTarget = clamp(
      labelScore * 0.74 +
      clamp(safeNumber(trade.executionQualityScore, 0.5), 0, 1) * 0.14 +
      clamp(safeNumber(trade.captureEfficiency, 0.5), 0, 1) * 0.12,
      0,
      1
    );
    const scopes = buildScopeDescriptors(inputs);
    for (const descriptor of scopes) {
      const bucket = normalizeBucket(this.state.buckets[descriptor.key] || buildDefaultBucket());
      const previousTrades = bucket.trades;
      bucket.trades += 1;
      bucket.alpha += labelScore;
      bucket.beta += (1 - labelScore);
      bucket.rewardEma = previousTrades
        ? (bucket.rewardEma * 0.82) + (rewardTarget * 0.18)
        : rewardTarget;
      bucket.avgLabelScore = previousTrades
        ? ((bucket.avgLabelScore * previousTrades) + labelScore) / bucket.trades
        : labelScore;
      bucket.avgPnlPct = previousTrades
        ? ((bucket.avgPnlPct * previousTrades) + safeNumber(trade.netPnlPct, 0)) / bucket.trades
        : safeNumber(trade.netPnlPct, 0);
      bucket.avgExecutionQuality = previousTrades
        ? ((bucket.avgExecutionQuality * previousTrades) + clamp(safeNumber(trade.executionQualityScore, 0.5), 0, 1)) / bucket.trades
        : clamp(safeNumber(trade.executionQualityScore, 0.5), 0, 1);
      bucket.avgCaptureEfficiency = previousTrades
        ? ((bucket.avgCaptureEfficiency * previousTrades) + clamp(safeNumber(trade.captureEfficiency, 0.5), 0, 1)) / bucket.trades
        : clamp(safeNumber(trade.captureEfficiency, 0.5), 0, 1);
      bucket.lastTradeAt = trade.exitAt || trade.entryAt || new Date().toISOString();
      this.state.buckets[descriptor.key] = bucket;
    }

    this.state.history.unshift({
      at: trade.exitAt || trade.entryAt || new Date().toISOString(),
      regime: inputs.regime,
      session: inputs.session,
      family: inputs.family,
      strategy: inputs.strategy,
      labelScore: num(labelScore, 4),
      rewardTarget: num(rewardTarget, 4),
      netPnlPct: num(trade.netPnlPct || 0, 4)
    });
    this.state.history = this.state.history.slice(0, HISTORY_LIMIT);

    const bucketEntries = Object.entries(this.state.buckets);
    if (bucketEntries.length > MAX_BUCKETS) {
      const trimmed = bucketEntries
        .sort((left, right) => {
          const leftBucket = left[1];
          const rightBucket = right[1];
          const leftTime = leftBucket.lastTradeAt ? new Date(leftBucket.lastTradeAt).getTime() : 0;
          const rightTime = rightBucket.lastTradeAt ? new Date(rightBucket.lastTradeAt).getTime() : 0;
          return (rightBucket.trades - leftBucket.trades) || (rightTime - leftTime);
        })
        .slice(0, MAX_BUCKETS);
      this.state.buckets = Object.fromEntries(trimmed);
    }

    return this.score(context);
  }

  getSummary() {
    const referenceMs = Date.now();
    const lastTradeAt = this.state.history[0]?.at || null;
    const tradeCount = this.state.history.length;
    const topFamilies = rankBuckets(this.state.buckets, "family", 4, referenceMs, this.config);
    const topStrategies = rankBuckets(this.state.buckets, "strategy", 4, referenceMs, this.config);
    const topRegimes = rankBuckets(this.state.buckets, "family_regime", 4, referenceMs, this.config)
      .map((item) => ({
        ...item,
        regime: item.context || null
      }));
    const topSessions = rankBuckets(this.state.buckets, "session_family", 4, referenceMs, this.config)
      .map((item) => ({
        ...item,
        session: item.context || null
      }));
    const status = tradeCount >= 8 ? "active" : tradeCount >= 3 ? "building" : "warmup";
    const leadFamily = topFamilies[0];
    const leadStrategy = topStrategies[0];
    return {
      status,
      tradeCount,
      bucketCount: Object.keys(this.state.buckets).length,
      lastTradeAt,
      topFamilies,
      topStrategies,
      topRegimes,
      topSessions,
      notes: [
        leadStrategy
          ? `Allocator ziet ${leadStrategy.id} nu als sterkste strategie-bias.`
          : "Allocator warmt nog op; er zijn nog weinig gesloten trades.",
        leadFamily
          ? `Sterkste family-bias staat nu op ${leadFamily.id}.`
          : null
      ].filter(Boolean)
    };
  }
}

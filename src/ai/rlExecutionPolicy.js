import { clamp } from "../utils/math.js";

const ACTIONS = {
  defensive: {
    preferMakerBias: -0.15,
    patienceMultiplier: 0.82,
    sizeMultiplier: 0.9,
    trailingMultiplier: 0.92
  },
  balanced: {
    preferMakerBias: 0,
    patienceMultiplier: 1,
    sizeMultiplier: 1,
    trailingMultiplier: 1
  },
  aggressive: {
    preferMakerBias: 0.18,
    patienceMultiplier: 1.28,
    sizeMultiplier: 1.08,
    trailingMultiplier: 1.05
  }
};

function safeValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function buildDefaultState() {
  return {
    version: 1,
    buckets: {},
    metrics: {
      observations: 0,
      lastReward: null,
      lastUpdatedAt: null,
      recentRewards: []
    }
  };
}

function normalizeActionState(actionState) {
  return {
    value: safeValue(actionState?.value),
    count: safeValue(actionState?.count),
    lastReward: actionState?.lastReward == null ? null : safeValue(actionState.lastReward)
  };
}

function normalizeState(state) {
  const base = buildDefaultState();
  return {
    version: 1,
    buckets: Object.fromEntries(
      Object.entries(state?.buckets || {}).map(([bucket, actions]) => [
        bucket,
        Object.fromEntries(
          Object.keys(ACTIONS).map((action) => [action, normalizeActionState(actions?.[action])])
        )
      ])
    ),
    metrics: {
      observations: safeValue(state?.metrics?.observations),
      lastReward: state?.metrics?.lastReward == null ? null : safeValue(state.metrics.lastReward),
      lastUpdatedAt: state?.metrics?.lastUpdatedAt || null,
      recentRewards: Array.isArray(state?.metrics?.recentRewards)
        ? [...state.metrics.recentRewards].slice(-80)
        : base.metrics.recentRewards
    }
  };
}

export class ReinforcementExecutionPolicy {
  constructor(state, config) {
    this.state = normalizeState(state);
    this.config = config;
  }

  getState() {
    return this.state;
  }

  getBucketState(bucket) {
    if (!this.state.buckets[bucket]) {
      this.state.buckets[bucket] = Object.fromEntries(
        Object.keys(ACTIONS).map((action) => [action, normalizeActionState()])
      );
    }
    return this.state.buckets[bucket];
  }

  deriveBucket({ regimeSummary = {}, marketSnapshot = {}, score = {}, committeeSummary = {}, newsSummary = {} }) {
    const spreadBand = safeValue(marketSnapshot.book?.spreadBps) >= this.config.makerMinSpreadBps ? "wide" : "tight";
    const pressureBand = safeValue(marketSnapshot.book?.bookPressure) >= 0.15 ? "supportive" : safeValue(marketSnapshot.book?.bookPressure) <= -0.15 ? "weak" : "flat";
    const newsBand = safeValue(newsSummary.riskScore) >= 0.65 ? "newsrisk" : safeValue(newsSummary.sentimentScore) >= 0.18 ? "newspos" : "newsflat";
    const committeeBand = safeValue(committeeSummary.netScore) >= 0.12 ? "aligned" : safeValue(committeeSummary.netScore) <= -0.08 ? "mixed" : "neutral";
    return `${regimeSummary.regime || "range"}:${spreadBand}:${pressureBand}:${newsBand}:${committeeBand}`;
  }

  advise({ symbol, marketSnapshot, score, regimeSummary, committeeSummary = {}, newsSummary = {} }) {
    if (this.config.enableRlExecution === false) {
      return {
        symbol,
        bucket: "disabled",
        action: "balanced",
        confidence: 0,
        expectedReward: 0,
        sizeMultiplier: 1,
        patienceMultiplier: 1,
        trailingMultiplier: 1,
        preferMakerBoost: 0,
        reasons: ["rl_disabled"]
      };
    }
    const bucket = this.deriveBucket({ regimeSummary, marketSnapshot, score, committeeSummary, newsSummary });
    const bucketState = this.getBucketState(bucket);
    const actionEntries = Object.entries(ACTIONS).map(([action, modifiers]) => {
      const policy = bucketState[action] || normalizeActionState();
      const explorationBonus = this.config.enableRlExecution && this.config.botMode !== "live"
        ? Math.min(0.18, 0.12 / Math.sqrt((policy.count || 0) + 1))
        : 0;
      const prior = action === "balanced" ? 0.03 : action === "aggressive" && safeValue(score.probability) > 0.68 ? 0.02 : 0;
      return {
        action,
        modifiers,
        value: safeValue(policy.value),
        count: policy.count || 0,
        score: safeValue(policy.value) + explorationBonus + prior
      };
    });

    actionEntries.sort((left, right) => right.score - left.score);
    const selected = actionEntries[0] || { action: "balanced", modifiers: ACTIONS.balanced, value: 0, count: 0, score: 0 };
    const confidence = clamp(0.35 + Math.min(0.45, selected.count * 0.04) + Math.min(0.2, Math.abs(selected.value) * 0.25), 0, 1);
    const expectedReward = clamp(selected.value, -1, 1);
    const preferMakerBoost = selected.modifiers.preferMakerBias + (safeValue(committeeSummary.agreement) - 0.5) * 0.1;

    return {
      symbol,
      bucket,
      action: selected.action,
      confidence,
      expectedReward,
      sizeMultiplier: clamp(selected.modifiers.sizeMultiplier + Math.max(0, safeValue(committeeSummary.netScore)) * 0.04, 0.78, 1.14),
      patienceMultiplier: clamp(selected.modifiers.patienceMultiplier + Math.max(0, safeValue(score.confidence) - 0.4) * 0.15, 0.75, 1.45),
      trailingMultiplier: clamp(selected.modifiers.trailingMultiplier, 0.85, 1.15),
      preferMakerBoost: clamp(preferMakerBoost, -0.35, 0.35),
      reasons: [
        selected.action,
        bucket,
        `value ${selected.value.toFixed(3)}`,
        `visits ${selected.count}`
      ]
    };
  }

  updateFromTrade(trade, labelScore) {
    const decision = trade.executionPolicyDecision || trade.entryRationale?.rlPolicy;
    if (!decision?.bucket || !decision?.action) {
      return null;
    }
    const bucketState = this.getBucketState(decision.bucket);
    const actionState = bucketState[decision.action] || normalizeActionState();
    const pnlReward = clamp(safeValue(trade.netPnlPct) * 9, -1, 1);
    const executionReward = clamp((safeValue(trade.executionQualityScore) - 0.5) * 1.5, -0.75, 0.75);
    const captureReward = clamp((safeValue(trade.captureEfficiency) - 0.5) * 1.2, -0.5, 0.5);
    const calibrationReward = clamp((safeValue(labelScore) - 0.5) * 0.3, -0.15, 0.15);
    const reward = clamp(pnlReward * 0.55 + executionReward * 0.3 + captureReward * 0.1 + calibrationReward, -1, 1);
    const nextCount = (actionState.count || 0) + 1;
    actionState.value += (reward - safeValue(actionState.value)) / nextCount;
    actionState.count = nextCount;
    actionState.lastReward = reward;
    bucketState[decision.action] = actionState;

    this.state.metrics.observations += 1;
    this.state.metrics.lastReward = reward;
    this.state.metrics.lastUpdatedAt = trade.exitAt || new Date().toISOString();
    this.state.metrics.recentRewards.push({
      at: this.state.metrics.lastUpdatedAt,
      bucket: decision.bucket,
      action: decision.action,
      reward
    });
    if (this.state.metrics.recentRewards.length > 80) {
      this.state.metrics.recentRewards = this.state.metrics.recentRewards.slice(-80);
    }

    return {
      bucket: decision.bucket,
      action: decision.action,
      reward,
      visits: nextCount
    };
  }

  getSummary() {
    const recent = this.state.metrics.recentRewards.slice(-30);
    const averageReward = recent.length
      ? recent.reduce((total, item) => total + safeValue(item.reward), 0) / recent.length
      : null;
    const topPolicies = Object.entries(this.state.buckets)
      .map(([bucket, actions]) => {
        const best = Object.entries(actions || {})
          .map(([action, state]) => ({ action, value: safeValue(state?.value), count: state?.count || 0 }))
          .sort((left, right) => right.value - left.value)[0];
        return best ? { bucket, ...best } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.count - left.count || right.value - left.value)
      .slice(0, 6);

    return {
      observations: this.state.metrics.observations,
      lastReward: this.state.metrics.lastReward,
      lastUpdatedAt: this.state.metrics.lastUpdatedAt,
      averageReward,
      topPolicies
    };
  }

  getWeightView() {
    return Object.entries(this.state.buckets)
      .flatMap(([bucket, actions]) =>
        Object.entries(actions || {}).map(([action, state]) => ({
          name: `rl:${bucket}:${action}`,
          weight: clamp(safeValue(state?.value), -2, 2)
        }))
      )
      .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))
      .slice(0, 12);
  }
}

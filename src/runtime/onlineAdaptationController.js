import { clamp } from "../utils/math.js";

const HISTORY_LIMIT = 40;
const POLICY_LIMIT = 240;

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeId(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function buildDefaultPolicy(scopeType, scopeId, scope = {}) {
  return {
    scopeType,
    scopeId,
    scope,
    tradeCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    thresholdBias: 0,
    sizeBias: 1,
    confidenceBias: 0,
    cautionPenalty: 0,
    lastTradeAt: null,
    lastCategory: null,
    lastConfidence: 0
  };
}

function normalizePolicy(scopeType, scopeId, scope = {}, policy = {}) {
  const normalized = buildDefaultPolicy(scopeType, scopeId, scope);
  return {
    ...normalized,
    ...policy,
    scopeType,
    scopeId,
    scope,
    tradeCount: Math.max(0, Math.round(safeNumber(policy.tradeCount, 0))),
    positiveCount: Math.max(0, Math.round(safeNumber(policy.positiveCount, 0))),
    negativeCount: Math.max(0, Math.round(safeNumber(policy.negativeCount, 0))),
    thresholdBias: clamp(safeNumber(policy.thresholdBias, 0), -0.01, 0.01),
    sizeBias: clamp(safeNumber(policy.sizeBias, 1), 0.9, 1.08),
    confidenceBias: clamp(safeNumber(policy.confidenceBias, 0), -0.03, 0.03),
    cautionPenalty: clamp(safeNumber(policy.cautionPenalty, 0), 0, 0.08),
    lastConfidence: clamp(safeNumber(policy.lastConfidence, 0), 0, 1)
  };
}

function normalizeState(state = {}) {
  const policies = Object.fromEntries(
    Object.entries(state.policies || {}).map(([key, value]) => {
      const [scopeType, scopeId] = String(key).split("::");
      return [key, normalizePolicy(scopeType || "scope", scopeId || "unknown", value.scope || {}, value)];
    })
  );
  return {
    version: 1,
    lastUpdatedAt: state.lastUpdatedAt || null,
    policies,
    history: arr(state.history).slice(-HISTORY_LIMIT),
    lastApplied: state.lastApplied || null
  };
}

function scopeKey(scopeType, scopeId) {
  return `${scopeType}::${scopeId}`;
}

function buildScopeDescriptors(scope = {}) {
  const family = normalizeId(scope.family, "unknown_family");
  const strategy = normalizeId(scope.strategy, "unknown_strategy");
  const regime = normalizeId(scope.regime, "unknown_regime");
  const session = normalizeId(scope.session, "unknown_session");
  const condition = normalizeId(scope.condition, "unknown_condition");
  return [
    { scopeType: "family", scopeId: family, weight: 0.36, scope: { family } },
    { scopeType: "family_regime", scopeId: `${family}:${regime}`, weight: 0.26, scope: { family, regime } },
    { scopeType: "strategy", scopeId: strategy, weight: 0.16, scope: { strategy, family } },
    { scopeType: "session_family", scopeId: `${session}:${family}`, weight: 0.14, scope: { session, family } },
    { scopeType: "condition_family", scopeId: `${condition}:${family}`, weight: 0.08, scope: { condition, family } }
  ];
}

function buildCategoryDelta(category = "uncertain") {
  switch (category) {
    case "good_trade":
      return { thresholdBias: -0.0018, sizeBias: 1.018, confidenceBias: 0.009, cautionPenalty: -0.004, direction: "positive" };
    case "timing_problem":
      return { thresholdBias: 0.0018, sizeBias: 0.992, confidenceBias: -0.006, cautionPenalty: 0.012, direction: "negative" };
    case "regime_problem":
      return { thresholdBias: 0.0028, sizeBias: 0.982, confidenceBias: -0.011, cautionPenalty: 0.02, direction: "negative" };
    case "data_problem":
      return { thresholdBias: 0.0032, sizeBias: 0.978, confidenceBias: -0.012, cautionPenalty: 0.024, direction: "negative" };
    case "execution_problem":
      return { thresholdBias: 0.0012, sizeBias: 0.974, confidenceBias: -0.008, cautionPenalty: 0.024, direction: "negative" };
    case "risk_problem":
      return { thresholdBias: 0.0024, sizeBias: 0.968, confidenceBias: -0.01, cautionPenalty: 0.026, direction: "negative" };
    case "exit_problem":
      return { thresholdBias: 0, sizeBias: 1, confidenceBias: 0, cautionPenalty: 0.006, direction: "analysis_only" };
    case "mixed_problem":
      return { thresholdBias: 0.0016, sizeBias: 0.986, confidenceBias: -0.006, cautionPenalty: 0.016, direction: "negative" };
    default:
      return { thresholdBias: 0, sizeBias: 1, confidenceBias: 0, cautionPenalty: 0.004, direction: "analysis_only" };
  }
}

function blendMetric(current, target, learningRate, min, max) {
  const base = safeNumber(current, min === 0 && max === 0 ? 0 : (min + max) / 2);
  return clamp(base + (target - base) * learningRate, min, max);
}

function summarizePolicy(policy = {}) {
  return {
    scopeType: policy.scopeType || null,
    scopeId: policy.scopeId || null,
    scope: policy.scope || {},
    tradeCount: policy.tradeCount || 0,
    thresholdBias: num(policy.thresholdBias || 0),
    sizeBias: num(policy.sizeBias || 1),
    confidenceBias: num(policy.confidenceBias || 0),
    cautionPenalty: num(policy.cautionPenalty || 0),
    lastTradeAt: policy.lastTradeAt || null,
    lastCategory: policy.lastCategory || null,
    lastConfidence: num(policy.lastConfidence || 0)
  };
}

export function buildOnlineAdaptationState(state = {}) {
  return normalizeState(state);
}

export function summarizeOnlineAdaptation(state = {}) {
  const normalized = normalizeState(state);
  const policies = Object.values(normalized.policies)
    .sort((left, right) => Math.abs(safeNumber(right.thresholdBias, 0)) - Math.abs(safeNumber(left.thresholdBias, 0)) || (right.tradeCount || 0) - (left.tradeCount || 0))
    .slice(0, 8)
    .map(summarizePolicy);
  return {
    version: 1,
    status: policies.length ? "active" : "warmup",
    lastUpdatedAt: normalized.lastUpdatedAt || null,
    policyCount: Object.keys(normalized.policies).length,
    topPolicies: policies,
    lastApplied: normalized.lastApplied || null,
    history: arr(normalized.history).slice(0, 6)
  };
}

export function updateOnlineAdaptationState(state = {}, {
  trade = {},
  attribution = {},
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const normalized = normalizeState(state);
  const enabled = config.adaptiveLearningEnabled !== false;
  if (!enabled) {
    return {
      state: normalized,
      runtimeApplied: null,
      analysisOnly: {
        enabled: false,
        reason: "adaptive_learning_disabled"
      }
    };
  }

  const scope = attribution.scope || {
    family: trade.strategyFamily || trade.entryRationale?.strategy?.family || null,
    strategy: trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || null,
    regime: trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || null,
    session: trade.sessionAtEntry || trade.entryRationale?.session?.session || null,
    condition: trade.marketConditionAtEntry || trade.entryRationale?.marketCondition?.conditionId || null
  };
  const descriptors = buildScopeDescriptors(scope);
  const baseDelta = buildCategoryDelta(attribution.category || "uncertain");
  const learningRate = clamp(safeNumber(config.adaptiveLearningCoreLearningRate, 0.01), 0.002, 0.03);
  const attributionConfidence = clamp(safeNumber(attribution.confidence, 0.5), 0.1, 1);
  const allowPositive = (trade.brokerMode || config.botMode || "paper") === "paper";
  const runtimeApplied = [];
  const analysisOnly = [];

  for (const descriptor of descriptors) {
    const key = scopeKey(descriptor.scopeType, descriptor.scopeId);
    const existing = normalizePolicy(descriptor.scopeType, descriptor.scopeId, descriptor.scope, normalized.policies[key]);
    const scopedRate = learningRate * descriptor.weight * attributionConfidence;
    const positiveDirection = baseDelta.direction === "positive";
    const activeDirection = positiveDirection && !allowPositive ? "analysis_only" : baseDelta.direction;
    const thresholdTarget = activeDirection === "analysis_only"
      ? existing.thresholdBias
      : clamp(existing.thresholdBias + baseDelta.thresholdBias, -(config.adaptiveLearningMaxThresholdShift || 0.012), config.adaptiveLearningMaxThresholdShift || 0.012);
    const sizeTarget = activeDirection === "analysis_only"
      ? existing.sizeBias
      : clamp(existing.sizeBias * baseDelta.sizeBias, 1 - (config.adaptiveLearningMaxSizeBias || 0.08), 1 + (config.adaptiveLearningMaxSizeBias || 0.08));
    const confidenceTarget = activeDirection === "analysis_only"
      ? existing.confidenceBias
      : clamp(existing.confidenceBias + baseDelta.confidenceBias, -0.03, 0.03);
    const cautionTarget = clamp(existing.cautionPenalty + Math.max(0, baseDelta.cautionPenalty), 0, 0.08);
    const next = {
      ...existing,
      tradeCount: existing.tradeCount + 1,
      positiveCount: existing.positiveCount + (activeDirection === "positive" ? 1 : 0),
      negativeCount: existing.negativeCount + (activeDirection === "negative" ? 1 : 0),
      thresholdBias: blendMetric(existing.thresholdBias, thresholdTarget, scopedRate, -(config.adaptiveLearningMaxThresholdShift || 0.012), config.adaptiveLearningMaxThresholdShift || 0.012),
      sizeBias: blendMetric(existing.sizeBias, sizeTarget, scopedRate, 1 - (config.adaptiveLearningMaxSizeBias || 0.08), 1 + (config.adaptiveLearningMaxSizeBias || 0.08)),
      confidenceBias: blendMetric(existing.confidenceBias, confidenceTarget, scopedRate, -0.03, 0.03),
      cautionPenalty: blendMetric(existing.cautionPenalty, cautionTarget, scopedRate, 0, 0.08),
      lastTradeAt: trade.exitAt || trade.entryAt || nowIso,
      lastCategory: attribution.category || "uncertain",
      lastConfidence: attributionConfidence
    };
    normalized.policies[key] = next;

    const summary = {
      scopeType: descriptor.scopeType,
      scopeId: descriptor.scopeId,
      thresholdBias: num(next.thresholdBias),
      sizeBias: num(next.sizeBias),
      confidenceBias: num(next.confidenceBias),
      cautionPenalty: num(next.cautionPenalty),
      confidence: num(attributionConfidence),
      category: attribution.category || "uncertain"
    };
    if (activeDirection === "analysis_only") {
      analysisOnly.push(summary);
    } else {
      runtimeApplied.push(summary);
    }
  }

  const keys = Object.keys(normalized.policies);
  if (keys.length > POLICY_LIMIT) {
    normalized.policies = Object.fromEntries(
      keys
        .map((key) => [key, normalized.policies[key]])
        .sort((left, right) => {
          const rightAt = new Date(right[1].lastTradeAt || 0).getTime();
          const leftAt = new Date(left[1].lastTradeAt || 0).getTime();
          return rightAt - leftAt || (right[1].tradeCount || 0) - (left[1].tradeCount || 0);
        })
        .slice(0, POLICY_LIMIT)
    );
  }

  normalized.history.unshift({
    at: nowIso,
    symbol: trade.symbol || null,
    category: attribution.category || "uncertain",
    confidence: num(attributionConfidence),
    runtimeApplied: runtimeApplied.length,
    analysisOnly: analysisOnly.length
  });
  normalized.history = normalized.history.slice(0, HISTORY_LIMIT);
  normalized.lastUpdatedAt = nowIso;
  normalized.lastApplied = {
    at: nowIso,
    symbol: trade.symbol || null,
    category: attribution.category || "uncertain",
    runtimeApplied: runtimeApplied.slice(0, 4),
    analysisOnly: analysisOnly.slice(0, 4)
  };

  return {
    state: normalized,
    runtimeApplied: runtimeApplied.slice(0, 6),
    analysisOnly: analysisOnly.slice(0, 6)
  };
}

export function buildOnlineAdaptationGuidance(state = {}, {
  strategySummary = {},
  regimeSummary = {},
  sessionSummary = {},
  marketConditionSummary = {}
} = {}) {
  const normalized = normalizeState(state);
  const descriptors = buildScopeDescriptors({
    family: strategySummary.family || null,
    strategy: strategySummary.activeStrategy || strategySummary.strategyLabel || null,
    regime: regimeSummary.regime || null,
    session: sessionSummary.session || null,
    condition: marketConditionSummary.conditionId || null
  });
  const matches = descriptors
    .map((descriptor) => {
      const policy = normalized.policies[scopeKey(descriptor.scopeType, descriptor.scopeId)];
      return policy ? { descriptor, policy } : null;
    })
    .filter(Boolean);
  if (!matches.length) {
    return {
      active: false,
      thresholdShift: 0,
      sizeMultiplier: 1,
      confidenceBias: 0,
      cautionPenalty: 0,
      reasons: [],
      matchedScopes: []
    };
  }
  const totalWeight = matches.reduce((sum, item) => sum + item.descriptor.weight, 0) || 1;
  const weighted = (field, fallback = 0) => matches.reduce(
    (sum, item) => sum + safeNumber(item.policy[field], fallback) * item.descriptor.weight,
    0
  ) / totalWeight;
  return {
    active: true,
    thresholdShift: num(clamp(weighted("thresholdBias", 0), -0.01, 0.01)),
    sizeMultiplier: num(clamp(weighted("sizeBias", 1), 0.92, 1.08)),
    confidenceBias: num(clamp(weighted("confidenceBias", 0), -0.03, 0.03)),
    cautionPenalty: num(clamp(weighted("cautionPenalty", 0), 0, 0.08)),
    reasons: matches.map((item) => `${item.descriptor.scopeType}:${item.descriptor.scopeId}`).slice(0, 6),
    matchedScopes: matches
      .sort((left, right) => right.descriptor.weight - left.descriptor.weight)
      .slice(0, 6)
      .map((item) => ({
        scopeType: item.descriptor.scopeType,
        scopeId: item.descriptor.scopeId,
        thresholdBias: num(item.policy.thresholdBias || 0),
        sizeBias: num(item.policy.sizeBias || 1),
        confidenceBias: num(item.policy.confidenceBias || 0),
        cautionPenalty: num(item.policy.cautionPenalty || 0),
        tradeCount: item.policy.tradeCount || 0
      }))
  };
}

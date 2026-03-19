import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

export function detectFeedFailureKind(errorMessage = "") {
  const text = `${errorMessage}`.toLowerCase();
  return {
    isTimeout: text.includes("timeout") || text.includes("aborted"),
    isRateLimit: text.includes("429") || text.includes("rate limit")
  };
}

export function normalizeExternalFeedState(state = {}, { group = "external", feed = null } = {}) {
  return {
    group: state.group || group,
    feed: state.feed || feed,
    successCount: Number(state.successCount || 0),
    failureCount: Number(state.failureCount || 0),
    timeoutCount: Number(state.timeoutCount || 0),
    rateLimitCount: Number(state.rateLimitCount || 0),
    skipCount: Number(state.skipCount || 0),
    recentFailures: Number(state.recentFailures || 0),
    score: Number.isFinite(state.score) ? Number(state.score) : 0.7,
    cooldownUntil: state.cooldownUntil || null,
    lastSuccessAt: state.lastSuccessAt || null,
    lastFailureAt: state.lastFailureAt || null,
    lastError: state.lastError || null
  };
}

function ensureBucket(runtime) {
  runtime.externalFeedHealth = runtime.externalFeedHealth || {};
  return runtime.externalFeedHealth;
}

function buildKey(group, feedId) {
  return `${group}:${feedId}`;
}

export class ExternalFeedRegistry {
  constructor(config) {
    this.config = config;
  }

  getFeedState(runtime, feedId, { group = "external", legacyBucket = null } = {}) {
    const bucket = ensureBucket(runtime);
    const key = buildKey(group, feedId);
    if (!bucket[key] && legacyBucket && runtime[legacyBucket]?.[feedId]) {
      bucket[key] = normalizeExternalFeedState(runtime[legacyBucket][feedId], { group, feed: feedId });
    }
    bucket[key] = normalizeExternalFeedState(bucket[key], { group, feed: feedId });
    if (legacyBucket) {
      runtime[legacyBucket] = runtime[legacyBucket] || {};
      runtime[legacyBucket][feedId] = bucket[key];
    }
    return bucket[key];
  }

  shouldUse(runtime, feedId, nowIso = new Date().toISOString(), options = {}) {
    const state = this.getFeedState(runtime, feedId, options);
    const cooldownUntilMs = new Date(state.cooldownUntil || 0).getTime();
    const nowMs = new Date(nowIso).getTime();
    if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs) {
      state.skipCount += 1;
      return {
        allow: false,
        reason: "provider_cooldown_active",
        cooldownUntil: state.cooldownUntil,
        score: state.score
      };
    }
    const minOperationalScore = Number.isFinite(options.minOperationalScore) ? options.minOperationalScore : null;
    if (minOperationalScore != null && state.score < minOperationalScore) {
      return {
        allow: false,
        reason: "provider_operational_score_too_low",
        cooldownUntil: state.cooldownUntil,
        score: state.score
      };
    }
    return {
      allow: true,
      reason: null,
      cooldownUntil: state.cooldownUntil,
      score: state.score
    };
  }

  noteSuccess(runtime, feedId, nowIso = new Date().toISOString(), options = {}) {
    const state = this.getFeedState(runtime, feedId, options);
    state.successCount += 1;
    state.recentFailures = Math.max(0, state.recentFailures - 1);
    state.lastSuccessAt = nowIso;
    state.lastError = null;
    state.cooldownUntil = null;
    state.score = clamp(state.score * 0.72 + 0.28 + Math.min(0.08, state.successCount / 80), 0.25, 1);
    return normalizeExternalFeedState(state, { group: options.group, feed: feedId });
  }

  noteFailure(runtime, feedId, errorMessage = "", nowIso = new Date().toISOString(), options = {}) {
    const state = this.getFeedState(runtime, feedId, options);
    const kind = detectFeedFailureKind(errorMessage);
    state.failureCount += 1;
    state.recentFailures += 1;
    state.lastFailureAt = nowIso;
    state.lastError = errorMessage || null;
    if (kind.isTimeout) {
      state.timeoutCount += 1;
    }
    if (kind.isRateLimit) {
      state.rateLimitCount += 1;
    }
    const penalty = kind.isRateLimit ? 0.22 : kind.isTimeout ? 0.16 : 0.1;
    state.score = clamp(state.score * 0.72 - penalty - Math.min(0.08, state.recentFailures * 0.02), 0.05, 1);
    const cooldownMinutes = kind.isRateLimit
      ? this.config.sourceReliabilityRateLimitCooldownMinutes
      : kind.isTimeout
        ? this.config.sourceReliabilityTimeoutCooldownMinutes
        : this.config.sourceReliabilityFailureCooldownMinutes;
    if (state.recentFailures >= this.config.sourceReliabilityMaxRecentFailures || kind.isRateLimit) {
      state.cooldownUntil = new Date(new Date(nowIso).getTime() + Math.max(1, cooldownMinutes) * 60_000).toISOString();
    }
    return normalizeExternalFeedState(state, { group: options.group, feed: feedId });
  }

  buildSummary(runtime = {}, {
    group = null,
    excludeGroups = [],
    nowIso = new Date().toISOString(),
    minOperationalScore = null
  } = {}) {
    const nowMs = new Date(nowIso).getTime();
    const providers = Object.values(runtime.externalFeedHealth || {})
      .map((state) => normalizeExternalFeedState(state))
      .filter((state) => !group || state.group === group)
      .filter((state) => !excludeGroups.includes(state.group))
      .map((state) => {
        const cooldownUntilMs = new Date(state.cooldownUntil || 0).getTime();
        return {
          provider: state.feed || null,
          group: state.group || "external",
          score: num(state.score),
          successCount: state.successCount,
          failureCount: state.failureCount,
          timeoutCount: state.timeoutCount,
          rateLimitCount: state.rateLimitCount,
          skipCount: state.skipCount,
          recentFailures: state.recentFailures,
          coolingDown: Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs,
          cooldownUntil: state.cooldownUntil,
          lastSuccessAt: state.lastSuccessAt,
          lastFailureAt: state.lastFailureAt,
          lastError: state.lastError
        };
      })
      .sort((left, right) => right.score - left.score);

    const floor = Number.isFinite(minOperationalScore) ? minOperationalScore : this.config.sourceReliabilityMinOperationalScore;
    return {
      generatedAt: nowIso,
      providerCount: providers.length,
      averageScore: num(providers.length ? providers.reduce((total, item) => total + item.score, 0) / providers.length : 0.7),
      degradedCount: providers.filter((provider) => provider.score < floor).length,
      coolingDownCount: providers.filter((provider) => provider.coolingDown).length,
      providers,
      notes: providers.some((provider) => provider.coolingDown)
        ? [`${providers.find((provider) => provider.coolingDown)?.group || "external"} feed staat tijdelijk op cooldown.`]
        : ["Externe feeds draaien zonder actieve cooldowns."]
    };
  }
}

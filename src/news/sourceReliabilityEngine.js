import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function normalizeProviderState(state = {}) {
  return {
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

function detectFailureKind(errorMessage = "") {
  const text = `${errorMessage}`.toLowerCase();
  return {
    isTimeout: text.includes("timeout") || text.includes("aborted"),
    isRateLimit: text.includes("429") || text.includes("rate limit")
  };
}

export class SourceReliabilityEngine {
  constructor(config) {
    this.config = config;
  }

  getProviderState(runtime, providerId) {
    runtime.newsSourceHealth = runtime.newsSourceHealth || {};
    runtime.newsSourceHealth[providerId] = normalizeProviderState(runtime.newsSourceHealth[providerId]);
    return runtime.newsSourceHealth[providerId];
  }

  shouldUseProvider(runtime, providerId, nowIso = new Date().toISOString()) {
    const state = this.getProviderState(runtime, providerId);
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
    if (state.score < this.config.sourceReliabilityMinOperationalScore) {
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

  noteSuccess(runtime, providerId, nowIso = new Date().toISOString()) {
    const state = this.getProviderState(runtime, providerId);
    state.successCount += 1;
    state.recentFailures = Math.max(0, state.recentFailures - 1);
    state.lastSuccessAt = nowIso;
    state.lastError = null;
    state.cooldownUntil = null;
    state.score = clamp(state.score * 0.72 + 0.28 + Math.min(0.08, state.successCount / 80), 0.25, 1);
    return normalizeProviderState(state);
  }

  noteFailure(runtime, providerId, errorMessage = "", nowIso = new Date().toISOString()) {
    const state = this.getProviderState(runtime, providerId);
    const kind = detectFailureKind(errorMessage);
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
    return normalizeProviderState(state);
  }

  buildSummary(runtime = {}, nowIso = new Date().toISOString()) {
    const providers = Object.entries(runtime.newsSourceHealth || {}).map(([provider, state]) => {
      const normalized = normalizeProviderState(state);
      const cooldownUntilMs = new Date(normalized.cooldownUntil || 0).getTime();
      return {
        provider,
        score: num(normalized.score),
        successCount: normalized.successCount,
        failureCount: normalized.failureCount,
        timeoutCount: normalized.timeoutCount,
        rateLimitCount: normalized.rateLimitCount,
        skipCount: normalized.skipCount,
        recentFailures: normalized.recentFailures,
        coolingDown: Number.isFinite(cooldownUntilMs) && cooldownUntilMs > new Date(nowIso).getTime(),
        cooldownUntil: normalized.cooldownUntil,
        lastSuccessAt: normalized.lastSuccessAt,
        lastFailureAt: normalized.lastFailureAt,
        lastError: normalized.lastError
      };
    }).sort((left, right) => right.score - left.score);

    return {
      generatedAt: nowIso,
      providerCount: providers.length,
      averageScore: num(providers.length ? providers.reduce((total, item) => total + item.score, 0) / providers.length : 0.7),
      degradedCount: providers.filter((provider) => provider.score < this.config.sourceReliabilityMinOperationalScore).length,
      coolingDownCount: providers.filter((provider) => provider.coolingDown).length,
      providers,
      notes: providers.some((provider) => provider.coolingDown)
        ? [`${providers.find((provider) => provider.coolingDown)?.provider} staat tijdelijk op cooldown.`]
        : ["Nieuwsproviders draaien zonder actieve cooldowns."]
    };
  }
}

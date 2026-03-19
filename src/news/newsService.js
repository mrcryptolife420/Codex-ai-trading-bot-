import { nowIso } from "../utils/time.js";
import { SourceReliabilityEngine } from "./sourceReliabilityEngine.js";
import { BlockworksProvider } from "./blockworksProvider.js";
import { CoinDeskProvider } from "./coindeskProvider.js";
import { CointelegraphProvider } from "./cointelegraphProvider.js";
import { DecryptProvider } from "./decryptProvider.js";
import { GoogleNewsProvider } from "./googleNewsProvider.js";
import { summarizeNews } from "./sentiment.js";
import { mapWithConcurrency } from "../utils/async.js";
import { RequestBudget } from "../utils/requestBudget.js";

const EMPTY_SUMMARY = {
  coverage: 0,
  sentimentScore: 0,
  riskScore: 0,
  confidence: 0,
  headlines: [],
  providerCounts: {},
  sourceCounts: {},
  channelCounts: {},
  bullishDrivers: [],
  bearishDrivers: [],
  dominantEventType: "general",
  eventBullishScore: 0,
  eventBearishScore: 0,
  eventRiskScore: 0,
  sourceQualityScore: 0,
  providerQualityScore: 0,
  reliabilityScore: 0,
  whitelistCoverage: 0,
  maxSeverity: 0,
  socialCoverage: 0,
  socialSentiment: 0,
  socialRisk: 0,
  socialEngagement: 0,
  operationalReliability: 0.7,
  providerOperationalHealth: []
};

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

export class NewsService {
  constructor({ config, runtime, logger, recordEvent = null, recordHistory = null }) {
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
    this.recordEvent = typeof recordEvent === "function" ? recordEvent : null;
    this.recordHistory = typeof recordHistory === "function" ? recordHistory : null;
    this.reliability = new SourceReliabilityEngine(config);
    this.requestBudget = new RequestBudget({
      timeoutMs: 8_000,
      baseCooldownMs: Math.max(1, Number(config.sourceReliabilityFailureCooldownMinutes || 8)) * 60_000,
      maxCooldownMs: Math.max(1, Number(config.sourceReliabilityRateLimitCooldownMinutes || 30)) * 60_000,
      registry: this.reliability.registry,
      runtime,
      group: "news"
    });
    this.providers = [
      { id: "google_news", client: new GoogleNewsProvider(logger) },
      { id: "coindesk", client: new CoinDeskProvider(logger) },
      { id: "cointelegraph", client: new CointelegraphProvider(logger) },
      { id: "decrypt", client: new DecryptProvider(logger) },
      { id: "blockworks", client: new BlockworksProvider(logger) }
    ];
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= this.config.newsCacheMinutes * 60 * 1000;
  }

  async maybeRecordHistory({ symbol, aliases, summary, items = [], cacheState, cacheEntry = null } = {}) {
    if (!this.recordHistory || !symbol || !summary) {
      return;
    }
    const entry = cacheEntry || this.runtime.newsCache?.[symbol];
    if (!entry) {
      return;
    }
    entry.historyRecorded = entry.historyRecorded || {};
    if (entry.historyRecorded[cacheState]) {
      return;
    }
    try {
      await this.recordHistory({
        at: nowIso(),
        symbol,
        aliases,
        summary,
        items,
        cacheState
      });
      entry.historyRecorded[cacheState] = true;
    } catch (error) {
      this.logger.warn("News history record failed", {
        symbol,
        error: error.message
      });
    }
  }

  async getSymbolSummary(symbol, aliases) {
    const cached = this.runtime.newsCache?.[symbol];
    if (this.isFresh(cached)) {
      await this.maybeRecordHistory({
        symbol,
        aliases,
        summary: cached.summary,
        items: cached.items || [],
        cacheState: "cached",
        cacheEntry: cached
      });
      this.runtime.sourceReliability = this.reliability.buildSummary(this.runtime);
      return cached.summary;
    }

    const now = nowIso();
    try {
      const items = [];
      const usedProviders = [];
      let successfulProviders = 0;
      const providerResults = await mapWithConcurrency(this.providers, 3, async (provider) => {
        const gate = this.reliability.shouldUseProvider(this.runtime, provider.id, now);
        if (!gate.allow) {
          this.recordEvent?.("source_provider_cooldown", {
            symbol,
            provider: provider.id,
            reason: gate.reason,
            score: gate.score,
            cooldownUntil: gate.cooldownUntil
          });
          return { providerId: provider.id, skipped: true };
        }
        try {
          const result = await provider.client.fetchNews({
            symbol,
            aliases,
            lookbackHours: this.config.newsLookbackHours,
            limit: this.config.newsHeadlineLimit,
            requestBudget: this.requestBudget,
            runtime: this.runtime,
            providerId: provider.id
          });
          this.reliability.noteSuccess(this.runtime, provider.id, nowIso());
          successfulProviders += 1;
          return {
            providerId: provider.id,
            items: Array.isArray(result) ? result : [],
            skipped: false
          };
        } catch (error) {
          this.reliability.noteFailure(this.runtime, provider.id, error.message, nowIso());
          this.logger.warn("News provider failed", {
            symbol,
            provider: provider.id,
            error: error.message
          });
          this.recordEvent?.("news_provider_failure", {
            symbol,
            provider: provider.id,
            error: error.message
          });
          return {
            providerId: provider.id,
            skipped: false,
            error
          };
        }
      });
      for (const result of providerResults) {
        if (!result || result.skipped || result.error) {
          continue;
        }
        items.push(...(result.items || []));
        usedProviders.push(result.providerId);
      }
      if (successfulProviders === 0) {
        if (cached?.summary) {
          await this.maybeRecordHistory({
            symbol,
            aliases,
            summary: cached.summary,
            items: cached.items || [],
            cacheState: "fallback",
            cacheEntry: cached
          });
          this.runtime.sourceReliability = this.reliability.buildSummary(this.runtime);
          return cached.summary;
        }
        this.runtime.sourceReliability = this.reliability.buildSummary(this.runtime);
        return EMPTY_SUMMARY;
      }
      const summary = summarizeNews(items, this.config.newsLookbackHours, nowIso(), {
        minSourceQuality: this.config.newsMinSourceQuality,
        minReliabilityScore: this.config.newsMinReliabilityScore,
        strictWhitelist: this.config.newsStrictWhitelist
      });
      const providerOperationalHealth = usedProviders.map((providerId) => {
        const state = this.reliability.getProviderState(this.runtime, providerId);
        return {
          provider: providerId,
          score: num(state.score),
          cooldownUntil: state.cooldownUntil || null
        };
      });
      const operationalReliability = num(average(providerOperationalHealth.map((item) => item.score), 0.7));
      const adjustedSummary = {
        ...summary,
        confidence: Math.max(0, Math.min(1, summary.confidence * (0.8 + operationalReliability * 0.2))),
        reliabilityScore: Math.max(0, Math.min(1, summary.reliabilityScore * (0.82 + operationalReliability * 0.18))),
        operationalReliability,
        providerOperationalHealth
      };
      this.runtime.newsCache[symbol] = {
        fetchedAt: nowIso(),
        summary: adjustedSummary,
        items,
        historyRecorded: {
          fresh_fetch: false,
          cached: false,
          fallback: false
        }
      };
      await this.maybeRecordHistory({
        symbol,
        aliases,
        summary: adjustedSummary,
        items,
        cacheState: "fresh_fetch",
        cacheEntry: this.runtime.newsCache[symbol]
      });
      this.runtime.sourceReliability = this.reliability.buildSummary(this.runtime);
      return adjustedSummary;
    } catch (error) {
      this.logger.warn("News fetch failed, using cached/empty summary", {
        symbol,
        error: error.message
      });
      if (cached?.summary) {
        await this.maybeRecordHistory({
          symbol,
          aliases,
          summary: cached.summary,
          items: cached.items || [],
          cacheState: "fallback",
          cacheEntry: cached
        });
      }
      this.runtime.sourceReliability = this.reliability.buildSummary(this.runtime);
      return cached?.summary || EMPTY_SUMMARY;
    }
  }
}

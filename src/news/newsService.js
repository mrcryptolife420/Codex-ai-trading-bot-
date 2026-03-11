import { nowIso } from "../utils/time.js";
import { SourceReliabilityEngine } from "./sourceReliabilityEngine.js";
import { BlockworksProvider } from "./blockworksProvider.js";
import { CoinDeskProvider } from "./coindeskProvider.js";
import { CointelegraphProvider } from "./cointelegraphProvider.js";
import { DecryptProvider } from "./decryptProvider.js";
import { GoogleNewsProvider } from "./googleNewsProvider.js";
import { RedditProvider } from "./redditProvider.js";
import { summarizeNews } from "./sentiment.js";

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
  constructor({ config, runtime, logger, recordEvent = null }) {
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
    this.recordEvent = typeof recordEvent === "function" ? recordEvent : null;
    this.reliability = new SourceReliabilityEngine(config);
    this.providers = [
      { id: "google_news", client: new GoogleNewsProvider(logger) },
      { id: "coindesk", client: new CoinDeskProvider(logger) },
      { id: "cointelegraph", client: new CointelegraphProvider(logger) },
      { id: "decrypt", client: new DecryptProvider(logger) },
      { id: "blockworks", client: new BlockworksProvider(logger) }
    ];
    if (config.enableRedditSentiment) {
      this.providers.push({ id: "reddit_search", client: new RedditProvider({ logger, config }) });
    }
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= this.config.newsCacheMinutes * 60 * 1000;
  }

  async getSymbolSummary(symbol, aliases) {
    const cached = this.runtime.newsCache?.[symbol];
    if (this.isFresh(cached)) {
      this.runtime.sourceReliability = this.reliability.buildSummary(this.runtime);
      return cached.summary;
    }

    const now = nowIso();
    try {
      const items = [];
      const usedProviders = [];
      for (const provider of this.providers) {
        const gate = this.reliability.shouldUseProvider(this.runtime, provider.id, now);
        if (!gate.allow) {
          this.recordEvent?.("source_provider_cooldown", {
            symbol,
            provider: provider.id,
            reason: gate.reason,
            score: gate.score,
            cooldownUntil: gate.cooldownUntil
          });
          continue;
        }
        try {
          const result = await provider.client.fetchNews({
            symbol,
            aliases,
            lookbackHours: this.config.newsLookbackHours,
            limit: this.config.newsHeadlineLimit
          });
          items.push(...result);
          usedProviders.push(provider.id);
          this.reliability.noteSuccess(this.runtime, provider.id, nowIso());
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
        }
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
        items
      };
      this.runtime.sourceReliability = this.reliability.buildSummary(this.runtime);
      return adjustedSummary;
    } catch (error) {
      this.logger.warn("News fetch failed, using cached/empty summary", {
        symbol,
        error: error.message
      });
      this.runtime.sourceReliability = this.reliability.buildSummary(this.runtime);
      return cached?.summary || EMPTY_SUMMARY;
    }
  }
}

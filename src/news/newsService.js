import { nowIso } from "../utils/time.js";
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
  socialEngagement: 0
};

export class NewsService {
  constructor({ config, runtime, logger }) {
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
    this.providers = [
      new GoogleNewsProvider(logger),
      new CoinDeskProvider(logger),
      new CointelegraphProvider(logger),
      new DecryptProvider(logger),
      new BlockworksProvider(logger)
    ];
    if (config.enableRedditSentiment) {
      this.providers.push(new RedditProvider({ logger, config }));
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
      return cached.summary;
    }

    try {
      const providerResults = await Promise.allSettled(
        this.providers.map((provider) =>
          provider.fetchNews({
            symbol,
            aliases,
            lookbackHours: this.config.newsLookbackHours,
            limit: this.config.newsHeadlineLimit
          })
        )
      );
      const items = [];
      for (const result of providerResults) {
        if (result.status === "fulfilled") {
          items.push(...result.value);
          continue;
        }
        this.logger.warn("News provider failed", {
          symbol,
          error: result.reason?.message || String(result.reason)
        });
      }
      const summary = summarizeNews(items, this.config.newsLookbackHours, nowIso(), {
        minSourceQuality: this.config.newsMinSourceQuality,
        minReliabilityScore: this.config.newsMinReliabilityScore,
        strictWhitelist: this.config.newsStrictWhitelist
      });
      this.runtime.newsCache[symbol] = {
        fetchedAt: nowIso(),
        summary,
        items
      };
      return summary;
    } catch (error) {
      this.logger.warn("News fetch failed, using cached/empty summary", {
        symbol,
        error: error.message
      });
      return cached?.summary || EMPTY_SUMMARY;
    }
  }
}

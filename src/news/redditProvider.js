import { fetchXml, parseProviderItems } from "./rssFeed.js";

const DEFAULT_SUBREDDITS = ["CryptoCurrency", "CryptoMarkets", "Binance"];

function uniqueAliases(aliases = []) {
  return [...new Set((aliases || []).filter(Boolean).map((alias) => `${alias}`.trim()).filter(Boolean))].slice(0, 4);
}

function buildQuery(aliases = []) {
  const searchTerms = uniqueAliases(aliases);
  if (!searchTerms.length) {
    return "crypto";
  }
  return `${searchTerms.join(" OR ")} crypto`;
}

function buildRedditUrl(subreddit, aliases, lookbackHours, limit) {
  const query = encodeURIComponent(buildQuery(aliases));
  const days = Math.max(1, Math.ceil(Math.max(lookbackHours, 1) / 24));
  const safeLimit = Math.max(2, Math.min(Math.round(limit || 8), 20));
  return `https://www.reddit.com/r/${subreddit}/search.rss?q=${query}&restrict_sr=1&sort=new&t=${days > 1 ? "week" : "day"}&limit=${safeLimit}`;
}

export class RedditProvider {
  constructor({ logger, config }) {
    this.logger = logger;
    this.subreddits = Array.isArray(config?.redditSentimentSubreddits) && config.redditSentimentSubreddits.length
      ? config.redditSentimentSubreddits
      : DEFAULT_SUBREDDITS;
  }

  async fetchNews({ symbol, aliases, lookbackHours, limit }) {
    const perSubredditLimit = Math.max(2, Math.ceil((limit || 8) / Math.max(this.subreddits.length, 1)));
    const results = await Promise.allSettled(
      this.subreddits.map(async (subreddit) => {
        const xml = await fetchXml(buildRedditUrl(subreddit, aliases, lookbackHours, perSubredditLimit));
        return parseProviderItems(
          xml,
          {
            provider: "reddit_search",
            sourceFallback: `r/${subreddit}`,
            channel: "social"
          },
          {
            aliases,
            lookbackHours,
            limit: perSubredditLimit
          }
        ).map((item) => ({
          ...item,
          source: `r/${subreddit}`,
          engagementScore: 1,
          category: subreddit
        }));
      })
    );

    const items = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        items.push(...result.value);
        continue;
      }
      this.logger?.warn?.("Reddit provider failed", {
        symbol,
        error: result.reason?.message || String(result.reason)
      });
    }

    return items
      .sort((left, right) => new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime())
      .slice(0, limit);
  }
}

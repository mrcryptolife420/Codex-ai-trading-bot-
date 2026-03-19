import { fetchXml, parseProviderItems } from "./rssFeed.js";

function buildQuery(aliases, lookbackHours) {
  const days = Math.max(1, Math.ceil(lookbackHours / 24));
  const query = `(${aliases.join(" OR ")}) crypto when:${days}d`;
  return encodeURIComponent(query);
}

export class GoogleNewsProvider {
  constructor(logger) {
    this.logger = logger;
  }

  async fetchNews({ symbol, aliases, lookbackHours, limit, requestBudget = null, runtime = null, providerId = "google_news" }) {
    const query = buildQuery(aliases, lookbackHours);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const xml = await fetchXml(url, { requestBudget, runtime, key: `news:${providerId}` });
      return parseProviderItems(
        xml,
        {
          provider: "google_news",
          sourceFallback: "Google News"
        },
        {
          aliases,
          lookbackHours,
          limit
        }
      );
    } catch (error) {
      throw new Error(`Failed to fetch news for ${symbol}: ${error.message}`);
    }
  }
}

import { fetchXml, parseProviderItems } from "./rssFeed.js";

const COINTELEGRAPH_FEED_URL = "https://cointelegraph.com/rss";

export class CointelegraphProvider {
  constructor(logger) {
    this.logger = logger;
  }

  async fetchNews({ aliases, lookbackHours, limit, requestBudget = null, runtime = null, providerId = "cointelegraph" }) {
    const xml = await fetchXml(COINTELEGRAPH_FEED_URL, { requestBudget, runtime, key: `news:${providerId}` });
    return parseProviderItems(
      xml,
      {
        provider: "cointelegraph",
        sourceFallback: "Cointelegraph"
      },
      {
        aliases,
        lookbackHours,
        limit
      }
    );
  }
}

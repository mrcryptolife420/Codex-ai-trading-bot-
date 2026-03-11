import { fetchXml, parseProviderItems } from "./rssFeed.js";

const COINTELEGRAPH_FEED_URL = "https://cointelegraph.com/rss";

export class CointelegraphProvider {
  constructor(logger) {
    this.logger = logger;
  }

  async fetchNews({ aliases, lookbackHours, limit }) {
    const xml = await fetchXml(COINTELEGRAPH_FEED_URL);
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

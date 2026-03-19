import { fetchXml, parseProviderItems } from "./rssFeed.js";

const BLOCKWORKS_FEED_URL = "https://blockworks.com/feed";

export class BlockworksProvider {
  constructor(logger) {
    this.logger = logger;
  }

  async fetchNews({ aliases, lookbackHours, limit, requestBudget = null, runtime = null, providerId = "blockworks" }) {
    const xml = await fetchXml(BLOCKWORKS_FEED_URL, { requestBudget, runtime, key: `news:${providerId}` });
    return parseProviderItems(
      xml,
      {
        provider: "blockworks",
        sourceFallback: "Blockworks"
      },
      {
        aliases,
        lookbackHours,
        limit
      }
    );
  }
}

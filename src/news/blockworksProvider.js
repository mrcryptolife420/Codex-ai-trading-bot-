import { fetchXml, parseProviderItems } from "./rssFeed.js";

const BLOCKWORKS_FEED_URL = "https://blockworks.com/feed";

export class BlockworksProvider {
  constructor(logger) {
    this.logger = logger;
  }

  async fetchNews({ aliases, lookbackHours, limit }) {
    const xml = await fetchXml(BLOCKWORKS_FEED_URL);
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

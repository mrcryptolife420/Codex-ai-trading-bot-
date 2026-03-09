import { fetchXml, parseProviderItems } from "./rssFeed.js";

const DECRYPT_FEED_URL = "https://decrypt.co/feed";

export class DecryptProvider {
  constructor(logger) {
    this.logger = logger;
  }

  async fetchNews({ aliases, lookbackHours, limit }) {
    const xml = await fetchXml(DECRYPT_FEED_URL);
    return parseProviderItems(
      xml,
      {
        provider: "decrypt",
        sourceFallback: "Decrypt"
      },
      {
        aliases,
        lookbackHours,
        limit
      }
    );
  }
}

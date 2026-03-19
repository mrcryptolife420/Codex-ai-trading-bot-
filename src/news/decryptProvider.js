import { fetchXml, parseProviderItems } from "./rssFeed.js";

const DECRYPT_FEED_URL = "https://decrypt.co/feed";

export class DecryptProvider {
  constructor(logger) {
    this.logger = logger;
  }

  async fetchNews({ aliases, lookbackHours, limit, requestBudget = null, runtime = null, providerId = "decrypt" }) {
    const xml = await fetchXml(DECRYPT_FEED_URL, { requestBudget, runtime, key: `news:${providerId}` });
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

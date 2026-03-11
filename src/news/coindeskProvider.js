import { fetchXml, parseProviderItems } from "./rssFeed.js";

const COINDESK_FEED_URL = "https://www.coindesk.com/arc/outboundfeeds/rss";

export class CoinDeskProvider {
  constructor(logger) {
    this.logger = logger;
  }

  async fetchNews({ aliases, lookbackHours, limit }) {
    const xml = await fetchXml(COINDESK_FEED_URL);
    return parseProviderItems(
      xml,
      {
        provider: "coindesk",
        sourceFallback: "CoinDesk"
      },
      {
        aliases,
        lookbackHours,
        limit
      }
    );
  }
}

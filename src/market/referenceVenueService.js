function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, safeNumber(value)));
}

function normalizeQuote(item = {}) {
  const bid = safeNumber(item.bid ?? item.bidPrice, 0);
  const ask = safeNumber(item.ask ?? item.askPrice, 0);
  const mid = safeNumber(item.mid, bid && ask ? (bid + ask) / 2 : bid || ask || 0);
  return {
    venue: item.venue || item.exchange || "reference",
    bid: num(bid, 8),
    ask: num(ask, 8),
    mid: num(mid, 8),
    at: item.at || null
  };
}

export class ReferenceVenueService {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
  }

  async fetchReferenceQuotes(symbol) {
    if (!this.config.referenceVenueFetchEnabled || !(this.config.referenceVenueQuoteUrls || []).length) {
      return [];
    }
    const quotes = [];
    for (const template of this.config.referenceVenueQuoteUrls || []) {
      const url = `${template}`.replaceAll("{symbol}", encodeURIComponent(symbol));
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        const items = Array.isArray(payload) ? payload : Array.isArray(payload?.quotes) ? payload.quotes : [payload];
        for (const item of items) {
          quotes.push(normalizeQuote(item));
        }
      } catch (error) {
        this.logger.warn?.("Reference venue fetch failed", { symbol, url, error: error.message });
      }
    }
    return quotes.filter((item) => item.mid > 0);
  }

  async getSymbolSummary(symbol, marketSnapshot = {}, { referenceQuotes = null } = {}) {
    const quotes = Array.isArray(referenceQuotes) && referenceQuotes.length
      ? referenceQuotes.map(normalizeQuote).filter((item) => item.mid > 0)
      : await this.fetchReferenceQuotes(symbol);
    if (!quotes.length) {
      return {
        generatedAt: new Date().toISOString(),
        symbol,
        status: "warmup",
        confirmed: false,
        venueCount: 0,
        divergenceBps: null,
        blockerReasons: [],
        notes: ["Nog geen reference-venue quotes beschikbaar."],
        venues: []
      };
    }
    const localMid = safeNumber(marketSnapshot?.book?.mid, 0);
    const referenceMid = quotes.reduce((total, item) => total + safeNumber(item.mid, 0), 0) / quotes.length;
    const divergenceBps = localMid > 0 && referenceMid > 0
      ? Math.abs(localMid - referenceMid) / referenceMid * 10_000
      : 0;
    const minQuotes = this.config.referenceVenueMinQuotes || 2;
    const maxDivergenceBps = this.config.referenceVenueMaxDivergenceBps || 18;
    const confirmed = quotes.length >= minQuotes && divergenceBps <= maxDivergenceBps;
    const blocked = quotes.length >= minQuotes && divergenceBps > maxDivergenceBps;
    return {
      generatedAt: new Date().toISOString(),
      symbol,
      status: blocked
        ? "blocked"
        : confirmed
          ? "confirmed"
          : "observe",
      confirmed,
      venueCount: quotes.length,
      divergenceBps: num(divergenceBps, 2),
      blockerReasons: blocked ? ["reference_venue_divergence"] : [],
      notes: [
        blocked
          ? `Venue-confirmatie wijkt ${num(divergenceBps, 2)} bps af van Binance.`
          : confirmed
            ? `${quotes.length} reference venues bevestigen de Binance mid.`
            : `${quotes.length}/${minQuotes} reference venues beschikbaar voor bevestiging.`
      ],
      venues: quotes
        .map((item) => ({
          ...item,
          divergenceBps: localMid > 0 && item.mid > 0 ? num(Math.abs(localMid - item.mid) / item.mid * 10_000, 2) : null
        }))
        .slice(0, 6)
    };
  }

  summarizeRuntime(candidates = [], nowIso = new Date().toISOString()) {
    const summaries = candidates.map((candidate) => candidate.venueConfirmationSummary).filter(Boolean);
    const lead = summaries[0] || null;
    return {
      generatedAt: nowIso,
      candidateCount: summaries.length,
      confirmedCount: summaries.filter((item) => item.confirmed).length,
      blockedCount: summaries.filter((item) => item.status === "blocked").length,
      averageDivergenceBps: num(summaries.length ? summaries.reduce((total, item) => total + safeNumber(item.divergenceBps, 0), 0) / summaries.length : 0, 2),
      leadSymbol: lead?.symbol || null,
      status: lead?.status || "warmup",
      blockerReasons: [...(lead?.blockerReasons || [])],
      notes: lead?.notes || ["Nog geen runtime venue-confirmatie beschikbaar."]
    };
  }
}

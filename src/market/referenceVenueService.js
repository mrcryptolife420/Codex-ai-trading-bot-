import { RequestBudget, maskUrl } from "../utils/requestBudget.js";
import { ExternalFeedRegistry } from "../runtime/externalFeedRegistry.js";

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

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

export class ReferenceVenueService {
  constructor(config, logger = console, runtime = null) {
    this.config = config;
    this.logger = logger;
    this.runtime = runtime || null;
    this.requestBudget = new RequestBudget({
      timeoutMs: 8_000,
      baseCooldownMs: 30_000,
      maxCooldownMs: 5 * 60_000,
      registry: new ExternalFeedRegistry(config),
      runtime: this.runtime,
      group: "reference"
    });
  }

  setRuntime(runtime = null) {
    this.runtime = runtime || null;
    this.requestBudget.runtime = this.runtime;
  }

  async fetchReferenceQuotes(symbol) {
    if (!this.config.referenceVenueFetchEnabled || !(this.config.referenceVenueQuoteUrls || []).length) {
      return [];
    }
    const responses = await Promise.all((this.config.referenceVenueQuoteUrls || []).map(async (template) => {
      const url = `${template}`.replaceAll("{symbol}", encodeURIComponent(symbol));
      try {
        const response = await this.requestBudget.fetchJson(url, {
          key: `reference:${template}`,
          runtime: this.runtime,
          headers: {
            "User-Agent": "Mozilla/5.0 trading-bot"
          }
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        this.requestBudget.noteSuccess(`reference:${template}`, this.runtime);
        const items = Array.isArray(payload) ? payload : Array.isArray(payload?.quotes) ? payload.quotes : [payload];
        return items.map(normalizeQuote);
      } catch (error) {
        const failure = error.code === "REQUEST_BUDGET_COOLDOWN"
          ? { cooldownUntil: error.cooldownUntil }
          : this.requestBudget.noteFailure(`reference:${template}`, Date.now(), this.runtime, error.message);
        this.logger.warn?.("Reference venue fetch failed", {
          symbol,
          url: maskUrl(url),
          error: error.message,
          cooldownUntil: failure.cooldownUntil || null
        });
        return [];
      }
    }));
    return responses.flat().filter((item) => item.mid > 0);
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
        averageHealthScore: null,
        blockerReasons: [],
        notes: ["Nog geen reference-venue quotes beschikbaar."],
        routeAdvice: {
          preferredEntryStyle: "market",
          preferMakerBoost: 0,
          sizeMultiplier: 1,
          aggressiveTakerAllowed: true,
          confidence: 0,
          preferredVenues: [],
          degradedVenues: []
        },
        venueHealth: [],
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
    const venueHealth = quotes
      .map((item) => {
        const venueDivergenceBps = localMid > 0 && item.mid > 0 ? Math.abs(localMid - item.mid) / item.mid * 10_000 : divergenceBps;
        const healthScore = clamp(1 - venueDivergenceBps / Math.max(maxDivergenceBps, 0.0001), 0, 1);
        return {
          venue: item.venue || "reference",
          mid: item.mid,
          divergenceBps: num(venueDivergenceBps, 2),
          healthScore: num(healthScore),
          status: healthScore >= 0.78 ? "healthy" : healthScore >= 0.52 ? "watch" : "degraded"
        };
      })
      .sort((left, right) => (right.healthScore || 0) - (left.healthScore || 0));
    const averageHealthScore = average(venueHealth.map((item) => item.healthScore || 0), 0);
    const routeAdvice = {
      preferredEntryStyle: blocked
        ? "limit_maker"
        : confirmed && divergenceBps <= maxDivergenceBps * 0.35 && averageHealthScore >= 0.72
          ? "market"
          : "limit_maker",
      preferMakerBoost: blocked ? 0.08 : confirmed ? -0.02 : 0.04,
      sizeMultiplier: blocked ? 0.45 : confirmed ? 1.02 : 0.9,
      aggressiveTakerAllowed: confirmed && divergenceBps <= maxDivergenceBps * 0.35 && averageHealthScore >= 0.72,
      confidence: num(clamp(0.3 + averageHealthScore * 0.5 + (confirmed ? 0.2 : 0), 0, 1)),
      preferredVenues: venueHealth.filter((item) => item.status === "healthy").slice(0, 3).map((item) => item.venue),
      degradedVenues: venueHealth.filter((item) => item.status === "degraded").slice(0, 3).map((item) => item.venue)
    };
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
      averageHealthScore: num(averageHealthScore),
      blockerReasons: blocked ? ["reference_venue_divergence"] : [],
      notes: [
        blocked
          ? `Venue-confirmatie wijkt ${num(divergenceBps, 2)} bps af van Binance.`
          : confirmed
            ? `${quotes.length} reference venues bevestigen de Binance mid.`
            : `${quotes.length}/${minQuotes} reference venues beschikbaar voor bevestiging.`
      ],
      routeAdvice,
      venueHealth: venueHealth.slice(0, 6),
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
      averageHealthScore: num(summaries.length ? summaries.reduce((total, item) => total + safeNumber(item.averageHealthScore, 0), 0) / summaries.length : 0),
      leadSymbol: lead?.symbol || null,
      status: lead?.status || "warmup",
      blockerReasons: [...(lead?.blockerReasons || [])],
      routeAdvice: lead?.routeAdvice || {
        preferredEntryStyle: "market",
        preferMakerBoost: 0,
        sizeMultiplier: 1,
        aggressiveTakerAllowed: true,
        confidence: 0,
        preferredVenues: [],
        degradedVenues: []
      },
      notes: lead?.notes || ["Nog geen runtime venue-confirmatie beschikbaar."]
    };
  }
}

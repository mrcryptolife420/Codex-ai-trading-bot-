import { clamp } from "../utils/math.js";
import { nowIso } from "../utils/time.js";

const STABLECOIN_IDS = ["tether", "usd-coin", "dai", "first-digital-usd", "ethena-usde"];
const EMPTY_ONCHAIN = {
  coverage: 0,
  stablecoinMarketCapUsd: 0,
  stablecoinVolumeUsd: 0,
  stablecoinChangePct24h: 0,
  stablecoinDominancePct: 0,
  liquidityScore: 0,
  riskOffScore: 0,
  stressScore: 0,
  reasons: [],
  lastUpdatedAt: null
};

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

export class OnChainLiteService {
  constructor({ config, runtime, logger, fetchImpl } = {}) {
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
    this.fetchImpl = fetchImpl || fetch;
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= (this.config.onChainLiteCacheMinutes || 30) * 60 * 1000;
  }

  async requestJson(url) {
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 trading-bot"
      },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) {
      throw new Error(`On-chain lite request failed: ${response.status}`);
    }
    return response.json();
  }

  summarize(payload = [], marketSentiment = {}) {
    const items = Array.isArray(payload) ? payload : [];
    if (!items.length) {
      return { ...EMPTY_ONCHAIN };
    }
    const stablecoinMarketCapUsd = items.reduce((total, item) => total + asNumber(item.market_cap || 0), 0);
    const stablecoinVolumeUsd = items.reduce((total, item) => total + asNumber(item.total_volume || 0), 0);
    const weightedChange = stablecoinMarketCapUsd
      ? items.reduce((total, item) => total + asNumber(item.market_cap || 0) * asNumber(item.price_change_percentage_24h || 0), 0) / stablecoinMarketCapUsd
      : 0;
    const totalMarketCapUsd = asNumber(marketSentiment.totalMarketCapUsd || 0);
    const stablecoinDominancePct = totalMarketCapUsd ? (stablecoinMarketCapUsd / totalMarketCapUsd) * 100 : 0;
    const liquidityScore = clamp(stablecoinDominancePct / 12, 0, 1) * 0.55 + clamp(stablecoinVolumeUsd / 25_000_000_000, 0, 1) * 0.45;
    const riskOffScore = clamp(Math.max(0, weightedChange) / 3.5, 0, 1) * 0.6 + clamp(stablecoinDominancePct / 14, 0, 1) * 0.4;
    const stressScore = clamp(Math.max(0, -weightedChange) / 4 + Math.max(0, 8 - stablecoinDominancePct) / 10 * 0.2, 0, 1);
    const reasons = [];
    if (weightedChange >= 1) {
      reasons.push("stablecoin_supply_expanding");
    }
    if (weightedChange <= -1) {
      reasons.push("stablecoin_supply_contracting");
    }
    if (stablecoinDominancePct >= 9.5) {
      reasons.push("stablecoin_dominance_high");
    }
    if (stablecoinVolumeUsd >= 18_000_000_000) {
      reasons.push("stablecoin_volume_supportive");
    }
    return {
      coverage: items.length,
      stablecoinMarketCapUsd: num(stablecoinMarketCapUsd, 2),
      stablecoinVolumeUsd: num(stablecoinVolumeUsd, 2),
      stablecoinChangePct24h: num(weightedChange, 2),
      stablecoinDominancePct: num(stablecoinDominancePct, 2),
      liquidityScore: num(liquidityScore),
      riskOffScore: num(riskOffScore),
      stressScore: num(stressScore),
      reasons,
      lastUpdatedAt: nowIso()
    };
  }

  async getSummary(marketSentiment = {}) {
    const cached = this.runtime.onChainLiteCache;
    if (this.isFresh(cached)) {
      return this.summarize(cached.payload, marketSentiment);
    }

    try {
      const baseUrl = `${this.config.coinGeckoApiBaseUrl || "https://api.coingecko.com/api/v3"}`.replace(/\/$/, "");
      const ids = encodeURIComponent((this.config.onChainLiteStablecoinIds || STABLECOIN_IDS).join(","));
      const payload = await this.requestJson(`${baseUrl}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`);
      this.runtime.onChainLiteCache = {
        fetchedAt: nowIso(),
        payload: Array.isArray(payload) ? payload : []
      };
      return this.summarize(this.runtime.onChainLiteCache.payload, marketSentiment);
    } catch (error) {
      this.logger?.warn?.("On-chain lite fetch failed", { error: error.message });
      return cached?.payload ? this.summarize(cached.payload, marketSentiment) : { ...EMPTY_ONCHAIN };
    }
  }
}

export { EMPTY_ONCHAIN };

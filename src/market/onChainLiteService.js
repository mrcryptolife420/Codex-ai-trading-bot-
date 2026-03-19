import { clamp } from "../utils/math.js";
import { nowIso } from "../utils/time.js";
import { RequestBudget, isRequestBudgetCooldownError } from "../utils/requestBudget.js";
import { ExternalFeedRegistry } from "../runtime/externalFeedRegistry.js";

const STABLECOIN_IDS = ["tether", "usd-coin", "dai", "first-digital-usd", "ethena-usde"];
const MAJOR_IDS = ["bitcoin", "ethereum", "binancecoin", "solana", "ripple", "dogecoin"];
const EMPTY_ONCHAIN = {
  coverage: 0,
  stablecoinMarketCapUsd: 0,
  stablecoinVolumeUsd: 0,
  stablecoinChangePct24h: 0,
  stablecoinDominancePct: 0,
  stablecoinConcentrationPct: 0,
  liquidityScore: 0,
  riskOffScore: 0,
  stressScore: 0,
  marketBreadthScore: 0,
  majorsPositiveRatio: 0,
  majorsMomentumScore: 0,
  altLiquidityScore: 0,
  trendingScore: 0,
  trendingSymbols: [],
  proxyConfidence: 0,
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

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function normalizePayload(payload = null) {
  if (Array.isArray(payload)) {
    return { stablecoins: payload, majors: [], trending: [] };
  }
  return {
    stablecoins: Array.isArray(payload?.stablecoins) ? payload.stablecoins : [],
    majors: Array.isArray(payload?.majors) ? payload.majors : [],
    trending: Array.isArray(payload?.trending) ? payload.trending : []
  };
}

export class OnChainLiteService {
  constructor({ config, runtime, logger, fetchImpl } = {}) {
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
    this.fetchImpl = fetchImpl || fetch;
    this.requestBudget = new RequestBudget({
      timeoutMs: 8_000,
      baseCooldownMs: Math.max(1, Number(config?.sourceReliabilityFailureCooldownMinutes || 8)) * 60_000,
      maxCooldownMs: Math.max(1, Number(config?.sourceReliabilityRateLimitCooldownMinutes || 30)) * 60_000,
      registry: new ExternalFeedRegistry(config || {}),
      runtime,
      group: "onchain"
    });
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= (this.config.onChainLiteCacheMinutes || 30) * 60 * 1000;
  }

  async requestJson(url, key) {
    const response = await this.requestBudget.fetchJson(url, {
      key,
      runtime: this.runtime,
      fetchImpl: this.fetchImpl,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 trading-bot"
      }
    });
    if (!response.ok) {
      throw new Error(`On-chain lite request failed: ${response.status}`);
    }
    return response.json();
  }

  summarize(payload = {}, marketSentiment = {}) {
    const normalized = normalizePayload(payload);
    const stablecoins = normalized.stablecoins;
    const majors = normalized.majors;
    const trending = normalized.trending;
    if (!stablecoins.length && !majors.length && !trending.length) {
      return { ...EMPTY_ONCHAIN };
    }

    const stablecoinMarketCapUsd = stablecoins.reduce((total, item) => total + asNumber(item.market_cap || 0), 0);
    const stablecoinVolumeUsd = stablecoins.reduce((total, item) => total + asNumber(item.total_volume || 0), 0);
    const weightedChange = stablecoinMarketCapUsd
      ? stablecoins.reduce((total, item) => total + asNumber(item.market_cap || 0) * asNumber(item.price_change_percentage_24h || 0), 0) / stablecoinMarketCapUsd
      : 0;
    const totalMarketCapUsd = asNumber(marketSentiment.totalMarketCapUsd || 0);
    const stablecoinDominancePct = totalMarketCapUsd ? (stablecoinMarketCapUsd / totalMarketCapUsd) * 100 : 0;
    const largestStablecoin = stablecoins.reduce((maxValue, item) => Math.max(maxValue, asNumber(item.market_cap || 0)), 0);
    const stablecoinConcentrationPct = stablecoinMarketCapUsd ? (largestStablecoin / stablecoinMarketCapUsd) * 100 : 0;

    const majorsPositiveRatio = majors.length
      ? majors.filter((item) => asNumber(item.price_change_percentage_24h || 0) > 0).length / majors.length
      : 0;
    const majorsMarketCap = majors.reduce((total, item) => total + asNumber(item.market_cap || 0), 0);
    const majorsMomentumPct = majorsMarketCap
      ? majors.reduce((total, item) => total + asNumber(item.market_cap || 0) * asNumber(item.price_change_percentage_24h || 0), 0) / majorsMarketCap
      : 0;
    const majorsMomentumScore = clamp(0.5 + majorsMomentumPct / 6.5, 0, 1);
    const marketBreadthScore = clamp(majorsPositiveRatio * 0.55 + majorsMomentumScore * 0.45, 0, 1);
    const altLiquidityScore = clamp((1 - Math.min(1, stablecoinDominancePct / 16)) * 0.45 + majorsPositiveRatio * 0.35 + Math.max(0, majorsMomentumPct) / 6 * 0.2, 0, 1);

    const trendingSymbols = trending
      .map((item) => item?.symbol || item?.item?.symbol || item?.name || null)
      .filter(Boolean)
      .slice(0, this.config.onChainLiteTrendingLimit || 7);
    const trendingScore = clamp(trendingSymbols.length / Math.max(this.config.onChainLiteTrendingLimit || 7, 1), 0, 1);

    const liquidityScore = clamp(stablecoinDominancePct / 12, 0, 1) * 0.42 + clamp(stablecoinVolumeUsd / 25_000_000_000, 0, 1) * 0.33 + marketBreadthScore * 0.25;
    const riskOffScore = clamp(Math.max(0, weightedChange) / 3.5, 0, 1) * 0.45 + clamp(stablecoinDominancePct / 14, 0, 1) * 0.3 + clamp((1 - marketBreadthScore) * 0.25, 0, 1);
    const stressScore = clamp(Math.max(0, -weightedChange) / 4 + Math.max(0, 8 - stablecoinDominancePct) / 10 * 0.15 + Math.max(0, 0.5 - majorsMomentumScore) * 0.35, 0, 1);
    const proxyConfidence = clamp((stablecoins.length / 5) * 0.45 + (majors.length / 6) * 0.35 + (trendingSymbols.length / Math.max(this.config.onChainLiteTrendingLimit || 7, 1)) * 0.2, 0, 1);

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
    if (marketBreadthScore >= 0.62) {
      reasons.push("major_breadth_supportive");
    }
    if (marketBreadthScore <= 0.36) {
      reasons.push("major_breadth_weak");
    }
    if (stablecoinConcentrationPct >= 62) {
      reasons.push("stablecoin_concentration_high");
    }
    if (trendingScore >= 0.72) {
      reasons.push("crypto_hype_rising");
    }

    return {
      coverage: stablecoins.length + majors.length + trendingSymbols.length,
      stablecoinMarketCapUsd: num(stablecoinMarketCapUsd, 2),
      stablecoinVolumeUsd: num(stablecoinVolumeUsd, 2),
      stablecoinChangePct24h: num(weightedChange, 2),
      stablecoinDominancePct: num(stablecoinDominancePct, 2),
      stablecoinConcentrationPct: num(stablecoinConcentrationPct, 2),
      liquidityScore: num(liquidityScore),
      riskOffScore: num(riskOffScore),
      stressScore: num(stressScore),
      marketBreadthScore: num(marketBreadthScore),
      majorsPositiveRatio: num(majorsPositiveRatio),
      majorsMomentumScore: num(majorsMomentumScore),
      altLiquidityScore: num(altLiquidityScore),
      trendingScore: num(trendingScore),
      trendingSymbols,
      proxyConfidence: num(proxyConfidence),
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
      const stablecoinIds = encodeURIComponent((this.config.onChainLiteStablecoinIds || STABLECOIN_IDS).join(","));
      const majorIds = encodeURIComponent((this.config.onChainLiteMajorIds || MAJOR_IDS).join(","));
      const [stablecoins, majors, trendingPayload] = await Promise.allSettled([
        this.requestJson(`${baseUrl}/coins/markets?vs_currency=usd&ids=${stablecoinIds}&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`, "onchain:stablecoins"),
        this.requestJson(`${baseUrl}/coins/markets?vs_currency=usd&ids=${majorIds}&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`, "onchain:majors"),
        this.requestJson(`${baseUrl}/search/trending`, "onchain:trending")
      ]);
      const outcomeMap = [
        ["onchain:stablecoins", stablecoins],
        ["onchain:majors", majors],
        ["onchain:trending", trendingPayload]
      ];
      for (const [key, result] of outcomeMap) {
        if (result.status === "fulfilled") {
          this.requestBudget.noteSuccess(key, this.runtime);
        } else if (!isRequestBudgetCooldownError(result.reason)) {
          this.requestBudget.noteFailure(key, Date.now(), this.runtime, result.reason?.message || String(result.reason));
        }
      }
      if (outcomeMap.every(([, result]) => result.status !== "fulfilled")) {
        throw new Error("All on-chain lite providers failed");
      }
      this.runtime.onChainLiteCache = {
        fetchedAt: nowIso(),
        payload: {
          stablecoins: stablecoins.status === "fulfilled" && Array.isArray(stablecoins.value) ? stablecoins.value : [],
          majors: majors.status === "fulfilled" && Array.isArray(majors.value) ? majors.value : [],
          trending: trendingPayload.status === "fulfilled" && Array.isArray(trendingPayload.value?.coins) ? trendingPayload.value.coins : []
        }
      };
      return this.summarize(this.runtime.onChainLiteCache.payload, marketSentiment);
    } catch (error) {
      this.logger?.warn?.("On-chain lite fetch failed", { error: error.message });
      return cached?.payload ? this.summarize(cached.payload, marketSentiment) : { ...EMPTY_ONCHAIN };
    }
  }
}

export { EMPTY_ONCHAIN };

import { clamp } from "../utils/math.js";
import { nowIso } from "../utils/time.js";
import { RequestBudget, isRequestBudgetCooldownError } from "../utils/requestBudget.js";
import { ExternalFeedRegistry } from "../runtime/externalFeedRegistry.js";

export const EMPTY_MARKET_SENTIMENT = {
  coverage: 0,
  fearGreedValue: null,
  fearGreedClassification: null,
  fearGreedPrevious: null,
  fearGreedDelta: null,
  contrarianScore: 0,
  riskScore: 0,
  btcDominancePct: null,
  altDominancePct: null,
  totalMarketCapUsd: null,
  totalVolume24hUsd: null,
  marketCapChangePct24h: null,
  confidence: 0,
  reasons: [],
  lastUpdatedAt: null
};

function asNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickGlobalData(payload = {}) {
  if (payload?.data && !Array.isArray(payload.data)) {
    return payload.data;
  }
  if (payload?.data && Array.isArray(payload.data)) {
    return payload.data[0] || {};
  }
  return payload || {};
}

export function summarizeMarketSentiment({ fearGreedPayload = {}, globalPayload = {} } = {}) {
  const latest = fearGreedPayload?.data?.[0] || {};
  const previous = fearGreedPayload?.data?.[1] || {};
  const globalData = pickGlobalData(globalPayload);
  const value = asNumber(latest.value);
  const previousValue = asNumber(previous.value);
  const btcDominancePct = asNumber(
    globalData?.market_cap_percentage?.btc ??
      globalData?.market_cap_percentage?.BTC ??
      globalData?.btc_dominance_percentage,
    null
  );
  const totalMarketCapUsd = asNumber(
    globalData?.total_market_cap?.usd ?? globalData?.total_market_cap,
    null
  );
  const totalVolume24hUsd = asNumber(
    globalData?.total_volume?.usd ?? globalData?.total_volume,
    null
  );
  const marketCapChangePct24h = asNumber(
    globalData?.market_cap_change_percentage_24h_usd ?? globalData?.market_cap_change_percentage_24h,
    null
  );

  if (value == null && btcDominancePct == null && totalMarketCapUsd == null) {
    return { ...EMPTY_MARKET_SENTIMENT };
  }

  const contrarianScore = value == null ? 0 : clamp((50 - value) / 50, -1, 1);
  const extremeScore = value == null ? 0 : clamp(Math.abs(value - 50) / 40, 0, 1);
  const btcDominanceCentered = btcDominancePct == null ? 0 : clamp((btcDominancePct - 52) / 18, -1, 1);
  const riskScore = clamp(extremeScore * 0.56 + Math.max(0, btcDominanceCentered) * 0.18 + Math.max(0, -(marketCapChangePct24h || 0)) / 12 * 0.26, 0, 1);
  const reasons = [];

  if (value != null) {
    if (value <= 24) {
      reasons.push("extreme_fear");
    } else if (value <= 38) {
      reasons.push("fearful_tape");
    } else if (value >= 76) {
      reasons.push("extreme_greed");
    } else if (value >= 62) {
      reasons.push("greedy_tape");
    }
  }
  if (btcDominancePct != null) {
    if (btcDominancePct >= 58) {
      reasons.push("btc_dominance_high");
    }
    if (btcDominancePct <= 48) {
      reasons.push("alts_broadening");
    }
  }
  if ((marketCapChangePct24h || 0) <= -3) {
    reasons.push("market_cap_drawdown");
  }
  if ((marketCapChangePct24h || 0) >= 3) {
    reasons.push("market_cap_expansion");
  }

  const coverage = (value != null ? 1 : 0) + (btcDominancePct != null || totalMarketCapUsd != null ? 1 : 0);
  const confidence = clamp(0.3 + coverage * 0.26 + (value != null && previousValue != null ? 0.08 : 0) + (btcDominancePct != null ? 0.1 : 0), 0, 1);

  return {
    coverage,
    fearGreedValue: value,
    fearGreedClassification: latest.value_classification || latest.classification || null,
    fearGreedPrevious: previousValue,
    fearGreedDelta: value != null && previousValue != null ? Number((value - previousValue).toFixed(2)) : null,
    contrarianScore: Number(contrarianScore.toFixed(4)),
    riskScore: Number(riskScore.toFixed(4)),
    btcDominancePct: btcDominancePct == null ? null : Number(btcDominancePct.toFixed(2)),
    altDominancePct: btcDominancePct == null ? null : Number((100 - btcDominancePct).toFixed(2)),
    totalMarketCapUsd: totalMarketCapUsd == null ? null : Number(totalMarketCapUsd.toFixed(2)),
    totalVolume24hUsd: totalVolume24hUsd == null ? null : Number(totalVolume24hUsd.toFixed(2)),
    marketCapChangePct24h: marketCapChangePct24h == null ? null : Number(marketCapChangePct24h.toFixed(2)),
    confidence: Number(confidence.toFixed(4)),
    reasons,
    lastUpdatedAt: nowIso()
  };
}

export class MarketSentimentService {
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
      group: "market_sentiment"
    });
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= (this.config.marketSentimentCacheMinutes || 15) * 60 * 1000;
  }

  async requestJson(url, key) {
    const response = await this.requestBudget.fetchJson(url, {
      key,
      runtime: this.runtime,
      fetchImpl: this.fetchImpl,
      headers: {
        "User-Agent": "Mozilla/5.0 trading-bot",
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Market sentiment request failed: ${response.status}`);
    }
    return response.json();
  }

  async getSummary() {
    const cached = this.runtime.marketSentimentCache;
    if (this.isFresh(cached)) {
      return cached.summary;
    }

    try {
      const alternativeBaseUrl = `${this.config.alternativeApiBaseUrl || "https://api.alternative.me"}`.replace(/\/$/, "");
      const coinGeckoBaseUrl = `${this.config.coinGeckoApiBaseUrl || "https://api.coingecko.com/api/v3"}`.replace(/\/$/, "");
      const [fearGreed, global] = await Promise.allSettled([
        this.requestJson(`${alternativeBaseUrl}/fng/?limit=2&format=json`, "market_sentiment:fear_greed"),
        this.requestJson(`${coinGeckoBaseUrl}/global`, "market_sentiment:global")
      ]);
      if (fearGreed.status === "fulfilled") {
        this.requestBudget.noteSuccess("market_sentiment:fear_greed", this.runtime);
      } else if (!isRequestBudgetCooldownError(fearGreed.reason)) {
        this.requestBudget.noteFailure("market_sentiment:fear_greed", Date.now(), this.runtime, fearGreed.reason?.message || String(fearGreed.reason));
      }
      if (global.status === "fulfilled") {
        this.requestBudget.noteSuccess("market_sentiment:global", this.runtime);
      } else if (!isRequestBudgetCooldownError(global.reason)) {
        this.requestBudget.noteFailure("market_sentiment:global", Date.now(), this.runtime, global.reason?.message || String(global.reason));
      }
      const payload = {
        fearGreedPayload: fearGreed.status === "fulfilled" ? fearGreed.value : {},
        globalPayload: global.status === "fulfilled" ? global.value : {}
      };
      const summary = summarizeMarketSentiment(payload);
      this.runtime.marketSentimentCache = {
        fetchedAt: nowIso(),
        payload,
        summary
      };
      return summary;
    } catch (error) {
      this.logger?.warn?.("Market sentiment fetch failed", { error: error.message });
      return cached?.summary || { ...EMPTY_MARKET_SENTIMENT };
    }
  }
}


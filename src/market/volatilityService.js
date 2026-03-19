import { average, clamp } from "../utils/math.js";
import { nowIso } from "../utils/time.js";
import { RequestBudget, isRequestBudgetCooldownError } from "../utils/requestBudget.js";
import { ExternalFeedRegistry } from "../runtime/externalFeedRegistry.js";

export const EMPTY_VOLATILITY_CONTEXT = {
  coverage: 0,
  btcOptionIv: null,
  ethOptionIv: null,
  btcHistoricalVol: null,
  ethHistoricalVol: null,
  marketOptionIv: null,
  marketHistoricalVol: null,
  ivPremium: 0,
  riskScore: 0,
  regime: "unknown",
  reasons: [],
  confidence: 0,
  lastUpdatedAt: null
};

function asNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function weightedIv(items = []) {
  const normalized = items
    .map((item) => ({
      iv: asNumber(item.mark_iv ?? item.markIv, null),
      openInterest: Math.max(0, asNumber(item.open_interest ?? item.openInterest, 0)),
      volumeUsd: Math.max(0, asNumber(item.volume_usd ?? item.volumeUsd, 0)),
      underlyingPrice: Math.max(0, asNumber(item.underlying_price ?? item.underlyingPrice, 0))
    }))
    .filter((item) => item.iv != null);
  if (!normalized.length) {
    return null;
  }
  const totalWeight = normalized.reduce((total, item) => total + (item.openInterest || item.volumeUsd || item.underlyingPrice || 1), 0);
  if (!totalWeight) {
    return average(normalized.map((item) => item.iv), null);
  }
  return normalized.reduce((total, item) => total + item.iv * (item.openInterest || item.volumeUsd || item.underlyingPrice || 1), 0) / totalWeight;
}

function latestHistoricalVol(items = []) {
  const normalized = items
    .map((item) => {
      if (Array.isArray(item)) {
        return asNumber(item[1], null);
      }
      if (item && typeof item === "object") {
        return asNumber(item.value ?? item.volatility ?? item.close ?? item.historicalVolatility, null);
      }
      return asNumber(item, null);
    })
    .filter((value) => value != null);
  return normalized.length ? normalized.at(-1) : null;
}

export function summarizeVolatilityContext({ btcOptions = [], ethOptions = [], btcHistoricalVol = [], ethHistoricalVol = [] } = {}) {
  const btcIv = weightedIv(btcOptions);
  const ethIv = weightedIv(ethOptions);
  const btcHist = latestHistoricalVol(btcHistoricalVol);
  const ethHist = latestHistoricalVol(ethHistoricalVol);
  const marketOptionIv = average([btcIv, ethIv].filter((value) => value != null), null);
  const marketHistoricalVol = average([btcHist, ethHist].filter((value) => value != null), null);

  if (marketOptionIv == null && marketHistoricalVol == null) {
    return { ...EMPTY_VOLATILITY_CONTEXT };
  }

  const ivPremium = marketOptionIv != null && marketHistoricalVol != null ? marketOptionIv - marketHistoricalVol : 0;
  const riskScore = clamp(
    Math.max(0, (marketOptionIv || 0) - 55) / 35 * 0.58 +
      Math.max(0, ivPremium) / 20 * 0.28 +
      Math.max(0, (marketHistoricalVol || 0) - 50) / 35 * 0.14,
    0,
    1
  );
  let regime = "calm";
  if ((marketOptionIv || 0) >= 80 || ivPremium >= 16 || riskScore >= 0.78) {
    regime = "stress";
  } else if ((marketOptionIv || 0) >= 64 || ivPremium >= 8 || riskScore >= 0.48) {
    regime = "elevated";
  }

  const reasons = [];
  if ((marketOptionIv || 0) >= 70) {
    reasons.push("options_iv_elevated");
  }
  if (ivPremium >= 8) {
    reasons.push("iv_premium_positive");
  }
  if ((marketHistoricalVol || 0) >= 55) {
    reasons.push("historical_vol_elevated");
  }

  const coverage = [btcIv, ethIv, btcHist, ethHist].filter((value) => value != null).length;
  const confidence = clamp(0.24 + coverage * 0.14 + (marketOptionIv != null && marketHistoricalVol != null ? 0.18 : 0), 0, 1);

  return {
    coverage,
    btcOptionIv: btcIv == null ? null : Number(btcIv.toFixed(2)),
    ethOptionIv: ethIv == null ? null : Number(ethIv.toFixed(2)),
    btcHistoricalVol: btcHist == null ? null : Number(btcHist.toFixed(2)),
    ethHistoricalVol: ethHist == null ? null : Number(ethHist.toFixed(2)),
    marketOptionIv: marketOptionIv == null ? null : Number(marketOptionIv.toFixed(2)),
    marketHistoricalVol: marketHistoricalVol == null ? null : Number(marketHistoricalVol.toFixed(2)),
    ivPremium: Number(ivPremium.toFixed(2)),
    riskScore: Number(riskScore.toFixed(4)),
    regime,
    reasons,
    confidence: Number(confidence.toFixed(4)),
    lastUpdatedAt: nowIso()
  };
}

export class VolatilityService {
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
      group: "volatility"
    });
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= (this.config.volatilityCacheMinutes || 15) * 60 * 1000;
  }

  async requestResult(url, key) {
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
      throw new Error(`Volatility request failed: ${response.status}`);
    }
    const payload = await response.json();
    return payload?.result ?? payload;
  }

  async getSummary() {
    const cached = this.runtime.volatilityContextCache;
    if (this.isFresh(cached)) {
      return cached.summary;
    }

    try {
      const configuredBaseUrl = `${this.config.deribitApiBaseUrl || "https://www.deribit.com/api/v2"}`.replace(/\/$/, "");
      const baseUrl = /\/api\/v2$/i.test(configuredBaseUrl) ? configuredBaseUrl : `${configuredBaseUrl}/api/v2`;
      const [btcOptions, ethOptions, btcHist, ethHist] = await Promise.allSettled([
        this.requestResult(`${baseUrl}/public/get_book_summary_by_currency?currency=BTC&kind=option`, "volatility:btc_options"),
        this.requestResult(`${baseUrl}/public/get_book_summary_by_currency?currency=ETH&kind=option`, "volatility:eth_options"),
        this.requestResult(`${baseUrl}/public/get_historical_volatility?currency=BTC`, "volatility:btc_historical"),
        this.requestResult(`${baseUrl}/public/get_historical_volatility?currency=ETH`, "volatility:eth_historical")
      ]);
      const outcomeMap = [
        ["volatility:btc_options", btcOptions],
        ["volatility:eth_options", ethOptions],
        ["volatility:btc_historical", btcHist],
        ["volatility:eth_historical", ethHist]
      ];
      for (const [key, result] of outcomeMap) {
        if (result.status === "fulfilled") {
          this.requestBudget.noteSuccess(key, this.runtime);
        } else if (!isRequestBudgetCooldownError(result.reason)) {
          this.requestBudget.noteFailure(key, Date.now(), this.runtime, result.reason?.message || String(result.reason));
        }
      }
      if (outcomeMap.every(([, result]) => result.status !== "fulfilled")) {
        throw new Error("All volatility providers failed");
      }
      const payload = {
        btcOptions: btcOptions.status === "fulfilled" ? btcOptions.value : [],
        ethOptions: ethOptions.status === "fulfilled" ? ethOptions.value : [],
        btcHistoricalVol: btcHist.status === "fulfilled" ? btcHist.value : [],
        ethHistoricalVol: ethHist.status === "fulfilled" ? ethHist.value : []
      };
      const summary = summarizeVolatilityContext(payload);
      this.runtime.volatilityContextCache = {
        fetchedAt: nowIso(),
        payload,
        summary
      };
      return summary;
    } catch (error) {
      this.logger?.warn?.("Volatility context fetch failed", { error: error.message });
      return cached?.summary || { ...EMPTY_VOLATILITY_CONTEXT };
    }
  }
}


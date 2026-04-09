const DEFAULT_BASE_URL = "https://api.coingecko.com/api/v3";
const DEFAULT_CACHE_MINUTES = 20;

let cacheEntry = null;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBaseUrl() {
  return `${process.env.COINGECKO_API_BASE_URL || DEFAULT_BASE_URL}`.trim().replace(/\/+$/, "");
}

function getCacheMinutes() {
  return Math.max(1, toNumber(process.env.GLOBAL_MARKET_CACHE_MINUTES, DEFAULT_CACHE_MINUTES));
}

function computeStablecoinDominance(marketCapPercentages) {
  const usd = toNumber(marketCapPercentages?.usdt, 0);
  const usdc = toNumber(marketCapPercentages?.usdc, 0);
  const dai = toNumber(marketCapPercentages?.dai, 0);
  const fdusd = toNumber(marketCapPercentages?.fdusd, 0);
  const tusd = toNumber(marketCapPercentages?.tusd, 0);
  return usd + usdc + dai + fdusd + tusd;
}

function deriveSignals({ btcDominance, stablecoinDominance, marketCapChangePercent24h }) {
  const btcDominanceSignal = btcDominance >= 55 ? "btc_strong" : btcDominance <= 45 ? "alts_favored" : "balanced";
  const stablecoinSignal = stablecoinDominance >= 9 ? "risk_off" : stablecoinDominance <= 6 ? "risk_on" : "neutral";
  const marketMomentum = marketCapChangePercent24h >= 2
    ? "strong_up"
    : marketCapChangePercent24h <= -2
      ? "strong_down"
      : "sideways";
  let riskRegime = "neutral";
  if (stablecoinSignal === "risk_off" || marketMomentum === "strong_down") {
    riskRegime = "defensive";
  } else if (stablecoinSignal === "risk_on" && marketMomentum === "strong_up") {
    riskRegime = "risk_on";
  }
  return {
    btcDominanceSignal,
    stablecoinSignal,
    marketMomentum,
    riskRegime
  };
}

function normalizeGlobalPayload(payload, dataQuality = "fresh") {
  const data = payload?.data || {};
  const percentages = data.market_cap_percentage || {};
  const btcDominance = toNumber(percentages.btc, 0);
  const ethDominance = toNumber(percentages.eth, 0);
  const stablecoinDominance = computeStablecoinDominance(percentages);
  const totalMarketCapUsd = toNumber(data.total_market_cap?.usd, 0);
  const marketCapChangePercent24h = toNumber(data.market_cap_change_percentage_24h_usd, 0);
  const signals = deriveSignals({
    btcDominance,
    stablecoinDominance,
    marketCapChangePercent24h
  });
  return {
    btcDominance,
    ethDominance,
    stablecoinDominance,
    totalMarketCapUsd,
    marketCapChangePercent24h,
    btcDominanceSignal: signals.btcDominanceSignal,
    stablecoinSignal: signals.stablecoinSignal,
    marketMomentum: signals.marketMomentum,
    riskRegime: signals.riskRegime,
    dataQuality,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchGlobalPayload() {
  const url = `${getBaseUrl()}/global`;
  const response = await fetch(url, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`CoinGecko global request failed (${response.status})`);
  }
  return response.json();
}

function isCacheFresh(entry) {
  if (!entry?.cachedAt) {
    return false;
  }
  const ttlMs = getCacheMinutes() * 60 * 1000;
  return Date.now() - entry.cachedAt < ttlMs;
}

export async function getGlobalMarketContext() {
  if (cacheEntry && isCacheFresh(cacheEntry)) {
    return {
      ...cacheEntry.context,
      dataQuality: "cache_fresh"
    };
  }
  try {
    const payload = await fetchGlobalPayload();
    const context = normalizeGlobalPayload(payload, "fresh");
    cacheEntry = {
      context,
      cachedAt: Date.now()
    };
    return context;
  } catch (error) {
    if (cacheEntry?.context) {
      return {
        ...cacheEntry.context,
        dataQuality: "cache_stale",
        staleReason: error.message
      };
    }
    return {
      btcDominance: null,
      ethDominance: null,
      stablecoinDominance: null,
      totalMarketCapUsd: null,
      marketCapChangePercent24h: null,
      btcDominanceSignal: "unknown",
      stablecoinSignal: "unknown",
      marketMomentum: "unknown",
      riskRegime: "unknown",
      dataQuality: "unavailable",
      fetchedAt: new Date().toISOString(),
      error: error.message
    };
  }
}

export async function getGlobalMarketSummary() {
  const context = await getGlobalMarketContext();
  return {
    fetchedAt: context.fetchedAt,
    dataQuality: context.dataQuality,
    riskRegime: context.riskRegime,
    marketMomentum: context.marketMomentum,
    dominance: {
      btc: context.btcDominance,
      eth: context.ethDominance,
      stablecoins: context.stablecoinDominance
    },
    signals: {
      btcDominanceSignal: context.btcDominanceSignal,
      stablecoinSignal: context.stablecoinSignal
    },
    totalMarketCapUsd: context.totalMarketCapUsd,
    marketCapChangePercent24h: context.marketCapChangePercent24h
  };
}

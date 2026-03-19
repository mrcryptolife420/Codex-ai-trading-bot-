import { coinAliases } from "../data/coinAliases.js";
import { getCoinProfile } from "../data/coinProfiles.js";
import { RequestBudget, isRequestBudgetCooldownError } from "../utils/requestBudget.js";
import { ExternalFeedRegistry } from "./externalFeedRegistry.js";

const STABLE_OR_FIAT_ASSETS = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "BUSD",
  "TUSD",
  "DAI",
  "USDP",
  "USDS",
  "USDE",
  "USDD",
  "USD1",
  "PYUSD",
  "RLUSD",
  "USDB",
  "GHO",
  "EUR",
  "EURC",
  "TRY",
  "BRL",
  "AUD",
  "GBP",
  "JPY",
  "RUB",
  "UAH",
  "ZAR",
  "IDRT",
  "BIDR"
]);

const LEVERAGED_TOKEN_SUFFIXES = ["UP", "DOWN", "BULL", "BEAR"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function toIso(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function normalizeSymbol(value) {
  return `${value || ""}`.trim().toUpperCase();
}

function buildAliasList({ symbol, baseAsset, coinName }) {
  return uniq([
    ...(coinAliases[symbol] || []),
    baseAsset,
    coinName,
    symbol
  ]);
}

function guessProfile({ symbol, baseAsset, coinName = "", marketCapRank = 999 }) {
  const existing = getCoinProfile(symbol);
  if (existing.cluster !== "other" || existing.sector !== "other" || existing.betaGroup !== "other") {
    return existing;
  }

  const lowerName = coinName.toLowerCase();
  if (marketCapRank <= 2) {
    return { cluster: "majors", sector: "store_of_value", betaGroup: "btc" };
  }
  if (marketCapRank <= 5) {
    return { cluster: "majors", sector: "smart_contracts", betaGroup: "eth" };
  }
  if (/doge|shib|pepe|bonk|floki|wif/.test(lowerName) || /DOGE|SHIB|PEPE|BONK|FLOKI|WIF/.test(baseAsset)) {
    return { cluster: "meme", sector: "meme", betaGroup: "meme" };
  }
  if (/swap|dex|lending|finance|protocol|curve|maker|aave|uni/.test(lowerName)) {
    return { cluster: "defi", sector: "defi", betaGroup: "defi" };
  }
  if (/solana|ethereum|aptos|sui|avax|avalanche|near|injective|sei|polkadot|cardano|tron/.test(lowerName)) {
    return { cluster: "layer1", sector: "smart_contracts", betaGroup: "alt_l1" };
  }
  if (/chainlink|oracle/.test(lowerName)) {
    return { cluster: "infrastructure", sector: "oracle", betaGroup: "infra" };
  }
  if (/bnb|binance/.test(lowerName) || baseAsset === "BNB") {
    return { cluster: "exchange", sector: "exchange", betaGroup: "exchange" };
  }
  return existing;
}

function isStableOrFiatAsset(baseAsset, coinName = "") {
  const upper = normalizeSymbol(baseAsset);
  const normalizedName = `${coinName || ""}`.toLowerCase();
  if (STABLE_OR_FIAT_ASSETS.has(upper)) {
    return true;
  }
  if (/^(usd|eur|gbp|aud|brl|try|jpy|rub|uah|zar)\w{0,3}$/.test(upper)) {
    return true;
  }
  return /\bstable\b|\bfiat\b|\bsynthetic dollar\b|\bdigital dollar\b|\busd[0-9a-z]*\b|\beur[0-9a-z]*\b|\bdollar\b/.test(normalizedName);
}

function isLeveragedToken(baseAsset, coinName = "") {
  const upper = normalizeSymbol(baseAsset);
  if (LEVERAGED_TOKEN_SUFFIXES.some((suffix) => upper.endsWith(suffix))) {
    return true;
  }
  return /\bleveraged\b|\b(3l|3s|5l|5s)\b/.test(coinName.toLowerCase());
}

function buildTradableUniverse(exchangeInfo, quoteAsset = "USDT") {
  const tradable = new Map();
  for (const symbolInfo of exchangeInfo?.symbols || []) {
    if (symbolInfo.status !== "TRADING") {
      continue;
    }
    if (quoteAsset && symbolInfo.quoteAsset !== quoteAsset) {
      continue;
    }
    tradable.set(symbolInfo.baseAsset, {
      symbol: symbolInfo.symbol,
      baseAsset: symbolInfo.baseAsset,
      quoteAsset: symbolInfo.quoteAsset
    });
  }
  return tradable;
}

async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    throw new Error(`Watchlist fetch failed with ${response.status}`);
  }
  return response.json();
}

async function fetchCoinGeckoTopMarkets({ config, fetchImpl, requestBudget = null, runtime = null }) {
  const baseUrl = `${config.coinGeckoApiBaseUrl || "https://api.coingecko.com/api/v3"}`.replace(/\/$/, "");
  const perPage = clamp(config.watchlistFetchPerPage || 250, 50, 250);
  const url = `${baseUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false`;
  const payload = requestBudget
    ? await (async () => {
      const response = await requestBudget.fetchJson(url, {
        key: "dynamic_watchlist:coingecko_top_markets",
        runtime,
        fetchImpl,
        headers: {
          Accept: "application/json"
        },
        timeoutMs: 10_000
      });
      if (!response.ok) {
        throw new Error(`Watchlist fetch failed with ${response.status}`);
      }
      return response.json();
    })()
    : await fetchJson(url, fetchImpl);
  return Array.isArray(payload) ? payload : [];
}

async function fetchBinanceVolumeRanking({ client, tradableMap }) {
  const payload = await client.publicRequest("GET", "/api/v3/ticker/24hr");
  const tickers = Array.isArray(payload) ? payload : [];
  return tickers
    .map((ticker) => {
      const symbol = normalizeSymbol(ticker.symbol);
      if (!symbol.endsWith("USDT")) {
        return null;
      }
      const baseAsset = symbol.slice(0, -4);
      if (!tradableMap.has(baseAsset)) {
        return null;
      }
      return {
        symbol,
        baseAsset,
        quoteVolume: Number(ticker.quoteVolume || 0)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.quoteVolume - left.quoteVolume);
}

function buildSelectedEntries({ tradableMap, markets, config, source }) {
  const excluded = new Set((config.watchlistExclude || []).map(normalizeSymbol));
  const included = new Set((config.watchlistInclude || []).map(normalizeSymbol));
  const entries = [];
  const seen = new Set();

  for (const market of markets) {
    const baseAsset = normalizeSymbol(market.symbol);
    const tradable = tradableMap.get(baseAsset);
    if (!tradable || seen.has(tradable.symbol) || excluded.has(tradable.symbol)) {
      continue;
    }
    if (config.watchlistExcludeStablecoins && isStableOrFiatAsset(baseAsset, market.name || "")) {
      continue;
    }
    if (config.watchlistExcludeLeveragedTokens && isLeveragedToken(baseAsset, market.name || "")) {
      continue;
    }
    seen.add(tradable.symbol);
    entries.push({
      symbol: tradable.symbol,
      baseAsset,
      name: market.name || baseAsset,
      marketCapRank: Number(market.market_cap_rank || 999),
      marketCap: Number(market.market_cap || 0),
      source,
      aliases: buildAliasList({
        symbol: tradable.symbol,
        baseAsset,
        coinName: market.name || baseAsset
      }),
      profile: guessProfile({
        symbol: tradable.symbol,
        baseAsset,
        coinName: market.name || baseAsset,
        marketCapRank: Number(market.market_cap_rank || 999)
      })
    });
    if (entries.length >= config.watchlistTopN) {
      break;
    }
  }

  for (const symbol of included) {
    if (seen.has(symbol) || excluded.has(symbol)) {
      continue;
    }
    const baseAsset = symbol.endsWith(config.baseQuoteAsset) ? symbol.slice(0, -config.baseQuoteAsset.length) : symbol;
    const tradable = tradableMap.get(baseAsset);
    if (!tradable) {
      continue;
    }
    seen.add(tradable.symbol);
    entries.push({
      symbol: tradable.symbol,
      baseAsset,
      name: baseAsset,
      marketCapRank: 999,
      marketCap: 0,
      source: `${source}:manual_include`,
      aliases: buildAliasList({
        symbol: tradable.symbol,
        baseAsset,
        coinName: baseAsset
      }),
      profile: guessProfile({
        symbol: tradable.symbol,
        baseAsset,
        coinName: baseAsset,
        marketCapRank: 999
      })
    });
  }

  return entries.slice(0, config.watchlistTopN);
}

export async function resolveDynamicWatchlist({ client, config, logger, fetchImpl = fetch, runtime = null }) {
  if (!config.enableDynamicWatchlist) {
    return null;
  }

  const requestBudget = new RequestBudget({
    timeoutMs: 10_000,
    baseCooldownMs: Math.max(1, Number(config?.sourceReliabilityFailureCooldownMinutes || 8)) * 60_000,
    maxCooldownMs: Math.max(1, Number(config?.sourceReliabilityRateLimitCooldownMinutes || 30)) * 60_000,
    registry: new ExternalFeedRegistry(config || {}),
    runtime,
    group: "dynamic_watchlist"
  });

  const exchangeInfo = await client.getExchangeInfo();
  const tradableMap = buildTradableUniverse(exchangeInfo, config.baseQuoteAsset);
  const targetCount = clamp(config.watchlistTopN || 100, 10, 150);
  const minimumCount = clamp(config.dynamicWatchlistMinSymbols || 40, 5, targetCount);
  const notes = [];
  let source = "coingecko_top_market_cap";
  let selectedEntries = [];

  try {
    const markets = await fetchCoinGeckoTopMarkets({ config, fetchImpl, requestBudget, runtime });
    requestBudget.noteSuccess("dynamic_watchlist:coingecko_top_markets", runtime);
    selectedEntries = buildSelectedEntries({
      tradableMap,
      markets,
      config: { ...config, watchlistTopN: targetCount },
      source
    });
    notes.push(`CoinGecko leverde ${markets.length} market-cap records; ${selectedEntries.length} coins matchen Binance ${config.baseQuoteAsset} spot.`);
  } catch (error) {
    if (!isRequestBudgetCooldownError(error)) {
      requestBudget.noteFailure("dynamic_watchlist:coingecko_top_markets", Date.now(), runtime, error.message);
    }
    notes.push(`CoinGecko fallback actief: ${error.message}`);
    logger?.warn?.("Dynamic watchlist CoinGecko fetch failed", { error: error.message });
  }

  if (selectedEntries.length < minimumCount) {
    source = "binance_quote_volume_fallback";
    const volumeRanking = await fetchBinanceVolumeRanking({ client, tradableMap });
    selectedEntries = volumeRanking
      .filter((item) => !config.watchlistExcludeStablecoins || !isStableOrFiatAsset(item.baseAsset, item.baseAsset))
      .filter((item) => !config.watchlistExcludeLeveragedTokens || !isLeveragedToken(item.baseAsset, item.baseAsset))
      .slice(0, targetCount)
      .map((item, index) => ({
        symbol: item.symbol,
        baseAsset: item.baseAsset,
        name: item.baseAsset,
        marketCapRank: index + 1,
        marketCap: 0,
        source,
        aliases: buildAliasList({
          symbol: item.symbol,
          baseAsset: item.baseAsset,
          coinName: item.baseAsset
        }),
        profile: guessProfile({
          symbol: item.symbol,
          baseAsset: item.baseAsset,
          coinName: item.baseAsset,
          marketCapRank: index + 1
        })
      }));
    notes.push(`Fallback via Binance quote-volume leverde ${selectedEntries.length} tradable ${config.baseQuoteAsset} pairs op.`);
  }

  const symbolMetadata = Object.fromEntries(selectedEntries.map((entry) => [entry.symbol, entry.aliases]));
  const symbolProfiles = Object.fromEntries(selectedEntries.map((entry) => [entry.symbol, entry.profile]));
  const marketCapRanks = Object.fromEntries(selectedEntries.map((entry) => [entry.symbol, entry.marketCapRank]));
  const watchlist = selectedEntries.map((entry) => entry.symbol);

  return {
    watchlist,
    symbolMetadata,
    symbolProfiles,
    marketCapRanks,
    summary: {
      enabled: true,
      source,
      targetCount,
      resolvedCount: watchlist.length,
      baseQuoteAsset: config.baseQuoteAsset,
      excludeStablecoins: Boolean(config.watchlistExcludeStablecoins),
      excludeLeveragedTokens: Boolean(config.watchlistExcludeLeveragedTokens),
      generatedAt: toIso(),
      notes,
      topSymbols: selectedEntries.slice(0, 12).map((entry) => ({
        symbol: entry.symbol,
        name: entry.name,
        marketCapRank: entry.marketCapRank,
        source: entry.source
      }))
    }
  };
}


import { clamp, pctChange } from "../utils/math.js";
import { nowIso } from "../utils/time.js";

const EMPTY_SUMMARY = {
  fundingRate: 0,
  nextFundingTime: null,
  basisRate: 0,
  basisBps: 0,
  openInterest: 0,
  openInterestUsd: 0,
  openInterestChangePct: 0,
  takerBuySellRatio: 1,
  takerImbalance: 0,
  globalLongShortRatio: 1,
  globalLongShortImbalance: 0,
  topTraderLongShortRatio: 1,
  topTraderImbalance: 0,
  leverageBuildupScore: 0,
  shortSqueezeScore: 0,
  longSqueezeScore: 0,
  liquidationCount: 0,
  liquidationNotional: 0,
  liquidationImbalance: 0,
  liquidationIntensity: 0,
  liquidationClusterBias: 0,
  liquidationMagnetDirection: "neutral",
  liquidationMagnetStrength: 0,
  longLiquidationPocketScore: 0,
  shortLiquidationPocketScore: 0,
  squeezeContinuationScore: 0,
  liquidationTrapRisk: 0,
  crowdingBias: 0,
  riskScore: 0,
  signalScore: 0,
  confidence: 0,
  reasons: [],
  lastUpdatedAt: null
};

function pickLatest(items = []) {
  return [...items].sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0)).at(-1) || null;
}

function pickPrevious(items = []) {
  const sorted = [...items].sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
  return sorted.length > 1 ? sorted.at(-2) : sorted.at(-1) || null;
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ratioToImbalance(value) {
  const ratio = Math.max(0, asNumber(value, 1));
  if (!ratio) {
    return 0;
  }
  return clamp((ratio - 1) / (ratio + 1), -1, 1);
}

export function summarizeMarketStructure(payload = {}, streamFeatures = {}) {
  const premium = payload.premium || {};
  const openInterest = payload.openInterest || {};
  const openInterestHist = asArray(payload.openInterestHist);
  const takerLongShort = asArray(payload.takerLongShort);
  const basis = asArray(payload.basis);
  const globalLongShort = asArray(payload.globalLongShort);
  const topLongShortPosition = asArray(payload.topLongShortPosition);

  const latestOi = pickLatest(openInterestHist);
  const previousOi = pickPrevious(openInterestHist);
  const latestBasis = pickLatest(basis);
  const latestTaker = pickLatest(takerLongShort);
  const latestGlobalLongShort = pickLatest(globalLongShort);
  const latestTopTrader = pickLatest(topLongShortPosition);
  const currentOi = asNumber(openInterest.openInterest || latestOi?.sumOpenInterest || 0);
  const previousOiValue = asNumber(previousOi?.sumOpenInterest || 0);
  const openInterestChangePct = previousOiValue ? pctChange(previousOiValue, currentOi) : 0;
  const openInterestUsd = asNumber(latestOi?.sumOpenInterestValue || 0);
  const basisRate = asNumber(latestBasis?.basisRate || 0);
  const basisBps = basisRate * 10_000;
  const fundingRate = asNumber(premium.lastFundingRate || 0);
  const buyVol = asNumber(latestTaker?.buyVol || 0);
  const sellVol = asNumber(latestTaker?.sellVol || 0);
  const takerTotal = buyVol + sellVol;
  const takerImbalance = takerTotal ? (buyVol - sellVol) / takerTotal : 0;
  const globalLongShortRatio = asNumber(latestGlobalLongShort?.longShortRatio || 1, 1);
  const globalLongShortImbalance = ratioToImbalance(globalLongShortRatio);
  const topTraderLongShortRatio = asNumber(latestTopTrader?.longShortRatio || 1, 1);
  const topTraderImbalance = ratioToImbalance(topTraderLongShortRatio);
  const liquidationCount = streamFeatures.liquidationCount || 0;
  const liquidationNotional = streamFeatures.liquidationNotional || 0;
  const liquidationImbalance = streamFeatures.liquidationImbalance || 0;
  const liquidationIntensityBase = Math.max(openInterestUsd * 0.002, 150_000);
  const liquidationIntensity = clamp(liquidationNotional / liquidationIntensityBase, 0, 1);
  const longLiquidationPocketScore = clamp(Math.max(0, -liquidationImbalance) * 0.58 + liquidationIntensity * 0.42, 0, 1);
  const shortLiquidationPocketScore = clamp(Math.max(0, liquidationImbalance) * 0.58 + liquidationIntensity * 0.42, 0, 1);
  const fundingExtreme = clamp(Math.abs(fundingRate) / 0.0007, 0, 1);
  const basisStress = clamp(Math.abs(basisBps) / 16, 0, 1);
  const oiBuild = clamp(Math.abs(openInterestChangePct) * 18, 0, 1);
  const leverageBuildupScore = clamp(
    Math.max(0, openInterestChangePct) * 20 * 0.4 +
      Math.abs(fundingRate) / 0.0006 * 0.2 +
      Math.abs(globalLongShortImbalance) * 0.18 +
      Math.abs(topTraderImbalance) * 0.12 +
      Math.abs(takerImbalance) * 0.1,
    0,
    1
  );
  const shortSqueezeScore = clamp(
    Math.max(0, -fundingRate) / 0.0006 * 0.3 +
      Math.max(0, -globalLongShortImbalance) * 0.18 +
      Math.max(0, -topTraderImbalance) * 0.16 +
      Math.max(0, openInterestChangePct) * 22 * 0.18 +
      Math.max(0, liquidationImbalance) * 0.18,
    0,
    1
  );
  const longSqueezeScore = clamp(
    Math.max(0, fundingRate) / 0.0006 * 0.3 +
      Math.max(0, globalLongShortImbalance) * 0.18 +
      Math.max(0, topTraderImbalance) * 0.16 +
      Math.max(0, openInterestChangePct) * 22 * 0.18 +
      Math.max(0, -liquidationImbalance) * 0.18,
    0,
    1
  );
  const crowdingBias = clamp(
    takerImbalance * 0.28 +
      clamp(fundingRate / 0.00045, -1, 1) * 0.2 +
      clamp(basisBps / 18, -1, 1) * 0.14 +
      globalLongShortImbalance * 0.2 +
      topTraderImbalance * 0.18,
    -1,
    1
  );
  const signalScore = clamp(
    takerImbalance * 0.22 -
      clamp(fundingRate / 0.00045, -1, 1) * 0.18 -
      clamp(basisBps / 18, -1, 1) * 0.12 +
      liquidationImbalance * 0.18 -
      globalLongShortImbalance * 0.1 -
      topTraderImbalance * 0.08 +
      shortSqueezeScore * 0.12 -
      longSqueezeScore * 0.12,
    -1,
    1
  );
  const squeezeContinuationScore = clamp(
    Math.max(shortSqueezeScore, longSqueezeScore) * 0.46 +
      Math.max(0, openInterestChangePct) * 16 * 0.24 +
      Math.abs(liquidationImbalance) * 0.18 +
      Math.abs(crowdingBias) * 0.12,
    0,
    1
  );
  const liquidationClusterBias = clamp(
    liquidationImbalance * 0.64 +
      clamp(openInterestChangePct * 14, -1, 1) * 0.18 +
      crowdingBias * 0.18,
    -1,
    1
  );
  const liquidationMagnetStrength = clamp(
    liquidationIntensity * 0.42 +
      Math.abs(liquidationImbalance) * 0.28 +
      Math.max(shortSqueezeScore, longSqueezeScore) * 0.18 +
      Math.max(0, Math.abs(openInterestChangePct) * 12) * 0.12,
    0,
    1
  );
  const liquidationMagnetDirection = liquidationClusterBias > 0.12
    ? "up"
    : liquidationClusterBias < -0.12
      ? "down"
      : "neutral";
  const liquidationTrapRisk = clamp(
    liquidationIntensity * 0.34 +
      Math.abs(liquidationImbalance) * 0.24 +
      Math.abs(crowdingBias) * 0.18 +
      Math.abs(globalLongShortImbalance) * 0.12 +
      Math.abs(topTraderImbalance) * 0.12,
    0,
    1
  );
  const riskScore = clamp(
    fundingExtreme * 0.16 +
      basisStress * 0.12 +
      oiBuild * 0.14 +
      Math.abs(crowdingBias) * 0.14 +
      liquidationIntensity * 0.14 +
      Math.abs(liquidationImbalance) * 0.08 +
      leverageBuildupScore * 0.12 +
      Math.max(shortSqueezeScore, longSqueezeScore) * 0.1,
    0,
    1
  );
  const reasons = [];
  if (Math.abs(fundingRate) > 0.00035) {
    reasons.push("funding_extreme");
  }
  if (Math.abs(basisBps) > 8) {
    reasons.push("basis_dislocation");
  }
  if (Math.abs(openInterestChangePct) > 0.01) {
    reasons.push(openInterestChangePct > 0 ? "open_interest_build" : "open_interest_flush");
  }
  if (Math.abs(takerImbalance) > 0.2) {
    reasons.push(takerImbalance > 0 ? "taker_buy_pressure" : "taker_sell_pressure");
  }
  if (Math.abs(globalLongShortImbalance) > 0.18) {
    reasons.push(globalLongShortImbalance > 0 ? "global_longs_crowded" : "global_shorts_crowded");
  }
  if (Math.abs(topTraderImbalance) > 0.18) {
    reasons.push(topTraderImbalance > 0 ? "top_trader_longs_crowded" : "top_trader_shorts_crowded");
  }
  if (leverageBuildupScore > 0.58) {
    reasons.push("leverage_buildup");
  }
  if (shortSqueezeScore > 0.62) {
    reasons.push("short_squeeze_risk");
  }
  if (longSqueezeScore > 0.62) {
    reasons.push("long_squeeze_risk");
  }
  if (liquidationCount > 0) {
    reasons.push(liquidationImbalance > 0 ? "short_liquidations" : "long_liquidations");
  }
  if (liquidationMagnetStrength > 0.42 && liquidationMagnetDirection === "up") {
    reasons.push("short_liquidation_magnet_up");
  }
  if (liquidationMagnetStrength > 0.42 && liquidationMagnetDirection === "down") {
    reasons.push("long_liquidation_flush_risk");
  }
  if (squeezeContinuationScore > 0.52) {
    reasons.push("squeeze_continuation_supported");
  }
  if (liquidationTrapRisk > 0.54) {
    reasons.push("liquidation_trap_risk");
  }

  const observedSignals = [premium, openInterest, latestOi, latestBasis, latestTaker, latestGlobalLongShort, latestTopTrader].filter(Boolean).length;
  return {
    fundingRate,
    nextFundingTime: premium.nextFundingTime ? new Date(Number(premium.nextFundingTime)).toISOString() : null,
    basisRate,
    basisBps,
    openInterest: currentOi,
    openInterestUsd,
    openInterestChangePct,
    takerBuySellRatio: asNumber(latestTaker?.buySellRatio || 1, 1),
    takerImbalance,
    globalLongShortRatio,
    globalLongShortImbalance,
    topTraderLongShortRatio,
    topTraderImbalance,
    leverageBuildupScore,
    shortSqueezeScore,
    longSqueezeScore,
    liquidationCount,
    liquidationNotional,
    liquidationImbalance,
    liquidationIntensity,
    liquidationClusterBias,
    liquidationMagnetDirection,
    liquidationMagnetStrength,
    longLiquidationPocketScore,
    shortLiquidationPocketScore,
    squeezeContinuationScore,
    liquidationTrapRisk,
    crowdingBias,
    riskScore,
    signalScore,
    confidence: clamp(0.22 + observedSignals * 0.11 + (liquidationCount > 0 ? 0.08 : 0), 0, 1),
    reasons,
    lastUpdatedAt: premium.time ? new Date(Number(premium.time)).toISOString() : nowIso()
  };
}

export class MarketStructureService {
  constructor({ client, config, runtime, logger }) {
    this.client = client;
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= this.config.marketStructureCacheMinutes * 60 * 1000;
  }

  async getSymbolSummary(symbol, streamFeatures = {}) {
    const cacheKey = `market:${symbol}`;
    const cached = this.runtime.marketStructureCache?.[cacheKey];
    if (this.isFresh(cached)) {
      return summarizeMarketStructure(cached.payload, streamFeatures);
    }

    try {
      const [premium, openInterest, openInterestHist, takerLongShort, basis, globalLongShort, topLongShortPosition] = await Promise.allSettled([
        this.client.getFuturesPremiumIndex(symbol),
        this.client.getFuturesOpenInterest(symbol),
        this.client.getFuturesOpenInterestHist(symbol, "5m", this.config.marketStructureLookbackPoints),
        this.client.getFuturesTakerLongShortRatio(symbol, "5m", this.config.marketStructureLookbackPoints),
        this.client.getFuturesBasis(symbol, "5m", this.config.marketStructureLookbackPoints),
        this.client.getFuturesGlobalLongShortAccountRatio(symbol, "5m", this.config.marketStructureLookbackPoints),
        this.client.getFuturesTopLongShortPositionRatio(symbol, "5m", this.config.marketStructureLookbackPoints)
      ]);
      const payload = {
        premium: premium.status === "fulfilled" ? premium.value : null,
        openInterest: openInterest.status === "fulfilled" ? openInterest.value : null,
        openInterestHist: openInterestHist.status === "fulfilled" ? openInterestHist.value : [],
        takerLongShort: takerLongShort.status === "fulfilled" ? takerLongShort.value : [],
        basis: basis.status === "fulfilled" ? basis.value : [],
        globalLongShort: globalLongShort.status === "fulfilled" ? globalLongShort.value : [],
        topLongShortPosition: topLongShortPosition.status === "fulfilled" ? topLongShortPosition.value : []
      };
      this.runtime.marketStructureCache = this.runtime.marketStructureCache || {};
      this.runtime.marketStructureCache[cacheKey] = {
        fetchedAt: nowIso(),
        payload
      };
      return summarizeMarketStructure(payload, streamFeatures);
    } catch (error) {
      this.logger.warn("Market-structure fetch failed", {
        symbol,
        error: error.message
      });
      return cached?.payload ? summarizeMarketStructure(cached.payload, streamFeatures) : EMPTY_SUMMARY;
    }
  }
}

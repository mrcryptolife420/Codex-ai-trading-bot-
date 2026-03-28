import { clamp } from "../utils/math.js";

function rollingCorrelation(left, right) {
  const length = Math.min(left.length, right.length);
  if (length < 8) {
    return 0;
  }
  const a = left.slice(-length);
  const b = right.slice(-length);
  const meanA = a.reduce((total, value) => total + value, 0) / length;
  const meanB = b.reduce((total, value) => total + value, 0) / length;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let index = 0; index < length; index += 1) {
    const deltaA = a[index] - meanA;
    const deltaB = b[index] - meanB;
    numerator += deltaA * deltaB;
    denomA += deltaA ** 2;
    denomB += deltaB ** 2;
  }
  if (!denomA || !denomB) {
    return 0;
  }
  return clamp(numerator / Math.sqrt(denomA * denomB), -1, 1);
}

function toReturns(candles = []) {
  const closes = candles.map((candle) => candle.close);
  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    if (!closes[index - 1]) {
      returns.push(0);
      continue;
    }
    returns.push((closes[index] - closes[index - 1]) / closes[index - 1]);
  }
  return returns;
}

function average(values = []) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function sameUtcDay(left, right) {
  return `${left || ""}`.slice(0, 10) === `${right || ""}`.slice(0, 10);
}

function safeValue(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeValue(value).toFixed(digits));
}

function hasSpecificBucket(value) {
  return typeof value === "string" && value.trim() && value !== "other";
}

function shouldFlagBudgetCooling({
  factor = 1,
  exposureCount = 0,
  heat = 0,
  mildThreshold = 0.9,
  severeThreshold = 0.85,
  activeHeatThreshold = 0.08
} = {}) {
  if (!Number.isFinite(factor) || factor >= mildThreshold) {
    return false;
  }
  return factor < severeThreshold || exposureCount > 0 || heat >= activeHeatThreshold;
}

function computeLossStreakStateMap(trades = [], keyFn, {
  limit = 60,
  nowIso = new Date().toISOString(),
  maxIdleHours = 96
} = {}) {
  const states = {};
  const settled = trades.filter((trade) => trade.exitAt).slice(-limit).reverse();
  const cooled = new Set();
  const nowMs = new Date(nowIso).getTime();
  const maxIdleMs = Math.max(1, safeValue(maxIdleHours, 96)) * 3_600_000;
  for (const trade of settled) {
    const key = keyFn(trade) || "unknown";
    if (cooled.has(key)) {
      continue;
    }
    const tradeAt = trade.exitAt || trade.entryAt || null;
    const tradeMs = new Date(tradeAt || 0).getTime();
    const existing = states[key] || {
      streak: 0,
      latestTradeAt: null,
      lastTradeAgeHours: null,
      stale: false,
      previousTradeMs: null,
      gapBroken: false
    };
    if (!existing.latestTradeAt && Number.isFinite(tradeMs) && Number.isFinite(nowMs)) {
      existing.latestTradeAt = tradeAt;
      existing.lastTradeAgeHours = num((nowMs - tradeMs) / 3_600_000, 1);
      existing.stale = nowMs - tradeMs > maxIdleMs;
      states[key] = existing;
      if (existing.stale) {
        cooled.add(key);
        continue;
      }
    }
    if (Number.isFinite(tradeMs) && Number.isFinite(existing.previousTradeMs) && existing.previousTradeMs - tradeMs > maxIdleMs) {
      existing.gapBroken = true;
      states[key] = existing;
      cooled.add(key);
      continue;
    }
    existing.previousTradeMs = Number.isFinite(tradeMs) ? tradeMs : existing.previousTradeMs;
    if ((trade.netPnlPct || 0) < 0) {
      existing.streak += 1;
      states[key] = existing;
      continue;
    }
    states[key] = existing;
    cooled.add(key);
  }
  return Object.fromEntries(
    Object.entries(states).map(([key, state]) => [key, {
      streak: state.streak || 0,
      latestTradeAt: state.latestTradeAt || null,
      lastTradeAgeHours: Number.isFinite(state.lastTradeAgeHours) ? state.lastTradeAgeHours : null,
      stale: Boolean(state.stale),
      gapBroken: Boolean(state.gapBroken)
    }])
  );
}

function computeDrawdownPct(equitySnapshots = []) {
  let peak = 0;
  let maxDrawdown = 0;
  for (const snapshot of equitySnapshots) {
    const equity = Number(snapshot?.equity || 0);
    if (!Number.isFinite(equity) || equity <= 0) {
      continue;
    }
    peak = Math.max(peak, equity);
    if (!peak) {
      continue;
    }
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }
  return clamp(maxDrawdown, 0, 1);
}

function resolveStrategy(trade) {
  return trade.strategyAtEntry || trade.strategyDecision?.activeStrategy || trade.entryRationale?.strategy?.activeStrategy || "unknown";
}

function resolveFactorSet({ family = "", regime = "", marketStructureSummary = {}, calendarSummary = {} } = {}) {
  const factors = new Set();
  if (["trend_following", "orderflow", "market_structure"].includes(family) || regime === "trend") {
    factors.add("momentum");
  }
  if (family === "mean_reversion" || regime === "range") {
    factors.add("mean_reversion");
  }
  if (["breakout", "market_structure"].includes(family) || regime === "breakout") {
    factors.add("breakout");
  }
  if (family === "derivatives" || Math.abs(marketStructureSummary?.crowdingBias || 0) >= 0.35) {
    factors.add("crowding");
  }
  if (regime === "event_risk" || (calendarSummary?.riskScore || 0) >= 0.58) {
    factors.add("event_risk");
  }
  if (!factors.size) {
    factors.add("hybrid");
  }
  return [...factors];
}

export function buildBudgetState(journal = {}, config = {}, nowIso = new Date().toISOString()) {
  const nowMs = new Date(nowIso).getTime();
  const minMs = nowMs - 21 * 86_400_000;
  const strategyBuckets = new Map();
  const familyBuckets = new Map();
  const regimeBuckets = new Map();
  const clusterBuckets = new Map();
  const sectorBuckets = new Map();
  const factorBuckets = new Map();

  for (const trade of journal.trades || []) {
    const atMs = new Date(trade.exitAt || trade.entryAt || 0).getTime();
    if (!Number.isFinite(atMs) || atMs < minMs) {
      continue;
    }
    const strategy = resolveStrategy(trade);
    const family = trade.strategyDecision?.family || trade.entryRationale?.strategy?.family || "unknown";
    const regime = trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown";
    const profile = config.symbolProfiles?.[trade.symbol] || { cluster: "other", sector: "other" };
    const cluster = profile.cluster || "other";
    const sector = profile.sector || "other";
    const factors = resolveFactorSet({
      family,
      regime,
      marketStructureSummary: trade.entryRationale?.marketStructure || trade.latestMarketStructureSummary || {},
      calendarSummary: trade.entryRationale?.calendar || trade.latestCalendarSummary || {}
    });
    const buckets = [
      [strategyBuckets, strategy],
      [familyBuckets, family],
      [regimeBuckets, regime],
      [clusterBuckets, cluster],
      [sectorBuckets, sector]
    ];
    for (const [bucketMap, key] of buckets) {
      if (!bucketMap.has(key)) {
        bucketMap.set(key, []);
      }
      bucketMap.get(key).push(trade.netPnlPct || 0);
    }
    for (const factor of factors) {
      if (!factorBuckets.has(factor)) {
        factorBuckets.set(factor, []);
      }
      factorBuckets.get(factor).push(trade.netPnlPct || 0);
    }
  }

  const scoreBucketMap = (map) => Object.fromEntries(
    [...map.entries()].map(([id, values]) => {
      const edge = average(values);
      const factor = clamp(1 + edge * 12, 0.72, 1.18);
      return [id, Number(factor.toFixed(4))];
    })
  );

  const dailyRealized = (journal.trades || [])
    .filter((trade) => trade.exitAt && sameUtcDay(trade.exitAt, nowIso))
    .reduce((total, trade) => total + (trade.pnlQuote || 0), 0) +
    (journal.scaleOuts || [])
      .filter((event) => event.at && sameUtcDay(event.at, nowIso))
      .reduce((total, event) => total + (event.realizedPnl || 0), 0);
  const dailyLossFraction = dailyRealized < 0 ? Math.abs(dailyRealized) / Math.max(config.startingCash || 1, 1) : 0;
  const dailyBudgetFactor = clamp(1 - dailyLossFraction * 7.5, config.dailyRiskBudgetFloor || 0.35, 1.08);
  const settledTrades = (journal.trades || []).filter((trade) => trade.exitAt);
  const recentReturns = settledTrades
    .slice(-(config.executionCalibrationLookbackTrades || 48))
    .map((trade) => Number(trade.netPnlPct || 0))
    .filter((value) => Number.isFinite(value));
  const tailLosses = recentReturns.filter((value) => value < 0).sort((left, right) => left - right);
  const cvarTailCount = Math.max(1, Math.floor(Math.max(1, tailLosses.length) * 0.2));
  const portfolioCvarPct = tailLosses.length ? Math.abs(average(tailLosses.slice(0, cvarTailCount))) : 0;
  const drawdownPct = computeDrawdownPct((journal.equitySnapshots || []).slice(-240));
  const drawdownBudgetUsage = config.portfolioDrawdownBudgetPct
    ? clamp(drawdownPct / Math.max(config.portfolioDrawdownBudgetPct, 0.0001), 0, 3)
    : 0;
  const regimeLossStreakMetaMap = computeLossStreakStateMap(
    settledTrades,
    (trade) => trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown",
    {
      nowIso,
      maxIdleHours: config.portfolioRegimeKillSwitchMaxIdleHours || 96
    }
  );
  const regimeLossStreakMap = Object.fromEntries(
    Object.entries(regimeLossStreakMetaMap).map(([key, state]) => [key, state.streak || 0])
  );

  return {
    strategyBudgetMap: scoreBucketMap(strategyBuckets),
    familyBudgetMap: scoreBucketMap(familyBuckets),
    regimeBudgetMap: scoreBucketMap(regimeBuckets),
    clusterBudgetMap: scoreBucketMap(clusterBuckets),
    sectorBudgetMap: scoreBucketMap(sectorBuckets),
    factorBudgetMap: scoreBucketMap(factorBuckets),
    dailyBudgetFactor: Number(dailyBudgetFactor.toFixed(4)),
    dailyLossFraction: Number(dailyLossFraction.toFixed(4)),
    portfolioCvarPct: Number(portfolioCvarPct.toFixed(4)),
    drawdownPct: Number(drawdownPct.toFixed(4)),
    drawdownBudgetUsage: Number(drawdownBudgetUsage.toFixed(4)),
    regimeLossStreakMap,
    regimeLossStreakMetaMap
  };
}

export class PortfolioOptimizer {
  constructor(config) {
    this.config = config;
  }

  evaluateCandidate({ symbol, runtime, journal = {}, marketSnapshot, candidateProfile, openPositionContexts, regimeSummary, strategySummary = {}, marketStructureSummary = {}, calendarSummary = {} }) {
    const allOpenPositionContexts = openPositionContexts || [];
    const comparableOpenPositionContexts = allOpenPositionContexts.filter((context) => context?.symbol && context.symbol !== symbol);
    const candidateCluster = candidateProfile.cluster || "other";
    const candidateSector = candidateProfile.sector || "other";
    const hasSpecificCluster = hasSpecificBucket(candidateCluster);
    const hasSpecificSector = hasSpecificBucket(candidateSector);
    const sameClusterPositions = comparableOpenPositionContexts.filter(
      (context) => hasSpecificCluster && hasSpecificBucket(context.profile.cluster) && context.profile.cluster === candidateCluster
    );
    const sameSectorPositions = comparableOpenPositionContexts.filter(
      (context) => hasSpecificSector && hasSpecificBucket(context.profile.sector) && context.profile.sector === candidateSector
    );
    const activeFamily = strategySummary.family || "unknown";
    const activeRegime = regimeSummary.regime || "unknown";
    const activeStrategy = strategySummary.activeStrategy || "unknown";
    const sameFamilyPositions = comparableOpenPositionContexts.filter((context) => {
      const family = context.position?.strategyDecision?.family || context.position?.entryRationale?.strategy?.family || "unknown";
      return family === activeFamily;
    });
    const sameRegimePositions = comparableOpenPositionContexts.filter((context) => {
      const regime = context.position?.regimeAtEntry || context.position?.entryRationale?.regimeSummary?.regime || "unknown";
      return regime === activeRegime;
    });
    const sameStrategyPositions = comparableOpenPositionContexts.filter((context) => {
      const strategy = context.position?.strategyAtEntry || context.position?.entryRationale?.strategy?.activeStrategy || "unknown";
      return strategy === activeStrategy;
    });
    const candidateFactors = resolveFactorSet({ family: activeFamily, regime: activeRegime, marketStructureSummary, calendarSummary });
    const sameFactorPositions = comparableOpenPositionContexts.filter((context) => {
      const factors = resolveFactorSet({
        family: context.position?.strategyDecision?.family || context.position?.entryRationale?.strategy?.family || "unknown",
        regime: context.position?.regimeAtEntry || context.position?.entryRationale?.regimeSummary?.regime || "unknown",
        marketStructureSummary: context.position?.latestMarketStructureSummary || context.position?.entryRationale?.marketStructure || {},
        calendarSummary: context.position?.latestCalendarSummary || context.position?.entryRationale?.calendar || {}
      });
      return factors.some((factor) => candidateFactors.includes(factor));
    });

    const candidateReturns = toReturns(marketSnapshot.candles || []);
    const budgetState = buildBudgetState(journal, this.config, new Date().toISOString());
    const correlations = comparableOpenPositionContexts.map((context) => ({
      symbol: context.symbol,
      correlation: rollingCorrelation(candidateReturns, toReturns(context.marketSnapshot.candles || []))
    }));
    const maxCorrelation = correlations.reduce(
      (maxValue, item) => Math.max(maxValue, Math.abs(item.correlation || 0)),
      0
    );

    const totalEquityProxy = Math.max(
      runtime?.lastKnownEquity ||
        ((runtime?.lastKnownBalance || 0) + allOpenPositionContexts.reduce((total, context) => total + (context.position?.notional || context.position?.quantity * context.position?.entryPrice || 0), 0)) ||
        this.config.startingCash,
      1
    );
    const openExposure = allOpenPositionContexts.reduce((total, context) => total + (context.position?.notional || context.position?.quantity * context.position?.entryPrice || 0), 0);
    const clusterExposure = sameClusterPositions.reduce((total, context) => total + (context.position?.notional || context.position?.quantity * context.position?.entryPrice || 0), 0);
    const sectorExposure = sameSectorPositions.reduce((total, context) => total + (context.position?.notional || context.position?.quantity * context.position?.entryPrice || 0), 0);
    const familyExposure = sameFamilyPositions.reduce((total, context) => total + (context.position?.notional || context.position?.quantity * context.position?.entryPrice || 0), 0);
    const regimeExposure = sameRegimePositions.reduce((total, context) => total + (context.position?.notional || context.position?.quantity * context.position?.entryPrice || 0), 0);
    const strategyExposure = sameStrategyPositions.reduce((total, context) => total + (context.position?.notional || context.position?.quantity * context.position?.entryPrice || 0), 0);
    const factorExposure = sameFactorPositions.reduce((total, context) => total + (context.position?.notional || context.position?.quantity * context.position?.entryPrice || 0), 0);
    const clusterHeat = clusterExposure / totalEquityProxy;
    const sectorHeat = sectorExposure / totalEquityProxy;
    const familyHeat = familyExposure / totalEquityProxy;
    const regimeHeat = regimeExposure / totalEquityProxy;
    const strategyHeat = strategyExposure / totalEquityProxy;
    const factorHeat = factorExposure / totalEquityProxy;
    const portfolioHeat = openExposure / totalEquityProxy;

    const volatilityTargetFraction = clamp(
      this.config.targetAnnualizedVolatility / Math.max((marketSnapshot.market.realizedVolPct || 0) * 16, 0.05),
      this.config.minVolTargetFraction,
      this.config.maxVolTargetFraction
    );

    const regimeExposureMultiplier = {
      trend: 1,
      breakout: 0.92,
      range: 0.78,
      high_vol: 0.6,
      event_risk: 0.45
    }[regimeSummary.regime] || 0.8;

    const sameClusterPenalty = sameClusterPositions.length >= this.config.maxClusterPositions ? 0.4 : 1;
    const sameSectorPenalty = sameSectorPositions.length >= this.config.maxSectorPositions ? 0.7 : 1;
    const correlationPenalty = maxCorrelation > this.config.maxPairCorrelation ? 0.35 : 1;
    const strategyBudgetFactor = budgetState.strategyBudgetMap[activeStrategy] || 1;
    const familyBudgetFactor = budgetState.familyBudgetMap[activeFamily] || 1;
    const regimeBudgetFactor = budgetState.regimeBudgetMap[activeRegime] || 1;
    const clusterBudgetFactor = hasSpecificCluster ? (budgetState.clusterBudgetMap[candidateCluster] || 1) : 1;
    const sectorBudgetFactor = hasSpecificSector ? (budgetState.sectorBudgetMap[candidateSector] || 1) : 1;
    const factorBudgetFactor = candidateFactors.length
      ? average(candidateFactors.map((factor) => budgetState.factorBudgetMap[factor] || 1))
      : 1;
    const dailyBudgetFactor = budgetState.dailyBudgetFactor || 1;
    const familyExposurePenalty = sameFamilyPositions.length >= this.config.maxFamilyPositions ? 0.58 : 1;
    const regimeExposureSoftenedInPaper =
      this.config.botMode === "paper" &&
      sameRegimePositions.length >= this.config.maxRegimePositions &&
      sameClusterPositions.length < this.config.maxClusterPositions &&
      sameSectorPositions.length < this.config.maxSectorPositions &&
      sameFamilyPositions.length === 0 &&
      sameStrategyPositions.length === 0 &&
      maxCorrelation <= this.config.maxPairCorrelation;
    const regimeExposurePenalty = sameRegimePositions.length >= this.config.maxRegimePositions
      ? (regimeExposureSoftenedInPaper ? 0.84 : 0.7)
      : 1;
    const strategyExposurePenalty = sameStrategyPositions.length >= Math.max(1, Math.min(2, this.config.maxFamilyPositions || 2)) ? 0.78 : 1;
    const clusterHeatPenalty = clamp(1 - Math.max(0, clusterHeat - 0.18) * 1.8, 0.58, 1);
    const sectorHeatPenalty = clamp(1 - Math.max(0, sectorHeat - 0.28) * 1.4, 0.62, 1);
    const factorHeatPenalty = clamp(1 - Math.max(0, factorHeat - 0.22) * 1.6, 0.58, 1);
    const portfolioHeatPenalty = clamp(1 - portfolioHeat * 0.42, 0.55, 1);
    const cvarPenalty = clamp(
      1 - Math.max(0, (budgetState.portfolioCvarPct || 0) - (this.config.portfolioMaxCvarPct || 0.028)) * 18,
      0.5,
      1
    );
    const drawdownBudgetPenalty = clamp(
      1 - Math.max(0, (budgetState.drawdownBudgetUsage || 0) - 0.7) * 0.55,
      0.48,
      1
    );
    const regimeLossStreakMeta = budgetState.regimeLossStreakMetaMap?.[activeRegime] || null;
    const regimeLossStreak = regimeLossStreakMeta?.streak ?? budgetState.regimeLossStreakMap?.[activeRegime] ?? 0;
    const regimeKillSwitchStale = Boolean(regimeLossStreakMeta?.stale);
    const regimeKillSwitchActive = !regimeKillSwitchStale && regimeLossStreak >= (this.config.portfolioRegimeKillSwitchLossStreak || 3);
    const regimeKillSwitchSoftenedInPaper = this.config.botMode === "paper" && regimeKillSwitchActive;

    const sizeMultiplier = clamp(
      volatilityTargetFraction *
        regimeExposureMultiplier *
        sameClusterPenalty *
        sameSectorPenalty *
        correlationPenalty *
        strategyBudgetFactor *
        familyBudgetFactor *
        regimeBudgetFactor *
        clusterBudgetFactor *
        sectorBudgetFactor *
        factorBudgetFactor *
        dailyBudgetFactor *
        familyExposurePenalty *
        regimeExposurePenalty *
        strategyExposurePenalty *
        clusterHeatPenalty *
        sectorHeatPenalty *
        factorHeatPenalty *
        portfolioHeatPenalty *
        cvarPenalty *
        drawdownBudgetPenalty *
        (regimeKillSwitchActive ? (regimeKillSwitchSoftenedInPaper ? 0.74 : 0.22) : 1),
      0.18,
      1.12
    );

    const allocatorScore = clamp(
      0.56 +
        volatilityTargetFraction * 0.08 +
        dailyBudgetFactor * 0.08 +
        strategyBudgetFactor * 0.07 +
        familyBudgetFactor * 0.05 +
        clusterBudgetFactor * 0.05 +
        (factorBudgetFactor - 1) * 0.06 -
        maxCorrelation * 0.16 -
        clusterHeat * 0.18 -
        sectorHeat * 0.12 -
        factorHeat * 0.1 -
        portfolioHeat * 0.14 -
        Math.max(0, (budgetState.portfolioCvarPct || 0) - (this.config.portfolioMaxCvarPct || 0.028)) * 1.6 -
        Math.max(0, (budgetState.drawdownBudgetUsage || 0) - 1) * 0.18 -
        (regimeKillSwitchActive ? (regimeKillSwitchSoftenedInPaper ? 0.08 : 0.28) : 0),
      0,
      1
    );

    const reasons = [];
    const hardReasons = [];
    if (sameClusterPositions.length >= this.config.maxClusterPositions) {
      reasons.push("cluster_exposure_limit_hit");
      hardReasons.push("cluster_exposure_limit_hit");
    }
    if (sameSectorPositions.length >= this.config.maxSectorPositions) {
      reasons.push("sector_exposure_limit_hit");
      hardReasons.push("sector_exposure_limit_hit");
    }
    if (maxCorrelation > this.config.maxPairCorrelation) {
      reasons.push("pair_correlation_too_high");
      hardReasons.push("pair_correlation_too_high");
    }
    if (sameFamilyPositions.length >= this.config.maxFamilyPositions) {
      reasons.push("family_exposure_limit_hit");
      hardReasons.push("family_exposure_limit_hit");
    }
    if (sameRegimePositions.length >= this.config.maxRegimePositions && !regimeExposureSoftenedInPaper) {
      reasons.push("regime_exposure_limit_hit");
      hardReasons.push("regime_exposure_limit_hit");
    }
    if (sameStrategyPositions.length >= Math.max(1, Math.min(2, this.config.maxFamilyPositions || 2))) {
      reasons.push("strategy_exposure_limit_hit");
      hardReasons.push("strategy_exposure_limit_hit");
    }
    if (shouldFlagBudgetCooling({
      factor: familyBudgetFactor,
      exposureCount: sameFamilyPositions.length,
      heat: familyHeat,
      activeHeatThreshold: 0.08
    })) {
      reasons.push("family_budget_cooled");
    }
    if (shouldFlagBudgetCooling({
      factor: regimeBudgetFactor,
      exposureCount: sameRegimePositions.length,
      heat: regimeHeat,
      activeHeatThreshold: 0.08
    })) {
      reasons.push("regime_budget_cooled");
    }
    if (shouldFlagBudgetCooling({
      factor: strategyBudgetFactor,
      exposureCount: sameStrategyPositions.length,
      heat: strategyHeat,
      activeHeatThreshold: 0.05
    })) {
      reasons.push("strategy_budget_cooled");
    }
    if (shouldFlagBudgetCooling({
      factor: clusterBudgetFactor,
      exposureCount: sameClusterPositions.length,
      heat: clusterHeat,
      activeHeatThreshold: 0.12
    })) {
      reasons.push("cluster_budget_cooled");
    }
    if (dailyBudgetFactor < 0.9) {
      reasons.push("daily_risk_budget_cooled");
    }
    if (shouldFlagBudgetCooling({
      factor: factorBudgetFactor,
      exposureCount: sameFactorPositions.length,
      heat: factorHeat,
      activeHeatThreshold: 0.08
    })) {
      reasons.push("factor_budget_cooled");
    }
    if ((budgetState.portfolioCvarPct || 0) >= (this.config.portfolioMaxCvarPct || 0.028)) {
      reasons.push("portfolio_cvar_budget_hit");
      hardReasons.push("portfolio_cvar_budget_hit");
    }
    if ((budgetState.drawdownBudgetUsage || 0) >= 1) {
      reasons.push("portfolio_drawdown_budget_hit");
      hardReasons.push("portfolio_drawdown_budget_hit");
    }
    if (regimeKillSwitchActive) {
      reasons.push("regime_kill_switch_active");
      if (!regimeKillSwitchSoftenedInPaper) {
        hardReasons.push("regime_kill_switch_active");
      }
    }
    if (clusterHeat >= 0.24) {
      reasons.push("cluster_heat_elevated");
    }
    if (sectorHeat >= 0.34) {
      reasons.push("sector_heat_elevated");
    }
    if (factorHeat >= 0.28) {
      reasons.push("factor_heat_elevated");
    }
    if (allocatorScore < 0.42) {
      reasons.push("portfolio_allocator_score_low");
    }

    return {
      sameClusterCount: sameClusterPositions.length,
      sameSectorCount: sameSectorPositions.length,
      sameFamilyCount: sameFamilyPositions.length,
      sameRegimeCount: sameRegimePositions.length,
      sameStrategyCount: sameStrategyPositions.length,
      maxCorrelation,
      volatilityTargetFraction,
      regimeExposureMultiplier,
      strategyBudgetFactor,
      familyBudgetFactor,
      regimeBudgetFactor,
      clusterBudgetFactor,
      sectorBudgetFactor,
      factorBudgetFactor,
      dailyBudgetFactor,
      dailyLossFraction: budgetState.dailyLossFraction,
      clusterHeat,
      sectorHeat,
      familyHeat,
      regimeHeat,
      strategyHeat,
      factorHeat,
      portfolioHeat,
      portfolioCvarPct: budgetState.portfolioCvarPct,
      drawdownPct: budgetState.drawdownPct,
      drawdownBudgetUsage: budgetState.drawdownBudgetUsage,
      regimeLossStreak,
      regimeLatestTradeAt: regimeLossStreakMeta?.latestTradeAt || null,
      regimeLastTradeAgeHours: Number.isFinite(regimeLossStreakMeta?.lastTradeAgeHours) ? regimeLossStreakMeta.lastTradeAgeHours : null,
      regimeKillSwitchActive,
      regimeKillSwitchStale,
      regimeKillSwitchSoftenedInPaper,
      regimeExposureSoftenedInPaper,
      cvarPenalty,
      drawdownBudgetPenalty,
      candidateFactors,
      sameFactorCount: sameFactorPositions.length,
      selfPositionExcluded: allOpenPositionContexts.some((context) => context?.symbol === symbol),
      unknownClusterOverlapIgnored: !hasSpecificCluster,
      unknownSectorOverlapIgnored: !hasSpecificSector,
      allocatorScore,
      sizeMultiplier,
      reasons,
      hardReasons: [...new Set(hardReasons)],
      correlations
    };
  }
}

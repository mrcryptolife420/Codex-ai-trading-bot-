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

function buildBudgetState(journal = {}, nowIso = new Date().toISOString()) {
  const nowMs = new Date(nowIso).getTime();
  const minMs = nowMs - 21 * 86_400_000;
  const familyBuckets = new Map();
  const regimeBuckets = new Map();

  for (const trade of journal.trades || []) {
    const atMs = new Date(trade.exitAt || trade.entryAt || 0).getTime();
    if (!Number.isFinite(atMs) || atMs < minMs) {
      continue;
    }
    const family = trade.strategyDecision?.family || trade.entryRationale?.strategy?.family || "unknown";
    const regime = trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown";
    if (!familyBuckets.has(family)) {
      familyBuckets.set(family, []);
    }
    if (!regimeBuckets.has(regime)) {
      regimeBuckets.set(regime, []);
    }
    familyBuckets.get(family).push(trade.netPnlPct || 0);
    regimeBuckets.get(regime).push(trade.netPnlPct || 0);
  }

  const scoreBucketMap = (map) => Object.fromEntries(
    [...map.entries()].map(([id, values]) => {
      const edge = average(values);
      return [id, clamp(1 + edge * 12, 0.72, 1.18)];
    })
  );

  return {
    familyBudgetMap: scoreBucketMap(familyBuckets),
    regimeBudgetMap: scoreBucketMap(regimeBuckets)
  };
}

export class PortfolioOptimizer {
  constructor(config) {
    this.config = config;
  }

  evaluateCandidate({ symbol, runtime, journal = {}, marketSnapshot, candidateProfile, openPositionContexts, regimeSummary, strategySummary = {} }) {
    const sameClusterPositions = openPositionContexts.filter(
      (context) => context.profile.cluster === candidateProfile.cluster
    );
    const sameSectorPositions = openPositionContexts.filter(
      (context) => context.profile.sector === candidateProfile.sector
    );
    const candidateReturns = toReturns(marketSnapshot.candles || []);
    const budgetState = buildBudgetState(journal, new Date().toISOString());
    const activeFamily = strategySummary.family || "unknown";
    const activeRegime = regimeSummary.regime || "unknown";

    const correlations = openPositionContexts.map((context) => ({
      symbol: context.symbol,
      correlation: rollingCorrelation(candidateReturns, toReturns(context.marketSnapshot.candles || []))
    }));
    const maxCorrelation = correlations.reduce(
      (maxValue, item) => Math.max(maxValue, Math.abs(item.correlation || 0)),
      0
    );

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

    const sameFamilyPositions = openPositionContexts.filter((context) => {
      const family = context.position?.strategyDecision?.family || context.position?.entryRationale?.strategy?.family || "unknown";
      return family === activeFamily;
    });
    const sameRegimePositions = openPositionContexts.filter((context) => {
      const regime = context.position?.regimeAtEntry || context.position?.entryRationale?.regimeSummary?.regime || "unknown";
      return regime === activeRegime;
    });

    const sameClusterPenalty = sameClusterPositions.length >= this.config.maxClusterPositions ? 0.4 : 1;
    const sameSectorPenalty = sameSectorPositions.length >= this.config.maxSectorPositions ? 0.7 : 1;
    const correlationPenalty = maxCorrelation > this.config.maxPairCorrelation ? 0.35 : 1;
    const familyBudgetFactor = budgetState.familyBudgetMap[activeFamily] || 1;
    const regimeBudgetFactor = budgetState.regimeBudgetMap[activeRegime] || 1;
    const familyExposurePenalty = sameFamilyPositions.length >= this.config.maxFamilyPositions ? 0.58 : 1;
    const regimeExposurePenalty = sameRegimePositions.length >= this.config.maxRegimePositions ? 0.7 : 1;
    const sizeMultiplier = clamp(
      volatilityTargetFraction * regimeExposureMultiplier * sameClusterPenalty * sameSectorPenalty * correlationPenalty * familyBudgetFactor * regimeBudgetFactor * familyExposurePenalty * regimeExposurePenalty,
      0.2,
      1.1
    );

    const reasons = [];
    if (sameClusterPositions.length >= this.config.maxClusterPositions) {
      reasons.push("cluster_exposure_limit_hit");
    }
    if (sameSectorPositions.length >= this.config.maxSectorPositions) {
      reasons.push("sector_exposure_limit_hit");
    }
    if (maxCorrelation > this.config.maxPairCorrelation) {
      reasons.push("pair_correlation_too_high");
    }
    if (sameFamilyPositions.length >= this.config.maxFamilyPositions) {
      reasons.push("family_exposure_limit_hit");
    }
    if (sameRegimePositions.length >= this.config.maxRegimePositions) {
      reasons.push("regime_exposure_limit_hit");
    }
    if (familyBudgetFactor < 0.9) {
      reasons.push("family_budget_cooled");
    }
    if (regimeBudgetFactor < 0.9) {
      reasons.push("regime_budget_cooled");
    }

    return {
      sameClusterCount: sameClusterPositions.length,
      sameSectorCount: sameSectorPositions.length,
      sameFamilyCount: sameFamilyPositions.length,
      sameRegimeCount: sameRegimePositions.length,
      maxCorrelation,
      volatilityTargetFraction,
      regimeExposureMultiplier,
      familyBudgetFactor,
      regimeBudgetFactor,
      sizeMultiplier,
      reasons,
      correlations
    };
  }
}


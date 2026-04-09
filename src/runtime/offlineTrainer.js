import { clamp } from "../utils/math.js";
import {
  buildFeatureGovernanceSummary,
  buildSampleConfidence,
  featureGroup,
  isSupportFeature
} from "../strategy/featureGovernance.js";
import { getConfiguredTradingSource, matchesTradingSource } from "../utils/tradingSource.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function resolveEvidenceTimestampMs(item = {}) {
  const at = item.exitAt || item.resolvedAt || item.closedAt || item.entryAt || item.queuedAt || item.dueAt || item.createdAt || null;
  const timestampMs = new Date(at || 0).getTime();
  return Number.isFinite(timestampMs) ? timestampMs : Number.NaN;
}

function computeEvidenceWeight(item = {}, { nowIso = new Date().toISOString(), halfLifeHours = 24 * 7, minWeight = 0.2 } = {}) {
  const nowMs = new Date(nowIso).getTime();
  const evidenceMs = resolveEvidenceTimestampMs(item);
  if (!Number.isFinite(nowMs) || !Number.isFinite(evidenceMs)) {
    return 1;
  }
  const ageHours = Math.max(0, (nowMs - evidenceMs) / 3_600_000);
  const decay = Math.pow(0.5, ageHours / Math.max(halfLifeHours, 1));
  return clamp(decay, minWeight, 1);
}

function computeFreshnessScore(trades = [], nowIso = new Date().toISOString(), horizonHours = 24 * 21) {
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(nowMs) || !trades.length) {
    return {
      freshnessScore: 0,
      latestTradeAt: null
    };
  }
  const timestamps = trades
    .map((trade) => trade.exitAt || trade.entryAt || null)
    .filter(Boolean)
    .map((at) => new Date(at).getTime())
    .filter(Number.isFinite);
  if (!timestamps.length) {
    return {
      freshnessScore: 0,
      latestTradeAt: null
    };
  }
  const latestTradeMs = Math.max(...timestamps);
  const freshnessScore = average(
    timestamps.map((tradeMs) => clamp(1 - Math.max(0, nowMs - tradeMs) / Math.max(1, horizonHours * 60 * 60 * 1000), 0, 1)),
    0
  );
  return {
    freshnessScore: num(freshnessScore),
    latestTradeAt: new Date(latestTradeMs).toISOString()
  };
}

function buildBucketMap(items = [], keyFn, projector = null) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    if (!map.has(key)) {
      map.set(key, { id: key, count: 0, paperCount: 0, liveCount: 0, pnl: 0, wins: 0, quality: 0, label: 0, move: 0 });
    }
    const bucket = map.get(key);
    const view = projector ? projector(item) : {
      pnl: item.pnlQuote || 0,
      win: (item.pnlQuote || 0) > 0 ? 1 : 0,
      quality: item.executionQualityScore || 0,
      label: item.labelScore || 0,
      move: item.realizedMovePct || 0,
      mode: item.brokerMode || "paper"
    };
    bucket.count += 1;
    bucket.paperCount += view.mode === "paper" ? 1 : 0;
    bucket.liveCount += view.mode === "live" ? 1 : 0;
    bucket.pnl += view.pnl;
    bucket.wins += view.win;
    bucket.quality += view.quality;
    bucket.label += view.label;
    bucket.move += view.move;
  }
  return [...map.values()].map((bucket) => ({
    id: bucket.id,
    tradeCount: bucket.count,
    paperTradeCount: bucket.paperCount,
    liveTradeCount: bucket.liveCount,
    realizedPnl: num(bucket.pnl, 2),
    winRate: num(bucket.count ? bucket.wins / bucket.count : 0),
    avgExecutionQuality: num(bucket.count ? bucket.quality / bucket.count : 0),
    avgLabelScore: num(bucket.count ? bucket.label / bucket.count : 0),
    avgMovePct: num(bucket.count ? bucket.move / bucket.count : 0),
    governanceScore: num(clamp(0.46 + (bucket.count ? bucket.pnl / Math.max(bucket.count * 80, 1) : 0) + (bucket.count ? bucket.wins / bucket.count - 0.5 : 0), 0, 1))
  })).sort((left, right) => right.governanceScore - left.governanceScore);
}

function buildDecisionScorecards({
  trades = [],
  falsePositives = [],
  falseNegatives = [],
  keyFn = null,
  falseNegativeKeyFn = null,
  fallbackId = "unknown",
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const map = new Map();
  const halfLifeHours = safeNumber(config.offlineTrainerScorecardHalfLifeHours, 24 * 7);
  const priorTrades = safeNumber(config.offlineTrainerScorecardPriorTrades, 3);
  const minEffectiveSample = safeNumber(config.offlineTrainerMinEffectiveSample, 2.4);
  const getBucket = (id) => {
    const key = id || fallbackId;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        tradeCount: 0,
        paperTradeCount: 0,
        liveTradeCount: 0,
        winCount: 0,
        pnl: 0,
        executionQuality: 0,
        labelScore: 0,
        falsePositiveCount: 0,
        falseNegativeCount: 0,
        moveSum: 0,
        weightedTradeCount: 0,
        weightedFalsePositiveCount: 0,
        weightedFalseNegativeCount: 0,
        weightedWinSum: 0,
        weightedPnl: 0,
        weightedExecutionQuality: 0,
        weightedLabelScore: 0,
        weightedTradeMoveSum: 0,
        weightedFalseNegativeMoveSum: 0,
        evidenceWeightSum: 0,
        evidenceCount: 0,
        latestEvidenceMs: Number.NaN
      });
    }
    return map.get(key);
  };

  for (const trade of trades) {
    const id = keyFn ? keyFn(trade) : fallbackId;
    const bucket = getBucket(id);
    const weight = computeEvidenceWeight(trade, { nowIso, halfLifeHours });
    const evidenceMs = resolveEvidenceTimestampMs(trade);
    bucket.tradeCount += 1;
    bucket.paperTradeCount += (trade.brokerMode || "paper") === "paper" ? 1 : 0;
    bucket.liveTradeCount += (trade.brokerMode || "paper") === "live" ? 1 : 0;
    bucket.winCount += (trade.pnlQuote || 0) > 0 ? 1 : 0;
    bucket.pnl += trade.pnlQuote || 0;
    bucket.executionQuality += trade.executionQualityScore || 0;
    bucket.labelScore += trade.labelScore || 0;
    bucket.moveSum += trade.netPnlPct || 0;
    bucket.weightedTradeCount += weight;
    bucket.weightedWinSum += ((trade.pnlQuote || 0) > 0 ? 1 : 0) * weight;
    bucket.weightedPnl += (trade.pnlQuote || 0) * weight;
    bucket.weightedExecutionQuality += (trade.executionQualityScore || 0) * weight;
    bucket.weightedLabelScore += (trade.labelScore || 0) * weight;
    bucket.weightedTradeMoveSum += (trade.netPnlPct || 0) * weight;
    bucket.evidenceWeightSum += weight;
    bucket.evidenceCount += 1;
    if (Number.isFinite(evidenceMs)) {
      bucket.latestEvidenceMs = Number.isFinite(bucket.latestEvidenceMs)
        ? Math.max(bucket.latestEvidenceMs, evidenceMs)
        : evidenceMs;
    }
  }

  for (const trade of falsePositives) {
    const id = keyFn ? keyFn(trade) : fallbackId;
    const bucket = getBucket(id);
    const weight = computeEvidenceWeight(trade, { nowIso, halfLifeHours });
    const evidenceMs = resolveEvidenceTimestampMs(trade);
    bucket.falsePositiveCount += 1;
    bucket.weightedFalsePositiveCount += weight;
    bucket.evidenceWeightSum += weight;
    bucket.evidenceCount += 1;
    if (Number.isFinite(evidenceMs)) {
      bucket.latestEvidenceMs = Number.isFinite(bucket.latestEvidenceMs)
        ? Math.max(bucket.latestEvidenceMs, evidenceMs)
        : evidenceMs;
    }
  }

  for (const item of falseNegatives) {
    const id = falseNegativeKeyFn ? falseNegativeKeyFn(item) : fallbackId;
    const bucket = getBucket(id);
    const weight = computeEvidenceWeight(item, { nowIso, halfLifeHours });
    const evidenceMs = resolveEvidenceTimestampMs(item);
    bucket.falseNegativeCount += 1;
    bucket.moveSum += item.realizedMovePct || 0;
    bucket.weightedFalseNegativeCount += weight;
    bucket.weightedFalseNegativeMoveSum += (item.realizedMovePct || 0) * weight;
    bucket.evidenceWeightSum += weight;
    bucket.evidenceCount += 1;
    if (Number.isFinite(evidenceMs)) {
      bucket.latestEvidenceMs = Number.isFinite(bucket.latestEvidenceMs)
        ? Math.max(bucket.latestEvidenceMs, evidenceMs)
        : evidenceMs;
    }
  }

  return [...map.values()]
    .map((bucket) => {
      const tradeCount = bucket.tradeCount || 0;
      const weightedTradeCount = bucket.weightedTradeCount || 0;
      const weightedFalsePositiveCount = bucket.weightedFalsePositiveCount || 0;
      const weightedFalseNegativeCount = bucket.weightedFalseNegativeCount || 0;
      const weightedOutcomeSample = weightedTradeCount + weightedFalseNegativeCount * 0.72;
      const effectiveSampleSize = weightedTradeCount + weightedFalseNegativeCount * 0.72 + weightedFalsePositiveCount * 0.38;
      const denominator = weightedTradeCount + priorTrades;
      const winRate = (bucket.weightedWinSum + 0.5 * priorTrades) / Math.max(denominator, 1);
      const avgExecutionQuality = (bucket.weightedExecutionQuality + 0.56 * priorTrades) / Math.max(denominator, 1);
      const avgLabelScore = (bucket.weightedLabelScore + 0.52 * priorTrades) / Math.max(denominator, 1);
      const avgMovePct = (bucket.weightedTradeMoveSum + bucket.weightedFalseNegativeMoveSum * 0.72) / Math.max(weightedOutcomeSample + priorTrades * 0.5, 1);
      const falsePositiveRate = weightedFalsePositiveCount / Math.max(weightedTradeCount + priorTrades * 0.5, 1);
      const falseNegativeRate = weightedFalseNegativeCount / Math.max(weightedTradeCount + weightedFalseNegativeCount + priorTrades, 1);
      const pnlScore = clamp(0.5 + bucket.weightedPnl / Math.max((weightedTradeCount + priorTrades) * 60, 60), 0, 1);
      const freshnessScore = bucket.evidenceCount ? bucket.evidenceWeightSum / bucket.evidenceCount : 0;
      const latestEvidenceAt = Number.isFinite(bucket.latestEvidenceMs) ? new Date(bucket.latestEvidenceMs).toISOString() : null;
      const sampleConfidence = buildSampleConfidence(
        effectiveSampleSize,
        Math.max(2, safeNumber(config.strategyAttributionMinTrades, 6))
      );
      const governanceScore = clamp(
        0.34 +
          (winRate - 0.5) * 0.26 +
          avgExecutionQuality * 0.14 +
          avgLabelScore * 0.16 +
          pnlScore * 0.18 -
          falsePositiveRate * 0.18 -
          falseNegativeRate * 0.1 +
          sampleConfidence * 0.08 +
          (freshnessScore - 0.5) * 0.04,
        0,
        1
      );
      const status = governanceScore >= 0.62 && effectiveSampleSize >= minEffectiveSample + 1
        ? "prime"
        : governanceScore <= 0.42 && effectiveSampleSize >= minEffectiveSample
          ? "cooldown"
          : effectiveSampleSize >= 0.8 || weightedFalseNegativeCount > 0.2
            ? "observe"
            : "warmup";
      return {
        id: bucket.id,
        tradeCount,
        paperTradeCount: bucket.paperTradeCount,
        liveTradeCount: bucket.liveTradeCount,
        winRate: num(winRate),
        realizedPnl: num(bucket.pnl, 2),
        avgExecutionQuality: num(avgExecutionQuality),
        avgLabelScore: num(avgLabelScore),
        avgMovePct: num(avgMovePct),
        falsePositiveCount: bucket.falsePositiveCount,
        falseNegativeCount: bucket.falseNegativeCount,
        falsePositiveRate: num(falsePositiveRate),
        falseNegativeRate: num(falseNegativeRate),
        effectiveSampleSize: num(effectiveSampleSize, 4),
        weightedTradeCount: num(weightedTradeCount, 4),
        weightedFalsePositiveCount: num(weightedFalsePositiveCount, 4),
        weightedFalseNegativeCount: num(weightedFalseNegativeCount, 4),
        freshnessScore: num(freshnessScore, 4),
        sampleConfidence: num(sampleConfidence, 4),
        latestEvidenceAt,
        governanceScore: num(governanceScore),
        dominantError: bucket.falsePositiveCount > bucket.falseNegativeCount
          ? "false_positive_bias"
          : bucket.falseNegativeCount > bucket.falsePositiveCount
            ? "false_negative_bias"
            : "balanced",
        status
      };
    })
    .sort((left, right) => right.governanceScore - left.governanceScore)
    .slice(0, 10);
}

function buildStrategyScorecards(trades = [], falsePositives = [], falseNegatives = [], config = {}, nowIso = new Date().toISOString()) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown",
    falseNegativeKeyFn: (item) => item.strategy || item.strategyAtEntry || "blocked_setup",
    fallbackId: "unknown",
    config,
    nowIso
  });
}

function buildRegimeScorecards(trades = [], falsePositives = [], falseNegatives = [], config = {}, nowIso = new Date().toISOString()) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown",
    falseNegativeKeyFn: (item) => item.regime || item.regimeAtEntry || "blocked_setup",
    fallbackId: "unknown",
    config,
    nowIso
  });
}

function resolveTradeConditionId(trade = {}) {
  return (
    trade.marketConditionAtEntry ||
    trade.entryRationale?.marketCondition?.conditionId ||
    trade.entryRationale?.marketConditionSummary?.conditionId ||
    trade.entryRationale?.marketCondition?.id ||
    trade.entryRationale?.regimeSummary?.regime ||
    trade.regimeAtEntry ||
    "unknown_condition"
  );
}

function resolveTradeStrategyFamily(trade = {}) {
  return (
    trade.strategyFamily ||
    trade.entryRationale?.strategy?.family ||
    trade.strategyDecision?.family ||
    "unknown_family"
  );
}

function resolveTradeStrategyId(trade = {}) {
  return (
    trade.strategyAtEntry ||
    trade.entryRationale?.strategy?.activeStrategy ||
    trade.strategyDecision?.activeStrategy ||
    "unknown_strategy"
  );
}

function resolveCounterfactualConditionId(item = {}) {
  return (
    item.marketConditionId ||
    item.marketCondition?.conditionId ||
    item.entryRationale?.marketCondition?.conditionId ||
    item.regime ||
    "unknown_condition"
  );
}

function resolveCounterfactualStrategyFamily(item = {}) {
  return item.strategyFamily || item.family || item.paperLearning?.scope?.family || "unknown_family";
}

function resolveTradeSessionId(trade = {}) {
  return (
    trade.sessionAtEntry ||
    trade.entryRationale?.session?.session ||
    "unknown_session"
  );
}

function resolveCounterfactualSessionId(item = {}) {
  return (
    item.sessionAtEntry ||
    item.paperLearning?.scope?.session ||
    "unknown_session"
  );
}

function resolveCounterfactualStrategyId(item = {}) {
  return (
    item.strategy ||
    item.strategyAtEntry ||
    item.paperLearning?.scope?.strategy ||
    "unknown_strategy"
  );
}

function resolveCounterfactualBlockerReasons(item = {}) {
  const reasons = arr(item.blockerReasons || []).filter(Boolean);
  if (reasons.length) {
    return reasons.slice(0, 4);
  }
  return [item.blocker || item.reason || "no_explicit_blocker"];
}

function resolveCounterfactualMarginalBlocker(item = {}) {
  if (item.marginalBlocker) {
    return item.marginalBlocker;
  }
  const reasons = resolveCounterfactualBlockerReasons(item);
  return reasons.length === 1 ? reasons[0] : null;
}

function resolveCounterfactualBlockerMode(item = {}, blockerId = null) {
  const marginalBlocker = resolveCounterfactualMarginalBlocker(item);
  if (blockerId && marginalBlocker === blockerId) {
    return "marginal";
  }
  const sharedBlockers = arr(item.sharedBlockers || []).filter(Boolean);
  if (blockerId && sharedBlockers.includes(blockerId)) {
    return "shared";
  }
  const reasons = resolveCounterfactualBlockerReasons(item);
  if (blockerId && reasons.includes(blockerId)) {
    return reasons.length === 1 ? "marginal" : "shared";
  }
  if (item.blockerMode) {
    return item.blockerMode;
  }
  return marginalBlocker ? "marginal" : reasons.length ? "shared" : "none";
}

function buildConditionScorecards(trades = [], falsePositives = [], falseNegatives = [], config = {}, nowIso = new Date().toISOString()) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => resolveTradeConditionId(trade),
    falseNegativeKeyFn: (item) => resolveCounterfactualConditionId(item),
    fallbackId: "unknown_condition",
    config,
    nowIso
  });
}

function buildConditionStrategyScorecards(trades = [], falsePositives = [], falseNegatives = [], config = {}, nowIso = new Date().toISOString()) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => `${resolveTradeConditionId(trade)}::${resolveTradeStrategyId(trade)}`,
    falseNegativeKeyFn: (item) => `${resolveCounterfactualConditionId(item)}::${item.strategy || item.strategyAtEntry || "blocked_setup"}`,
    fallbackId: "unknown_condition::unknown_strategy",
    config,
    nowIso
  }).map((item) => {
    const [conditionId, strategyId] = String(item.id || "").split("::");
    return {
      ...item,
      conditionId: conditionId || null,
      strategyId: strategyId || null,
      familyId: trades.find((trade) => `${resolveTradeConditionId(trade)}::${resolveTradeStrategyId(trade)}` === item.id)?.strategyFamily ||
        trades.find((trade) => `${resolveTradeConditionId(trade)}::${resolveTradeStrategyId(trade)}` === item.id)?.entryRationale?.strategy?.family ||
        null
    };
  });
}

function buildConditionFamilyScorecards(trades = [], falsePositives = [], falseNegatives = [], config = {}, nowIso = new Date().toISOString()) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => `${resolveTradeConditionId(trade)}::${resolveTradeStrategyFamily(trade)}`,
    falseNegativeKeyFn: (item) => `${resolveCounterfactualConditionId(item)}::${resolveCounterfactualStrategyFamily(item)}`,
    fallbackId: "unknown_condition::unknown_family",
    config,
    nowIso
  }).map((item) => {
    const [conditionId, familyId] = String(item.id || "").split("::");
    return {
      ...item,
      conditionId: conditionId || null,
      familyId: familyId || null
    };
  });
}

function buildConditionSessionFamilyScorecards(trades = [], falsePositives = [], falseNegatives = [], config = {}, nowIso = new Date().toISOString()) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => `${resolveTradeConditionId(trade)}::${resolveTradeSessionId(trade)}::${resolveTradeStrategyFamily(trade)}`,
    falseNegativeKeyFn: (item) => `${resolveCounterfactualConditionId(item)}::${resolveCounterfactualSessionId(item)}::${resolveCounterfactualStrategyFamily(item)}`,
    fallbackId: "unknown_condition::unknown_session::unknown_family",
    config,
    nowIso
  }).map((item) => {
    const [conditionId, sessionId, familyId] = String(item.id || "").split("::");
    return {
      ...item,
      conditionId: conditionId || null,
      sessionId: sessionId || null,
      familyId: familyId || null
    };
  });
}

const HARD_TUNING_BLOCKERS = new Set([
  "exchange_notice_risk",
  "high_impact_event_imminent",
  "daily_drawdown_limit_hit",
  "max_total_exposure_reached",
  "spread_too_wide",
  "volatility_too_high",
  "pair_health_quarantine",
  "live_paper_divergence_guard",
  "manual_review_required",
  "reconcile_required",
  "exchange_truth_freeze"
]);

const BAD_VETO_OUTCOMES = new Set([
  "missed_winner",
  "bad_veto",
  "near_miss_winner",
  "missed_breakout",
  "bad_countertrend_veto",
  "quality_trap",
  "right_direction_wrong_timing"
]);

const GOOD_VETO_OUTCOMES = new Set([
  "good_veto",
  "blocked_correctly",
  "near_miss_loser",
  "fakeout_avoided"
]);

function resolveCounterfactualOutcomeLabel(item = {}) {
  return `${item?.outcomeLabel || item?.outcome || ""}`.trim().toLowerCase();
}

function buildBlockerConditionScorecards(counterfactuals = []) {
  const buckets = new Map();
  for (const item of counterfactuals || []) {
    const reasons = resolveCounterfactualBlockerReasons(item);
    const conditionId = resolveCounterfactualConditionId(item);
    const familyId = resolveCounterfactualStrategyFamily(item);
    const strategyId = resolveCounterfactualStrategyId(item);
    for (const blockerId of reasons) {
      const key = `${blockerId}::${conditionId}::${familyId}::${strategyId}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          id: blockerId,
          conditionId,
          familyId,
          strategyId,
          count: 0,
          marginalCount: 0,
          sharedCount: 0,
          missedWinnerCount: 0,
          marginalMissedWinnerCount: 0,
          sharedMissedWinnerCount: 0,
          goodVetoCount: 0,
          marginalGoodVetoCount: 0,
          sharedGoodVetoCount: 0,
          lateVetoCount: 0,
          averageMovePctSum: 0
        });
      }
      const bucket = buckets.get(key);
      const blockerMode = resolveCounterfactualBlockerMode(item, blockerId);
      bucket.count += 1;
      if (blockerMode === "marginal") {
        bucket.marginalCount += 1;
      } else if (blockerMode === "shared") {
        bucket.sharedCount += 1;
      }
      bucket.averageMovePctSum += item.realizedMovePct || item.bestBranch?.adjustedMovePct || 0;
      if (BAD_VETO_OUTCOMES.has(resolveCounterfactualOutcomeLabel(item))) {
        bucket.missedWinnerCount += 1;
        if (blockerMode === "marginal") {
          bucket.marginalMissedWinnerCount += 1;
        } else if (blockerMode === "shared") {
          bucket.sharedMissedWinnerCount += 1;
        }
      }
      if (GOOD_VETO_OUTCOMES.has(resolveCounterfactualOutcomeLabel(item))) {
        bucket.goodVetoCount += 1;
        if (blockerMode === "marginal") {
          bucket.marginalGoodVetoCount += 1;
        } else if (blockerMode === "shared") {
          bucket.sharedGoodVetoCount += 1;
        }
      }
      if (resolveCounterfactualOutcomeLabel(item) === "late_veto") {
        bucket.lateVetoCount += 1;
      }
    }
  }
  return [...buckets.values()]
    .map((bucket) => {
      const weightedCount = bucket.marginalCount + bucket.sharedCount * 0.55;
      const weightedMissedWinnerCount = bucket.marginalMissedWinnerCount + bucket.sharedMissedWinnerCount * 0.45;
      const weightedGoodVetoCount = bucket.marginalGoodVetoCount + bucket.sharedGoodVetoCount * 0.65;
      const missedWinnerRate = weightedCount ? weightedMissedWinnerCount / weightedCount : 0;
      const goodVetoRate = weightedCount ? weightedGoodVetoCount / weightedCount : 0;
      const lateVetoRate = bucket.count ? bucket.lateVetoCount / bucket.count : 0;
      const averageMovePct = bucket.count ? bucket.averageMovePctSum / bucket.count : 0;
      const confidence = clamp(
        Math.min(0.68, weightedCount / 10) +
        Math.abs(missedWinnerRate - goodVetoRate) * 0.26 +
        lateVetoRate * 0.06,
        0,
        1
      );
      const soften = !HARD_TUNING_BLOCKERS.has(bucket.id) && bucket.count >= 3 && missedWinnerRate >= 0.5 && goodVetoRate <= 0.35;
      const harden = bucket.count >= 3 && goodVetoRate >= 0.62 && missedWinnerRate <= 0.2;
      const action = soften ? "soften" : harden ? "harden" : "observe";
      return {
        id: bucket.id,
        conditionId: bucket.conditionId,
        familyId: bucket.familyId,
        strategyId: bucket.strategyId,
        count: bucket.count,
        marginalCount: bucket.marginalCount,
        sharedCount: bucket.sharedCount,
        missedWinnerCount: bucket.missedWinnerCount,
        marginalMissedWinnerCount: bucket.marginalMissedWinnerCount,
        sharedMissedWinnerCount: bucket.sharedMissedWinnerCount,
        goodVetoCount: bucket.goodVetoCount,
        marginalGoodVetoCount: bucket.marginalGoodVetoCount,
        sharedGoodVetoCount: bucket.sharedGoodVetoCount,
        lateVetoCount: bucket.lateVetoCount,
        weightedCount: num(weightedCount, 4),
        missedWinnerRate: num(missedWinnerRate),
        goodVetoRate: num(goodVetoRate),
        lateVetoRate: num(lateVetoRate),
        averageMovePct: num(averageMovePct),
        confidence: num(confidence),
        action,
        thresholdShift: soften
          ? num(clamp(-0.004 - (missedWinnerRate - 0.5) * 0.018, -0.016, -0.004))
          : harden
            ? num(clamp(0.004 + (goodVetoRate - 0.62) * 0.02, 0.004, 0.016))
            : 0,
        paperProbeEligible: soften,
        shadowPriority: soften && bucket.missedWinnerCount >= 2,
        blockerSofteningRecommendation: soften ? bucket.id : null,
        blockerHardeningRecommendation: harden ? bucket.id : null,
        status: action === "soften"
          ? "priority"
          : action === "harden"
            ? "guarded"
            : bucket.count >= 3
              ? "observe"
              : "warmup"
      };
    })
    .sort((left, right) => (right.confidence || 0) - (left.confidence || 0))
    .slice(0, 12);
}

function buildBlockerScorecards(counterfactuals = []) {
  const map = new Map();
  const getBucket = (id) => {
    const key = id || "no_explicit_blocker";
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        total: 0,
        marginalCount: 0,
        sharedCount: 0,
        goodVetoCount: 0,
        marginalGoodVetoCount: 0,
        sharedGoodVetoCount: 0,
        badVetoCount: 0,
        marginalBadVetoCount: 0,
        sharedBadVetoCount: 0,
        lateVetoCount: 0,
        timingIssueCount: 0,
        moveSum: 0,
        strategyIds: new Set(),
        regimeIds: new Set(),
        phaseIds: new Set()
      });
    }
    return map.get(key);
  };

  for (const item of counterfactuals || []) {
    const reasons = resolveCounterfactualBlockerReasons(item);
    for (const reason of reasons) {
      const bucket = getBucket(reason);
      const blockerMode = resolveCounterfactualBlockerMode(item, reason);
      bucket.total += 1;
      if (blockerMode === "marginal") {
        bucket.marginalCount += 1;
      } else if (blockerMode === "shared") {
        bucket.sharedCount += 1;
      }
      bucket.moveSum += item.realizedMovePct || 0;
      if (GOOD_VETO_OUTCOMES.has(resolveCounterfactualOutcomeLabel(item))) {
        bucket.goodVetoCount += 1;
        if (blockerMode === "marginal") {
          bucket.marginalGoodVetoCount += 1;
        } else if (blockerMode === "shared") {
          bucket.sharedGoodVetoCount += 1;
        }
      } else if (BAD_VETO_OUTCOMES.has(resolveCounterfactualOutcomeLabel(item))) {
        bucket.badVetoCount += 1;
        if (blockerMode === "marginal") {
          bucket.marginalBadVetoCount += 1;
        } else if (blockerMode === "shared") {
          bucket.sharedBadVetoCount += 1;
        }
      } else if (resolveCounterfactualOutcomeLabel(item) === "late_veto") {
        bucket.lateVetoCount += 1;
      } else if (["right_direction_wrong_timing", "quality_trap"].includes(resolveCounterfactualOutcomeLabel(item))) {
        bucket.timingIssueCount += 1;
      }
      if (item.strategy || item.strategyAtEntry) {
        bucket.strategyIds.add(item.strategy || item.strategyAtEntry);
      }
      if (item.regime || item.regimeAtEntry) {
        bucket.regimeIds.add(item.regime || item.regimeAtEntry);
      }
      if (item.marketPhase) {
        bucket.phaseIds.add(item.marketPhase);
      }
    }
  }

  return [...map.values()]
    .map((bucket) => {
      const weightedTotal = bucket.marginalCount + bucket.sharedCount * 0.55;
      const weightedGoodVetoCount = bucket.marginalGoodVetoCount + bucket.sharedGoodVetoCount * 0.65;
      const weightedBadVetoCount = bucket.marginalBadVetoCount + bucket.sharedBadVetoCount * 0.45;
      const goodVetoRate = bucket.total ? bucket.goodVetoCount / bucket.total : 0;
      const badVetoRate = bucket.total ? bucket.badVetoCount / bucket.total : 0;
      const weightedGoodVetoRate = weightedTotal ? weightedGoodVetoCount / weightedTotal : goodVetoRate;
      const weightedBadVetoRate = weightedTotal ? weightedBadVetoCount / weightedTotal : badVetoRate;
      const lateVetoRate = bucket.total ? bucket.lateVetoCount / bucket.total : 0;
      const timingIssueRate = bucket.total ? bucket.timingIssueCount / bucket.total : 0;
      const averageMovePct = bucket.total ? bucket.moveSum / bucket.total : 0;
      const governanceScore = clamp(
        0.5 +
          weightedGoodVetoRate * 0.24 -
          weightedBadVetoRate * 0.28 -
          lateVetoRate * 0.12 -
          timingIssueRate * 0.08 -
          Math.max(0, averageMovePct) * 4.5,
        0,
        1
      );
      return {
        id: bucket.id,
        total: bucket.total,
        marginalCount: bucket.marginalCount,
        sharedCount: bucket.sharedCount,
        goodVetoCount: bucket.goodVetoCount,
        marginalGoodVetoCount: bucket.marginalGoodVetoCount,
        sharedGoodVetoCount: bucket.sharedGoodVetoCount,
        badVetoCount: bucket.badVetoCount,
        marginalBadVetoCount: bucket.marginalBadVetoCount,
        sharedBadVetoCount: bucket.sharedBadVetoCount,
        lateVetoCount: bucket.lateVetoCount,
        timingIssueCount: bucket.timingIssueCount,
        goodVetoRate: num(goodVetoRate),
        badVetoRate: num(badVetoRate),
        weightedGoodVetoRate: num(weightedGoodVetoRate),
        weightedBadVetoRate: num(weightedBadVetoRate),
        lateVetoRate: num(lateVetoRate),
        timingIssueRate: num(timingIssueRate),
        averageMovePct: num(averageMovePct),
        governanceScore: num(governanceScore),
        affectedStrategies: [...bucket.strategyIds].slice(0, 4),
        affectedRegimes: [...bucket.regimeIds].slice(0, 4),
        affectedPhases: [...bucket.phaseIds].slice(0, 4),
        status: weightedBadVetoRate >= 0.45 && weightedBadVetoCount >= 2
          ? "relax"
          : weightedGoodVetoRate >= 0.55 && weightedGoodVetoCount >= 2
            ? "keep"
            : "observe"
      };
    })
    .sort((left, right) => {
      const badEdge = (right.weightedBadVetoRate || 0) - (left.weightedBadVetoRate || 0);
      return Math.abs(badEdge) > 0.001 ? badEdge : right.total - left.total;
    })
    .slice(0, 10);
}

function correlation(values = [], outcomes = []) {
  const length = Math.min(values.length, outcomes.length);
  if (length < 3) {
    return 0;
  }
  const x = values.slice(-length);
  const y = outcomes.slice(-length);
  const meanX = average(x);
  const meanY = average(y);
  let numerator = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < length; index += 1) {
    const dx = x[index] - meanX;
    const dy = y[index] - meanY;
    numerator += dx * dy;
    varianceX += dx ** 2;
    varianceY += dy ** 2;
  }
  if (!varianceX || !varianceY) {
    return 0;
  }
  return clamp(numerator / Math.sqrt(varianceX * varianceY), -1, 1);
}

function buildThresholdPolicy(blockerScorecards = [], config = {}) {
  const recommendations = blockerScorecards
    .filter((item) => (item.total || 0) >= 2)
    .map((item) => {
      const relaxSignal = item.weightedBadVetoRate ?? item.badVetoRate ?? 0;
      const tightenSignal = item.weightedGoodVetoRate ?? item.goodVetoRate ?? 0;
      const action = item.status === "relax"
        ? "relax"
        : item.status === "keep" && tightenSignal >= 0.58
          ? "tighten"
          : "observe";
      const baseStep = action === "relax"
        ? config.thresholdRelaxStep || 0.012
        : config.thresholdTightenStep || 0.01;
      const signalStrength = Math.max(relaxSignal, tightenSignal);
      const adjustment = action === "observe"
        ? 0
        : (action === "relax" ? -1 : 1) * Math.min(baseStep, Math.max(baseStep * 0.4, signalStrength * baseStep));
      const confidence = clamp(
        Math.min(1, (item.total || 0) / 8) * 0.44 +
          Math.abs(relaxSignal - tightenSignal) * 0.56,
        0,
        1
      );
      return {
        id: item.id,
        action,
        adjustment: num(adjustment),
        confidence: num(confidence),
        total: item.total || 0,
        affectedStrategies: [...(item.affectedStrategies || [])].slice(0, 4),
        affectedRegimes: [...(item.affectedRegimes || [])].slice(0, 4),
        rationale: action === "relax"
          ? `${item.id} blokkeert te vaak gemiste winnaars.`
          : action === "tighten"
            ? `${item.id} veto is meestal correct en mag iets zwaarder wegen.`
            : `${item.id} heeft nog te weinig overtuigende feedback voor een threshold-wijziging.`
      };
    })
    .filter((item) => item.action !== "observe")
    .sort((left, right) => {
      const confidenceDelta = (right.confidence || 0) - (left.confidence || 0);
      return Math.abs(confidenceDelta) > 0.001
        ? confidenceDelta
        : Math.abs(right.adjustment || 0) - Math.abs(left.adjustment || 0);
    })
    .slice(0, config.thresholdTuningMaxRecommendations || 5);

  const relaxCount = recommendations.filter((item) => item.action === "relax").length;
  const tightenCount = recommendations.filter((item) => item.action === "tighten").length;
  const netThresholdShift = clamp(
    recommendations.reduce((total, item) => total + (item.adjustment || 0), 0),
    -0.06,
    0.06
  );
  const adjustThreshold = Math.max(
    0.004,
    Math.min(config.thresholdRelaxStep || 0.012, config.thresholdTightenStep || 0.01) * 0.55
  );
  const status = recommendations.length === 0
    ? "stable"
    : Math.abs(netThresholdShift) >= adjustThreshold
      ? "adjust"
      : "observe";

  return {
    status,
    relaxCount,
    tightenCount,
    netThresholdShift: num(netThresholdShift),
    topRecommendation: recommendations[0] || null,
    recommendations,
    notes: [
      recommendations[0]
        ? `${recommendations[0].id} is de sterkste threshold-kandidaat (${recommendations[0].action}).`
        : "Thresholds blijven stabiel; er is nog geen duidelijke veto-aanpassing nodig.",
      relaxCount
        ? `${relaxCount} veto-blokkers vragen een lossere gate.`
        : "Geen veto-blokkers vragen nu om een lossere gate.",
      tightenCount
        ? `${tightenCount} veto-blokkers mogen juist strakker worden bewaakt.`
        : "Geen veto-blokkers vragen nu om een strakkere gate."
    ]
  };
}

function resolvePaperLearningOutcomeId(trade = {}) {
  if (trade.paperLearningOutcome?.outcome) {
    return trade.paperLearningOutcome.outcome;
  }
  if ((trade.pnlQuote || 0) > 0 && (trade.captureEfficiency || 0) >= 0.5) {
    return "good_trade";
  }
  if ((trade.pnlQuote || 0) > 0) {
    return "acceptable_trade";
  }
  if ((trade.mfePct || 0) >= 0.018 && (trade.captureEfficiency || 0) < 0.32) {
    return "early_exit";
  }
  if ((trade.maePct || 0) <= -0.02 && ["time_stop", "manual_exit", "stop_loss"].includes(trade.reason || "")) {
    return "late_exit";
  }
  if ((trade.executionQualityScore || 0) < 0.42) {
    return "execution_drag";
  }
  return "bad_trade";
}

function isQualityTrapTrade(trade = {}) {
  return (trade.captureEfficiency || 0) < 0.25 && (trade.mfePct || 0) > 0.012;
}

function buildScopedOutcomeLearningScorecards(trades = [], counterfactuals = [], keyFn = null, scopeType = "scope") {
  const buckets = new Map();
  const ensureBucket = (id) => {
    const bucketId = id || `unknown_${scopeType}`;
    if (!buckets.has(bucketId)) {
      buckets.set(bucketId, {
        id: bucketId,
        tradeCount: 0,
        counterfactualCount: 0,
        goodTradeCount: 0,
        acceptableTradeCount: 0,
        badTradeCount: 0,
        earlyExitCount: 0,
        lateExitCount: 0,
        executionDragCount: 0,
        qualityTrapCount: 0,
        badVetoCount: 0,
        goodVetoCount: 0,
        moveSum: 0,
        pnlSum: 0,
        latestAt: null
      });
    }
    return buckets.get(bucketId);
  };

  for (const trade of trades) {
    const bucket = ensureBucket(keyFn ? keyFn(trade) : null);
    const outcome = resolvePaperLearningOutcomeId(trade);
    bucket.tradeCount += 1;
    bucket.pnlSum += trade.pnlQuote || 0;
    bucket.moveSum += trade.netPnlPct || 0;
    const latestAt = trade.exitAt || trade.entryAt || null;
    if (latestAt && (!bucket.latestAt || latestAt > bucket.latestAt)) {
      bucket.latestAt = latestAt;
    }
    if (outcome === "good_trade") {
      bucket.goodTradeCount += 1;
    } else if (outcome === "acceptable_trade") {
      bucket.acceptableTradeCount += 1;
    } else if (outcome === "bad_trade") {
      bucket.badTradeCount += 1;
    } else if (outcome === "early_exit") {
      bucket.earlyExitCount += 1;
    } else if (outcome === "late_exit") {
      bucket.lateExitCount += 1;
    } else if (outcome === "execution_drag") {
      bucket.executionDragCount += 1;
    }
    if ((trade.executionQualityScore || 0) < 0.42 && (trade.pnlQuote || 0) <= 0) {
      bucket.executionDragCount += 1;
    }
    if (isQualityTrapTrade(trade)) {
      bucket.qualityTrapCount += 1;
    }
  }

  for (const item of counterfactuals) {
    const bucket = ensureBucket(keyFn ? keyFn(item) : null);
    bucket.counterfactualCount += 1;
    bucket.moveSum += item.realizedMovePct || item.bestBranch?.adjustedMovePct || 0;
    if (BAD_VETO_OUTCOMES.has(resolveCounterfactualOutcomeLabel(item))) {
      bucket.badVetoCount += 1;
    }
    if (GOOD_VETO_OUTCOMES.has(resolveCounterfactualOutcomeLabel(item))) {
      bucket.goodVetoCount += 1;
    }
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.tradeCount + bucket.counterfactualCount >= 2)
    .map((bucket) => {
      const tradeCount = Math.max(bucket.tradeCount, 1);
      const counterfactualCount = Math.max(bucket.counterfactualCount, 1);
      const goodTradeRate = bucket.tradeCount ? bucket.goodTradeCount / tradeCount : 0;
      const acceptableTradeRate = bucket.tradeCount ? bucket.acceptableTradeCount / tradeCount : 0;
      const weakTradeRate = bucket.tradeCount
        ? (bucket.badTradeCount + bucket.earlyExitCount + bucket.lateExitCount + bucket.executionDragCount) / tradeCount
        : 0;
      const earlyExitRate = bucket.tradeCount ? bucket.earlyExitCount / tradeCount : 0;
      const lateExitRate = bucket.tradeCount ? bucket.lateExitCount / tradeCount : 0;
      const executionDragRate = bucket.tradeCount ? bucket.executionDragCount / tradeCount : 0;
      const qualityTrapRate = bucket.tradeCount ? bucket.qualityTrapCount / tradeCount : 0;
      const badVetoRate = bucket.counterfactualCount ? bucket.badVetoCount / counterfactualCount : 0;
      const goodVetoRate = bucket.counterfactualCount ? bucket.goodVetoCount / counterfactualCount : 0;
      const relaxPressure =
        badVetoRate * 0.95 +
        goodTradeRate * 0.5 +
        acceptableTradeRate * 0.22;
      const tightenPressure =
        weakTradeRate * 0.78 +
        qualityTrapRate * 0.7 +
        executionDragRate * 0.62 +
        earlyExitRate * 0.26 +
        lateExitRate * 0.34 +
        goodVetoRate * 0.74;
      const thresholdShift = clamp((tightenPressure - relaxPressure) * 0.014, -0.018, 0.018);
      const sizeMultiplier = clamp(
        1 +
          goodTradeRate * 0.05 +
          acceptableTradeRate * 0.02 +
          badVetoRate * 0.02 -
          weakTradeRate * 0.08 -
          executionDragRate * 0.12 -
          qualityTrapRate * 0.1 -
          earlyExitRate * 0.04 -
          lateExitRate * 0.05,
        0.82,
        1.08
      );
      const cautionPenalty = clamp(
        goodVetoRate * 0.06 +
          weakTradeRate * 0.08 +
          executionDragRate * 0.1 +
          qualityTrapRate * 0.1 +
          earlyExitRate * 0.05 +
          lateExitRate * 0.04 -
          badVetoRate * 0.04 -
          goodTradeRate * 0.03,
        0,
        0.14
      );
      const confidence = clamp(
        Math.min(1, (bucket.tradeCount + bucket.counterfactualCount) / 10) * 0.52 +
          Math.abs(relaxPressure - tightenPressure) * 0.48,
        0,
        1
      );
      const status = confidence >= 0.58 && thresholdShift <= -0.006
        ? "relax"
        : confidence >= 0.58 && (thresholdShift >= 0.006 || sizeMultiplier <= 0.94 || cautionPenalty >= 0.06)
          ? "tighten"
          : "observe";
      const note = badVetoRate >= 0.26
        ? `${bucket.id} laat relatief veel bad-veto druk zien.`
        : qualityTrapRate >= 0.24
          ? `${bucket.id} toont opvallend veel quality traps.`
          : executionDragRate >= 0.24
            ? `${bucket.id} verliest te veel via execution drag.`
            : earlyExitRate >= 0.24
              ? `${bucket.id} heeft te veel vroege exits.`
              : goodTradeRate >= 0.52
                ? `${bucket.id} levert stabiel goede paper outcomes.`
                : `${bucket.id} bouwt nog outcome-feedback op.`;
      return {
        id: bucket.id,
        scopeType,
        tradeCount: bucket.tradeCount,
        counterfactualCount: bucket.counterfactualCount,
        goodTradeCount: bucket.goodTradeCount,
        acceptableTradeCount: bucket.acceptableTradeCount,
        badTradeCount: bucket.badTradeCount,
        earlyExitCount: bucket.earlyExitCount,
        lateExitCount: bucket.lateExitCount,
        executionDragCount: bucket.executionDragCount,
        qualityTrapCount: bucket.qualityTrapCount,
        badVetoCount: bucket.badVetoCount,
        goodVetoCount: bucket.goodVetoCount,
        goodTradeRate: num(goodTradeRate),
        acceptableTradeRate: num(acceptableTradeRate),
        weakTradeRate: num(weakTradeRate),
        earlyExitRate: num(earlyExitRate),
        lateExitRate: num(lateExitRate),
        executionDragRate: num(executionDragRate),
        qualityTrapRate: num(qualityTrapRate),
        badVetoRate: num(badVetoRate),
        goodVetoRate: num(goodVetoRate),
        thresholdShift: num(thresholdShift),
        sizeMultiplier: num(sizeMultiplier),
        cautionPenalty: num(cautionPenalty),
        confidence: num(confidence),
        averageMovePct: num((bucket.tradeCount + bucket.counterfactualCount) ? bucket.moveSum / Math.max(bucket.tradeCount + bucket.counterfactualCount, 1) : 0),
        realizedPnl: num(bucket.pnlSum, 2),
        status,
        latestAt: bucket.latestAt || null,
        note
      };
    })
    .sort((left, right) => {
      const severityDelta =
        (Math.abs(right.thresholdShift || 0) + Math.abs(1 - (right.sizeMultiplier || 1)) + (right.cautionPenalty || 0)) -
        (Math.abs(left.thresholdShift || 0) + Math.abs(1 - (left.sizeMultiplier || 1)) + (left.cautionPenalty || 0));
      return Math.abs(severityDelta) > 0.001
        ? severityDelta
        : (right.confidence || 0) - (left.confidence || 0);
    })
    .slice(0, 8);
}

function buildOutcomeScopeScorecards(trades = [], counterfactuals = []) {
  const family = buildScopedOutcomeLearningScorecards(
    trades,
    counterfactuals,
    (item) => resolveTradeStrategyFamily(item),
    "family"
  );
  const regime = buildScopedOutcomeLearningScorecards(
    trades,
    counterfactuals,
    (item) => item.regimeAtEntry || item.regime || item.entryRationale?.regimeSummary?.regime || "unknown",
    "regime"
  );
  const session = buildScopedOutcomeLearningScorecards(
    trades,
    counterfactuals,
    (item) => resolveTradeSessionId(item),
    "session"
  );
  const condition = buildScopedOutcomeLearningScorecards(
    trades,
    counterfactuals,
    (item) => resolveTradeConditionId(item),
    "condition"
  );
  const topActionable = [...family, ...regime, ...session, ...condition]
    .sort((left, right) => {
      const leftSeverity = Math.abs(left.thresholdShift || 0) + Math.abs(1 - (left.sizeMultiplier || 1)) + (left.cautionPenalty || 0);
      const rightSeverity = Math.abs(right.thresholdShift || 0) + Math.abs(1 - (right.sizeMultiplier || 1)) + (right.cautionPenalty || 0);
      return rightSeverity - leftSeverity || (right.confidence || 0) - (left.confidence || 0);
    })[0] || null;
  const status = topActionable
    ? topActionable.status === "relax" || topActionable.status === "tighten"
      ? "active"
      : "observe"
    : "warmup";
  return {
    status,
    topActionable,
    family,
    regime,
    session,
    condition,
    notes: [
      topActionable
        ? `${topActionable.scopeType}:${topActionable.id} heeft nu de sterkste outcome-gestuurde runtime bias.`
        : "Nog te weinig outcome-data voor scope-level runtime guidance.",
      topActionable?.badVetoRate >= 0.24
        ? "Counterfactual bad-veto feedback duwt nu direct mee op thresholding."
        : topActionable?.executionDragRate >= 0.2 || topActionable?.qualityTrapRate >= 0.2
          ? "Execution drag of quality traps remmen nu direct sizing en caution."
          : "Outcome-feedback blijft voorlopig vooral observerend."
    ]
  };
}

function buildExitLearning(trades = []) {
  const map = new Map();
  let prematureExitCount = 0;
  let lateExitCount = 0;
  const exitScores = [];

  for (const trade of trades) {
    const reason = trade.reason || "unknown";
    if (!map.has(reason)) {
      map.set(reason, {
        id: reason,
        tradeCount: 0,
        avgExitScore: 0,
        prematureExitCount: 0,
        lateExitCount: 0,
        realizedPnl: 0,
        averageCapture: 0
      });
    }
    const bucket = map.get(reason);
    const mfePct = Math.max(0, trade.mfePct || 0);
    const captureRatio = mfePct > 0 ? clamp((trade.netPnlPct || 0) / mfePct, -1, 1.4) : (trade.netPnlPct || 0) > 0 ? 0.65 : 0.45;
    const prematureExit = (trade.netPnlPct || 0) > 0 && mfePct >= 0.012 && captureRatio < 0.42;
    const lateExit = (trade.netPnlPct || 0) <= 0 && mfePct >= 0.012 && captureRatio < 0.08;
    const exitScore = clamp(
      0.4 +
        Math.max(0, Math.min(captureRatio, 1)) * 0.28 +
        (trade.captureEfficiency || 0) * 0.16 +
        (trade.executionQualityScore || 0) * 0.14 +
        ((trade.exitIntelligenceSummary?.confidence || 0) * 0.08) -
        (prematureExit ? 0.12 : 0) -
        (lateExit ? 0.18 : 0),
      0,
      1
    );

    bucket.tradeCount += 1;
    bucket.avgExitScore += exitScore;
    bucket.realizedPnl += trade.pnlQuote || 0;
    bucket.averageCapture += trade.captureEfficiency || Math.max(0, captureRatio);
    if (prematureExit) {
      bucket.prematureExitCount += 1;
      prematureExitCount += 1;
    }
    if (lateExit) {
      bucket.lateExitCount += 1;
      lateExitCount += 1;
    }
    exitScores.push(exitScore);
  }

  const exitScorecards = [...map.values()]
    .map((bucket) => {
      const avgExitScore = bucket.tradeCount ? bucket.avgExitScore / bucket.tradeCount : 0;
      const averageCapture = bucket.tradeCount ? bucket.averageCapture / bucket.tradeCount : 0;
      const governanceScore = clamp(
        avgExitScore * 0.6 +
          clamp(0.5 + bucket.realizedPnl / Math.max(bucket.tradeCount * 60, 60), 0, 1) * 0.18 +
          averageCapture * 0.12 -
          Math.min(0.18, bucket.prematureExitCount / Math.max(bucket.tradeCount, 1) * 0.18) -
          Math.min(0.22, bucket.lateExitCount / Math.max(bucket.tradeCount, 1) * 0.22),
        0,
        1
      );
      return {
        id: bucket.id,
        tradeCount: bucket.tradeCount,
        averageExitScore: num(avgExitScore),
        averageCapture: num(averageCapture),
        realizedPnl: num(bucket.realizedPnl, 2),
        prematureExitCount: bucket.prematureExitCount,
        lateExitCount: bucket.lateExitCount,
        governanceScore: num(governanceScore),
        status: governanceScore >= 0.62
          ? "ready"
          : governanceScore <= 0.42
            ? "blocked"
            : "observe"
      };
    })
    .sort((left, right) => right.governanceScore - left.governanceScore)
    .slice(0, 8);

  const averageExitScore = average(exitScores);
  const status = averageExitScore >= 0.58 && lateExitCount <= Math.max(1, Math.round(trades.length * 0.28))
    ? "ready"
    : averageExitScore >= 0.46
      ? "observe"
      : "blocked";

  return {
    status,
    averageExitScore: num(averageExitScore),
    prematureExitCount,
    lateExitCount,
    topReason: exitScorecards[0]?.id || null,
    scorecards: exitScorecards,
    strategyPolicies: buildScopedExitPolicies(trades, (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown"),
    regimePolicies: buildScopedExitPolicies(trades, (trade) => trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown"),
    conditionPolicies: buildExitConditionScorecards(trades),
    notes: [
      exitScorecards[0]
        ? `${exitScorecards[0].id} is momenteel de sterkste exit-route.`
        : "Nog geen exit-scorecards beschikbaar.",
      lateExitCount
        ? `${lateExitCount} exits gaven winst terug en verdienen strakkere follow-through.`
        : "Geen duidelijke late-exit patronen in de huidige set.",
      prematureExitCount
        ? `${prematureExitCount} exits waren waarschijnlijk te vroeg.`
        : "Geen duidelijke premature exits in de huidige set."
    ]
  };
}

function buildScopedExitPolicies(trades = [], keyFn = null) {
  const map = new Map();
  for (const trade of trades) {
    const id = (keyFn ? keyFn(trade) : "unknown") || "unknown";
    if (!map.has(id)) {
      map.set(id, {
        id,
        tradeCount: 0,
        prematureExitCount: 0,
        lateExitCount: 0,
        captureSum: 0
      });
    }
    const bucket = map.get(id);
    const mfePct = Math.max(0, trade.mfePct || 0);
    const captureRatio = mfePct > 0 ? clamp((trade.netPnlPct || 0) / mfePct, -1, 1.4) : (trade.netPnlPct || 0) > 0 ? 0.65 : 0.45;
    const prematureExit = (trade.netPnlPct || 0) > 0 && mfePct >= 0.012 && captureRatio < 0.42;
    const lateExit = (trade.netPnlPct || 0) <= 0 && mfePct >= 0.012 && captureRatio < 0.08;
    bucket.tradeCount += 1;
    bucket.captureSum += Math.max(0, captureRatio);
    if (prematureExit) {
      bucket.prematureExitCount += 1;
    }
    if (lateExit) {
      bucket.lateExitCount += 1;
    }
  }

  return [...map.values()]
    .filter((bucket) => bucket.tradeCount >= 2)
    .map((bucket) => {
      const prematureRate = bucket.tradeCount ? bucket.prematureExitCount / bucket.tradeCount : 0;
      const lateRate = bucket.tradeCount ? bucket.lateExitCount / bucket.tradeCount : 0;
      const lateBiased = lateRate > prematureRate + 0.05;
      const prematureBiased = prematureRate > lateRate + 0.05;
      return {
        id: bucket.id,
        tradeCount: bucket.tradeCount,
        prematureExitCount: bucket.prematureExitCount,
        lateExitCount: bucket.lateExitCount,
        averageCapture: num(bucket.captureSum / Math.max(bucket.tradeCount, 1)),
        scaleOutFractionMultiplier: num(lateBiased ? 1.08 : prematureBiased ? 0.92 : 1),
        scaleOutTriggerMultiplier: num(lateBiased ? 0.94 : prematureBiased ? 1.08 : 1),
        trailingStopMultiplier: num(lateBiased ? 0.9 : prematureBiased ? 1.08 : 1),
        maxHoldMinutesMultiplier: num(lateBiased ? 0.84 : prematureBiased ? 1.08 : 1),
        status: lateBiased
          ? "tighten"
          : prematureBiased
            ? "widen"
            : "balanced"
      };
    })
    .sort((left, right) => (right.tradeCount || 0) - (left.tradeCount || 0))
    .slice(0, 8);
}

function buildExitConditionScorecards(trades = []) {
  return buildScopedExitPolicies(
    trades,
    (trade) => `${resolveTradeConditionId(trade)}::${resolveTradeStrategyFamily(trade)}`
  ).map((item) => {
    const [conditionId, familyId] = String(item.id || "").split("::");
    const averageCapture = safeNumber(item.averageCapture, 0);
    const preferredExitStyle = item.status === "tighten"
      ? "trim_or_trail"
      : item.status === "widen"
        ? "hold_winner"
        : "balanced";
    return {
      ...item,
      conditionId: conditionId || null,
      familyId: familyId || null,
      preferredExitStyle,
      trailTightnessBias: num(item.status === "tighten" ? 0.12 : item.status === "widen" ? -0.08 : 0),
      trimBias: num(item.status === "tighten" ? 0.1 : item.status === "widen" ? -0.06 : 0),
      holdTolerance: num(item.status === "widen" ? 0.12 : item.status === "tighten" ? -0.08 : 0),
      maxHoldBias: num(item.status === "widen" ? 0.08 : item.status === "tighten" ? -0.1 : 0),
      expectancyHint: num(clamp((averageCapture - 0.5) * 0.8, -0.2, 0.2))
    };
  });
}

function buildMissedTradeTuning(blockerConditionScorecards = []) {
  const ranked = [...blockerConditionScorecards].sort((left, right) => {
    const actionDelta = Number(right.action !== "observe") - Number(left.action !== "observe");
    if (actionDelta !== 0) {
      return actionDelta;
    }
    const strategyDelta = Number(Boolean(right.strategyId)) - Number(Boolean(left.strategyId));
    if (strategyDelta !== 0) {
      return strategyDelta;
    }
    return (right.confidence || 0) - (left.confidence || 0);
  });
  const top = ranked.find((item) => item.action !== "observe") || ranked[0] || null;
  if (!top) {
    return {
      status: "warmup",
      topBlocker: null,
      action: "observe",
      confidence: 0,
      scope: null,
      thresholdShift: 0,
      paperProbeEligible: false,
      shadowPriority: false,
      blockerSofteningRecommendation: null,
      blockerHardeningRecommendation: null,
      note: "Nog geen condition-specifieke missed-trade tuning zichtbaar."
    };
  }
  return {
    status: top.action === "soften" ? "priority" : top.action === "harden" ? "guarded" : "observe",
    topBlocker: top.id,
    action: top.action,
    confidence: num(top.confidence || 0, 4),
    scope: {
      conditionId: top.conditionId || null,
      familyId: top.familyId || null,
      strategyId: top.strategyId || null
    },
    thresholdShift: num(top.thresholdShift || 0, 4),
    paperProbeEligible: Boolean(top.paperProbeEligible),
    shadowPriority: Boolean(top.shadowPriority),
    blockerSofteningRecommendation: top.blockerSofteningRecommendation || null,
    blockerHardeningRecommendation: top.blockerHardeningRecommendation || null,
    note: top.action === "soften"
      ? `${top.id} lijkt te streng binnen ${top.conditionId}/${top.familyId}${top.strategyId ? `/${top.strategyId}` : ""}.`
      : top.action === "harden"
        ? `${top.id} blokkeert meestal terecht binnen ${top.conditionId}/${top.familyId}${top.strategyId ? `/${top.strategyId}` : ""}.`
        : `${top.id} wordt gevolgd binnen ${top.conditionId}/${top.familyId}${top.strategyId ? `/${top.strategyId}` : ""}.`
  };
}

function buildPolicyTransitionCandidatesByCondition(
  conditionStrategyScorecards = [],
  blockerConditionScorecards = [],
  conditionFamilyScorecards = [],
  exitConditionScorecards = []
) {
  const blockerByScope = new Map();
  for (const item of blockerConditionScorecards) {
    blockerByScope.set(`${item.conditionId}::${item.familyId}::${item.strategyId || "unknown_strategy"}`, item);
    if (!blockerByScope.has(`${item.conditionId}::${item.familyId}`)) {
      blockerByScope.set(`${item.conditionId}::${item.familyId}`, item);
    }
  }
  const familyByScope = new Map(
    conditionFamilyScorecards.map((item) => [`${item.conditionId}::${item.familyId}`, item])
  );
  const exitByScope = new Map(
    exitConditionScorecards.map((item) => [`${item.conditionId}::${item.familyId}`, item])
  );
  const strategyAggregate = new Map();
  for (const item of conditionStrategyScorecards) {
    const key = item.strategyId || "unknown_strategy";
    if (!strategyAggregate.has(key)) {
        strategyAggregate.set(key, {
          strategyId: key,
          familyId: item.familyId || null,
          conditionCount: 0,
          stableConditionCount: 0,
          supportiveConditionCount: 0,
          weakConditionCount: 0,
          falseSignalCount: 0,
          totalGovernance: 0
        });
      }
      const bucket = strategyAggregate.get(key);
      bucket.conditionCount += 1;
      bucket.totalGovernance += safeNumber(item.governanceScore, 0);
      const lowFalsePositivePressure = (item.falsePositiveRate || 0) <= 0.18;
      if ((item.governanceScore || 0) >= 0.62 && item.status === "prime") {
        bucket.stableConditionCount += 1;
      }
      if ((item.governanceScore || 0) >= 0.68 && ["prime", "observe"].includes(item.status) && lowFalsePositivePressure) {
        bucket.supportiveConditionCount += 1;
      }
      if (item.status === "cooldown" || (item.governanceScore || 0) <= 0.4) {
        bucket.weakConditionCount += 1;
      }
    if ((item.falsePositiveRate || 0) >= 0.26) {
      bucket.falseSignalCount += 1;
    }
  }
  return conditionStrategyScorecards
    .filter((item) => (item.tradeCount || 0) >= 3)
    .map((item) => {
      const familyId = item.familyId || null;
      const blocker = blockerByScope.get(`${item.conditionId}::${familyId}::${item.strategyId || "unknown_strategy"}`) ||
        blockerByScope.get(`${item.conditionId}::${familyId}`) ||
        null;
      const familyScope = familyByScope.get(`${item.conditionId}::${familyId}`) || null;
      const exitScope = exitByScope.get(`${item.conditionId}::${familyId}`) || null;
      const aggregate = strategyAggregate.get(item.strategyId || "unknown_strategy") || {};
      const averageGovernance = aggregate.conditionCount
        ? safeNumber(aggregate.totalGovernance, 0) / Math.max(aggregate.conditionCount, 1)
        : safeNumber(item.governanceScore, 0);
      let action = "observe";
      if (
        Math.max(aggregate.stableConditionCount || 0, aggregate.supportiveConditionCount || 0) >= 2 &&
        averageGovernance >= 0.72 &&
        (item.falsePositiveRate || 0) <= 0.16 &&
        (familyScope?.governanceScore || 0) >= 0.58 &&
        (exitScope?.tradeCount || 0) >= 2
      ) {
        action = "guarded_live_candidate";
      } else if (
        Math.max(aggregate.stableConditionCount || 0, aggregate.supportiveConditionCount || 0) >= 1 &&
        averageGovernance >= 0.66 &&
        (item.falsePositiveRate || 0) <= 0.18
      ) {
        action = "paper_ready";
      } else if (item.status === "prime" && (item.falsePositiveRate || 0) <= 0.2) {
        action = "promote_candidate";
      } else if (item.status === "cooldown" && aggregate.weakConditionCount >= 2 && blocker?.action === "harden") {
        action = "retire_candidate";
      } else if (item.status === "cooldown") {
        action = "cooldown_candidate";
      } else if ((item.falseNegativeRate || 0) >= 0.34 && blocker?.action === "soften") {
        action = aggregate.stableConditionCount >= 1 ? "priority_probe" : "probe_only";
      } else if ((item.falsePositiveRate || 0) >= 0.28) {
        action = "shadow_only";
      }
      return {
        id: item.strategyId,
        conditionId: item.conditionId,
        strategyId: item.strategyId,
        familyId,
        action,
        confidence: num(clamp(
          (item.governanceScore || 0) * 0.52 +
          Math.min(0.24, (item.tradeCount || 0) / 14) +
          Math.max(0, safeNumber(blocker?.confidence, 0) - 0.5) * 0.18 +
          Math.max(0, safeNumber(exitScope?.averageCapture, 0) - 0.5) * 0.12 +
          Math.min(0.16, safeNumber(aggregate.stableConditionCount, 0) * 0.06),
          0,
          1
        )),
        scope: `${item.conditionId} | ${item.strategyId}`,
        conditionCount: aggregate.conditionCount || 1,
        stableConditionCount: aggregate.stableConditionCount || 0,
        supportiveConditionCount: aggregate.supportiveConditionCount || 0,
        weakConditionCount: aggregate.weakConditionCount || 0,
        preferredExitStyle: exitScope?.preferredExitStyle || "balanced",
        reason: action === "guarded_live_candidate"
          ? `${item.strategyId} blijft sterk over meerdere condities en heeft ${exitScope?.preferredExitStyle || "balanced"} exit-evidence voor guarded live bewijs.`
          : action === "paper_ready"
            ? `${item.strategyId} oogt stabiel genoeg om paper-first breder te draaien binnen ${item.conditionId}.`
          : action === "promote_candidate"
          ? `${item.strategyId} presteert stabiel binnen ${item.conditionId}.`
          : action === "cooldown_candidate"
            ? `${item.strategyId} blijft zwak binnen ${item.conditionId}.`
            : action === "retire_candidate"
              ? `${item.strategyId} faalt herhaald binnen meerdere condities en vraagt retirement review.`
            : action === "priority_probe"
              ? `${item.strategyId} mist nog scopebewijs, maar verdient prioritaire probes binnen ${item.conditionId}.`
            : action === "probe_only"
              ? `${item.strategyId} blijft leerzaam binnen ${item.conditionId}, maar nog niet rijp voor brede exposure.`
              : action === "shadow_only"
                ? `${item.strategyId} vraagt eerst extra schaduwevidence binnen ${item.conditionId}.`
                : `${item.strategyId} wordt voorlopig gemonitord binnen ${item.conditionId}.`
      };
    })
    .filter((item) => item.action !== "observe")
    .sort((left, right) => (right.confidence || 0) - (left.confidence || 0))
    .slice(0, 8);
}

function buildFeatureDecay(trades = [], config = {}) {
  const buckets = new Map();
  for (const trade of trades) {
    const rawFeatures = trade.rawFeatures || {};
    const outcome = Number.isFinite(trade.labelScore)
      ? trade.labelScore
      : clamp(0.5 + (trade.netPnlPct || 0) * 12, 0, 1);
    for (const [key, value] of Object.entries(rawFeatures)) {
      if (!Number.isFinite(value)) {
        continue;
      }
      if (!buckets.has(key)) {
        buckets.set(key, { id: key, values: [], outcomes: [] });
      }
      const bucket = buckets.get(key);
      bucket.values.push(Number(value));
      bucket.outcomes.push(outcome);
    }
  }

  const minTrades = config.featureDecayMinTrades || 8;
  const weakScore = config.featureDecayWeakScore || 0.18;
  const blockedScore = config.featureDecayBlockedScore || 0.1;
  const scorecards = [...buckets.values()]
    .filter((bucket) => bucket.values.length >= minTrades)
    .map((bucket) => {
      const predictiveScore = Math.abs(correlation(bucket.values, bucket.outcomes));
      const half = Math.max(1, Math.floor(bucket.values.length / 2));
      const earlierMean = average(bucket.values.slice(0, half));
      const recentMean = average(bucket.values.slice(-half));
      const meanShift = Math.abs(recentMean - earlierMean);
      const group = featureGroup(bucket.id);
      const supportFeature = isSupportFeature(bucket.id, group);
      const sampleConfidence = buildSampleConfidence(bucket.values.length, minTrades);
      const lowPredictivePressure = clamp((Math.max(blockedScore, 0.0001) - predictiveScore) / Math.max(blockedScore, 0.0001), 0, 1);
      const driftPressure = clamp(meanShift / (supportFeature ? 0.28 : 0.2), 0, 1);
      const decayEvidenceConfidence = clamp(
        sampleConfidence * (supportFeature ? 0.46 : 0.58) +
          lowPredictivePressure * (supportFeature ? 0.18 : 0.24) +
          driftPressure * (supportFeature ? 0.36 : 0.18),
        0,
        1
      );
      const blockedThreshold = supportFeature ? blockedScore * 0.72 : blockedScore;
      const weakThreshold = supportFeature ? weakScore * 0.8 : weakScore;
      const decayed = supportFeature
        ? predictiveScore <= blockedThreshold && sampleConfidence >= 0.68 && meanShift >= 0.12 && decayEvidenceConfidence >= 0.62
        : predictiveScore <= blockedScore && decayEvidenceConfidence >= 0.52;
      const watch = decayed || (
        supportFeature
          ? predictiveScore <= weakThreshold || meanShift >= 0.14
          : predictiveScore <= weakScore
      );
      return {
        id: bucket.id,
        group,
        count: bucket.values.length,
        supportFeature,
        sampleConfidence: num(sampleConfidence),
        decayEvidenceConfidence: num(decayEvidenceConfidence),
        predictiveScore: num(predictiveScore),
        meanShift: num(meanShift),
        direction: correlation(bucket.values, bucket.outcomes) >= 0 ? "pro" : "inverse",
        status: decayed
          ? "decayed"
          : watch
            ? "watch"
            : "healthy"
      };
    })
    .sort((left, right) => {
      const scoreDelta = (left.predictiveScore || 0) - (right.predictiveScore || 0);
      return Math.abs(scoreDelta) > 0.001 ? scoreDelta : (right.meanShift || 0) - (left.meanShift || 0);
    })
    .slice(0, 12);

  const degradedFeatureCount = scorecards.filter((item) => item.status === "decayed").length;
  const weakFeatureCount = scorecards.filter((item) => item.status !== "healthy").length;
  const strongestFeature = [...scorecards].sort((left, right) => (right.predictiveScore || 0) - (left.predictiveScore || 0))[0] || null;
  const weakestFeature = scorecards[0] || null;
  const averagePredictiveScore = average(scorecards.map((item) => item.predictiveScore || 0));
  const status = degradedFeatureCount >= 2
    ? "blocked"
    : weakFeatureCount >= 3
      ? "watch"
      : scorecards.length
        ? "healthy"
        : "warmup";

  return {
    status,
    trackedFeatureCount: scorecards.length,
    weakFeatureCount,
    degradedFeatureCount,
    strongestFeature: strongestFeature?.id || null,
    weakestFeature: weakestFeature?.id || null,
    averagePredictiveScore: num(averagePredictiveScore),
    scorecards,
    notes: [
      weakestFeature
        ? `${weakestFeature.id} toont momenteel de meeste feature decay.`
        : "Nog niet genoeg feature-data voor decay scoring.",
      strongestFeature
        ? `${strongestFeature.id} blijft de stabielste feature in de huidige set.`
        : "Nog geen stabiele feature-leider zichtbaar."
    ]
  };
}

function buildCalibrationGovernance({ tradeCount = 0, falsePositiveCount = 0, falseNegativeCount = 0, readinessScore = 0 } = {}) {
  const falsePositiveRate = tradeCount ? falsePositiveCount / tradeCount : 0;
  const denominator = tradeCount + falseNegativeCount;
  const falseNegativeRate = denominator ? falseNegativeCount / denominator : 0;
  const governanceScore = clamp(
    0.62 -
      falsePositiveRate * 0.34 -
      falseNegativeRate * 0.24 +
      readinessScore * 0.12,
    0,
    1
  );
  return {
    falsePositiveRate: num(falsePositiveRate),
    falseNegativeRate: num(falseNegativeRate),
    governanceScore: num(governanceScore),
    status: governanceScore >= 0.58
      ? "ready"
      : governanceScore >= 0.42
        ? "observe"
        : "blocked",
    note: governanceScore >= 0.58
      ? "Calibration governance oogt stabiel genoeg voor promotiebesluiten."
      : governanceScore >= 0.42
        ? "Calibration governance is bruikbaar, maar vraagt nog toezicht."
        : "Calibration governance is te zwak voor agressieve promotie."
  };
}

function buildRegimeDeployment(regimeScorecards = []) {
  const mature = regimeScorecards.filter((item) => (item.tradeCount || 0) >= 2);
  const readyRegimes = mature.filter((item) => (item.governanceScore || 0) >= 0.56).map((item) => item.id).slice(0, 4);
  const observeRegimes = mature.filter((item) => (item.governanceScore || 0) < 0.56 && (item.governanceScore || 0) >= 0.42).map((item) => item.id).slice(0, 4);
  const cooldownRegimes = mature.filter((item) => (item.governanceScore || 0) < 0.42).map((item) => item.id).slice(0, 4);
  return {
    status: readyRegimes.length ? "segmented" : mature.length ? "observe" : "warmup",
    readyRegimes,
    observeRegimes,
    cooldownRegimes,
    note: readyRegimes.length
      ? `${readyRegimes.length} regimes kunnen apart worden behandeld in deployment-governance.`
      : "Nog geen duidelijke regime-specifieke champions beschikbaar."
  };
}

function countCoverage(entries = []) {
  return (Array.isArray(entries) ? entries : []).reduce((total, item) => total + (item.count || 0), 0);
}

function buildRetrainTrack({
  label = "paper",
  trades = [],
  bootstrap = {},
  learningFrames = 0,
  averageRecordQuality = 0,
  lineageCoverage = 0,
  nowIso = new Date().toISOString()
} = {}) {
  const freshness = computeFreshnessScore(trades, nowIso, label === "live" ? 24 * 30 : 24 * 21);
  const strategyCount = new Set(trades.map((trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy).filter(Boolean)).size;
  const regimeCount = new Set(trades.map((trade) => trade.regimeAtEntry).filter(Boolean)).size;
  const winRate = trades.length ? trades.filter((trade) => (trade.pnlQuote || 0) > 0).length / trades.length : 0;
  const avgExecutionQuality = average(trades.map((trade) => trade.executionQualityScore || 0), 0);
  const countScore = Math.min(0.38, trades.length / (label === "live" ? 30 : 45) * 0.38);
  const diversityScore = Math.min(0.18, strategyCount / 6 * 0.1 + regimeCount / 5 * 0.08);
  const qualityScore = Math.min(0.18, averageRecordQuality * 0.1 + lineageCoverage * 0.08);
  const executionScore = Math.min(0.14, avgExecutionQuality * 0.14);
  const freshnessBias = Math.min(0.1, freshness.freshnessScore * 0.1);
  const bootstrapBias = label === "paper" && bootstrap?.paperLearningReady ? 0.08 : 0.03;
  const score = clamp(0.12 + countScore + diversityScore + qualityScore + executionScore + freshnessBias + bootstrapBias, 0, 1);
  return {
    label,
    tradeCount: trades.length,
    strategyCount,
    regimeCount,
    winRate: num(winRate),
    avgExecutionQuality: num(avgExecutionQuality),
    learningFrames,
    averageRecordQuality: num(averageRecordQuality),
    lineageCoverage: num(lineageCoverage),
    freshnessScore: freshness.freshnessScore,
    latestTradeAt: freshness.latestTradeAt,
    score: num(score),
    status: score >= 0.72
      ? "ready"
      : score >= 0.52
        ? "building"
        : "warmup",
    recommendation: score >= 0.72
      ? `${label} retrain kan frequenter en breder over scopes worden gebruikt.`
      : score >= 0.52
        ? `${label} retrain is bruikbaar, maar vraagt nog meer scope-diversiteit, trade-count of recentere data.`
        : `${label} retrain is nog dun of te oud; verzamel eerst meer recente representatieve closed trades.`
  };
}

function buildRetrainReadiness({
  paperTrades = [],
  liveTrades = [],
  dataRecorder = {},
  bootstrap = {},
  nowIso = new Date().toISOString()
} = {}) {
  const paper = buildRetrainTrack({
    label: "paper",
    trades: paperTrades,
    bootstrap: bootstrap.warmStart || {},
    learningFrames: dataRecorder.learningFrames || 0,
    averageRecordQuality: dataRecorder.averageRecordQuality || 0,
    lineageCoverage: dataRecorder.lineageCoverage || 0,
    nowIso
  });
  const live = buildRetrainTrack({
    label: "live",
    trades: liveTrades,
    bootstrap: bootstrap.warmStart || {},
    learningFrames: dataRecorder.learningFrames || 0,
    averageRecordQuality: dataRecorder.averageRecordQuality || 0,
    lineageCoverage: dataRecorder.lineageCoverage || 0,
    nowIso
  });
  const providerCoverage = countCoverage(dataRecorder.sourceCoverage || []);
  const contextCoverage = countCoverage(dataRecorder.contextCoverage || []);
  const datasetHealth = clamp(
    0.18 +
      (dataRecorder.averageRecordQuality || 0) * 0.28 +
      (dataRecorder.lineageCoverage || 0) * 0.22 +
      Math.min(0.16, providerCoverage / 12 * 0.16) +
      Math.min(0.16, contextCoverage / 8 * 0.16),
    0,
    1
  );
  const overallScore = clamp(
    0.32 * paper.score +
      0.28 * live.score +
      0.4 * datasetHealth,
    0,
    1
  );
  const priority = live.score < 0.52
    ? "grow_live_dataset"
    : paper.score < 0.52
      ? "grow_paper_dataset"
      : datasetHealth < 0.56
        ? "improve_dataset_quality"
        : "schedule_full_retrain";
  return {
    status: overallScore >= 0.72 ? "ready" : overallScore >= 0.52 ? "building" : "warmup",
    score: num(overallScore),
    datasetHealth: num(datasetHealth),
    providerCoverage,
    contextCoverage,
    bootstrapStatus: bootstrap.status || "empty",
    priority,
    paper,
    live,
    note: priority === "schedule_full_retrain"
      ? "Paper, live en datasetkwaliteit zijn sterk genoeg voor een bredere retrain-run."
      : priority === "improve_dataset_quality"
        ? "Retrain-data is al bruikbaar, maar bron/contextdekking of recordkwaliteit moet nog omhoog."
        : priority === "grow_live_dataset"
          ? "Live retrain blijft het dunste pad; hou live streng en gebruik paper voorlopig als hoofdbron."
          : "Paper retrain heeft nog extra closed-trade dekking nodig voor stabielere brede hertraining."
  };
}

function smoothRetrainTrack(nextTrack = {}, previousTrack = {}) {
  if (!previousTrack || !nextTrack) {
    return nextTrack;
  }
  const sameLatestTrade = (nextTrack.latestTradeAt || null) === (previousTrack.latestTradeAt || null);
  const sameTradeCount = (nextTrack.tradeCount || 0) === (previousTrack.tradeCount || 0);
  if (!sameLatestTrade || !sameTradeCount) {
    return nextTrack;
  }
  const smoothedScore = clamp((safeNumber(previousTrack.score, nextTrack.score) * 0.65) + (safeNumber(nextTrack.score, 0) * 0.35), 0, 1);
  return {
    ...nextTrack,
    score: num(smoothedScore),
    status: smoothedScore >= 0.72
      ? "ready"
      : smoothedScore >= 0.52
        ? "building"
        : "warmup"
  };
}

function stabilizeRetrainReadiness(nextReadiness = {}, previousReadiness = {}) {
  if (!previousReadiness || !nextReadiness) {
    return nextReadiness;
  }
  const paper = smoothRetrainTrack(nextReadiness.paper || {}, previousReadiness.paper || {});
  const live = smoothRetrainTrack(nextReadiness.live || {}, previousReadiness.live || {});
  const samePaper = (paper.latestTradeAt || null) === (previousReadiness.paper?.latestTradeAt || null) &&
    (paper.tradeCount || 0) === (previousReadiness.paper?.tradeCount || 0);
  const sameLive = (live.latestTradeAt || null) === (previousReadiness.live?.latestTradeAt || null) &&
    (live.tradeCount || 0) === (previousReadiness.live?.tradeCount || 0);
  const nextScoreRaw = safeNumber(nextReadiness.score, 0);
  const previousScoreRaw = safeNumber(previousReadiness.score, nextScoreRaw);
  const score = samePaper && sameLive
    ? clamp(previousScoreRaw * 0.65 + nextScoreRaw * 0.35, 0, 1)
    : nextScoreRaw;
  return {
    ...nextReadiness,
    paper,
    live,
    score: num(score),
    status: score >= 0.72 ? "ready" : score >= 0.52 ? "building" : "warmup"
  };
}

function buildScopedRetrainReadiness({
  paperTrades = [],
  liveTrades = [],
  nowIso = new Date().toISOString()
} = {}) {
  const buckets = new Map();
  const addTrade = (trade, mode, scopeType, scopeId) => {
    if (!scopeId) {
      return;
    }
    const key = `${scopeType}:${scopeId}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        id: scopeId,
        type: scopeType,
        paperCount: 0,
        liveCount: 0,
        totalCount: 0,
        wins: 0,
        executionQuality: 0,
        pnl: 0,
        latestTradeAt: null
      });
    }
    const bucket = buckets.get(key);
    const tradeAt = trade.exitAt || trade.entryAt || null;
    bucket.totalCount += 1;
    bucket.paperCount += mode === "paper" ? 1 : 0;
    bucket.liveCount += mode === "live" ? 1 : 0;
    bucket.wins += (trade.pnlQuote || 0) > 0 ? 1 : 0;
    bucket.executionQuality += trade.executionQualityScore || 0;
    bucket.pnl += trade.netPnlPct || 0;
    if (tradeAt && (!bucket.latestTradeAt || new Date(tradeAt).getTime() > new Date(bucket.latestTradeAt).getTime())) {
      bucket.latestTradeAt = tradeAt;
    }
  };

  for (const trade of paperTrades) {
    addTrade(trade, "paper", "family", trade.entryRationale?.strategy?.family || trade.strategyFamily || null);
    addTrade(trade, "paper", "regime", trade.regimeAtEntry || null);
  }
  for (const trade of liveTrades) {
    addTrade(trade, "live", "family", trade.entryRationale?.strategy?.family || trade.strategyFamily || null);
    addTrade(trade, "live", "regime", trade.regimeAtEntry || null);
  }

  return [...buckets.values()]
    .map((bucket) => {
      const winRate = bucket.totalCount ? bucket.wins / bucket.totalCount : 0;
      const avgExecutionQuality = bucket.totalCount ? bucket.executionQuality / bucket.totalCount : 0;
      const avgPnlPct = bucket.totalCount ? bucket.pnl / bucket.totalCount : 0;
      const diversityBias = bucket.paperCount > 0 && bucket.liveCount > 0 ? 0.08 : bucket.liveCount > 0 ? 0.05 : 0.03;
      const freshness = computeFreshnessScore(
        [{ exitAt: bucket.latestTradeAt }],
        nowIso,
        bucket.liveCount > 0 ? 24 * 30 : 24 * 21
      );
      const score = clamp(
        0.16 +
          Math.min(0.32, bucket.totalCount / 12 * 0.32) +
          Math.min(0.18, winRate * 0.18) +
          Math.min(0.16, avgExecutionQuality * 0.16) +
          Math.max(-0.08, Math.min(0.1, avgPnlPct * 8)) +
          Math.min(0.08, freshness.freshnessScore * 0.08) +
          diversityBias,
        0,
        1
      );
      return {
        id: bucket.id,
        type: bucket.type,
        totalCount: bucket.totalCount,
        paperCount: bucket.paperCount,
        liveCount: bucket.liveCount,
        winRate: num(winRate),
        avgExecutionQuality: num(avgExecutionQuality),
        avgPnlPct: num(avgPnlPct),
        freshnessScore: freshness.freshnessScore,
        latestTradeAt: bucket.latestTradeAt,
        score: num(score),
        status: score >= 0.72
          ? "ready"
          : score >= 0.52
            ? "building"
            : "warmup"
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
}

function buildRetrainFocusPlan({
  retrainReadiness = {},
  scopeRetrainReadiness = []
} = {}) {
  const topScope = scopeRetrainReadiness[0] || null;
  const weakestScope = [...(scopeRetrainReadiness || [])]
    .sort((left, right) => left.score - right.score)[0] || null;
  const readyScopes = (scopeRetrainReadiness || []).filter((item) => item.status === "ready").length;
  const buildingScopes = (scopeRetrainReadiness || []).filter((item) => item.status === "building").length;
  const warmupScopes = (scopeRetrainReadiness || []).filter((item) => item.status === "warmup").length;
  const nextAction = retrainReadiness.priority === "grow_live_dataset"
    ? "Verzamel meer live closed trades in de sterkste paper-scopes voordat je breder retrained."
    : retrainReadiness.priority === "grow_paper_dataset"
      ? "Vergroot paperdekking in de zwakste scopes en hou live voorlopig secundair."
      : retrainReadiness.priority === "improve_dataset_quality"
        ? "Verbeter recorderkwaliteit en bron/contextdekking voordat je een grote retrain-run start."
        : "Plan een bredere retrain-run, beginnend met de sterkste ready scopes.";
  return {
    status: retrainReadiness.status || "warmup",
    topScope: topScope ? {
      id: topScope.id,
      type: topScope.type,
      status: topScope.status,
      score: num(topScope.score)
    } : null,
    weakestScope: weakestScope ? {
      id: weakestScope.id,
      type: weakestScope.type,
      status: weakestScope.status,
      score: num(weakestScope.score)
    } : null,
    readyScopes,
    buildingScopes,
    warmupScopes,
    nextAction,
    note: topScope
      ? `${topScope.type}:${topScope.id} is nu de beste retrain-scope, terwijl ${weakestScope?.type || "scope"}:${weakestScope?.id || "n/a"} nog de meeste opbouw vraagt.`
      : "Nog geen scope-level retrain focus zichtbaar."
  };
}

function buildRetrainExecutionPlan({
  retrainReadiness = {},
  retrainFocusPlan = {},
  scopeRetrainReadiness = [],
  thresholdPolicy = {},
  exitLearning = {},
  calibrationGovernance = {},
  regimeDeployment = {}
} = {}) {
  const readyScopes = (scopeRetrainReadiness || []).filter((item) => item.status === "ready");
  const buildingScopes = (scopeRetrainReadiness || []).filter((item) => item.status === "building");
  const warmupScopes = (scopeRetrainReadiness || []).filter((item) => item.status === "warmup");
  const selectedScopes = (readyScopes.length ? readyScopes : buildingScopes).slice(0, 3);
  const probationScopes = buildingScopes
    .filter((item) => (item.score || 0) >= 0.58)
    .slice(0, 3);
  const rollbackWatchScopes = [...(scopeRetrainReadiness || [])]
    .filter((item) => (item.liveCount || 0) > 0 || (item.avgPnlPct || 0) < -0.003 || (item.score || 0) < 0.45)
    .sort((left, right) => (left.score || 0) - (right.score || 0))
    .slice(0, 3);
  const gatingReasons = [
    thresholdPolicy.status === "adjust" ? "threshold_probation_active" : null,
    exitLearning.status === "blocked" ? "exit_learning_blocked" : null,
    calibrationGovernance.status === "blocked" ? "calibration_governance_blocked" : null,
    retrainReadiness.priority === "improve_dataset_quality" ? "dataset_quality_upgrade" : null
  ].filter(Boolean);
  const cadence = retrainReadiness.priority === "schedule_full_retrain"
    ? "daily_scope_review_weekly_full"
    : retrainReadiness.priority === "grow_live_dataset"
      ? "daily_scope_review_live_guarded"
      : retrainReadiness.priority === "grow_paper_dataset"
        ? "daily_scope_review_paper_expansion"
        : "quality_repair_then_review";
  const batchType = retrainReadiness.priority === "schedule_full_retrain"
    ? "full_retrain"
    : selectedScopes.length
      ? "scoped_retrain"
      : "warmup_review";
  const status = retrainReadiness.status === "ready" && !gatingReasons.length
    ? "ready"
    : selectedScopes.length
      ? "building"
      : "warmup";

  return {
    status,
    cadence,
    batchType,
    selectedScopes: selectedScopes.map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      score: num(item.score),
      paperCount: item.paperCount || 0,
      liveCount: item.liveCount || 0
    })),
    probationScopes: probationScopes.map((item) => ({
      id: item.id,
      type: item.type,
      score: num(item.score),
      status: item.status
    })),
    rollbackWatchScopes: rollbackWatchScopes.map((item) => ({
      id: item.id,
      type: item.type,
      score: num(item.score),
      avgPnlPct: num(item.avgPnlPct || 0),
      liveCount: item.liveCount || 0
    })),
    gatingReasons,
    operatorAction: retrainReadiness.priority === "schedule_full_retrain"
      ? "Plan een bredere retrain-run, maar hou probation en rollback-watch actief op zwakkere scopes."
      : retrainReadiness.priority === "grow_live_dataset"
        ? "Hou live streng, vergroot live closed trades in de sterkste paper-scopes en retrain scoped."
        : retrainReadiness.priority === "grow_paper_dataset"
          ? "Vergroot paper-dekking in building scopes en promote pas na probation naar bredere retrain."
          : "Verbeter eerst datasetkwaliteit en lineage voordat retrain wordt opgeschaald.",
    notes: [
      selectedScopes.length
        ? `Volgende retrain-batch focust op ${selectedScopes.map((item) => `${item.type}:${item.id}`).join(", ")}.`
        : "Nog geen sterke retrain-scope voor een gerichte batch zichtbaar.",
      probationScopes.length
        ? `${probationScopes.length} scope(s) kunnen eerst via probation naar een bredere retrain-run doorgroeien.`
        : "Nog geen duidelijke probation-scopes voor retrain-promotie.",
      rollbackWatchScopes.length
        ? `Rollback-watch blijft actief op ${rollbackWatchScopes.map((item) => `${item.type}:${item.id}`).join(", ")}.`
        : "Geen expliciete rollback-watch scopes actief.",
      regimeDeployment.readyRegimes?.length
        ? `Regime deployment is al bruikbaar in ${regimeDeployment.readyRegimes.join(", ")}.`
        : "Regime deployment warmt nog op voor retrain-segmentatie."
    ]
  };
}

export class OfflineTrainer {
  constructor(config) {
    this.config = config;
    this.lastSummary = null;
  }

  buildSummary({ journal = {}, dataRecorder = {}, counterfactuals = [], historySummary = {}, nowIso = new Date().toISOString() } = {}) {
    const botMode = this.config?.botMode || "paper";
    const tradingSource = getConfiguredTradingSource(this.config, botMode);
    const usableCounterfactuals = (counterfactuals || []).filter((item) => !item?.resolutionFailed && item?.outcome !== "resolution_failed");
    const trades = (journal.trades || []).filter((trade) => trade.exitAt);
    const learningReadyTrades = trades.filter((trade) => Number.isFinite(trade.labelScore) && trade.rawFeatures && Object.keys(trade.rawFeatures).length > 0);
    const paperTrades = learningReadyTrades.filter((trade) => matchesTradingSource(trade, tradingSource, "paper"));
    const liveTrades = learningReadyTrades.filter((trade) => (trade.brokerMode || "paper") === "live");
    const modeScopedTrades = botMode === "paper" ? paperTrades : liveTrades;
    const modeScopedCounterfactuals = botMode === "paper"
      ? usableCounterfactuals.filter((item) => matchesTradingSource(item, tradingSource, "paper"))
      : usableCounterfactuals.filter((item) => (item?.brokerMode || "paper") === "live");
    const missedWinners = modeScopedCounterfactuals.filter((item) => BAD_VETO_OUTCOMES.has(resolveCounterfactualOutcomeLabel(item)));
    const blockedCorrectly = modeScopedCounterfactuals.filter((item) => GOOD_VETO_OUTCOMES.has(resolveCounterfactualOutcomeLabel(item)));
    const lateVetoes = modeScopedCounterfactuals.filter((item) => resolveCounterfactualOutcomeLabel(item) === "late_veto");
    const timingIssues = modeScopedCounterfactuals.filter((item) => ["right_direction_wrong_timing", "quality_trap"].includes(resolveCounterfactualOutcomeLabel(item)));
    const falsePositives = modeScopedTrades.filter((trade) => (trade.labelScore || 0.5) < 0.45 && (trade.pnlQuote || 0) < 0);
    const falseNegatives = missedWinners.filter((item) => (item.realizedMovePct || 0) > 0.01);
    const marginalFalseNegatives = falseNegatives.filter((item) => resolveCounterfactualBlockerMode(item) === "marginal");
    const sharedFalseNegatives = falseNegatives.filter((item) => resolveCounterfactualBlockerMode(item) === "shared");
    const timingFalseNegatives = timingIssues.filter((item) => (item.realizedMovePct || 0) > 0.01);
    const strategies = buildBucketMap(modeScopedTrades, (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy);
    const regimes = buildBucketMap(modeScopedTrades, (trade) => trade.regimeAtEntry || "unknown");
    const falsePositiveByStrategy = buildBucketMap(falsePositives, (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy);
    const falseNegativeByStrategy = buildBucketMap(falseNegatives, (item) => item.strategy || "blocked_setup", (item) => ({ pnl: 0, win: 1, quality: 0.5, label: 0.8, move: item.realizedMovePct || 0, mode: "paper" }));
    const strategyScorecards = buildStrategyScorecards(modeScopedTrades, falsePositives, falseNegatives, this.config, nowIso);
    const regimeScorecards = buildRegimeScorecards(modeScopedTrades, falsePositives, falseNegatives, this.config, nowIso);
    const conditionScorecards = buildConditionScorecards(modeScopedTrades, falsePositives, falseNegatives, this.config, nowIso);
    const conditionStrategyScorecards = buildConditionStrategyScorecards(modeScopedTrades, falsePositives, falseNegatives, this.config, nowIso);
    const conditionFamilyScorecards = buildConditionFamilyScorecards(modeScopedTrades, falsePositives, falseNegatives, this.config, nowIso);
    const conditionSessionFamilyScorecards = buildConditionSessionFamilyScorecards(modeScopedTrades, falsePositives, falseNegatives, this.config, nowIso);
    const blockerScorecards = buildBlockerScorecards(modeScopedCounterfactuals);
    const blockerConditionScorecards = buildBlockerConditionScorecards(modeScopedCounterfactuals);
    const readinessScore = clamp(
      0.24 +
        Math.min(0.3, modeScopedTrades.length / 80) +
        Math.min(0.16, (dataRecorder.learningFrames || 0) / 60) +
        Math.min(0.1, missedWinners.length / 20) +
        Math.min(0.1, blockedCorrectly.length / 20) +
        Math.min(0.05, lateVetoes.length / 16) +
        Math.min(0.1, falsePositives.length / 24),
      0,
      1
    );
    const thresholdPolicy = buildThresholdPolicy(blockerScorecards, this.config);
    const exitLearning = buildExitLearning(modeScopedTrades);
    const exitConditionScorecards = exitLearning.conditionPolicies || [];
    const missedTradeTuning = buildMissedTradeTuning(blockerConditionScorecards);
    const featureDecay = buildFeatureDecay(modeScopedTrades, this.config);
    const featureGovernance = buildFeatureGovernanceSummary({
      trades: modeScopedTrades,
      paperTrades,
      liveTrades,
      counterfactuals: modeScopedCounterfactuals,
      featureScorecards: featureDecay.scorecards || []
    });
    const outcomeScopeScorecards = buildOutcomeScopeScorecards(modeScopedTrades, modeScopedCounterfactuals);
    const scopeRetrainReadiness = buildScopedRetrainReadiness({
      paperTrades,
      liveTrades,
      nowIso
    });
    const retrainReadinessRaw = buildRetrainReadiness({
      paperTrades,
      liveTrades,
      dataRecorder,
      bootstrap: dataRecorder.latestBootstrap || {},
      nowIso
    });
    const retrainReadiness = stabilizeRetrainReadiness(retrainReadinessRaw, this.lastSummary?.retrainReadiness || {});
    const historyAggregate = historySummary?.aggregate || {};
    const historyCoverage = {
      status: historySummary?.status || historyAggregate.status || "unknown",
      symbolCount: historyAggregate.symbolCount || 0,
      coveredSymbolCount: historyAggregate.coveredSymbolCount || 0,
      staleSymbolCount: historyAggregate.staleSymbolCount || 0,
      gapSymbolCount: historyAggregate.gapSymbolCount || 0,
      uncoveredSymbolCount: historyAggregate.uncoveredSymbolCount || 0,
      partitionedSymbolCount: historyAggregate.partitionedSymbolCount || 0,
      notes: [...(historySummary?.notes || [])].slice(0, 4)
    };
    const calibrationGovernance = buildCalibrationGovernance({
      tradeCount: modeScopedTrades.length,
      falsePositiveCount: falsePositives.length,
      falseNegativeCount: falseNegatives.length,
      readinessScore
    });
    const regimeDeployment = buildRegimeDeployment(regimeScorecards);
    const policyTransitionCandidatesByCondition = buildPolicyTransitionCandidatesByCondition(
      conditionStrategyScorecards,
      blockerConditionScorecards,
      conditionFamilyScorecards,
      exitConditionScorecards
    );
    const retrainFocusPlan = buildRetrainFocusPlan({
      retrainReadiness,
      scopeRetrainReadiness
    });
    const retrainExecutionPlan = buildRetrainExecutionPlan({
      retrainReadiness,
      retrainFocusPlan,
      scopeRetrainReadiness,
      thresholdPolicy,
      exitLearning,
      calibrationGovernance,
      regimeDeployment
    });

    const summary = {
      generatedAt: nowIso,
      tradingSource,
      learningReadyTrades: modeScopedTrades.length,
      modeScopedTradeCount: modeScopedTrades.length,
      modeScopedCounterfactualCount: modeScopedCounterfactuals.length,
      paperTrades: paperTrades.length,
      liveTrades: liveTrades.length,
      learningFrames: dataRecorder.learningFrames || 0,
      decisionFrames: dataRecorder.decisionFrames || 0,
      counterfactuals: {
        total: modeScopedCounterfactuals.length,
        missedWinners: missedWinners.length,
        blockedCorrectly: blockedCorrectly.length,
        lateVetoes: lateVetoes.length,
        timingIssues: timingIssues.length,
        falseNegatives: falseNegatives.length,
        marginalFalseNegatives: marginalFalseNegatives.length,
        sharedFalseNegatives: sharedFalseNegatives.length,
        timingFalseNegatives: timingFalseNegatives.length,
        averageMissedMovePct: num(average(missedWinners.map((item) => item.realizedMovePct || 0), 0))
      },
      vetoFeedback: {
        total: modeScopedCounterfactuals.length,
        blockerCount: blockerScorecards.length,
        goodVetoCount: blockedCorrectly.length,
        badVetoCount: missedWinners.length,
        lateVetoCount: lateVetoes.length,
        timingIssueCount: timingIssues.length,
        topBlocker: blockerScorecards[0]?.id || null
      },
      falsePositiveTrades: falsePositives.length,
      falseNegativeTrades: falseNegatives.length,
      strategies: strategies.slice(0, 8),
      regimes: regimes.slice(0, 6),
      strategyScorecards,
      regimeScorecards,
      conditionScorecards,
      conditionStrategyScorecards,
      conditionFamilyScorecards,
      conditionSessionFamilyScorecards,
      blockerScorecards,
      blockerConditionScorecards,
      thresholdPolicy,
      missedTradeTuning,
      outcomeScopeScorecards,
      exitLearning,
      exitScorecards: exitLearning.scorecards || [],
      exitConditionScorecards,
      featureDecay,
      featureDecayScorecards: featureDecay.scorecards || [],
      featureGovernance,
      scopeRetrainReadiness,
      retrainReadiness,
      retrainFocusPlan,
      retrainExecutionPlan,
      calibrationGovernance,
      regimeDeployment,
      policyTransitionCandidatesByCondition,
      historyCoverage,
      falsePositiveByStrategy: falsePositiveByStrategy.slice(0, 6),
      falseNegativeByStrategy: falseNegativeByStrategy.slice(0, 6),
      readinessScore: num(readinessScore),
      status: readinessScore >= 0.72 ? "ready" : readinessScore >= 0.52 ? "building" : "warmup",
      notes: [
        modeScopedTrades.length >= 20
          ? "Er is genoeg gesloten trade-data voor regelmatige offline evaluatie."
          : "Nog extra gesloten trades verzamelen voor sterkere offline training.",
        botMode === "paper"
          ? `Offline trainer gebruikt nu alleen ${tradingSource} voor paper-governance en feature learning.`
          : "Offline trainer gebruikt nu alleen live gesloten trades voor live-governance.",
        falseNegatives.length
          ? `${falseNegatives.length} gemiste winnaars zijn bruikbaar voor counterfactual training (${marginalFalseNegatives.length} marginaal, ${sharedFalseNegatives.length} gedeeld).`
          : "Nog geen duidelijke false negatives in de counterfactual set.",
        falsePositives.length
          ? `${falsePositives.length} false positives tonen waar de meta-gate strenger mag worden.`
          : "False positive set is nog klein; dat is positief voor de huidige gating.",
        blockerScorecards[0]
          ? `${blockerScorecards[0].id} vraagt momenteel veto-aandacht (${blockerScorecards[0].status}).`
          : "Nog geen veto-feedback met duidelijke blocker-patronen.",
        missedTradeTuning.topBlocker
          ? `${missedTradeTuning.topBlocker} krijgt nu ${missedTradeTuning.action}-tuning binnen ${missedTradeTuning.scope?.conditionId || "onbekende conditie"}.`
          : "Nog geen condition-aware missed-trade tuning actief.",
        thresholdPolicy.topRecommendation
          ? `${thresholdPolicy.topRecommendation.id} geeft threshold-advies: ${thresholdPolicy.topRecommendation.action}.`
          : "Threshold-tuning ziet momenteel geen harde aanpassing nodig.",
        outcomeScopeScorecards.topActionable
          ? `outcome-scope ${outcomeScopeScorecards.topActionable.scopeType}:${outcomeScopeScorecards.topActionable.id} stuurt nu direct threshold- en sizing-bias.`
          : "outcome-scope scorecards bouwen nog op.",
        exitLearning.topReason
          ? `${exitLearning.topReason} leidt momenteel in exit learning (${exitLearning.status}).`
          : "Nog geen volwassen exit-learning patroon zichtbaar.",
        featureDecay.weakestFeature
          ? `${featureDecay.weakestFeature} toont momenteel de meeste feature decay.`
          : "Feature-decay tracking warmt nog op.",
        featureGovernance.notes?.[0] || "Feature-governance warmt nog op.",
        featureGovernance.notes?.[1] || "Feature parity en pruning hebben nog meer data nodig.",
        retrainReadiness.note,
        retrainFocusPlan.note,
        retrainExecutionPlan.notes?.[0],
        scopeRetrainReadiness[0]
          ? `${scopeRetrainReadiness[0].type}:${scopeRetrainReadiness[0].id} is momenteel de sterkste retrain-scope.`
          : "Nog geen duidelijke retrain-scopeleider zichtbaar.",
        calibrationGovernance.note,
        historyCoverage.gapSymbolCount
          ? `${historyCoverage.gapSymbolCount} history-symbolen hebben nog gaten voor replay of offline learning.`
          : "Geen openstaande history gaps in de offline learning dekking.",
        regimeScorecards[0]
          ? `${regimeScorecards[0].id} is het sterkste regime in offline trainer governance.`
          : "Nog geen duidelijke regime-leider in offline trainer.",
        strategyScorecards[0]
          ? `${strategyScorecards[0].id} leidt momenteel in offline trainer governance.`
          : "Nog geen duidelijke strategy-leider in offline trainer."
      ]
    };
    this.lastSummary = summary;
    return summary;
  }
}

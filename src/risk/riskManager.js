import { clamp } from "../utils/math.js";
import { minutesBetween, sameUtcDay } from "../utils/time.js";
import { buildMarketStateSummary } from "../strategy/marketState.js";
import { buildConfidenceBreakdown, buildDataQualitySummary, buildSignalQualitySummary } from "../strategy/candidateInsights.js";
import { matchesBrokerMode } from "../utils/tradingSource.js";

function safeValue(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeValue(value, 0).toFixed(digits));
}

function isValidPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function isWithinLookback(at, nowIso, lookbackMinutes) {
  if (!at || !Number.isFinite(lookbackMinutes) || lookbackMinutes <= 0) {
    return true;
  }
  const atMs = new Date(at).getTime();
  const nowMs = new Date(nowIso || at).getTime();
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) {
    return true;
  }
  return nowMs - atMs <= lookbackMinutes * 60_000;
}

function getMostRecentTradeTimestamp(journal) {
  return [...(journal?.trades || [])]
    .reverse()
    .map((trade) => trade.exitAt || trade.entryAt || null)
    .find(Boolean) || null;
}

function isSoftPaperReason(reason) {
  return [
    "model_confidence_too_low",
    "model_uncertainty_abstain",
    "transformer_challenger_reject",
    "committee_veto",
    "committee_confidence_too_low",
    "committee_low_agreement",
    "strategy_fit_too_low",
    "strategy_context_mismatch",
    "orderbook_sell_pressure",
    "execution_cost_budget_exceeded",
    "strategy_cooldown",
    "strategy_budget_cooled",
    "family_budget_cooled",
    "cluster_budget_cooled",
    "regime_budget_cooled",
    "factor_budget_cooled",
    "daily_risk_budget_cooled",
    "regime_kill_switch_active",
    "portfolio_loss_streak_guard",
    "symbol_loss_streak_guard",
    "capital_governor_blocked",
    "capital_governor_recovery",
    "trade_size_below_minimum",
    "entry_cooldown_active",
    "daily_entry_budget_reached",
    "weekend_high_risk_strategy_block",
    "ambiguous_setup_context"
  ].includes(reason);
}

function classifyReasonCategory(reason = "") {
  if (!reason) {
    return "other";
  }
  if (reason.includes("confidence") || reason.includes("abstain") || reason.includes("quality")) {
    return "quality";
  }
  if (reason.includes("committee") || reason.includes("meta") || reason.includes("governor")) {
    return "governance";
  }
  if (reason.includes("volatility") || reason.includes("spread") || reason.includes("orderbook") || reason.includes("liquidity")) {
    return "execution";
  }
  if (reason.includes("news") || reason.includes("event") || reason.includes("calendar") || reason.includes("announcement")) {
    return "event";
  }
  if (reason.includes("portfolio") || reason.includes("exposure") || reason.includes("position") || reason.includes("trade_size")) {
    return "risk";
  }
  if (reason.includes("regime") || reason.includes("trend") || reason.includes("breakout") || reason.includes("session")) {
    return "regime";
  }
  if (reason.startsWith("paper_learning_") || reason.includes("shadow")) {
    return "learning";
  }
  return "other";
}

function reasonSeverity(reason = "") {
  if (!reason || isSoftPaperReason(reason)) {
    return 1;
  }
  if (
    [
      "position_already_open",
      "max_open_positions_reached",
      "trade_size_invalid",
      "trade_size_below_minimum"
    ].includes(reason)
  ) {
    return 5;
  }
  if (
    [
      "capital_governor_blocked",
      "regime_kill_switch_active",
      "self_heal_pause_entries",
      "execution_cost_budget_exceeded"
    ].includes(reason)
  ) {
    return 4;
  }
  return 3;
}

function normalizeDecisionReasons(reasons = []) {
  return [...new Set((reasons || []).filter(Boolean))]
    .sort((left, right) => {
      const severityDelta = reasonSeverity(right) - reasonSeverity(left);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return left.localeCompare(right);
    });
}

function getAmbiguityThreshold({
  regime = "range",
  family = "",
  marketConditionId = ""
} = {}) {
  let threshold = 0.62;
  if (["range", "high_vol"].includes(regime)) {
    threshold -= 0.04;
  } else if (regime === "trend") {
    threshold += 0.03;
  }
  if (["breakout", "market_structure", "orderflow"].includes(family)) {
    threshold -= 0.02;
  } else if (family === "mean_reversion") {
    threshold += 0.03;
  }
  if (["failed_breakout", "range_break_risk", "trend_exhaustion"].includes(marketConditionId)) {
    threshold -= 0.02;
  }
  return clamp(threshold, 0.5, 0.75);
}

function buildDecisionContextConfidence({
  signalQualitySummary = {},
  dataQualitySummary = {},
  confidenceBreakdown = {},
  marketConditionSummary = {},
  score = {}
} = {}) {
  const signalQuality = safeValue(signalQualitySummary.overallScore, 0);
  const dataQuality = safeValue(dataQualitySummary.overallScore, 0);
  const executionConfidence = safeValue(confidenceBreakdown.executionConfidence, 0);
  const modelConfidence = safeValue(score.calibrationConfidence ?? score.confidence, 0);
  const conditionConfidence = safeValue(marketConditionSummary.conditionConfidence, 0);
  const conditionRiskPenalty = safeValue(marketConditionSummary.conditionRisk, 0) * 0.14;
  return clamp(
    signalQuality * 0.26 +
    dataQuality * 0.22 +
    executionConfidence * 0.24 +
    modelConfidence * 0.18 +
    conditionConfidence * 0.1 -
    conditionRiskPenalty,
    0,
    1
  );
}

function isMildPaperQualityReason(reason) {
  return [
    "local_book_quality_too_low",
    "quality_quorum_degraded"
  ].includes(reason);
}

function isPaperProbeCapReason(reason) {
  return [
    "paper_learning_family_probe_cap_reached",
    "paper_learning_regime_probe_cap_reached",
    "paper_learning_session_probe_cap_reached",
    "paper_learning_regime_family_probe_cap_reached",
    "paper_learning_condition_strategy_probe_cap_reached"
  ].includes(reason);
}

function isPaperShadowCapReason(reason) {
  return [
    "paper_learning_regime_family_shadow_cap_reached",
    "paper_learning_condition_strategy_shadow_cap_reached"
  ].includes(reason);
}

function isPaperRecoveryProbeReason(reason) {
  return [
    "capital_governor_blocked",
    "capital_governor_recovery",
    "trade_size_below_minimum"
  ].includes(reason);
}

function canRelaxPaperSelfHeal(selfHealState = {}) {
  const issues = new Set(selfHealState.issues || []);
  return Boolean(selfHealState.learningAllowed) || !issues.has("health_circuit_open");
}

function isPaperLeniencyReason(reason, selfHealState = {}) {
  if (reason === "self_heal_pause_entries") {
    return canRelaxPaperSelfHeal(selfHealState);
  }
  return isSoftPaperReason(reason);
}

function usesWeekendHighRiskStrategyGate(strategySummary = {}) {
  const family = strategySummary.family || "";
  const activeStrategy = strategySummary.activeStrategy || "";
  if (["breakout", "derivatives"].includes(family)) {
    return true;
  }
  if (family === "market_structure") {
    return ["market_structure_break"].includes(activeStrategy);
  }
  return false;
}

function isRedundantCommitteeVeto({ committeeVetoIds = [], portfolioSummary = {}, strategySummary = {} } = {}) {
  if (!committeeVetoIds.length) {
    return false;
  }
  const vetoSet = new Set(committeeVetoIds);
  const portfolioReasons = new Set(portfolioSummary.reasons || []);
  const strategyBlockers = new Set(strategySummary.blockers || []);
  const portfolioCovered =
    vetoSet.has("portfolio_overlap") &&
    [
      "cluster_exposure_limit_hit",
      "sector_exposure_limit_hit",
      "pair_correlation_too_high",
      "family_exposure_limit_hit",
      "regime_exposure_limit_hit",
      "strategy_exposure_limit_hit",
      "portfolio_cvar_budget_hit",
      "portfolio_drawdown_budget_hit",
      "regime_kill_switch_active"
    ].some((reason) => portfolioReasons.has(reason));
  const strategyCovered =
    vetoSet.has("strategy_context_mismatch") &&
    strategyBlockers.size > 0;
  return committeeVetoIds.every((id) =>
    (id === "portfolio_overlap" && portfolioCovered) ||
    (id === "strategy_context_mismatch" && strategyCovered)
  );
}

function getStrategyFitGuardFloor(strategySummary = {}, botMode = "paper") {
  const activeStrategy = strategySummary.activeStrategy || "";
  const family = strategySummary.family || "";
  if (botMode === "paper") {
    if (activeStrategy === "liquidity_sweep") {
      return 0.46;
    }
    if (activeStrategy === "orderbook_imbalance") {
      return 0.4;
    }
    if (["zscore_reversion", "vwap_reversion"].includes(activeStrategy) || family === "mean_reversion") {
      return 0.47;
    }
  }
  return 0.5;
}

function canUsePaperProbeScopeOverflow({
  entryMode = "standard",
  reasons = [],
  score = {},
  threshold = 0,
  paperLearningBudget = {},
  paperLearningSampling = {},
  signalQualitySummary = {},
  dataQualitySummary = {},
  confidenceBreakdown = {},
  selfHealState = {}
} = {}) {
  if (!["paper_exploration", "paper_recovery_probe"].includes(entryMode)) {
    return false;
  }
  if ((paperLearningBudget.probeRemaining || 0) <= 0) {
    return false;
  }
  const capReasons = reasons.filter((reason) => isPaperProbeCapReason(reason));
  if (capReasons.length !== 1) {
    return false;
  }
  const nonCapReasons = reasons.filter((reason) => !isPaperProbeCapReason(reason));
  if (!nonCapReasons.length || !nonCapReasons.every((reason) => isPaperLeniencyReason(reason, selfHealState) || isMildPaperQualityReason(reason))) {
    return false;
  }
  return (
    score.probability >= threshold - 0.04 &&
    safeValue(score.calibrationConfidence, 0) >= 0.66 &&
    safeValue(confidenceBreakdown.overallConfidence, 0) >= 0.6 &&
    safeValue(signalQualitySummary.overallScore, 0) >= 0.66 &&
    safeValue(dataQualitySummary.overallScore, 0) >= 0.44 &&
    safeValue(paperLearningSampling.noveltyScore, 0) >= 0.18
  );
}

function hasConfirmedPaperSellPressure({ marketSnapshot = {}, strategySummary = {}, config = {} } = {}) {
  const book = marketSnapshot.book || {};
  const family = strategySummary.family || "";
  const restBookFallbackPressureOnly =
    (book.bookSource || "") === "rest_book" &&
    book.bookFallbackReady === true &&
    book.localBookSynced !== true;
  const fallbackCorroborated =
    (book.microPriceEdgeBps || 0) < -0.22 ||
    (book.weightedDepthImbalance || 0) < -0.14 ||
    (
      (book.bookPressure || 0) < config.minBookPressureForEntry - 0.18 &&
      (
        (book.microPriceEdgeBps || 0) < -0.08 ||
        (book.weightedDepthImbalance || 0) < -0.08
      )
    );
  const baseConfirmed =
    !restBookFallbackPressureOnly ||
    fallbackCorroborated;
  if (!["breakout", "market_structure"].includes(family)) {
    return baseConfirmed;
  }
  if (restBookFallbackPressureOnly) {
    return baseConfirmed;
  }
  return (
    (book.bookPressure || 0) < config.minBookPressureForEntry - 0.1 ||
    ((book.bookPressure || 0) < config.minBookPressureForEntry && (book.microPriceEdgeBps || 0) < 0) ||
    ((book.bookPressure || 0) < config.minBookPressureForEntry && (book.weightedDepthImbalance || 0) < -0.1) ||
    (book.microPriceEdgeBps || 0) < -0.22 ||
    (book.weightedDepthImbalance || 0) < -0.16
  );
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function buildRelativeStrengthComposite(market = {}) {
  return average([
    market.relativeStrengthVsBtc,
    market.relativeStrengthVsEth,
    market.clusterRelativeStrength,
    market.sectorRelativeStrength
  ].filter((value) => Number.isFinite(value)), 0);
}

function buildDownsideVolDominance(market = {}) {
  const upside = safeValue(market.upsideRealizedVolPct);
  const downside = safeValue(market.downsideRealizedVolPct);
  return (downside - upside) / Math.max(upside + downside, 1e-9);
}

function buildAcceptanceQuality(market = {}) {
  return clamp(average([
    market.closeLocationQuality,
    market.volumeAcceptanceScore,
    market.anchoredVwapAcceptanceScore,
    Number.isFinite(market.anchoredVwapRejectionScore) ? 1 - market.anchoredVwapRejectionScore : null,
    market.breakoutFollowThroughScore
  ].filter((value) => Number.isFinite(value)), 0.5), 0, 1);
}

function buildReplenishmentQuality(book = {}) {
  return clamp(average([
    Number.isFinite(book.replenishmentScore) ? (book.replenishmentScore + 1) / 2 : null,
    Number.isFinite(book.queueRefreshScore) ? (book.queueRefreshScore + 1) / 2 : null,
    Number.isFinite(book.resilienceScore) ? (book.resilienceScore + 1) / 2 : null
  ].filter((value) => Number.isFinite(value)), 0.5), 0, 1);
}

function normalizeRelativeStrength(relativeStrength = 0) {
  return clamp((safeValue(relativeStrength, 0) + 0.01) / 0.03, 0, 1);
}

function buildSetupQualityAssessment({
  config = {},
  score = {},
  threshold = 0,
  strategySummary = {},
  signalQualitySummary = {},
  confidenceBreakdown = {},
  dataQualitySummary = {},
  acceptanceQuality = 0,
  replenishmentQuality = 0,
  relativeStrengthComposite = 0,
  downsideVolDominance = 0,
  timeframeSummary = {},
  pairHealthSummary = {},
  venueConfirmationSummary = {},
  marketConditionSummary = {},
  marketStateSummary = {},
  regimeSummary = {}
} = {}) {
  const edgeToThreshold = safeValue(score.probability, 0) - safeValue(threshold, 0);
  const strategyFit = safeValue(strategySummary.fitScore, 0);
  const strategyFitGuardFloor = getStrategyFitGuardFloor(strategySummary, config.botMode || "paper");
  const strategyBlockerCount = Array.isArray(strategySummary.blockers) ? strategySummary.blockers.length : 0;
  const relativeStrengthScore = normalizeRelativeStrength(relativeStrengthComposite);
  const conditionConfidence = clamp(safeValue(marketConditionSummary.conditionConfidence, 0.5), 0, 1);
  const conditionRisk = clamp(safeValue(marketConditionSummary.conditionRisk, 0.5), 0, 1);
  const hostilePhase = ["late_crowded", "late_distribution"].includes(marketStateSummary.phase || "");
  const hostileRegime = ["high_vol", "breakout"].includes(regimeSummary.regime || "");
  const strategyContextPenalty = strategyBlockerCount
    ? Math.min(0.12, 0.04 + strategyBlockerCount * 0.02)
    : 0;
  const strategyFitPenalty = Math.max(0, strategyFitGuardFloor - strategyFit) * 0.12;
  const qualityScore = clamp(
      0.14 +
        Math.max(0, edgeToThreshold + 0.03) * 2.4 * 0.16 +
        strategyFit * 0.17 +
        safeValue(signalQualitySummary.overallScore, 0) * 0.16 +
        safeValue(confidenceBreakdown.overallConfidence, 0) * 0.14 +
        safeValue(dataQualitySummary.overallScore, 0) * 0.1 +
        clamp(acceptanceQuality, 0, 1) * 0.08 +
        clamp(replenishmentQuality, 0, 1) * 0.06 +
      relativeStrengthScore * 0.05 +
      safeValue(timeframeSummary.alignmentScore, 0) * 0.05 +
      conditionConfidence * 0.04 +
      safeValue(pairHealthSummary.score, 0.5) * 0.04 +
        Math.max(0, 1 - conditionRisk) * 0.03 -
        Math.max(0, conditionRisk - 0.48) * 0.06 -
        Math.max(0, downsideVolDominance) * 0.08 -
        strategyFitPenalty -
        strategyContextPenalty -
        (hostilePhase ? 0.06 : 0) -
        (hostileRegime ? 0.03 : 0) -
        ((venueConfirmationSummary.status || "") === "blocked" ? 0.08 : 0),
      0,
      1
  );
  const cautionScore = safeValue(config.tradeQualityCautionScore, 0.58);
  const minScore = safeValue(config.tradeQualityMinScore, 0.47);
  let tier =
    qualityScore >= 0.72 ? "elite" :
    qualityScore >= cautionScore ? "good" :
    qualityScore >= minScore ? "watch" :
    "weak";
  if (strategyBlockerCount > 0 || strategyFit < strategyFitGuardFloor) {
    tier = tier === "elite" || tier === "good" ? "watch" : tier;
  }
  if (strategyBlockerCount >= 2 && strategyFit < Math.max(0.18, strategyFitGuardFloor - 0.08)) {
    tier = "weak";
  }
  return {
    score: num(qualityScore, 4),
    tier,
    edgeToThreshold: num(edgeToThreshold, 4),
    relativeStrengthScore: num(relativeStrengthScore, 4),
    hostilePhase,
    hostileRegime,
    regimeFit: num(strategyFit, 4),
    strategyFitGuardFloor: num(strategyFitGuardFloor, 4),
    strategyBlockerCount,
    conditionConfidence: num(conditionConfidence, 4),
    conditionRisk: num(conditionRisk, 4),
    signalQuality: num(safeValue(signalQualitySummary.overallScore, 0), 4),
    executionReadiness: num(safeValue(confidenceBreakdown.executionConfidence, 0), 4),
    acceptanceQuality: num(acceptanceQuality, 4),
    replenishmentQuality: num(replenishmentQuality, 4)
  };
}

function buildApprovalReasons({
  score = {},
  threshold = 0,
  strategySummary = {},
  signalQualitySummary = {},
  confidenceBreakdown = {},
  setupQuality = {},
  acceptanceQuality = 0,
  replenishmentQuality = 0,
  relativeStrengthComposite = 0,
  marketConditionSummary = {}
} = {}) {
  const reasons = [];
  if (safeValue(score.probability, 0) >= safeValue(threshold, 0) + 0.05) {
    reasons.push("probability_edge_clear");
  }
  if ((setupQuality.tier || "") === "elite") {
    reasons.push("setup_quality_elite");
  } else if ((setupQuality.tier || "") === "good") {
    reasons.push("setup_quality_good");
  }
  if (safeValue(strategySummary.fitScore, 0) >= 0.62) {
    reasons.push("strategy_fit_strong");
  }
  if (safeValue(signalQualitySummary.overallScore, 0) >= 0.62) {
    reasons.push("signal_confluence_strong");
  }
  if (safeValue(confidenceBreakdown.executionConfidence, 0) >= 0.56) {
    reasons.push("execution_ready");
  }
  if (acceptanceQuality >= 0.58) {
    reasons.push("acceptance_confirmed");
  }
  if (replenishmentQuality >= 0.56) {
    reasons.push("orderbook_supportive");
  }
  if (
    safeValue(marketConditionSummary.conditionConfidence, 0) >= 0.62 &&
    safeValue(marketConditionSummary.conditionRisk, 1) <= 0.42
  ) {
    reasons.push("condition_context_supportive");
  }
  if (relativeStrengthComposite >= 0.003) {
    reasons.push("relative_strength_confirmed");
  }
  return [...new Set(reasons)].slice(0, 4);
}

function getMetaCautionReasons(metaSummary = {}) {
  return [...new Set((metaSummary.reasons || []).filter((reason) =>
    ["meta_gate_caution", "meta_neural_caution", "trade_quality_caution"].includes(reason)
  ))];
}

function getCommitteeVetoIds(committeeSummary = {}) {
  return [...new Set((committeeSummary.vetoes || []).map((item) => item?.id).filter(Boolean))];
}

function isSoftPaperCommitteeDisagreementOnly({ committeeSummary = {}, score = {} } = {}) {
  const vetoIds = getCommitteeVetoIds(committeeSummary);
  if (!vetoIds.length || !vetoIds.every((id) => id === "model_disagreement")) {
    return false;
  }
  const committeeProbability = safeValue(committeeSummary.probability, 0.5);
  const modelProbability = safeValue(score.probability, 0.5);
  return (
    committeeProbability >= modelProbability - 0.02 &&
    safeValue(committeeSummary.netScore, 0) >= -0.08 &&
    safeValue(committeeSummary.agreement, 0) >= 0.22
  );
}

function isSoftPaperCommitteeConfidenceOnly({ committeeSummary = {}, score = {}, threshold = 0 } = {}) {
  if (getCommitteeVetoIds(committeeSummary).length) {
    return false;
  }
  const committeeProbability = safeValue(committeeSummary.probability, 0.5);
  const modelProbability = safeValue(score.probability, 0.5);
  return (
    safeValue(committeeSummary.agreement, 0) >= 0.72 &&
    safeValue(committeeSummary.netScore, 0) >= -0.08 &&
    committeeProbability >= modelProbability - 0.04 &&
    committeeProbability >= threshold - 0.1
  );
}

function isRedundantPaperCommitteeConfidence({ committeeSummary = {}, score = {}, threshold = 0, reasons = [] } = {}) {
  if (!reasons.includes("model_confidence_too_low")) {
    return false;
  }
  if (getCommitteeVetoIds(committeeSummary).length) {
    return false;
  }
  const committeeProbability = safeValue(committeeSummary.probability, 0.5);
  const modelProbability = safeValue(score.probability, 0.5);
  return (
    safeValue(committeeSummary.agreement, 0) >= 0.78 &&
    safeValue(committeeSummary.netScore, 0) >= -0.1 &&
    committeeProbability >= modelProbability - 0.03 &&
    committeeProbability >= threshold - 0.1
  );
}

function getPaperLearningBudgetState({ journal = {}, runtime = {}, nowIso, config = {} } = {}) {
  const botMode = config.botMode || "paper";
  const probeUsed = [
    ...(journal?.trades || []).filter((trade) => matchesBrokerMode(trade, botMode) && trade.learningLane === "probe" && trade.entryAt && sameUtcDay(trade.entryAt, nowIso)),
    ...(runtime?.openPositions || []).filter((position) => matchesBrokerMode(position, botMode) && position.learningLane === "probe" && position.entryAt && sameUtcDay(position.entryAt, nowIso))
  ].length;
  const shadowUsed = [
    ...(journal?.counterfactuals || []).filter((item) => matchesBrokerMode(item, botMode) && item.learningLane === "shadow" && sameUtcDay(item.resolvedAt || item.queuedAt || item.at, nowIso)),
    ...(runtime?.counterfactualQueue || []).filter((item) => matchesBrokerMode(item, botMode) && item.learningLane === "shadow" && sameUtcDay(item.queuedAt || item.dueAt, nowIso))
  ].length;
  const probeDailyLimit = Math.max(0, Math.round(config.paperLearningProbeDailyLimit || 0));
  const shadowDailyLimit = Math.max(0, Math.round(config.paperLearningShadowDailyLimit || 0));
  return {
    probeDailyLimit,
    probeUsed,
    probeRemaining: Math.max(0, probeDailyLimit - probeUsed),
    shadowDailyLimit,
    shadowUsed,
    shadowRemaining: Math.max(0, shadowDailyLimit - shadowUsed)
  };
}

function incrementCounter(map, key) {
  if (!key) {
    return;
  }
  map[key] = (map[key] || 0) + 1;
}

function buildPaperScopeKey(parts = []) {
  return parts.map((part) => `${part || ""}`.trim()).filter(Boolean).join("::");
}

function getPaperLearningSamplingState({
  journal = {},
  runtime = {},
  nowIso,
  config = {},
  strategySummary = {},
  regimeSummary = {},
  sessionSummary = {},
  marketConditionSummary = {}
} = {}) {
  const botMode = config.botMode || "paper";
  const familyCounts = {};
  const regimeCounts = {};
  const sessionCounts = {};
  const regimeFamilyCounts = {};
  const conditionStrategyCounts = {};
  const shadowRegimeFamilyCounts = {};
  const shadowConditionStrategyCounts = {};
  const records = [
    ...(journal?.trades || []).filter((trade) => matchesBrokerMode(trade, botMode) && trade.learningLane === "probe" && trade.entryAt && sameUtcDay(trade.entryAt, nowIso)),
    ...(runtime?.openPositions || []).filter((position) => matchesBrokerMode(position, botMode) && position.learningLane === "probe" && position.entryAt && sameUtcDay(position.entryAt, nowIso))
  ];
  for (const item of records) {
    const familyId = item.strategyFamily || item.family || item.strategy?.family || item.entryRationale?.strategy?.family || null;
    const regimeId = item.regimeAtEntry || item.regime || item.entryRationale?.regimeSummary?.regime || null;
    const sessionId = item.sessionAtEntry || item.session || item.entryRationale?.session?.session || null;
    const conditionId = item.marketConditionAtEntry || item.marketCondition?.conditionId || item.entryRationale?.marketCondition?.conditionId || null;
    const strategyId = item.strategyAtEntry || item.strategy || item.entryRationale?.strategy?.activeStrategy || null;
    incrementCounter(familyCounts, familyId);
    incrementCounter(regimeCounts, regimeId);
    incrementCounter(sessionCounts, sessionId);
    incrementCounter(regimeFamilyCounts, buildPaperScopeKey([regimeId, familyId]));
    incrementCounter(conditionStrategyCounts, buildPaperScopeKey([conditionId, strategyId]));
  }
  const shadowRecords = [
    ...(journal?.counterfactuals || []).filter((item) => matchesBrokerMode(item, botMode) && item.learningLane === "shadow" && sameUtcDay(item.resolvedAt || item.queuedAt || item.at, nowIso)),
    ...(runtime?.counterfactualQueue || []).filter((item) => matchesBrokerMode(item, botMode) && item.learningLane === "shadow" && sameUtcDay(item.queuedAt || item.dueAt, nowIso))
  ];
  for (const item of shadowRecords) {
    const familyId = item.strategyFamily || item.family || item.strategy?.family || item.paperLearning?.scope?.family || item.entryRationale?.strategy?.family || null;
    const regimeId = item.regimeAtEntry || item.regime || item.paperLearning?.scope?.regime || item.entryRationale?.regimeSummary?.regime || null;
    const conditionId = item.marketConditionAtEntry || item.marketCondition?.conditionId || item.paperLearning?.scope?.condition || item.entryRationale?.marketCondition?.conditionId || null;
    const strategyId = item.strategyAtEntry || item.strategy || item.paperLearning?.scope?.strategy || item.entryRationale?.strategy?.activeStrategy || null;
    incrementCounter(shadowRegimeFamilyCounts, buildPaperScopeKey([regimeId, familyId]));
    incrementCounter(shadowConditionStrategyCounts, buildPaperScopeKey([conditionId, strategyId]));
  }
  const family = strategySummary.family || null;
  const regime = regimeSummary.regime || null;
  const session = sessionSummary.session || null;
  const conditionId = marketConditionSummary.conditionId || null;
  const strategyId = strategySummary.activeStrategy || null;
  const regimeFamilyKey = buildPaperScopeKey([regime, family]);
  const conditionStrategyKey = buildPaperScopeKey([conditionId, strategyId]);
  const familyLimit = Math.max(0, Math.round(config.paperLearningMaxProbePerFamilyPerDay || 0));
  const regimeLimit = Math.max(0, Math.round(config.paperLearningMaxProbePerRegimePerDay || 0));
  const sessionLimit = Math.max(0, Math.round(config.paperLearningMaxProbePerSessionPerDay || 0));
  const regimeFamilyLimit = Math.max(0, Math.round(config.paperLearningMaxProbePerRegimeFamilyPerDay || 0));
  const conditionStrategyLimit = Math.max(0, Math.round(config.paperLearningMaxProbePerConditionStrategyPerDay || 0));
  const shadowRegimeFamilyLimit = Math.max(0, Math.round(config.paperLearningMaxShadowPerRegimeFamilyPerDay || 0));
  const shadowConditionStrategyLimit = Math.max(0, Math.round(config.paperLearningMaxShadowPerConditionStrategyPerDay || 0));
  const familyUsed = family ? (familyCounts[family] || 0) : 0;
  const regimeUsed = regime ? (regimeCounts[regime] || 0) : 0;
  const sessionUsed = session ? (sessionCounts[session] || 0) : 0;
  const regimeFamilyUsed = regimeFamilyKey ? (regimeFamilyCounts[regimeFamilyKey] || 0) : 0;
  const conditionStrategyUsed = conditionStrategyKey ? (conditionStrategyCounts[conditionStrategyKey] || 0) : 0;
  const shadowRegimeFamilyUsed = regimeFamilyKey ? (shadowRegimeFamilyCounts[regimeFamilyKey] || 0) : 0;
  const shadowConditionStrategyUsed = conditionStrategyKey ? (shadowConditionStrategyCounts[conditionStrategyKey] || 0) : 0;
  const familyRemaining = familyLimit > 0 ? Math.max(0, familyLimit - familyUsed) : Infinity;
  const regimeRemaining = regimeLimit > 0 ? Math.max(0, regimeLimit - regimeUsed) : Infinity;
  const sessionRemaining = sessionLimit > 0 ? Math.max(0, sessionLimit - sessionUsed) : Infinity;
  const regimeFamilyRemaining = regimeFamilyLimit > 0 ? Math.max(0, regimeFamilyLimit - regimeFamilyUsed) : Infinity;
  const conditionStrategyRemaining = conditionStrategyLimit > 0 ? Math.max(0, conditionStrategyLimit - conditionStrategyUsed) : Infinity;
  const shadowRegimeFamilyRemaining = shadowRegimeFamilyLimit > 0 ? Math.max(0, shadowRegimeFamilyLimit - shadowRegimeFamilyUsed) : Infinity;
  const shadowConditionStrategyRemaining = shadowConditionStrategyLimit > 0 ? Math.max(0, shadowConditionStrategyLimit - shadowConditionStrategyUsed) : Infinity;
  const familyNovelty = familyLimit > 0 ? clamp(1 - (familyUsed / familyLimit), 0, 1) : (familyUsed === 0 ? 1 : 0.5);
  const regimeNovelty = regimeLimit > 0 ? clamp(1 - (regimeUsed / regimeLimit), 0, 1) : (regimeUsed === 0 ? 1 : 0.5);
  const sessionNovelty = sessionLimit > 0 ? clamp(1 - (sessionUsed / sessionLimit), 0, 1) : (sessionUsed === 0 ? 1 : 0.5);
  const regimeFamilyNovelty = regimeFamilyLimit > 0 ? clamp(1 - (regimeFamilyUsed / regimeFamilyLimit), 0, 1) : (regimeFamilyUsed === 0 ? 1 : 0.5);
  const conditionStrategyNovelty = conditionStrategyLimit > 0 ? clamp(1 - (conditionStrategyUsed / conditionStrategyLimit), 0, 1) : (conditionStrategyUsed === 0 ? 1 : 0.5);
  const recordCount = records.length;
  const scopeRarityScore = clamp(recordCount <= 0 ? 1 : 1 / Math.sqrt(recordCount + 1), 0, 1);
  const noveltyScore = clamp(
    familyNovelty * 0.22 +
    regimeNovelty * 0.18 +
    sessionNovelty * 0.1 +
    regimeFamilyNovelty * 0.22 +
    conditionStrategyNovelty * 0.18 +
    scopeRarityScore * 0.1,
    0,
    1
  );
  return {
    scope: {
      family,
      regime,
      session,
      condition: conditionId,
      strategy: strategyId
    },
    probeCaps: {
      familyLimit,
      familyUsed,
      familyRemaining: Number.isFinite(familyRemaining) ? familyRemaining : null,
      regimeLimit,
      regimeUsed,
      regimeRemaining: Number.isFinite(regimeRemaining) ? regimeRemaining : null,
      sessionLimit,
      sessionUsed,
      sessionRemaining: Number.isFinite(sessionRemaining) ? sessionRemaining : null,
      regimeFamilyKey: regimeFamilyKey || null,
      regimeFamilyLimit,
      regimeFamilyUsed,
      regimeFamilyRemaining: Number.isFinite(regimeFamilyRemaining) ? regimeFamilyRemaining : null,
      conditionStrategyKey: conditionStrategyKey || null,
      conditionStrategyLimit,
      conditionStrategyUsed,
      conditionStrategyRemaining: Number.isFinite(conditionStrategyRemaining) ? conditionStrategyRemaining : null
    },
    shadowCaps: {
      regimeFamilyKey: regimeFamilyKey || null,
      regimeFamilyLimit: shadowRegimeFamilyLimit,
      regimeFamilyUsed: shadowRegimeFamilyUsed,
      regimeFamilyRemaining: Number.isFinite(shadowRegimeFamilyRemaining) ? shadowRegimeFamilyRemaining : null,
      conditionStrategyKey: conditionStrategyKey || null,
      conditionStrategyLimit: shadowConditionStrategyLimit,
      conditionStrategyUsed: shadowConditionStrategyUsed,
      conditionStrategyRemaining: Number.isFinite(shadowConditionStrategyRemaining) ? shadowConditionStrategyRemaining : null
    },
    noveltyScore,
    canOpenProbe:
      (familyLimit === 0 || familyUsed < familyLimit) &&
      (regimeLimit === 0 || regimeUsed < regimeLimit) &&
      (sessionLimit === 0 || sessionUsed < sessionLimit) &&
      (regimeFamilyLimit === 0 || regimeFamilyUsed < regimeFamilyLimit) &&
      (conditionStrategyLimit === 0 || conditionStrategyUsed < conditionStrategyLimit),
    canQueueShadow:
      (shadowRegimeFamilyLimit === 0 || shadowRegimeFamilyUsed < shadowRegimeFamilyLimit) &&
      (shadowConditionStrategyLimit === 0 || shadowConditionStrategyUsed < shadowConditionStrategyLimit),
    rarityScore: scopeRarityScore
  };
}

function collectPaperShadowCapReasons(samplingState = {}) {
  const reasons = [];
  if (
    (samplingState.shadowCaps?.regimeFamilyLimit || 0) > 0 &&
    (samplingState.shadowCaps?.regimeFamilyUsed || 0) >= (samplingState.shadowCaps?.regimeFamilyLimit || 0)
  ) {
    reasons.push("paper_learning_regime_family_shadow_cap_reached");
  }
  if (
    (samplingState.shadowCaps?.conditionStrategyLimit || 0) > 0 &&
    (samplingState.shadowCaps?.conditionStrategyUsed || 0) >= (samplingState.shadowCaps?.conditionStrategyLimit || 0)
  ) {
    reasons.push("paper_learning_condition_strategy_shadow_cap_reached");
  }
  return reasons;
}

function buildPaperActiveLearningState({
  score = {},
  threshold = 0,
  confidenceBreakdown = {},
  signalQualitySummary = {},
  dataQualitySummary = {},
  reasons = [],
  samplingState = {}
} = {}) {
  const thresholdBuffer = Math.max(0.0001, Math.abs(score.probability - threshold) + 0.02);
  const nearMissScore = clamp(1 - Math.min(1, Math.abs((score.probability || 0) - threshold) / thresholdBuffer), 0, 1);
  const disagreementScore = clamp(safeValue(score.disagreement) / 0.2, 0, 1);
  const uncertaintyScore = clamp(1 - safeValue(confidenceBreakdown.overallConfidence, 0.5), 0, 1);
  const signalScore = clamp(safeValue(signalQualitySummary.overallScore, 0.5), 0, 1);
  const dataScore = clamp(safeValue(dataQualitySummary.overallScore, 0.5), 0, 1);
  const blockerDensity = clamp(reasons.length / 5, 0, 1);
  const noveltyScore = clamp(safeValue(samplingState.noveltyScore, 0.5), 0, 1);
  const rarityScore = clamp(safeValue(samplingState.rarityScore, 0.5), 0, 1);
  const activeLearningScore = clamp(
    nearMissScore * 0.26 +
    disagreementScore * 0.18 +
    uncertaintyScore * 0.2 +
    blockerDensity * 0.12 +
    noveltyScore * 0.12 +
    rarityScore * 0.08 +
    signalScore * 0.02 +
    dataScore * 0.02,
    0,
    1
  );
  const focusReason = disagreementScore >= 0.6
    ? "model_disagreement"
    : uncertaintyScore >= 0.48
      ? "confidence_uncertainty"
      : nearMissScore >= 0.7
        ? "threshold_near_miss"
        : blockerDensity >= 0.5
          ? "multi_blocker_conflict"
          : noveltyScore >= 0.7 || rarityScore >= 0.65
            ? "rare_scope"
            : "standard_learning";
  return {
    activeLearningScore,
    focusReason,
    nearMissScore,
    disagreementScore,
    uncertaintyScore,
    blockerDensity
  };
}

function isHardPaperLearningBlocker(reason) {
  return [
    "health_circuit_open",
    "exchange_truth_freeze",
    "exchange_safety_blocked",
    "lifecycle_attention_required",
    "quality_quorum_observe_only",
    "quality_quorum_degraded",
    "session_blocked",
    "drift_blocked",
    "operator_ack_required"
  ].includes(reason);
}

function classifyPaperBlocker(reason) {
  if ([
    "health_circuit_open",
    "exchange_truth_freeze",
    "exchange_safety_blocked",
    "lifecycle_attention_required",
    "reconcile_required",
    "operator_ack_required"
  ].includes(reason)) {
    return "safety";
  }
  if ([
    "capital_governor_blocked",
    "capital_governor_recovery",
    "execution_cost_budget_exceeded",
    "strategy_cooldown",
    "strategy_budget_cooled",
    "family_budget_cooled",
    "cluster_budget_cooled",
    "regime_budget_cooled",
    "factor_budget_cooled",
    "daily_risk_budget_cooled",
    "regime_kill_switch_active",
    "baseline_core_strategy_suspended",
    "baseline_core_outside_preferred_set"
  ].includes(reason)) {
    return "governance";
  }
  if ([
    "committee_veto",
    "model_confidence_too_low",
    "model_uncertainty_abstain",
    "committee_confidence_too_low",
    "strategy_fit_too_low",
    "paper_learning_probe_budget_reached",
    "paper_learning_family_probe_cap_reached",
    "paper_learning_regime_probe_cap_reached",
    "paper_learning_session_probe_cap_reached",
    "paper_learning_regime_family_probe_cap_reached",
    "paper_learning_condition_strategy_probe_cap_reached",
    "paper_learning_regime_family_shadow_cap_reached",
    "paper_learning_condition_strategy_shadow_cap_reached",
    "paper_learning_novelty_too_low"
  ].includes(reason)) {
    return "learning";
  }
  return "market";
}

function resolvePaperTradeBucket(trade = {}) {
  const outcome = trade.paperLearningOutcome?.outcome || null;
  if (["good_trade", "acceptable_trade"].includes(outcome)) {
    return "good";
  }
  if (["bad_trade", "early_exit", "late_exit", "execution_drag"].includes(outcome)) {
    return "weak";
  }
  return "neutral";
}

function buildPaperThresholdSandboxState({
  journal = {},
  config = {},
  strategySummary = {},
  regimeSummary = {},
  sessionSummary = {},
  nowIso
} = {}) {
  if (!config.paperLearningSandboxEnabled) {
    return {
      active: false,
      status: "disabled",
      thresholdShift: 0,
      sampleSize: 0,
      scope: {
        family: strategySummary.family || null,
        regime: regimeSummary.regime || null,
        session: sessionSummary.session || null
      }
    };
  }
  const scope = {
    family: strategySummary.family || null,
    regime: regimeSummary.regime || null,
    session: sessionSummary.session || null
  };
  const records = (journal?.trades || [])
    .filter((trade) => (trade.brokerMode || "paper") === "paper" && trade.exitAt && isWithinLookback(trade.exitAt, nowIso, 60 * 24 * 21))
    .filter((trade) => {
      const familyMatch = !scope.family || trade.strategyFamily === scope.family;
      const regimeMatch = !scope.regime || trade.regimeAtEntry === scope.regime;
      const sessionMatch = !scope.session || trade.sessionAtEntry === scope.session;
      return familyMatch && regimeMatch && sessionMatch;
    })
    .slice(-18);
  const minClosedTrades = Math.max(1, Math.round(config.paperLearningSandboxMinClosedTrades || 3));
  if (records.length < minClosedTrades) {
    return {
      active: false,
      status: "warmup",
      thresholdShift: 0,
      sampleSize: records.length,
      scope
    };
  }
  const goodCount = records.filter((trade) => resolvePaperTradeBucket(trade) === "good").length;
  const weakCount = records.filter((trade) => resolvePaperTradeBucket(trade) === "weak").length;
  const avgNetPnlPct = average(records.map((trade) => trade.netPnlPct || 0), 0);
  const avgExecutionQuality = average(records.map((trade) => trade.executionQualityScore || 0), 0);
  const goodRate = goodCount / Math.max(records.length, 1);
  const weakRate = weakCount / Math.max(records.length, 1);
  let thresholdShift = 0;
  let status = "observe";
  if (goodRate >= 0.62 && avgNetPnlPct > 0 && avgExecutionQuality >= 0.52) {
    thresholdShift = -Math.min(config.paperLearningSandboxMaxThresholdShift || 0.01, 0.004 + (goodRate - 0.62) * 0.02);
    status = "relax";
  } else if (weakRate >= 0.52 && avgNetPnlPct < 0) {
    thresholdShift = Math.min(config.paperLearningSandboxMaxThresholdShift || 0.01, 0.004 + (weakRate - 0.52) * 0.02);
    status = "tighten";
  }
  return {
    active: thresholdShift !== 0,
    status,
    thresholdShift: clamp(thresholdShift, -(config.paperLearningSandboxMaxThresholdShift || 0.01), config.paperLearningSandboxMaxThresholdShift || 0.01),
    sampleSize: records.length,
    goodRate,
    weakRate,
    avgNetPnlPct,
    avgExecutionQuality,
    scope
  };
}

function buildPaperLearningValueScore({
  score = {},
  threshold = 0,
  signalQualitySummary = {},
  confidenceBreakdown = {},
  dataQualitySummary = {},
  reasons = [],
  entryMode = "standard",
  samplingState = {},
  activeLearningState = {}
} = {}) {
  const thresholdBuffer = Math.max(0.0001, Math.abs(score.probability - threshold) + 0.02);
  const nearMissScore = clamp(1 - Math.min(1, Math.abs((score.probability || 0) - threshold) / thresholdBuffer), 0, 1);
  const disagreementScore = clamp(safeValue(score.disagreement) / 0.2, 0, 1);
  const signalScore = clamp(safeValue(signalQualitySummary.overallScore, 0.5), 0, 1);
  const dataScore = clamp(safeValue(dataQualitySummary.overallScore, 0.5), 0, 1);
  const confidenceScore = clamp(1 - safeValue(confidenceBreakdown.overallConfidence, 0.5) * 0.55, 0, 1);
  const blockerScore = clamp(reasons.length / 4, 0, 1);
  const noveltyScore = clamp(safeValue(samplingState.noveltyScore, 0.5), 0, 1);
  const rarityScore = clamp(safeValue(samplingState.rarityScore, 0.5), 0, 1);
  const activeLearningScore = clamp(safeValue(activeLearningState.activeLearningScore, 0.5), 0, 1);
  const modeBoost = entryMode === "paper_recovery_probe" ? 0.08 : entryMode === "paper_exploration" ? 0.05 : 0;
  return clamp(
    nearMissScore * 0.16 +
    disagreementScore * 0.08 +
    signalScore * 0.17 +
    dataScore * 0.15 +
    confidenceScore * 0.08 +
    blockerScore * 0.08 +
    noveltyScore * 0.08 +
    rarityScore * 0.06 +
    activeLearningScore * 0.14 +
    modeBoost,
    0,
    1
  );
}

function resolvePaperLearningLane({
  config = {},
  allow = false,
  entryMode = "standard",
  reasons = [],
  score = {},
  threshold = 0,
  signalQualitySummary = {},
  confidenceBreakdown = {},
  dataQualitySummary = {},
  paperLearningBudget = {},
  botMode = "paper",
  samplingState = {}
} = {}) {
  const activeLearningState = buildPaperActiveLearningState({
    score,
    threshold,
    confidenceBreakdown,
    signalQualitySummary,
    dataQualitySummary,
    reasons,
    samplingState
  });
  const learningValueScore = buildPaperLearningValueScore({
    score,
    threshold,
    signalQualitySummary,
    confidenceBreakdown,
    dataQualitySummary,
    reasons,
    entryMode,
    samplingState,
    activeLearningState
  });
  if (botMode !== "paper") {
    return {
      lane: allow ? "safe" : null,
      learningValueScore,
      activeLearningState
    };
  }
  if (allow) {
    return {
      lane: entryMode === "paper_exploration" || entryMode === "paper_recovery_probe" ? "probe" : "safe",
      learningValueScore,
      activeLearningState
    };
  }
  const nearThreshold = (score.probability || 0) >= threshold - (config.paperLearningNearMissThresholdBuffer || 0.025);
  const qualityOkay =
    safeValue(signalQualitySummary.overallScore, 0) >= (config.paperLearningMinSignalQuality || 0.4) &&
    safeValue(dataQualitySummary.overallScore, 0) >= (config.paperLearningMinDataQuality || 0.52);
  const hardBlocked = reasons.some((reason) => isHardPaperLearningBlocker(reason));
  const informativeShadowCase =
    nearThreshold ||
    safeValue(activeLearningState.activeLearningScore, 0) >= 0.5 ||
    safeValue(activeLearningState.disagreementScore, 0) >= 0.35 ||
    safeValue(activeLearningState.uncertaintyScore, 0) >= 0.48;
  const shadowQualityOkay =
    safeValue(signalQualitySummary.overallScore, 0) >= Math.max(0.34, (config.paperLearningMinSignalQuality || 0.4) - 0.06) &&
    safeValue(dataQualitySummary.overallScore, 0) >= Math.max(0.42, (config.paperLearningMinDataQuality || 0.52) - 0.08);
  if (informativeShadowCase && shadowQualityOkay && !hardBlocked && (paperLearningBudget.shadowRemaining || 0) > 0) {
    if (samplingState.canQueueShadow === false) {
      return {
        lane: null,
        learningValueScore,
        activeLearningState,
        shadowQueueBlockedByCap: true,
        shadowCapReasons: collectPaperShadowCapReasons(samplingState)
      };
    }
    return {
      lane: "shadow",
      learningValueScore,
      activeLearningState,
      shadowQueueBlockedByCap: false,
      shadowCapReasons: []
    };
  }
  return {
    lane: null,
    learningValueScore,
    activeLearningState,
    shadowQueueBlockedByCap: false,
    shadowCapReasons: []
  };
}

function buildStrategyAllocationGovernanceState({
  config = {},
  botMode = "paper",
  allow = false,
  reasons = [],
  learningLane = null,
  strategySummary = {},
  strategyAllocationSummary = {},
  paperLearningBudget = {},
  samplingState = {},
  canOpenAnotherPaperLearningPosition = true
} = {}) {
  const activeStrategy = strategySummary.activeStrategy || strategyAllocationSummary.activeStrategy || null;
  const activeFamily = strategySummary.family || strategyAllocationSummary.activeFamily || null;
  const preferredStrategy = strategyAllocationSummary.preferredStrategy || null;
  const preferredFamily = strategyAllocationSummary.preferredFamily || null;
  const posture = strategyAllocationSummary.posture || "neutral";
  const confidence = clamp(safeValue(strategyAllocationSummary.confidence, 0), 0, 1);
  const activeBias = safeValue(strategyAllocationSummary.activeBias, 0);
  const explorationWeight = clamp(safeValue(strategyAllocationSummary.explorationWeight, 0), 0, 1);
  const fitBoost = safeValue(strategyAllocationSummary.fitBoost, 0);
  const hardBlocked = reasons.some((reason) => isHardPaperLearningBlocker(reason));
  const shadowRemaining = Math.max(0, Math.round(paperLearningBudget.shadowRemaining || 0));
  const probeRemaining = Math.max(0, Math.round(paperLearningBudget.probeRemaining || 0));
  const canOpenProbe = canOpenAnotherPaperLearningPosition && probeRemaining > 0 && samplingState.canOpenProbe !== false;
  const canQueueShadow = shadowRemaining > 0 && !hardBlocked && samplingState.canQueueShadow !== false;
  const favorThreshold = Math.max(0.42, safeValue(config.strategyAllocationGovernanceMinConfidence, 0.44));
  const coolThreshold = Math.max(0.4, favorThreshold - 0.04);
  const notes = [...(strategyAllocationSummary.notes || [])];
  const preferenceMismatch =
    (preferredStrategy && activeStrategy && preferredStrategy !== activeStrategy) ||
    (preferredFamily && activeFamily && preferredFamily !== activeFamily);
  const state = {
    status: "neutral",
    applied: false,
    mode: "observe",
    recommendedLane: learningLane,
    priorityBoost: 0,
    posture,
    confidence,
    activeBias,
    preferredStrategy,
    preferredFamily,
    activeStrategy,
    activeFamily,
    preferenceMismatch,
    notes
  };

  if (botMode !== "paper" || !activeStrategy) {
    return state;
  }

  if (posture === "favor" && confidence >= favorThreshold && activeBias >= 0.08) {
    state.status = "favoring";
    state.priorityBoost = clamp(0.03 + confidence * 0.05 + explorationWeight * 0.04 + Math.max(0, fitBoost) * 0.4, 0.03, 0.12);
    if (allow && learningLane === "safe" && canOpenProbe && explorationWeight >= 0.12) {
      state.recommendedLane = "probe";
      state.mode = "priority_probe";
      state.applied = true;
      state.notes = [...notes, `Allocator geeft ${activeStrategy} extra paper-prioriteit binnen ${preferredFamily || activeFamily || "de huidige family"}.`];
      return state;
    }
    state.mode = state.priorityBoost >= 0.04 ? "priority" : "observe";
    state.applied = state.priorityBoost >= 0.04;
    if (state.applied) {
      state.notes = [...notes, `Allocator bevoordeelt ${activeStrategy} nu voor extra paper-sampling.`];
    }
    return state;
  }

  if (posture === "cool" && confidence >= coolThreshold && activeBias <= -0.08) {
    state.status = "cooling";
    if (allow && learningLane === "safe" && canOpenProbe) {
      state.recommendedLane = "probe";
      state.mode = "probe_only";
      state.applied = true;
      state.notes = [...notes, `Allocator koelt ${activeStrategy} af; alleen probe-exposure blijft nu verantwoord.`];
      return state;
    }
    if (!allow && canQueueShadow) {
      state.recommendedLane = "shadow";
      state.mode = "shadow_only";
      state.applied = true;
      state.notes = [...notes, `Allocator koelt ${activeStrategy} af; shadow learning krijgt nu voorrang.`];
      return state;
    }
    state.mode = "cooling_only";
    state.notes = [...notes, `Allocator koelt ${activeStrategy} af, maar er is nu geen extra probe/shadow capaciteit beschikbaar.`];
    return state;
  }

  return state;
}

function applyPaperLearningGuidance({
  botMode = "paper",
  guidance = {},
  allow = false,
  entryMode = "standard",
  learningLane = null,
  learningValueScore = 0,
  activeLearningState = {},
  paperLearningBudget = {},
  samplingState = {},
  score = {},
  threshold = 0
} = {}) {
  if (botMode !== "paper" || !guidance?.active) {
    return {
      learningLane,
      learningValueScore,
      activeLearningState,
      opportunityBoost: 0,
      applied: false
    };
  }

  const nearMiss = safeValue(score.probability, 0) >= threshold - 0.035;
  let nextLearningLane = learningLane;
  if (
    guidance.preferredLane === "probe" &&
    allow &&
    nextLearningLane === "safe" &&
    ["standard", "paper_exploration", "paper_recovery_probe"].includes(entryMode) &&
    nearMiss
  ) {
    nextLearningLane = "probe";
  } else if (
    guidance.preferredLane === "shadow" &&
    !allow &&
    (nextLearningLane === "safe" || !nextLearningLane) &&
    (paperLearningBudget.shadowRemaining || 0) > 0 &&
    samplingState.canQueueShadow !== false
  ) {
    nextLearningLane = "shadow";
  }

  const positiveLearningBoost =
    safeValue(guidance.priorityBoost, 0) * 0.7 +
    safeValue(guidance.probeBoost, 0) * (allow ? 0.75 : 0.35) +
    safeValue(guidance.shadowBoost, 0) * (!allow ? 0.7 : 0.2);
  const negativeLearningPenalty = safeValue(guidance.cautionPenalty, 0) * 0.45;
  const nextLearningValueScore = clamp(learningValueScore + positiveLearningBoost - negativeLearningPenalty, 0, 1);
  const nextActiveLearningScore = clamp(
    safeValue(activeLearningState.activeLearningScore, 0) +
      safeValue(guidance.priorityBoost, 0) * 0.55 +
      safeValue(guidance.probeBoost, 0) * 0.35 +
      safeValue(guidance.shadowBoost, 0) * 0.32 -
      safeValue(guidance.cautionPenalty, 0) * 0.24,
    0,
    1
  );
  const opportunityBoost = num(clamp(
    (allow
      ? safeValue(guidance.priorityBoost, 0) + safeValue(guidance.probeBoost, 0) * 0.8
      : safeValue(guidance.priorityBoost, 0) * 0.45 + safeValue(guidance.shadowBoost, 0) * 0.9) -
      safeValue(guidance.cautionPenalty, 0) * 0.8,
    -0.05,
    0.12
  ), 4);

  return {
    learningLane: nextLearningLane,
    learningValueScore: nextLearningValueScore,
    activeLearningState: {
      ...activeLearningState,
      activeLearningScore: nextActiveLearningScore,
      focusReason: activeLearningState.focusReason || guidance.focusReason || "paper_learning_guidance"
    },
    opportunityBoost,
    applied:
      nextLearningLane !== learningLane ||
      nextLearningValueScore !== learningValueScore ||
      nextActiveLearningScore !== safeValue(activeLearningState.activeLearningScore, 0) ||
      opportunityBoost !== 0
  };
}

function applyOfflineLearningGuidance({
  botMode = "paper",
  guidance = {},
  learningValueScore = 0,
  activeLearningState = {}
} = {}) {
  if (!guidance?.active) {
    return {
      thresholdShift: 0,
      sizeMultiplier: 1,
      cautionPenalty: 0,
      executionCaution: 0,
      featureTrustPenalty: 0,
      independentWeakGroupPressure: 0,
      correlatedWeakFeaturePressure: 0,
      adjacentFeaturePressure: 0,
      featurePressureSources: [],
      impactedFeatureGroups: [],
      opportunityShift: 0,
      learningValueScore,
      activeLearningState,
      applied: false
    };
  }

  const rawThresholdShift = clamp(safeValue(guidance.thresholdShift, 0), -0.018, 0.018);
  const rawSizeMultiplier = clamp(safeValue(guidance.sizeMultiplier, 1), 0.84, 1.08);
  const baseCautionPenalty = clamp(safeValue(guidance.cautionPenalty, 0), 0, 0.14);
  const executionCaution = clamp(safeValue(guidance.executionCaution, 0), 0, 0.18);
  const featureTrustPenalty = clamp(safeValue(guidance.featureTrustPenalty, guidance.featurePenalty || 0), 0, 0.12);
  const independentWeakGroupPressure = clamp(safeValue(guidance.independentWeakGroupPressure, 0), 0, 0.04);
  const correlatedWeakFeaturePressure = clamp(safeValue(guidance.correlatedWeakFeaturePressure, 0), 0, 0.02);
  const adjacentFeaturePressure = clamp(safeValue(guidance.adjacentFeaturePressure, 0), 0, 0.03);
  const featurePressureSources = Array.isArray(guidance.featurePressureSources) ? guidance.featurePressureSources : [];
  const impactedFeatureGroups = Array.isArray(guidance.impactedFeatureGroups) ? guidance.impactedFeatureGroups : [];
  const cautionPenalty = clamp(baseCautionPenalty + executionCaution * 0.55 + featureTrustPenalty * 0.4, 0, 0.18);
  const thresholdShift = botMode === "paper"
    ? rawThresholdShift
    : Math.max(0, rawThresholdShift);
  const baseSizeMultiplier = botMode === "paper"
    ? rawSizeMultiplier
    : Math.min(1, rawSizeMultiplier);
  const executionAwareSizeMultiplier = clamp(
    baseSizeMultiplier *
      (1 - executionCaution * (botMode === "paper" ? 0.72 : 0.88)) *
      (1 - featureTrustPenalty * 0.42),
    0.78,
    botMode === "paper" ? 1.08 : 1
  );
  const learningBias = botMode === "paper"
    ? clamp(
        Math.max(0, -thresholdShift) * 1.5 +
          Math.max(0, executionAwareSizeMultiplier - 1) * 0.18 -
          cautionPenalty * 0.45,
        -0.04,
        0.06
      )
    : clamp(-cautionPenalty * 0.35, -0.04, 0.015);
  const nextLearningValueScore = clamp(learningValueScore + learningBias, 0, 1);
  const nextActiveLearningScore = clamp(
    safeValue(activeLearningState.activeLearningScore, 0) +
      Math.max(0, -thresholdShift) * 0.55 +
      Math.max(0, executionAwareSizeMultiplier - 1) * 0.14 -
      cautionPenalty * 0.24,
    0,
    1
  );
  const opportunityShift = num(clamp(
    (thresholdShift < 0 ? Math.abs(thresholdShift) * 1.9 : -thresholdShift * 1.6) +
      (executionAwareSizeMultiplier - 1) * 0.42 -
      cautionPenalty * 0.42,
    -0.08,
    0.08
  ), 4);

  return {
    thresholdShift: num(thresholdShift, 4),
    sizeMultiplier: num(executionAwareSizeMultiplier, 4),
    cautionPenalty: num(cautionPenalty, 4),
    executionCaution: num(executionCaution, 4),
    featureTrustPenalty: num(featureTrustPenalty, 4),
    independentWeakGroupPressure: num(independentWeakGroupPressure, 4),
    correlatedWeakFeaturePressure: num(correlatedWeakFeaturePressure, 4),
    adjacentFeaturePressure: num(adjacentFeaturePressure, 4),
    featurePressureSources: featurePressureSources.slice(0, 4),
    impactedFeatureGroups: impactedFeatureGroups.slice(0, 4),
    opportunityShift,
    learningValueScore: nextLearningValueScore,
    activeLearningState: {
      ...activeLearningState,
      activeLearningScore: nextActiveLearningScore,
      focusReason: activeLearningState.focusReason || guidance.focusReason || "offline_learning_guidance"
    },
    applied:
      thresholdShift !== 0 ||
      executionAwareSizeMultiplier !== 1 ||
      cautionPenalty !== 0 ||
      executionCaution !== 0 ||
      featureTrustPenalty !== 0 ||
      opportunityShift !== 0 ||
      nextLearningValueScore !== learningValueScore ||
      nextActiveLearningScore !== safeValue(activeLearningState.activeLearningScore, 0)
  };
}

function buildLowConfidencePressure({
  score = {},
  threshold = 0,
  baseThreshold = 0,
  confidenceBreakdown = {},
  calibrationWarmup = 0,
  minCalibrationConfidence = 0,
  sessionThresholdPenalty = 0,
  driftThresholdPenalty = 0,
  selfHealThresholdPenalty = 0,
  metaThresholdPenalty = 0,
  thresholdTuningAdjustment = {},
  parameterGovernorAdjustment = {},
  strategyMetaSummary = {},
  missedTradeTuningApplied = {},
  trendStateTuning = {},
  offlineLearningGuidanceApplied = {},
  signalQualitySummary = {},
  dataQualitySummary = {}
} = {}) {
  const thresholdPenaltyPressure = clamp(
    Math.max(0, safeValue(sessionThresholdPenalty, 0)) +
      Math.max(0, safeValue(driftThresholdPenalty, 0)) +
      Math.max(0, safeValue(selfHealThresholdPenalty, 0)) +
      Math.max(0, safeValue(metaThresholdPenalty, 0)) +
      Math.max(0, safeValue(thresholdTuningAdjustment.adjustment, 0)) +
      Math.max(0, safeValue(parameterGovernorAdjustment.thresholdShift, 0)) +
      Math.max(0, safeValue(strategyMetaSummary.thresholdShift || 0, 0)) +
      Math.max(0, safeValue(trendStateTuning.thresholdShift, 0)),
    0,
    0.18
  );
  const thresholdRelief = clamp(
    Math.max(0, -safeValue(missedTradeTuningApplied.thresholdShift, 0)),
    0,
    0.08
  );
  const calibrationWarmupGap = clamp(1 - safeValue(calibrationWarmup, 0), 0, 1);
  const calibrationConfidenceGap = clamp(0.5 - safeValue(score.calibrationConfidence, 0.5), 0, 1);
  const modelConfidenceGap = clamp(0.62 - safeValue(confidenceBreakdown.modelConfidence, 0.62), 0, 1);
  const dataConfidenceGap = clamp(0.6 - safeValue(confidenceBreakdown.dataConfidence, 0.6), 0, 1);
  const executionConfidenceGap = clamp(0.58 - safeValue(confidenceBreakdown.executionConfidence, 0.58), 0, 1);
  const disagreementPressure = clamp(safeValue(score.disagreement, 0) / 0.28, 0, 1);
  const disagreementAudit = score.disagreementAudit || {};
  const rawDisagreement = clamp(safeValue(disagreementAudit.rawDisagreement, safeValue(score.disagreement, 0)), 0, 1);
  const weightedDisagreement = clamp(safeValue(disagreementAudit.weightedDisagreement, safeValue(score.disagreement, 0)), 0, 1);
  const disagreementCompression = clamp(rawDisagreement - weightedDisagreement, 0, 0.2);
  const effectiveDisagreementPressure = clamp(weightedDisagreement / 0.28, 0, 1);
  const dominantDisagreementPair = disagreementAudit.dominantPair || null;
  const blendAudit = score.blendAudit || {};
  const blendDrag = clamp(
    safeValue(blendAudit.championToBlendDrag, 0),
    0,
    0.12
  );
  const challengerNeutralDrag = clamp(safeValue(blendAudit.challenger?.neutralDrag, 0), 0, 0.08);
  const transformerNeutralDrag = clamp(safeValue(blendAudit.transformer?.neutralDrag, 0), 0, 0.08);
  const sequenceNeutralDrag = clamp(safeValue(blendAudit.sequence?.neutralDrag, 0), 0, 0.08);
  const dominantBlendDragSource = [
    ["challenger", challengerNeutralDrag],
    ["transformer", transformerNeutralDrag],
    ["sequence", sequenceNeutralDrag]
  ].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
  const featureTrustPenalty = clamp(safeValue(offlineLearningGuidanceApplied.featureTrustPenalty, 0), 0, 0.12);
  const executionCaution = clamp(safeValue(offlineLearningGuidanceApplied.executionCaution, 0), 0, 0.18);
  const featurePressureSources = Array.isArray(offlineLearningGuidanceApplied.featurePressureSources)
    ? offlineLearningGuidanceApplied.featurePressureSources
    : [];
  const impactedFeatureGroups = Array.isArray(offlineLearningGuidanceApplied.impactedFeatureGroups)
    ? offlineLearningGuidanceApplied.impactedFeatureGroups
    : [];
  const dominantFeaturePressureSource = featurePressureSources
    .slice()
    .sort((left, right) => safeValue(right.penalty, 0) - safeValue(left.penalty, 0))[0]?.source || null;
  const dominantFeaturePressureGroup = impactedFeatureGroups
    .slice()
    .sort((left, right) => safeValue(right.penalty, 0) - safeValue(left.penalty, 0))[0]?.group || null;
  const independentWeakGroupCount = impactedFeatureGroups.length;
  const featureTrustNarrowPressure =
    independentWeakGroupCount > 0 &&
    independentWeakGroupCount <= 1 &&
    featureTrustPenalty <= 0.08 &&
    !featurePressureSources.some((item) => ["parity_missing_in_live", "pruning_drop_candidate"].includes(item?.source || "") && safeValue(item?.penalty, 0) >= 0.018);
  const edgeToThreshold = num(safeValue(score.probability, 0) - safeValue(threshold, 0), 4);
  const edgeToBaseThreshold = num(safeValue(score.probability, 0) - safeValue(baseThreshold, 0), 4);
  const signalQuality = clamp(safeValue(signalQualitySummary.overallScore, 0), 0, 1);
  const dataQuality = clamp(safeValue(dataQualitySummary.overallScore, 0), 0, 1);
  const softDataQualityEligible =
    dataQuality >= 0.58 ||
    (
      dataQuality >= 0.36 &&
      safeValue(confidenceBreakdown.dataConfidence, 0) >= 0.58
    );
  const driverScores = {
    calibration_warmup: calibrationWarmupGap * 0.95 + Math.max(0, thresholdPenaltyPressure - 0.01) * 1.4,
    calibration_confidence: calibrationConfidenceGap * 1.25 + Math.max(0, safeValue(minCalibrationConfidence, 0) - safeValue(score.calibrationConfidence, 0)) * 0.8,
    threshold_penalty_stack: thresholdPenaltyPressure * 8.5 - thresholdRelief * 2.4,
    auxiliary_blend_drag: blendDrag * 10.5 + Math.max(challengerNeutralDrag, transformerNeutralDrag, sequenceNeutralDrag) * 4.5,
    model_disagreement: disagreementPressure * 1.05 + Math.max(0, rawDisagreement - 0.22) * 0.35,
    feature_trust: featureTrustPenalty * 8.2,
    execution_quality: executionConfidenceGap * 1.12 + executionCaution * 2.1,
    data_quality: dataConfidenceGap * 1.05 + Math.max(0, 0.58 - dataQuality) * 0.7,
    model_confidence: modelConfidenceGap * 1.08
  };
  const [primaryDriver = "model_confidence", primaryScore = 0] = Object.entries(driverScores)
    .sort((left, right) => right[1] - left[1])[0] || [];
  const softNearMissEligible =
    edgeToThreshold >= -0.045 ||
    (
      edgeToThreshold >= -0.055 &&
      ["calibration_warmup", "feature_trust", "auxiliary_blend_drag", "model_disagreement"].includes(primaryDriver)
    ) ||
    (
      primaryDriver === "threshold_penalty_stack" &&
      edgeToBaseThreshold >= -0.055
    );
  const softExecutionConfidenceEligible =
    safeValue(confidenceBreakdown.executionConfidence, 0) >= 0.56 ||
    (
      safeValue(confidenceBreakdown.executionConfidence, 0) >= 0.52 &&
      ["calibration_warmup", "feature_trust", "auxiliary_blend_drag", "model_disagreement"].includes(primaryDriver)
    );
  const reliefEligible =
    softNearMissEligible &&
    signalQuality >= 0.64 &&
    softDataQualityEligible &&
    softExecutionConfidenceEligible &&
    safeValue(confidenceBreakdown.dataConfidence, 0) >= 0.58 &&
      (
        primaryDriver === "model_disagreement"
          ? effectiveDisagreementPressure <= 0.42
          : disagreementPressure <= 0.42
      ) &&
      executionCaution <= 0.08 &&
      (
      (
        featureTrustPenalty <= 0.08 &&
        ["calibration_warmup", "calibration_confidence", "threshold_penalty_stack"].includes(primaryDriver)
      ) ||
      (
        primaryDriver === "auxiliary_blend_drag" &&
        blendDrag <= 0.045 &&
        disagreementPressure <= 0.32 &&
        featureTrustPenalty <= 0.08 &&
        executionCaution <= 0.06
      ) ||
      (
        primaryDriver === "model_disagreement" &&
        rawDisagreement <= 0.22 &&
        disagreementCompression >= 0.03 &&
        featureTrustPenalty <= 0.08 &&
        executionCaution <= 0.06
      ) ||
      (
        primaryDriver === "feature_trust" &&
        featureTrustNarrowPressure &&
        ["inverse_attribution", "pruning_guard_only", null].includes(dominantFeaturePressureSource)
      )
    );

  const note =
    primaryDriver === "calibration_warmup"
      ? "Calibrator warmt nog op; sterke paper setups vallen daardoor net onder de entry-threshold."
      : primaryDriver === "calibration_confidence"
        ? "Calibrated confidence blijft nog zwak terwijl de rest van de setup relatief gezond is."
        : primaryDriver === "threshold_penalty_stack"
          ? "Threshold-penalties stapelen nu harder op dan de ruwe setupkwaliteit rechtvaardigt."
          : primaryDriver === "auxiliary_blend_drag"
            ? `${dominantBlendDragSource || "auxiliary"} trekt de champion-score met weinig directional edge terug richting neutraal.`
          : primaryDriver === "feature_trust"
            ? `${dominantFeaturePressureGroup || "feature"}-druk uit ${describeFeaturePressureSource(dominantFeaturePressureSource)} duwt deze setup nu onder de vertrouwenstrigger.`
            : primaryDriver === "execution_quality"
              ? "Execution-confidence en cost-caution drukken dit signaal onder de gewone entry-grens."
              : primaryDriver === "data_quality"
                ? "Datakwaliteit en quorum houden de confidence nu zichtbaar omlaag."
                : primaryDriver === "model_disagreement"
                  ? `${dominantDisagreementPair || "ensemble"} blijft verdeeld, maar een deel van die spanning komt uit zwakke auxiliary signalen.`
                  : "Model confidence blijft te laag ten opzichte van de huidige threshold-stack.";

  return {
    active: edgeToThreshold < 0 || primaryScore > 0.08,
    primaryDriver,
    edgeToThreshold,
    edgeToBaseThreshold,
    thresholdPenaltyPressure: num(thresholdPenaltyPressure, 4),
    thresholdRelief: num(thresholdRelief, 4),
    calibrationWarmup: num(calibrationWarmup, 4),
    calibrationWarmupGap: num(calibrationWarmupGap, 4),
    calibrationConfidenceGap: num(calibrationConfidenceGap, 4),
    disagreementPressure: num(disagreementPressure, 4),
    effectiveDisagreementPressure: num(effectiveDisagreementPressure, 4),
    rawDisagreement: num(rawDisagreement, 4),
    weightedDisagreement: num(weightedDisagreement, 4),
    disagreementCompression: num(disagreementCompression, 4),
    dominantDisagreementPair,
    blendDrag: num(blendDrag, 4),
    challengerNeutralDrag: num(challengerNeutralDrag, 4),
    transformerNeutralDrag: num(transformerNeutralDrag, 4),
    sequenceNeutralDrag: num(sequenceNeutralDrag, 4),
    dominantBlendDragSource,
    modelConfidenceGap: num(modelConfidenceGap, 4),
    dataConfidenceGap: num(dataConfidenceGap, 4),
    executionConfidenceGap: num(executionConfidenceGap, 4),
    featureTrustPenalty: num(featureTrustPenalty, 4),
    dominantFeaturePressureSource,
    dominantFeaturePressureGroup,
    independentWeakGroupCount,
    featureTrustNarrowPressure,
    executionCaution: num(executionCaution, 4),
    signalQuality: num(signalQuality, 4),
    dataQuality: num(dataQuality, 4),
    reliefEligible,
    note
  };
}

function describeFeaturePressureSource(source) {
  switch (source) {
    case "pruning_drop_candidate":
      return "learning-pruning (drop-candidate)";
    case "pruning_guard_only":
      return "learning-pruning (guard-only)";
    case "parity_missing_in_live":
      return "live-parity verlies";
    case "inverse_attribution":
      return "inverse feature-attributie";
    default:
      return source || "feature_governance";
  }
}

function toBoolean(value, fallback = false) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }
  if (value == null) {
    return fallback;
  }
  return Boolean(value);
}

function summarizeExchangeCapabilities(capabilities = {}) {
  return {
    region: capabilities.region || "GLOBAL",
    spotEnabled: toBoolean(capabilities.spotEnabled, true),
    marginEnabled: toBoolean(capabilities.marginEnabled),
    futuresEnabled: toBoolean(capabilities.futuresEnabled),
    shortingEnabled: toBoolean(capabilities.shortingEnabled),
    leveragedTokensEnabled: toBoolean(capabilities.leveragedTokensEnabled),
    spotBearMarketMode: capabilities.spotBearMarketMode || "defensive_rebounds",
    notes: [...(capabilities.notes || [])]
  };
}

function buildDowntrendPolicy({ marketSnapshot = {}, marketStructureSummary = {}, regimeSummary = {}, exchangeCapabilities = {}, trendStateSummary = null } = {}) {
  const market = marketSnapshot.market || {};
  const baseDowntrendScore = clamp(
    Math.max(0, -safeValue(market.momentum20)) * 18 * 0.24 +
    Math.max(0, -safeValue(market.emaGap)) * 38 * 0.18 +
    Math.max(0, -safeValue(market.dmiSpread)) * 2.5 * 0.12 +
    Math.max(0, -safeValue(market.swingStructureScore)) * 0.14 +
    safeValue(market.downsideAccelerationScore) * 0.08 +
    Math.max(0, -safeValue(market.anchoredVwapGapPct)) * 18 * 0.05 +
    (safeValue(market.supertrendDirection) < 0 ? 0.16 : 0) +
    safeValue(market.bearishPatternScore) * 0.11 +
    safeValue(marketStructureSummary.longSqueezeScore) * 0.08 +
    (regimeSummary.regime === "trend" ? 0.06 : regimeSummary.regime === "high_vol" ? 0.04 : 0),
    0,
    1
  );
  const downtrendScore = clamp(
    trendStateSummary
      ? baseDowntrendScore * 0.52 + safeValue(trendStateSummary.downtrendScore) * 0.48
      : baseDowntrendScore,
    0,
    1
  );
  return {
    downtrendScore,
    strongDowntrend: downtrendScore >= 0.58,
    severeDowntrend: downtrendScore >= 0.74,
    shortingUnavailable: exchangeCapabilities.shortingEnabled === false,
    spotOnly: exchangeCapabilities.spotEnabled !== false && exchangeCapabilities.shortingEnabled === false
  };
}

function matchesScopedAdjustment(entry = {}, strategyId = null, regimeId = null) {
  const strategies = entry.affectedStrategies || [];
  const regimes = entry.affectedRegimes || [];
  const strategyMatch = !strategies.length || (strategyId && strategies.includes(strategyId));
  const regimeMatch = !regimes.length || (regimeId && regimes.includes(regimeId));
  return strategyMatch && regimeMatch;
}

function resolveTrendStateTuning({ marketSnapshot = {}, strategySummary = {}, regimeSummary = {}, trendStateSummary = null } = {}) {
  const market = marketSnapshot.market || {};
  const family = strategySummary.family || "";
  const strategyId = strategySummary.activeStrategy || "";
  const trendFamily = ["trend_following", "breakout"].includes(family);
  const meanReversionFamily = family === "mean_reversion";
  const matureTrend = safeValue(trendStateSummary?.maturityScore, safeValue(market.trendMaturityScore)) >= 0.6;
  const exhaustedTrend = safeValue(trendStateSummary?.exhaustionScore, safeValue(market.trendExhaustionScore)) >= 0.68;
  const strongDownsideAcceleration = safeValue(market.downsideAccelerationScore) >= 0.6 || safeValue(trendStateSummary?.downtrendScore) >= 0.68;
  const strongUpsideAcceleration = safeValue(market.upsideAccelerationScore) >= 0.6 || safeValue(trendStateSummary?.uptrendScore) >= 0.68;
  const strongNegativeStructure = (trendStateSummary?.direction || "") === "downtrend" || safeValue(market.swingStructureScore) <= -0.32;
  const strongPositiveStructure = (trendStateSummary?.direction || "") === "uptrend" || safeValue(market.swingStructureScore) >= 0.32;
  const lowDataConfidence = safeValue(trendStateSummary?.dataConfidenceScore, 0.7) < 0.55;
  let thresholdShift = 0;
  let sizeMultiplier = 1;
  const notes = [];

  if (trendFamily && ["trend", "breakout"].includes(regimeSummary.regime || "")) {
    if (matureTrend && strongPositiveStructure && !exhaustedTrend && !strongDownsideAcceleration) {
      thresholdShift -= 0.008;
      sizeMultiplier *= 1.04;
      notes.push("trend_follow_through");
    }
    if (exhaustedTrend || strongDownsideAcceleration) {
      thresholdShift += 0.01;
      sizeMultiplier *= 0.9;
      notes.push("trend_exhaustion_caution");
    }
  }

  if (meanReversionFamily && strongDownsideAcceleration && strongNegativeStructure && !["bear_rally_reclaim"].includes(strategyId)) {
    thresholdShift += 0.01;
    sizeMultiplier *= 0.88;
    notes.push("mean_reversion_vs_downtrend");
  }

  if (meanReversionFamily && strategyId === "bear_rally_reclaim" && exhaustedTrend && strongDownsideAcceleration) {
    thresholdShift -= 0.006;
    sizeMultiplier *= 1.03;
    notes.push("bear_bounce_probe_window");
  }

  if (trendFamily && strongUpsideAcceleration && exhaustedTrend) {
    thresholdShift += 0.004;
    sizeMultiplier *= 0.96;
    notes.push("late_trend_extension");
  }
  if (lowDataConfidence) {
    thresholdShift += 0.006;
    sizeMultiplier *= 0.9;
    notes.push("soft_data_confidence");
  }

  return {
    active: notes.length > 0,
    thresholdShift: clamp(thresholdShift, -0.012, 0.012),
    sizeMultiplier: clamp(sizeMultiplier, 0.82, 1.06),
    notes
  };
}

export class RiskManager {
  constructor(config) {
    this.config = config;
  }

  getDailyRealizedPnl(journal, nowIso) {
    const tradePnl = (journal?.trades || [])
      .filter((trade) => matchesBrokerMode(trade, this.config.botMode) && trade.exitAt && sameUtcDay(trade.exitAt, nowIso))
      .reduce((total, trade) => total + (trade.pnlQuote || 0), 0);
    const scaleOutPnl = (journal?.scaleOuts || [])
      .filter((event) => matchesBrokerMode(event, this.config.botMode) && event.at && sameUtcDay(event.at, nowIso))
      .reduce((total, event) => total + (event.realizedPnl || 0), 0);
    return tradePnl + scaleOutPnl;
  }

  getRecentTradeForSymbol(journal, symbol) {
    return [...(journal?.trades || [])]
      .reverse()
      .find((trade) => matchesBrokerMode(trade, this.config.botMode) && trade.symbol === symbol && trade.exitAt);
  }

  getDailyEntryCountForSymbol(journal, runtime, symbol, nowIso) {
    const closedEntries = (journal?.trades || []).filter(
      (trade) => matchesBrokerMode(trade, this.config.botMode) && trade.symbol === symbol && trade.entryAt && sameUtcDay(trade.entryAt, nowIso)
    ).length;
    const openEntries = (runtime?.openPositions || []).filter(
      (position) => matchesBrokerMode(position, this.config.botMode) && position.symbol === symbol && position.entryAt && sameUtcDay(position.entryAt, nowIso)
    ).length;
    return closedEntries + openEntries;
  }

  getLossStreak(journal, symbol = null, options = {}) {
    let streak = 0;
    const trades = [...(journal?.trades || [])].reverse();
    const nowIso = options.nowIso || null;
    const lookbackMinutes = Number.isFinite(options.lookbackMinutes) ? options.lookbackMinutes : 0;
    for (const trade of trades) {
      if (!trade.exitAt) {
        continue;
      }
      if (!matchesBrokerMode(trade, this.config.botMode)) {
        continue;
      }
      if (symbol && trade.symbol !== symbol) {
        continue;
      }
      if (!isWithinLookback(trade.exitAt, nowIso, lookbackMinutes)) {
        break;
      }
      if ((trade.pnlQuote || 0) < 0) {
        streak += 1;
        continue;
      }
      break;
    }
    return streak;
  }


  getCurrentExposure(runtime) {
    return (runtime.openPositions || []).reduce((total, position) => {
      const notional = safeValue(position?.notional, Number.NaN);
      const quantity = safeValue(position?.quantity, 0);
      const entryPrice = safeValue(position?.entryPrice, 0);
      const fallbackNotional = quantity * entryPrice;
      const contribution = Number.isFinite(notional) ? notional : fallbackNotional;
      return total + safeValue(contribution, 0);
    }, 0);
  }

  getOptimizerAdjustments(strategySummary = {}) {
    const optimizer = strategySummary.optimizer || {};
    const strategyId = strategySummary.activeStrategy || null;
    const familyId = strategySummary.family || null;

    const globalThresholdTilt = safeValue(optimizer.thresholdTilt);
    const familyThresholdTilt = safeValue(optimizer.familyThresholdTilts?.[familyId]);
    const strategyThresholdTilt = safeValue(optimizer.strategyThresholdTilts?.[strategyId]);
    const globalConfidenceTilt = safeValue(optimizer.confidenceTilt);
    const familyConfidenceTilt = safeValue(optimizer.familyConfidenceTilts?.[familyId]);
    const strategyConfidenceTilt = safeValue(optimizer.strategyConfidenceTilts?.[strategyId]);

    return {
      sampleSize: optimizer.sampleSize || 0,
      sampleConfidence: safeValue(optimizer.sampleConfidence),
      globalThresholdTilt,
      familyThresholdTilt,
      strategyThresholdTilt,
      thresholdAdjustment: clamp(globalThresholdTilt * 0.2 + familyThresholdTilt * 0.35 + strategyThresholdTilt * 0.45, -0.12, 0.12),
      globalConfidenceTilt,
      familyConfidenceTilt,
      strategyConfidenceTilt,
      strategyConfidenceAdjustment: clamp(globalConfidenceTilt * 0.2 + familyConfidenceTilt * 0.35 + strategyConfidenceTilt * 0.45, -0.1, 0.1)
    };
  }

  getThresholdTuningAdjustment(thresholdTuningSummary = {}, strategySummary = {}, regimeSummary = {}) {
    const applied = thresholdTuningSummary?.appliedRecommendation || null;
    if (!applied || !["probation", "confirmed"].includes(applied.status || "")) {
      return {
        adjustment: 0,
        status: "inactive",
        id: null,
        confidence: 0
      };
    }
    if (!matchesScopedAdjustment(applied, strategySummary?.activeStrategy || null, regimeSummary?.regime || null)) {
      return {
        adjustment: 0,
        status: "out_of_scope",
        id: applied.id || null,
        confidence: safeValue(applied.confidence || 0)
      };
    }
    return {
      adjustment: clamp(safeValue(applied.adjustment || 0), -0.06, 0.06),
      status: applied.status || "probation",
      id: applied.id || null,
      confidence: safeValue(applied.confidence || 0)
    };
  }

  resolveMissedTradeTuning(missedTradeTuningSummary = {}, strategySummary = {}, marketConditionSummary = {}) {
    const scope = missedTradeTuningSummary?.scope || {};
    const conditionId = marketConditionSummary?.conditionId || null;
    const familyId = strategySummary?.family || null;
    const strategyId = strategySummary?.activeStrategy || null;
    const inScope =
      (!scope.conditionId || scope.conditionId === conditionId) &&
      (!scope.familyId || scope.familyId === familyId) &&
      (!scope.strategyId || scope.strategyId === strategyId);
    if (!inScope || !["priority", "guarded", "observe"].includes(missedTradeTuningSummary?.status || "")) {
      return {
        active: false,
        thresholdShift: 0,
        paperProbeEligible: false,
        shadowPriority: false,
        action: "observe",
        confidence: 0,
        blocker: null,
        note: null
      };
    }
    return {
      active: true,
      thresholdShift: clamp(safeValue(missedTradeTuningSummary.thresholdShift, 0), -0.018, 0.018),
      paperProbeEligible: Boolean(missedTradeTuningSummary.paperProbeEligible),
      shadowPriority: Boolean(missedTradeTuningSummary.shadowPriority),
      action: missedTradeTuningSummary.action || "observe",
      confidence: safeValue(missedTradeTuningSummary.confidence, 0),
      blocker: missedTradeTuningSummary.topBlocker || null,
      blockerSofteningRecommendation: missedTradeTuningSummary.blockerSofteningRecommendation || null,
      blockerHardeningRecommendation: missedTradeTuningSummary.blockerHardeningRecommendation || null,
      note: missedTradeTuningSummary.note || null,
      scope: {
        conditionId: scope.conditionId || null,
        familyId: scope.familyId || null,
        strategyId: scope.strategyId || null
      }
    };
  }

  resolveAdaptiveExitPolicy(exitLearningSummary = {}, position = {}) {
    const strategyId = position.strategyAtEntry || position.strategyDecision?.activeStrategy || position.entryRationale?.strategy?.activeStrategy || null;
    const regimeId = position.regimeAtEntry || position.entryRationale?.regimeSummary?.regime || null;
    const familyId = position.strategyFamily || position.strategyDecision?.family || position.entryRationale?.strategy?.family || null;
    const conditionId = position.marketConditionAtEntry || position.entryRationale?.marketCondition?.conditionId || null;
    const conditionPolicy = (exitLearningSummary?.conditionPolicies || []).find((item) => item.conditionId === conditionId && item.familyId === familyId) || null;
    const strategyPolicy = (exitLearningSummary?.strategyPolicies || []).find((item) => item.id === strategyId) || null;
    const regimePolicy = (exitLearningSummary?.regimePolicies || []).find((item) => item.id === regimeId) || null;
    const policies = [conditionPolicy, strategyPolicy, regimePolicy].filter(Boolean);
    if (!policies.length) {
      return {
        active: false,
        scaleOutFractionMultiplier: 1,
        scaleOutTriggerMultiplier: 1,
        trailingStopMultiplier: 1,
        maxHoldMinutesMultiplier: 1,
        preferredExitStyle: "balanced",
        trailTightnessBias: 0,
        trimBias: 0,
        holdTolerance: 0,
        maxHoldBias: 0,
        sources: []
      };
    }
    return {
      active: true,
      scaleOutFractionMultiplier: clamp(average(policies.map((item) => safeValue(item.scaleOutFractionMultiplier || 1)), 1), 0.75, 1.25),
      scaleOutTriggerMultiplier: clamp(average(policies.map((item) => safeValue(item.scaleOutTriggerMultiplier || 1)), 1), 0.78, 1.25),
      trailingStopMultiplier: clamp(average(policies.map((item) => safeValue(item.trailingStopMultiplier || 1)), 1), 0.82, 1.22),
      maxHoldMinutesMultiplier: clamp(average(policies.map((item) => safeValue(item.maxHoldMinutesMultiplier || 1)), 1), 0.75, 1.25),
      preferredExitStyle: conditionPolicy?.preferredExitStyle || "balanced",
      trailTightnessBias: clamp(average(policies.map((item) => safeValue(item.trailTightnessBias || 0)), 0), -0.2, 0.2),
      trimBias: clamp(average(policies.map((item) => safeValue(item.trimBias || 0)), 0), -0.2, 0.2),
      holdTolerance: clamp(average(policies.map((item) => safeValue(item.holdTolerance || 0)), 0), -0.2, 0.2),
      maxHoldBias: clamp(average(policies.map((item) => safeValue(item.maxHoldBias || 0)), 0), -0.2, 0.2),
      sources: policies.map((item) => item.id)
    };
  }

  resolveParameterGovernor(parameterGovernorSummary = {}, strategySummary = {}, regimeSummary = {}) {
    const strategyId = strategySummary.activeStrategy || null;
    const regimeId = regimeSummary.regime || null;
    const scopes = [
      ...((parameterGovernorSummary.strategyScopes || []).filter((item) => item.id === strategyId)),
      ...((parameterGovernorSummary.regimeScopes || []).filter((item) => item.id === regimeId))
    ];
    if (!scopes.length) {
      return {
        active: false,
        thresholdShift: 0,
        stopLossMultiplier: 1,
        takeProfitMultiplier: 1,
        trailingStopMultiplier: 1,
        scaleOutTriggerMultiplier: 1,
        scaleOutFractionMultiplier: 1,
        maxHoldMinutesMultiplier: 1,
        executionAggressivenessBias: 1,
        sources: []
      };
    }
    const avg = (key, fallback = 1) => average(scopes.map((item) => safeValue(item[key], fallback)), fallback);
    return {
      active: true,
      thresholdShift: clamp(avg("thresholdShift", 0), -(this.config.parameterGovernorMaxThresholdShift || 0.03), this.config.parameterGovernorMaxThresholdShift || 0.03),
      stopLossMultiplier: clamp(avg("stopLossMultiplier", 1), 1 - (this.config.parameterGovernorMaxStopLossMultiplierDelta || 0.14), 1 + (this.config.parameterGovernorMaxStopLossMultiplierDelta || 0.14)),
      takeProfitMultiplier: clamp(avg("takeProfitMultiplier", 1), 1 - (this.config.parameterGovernorMaxTakeProfitMultiplierDelta || 0.18), 1 + (this.config.parameterGovernorMaxTakeProfitMultiplierDelta || 0.18)),
      trailingStopMultiplier: clamp(avg("trailingStopMultiplier", 1), 0.82, 1.18),
      scaleOutTriggerMultiplier: clamp(avg("scaleOutTriggerMultiplier", 1), 0.84, 1.18),
      scaleOutFractionMultiplier: clamp(avg("scaleOutFractionMultiplier", 1), 0.84, 1.18),
      maxHoldMinutesMultiplier: clamp(avg("maxHoldMinutesMultiplier", 1), 0.82, 1.18),
      executionAggressivenessBias: clamp(avg("executionAggressivenessBias", 1), 0.82, 1.18),
      sources: scopes.map((item) => `${item.scopeType}:${item.id}`)
    };
  }

  resolveStrategyRetirement(strategyRetirementSummary = {}, strategySummary = {}) {
    const strategyId = strategySummary.activeStrategy || null;
    const policy = (strategyRetirementSummary.policies || []).find((item) => item.id === strategyId) || null;
    if (!policy) {
      return {
        active: false,
        status: "ready",
        sizeMultiplier: 1,
        blocked: false,
        reason: null
      };
    }
    return {
      active: true,
      status: policy.status || "observe",
      sizeMultiplier: clamp(safeValue(policy.sizeMultiplier || 1), 0, 1),
      blocked: (policy.status || "") === "retire",
      reason: policy.note || null,
      confidence: safeValue(policy.confidence || 0),
      statusTriggers: [...(policy.statusTriggers || [])]
    };
  }

  resolveExecutionCostBudget(executionCostSummary = {}, strategySummary = {}, regimeSummary = {}) {
    const minScopedTrades = Math.max(1, Math.round(safeValue(this.config.executionCostBudgetMinScopedTrades) || 3));
    if (executionCostSummary.stale) {
      return {
        active: false,
        status: executionCostSummary.status || "warmup",
        stale: true,
        blocked: false,
        sizeMultiplier: 1,
        averageTotalCostBps: safeValue(executionCostSummary.averageTotalCostBps || 0),
        averageSlippageDeltaBps: safeValue(executionCostSummary.averageSlippageDeltaBps || 0),
        latestTradeAt: executionCostSummary.latestTradeAt || null,
        freshnessHours: safeValue(executionCostSummary.freshnessHours, 0),
        notes: ["stale_execution_cost_sample"]
      };
    }
    const strategyId = strategySummary.activeStrategy || null;
    const regimeId = regimeSummary.regime || null;
    const strategyScope = (executionCostSummary.strategies || []).find((item) => item.id === strategyId) || null;
    const regimeScope = (executionCostSummary.regimes || []).find((item) => item.id === regimeId) || null;
    const scopes = [strategyScope, regimeScope].filter(Boolean);
    if (!scopes.length) {
      return {
        active: false,
        status: executionCostSummary.status || "warmup",
        blocked: false,
        sizeMultiplier: 1,
        averageTotalCostBps: safeValue(executionCostSummary.averageTotalCostBps || 0),
        averageBudgetCostBps: safeValue(executionCostSummary.averageBudgetCostBps || 0),
        averageExcessFeeBps: safeValue(executionCostSummary.averageExcessFeeBps || 0),
        minTradeCount: minScopedTrades
      };
    }
    const matureScopes = scopes.filter((item) => {
      const status = item.status || "warmup";
      if (status === "warmup") {
        return false;
      }
      if (Number.isFinite(item.tradeCount)) {
        return item.tradeCount >= minScopedTrades;
      }
      return true;
    });
    const averageTotalCostBps = average(matureScopes.map((item) => safeValue(item.averageTotalCostBps || 0)), safeValue(executionCostSummary.averageTotalCostBps || 0));
    const averageBudgetCostBps = average(matureScopes.map((item) => safeValue(item.averageBudgetCostBps || 0)), safeValue(executionCostSummary.averageBudgetCostBps || 0));
    const averageExcessFeeBps = average(matureScopes.map((item) => safeValue(item.averageExcessFeeBps || 0)), safeValue(executionCostSummary.averageExcessFeeBps || 0));
    const averageSlippageDeltaBps = average(matureScopes.map((item) => safeValue(item.averageSlippageDeltaBps || 0)), safeValue(executionCostSummary.averageSlippageDeltaBps || 0));
    if (!matureScopes.length) {
      return {
        active: false,
        status: "warmup",
        blocked: false,
        sizeMultiplier: 1,
        averageTotalCostBps: safeValue(executionCostSummary.averageTotalCostBps || 0),
        averageBudgetCostBps: safeValue(executionCostSummary.averageBudgetCostBps || 0),
        averageExcessFeeBps: safeValue(executionCostSummary.averageExcessFeeBps || 0),
        averageSlippageDeltaBps: safeValue(executionCostSummary.averageSlippageDeltaBps || 0),
        scopeTradeCount: scopes.reduce((total, item) => total + (item.tradeCount || 0), 0),
        minTradeCount: minScopedTrades,
        notes: ["execution_cost_scope_warmup"]
      };
    }
    const blocked = matureScopes.some((item) => (item.status || "") === "blocked");
    const caution = !blocked && matureScopes.some((item) => (item.status || "") === "caution");
    return {
      active: true,
      status: blocked ? "blocked" : caution ? "caution" : "ready",
      blocked,
      sizeMultiplier: blocked ? 0.58 : caution ? 0.82 : 1,
      averageTotalCostBps,
      averageBudgetCostBps,
      averageExcessFeeBps,
      averageSlippageDeltaBps,
      scopeTradeCount: matureScopes.reduce((total, item) => total + (item.tradeCount || 0), 0),
      minTradeCount: minScopedTrades,
      notes: [...new Set(matureScopes.map((item) => item.id).filter(Boolean))]
    };
  }

  resolveCapitalGovernor(capitalGovernorSummary = {}) {
    return {
      generatedAt: capitalGovernorSummary.generatedAt || null,
      active: Boolean(capitalGovernorSummary.status),
      status: capitalGovernorSummary.status || "warmup",
      allowEntries: capitalGovernorSummary.allowEntries !== false,
      blocked: capitalGovernorSummary.allowEntries === false,
      allowProbeEntries: Boolean(capitalGovernorSummary.allowProbeEntries),
      recoveryMode: Boolean(capitalGovernorSummary.recoveryMode),
      sizeMultiplier: clamp(safeValue(capitalGovernorSummary.sizeMultiplier ?? 1), 0, 1),
      latestTradeAt: capitalGovernorSummary.latestTradeAt || null,
      lastClosedTradeAgeHours: safeValue(capitalGovernorSummary.lastClosedTradeAgeHours, 0),
      blockerReasons: [...(capitalGovernorSummary.blockerReasons || [])],
      notes: [...(capitalGovernorSummary.notes || [])]
    };
  }

  evaluateEntry({
    symbol,
    score,
    marketSnapshot,
    newsSummary,
    announcementSummary = {},
    marketStructureSummary = {},
    marketSentimentSummary = {},
    volatilitySummary = {},
    calendarSummary = {},
    committeeSummary = {},
    rlAdvice = {},
    strategySummary = {},
    sessionSummary = {},
    driftSummary = {},
    selfHealState = {},
    metaSummary = {},
    timeframeSummary = {},
    pairHealthSummary = {},
    onChainLiteSummary = {},
    divergenceSummary = {},
    qualityQuorumSummary = {},
    executionCostSummary = {},
    strategyRetirementSummary = {},
    capitalGovernorSummary = {},
    missedTradeTuningSummary = {},
    marketConditionSummary = {},
    runtime,
    journal,
    balance,
    symbolStats,
    portfolioSummary = {},
    regimeSummary = { regime: "range" },
    thresholdTuningSummary = {},
    parameterGovernorSummary = {},
    capitalLadderSummary = {},
    nowIso
    ,
    venueConfirmationSummary = {},
    strategyMetaSummary = {},
    strategyAllocationSummary = {},
    baselineCoreSummary = {},
    paperLearningGuidance = {},
    offlineLearningGuidance = {},
    exchangeCapabilitiesSummary = {}
  }) {
    const reasons = [];
    const openPositions = runtime.openPositions || [];
    const openPositionsInMode = openPositions.filter((position) => matchesBrokerMode(position, this.config.botMode));
    const paperLearningMaxConcurrentPositions = Math.max(1, Math.round(this.config.paperLearningMaxConcurrentPositions || 1));
    const canOpenAnotherPaperLearningPosition = this.config.botMode !== "paper" || openPositionsInMode.length < paperLearningMaxConcurrentPositions;
    const baseThreshold = Math.max(this.config.modelThreshold, this.config.minModelConfidence);
    const optimizerAdjustments = this.getOptimizerAdjustments(strategySummary);
    const thresholdTuningAdjustment = this.getThresholdTuningAdjustment(thresholdTuningSummary, strategySummary, regimeSummary);
    const parameterGovernorAdjustment = this.resolveParameterGovernor(parameterGovernorSummary, strategySummary, regimeSummary);
    const missedTradeTuningApplied = this.resolveMissedTradeTuning(missedTradeTuningSummary, strategySummary, marketConditionSummary);
    const strategyRetirementPolicy = this.resolveStrategyRetirement(strategyRetirementSummary, strategySummary);
    const executionCostBudget = this.resolveExecutionCostBudget(executionCostSummary, strategySummary, regimeSummary);
    const capitalGovernor = this.resolveCapitalGovernor(capitalGovernorSummary);
    const exchangeCapabilities = summarizeExchangeCapabilities(exchangeCapabilitiesSummary);
    const marketStateSummary = buildMarketStateSummary({
      marketFeatures: marketSnapshot.market || {},
      bookFeatures: marketSnapshot.book || {},
      newsSummary,
      announcementSummary,
      qualityQuorumSummary,
      venueConfirmationSummary,
      timeframeSummary
    });
    const trendStateSummary = marketStateSummary.trendStateSummary;
    const dataQualitySummary = buildDataQualitySummary({
      newsSummary,
      announcementSummary,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      onChainLiteSummary,
      qualityQuorumSummary,
      venueConfirmationSummary,
      bookFeatures: marketSnapshot.book || {}
    });
    const signalQualitySummary = buildSignalQualitySummary({
      marketFeatures: marketSnapshot.market || {},
      bookFeatures: marketSnapshot.book || {},
      strategySummary,
      trendStateSummary,
      qualityQuorumSummary,
      venueConfirmationSummary,
      newsSummary
    });
    const preliminaryConfidenceBreakdown = buildConfidenceBreakdown({
      score,
      trendStateSummary,
      signalQualitySummary,
      venueConfirmationSummary,
      qualityQuorumSummary,
      strategySummary,
      executionPlan: {}
    });
    const downtrendPolicy = buildDowntrendPolicy({
      marketSnapshot,
      marketStructureSummary,
      regimeSummary,
      exchangeCapabilities,
      trendStateSummary
    });
    const trendStateTuning = resolveTrendStateTuning({ marketSnapshot, strategySummary, regimeSummary, trendStateSummary });
    const relativeStrengthComposite = buildRelativeStrengthComposite(marketSnapshot.market || {});
    const downsideVolDominance = buildDownsideVolDominance(marketSnapshot.market || {});
    const acceptanceQuality = buildAcceptanceQuality(marketSnapshot.market || {});
    const replenishmentQuality = buildReplenishmentQuality(marketSnapshot.book || {});
    const marketConditionConfidence = safeValue(marketConditionSummary.conditionConfidence, 0);
    const marketConditionRisk = safeValue(marketConditionSummary.conditionRisk, 0);
    const metaCautionReasons = getMetaCautionReasons(metaSummary);
    const hasDirectMetaCautionGate = metaCautionReasons.some((reason) => ["meta_gate_caution", "trade_quality_caution"].includes(reason));
    const sessionThresholdPenalty = safeValue(sessionSummary.thresholdPenalty || 0);
    const driftThresholdPenalty = safeValue(driftSummary.severity || 0) >= 0.82 ? 0.05 : safeValue(driftSummary.severity || 0) >= 0.45 ? 0.02 : 0;
    const rawSelfHealThresholdPenalty = safeValue(selfHealState.thresholdPenalty || 0);
    const selfHealThresholdPenalty = this.config.botMode === "paper" && canRelaxPaperSelfHeal(selfHealState)
      ? Math.min(rawSelfHealThresholdPenalty, 0.02)
      : rawSelfHealThresholdPenalty;
    const metaThresholdPenalty = safeValue(metaSummary.thresholdPenalty || 0);
    const calibrationWarmup = clamp(
      safeValue(
        score.calibrator?.warmupProgress ??
        score.calibrator?.globalConfidence ??
        score.calibrationConfidence ??
        0
      ),
      0,
      1
    );
    const paperWarmupDiscount = this.config.botMode === "paper" ? (1 - calibrationWarmup) * 0.06 : 0;
    const thresholdFloor = this.config.botMode === "paper"
      ? Math.max(0.5, this.config.minModelConfidence - paperWarmupDiscount)
      : this.config.minModelConfidence;
    let threshold = clamp(
      baseThreshold - optimizerAdjustments.thresholdAdjustment - paperWarmupDiscount + sessionThresholdPenalty + driftThresholdPenalty + selfHealThresholdPenalty + metaThresholdPenalty + thresholdTuningAdjustment.adjustment + parameterGovernorAdjustment.thresholdShift + safeValue(strategyMetaSummary.thresholdShift || 0) + missedTradeTuningApplied.thresholdShift,
      thresholdFloor,
      0.99
    );
    threshold = clamp(
      threshold +
      trendStateTuning.thresholdShift,
      thresholdFloor,
      0.99
    );
    let learningValueScore = 0;
    let activeLearningState = { activeLearningScore: 0 };
    const offlineLearningGuidanceApplied = applyOfflineLearningGuidance({
      botMode: this.config.botMode,
      guidance: offlineLearningGuidance,
      learningValueScore,
      activeLearningState
    });
    learningValueScore = offlineLearningGuidanceApplied.learningValueScore;
    activeLearningState = offlineLearningGuidanceApplied.activeLearningState;
    threshold = clamp(
      threshold + offlineLearningGuidanceApplied.thresholdShift,
      thresholdFloor,
      0.99
    );
    const paperThresholdSandbox = buildPaperThresholdSandboxState({
      journal,
      config: this.config,
      strategySummary,
      regimeSummary,
      sessionSummary,
      nowIso
    });
    const thresholdBeforeSandbox = threshold;
    if (this.config.botMode === "paper" && Number.isFinite(paperThresholdSandbox.thresholdShift)) {
      threshold = clamp(threshold + paperThresholdSandbox.thresholdShift, thresholdFloor, 0.99);
    }
    const standardConfidenceThreshold = clamp(
      threshold + (this.config.botMode === "paper" ? paperWarmupDiscount : 0),
      Math.max(this.config.minModelConfidence || 0, 0),
      0.99
    );
    const lowConfidencePressure = buildLowConfidencePressure({
      score,
      threshold,
      baseThreshold,
      confidenceBreakdown: preliminaryConfidenceBreakdown,
      calibrationWarmup,
      minCalibrationConfidence: this.config.minCalibrationConfidence,
      sessionThresholdPenalty,
      driftThresholdPenalty,
      selfHealThresholdPenalty,
      metaThresholdPenalty,
      thresholdTuningAdjustment,
      parameterGovernorAdjustment,
      strategyMetaSummary,
      missedTradeTuningApplied,
      trendStateTuning,
      offlineLearningGuidanceApplied,
      signalQualitySummary,
      dataQualitySummary
    });
    const setupQuality = buildSetupQualityAssessment({
      config: this.config,
      score,
      threshold,
      strategySummary,
      signalQualitySummary,
      confidenceBreakdown: preliminaryConfidenceBreakdown,
      dataQualitySummary,
      acceptanceQuality,
      replenishmentQuality,
      relativeStrengthComposite,
      downsideVolDominance,
      timeframeSummary,
      pairHealthSummary,
      venueConfirmationSummary,
      marketConditionSummary,
      marketStateSummary,
      regimeSummary
    });
    const strongTrendGuardOverride =
      ["trend_following", "breakout", "market_structure"].includes(strategySummary.family || "") &&
      relativeStrengthComposite > 0.004 &&
      acceptanceQuality >= 0.62 &&
      replenishmentQuality >= 0.54 &&
      (timeframeSummary.alignmentScore || 0) >= 0.58 &&
      (signalQualitySummary.overallScore || 0) >= 0.58 &&
      (preliminaryConfidenceBreakdown.executionConfidence || 0) >= 0.5 &&
      score.probability >= threshold + 0.03;
    const strategyConfidenceFloor = clamp(this.config.strategyMinConfidence - optimizerAdjustments.strategyConfidenceAdjustment + selfHealThresholdPenalty * 0.35, 0.1, 0.95);
    const dailyPnl = this.getDailyRealizedPnl(journal, nowIso);
    const dailyLossFraction = dailyPnl < 0 ? Math.abs(dailyPnl) / this.config.startingCash : 0;
    const currentExposure = this.getCurrentExposure(runtime);
    const totalEquityProxy = Math.max(balance.quoteFree + currentExposure, 1);
    const portfolioHeat = totalEquityProxy ? currentExposure / totalEquityProxy : 0;
    const lossStreakOptions = {
      nowIso,
      lookbackMinutes: this.config.lossStreakLookbackMinutes
    };
    const globalLossStreak = this.getLossStreak(journal, null, lossStreakOptions);
    const symbolLossStreak = this.getLossStreak(journal, symbol, lossStreakOptions);
    const sessionSizeMultiplier = clamp(safeValue(sessionSummary.sizeMultiplier) || 1, 0.2, 1);
    const driftSizeMultiplier = clamp((safeValue(driftSummary.severity || 0) >= 0.82) ? 0.55 : (safeValue(driftSummary.severity || 0) >= 0.45 ? 0.78 : 1), 0.2, 1);
    const rawSelfHealSizeMultiplier = clamp(safeValue(selfHealState.sizeMultiplier) || 1, 0, 1);
    const selfHealSizeMultiplier = this.config.botMode === "paper" &&
      selfHealState.mode === "low_risk_only" &&
      canRelaxPaperSelfHeal(selfHealState)
      ? Math.max(rawSelfHealSizeMultiplier, 0.72)
      : rawSelfHealSizeMultiplier;
    const paperLearningRecoveryActive = this.config.botMode === "paper" &&
      selfHealState.mode === "low_risk_only" &&
      canRelaxPaperSelfHeal(selfHealState);
    const metaSizeMultiplier = clamp(safeValue(metaSummary.sizeMultiplier) || 1, 0.1, 1.15);
    const strategyMetaSizeMultiplier = clamp(safeValue(strategyMetaSummary.sizeMultiplier) || 1, 0.75, 1.15);
    const venueSizeMultiplier = clamp((venueConfirmationSummary.status || "") === "blocked" ? 0.45 : (venueConfirmationSummary.confirmed ? 1.04 : 0.9), 0.45, 1.05);
    const capitalLadderSizeMultiplier = clamp(safeValue(capitalLadderSummary.sizeMultiplier) || 1, 0, 1.2);
    const capitalGovernorSizeMultiplier = clamp(capitalGovernor.sizeMultiplier || 1, 0, 1);
    const retirementSizeMultiplier = clamp(strategyRetirementPolicy.sizeMultiplier || 1, 0, 1);
    const executionCostSizeMultiplier = clamp(executionCostBudget.sizeMultiplier || 1, 0.45, 1);
    const spotDowntrendPenalty = downtrendPolicy.spotOnly && downtrendPolicy.strongDowntrend ? (downtrendPolicy.severeDowntrend ? 0.52 : 0.68) : 1;
    const lowRiskCandidate = ["trend_following", "mean_reversion", "orderflow"].includes(strategySummary.family || "") &&
      (marketSnapshot.book.spreadBps || 0) <= Math.max(this.config.maxSpreadBps * 0.4, 3) &&
      (marketSnapshot.market.realizedVolPct || 0) <= this.config.maxRealizedVolPct * 0.75 &&
      (newsSummary.riskScore || 0) <= 0.42 &&
      (calendarSummary.riskScore || 0) <= 0.42;
    const riskSensitiveFamily = ["breakout", "trend_following", "market_structure", "orderflow"].includes(strategySummary.family || "");
    const hostileTradeContext =
      setupQuality.hostilePhase ||
      setupQuality.hostileRegime ||
      ["range_acceptance", "late_crowded"].includes(marketStateSummary.phase || "");
    const marketConditionId = marketConditionSummary.conditionId || "";
    const conditionDrivenBreakoutFailure =
      ["breakout", "market_structure", "orderflow"].includes(strategySummary.family || "") &&
      marketConditionId === "failed_breakout" &&
      safeValue(marketConditionSummary.conditionConfidence, 0) >= 0.54 &&
      (marketSnapshot.market.breakoutFollowThroughScore || 0) < 0.52 &&
      score.probability < threshold + 0.1;
    const conditionDrivenBreakoutNotReady =
      ["breakout", "market_structure", "orderflow"].includes(strategySummary.family || "") &&
      marketConditionId === "range_break_risk" &&
      safeValue(marketConditionSummary.conditionConfidence, 0) < 0.62 &&
      (marketSnapshot.market.breakoutFollowThroughScore || 0) < 0.48 &&
      acceptanceQuality < 0.56 &&
      score.probability < threshold + 0.055;
    const ambiguityThreshold = getAmbiguityThreshold({
      regime: regimeSummary.regime || "range",
      family: strategySummary.family || "",
      marketConditionId
    });
    const chopContextFragile =
      ["breakout", "trend_following", "market_structure", "orderflow"].includes(strategySummary.family || "") &&
      (
        marketConditionId === "low_liquidity_caution" ||
        (marketStateSummary.phase || "") === "range_acceptance"
      ) &&
      safeValue(marketConditionSummary.conditionRisk, 0) >= 0.46 &&
      acceptanceQuality < 0.56 &&
      safeValue(signalQualitySummary.structureQuality, 0) < 0.62 &&
      score.probability < threshold + 0.055;
    const entryOverextended =
      ["trend_following", "breakout", "market_structure"].includes(strategySummary.family || "") &&
      (
        (marketSnapshot.market.closeLocation || 0) >= 0.84 ||
        (marketSnapshot.market.bollingerPosition || 0) >= 0.88
      ) &&
      (marketSnapshot.market.vwapGapPct || 0) >= 0.008 &&
      (trendStateSummary.exhaustionScore || 0) >= 0.62 &&
      (safeValue(marketConditionSummary.conditionRisk, 0) >= 0.42 || marketConditionId === "trend_exhaustion") &&
      score.probability < threshold + 0.12 &&
      !strongTrendGuardOverride;
    const meanReversionTooShallow =
      strategySummary.family === "mean_reversion" &&
      !["bear_rally_reclaim"].includes(strategySummary.activeStrategy || "") &&
      ["trend_continuation", "breakout_release"].includes(marketConditionId) &&
      (trendStateSummary.uptrendScore || 0) >= 0.64 &&
      (marketSnapshot.market.breakoutFollowThroughScore || 0) >= 0.56 &&
      (marketSnapshot.market.priceZScore || 0) > -0.75 &&
      acceptanceQuality < 0.58 &&
      score.probability < threshold + 0.12;
    const ambiguityScore = clamp(
      (safeValue(score.disagreement, 0) * 0.45) +
      (Math.max(0, 0.7 - safeValue(committeeSummary.agreement, 0)) * 0.35) +
      (Math.max(0, 0.62 - safeValue(signalQualitySummary.overallScore, 0)) * 0.28) +
      (Math.max(0, 0.58 - safeValue(confidenceBreakdown.executionConfidence, 0)) * 0.22),
      0,
      1
    );

    if (openPositions.length >= this.config.maxOpenPositions) {
      reasons.push("max_open_positions_reached");
    }
    if ((sessionSummary.blockerReasons || []).length) {
      reasons.push(...sessionSummary.blockerReasons);
    }
    if (capitalLadderSummary.allowEntries === false) {
      reasons.push("capital_ladder_shadow_only");
    }
    if (capitalGovernor.blocked) {
      reasons.push("capital_governor_blocked");
    }
    if ((timeframeSummary.blockerReasons || []).length) {
      reasons.push(...timeframeSummary.blockerReasons);
    }
    if ((driftSummary.blockerReasons || []).length) {
      reasons.push(...driftSummary.blockerReasons);
    }
    if (metaSummary.action === "block") {
      reasons.push(...(metaSummary.reasons || []));
    }
    if (pairHealthSummary.quarantined) {
      reasons.push("pair_health_quarantine");
    }
    if ((venueConfirmationSummary.status || "") === "blocked") {
      reasons.push(...(venueConfirmationSummary.blockerReasons || ["reference_venue_divergence"]));
    }
    const hasOpenPositionForSymbol = openPositions.some((position) => position.symbol === symbol);
    if (strategyRetirementPolicy.blocked) {
      reasons.push("strategy_retired");
    } else if (
      !hasOpenPositionForSymbol &&
      strategyRetirementPolicy.active &&
      (strategyRetirementPolicy.status || "") === "cooldown" &&
      score.probability < threshold + (this.config.botMode === "paper" ? 0.02 : 0.04) &&
      !(
        this.config.botMode === "paper" &&
        canRelaxPaperSelfHeal(selfHealState) &&
        safeValue(strategyRetirementPolicy.confidence, 0) < 0.72
      )
    ) {
      reasons.push("strategy_cooldown");
    }
    if (
      this.config.botMode === "paper" &&
      baselineCoreSummary.active &&
      baselineCoreSummary.enforce
    ) {
      const preferredStrategies = new Set(
        (baselineCoreSummary.preferredStrategies || [])
          .map((item) => item?.id || item)
          .filter(Boolean)
      );
      const suspendedStrategies = new Set(
        (baselineCoreSummary.suspendedStrategies || [])
          .map((item) => item?.id || item)
          .filter(Boolean)
      );
      if (suspendedStrategies.has(strategySummary.activeStrategy || "")) {
        reasons.push("baseline_core_strategy_suspended");
      } else if (preferredStrategies.size && !preferredStrategies.has(strategySummary.activeStrategy || "")) {
        reasons.push("baseline_core_outside_preferred_set");
      }
    }
    if (
      downtrendPolicy.spotOnly &&
      downtrendPolicy.strongDowntrend &&
      !["bear_rally_reclaim", "vwap_reversion", "zscore_reversion", "liquidity_sweep", "funding_rate_extreme"].includes(strategySummary.activeStrategy || "") &&
      score.probability < threshold + 0.08
    ) {
      reasons.push("spot_downtrend_guard");
    }
    if (["paused", "paper_fallback"].includes(selfHealState.mode)) {
      reasons.push("self_heal_pause_entries");
    }
    if (hasOpenPositionForSymbol) {
      reasons.push("position_already_open");
    }
    if (score.probability < standardConfidenceThreshold) {
      reasons.push("model_confidence_too_low");
    }
    if (score.shouldAbstain) {
      reasons.push("model_uncertainty_abstain");
    }
    const abstainReasons = [...new Set((score.abstainReasons || []).filter(Boolean))];
    if ((score.transformer?.confidence || 0) >= this.config.transformerMinConfidence && (score.transformer?.probability || 0) < threshold - 0.03) {
      reasons.push("transformer_challenger_reject");
    }
    if (marketSnapshot.book.spreadBps > this.config.maxSpreadBps) {
      reasons.push("spread_too_wide");
    }
    if (marketSnapshot.market.realizedVolPct > this.config.maxRealizedVolPct) {
      reasons.push("volatility_too_high");
    }
    const sellPressureConfirmed = this.config.botMode === "paper"
      ? hasConfirmedPaperSellPressure({ marketSnapshot, strategySummary, config: this.config })
      : (marketSnapshot.book.bookPressure || 0) < this.config.minBookPressureForEntry;
    if ((marketSnapshot.book.bookPressure || 0) < this.config.minBookPressureForEntry && sellPressureConfirmed) {
      reasons.push("orderbook_sell_pressure");
    }
    if ((marketSnapshot.market.bearishPatternScore || 0) > 0.72 && (marketSnapshot.market.momentum5 || 0) <= 0) {
      reasons.push("bearish_pattern_stack");
    }
    if (newsSummary.riskScore > 0.75) {
      reasons.push("negative_news_risk");
    }
    if ((announcementSummary.riskScore || 0) > 0.7) {
      reasons.push("exchange_notice_risk");
    }
    if ((calendarSummary.riskScore || 0) > 0.72 && (calendarSummary.proximityHours || 999) <= 24) {
      reasons.push("high_impact_event_imminent");
    }
    if ((sessionSummary.lowLiquidity || false) && (marketSnapshot.book.spreadBps || 0) > this.config.sessionLowLiquiditySpreadBps) {
      reasons.push("session_liquidity_guard");
    }
    if (sessionSummary.isWeekend && this.config.blockWeekendHighRiskStrategies && usesWeekendHighRiskStrategyGate(strategySummary)) {
      reasons.push("weekend_high_risk_strategy_block");
    }
    if ((marketStructureSummary.riskScore || 0) > 0.82) {
      reasons.push("market_structure_overheated");
    }
    if ((marketStructureSummary.crowdingBias || 0) > 0.7 && (marketStructureSummary.fundingRate || 0) > 0) {
      reasons.push("crowded_longing");
    }
    if ((marketStructureSummary.longSqueezeScore || 0) > 0.72) {
      reasons.push("long_squeeze_risk");
    }
    if ((marketStructureSummary.liquidationImbalance || 0) < -0.55 && (marketStructureSummary.liquidationIntensity || 0) > 0.35) {
      reasons.push("liquidation_sell_pressure");
    }
    if ((marketSentimentSummary.riskScore || 0) > 0.84 && (marketSentimentSummary.contrarianScore || 0) < -0.2) {
      reasons.push("macro_sentiment_overheated");
    }
    if ((onChainLiteSummary.riskOffScore || 0) > 0.82 || (onChainLiteSummary.stressScore || 0) > 0.78) {
      reasons.push("stablecoin_flow_risk_off");
    }
    if ((onChainLiteSummary.marketBreadthScore || 0) < 0.24 && (onChainLiteSummary.stressScore || 0) > 0.5) {
      reasons.push("onchain_breadth_weak");
    }
    if ((onChainLiteSummary.trendingScore || 0) > 0.82 && (onChainLiteSummary.riskOffScore || 0) > 0.62) {
      reasons.push("onchain_hype_extreme");
    }
    if ((volatilitySummary.riskScore || 0) > 0.86 && (marketSnapshot.market.realizedVolPct || 0) > this.config.maxRealizedVolPct * 0.55) {
      reasons.push("options_volatility_stress");
    }
    const committeeVetoIds = getCommitteeVetoIds(committeeSummary);
    const softPaperCommitteeDisagreement =
      this.config.botMode === "paper" &&
      isSoftPaperCommitteeDisagreementOnly({ committeeSummary, score });
    const redundantCommitteeVeto =
      this.config.botMode === "paper" &&
      isRedundantCommitteeVeto({ committeeVetoIds, portfolioSummary, strategySummary });
    if (committeeVetoIds.length && !softPaperCommitteeDisagreement && !redundantCommitteeVeto) {
      reasons.push("committee_veto");
    }
    const committeeGuardBuffer = this.config.botMode === "paper" ? 0.08 : 0.02;
    const committeeNetGuard = this.config.botMode === "paper" ? -0.14 : -0.05;
    const committeeProbabilityDelta = safeValue(committeeSummary.probability, 0.5) - safeValue(score.probability, 0.5);
    const softPaperCommitteeConfidence =
      this.config.botMode === "paper" &&
      isSoftPaperCommitteeConfidenceOnly({ committeeSummary, score, threshold });
    const redundantPaperCommitteeConfidence =
      this.config.botMode === "paper" &&
      isRedundantPaperCommitteeConfidence({ committeeSummary, score, threshold, reasons });
    if (
      (committeeSummary.confidence || 0) >= this.config.committeeMinConfidence &&
      (committeeSummary.probability || 0) < threshold - committeeGuardBuffer &&
      (committeeSummary.netScore || 0) <= committeeNetGuard &&
      committeeProbabilityDelta <= -0.01 &&
      !softPaperCommitteeConfidence &&
      !redundantPaperCommitteeConfidence
    ) {
      reasons.push("committee_confidence_too_low");
    }
    if ((committeeSummary.agreement || 0) < this.config.committeeMinAgreement && score.probability < threshold + 0.04) {
      reasons.push("committee_low_agreement");
    }
    if (setupQuality.score < this.config.tradeQualityMinScore && score.probability < threshold + 0.06) {
      reasons.push("setup_quality_too_low");
    }
    if (
      riskSensitiveFamily &&
      hostileTradeContext &&
      setupQuality.score < Math.min(0.92, this.config.tradeQualityCautionScore + 0.04) &&
      score.probability < threshold + 0.055 &&
      !strongTrendGuardOverride
    ) {
      reasons.push("setup_quality_not_exceptional");
    }
    const strategyFitGuardFloor = getStrategyFitGuardFloor(strategySummary, this.config.botMode);
    if ((strategySummary.confidence || 0) >= strategyConfidenceFloor && (strategySummary.fitScore || 0) < strategyFitGuardFloor && score.probability < threshold + 0.05) {
      reasons.push("strategy_fit_too_low");
    }
    if ((strategySummary.confidence || 0) >= strategyConfidenceFloor && (strategySummary.blockers || []).length && score.probability < threshold + 0.07) {
      reasons.push("strategy_context_mismatch");
    }
    if (globalLossStreak >= this.config.maxLossStreak && !paperLearningRecoveryActive) {
      reasons.push("portfolio_loss_streak_guard");
    }
    if (symbolLossStreak >= this.config.maxSymbolLossStreak && !paperLearningRecoveryActive) {
      reasons.push("symbol_loss_streak_guard");
    }
    if (dailyLossFraction >= this.config.maxDailyDrawdown) {
      reasons.push("daily_drawdown_limit_hit");
    }
    if (currentExposure / totalEquityProxy >= this.config.maxTotalExposureFraction) {
      reasons.push("max_total_exposure_reached");
    }
    const portfolioBlockingReasons = [
      ...(portfolioSummary.blockingReasons || []),
      ...((portfolioSummary.blockingReasons || []).length ? [] : (portfolioSummary.hardReasons || []))
    ];
    if (portfolioBlockingReasons.length) {
      reasons.push(...portfolioBlockingReasons);
    }
    if (executionCostBudget.blocked) {
      reasons.push("execution_cost_budget_exceeded");
    }
    if (
      ["trend_following", "breakout"].includes(strategySummary.family || "") &&
      (marketStateSummary.phase || "") === "late_crowded" &&
      (
        (preliminaryConfidenceBreakdown.executionConfidence || 0) < 0.46 ||
        (venueConfirmationSummary.status || "") === "blocked" ||
        executionCostBudget.blocked
      )
    ) {
      reasons.push("late_trend_execution_fragile");
    }
    if (
      strategySummary.family === "mean_reversion" &&
      (marketStateSummary.phase || "") === "healthy_downtrend" &&
      !["bear_rally_reclaim"].includes(strategySummary.activeStrategy || "") &&
      (marketStateSummary.trendFailure || 0) < 0.42 &&
      (signalQualitySummary.structureQuality || 0) < 0.58
    ) {
      reasons.push("mean_reversion_vs_healthy_downtrend");
    }
    if (
      strategySummary.family === "breakout" &&
      (marketStateSummary.phase || "") === "range_acceptance" &&
      (marketSnapshot.market.breakoutFollowThroughScore || 0) < 0.38 &&
      (
        executionCostBudget.blocked ||
        (marketSnapshot.book.spreadBps || 0) > Math.max(this.config.maxSpreadBps * 0.7, 8)
      ) &&
      !strongTrendGuardOverride
    ) {
      reasons.push("range_breakout_follow_through_weak");
    }
    if (conditionDrivenBreakoutFailure && !strongTrendGuardOverride) {
      reasons.push("failed_breakout_context");
    }
    if (conditionDrivenBreakoutNotReady && !strongTrendGuardOverride) {
      reasons.push("breakout_release_not_ready");
    }
    if (chopContextFragile && !strongTrendGuardOverride) {
      reasons.push("chop_regime_fragile");
    }
    if (
      ["trend_following", "breakout", "market_structure"].includes(strategySummary.family || "") &&
      (marketStateSummary.phase || "") === "late_crowded" &&
      safeValue(marketConditionSummary.conditionConfidence, 0) >= 0.56 &&
      score.probability < threshold + 0.12 &&
      !strongTrendGuardOverride
    ) {
      reasons.push("late_trend_crowding");
    }
    if (entryOverextended) {
      reasons.push("entry_overextended");
    }
    if (meanReversionTooShallow) {
      reasons.push("mean_reversion_too_shallow");
    }
    if (
      riskSensitiveFamily &&
      ambiguityScore >= ambiguityThreshold &&
      score.probability < threshold + 0.06 &&
      !strongTrendGuardOverride
    ) {
      reasons.push("ambiguous_setup_context");
    }
    const trendAcceptanceFamily = strategySummary.family || "";
    const activeStrategyId = strategySummary.activeStrategy || "";
    const usesBreakoutAcceptanceGate =
      trendAcceptanceFamily === "breakout" ||
      activeStrategyId === "market_structure_break";
    const usesTrendAcceptanceGate =
      ["trend_following", "breakout"].includes(trendAcceptanceFamily) ||
      activeStrategyId === "market_structure_break";
    const anchoredAcceptanceFailure =
      (marketSnapshot.market.anchoredVwapRejectionScore || 0) > 0.68 &&
      acceptanceQuality < 0.44 &&
      replenishmentQuality < 0.54;
    const breakoutAcceptanceFailure =
      (marketSnapshot.market.breakoutFollowThroughScore || 0) < 0.3 &&
      acceptanceQuality < 0.44 &&
      relativeStrengthComposite < 0.002;
    const severeBreakoutAcceptanceFailure =
      usesBreakoutAcceptanceGate &&
      (marketSnapshot.market.breakoutFollowThroughScore || 0) < 0.12 &&
      acceptanceQuality < 0.43 &&
      relativeStrengthComposite < 0.0025;
    const trendAcceptanceFailure =
      anchoredAcceptanceFailure ||
      (
        usesBreakoutAcceptanceGate &&
        breakoutAcceptanceFailure
      );
    const severeTrendFragility =
      ["trend_following", "breakout", "market_structure"].includes(strategySummary.family || "") &&
      relativeStrengthComposite < -0.006 &&
      acceptanceQuality < 0.34 &&
      replenishmentQuality < 0.46 &&
      downsideVolDominance > 0.24;
    if (
      usesTrendAcceptanceGate &&
      trendAcceptanceFailure &&
      (score.probability < threshold + 0.045 || severeTrendFragility || severeBreakoutAcceptanceFailure) &&
      !strongTrendGuardOverride
    ) {
      reasons.push("trend_acceptance_failed");
    }
    if (
      downsideVolDominance > 0.24 &&
      acceptanceQuality < 0.44 &&
      replenishmentQuality < 0.46 &&
      relativeStrengthComposite < 0.002 &&
      (score.probability < threshold + 0.04 || severeTrendFragility) &&
      !strongTrendGuardOverride
    ) {
      reasons.push("downside_vol_dominance");
    }
    if (
      ["trend_following", "breakout", "market_structure"].includes(strategySummary.family || "") &&
      relativeStrengthComposite < -0.0045 &&
      (score.probability < threshold + 0.04 || severeTrendFragility) &&
      !strongTrendGuardOverride &&
      !reasons.includes("relative_weakness_vs_market")
    ) {
      reasons.push("relative_weakness_vs_market");
    }
    if (
      strategySummary.family === "orderflow" &&
      replenishmentQuality < 0.46 &&
      acceptanceQuality < 0.42 &&
      (preliminaryConfidenceBreakdown.executionConfidence || 0) < 0.54 &&
      score.probability < threshold + 0.045
    ) {
      reasons.push("orderflow_context_fragile");
    }
    if (
      ((trendStateSummary.direction || "") === "uptrend" || (trendStateSummary.uptrendScore || 0) >= 0.58) &&
      (trendStateSummary.exhaustionScore || 0) >= 0.72 &&
      (signalQualitySummary.executionViability || 0) <= 0.44 &&
      ((venueConfirmationSummary.status || "") === "blocked" || executionCostBudget.blocked)
    ) {
      reasons.push("trend_exhausted_execution_fragile");
    }
    if (capitalGovernor.recoveryMode && score.probability < threshold + 0.025) {
      reasons.push("capital_governor_recovery");
    }
    if ((driftSummary.severity || 0) >= 0.45 && (score.calibrationConfidence || 0) < this.config.minCalibrationConfidence + 0.05) {
      reasons.push("drift_confidence_guard");
    }
    if (selfHealState.lowRiskOnly && !lowRiskCandidate && this.config.botMode !== "paper") {
      reasons.push("self_heal_low_risk_only");
    }
    if (qualityQuorumSummary.observeOnly) {
      reasons.push("quality_quorum_observe_only");
    } else if ((qualityQuorumSummary.status || "") === "degraded" && score.probability < threshold + 0.03) {
      reasons.push("quality_quorum_degraded");
    }
    const portfolioAdvisoryReasons = new Set(
      Array.isArray(portfolioSummary.advisoryReasons) ? portfolioSummary.advisoryReasons.filter(Boolean) : []
    );
    for (const portfolioReason of (Array.isArray(portfolioSummary.reasons) ? portfolioSummary.reasons : [])) {
      if (portfolioAdvisoryReasons.has(portfolioReason)) {
        continue;
      }
      if (!reasons.includes(portfolioReason)) {
        reasons.push(portfolioReason);
      }
    }
    if ((divergenceSummary?.leadBlocker?.status || "") === "blocked" && this.config.botMode === "live") {
      reasons.push("live_paper_divergence_guard");
    }
    if ((metaSummary.dailyTradeCount || 0) >= this.config.maxEntriesPerDay) {
      reasons.push("daily_entry_budget_reached");
    }
    if (metaSummary.action === "caution" && hasDirectMetaCautionGate) {
      reasons.push("meta_gate_caution");
    }

    const recentTrade = this.getRecentTradeForSymbol(journal, symbol);
    const dailyEntriesForSymbol = this.getDailyEntryCountForSymbol(journal, runtime, symbol, nowIso);
    const symbolLossCooldownMinutes = Math.max(0, safeValue(this.config.symbolLossCooldownMinutes, 240));
    const entryCooldownMinutes = Math.max(0, safeValue(this.config.entryCooldownMinutes, 20));
    if (dailyEntriesForSymbol >= this.config.maxEntriesPerSymbolPerDay && this.config.botMode !== "paper") {
      reasons.push("symbol_entry_budget_reached");
    }
    if (
      this.config.botMode !== "paper" &&
      recentTrade?.exitAt &&
      (recentTrade.pnlQuote || 0) < 0 &&
      minutesBetween(recentTrade.exitAt, nowIso) < symbolLossCooldownMinutes
    ) {
      reasons.push("symbol_loss_cooldown_active");
    }
    if (!hasOpenPositionForSymbol && recentTrade?.exitAt && minutesBetween(recentTrade.exitAt, nowIso) < entryCooldownMinutes) {
      reasons.push("entry_cooldown_active");
    }
    const recentPortfolioTradeAt = getMostRecentTradeTimestamp(journal);
    const minutesSincePortfolioTrade = recentPortfolioTradeAt ? minutesBetween(recentPortfolioTradeAt, nowIso) : Number.POSITIVE_INFINITY;
    const effectivePaperExplorationCooldownMinutes = this.config.botMode === "paper"
      ? Math.min(this.config.paperExplorationCooldownMinutes || 0, 3)
      : (this.config.paperExplorationCooldownMinutes || 0);
    const effectivePaperRecoveryCooldownMinutes = this.config.botMode === "paper"
      ? Math.min(this.config.paperRecoveryProbeCooldownMinutes || 0, 3)
      : (this.config.paperRecoveryProbeCooldownMinutes || 0);

    const stopLossPct = clamp(Math.max(this.config.stopLossPct, marketSnapshot.market.atrPct * 1.2), 0.008, 0.04);
    const adjustedStopLossPct = clamp(stopLossPct * parameterGovernorAdjustment.stopLossMultiplier * clamp(safeValue(strategyMetaSummary.stopLossMultiplier || 1), 0.88, 1.12), 0.006, 0.05);
    const regimeTakeProfitMultiplier = {
      trend: 1.9,
      breakout: 2.1,
      range: 1.4,
      high_vol: 1.5,
      event_risk: 1.3
    }[regimeSummary.regime] || 1.6;
    const takeProfitPct = clamp(Math.max(this.config.takeProfitPct, adjustedStopLossPct * regimeTakeProfitMultiplier) * parameterGovernorAdjustment.takeProfitMultiplier, 0.008, 0.5);
    const quoteFree = balance.quoteFree || 0;
    const entryReferencePrice = safeValue(
      marketSnapshot.book.ask,
      safeValue(
        marketSnapshot.book.mid,
        safeValue(
          marketSnapshot.market.close,
          safeValue(marketSnapshot.market.lastPrice, Number.NaN)
        )
      )
    );
    const maxByPosition = quoteFree * this.config.maxPositionFraction;
    const maxByRisk = adjustedStopLossPct > 0 ? (quoteFree * this.config.riskPerTrade) / adjustedStopLossPct : maxByPosition;
    const remainingExposureBudget = Math.max(0, totalEquityProxy * this.config.maxTotalExposureFraction - currentExposure);
    const confidenceFactor = clamp(0.65 + Math.max(0, score.probability - threshold) * 3.5, 0.6, 1.25);
    const calibrationFactor = clamp(0.75 + (score.calibrationConfidence || 0) * 0.4, 0.75, 1.15);
    const transformerFactor = clamp(0.88 + (score.transformer?.probability || 0.5) * 0.3 + (score.transformer?.confidence || 0) * 0.1, 0.78, 1.16);
    const newsFactor = clamp(1 + newsSummary.sentimentScore * 0.12 - newsSummary.riskScore * 0.18 + (newsSummary.eventBullishScore || 0) * 0.08 - (newsSummary.eventBearishScore || 0) * 0.12, 0.65, 1.1);
    const socialFactor = clamp(1 + (newsSummary.socialSentiment || 0) * 0.05 - (newsSummary.socialRisk || 0) * 0.08, 0.82, 1.05);
    const announcementFactor = clamp(1 + (announcementSummary.sentimentScore || 0) * 0.08 - (announcementSummary.riskScore || 0) * 0.2, 0.7, 1.08);
    const structureFactor = clamp(1 + (marketStructureSummary.signalScore || 0) * 0.1 - (marketStructureSummary.riskScore || 0) * 0.18 - Math.abs(marketStructureSummary.crowdingBias || 0) * 0.05, 0.62, 1.08);
    const calendarFactor = clamp(1 + (calendarSummary.bullishScore || 0) * 0.08 - (calendarSummary.riskScore || 0) * 0.2 - (calendarSummary.urgencyScore || 0) * 0.06, 0.58, 1.05);
    const macroFactor = clamp(1 + (marketSentimentSummary.contrarianScore || 0) * 0.08 - (marketSentimentSummary.riskScore || 0) * 0.12, 0.74, 1.08);
    const volatilityFactor = clamp(1 - (volatilitySummary.riskScore || 0) * 0.16 - Math.max(0, volatilitySummary.ivPremium || 0) * 0.005, 0.68, 1.04);
    const orderbookFactor = clamp(1 + (marketSnapshot.book.bookPressure || 0) * 0.14 + (marketSnapshot.book.microPriceEdgeBps || 0) / 250, 0.72, 1.12);
    const replenishmentFactor = clamp(0.78 + replenishmentQuality * 0.32, 0.62, 1.08);
    const relativeStrengthFactor = clamp(0.88 + relativeStrengthComposite * 8, 0.72, 1.12);
    const acceptanceFactor = clamp(0.78 + acceptanceQuality * 0.34, 0.62, 1.12);
    const downsideVolFactor = clamp(1 - Math.max(0, downsideVolDominance) * 0.26, 0.68, 1.04);
    const patternFactor = clamp(1 + (marketSnapshot.market.bullishPatternScore || 0) * 0.08 - (marketSnapshot.market.bearishPatternScore || 0) * 0.12, 0.72, 1.08);
    const committeeFactor = clamp(0.8 + (committeeSummary.sizeMultiplier || 1) * 0.24 + (committeeSummary.netScore || 0) * 0.12 + (committeeSummary.agreement || 0) * 0.08, 0.62, 1.16);
    const strategyFactor = clamp(0.76 + (strategySummary.fitScore || 0) * 0.28 + (strategySummary.agreementGap || 0) * 0.12 + (strategySummary.optimizerBoost || 0) * 0.5 - (strategySummary.blockers || []).length * 0.06, 0.56, 1.16);
    const rlFactor = clamp(rlAdvice.sizeMultiplier || 1, 0.78, 1.14);
    const memoryFactor = clamp(0.9 + (symbolStats.avgPnlPct || 0) * 4, 0.75, 1.15);
    const portfolioFactor = clamp((portfolioSummary.sizeMultiplier || 1) * (portfolioSummary.dailyBudgetFactor || 1) * (0.88 + (portfolioSummary.allocatorScore || 0) * 0.24), 0.22, 1.08);
    const pairHealthFactor = clamp(0.78 + (pairHealthSummary.score || 0.5) * 0.34 - (pairHealthSummary.quarantined ? 0.24 : 0), 0.45, 1.08);
    const timeframeFactor = clamp(0.76 + (timeframeSummary.alignmentScore || 0.5) * 0.36 - ((timeframeSummary.blockerReasons || []).length ? 0.16 : 0), 0.46, 1.08);
    const onChainFactor = clamp(1 + (onChainLiteSummary.liquidityScore || 0) * 0.08 + (onChainLiteSummary.marketBreadthScore || 0) * 0.06 + (onChainLiteSummary.majorsMomentumScore || 0) * 0.05 - (onChainLiteSummary.riskOffScore || 0) * 0.14 - (onChainLiteSummary.stressScore || 0) * 0.12 - (onChainLiteSummary.trendingScore || 0) * ((onChainLiteSummary.riskOffScore || 0) > 0.6 ? 0.06 : 0.02), 0.56, 1.1);
    const qualityQuorumFactor = clamp(
      0.72 +
        (qualityQuorumSummary.quorumScore || qualityQuorumSummary.averageScore || 0) * 0.34 -
        (qualityQuorumSummary.observeOnly ? 0.26 : (qualityQuorumSummary.status || "") === "degraded" ? 0.12 : 0),
      0.38,
      1.04
    );
    const marketConfidenceFactor = clamp(0.84 + (preliminaryConfidenceBreakdown.marketConfidence || 0.5) * 0.18, 0.72, 1.02);
    const dataConfidenceFactor = clamp(0.72 + safeValue(trendStateSummary.dataConfidenceScore, 0.6) * 0.36, 0.48, 1.05);
    const executionConfidenceFactor = clamp(0.82 + (preliminaryConfidenceBreakdown.executionConfidence || 0.45) * 0.2, 0.68, 1.02);
    const modelConfidenceFactor = clamp(0.82 + (preliminaryConfidenceBreakdown.modelConfidence || 0.45) * 0.2, 0.7, 1.03);
    const signalQualityFactor = clamp(0.76 + (signalQualitySummary.overallScore || 0.5) * 0.34, 0.5, 1.08);
    const setupQualityFactor = clamp(0.72 + safeValue(setupQuality.score, 0) * 0.4, 0.58, 1.08);
    const divergenceFactor = clamp((divergenceSummary.averageScore || 0) >= this.config.divergenceBlockScore ? 0.55 : (divergenceSummary.averageScore || 0) >= this.config.divergenceAlertScore ? 0.86 : 1, 0.5, 1);
    const heatPenalty = clamp(1 - portfolioHeat * 0.45, 0.55, 1);
    const streakPenalty = paperLearningRecoveryActive
      ? clamp(1 - globalLossStreak * 0.02 - symbolLossStreak * 0.01, 0.88, 1)
      : clamp(1 - globalLossStreak * 0.08 - symbolLossStreak * 0.06, 0.55, 1);

    const quoteAmount =
      Math.min(maxByPosition, maxByRisk, remainingExposureBudget) *
      confidenceFactor *
      calibrationFactor *
      transformerFactor *
      newsFactor *
      socialFactor *
      announcementFactor *
      structureFactor *
      calendarFactor *
      macroFactor *
      volatilityFactor *
      orderbookFactor *
      replenishmentFactor *
      relativeStrengthFactor *
      acceptanceFactor *
      downsideVolFactor *
      patternFactor *
      committeeFactor *
      strategyFactor *
      rlFactor *
      memoryFactor *
      portfolioFactor *
      pairHealthFactor *
      timeframeFactor *
      onChainFactor *
      qualityQuorumFactor *
      marketConfidenceFactor *
      dataConfidenceFactor *
      executionConfidenceFactor *
      modelConfidenceFactor *
      signalQualityFactor *
      setupQualityFactor *
      divergenceFactor *
      heatPenalty *
      streakPenalty *
      sessionSizeMultiplier *
      driftSizeMultiplier *
      selfHealSizeMultiplier *
      metaSizeMultiplier *
      strategyMetaSizeMultiplier *
      venueSizeMultiplier *
      capitalGovernorSizeMultiplier *
      capitalLadderSizeMultiplier *
      retirementSizeMultiplier *
      executionCostSizeMultiplier *
      spotDowntrendPenalty *
      parameterGovernorAdjustment.executionAggressivenessBias;
    const adjustedQuoteAmount = quoteAmount * trendStateTuning.sizeMultiplier * offlineLearningGuidanceApplied.sizeMultiplier;
    const invalidQuoteAmount =
      !Number.isFinite(quoteAmount) ||
      !Number.isFinite(adjustedQuoteAmount) ||
      adjustedQuoteAmount <= 0 ||
      !Number.isFinite(maxByPosition) ||
      !Number.isFinite(maxByRisk) ||
      !Number.isFinite(remainingExposureBudget);

    if (invalidQuoteAmount) {
      reasons.push("trade_size_invalid");
    }

    const confidenceBreakdown = preliminaryConfidenceBreakdown;

    if (!invalidQuoteAmount && adjustedQuoteAmount < this.config.minTradeUsdt) {
      reasons.push("trade_size_below_minimum");
    }

    const cappedQuoteAmount = invalidQuoteAmount
      ? 0
      : Math.min(adjustedQuoteAmount, maxByPosition, maxByRisk, remainingExposureBudget);

    const normalizedReasons = normalizeDecisionReasons(reasons);
    reasons.length = 0;
    reasons.push(...normalizedReasons);
    let allow = reasons.length === 0;
    let entryMode = "standard";
    let suppressedReasons = [];
    let finalQuoteAmount = cappedQuoteAmount;
    let paperExploration = null;
    let paperGuardrailRelief = [];

    const eligiblePaperSuppressedReasons = reasons.filter((reason) => isPaperLeniencyReason(reason, selfHealState));
    const paperGuardrailReasons = eligiblePaperSuppressedReasons.filter((reason) =>
      [
        "self_heal_pause_entries",
        "execution_cost_budget_exceeded",
        "capital_governor_blocked",
        "capital_governor_recovery",
        "strategy_cooldown",
        "strategy_budget_cooled",
        "family_budget_cooled",
        "cluster_budget_cooled",
        "regime_budget_cooled",
        "factor_budget_cooled",
        "daily_risk_budget_cooled",
        "regime_kill_switch_active"
      ].includes(reason)
    );
    const paperGuardrailThresholdRelief = clamp(
      paperGuardrailReasons.reduce((total, reason) => total + (
        ["family_budget_cooled", "strategy_budget_cooled"].includes(reason)
          ? 0.008
          : [
              "cluster_budget_cooled",
              "regime_budget_cooled",
              "factor_budget_cooled",
              "daily_risk_budget_cooled",
              "regime_kill_switch_active",
              "strategy_cooldown"
            ].includes(reason)
            ? 0.006
            : ["capital_governor_blocked", "capital_governor_recovery"].includes(reason)
              ? 0.004
              : ["execution_cost_budget_exceeded", "self_heal_pause_entries"].includes(reason)
                ? 0.003
                : 0
      ), 0),
      0,
      0.03
    );

    const mildPaperQualityOnly =
      reasons.some((reason) => isMildPaperQualityReason(reason)) &&
      reasons.every((reason) => isPaperLeniencyReason(reason, selfHealState) || isMildPaperQualityReason(reason));

    const softPaperOnlyReasons = reasons.length > 0 && reasons.every((reason) => isPaperLeniencyReason(reason, selfHealState));
    const highQualitySoftPaperProbeCandidate =
      softPaperOnlyReasons &&
      (committeeVetoIds.length === 0 || softPaperCommitteeDisagreement) &&
      (committeeSummary.netScore || 0) >= -0.08 &&
      safeValue(signalQualitySummary.overallScore, 0) >= 0.68 &&
      safeValue(dataQualitySummary.overallScore, 0) >= 0.62 &&
      safeValue(confidenceBreakdown.overallConfidence, 0) >= 0.64 &&
      safeValue(score.calibrationConfidence, 0) >= 0.68 &&
      safeValue(score.disagreement, 1) <= Math.min(0.08, this.config.maxModelDisagreement * 0.35) &&
      (
        abstainReasons.length === 0 ||
        abstainReasons.every((reason) => reason === "probability_neutral_band")
      );
    const paperGuidanceProbeRelief =
      this.config.botMode === "paper" &&
      paperLearningGuidance?.active &&
      paperLearningGuidance.preferredLane === "probe" &&
      !["always_skip", "simple_exit", "safe_lane"].includes(paperLearningGuidance.benchmarkLead || "") &&
      safeValue(paperLearningGuidance.cautionPenalty, 0) <= 0.08 &&
      safeValue(offlineLearningGuidance.executionCaution, 0) <= 0.08 &&
      safeValue(offlineLearningGuidance.featureTrustPenalty, offlineLearningGuidance.featurePenalty || 0) <= 0.08
        ? clamp(
            safeValue(paperLearningGuidance.priorityBoost, 0) * 0.22 +
            safeValue(paperLearningGuidance.probeBoost, 0) * 0.18 +
            (paperLearningGuidance.targetScopeMatched ? 0.03 : 0) -
            safeValue(paperLearningGuidance.cautionPenalty, 0) * 0.08,
            0,
            0.05
          )
        : 0;
    const lowConfidenceProbeRelief =
      this.config.botMode === "paper" &&
      lowConfidencePressure.reliefEligible &&
      reasons.includes("model_confidence_too_low") &&
      reasons.every((reason) => isPaperLeniencyReason(reason, selfHealState) || isMildPaperQualityReason(reason)) &&
      !["always_skip", "simple_exit", "safe_lane"].includes(paperLearningGuidance?.benchmarkLead || "") &&
      safeValue(offlineLearningGuidance.executionCaution, 0) <= 0.08 &&
      safeValue(offlineLearningGuidance.featureTrustPenalty, offlineLearningGuidance.featurePenalty || 0) <= 0.08
        ? clamp(
            (lowConfidencePressure.primaryDriver === "calibration_warmup"
              ? 0.012
              : lowConfidencePressure.primaryDriver === "calibration_confidence"
                ? 0.01
                : lowConfidencePressure.primaryDriver === "auxiliary_blend_drag"
                  ? 0.008
                : lowConfidencePressure.primaryDriver === "model_disagreement"
                  ? 0.006
                : lowConfidencePressure.primaryDriver === "feature_trust" && lowConfidencePressure.featureTrustNarrowPressure
                  ? 0.007
                : 0.008) +
            Math.max(0, 0.03 + safeValue(lowConfidencePressure.edgeToThreshold, 0)) * 0.08,
            0,
            ["feature_trust", "model_disagreement"].includes(lowConfidencePressure.primaryDriver) ? 0.01 : 0.014
          )
        : 0;
    const thresholdPenaltyStackProbeRelief =
      this.config.botMode === "paper" &&
      lowConfidencePressure.reliefEligible &&
      lowConfidencePressure.primaryDriver === "threshold_penalty_stack" &&
      reasons.includes("model_confidence_too_low")
        ? clamp(
            Math.max(0, safeValue(threshold, 0) - safeValue(baseThreshold, 0)) * 0.6,
            0,
            0.024
          )
        : 0;
    const rawProbabilityProbeRelief =
      this.config.botMode === "paper" &&
      reasons.includes("model_confidence_too_low") &&
      !score.shouldAbstain &&
      Number.isFinite(score.rawProbability) &&
      safeValue(score.rawProbability, 0) > safeValue(score.probability, 0) &&
      safeValue(score.rawProbability, 0) >= baseThreshold - 0.03 &&
      ["threshold_penalty_stack", "model_confidence", "calibration_confidence"].includes(lowConfidencePressure.primaryDriver) &&
      safeValue(signalQualitySummary.overallScore, 0) >= 0.68 &&
      safeValue(confidenceBreakdown.overallConfidence, 0) >= 0.66 &&
      safeValue(committeeSummary.agreement, 0) >= 0.75 &&
      safeValue(dataQualitySummary.overallScore, 0) >= 0.5 &&
      safeValue(newsSummary.riskScore, 0) <= 0.08 &&
      safeValue(announcementSummary.riskScore, 0) <= 0.04 &&
      safeValue(volatilitySummary.riskScore, 0) <= 0.35
        ? clamp(
            (safeValue(score.rawProbability, 0) - safeValue(score.probability, 0)) * 1.2 +
            Math.max(0, 0.03 + safeValue(lowConfidencePressure.edgeToBaseThreshold, 0)) * 0.3 +
            0.003,
            0,
            0.012
          )
        : 0;
    const paperProbeThresholdBuffer = this.config.paperExplorationThresholdBuffer +
      paperGuardrailThresholdRelief +
      paperGuidanceProbeRelief +
      lowConfidenceProbeRelief +
      thresholdPenaltyStackProbeRelief +
      rawProbabilityProbeRelief +
      (highQualitySoftPaperProbeCandidate ? 0.03 : 0) +
      (missedTradeTuningApplied.paperProbeEligible ? 0.012 : 0);
    const targetedLowConfidenceDriver = ["feature_trust", "model_disagreement", "auxiliary_blend_drag"].includes(lowConfidencePressure.primaryDriver);
    const untargetedLowConfidenceNearMiss =
      reasons.includes("model_confidence_too_low") &&
      !reasons.includes("trade_size_below_minimum") &&
      reasons.every((reason) => isPaperLeniencyReason(reason, selfHealState) || isMildPaperQualityReason(reason)) &&
      targetedLowConfidenceDriver &&
      paperGuardrailThresholdRelief === 0 &&
      paperGuidanceProbeRelief === 0 &&
      lowConfidenceProbeRelief === 0 &&
      !highQualitySoftPaperProbeCandidate;
    const paperProbeBookPressureFloor = clamp(
      this.config.paperExplorationMinBookPressure - paperGuidanceProbeRelief * 2.2,
      -1,
      1
    );

    if (
      !allow &&
      !invalidQuoteAmount &&
      this.config.botMode === "paper" &&
      this.config.paperExplorationEnabled &&
      canOpenAnotherPaperLearningPosition &&
      minutesSincePortfolioTrade >= effectivePaperExplorationCooldownMinutes &&
      reasons.length > 0 &&
      !reasons.includes("capital_governor_recovery") &&
      !untargetedLowConfidenceNearMiss &&
      reasons.every((reason) => isPaperLeniencyReason(reason, selfHealState) || isMildPaperQualityReason(reason)) &&
      score.probability >= threshold - paperProbeThresholdBuffer &&
      (marketSnapshot.book.bookPressure || 0) >= paperProbeBookPressureFloor &&
      (marketSnapshot.book.spreadBps || 0) <= Math.min(this.config.maxSpreadBps * 0.4, 8) &&
      (marketSnapshot.market.realizedVolPct || 0) <= this.config.maxRealizedVolPct * 0.75 &&
      (newsSummary.riskScore || 0) <= 0.32 &&
      (announcementSummary.riskScore || 0) <= 0.2 &&
      (calendarSummary.riskScore || 0) <= 0.28 &&
      (marketStructureSummary.riskScore || 0) <= 0.32 &&
      (volatilitySummary.riskScore || 0) <= 0.72 &&
      !(sessionSummary.blockerReasons || []).length &&
      (
        !(driftSummary.blockerReasons || []).length ||
        (driftSummary.blockerReasons || []).every((reason) => isMildPaperQualityReason(reason))
      ) &&
      qualityQuorumSummary.observeOnly !== true &&
      ((qualityQuorumSummary.status || "") !== "degraded" || mildPaperQualityOnly) &&
      (
        !mildPaperQualityOnly ||
        safeValue(signalQualitySummary.executionViability, 0) >= 0.52 ||
        safeValue(dataQualitySummary.overallScore, 0) >= 0.54
      ) &&
      canRelaxPaperSelfHeal(selfHealState)
    ) {
      const explorationBudget = Math.min(maxByPosition, maxByRisk, remainingExposureBudget);
      const explorationQuoteAmount = Math.min(
        explorationBudget,
        Math.max(this.config.minTradeUsdt, adjustedQuoteAmount * this.config.paperExplorationSizeMultiplier)
      );
      if (explorationQuoteAmount >= this.config.minTradeUsdt) {
        allow = true;
        entryMode = "paper_exploration";
        suppressedReasons = [...reasons];
        paperGuardrailRelief = paperGuardrailReasons;
        finalQuoteAmount = explorationQuoteAmount;
        paperExploration = {
          mode: "paper_exploration",
          thresholdBuffer: paperProbeThresholdBuffer,
          sizeMultiplier: this.config.paperExplorationSizeMultiplier,
          minBookPressure: paperProbeBookPressureFloor,
          minutesSincePortfolioTrade: Number.isFinite(minutesSincePortfolioTrade) ? minutesSincePortfolioTrade : null,
          warmupProgress: calibrationWarmup,
          suppressedReasons,
          guardrailReliefReasons: paperGuardrailRelief,
          adaptiveThresholdRelief: clamp(paperProbeThresholdBuffer - this.config.paperExplorationThresholdBuffer, 0, 0.05),
          guidanceThresholdRelief: num(paperGuidanceProbeRelief, 4),
          confidenceThresholdRelief: num(lowConfidenceProbeRelief, 4),
          thresholdPenaltyStackRelief: num(thresholdPenaltyStackProbeRelief, 4),
          rawProbabilityThresholdRelief: num(rawProbabilityProbeRelief, 4),
          confidencePrimaryDriver: lowConfidencePressure.primaryDriver || null,
          confidenceDriverSource: lowConfidencePressure.dominantFeaturePressureSource || null,
          confidenceDriverGroup: lowConfidencePressure.dominantFeaturePressureGroup || null,
          selfHealRelaxed: suppressedReasons.includes("self_heal_pause_entries"),
          selfHealIssues: [...(selfHealState.issues || [])]
        };
      }
    }

    const recoveryProbeSuppressedReasons = reasons.filter((reason) =>
      isPaperRecoveryProbeReason(reason) || isPaperLeniencyReason(reason, selfHealState)
    );
    const recoveryProbeGuardrailReasons = recoveryProbeSuppressedReasons.filter((reason) =>
      [
        "capital_governor_blocked",
        "capital_governor_recovery",
        "trade_size_below_minimum"
      ].includes(reason)
    );

    if (
      !allow &&
      !invalidQuoteAmount &&
      this.config.botMode === "paper" &&
      this.config.paperRecoveryProbeEnabled &&
      canOpenAnotherPaperLearningPosition &&
      minutesSincePortfolioTrade >= effectivePaperRecoveryCooldownMinutes &&
      reasons.some((reason) => ["capital_governor_blocked", "capital_governor_recovery"].includes(reason)) &&
      reasons.every((reason) => isPaperRecoveryProbeReason(reason) || isPaperLeniencyReason(reason, selfHealState) || isMildPaperQualityReason(reason)) &&
      score.probability >= threshold - this.config.paperRecoveryProbeThresholdBuffer &&
      (marketSnapshot.book.bookPressure || 0) >= this.config.paperRecoveryProbeMinBookPressure &&
      (marketSnapshot.book.spreadBps || 0) <= Math.min(this.config.maxSpreadBps * 0.5, 10) &&
      (marketSnapshot.market.realizedVolPct || 0) <= this.config.maxRealizedVolPct * 0.82 &&
      (newsSummary.riskScore || 0) <= 0.36 &&
      (announcementSummary.riskScore || 0) <= 0.24 &&
      (calendarSummary.riskScore || 0) <= 0.3 &&
      (marketStructureSummary.riskScore || 0) <= 0.36 &&
      (volatilitySummary.riskScore || 0) <= 0.76 &&
      !(sessionSummary.blockerReasons || []).length &&
      (
        !(driftSummary.blockerReasons || []).length ||
        (driftSummary.blockerReasons || []).every((reason) => isMildPaperQualityReason(reason))
      ) &&
      (qualityQuorumSummary.observeOnly !== true) &&
      (
        (qualityQuorumSummary.status || "") !== "degraded" ||
        safeValue(signalQualitySummary.executionViability, 0) >= 0.52 ||
        safeValue(dataQualitySummary.overallScore, 0) >= 0.54
      ) &&
      canRelaxPaperSelfHeal(selfHealState)
    ) {
      const recoveryBudget = Math.min(maxByPosition, maxByRisk, remainingExposureBudget);
      const recoveryProbeFloor = this.config.paperRecoveryProbeAllowMinTradeOverride
        ? Math.max(5, this.config.minTradeUsdt * this.config.paperRecoveryProbeSizeMultiplier)
        : this.config.minTradeUsdt;
      const recoveryProbeQuoteAmount = Math.min(
        recoveryBudget,
        Math.max(recoveryProbeFloor, adjustedQuoteAmount * this.config.paperRecoveryProbeSizeMultiplier)
      );
      if (recoveryProbeQuoteAmount > 0 && (this.config.paperRecoveryProbeAllowMinTradeOverride || recoveryProbeQuoteAmount >= this.config.minTradeUsdt)) {
        allow = true;
        entryMode = "paper_recovery_probe";
        suppressedReasons = [...reasons];
        paperGuardrailRelief = recoveryProbeGuardrailReasons;
        finalQuoteAmount = recoveryProbeQuoteAmount;
        paperExploration = {
          mode: "paper_recovery_probe",
          thresholdBuffer: this.config.paperRecoveryProbeThresholdBuffer,
          sizeMultiplier: this.config.paperRecoveryProbeSizeMultiplier,
          minBookPressure: this.config.paperRecoveryProbeMinBookPressure,
          minutesSincePortfolioTrade: Number.isFinite(minutesSincePortfolioTrade) ? minutesSincePortfolioTrade : null,
          warmupProgress: calibrationWarmup,
          suppressedReasons,
          guardrailReliefReasons: paperGuardrailRelief,
          selfHealRelaxed: suppressedReasons.includes("self_heal_pause_entries"),
          allowMinTradeOverride: Boolean(this.config.paperRecoveryProbeAllowMinTradeOverride),
          selfHealIssues: [...(selfHealState.issues || [])]
        };
      }
    }

    const paperLearningBudget = getPaperLearningBudgetState({
      journal,
      runtime,
      nowIso,
      config: this.config
    });
    const paperLearningSampling = getPaperLearningSamplingState({
      journal,
      runtime,
      nowIso,
      config: this.config,
      strategySummary,
      regimeSummary,
      sessionSummary,
      marketConditionSummary
    });
    if (allow && ["paper_exploration", "paper_recovery_probe"].includes(entryMode) && paperLearningBudget.probeRemaining <= 0) {
      allow = false;
      entryMode = "standard";
      finalQuoteAmount = 0;
      paperExploration = null;
      suppressedReasons = [];
      paperGuardrailRelief = [];
      if (!reasons.includes("paper_learning_probe_budget_reached")) {
        reasons.push("paper_learning_probe_budget_reached");
      }
    }
    if (
      allow &&
      ["paper_exploration", "paper_recovery_probe"].includes(entryMode) &&
      !paperLearningSampling.canOpenProbe
    ) {
      if (
        paperLearningSampling.probeCaps.familyLimit > 0 &&
        paperLearningSampling.probeCaps.familyUsed >= paperLearningSampling.probeCaps.familyLimit &&
        !reasons.includes("paper_learning_family_probe_cap_reached")
      ) {
        reasons.push("paper_learning_family_probe_cap_reached");
      }
      if (
        paperLearningSampling.probeCaps.regimeLimit > 0 &&
        paperLearningSampling.probeCaps.regimeUsed >= paperLearningSampling.probeCaps.regimeLimit &&
        !reasons.includes("paper_learning_regime_probe_cap_reached")
      ) {
        reasons.push("paper_learning_regime_probe_cap_reached");
      }
      if (
        paperLearningSampling.probeCaps.sessionLimit > 0 &&
        paperLearningSampling.probeCaps.sessionUsed >= paperLearningSampling.probeCaps.sessionLimit &&
        !reasons.includes("paper_learning_session_probe_cap_reached")
      ) {
        reasons.push("paper_learning_session_probe_cap_reached");
      }
      if (
        paperLearningSampling.probeCaps.regimeFamilyLimit > 0 &&
        paperLearningSampling.probeCaps.regimeFamilyUsed >= paperLearningSampling.probeCaps.regimeFamilyLimit &&
        !reasons.includes("paper_learning_regime_family_probe_cap_reached")
      ) {
        reasons.push("paper_learning_regime_family_probe_cap_reached");
      }
      if (
        paperLearningSampling.probeCaps.conditionStrategyLimit > 0 &&
        paperLearningSampling.probeCaps.conditionStrategyUsed >= paperLearningSampling.probeCaps.conditionStrategyLimit &&
        !reasons.includes("paper_learning_condition_strategy_probe_cap_reached")
      ) {
        reasons.push("paper_learning_condition_strategy_probe_cap_reached");
      }
      const scopeCapOverflowAllowed = this.config.botMode === "paper" && canUsePaperProbeScopeOverflow({
        entryMode,
        reasons,
        score,
        threshold,
        paperLearningBudget,
        paperLearningSampling,
        signalQualitySummary,
        dataQualitySummary,
        confidenceBreakdown,
        selfHealState
      });
      if (scopeCapOverflowAllowed) {
        suppressedReasons = [...new Set([...suppressedReasons, ...reasons.filter((reason) => isPaperProbeCapReason(reason))])];
        paperExploration = {
          ...(paperExploration || {}),
          scopeCapOverflow: {
            family: reasons.includes("paper_learning_family_probe_cap_reached"),
            regime: reasons.includes("paper_learning_regime_probe_cap_reached"),
            session: reasons.includes("paper_learning_session_probe_cap_reached"),
            regimeFamily: reasons.includes("paper_learning_regime_family_probe_cap_reached"),
            conditionStrategy: reasons.includes("paper_learning_condition_strategy_probe_cap_reached")
          }
        };
      } else {
        allow = false;
        entryMode = "standard";
        finalQuoteAmount = 0;
        paperExploration = null;
        suppressedReasons = [];
        paperGuardrailRelief = [];
      }
    }
    let {
      lane: learningLane,
      learningValueScore: paperLearningValueScore,
      activeLearningState: paperActiveLearningState,
      shadowQueueBlockedByCap,
      shadowCapReasons
    } = resolvePaperLearningLane({
      config: this.config,
      allow,
      entryMode,
      reasons,
      score,
      threshold,
      signalQualitySummary,
      confidenceBreakdown,
      dataQualitySummary,
      paperLearningBudget,
      botMode: this.config.botMode,
      samplingState: paperLearningSampling
    });
    if (!allow && shadowQueueBlockedByCap) {
      for (const reason of shadowCapReasons || []) {
        if (!reasons.includes(reason)) {
          reasons.push(reason);
        }
      }
    }
    learningValueScore = clamp(Math.max(learningValueScore, paperLearningValueScore), 0, 1);
    activeLearningState = {
      ...paperActiveLearningState,
      activeLearningScore: clamp(
        Math.max(
          safeValue(paperActiveLearningState.activeLearningScore, 0),
          safeValue(activeLearningState.activeLearningScore, 0)
        ),
        0,
        1
      ),
      focusReason: paperActiveLearningState.focusReason || activeLearningState.focusReason
    };
    const learningNoveltyTooLow = this.config.botMode === "paper" &&
      ["paper_exploration", "paper_recovery_probe"].includes(entryMode) &&
      learningLane === "probe" &&
      safeValue(paperLearningSampling.noveltyScore, 0) < (this.config.paperLearningMinNoveltyScore || 0);
    if (allow && learningNoveltyTooLow) {
      allow = false;
      entryMode = "standard";
      finalQuoteAmount = 0;
      paperExploration = null;
      suppressedReasons = [];
      paperGuardrailRelief = [];
      if (!reasons.includes("paper_learning_novelty_too_low")) {
        reasons.push("paper_learning_novelty_too_low");
      }
      ({
        lane: learningLane,
        learningValueScore: paperLearningValueScore,
        activeLearningState: paperActiveLearningState,
        shadowQueueBlockedByCap,
        shadowCapReasons
      } = resolvePaperLearningLane({
        config: this.config,
        allow,
        entryMode,
        reasons,
        score,
        threshold,
        signalQualitySummary,
        confidenceBreakdown,
        dataQualitySummary,
        paperLearningBudget,
        botMode: this.config.botMode,
        samplingState: paperLearningSampling
      }));
      if (!allow && shadowQueueBlockedByCap) {
        for (const reason of shadowCapReasons || []) {
          if (!reasons.includes(reason)) {
            reasons.push(reason);
          }
        }
      }
      learningValueScore = clamp(Math.max(learningValueScore, paperLearningValueScore), 0, 1);
      activeLearningState = {
        ...paperActiveLearningState,
        activeLearningScore: clamp(
          Math.max(
            safeValue(paperActiveLearningState.activeLearningScore, 0),
            safeValue(activeLearningState.activeLearningScore, 0)
          ),
          0,
          1
        ),
        focusReason: paperActiveLearningState.focusReason || activeLearningState.focusReason
      };
    }
    let strategyAllocationGovernance = buildStrategyAllocationGovernanceState({
      config: this.config,
      botMode: this.config.botMode,
      allow,
      reasons,
      learningLane,
      strategySummary,
      strategyAllocationSummary,
      paperLearningBudget,
      samplingState: paperLearningSampling,
      canOpenAnotherPaperLearningPosition
    });
    if (this.config.botMode === "paper" && strategyAllocationGovernance.applied) {
      if (strategyAllocationGovernance.recommendedLane && strategyAllocationGovernance.recommendedLane !== learningLane) {
        learningLane = strategyAllocationGovernance.recommendedLane;
      }
      if (strategyAllocationGovernance.priorityBoost > 0) {
        learningValueScore = clamp(learningValueScore + strategyAllocationGovernance.priorityBoost, 0, 1);
        activeLearningState = {
          ...activeLearningState,
          activeLearningScore: clamp(
            safeValue(activeLearningState.activeLearningScore, 0) + strategyAllocationGovernance.priorityBoost * 0.55,
            0,
            1
          ),
          focusReason: activeLearningState.focusReason || "allocator_priority"
        };
      }
    }
    if (this.config.botMode === "paper" && missedTradeTuningApplied.active) {
      if (missedTradeTuningApplied.paperProbeEligible && allow && learningLane === "safe" && entryMode === "standard") {
        learningLane = "probe";
      }
      if (missedTradeTuningApplied.shadowPriority && !allow && learningLane === "safe") {
        learningLane = "shadow";
      }
      learningValueScore = clamp(
        learningValueScore +
        (missedTradeTuningApplied.paperProbeEligible ? 0.06 : 0) +
        (missedTradeTuningApplied.shadowPriority ? 0.04 : 0),
        0,
        1
      );
      activeLearningState = {
        ...activeLearningState,
        activeLearningScore: clamp(
          safeValue(activeLearningState.activeLearningScore, 0) +
          (missedTradeTuningApplied.paperProbeEligible ? 0.04 : 0) +
          (missedTradeTuningApplied.shadowPriority ? 0.03 : 0),
          0,
          1
        ),
        focusReason: activeLearningState.focusReason || "condition_missed_trade_tuning"
      };
    }
    const paperLearningGuidanceApplied = applyPaperLearningGuidance({
      botMode: this.config.botMode,
      guidance: paperLearningGuidance,
      allow,
      entryMode,
      learningLane,
      learningValueScore,
      activeLearningState,
      paperLearningBudget,
      samplingState: paperLearningSampling,
      score,
      threshold
    });
    learningLane = paperLearningGuidanceApplied.learningLane;
    learningValueScore = paperLearningGuidanceApplied.learningValueScore;
    activeLearningState = paperLearningGuidanceApplied.activeLearningState;
    const paperLearningGuidanceOpportunityBoost = this.config.botMode === "paper"
      ? paperLearningGuidanceApplied.opportunityBoost
      : 0;
    const offlineLearningGuidanceOpportunityShift = offlineLearningGuidanceApplied.opportunityShift;
    const paperPriorityOpportunityBoost =
      this.config.botMode === "paper"
        ? clamp(
            (strategyAllocationGovernance.mode === "priority_probe" ? 0.08 : 0) +
            (learningLane === "probe" && entryMode === "paper_exploration" ? 0.04 : 0) +
            (missedTradeTuningApplied.paperProbeEligible ? 0.03 : 0) +
            (missedTradeTuningApplied.shadowPriority && !allow ? 0.02 : 0),
            0,
            0.12
          )
        : 0;
    const opportunityScore = num(clamp(
      0.34 +
      clamp(score.probability - threshold, -0.12, 0.12) * 2.4 +
      safeValue(strategyAllocationSummary.convictionScore, 0) * 0.12 +
      safeValue(signalQualitySummary.overallScore, 0) * 0.12 +
      safeValue(confidenceBreakdown.overallConfidence, 0) * 0.08 +
      safeValue(pairHealthSummary.score, 0.5) * 0.06 +
      marketConditionConfidence * 0.08 +
      Math.max(0, 0.6 - marketConditionRisk) * 0.06 +
      Math.max(0, safeValue(portfolioSummary.diversificationScore, 0.5) - 0.5) * 0.08 +
      (missedTradeTuningApplied.paperProbeEligible ? 0.05 : 0) +
      (missedTradeTuningApplied.shadowPriority ? 0.03 : 0) +
      safeValue(strategyMetaSummary.holdMultiplier, 1) * 0.02 +
      paperPriorityOpportunityBoost +
      paperLearningGuidanceOpportunityBoost +
      offlineLearningGuidanceOpportunityShift +
      safeValue(setupQuality.score, 0) * 0.08,
      0,
      1.4
    ), 4);
    const candidateApprovalReasons = buildApprovalReasons({
      score,
      threshold,
      strategySummary,
      signalQualitySummary,
      confidenceBreakdown,
      setupQuality,
      acceptanceQuality,
      replenishmentQuality,
      relativeStrengthComposite,
      marketConditionSummary
    });
    const approvalReasons = allow ? candidateApprovalReasons : [];
    const decisionContextConfidence = buildDecisionContextConfidence({
      signalQualitySummary,
      dataQualitySummary,
      confidenceBreakdown,
      marketConditionSummary,
      score
    });
    const blockerCategoryCounts = reasons.reduce((acc, reason) => {
      const category = classifyReasonCategory(reason);
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});
    const reasonSeverityProfile = reasons.reduce((acc, reason) => {
      const severity = reasonSeverity(reason);
      if (severity >= 4) {
        acc.hard += 1;
      } else if (severity >= 3) {
        acc.medium += 1;
      } else {
        acc.soft += 1;
      }
      return acc;
    }, { hard: 0, medium: 0, soft: 0 });
    const sizingFactors = [
      { id: "session", value: sessionSizeMultiplier },
      { id: "drift", value: driftSizeMultiplier },
      { id: "self_heal", value: selfHealSizeMultiplier },
      { id: "meta", value: metaSizeMultiplier },
      { id: "strategy_meta", value: strategyMetaSizeMultiplier },
      { id: "venue", value: venueSizeMultiplier },
      { id: "capital_governor", value: capitalGovernorSizeMultiplier },
      { id: "capital_ladder", value: capitalLadderSizeMultiplier },
      { id: "retirement", value: retirementSizeMultiplier },
      { id: "execution_cost", value: executionCostSizeMultiplier },
      { id: "downtrend", value: spotDowntrendPenalty },
      { id: "trend_state", value: trendStateTuning.sizeMultiplier },
      { id: "offline_learning", value: offlineLearningGuidanceApplied.sizeMultiplier }
    ].map((item) => ({
      ...item,
      effect: num((safeValue(item.value, 1) - 1), 4)
    }));
    const dominantSizingDrag = [...sizingFactors]
      .filter((item) => item.value < 1)
      .sort((left, right) => left.value - right.value)
      .slice(0, 3);
    const dominantSizingBoost = [...sizingFactors]
      .filter((item) => item.value > 1)
      .sort((left, right) => right.value - left.value)
      .slice(0, 2);
    const entryDiagnostics = {
      regime: regimeSummary.regime || null,
      phase: marketStateSummary.phase || null,
      marketCondition: {
        id: marketConditionId || null,
        confidence: num(marketConditionConfidence, 4),
        risk: num(marketConditionRisk, 4),
        posture: marketConditionSummary.posture || null,
        drivers: [...(marketConditionSummary.drivers || [])].slice(0, 3)
      },
      thresholdBuffer: num(score.probability - threshold, 4),
      strongestConfirmingFactors: candidateApprovalReasons.slice(0, 4),
      strongestRejectingFactors: reasons.slice(0, 4),
      blockerCategoryCounts,
      reasonSeverityProfile,
      ambiguityScore: num(ambiguityScore, 4),
      ambiguityThreshold: num(ambiguityThreshold, 4),
      decisionContextConfidence: num(decisionContextConfidence, 4)
    };

    return {
      allow,
      reasons: allow ? [] : reasons,
      approvalReasons,
      entryDiagnostics,
      suppressedReasons,
      entryMode,
      learningLane,
      learningValueScore,
      paperLearningBudget,
      paperLearningSampling,
      paperActiveLearning: activeLearningState,
      strategyAllocationGovernance,
      baselineCoreApplied: {
        active: Boolean(baselineCoreSummary.active),
        enforce: Boolean(baselineCoreSummary.enforce),
        preferredStrategies: (baselineCoreSummary.preferredStrategies || []).map((item) => item?.id || item).filter(Boolean),
        suspendedStrategies: (baselineCoreSummary.suspendedStrategies || []).map((item) => item?.id || item).filter(Boolean),
        matchedPreferred: (baselineCoreSummary.preferredStrategies || []).length
          ? (baselineCoreSummary.preferredStrategies || []).some((item) => (item?.id || item) === (strategySummary.activeStrategy || ""))
          : true,
        note: baselineCoreSummary.note || null
      },
      missedTradeTuningApplied,
      paperLearningGuidance: {
        ...(paperLearningGuidance || {}),
        applied: paperLearningGuidanceApplied.applied,
        opportunityBoost: paperLearningGuidanceApplied.opportunityBoost
      },
      offlineLearningGuidance: {
        ...(offlineLearningGuidance || {}),
        applied: offlineLearningGuidanceApplied.applied,
        thresholdShiftApplied: offlineLearningGuidanceApplied.thresholdShift,
        sizeMultiplierApplied: offlineLearningGuidanceApplied.sizeMultiplier,
        cautionPenaltyApplied: offlineLearningGuidanceApplied.cautionPenalty,
        executionCautionApplied: offlineLearningGuidanceApplied.executionCaution,
        featureTrustPenaltyApplied: offlineLearningGuidanceApplied.featureTrustPenalty,
        opportunityShift: offlineLearningGuidanceApplied.opportunityShift
      },
      paperThresholdSandbox: {
        ...paperThresholdSandbox,
        thresholdBeforeSandbox,
        thresholdAfterSandbox: threshold
      },
      paperBlockerCategories: allow ? {} : reasons.reduce((acc, reason) => {
        const category = classifyPaperBlocker(reason);
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {}),
      paperExploration,
      paperPriorityOpportunityBoost,
      paperLearningGuidanceOpportunityBoost,
      offlineLearningGuidanceOpportunityShift,
      paperGuardrailRelief,
      baseThreshold,
      threshold,
      thresholdAdjustment: optimizerAdjustments.thresholdAdjustment,
      thresholdTuningApplied: thresholdTuningAdjustment,
      parameterGovernorApplied: parameterGovernorAdjustment,
      trendStateTuningApplied: trendStateTuning,
      strategyRetirementApplied: strategyRetirementPolicy,
      executionCostBudgetApplied: {
        ...executionCostBudget,
        learningCaution: {
          executionCaution: offlineLearningGuidanceApplied.executionCaution,
          featureTrustPenalty: offlineLearningGuidanceApplied.featureTrustPenalty,
          executionCostBufferBps: safeValue(offlineLearningGuidance.executionCostBufferBps, 0)
        }
      },
      capitalGovernorApplied: capitalGovernor,
      exchangeCapabilitiesApplied: exchangeCapabilities,
      marketConditionApplied: marketConditionSummary,
      downtrendPolicy,
      trendStateSummary,
      marketConditionSummary,
      dataQualitySummary,
      signalQualitySummary,
      confidenceBreakdown,
      setupQuality,
      lowConfidencePressure,
      decisionContext: {
        confidence: num(decisionContextConfidence, 4),
        regime: regimeSummary.regime || null,
        conditionId: marketConditionId || null
      },
      sizingSummary: {
        rawQuoteAmount: Number.isFinite(quoteAmount) ? num(quoteAmount, 2) : null,
        adjustedQuoteAmount: Number.isFinite(adjustedQuoteAmount) ? num(adjustedQuoteAmount, 2) : null,
        cappedQuoteAmount: Number.isFinite(cappedQuoteAmount) ? num(cappedQuoteAmount, 2) : null,
        maxByPosition: Number.isFinite(maxByPosition) ? num(maxByPosition, 2) : null,
        maxByRisk: Number.isFinite(maxByRisk) ? num(maxByRisk, 2) : null,
        remainingExposureBudget: Number.isFinite(remainingExposureBudget) ? num(remainingExposureBudget, 2) : null,
        minTradeUsdt: num(this.config.minTradeUsdt || 0, 2),
        invalidQuoteAmount,
        entryReferencePrice: Number.isFinite(entryReferencePrice) ? num(entryReferencePrice, 8) : null,
        missingExecutableEntryPrice: !Number.isFinite(entryReferencePrice) || entryReferencePrice <= 0,
        offlineLearningSizeMultiplier: num(offlineLearningGuidanceApplied.sizeMultiplier, 4),
        offlineLearningExecutionCaution: num(offlineLearningGuidanceApplied.executionCaution, 4),
        offlineLearningFeatureTrustPenalty: num(offlineLearningGuidanceApplied.featureTrustPenalty, 4),
        advisoryPortfolioReasons: [...(portfolioSummary.advisoryReasons || [])],
        dominantSizingDrag,
        dominantSizingBoost
      },
      modelAbstainReasons: abstainReasons,
      committeeVetoObservation: {
        vetoIds: committeeVetoIds,
        softenedInPaper: softPaperCommitteeDisagreement || redundantCommitteeVeto || softPaperCommitteeConfidence,
        redundantInDecision: redundantCommitteeVeto,
        confidenceSoftenedInPaper: softPaperCommitteeConfidence
      },
      strategyMetaApplied: strategyMetaSummary,
      capitalLadderApplied: capitalLadderSummary,
      strategyConfidenceFloor,
      strategyConfidenceAdjustment: optimizerAdjustments.strategyConfidenceAdjustment,
      optimizerApplied: {
        sampleSize: optimizerAdjustments.sampleSize,
        sampleConfidence: optimizerAdjustments.sampleConfidence,
        baseThreshold,
        effectiveThreshold: threshold,
        thresholdAdjustment: optimizerAdjustments.thresholdAdjustment,
        thresholdTuningAdjustment: thresholdTuningAdjustment.adjustment,
        parameterGovernorThresholdShift: parameterGovernorAdjustment.thresholdShift,
        missedTradeThresholdShift: missedTradeTuningApplied.thresholdShift,
        trendStateThresholdShift: trendStateTuning.thresholdShift,
        offlineLearningThresholdShift: offlineLearningGuidanceApplied.thresholdShift,
        globalThresholdTilt: optimizerAdjustments.globalThresholdTilt,
        familyThresholdTilt: optimizerAdjustments.familyThresholdTilt,
        strategyThresholdTilt: optimizerAdjustments.strategyThresholdTilt,
        strategyConfidenceFloor,
        strategyConfidenceAdjustment: optimizerAdjustments.strategyConfidenceAdjustment,
        globalConfidenceTilt: optimizerAdjustments.globalConfidenceTilt,
        familyConfidenceTilt: optimizerAdjustments.familyConfidenceTilt,
        strategyConfidenceTilt: optimizerAdjustments.strategyConfidenceTilt
      },
      quoteAmount: finalQuoteAmount,
      stopLossPct: adjustedStopLossPct,
      takeProfitPct,
      maxHoldMinutes: Math.max(1, Math.round((this.config.maxHoldMinutes || 1) * parameterGovernorAdjustment.maxHoldMinutesMultiplier * clamp(safeValue(strategyMetaSummary.holdMultiplier || 1), 0.84, 1.14))),
      scaleOutPlan: {
        enabled: this.config.scaleOutFraction > 0,
        fraction: clamp(this.config.scaleOutFraction * parameterGovernorAdjustment.scaleOutFractionMultiplier, 0.05, 0.95),
        triggerPct: Math.max(this.config.scaleOutTriggerPct, adjustedStopLossPct * 0.9) * parameterGovernorAdjustment.scaleOutTriggerMultiplier,
        minNotionalUsd: this.config.scaleOutMinNotionalUsd,
        trailOffsetPct: this.config.scaleOutTrailOffsetPct
      },
      metaSummary,
      regime: regimeSummary.regime,
      committeeSummary,
      rlAdvice,
      strategySummary,
      sessionSummary,
      driftSummary,
      selfHealState,
      timeframeSummary,
      pairHealthSummary,
      onChainLiteSummary,
      qualityQuorumSummary,
      divergenceSummary,
      venueConfirmationSummary,
      rankScore:
        score.probability -
        threshold +
        (safeValue(setupQuality.score, 0) - 0.5) * 0.08 +
        (score.transformer?.probability || 0.5) * 0.04 +
        (committeeSummary.netScore || 0) * 0.09 +
        (committeeSummary.agreement || 0) * 0.03 +
        (strategySummary.fitScore || 0) * 0.08 +
        (strategySummary.agreementGap || 0) * 0.03 +
        (strategySummary.optimizerBoost || 0) * 0.05 +
        (newsSummary.sentimentScore || 0) * 0.03 +
        (sessionSummary.riskScore || 0) * -0.04 +
        (driftSummary.severity || 0) * -0.06 +
        (newsSummary.socialSentiment || 0) * 0.01 +
        (announcementSummary.sentimentScore || 0) * 0.02 +
        (marketSentimentSummary.contrarianScore || 0) * 0.02 +
        (marketStructureSummary.signalScore || 0) * 0.04 +
        (pairHealthSummary.score || 0.5) * 0.04 +
        (timeframeSummary.alignmentScore || 0) * 0.05 +
        (onChainLiteSummary.liquidityScore || 0) * 0.03 +
        (qualityQuorumSummary.quorumScore || qualityQuorumSummary.averageScore || 0) * 0.04 +
        (signalQualitySummary.overallScore || 0) * 0.05 +
        (dataQualitySummary.overallScore || 0) * 0.04 +
        (confidenceBreakdown.overallConfidence || 0) * 0.03 +
        (onChainLiteSummary.marketBreadthScore || 0) * 0.025 +
        (onChainLiteSummary.majorsMomentumScore || 0) * 0.018 +
        ((venueConfirmationSummary.confirmed ? 0.02 : (venueConfirmationSummary.status || "") === "blocked" ? -0.06 : 0)) +
        (marketSnapshot.book.bookPressure || 0) * 0.04 +
        (marketSnapshot.market.bullishPatternScore || 0) * 0.03 +
        (metaSummary.score || 0) * 0.05 -
        (onChainLiteSummary.stressScore || 0) * 0.03 -
        (qualityQuorumSummary.observeOnly ? 0.06 : (qualityQuorumSummary.status || "") === "degraded" ? 0.025 : 0) -
        (divergenceSummary.averageScore || 0) * 0.04 -
        ((strategySummary.blockers || []).length ? 0.03 : 0) -
        (volatilitySummary.riskScore || 0) * 0.04 -
        (marketSnapshot.market.bearishPatternScore || 0) * 0.04 -
        (announcementSummary.riskScore || 0) * 0.03 -
        (calendarSummary.riskScore || 0) * 0.04 -
        (rlAdvice.expectedReward || 0) * 0.02 -
        marketSnapshot.book.spreadBps / 20_000 +
        (portfolioSummary.allocatorScore || 0) * 0.03 -
        (portfolioSummary.maxCorrelation || 0) * 0.03 +
        (score.calibrationConfidence || 0) * 0.02 +
        marketConditionConfidence * 0.03 -
        marketConditionRisk * 0.02 +
        (missedTradeTuningApplied.paperProbeEligible ? 0.02 : 0),
      opportunityScore
    };
  }

  evaluateExit({ position, currentPrice, newsSummary, announcementSummary = {}, marketStructureSummary = {}, calendarSummary = {}, marketSnapshot = {}, exitIntelligenceSummary = {}, exitPolicySummary = {}, parameterGovernorSummary = {}, nowIso }) {
    const updatedHigh = Math.max(position.highestPrice || position.entryPrice, currentPrice);
    const updatedLow = Math.min(position.lowestPrice || position.entryPrice, currentPrice);
    const adaptiveExitPolicy = this.resolveAdaptiveExitPolicy(exitPolicySummary, position);
    const entryDecisionContextConfidence = clamp(
      safeValue(
        position.entryRationale?.decisionContext?.confidence ??
        position.entryRationale?.entryDiagnostics?.decisionContextConfidence,
        0.5
      ),
      0,
      1
    );
    const contextExitUrgency = clamp((0.58 - entryDecisionContextConfidence) * 0.5, 0, 0.18);
    const parameterGovernorAdjustment = this.resolveParameterGovernor(parameterGovernorSummary, {
      activeStrategy: position.strategyAtEntry || position.strategyDecision?.activeStrategy || position.entryRationale?.strategy?.activeStrategy || null
    }, {
      regime: position.regimeAtEntry || position.entryRationale?.regimeSummary?.regime || null
    });
    const exitTrailBias = safeValue(exitIntelligenceSummary.trailTightnessBias, 0) + safeValue(adaptiveExitPolicy.trailTightnessBias, 0);
    const exitTrimBias = safeValue(exitIntelligenceSummary.trimBias, 0) + safeValue(adaptiveExitPolicy.trimBias, 0);
    const holdToleranceBias = safeValue(exitIntelligenceSummary.holdTolerance, 0) + safeValue(adaptiveExitPolicy.holdTolerance, 0);
    const maxHoldBias = safeValue(exitIntelligenceSummary.maxHoldBias, 0) + safeValue(adaptiveExitPolicy.maxHoldBias, 0);
    const trailingStopPct = clamp(
      (position.trailingStopPct || this.config.trailingStopPct) *
      (adaptiveExitPolicy.trailingStopMultiplier || 1) *
      (parameterGovernorAdjustment.trailingStopMultiplier || 1) *
      (1 + clamp(exitTrailBias, -0.18, 0.18)) *
      (1 - contextExitUrgency * 0.55),
      0.004,
      0.04
    );
    const trailingStopPrice = updatedHigh * (1 - trailingStopPct);
    const heldMinutes = minutesBetween(position.entryAt, nowIso);
    const scaleOutTriggerPrice =
      (position.scaleOutTriggerPrice || position.entryPrice * (1 + this.config.scaleOutTriggerPct)) *
      (adaptiveExitPolicy.scaleOutTriggerMultiplier || 1) *
      (parameterGovernorAdjustment.scaleOutTriggerMultiplier || 1) *
      (1 + clamp(-exitTrimBias * 0.35, -0.08, 0.08));
    const notional = position.lastMarkedPrice ? position.lastMarkedPrice * position.quantity : position.notional || position.totalCost || 0;
    const effectiveMaxHoldMinutes = Math.max(
      1,
      Math.round(
        (position.maxHoldMinutes || this.config.maxHoldMinutes || 1) *
        (adaptiveExitPolicy.maxHoldMinutesMultiplier || 1) *
        (parameterGovernorAdjustment.maxHoldMinutesMultiplier || 1) *
        (1 + clamp(maxHoldBias, -0.18, 0.18)) *
        (1 - contextExitUrgency * 0.5)
      )
    );
    const canScaleOut =
      !position.scaleOutCompletedAt &&
      !position.scaleOutInProgress &&
      (position.scaleOutFraction || this.config.scaleOutFraction) > 0 &&
      notional >= (position.scaleOutMinNotionalUsd || this.config.scaleOutMinNotionalUsd) * (1.2 + Math.max(0, holdToleranceBias) * 0.15) &&
      currentPrice >= scaleOutTriggerPrice;

    if (canScaleOut) {
      return {
        shouldExit: false,
        shouldScaleOut: true,
        scaleOutFraction: clamp(
          (exitIntelligenceSummary.trimFraction || position.scaleOutFraction || this.config.scaleOutFraction) *
          (adaptiveExitPolicy.scaleOutFractionMultiplier || 1) *
          (parameterGovernorAdjustment.scaleOutFractionMultiplier || 1) *
          (1 + clamp(exitTrimBias, -0.18, 0.18)),
          0.05,
          0.95
        ),
        scaleOutReason: "partial_take_profit",
        updatedHigh,
        updatedLow,
        exitPolicy: adaptiveExitPolicy
      };
    }
    if (currentPrice <= position.stopLossPrice) {
      return { shouldExit: true, shouldScaleOut: false, reason: "stop_loss", updatedHigh, updatedLow };
    }
    if (currentPrice >= position.takeProfitPrice) {
      if ((exitIntelligenceSummary.preferredExitStyle || adaptiveExitPolicy.preferredExitStyle) === "trail" && holdToleranceBias > 0.04) {
        return {
          shouldExit: false,
          shouldScaleOut: false,
          reason: null,
          updatedHigh,
          updatedLow,
          exitPolicy: adaptiveExitPolicy
        };
      }
      return { shouldExit: true, shouldScaleOut: false, reason: "take_profit", updatedHigh, updatedLow };
    }
    if (updatedHigh > position.entryPrice * 1.004 && currentPrice <= trailingStopPrice) {
      return { shouldExit: true, shouldScaleOut: false, reason: "trailing_stop", updatedHigh, updatedLow };
    }
    if (heldMinutes >= effectiveMaxHoldMinutes && (holdToleranceBias - contextExitUrgency * 0.4) <= 0.08) {
      return { shouldExit: true, shouldScaleOut: false, reason: "time_stop", updatedHigh, updatedLow };
    }
    if ((marketSnapshot.book?.spreadBps || 0) >= this.config.exitOnSpreadShockBps) {
      return { shouldExit: true, shouldScaleOut: false, reason: "spread_shock_exit", updatedHigh, updatedLow };
    }
    if ((marketSnapshot.book?.bookPressure || 0) < -0.62 && (marketSnapshot.market?.bearishPatternScore || 0) > 0.45) {
      return { shouldExit: true, shouldScaleOut: false, reason: "orderbook_reversal_exit", updatedHigh, updatedLow };
    }
    if ((marketStructureSummary.liquidationImbalance || 0) < -0.55 && (marketStructureSummary.riskScore || 0) > 0.55 && (marketStructureSummary.liquidationCount || 0) > 0) {
      return { shouldExit: true, shouldScaleOut: false, reason: "liquidation_shock_exit", updatedHigh, updatedLow };
    }
    if (newsSummary.riskScore > 0.8 && newsSummary.sentimentScore < -0.2) {
      return { shouldExit: true, shouldScaleOut: false, reason: "news_risk_exit", updatedHigh, updatedLow };
    }
    if ((announcementSummary.riskScore || 0) > 0.82) {
      return { shouldExit: true, shouldScaleOut: false, reason: "exchange_notice_exit", updatedHigh, updatedLow };
    }
    if ((calendarSummary.riskScore || 0) > 0.8 && (calendarSummary.proximityHours || 999) <= 6) {
      return { shouldExit: true, shouldScaleOut: false, reason: "calendar_risk_exit", updatedHigh, updatedLow };
    }
    if ((marketStructureSummary.riskScore || 0) > 0.85 && (marketStructureSummary.signalScore || 0) < -0.15) {
      return { shouldExit: true, shouldScaleOut: false, reason: "market_structure_exit", updatedHigh, updatedLow };
    }
    if (
      canScaleOut &&
      exitIntelligenceSummary.action === "trim" &&
      (exitIntelligenceSummary.confidence || 0) >= this.config.exitIntelligenceMinConfidence &&
      (exitIntelligenceSummary.trimScore || 0) >= this.config.exitIntelligenceTrimScore
    ) {
      return {
        shouldExit: false,
        shouldScaleOut: true,
        scaleOutFraction: clamp(
          (exitIntelligenceSummary.trimFraction || position.scaleOutFraction || this.config.scaleOutFraction) *
          (adaptiveExitPolicy.scaleOutFractionMultiplier || 1) *
          (parameterGovernorAdjustment.scaleOutFractionMultiplier || 1) *
          (1 + clamp(exitTrimBias, -0.18, 0.18)),
          0.05,
          0.95
        ),
        scaleOutReason: exitIntelligenceSummary.reason || "exit_ai_trim",
        updatedHigh,
        updatedLow,
        exitPolicy: adaptiveExitPolicy
      };
    }
    if (
      exitIntelligenceSummary.action === "exit" &&
      (exitIntelligenceSummary.confidence || 0) >= Math.max(0.2, this.config.exitIntelligenceMinConfidence - contextExitUrgency * 0.08) &&
      (exitIntelligenceSummary.exitScore || 0) >= Math.max(0.2, this.config.exitIntelligenceExitScore - contextExitUrgency * 0.06)
    ) {
      return { shouldExit: true, shouldScaleOut: false, reason: exitIntelligenceSummary.reason || "exit_ai_signal", updatedHigh, updatedLow };
    }

    return {
      shouldExit: false,
      shouldScaleOut: false,
      reason: null,
      updatedHigh,
      updatedLow,
      exitPolicy: adaptiveExitPolicy,
      exitContext: {
        entryDecisionContextConfidence: num(entryDecisionContextConfidence, 4),
        contextExitUrgency: num(contextExitUrgency, 4)
      }
    };
  }
}

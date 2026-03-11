import { clamp } from "../utils/math.js";
import { minutesBetween, sameUtcDay } from "../utils/time.js";

function safeValue(value) {
  return Number.isFinite(value) ? value : 0;
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
    "committee_confidence_too_low",
    "committee_low_agreement",
    "strategy_fit_too_low",
    "orderbook_sell_pressure",
    "meta_gate_caution",
    "execution_cost_budget_exceeded",
    "strategy_cooldown",
    "capital_governor_blocked",
    "capital_governor_recovery"
  ].includes(reason);
}

function canRelaxPaperSelfHeal(selfHealState = {}) {
  const issues = new Set(selfHealState.issues || []);
  return !issues.has("health_circuit_open");
}

function isPaperLeniencyReason(reason, selfHealState = {}) {
  if (reason === "self_heal_pause_entries") {
    return canRelaxPaperSelfHeal(selfHealState);
  }
  return isSoftPaperReason(reason);
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function matchesScopedAdjustment(entry = {}, strategyId = null, regimeId = null) {
  const strategies = entry.affectedStrategies || [];
  const regimes = entry.affectedRegimes || [];
  const strategyMatch = !strategies.length || (strategyId && strategies.includes(strategyId));
  const regimeMatch = !regimes.length || (regimeId && regimes.includes(regimeId));
  return strategyMatch || regimeMatch;
}

export class RiskManager {
  constructor(config) {
    this.config = config;
  }

  getDailyRealizedPnl(journal, nowIso) {
    const tradePnl = (journal?.trades || [])
      .filter((trade) => trade.exitAt && sameUtcDay(trade.exitAt, nowIso))
      .reduce((total, trade) => total + (trade.pnlQuote || 0), 0);
    const scaleOutPnl = (journal?.scaleOuts || [])
      .filter((event) => event.at && sameUtcDay(event.at, nowIso))
      .reduce((total, event) => total + (event.realizedPnl || 0), 0);
    return tradePnl + scaleOutPnl;
  }

  getRecentTradeForSymbol(journal, symbol) {
    return [...(journal?.trades || [])].reverse().find((trade) => trade.symbol === symbol && trade.exitAt);
  }

  getDailyEntryCountForSymbol(journal, runtime, symbol, nowIso) {
    const closedEntries = (journal?.trades || []).filter(
      (trade) => trade.symbol === symbol && trade.entryAt && sameUtcDay(trade.entryAt, nowIso)
    ).length;
    const openEntries = (runtime?.openPositions || []).filter(
      (position) => position.symbol === symbol && position.entryAt && sameUtcDay(position.entryAt, nowIso)
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
    return (runtime.openPositions || []).reduce((total, position) => total + (position.notional || position.quantity * position.entryPrice), 0);
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

  resolveAdaptiveExitPolicy(exitLearningSummary = {}, position = {}) {
    const strategyId = position.strategyAtEntry || position.strategyDecision?.activeStrategy || position.entryRationale?.strategy?.activeStrategy || null;
    const regimeId = position.regimeAtEntry || position.entryRationale?.regimeSummary?.regime || null;
    const strategyPolicy = (exitLearningSummary?.strategyPolicies || []).find((item) => item.id === strategyId) || null;
    const regimePolicy = (exitLearningSummary?.regimePolicies || []).find((item) => item.id === regimeId) || null;
    const policies = [strategyPolicy, regimePolicy].filter(Boolean);
    if (!policies.length) {
      return {
        active: false,
        scaleOutFractionMultiplier: 1,
        scaleOutTriggerMultiplier: 1,
        trailingStopMultiplier: 1,
        maxHoldMinutesMultiplier: 1,
        sources: []
      };
    }
    return {
      active: true,
      scaleOutFractionMultiplier: clamp(average(policies.map((item) => safeValue(item.scaleOutFractionMultiplier || 1)), 1), 0.75, 1.25),
      scaleOutTriggerMultiplier: clamp(average(policies.map((item) => safeValue(item.scaleOutTriggerMultiplier || 1)), 1), 0.78, 1.25),
      trailingStopMultiplier: clamp(average(policies.map((item) => safeValue(item.trailingStopMultiplier || 1)), 1), 0.82, 1.22),
      maxHoldMinutesMultiplier: clamp(average(policies.map((item) => safeValue(item.maxHoldMinutesMultiplier || 1)), 1), 0.75, 1.25),
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
      confidence: safeValue(policy.confidence || 0)
    };
  }

  resolveExecutionCostBudget(executionCostSummary = {}, strategySummary = {}, regimeSummary = {}) {
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
        averageTotalCostBps: safeValue(executionCostSummary.averageTotalCostBps || 0)
      };
    }
    const averageTotalCostBps = average(scopes.map((item) => safeValue(item.averageTotalCostBps || 0)), safeValue(executionCostSummary.averageTotalCostBps || 0));
    const averageSlippageDeltaBps = average(scopes.map((item) => safeValue(item.averageSlippageDeltaBps || 0)), safeValue(executionCostSummary.averageSlippageDeltaBps || 0));
    const blocked = scopes.some((item) => (item.status || "") === "blocked");
    const caution = !blocked && scopes.some((item) => (item.status || "") === "caution");
    return {
      active: true,
      status: blocked ? "blocked" : caution ? "caution" : "ready",
      blocked,
      sizeMultiplier: blocked ? 0.58 : caution ? 0.82 : 1,
      averageTotalCostBps,
      averageSlippageDeltaBps,
      notes: [...new Set(scopes.map((item) => item.id).filter(Boolean))]
    };
  }

  resolveCapitalGovernor(capitalGovernorSummary = {}) {
    return {
      active: Boolean(capitalGovernorSummary.status),
      status: capitalGovernorSummary.status || "warmup",
      blocked: capitalGovernorSummary.allowEntries === false,
      recoveryMode: Boolean(capitalGovernorSummary.recoveryMode),
      sizeMultiplier: clamp(safeValue(capitalGovernorSummary.sizeMultiplier ?? 1), 0, 1),
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
    strategyMetaSummary = {}
  }) {
    const reasons = [];
    const openPositions = runtime.openPositions || [];
    const baseThreshold = Math.max(this.config.modelThreshold, this.config.minModelConfidence);
    const optimizerAdjustments = this.getOptimizerAdjustments(strategySummary);
    const thresholdTuningAdjustment = this.getThresholdTuningAdjustment(thresholdTuningSummary, strategySummary, regimeSummary);
    const parameterGovernorAdjustment = this.resolveParameterGovernor(parameterGovernorSummary, strategySummary, regimeSummary);
    const strategyRetirementPolicy = this.resolveStrategyRetirement(strategyRetirementSummary, strategySummary);
    const executionCostBudget = this.resolveExecutionCostBudget(executionCostSummary, strategySummary, regimeSummary);
    const capitalGovernor = this.resolveCapitalGovernor(capitalGovernorSummary);
    const sessionThresholdPenalty = safeValue(sessionSummary.thresholdPenalty || 0);
    const driftThresholdPenalty = safeValue(driftSummary.severity || 0) >= 0.82 ? 0.05 : safeValue(driftSummary.severity || 0) >= 0.45 ? 0.02 : 0;
    const rawSelfHealThresholdPenalty = safeValue(selfHealState.thresholdPenalty || 0);
    const selfHealThresholdPenalty = this.config.botMode === "paper" && canRelaxPaperSelfHeal(selfHealState)
      ? Math.min(rawSelfHealThresholdPenalty, 0.02)
      : rawSelfHealThresholdPenalty;
    const metaThresholdPenalty = safeValue(metaSummary.thresholdPenalty || 0);
    const calibrationWarmup = clamp(safeValue(score.calibrator?.warmupProgress ?? score.calibrator?.globalConfidence ?? 0), 0, 1);
    const paperWarmupDiscount = this.config.botMode === "paper" ? (1 - calibrationWarmup) * 0.06 : 0;
    const thresholdFloor = this.config.botMode === "paper"
      ? Math.max(0.5, this.config.minModelConfidence - paperWarmupDiscount)
      : this.config.minModelConfidence;
    const threshold = clamp(
      baseThreshold - optimizerAdjustments.thresholdAdjustment - paperWarmupDiscount + sessionThresholdPenalty + driftThresholdPenalty + selfHealThresholdPenalty + metaThresholdPenalty + thresholdTuningAdjustment.adjustment + parameterGovernorAdjustment.thresholdShift + safeValue(strategyMetaSummary.thresholdShift || 0),
      thresholdFloor,
      0.99
    );
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
    const selfHealSizeMultiplier = clamp(safeValue(selfHealState.sizeMultiplier) || 1, 0, 1);
    const metaSizeMultiplier = clamp(safeValue(metaSummary.sizeMultiplier) || 1, 0.1, 1.15);
    const strategyMetaSizeMultiplier = clamp(safeValue(strategyMetaSummary.sizeMultiplier) || 1, 0.75, 1.15);
    const venueSizeMultiplier = clamp((venueConfirmationSummary.status || "") === "blocked" ? 0.45 : (venueConfirmationSummary.confirmed ? 1.04 : 0.9), 0.45, 1.05);
    const capitalLadderSizeMultiplier = clamp(safeValue(capitalLadderSummary.sizeMultiplier) || 1, 0, 1.2);
    const capitalGovernorSizeMultiplier = clamp(capitalGovernor.sizeMultiplier || 1, 0, 1);
    const retirementSizeMultiplier = clamp(strategyRetirementPolicy.sizeMultiplier || 1, 0, 1);
    const executionCostSizeMultiplier = clamp(executionCostBudget.sizeMultiplier || 1, 0.45, 1);
    const lowRiskCandidate = ["trend_following", "mean_reversion", "orderflow"].includes(strategySummary.family || "") &&
      (marketSnapshot.book.spreadBps || 0) <= Math.max(this.config.maxSpreadBps * 0.4, 3) &&
      (marketSnapshot.market.realizedVolPct || 0) <= this.config.maxRealizedVolPct * 0.75 &&
      (newsSummary.riskScore || 0) <= 0.42 &&
      (calendarSummary.riskScore || 0) <= 0.42;

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
    if (strategyRetirementPolicy.blocked) {
      reasons.push("strategy_retired");
    } else if (strategyRetirementPolicy.active && (strategyRetirementPolicy.status || "") === "cooldown" && score.probability < threshold + 0.04) {
      reasons.push("strategy_cooldown");
    }
    if (["paused", "paper_fallback"].includes(selfHealState.mode)) {
      reasons.push("self_heal_pause_entries");
    }
    if (openPositions.some((position) => position.symbol === symbol)) {
      reasons.push("position_already_open");
    }
    if (score.probability < threshold) {
      reasons.push("model_confidence_too_low");
    }
    if (score.shouldAbstain) {
      reasons.push("model_uncertainty_abstain");
    }
    if ((score.transformer?.confidence || 0) >= this.config.transformerMinConfidence && (score.transformer?.probability || 0) < threshold - 0.03) {
      reasons.push("transformer_challenger_reject");
    }
    if (marketSnapshot.book.spreadBps > this.config.maxSpreadBps) {
      reasons.push("spread_too_wide");
    }
    if (marketSnapshot.market.realizedVolPct > this.config.maxRealizedVolPct) {
      reasons.push("volatility_too_high");
    }
    if ((marketSnapshot.book.bookPressure || 0) < this.config.minBookPressureForEntry) {
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
    if (sessionSummary.isWeekend && this.config.blockWeekendHighRiskStrategies && ["breakout", "market_structure", "derivatives"].includes(strategySummary.family || "")) {
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
    if ((committeeSummary.vetoes || []).length) {
      reasons.push("committee_veto");
    }
    const committeeGuardBuffer = this.config.botMode === "paper" ? 0.08 : 0.02;
    const committeeNetGuard = this.config.botMode === "paper" ? -0.14 : -0.05;
    if (
      (committeeSummary.confidence || 0) >= this.config.committeeMinConfidence &&
      (committeeSummary.probability || 0) < threshold - committeeGuardBuffer &&
      (committeeSummary.netScore || 0) <= committeeNetGuard
    ) {
      reasons.push("committee_confidence_too_low");
    }
    if ((committeeSummary.agreement || 0) < this.config.committeeMinAgreement && score.probability < threshold + 0.04) {
      reasons.push("committee_low_agreement");
    }
    if ((strategySummary.confidence || 0) >= strategyConfidenceFloor && (strategySummary.fitScore || 0) < 0.5 && score.probability < threshold + 0.05) {
      reasons.push("strategy_fit_too_low");
    }
    if ((strategySummary.confidence || 0) >= strategyConfidenceFloor && (strategySummary.blockers || []).length && score.probability < threshold + 0.07) {
      reasons.push("strategy_context_mismatch");
    }
    if (globalLossStreak >= this.config.maxLossStreak) {
      reasons.push("portfolio_loss_streak_guard");
    }
    if (symbolLossStreak >= this.config.maxSymbolLossStreak) {
      reasons.push("symbol_loss_streak_guard");
    }
    if (dailyLossFraction >= this.config.maxDailyDrawdown) {
      reasons.push("daily_drawdown_limit_hit");
    }
    if (currentExposure / totalEquityProxy >= this.config.maxTotalExposureFraction) {
      reasons.push("max_total_exposure_reached");
    }
    if ((portfolioSummary.reasons || []).length) {
      reasons.push(...portfolioSummary.reasons);
    }
    if (executionCostBudget.blocked) {
      reasons.push("execution_cost_budget_exceeded");
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
    if ((divergenceSummary?.leadBlocker?.status || "") === "blocked" && this.config.botMode === "live") {
      reasons.push("live_paper_divergence_guard");
    }
    if ((metaSummary.dailyTradeCount || 0) >= this.config.maxEntriesPerDay) {
      reasons.push("daily_entry_budget_reached");
    }
    if (metaSummary.action === "caution" && score.probability < threshold + 0.015) {
      reasons.push("meta_gate_caution");
    }

    const recentTrade = this.getRecentTradeForSymbol(journal, symbol);
    const dailyEntriesForSymbol = this.getDailyEntryCountForSymbol(journal, runtime, symbol, nowIso);
    if (dailyEntriesForSymbol >= this.config.maxEntriesPerSymbolPerDay && this.config.botMode !== "paper") {
      reasons.push("symbol_entry_budget_reached");
    }
    if (
      this.config.botMode !== "paper" &&
      recentTrade?.exitAt &&
      (recentTrade.pnlQuote || 0) < 0 &&
      minutesBetween(recentTrade.exitAt, nowIso) < this.config.symbolLossCooldownMinutes
    ) {
      reasons.push("symbol_loss_cooldown_active");
    }
    if (recentTrade?.exitAt && minutesBetween(recentTrade.exitAt, nowIso) < this.config.entryCooldownMinutes) {
      reasons.push("entry_cooldown_active");
    }
    const recentPortfolioTradeAt = getMostRecentTradeTimestamp(journal);
    const minutesSincePortfolioTrade = recentPortfolioTradeAt ? minutesBetween(recentPortfolioTradeAt, nowIso) : Number.POSITIVE_INFINITY;

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
    const divergenceFactor = clamp((divergenceSummary.averageScore || 0) >= this.config.divergenceBlockScore ? 0.55 : (divergenceSummary.averageScore || 0) >= this.config.divergenceAlertScore ? 0.86 : 1, 0.5, 1);
    const heatPenalty = clamp(1 - portfolioHeat * 0.45, 0.55, 1);
    const streakPenalty = clamp(1 - globalLossStreak * 0.08 - symbolLossStreak * 0.06, 0.55, 1);

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
      parameterGovernorAdjustment.executionAggressivenessBias;

    if (quoteAmount < this.config.minTradeUsdt) {
      reasons.push("trade_size_below_minimum");
    }

    let allow = reasons.length === 0;
    let entryMode = "standard";
    let suppressedReasons = [];
    let finalQuoteAmount = quoteAmount;
    let paperExploration = null;
    let paperGuardrailRelief = [];

    const eligiblePaperSuppressedReasons = reasons.filter((reason) => isPaperLeniencyReason(reason, selfHealState));
    const paperGuardrailReasons = eligiblePaperSuppressedReasons.filter((reason) =>
      [
        "self_heal_pause_entries",
        "execution_cost_budget_exceeded",
        "capital_governor_blocked",
        "capital_governor_recovery",
        "strategy_cooldown"
      ].includes(reason)
    );

    if (
      !allow &&
      this.config.botMode === "paper" &&
      this.config.paperExplorationEnabled &&
      openPositions.length === 0 &&
      minutesSincePortfolioTrade >= this.config.paperExplorationCooldownMinutes &&
      reasons.length > 0 &&
      reasons.every((reason) => isPaperLeniencyReason(reason, selfHealState)) &&
      score.probability >= threshold - this.config.paperExplorationThresholdBuffer &&
      (marketSnapshot.book.bookPressure || 0) >= this.config.paperExplorationMinBookPressure &&
      (marketSnapshot.book.spreadBps || 0) <= Math.min(this.config.maxSpreadBps * 0.4, 8) &&
      (marketSnapshot.market.realizedVolPct || 0) <= this.config.maxRealizedVolPct * 0.75 &&
      (newsSummary.riskScore || 0) <= 0.32 &&
      (announcementSummary.riskScore || 0) <= 0.2 &&
      (calendarSummary.riskScore || 0) <= 0.28 &&
      (marketStructureSummary.riskScore || 0) <= 0.32 &&
      (volatilitySummary.riskScore || 0) <= 0.72 &&
      !(sessionSummary.blockerReasons || []).length &&
      !(driftSummary.blockerReasons || []).length &&
      canRelaxPaperSelfHeal(selfHealState)
    ) {
      const explorationBudget = Math.min(maxByPosition, maxByRisk, remainingExposureBudget);
      const explorationQuoteAmount = Math.min(
        explorationBudget,
        Math.max(this.config.minTradeUsdt, quoteAmount * this.config.paperExplorationSizeMultiplier)
      );
      if (explorationQuoteAmount >= this.config.minTradeUsdt) {
        allow = true;
        entryMode = "paper_exploration";
        suppressedReasons = [...reasons];
        paperGuardrailRelief = paperGuardrailReasons;
        finalQuoteAmount = explorationQuoteAmount;
        paperExploration = {
          mode: "paper_exploration",
          thresholdBuffer: this.config.paperExplorationThresholdBuffer,
          sizeMultiplier: this.config.paperExplorationSizeMultiplier,
          minBookPressure: this.config.paperExplorationMinBookPressure,
          minutesSincePortfolioTrade: Number.isFinite(minutesSincePortfolioTrade) ? minutesSincePortfolioTrade : null,
          warmupProgress: calibrationWarmup,
          suppressedReasons,
          guardrailReliefReasons: paperGuardrailRelief,
          selfHealRelaxed: suppressedReasons.includes("self_heal_pause_entries"),
          selfHealIssues: [...(selfHealState.issues || [])]
        };
      }
    }

    return {
      allow,
      reasons: allow ? [] : reasons,
      suppressedReasons,
      entryMode,
      paperExploration,
      paperGuardrailRelief,
      baseThreshold,
      threshold,
      thresholdAdjustment: optimizerAdjustments.thresholdAdjustment,
      thresholdTuningApplied: thresholdTuningAdjustment,
      parameterGovernorApplied: parameterGovernorAdjustment,
      strategyRetirementApplied: strategyRetirementPolicy,
      executionCostBudgetApplied: executionCostBudget,
      capitalGovernorApplied: capitalGovernor,
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
        (score.calibrationConfidence || 0) * 0.02
    };
  }

  evaluateExit({ position, currentPrice, newsSummary, announcementSummary = {}, marketStructureSummary = {}, calendarSummary = {}, marketSnapshot = {}, exitIntelligenceSummary = {}, exitPolicySummary = {}, parameterGovernorSummary = {}, nowIso }) {
    const updatedHigh = Math.max(position.highestPrice || position.entryPrice, currentPrice);
    const updatedLow = Math.min(position.lowestPrice || position.entryPrice, currentPrice);
    const adaptiveExitPolicy = this.resolveAdaptiveExitPolicy(exitPolicySummary, position);
    const parameterGovernorAdjustment = this.resolveParameterGovernor(parameterGovernorSummary, {
      activeStrategy: position.strategyAtEntry || position.strategyDecision?.activeStrategy || position.entryRationale?.strategy?.activeStrategy || null
    }, {
      regime: position.regimeAtEntry || position.entryRationale?.regimeSummary?.regime || null
    });
    const trailingStopPct = clamp((position.trailingStopPct || this.config.trailingStopPct) * (adaptiveExitPolicy.trailingStopMultiplier || 1) * (parameterGovernorAdjustment.trailingStopMultiplier || 1), 0.004, 0.04);
    const trailingStopPrice = updatedHigh * (1 - trailingStopPct);
    const heldMinutes = minutesBetween(position.entryAt, nowIso);
    const scaleOutTriggerPrice = (position.scaleOutTriggerPrice || position.entryPrice * (1 + this.config.scaleOutTriggerPct)) * (adaptiveExitPolicy.scaleOutTriggerMultiplier || 1) * (parameterGovernorAdjustment.scaleOutTriggerMultiplier || 1);
    const notional = position.lastMarkedPrice ? position.lastMarkedPrice * position.quantity : position.notional || position.totalCost || 0;
    const effectiveMaxHoldMinutes = Math.max(1, Math.round((position.maxHoldMinutes || this.config.maxHoldMinutes || 1) * (adaptiveExitPolicy.maxHoldMinutesMultiplier || 1) * (parameterGovernorAdjustment.maxHoldMinutesMultiplier || 1)));
    const canScaleOut =
      !position.scaleOutCompletedAt &&
      !position.scaleOutInProgress &&
      (position.scaleOutFraction || this.config.scaleOutFraction) > 0 &&
      notional >= (position.scaleOutMinNotionalUsd || this.config.scaleOutMinNotionalUsd) * 1.2 &&
      currentPrice >= scaleOutTriggerPrice;

    if (canScaleOut) {
      return {
        shouldExit: false,
        shouldScaleOut: true,
        scaleOutFraction: clamp(
          (exitIntelligenceSummary.trimFraction || position.scaleOutFraction || this.config.scaleOutFraction) * (adaptiveExitPolicy.scaleOutFractionMultiplier || 1) * (parameterGovernorAdjustment.scaleOutFractionMultiplier || 1),
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
      return { shouldExit: true, shouldScaleOut: false, reason: "take_profit", updatedHigh, updatedLow };
    }
    if (updatedHigh > position.entryPrice * 1.004 && currentPrice <= trailingStopPrice) {
      return { shouldExit: true, shouldScaleOut: false, reason: "trailing_stop", updatedHigh, updatedLow };
    }
    if (heldMinutes >= effectiveMaxHoldMinutes) {
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
          (exitIntelligenceSummary.trimFraction || position.scaleOutFraction || this.config.scaleOutFraction) * (adaptiveExitPolicy.scaleOutFractionMultiplier || 1) * (parameterGovernorAdjustment.scaleOutFractionMultiplier || 1),
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
      (exitIntelligenceSummary.confidence || 0) >= this.config.exitIntelligenceMinConfidence &&
      (exitIntelligenceSummary.exitScore || 0) >= this.config.exitIntelligenceExitScore
    ) {
      return { shouldExit: true, shouldScaleOut: false, reason: exitIntelligenceSummary.reason || "exit_ai_signal", updatedHigh, updatedLow };
    }

    return {
      shouldExit: false,
      shouldScaleOut: false,
      reason: null,
      updatedHigh,
      updatedLow,
      exitPolicy: adaptiveExitPolicy
    };
  }
}

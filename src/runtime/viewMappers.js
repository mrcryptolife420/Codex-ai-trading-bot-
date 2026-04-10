function toNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function round(value, digits = 4) {
  return Number(toNumber(value, 0).toFixed(digits));
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(arr(values).filter(Boolean))];
}

function classifyDecisionReason(reason = null) {
  const id = `${reason || ""}`.trim().toLowerCase();
  if (!id) {
    return "unknown";
  }
  if (/execution|spread|slippage|book|depth|liquidity|maker|taker/.test(id)) {
    return "execution";
  }
  if (/capital|budget|exposure|position|quote|size|risk|drawdown/.test(id)) {
    return "risk";
  }
  if (/committee|meta|policy|governor|retire|promotion|governance/.test(id)) {
    return "governance";
  }
  if (/session|trend|regime|alignment|condition|drift|cooldown|duplicate/.test(id)) {
    return "context";
  }
  if (/quality|confidence|feature|data|source|calendar|news|event|quorum/.test(id)) {
    return "quality";
  }
  return "strategy";
}

export function buildCoreMetricsView({ report = {}, overview = {} } = {}) {
  return {
    tradeCount: toNumber(report.tradeCount, 0),
    realizedPnl: round(report.realizedPnl, 2),
    winRate: round(report.winRate, 4),
    averagePnlPct: round(report.averagePnlPct, 4),
    maxDrawdownPct: round(report.maxDrawdownPct, 4),
    openExposure: round(report.openExposure ?? overview.openExposure, 2),
    quoteFree: round(overview.quoteFree, 2),
    equity: round(overview.equity, 2)
  };
}

export function buildDecisionTruthView(decision = {}) {
  const blockerReasons = unique([
    ...arr(decision.blockerReasons || decision.reasons || []),
    ...arr(decision.entryDiagnostics?.strongestRejectingFactors || [])
  ]);
  const confirmationReasons = unique([
    ...arr(decision.approvalReasons || []),
    ...arr(decision.entryDiagnostics?.strongestConfirmingFactors || [])
  ]);
  const primaryReason = decision.entryDiagnostics?.decisionPrimaryReason ||
    blockerReasons[0] ||
    confirmationReasons[0] ||
    null;
  const baseThreshold = round(decision.baseThreshold ?? decision.threshold ?? 0, 4);
  const effectiveThreshold = round(
    decision.effectiveThreshold ?? decision.threshold ?? decision.baseThreshold ?? 0,
    4
  );
  const thresholdAdjustment = round(
    decision.thresholdAdjustment ??
      (effectiveThreshold - baseThreshold),
    4
  );
  const thresholdBuffer = round(
    decision.edgeToThreshold ??
      decision.entryDiagnostics?.thresholdBuffer ??
      (toNumber(decision.probability, 0) - effectiveThreshold),
    4
  );
  return {
    decision: decision.allow ? "tradeable" : "blocked",
    primaryReason,
    primaryCategory: classifyDecisionReason(primaryReason),
    blockerReasonChain: blockerReasons.slice(0, 4),
    confirmationReasonChain: confirmationReasons.slice(0, 4),
    baseThreshold,
    effectiveThreshold,
    thresholdAdjustment,
    thresholdBuffer
  };
}

export function buildExecutionTruthView(decision = {}) {
  const rawQuoteAmount = toNumber(
    decision.sizingSummary?.rawQuoteAmount ?? decision.rawQuoteAmount,
    0
  );
  const adjustedQuoteAmount = toNumber(
    decision.sizingSummary?.adjustedQuoteAmount ?? decision.adjustedQuoteAmount ?? rawQuoteAmount,
    0
  );
  const cappedQuoteAmount = toNumber(
    decision.sizingSummary?.cappedQuoteAmount ?? decision.cappedQuoteAmount ?? adjustedQuoteAmount,
    0
  );
  const finalQuoteAmount = toNumber(decision.quoteAmount ?? decision.finalQuoteAmount ?? cappedQuoteAmount, 0);
  const meaningfulSizeFloor = toNumber(
    decision.sizingSummary?.meaningfulSizeFloor ?? decision.sizeVerdict?.meaningfulSizeFloor,
    0
  );
  const invalidQuoteAmount = Boolean(decision.sizingSummary?.invalidQuoteAmount ?? decision.invalidQuoteAmount);
  const deservesMeaningfulSize = decision.sizingSummary?.deservesMeaningfulSize ??
    decision.sizeVerdict?.deservesMeaningfulSize ??
    (finalQuoteAmount >= meaningfulSizeFloor || meaningfulSizeFloor <= 0);
  const executable = finalQuoteAmount > 0 && !invalidQuoteAmount;
  const tinySize = executable && !deservesMeaningfulSize;
  return {
    policySizedAmount: round(rawQuoteAmount, 4),
    adjustedAmount: round(adjustedQuoteAmount, 4),
    cappedAmount: round(cappedQuoteAmount, 4),
    finalExecutableAmount: round(finalQuoteAmount, 4),
    meaningfulSizeFloor: round(meaningfulSizeFloor, 4),
    invalidQuoteAmount,
    deservesMeaningfulSize: Boolean(deservesMeaningfulSize),
    executable,
    tinySize,
    nonExecutable: !executable,
    status: !executable ? "non_executable" : tinySize ? "probe_size" : "executable"
  };
}

export function buildLearningImpactView(decision = {}) {
  const paperGuidance = decision.paperLearningGuidance || {};
  const offlineGuidance = decision.offlineLearningGuidance || {};
  const onlineAdaptation = offlineGuidance.onlineAdaptation || {};
  const strategyReweighting = offlineGuidance.strategyReweighting || {};
  const runtimeEvidence = unique([
    paperGuidance.focusReason,
    paperGuidance.benchmarkLead,
    paperGuidance.targetScopeMatched ? "scope_readiness_match" : null,
    offlineGuidance.focusReason,
    ...(arr(offlineGuidance.matchedOutcomeScopes || []).map((item) => item.id)),
    ...(arr(onlineAdaptation.reasons || [])),
    strategyReweighting.id ? `family_bias:${strategyReweighting.id}` : null
  ]);
  const runtimeApplied = Boolean(
    Math.abs(toNumber(offlineGuidance.thresholdShift, 0)) > 0 ||
    Math.abs(toNumber(offlineGuidance.sizeMultiplier, 1) - 1) > 0.0001 ||
    Math.abs(toNumber(offlineGuidance.priorityBoost, 0)) > 0 ||
    Math.abs(toNumber(paperGuidance.priorityBoost, 0)) > 0 ||
    Math.abs(toNumber(paperGuidance.probeBoost, 0)) > 0 ||
    Math.abs(toNumber(paperGuidance.shadowBoost, 0)) > 0 ||
    Boolean(decision.learningLane)
  );
  const analysisOnlyEvidence = unique([
    ...(arr(offlineGuidance.impactedFeatures || []).slice(0, 4)),
    ...(arr(offlineGuidance.impactedFeatureGroups || []).map((item) => item.group))
  ]);
  return {
    runtimeApplied,
    laneRecommendation: decision.learningLane || paperGuidance.preferredLane || null,
    thresholdShift: round(offlineGuidance.thresholdShift || 0, 4),
    sizeMultiplier: round(offlineGuidance.sizeMultiplier || 1, 4),
    offlinePriorityBoost: round(offlineGuidance.priorityBoost || 0, 4),
    priorityBoost: round(paperGuidance.priorityBoost || 0, 4),
    cautionPenalty: round(
      Math.max(
        toNumber(paperGuidance.cautionPenalty, 0),
        toNumber(offlineGuidance.cautionPenalty, 0)
      ),
      4
    ),
    runtimeEvidence: runtimeEvidence.slice(0, 4),
    analysisOnlyEvidence: analysisOnlyEvidence.slice(0, 4),
    sourceStatus: paperGuidance.sourceStatus || offlineGuidance.sourceStatus || null,
    onlineAdaptation: offlineGuidance.onlineAdaptation || null,
    strategyReweighting: offlineGuidance.strategyReweighting || null,
    note: paperGuidance.note || offlineGuidance.note || null
  };
}

export function buildScannerPriorityView(decision = {}, scannerEntry = null) {
  const priority = decision.scannerPriority || scannerEntry || {};
  const rank = Number.isFinite(priority.scannerRank) ? priority.scannerRank : (Number.isFinite(priority.rank) ? priority.rank : null);
  const lane = priority.scannerLane || priority.recommendedLane || null;
  const action = priority.scannerAction || priority.recommendedAction || null;
  const priorityApplied = round(priority.priorityApplied || 0, 4);
  return {
    scannerRank: rank,
    scannerLane: lane,
    scannerAction: action,
    scannerScore: round(priority.finalScore || priority.scannerScore || 0, 4),
    priorityApplied,
    seededByScanner: Boolean(priority.seededByScanner || priorityApplied > 0 || rank != null)
  };
}

export function buildFeatureUsefulnessView(scorecards = []) {
  const groups = new Map();
  for (const item of arr(scorecards)) {
    const id = item.group || "context";
    if (!groups.has(id)) {
      groups.set(id, {
        group: id,
        featureCount: 0,
        positiveCount: 0,
        negativeCount: 0,
        totalInfluence: 0,
        topFeature: null
      });
    }
    const group = groups.get(id);
    group.featureCount += 1;
    if (toNumber(item.signedEdge, 0) >= 0) {
      group.positiveCount += 1;
    } else {
      group.negativeCount += 1;
    }
    group.totalInfluence += Math.abs(toNumber(item.influenceScore, 0));
    if (!group.topFeature || toNumber(item.influenceScore, 0) > toNumber(group.topFeature.influenceScore, 0)) {
      group.topFeature = {
        id: item.id || null,
        influenceScore: round(item.influenceScore || 0, 4),
        predictiveScore: round(item.predictiveScore || 0, 4)
      };
    }
  }
  return [...groups.values()]
    .map((item) => ({
      group: item.group,
      featureCount: item.featureCount,
      positiveCount: item.positiveCount,
      negativeCount: item.negativeCount,
      averageInfluence: round(item.totalInfluence / Math.max(item.featureCount, 1), 4),
      topFeature: item.topFeature
    }))
    .sort((left, right) => right.averageInfluence - left.averageInfluence);
}

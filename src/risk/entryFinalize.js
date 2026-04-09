function safeValue(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeValue(value, 0).toFixed(digits));
}

export function buildReasonProfiles(reasons = [], { classifyReasonCategory, reasonSeverity }) {
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
  return {
    blockerCategoryCounts,
    reasonSeverityProfile
  };
}

export function buildEntryDiagnosticsSummary({
  regimeSummary,
  strategySummary,
  allow,
  marketStateSummary,
  marketConditionId,
  marketConditionConfidence,
  marketConditionRisk,
  marketConditionSummary,
  score,
  threshold,
  candidateApprovalReasons,
  reasons,
  blockerCategoryCounts,
  reasonSeverityProfile,
  ambiguityScore,
  ambiguityThreshold,
  decisionContextConfidence
}) {
  return {
    regime: regimeSummary.regime || null,
    setupFamily: strategySummary?.family || null,
    activeStrategy: strategySummary?.activeStrategy || null,
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
    decision: allow ? "tradeable" : "blocked",
    decisionPrimaryReason: allow
      ? (candidateApprovalReasons[0] || null)
      : (reasons[0] || null),
    blockerCategoryCounts,
    reasonSeverityProfile,
    ambiguityScore: num(ambiguityScore, 4),
    ambiguityThreshold: num(ambiguityThreshold, 4),
    decisionContextConfidence: num(decisionContextConfidence, 4)
  };
}

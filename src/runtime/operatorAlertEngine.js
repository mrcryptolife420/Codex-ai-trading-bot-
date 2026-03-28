function arr(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function topCountKey(counter = {}) {
  return Object.entries(counter || {})
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })[0]?.[0] || null;
}

function makeAlert(id, severity, title, reason, action, extra = {}) {
  return {
    id,
    severity,
    title,
    reason,
    action,
    ...extra
  };
}

function isPaperGovernanceAlert(id) {
  return [
    "execution_cost_budget_blocked",
    "capital_governor_blocked",
    "capital_governor_recovery",
    "readiness_degraded",
    "paper_signal_flow_stalled"
  ].includes(id);
}

function resolveAlertState(id, alertState = {}, nowIso = new Date().toISOString()) {
  const acknowledgedAt = alertState.acknowledgedAtById?.[id] || null;
  const silencedUntil = alertState.silencedUntilById?.[id] || null;
  const resolvedAt = alertState.resolvedAtById?.[id] || null;
  const lastDeliveredAt = alertState.delivery?.lastDeliveredAtById?.[id] || null;
  const muted = (() => {
    const silenceMs = new Date(silencedUntil || 0).getTime();
    const nowMs = new Date(nowIso).getTime();
    return Boolean(silencedUntil) && Number.isFinite(silenceMs) && silenceMs > nowMs;
  })();
  return {
    acknowledgedAt,
    silencedUntil,
    resolvedAt,
    lastDeliveredAt,
    muted,
    active: !muted && !resolvedAt,
    state: resolvedAt ? "resolved" : muted ? "silenced" : acknowledgedAt ? "acked" : "new"
  };
}

export function buildOperatorAlerts({
  runtime = {},
  report = {},
  readiness = {},
  exchangeSafety = {},
  strategyRetirement = {},
  executionCost = {},
  capitalGovernor = {},
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const rawAlerts = [];
  const lifecycle = runtime.orderLifecycle || {};
  const health = runtime.health || {};
  const selfHeal = runtime.selfHeal || {};
  const thresholdTuning = runtime.thresholdTuning || {};
  const signalFlow = runtime.signalFlow || {};
  const alertState = runtime.ops?.alertState || {};
  const botMode = `${config.botMode || runtime.botMode || "paper"}`.toLowerCase();
  const paperMode = botMode === "paper";

  if (health.circuitOpen) {
    rawAlerts.push(makeAlert(
      "health_circuit_open",
      "critical",
      "Trading circuit open",
      health.reason || "Te veel cycle failures of stale runtime telemetry.",
      "Onderzoek cycle failures en laat eerst een schone run slagen."
    ));
  }
  if ((exchangeSafety.status || "") === "blocked") {
    rawAlerts.push(makeAlert(
      "exchange_safety_blocked",
      "critical",
      "Exchange safety blokkeert entries",
      (exchangeSafety.notes || [])[0] || "Exchange safety audit markeerde de runtime als blocked.",
      (exchangeSafety.actions || [])[0] || "Draai eerst een reconcile-pass."
    ));
  }
  if (arr(lifecycle.pendingActions).some((item) => ["manual_review", "reconcile_required"].includes(item.state))) {
    rawAlerts.push(makeAlert(
      "lifecycle_attention_required",
      "high",
      "Positie vraagt operator aandacht",
      "Een open positie staat in manual review of reconcile_required.",
      "Controleer quantity, protective state en recente exchange actions."
    ));
  }
  if ((strategyRetirement.retireCount || 0) > 0) {
    rawAlerts.push(makeAlert(
      "strategy_retired",
      "high",
      "Strategie is met pensioen gestuurd",
      `${strategyRetirement.retireCount} strategie(en) staan nu op retire.`,
      `Controleer ${(strategyRetirement.policies || [])[0]?.id || "de betreffende strategie"} voordat je overrides toepast.`
    ));
  }
  if ((executionCost.status || "") === "blocked") {
    rawAlerts.push(makeAlert(
      "execution_cost_budget_blocked",
      paperMode ? "medium" : "high",
      "Execution cost budget te duur",
      (executionCost.notes || [])[0] || "Recente slippage/fee kosten liggen boven budget.",
      "Verlaag aggressie, wacht op betere microstructuur of forceer shadow-only."
    ));
  }
  if ((capitalGovernor.status || "") === "blocked") {
    rawAlerts.push(makeAlert(
      "capital_governor_blocked",
      paperMode ? "medium" : "critical",
      "Capital governor houdt entries tegen",
      (capitalGovernor.notes || [])[0] || "Dag- of weekverlies blijft boven het toegestane budget.",
      "Laat eerst recovery trades slagen of verlaag het risicoprofiel verder."
    ));
  } else if ((capitalGovernor.status || "") === "recovery") {
    rawAlerts.push(makeAlert(
      "capital_governor_recovery",
      "medium",
      "Capital governor draait in recovery",
      (capitalGovernor.notes || [])[0] || "Nieuwe entries worden kleiner gesized.",
      "Houd de recovery-window en winrate in de gaten voordat sizing weer oploopt."
    ));
  }
  if ((selfHeal.mode || "") === "paused") {
    rawAlerts.push(makeAlert(
      "self_heal_paused",
      "medium",
      "Self-heal houdt entries tegen",
      selfHeal.reason || "Runtime draait in defensieve modus.",
      "Bevestig drift, calibration en health voordat entries weer open gaan."
    ));
  }
  if (paperMode && safeNumber(signalFlow.consecutiveCyclesWithSignalsNoPaperTrade, 0) >= safeNumber(config.paperSilentFailureCycleThreshold, 3)) {
    rawAlerts.push(makeAlert(
      "paper_signal_flow_stalled",
      "high",
      "Paper signal flow stalled",
      topCountKey(signalFlow.lastCycle?.rejectionReasons || {}) || "Er komen wel signalen door de scan, maar ze eindigen meerdere cycles achter elkaar zonder paper trade.",
      "Gebruik status/doctor signalFlow, reject-categorieen en entry_flow_blocked events om de blokkade gericht te herstellen."
    ));
  }
  if ((readiness.status || "") === "degraded" && (readiness.reasons || []).length) {
    rawAlerts.push(makeAlert(
      "readiness_degraded",
      paperMode && (readiness.reasons || []).every((reason) => ["operator_ack_required", "capital_governor_blocked"].includes(reason)) ? "info" : "medium",
      "Operationele readiness degraded",
      readiness.reasons[0],
      "Gebruik status/doctor en volg de actieve runbooks."
    ));
  }
  if ((thresholdTuning.appliedRecommendation?.status || "") === "probation") {
    rawAlerts.push(makeAlert(
      "threshold_probation",
      "info",
      "Threshold probation actief",
      `${thresholdTuning.appliedRecommendation.id} draait tijdelijk met aangepaste gate.`,
      "Volg winrate en gemiddelde PnL tot probation confirmeert of terugdraait."
    ));
  }

  const alerts = rawAlerts.map((item) => ({
    ...item,
    ...resolveAlertState(item.id, alertState, nowIso)
  }));
  const activeAlerts = alerts.filter((item) => item.active);
  const blockingAlerts = activeAlerts.filter((item) => !(paperMode && isPaperGovernanceAlert(item.id)));
  const maxItems = Math.max(4, safeNumber(config.operatorAlertMaxItems, 8) || 8);
  return {
    generatedAt: nowIso,
    count: alerts.length,
    activeCount: activeAlerts.length,
    mutedCount: alerts.filter((item) => item.muted).length,
    acknowledgedCount: alerts.filter((item) => item.acknowledgedAt).length,
    resolvedCount: alerts.filter((item) => item.resolvedAt).length,
    criticalCount: blockingAlerts.filter((item) => item.severity === "critical").length,
    status: blockingAlerts.some((item) => item.severity === "critical")
      ? "critical"
      : blockingAlerts.some((item) => item.severity === "high")
        ? "high"
        : activeAlerts.length
          ? "watch"
          : "clear",
    alerts: alerts.slice(0, maxItems)
  };
}

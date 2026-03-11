function arr(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
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

export function buildOperatorAlerts({
  runtime = {},
  report = {},
  readiness = {},
  exchangeSafety = {},
  strategyRetirement = {},
  executionCost = {},
  nowIso = new Date().toISOString()
} = {}) {
  const alerts = [];
  const lifecycle = runtime.orderLifecycle || {};
  const health = runtime.health || {};
  const selfHeal = runtime.selfHeal || {};
  const thresholdTuning = runtime.thresholdTuning || {};

  if (health.circuitOpen) {
    alerts.push(makeAlert(
      "health_circuit_open",
      "critical",
      "Trading circuit open",
      health.reason || "Te veel cycle failures of stale runtime telemetry.",
      "Onderzoek cycle failures en laat eerst een schone run slagen."
    ));
  }
  if ((exchangeSafety.status || "") === "blocked") {
    alerts.push(makeAlert(
      "exchange_safety_blocked",
      "critical",
      "Exchange safety blokkeert entries",
      (exchangeSafety.notes || [])[0] || "Exchange safety audit markeerde de runtime als blocked.",
      (exchangeSafety.actions || [])[0] || "Draai eerst een reconcile-pass."
    ));
  }
  if (arr(lifecycle.pendingActions).some((item) => ["manual_review", "reconcile_required"].includes(item.state))) {
    alerts.push(makeAlert(
      "lifecycle_attention_required",
      "high",
      "Positie vraagt operator aandacht",
      "Een open positie staat in manual review of reconcile_required.",
      "Controleer quantity, protective state en recente exchange actions."
    ));
  }
  if ((strategyRetirement.retireCount || 0) > 0) {
    alerts.push(makeAlert(
      "strategy_retired",
      "high",
      "Strategie is met pensioen gestuurd",
      `${strategyRetirement.retireCount} strategie(en) staan nu op retire.`,
      `Controleer ${(strategyRetirement.policies || [])[0]?.id || "de betreffende strategie"} voordat je overrides toepast.`
    ));
  }
  if ((executionCost.status || "") === "blocked") {
    alerts.push(makeAlert(
      "execution_cost_budget_blocked",
      "high",
      "Execution cost budget te duur",
      (executionCost.notes || [])[0] || "Recente slippage/fee kosten liggen boven budget.",
      "Verlaag aggressie, wacht op betere microstructuur of forceer shadow-only."
    ));
  }
  if ((selfHeal.mode || "") === "paused") {
    alerts.push(makeAlert(
      "self_heal_paused",
      "medium",
      "Self-heal houdt entries tegen",
      selfHeal.reason || "Runtime draait in defensieve modus.",
      "Bevestig drift, calibration en health voordat entries weer open gaan."
    ));
  }
  if ((readiness.status || "") === "degraded" && (readiness.reasons || []).length) {
    alerts.push(makeAlert(
      "readiness_degraded",
      "medium",
      "Operationele readiness degraded",
      readiness.reasons[0],
      "Gebruik status/doctor en volg de actieve runbooks."
    ));
  }
  if ((thresholdTuning.appliedRecommendation?.status || "") === "probation") {
    alerts.push(makeAlert(
      "threshold_probation",
      "info",
      "Threshold probation actief",
      `${thresholdTuning.appliedRecommendation.id} draait tijdelijk met aangepaste gate.`,
      "Volg winrate en gemiddelde PnL tot probation confirmeert of terugdraait."
    ));
  }

  const maxItems = Math.max(4, safeNumber(runtime.configSummary?.operatorAlertMaxItems, 8) || 8);
  return {
    generatedAt: nowIso,
    count: alerts.length,
    criticalCount: alerts.filter((item) => item.severity === "critical").length,
    status: alerts.some((item) => item.severity === "critical")
      ? "critical"
      : alerts.some((item) => item.severity === "high")
        ? "high"
        : alerts.length
          ? "watch"
          : "clear",
    alerts: alerts.slice(0, maxItems)
  };
}

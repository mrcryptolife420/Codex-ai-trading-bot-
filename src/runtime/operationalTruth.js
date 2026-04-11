import { nowIso } from "../utils/time.js";

const PAPER_ACK_IGNORE_IDS = new Set([
  "capital_governor_blocked",
  "capital_governor_recovery",
  "execution_cost_budget_blocked",
  "readiness_degraded",
  "paper_signal_flow_stalled"
]);

export function requiresOperatorAck(alert = {}, mode = "paper") {
  if (alert.resolvedAt || alert.acknowledgedAt) {
    return false;
  }
  const severity = `${alert.severity || ""}`.toLowerCase();
  if (!["negative", "critical", "high"].includes(severity)) {
    return false;
  }
  if (mode !== "paper") {
    return true;
  }
  return !PAPER_ACK_IGNORE_IDS.has(alert.id || "");
}

function ensureReason(readiness, reason, status = "degraded") {
  if (!readiness.reasons.includes(reason)) {
    readiness.reasons.push(reason);
  }
  readiness.ok = false;
  if (readiness.status !== "blocked") {
    readiness.status = status === "blocked" ? "blocked" : status;
  }
}

export function computeOperationalReadiness({
  snapshotReadiness = {},
  checkedAt = nowIso(),
  lastAnalysisAt = null,
  runState = null,
  mode = "paper",
  managerHasError = false,
  healthCircuitOpen = false,
  exchangeTruthFreeze = false,
  exchangeSafetyBlocked = false,
  capitalGovernorBlocked = false,
  selfHealMode = null,
  serviceWatchdogStatus = "",
  serviceHeartbeatStale = false,
  serviceRecoveryActive = false,
  externalModeMismatch = false,
  alerts = [],
  pendingActions = [],
  analysisMissingStatus = "warming"
} = {}) {
  const readiness = {
    ok: (snapshotReadiness.status || "ready") === "ready",
    status: snapshotReadiness.status || "ready",
    reasons: [...new Set(Array.isArray(snapshotReadiness.reasons) ? snapshotReadiness.reasons : [])],
    checkedAt,
    lastAnalysisAt: lastAnalysisAt || null,
    runState,
    mode
  };
  if (!lastAnalysisAt) {
    ensureReason(readiness, "analysis_not_ready", analysisMissingStatus);
  }
  if (managerHasError) {
    ensureReason(readiness, "manager_error", "degraded");
  }
  if (healthCircuitOpen) {
    ensureReason(readiness, "health_circuit_open", "blocked");
  }
  if (exchangeTruthFreeze) {
    ensureReason(readiness, "exchange_truth_freeze", "blocked");
  }
  if (exchangeSafetyBlocked) {
    ensureReason(readiness, "exchange_safety_blocked", "blocked");
  }
  if (capitalGovernorBlocked) {
    ensureReason(readiness, "capital_governor_blocked", "blocked");
  }
  if (["paused", "paper_fallback"].includes(selfHealMode || "")) {
    ensureReason(readiness, "self_heal_paused", "blocked");
  }
  if (serviceWatchdogStatus === "degraded") {
    ensureReason(readiness, "service_watchdog_degraded", "degraded");
  }
  if (serviceHeartbeatStale) {
    ensureReason(readiness, "service_heartbeat_stale", "degraded");
  }
  if (serviceRecoveryActive) {
    ensureReason(readiness, "service_restart_backoff_active", "degraded");
  }
  if (externalModeMismatch) {
    ensureReason(readiness, "external_mode_mismatch", "degraded");
  }
  if ((alerts || []).some((item) => requiresOperatorAck(item, mode))) {
    ensureReason(readiness, "operator_ack_required", "degraded");
  }
  if ((pendingActions || []).some((item) => ["manual_review", "reconcile_required"].includes(item.state))) {
    ensureReason(readiness, "lifecycle_attention_required", "degraded");
  }
  readiness.reasons = [...new Set(readiness.reasons)];
  readiness.ok = readiness.status === "ready" && readiness.reasons.length === 0;
  return readiness;
}

export function buildContract(kind, shape = null) {
  return {
    version: "v1",
    kind,
    ...(shape ? { shape } : {})
  };
}

export function buildApiEnvelope({ kind, manager, status = null, doctor = null, report = null, snapshot = null, learning = null }) {
  return {
    contract: buildContract(kind),
    manager,
    ...(kind === "status" ? { status } : {}),
    ...(kind === "doctor" ? { doctor } : {}),
    ...(kind === "report" ? { report } : {}),
    ...(kind === "learning" ? { learning } : {}),
    ...(kind === "snapshot" ? { dashboard: snapshot?.dashboard || null } : {}),
    payload: {
      snapshot: kind === "snapshot" ? snapshot : null,
      status: kind === "status" ? status : null,
      doctor: kind === "doctor" ? doctor : null,
      report: kind === "report" ? report : null,
      learning: kind === "learning" ? learning : null
    }
  };
}

import { clamp } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function minutesSince(at, nowIso) {
  const atMs = new Date(at || 0).getTime();
  const nowMs = new Date(nowIso || Date.now()).getTime();
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs) || nowMs < atMs) {
    return null;
  }
  return (nowMs - atMs) / 60000;
}

function latestStreamMessageAt(streamStatus = {}) {
  return [
    streamStatus.lastPublicMessageAt,
    streamStatus.lastFuturesMessageAt,
    streamStatus.lastUserMessageAt
  ].filter(Boolean).sort().at(-1) || null;
}

export function buildExchangeSafetyAudit({
  runtime = {},
  report = {},
  config = {},
  streamStatus = {},
  nowIso = new Date().toISOString()
} = {}) {
  const exchangeTruth = runtime.exchangeTruth || {};
  const lifecycle = runtime.orderLifecycle || {};
  const openPositions = arr(runtime.openPositions);
  const pendingActions = arr(lifecycle.pendingActions);
  const mismatchCount = safeNumber(exchangeTruth.mismatchCount || 0);
  const lastReconciledAt = exchangeTruth.lastReconciledAt || null;
  const reconcileAgeMinutes = minutesSince(lastReconciledAt, nowIso);
  const streamAgeMinutes = minutesSince(latestStreamMessageAt(streamStatus), nowIso);
  const criticalPendingStates = new Set(["manual_review", "reconcile_required", "protection_pending"]);
  const criticalPending = pendingActions.filter((item) => criticalPendingStates.has(item.state));
  const stalePendingMinutes = safeNumber(config.exchangeSafetyCriticalPendingAgeMinutes, 18);
  const stalePending = pendingActions.filter((item) => {
    const ageMinutes = minutesSince(item.updatedAt || item.startedAt || item.completedAt, nowIso);
    return ageMinutes != null && ageMinutes >= stalePendingMinutes;
  });
  const maxReconcileAgeMinutes = safeNumber(
    config.exchangeSafetyMaxReconcileAgeMinutes,
    (config.botMode || "paper") === "live" ? 20 : 120
  );
  const staleReconcile = (config.botMode || "paper") === "live" &&
    openPositions.length > 0 &&
    reconcileAgeMinutes != null &&
    reconcileAgeMinutes >= maxReconcileAgeMinutes;
  const staleStream = openPositions.length > 0 &&
    streamAgeMinutes != null &&
    streamAgeMinutes >= safeNumber(config.exchangeSafetyMaxStreamSilenceMinutes, 12);
  const unresolvedLivePositions = openPositions.filter((item) =>
    (item.brokerMode || config.botMode || "paper") === "live" &&
    (!item.protectiveOrderListId || item.reconcileRequired || item.manualReviewRequired)
  );
  const negativeIncidents = arr(report.recentEvents || []).filter((item) =>
    /warning|error|fail|freeze|reconcile/i.test(item.type || "")
  ).length;

  const reasons = [];
  if (mismatchCount > 0) {
    reasons.push("exchange_truth_mismatch");
  }
  if (criticalPending.length) {
    reasons.push("critical_lifecycle_pending");
  }
  if (stalePending.length) {
    reasons.push("stale_lifecycle_actions");
  }
  if (staleReconcile) {
    reasons.push("reconcile_stale");
  }
  if (staleStream) {
    reasons.push("stream_silence_with_open_positions");
  }
  if (unresolvedLivePositions.length) {
    reasons.push("live_positions_need_attention");
  }

  const isLive = (config.botMode || "paper") === "live";
  const derivedFreezeEntries =
    isLive &&
    (
      mismatchCount > 0 ||
      criticalPending.length > 0 ||
      staleReconcile ||
      stalePending.length > 0
    );
  // Paper: ignore stale exchangeTruth.freezeEntries from persisted/live-only state; only hard material risk freezes entries.
  const paperMaterialFreeze =
    !isLive &&
    (mismatchCount > 0 || criticalPending.length > 0);
  const freezeEntries = isLive
    ? Boolean(exchangeTruth.freezeEntries || derivedFreezeEntries)
    : paperMaterialFreeze;
  const riskScore = clamp(
    mismatchCount * 0.18 +
      criticalPending.length * 0.16 +
      stalePending.length * 0.08 +
      (staleReconcile ? 0.28 : 0) +
      (staleStream ? 0.12 : 0) +
      Math.min(0.18, unresolvedLivePositions.length * 0.08) +
      Math.min(0.08, negativeIncidents * 0.01),
    0,
    1
  );
  const status = freezeEntries
    ? "blocked"
    : reasons.length
      ? "watch"
      : "ready";

  const notes = [
    mismatchCount
      ? `${mismatchCount} exchange/runtime mismatch(es) vragen eerst reconcile.`
      : "Geen actieve exchange/runtime mismatch gezien.",
    staleReconcile
      ? `Laatste exchange reconcile is ${num(reconcileAgeMinutes, 1)} minuten oud met open live posities.`
      : lastReconciledAt
        ? `Laatste exchange reconcile: ${lastReconciledAt}.`
        : "Nog geen exchange reconcile-timestamp beschikbaar.",
    unresolvedLivePositions.length
      ? `${unresolvedLivePositions.length} live positie(s) missen nog een schone protected state.`
      : "Open live posities hebben momenteel geen extra attention-flag.",
    stalePending.length
      ? `${stalePending.length} lifecycle-actie(s) zijn mogelijk blijven hangen.`
      : "Geen verouderde lifecycle-acties gevonden."
  ];

  return {
    generatedAt: nowIso,
    status,
    freezeEntries,
    riskScore: num(riskScore),
    mismatchCount,
    criticalPendingCount: criticalPending.length,
    stalePendingCount: stalePending.length,
    unresolvedLivePositions: unresolvedLivePositions.length,
    reconcileAgeMinutes: reconcileAgeMinutes == null ? null : num(reconcileAgeMinutes, 1),
    streamAgeMinutes: streamAgeMinutes == null ? null : num(streamAgeMinutes, 1),
    reasons,
    notes,
    actions: freezeEntries
      ? [
          "Laat alleen reconcile, exits en protective rebuilds lopen.",
          "Bevestig exchange inventory en protective orders voor live positions.",
          "Heropen entries pas na een schone reconcile-pass."
        ]
      : reasons.length
        ? [
            "Monitor de volgende cycle op reconcile en lifecycle-herstel.",
            "Controleer operator alerts voordat sizing weer normaliseert."
          ]
        : [
            "Geen directe exchange safety actie nodig."
          ]
  };
}

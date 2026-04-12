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

function isPaperMode(config = {}) {
  return (config.botMode || "paper") === "paper";
}

function isBinanceDemoPaper(config = {}) {
  return isPaperMode(config) && String(config.paperExecutionVenue || "").toLowerCase() === "binance_demo_spot";
}

/** Zelfde issue-set als liveBroker.reconcileRuntime bij mismatch-union (minus recentFillSymbols). */
const EXCHANGE_TRUTH_WARNING_SYMBOL_ISSUES = new Set([
  "protective_order_rebuild_failed",
  "protective_order_for_recovered_position_failed",
  "protective_order_state_stale",
  "position_sync_failed",
  "unmanaged_balance_detected",
  "position_quantity_mismatch",
  "position_quantity_reduced_to_exchange_balance",
  "stale_untracked_entry_order_cancel_failed",
  "stale_untracked_exit_order_cancel_failed",
  "multiple_protective_order_lists_detected",
  "orphaned_exit_order_with_balance",
  "unexpected_open_order_for_managed_position"
]);

/**
 * Aantal unieke symbolen dat telt voor entry-freeze op Binance demo-paper.
 * Sluit `recentFillSymbols` impliciet uit (die zitten niet in deze union).
 */
export function buildBinanceDemoPaperMismatchSymbolCount(exchangeTruth = {}) {
  const fromWarnings = arr(exchangeTruth.warnings)
    .filter((w) => EXCHANGE_TRUTH_WARNING_SYMBOL_ISSUES.has(w.issue))
    .map((w) => w.symbol)
    .filter(Boolean);
  return new Set([
    ...arr(exchangeTruth.orphanedSymbols),
    ...arr(exchangeTruth.missingRuntimeSymbols),
    ...arr(exchangeTruth.unmatchedOrderSymbols),
    ...arr(exchangeTruth.staleProtectiveSymbols),
    ...fromWarnings
  ]).size;
}

export function binanceDemoPaperHardInventoryDrift(exchangeTruth = {}) {
  return (
    arr(exchangeTruth.orphanedSymbols).length > 0 ||
    arr(exchangeTruth.missingRuntimeSymbols).length > 0 ||
    arr(exchangeTruth.unmatchedOrderSymbols).length > 0 ||
    arr(exchangeTruth.manualInterferenceSymbols).length > 0
  );
}

/**
 * Wist unmatched/orphaned/manual-lijsten als reconcile **geen mismatch** meldt — voorkomt phantom lifecycle-pending
 * (ook op Binance demo-spot na schone reconcile).
 */
/**
 * Pending actions die op paper entries mogen bevriezen (gelijk aan audit `criticalPendingForEntryFreeze`).
 */
export function materialPaperLifecyclePendingForEntryFreeze(pendingActions = [], config = {}) {
  const demoPaper = isBinanceDemoPaper(config);
  const materialStates = new Set(["manual_review", "reconcile_required", "protection_pending"]);
  return arr(pendingActions).filter((item) => {
    if (!materialStates.has(item.state)) {
      return false;
    }
    if (demoPaper && (item.state === "protection_pending" || item.state === "reconcile_required")) {
      return false;
    }
    return true;
  });
}

export function sanitizeStaleLiveExchangeTruthFlagsOnPurePaper(exchangeTruth = {}, config = {}) {
  const et = { ...exchangeTruth };
  if (!isPaperMode(config)) {
    return et;
  }
  const mismatch = Number(et.mismatchCount) || 0;
  if (mismatch !== 0) {
    return et;
  }
  if (!arr(et.unmatchedOrderSymbols).length && !arr(et.orphanedSymbols).length && !arr(et.manualInterferenceSymbols).length) {
    return et;
  }
  return {
    ...et,
    unmatchedOrderSymbols: [],
    orphanedSymbols: [],
    manualInterferenceSymbols: []
  };
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
  const demoPaper = isBinanceDemoPaper(config);
  const freezeMismatchThreshold = safeNumber(config.exchangeTruthFreezeMismatchCount, 2);
  // Lifecycle-signalen voor risico-/watch (dashboard, reasons)
  const criticalPending = pendingActions.filter((item) => {
    if (!criticalPendingStates.has(item.state)) {
      return false;
    }
    if (demoPaper && item.state === "protection_pending") {
      return false;
    }
    return true;
  });
  const criticalPendingForEntryFreeze = materialPaperLifecyclePendingForEntryFreeze(pendingActions, config);
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
      criticalPendingForEntryFreeze.length > 0 ||
      staleReconcile ||
      stalePending.length > 0
    );
  // Paper: geen stale exchangeTruth.freezeEntries; alleen harde risico's bevriezen entries.
  // Demo spot: geen entry-freeze op enkel reconcile_required (zie materialPaperLifecyclePendingForEntryFreeze).
  // Ruwe mismatchCount bevat o.a. recentFillSymbols — te gevoelig voor 30m-blokkades. Harde inventory-drift
  // (orphan/unmatched/missing/manual) blokkeert direct; overige scenario's pas vanaf max(threshold, 3) symbolen.
  const demoPaperHardDrift = demoPaper && binanceDemoPaperHardInventoryDrift(exchangeTruth);
  const demoPaperSymbolFreezeCount = demoPaper ? buildBinanceDemoPaperMismatchSymbolCount(exchangeTruth) : mismatchCount;
  const demoPaperFreezeThreshold = Math.max(freezeMismatchThreshold, 3);
  const paperMismatchFreezes = demoPaper
    ? demoPaperHardDrift || demoPaperSymbolFreezeCount >= demoPaperFreezeThreshold
    : mismatchCount > 0;
  const paperMaterialFreeze =
    !isLive &&
    (paperMismatchFreezes || criticalPendingForEntryFreeze.length > 0);
  const freezeEntries = isLive
    ? Boolean(exchangeTruth.freezeEntries || derivedFreezeEntries)
    : paperMaterialFreeze;
  const riskScore = clamp(
    mismatchCount * 0.18 +
      criticalPending.length * 0.14 +
      criticalPendingForEntryFreeze.length * 0.04 +
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

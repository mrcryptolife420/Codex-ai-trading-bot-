function arr(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function minutesSince(at, nowIso) {
  const atMs = new Date(at || 0).getTime();
  const nowMs = new Date(nowIso || Date.now()).getTime();
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs) || nowMs < atMs) {
    return null;
  }
  return (nowMs - atMs) / 60000;
}

function severityRank(value) {
  return {
    info: 0,
    medium: 1,
    high: 2,
    critical: 3
  }[`${value || "info"}`.toLowerCase()] ?? 0;
}

export function buildOperatorAlertDispatchPlan({
  alerts = {},
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const cooldownMinutes = Math.max(1, safeNumber(config.operatorAlertDispatchCooldownMinutes, 30));
  const minimumSeverity = `${config.operatorAlertDispatchMinSeverity || "high"}`.toLowerCase();
  const minimumRank = severityRank(minimumSeverity);
  const endpoints = arr(config.operatorAlertWebhookUrls || []).filter(Boolean);
  const eligibleAlerts = arr(alerts.alerts || []).filter((item) =>
    !item.muted &&
    !item.acknowledgedAt &&
    severityRank(item.severity) >= minimumRank &&
    (() => {
      const lastDeliveredMinutes = minutesSince(item.lastDeliveredAt, nowIso);
      return lastDeliveredMinutes == null || lastDeliveredMinutes >= cooldownMinutes;
    })()
  );

  return {
    generatedAt: nowIso,
    endpointCount: endpoints.length,
    cooldownMinutes,
    minimumSeverity,
    eligibleCount: eligibleAlerts.length,
    status: !endpoints.length
      ? "disabled"
      : eligibleAlerts.length
        ? "pending"
        : "idle",
    alerts: eligibleAlerts.map((item) => ({
      id: item.id,
      severity: item.severity,
      title: item.title,
      reason: item.reason,
      action: item.action
    })),
    endpoints: endpoints.map((url, index) => ({ id: `webhook_${index + 1}`, url }))
  };
}

export async function dispatchOperatorAlerts({
  alerts = {},
  runtime = {},
  config = {},
  nowIso = new Date().toISOString(),
  fetchImpl = globalThis.fetch
} = {}) {
  const plan = buildOperatorAlertDispatchPlan({ alerts, config, nowIso });
  const alertState = runtime.ops?.alertState || {};
  const deliveryState = alertState.delivery && typeof alertState.delivery === "object" ? alertState.delivery : {};
  const lastDeliveredAtById = deliveryState.lastDeliveredAtById && typeof deliveryState.lastDeliveredAtById === "object"
    ? deliveryState.lastDeliveredAtById
    : {};

  if (plan.status !== "pending" || typeof fetchImpl !== "function") {
    return {
      generatedAt: nowIso,
      status: plan.status,
      endpointCount: plan.endpointCount,
      eligibleCount: plan.eligibleCount,
      deliveredCount: 0,
      failedCount: 0,
      lastDeliveryAt: deliveryState.lastDeliveryAt || null,
      notes: [
        plan.status === "disabled"
          ? "Geen alert-webhooks geconfigureerd."
          : plan.eligibleCount
            ? "Alert dispatch wacht op een geldige fetch-implementatie."
            : "Geen nieuwe operator alerts klaar voor dispatch."
      ]
    };
  }

  let deliveredCount = 0;
  let failedCount = 0;
  let lastError = null;

  const payload = {
    generatedAt: nowIso,
    status: alerts.status || "clear",
    criticalCount: alerts.criticalCount || 0,
    alerts: plan.alerts
  };

  for (const endpoint of plan.endpoints) {
    try {
      const response = await fetchImpl(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response?.ok) {
        throw new Error(`HTTP ${response?.status || "unknown"}`);
      }
      deliveredCount += plan.alerts.length;
    } catch (error) {
      failedCount += plan.alerts.length || 1;
      lastError = error.message;
    }
  }

  if (deliveredCount) {
    for (const item of plan.alerts) {
      lastDeliveredAtById[item.id] = nowIso;
    }
  }

  return {
    generatedAt: nowIso,
    status: failedCount && !deliveredCount
      ? "failed"
      : failedCount
        ? "partial"
        : deliveredCount
          ? "delivered"
          : plan.status,
    endpointCount: plan.endpointCount,
    eligibleCount: plan.eligibleCount,
    deliveredCount,
    failedCount,
    lastDeliveryAt: deliveredCount ? nowIso : deliveryState.lastDeliveryAt || null,
    lastError,
    lastDeliveredAtById,
    notes: [
      deliveredCount
        ? `${plan.alerts.length} operator alert(s) zijn via webhook verzonden.`
        : "Geen operator alerts via webhook verstuurd.",
      failedCount
        ? `Webhook delivery had ${failedCount} mislukte alert afleveringen.`
        : "Geen webhook delivery-fouten gemeld."
    ]
  };
}

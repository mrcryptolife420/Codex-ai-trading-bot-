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

function buildEndpoints(config = {}) {
  const webhooks = arr(config.operatorAlertWebhookUrls || []).filter(Boolean).map((url, index) => ({
    id: `webhook_${index + 1}`,
    url,
    kind: "webhook"
  }));
  const discord = arr(config.operatorAlertDiscordWebhookUrls || []).filter(Boolean).map((url, index) => ({
    id: `discord_${index + 1}`,
    url,
    kind: "discord"
  }));
  const telegram = config.operatorAlertTelegramBotToken && config.operatorAlertTelegramChatId
    ? [{
        id: "telegram_primary",
        kind: "telegram",
        url: `https://api.telegram.org/bot${config.operatorAlertTelegramBotToken}/sendMessage`,
        chatId: config.operatorAlertTelegramChatId
      }]
    : [];
  return [...webhooks, ...discord, ...telegram];
}

export function buildOperatorAlertDispatchPlan({
  alerts = {},
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const cooldownMinutes = Math.max(1, safeNumber(config.operatorAlertDispatchCooldownMinutes, 30));
  const minimumSeverity = `${config.operatorAlertDispatchMinSeverity || "high"}`.toLowerCase();
  const minimumRank = severityRank(minimumSeverity);
  const endpoints = buildEndpoints(config);
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
    endpoints: endpoints.map((endpoint) => ({
      id: endpoint.id,
      url: endpoint.url,
      kind: endpoint.kind,
      chatId: endpoint.chatId || null
    }))
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
          ? "Geen operator alert-kanalen geconfigureerd."
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
      const body = endpoint.kind === "telegram"
        ? JSON.stringify({
            chat_id: endpoint.chatId,
            text: [`${alerts.status || "clear"}`.toUpperCase(), ...plan.alerts.map((item) => `- ${item.title}: ${item.reason}`)].join("\n")
          })
        : endpoint.kind === "discord"
          ? JSON.stringify({
              content: [`Operator alerts (${alerts.status || "clear"})`, ...plan.alerts.map((item) => `- ${item.title}: ${item.reason}`)].join("\n")
            })
          : JSON.stringify(payload);
      const response = await fetchImpl(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body
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
        ? `${plan.alerts.length} operator alert(s) zijn verzonden.`
        : "Geen operator alerts verzonden.",
      failedCount
        ? `Alert delivery had ${failedCount} mislukte afleveringen.`
        : "Geen alert-delivery fouten gemeld."
    ]
  };
}

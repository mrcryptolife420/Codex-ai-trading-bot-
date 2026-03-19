import { maskUrl, redactSensitiveText } from "../utils/requestBudget.js";

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

function buildRedactionSecrets(config = {}) {
  return [
    ...arr(config.operatorAlertWebhookUrls || []),
    ...arr(config.operatorAlertDiscordWebhookUrls || []),
    config.operatorAlertTelegramBotToken || "",
    config.operatorAlertTelegramChatId || ""
  ].filter(Boolean);
}

function maskIdentifier(value) {
  const text = `${value || ""}`;
  if (!text) {
    return null;
  }
  if (text.length <= 4) {
    return "***";
  }
  return `${"*".repeat(Math.max(3, text.length - 4))}${text.slice(-4)}`;
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
      url: maskUrl(endpoint.url),
      kind: endpoint.kind,
      chatId: maskIdentifier(endpoint.chatId)
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
  let deliveredEndpointCount = 0;
  let failedEndpointCount = 0;
  let lastError = null;
  const redactionSecrets = buildRedactionSecrets(config);

  const payload = {
    generatedAt: nowIso,
    status: alerts.status || "clear",
    criticalCount: alerts.criticalCount || 0,
    alerts: plan.alerts
  };
  const requestEndpoints = buildEndpoints(config);

  for (const endpoint of requestEndpoints) {
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
      deliveredEndpointCount += 1;
    } catch (error) {
      failedEndpointCount += 1;
      lastError = redactSensitiveText(error.message, redactionSecrets);
    }
  }

  deliveredCount = deliveredEndpointCount ? plan.alerts.length : 0;
  failedCount = failedEndpointCount;

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
      failedEndpointCount
        ? `Alert delivery had ${failedEndpointCount} mislukte endpoint afleveringen.`
        : "Geen alert-delivery fouten gemeld."
    ]
  };
}

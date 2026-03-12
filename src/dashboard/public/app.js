const POLL_MS = 5000;
const SIGNAL_LIMIT = 3;
const POSITION_LIMIT = 4;
const TRADE_LIMIT = 6;
const STORAGE_KEYS = {
  showAllDecisions: "dashboard.showAllDecisions"
};

const elements = {
  modeBadge: document.querySelector("#modeBadge"),
  runStateBadge: document.querySelector("#runStateBadge"),
  healthBadge: document.querySelector("#healthBadge"),
  refreshBadge: document.querySelector("#refreshBadge"),
  controlHint: document.querySelector("#controlHint"),
  operatorSummary: document.querySelector("#operatorSummary"),
  startBtn: document.querySelector("#startBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  paperBtn: document.querySelector("#paperBtn"),
  liveBtn: document.querySelector("#liveBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  decisionSearch: document.querySelector("#decisionSearch"),
  decisionAllowedOnly: document.querySelector("#decisionAllowedOnly"),
  decisionMeta: document.querySelector("#decisionMeta"),
  decisionShowMoreBtn: document.querySelector("#decisionShowMoreBtn"),
  decisionsList: document.querySelector("#decisionsList"),
  positionsList: document.querySelector("#positionsList"),
  opsSummary: document.querySelector("#opsSummary"),
  opsLearning: document.querySelector("#opsLearning"),
  opsList: document.querySelector("#opsList"),
  tradesBody: document.querySelector("#tradesBody"),
  signalsSection: document.querySelector("#signalsSection"),
  positionsSection: document.querySelector("#positionsSection"),
  riskSection: document.querySelector("#riskSection"),
  historySection: document.querySelector("#historySection"),
  signalsToggleBtn: document.querySelector("#signalsToggleBtn"),
  positionsToggleBtn: document.querySelector("#positionsToggleBtn"),
  riskToggleBtn: document.querySelector("#riskToggleBtn"),
  historyToggleBtn: document.querySelector("#historyToggleBtn")
};

let latestSnapshot = null;
let busy = false;
let pollTimer = null;
let requestEpoch = 0;
let searchQuery = "";
let allowedOnly = false;
let showAllDecisions = readStoredBoolean(STORAGE_KEYS.showAllDecisions, false);
let lastSnapshotReceivedAt = null;
const panelState = {
  signals: true,
  positions: true,
  risk: true,
  history: true
};

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readStoredBoolean(key, fallback = false) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) {
      return fallback;
    }
    return raw === "true";
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key, value) {
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // ignore storage failures
  }
}

function number(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "0";
}

function formatMoney(value) {
  const numeric = Number(value);
  return new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatPct(value, digits = 1) {
  const numeric = Number(value);
  return `${(Number.isFinite(numeric) ? numeric * 100 : 0).toFixed(digits)}%`;
}

function formatSignedPct(value, digits = 1) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const prefix = safe > 0 ? "+" : "";
  return `${prefix}${(safe * 100).toFixed(digits)}%`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function toneClass(value) {
  const numeric = Number(value);
  if (numeric > 0) {
    return "positive";
  }
  if (numeric < 0) {
    return "negative";
  }
  return "neutral";
}

function statusTone(value) {
  const normalized = `${value || ""}`.toLowerCase();
  if (["healthy", "ready", "running", "positive", "clear", "paper", "eligible", "active"].includes(normalized)) {
    return "positive";
  }
  if (["blocked", "critical", "failed", "negative", "stopped", "live", "manual_review"].includes(normalized)) {
    return "negative";
  }
  return "neutral";
}

function titleize(value) {
  return `${value || "-"}`
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDecisionType(decision) {
  return titleize(
    decision.setupStyle ||
    decision.strategy?.familyLabel ||
    decision.strategy?.strategyLabel ||
    decision.marketState?.phase ||
    "setup"
  );
}

function whyTradeable(decision) {
  if (!decision.allow) {
    return null;
  }
  const style = decision.executionStyle ? titleize(decision.executionStyle) : "Standaard entry";
  const market = decision.marketState?.phase ? titleize(decision.marketState.phase) : titleize(decision.regime || "regime");
  return `${formatDecisionType(decision)} in ${market} met ${style.toLowerCase()}.`;
}

function whyBlocked(decision) {
  return decision.operatorAction || titleize(decision.blockerReasons?.[0] || decision.reasons?.[0] || "geen directe reden");
}

function actionText(decision) {
  return decision.autoRecovery || decision.operatorAction || "Geen directe actie nodig.";
}

function truncate(text, max = 120) {
  const value = `${text || ""}`.trim();
  if (!value) {
    return "";
  }
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function buildMutationHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Dashboard-Request": "1"
  };
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: method === "POST" ? buildMutationHeaders() : undefined,
    body: method === "POST" ? JSON.stringify(body || {}) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function pickSnapshot(payload) {
  if (payload?.dashboard && payload?.manager) {
    return payload;
  }
  if (payload?.snapshot?.dashboard) {
    return payload.snapshot;
  }
  return {
    manager: {},
    dashboard: {}
  };
}

function unresolvedAlerts(snapshot) {
  return (snapshot?.dashboard?.ops?.alerts?.alerts || []).filter((item) => !item.resolvedAt);
}

function pendingActions(snapshot) {
  return snapshot?.dashboard?.safety?.orderLifecycle?.pendingActions || [];
}

function topBlocker(snapshot) {
  const readinessReason = snapshot?.dashboard?.ops?.readiness?.reasons?.[0];
  if (readinessReason) {
    return readinessReason;
  }
  const alert = unresolvedAlerts(snapshot).find((item) => !item.acknowledgedAt);
  if (alert?.type) {
    return alert.type;
  }
  const pending = pendingActions(snapshot).find((item) => ["manual_review", "reconcile_required"].includes(item.state));
  if (pending?.state) {
    return pending.state;
  }
  const blocked = snapshot?.dashboard?.blockedSetups?.[0];
  return blocked?.blockerReasons?.[0] || blocked?.operatorAction || null;
}

function buildHeroSummary(snapshot) {
  const manager = snapshot?.manager || {};
  const dashboard = snapshot?.dashboard || {};
  const readiness = dashboard.ops?.readiness || {};
  const leadDecision = dashboard.topDecisions?.[0] || null;
  const topReason = topBlocker(snapshot);
  const unresolvedCritical = unresolvedAlerts(snapshot).filter((item) => !item.acknowledgedAt && ["critical", "negative"].includes(item.severity));
  const freezeEntries = Boolean(dashboard.safety?.exchangeTruth?.freezeEntries);
  const probeOnly = Boolean(dashboard.safety?.orderLifecycle?.probeOnly?.enabled || dashboard.ops?.readiness?.reasons?.includes("probe_only"));
  const overview = dashboard.overview || {};

  const subline = leadDecision?.allow
    ? `${leadDecision.symbol} is momenteel de beste tradebare setup.`
    : topReason
      ? `Geen nieuwe trade: ${titleize(topReason)}.`
      : "Wachten op een valide setup of nieuwe analyse.";

  const pills = [
    {
      label: "Equity",
      value: formatMoney(overview.equity),
      tone: "neutral"
    },
    {
      label: "Beste kans",
      value: leadDecision?.symbol || "Geen setup",
      tone: leadDecision?.allow ? "positive" : "neutral"
    },
    {
      label: "Blokkade",
      value: topReason ? titleize(topReason) : "Geen directe blocker",
      tone: topReason ? "negative" : "positive"
    },
    {
      label: "Actie",
      value: leadDecision?.operatorAction || (freezeEntries ? "Reconcile controleren" : probeOnly ? "Alleen probes toelaten" : "Geen directe actie"),
      tone: leadDecision?.operatorAction || freezeEntries ? "negative" : "neutral"
    },
    {
      label: "Herstelt vanzelf",
      value: leadDecision?.autoRecovery || (unresolvedCritical.length ? "Na ack of resolve van kritieke alerts" : "Geen automatische recovery actief"),
      tone: leadDecision?.autoRecovery ? "positive" : "neutral"
    }
  ];

  return {
    subline,
    pills
  };
}

function renderBadges(snapshot) {
  const mode = snapshot?.manager?.currentMode || snapshot?.dashboard?.overview?.mode || "paper";
  const runState = snapshot?.manager?.runState || "stopped";
  const readiness = snapshot?.dashboard?.ops?.readiness?.status || "unknown";

  elements.modeBadge.className = `status-chip ${statusTone(mode)}`;
  elements.runStateBadge.className = `status-chip ${statusTone(runState)}`;
  elements.healthBadge.className = `status-chip ${statusTone(readiness)}`;

  elements.modeBadge.textContent = titleize(mode);
  elements.runStateBadge.textContent = titleize(runState);
  elements.healthBadge.textContent = titleize(readiness);
  const updatedAt = snapshot?.dashboard?.ops?.lastUpdatedAt || snapshot?.dashboard?.overview?.lastCycleAt || snapshot?.manager?.lastCycleAt || null;
  const receivedLabel = lastSnapshotReceivedAt ? `Refresh ${formatDate(lastSnapshotReceivedAt)}` : "Refresh -";
  const dataLabel = updatedAt ? `data ${formatDate(updatedAt)}` : "data -";
  const pingLabel = `${receivedLabel} · ${dataLabel}`;
  elements.refreshBadge.textContent = pingLabel;
  elements.refreshBadge.className = `status-chip muted refresh-chip ${statusTone(runState)}`;
}

function renderHero(snapshot) {
  const summary = buildHeroSummary(snapshot);
  elements.controlHint.textContent = summary.subline;
  elements.operatorSummary.innerHTML = summary.pills
    .map((item) => `
      <span class="hero-pill ${item.tone}">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(truncate(item.value, 72))}</span>
      </span>
    `)
    .join("");
}

function filterDecisions(snapshot) {
  const decisions = (snapshot?.dashboard?.topDecisions || []).slice(0, 24);
  return decisions.filter((item) => {
    if (allowedOnly && !item.allow) {
      return false;
    }
    if (!searchQuery) {
      return true;
    }
    const haystack = [
      item.symbol,
      item.summary,
      item.strategy?.strategyLabel,
      item.marketState?.phase,
      item.marketState?.direction
    ].join(" ").toLowerCase();
    return haystack.includes(searchQuery);
  });
}

function signalSummary(decision) {
  if (decision.allow) {
    return decision.summary || `${decision.symbol} is tradebaar.`;
  }
  return decision.operatorAction || decision.blockerReasons?.[0] || decision.summary || "Nog niet tradebaar.";
}

function renderSignals(snapshot) {
  const filtered = filterDecisions(snapshot);
  const total = snapshot?.dashboard?.topDecisions?.length || 0;
  const visible = showAllDecisions ? filtered : filtered.slice(0, SIGNAL_LIMIT);
  elements.decisionMeta.textContent = `${visible.length} van ${total} zichtbaar`;
  elements.decisionShowMoreBtn.textContent = showAllDecisions ? "Toon minder" : "Toon alles";
  elements.decisionShowMoreBtn.hidden = filtered.length <= SIGNAL_LIMIT;
  elements.decisionsList.innerHTML = visible.length
    ? visible.map((decision) => `
        <article class="signal-card">
          <div class="card-summary">
            <div class="card-header">
              <div>
                <p class="eyebrow">${escapeHtml(formatDecisionType(decision))}</p>
                <h3>${escapeHtml(decision.symbol || "-")}</h3>
              </div>
              <span class="pill ${decision.allow ? "positive" : "negative"}">${escapeHtml(decision.allow ? "Tradebaar" : "Geblokkeerd")}</span>
            </div>
            <p class="card-copy">${escapeHtml(truncate(signalSummary(decision), 170))}</p>
            <div class="quick-grid">
              <div class="stat">
                <span class="metric-label">Kans</span>
                <strong>${escapeHtml(formatPct(decision.probability, 0))}</strong>
              </div>
              <div class="stat">
                <span class="metric-label">Confidence</span>
                <strong>${escapeHtml(formatPct(decision.confidenceBreakdown?.overallConfidence, 0))}</strong>
              </div>
              <div class="stat">
                <span class="metric-label">Risk</span>
                <strong>${escapeHtml(titleize(decision.riskPolicy?.capitalPolicy?.status || decision.qualityQuorum?.status || "normal"))}</strong>
              </div>
            </div>
            <div class="decision-reasons">
              <div class="reason-row">
                <strong>Type</strong>
                <span>${escapeHtml(whyTradeable(decision) || formatDecisionType(decision))}</span>
              </div>
              <div class="reason-row">
                <strong>${decision.allow ? "Waarom wel" : "Waarom niet"}</strong>
                <span class="reason-copy">${escapeHtml(decision.allow ? whyTradeable(decision) || decision.summary || "Tradebaar volgens huidige checks." : whyBlocked(decision))}</span>
              </div>
              <div class="reason-row">
                <strong>Actie</strong>
                <span class="reason-copy">${escapeHtml(actionText(decision))}</span>
              </div>
            </div>
            <div class="tag-list">
              ${(decision.marketState?.direction ? `<span class="tag">${escapeHtml(titleize(decision.marketState.direction))}</span>` : "")}
              ${(decision.strategy?.strategyLabel ? `<span class="tag">${escapeHtml(decision.strategy.strategyLabel)}</span>` : "")}
              ${(decision.dataQuality?.status ? `<span class="tag ${statusTone(decision.dataQuality.status)}">${escapeHtml(titleize(decision.dataQuality.status))}</span>` : "")}
              ${(decision.executionStyle ? `<span class="tag">${escapeHtml(titleize(decision.executionStyle))}</span>` : "")}
            </div>
          </div>
        </article>
      `).join("")
    : `<div class="empty">Geen signalen passen bij de huidige filter.</div>`;
}

function renderPositions(snapshot) {
  const positions = (snapshot?.dashboard?.positions || []).slice(0, POSITION_LIMIT);
  elements.positionsList.innerHTML = positions.length
    ? positions.map((position) => `
        <article class="position-card">
          <div class="card-summary">
            <div class="card-header">
              <div>
                <p class="eyebrow">${escapeHtml(position.lifecycle?.state || "Positie")}</p>
                <h3>${escapeHtml(position.symbol || "-")}</h3>
              </div>
              <span class="pill ${toneClass(position.unrealizedPnl)}">${escapeHtml(formatMoney(position.unrealizedPnl))}</span>
            </div>
            <div class="subgrid">
              <div class="stat">
                <span class="metric-label">Entry</span>
                <strong>${escapeHtml(number(position.entryPrice, 4))}</strong>
              </div>
              <div class="stat">
                <span class="metric-label">Nu</span>
                <strong>${escapeHtml(number(position.currentPrice, 4))}</strong>
              </div>
              <div class="stat">
                <span class="metric-label">Rendement</span>
                <strong class="${toneClass(position.unrealizedPnlPct)}">${escapeHtml(formatSignedPct(position.unrealizedPnlPct))}</strong>
              </div>
            </div>
            <div class="tag-list">
              ${(position.regimeAtEntry ? `<span class="tag">${escapeHtml(titleize(position.regimeAtEntry))}</span>` : "")}
              ${(position.strategyAtEntry ? `<span class="tag">${escapeHtml(position.strategyAtEntry)}</span>` : "")}
              ${position.lifecycle?.manualReviewRequired ? `<span class="tag negative">Manual review</span>` : ""}
              ${position.lifecycle?.reconcileRequired ? `<span class="tag negative">Reconcile</span>` : ""}
            </div>
          </div>
        </article>
      `).join("")
    : `<div class="empty">Er zijn nu geen open posities.</div>`;
}

function buildOpsCards(snapshot) {
  const readiness = snapshot?.dashboard?.ops?.readiness || {};
  const alerts = unresolvedAlerts(snapshot);
  const lifecycle = pendingActions(snapshot);
  const exchangeTruth = snapshot?.dashboard?.safety?.exchangeTruth || {};
  const capitalPolicy = snapshot?.dashboard?.ops?.capitalPolicy || {};
  const paperLearning = snapshot?.dashboard?.ops?.paperLearning || {};
  return [
    {
      label: "Readiness",
      value: titleize(readiness.status || "unknown"),
      foot: readiness.reasons?.[0] ? titleize(readiness.reasons[0]) : "Geen directe blokkade",
      tone: statusTone(readiness.status)
    },
    {
      label: "Alerts",
      value: `${alerts.length}`,
      foot: alerts.find((item) => !item.acknowledgedAt) ? "Ack nodig" : "Onder controle",
      tone: alerts.find((item) => !item.acknowledgedAt) ? "negative" : "neutral"
    },
    {
      label: "Lifecycle",
      value: `${lifecycle.length}`,
      foot: lifecycle[0]?.state ? titleize(lifecycle[0].state) : "Geen pending actions",
      tone: lifecycle.some((item) => ["manual_review", "reconcile_required"].includes(item.state)) ? "negative" : "neutral"
    },
    {
      label: "Capital",
      value: titleize(capitalPolicy.status || "normal"),
      foot: exchangeTruth.freezeEntries ? "Entries bevroren" : "Entries toegestaan",
      tone: exchangeTruth.freezeEntries || capitalPolicy.status === "blocked" ? "negative" : "neutral"
    },
    {
      label: "Paper learning",
      value: titleize(paperLearning.readinessStatus || paperLearning.status || "warmup"),
      foot: paperLearning.probation?.status ? titleize(paperLearning.probation.status) : "Nog geen probation",
      tone: statusTone(paperLearning.readinessStatus || paperLearning.status)
    }
  ];
}

function buildOpsEvents(snapshot) {
  const readiness = snapshot?.dashboard?.ops?.readiness || {};
  const paperLearning = snapshot?.dashboard?.ops?.paperLearning || {};
  const alerts = unresolvedAlerts(snapshot).slice(0, 2).map((item) => ({
    title: titleize(item.type || item.severity || "alert"),
    detail: item.note || item.message || item.reason || "Alert vereist aandacht.",
    tone: item.acknowledgedAt ? "neutral" : "negative"
  }));
  const lifecycle = pendingActions(snapshot).slice(0, 2).map((item) => ({
    title: titleize(item.state || "pending_action"),
    detail: item.symbol ? `${item.symbol} · ${item.action || "actie open"}` : item.action || "Pending action actief.",
    tone: ["manual_review", "reconcile_required"].includes(item.state) ? "negative" : "neutral"
  }));
  const runbooks = (snapshot?.dashboard?.ops?.runbooks || []).slice(0, 2).map((item) => ({
    title: titleize(item.title || item.type || "runbook"),
    detail: item.summary || item.action || item.description || "Operatoradvies beschikbaar.",
    tone: "neutral"
  }));

  const items = [
    readiness.reasons?.[0]
      ? {
          title: "Belangrijkste blokkade",
          detail: titleize(readiness.reasons[0]),
          tone: statusTone(readiness.status)
        }
      : null,
    ...alerts,
    paperLearning.probation?.note
      ? {
          title: "Paper probation",
          detail: paperLearning.probation.note,
          tone: paperLearning.probation.rollbackRisk ? "negative" : paperLearning.probation.promotionReady ? "positive" : "neutral"
        }
      : null,
    paperLearning.topBlockers?.[0]
      ? {
          title: "Paper blocker",
          detail: titleize(paperLearning.topBlockers[0].id),
          tone: "neutral"
        }
      : null,
    paperLearning.recentOutcomes?.[0]
      ? {
          title: "Paper outcome",
          detail: titleize(paperLearning.recentOutcomes[0].id),
          tone: "neutral"
        }
      : null,
    ...lifecycle,
    ...runbooks
  ].filter(Boolean).slice(0, 5);

  return items;
}

function renderOps(snapshot) {
  const cards = buildOpsCards(snapshot);
  const paperLearning = snapshot?.dashboard?.ops?.paperLearning || {};
  elements.opsSummary.innerHTML = cards.map((item) => `
    <article class="risk-card">
      <span class="metric-label">${escapeHtml(item.label)}</span>
      <strong class="metric-value ${item.tone || ""}">${escapeHtml(item.value)}</strong>
      <span class="metric-foot">${escapeHtml(item.foot)}</span>
    </article>
  `).join("");

  if (elements.opsLearning) {
    elements.opsLearning.innerHTML = paperLearning.readinessStatus || paperLearning.probation
      ? `
      <article class="learning-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Paper learning</p>
            <h3>Readiness ${escapeHtml(formatPct(paperLearning.readinessScore || 0, 0))}</h3>
          </div>
          <span class="pill ${statusTone(paperLearning.readinessStatus || paperLearning.status)}">${escapeHtml(titleize(paperLearning.readinessStatus || paperLearning.status || "warmup"))}</span>
        </div>
        <div class="quick-grid">
          <div class="stat">
            <span class="metric-label">Safe / Probe / Shadow</span>
            <strong>${escapeHtml(`${paperLearning.safeCount || 0} / ${paperLearning.probeCount || 0} / ${paperLearning.shadowCount || 0}`)}</strong>
          </div>
          <div class="stat">
            <span class="metric-label">Probation</span>
            <strong>${escapeHtml(titleize(paperLearning.probation?.status || "warmup"))}</strong>
          </div>
          <div class="stat">
            <span class="metric-label">Top blocker</span>
            <strong>${escapeHtml(titleize(paperLearning.topBlockers?.[0]?.id || "geen"))}</strong>
          </div>
          <div class="stat">
            <span class="metric-label">Top outcome</span>
            <strong>${escapeHtml(titleize(paperLearning.recentOutcomes?.[0]?.id || "nog geen"))}</strong>
          </div>
        </div>
      </article>
    `
      : "";
  }

  const events = buildOpsEvents(snapshot);
  elements.opsList.innerHTML = events.length
    ? events.map((item) => `
        <article class="event-row ${item.tone || ""}">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="meta">${escapeHtml(truncate(item.detail, 120))}</span>
        </article>
      `).join("")
    : `<div class="empty">Geen operationele aandachtspunten.</div>`;
}

function renderTrades(snapshot) {
  const trades = (snapshot?.dashboard?.report?.recentTrades || []).slice(0, TRADE_LIMIT);
  elements.tradesBody.innerHTML = trades.length
    ? trades.map((trade) => `
        <tr>
          <td>${escapeHtml(trade.symbol || "-")}</td>
          <td>${escapeHtml(number(trade.entryPrice, 4))}</td>
          <td>${escapeHtml(number(trade.exitPrice, 4))}</td>
          <td>${escapeHtml(titleize(trade.reason || "-"))}</td>
          <td class="${toneClass(trade.pnlQuote)}">${escapeHtml(formatMoney(trade.pnlQuote))}</td>
          <td class="${toneClass(trade.netPnlPct)}">${escapeHtml(formatSignedPct(trade.netPnlPct))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="6" class="empty">Nog geen recente trades beschikbaar.</td></tr>`;
}

function render(snapshot) {
  latestSnapshot = snapshot;
  lastSnapshotReceivedAt = new Date().toISOString();
  renderBadges(snapshot);
  renderHero(snapshot);
  renderSignals(snapshot);
  renderPositions(snapshot);
  renderOps(snapshot);
  renderTrades(snapshot);
  syncControls(snapshot);
  syncPanels();
}

function syncControls(snapshot) {
  const runState = snapshot?.manager?.runState || "stopped";
  const mode = snapshot?.manager?.currentMode || "paper";
  const running = runState === "running";
  elements.startBtn.disabled = busy || running;
  elements.stopBtn.disabled = busy || runState === "stopped";
  elements.refreshBtn.disabled = busy || running;
  elements.paperBtn.disabled = busy || mode === "paper";
  elements.liveBtn.disabled = busy || mode === "live";
}

async function refreshSnapshot() {
  const epoch = ++requestEpoch;
  try {
    const payload = await api("/api/snapshot");
    if (epoch !== requestEpoch) {
      return;
    }
    render(pickSnapshot(payload));
  } catch (error) {
    elements.controlHint.textContent = error.message;
    elements.operatorSummary.innerHTML = `
      <span class="hero-pill negative">
        <strong>Dashboard</strong>
        <span>Controleer of de dashboardserver nog draait.</span>
      </span>
    `;
  }
}

async function runAction(path, body = {}) {
  busy = true;
  syncControls(latestSnapshot || {});
  try {
    const payload = await api(path, { method: "POST", body });
    render(pickSnapshot(payload));
  } catch (error) {
    elements.controlHint.textContent = error.message;
  } finally {
    busy = false;
    syncControls(latestSnapshot || {});
  }
}

function bindEvents() {
  elements.startBtn?.addEventListener("click", () => runAction("/api/start"));
  elements.stopBtn?.addEventListener("click", () => runAction("/api/stop"));
  elements.refreshBtn?.addEventListener("click", () => runAction("/api/refresh"));
  elements.paperBtn?.addEventListener("click", () => runAction("/api/mode", { mode: "paper" }));
  elements.liveBtn?.addEventListener("click", () => runAction("/api/mode", { mode: "live" }));

  elements.decisionSearch?.addEventListener("input", (event) => {
    searchQuery = `${event.target.value || ""}`.trim().toLowerCase();
    if (latestSnapshot) {
      renderSignals(latestSnapshot);
    }
  });

  elements.decisionAllowedOnly?.addEventListener("change", (event) => {
    allowedOnly = Boolean(event.target.checked);
    if (latestSnapshot) {
      renderSignals(latestSnapshot);
    }
  });

  elements.decisionShowMoreBtn?.addEventListener("click", () => {
    showAllDecisions = !showAllDecisions;
    writeStoredBoolean(STORAGE_KEYS.showAllDecisions, showAllDecisions);
    if (latestSnapshot) {
      renderSignals(latestSnapshot);
    }
  });

  bindPanelToggle("signals", elements.signalsSection, elements.signalsToggleBtn);
  bindPanelToggle("positions", elements.positionsSection, elements.positionsToggleBtn);
  bindPanelToggle("risk", elements.riskSection, elements.riskToggleBtn);
  bindPanelToggle("history", elements.historySection, elements.historyToggleBtn);
}

function bindPanelToggle(key, section, button) {
  button?.addEventListener("click", () => {
    panelState[key] = !panelState[key];
    syncPanel(section, button, panelState[key]);
  });
}

function syncPanel(section, button, expanded) {
  section?.classList.toggle("is-collapsed", !expanded);
  if (button) {
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "Inklappen" : "Uitklappen";
  }
}

function syncPanels() {
  syncPanel(elements.signalsSection, elements.signalsToggleBtn, panelState.signals);
  syncPanel(elements.positionsSection, elements.positionsToggleBtn, panelState.positions);
  syncPanel(elements.riskSection, elements.riskToggleBtn, panelState.risk);
  syncPanel(elements.historySection, elements.historyToggleBtn, panelState.history);
}

async function init() {
  bindEvents();
  await refreshSnapshot();
  pollTimer = window.setInterval(refreshSnapshot, POLL_MS);
}

init();

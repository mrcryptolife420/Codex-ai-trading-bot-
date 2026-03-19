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
  learningList: document.querySelector("#learningList"),
  opsSummary: document.querySelector("#opsSummary"),
  opsLearning: document.querySelector("#opsLearning"),
  opsList: document.querySelector("#opsList"),
  missedTradesList: document.querySelector("#missedTradesList"),
  tradesBody: document.querySelector("#tradesBody"),
  signalsSection: document.querySelector("#signalsSection"),
  positionsSection: document.querySelector("#positionsSection"),
  learningSection: document.querySelector("#learningSection"),
  missedTradesSection: document.querySelector("#missedTradesSection"),
  riskSection: document.querySelector("#riskSection"),
  historySection: document.querySelector("#historySection"),
  signalsToggleBtn: document.querySelector("#signalsToggleBtn"),
  positionsToggleBtn: document.querySelector("#positionsToggleBtn"),
  learningToggleBtn: document.querySelector("#learningToggleBtn"),
  missedTradesToggleBtn: document.querySelector("#missedTradesToggleBtn"),
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
  learning: true,
  missedTrades: true,
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

function isReadableSentence(value) {
  const text = `${value || ""}`.trim();
  if (!text) {
    return false;
  }
  return text.includes(" ") || /[.:]/.test(text);
}

function humanizeReason(value, fallback = "-") {
  const text = `${value || ""}`.trim();
  if (!text) {
    return fallback;
  }
  return isReadableSentence(text) ? text : titleize(text);
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

function signalPrimaryReason(decision) {
  if (decision.allow) {
    return decision.summary || whyTradeable(decision) || "Setup is tradebaar volgens de huidige checks.";
  }
  return whyBlocked(decision);
}

function signalStatusText(decision) {
  if (decision.allow) {
    return `Klaar voor ${titleize(decision.executionStyle || "entry")}.`;
  }
  return decision.blockerReasons?.[0]
    ? `Geblokkeerd door ${titleize(decision.blockerReasons[0])}.`
    : "Nog niet tradebaar.";
}

function signalSupportText(decision) {
  if (decision.allow) {
    return actionText(decision);
  }
  return decision.autoRecovery || "Wacht op betere marktdata, minder blokkades of een sterkere score.";
}

function renderMissedTradeAnalysis(decision) {
  const analysis = decision.missedTradeAnalysis;
  if (decision.allow || !analysis?.available) {
    return "";
  }
  const metrics = [
    analysis.badVetoRate != null ? `Te streng ${formatPct(analysis.badVetoRate, 0)}` : null,
    analysis.goodVetoRate != null ? `Terecht ${formatPct(analysis.goodVetoRate, 0)}` : null,
    analysis.averageMissedMovePct != null ? `Gemiste move ${formatPct(analysis.averageMissedMovePct, 1)}` : null,
    analysis.recentMatches ? `${analysis.recentMatches} vergelijkbare cases` : null
  ].filter(Boolean);
  return `
    <details class="analysis-box">
      <summary>Gemiste trade analyse</summary>
      <p>${escapeHtml(analysis.summary || "Nog geen specifieke analyse beschikbaar.")}</p>
      ${metrics.length ? `<div class="tag-list">${metrics.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      <p class="analysis-note">${escapeHtml(analysis.recommendation || "Gebruik dit als extra context bij geblokkeerde setups.")}</p>
    </details>
  `;
}

function hypotheticalTradeText(decision) {
  const analysis = decision.missedTradeAnalysis || {};
  if (analysis.averageMissedMovePct > 0.015) {
    return `Vergelijkbare blokkades liepen vaak nog ongeveer ${formatPct(analysis.averageMissedMovePct, 1)} door in jouw richting.`;
  }
  if (analysis.averageMissedMovePct > 0.005) {
    return `Vergelijkbare blokkades gaven vaak nog een kleine move van ongeveer ${formatPct(analysis.averageMissedMovePct, 1)}.`;
  }
  if ((analysis.goodVetoRate || 0) > (analysis.badVetoRate || 0)) {
    return "Historisch was blokkeren hier meestal veiliger dan instappen.";
  }
  return "Deze setup is leergevoelig: er is nog geen sterke voorkeur tussen blokkeren of instappen.";
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
  const blocked = snapshot?.dashboard?.blockedSetups?.[0];
  if (blocked?.operatorAction) {
    return blocked.operatorAction;
  }
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
  return blocked?.operatorAction || blocked?.blockerReasons?.[0] || null;
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
      ? `Geen nieuwe trade: ${humanizeReason(topReason)}.`
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
      value: topReason ? humanizeReason(topReason) : "Geen directe blocker",
      tone: topReason ? "negative" : "positive"
    },
    {
      label: "Actie",
      value: leadDecision?.operatorAction || (freezeEntries ? "Reconcile controleren" : probeOnly ? "Alleen probes toelaten" : "Geen directe actie"),
      tone: (Boolean(leadDecision?.operatorAction) || freezeEntries) ? "negative" : "neutral"
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
                <p class="signal-status ${decision.allow ? "positive" : "negative"}">${escapeHtml(signalStatusText(decision))}</p>
              </div>
              <span class="pill ${decision.allow ? "positive" : "negative"}">${escapeHtml(decision.allow ? "Tradebaar" : "Geblokkeerd")}</span>
            </div>
            <p class="card-copy">${escapeHtml(truncate(signalPrimaryReason(decision), 190))}</p>
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
            <div class="signal-overview">
              <span class="tag">${escapeHtml(titleize(decision.marketState?.phase || decision.regime || "setup"))}</span>
              ${decision.strategy?.strategyLabel ? `<span class="tag">${escapeHtml(decision.strategy.strategyLabel)}</span>` : ""}
              ${decision.executionStyle ? `<span class="tag">${escapeHtml(titleize(decision.executionStyle))}</span>` : ""}
              ${decision.dataQuality?.status ? `<span class="tag ${statusTone(decision.dataQuality.status)}">${escapeHtml(titleize(decision.dataQuality.status))}</span>` : ""}
            </div>
            <div class="decision-reasons">
              <div class="reason-row">
                <strong>Setup</strong>
                <span class="reason-copy">${escapeHtml(whyTradeable(decision) || formatDecisionType(decision))}</span>
              </div>
              <div class="reason-row">
                <strong>${decision.allow ? "Waarom nu" : "Waarom niet"}</strong>
                <span class="reason-copy">${escapeHtml(signalPrimaryReason(decision))}</span>
              </div>
              <div class="reason-row">
                <strong>Actie</strong>
                <span class="reason-copy">${escapeHtml(signalSupportText(decision))}</span>
              </div>
            </div>
            <p class="signal-note">${escapeHtml(truncate(signalSummary(decision), 220))}</p>
            ${renderMissedTradeAnalysis(decision)}
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

function renderMissedTrades(snapshot) {
  const blocked = (snapshot?.dashboard?.blockedSetups || [])
    .filter((item) => item?.missedTradeAnalysis?.available)
    .slice(0, 4);
  elements.missedTradesList.innerHTML = blocked.length
    ? blocked.map((decision) => {
      const analysis = decision.missedTradeAnalysis || {};
      const blockerLabel = analysis.blockerId ? titleize(analysis.blockerId) : "Gemengde blokkade";
      return `
        <article class="signal-card missed-card">
          <div class="card-summary">
            <div class="card-header">
              <div>
                <p class="eyebrow">Gemiste setup</p>
                <h3>${escapeHtml(decision.symbol || "-")}</h3>
              </div>
              <span class="pill negative">${escapeHtml(blockerLabel)}</span>
            </div>
            <p class="card-copy">${escapeHtml(analysis.summary || "Nog geen specifieke gemiste-trade analyse beschikbaar.")}</p>
            <div class="decision-reasons">
              <div class="reason-row">
                <strong>Setup</strong>
                <span class="reason-copy">${escapeHtml(formatDecisionType(decision))}</span>
              </div>
              <div class="reason-row">
                <strong>Hoe wel</strong>
                <span class="reason-copy">${escapeHtml(hypotheticalTradeText(decision))}</span>
              </div>
              <div class="reason-row">
                <strong>Les</strong>
                <span class="reason-copy">${escapeHtml(analysis.recommendation || "Gebruik shadow/probe en vergelijkbare counterfactuals als leidraad.")}</span>
              </div>
            </div>
            <div class="tag-list">
              ${analysis.badVetoRate != null ? `<span class="tag negative">Te streng ${escapeHtml(formatPct(analysis.badVetoRate, 0))}</span>` : ""}
              ${analysis.goodVetoRate != null ? `<span class="tag ${analysis.goodVetoRate >= analysis.badVetoRate ? "positive" : ""}">Terecht ${escapeHtml(formatPct(analysis.goodVetoRate, 0))}</span>` : ""}
              ${analysis.averageMissedMovePct != null ? `<span class="tag">${escapeHtml(`Gemiste move ${formatPct(analysis.averageMissedMovePct, 1)}`)}</span>` : ""}
              ${analysis.recentMatches ? `<span class="tag">${escapeHtml(`${analysis.recentMatches} cases`)}</span>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("")
    : `<div class="empty">Nog geen duidelijke gemiste-trade analyse beschikbaar voor recente blokkades.</div>`;
}

function learningFocusText(snapshot) {
  const paperLearning = snapshot?.dashboard?.ops?.paperLearning || {};
  const retrainPlan = snapshot?.dashboard?.offlineTrainer?.retrainExecutionPlan || {};
  const replayPlan = snapshot?.dashboard?.ops?.replayChaos?.deterministicReplayPlan || {};
  const topScope =
    paperLearning.primaryScope ||
    paperLearning.scopeReadiness?.[0] ||
    (paperLearning.activeLearning?.focusScopes?.[0]
      ? {
          ...paperLearning.activeLearning.focusScopes[0],
          status: paperLearning.activeLearning?.status || "observe",
          source: "active_learning"
        }
      : null) ||
    (paperLearning.experimentScopes?.[0]
      ? {
          id: paperLearning.experimentScopes[0].id,
          status: paperLearning.experimentScopes[0].status || "observe",
          score: paperLearning.experimentScopes[0].score || 0,
          source: paperLearning.experimentScopes[0].source || "experiment"
        }
      : null);
  const topBlocker = paperLearning.topBlockers?.[0];
  const latestOutcome = paperLearning.recentOutcomes?.[0];

  if (retrainPlan.selectedScopes?.[0]?.id) {
    return `${titleize(retrainPlan.batchType || "scoped retrain")} rond ${titleize(retrainPlan.selectedScopes[0].id)}.`;
  }
  if (topScope?.id) {
    const sourceLabel = topScope.source === "shadow_learning"
      ? "via shadow-learning"
      : topScope.source === "active_learning"
        ? "via active learning"
        : "in paper readiness";
    return `Leert nu vooral op ${titleize(topScope.id)} ${sourceLabel}.`;
  }
  if (replayPlan.nextPackType) {
    return `Replay-focus ligt op ${titleize(replayPlan.nextPackType)}.`;
  }
  if (topBlocker?.id || latestOutcome?.id) {
    return `Leert nog vooral uit ${titleize(topBlocker?.id || latestOutcome?.id || "recente paper cases")}.`;
  }
  return "De bot bouwt nog basisleerdata op in paper mode.";
}

function latestTradeSummary(snapshot) {
  const mode = snapshot?.dashboard?.mode || snapshot?.mode || "paper";
  const trades = snapshot?.dashboard?.report?.recentTrades || [];
  const trade = trades.find((item) => (item.brokerMode || mode) === mode) || trades[0];
  if (!trade) {
    return {
      title: "Nog geen recente trade",
      detail: "Zodra een trade sluit, zie je hier direct wat er gebeurde en wat de bot daarvan leert.",
      lesson: "Nog geen concrete trade-les beschikbaar."
    };
  }
  const pnl = formatMoney(trade.pnlQuote);
  const pnlPct = formatSignedPct(trade.netPnlPct);
  const reason = titleize(trade.reason || "trade");
  return {
    title: `${trade.symbol || "-"} · ${reason}`,
    detail: `${pnl} (${pnlPct}) bij exit op ${formatDate(trade.closedAt || trade.exitAt || trade.updatedAt)}.`,
    lesson: `${trade.symbol || "Deze trade"} sloot via ${reason.toLowerCase()} en telt mee in de leerlus voor exits, timing en execution-kosten.`
  };
}

function renderProbeReviews(reviews = []) {
  if (!reviews.length) {
    return `
      <article class="learning-review-card">
        <span class="metric-label">Probe review</span>
        <p class="learning-note">Nog geen recente probe-trades om te tonen.</p>
      </article>
    `;
  }
  return reviews.map((review) => `
    <article class="learning-review-card">
      <div class="learning-review-head">
        <strong>${escapeHtml(review.symbol || "Probe")}</strong>
        <span class="pill ${statusTone(review.outcome)}">${escapeHtml(titleize(review.outcome || "observe"))}</span>
      </div>
      <div class="learning-review-metrics">
        <span class="tag ${toneClass(review.pnlQuote)}">${escapeHtml(formatMoney(review.pnlQuote || 0))}</span>
        <span class="tag ${toneClass(review.netPnlPct)}">${escapeHtml(formatSignedPct(review.netPnlPct || 0, 1))}</span>
        <span class="tag">${escapeHtml(titleize(review.reason || review.learningLane || "probe"))}</span>
      </div>
      <p class="learning-note">${escapeHtml(review.lesson || "Deze probe voedt de paper-leerlus.")}</p>
      <span class="metric-foot">${escapeHtml(`Gesloten ${formatDate(review.closedAt)}`)}</span>
    </article>
  `).join("");
}

function renderShadowReviews(reviews = []) {
  if (!reviews.length) {
    return `
      <article class="learning-review-card">
        <span class="metric-label">Shadow review</span>
        <p class="learning-note">Nog geen recente shadow-cases om te tonen.</p>
      </article>
    `;
  }
  return reviews.map((review) => {
    const branchText = review.bestBranch?.id
      ? review.bestBranch.outcome === "pending_review"
        ? `${titleize(review.bestBranch.id)} · Review loopt nog`
        : `${titleize(review.bestBranch.id)} · ${titleize(review.bestBranch.outcome || "observe")} · ${formatPct(review.bestBranch.adjustedMovePct || 0, 1)}`
      : "Nog geen beste alternatieve branch.";
    const moveText = Number.isFinite(review.realizedMovePct)
      ? `Move ${formatPct(review.realizedMovePct || 0, 1)}`
      : "Nog in review";
    return `
      <article class="learning-review-card">
        <div class="learning-review-head">
          <strong>${escapeHtml(review.symbol || "Shadow")}</strong>
          <span class="pill ${statusTone(review.outcome)}">${escapeHtml(titleize(review.outcome || "observe"))}</span>
        </div>
        <div class="learning-review-metrics">
          <span class="tag">${escapeHtml(moveText)}</span>
          <span class="tag">${escapeHtml(titleize(review.blocker || "geen blocker"))}</span>
        </div>
        <p class="learning-note">${escapeHtml(review.lesson || "Deze shadow-case blijft bruikbaar als vergelijkingsmateriaal.")}</p>
        <span class="metric-foot">${escapeHtml(branchText)}</span>
      </article>
    `;
  }).join("");
}

function renderLearning(snapshot) {
  if (!elements.learningList) {
    return;
  }

  const paperLearning = snapshot?.dashboard?.ops?.paperLearning || {};
  const offlineTrainer = snapshot?.dashboard?.offlineTrainer || {};
  const retrainPlan = offlineTrainer.retrainExecutionPlan || {};
  const replayPlan = snapshot?.dashboard?.ops?.replayChaos?.deterministicReplayPlan || {};
  const topScope =
    paperLearning.primaryScope ||
    paperLearning.scopeReadiness?.[0] ||
    (paperLearning.activeLearning?.focusScopes?.[0]
      ? {
          ...paperLearning.activeLearning.focusScopes[0],
          status: paperLearning.activeLearning?.status || "observe",
          source: "active_learning"
        }
      : null) ||
    (paperLearning.experimentScopes?.[0]
      ? {
          id: paperLearning.experimentScopes[0].id,
          status: paperLearning.experimentScopes[0].status || "observe",
          score: paperLearning.experimentScopes[0].score || 0,
          source: paperLearning.experimentScopes[0].source || "experiment"
        }
      : null);
  const topBlocker = paperLearning.topBlockers?.[0];
  const topOutcome = paperLearning.recentOutcomes?.[0];
  const latestTrade = latestTradeSummary(snapshot);
  const learningStatus = titleize(paperLearning.readinessStatus || paperLearning.status || "warmup");
  const learningScore = formatPct(paperLearning.readinessScore || 0, 0);
  const laneText = `${paperLearning.safeCount || 0} safe · ${paperLearning.probeCount || 0} probe · ${paperLearning.shadowCount || 0} shadow`;
  const topBlockerText = titleize(topBlocker?.id || "geen dominante blocker");
  const reviewQueue = (paperLearning.reviewQueue || []).slice(0, 3);
  const benchmarkLead = paperLearning.challengerScorecards?.[0] || paperLearning.challengerPolicy || null;
  const policyCandidates = (paperLearning.policyTransitions?.candidates || []).slice(0, 2);
  const activeOverrides = (paperLearning.operatorActions?.activeOverrides || []).slice(0, 3);
  const operatorHistory = (paperLearning.operatorActions?.history || []).slice(0, 3);
  const operatorGuardrails = (paperLearning.operatorGuardrails?.blockedBy || []).slice(0, 3);
  const reviewText = reviewQueue[0]?.note ||
    (paperLearning.reviewPacks?.topMissedSetup
      ? `Review vooral ${paperLearning.reviewPacks.topMissedSetup} als gemiste setup en ${paperLearning.reviewPacks.weakestProbe || "de zwakste probe"} als leergeval.`
      : "Nog geen automatische review-pack beschikbaar.");
  const blockerMeaning = topBlocker?.id
    ? `Dit remt nu het vaakst: ${titleize(topBlocker.id)}.`
    : "Er is nog geen dominante rem in de huidige learning-data.";
  const scopeMeaning = topScope?.id
    ? topScope.source === "shadow_learning"
      ? `${titleize(topScope.id)} springt nu vooral uit blocked/shadow-learning; bevestig dit nog met extra probes.`
      : `${titleize(topScope.id)} is nu de sterkste leerscope.`
    : "De bot zit nog in warmup en heeft nog geen sterke paperscope.";
  const nextStep =
    retrainPlan.operatorAction ||
    replayPlan.operatorGoal ||
    paperLearning.probation?.note ||
    paperLearning.notes?.[0] ||
    "Nog geen directe leeractie nodig.";
  const focusText = learningFocusText(snapshot);
  const probeReviewMarkup = renderProbeReviews(paperLearning.recentProbeReviews || []);
  const shadowReviewMarkup = renderShadowReviews(paperLearning.recentShadowReviews || []);
  const compactReviewTags = reviewQueue.length
    ? reviewQueue.map((item) => `<span class="tag ${item.priority === "high" ? "negative" : ""}">${escapeHtml(`${titleize(item.type)} · ${item.id}`)}</span>`).join("")
    : `<span class="tag">Geen review queue</span>`;
  const compactPolicyTags = policyCandidates.length
    ? policyCandidates.map((item) => `<span class="tag ${item.action.includes("retire") ? "negative" : item.action.includes("promote") ? "positive" : ""}">${escapeHtml(`${titleize(item.action)} · ${titleize(item.id)}`)}</span>`).join("")
    : `<span class="tag">Geen policy-wijziging klaar</span>`;
  const compactOverrideTags = activeOverrides.length
    ? activeOverrides.map((item) => `<span class="tag positive">${escapeHtml(`${titleize(item.id)} · ${titleize(item.status || "override")}`)}</span>`).join("")
    : `<span class="tag">Geen actieve override</span>`;
  const operatorActionButtons = policyCandidates.length
    ? policyCandidates.map((item) => item.approved
      ? `<span class="tag positive">${escapeHtml(`Approved · ${titleize(item.id)}`)}</span>`
      : `<button class="tag" data-policy-action="approve" data-transition-id="${escapeHtml(item.id)}" data-transition-kind="${escapeHtml(item.action)}">Approve ${escapeHtml(titleize(item.id))}</button><button class="tag negative" data-policy-action="reject" data-transition-id="${escapeHtml(item.id)}" data-transition-kind="${escapeHtml(item.action)}">Reject</button>`
    ).join("")
    : "";
  const revertButtons = activeOverrides.length
    ? activeOverrides.map((item) => `<button class="tag negative" data-policy-action="revert" data-transition-id="${escapeHtml(item.id)}">Revert ${escapeHtml(titleize(item.id))}</button>`).join("")
    : "";

  elements.learningList.innerHTML = `
    <article class="learning-board">
      <section class="learning-hero">
        <div class="learning-title">
          <div>
            <p class="eyebrow">Live learning</p>
            <h3>${escapeHtml(learningStatus)} · ${escapeHtml(learningScore)}</h3>
          </div>
          <span class="pill ${statusTone(paperLearning.readinessStatus || paperLearning.status)}">${escapeHtml(learningStatus)}</span>
        </div>
        <p class="learning-copy">${escapeHtml(focusText)}</p>
        <div class="learning-strip-grid">
          <span class="tag">${escapeHtml(laneText)}</span>
          <span class="tag">${escapeHtml(`Snapshot: ${formatDate(paperLearning.generatedAt)}`)}</span>
          <span class="tag">${escapeHtml(`Top blocker: ${topBlockerText}`)}</span>
          <span class="tag">${escapeHtml(`Laatste les: ${titleize(topOutcome?.id || "warmup")}`)}</span>
        </div>
      </section>
      <section class="learning-summary-grid">
        <article class="learning-detail">
          <span class="metric-label">Leert nu</span>
          <strong>${escapeHtml(topScope?.id ? titleize(topScope.id) : "Warmup dataset")}</strong>
          <span class="metric-foot">${escapeHtml(topScope?.status ? `${titleize(topScope.status)} · ${formatPct(topScope.readinessScore || topScope.score || 0, 0)} · ${titleize(topScope.source || "probe_trades")}` : "Nog geen sterke scope zichtbaar.")}</span>
          <p class="learning-note">${escapeHtml(scopeMeaning)}</p>
        </article>
        <article class="learning-detail">
          <span class="metric-label">Laatste trade</span>
          <strong>${escapeHtml(latestTrade.title)}</strong>
          <span class="metric-foot">${escapeHtml(latestTrade.detail)}</span>
          <p class="learning-note">${escapeHtml(latestTrade.lesson)}</p>
        </article>
        <article class="learning-detail">
          <span class="metric-label">Belangrijkste rem</span>
          <strong>${escapeHtml(titleize(topOutcome?.id || topBlocker?.id || "nog geen duidelijke les"))}</strong>
          <span class="metric-foot">${escapeHtml(
            topOutcome?.count
              ? `${topOutcome.count} recente cases van dit type.`
              : topBlocker?.count
                ? `${topBlocker.count} blokkades sturen nu de leerlus.`
                : "Er is nog te weinig consistente paperdata om 1 duidelijke les te trekken."
          )}</span>
          <p class="learning-note">${escapeHtml(blockerMeaning)}</p>
        </article>
        <article class="learning-detail">
          <span class="metric-label">Volgende stap</span>
          <strong>${escapeHtml(titleize(retrainPlan.batchType || replayPlan.nextPackType || "observe"))}</strong>
          <span class="metric-foot">${escapeHtml(nextStep)}</span>
          <p class="learning-note">${escapeHtml(reviewText)}</p>
        </article>
      </section>
      <section class="learning-callouts">
        <article class="learning-list-item">
          <span class="metric-label">Wat gebeurt er nu</span>
          <p>${escapeHtml(
            paperLearning.probation?.note ||
            (paperLearning.thresholdSandbox?.status
              ? `${titleize(paperLearning.probation?.status || "sandbox")} actief: de bot test kleine aanpassingen zonder meteen het hoofdbeleid te wijzigen.`
              : "De bot vergelijkt recente trades, blokkades en shadow-cases om thresholds en filters te verbeteren.")
          )}</p>
          <p>${escapeHtml(
            benchmarkLead?.id
              ? `${titleize(benchmarkLead.id)} presteert nu het sterkst als challenger of benchmark.`
              : paperLearning.coaching?.whatWorked || "Nog geen sterke benchmark of coachingregel zichtbaar."
          )}</p>
        </article>
        <article class="learning-list-item">
          <span class="metric-label">Review queue</span>
          <div class="tag-list">${compactReviewTags}</div>
          <p>${escapeHtml(reviewText)}</p>
        </article>
        <article class="learning-list-item">
          <span class="metric-label">Policy en operatoracties</span>
          <div class="tag-list">${compactPolicyTags}</div>
          <div class="tag-list">${compactOverrideTags}</div>
          <p>${escapeHtml(
            paperLearning.policyTransitions?.note ||
            paperLearning.operatorActions?.note ||
            "Nog geen policy-wijziging of override die operator-ingreep vraagt."
          )}</p>
          ${operatorGuardrails.length ? `<div class="tag-list">${operatorGuardrails.map((item) => `<span class="tag negative">${escapeHtml(titleize(item))}</span>`).join("")}</div>` : ""}
          ${operatorActionButtons ? `<div class="tag-list">${operatorActionButtons}</div>` : ""}
          ${revertButtons ? `<div class="tag-list">${revertButtons}</div>` : ""}
        </article>
        <article class="learning-list-item">
          <span class="metric-label">Laatste operatorlog</span>
          <div class="tag-list">
            ${operatorHistory.length
              ? operatorHistory.map((item) => `<span class="tag">${escapeHtml(`${titleize(item.status || item.action || "actie")} · ${titleize(item.id)} · ${formatDate(item.at)}`)}</span>`).join("")
              : `<span class="tag">Nog geen operator history</span>`}
          </div>
          <p>${escapeHtml(
            operatorHistory[0]?.note ||
            paperLearning.coaching?.nextReview ||
            "Goedgekeurde, afgewezen en teruggedraaide policy-acties verschijnen hier."
          )}</p>
        </article>
      </section>
      <section class="learning-review-grid">
        <article class="learning-review-column">
          <div class="learning-section-head">
            <span class="metric-label">Probe trades</span>
            <span class="metric-foot">Hoe echte paper-probes liepen</span>
          </div>
          ${probeReviewMarkup}
        </article>
        <article class="learning-review-column">
          <div class="learning-section-head">
            <span class="metric-label">Shadow cases</span>
            <span class="metric-foot">Wat geblokkeerde setups waarschijnlijk deden</span>
          </div>
          ${shadowReviewMarkup}
        </article>
      </section>
    </article>
  `;
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
  const offlineTrainer = snapshot?.dashboard?.offlineTrainer || {};
  const retrainPlan = offlineTrainer.retrainExecutionPlan || {};
  const replayPlan = snapshot?.dashboard?.ops?.replayChaos?.deterministicReplayPlan || {};
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
    retrainPlan.operatorAction
      ? {
          title: "Retrain batch",
          detail: retrainPlan.operatorAction,
          tone: retrainPlan.gatingReasons?.length ? "negative" : "neutral"
        }
      : null,
    replayPlan.operatorGoal
      ? {
          title: "Replay prioriteit",
          detail: replayPlan.operatorGoal,
          tone: replayPlan.status === "priority" ? "negative" : "neutral"
        }
      : null,
    ...lifecycle,
    ...runbooks
  ].filter(Boolean).slice(0, 5);

  return items;
}

function renderOps(snapshot) {
  const cards = buildOpsCards(snapshot);
  elements.opsSummary.innerHTML = cards.map((item) => `
    <article class="risk-card">
      <span class="metric-label">${escapeHtml(item.label)}</span>
      <strong class="metric-value ${item.tone || ""}">${escapeHtml(item.value)}</strong>
      <span class="metric-foot">${escapeHtml(item.foot)}</span>
    </article>
  `).join("");

  if (elements.opsLearning) {
    elements.opsLearning.innerHTML = "";
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
  renderLearning(snapshot);
  renderMissedTrades(snapshot);
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

  elements.learningList?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-policy-action]");
    if (!target) {
      return;
    }
    const policyAction = `${target.getAttribute("data-policy-action") || ""}`.trim();
    const id = `${target.getAttribute("data-transition-id") || ""}`.trim();
    const action = `${target.getAttribute("data-transition-kind") || ""}`.trim();
    if (!policyAction || !id || !action) {
      if (policyAction !== "revert" || !id) {
        return;
      }
    }
    const note = window.prompt(`Optionele notitie voor ${policyAction} ${id}:`, "") || null;
    if (policyAction === "approve") {
      await runAction("/api/policies/approve", { id, action, note });
      return;
    }
    if (policyAction === "reject") {
      await runAction("/api/policies/reject", { id, action, note });
      return;
    }
    if (policyAction === "revert") {
      await runAction("/api/policies/revert", { id, note });
    }
  });

  bindPanelToggle("signals", elements.signalsSection, elements.signalsToggleBtn);
  bindPanelToggle("positions", elements.positionsSection, elements.positionsToggleBtn);
  bindPanelToggle("learning", elements.learningSection, elements.learningToggleBtn);
  bindPanelToggle("missedTrades", elements.missedTradesSection, elements.missedTradesToggleBtn);
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
  syncPanel(elements.learningSection, elements.learningToggleBtn, panelState.learning);
  syncPanel(elements.missedTradesSection, elements.missedTradesToggleBtn, panelState.missedTrades);
  syncPanel(elements.riskSection, elements.riskToggleBtn, panelState.risk);
  syncPanel(elements.historySection, elements.historyToggleBtn, panelState.history);
}

async function init() {
  bindEvents();
  await refreshSnapshot();
  pollTimer = window.setInterval(refreshSnapshot, POLL_MS);
}

init();

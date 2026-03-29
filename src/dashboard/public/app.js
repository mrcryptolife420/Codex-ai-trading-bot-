const POLL_MS = 5000;
const SIGNAL_LIMIT = 3;
const POSITION_LIMIT = 4;
const TRADE_LIMIT = 6;
const STORAGE_KEYS = {
  showAllDecisions: "dashboard.showAllDecisions"
};

function createElements(doc) {
  const query = (selector) => doc?.querySelector?.(selector) || null;
  return {
    modeBadge: query("#modeBadge"),
    runStateBadge: query("#runStateBadge"),
    healthBadge: query("#healthBadge"),
    refreshBadge: query("#refreshBadge"),
    controlHint: query("#controlHint"),
    operatorSummary: query("#operatorSummary"),
    startBtn: query("#startBtn"),
    stopBtn: query("#stopBtn"),
    paperBtn: query("#paperBtn"),
    liveBtn: query("#liveBtn"),
    refreshBtn: query("#refreshBtn"),
    decisionSearch: query("#decisionSearch"),
    decisionAllowedOnly: query("#decisionAllowedOnly"),
    decisionMeta: query("#decisionMeta"),
    decisionShowMoreBtn: query("#decisionShowMoreBtn"),
    decisionsList: query("#decisionsList"),
    positionsList: query("#positionsList"),
    learningList: query("#learningList"),
    opsSummary: query("#opsSummary"),
    opsList: query("#opsList"),
    missedTradesList: query("#missedTradesList"),
    tradesBody: query("#tradesBody"),
    diagnosticsList: query("#diagnosticsList"),
    explainabilityList: query("#explainabilityList"),
    promotionList: query("#promotionList"),
    signalsSection: query("#signalsSection"),
    positionsSection: query("#positionsSection"),
    learningSection: query("#learningSection"),
    missedTradesSection: query("#missedTradesSection"),
    riskSection: query("#riskSection"),
    historySection: query("#historySection"),
    diagnosticsSection: query("#diagnosticsSection"),
    explainabilitySection: query("#explainabilitySection"),
    promotionSection: query("#promotionSection"),
    signalsToggleBtn: query("#signalsToggleBtn"),
    positionsToggleBtn: query("#positionsToggleBtn"),
    learningToggleBtn: query("#learningToggleBtn"),
    missedTradesToggleBtn: query("#missedTradesToggleBtn"),
    riskToggleBtn: query("#riskToggleBtn"),
    historyToggleBtn: query("#historyToggleBtn"),
    diagnosticsToggleBtn: query("#diagnosticsToggleBtn"),
    explainabilityToggleBtn: query("#explainabilityToggleBtn"),
    promotionToggleBtn: query("#promotionToggleBtn")
  };
}

let activeDocument = typeof document !== "undefined" ? document : null;
let elements = createElements(activeDocument);

let latestSnapshot = null;
let busy = false;
let pollTimer = null;
let requestEpoch = 0;
let searchQuery = "";
let allowedOnly = false;
let showAllDecisions = readStoredBoolean(STORAGE_KEYS.showAllDecisions, false);
let lastSnapshotReceivedAt = null;
let latestAppliedEpoch = 0;
const panelState = {
  signals: true,
  positions: true,
  learning: true,
  missedTrades: true,
  risk: true,
  history: true,
  diagnostics: true,
  explainability: true,
  promotion: true
};

function makeActionButton({ action, kind = "", id, label, tone = "" }) {
  return makeNode("button", {
    className: ["tag", tone].filter(Boolean).join(" "),
    text: label,
    attrs: {
      "data-policy-action": action,
      "data-transition-id": id,
      "data-transition-kind": kind || null
    }
  });
}

function makeDiagnosticsActionButton({ action, target = "", label, tone = "" }) {
  return makeNode("button", {
    className: ["tag", tone].filter(Boolean).join(" "),
    text: label,
    attrs: {
      "data-diagnostics-action": action,
      "data-diagnostics-target": target || null
    }
  });
}

function makePromotionActionButton({ action, symbol = "", label, tone = "" }) {
  return makeNode("button", {
    className: ["tag", tone].filter(Boolean).join(" "),
    text: label,
    attrs: {
      "data-promotion-action": action,
      "data-promotion-symbol": symbol || null
    }
  });
}

function makePromotionScopeButton({ action, scope = "", label, tone = "" }) {
  return makeNode("button", {
    className: ["tag", tone].filter(Boolean).join(" "),
    text: label,
    attrs: {
      "data-promotion-scope-action": action,
      "data-promotion-scope": scope || null
    }
  });
}

function makeProbationDecisionButton({ action, key = "", label, tone = "" }) {
  return makeNode("button", {
    className: ["tag", tone].filter(Boolean).join(" "),
    text: label,
    attrs: {
      "data-probation-decision": action,
      "data-probation-key": key || null
    }
  });
}

function makeNode(tag, { className = "", text = "", attrs = {} } = {}) {
  if (!activeDocument?.createElement) {
    throw new Error("dashboard_document_unavailable");
  }
  const node = activeDocument.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text) {
    node.textContent = text;
  }
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === "") {
      continue;
    }
    const attrName = `${name}`.trim();
    const lowerName = attrName.toLowerCase();
    const attrValue = `${value}`;
    if (!attrName || lowerName.startsWith("on") || ["innerhtml", "outerhtml", "srcdoc"].includes(lowerName)) {
      continue;
    }
    if ((lowerName === "href" || lowerName === "src") && /^\s*javascript:/i.test(attrValue)) {
      continue;
    }
    node.setAttribute(attrName, attrValue);
  }
  return node;
}

function replaceChildren(element, children = []) {
  if (!element) {
    return;
  }
  element.replaceChildren(...children.filter(Boolean));
}

function makeTag(text, className = "tag") {
  return makeNode("span", { className, text });
}

function makeTagList(items = []) {
  const list = makeNode("div", { className: "tag-list" });
  list.append(...items.filter(Boolean));
  return list;
}

function compactJoin(parts = [], separator = " · ") {
  return parts.filter(Boolean).join(separator);
}

function makeEmptyState(text, tag = "div") {
  return makeNode(tag, { className: "empty", text });
}

function makeMetricStat(label, value, tone = "") {
  const stat = makeNode("div", { className: "stat" });
  stat.append(
    makeNode("span", { className: "metric-label", text: label }),
    makeNode("strong", { className: tone, text: value })
  );
  return stat;
}

function makeCardHeader({ eyebrow = "", title = "-", pillText = "", pillClassName = "" } = {}) {
  const header = makeNode("div", { className: "card-header" });
  const left = makeNode("div");
  if (eyebrow) {
    left.append(makeNode("p", { className: "eyebrow", text: eyebrow }));
  }
  left.append(makeNode("h3", { text: title }));
  header.append(left);
  if (pillText) {
    header.append(makeNode("span", { className: pillClassName || "pill", text: pillText }));
  }
  return header;
}

function makeReasonRows(rows = []) {
  const container = makeNode("div", { className: "decision-reasons" });
  container.append(...rows.map(([label, text]) => {
    const row = makeNode("div", { className: "reason-row" });
    row.append(
      makeNode("strong", { text: label }),
      makeNode("span", { className: "reason-copy", text })
    );
    return row;
  }));
  return container;
}

function makeSectionHead(label, foot) {
  const head = makeNode("div", { className: "learning-section-head" });
  head.append(
    makeNode("span", { className: "metric-label", text: label }),
    makeNode("span", { className: "metric-foot", text: foot })
  );
  return head;
}

function makeKeyValueCard({ className = "risk-card", label, value, foot, valueClassName = "" } = {}) {
  const card = makeNode("article", { className });
  card.append(
    makeNode("span", { className: "metric-label", text: label }),
    makeNode("strong", { className: ["metric-value", valueClassName].filter(Boolean).join(" "), text: value }),
    makeNode("span", { className: "metric-foot", text: foot })
  );
  return card;
}

function makeEventRow({ title, detail, tone = "" } = {}) {
  const row = makeNode("article", { className: ["event-row", tone].filter(Boolean).join(" ") });
  row.append(
    makeNode("strong", { text: title }),
    makeNode("span", { className: "meta", text: truncate(detail, 120) })
  );
  return row;
}

function showDashboardRenderIssue(section, error) {
  const message = `${section}: ${error?.message || "Onbekende renderfout"}`;
  console.error("Dashboard render failed", { section, error: error?.message || error });
  if (elements.controlHint) {
    elements.controlHint.textContent = `Render issue: ${truncate(message, 160)}`;
  }
  if (elements.operatorSummary) {
    const staleIssues = elements.operatorSummary.querySelectorAll?.("[data-render-issue='1']") || [];
    staleIssues.forEach((item) => item.remove());
    const pill = makeNode("span", { className: "hero-pill negative" });
    pill.setAttribute("data-render-issue", "1");
    pill.append(
      makeNode("strong", { text: "Dashboard render" }),
      makeNode("span", { text: truncate(message, 140) })
    );
    elements.operatorSummary.append(pill);
  }
}

function safeRenderSection(section, renderFn) {
  try {
    renderFn();
    return null;
  } catch (error) {
    showDashboardRenderIssue(section, error);
    return {
      section,
      message: error?.message || "Onbekende renderfout"
    };
  }
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

function formatNumber(value, digits = 2) {
  return number(value, digits);
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

function externalFeedHeadline(snapshot) {
  const external = snapshot?.dashboard?.sourceReliability?.externalFeeds || {};
  if ((external.providerCount || 0) === 0) {
    return {
      value: "Geen",
      foot: "Geen externe feed issues",
      tone: "neutral"
    };
  }
  const lead = (external.providers || [])[0] || null;
  if ((external.coolingDownCount || 0) > 0) {
    return {
      value: `${external.coolingDownCount} cooldown`,
      foot: lead ? `${titleize(lead.group)} · ${titleize(lead.provider)}` : "Feed cooldown actief",
      tone: "negative"
    };
  }
  if ((external.degradedCount || 0) > 0) {
    return {
      value: `${external.degradedCount} degraded`,
      foot: lead ? `${titleize(lead.group)} · ${titleize(lead.provider)}` : "Feed quality verlaagd",
      tone: "neutral"
    };
  }
  return {
    value: titleize("healthy"),
    foot: `Avg ${formatPct(external.averageScore || 0, 0)}`,
    tone: "positive"
  };
}

function buildMissedTradeMetricTags(analysis = {}, { compact = false } = {}) {
  const suffix = compact ? " cases" : " vergelijkbare cases";
  return [
    analysis.badVetoRate != null ? makeTag(`Te streng ${formatPct(analysis.badVetoRate, 0)}`, "tag negative") : null,
    analysis.goodVetoRate != null
      ? makeTag(`Terecht ${formatPct(analysis.goodVetoRate, 0)}`, `tag ${analysis.goodVetoRate >= (analysis.badVetoRate || 0) ? "positive" : ""}`.trim())
      : null,
    analysis.averageMissedMovePct != null ? makeTag(`Gemiste move ${formatPct(analysis.averageMissedMovePct, 1)}`) : null,
    analysis.recentMatches ? makeTag(`${analysis.recentMatches}${suffix}`) : null
  ].filter(Boolean);
}

function makeLearningEmptyCard(label, note) {
  const article = makeNode("article", { className: "learning-review-card" });
  article.append(
    makeNode("span", { className: "metric-label", text: label }),
    makeNode("p", { className: "learning-note", text: note })
  );
  return article;
}

function resolveLearningTopScope(paperLearning = {}) {
  return (
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
      : null)
  );
}

function buildLearningDigest(snapshot) {
  const paperLearning = snapshot?.dashboard?.ops?.paperLearning || {};
  const learningInsights = snapshot?.dashboard?.ops?.learningInsights || {};
  const missedTradeDigest = learningInsights.missedTrades || {};
  const exitDigest = learningInsights.exits || {};
  const adaptation = snapshot?.dashboard?.ai?.adaptation || snapshot?.dashboard?.ops?.adaptation || {};
  const strategyAllocation = adaptation.strategyAllocation || snapshot?.dashboard?.ai?.strategyAllocation || {};
  const offlineTrainer = snapshot?.dashboard?.offlineTrainer || {};
  const retrainPlan = offlineTrainer.retrainExecutionPlan || {};
  const replayPlan = snapshot?.dashboard?.ops?.replayChaos?.deterministicReplayPlan || {};
  const inputHealth = paperLearning.inputHealth || {};
  const topScope = resolveLearningTopScope(paperLearning);
  const topBlocker = paperLearning.topBlockers?.[0];
  const topOutcome = paperLearning.recentOutcomes?.[0];
  const latestTrade = latestTradeSummary(snapshot);
  const learningStatus = titleize(paperLearning.readinessStatus || paperLearning.status || "warmup");
  const learningScore = formatPct(paperLearning.readinessScore || 0, 1);
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
    ? inputHealth.status === "stalled" && inputHealth.latestClosedLearningAt && topScope.source !== "probe_trades"
      ? `${titleize(topScope.id)} is nu de versere leerscope, omdat probe/live closes stilvallen sinds ${formatDate(inputHealth.latestClosedLearningAt)}.`
      : topScope.source === "shadow_learning"
        ? `${titleize(topScope.id)} springt nu vooral uit blocked/shadow-learning; bevestig dit nog met extra probes.`
        : `${titleize(topScope.id)} is nu de sterkste leerscope.`
    : "De bot zit nog in warmup en heeft nog geen sterke paperscope.";
  const learningInputTag = inputHealth.status === "stalled"
    ? makeTag(
        inputHealth.latestClosedLearningAt
          ? `Leerinput stil sinds ${formatDate(inputHealth.latestClosedLearningAt)}`
          : "Leerinput stil",
        "tag negative"
      )
    : makeTag("Leerinput vers", "tag positive");
  const learningInputNote = inputHealth.note || (
    inputHealth.status === "stalled"
      ? "Er zijn geen recente probe/live closes; de kaart valt terug op andere learning-evidence."
      : topScope?.id
        ? `${titleize(topScope.id)} blijft de sterkste leerscope.`
        : "De leerlus bouwt nog basisdata op."
  );
  const nextStep =
    retrainPlan.operatorAction ||
    replayPlan.operatorGoal ||
    paperLearning.probation?.note ||
    paperLearning.notes?.[0] ||
    "Nog geen directe leeractie nodig.";
  const sourceLabel = topScope?.source === "shadow_learning"
    ? "via shadow-learning"
    : topScope?.source === "active_learning"
      ? "via active learning"
      : "in paper readiness";
  const focusText = inputHealth.status === "stalled" && inputHealth.latestClosedLearningAt
    ? retrainPlan.selectedScopes?.[0]?.id
      ? `${titleize(retrainPlan.batchType || "scoped retrain")} rond ${titleize(retrainPlan.selectedScopes[0].id)}, maar probe/live leerinput staat stil sinds ${formatDate(inputHealth.latestClosedLearningAt)}.`
      : `Probe/live leerinput staat stil sinds ${formatDate(inputHealth.latestClosedLearningAt)}; de bot leunt nu op ${titleize(topScope?.source || "shadow_learning")}.`
    : retrainPlan.selectedScopes?.[0]?.id
      ? `${titleize(retrainPlan.batchType || "scoped retrain")} rond ${titleize(retrainPlan.selectedScopes[0].id)}.`
      : topScope?.id
        ? `Leert nu vooral op ${titleize(topScope.id)} ${sourceLabel}.`
        : replayPlan.nextPackType
          ? `Replay-focus ligt op ${titleize(replayPlan.nextPackType)}.`
          : topBlocker?.id || topOutcome?.id
            ? `Leert nog vooral uit ${titleize(topBlocker?.id || topOutcome?.id || "recente paper cases")}.`
            : "De bot bouwt nog basisleerdata op in paper mode.";
  const adaptationInputs = (adaptation.adaptiveInputs?.items || [])
    .filter((item) => item.enabled)
    .slice(0, 3)
    .map((item) => titleize(item.id))
    .join(", ");
  const allocationLead =
    strategyAllocation.topStrategies?.[0] ||
    strategyAllocation.topFamilies?.[0] ||
    null;
  const adaptationFoot = compactJoin([
    `${adaptation.learningFrames || 0} learning frames`,
    `${adaptation.calibrationObservations || 0} calibration obs`,
    adaptation.offlineReadinessScore != null ? `${formatPct(adaptation.offlineReadinessScore || 0, 1)} offline ready` : null,
    strategyAllocation.tradeCount != null ? `${strategyAllocation.tradeCount || 0} allocator closes` : null
  ]);
  const adaptationNote = adaptation.status === "stalled"
    ? adaptation.notes?.[1] || adaptation.notes?.[0] || "De bot ziet nu te weinig verse closed trades om de online leerlus actief te houden."
    : adaptation.status === "warmup"
      ? adaptation.notes?.[1] || adaptation.notes?.[0] || "De online leerlus warmt nog op totdat de eerste leerbare closed trades binnenkomen."
      : [
          adaptation.notes?.[0],
          adaptation.lastLearningTradeAt ? `Laatste leertrade: ${formatDate(adaptation.lastLearningTradeAt)}.` : null,
          adaptationInputs ? `Actieve adaptieve inputs: ${adaptationInputs}.` : null,
          allocationLead?.id
            ? `Allocator bias nu naar ${titleize(allocationLead.id)}${allocationLead.context ? ` binnen ${titleize(allocationLead.context)}` : ""}.`
            : null
        ].filter(Boolean).join(" ");

  return {
    paperLearning,
    learningInsights,
    missedTradeDigest,
    exitDigest,
    adaptation,
    strategyAllocation,
    offlineTrainer,
    retrainPlan,
    replayPlan,
    inputHealth,
    topScope,
    topBlocker,
    topOutcome,
    latestTrade,
    learningStatus,
    learningScore,
    laneText,
    topBlockerText,
    reviewQueue,
    benchmarkLead,
    policyCandidates,
    activeOverrides,
    operatorHistory,
    operatorGuardrails,
    reviewText,
    blockerMeaning,
    scopeMeaning,
    learningInputTag,
    learningInputNote,
    nextStep,
    focusText,
    adaptationFoot,
    adaptationNote
  };
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

function compactOperatorText(value, fallback = "-") {
  const text = humanizeReason(value, fallback);
  return truncate(text, 54);
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
  if (alert?.id || alert?.type) {
    return alert.id || alert.type;
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
  const effectiveBudget = overview.effectiveBudget || {};
  const focusText = leadDecision?.allow
    ? compactOperatorText(leadDecision?.summary || actionText(leadDecision), "Geen directe focus")
    : compactOperatorText(leadDecision?.operatorAction || topReason, "Geen directe focus");
  const recoveryText = compactOperatorText(
    leadDecision?.autoRecovery || (unresolvedCritical.length ? "Na ack of resolve van kritieke alerts" : "Geen automatische recovery actief"),
    "Geen automatische recovery actief"
  );

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
      label: "Effectief budget",
      value: formatMoney(effectiveBudget.deployableBudget || 0),
      tone: (effectiveBudget.deployableBudget || 0) > 0 ? "positive" : "neutral"
    },
    {
      label: "Focus",
      value: focusText,
      tone: leadDecision?.allow ? "neutral" : topReason ? "negative" : "positive"
    },
    leadDecision?.symbol
      ? {
          label: "Setup",
          value: compactJoin([
            leadDecision.symbol,
            leadDecision.allow ? "tradebaar" : null
          ], " · "),
          tone: leadDecision.allow ? "positive" : "neutral"
        }
      : null,
    recoveryText && recoveryText !== focusText
      ? {
          label: "Herstel",
          value: recoveryText,
          tone: leadDecision?.autoRecovery ? "positive" : "neutral"
        }
      : null,
    freezeEntries
      ? {
          label: "Guardrail",
          value: "Entries bevroren tot reconcile klaar is.",
          tone: "negative"
        }
      : probeOnly
        ? {
            label: "Guardrail",
            value: "Alleen probes zijn nu toegestaan.",
            tone: "neutral"
          }
        : null
  ].filter(Boolean);

  return {
    subline,
    pills
  };
}

function renderBadges(snapshot) {
  const mode = snapshot?.manager?.currentMode || snapshot?.dashboard?.overview?.mode || "paper";
  const runState = snapshot?.manager?.runState || "stopped";
  const readiness = snapshot?.manager?.readiness?.status || snapshot?.dashboard?.ops?.readiness?.status || "unknown";

  elements.modeBadge.className = `status-chip ${statusTone(mode)}`;
  elements.runStateBadge.className = `status-chip ${statusTone(runState)}`;
  elements.healthBadge.className = `status-chip ${statusTone(readiness)}`;

  elements.modeBadge.textContent = titleize(mode);
  elements.runStateBadge.textContent = titleize(runState);
  elements.healthBadge.textContent = titleize(readiness);
  const updatedAt = snapshot?.dashboard?.ops?.lastUpdatedAt || snapshot?.dashboard?.overview?.lastCycleAt || snapshot?.manager?.lastStartAt || null;
  const receivedLabel = lastSnapshotReceivedAt ? `Refresh ${formatDate(lastSnapshotReceivedAt)}` : "Refresh -";
  const dataLabel = updatedAt ? `data ${formatDate(updatedAt)}` : "data -";
  const pingLabel = `${receivedLabel} · ${dataLabel}`;
  elements.refreshBadge.textContent = pingLabel;
  elements.refreshBadge.className = `status-chip muted refresh-chip ${statusTone(runState)}`;
}

function renderHero(snapshot) {
  const summary = buildHeroSummary(snapshot);
  elements.controlHint.textContent = summary.subline;
  replaceChildren(elements.operatorSummary, summary.pills.map((item) => {
    const pill = makeNode("span", { className: ["hero-pill", item.tone].filter(Boolean).join(" ") });
    pill.append(
      makeNode("strong", { text: item.label }),
      makeNode("span", { text: truncate(item.value, 72) })
    );
    return pill;
  }));
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

function makeMissedTradeAnalysisNode(decision) {
  const analysis = decision.missedTradeAnalysis;
  if (decision.allow || !analysis?.available) {
    return null;
  }
  const details = makeNode("details", { className: "analysis-box" });
  details.append(makeNode("summary", { text: "Gemiste trade analyse" }));
  details.append(makeNode("p", { text: analysis.summary || "Nog geen specifieke analyse beschikbaar." }));
  const metrics = buildMissedTradeMetricTags(analysis);
  if (metrics.length) {
    details.append(makeTagList(metrics));
  }
  details.append(makeNode("p", {
    className: "analysis-note",
    text: analysis.recommendation || "Gebruik dit als extra context bij geblokkeerde setups."
  }));
  return details;
}

function buildSignalCard(decision) {
  const article = makeNode("article", { className: "signal-card" });
  const summary = makeNode("div", { className: "card-summary" });
  const header = makeNode("div", { className: "card-header" });
  const left = makeNode("div");
  left.append(
    makeNode("p", { className: "eyebrow", text: formatDecisionType(decision) }),
    makeNode("h3", { text: decision.symbol || "-" }),
    makeNode("p", {
      className: `signal-status ${decision.allow ? "positive" : "negative"}`,
      text: signalStatusText(decision)
    })
  );
  header.append(
    left,
    makeNode("span", {
      className: `pill ${decision.allow ? "positive" : "negative"}`,
      text: decision.allow ? "Tradebaar" : "Geblokkeerd"
    })
  );

  const quickGrid = makeNode("div", { className: "quick-grid" });
  quickGrid.append(
    makeMetricStat("Kans", formatPct(decision.probability, 0)),
    makeMetricStat("Confidence", formatPct(decision.confidenceBreakdown?.overallConfidence, 0)),
    makeMetricStat("Risk", titleize(decision.riskPolicy?.capitalPolicy?.status || decision.qualityQuorum?.status || "normal"))
  );

  const overview = makeNode("div", { className: "signal-overview" });
  const tags = [
    makeTag(titleize(decision.marketState?.phase || decision.regime || "setup")),
    decision.strategy?.strategyLabel ? makeTag(decision.strategy.strategyLabel) : null,
    decision.executionStyle ? makeTag(titleize(decision.executionStyle)) : null,
    decision.dataQuality?.status ? makeTag(titleize(decision.dataQuality.status), `tag ${statusTone(decision.dataQuality.status)}`.trim()) : null
  ].filter(Boolean);
  overview.append(...tags);

  const reasons = makeReasonRows([
    ["Setup", whyTradeable(decision) || formatDecisionType(decision)],
    [decision.allow ? "Waarom nu" : "Waarom niet", signalPrimaryReason(decision)],
    ["Actie", signalSupportText(decision)]
  ]);

  summary.append(
    header,
    makeNode("p", { className: "card-copy", text: truncate(signalPrimaryReason(decision), 190) }),
    quickGrid,
    overview,
    reasons,
    makeNode("p", { className: "signal-note", text: truncate(signalSummary(decision), 220) })
  );
  const analysisNode = makeMissedTradeAnalysisNode(decision);
  if (analysisNode) {
    summary.append(analysisNode);
  }
  article.append(summary);
  return article;
}

function renderSignals(snapshot) {
  const filtered = filterDecisions(snapshot);
  const total = snapshot?.dashboard?.topDecisions?.length || 0;
  const visible = showAllDecisions ? filtered : filtered.slice(0, SIGNAL_LIMIT);
  elements.decisionMeta.textContent = `${visible.length} van ${total} zichtbaar`;
  elements.decisionShowMoreBtn.textContent = showAllDecisions ? "Toon minder" : "Toon alles";
  elements.decisionShowMoreBtn.hidden = filtered.length <= SIGNAL_LIMIT;
  if (!visible.length) {
    replaceChildren(elements.decisionsList, [makeEmptyState("Geen signalen passen bij de huidige filter.")]);
    return;
  }
  replaceChildren(elements.decisionsList, visible.map((decision) => buildSignalCard(decision)));
}

function renderPositions(snapshot) {
  const positions = (snapshot?.dashboard?.positions || []).slice(0, POSITION_LIMIT);
  if (!positions.length) {
    replaceChildren(elements.positionsList, [makeEmptyState("Er zijn nu geen open posities.")]);
    return;
  }
  replaceChildren(elements.positionsList, positions.map((position) => {
    const article = makeNode("article", { className: "position-card" });
    const summary = makeNode("div", { className: "card-summary" });
    const header = makeCardHeader({
      eyebrow: position.lifecycle?.state || "Positie",
      title: position.symbol || "-",
      pillText: formatMoney(position.unrealizedPnl),
      pillClassName: ["pill", toneClass(position.unrealizedPnl)].filter(Boolean).join(" ")
    });
    const subgrid = makeNode("div", { className: "subgrid" });
    const stats = [
      ["Entry", number(position.entryPrice, 4), ""],
      ["Nu", number(position.currentPrice, 4), ""],
      ["Rendement", formatSignedPct(position.unrealizedPnlPct), toneClass(position.unrealizedPnlPct)]
    ];
    subgrid.append(...stats.map(([label, value, tone]) => makeMetricStat(label, value, tone)));
    const tags = makeNode("div", { className: "tag-list" });
    const tagNodes = [
      position.regimeAtEntry ? makeTag(titleize(position.regimeAtEntry)) : null,
      position.strategyAtEntry ? makeTag(position.strategyAtEntry) : null,
      position.lifecycle?.manualReviewRequired ? makeTag("Manual review", "tag negative") : null,
      position.lifecycle?.reconcileRequired ? makeTag("Reconcile", "tag negative") : null
    ].filter(Boolean);
    tags.append(...tagNodes);
    summary.append(header, subgrid, tags);
    article.append(summary);
    return article;
  }));
}

function renderMissedTrades(snapshot) {
  const missedTradeDigest = snapshot?.dashboard?.ops?.learningInsights?.missedTrades || {};
  const blocked = (snapshot?.dashboard?.blockedSetups || [])
    .filter((item) => item?.missedTradeAnalysis?.available)
    .slice(0, 4);
  if (!blocked.length) {
    replaceChildren(elements.missedTradesList, [makeEmptyState(
      missedTradeDigest.note || "Nog geen duidelijke gemiste-trade analyse beschikbaar voor recente blokkades."
    )]);
    return;
  }
  replaceChildren(elements.missedTradesList, blocked.map((decision) => {
    const analysis = decision.missedTradeAnalysis || {};
    const blockerLabel = analysis.blockerId ? titleize(analysis.blockerId) : "Gemengde blokkade";
    const article = makeNode("article", { className: "signal-card missed-card" });
    const summary = makeNode("div", { className: "card-summary" });
    const header = makeCardHeader({
      eyebrow: "Gemiste setup",
      title: decision.symbol || "-",
      pillText: blockerLabel,
      pillClassName: "pill negative"
    });
    const rows = [
      ["Setup", formatDecisionType(decision)],
      ["Hoe wel", hypotheticalTradeText(decision)],
      ["Les", analysis.recommendation || "Gebruik shadow/probe en vergelijkbare counterfactuals als leidraad."]
    ];
    const reasons = makeReasonRows(rows);
    const tags = makeTagList(buildMissedTradeMetricTags(analysis, { compact: true }));
    summary.append(
      header,
      makeNode("p", { className: "card-copy", text: analysis.summary || "Nog geen specifieke gemiste-trade analyse beschikbaar." }),
      reasons,
      tags
    );
    article.append(summary);
    return article;
  }));
}

function learningFocusText(snapshot) {
  return buildLearningDigest(snapshot).focusText;
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

function makeLearningReviewCard({
  title,
  outcome,
  metrics = [],
  note,
  foot
}) {
  const article = makeNode("article", { className: "learning-review-card" });
  if (title) {
    const head = makeNode("div", { className: "learning-review-head" });
    head.append(
      makeNode("strong", { text: title }),
      makeNode("span", { className: `pill ${statusTone(outcome)}`, text: titleize(outcome || "observe") })
    );
    article.append(head);
  }
  if (metrics.length) {
    article.append(makeTagList(metrics.map((item) => makeTag(item.text, item.className || "tag"))));
  }
  article.append(makeNode("p", { className: "learning-note", text: note }));
  if (foot) {
    article.append(makeNode("span", { className: "metric-foot", text: foot }));
  }
  return article;
}

function renderProbeReviewNodes(reviews = []) {
  if (!reviews.length) {
    return [makeLearningEmptyCard("Probe review", "Nog geen recente probe-trades om te tonen.")];
  }
  return reviews.map((review) => makeLearningReviewCard({
    title: review.symbol || "Probe",
    outcome: review.outcome || "observe",
    metrics: [
      { text: formatMoney(review.pnlQuote || 0), className: `tag ${toneClass(review.pnlQuote)}`.trim() },
      { text: formatSignedPct(review.netPnlPct || 0, 1), className: `tag ${toneClass(review.netPnlPct)}`.trim() },
      { text: titleize(review.reason || review.learningLane || "probe"), className: "tag" }
    ],
    note: review.lesson || "Deze probe voedt de paper-leerlus.",
    foot: `Gesloten ${formatDate(review.closedAt)}`
  }));
}

function renderShadowReviewNodes(reviews = []) {
  if (!reviews.length) {
    return [makeLearningEmptyCard("Shadow review", "Nog geen recente shadow-cases om te tonen.")];
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
    return makeLearningReviewCard({
      title: review.symbol || "Shadow",
      outcome: review.outcome || "observe",
      metrics: [
        { text: moveText, className: "tag" },
        { text: titleize(review.blocker || "geen blocker"), className: "tag" }
      ],
      note: review.lesson || "Deze shadow-case blijft bruikbaar als vergelijkingsmateriaal.",
      foot: branchText
    });
  });
}

function makeLearningDetailCard(label, title, foot, note) {
  const article = makeNode("article", { className: "learning-detail" });
  article.append(
    makeNode("span", { className: "metric-label", text: label }),
    makeNode("strong", { text: title }),
    makeNode("span", { className: "metric-foot", text: foot }),
    makeNode("p", { className: "learning-note", text: note })
  );
  return article;
}

function makeLearningListItem(label, paragraphs = [], tagLists = []) {
  const article = makeNode("article", { className: "learning-list-item" });
  article.append(makeNode("span", { className: "metric-label", text: label }));
  for (const list of tagLists.filter(Boolean)) {
    article.append(list);
  }
  for (const paragraph of paragraphs.filter(Boolean)) {
    article.append(makeNode("p", { text: paragraph }));
  }
  return article;
}

function renderLearning(snapshot) {
  if (!elements.learningList) {
    return;
  }

  const {
    paperLearning,
    missedTradeDigest,
    exitDigest,
    adaptation,
    retrainPlan,
    topScope,
    topBlocker,
    topOutcome,
    learningStatus,
    learningScore,
    laneText,
    topBlockerText,
    reviewQueue,
    benchmarkLead,
    policyCandidates,
    activeOverrides,
    operatorHistory,
    operatorGuardrails,
    reviewText,
    blockerMeaning,
    scopeMeaning,
    learningInputTag,
    learningInputNote,
    nextStep,
    focusText,
    latestTrade,
    adaptationFoot,
    adaptationNote
  } = buildLearningDigest(snapshot);
  const learningBoard = makeNode("article", { className: "learning-board" });
  const hero = makeNode("section", { className: "learning-hero" });
  const heroTitle = makeNode("div", { className: "learning-title" });
  const heroLeft = makeNode("div");
  heroLeft.append(
    makeNode("p", { className: "eyebrow", text: "Live learning" }),
    makeNode("h3", { text: `${learningStatus} · ${learningScore}` })
  );
  heroTitle.append(
    heroLeft,
    makeNode("span", {
      className: `pill ${statusTone(paperLearning.readinessStatus || paperLearning.status)}`,
      text: learningStatus
    })
  );
  const stripGrid = makeTagList([
    makeTag(laneText),
    makeTag(`Snapshot: ${formatDate(paperLearning.generatedAt)}`),
    learningInputTag,
    makeTag(`Top blocker: ${topBlockerText}`)
  ]);
  stripGrid.className = "learning-strip-grid";
  hero.append(
    heroTitle,
    makeNode("p", { className: "learning-copy", text: focusText }),
    stripGrid
  );

  const summaryGrid = makeNode("section", { className: "learning-summary-grid" });
  summaryGrid.append(
    makeLearningDetailCard(
      "Focus",
      topScope?.id ? titleize(topScope.id) : "Warmup dataset",
      topScope?.status
        ? `${titleize(topScope.status)} · ${formatPct(topScope.readinessScore || topScope.score || 0, 1)} · ${titleize(topScope.source || "probe_trades")}`
        : "Nog geen sterke scope zichtbaar.",
      [scopeMeaning, learningInputNote].filter(Boolean).join(" ")
    ),
    makeLearningDetailCard("Laatste trade", latestTrade.title, latestTrade.detail, latestTrade.lesson),
    makeLearningDetailCard(
      "Model adaptie",
      titleize(adaptation.status || "warmup"),
      adaptationFoot || "Nog geen online adaptie zichtbaar.",
      adaptationNote
    ),
    makeLearningDetailCard(
      "Blockers en misses",
      titleize(missedTradeDigest.topBlocker?.id || topOutcome?.id || topBlocker?.id || "warmup"),
      missedTradeDigest.totalCounterfactuals
        ? `${missedTradeDigest.totalCounterfactuals} counterfactuals · ${missedTradeDigest.missedWinners || 0} gemiste winnaars`
        : topOutcome?.count
          ? `${topOutcome.count} recente cases van dit type.`
          : topBlocker?.count
            ? `${topBlocker.count} blokkades sturen nu de leerlus.`
            : "Nog geen duidelijke blockertrend zichtbaar.",
      compactJoin([
        blockerMeaning,
        missedTradeDigest.note
      ], " ")
    ),
    makeLearningDetailCard(
      "Exit AI",
      exitDigest.leadSignal?.symbol
        ? `${titleize(exitDigest.leadSignal.action || "hold")} · ${exitDigest.leadSignal.symbol}`
        : titleize(exitDigest.learning?.status || exitDigest.status || "warmup"),
      exitDigest.openPositionCount
        ? `${exitDigest.exitCount || 0} exit · ${exitDigest.trimCount || 0} trim · ${exitDigest.trailCount || 0} trail · conf ${formatPct(exitDigest.averageConfidence || 0, 1)}`
        : exitDigest.learning?.topReason
          ? `Top patroon: ${titleize(exitDigest.learning.topReason)}`
          : "Nog geen open exit-focus zichtbaar.",
      exitDigest.note || "Exit intelligence warmt nog op."
    ),
    makeLearningDetailCard(
      "Volgende stap",
      titleize(retrainPlan.batchType || replayPlan.nextPackType || "observe"),
      nextStep,
      reviewText
    )
  );

  const callouts = makeNode("section", { className: "learning-callouts" });
  const reviewTags = reviewQueue.length
    ? reviewQueue.map((item) => makeTag(`${titleize(item.type)} · ${item.id}`, item.priority === "high" ? "tag negative" : "tag"))
    : [makeTag("Geen review queue")];
  const policyTags = policyCandidates.length
    ? policyCandidates.map((item) => makeTag(
      `${titleize(item.action)} · ${titleize(item.id)}`,
      item.action.includes("retire") ? "tag negative" : item.action.includes("promote") ? "tag positive" : "tag"
    ))
    : [makeTag("Geen policy-wijziging klaar")];
  const overrideTags = activeOverrides.length
    ? activeOverrides.map((item) => makeTag(`${titleize(item.id)} · ${titleize(item.status || "override")}`, "tag positive"))
    : [makeTag("Geen actieve override")];

  callouts.append(
    makeLearningListItem("Nu aan het testen", [
      paperLearning.probation?.note ||
        (paperLearning.thresholdSandbox?.status
          ? `${titleize(paperLearning.probation?.status || "sandbox")} actief: de bot test kleine aanpassingen zonder meteen het hoofdbeleid te wijzigen.`
          : "De bot vergelijkt recente trades, blokkades en shadow-cases om thresholds en filters te verbeteren."),
      benchmarkLead?.id
        ? `${titleize(benchmarkLead.id)} presteert nu het sterkst als challenger of benchmark.`
        : paperLearning.coaching?.whatWorked || "Nog geen sterke benchmark of coachingregel zichtbaar."
    ], [makeTagList(reviewTags)]),
    makeLearningListItem(
      "Misses en exits",
      [
        missedTradeDigest.tuning?.blocker
          ? `Counterfactual tuning kijkt nu vooral naar ${titleize(missedTradeDigest.tuning.blocker)} via ${titleize(missedTradeDigest.tuning.action || "observe")}.`
          : missedTradeDigest.note || "Counterfactual learning heeft nog geen dominante tuningrichting.",
        exitDigest.leadSignal?.reason
          ? `${exitDigest.leadSignal.symbol} wordt nu vooral gestuurd door ${titleize(exitDigest.leadSignal.reason)}.`
          : exitDigest.learning?.topReason
            ? `Offline exit learning ziet nu vooral ${titleize(exitDigest.learning.topReason)} terugkomen.`
            : exitDigest.note || "Exit intelligence heeft nog geen duidelijke focus."
      ],
      [makeTagList([
        makeTag(`${exitDigest.exitCount || 0} exit`),
        makeTag(`${exitDigest.trimCount || 0} trim`),
        makeTag(`${exitDigest.trailCount || 0} trail`),
        makeTag(`${missedTradeDigest.missedWinners || 0} gemist`)
      ])]
    ),
    makeLearningListItem(
      "Policy en operatoracties",
      [paperLearning.policyTransitions?.note || paperLearning.operatorActions?.note || "Nog geen policy-wijziging of override die operator-ingreep vraagt."],
      [
        makeTagList(policyTags),
        makeTagList(overrideTags),
        operatorGuardrails.length ? makeTagList(operatorGuardrails.map((item) => makeTag(titleize(item), "tag negative"))) : null,
        policyCandidates.length
          ? makeTagList(policyCandidates.map((item) => item.approved
            ? makeTag(`Approved · ${titleize(item.id)}`, "tag positive")
            : [
                makeActionButton({ action: "approve", kind: item.action, id: item.id, label: `Approve ${titleize(item.id)}` }),
                makeActionButton({ action: "reject", kind: item.action, id: item.id, label: "Reject", tone: "negative" })
              ]).flat())
          : null,
        activeOverrides.length
          ? makeTagList(activeOverrides.map((item) => makeActionButton({
            action: "revert",
            id: item.id,
            label: `Revert ${titleize(item.id)}`,
            tone: "negative"
          })))
          : null
      ]
    ),
    makeLearningListItem(
      "Laatste operatorlog",
      [operatorHistory[0]?.note || paperLearning.coaching?.nextReview || "Goedgekeurde, afgewezen en teruggedraaide policy-acties verschijnen hier."],
      [
        makeTagList(operatorHistory.length
          ? operatorHistory.map((item) => makeTag(`${titleize(item.status || item.action || "actie")} · ${titleize(item.id)} · ${formatDate(item.at)}`))
          : [makeTag("Nog geen operator history")])
      ]
    )
  );

  const reviewGrid = makeNode("section", { className: "learning-review-grid" });
  const probeColumn = makeNode("article", { className: "learning-review-column" });
  probeColumn.append(
    makeSectionHead("Probe trades", "Hoe echte paper-probes liepen"),
    ...renderProbeReviewNodes(paperLearning.recentProbeReviews || [])
  );
  const shadowColumn = makeNode("article", { className: "learning-review-column" });
  shadowColumn.append(
    makeSectionHead("Shadow cases", "Wat geblokkeerde setups waarschijnlijk deden"),
    ...renderShadowReviewNodes(paperLearning.recentShadowReviews || [])
  );
  reviewGrid.append(probeColumn, shadowColumn);

  learningBoard.append(hero, summaryGrid, callouts, reviewGrid);
  replaceChildren(elements.learningList, [learningBoard]);
}

function buildOpsCards(snapshot) {
  const readiness = snapshot?.dashboard?.ops?.readiness || {};
  const alerts = unresolvedAlerts(snapshot);
  const exchangeTruth = snapshot?.dashboard?.safety?.exchangeTruth || {};
  const capitalPolicy = snapshot?.dashboard?.ops?.capitalPolicy || {};
  const effectiveBudget = capitalPolicy.effectiveBudget || snapshot?.dashboard?.overview?.effectiveBudget || {};
  const sizingGuide = snapshot?.dashboard?.ops?.sizingGuide || snapshot?.dashboard?.overview?.sizingGuide || {};
  const strategyAllocation = snapshot?.dashboard?.ai?.strategyAllocation || {};
  const dashboardFeeds = snapshot?.dashboard?.ops?.service?.dashboardFeeds || {};
  const primaryDashboardFeed = dashboardFeeds.degradedFeeds?.[0] || dashboardFeeds.feeds?.[0] || null;
  const openExposureReview = snapshot?.dashboard?.report?.openExposureReview || {};
  const externalFeeds = externalFeedHeadline(snapshot);
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
      label: "Exposure",
      value: `${openExposureReview.unreconciledCount || 0}`,
      foot: (openExposureReview.unreconciledExposure || 0) > 0
        ? `${formatNumber(openExposureReview.unreconciledExposure || 0, 2)} USD wacht op reconcile`
        : "Open exposure in sync",
      tone: (openExposureReview.unreconciledCount || 0) > 0 ? "negative" : "neutral"
    },
    {
      label: "Capital",
      value: titleize(capitalPolicy.status || "normal"),
      foot: exchangeTruth.freezeEntries ? "Entries bevroren" : "Entries toegestaan",
      tone: exchangeTruth.freezeEntries || capitalPolicy.status === "blocked" ? "negative" : "neutral"
    },
    {
      label: "Effectief budget",
      value: formatMoney(effectiveBudget.deployableBudget || 0),
      foot: `${formatMoney(effectiveBudget.policyBudget || 0)} policy · ${formatMoney(effectiveBudget.quoteFree || 0)} vrij · x${formatNumber(effectiveBudget.sizeMultiplier || 0, 2)}`,
      tone: (effectiveBudget.deployableBudget || 0) > 0 ? (effectiveBudget.cashCapped ? "neutral" : "positive") : "negative"
    },
    {
      label: "Per trade target",
      value: formatMoney(sizingGuide.targetQuote || 0),
      foot: `${titleize(strategyAllocation.budgetLane || "standard")} x${formatNumber(strategyAllocation.budgetMultiplier || 1, 2)} · Probe ${formatMoney(sizingGuide.paperProbeQuote || 0)} · ${sizingGuide.idealConcurrentPositions || 0} tegelijk`,
      tone: (sizingGuide.minTradeDominates || false) ? "neutral" : "positive"
    },
    {
      label: "External feeds",
      value: externalFeeds.value,
      foot: externalFeeds.foot,
      tone: externalFeeds.tone
    },
    {
      label: "Dashboard feed",
      value: titleize(dashboardFeeds.status || "idle"),
      foot: primaryDashboardFeed
        ? `${titleize(primaryDashboardFeed.id)} | ${titleize(primaryDashboardFeed.status)}`
        : "Geen feed issues zichtbaar",
      tone: ["failed", "degraded"].includes(dashboardFeeds.status || "") ? "negative" : statusTone(dashboardFeeds.status || "idle")
    }
  ];
}

function buildOpsEvents(snapshot) {
  const readiness = snapshot?.dashboard?.ops?.readiness || {};
  const paperLearning = snapshot?.dashboard?.ops?.paperLearning || {};
  const learningInsights = snapshot?.dashboard?.ops?.learningInsights || {};
  const dashboardFeeds = snapshot?.dashboard?.ops?.service?.dashboardFeeds || {};
  const offlineTrainer = snapshot?.dashboard?.offlineTrainer || {};
  const retrainPlan = offlineTrainer.retrainExecutionPlan || {};
  const replayPlan = snapshot?.dashboard?.ops?.replayChaos?.deterministicReplayPlan || {};
  const externalFeeds = snapshot?.dashboard?.sourceReliability?.externalFeeds || {};
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
    dashboardFeeds.degradedFeeds?.[0]
      ? {
          title: "Dashboard feed",
          detail: `${titleize(dashboardFeeds.degradedFeeds[0].id)} | ${titleize(dashboardFeeds.degradedFeeds[0].status)}${dashboardFeeds.degradedFeeds[0].lastError ? ` | ${dashboardFeeds.degradedFeeds[0].lastError}` : ""}`,
          tone: dashboardFeeds.degradedFeeds[0].status === "failed" ? "negative" : "neutral"
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
    learningInsights.missedTrades?.status === "priority"
      ? {
          title: "Missed-trade learning",
          detail: learningInsights.missedTrades.note || "Counterfactual learning ziet nu een te strenge blocker.",
          tone: "negative"
        }
      : null,
    ["urgent", "watch"].includes(learningInsights.exits?.status)
      ? {
          title: "Exit AI",
          detail: learningInsights.exits.note || "Exit intelligence vraagt nu extra aandacht.",
          tone: learningInsights.exits.status === "urgent" ? "negative" : "neutral"
        }
      : null,
    (externalFeeds.coolingDownCount || externalFeeds.degradedCount)
      ? {
          title: "External feeds",
          detail: externalFeeds.providers?.[0]
            ? `${titleize(externalFeeds.providers[0].group)} · ${titleize(externalFeeds.providers[0].provider)} ${externalFeeds.providers[0].coolingDown ? "cooldown" : "degraded"}`
            : `${externalFeeds.coolingDownCount || 0} cooldown · ${externalFeeds.degradedCount || 0} degraded`,
          tone: externalFeeds.coolingDownCount ? "negative" : "neutral"
        }
      : null,
    ...lifecycle,
    ...runbooks
  ].filter(Boolean).slice(0, 5);

  return items;
}

function renderOps(snapshot) {
  const cards = buildOpsCards(snapshot);
  replaceChildren(elements.opsSummary, cards.map((item) => makeKeyValueCard({
    className: "risk-card",
    label: item.label,
    value: item.value,
    foot: item.foot,
    valueClassName: item.tone || ""
  })));
  const events = buildOpsEvents(snapshot);
  if (!events.length) {
    replaceChildren(elements.opsList, [makeEmptyState("Geen operationele aandachtspunten.")]);
    return;
  }
  replaceChildren(elements.opsList, events.map((item) => makeEventRow(item)));
}

function renderTrades(snapshot) {
  const trades = (snapshot?.dashboard?.report?.recentTrades || []).slice(0, TRADE_LIMIT);
  if (!trades.length) {
    const emptyRow = makeNode("tr");
    emptyRow.append(makeNode("td", {
      className: "empty",
      text: "Nog geen recente trades beschikbaar.",
      attrs: { colspan: "6" }
    }));
    replaceChildren(elements.tradesBody, [emptyRow]);
    return;
  }
  replaceChildren(elements.tradesBody, trades.map((trade) => {
    const row = makeNode("tr");
    const reasonCell = makeNode("td", {
      attrs: {
        title: trade.reasonNote || ""
      }
    });
    reasonCell.append(makeNode("span", { text: titleize(trade.reasonLabel || trade.reason || "-") }));
    if (trade.reasonNote) {
      reasonCell.append(makeNode("span", { className: "metric-foot", text: trade.reasonNote }));
    }
    const pnlCell = makeNode("td", { className: toneClass(trade.pnlQuote) });
    pnlCell.append(makeNode("span", { text: formatMoney(trade.pnlQuote) }));
    pnlCell.append(makeNode("span", {
      className: "metric-foot",
      text: `Bruto ${formatMoney(trade.grossMovePnl)} · Fees ${formatMoney(-(trade.totalFees || 0))}`
    }));
    const fields = [
      makeNode("td", { text: trade.symbol || "-" }),
      makeNode("td", { text: number(trade.entryPrice, 4) }),
      makeNode("td", { text: number(trade.exitPrice, 4) }),
      reasonCell,
      pnlCell,
      makeNode("td", { className: toneClass(trade.netPnlPct), text: formatSignedPct(trade.netPnlPct) })
    ];
    row.append(...fields);
    return row;
  }));
}

function renderDiagnostics(snapshot) {
  const diagnostics = snapshot?.dashboard?.operatorDiagnostics || {};
  const blockers = diagnostics.dominantBlockers || [];
  const actions = diagnostics.actionItems || [];
  const quickActions = diagnostics.quickActions || [];
  const recentActions = diagnostics.recentActions || [];
  if (!elements.diagnosticsList) {
    return;
  }
  const cards = [
    makeKeyValueCard({
      className: "risk-card",
      label: "Status",
      value: titleize(diagnostics.status || "unknown"),
      foot: diagnostics.headline || "Nog geen diagnostiek beschikbaar.",
      valueClassName: statusTone(diagnostics.status || "unknown")
    }),
    makeKeyValueCard({
      className: "risk-card",
      label: "Tradebaar",
      value: `${diagnostics.counts?.tradeable || 0}`,
      foot: `${diagnostics.counts?.blocked || 0} geblokkeerd`,
      valueClassName: (diagnostics.counts?.tradeable || 0) > 0 ? "positive" : "neutral"
    }),
    makeKeyValueCard({
      className: "risk-card",
      label: "Alerts",
      value: `${diagnostics.counts?.alerts || 0}`,
      foot: diagnostics.nextOperatorFocus || "Geen directe operatorfocus.",
      valueClassName: (diagnostics.counts?.alerts || 0) > 0 ? "negative" : "neutral"
    })
  ];
  const blockerRows = blockers.length
    ? blockers.map((item) => makeEventRow({
      title: `${titleize(item.id)} · ${item.count}x`,
      detail: `${titleize(item.category)} blocker`,
      tone: item.category === "infra" || item.category === "safety" ? "negative" : "neutral"
    }))
    : [makeEmptyState("Nog geen dominante blockers zichtbaar.")];
  const actionRows = actions.length
    ? actions.map((item) => makeEventRow(item))
    : [makeEmptyState("Nog geen operatoracties voorgesteld.")];
  const quickActionNodes = quickActions.length
    ? makeTagList(quickActions.map((item) => makeDiagnosticsActionButton({
      action: item.action,
      target: item.target || "",
      label: item.label || titleize(item.action || "actie"),
      tone: item.tone || ""
    })))
    : makeTagList([makeTag("Geen snelle actie klaar")]);
  const recentActionRows = recentActions.length
    ? recentActions.map((item) => makeEventRow({
      title: titleize(item.action || "actie"),
      detail: item.detail || item.note || titleize(item.target || "operator update"),
      meta: [item.target ? `Target ${item.target}` : null, formatDate(item.at)].filter(Boolean).join(" · "),
      tone: item.status === "completed" ? "neutral" : item.status === "failed" ? "negative" : "neutral"
    }))
    : [makeEmptyState("Nog geen diagnostics acties uitgevoerd.")];
  replaceChildren(elements.diagnosticsList, [
    (() => {
      const grid = makeNode("div", { className: "risk-grid" });
      grid.append(...cards);
      return grid;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(makeSectionHead("Dominante blockers", "Geaggregeerd uit readiness, alerts en blocked setups"), ...blockerRows);
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(makeSectionHead("Operatorfocus", "Wat nu als eerste aandacht vraagt"), ...actionRows);
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(
        makeSectionHead("Snelle acties", "Veilige operatoracties direct vanuit diagnostics"),
        quickActionNodes
      );
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(
        makeSectionHead("Actiehistorie", "Laatste diagnostics acties en resets"),
        ...recentActionRows
      );
      return section;
    })()
  ]);
}

function renderExplainability(snapshot) {
  const explainability = snapshot?.dashboard?.explainability || {};
  const replayChaos = snapshot?.dashboard?.ops?.replayChaos || explainability.replayChaos || {};
  const replayPlan = replayChaos.deterministicReplayPlan || {};
  const dataRecorder = snapshot?.dashboard?.dataRecorder || {};
  const research = snapshot?.dashboard?.research || {};
  const decisions = explainability.decisions || [];
  const replays = explainability.replays || [];
  if (!elements.explainabilityList) {
    return;
  }
  const recorderQuality = dataRecorder.latestRecordQuality || {};
  const recorderFoot = [
    `${dataRecorder.replayFrames || 0} replays`,
    `${dataRecorder.snapshotManifestFrames || 0} manifests`,
    dataRecorder.lastRecordAt ? formatDate(dataRecorder.lastRecordAt) : null
  ].filter(Boolean).join(" | ");
  const researchFoot = [
    `${research.totalTrades || 0} trades`,
    research.averageSharpe != null ? `Sharpe ${number(research.averageSharpe, 2)}` : null,
    research.generatedAt ? formatDate(research.generatedAt) : null
  ].filter(Boolean).join(" | ");
  const items = [
    makeKeyValueCard({
      className: "risk-card",
      label: "Explainability",
      value: `${decisions.length} decisions`,
      foot: explainability.note || "Nog geen explainability-data.",
      valueClassName: decisions.length ? "positive" : "neutral"
    }),
    makeKeyValueCard({
      className: "risk-card",
      label: "Replay chaos",
      value: titleize(replayChaos.status || replayPlan.status || "idle"),
      foot: replayPlan.operatorGoal
        || [
          replayChaos.replayCoverage != null ? `Coverage ${formatPct(replayChaos.replayCoverage, 0)}` : null,
          replayPlan.nextPackType ? `Next ${titleize(replayPlan.nextPackType)}` : null
        ].filter(Boolean).join(" | ")
        || "Nog geen replay-prioriteit actief.",
      valueClassName: statusTone(replayChaos.status || replayPlan.status || "idle")
    }),
    makeKeyValueCard({
      className: "risk-card",
      label: "Recorder",
      value: dataRecorder.enabled === false
        ? "Uit"
        : `${dataRecorder.replayFrames || 0} replays`,
      foot: recorderFoot || "Nog geen recorder-activiteit zichtbaar.",
      valueClassName: dataRecorder.enabled === false
        ? "neutral"
        : statusTone(recorderQuality.tier || (dataRecorder.averageRecordQuality >= 0.7 ? "ready" : "watch"))
    }),
    makeKeyValueCard({
      className: "risk-card",
      label: "Research",
      value: research.bestSymbol || `${research.symbolCount || 0} symbols`,
      foot: researchFoot || "Nog geen recente research-run zichtbaar.",
      valueClassName: research.bestSymbol || research.symbolCount ? "positive" : "neutral"
    })
  ];
  const decisionCards = decisions.length
    ? decisions.map((item) => {
      const card = makeNode("article", { className: "signal-card" });
      const summary = makeNode("div", { className: "card-summary" });
      const inputRows = makeReasonRows((item.inputs || []).map((step) => [step.label, step.detail]));
      summary.append(
        makeCardHeader({
          eyebrow: "Decision explainer",
          title: item.symbol || "-",
          pillText: titleize(item.status || "observe"),
          pillClassName: `pill ${item.status === "tradeable" ? "positive" : "negative"}`
        }),
        makeNode("p", { className: "card-copy", text: item.headline || "Geen explainability headline." }),
        makeReasonRows((item.explainSteps || []).slice(0, 4).map((step) => [step.label, step.detail])),
        inputRows,
        makeTagList((item.guardrails || item.blockerChain || []).slice(0, 4).map((blocker) => makeTag(titleize(blocker), "tag negative")))
      );
      card.append(summary);
      return card;
    })
    : [makeEmptyState("Nog geen decision explainers beschikbaar.")];
  const replayCards = replays.length
    ? replays.map((item) => {
      const card = makeNode("article", { className: "signal-card" });
      const summary = makeNode("div", { className: "card-summary" });
      const compareRows = makeReasonRows((item.outcomeCompare || []).map((entry) => [
        entry.label,
        `${entry.baseline || "-"} -> ${entry.challenger || "-"}${entry.delta != null ? ` (${entry.delta > 0 ? "+" : ""}${number(entry.delta, 1)})` : ""}`
      ]));
      const timelineRows = (item.fullTimeline || []).length
        ? makeNode("div", { className: "list-stack compact-list" })
        : null;
      if (timelineRows) {
        timelineRows.append(
          ...item.fullTimeline.slice(0, 8).map((stage) => makeEventRow({
            title: `${titleize(stage.label || stage.type || "step")} · ${formatDate(stage.at)}`,
            detail: stage.detail || "Geen detail."
          }))
        );
      }
      summary.append(
        makeCardHeader({
          eyebrow: "Trade replay",
          title: item.symbol || "-",
          pillText: formatMoney(item.pnlQuote || 0),
          pillClassName: `pill ${toneClass(item.pnlQuote)}`
        }),
        makeNode("p", { className: "card-copy", text: item.keyTakeaway || "Replay beschikbaar." }),
        makeReasonRows([
          ["Open", item.whyOpened || "Onbekend."],
          ["Sluit", item.whyClosed || "Onbekend."],
          ["Strategie", titleize(item.strategy || "unknown")],
          ["Gate", item.gateSnapshot ? `p ${formatPct(item.gateSnapshot.probability || 0, 1)} · gate ${formatPct(item.gateSnapshot.threshold || 0, 1)}` : "Onbekend."]
        ]),
        makeReasonRows((item.decisionInputs || []).map((entry) => [entry.label, entry.detail])),
        compareRows,
        makeTagList((item.keyStages || []).slice(0, 4).map((stage) => makeTag(`${titleize(stage.label || stage.type || "step")} · ${truncate(stage.detail || "", 48)}`))),
        timelineRows
      );
      card.append(summary);
      return card;
    })
    : [makeEmptyState("Nog geen trade replays beschikbaar.")];
  replaceChildren(elements.explainabilityList, [
    (() => {
      const grid = makeNode("div", { className: "risk-grid" });
      grid.append(...items);
      return grid;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(makeSectionHead("Decision chain", "Waarom setups door of niet door de gating kwamen"), ...decisionCards);
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(makeSectionHead("Replay digest", "Wat de bot zag bij recente trades"), ...replayCards);
      return section;
    })()
  ]);
}

function renderPromotion(snapshot) {
  const pipeline = snapshot?.dashboard?.promotionPipeline || {};
  if (!elements.promotionList) {
    return;
  }
  const topCards = [
    makeKeyValueCard({
      className: "risk-card",
      label: "Promotion",
      value: titleize(pipeline.status || "observe"),
      foot: pipeline.note || "Nog geen promotion pipeline beschikbaar.",
      valueClassName: pipeline.allowPromotion ? "positive" : statusTone(pipeline.status || "unknown")
    }),
    makeKeyValueCard({
      className: "risk-card",
      label: "Next gate",
      value: titleize(pipeline.nextGate || "observe"),
      foot: (pipeline.blockerReasons || [])[0] ? titleize(pipeline.blockerReasons[0]) : "Geen blocker",
      valueClassName: pipeline.allowPromotion ? "positive" : "neutral"
    })
  ];
  const transitionRows = (pipeline.candidateTransitions || []).length
    ? pipeline.candidateTransitions.slice(0, 5).map((item) => makeEventRow({
      title: `${titleize(item.action || "review")} · ${titleize(item.id || "-")}`,
      detail: item.reason || item.scope || "Policy-transitie kandidaat",
      tone: item.approved ? "positive" : item.blocker ? "negative" : "neutral"
    }))
    : [makeEmptyState("Nog geen policytransities klaar.")];
  const candidateRows = (pipeline.guardedLiveCandidates || []).length
    ? pipeline.guardedLiveCandidates.map((item) => makeEventRow({
      title: `${item.symbol || "-"} · ${titleize(item.status || "observe")}`,
      detail: `Governance ${formatPct(item.governanceScore || 0, 0)}`,
      tone: item.status === "promote" ? "positive" : "neutral"
    }))
    : [makeEmptyState("Nog geen guarded-live kandidaten zichtbaar.")];
  const candidateActions = (pipeline.guardedLiveCandidates || []).length
    ? makeTagList((pipeline.guardedLiveCandidates || []).map((item) => item.approved
      ? makeTag(`Approved · ${item.symbol}`, "tag positive")
      : makePromotionActionButton({
        action: "approve",
        symbol: item.symbol || "",
        label: `Approve ${item.symbol || "-"}`,
        tone: item.status === "promote" ? "positive" : ""
      })))
    : null;
  const rolloutRows = (pipeline.rolloutCandidates || []).length
    ? pipeline.rolloutCandidates.map((item) => makeEventRow({
      title: `${titleize(item.action || "observe")} · ${titleize(item.scope || item.id || "-")}`,
      detail: item.reason || item.scope || "Scope rollout kandidaat",
      tone: item.approved ? "positive" : item.blocker ? "negative" : "neutral"
    }))
    : [makeEmptyState("Nog geen scope-rollouts klaar.")];
  const rolloutActions = (pipeline.rolloutCandidates || []).length
    ? makeTagList((pipeline.rolloutCandidates || []).map((item) => item.approved
      ? makeTag(`Approved scope · ${titleize(item.scope || item.id || "-")}`, "tag positive")
      : makePromotionScopeButton({
        action: "approve",
        scope: item.scope || item.id || "",
        label: `Approve ${titleize(item.scope || item.id || "-")}`,
        tone: item.action === "promote_candidate" ? "positive" : ""
      })))
    : null;
  const activePromotionRows = (pipeline.activePromotions || []).length
    ? pipeline.activePromotions.map((item) => makeEventRow({
      title: `${item.symbol || titleize(item.scope || item.id || "-")} · ${titleize(item.stage || "guarded_live_probation")}`,
      detail: item.note || `Governance ${formatPct(item.governanceScore || 0, 0)} · ${item.completedTrades || 0}/${item.targetSampleCount || 0} trades · expiry ${formatDate(item.expiresAt)}`,
      tone: item.rollbackRecommended || item.expired ? "negative" : item.status === "ready_for_review" ? "positive" : "positive"
    }))
    : [makeEmptyState("Nog geen actieve guarded-live probation.")];
  const rollbackActions = (pipeline.activePromotions || []).length
    ? makeTagList((pipeline.activePromotions || []).map((item) => item.symbol
      ? makePromotionActionButton({
        action: "rollback",
        symbol: item.symbol || "",
        label: `Rollback ${item.symbol || "-"}`,
        tone: "negative"
      })
      : makePromotionScopeButton({
        action: "rollback",
        scope: item.scope || item.id || "",
        label: `Rollback ${titleize(item.scope || item.id || "-")}`,
        tone: "negative"
      })))
    : null;
  const historyRows = (pipeline.promotionHistory || []).length
    ? pipeline.promotionHistory.map((item) => makeEventRow({
      title: `${titleize(item.action || "actie")} · ${item.symbol || "-"}`,
      detail: item.note || `${titleize(item.stage || "stage")} · ${titleize(item.status || "done")}${item.verdict ? ` · ${titleize(item.verdict)}` : ""}`,
      tone: item.status === "rolled_back" ? "negative" : item.status === "approved" ? "positive" : "neutral"
    }))
    : [makeEmptyState("Nog geen promotion history.")];
  const probationRows = (pipeline.probationGuardrails || []).length
    ? pipeline.probationGuardrails.map((item) => makeEventRow({
      title: `${titleize(item.label || "-")} · ${titleize(item.status || "active")}`,
      detail: item.detail || "Probation guardrail actief.",
      tone: item.status === "rollback_recommended" || item.status === "expired" ? "negative" : item.status === "ready_for_review" ? "positive" : "neutral"
    }))
    : [makeEmptyState("Nog geen probation guardrails actief.")];
  const scorecardRows = (pipeline.readinessScorecards || []).length
    ? pipeline.readinessScorecards.map((item) => makeEventRow({
      title: `${titleize(item.label || "-")} · ${titleize(item.verdict || "hold")}`,
      detail: `${item.completedTrades || 0}/${item.targetSampleCount || 0} trades · good ${item.goodTrades || 0} · weak ${item.weakTrades || 0} · exec ${formatPct(item.avgExecutionQuality || 0, 0)} · pnl ${formatSignedPct(item.avgNetPnlPct || 0)}`,
      tone: item.verdict === "go" ? "positive" : item.verdict === "rollback" ? "negative" : "neutral"
    }))
    : [makeEmptyState("Nog geen readiness scorecards beschikbaar.")];
  const probationDecisionActions = (pipeline.readinessScorecards || []).length
    ? makeTagList((pipeline.readinessScorecards || []).flatMap((item) => [
      makeProbationDecisionButton({
        action: "promote",
        key: item.key || "",
        label: `Promote ${titleize(item.label || "-")}`,
        tone: item.verdict === "go" ? "positive" : ""
      }),
      makeProbationDecisionButton({
        action: "hold",
        key: item.key || "",
        label: `Hold ${titleize(item.label || "-")}`
      }),
      makeProbationDecisionButton({
        action: "close",
        key: item.key || "",
        label: `Close ${titleize(item.label || "-")}`,
        tone: "negative"
      })
    ]))
    : null;
  const guardrailTags = [
    ...(pipeline.guardrails || []).map((item) => makeTag(titleize(item), "tag negative")),
    ...((pipeline.activeOverrides || []).map((item) => makeTag(`${titleize(item.id)} · ${titleize(item.status || "override")}`, "tag positive")))
  ];
  replaceChildren(elements.promotionList, [
    (() => {
      const grid = makeNode("div", { className: "risk-grid" });
      grid.append(...topCards);
      return grid;
    })(),
    guardrailTags.length ? makeTagList(guardrailTags) : makeEmptyState("Geen actieve guardrails of overrides."),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(makeSectionHead("Pipeline actions", "Welke promotie- of cooldownstappen klaarstaan"), ...transitionRows);
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(
        makeSectionHead("Guarded live", "Kandidaten richting guarded live probation"),
        ...candidateRows,
        candidateActions || makeEmptyState("Geen guarded-live approve actions klaar.")
      );
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(
        makeSectionHead("Scope rollouts", "Staged probation per strategy, lane of scope"),
        ...rolloutRows,
        rolloutActions || makeEmptyState("Geen scope-rollout actions klaar.")
      );
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(
        makeSectionHead("Actieve probation", "Operator-goedgekeurde guarded-live overrides"),
        ...activePromotionRows,
        rollbackActions || makeEmptyState("Geen rollback acties actief.")
      );
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(
        makeSectionHead("Probation guardrails", "Sample targets, expiry en rollback-triggers"),
        ...probationRows
      );
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(
        makeSectionHead("Readiness scorecards", "Go, hold of rollback per actieve probation"),
        ...scorecardRows,
        probationDecisionActions || makeEmptyState("Geen probation decisions beschikbaar.")
      );
      return section;
    })(),
    (() => {
      const section = makeNode("div", { className: "list-stack" });
      section.append(
        makeSectionHead("Promotion history", "Laatste approve en rollback acties"),
        ...historyRows
      );
      return section;
    })()
  ]);
}

function render(snapshot) {
  latestSnapshot = snapshot;
  lastSnapshotReceivedAt = new Date().toISOString();
  const renderErrors = [];
  for (const [section, renderFn] of [
    ["badges", () => renderBadges(snapshot)],
    ["hero", () => renderHero(snapshot)],
    ["signals", () => renderSignals(snapshot)],
    ["positions", () => renderPositions(snapshot)],
    ["learning", () => renderLearning(snapshot)],
    ["missed_trades", () => renderMissedTrades(snapshot)],
    ["ops", () => renderOps(snapshot)],
    ["trades", () => renderTrades(snapshot)],
    ["diagnostics", () => renderDiagnostics(snapshot)],
    ["explainability", () => renderExplainability(snapshot)],
    ["promotion", () => renderPromotion(snapshot)],
    ["controls", () => syncControls(snapshot)],
    ["panels", () => syncPanels()]
  ]) {
    const issue = safeRenderSection(section, renderFn);
    if (issue) {
      renderErrors.push(issue);
    }
  }
  if (!renderErrors.length && elements.controlHint) {
    elements.controlHint.textContent = buildHeroSummary(snapshot).subline;
  }
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
    if (epoch < requestEpoch || epoch < latestAppliedEpoch) {
      return;
    }
    latestAppliedEpoch = epoch;
    render(pickSnapshot(payload));
  } catch (error) {
    elements.controlHint.textContent = error.message;
    replaceChildren(elements.operatorSummary, [
      (() => {
        const pill = makeNode("span", { className: "hero-pill negative" });
        pill.append(
          makeNode("strong", { text: "Dashboard" }),
          makeNode("span", {
            text: error?.message
              ? `Snapshot mislukt: ${truncate(error.message, 140)}`
              : "Controleer of de dashboardserver nog draait."
          })
        );
        return pill;
      })()
    ]);
  }
}

async function runAction(path, body = {}) {
  const epoch = ++requestEpoch;
  busy = true;
  syncControls(latestSnapshot || {});
  try {
    const payload = await api(path, { method: "POST", body });
    if (epoch < requestEpoch || epoch < latestAppliedEpoch) {
      return;
    }
    latestAppliedEpoch = epoch;
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

  elements.diagnosticsList?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-diagnostics-action]");
    if (!target) {
      return;
    }
    const diagnosticsAction = `${target.getAttribute("data-diagnostics-action") || ""}`.trim();
    const diagnosticsTarget = `${target.getAttribute("data-diagnostics-target") || ""}`.trim();
    if (!diagnosticsAction) {
      return;
    }
    const note = window.prompt(`Optionele notitie voor ${diagnosticsAction}${diagnosticsTarget ? ` ${diagnosticsTarget}` : ""}:`, "") || null;
    await runAction("/api/diagnostics/action", {
      action: diagnosticsAction,
      target: diagnosticsTarget || null,
      note
    });
  });

  elements.promotionList?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-promotion-action]");
    if (target) {
      const promotionAction = `${target.getAttribute("data-promotion-action") || ""}`.trim();
      const symbol = `${target.getAttribute("data-promotion-symbol") || ""}`.trim();
      if (!promotionAction || !symbol) {
        return;
      }
      const note = window.prompt(`Optionele notitie voor ${promotionAction} ${symbol}:`, "") || null;
      if (promotionAction === "approve") {
        await runAction("/api/promotion/approve", { symbol, note });
        return;
      }
      if (promotionAction === "rollback") {
        await runAction("/api/promotion/rollback", { symbol, note });
      }
      return;
    }
    const scopeTarget = event.target.closest("[data-promotion-scope-action]");
    if (!scopeTarget) {
      return;
    }
    const scopeAction = `${scopeTarget.getAttribute("data-promotion-scope-action") || ""}`.trim();
    const scope = `${scopeTarget.getAttribute("data-promotion-scope") || ""}`.trim();
    if (!scopeAction || !scope) {
      return;
    }
    const note = window.prompt(`Optionele notitie voor ${scopeAction} ${scope}:`, "") || null;
    if (scopeAction === "approve") {
      await runAction("/api/promotion/scope/approve", { scope, note });
      return;
    }
    if (scopeAction === "rollback") {
      await runAction("/api/promotion/scope/rollback", { scope, note });
    }
  });

  elements.promotionList?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-probation-decision]");
    if (!target) {
      return;
    }
    const decision = `${target.getAttribute("data-probation-decision") || ""}`.trim();
    const key = `${target.getAttribute("data-probation-key") || ""}`.trim();
    if (!decision || !key) {
      return;
    }
    const note = window.prompt(`Optionele notitie voor ${decision} ${key}:`, "") || null;
    await runAction("/api/promotion/probation/decide", { key, decision, note });
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
  bindPanelToggle("diagnostics", elements.diagnosticsSection, elements.diagnosticsToggleBtn);
  bindPanelToggle("explainability", elements.explainabilitySection, elements.explainabilityToggleBtn);
  bindPanelToggle("promotion", elements.promotionSection, elements.promotionToggleBtn);
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
  syncPanel(elements.diagnosticsSection, elements.diagnosticsToggleBtn, panelState.diagnostics);
  syncPanel(elements.explainabilitySection, elements.explainabilityToggleBtn, panelState.explainability);
  syncPanel(elements.promotionSection, elements.promotionToggleBtn, panelState.promotion);
}

function createFakeDashboardDocument() {
  class FakeClassList {
    constructor(node) {
      this.node = node;
      this.tokens = new Set();
    }
    toggle(token, force) {
      if (force === undefined) {
        if (this.tokens.has(token)) {
          this.tokens.delete(token);
        } else {
          this.tokens.add(token);
        }
      } else if (force) {
        this.tokens.add(token);
      } else {
        this.tokens.delete(token);
      }
      this.node.className = [...this.tokens].join(" ");
    }
  }

  class FakeNode {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.attributes = {};
      this.className = "";
      this.textContent = "";
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.value = "";
      this.classList = new FakeClassList(this);
    }
    append(...children) {
      this.children.push(...children.filter(Boolean));
    }
    replaceChildren(...children) {
      this.children = children.filter(Boolean);
    }
    setAttribute(name, value) {
      this.attributes[name] = `${value}`;
    }
    getAttribute(name) {
      return this.attributes[name] ?? null;
    }
    addEventListener() {}
    remove() {
      this.removed = true;
    }
    closest() {
      return null;
    }
    querySelectorAll(selector) {
      if (selector === "[data-render-issue='1']") {
        return this.children.filter((child) => child?.attributes?.["data-render-issue"] === "1");
      }
      return [];
    }
  }

  const selectorMap = new Map();
  const documentStub = {
    createElement(tag) {
      return new FakeNode(tag);
    },
    querySelector(selector) {
      if (!selectorMap.has(selector)) {
        selectorMap.set(selector, new FakeNode("div"));
      }
      return selectorMap.get(selector);
    }
  };
  return {
    document: documentStub,
    selectors: selectorMap
  };
}

export function __dashboardSmokeRender(snapshot) {
  const previousDocument = activeDocument;
  const previousElements = elements;
  const fake = createFakeDashboardDocument();
  try {
    activeDocument = fake.document;
    elements = createElements(activeDocument);
    render(snapshot);
    return {
      controlHint: elements.controlHint?.textContent || "",
      operatorSummaryChildren: elements.operatorSummary?.children?.length || 0,
      renderIssueCount: elements.operatorSummary?.querySelectorAll?.("[data-render-issue='1']")?.length || 0
    };
  } finally {
    activeDocument = previousDocument;
    elements = previousElements;
  }
}

async function init() {
  bindEvents();
  await refreshSnapshot();
  pollTimer = window.setInterval(refreshSnapshot, POLL_MS);
}

if (activeDocument) {
  init();
}


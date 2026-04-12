import { resolveStatusTone as statusTone } from "../../shared/statusTone.js";

const POLL_MS = 15000;
const DECISION_LIMIT = 6;
const STORAGE_KEYS = { showAllDecisions: "dashboard.showAllDecisions" };

function createElements(doc) {
  const q = (selector) => doc?.querySelector?.(selector) || null;
  return {
    modeBadge: q("#modeBadge"),
    runStateBadge: q("#runStateBadge"),
    healthBadge: q("#healthBadge"),
    refreshBadge: q("#refreshBadge"),
    controlHint: q("#controlHint"),
    operatorSummary: q("#operatorSummary"),
    startBtn: q("#startBtn"),
    stopBtn: q("#stopBtn"),
    paperBtn: q("#paperBtn"),
    liveBtn: q("#liveBtn"),
    refreshBtn: q("#refreshBtn"),
    decisionSearch: q("#decisionSearch"),
    decisionAllowedOnly: q("#decisionAllowedOnly"),
    decisionMeta: q("#decisionMeta"),
    decisionShowMoreBtn: q("#decisionShowMoreBtn"),
    overviewCards: q("#overviewCards"),
    attentionList: q("#attentionList"),
    actionList: q("#actionList"),
    quickActionsList: q("#quickActionsList"),
    focusList: q("#focusList"),
    positionsList: q("#positionsList"),
    recentTradesList: q("#recentTradesList"),
    opportunityList: q("#opportunityList"),
    healthList: q("#healthList"),
    learningList: q("#learningList"),
    diagnosticsList: q("#diagnosticsList"),
    explainabilityList: q("#explainabilityList"),
    promotionList: q("#promotionList")
  };
}

let activeDocument = typeof document !== "undefined" ? document : null;
let elements = createElements(activeDocument);
let latestSnapshot = null;
let busy = false;
let requestEpoch = 0;
let latestAppliedEpoch = 0;
let searchQuery = "";
let allowedOnly = false;
let showAllDecisions = readStoredBoolean(STORAGE_KEYS.showAllDecisions, false);
let lastSnapshotReceivedAt = null;
const renderFallbackSections = new Set();

function makeNode(tag, { className = "", text = "", attrs = {} } = {}) {
  if (!activeDocument?.createElement) {
    throw new Error("dashboard_document_unavailable");
  }
  const node = activeDocument.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === "") continue;
    const key = `${name}`.trim();
    const lower = key.toLowerCase();
    if (!key || lower.startsWith("on")) continue;
    node.setAttribute(key, `${value}`);
  }
  return node;
}

function replaceChildren(element, children = []) {
  if (element) {
    element.replaceChildren(...children.filter(Boolean));
  }
}

function setStyleProperty(node, name, value) {
  if (node?.style?.setProperty) {
    node.style.setProperty(name, value);
  }
}

function makeTag(text, className = "tag") {
  return makeNode("span", { className, text });
}

function makeTagList(items = []) {
  const list = makeNode("div", { className: "tag-list" });
  list.append(...items.filter(Boolean));
  return list;
}

function makeEmptyState(text) {
  return makeNode("div", { className: "empty", text });
}

function makeCard({ title, detail, tone = "neutral", body = null, metrics = [] }, className = "stack-card") {
  const node = makeNode("article", { className: `${className} ${tone}`.trim() });
  if (title) node.append(makeNode("h3", { text: title }));
  if (detail) node.append(makeNode("p", { text: detail }));
  if (body) node.append(body);
  if (metrics.length) node.append(makeTagList(metrics));
  return node;
}

function makeMetricCard({ label, value, detail, tone = "neutral" }) {
  const node = makeNode("article", { className: `overview-card ${tone}`.trim() });
  node.append(
    makeNode("h3", { text: label }),
    makeNode("div", { className: "overview-value", text: value || "-" }),
    makeNode("p", { text: detail || "-" })
  );
  return node;
}

function makeMetricRow(items = []) {
  const row = makeNode("div", { className: "metric-row" });
  for (const item of items.filter(Boolean)) {
    const metric = makeNode("div", { className: "metric" });
    metric.append(
      makeNode("span", { className: "metric-label", text: item.label || "-" }),
      makeNode("strong", { text: item.value || "-" })
    );
    if (item.detail) {
      metric.append(makeNode("span", { className: "metric-foot", text: item.detail }));
    }
    row.append(metric);
  }
  return row;
}

function compactJoin(parts = [], separator = " · ") {
  return parts.filter(Boolean).join(separator);
}

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : min;
}

function readStoredBoolean(key, fallback = false) {
  try {
    return typeof localStorage === "undefined" ? fallback : localStorage.getItem(key) === "1";
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key, value) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value ? "1" : "0");
    }
  } catch {}
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(Number(value))
    ? new Intl.NumberFormat("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value))
    : "-";
}

function formatMoney(value) {
  return Number.isFinite(Number(value))
    ? new Intl.NumberFormat("nl-NL", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: Math.abs(Number(value)) >= 100 ? 0 : 2,
        maximumFractionDigits: Math.abs(Number(value)) >= 100 ? 0 : 2
      }).format(Number(value))
    : "$0";
}

function formatPct(value, digits = 1) {
  return Number.isFinite(Number(value)) ? `${formatNumber(Number(value) * 100, digits)}%` : "-";
}

function formatSignedPct(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return "-";
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : ""}${formatNumber(numeric * 100, digits)}%`;
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("nl-NL", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
    : "-";
}

function titleize(value) {
  return `${value || ""}`
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase()) || "-";
}

function truncate(text, max = 120) {
  const value = `${text || ""}`.trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}...`;
}

function humanizeReason(value, fallback = "-") {
  return value ? titleize(value) : fallback;
}

function decisionPrimaryReason(decision = {}) {
  if (!decision || typeof decision !== "object") return null;
  return decision.decisionTruth?.primaryReason || decision.primaryReason || decision.blockerReasons?.[0] || decision.operatorAction || null;
}

function showDashboardRenderIssue(section, error) {
  renderFallbackSections.add(section);
  console.error?.(`dashboard_render_issue:${section}`, error);
}

function safeRenderSection(section, renderFn) {
  try {
    renderFallbackSections.delete(section);
    renderFn();
    return null;
  } catch (error) {
    showDashboardRenderIssue(section, error);
    return { section, error };
  }
}

function syncRenderHealthBanner(snapshot) {
  if (!elements.controlHint) return;
  if (renderFallbackSections.size) {
    elements.controlHint.textContent = `Dashboard rendering deels gedegradeerd: ${[...renderFallbackSections].join(", ")}`;
    return;
  }
  const readiness = snapshot?.dashboard?.ops?.readiness || snapshot?.manager?.readiness || {};
  const deck = buildOperatorDeckFromSnapshot(snapshot);
  elements.controlHint.textContent = deck.subline || readiness.note || "Overzicht geladen.";
}

function makeSignalMiniChart(decision = {}) {
  const threshold = Math.max(Number(decision.threshold) || 0, 0.0001);
  const probability = clamp(decision.probability || 0);
  const confidence = clamp(decision.confidenceBreakdown?.overallConfidence || 0);
  const edgeRatio = clamp((decision.probability || 0) / threshold);
  const chart = makeNode("div", { className: "signal-mini-chart" });
  [probability * 0.7, confidence * 0.58, edgeRatio * 0.9, probability * 0.88, confidence * 0.8].forEach((value) => {
    const bar = makeNode("span", { className: "signal-mini-bar" });
    setStyleProperty(bar, "--bar-height", `${Math.round(clamp(value, 0.12, 1) * 100)}%`);
    chart.append(bar);
  });
  return chart;
}

function makePositionGauge(position = {}) {
  const pnlPct = Number(position.unrealizedPnlPct) || 0;
  const gauge = makeNode("div", { className: `position-gauge ${pnlPct >= 0 ? "positive" : "negative"}` });
  setStyleProperty(gauge, "--gauge-fill", `${Math.round(clamp((pnlPct + 0.05) / 0.1) * 100)}%`);
  gauge.append(
    makeNode("span", { className: "position-gauge-value", text: formatSignedPct(pnlPct, 1) }),
    makeNode("span", { className: "position-gauge-label", text: "Open P/L" })
  );
  return gauge;
}

function buildMissedTradeMetricTags(analysis = {}, { compact = false } = {}) {
  const tags = [];
  if (Number.isFinite(analysis.badVetoRate)) tags.push(makeTag(`bad_veto ${formatPct(analysis.badVetoRate, compact ? 0 : 1)}`));
  if (Number.isFinite(analysis.averageMissedMovePct)) tags.push(makeTag(`avg_move ${formatPct(analysis.averageMissedMovePct, compact ? 0 : 1)}`));
  if (analysis.topOverblockedScope?.id) tags.push(makeTag(`shadow_evidence ${titleize(analysis.topOverblockedScope.id)}`));
  if ((analysis.totalCounterfactuals || 0) > 0) tags.push(makeTag(`queued_cases ${analysis.totalCounterfactuals}`));
  if (analysis.topBlocker?.id) tags.push(makeTag(`blocker ${titleize(analysis.topBlocker.id)}`));
  return tags;
}

function buildLearningDigest(snapshot) {
  const dashboard = snapshot?.dashboard || {};
  const offlineTrainer = dashboard.offlineTrainer || {};
  const adaptiveLearning = dashboard.adaptiveLearning || {};
  const onlineAdaptation = dashboard.onlineAdaptation || dashboard.ops?.onlineAdaptation || {};
  const missedTradeTuning = dashboard.ops?.missedTradeTuning || {};
  const missedTrades = dashboard.ops?.learningInsights?.missedTrades || {};
  const thresholdPolicy = offlineTrainer.thresholdPolicy || {};
  const topRecommendation = thresholdPolicy.topRecommendation || {};
  const parameterOptimization = adaptiveLearning.parameterOptimization || offlineTrainer.parameterOptimization || {};
  const tuningStatus = missedTradeTuning.actionClass || topRecommendation.actionClass || topRecommendation.action || "observe";
  return [
    {
      title: "Adaptive learning",
      detail: compactJoin([
        titleize(adaptiveLearning.status || "warmup"),
        adaptiveLearning.note || null,
        onlineAdaptation.lastApplied?.symbol ? `laatste ${onlineAdaptation.lastApplied.symbol}` : null
      ]),
      tone: adaptiveLearning.status === "active" ? "positive" : "neutral"
    },
    {
      title: "Threshold policy",
      detail: compactJoin([
        topRecommendation.id ? `${titleize(topRecommendation.id)} ${titleize(tuningStatus)}` : titleize(thresholdPolicy.status || "stable"),
        topRecommendation.dominantFeedback ? titleize(topRecommendation.dominantFeedback) : null,
        Number.isFinite(topRecommendation.adjustment) ? `shift ${formatPct(topRecommendation.adjustment || 0, 1)}` : null
      ]),
      tone: ["scoped_harden", "tighten"].includes(tuningStatus) ? "negative" : ["scoped_soften", "paper_only"].includes(tuningStatus) ? "positive" : "neutral"
    },
    {
      title: "Missed trades",
      detail: compactJoin([
        missedTradeTuning.topBlocker ? titleize(missedTradeTuning.topBlocker) : null,
        missedTradeTuning.actionClass ? titleize(missedTradeTuning.actionClass) : null,
        missedTrades.note || missedTradeTuning.dominantFeedback || null
      ]),
      tone: missedTrades.status === "priority" ? "negative" : "neutral",
      metrics: buildMissedTradeMetricTags(missedTrades, { compact: true })
    },
    {
      title: "Optimization",
      detail: compactJoin([
        parameterOptimization.topCandidate ? titleize(parameterOptimization.topCandidate) : null,
        parameterOptimization.livePromotionAllowed === false ? "live blocked" : null,
        parameterOptimization.note || null
      ]),
      tone: "neutral"
    }
  ];
}

function unresolvedAlerts(snapshot) {
  return (snapshot?.dashboard?.ops?.alerts?.alerts || []).filter((item) => !item.resolvedAt && !item.muted);
}

function buildOperatorDeckFromSnapshot(snapshot) {
  const dashboard = snapshot?.dashboard || {};
  if (dashboard.operatorDeck) return dashboard.operatorDeck;
  const overview = dashboard.overview || {};
  const readiness = dashboard.ops?.readiness || snapshot?.manager?.readiness || {};
  const signalFlow = dashboard.ops?.signalFlow?.tradingFlowHealth || {};
  const capitalPolicy = dashboard.ops?.capitalPolicy || {};
  const executionCost = dashboard.report?.executionCostSummary || {};
  const tradableDecision = (dashboard.topDecisions || []).find((item) => item.allow) || null;
  const topBlocked = (dashboard.blockedSetups || [])[0] || null;
  const urgentAlert = unresolvedAlerts(snapshot)[0] || null;
  const probeOnly = Boolean(capitalPolicy?.governor?.allowProbeEntries && capitalPolicy?.allowEntries === false);
  const dominantBlocker = signalFlow.dominantBlocker || decisionPrimaryReason(topBlocked) || (readiness.reasons || [])[0] || null;
  const cards = [
    {
      id: "system",
      label: "System state",
      value: titleize(readiness.status || "unknown"),
      detail: compactJoin([titleize(overview.mode || snapshot?.manager?.currentMode || "paper"), overview.lastCycleAt ? formatDate(overview.lastCycleAt) : null]),
      tone: readiness.status === "ready" ? "positive" : "negative"
    },
    {
      id: "focus",
      label: "Focus",
      value: tradableDecision ? `${tradableDecision.symbol} tradebaar` : titleize(readiness.status === "ready" ? "waiting" : readiness.status || "blocked"),
      detail: tradableDecision?.summary || tradableDecision?.operatorAction || humanizeReason(dominantBlocker, "Wachten op valide setup."),
      tone: tradableDecision ? "positive" : dominantBlocker ? "negative" : "neutral"
    },
    {
      id: "capital",
      label: "Capital",
      value: formatMoney(overview.equity || 0),
      detail: compactJoin([
        `Budget ${formatMoney(overview.effectiveBudget?.deployableBudget || 0)}`,
        (probeOnly || overview.effectiveBudget?.probeEntriesAllowed) && overview.effectiveBudget?.probeBudget > 0
          ? `Probe budget ${formatMoney(overview.effectiveBudget.probeBudget)}`
          : null,
        (probeOnly || overview.effectiveBudget?.probeEntriesAllowed) && overview.sizingGuide?.paperProbeQuote
          ? `Probe size ${formatMoney(overview.sizingGuide.paperProbeQuote)}`
          : null,
        probeOnly || overview.effectiveBudget?.probeEntriesAllowed ? "Probe only" : null,
        overview.sizingGuide?.effectivePaperMinTradeUsdt ? `Paper floor ${formatMoney(overview.sizingGuide.effectivePaperMinTradeUsdt)}` : null,
        Number(overview.openExposure || 0) > 0 ? `Exposure ${formatMoney(overview.openExposure || 0)}` : null
      ]),
      tone: (overview.effectiveBudget?.deployableBudget || 0) > 0 ? "positive" : "neutral"
    },
    {
      id: "freshness",
      label: "Data freshness",
      value: titleize(dashboard.ops?.service?.status || dashboard.marketHistory?.status || "unknown"),
      detail: dashboard.marketHistory?.note || "Controleer feed freshness en laatste analyse.",
      tone: dashboard.ops?.service?.status === "degraded" ? "negative" : "positive"
    }
  ];
  return {
    headline: cards[1].value,
    subline: cards[1].detail,
    dominantBlocker,
    tradeState: {
      status: tradableDecision ? "can_trade" : dominantBlocker ? "blocked" : "waiting",
      headline: cards[1].value,
      detail: cards[1].detail,
      symbol: tradableDecision?.symbol || null
    },
    cards,
    attention: [
      urgentAlert ? { title: urgentAlert.title || "Alert", detail: urgentAlert.action || urgentAlert.reason || "-", tone: "negative" } : null,
      dominantBlocker ? { title: "Dominant blocker", detail: humanizeReason(dominantBlocker), tone: "negative" } : null,
      executionCost.reconstructedPaperFeeSample
        ? {
            title: "Execution-cost sample",
            detail: executionCost.reconstructedPaperEntryFeeCount > 0
              ? `Paper entry-fees werden voor ${executionCost.reconstructedPaperEntryFeeCount} trade(s) uit fee-config gereconstrueerd.`
              : "Een deel van de paper fee-sample werd uit fee-config gereconstrueerd.",
            tone: "neutral"
          }
        : null
    ].filter(Boolean),
    actions: dashboard.operatorDiagnostics?.actionItems || [],
    advanced: {
      topDecisionCount: (dashboard.topDecisions || []).length,
      blockedCount: (dashboard.blockedSetups || []).length,
      positionCount: (dashboard.positions || []).length,
      recentTradeCount: (dashboard.report?.recentTrades || []).length
    }
  };
}

function buildMutationHeaders() {
  return { "content-type": "application/json", "x-dashboard-request": "1" };
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: method === "GET" ? undefined : buildMutationHeaders(),
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload;
}

function pickSnapshot(payload) {
  return payload?.dashboard ? payload : payload?.payload ? payload.payload : payload;
}

function toneClass(value) {
  return ["positive", "negative", "warning", "neutral"].includes(value) ? value : "neutral";
}

function summaryPill(label, value, tone = "neutral") {
  const pill = makeNode("div", { className: `headline-pill ${toneClass(tone)}` });
  pill.append(makeNode("strong", { text: label }), makeNode("span", { text: value || "-" }));
  return pill;
}

function setBadge(node, text, tone = "neutral") {
  if (!node) return;
  node.textContent = text;
  node.className = `status-chip ${toneClass(tone)}`.trim();
}

function renderBadges(snapshot) {
  const manager = snapshot?.manager || {};
  const readiness = snapshot?.dashboard?.ops?.readiness || manager.readiness || {};
  setBadge(elements.modeBadge, titleize(snapshot?.dashboard?.overview?.mode || manager.currentMode || "paper"), "neutral");
  setBadge(elements.runStateBadge, titleize(manager.runState || "idle"), statusTone(manager.runState || "idle"));
  setBadge(elements.healthBadge, titleize(readiness.status || "unknown"), statusTone(readiness.status || "unknown"));
  if (elements.refreshBadge) {
    elements.refreshBadge.textContent = `Laatste update: ${formatDate(lastSnapshotReceivedAt || snapshot?.generatedAt)}`;
  }
}

function renderHero(snapshot) {
  const deck = buildOperatorDeckFromSnapshot(snapshot);
  const children = [
    summaryPill("Status", deck.headline, deck.tradeState?.status === "can_trade" ? "positive" : deck.tradeState?.status === "blocked" ? "negative" : "neutral"),
    summaryPill("Belangrijkste reden", deck.dominantBlocker ? humanizeReason(deck.dominantBlocker) : "Geen kritieke blocker", deck.dominantBlocker ? "negative" : "positive"),
    summaryPill("Nu doen", deck.actions?.[0]?.title || "Monitoren", deck.actions?.[0]?.detail || deck.subline || "Geen directe operatoractie nodig.", "neutral")
  ];
  replaceChildren(elements.operatorSummary, children);
}

function renderOverview(snapshot) {
  const cards = buildOperatorDeckFromSnapshot(snapshot).cards || [];
  replaceChildren(elements.overviewCards, cards.map((card) => makeMetricCard(card)));
}

function renderAttention(snapshot) {
  const deck = buildOperatorDeckFromSnapshot(snapshot);
  const attention = deck.attention?.length ? deck.attention : [{ title: "Geen urgente alerts", detail: "Het systeem draait zonder directe operator-acties.", tone: "positive" }];
  const actions = deck.actions?.length
    ? deck.actions.map((item) => ({
        title: item.title || "Actie",
        detail: item.detail || item.reason || "-",
        tone: item.priority === "high" ? "negative" : item.priority === "medium" ? "warning" : "neutral"
      }))
    : [{ title: "Geen open operator tasks", detail: "Alleen blijven monitoren.", tone: "positive" }];
  replaceChildren(elements.attentionList, attention.map((item) => makeCard(item)));
  replaceChildren(elements.actionList, actions.map((item) => makeCard(item)));
}

function renderFocus(snapshot) {
  const dashboard = snapshot?.dashboard || {};
  const readiness = dashboard.ops?.readiness || snapshot?.manager?.readiness || {};
  const topDecisions = dashboard.topDecisions || [];
  const blockedSetups = dashboard.blockedSetups || [];
  const tradable = topDecisions.find((item) => item.allow);
  const blocker = blockedSetups[0];
  const cards = [
    makeCard({
      title: "Can it trade now?",
      detail: tradable ? `${tradable.symbol} staat klaar om te handelen.` : titleize(readiness.status || "waiting"),
      tone: tradable ? "positive" : readiness.status === "ready" ? "neutral" : "negative",
      body: makeMetricRow([
        { label: "Top setup", value: tradable?.symbol || "-", detail: tradable?.strategy?.strategyLabel || tradable?.strategyLabel || "-" },
        { label: "Threshold", value: formatPct(tradable?.threshold || 0, 1), detail: `Prob ${formatPct(tradable?.probability || 0, 1)}` },
        { label: "Confidence", value: formatPct(tradable?.confidenceBreakdown?.overallConfidence || 0, 1), detail: tradable?.setupQuality?.tier || "-" }
      ])
    }, "focus-card"),
    makeCard({
      title: "Dominant blocker",
      detail: blocker ? humanizeReason(decisionPrimaryReason(blocker)) : "Geen dominante blocker zichtbaar.",
      tone: blocker ? "negative" : "positive",
      body: makeMetricRow([
        { label: "Blocked setups", value: `${blockedSetups.length}`, detail: "laatste snapshot" },
        { label: "Readiness", value: titleize(readiness.status || "unknown"), detail: compactJoin((readiness.reasons || []).slice(0, 2).map(humanizeReason)) || "-" },
        { label: "Top blocked", value: blocker?.symbol || "-", detail: blocker?.strategy?.strategyLabel || blocker?.strategyLabel || "-" }
      ])
    }, "focus-card")
  ];
  replaceChildren(elements.focusList, cards);
}

function renderPositions(snapshot) {
  const positions = snapshot?.dashboard?.positions || [];
  if (!positions.length) {
    replaceChildren(elements.positionsList, [makeEmptyState("Geen open posities.")]);
    return;
  }
  replaceChildren(elements.positionsList, positions.slice(0, 4).map((position) => {
    const entryCapital = Number(position.totalCost) || Number(position.notional) || 0;
    const lc = position.lifecycle || {};
    const lifecycleLabel = compactJoin([
      lc.state ? `lifecycle: ${titleize(lc.state)}` : null,
      lc.operatorMode && lc.operatorMode !== "normal" ? titleize(lc.operatorMode) : null
    ]);
    const needsManualReview = Boolean(lc.manualReviewRequired || lc.state === "manual_review");
    const needsReconcile = Boolean(lc.reconcileRequired || lc.state === "reconcile_required");
    const body = makeNode("div");
    body.append(
      makeMetricRow([
        {
          label: "PnL",
          value: formatMoney(position.unrealizedPnl || 0),
          detail: formatSignedPct(position.unrealizedPnlPct || 0, 1)
        },
        {
          label: "Ingezet",
          value: formatMoney(entryCapital),
          detail: entryCapital ? `nu ${formatMoney(position.marketValue || 0)}` : "-"
        },
        {
          label: "Entry → nu",
          value: formatMoney(position.entryPrice || 0),
          detail: formatMoney(position.currentPrice || 0)
        }
      ]),
      makePositionGauge(position)
    );
    if (lifecycleLabel) {
      body.append(makeNode("p", { className: "position-lifecycle-hint", text: lifecycleLabel }));
    }
    if (needsReconcile) {
      body.append(
        makeNode("p", {
          className: "position-lifecycle-hint",
          text: "Reconcile vereist: gebruik Force reconcile in Snelle acties na controle op de exchange."
        })
      );
    }
    if (needsManualReview && position.id) {
      const row = makeNode("div", { className: "position-actions" });
      const reviewBtn = makeNode("button", { className: "ghost ghost-small", type: "button", text: "Markeer als beoordeeld" });
      reviewBtn.addEventListener("click", () =>
        mutateAndRefresh("/api/positions/review", { id: position.id, note: "dashboard manual review" }).catch((error) =>
          console.error?.("position_review_failed", error)
        )
      );
      row.append(
        reviewBtn,
        makeNode("span", { className: "position-id-hint", text: `id ${truncate(position.id, 36)}` })
      );
      body.append(row);
    }
    return makeCard({
      title: position.symbol || "-",
      detail: compactJoin([position.side ? titleize(position.side) : null, position.gridContext?.gridBand ? titleize(position.gridContext.gridBand) : null]),
      body,
      tone: Number(position.unrealizedPnl || 0) >= 0 ? "positive" : "negative"
    }, "position-card");
  }));
}

function renderRecentTrades(snapshot) {
  const trades = snapshot?.dashboard?.report?.recentTrades || [];
  if (!trades.length) {
    replaceChildren(elements.recentTradesList, [makeEmptyState("Nog geen recente trades om te tonen.")]);
    return;
  }
  replaceChildren(elements.recentTradesList, trades.slice(0, 5).map((trade) => makeCard({
    title: trade.symbol || "-",
    detail: compactJoin([
      trade.strategyLabel || trade.strategyAtEntry || null,
      trade.exitReason ? `exit ${titleize(trade.exitReason)}` : null,
      trade.exitAt ? formatDate(trade.exitAt) : null
    ]),
    body: makeMetricRow([
      { label: "PnL", value: formatMoney(trade.pnlQuote || 0), detail: formatSignedPct(trade.netPnlPct || 0, 1) },
      { label: "Entry", value: formatMoney(trade.entryPrice || 0) },
      { label: "Exit", value: formatMoney(trade.exitPrice || 0) }
    ]),
    tone: Number(trade.pnlQuote || 0) >= 0 ? "positive" : "negative"
  }, "trade-card")));
}

function buildOpportunityCards(snapshot) {
  const topDecisions = (snapshot?.dashboard?.topDecisions || []).map((item) => ({ ...item, _kind: "decision" }));
  const blockedSetups = (snapshot?.dashboard?.blockedSetups || []).map((item) => ({ ...item, _kind: "blocked" }));
  const combined = [...topDecisions, ...blockedSetups];
  const filtered = combined.filter((item) => {
    if (allowedOnly && !item.allow) return false;
    if (!searchQuery) return true;
    const haystack = [
      item.symbol,
      item.strategy?.strategyLabel,
      item.strategyLabel,
      item.strategy?.family,
      item.marketState?.phase,
      decisionPrimaryReason(item)
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(searchQuery);
  });
  return filtered.slice(0, showAllDecisions ? Math.max(filtered.length, DECISION_LIMIT) : DECISION_LIMIT);
}

function renderOpportunityBoard(snapshot) {
  const cards = buildOpportunityCards(snapshot);
  const total = (snapshot?.dashboard?.topDecisions || []).length + (snapshot?.dashboard?.blockedSetups || []).length;
  if (elements.decisionMeta) {
    elements.decisionMeta.textContent = `${cards.length}/${total} zichtbaar`;
  }
  if (elements.decisionShowMoreBtn) {
    elements.decisionShowMoreBtn.textContent = showAllDecisions ? "Toon minder" : "Toon meer";
  }
  if (!cards.length) {
    replaceChildren(elements.opportunityList, [makeEmptyState("Geen kansen of blokkades die aan de filter voldoen.")]);
    return;
  }
  replaceChildren(elements.opportunityList, cards.map((decision) => {
    const tags = [
      makeTag(decision.allow ? "tradebaar" : "blocked", decision.allow ? "tag positive" : "tag negative"),
      decision.strategy?.strategyLabel ? makeTag(decision.strategy.strategyLabel) : null,
      decision.scannerPriority?.scannerLane ? makeTag(`lane ${decision.scannerPriority.scannerLane}`) : null,
      decision.gridContext?.gridEntrySide ? makeTag(titleize(decision.gridContext.gridEntrySide)) : null
    ].filter(Boolean);
    const body = makeNode("div");
    body.append(
      makeMetricRow([
        { label: "Prob", value: formatPct(decision.probability || 0, 1), detail: `Thr ${formatPct(decision.threshold || 0, 1)}` },
        { label: "Conf", value: formatPct(decision.confidenceBreakdown?.overallConfidence || 0, 1), detail: decision.setupQuality?.tier || "-" },
        { label: "Reason", value: humanizeReason(decisionPrimaryReason(decision), "-"), detail: decision.marketState?.phase ? titleize(decision.marketState.phase) : "-" }
      ]),
      makeSignalMiniChart(decision),
      makeTagList(tags)
    );
    return makeCard({
      title: decision.symbol || "-",
      detail: truncate(decision.summary || decision.operatorAction || decision.executionSummary || "Geen extra samenvatting."),
      body,
      tone: decision.allow ? "positive" : "negative"
    }, "signal-card");
  }));
}

function renderHealth(snapshot) {
  const dashboard = snapshot?.dashboard || {};
  const service = dashboard.ops?.service || {};
  const history = dashboard.marketHistory || {};
  const sourceReliability = dashboard.sourceReliability?.externalFeeds || {};
  const items = [
    { title: "Dashboard feeds", detail: compactJoin([titleize(service.status || "unknown"), service.note || null]), tone: service.status === "degraded" ? "negative" : "positive" },
    { title: "Market history", detail: compactJoin([titleize(history.status || "unknown"), history.note || null]), tone: history.status === "degraded" ? "negative" : "neutral" },
    { title: "External feeds", detail: compactJoin([`${sourceReliability.providerCount || 0} providers`, `avg ${formatPct(sourceReliability.averageScore || 0, 0)}`]), tone: Number(sourceReliability.degradedCount || 0) > 0 ? "warning" : "positive" }
  ];
  replaceChildren(elements.healthList, items.map((item) => makeCard(item, "detail-card")));
}

function renderLearning(snapshot) {
  const digest = buildLearningDigest(snapshot);
  replaceChildren(elements.learningList, digest.map((item) => makeCard(item, "detail-card")));
  const diagnostics = snapshot?.dashboard?.operatorDiagnostics || {};
  const cards = [
    { title: "Action items", detail: diagnostics.actionItems?.length ? diagnostics.actionItems.map((item) => item.title).slice(0, 2).join(" · ") : "Geen extra operator-diagnostiek." },
    { title: "Readiness", detail: compactJoin([titleize(snapshot?.dashboard?.ops?.readiness?.status || "unknown"), snapshot?.dashboard?.ops?.missedTradeTuning?.actionClass ? titleize(snapshot.dashboard.ops.missedTradeTuning.actionClass) : null]) }
  ];
  replaceChildren(elements.diagnosticsList, cards.map((item) => makeCard(item, "detail-card")));
}

function renderExplainability(snapshot) {
  const explainability = snapshot?.dashboard?.explainability || {};
  const replays = explainability.replays || [];
  const cards = replays.length
    ? replays.slice(0, 3).map((item) => makeCard({
        title: item.symbol || "Replay",
        detail: compactJoin([
          item.learningAttribution?.category ? titleize(item.learningAttribution.category) : null,
          item.attributionEvidence?.reasons?.[0] ? humanizeReason(item.attributionEvidence.reasons[0]) : null,
          item.exitReason ? `exit ${titleize(item.exitReason)}` : null
        ])
      }, "detail-card"))
    : [makeEmptyState("Nog geen replay of explainability-items.")];
  replaceChildren(elements.explainabilityList, cards);
}

function renderPromotion(snapshot) {
  const adaptiveLearning = snapshot?.dashboard?.adaptiveLearning || {};
  const offlineTrainer = snapshot?.dashboard?.offlineTrainer || {};
  const parameterOptimization = adaptiveLearning.parameterOptimization || offlineTrainer.parameterOptimization || {};
  const cards = [
    makeCard({
      title: "Promotion",
      detail: compactJoin([
        adaptiveLearning.modelRegistry?.status ? titleize(adaptiveLearning.modelRegistry.status) : null,
        adaptiveLearning.modelRegistry?.probationRequired ? "probation required" : null,
        adaptiveLearning.modelRegistry?.offlineTrainerReadiness ? titleize(adaptiveLearning.modelRegistry.offlineTrainerReadiness) : null
      ]) || "Geen promotion-signaal beschikbaar."
    }, "detail-card"),
    makeCard({
      title: "Parameter optimization",
      detail: compactJoin([
        parameterOptimization.topCandidate ? titleize(parameterOptimization.topCandidate) : null,
        parameterOptimization.livePromotionAllowed === false ? "live blocked" : null,
        parameterOptimization.note || null
      ]) || "Nog geen optimizer-kandidaat."
    }, "detail-card")
  ];
  replaceChildren(elements.promotionList, cards);
}

function render(snapshot) {
  renderBadges(snapshot);
  safeRenderSection("hero", () => renderHero(snapshot));
  safeRenderSection("overview", () => renderOverview(snapshot));
  safeRenderSection("attention", () => renderAttention(snapshot));
  safeRenderSection("quickActions", () => renderQuickActions(snapshot));
  safeRenderSection("focus", () => renderFocus(snapshot));
  safeRenderSection("positions", () => renderPositions(snapshot));
  safeRenderSection("recentTrades", () => renderRecentTrades(snapshot));
  safeRenderSection("opportunityBoard", () => renderOpportunityBoard(snapshot));
  safeRenderSection("health", () => renderHealth(snapshot));
  safeRenderSection("learning", () => renderLearning(snapshot));
  safeRenderSection("explainability", () => renderExplainability(snapshot));
  safeRenderSection("promotion", () => renderPromotion(snapshot));
  syncRenderHealthBanner(snapshot);
}

async function fetchSnapshot() {
  const epoch = ++requestEpoch;
  const payload = await api("/api/snapshot");
  if (epoch < latestAppliedEpoch) return;
  latestAppliedEpoch = epoch;
  latestSnapshot = pickSnapshot(payload);
  lastSnapshotReceivedAt = latestSnapshot?.generatedAt || new Date().toISOString();
  render(latestSnapshot);
}

async function dispatchQuickAction(action, target) {
  const normalized = `${action || ""}`.trim().toLowerCase();
  if (!normalized) return;
  const note = "dashboard quick action";
  if (normalized === "ack_alert") {
    await mutateAndRefresh("/api/alerts/ack", { id: target, note });
    return;
  }
  if (normalized === "force_reconcile") {
    await mutateAndRefresh("/api/ops/force-reconcile", { note: target ? `${note} (${target})` : note });
    return;
  }
  if (normalized === "reset_external_feeds") {
    await mutateAndRefresh("/api/diagnostics/action", { action: "reset_external_feeds", target, note });
    return;
  }
  if (normalized === "research_focus_symbol") {
    const symbol = `${target || ""}`.trim();
    await mutateAndRefresh("/api/research", { symbols: symbol ? [symbol] : [] });
    return;
  }
  if (normalized === "enable_probe_only") {
    await mutateAndRefresh("/api/ops/probe-only", { enabled: true, minutes: 90, note });
    return;
  }
  if (normalized === "refresh_analysis") {
    await mutateAndRefresh("/api/refresh", {});
    return;
  }
  console.warn?.("dashboard_unknown_quick_action", action);
}

function buildQuickActionRows(snapshot) {
  const fromSnapshot = arr(snapshot?.dashboard?.operatorDiagnostics?.quickActions);
  const hasForce = fromSnapshot.some((item) => item.action === "force_reconcile");
  const hasRefresh = fromSnapshot.some((item) => item.action === "refresh_analysis");
  const extras = [];
  if (!hasForce) {
    extras.push({
      action: "force_reconcile",
      target: null,
      label: "Force reconcile",
      detail: "Zet exchange truth op freeze en start lifecycle-reconcile (bij mismatch).",
      tone: "warning"
    });
  }
  if (!hasRefresh) {
    extras.push({
      action: "refresh_analysis",
      target: null,
      label: "Analyse verversen",
      detail: "Herbouw analyse-snapshot. Alleen als de bot gestopt is.",
      tone: "neutral"
    });
  }
  return [...fromSnapshot, ...extras];
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function renderQuickActions(snapshot) {
  if (!elements.quickActionsList) return;
  const rows = buildQuickActionRows(snapshot);
  if (!rows.length) {
    replaceChildren(elements.quickActionsList, [makeEmptyState("Geen snelle acties beschikbaar.")]);
    return;
  }
  replaceChildren(
    elements.quickActionsList,
    rows.map((item) => {
      const tone = item.tone || "neutral";
      const article = makeNode("article", { className: `quick-action ${toneClass(tone)}` });
      const head = makeNode("div", { className: "quick-action-text" });
      head.append(
        makeNode("h3", { text: item.label || titleize(item.action) || "Actie" }),
        item.detail ? makeNode("p", { text: item.detail }) : null
      );
      const btn = makeNode("button", { className: "ghost ghost-small", type: "button", text: "Uitvoeren" });
      btn.addEventListener("click", () => dispatchQuickAction(item.action, item.target).catch((error) => console.error?.("quick_action_failed", error)));
      article.append(head, btn);
      return article;
    })
  );
}

async function mutateAndRefresh(path, body = {}) {
  if (busy) return;
  busy = true;
  try {
    await api(path, { method: "POST", body });
    if (elements.controlHint) {
      elements.controlHint.textContent = "Actie uitgevoerd. Snapshot vernieuwd.";
    }
    await fetchSnapshot();
  } catch (error) {
    console.error?.("dashboard_mutation_failed", error);
    if (elements.controlHint) {
      elements.controlHint.textContent = `Actie mislukt: ${error?.message || "unknown error"}`;
    }
  } finally {
    busy = false;
  }
}

function bindUi() {
  elements.refreshBtn?.addEventListener?.("click", () => fetchSnapshot().catch((error) => showDashboardRenderIssue("refresh", error)));
  elements.startBtn?.addEventListener?.("click", () => mutateAndRefresh("/api/start"));
  elements.stopBtn?.addEventListener?.("click", () => mutateAndRefresh("/api/stop"));
  elements.paperBtn?.addEventListener?.("click", () => mutateAndRefresh("/api/mode", { mode: "paper" }));
  elements.liveBtn?.addEventListener?.("click", () => mutateAndRefresh("/api/mode", { mode: "live" }));
  elements.decisionSearch?.addEventListener?.("input", (event) => {
    searchQuery = `${event?.target?.value || ""}`.trim().toLowerCase();
    if (latestSnapshot) render(latestSnapshot);
  });
  elements.decisionAllowedOnly?.addEventListener?.("change", (event) => {
    allowedOnly = Boolean(event?.target?.checked);
    if (latestSnapshot) render(latestSnapshot);
  });
  elements.decisionShowMoreBtn?.addEventListener?.("click", () => {
    showAllDecisions = !showAllDecisions;
    writeStoredBoolean(STORAGE_KEYS.showAllDecisions, showAllDecisions);
    if (latestSnapshot) render(latestSnapshot);
  });
}

function initDashboard() {
  if (!activeDocument) return;
  elements = createElements(activeDocument);
  bindUi();
  fetchSnapshot().catch((error) => showDashboardRenderIssue("bootstrap", error));
  if (typeof window !== "undefined" && window?.setInterval) {
    window.setInterval(() => {
      fetchSnapshot().catch((error) => showDashboardRenderIssue("poll", error));
    }, POLL_MS);
  }
}

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this.className = "";
    this.textContent = "";
    this.checked = false;
    this.value = "";
    this.listeners = {};
    this.styleMap = {};
    this.style = {
      setProperty: (name, value) => {
        this.styleMap[name] = value;
      }
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = `${value}`;
    if (name === "id") {
      this.id = `${value}`;
      this.ownerDocument.register(this);
    }
  }

  append(...children) {
    this.children.push(...children.filter(Boolean));
  }

  replaceChildren(...children) {
    this.children = children.filter(Boolean);
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
}

class FakeDocument {
  constructor() {
    this.nodes = new Map();
  }

  createElement(tagName) {
    return new FakeNode(tagName, this);
  }

  register(node) {
    if (node?.id) this.nodes.set(node.id, node);
  }

  querySelector(selector) {
    if (!selector || !selector.startsWith("#")) return null;
    return this.nodes.get(selector.slice(1)) || null;
  }
}

function createFakeDashboardDocument() {
  const doc = new FakeDocument();
  [
    "modeBadge",
    "runStateBadge",
    "healthBadge",
    "refreshBadge",
    "controlHint",
    "operatorSummary",
    "startBtn",
    "stopBtn",
    "paperBtn",
    "liveBtn",
    "refreshBtn",
    "decisionSearch",
    "decisionAllowedOnly",
    "decisionMeta",
    "decisionShowMoreBtn",
    "overviewCards",
    "attentionList",
    "actionList",
    "quickActionsList",
    "focusList",
    "positionsList",
    "recentTradesList",
    "opportunityList",
    "healthList",
    "learningList",
    "diagnosticsList",
    "explainabilityList",
    "promotionList"
  ].forEach((id) => {
    const node = doc.createElement("div");
    node.setAttribute("id", id);
    if (id === "decisionAllowedOnly") node.checked = false;
  });
  return doc;
}

export function __dashboardSmokeRender(snapshot) {
  const previousDocument = activeDocument;
  const previousElements = elements;
  const previousSnapshot = latestSnapshot;
  const previousSearch = searchQuery;
  const previousAllowed = allowedOnly;
  const previousShowAll = showAllDecisions;
  renderFallbackSections.clear();
  try {
    activeDocument = createFakeDashboardDocument();
    elements = createElements(activeDocument);
    latestSnapshot = snapshot;
    searchQuery = "";
    allowedOnly = false;
    showAllDecisions = false;
    render(snapshot);
    return {
      renderIssueCount: renderFallbackSections.size,
      operatorSummaryChildren: elements.operatorSummary?.children?.length || 0,
      overviewCardCount: elements.overviewCards?.children?.length || 0,
      opportunityCount: elements.opportunityList?.children?.length || 0
    };
  } finally {
    renderFallbackSections.clear();
    activeDocument = previousDocument;
    elements = previousElements;
    latestSnapshot = previousSnapshot;
    searchQuery = previousSearch;
    allowedOnly = previousAllowed;
    showAllDecisions = previousShowAll;
  }
}

if (typeof document !== "undefined") {
  initDashboard();
}

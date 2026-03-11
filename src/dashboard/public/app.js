const POLL_MS = 5000;
const THEME_STORAGE_KEY = "dashboard-theme";
const DETAIL_STATE_STORAGE_KEY = "dashboard-detail-state";
const TOP_DECISION_RENDER_LIMIT = 6;
const BLOCKED_RENDER_LIMIT = 4;
const REPLAY_RENDER_LIMIT = 3;
const RECENT_TRADE_RENDER_LIMIT = 6;
const UNIVERSE_RENDER_LIMIT = 6;
const ATTRIBUTION_RENDER_LIMIT = 4;
const PNL_ATTRIBUTION_RENDER_LIMIT = 6;
const REGISTRY_RENDER_LIMIT = 4;

const elements = {
  modeBadge: document.querySelector("#modeBadge"),
  runStateBadge: document.querySelector("#runStateBadge"),
  healthBadge: document.querySelector("#healthBadge"),
  controlHint: document.querySelector("#controlHint"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  sidebarScrim: document.querySelector("#sidebarScrim"),
  themeDarkBtn: document.querySelector("#themeDarkBtn"),
  themeLightBtn: document.querySelector("#themeLightBtn"),
  metrics: document.querySelector("#metrics"),
  equityChart: document.querySelector("#equityChart"),
  equityMeta: document.querySelector("#equityMeta"),
  windowCards: document.querySelector("#windowCards"),
  aiSummary: document.querySelector("#aiSummary"),
  optimizerSummary: document.querySelector("#optimizerSummary"),
  streamSummary: document.querySelector("#streamSummary"),
  executionSummary: document.querySelector("#executionSummary"),
  portfolioSummary: document.querySelector("#portfolioSummary"),
  newsSummary: document.querySelector("#newsSummary"),
  marketStructureSummary: document.querySelector("#marketStructureSummary"),
  volatilitySummary: document.querySelector("#volatilitySummary"),
  calendarSummary: document.querySelector("#calendarSummary"),
  driftSummary: document.querySelector("#driftSummary"),
  safetySummary: document.querySelector("#safetySummary"),
  upcomingEventsList: document.querySelector("#upcomingEventsList"),
  officialNoticeList: document.querySelector("#officialNoticeList"),
  positionsList: document.querySelector("#positionsList"),
  decisionsList: document.querySelector("#decisionsList"),
  decisionSearch: document.querySelector("#decisionSearch"),
  decisionAllowedOnly: document.querySelector("#decisionAllowedOnly"),
  decisionMeta: document.querySelector("#decisionMeta"),
  blockedList: document.querySelector("#blockedList"),
  replayList: document.querySelector("#replayList"),
  tradesBody: document.querySelector("#tradesBody"),
  weightsList: document.querySelector("#weightsList"),
  eventsList: document.querySelector("#eventsList"),
  researchList: document.querySelector("#researchList"),
  universeSummary: document.querySelector("#universeSummary"),
  universeList: document.querySelector("#universeList"),
  attributionSummary: document.querySelector("#attributionSummary"),
  attributionList: document.querySelector("#attributionList"),
  pnlAttributionSummary: document.querySelector("#pnlAttributionSummary"),
  pnlAttributionList: document.querySelector("#pnlAttributionList"),
  governanceSummary: document.querySelector("#governanceSummary"),
  registryList: document.querySelector("#registryList"),
  opsSummary: document.querySelector("#opsSummary"),
  opsList: document.querySelector("#opsList"),
  startBtn: document.querySelector("#startBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  cycleBtn: document.querySelector("#cycleBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  researchBtn: document.querySelector("#researchBtn"),
  paperBtn: document.querySelector("#paperBtn"),
  liveBtn: document.querySelector("#liveBtn")
};

let latestSnapshot = null;
let busy = false;
let transientMessage = "";
let decisionSearchQuery = "";
let decisionAllowedOnly = false;
let snapshotEpoch = 0;

function readDetailState() {
  try {
    return JSON.parse(window.localStorage.getItem(DETAIL_STATE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function getDetailOpenState(key, defaultOpen = false) {
  if (!key) {
    return defaultOpen;
  }
  const state = readDetailState();
  return Object.prototype.hasOwnProperty.call(state, key) ? Boolean(state[key]) : defaultOpen;
}

function setDetailOpenState(key, open) {
  if (!key) {
    return;
  }
  const state = readDetailState();
  state[key] = Boolean(open);
  window.localStorage.setItem(DETAIL_STATE_STORAGE_KEY, JSON.stringify(state));
}

function detailAttrs(key, defaultOpen = false) {
  const attrs = [];
  if (key) {
    attrs.push(`data-detail-key="${escapeHtml(key)}"`);
  }
  if (getDetailOpenState(key, defaultOpen)) {
    attrs.push("open");
  }
  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

function bindPersistentDetails(root = document) {
  root.querySelectorAll("details[data-detail-key]").forEach((detail) => {
    if (detail.dataset.detailBound) {
      return;
    }
    detail.addEventListener("toggle", () => {
      setDetailOpenState(detail.dataset.detailKey || "", detail.open);
    });
    detail.dataset.detailBound = "true";
  });
}

const mobileSidebarMedia = window.matchMedia("(max-width: 1180px)");
let mobileSidebarOpen = false;

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMoney(value) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatPct(value, digits = 2) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function formatSignedPct(value, digits = 2) {
  const numeric = Number(value || 0);
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${(numeric * 100).toFixed(digits)}%`;
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function toneClass(value) {
  if (value > 0) {
    return "positive";
  }
  if (value < 0) {
    return "negative";
  }
  return "neutral";
}

function healthTone(value) {
  const normalized = `${value || "neutral"}`.toLowerCase();
  if (["hot", "healthy", "positive", "promotion_candidate", "promote", "keep", "prime", "ready", "confirmed", "paper_candidate", "active", "full", "clear", "delivered"].includes(normalized)) {
    return "positive";
  }
  if (["cold", "blocked", "negative", "hold", "paused", "relax", "cooldown", "shadow", "critical", "high", "failed"].includes(normalized)) {
    return "negative";
  }
  return "neutral";
}

function formatBreakdown(items = []) {
  return items.length
    ? items.map((item) => `${item.name}: ${item.count}`).join(" | ")
    : "Geen";
}

function renderDriverCards(items = [], emptyText = "Geen drivers beschikbaar.") {
  if (!items.length) {
    return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  }
  return items
    .map(
      (item) => `
        <div class="mini-stat">
          <span class="kicker">${escapeHtml(item.provider || item.source || "Nieuws")}</span>
          <strong>${escapeHtml(item.title || item.name || "Signaal")}</strong>
          <div class="meta">${escapeHtml(item.dominantEventType || "general")} | ${item.freshnessHours == null ? "-" : `${formatNumber(item.freshnessHours, 1)}u`}</div>
        </div>
      `
    )
    .join("");
}

function renderCalendarCards(items = [], emptyText = "Geen agenda-events beschikbaar.") {
  if (!items.length) {
    return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  }
  return items
    .map(
      (item) => `
        <div class="mini-stat">
          <span class="kicker">${escapeHtml(item.type || "event")}</span>
          <strong>${escapeHtml(item.title || item.nextEventTitle || "Kalender-event")}</strong>
          <div class="meta">${item.at ? formatDate(item.at) : "-"} | impact ${formatNumber(item.impact || item.riskScore || 0, 2)}</div>
        </div>
      `
    )
    .join("");
}

function renderAgentCards(items = [], emptyText = "Geen agent-signalen beschikbaar.") {
  if (!items.length) {
    return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  }
  return items
    .map(
      (item) => `
        <div class="mini-stat">
          <span class="kicker">${escapeHtml(item.label || item.id || "agent")}</span>
          <strong class="${item.direction === "bullish" ? "positive" : item.direction === "bearish" ? "negative" : "neutral"}">${formatNumber(item.stance || 0, 3)}</strong>
          <div class="meta">conf ${formatPct(item.confidence || 0, 1)} | ${escapeHtml((item.reasons || []).slice(0, 2).join(" | ") || "geen notities")}</div>
        </div>
      `
    )
    .join("");
}

function renderAttentionCards(items = [], emptyText = "Geen transformer-attention beschikbaar.") {
  if (!items.length) {
    return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  }
  return items
    .map(
      (item) => `
        <div class="mini-stat">
          <span class="kicker">Candle -${escapeHtml(item.offset ?? "?")}</span>
          <strong>${formatPct(item.weight || 0, 1)}</strong>
          <div class="meta">ret ${formatPct(item.returnPct || 0, 2)} | loc ${formatNumber(item.closeLocation || 0, 2)}</div>
        </div>
      `
    )
    .join("");
}

function renderStrategyCards(items = [], emptyText = "Geen strategy-ranking beschikbaar.") {
  if (!items.length) {
    return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  }
  return items
    .map(
      (item) => `
        <div class="mini-stat">
          <span class="kicker">${escapeHtml(item.label || item.id || "strategy")}</span>
          <strong>${formatPct(item.fitScore || 0, 1)}</strong>
          <div class="meta">${escapeHtml(item.familyLabel || item.family || "family")} | conf ${formatPct(item.confidence || 0, 1)} | hist ${item.historicalTradeCount || 0} trades | boost ${formatPct(item.optimizerBoost || 0, 1)}</div>
        </div>
      `
    )
    .join("");
}
function normalizeReasonLabel(value) {
  return `${value || ""}`.replaceAll("_", " ");
}

function renderTagList(items = [], emptyText = "Geen extra redenen") {
  if (!items.length) {
    return `<span class="empty">${escapeHtml(emptyText)}</span>`;
  }
  return items.map((item) => `<span class="note-pill">${escapeHtml(normalizeReasonLabel(item))}</span>`).join("");
}

function truncateText(value, maxLength = 220) {
  const input = `${value || ""}`.trim();
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength - 1).trimEnd()}�`;
}

function collectHighlights(items = [], limit = 4) {
  return items
    .filter((item) => item != null && `${item}`.trim())
    .slice(0, limit);
}

function renderReasonPills(items = [], emptyText = "Geen highlights", limit = 4) {
  return `<div class="tag-list compact-tags">${renderTagList(collectHighlights(items, limit), emptyText)}</div>`;
}

function renderDetailSection(title, meta, content, open = false, key = "") {
  return `
    <details class="detail-section"${detailAttrs(key, open)}>
      <summary class="detail-summary">
        <div class="detail-copy">
          <span class="detail-title">${escapeHtml(title)}</span>
          ${meta ? `<span class="detail-meta">${escapeHtml(meta)}</span>` : ""}
        </div>
      </summary>
      <div class="detail-body">${content}</div>
    </details>
  `;
}

function formatExecutionMeta(execution = {}) {
  if (!execution || (!execution.entryStyle && execution.expectedImpactBps == null && execution.realizedTouchSlippageBps == null)) {
    return "Geen execution-attributie";
  }
  const parts = [];
  if (execution.entryStyle) {
    parts.push(execution.entryStyle);
  }
  if (execution.realizedTouchSlippageBps != null) {
    parts.push(`slip ${formatNumber(execution.realizedTouchSlippageBps || 0, 2)} bps`);
  } else if (execution.expectedImpactBps != null) {
    parts.push(`impact ${formatNumber(execution.expectedImpactBps || 0, 2)} bps`);
  }
  if (execution.makerFillRatio != null) {
    parts.push(`maker ${formatPct(execution.makerFillRatio || 0, 1)}`);
  }
  if (execution.peggedOrder) {
    parts.push("pegged");
  }
  if (execution.preventedMatchCount) {
    parts.push(`stp ${execution.preventedMatchCount}`);
  }
  return parts.join(" | ");
}

function summarizeHealth(health) {
  if (health?.circuitOpen) {
    return "Circuit open";
  }
  if ((health?.warnings || []).length) {
    return "Waarschuwingen";
  }
  return "Gezond";
}

function setSidebarToggleLabel() {
  if (!elements.sidebarToggle) {
    return;
  }
  const collapsed = document.body.classList.contains("sidebar-collapsed");
  const open = document.body.classList.contains("sidebar-open");
  const label = mobileSidebarMedia.matches
    ? open ? "Sluit navigatie" : "Open navigatie"
    : collapsed ? "Zijbalk uitklappen" : "Zijbalk inklappen";
  elements.sidebarToggle.setAttribute("aria-label", label);
}

function applySidebarLayout() {
  if (mobileSidebarMedia.matches) {
    document.body.classList.remove("sidebar-collapsed");
    document.body.classList.toggle("sidebar-open", mobileSidebarOpen);
  } else {
    const collapsed = window.localStorage.getItem("dashboard-sidebar-collapsed") === "1";
    mobileSidebarOpen = false;
    document.body.classList.remove("sidebar-open");
    document.body.classList.toggle("sidebar-collapsed", collapsed);
  }
  setSidebarToggleLabel();
}

function setupSidebar() {
  if (!elements.sidebarToggle || !elements.sidebarScrim) {
    return;
  }

  if (!elements.sidebarToggle.dataset.bound) {
    elements.sidebarToggle.addEventListener("click", () => {
      if (mobileSidebarMedia.matches) {
        mobileSidebarOpen = !mobileSidebarOpen;
      } else {
        const nextCollapsed = !document.body.classList.contains("sidebar-collapsed");
        window.localStorage.setItem("dashboard-sidebar-collapsed", nextCollapsed ? "1" : "0");
      }
      applySidebarLayout();
    });

    elements.sidebarScrim.addEventListener("click", () => {
      mobileSidebarOpen = false;
      applySidebarLayout();
    });

    mobileSidebarMedia.addEventListener("change", () => {
      mobileSidebarOpen = false;
      applySidebarLayout();
    });

    const navLinks = [...document.querySelectorAll(".nav-links a")];
    navLinks.forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.forEach((candidate) => candidate.classList.remove("active"));
        link.classList.add("active");
        if (mobileSidebarMedia.matches) {
          mobileSidebarOpen = false;
          applySidebarLayout();
        }
      });
    });

    const initialLink = navLinks.find((link) => link.getAttribute("href") === (window.location.hash || "#metricsSection")) || navLinks[0];
    initialLink?.classList.add("active");

    elements.sidebarToggle.dataset.bound = "true";
  }

  applySidebarLayout();
}

function setupSidebarAccordion() {
  const groups = [...document.querySelectorAll(".nav-group")];
  if (!groups.length) {
    return;
  }

  const savedGroup = window.localStorage.getItem("dashboard-nav-group");
  groups.forEach((group, index) => {
    if (savedGroup) {
      group.open = group.dataset.navGroup === savedGroup;
    } else if (index === 0) {
      group.open = true;
    }

    if (group.dataset.accordionInit) {
      return;
    }

    group.addEventListener("toggle", () => {
      if (!group.open) {
        return;
      }
      groups.forEach((candidate) => {
        if (candidate !== group) {
          candidate.open = false;
        }
      });
      window.localStorage.setItem("dashboard-nav-group", group.dataset.navGroup || "overview");
    });
    group.dataset.accordionInit = "true";
  });
}

function applyTheme(theme) {
  const resolved = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = resolved;
  document.body.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  window.localStorage.setItem(THEME_STORAGE_KEY, resolved);
  elements.themeDarkBtn?.classList.toggle("is-active", resolved === "dark");
  elements.themeLightBtn?.classList.toggle("is-active", resolved === "light");
  elements.themeDarkBtn?.setAttribute("aria-pressed", String(resolved === "dark"));
  elements.themeLightBtn?.setAttribute("aria-pressed", String(resolved === "light"));
}

function setupThemeToggle() {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  const preferredTheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(savedTheme || document.documentElement.dataset.theme || document.body.dataset.theme || preferredTheme);

  if (!elements.themeDarkBtn?.dataset.bound) {
    elements.themeDarkBtn?.addEventListener("click", () => applyTheme("dark"));
    elements.themeLightBtn?.addEventListener("click", () => applyTheme("light"));
    if (elements.themeDarkBtn) {
      elements.themeDarkBtn.dataset.bound = "true";
    }
    if (elements.themeLightBtn) {
      elements.themeLightBtn.dataset.bound = "true";
    }
  }
}

function setupCollapsiblePanels() {
  document.querySelectorAll(".panel.collapsible").forEach((panel, index) => {
    const head = panel.querySelector(".section-head[data-collapsible='true']");
    if (!head) {
      return;
    }
    const title = head.querySelector("h2")?.textContent?.trim() || `panel-${index + 1}`;
    const keyBase = `${panel.id || title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const storageKey = `dashboard-collapse-${keyBase}`;
    if (!panel.dataset.collapseInit) {
      head.tabIndex = 0;
      head.setAttribute("role", "button");
      const syncState = () => {
        const collapsed = panel.classList.contains("is-collapsed");
        head.setAttribute("aria-expanded", String(!collapsed));
      };
      const toggle = () => {
        panel.classList.toggle("is-collapsed");
        const collapsed = panel.classList.contains("is-collapsed");
        window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
        syncState();
      };
      head.addEventListener("click", (event) => {
        if (event.target.closest("button, input, label, a, select, textarea")) {
          return;
        }
        toggle();
      });
      head.addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) {
          return;
        }
        event.preventDefault();
        toggle();
      });
      panel.dataset.collapseInit = "true";
      const storedState = window.localStorage.getItem(storageKey);
      if (storedState === "1" || (storedState == null && panel.dataset.defaultCollapsed === "true")) {
        panel.classList.add("is-collapsed");
      }
      syncState();
      return;
    }
    head.setAttribute("aria-expanded", String(!panel.classList.contains("is-collapsed")));
  });
}

async function api(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Request": "1"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function metricCard(label, value, foot, tone = "neutral") {
  return `
    <article class="metric-card panel">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value ${tone}">${escapeHtml(value)}</div>
      <div class="metric-foot">${escapeHtml(foot)}</div>
    </article>
  `;
}

function insightCard(label, value, meta, tone = "neutral") {
  return `
    <article class="insight-card">
      <div class="kicker">${escapeHtml(label)}</div>
      <strong class="${tone}">${escapeHtml(value)}</strong>
      <div class="meta">${escapeHtml(meta)}</div>
    </article>
  `;
}

function renderMetrics(snapshot) {
  const overview = snapshot.dashboard.overview;
  const report = snapshot.dashboard.report || {};
  const windows = report.windows || {};
  const today = windows.today || {};
  const days30 = windows.days30 || {};
  const universe = snapshot.dashboard.universe || {};
  const watchlist = snapshot.dashboard.watchlist || {};

  elements.metrics.innerHTML = [
    metricCard("Mode", snapshot.manager.currentMode.toUpperCase(), `Loop ${snapshot.manager.runState} | ${overview.openPositionCount || 0} open`),
    metricCard("Equity", formatMoney(overview.equity), `Open P/L ${formatMoney(overview.totalUnrealizedPnl)} | cash ${formatMoney(overview.quoteFree)}`, toneClass(overview.totalUnrealizedPnl)),
    metricCard("Vandaag", formatMoney(today.realizedPnl), `${today.tradeCount || 0} trades | win ${formatPct(today.winRate || 0, 1)}`, toneClass(today.realizedPnl)),
    metricCard("30 dagen", formatMoney(days30.realizedPnl), `${days30.tradeCount || 0} trades | win ${formatPct(days30.winRate || 0, 1)}`, toneClass(days30.realizedPnl)),
    metricCard("Universe", `${watchlist.resolvedCount || universe.configuredSymbolCount || 0} pairs`, `focus ${universe.selectedCount || 0} | ${(universe.rotation?.focusClusters || []).slice(0, 1).join(" / ") || "neutraal"}`)
  ].join("");
}
function buildSparkline(series) {
  if (!series.length) {
    return `<div class="empty">Nog geen equity-data beschikbaar.</div>`;
  }
  const values = series.map((item) => Number(item.equity || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 920;
  const height = 220;
  const pad = 20;
  const scaleX = (index) => pad + (index / Math.max(series.length - 1, 1)) * (width - pad * 2);
  const scaleY = (value) => {
    if (max === min) {
      return height / 2;
    }
    return height - pad - ((value - min) / (max - min)) * (height - pad * 2);
  };
  const line = values.map((value, index) => `${scaleX(index)},${scaleY(value)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Equity curve">
      <defs>
        <linearGradient id="eq-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(31,122,90,0.42)" />
          <stop offset="100%" stop-color="rgba(31,122,90,0.02)" />
        </linearGradient>
      </defs>
      <polygon points="${area}" fill="url(#eq-fill)"></polygon>
      <polyline points="${line}" fill="none" stroke="#1f7a5a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
      <text x="${pad}" y="18">Start ${escapeHtml(formatMoney(values[0]))}</text>
      <text x="${width - 150}" y="18">Nu ${escapeHtml(formatMoney(values.at(-1)))}</text>
      <text x="${pad}" y="${height - 4}">Min ${escapeHtml(formatMoney(min))}</text>
      <text x="${width - 150}" y="${height - 4}">Max ${escapeHtml(formatMoney(max))}</text>
    </svg>
  `;
}

function buildReplayChart(replay) {
  const candles = replay.candleContext || [];
  if (!candles.length) {
    return `<div class="empty">Nog geen replay-chart beschikbaar.</div>`;
  }

  const width = 560;
  const height = 190;
  const pad = 20;
  const candleGap = (width - pad * 2) / Math.max(candles.length, 1);
  const bodyWidth = Math.max(3, candleGap * 0.56);
  const lows = candles.map((item) => Number(item.low || item.close || 0));
  const highs = candles.map((item) => Number(item.high || item.close || 0));
  const extraPrices = [replay.entryPrice, replay.exitPrice].filter((value) => Number.isFinite(value));
  const minPrice = Math.min(...lows, ...(extraPrices.length ? extraPrices : [Math.min(...lows)]));
  const maxPrice = Math.max(...highs, ...(extraPrices.length ? extraPrices : [Math.max(...highs)]));
  const scaleY = (value) => {
    if (maxPrice === minPrice) {
      return height / 2;
    }
    return height - pad - ((value - minPrice) / (maxPrice - minPrice)) * (height - pad * 2);
  };
  const scaleX = (index) => pad + index * candleGap + candleGap / 2;
  const entryIndex = Math.max(0, candles.length - 1);
  const newsLabel = (replay.headlines || [])[0] || null;
  const blockerLabel = (replay.blockersAtEntry || [])[0] || null;
  const candleMarkup = candles
    .map((candle, index) => {
      const x = scaleX(index);
      const open = Number(candle.open || candle.close || 0);
      const close = Number(candle.close || candle.open || 0);
      const high = Number(candle.high || Math.max(open, close));
      const low = Number(candle.low || Math.min(open, close));
      const top = scaleY(Math.max(open, close));
      const bottom = scaleY(Math.min(open, close));
      const wickTop = scaleY(high);
      const wickBottom = scaleY(low);
      const up = close >= open;
      return `
        <g class="candle ${up ? "up" : "down"}">
          <line x1="${x}" x2="${x}" y1="${wickTop}" y2="${wickBottom}" class="candle-wick"></line>
          <rect x="${x - bodyWidth / 2}" y="${Math.min(top, bottom)}" width="${bodyWidth}" height="${Math.max(2, Math.abs(bottom - top))}" rx="2" class="candle-body"></rect>
        </g>
      `;
    })
    .join("");

  const entryY = scaleY(replay.entryPrice || candles.at(-1)?.close || minPrice);
  const exitY = scaleY(replay.exitPrice || replay.entryPrice || candles.at(-1)?.close || minPrice);

  return `
    <div class="replay-chart">
      <svg class="replay-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Trade replay chart">
        <defs>
          <linearGradient id="replay-grid" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="rgba(127, 147, 255, 0.12)" />
            <stop offset="100%" stop-color="rgba(89, 195, 178, 0.02)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${width}" height="${height}" fill="url(#replay-grid)"></rect>
        ${candleMarkup}
        <line x1="${scaleX(entryIndex)}" x2="${width - pad * 0.6}" y1="${entryY}" y2="${entryY}" class="marker-line entry"></line>
        <line x1="${scaleX(entryIndex)}" x2="${width - pad * 0.6}" y1="${exitY}" y2="${exitY}" class="marker-line exit"></line>
        <circle cx="${scaleX(entryIndex)}" cy="${entryY}" r="4.5" class="marker-dot entry"></circle>
        <circle cx="${width - pad}" cy="${exitY}" r="4.5" class="marker-dot exit"></circle>
        <text x="${pad}" y="16" class="marker-label">Entry ${formatNumber(replay.entryPrice || 0, 4)}</text>
        <text x="${width - 128}" y="16" class="marker-label">Exit ${formatNumber(replay.exitPrice || 0, 4)}</text>
      </svg>
      <div class="replay-overlay">
        <span class="summary-chip">${escapeHtml(newsLabel ? `nieuws: ${truncateText(newsLabel, 42)}` : "geen headline-overlay")}</span>
        <span class="summary-chip">${escapeHtml(blockerLabel ? `entry check: ${normalizeReasonLabel(blockerLabel)}` : "geen entry-blockers")}</span>
      </div>
    </div>
  `;
}
function renderChart(snapshot) {
  const series = snapshot.dashboard.report.equitySeries || [];
  const limit = snapshot.configSummary?.dashboardEquityPointLimit || series.length;
  elements.equityChart.innerHTML = buildSparkline(series);
  elements.equityMeta.textContent = `${series.length} datapunten | limiet ${limit}`;
}

function renderWindowCards(snapshot) {
  const order = ["today", "days7", "days15", "days30", "allTime"];
  const labels = {
    today: "Vandaag",
    days7: "7 dagen",
    days15: "15 dagen",
    days30: "30 dagen",
    allTime: "All-time"
  };
  elements.windowCards.innerHTML = order
    .map((key) => {
      const stats = snapshot.dashboard.report.windows[key] || {};
      return `
        <article class="window-card">
          <div class="kicker">${labels[key]}</div>
          <div class="metric-value ${toneClass(stats.realizedPnl || 0)}">${formatMoney(stats.realizedPnl)}</div>
          <div class="meta">${stats.tradeCount || 0} trades</div>
          <div class="meta">Win rate ${formatPct(stats.winRate || 0, 1)}</div>
          <div class="meta">Gem. trade ${formatPct(stats.averagePnlPct || 0, 2)}</div>
          <div class="meta">Profit factor ${stats.profitFactor == null ? "-" : formatNumber(stats.profitFactor, 2)}</div>
        </article>
      `;
    })
    .join("");
}

function renderPositions(snapshot) {
  const positions = snapshot.dashboard.positions || [];
  if (!positions.length) {
    elements.positionsList.innerHTML = `<div class="empty">Geen open posities.</div>`;
    return;
  }

  elements.positionsList.innerHTML = positions
    .map((position, index) => {
      const rationale = position.entryRationale || {};
      const lifecycle = position.lifecycle || {};
      const exitAi = position.latestExitIntelligence || {};
      const strategyLabel = rationale.strategy?.strategyLabel || position.strategyAtEntry || rationale.setupStyle || "-";
      const keyReasons = collectHighlights([
        exitAi.reason ? normalizeReasonLabel(exitAi.reason) : "positie nog geldig",
        ...(rationale.strategy?.reasons || []).slice(0, 1).map(normalizeReasonLabel),
        ...(rationale.executionReasons || []).slice(0, 1).map(normalizeReasonLabel),
        rationale.session?.sessionLabel || rationale.session?.session || ""
      ], 4);
      const riskReasons = collectHighlights([
        ...(exitAi.riskReasons || []).slice(0, 2).map(normalizeReasonLabel),
        ...(rationale.selfHealIssues || []).slice(0, 1).map(normalizeReasonLabel),
        ...(rationale.sessionBlockers || []).slice(0, 1).map(normalizeReasonLabel)
      ], 4);
      const headlines = (rationale.headlines || []).slice(0, 2).map((headline) => headline.title || headline);
      return `
        <details class="position-card fold-card compact-fold"${detailAttrs(`position:${position.symbol}`, false)}>
          <summary class="fold-summary">
            <div class="fold-header">
                <div>
                <div class="reason-pill">${escapeHtml(normalizeReasonLabel(lifecycle.state || "open"))}</div>
                <h3>${escapeHtml(position.symbol)}</h3>
                <p class="meta">${escapeHtml(strategyLabel)} | ${escapeHtml(position.regimeAtEntry || "-")} | ${formatNumber(position.ageMinutes, 1)} min</p>
                <p class="decision-blurb">${escapeHtml(truncateText(rationale.summary || "Positie actief.", 132))}</p>
              </div>
              <div class="fold-stats">
                <span class="pill ${toneClass(position.unrealizedPnl)}">${formatMoney(position.unrealizedPnl)} | ${formatPct(position.unrealizedPnlPct, 2)}</span>
                <span class="pill">${escapeHtml((exitAi.action || "hold").replaceAll("_", " "))}</span>
              </div>
            </div>
            <div class="summary-strip">${renderReasonPills(keyReasons, "Geen highlights")}</div>
          </summary>
          <div class="fold-body compact-body">
            <div class="mini-grid compact-data-grid">
              <div class="mini-stat"><span class="kicker">Entry</span><strong>${formatNumber(position.entryPrice, 6)}</strong></div>
              <div class="mini-stat"><span class="kicker">Nu</span><strong>${formatNumber(position.currentPrice, 6)}</strong></div>
              <div class="mini-stat"><span class="kicker">Stop</span><strong>${formatNumber(position.stopLossPrice, 6)}</strong></div>
              <div class="mini-stat"><span class="kicker">Exit AI</span><strong>${escapeHtml((exitAi.action || "hold").replaceAll("_", " "))}</strong><div class="meta">conf ${formatPct(exitAi.confidence || 0, 1)}</div></div>
            </div>
            <div class="note-line"><span class="kicker">Waarom open</span><div class="tag-list">${renderTagList(keyReasons, "Geen kernreden")}</div></div>
            <div class="note-line"><span class="kicker">Nu opletten</span><div class="tag-list">${renderTagList(riskReasons, "Geen directe waarschuwingen")}</div></div>
            <div class="note-line"><span class="kicker">Lifecycle</span><div class="tag-list">${renderTagList([lifecycle.state, lifecycle.operatorMode !== "normal" ? lifecycle.operatorMode : "", lifecycle.manualReviewRequired ? "manual_review" : "", lifecycle.reconcileRequired ? "reconcile_required" : "", lifecycle.managementFailureCount ? `${lifecycle.managementFailureCount} beheerfouten` : ""].filter(Boolean), "Normale runtime-state")}</div></div>
            <div class="note-line"><span class="kicker">Nieuws</span><div class="tag-list">${renderTagList(headlines, "Geen recente headlines")}</div></div>
          </div>
        </details>
      `;
    })
    .join("");
}
function renderDecisions(snapshot) {
  const decisions = snapshot.dashboard.topDecisions || [];
  const watchlist = snapshot.dashboard.watchlist || {};
  const decisionLimit = snapshot.configSummary?.dashboardDecisionLimit || 12;
  const filtered = decisions.filter((decision) => {
    const searchIndex = [
      decision.symbol,
      decision.setupStyle,
      decision.regime,
      decision.summary,
      decision.strategy?.strategyLabel,
      decision.strategy?.familyLabel,
      decision.entryStatus,
      ...(decision.reasons || []),
      ...(decision.blockerReasons || []),
      ...(decision.executionBlockers || [])
    ].filter(Boolean).join(" ").toLowerCase();
    const matchesQuery = !decisionSearchQuery || searchIndex.includes(decisionSearchQuery);
    const matchesMode = !decisionAllowedOnly || decision.allow;
    return matchesQuery && matchesMode;
  });

  if (elements.decisionMeta) {
    const watchMeta = watchlist.resolvedCount ? ` | universe ${watchlist.resolvedCount}/${watchlist.targetCount || watchlist.resolvedCount}` : "";
    elements.decisionMeta.textContent = `${filtered.length}/${decisions.length} setups zichtbaar${watchMeta}`;
  }

  if (!filtered.length) {
    elements.decisionsList.innerHTML = `<div class="empty">Geen setups voor deze filter.</div>`;
    return;
  }

  const statusMap = {
    opened: { label: "Opened", pill: "Open", tone: "positive" },
    eligible: { label: "Eligible", pill: "Ready", tone: "neutral" },
    standby: { label: "Standby", pill: "Wait", tone: "neutral" },
    runtime_blocked: { label: "Geblokkeerd", pill: "Blocked", tone: "negative" },
    entry_failed: { label: "Entry fout", pill: "Retry", tone: "negative" },
    blocked: { label: "Skip", pill: "Skip", tone: "negative" },
    opened_elsewhere: { label: "Andere setup", pill: "Wait", tone: "neutral" }
  };

  elements.decisionsList.innerHTML = filtered
    .slice(0, Math.min(decisionLimit, TOP_DECISION_RENDER_LIMIT))
    .map((decision) => {
      const edge = Number(decision.edgeToThreshold ?? (decision.probability || 0) - (decision.threshold || 0));
      const strategyLabel = decision.strategy?.strategyLabel || decision.strategySummary?.strategyLabel || decision.setupStyle || "setup";
      const familyLabel = decision.strategy?.familyLabel || decision.strategy?.family || "family";
      const leadBull = normalizeReasonLabel(decision.bullishSignals?.[0]?.name || decision.bullishDrivers?.[0]?.title || decision.reasons?.[0] || "sterkste driver");
      const leadBear = normalizeReasonLabel(decision.blockerReasons?.[0] || decision.bearishSignals?.[0]?.name || decision.bearishDrivers?.[0]?.title || "geen blocker");
      const leadExecutionBlocker = normalizeReasonLabel(decision.executionBlockers?.[0] || "niet uitgevoerd");
      const qualityScore = decision.meta?.qualityScore ?? decision.meta?.score ?? 0;
      const qualityBand = decision.meta?.qualityBand || (qualityScore >= 0.62 ? "sterk" : qualityScore >= 0.5 ? "ok" : "zwak");
      const quorumStatus = decision.qualityQuorum?.status || "ready";
      const quorumScore = decision.qualityQuorum?.quorumScore || 0;
      const entryStatus = decision.entryStatus || (decision.allow ? "eligible" : "blocked");
      const statusMeta = statusMap[entryStatus] || statusMap.blocked;
      let summary = `${strategyLabel} is overgeslagen. Hoofdreden: ${leadBear}.`;
      if (entryStatus === "opened") {
        summary = `${strategyLabel} is echt geopend. Hoofdreden: ${leadBull}.`;
      } else if (entryStatus === "eligible") {
        summary = `${strategyLabel} is eligible. Hoofdreden: ${leadBull}.`;
      } else if (entryStatus === "standby" || entryStatus === "opened_elsewhere") {
        summary = `${strategyLabel} was goed genoeg, maar een sterkere setup kreeg voorrang.`;
      } else if (entryStatus === "runtime_blocked") {
        summary = `${strategyLabel} was eligible, maar runtime blokkeerde de entry door ${leadExecutionBlocker}.`;
      } else if (entryStatus === "entry_failed") {
        summary = `${strategyLabel} was eligible, maar de entry faalde door ${leadExecutionBlocker}.`;
      }

      const keyPills = !decision.allow
        ? collectHighlights([leadBear, ...(decision.blockerReasons || []).slice(0, 2).map(normalizeReasonLabel)], 4)
        : entryStatus === "opened"
          ? collectHighlights([leadBull, strategyLabel, familyLabel, "positie geopend"], 4)
          : collectHighlights([leadBull, strategyLabel, familyLabel, statusMeta.label], 4);
      const compactView = `
        <div class="mini-grid compact-data-grid">
          <div class="mini-stat"><span class="kicker">Model / gate</span><strong>${formatPct(decision.probability || 0, 1)} / ${formatPct(decision.threshold || 0, 1)}</strong><div class="meta">edge ${formatSignedPct(edge, 1)}</div></div>
          <div class="mini-stat"><span class="kicker">Strategie</span><strong>${escapeHtml(strategyLabel)}</strong><div class="meta">${escapeHtml(familyLabel)}</div></div>
          <div class="mini-stat"><span class="kicker">Status</span><strong>${escapeHtml(statusMeta.label)}</strong><div class="meta">${escapeHtml(decision.executionStyle || decision.executionAttribution?.entryStyle || "market")}</div></div>
          <div class="mini-stat"><span class="kicker">Quality</span><strong>${formatPct(qualityScore || 0, 1)}</strong><div class="meta">${escapeHtml(qualityBand)}</div></div>
          <div class="mini-stat"><span class="kicker">Quorum</span><strong>${escapeHtml(quorumStatus)}</strong><div class="meta">${formatPct(quorumScore || 0, 1)}</div></div>
        </div>
        <div class="note-line"><span class="kicker">Waarom</span><div class="tag-list">${renderTagList(decision.allow ? [leadBull] : [leadBear, ...(decision.blockerReasons || []).slice(0, 2).map(normalizeReasonLabel)], "Geen kernreden")}</div></div>
        ${decision.paperExploration?.mode ? `<div class="note-line"><span class="kicker">Paper mode</span><div class="tag-list">${renderTagList([decision.paperExploration.mode === "paper_recovery_probe" ? "paper recovery probe" : "paper warm-up"], "Geen paper override")}</div></div>` : ""}
        ${decision.paperGuardrailRelief?.length ? `<div class="note-line"><span class="kicker">${decision.paperExploration?.mode === "paper_recovery_probe" ? "Recovery relief" : "Paper leniency"}</span><div class="tag-list">${renderTagList((decision.paperGuardrailRelief || []).slice(0, 3).map(normalizeReasonLabel), "Geen versoepeling")}</div></div>` : ""}
        ${decision.downtrendPolicy?.strongDowntrend ? `<div class="note-line"><span class="kicker">Bear market</span><div class="tag-list">${renderTagList([decision.downtrendPolicy?.shortingUnavailable ? "spot-only defensive mode" : "shorting available", `${formatPct(decision.downtrendPolicy?.downtrendScore || 0, 1)} downtrend`], "Geen bear-market context")}</div></div>` : ""}
        ${decision.qualityQuorum?.blockerReasons?.length || decision.qualityQuorum?.cautionReasons?.length ? `<div class="note-line"><span class="kicker">Data quorum</span><div class="tag-list">${renderTagList([...(decision.qualityQuorum?.blockerReasons || []), ...(decision.qualityQuorum?.cautionReasons || [])].slice(0, 3).map(normalizeReasonLabel), "Quorum ready")}</div></div>` : ""}
        ${decision.allow && decision.executionBlockers?.length ? `<div class="note-line"><span class="kicker">Niet uitgevoerd door</span><div class="tag-list">${renderTagList((decision.executionBlockers || []).slice(0, 3).map(normalizeReasonLabel), "Geen runtime blocker")}</div></div>` : ""}
      `;
      const contextView = `
        <div class="mini-grid compact-data-grid">
          <div class="mini-stat"><span class="kicker">Book</span><strong>${formatNumber(decision.orderBook?.bookPressure || 0, 2)}</strong></div>
          <div class="mini-stat"><span class="kicker">Funding</span><strong>${formatNumber(decision.marketStructure?.fundingRate || 0, 6)}</strong></div>
          <div class="mini-stat"><span class="kicker">Session</span><strong>${escapeHtml(decision.session?.sessionLabel || decision.session?.session || "-")}</strong></div>
          <div class="mini-stat"><span class="kicker">Nieuws</span><strong>${decision.providerDiversity || 0} bronnen</strong><div class="meta">rel ${formatPct(decision.reliabilityScore || 0, 1)}</div></div>
          <div class="mini-stat"><span class="kicker">Pair health</span><strong>${escapeHtml(decision.pairHealth?.health || "-")}</strong><div class="meta">${formatPct(decision.pairHealth?.score || 0, 1)}</div></div>
          <div class="mini-stat"><span class="kicker">Quorum</span><strong>${escapeHtml(quorumStatus)}</strong><div class="meta">${(decision.qualityQuorum?.observeOnly) ? "observe-only" : "entry ok"}</div></div>
        </div>
      `;
      return `
        <details class="decision-card fold-card compact-fold ${decision.allow ? "allowed" : "blocked"}"${detailAttrs(`decision:${decision.symbol}:${entryStatus}`, false)}>
          <summary class="fold-summary">
            <div class="fold-header">
              <div>
                <div class="reason-pill ${statusMeta.tone === "negative" ? "blocked" : ""}">${escapeHtml(statusMeta.label)}</div>
                <h3>${escapeHtml(decision.symbol)}</h3>
                <p class="meta">${escapeHtml(strategyLabel)} | ${escapeHtml(decision.regime || "unknown")}</p>
                <p class="decision-blurb">${escapeHtml(summary)}</p>
              </div>
              <div class="fold-stats">
                <span class="pill ${statusMeta.tone}">${escapeHtml(statusMeta.pill)}</span>
                <span class="pill">${formatPct(decision.probability || 0, 1)}</span>
              </div>
            </div>
            <div class="summary-strip">${renderReasonPills(keyPills, "Geen highlights")}</div>
          </summary>
          <div class="fold-body compact-body">
            ${compactView}
            ${renderDetailSection("Meer context", "Alleen de kernsignalen", contextView, false, `decision-context:${decision.symbol}:${entryStatus}`)}
          </div>
        </details>
      `;
    })
    .join("");
}
function renderTrades(snapshot) {
  const trades = snapshot.dashboard.report.recentTrades || [];
  if (!trades.length) {
    elements.tradesBody.innerHTML = `<tr><td colspan="8" class="empty">Nog geen gesloten trades.</td></tr>`;
    return;
  }

  elements.tradesBody.innerHTML = trades
    .slice(0, RECENT_TRADE_RENDER_LIMIT)
    .map(
      (trade) => `
        <tr>
          <td>${escapeHtml(trade.symbol)}</td>
          <td>${formatDate(trade.entryAt)}</td>
          <td>${formatDate(trade.exitAt)}</td>
          <td>${escapeHtml(trade.entryExecutionAttribution?.entryStyle || "-")}</td>
          <td>${escapeHtml(trade.reason || "-")}</td>
          <td class="${toneClass(trade.pnlQuote)}">${formatMoney(trade.pnlQuote)}</td>
          <td class="${toneClass(trade.netPnlPct)}">${formatPct(trade.netPnlPct, 2)}</td>
          <td>${escapeHtml(formatExecutionMeta(trade.exitExecutionAttribution?.entryStyle ? trade.exitExecutionAttribution : trade.entryExecutionAttribution))}</td>
        </tr>
      `
    )
    .join("");
}

function renderTextList(items = []) {
  return items.length ? items.join(" | ") : "Geen";
}
function renderIntelligence(snapshot) {
  const calibration = snapshot.dashboard.ai?.calibration || {};
  const deployment = snapshot.dashboard.ai?.deployment || {};
  const stream = snapshot.dashboard.stream || {};
  const universe = snapshot.dashboard.universe || {};
  const exchange = snapshot.dashboard.exchange || {};
  const marketStructure = snapshot.dashboard.marketStructure || {};
  const volatility = snapshot.dashboard.volatility || {};
  const marketSentiment = snapshot.dashboard.marketSentiment || {};
  const safety = snapshot.dashboard.safety || {};
  const drift = safety.drift || {};
  const selfHeal = safety.selfHeal || {};
  const backups = safety.backups || {};
  const recovery = safety.recovery || {};
  const topDecision = (snapshot.dashboard.topDecisions || [])[0] || {};
  const modelRegistry = snapshot.dashboard.ai?.modelRegistry || {};
  const executionReport = snapshot.dashboard.report?.executionSummary || {};
  const rotation = universe.rotation || {};
  const leadStyle = executionReport.styles?.[0] || {};
  const leadStrategy = executionReport.strategies?.[0] || {};
  const promotionPolicy = modelRegistry.promotionPolicy || {};

  elements.aiSummary.innerHTML = [
    insightCard("Model", (deployment.active || "champion").toUpperCase(), `${deployment.shadowTradeCount || 0} shadow trades`),
    insightCard("Calibration", `${formatNumber((calibration.expectedCalibrationError || 0) * 100, 1)}% ECE`, `${calibration.observations || 0} observaties`, (calibration.expectedCalibrationError || 0) < 0.1 ? "positive" : "neutral"),
    insightCard("Trade quality", `${formatPct(topDecision.meta?.qualityScore || topDecision.meta?.score || 0, 1)}`, topDecision.meta?.qualityBand || "nog geen quality band", (topDecision.meta?.qualityScore || topDecision.meta?.score || 0) >= 0.58 ? "positive" : "neutral"),
    insightCard("Promotie", promotionPolicy.readyLevel || "observe", promotionPolicy.allowPromotion ? "challenger mag promoveren" : (promotionPolicy.blockerReasons || [])[0] || "nog niet klaar", promotionPolicy.allowPromotion ? "positive" : "neutral")
  ].join("");

  elements.optimizerSummary.innerHTML = [
    insightCard("Strategie", topDecision.strategy?.strategyLabel || snapshot.dashboard.ai?.strategy?.strategyLabel || "-", `fit ${formatPct(topDecision.strategy?.fitScore || snapshot.dashboard.ai?.strategy?.fitScore || 0, 1)}`),
    insightCard("Universe rotatie", (rotation.focusClusters || []).slice(0, 2).join(" / ") || "standaard", rotation.note || "geen cluster-tilt actief"),
    insightCard("Registry", `${modelRegistry.registrySize || 0} snapshots`, modelRegistry.rollbackCandidate?.at ? `rollback ${formatDate(modelRegistry.rollbackCandidate.at)}` : "geen rollback-kandidaat")
  ].join("");

  elements.streamSummary.innerHTML = [
    insightCard("Streams", stream.publicStreamConnected ? "verbonden" : "offline", stream.lastPublicMessageAt ? `laatste ${formatDate(stream.lastPublicMessageAt)}` : "nog geen tick", stream.publicStreamConnected ? "positive" : "negative"),
    insightCard("Local book", `${stream.localBook?.healthySymbols || 0}/${stream.localBook?.activeSymbols || 0}`, `conf ${formatNumber(stream.localBook?.averageDepthConfidence || 0, 2)}`),
    insightCard("User stream", stream.userStreamConnected ? "verbonden" : "inactief", stream.lastUserMessageAt ? `laatste ${formatDate(stream.lastUserMessageAt)}` : "geen account-events", stream.userStreamConnected ? "positive" : "neutral")
  ].join("");

  elements.executionSummary.innerHTML = [
    insightCard("Slip delta", `${formatNumber(executionReport.avgSlippageDeltaBps || 0, 2)} bps`, `verwacht ${formatNumber(executionReport.avgExpectedEntrySlippageBps || 0, 2)} | echt ${formatNumber(executionReport.avgEntryTouchSlippageBps || 0, 2)}`, (executionReport.avgSlippageDeltaBps || 0) <= 0.8 ? "positive" : "neutral"),
    insightCard("Maker efficiency", `${formatPct(executionReport.avgMakerFillRatio || 0, 1)}`, `${leadStyle.style || "-"} | ${leadStyle.tradeCount || 0} trades`, (executionReport.avgMakerFillRatio || 0) >= 0.35 ? "positive" : "neutral"),
    insightCard("Beste exec strategy", leadStrategy.id || "-", leadStrategy.id ? `${formatMoney(leadStrategy.realizedPnl || 0)} | q ${formatPct(leadStrategy.averageExecutionQuality || 0, 1)}` : "nog geen execution history")
  ].join("");

  elements.portfolioSummary.innerHTML = [
    insightCard("Focus cluster", (rotation.focusClusters || [])[0] || "-", rotation.focusReason || "geen cluster-focus actief"),
    insightCard("Cooling clusters", `${(rotation.coolingClusters || []).length}`, (rotation.coolingClusters || []).slice(0, 2).join(" / ") || "geen afkoeling"),
    insightCard("Universe", `${universe.selectedCount || 0}/${universe.configuredSymbolCount || 0}`, universe.suggestions?.[0] || "geen universe-opmerking")
  ].join("");

  elements.newsSummary.innerHTML = [
    insightCard("Nieuws", `${topDecision.providerDiversity || 0} bronnen`, topDecision.dominantEventType || "geen dominant event"),
    insightCard("Futures", `${formatNumber(marketStructure.fundingRate || 0, 6)}`, (marketStructure.reasons || []).slice(0, 2).join(" | ") || "rustige perp-structuur"),
    insightCard("Macro", marketSentiment.fearGreedValue == null ? "-" : `${formatNumber(marketSentiment.fearGreedValue, 1)}`, marketSentiment.fearGreedClassification || "fear/greed")
  ].join("");

  elements.marketStructureSummary.innerHTML = [
    insightCard("Liquidaties", `${marketStructure.liquidationCount || 0}`, `${formatMoney(marketStructure.liquidationNotional || 0)} | risk ${formatNumber(marketStructure.riskScore || 0, 2)}`),
    insightCard("Open interest", `${formatPct(marketStructure.openInterestChangePct || 0, 2)}`, `long/short ${formatNumber(marketStructure.longShortRatio || 0, 2)}`),
    insightCard("Crowding", `${formatNumber(marketStructure.crowdingBias || 0, 2)}`, (marketStructure.reasons || []).slice(0, 2).join(" | ") || "geen crowding signaal")
  ].join("");

  elements.volatilitySummary.innerHTML = [
    insightCard("Vol regime", volatility.regime || "unknown", volatility.marketOptionIv == null ? "geen Deribit context" : `IV ${formatNumber(volatility.marketOptionIv, 1)} | premium ${formatNumber(volatility.ivPremium || 0, 1)}`),
    insightCard("Vol risk", `${formatPct(volatility.riskScore || 0, 1)}`, (volatility.reasons || []).slice(0, 2).join(" | ") || "geen extra vol-signalen"),
    insightCard("Exchange notices", `${exchange.coverage || 0}`, exchange.categoryCounts ? formatBreakdown(exchange.categoryCounts) : "geen officiele notices")
  ].join("");

  elements.calendarSummary.innerHTML = [
    insightCard("Volgend event", snapshot.dashboard.calendar?.nextEventTitle || "-", snapshot.dashboard.calendar?.nextEventType || "geen event"),
    insightCard("Proximity", snapshot.dashboard.calendar?.proximityHours == null ? "-" : `${formatNumber(snapshot.dashboard.calendar.proximityHours, 1)}u`, `risk ${formatNumber(snapshot.dashboard.calendar?.riskScore || 0, 2)}`),
    insightCard("Upcoming", `${(snapshot.dashboard.upcomingEvents || []).length}`, `${(snapshot.dashboard.officialNotices || []).length} notices`)
  ].join("");

  elements.driftSummary.innerHTML = [
    insightCard("Drift", (drift.status || "normal").toUpperCase(), `sev ${formatPct(drift.severity || 0, 1)}`, (drift.severity || 0) >= 0.45 ? "negative" : "positive"),
    insightCard("Feature drift", `${formatPct(drift.featureDriftScore || 0, 1)}`, `source ${formatPct(drift.sourceDriftScore || 0, 1)}`),
    insightCard("Execution drift", `${formatPct(drift.executionScore || 0, 1)}`, `perf ${formatPct(drift.performanceScore || 0, 1)}`)
  ].join("");

  elements.safetySummary.innerHTML = [
    insightCard("Self-heal", (selfHeal.mode || "normal").replaceAll("_", " "), selfHeal.learningAllowed ? `${selfHeal.reason || "guard"} | paper learning actief` : (selfHeal.reason || "geen actieve guard"), selfHeal.active ? "neutral" : "positive"),
    insightCard("Recorder", `${(snapshot.dashboard.dataRecorder || {}).filesWritten || 0} writes`, (snapshot.dashboard.dataRecorder || {}).lastRecordAt ? `laatst ${formatDate((snapshot.dashboard.dataRecorder || {}).lastRecordAt)}` : "nog geen data"),
    insightCard("Backups", `${backups.backupCount || 0}`, backups.lastBackupAt ? `laatst ${formatDate(backups.lastBackupAt)}` : "nog geen backup"),
    insightCard("Recovery", recovery.uncleanShutdownDetected ? "waarschuwing" : "schoon", recovery.restoredFromBackupAt ? `restore ${formatDate(recovery.restoredFromBackupAt)}` : "geen herstel nodig", recovery.uncleanShutdownDetected ? "negative" : "positive")
  ].join("");

  const upcomingEvents = snapshot.dashboard.upcomingEvents || [];
  elements.upcomingEventsList.innerHTML = upcomingEvents.length
    ? upcomingEvents
        .map((event) => `
          <div class="event-row compact-row">
            <div class="kicker">${escapeHtml(event.type || "event")}</div>
            <div>${escapeHtml(event.title || event.nextEventTitle || "Kalender-event")}</div>
            <div class="meta">${event.at ? formatDate(event.at) : "-"}</div>
          </div>
        `)
        .join("")
    : `<div class="empty">Geen komende events.</div>`;

  const officialNotices = snapshot.dashboard.officialNotices || [];
  elements.officialNoticeList.innerHTML = officialNotices.length
    ? officialNotices
        .map((item) => `
          <div class="event-row compact-row">
            <div class="kicker">${escapeHtml(item.dominantEventType || item.provider || "notice")}</div>
            <div>${escapeHtml(item.title || "Official notice")}</div>
            <div class="meta">${formatDate(item.publishedAt)}</div>
          </div>
        `)
        .join("")
    : `<div class="empty">Geen officiele Binance notices.</div>`;
}
function renderWeights(snapshot) {
  const weights = snapshot.dashboard.modelWeights || [];
  elements.weightsList.innerHTML = weights.length
    ? weights
        .map(
          (weight) => `
            <div class="weight-row">
              <div class="kicker">${escapeHtml(weight.name)}</div>
              <div class="metric-value ${toneClass(weight.weight)}">${formatNumber(weight.weight, 4)}</div>
            </div>
          `
        )
        .join("")
    : `<div class="empty">Nog geen modelgewichten beschikbaar.</div>`;
}

function renderEvents(snapshot) {
  const events = snapshot.dashboard.report.recentEvents || [];
  elements.eventsList.innerHTML = events.length
    ? events
        .map(
          (event) => `
            <div class="event-row">
              <div class="kicker">${escapeHtml(event.type || "event")}</div>
              <div>${escapeHtml(event.symbol || event.error || event.rationale || "Runtime update")}</div>
              <div class="meta">${formatDate(event.at)}</div>
            </div>
          `
        )
        .join("")
    : `<div class="empty">Nog geen runtime-events.</div>`;
}

function renderTimelineRows(items = [], emptyText = "Nog geen timeline-data.") {
  if (!items.length) {
    return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  }
  return `<div class="timeline">${items
    .map(
      (item) => `
        <div class="timeline-row">
          <div class="kicker">${escapeHtml(item.label || item.type || "moment")}</div>
          <div class="meta">${formatDate(item.at)}</div>
          <div>${escapeHtml(item.detail || item.reason || "-")}</div>
        </div>
      `
    )
    .join("")}</div>`;
}

function renderBlockedSetups(snapshot) {
  const blocked = snapshot.dashboard.blockedSetups || [];
  elements.blockedList.innerHTML = blocked.length
    ? blocked
        .slice(0, BLOCKED_RENDER_LIMIT)
        .map(
          (item, index) => {
            const mainReason = normalizeReasonLabel(item.blockerReasons?.[0] || item.reasons?.[0] || "geen duidelijke blocker");
            const qualityScore = item.meta?.qualityScore ?? item.meta?.score ?? 0;
            return `
              <details class="blocked-card fold-card blocked compact-fold"${detailAttrs(`blocked:${item.symbol || "setup"}:${index}`, false)}>
                <summary class="fold-summary">
                  <div class="fold-header">
                    <div>
                      <div class="reason-pill blocked">No trade</div>
                      <h3>${escapeHtml(item.symbol || "setup")}</h3>
                      <p class="meta">${escapeHtml(item.strategy?.strategyLabel || item.setupStyle || "Geblokkeerde setup")} | ${escapeHtml(item.regime || "unknown")}</p>
                      <p class="decision-blurb">${escapeHtml(`Hoofdreden: ${mainReason}.`)}</p>
                    </div>
                    <div class="fold-stats">
                      <span class="pill negative">${formatPct(item.probability || 0, 1)}</span>
                      <span class="pill">q ${formatPct(qualityScore || 0, 1)}</span>
                    </div>
                  </div>
                </summary>
                <div class="fold-body compact-body">
                  <div class="note-line"><span class="kicker">Blockers</span><div class="tag-list">${renderTagList((item.blockerReasons || item.reasons || []).slice(0, REPLAY_RENDER_LIMIT).map(normalizeReasonLabel), "Geen blockers")}</div></div>
                  ${item.paperExploration?.mode ? `<div class="note-line"><span class="kicker">Paper mode</span><div class="tag-list">${renderTagList([item.paperExploration.mode === "paper_recovery_probe" ? "paper recovery probe" : "paper warm-up"], "Geen paper override")}</div></div>` : ""}
                  ${item.paperGuardrailRelief?.length ? `<div class="note-line"><span class="kicker">${item.paperExploration?.mode === "paper_recovery_probe" ? "Recovery relief" : "Paper leniency"}</span><div class="tag-list">${renderTagList((item.paperGuardrailRelief || []).slice(0, REPLAY_RENDER_LIMIT).map(normalizeReasonLabel), "Geen versoepeling")}</div></div>` : ""}
                  ${item.downtrendPolicy?.strongDowntrend ? `<div class="note-line"><span class="kicker">Bear market</span><div class="tag-list">${renderTagList([item.downtrendPolicy?.shortingUnavailable ? "spot-only defensive mode" : "shorting available", `${formatPct(item.downtrendPolicy?.downtrendScore || 0, 1)} downtrend`], "Geen bear-market context")}</div></div>` : ""}
                  <div class="note-line"><span class="kicker">Data quorum</span><div class="tag-list">${renderTagList([...(item.qualityQuorum?.blockerReasons || []), ...(item.qualityQuorum?.cautionReasons || [])].slice(0, REPLAY_RENDER_LIMIT).map(normalizeReasonLabel), item.qualityQuorum?.status || "Quorum ready")}</div></div>
                  <div class="note-line"><span class="kicker">Safety</span><div class="tag-list">${renderTagList([...(item.selfHealIssues || []), ...(item.sessionBlockers || []), ...(item.driftBlockers || [])].slice(0, REPLAY_RENDER_LIMIT).map(normalizeReasonLabel), "Geen extra safety-flags")}</div></div>
                </div>
              </details>
            `;
          }
        )
        .join("")
    : `<div class="empty">Geen recente geblokkeerde setups.</div>`;
}
function renderTradeReplays(snapshot) {
  const replays = snapshot.dashboard.tradeReplays || [];
  elements.replayList.innerHTML = replays.length
    ? replays
        .slice(0, REPLAY_RENDER_LIMIT)
        .map(
          (trade, index) => `
            <details class="replay-card fold-card compact-fold"${detailAttrs(`replay:${trade.symbol || "trade"}:${trade.entryAt || index}`, false)}>
              <summary class="fold-summary">
                <div class="fold-header">
                  <div>
                    <div class="kicker">${escapeHtml(trade.symbol || "trade")}</div>
                    <h3>${escapeHtml(trade.strategy || trade.regime || "Trade replay")}</h3>
                    <p class="meta">${escapeHtml(trade.regime || "-")} | ${formatDate(trade.entryAt)} -> ${formatDate(trade.exitAt)}</p>
                  </div>
                  <div class="fold-stats">
                    <span class="pill ${toneClass(trade.pnlQuote || 0)}">${formatMoney(trade.pnlQuote || 0)}</span>
                    <span class="pill">${formatPct(trade.netPnlPct || 0, 2)}</span>
                  </div>
                </div>
              </summary>
              <div class="fold-body compact-body">
                ${buildReplayChart(trade)}
                <div class="mini-grid compact-data-grid">
                  <div class="mini-stat"><span class="kicker">Entry</span><strong>${escapeHtml(trade.entryExecution?.entryStyle || "-")}</strong></div>
                  <div class="mini-stat"><span class="kicker">Exit</span><strong>${escapeHtml(trade.reason || trade.whyClosed || "-")}</strong></div>
                  <div class="mini-stat"><span class="kicker">Exit AI</span><strong>${escapeHtml((trade.exitIntelligence?.action || "hold").replaceAll("_", " "))}</strong></div>
                  <div class="mini-stat"><span class="kicker">Duur</span><strong>${formatNumber(trade.durationMinutes || 0, 1)} min</strong></div>
                </div>
                <div class="note-line"><span class="kicker">Waarom open</span><div class="tag-list">${renderTagList([trade.whyOpened].filter(Boolean), "Geen entry-uitleg")}</div></div>
                <div class="note-line"><span class="kicker">Waarom dicht</span><div class="tag-list">${renderTagList([trade.whyClosed].filter(Boolean), "Geen exit-reden")}</div></div>
                <div class="note-line"><span class="kicker">Veto chain</span><div class="tag-list">${renderTagList((trade.vetoChain || []).slice(0, 3), "Geen blockers bij entry")}</div></div>
                <div class="note-line"><span class="kicker">Alt exits</span><div class="tag-list">${renderTagList((trade.alternateExits || []).map((item) => `${normalizeReasonLabel(item.label)} ${formatNumber(item.price || 0, 6)}`).slice(0, 3), "Geen alternate exits")}</div></div>
                <div class="note-line"><span class="kicker">Nieuws</span><div class="tag-list">${renderTagList((trade.headlines || []).slice(0, 2), "Geen nieuws-overlay")}</div></div>
                ${renderDetailSection("Timeline", "Open, schaal uit en sluit", renderTimelineRows(trade.timeline || [], "Nog geen replay-timeline."), false, `replay-timeline:${trade.symbol || "trade"}:${trade.entryAt || index}`)}
              </div>
            </details>
          `
        )
        .join("")
    : `<div class="empty">Nog geen trade replays beschikbaar.</div>`;
}
function renderResearch(snapshot) {
  const research = snapshot.dashboard.research;
  const strategyResearch = snapshot.dashboard.strategyResearch || {};
  if (!research?.generatedAt && !strategyResearch?.generatedAt) {
    elements.researchList.innerHTML = `<div class="empty">Nog geen research-run uitgevoerd.</div>`;
    return;
  }

  const leadReport = (research.reports || [])[0] || {};
  const leadExperiments = (leadReport.experiments || []).slice(0, REPLAY_RENDER_LIMIT).map((item) => ({
    label: `${item.tradeCount || 0} trades`,
    at: item.testEndAt || research.generatedAt,
    detail: `${formatMoney(item.realizedPnl || 0)} | win ${formatPct(item.winRate || 0, 1)} | sharpe ${formatNumber(item.sharpe || 0, 2)}${item.strategyLeaders?.length ? ` | ${item.strategyLeaders.join(", ")}` : ""}`
  }));
  const leadCandidate = (strategyResearch.approvedCandidates || [])[0] || (strategyResearch.candidates || [])[0] || {};
  const candidateRows = (strategyResearch.candidates || []).slice(0, 3).map((item) => ({
    label: item.label || item.id || "candidate",
    at: strategyResearch.generatedAt,
    detail: `${item.status || "observe"} | score ${formatPct(item.score?.overall || 0, 1)} | stress ${formatPct(item.stress?.survivalScore || 0, 1)}`
  }));

  elements.researchList.innerHTML = `
    <article class="research-card">
      <div class="section-head compact">
        <div>
          <div class="kicker">Laatste research</div>
          <h3>${escapeHtml(research.bestSymbol || leadReport.symbol || "Research lab")}</h3>
        </div>
        <div class="meta">${formatDate(research.generatedAt)}</div>
      </div>
      <div class="driver-grid">
        <div class="mini-stat"><span class="kicker">Symbols</span><strong>${research.symbolCount || 0}</strong><div class="meta">beste ${escapeHtml(research.bestSymbol || "-")}</div></div>
        <div class="mini-stat"><span class="kicker">Trades</span><strong>${research.totalTrades || 0}</strong><div class="meta">PnL ${formatMoney(research.realizedPnl || 0)}</div></div>
        <div class="mini-stat"><span class="kicker">Winrate</span><strong>${formatPct(research.averageWinRate || 0, 1)}</strong><div class="meta">Sharpe ${formatNumber(research.averageSharpe || 0, 2)}</div></div>
      </div>
      <div class="note-line"><span class="kicker">Lead report</span><div class="tag-list">${renderTagList((leadReport.experiments || []).flatMap((item) => item.strategyLeaders || []).slice(0, BLOCKED_RENDER_LIMIT), "Nog geen strategy leaders")}</div></div>
      ${renderTimelineRows(leadExperiments, "Nog geen experiment-vensters beschikbaar.")}
    </article>
    <article class="research-card">
      <div class="section-head compact">
        <div>
          <div class="kicker">Strategy research miner</div>
          <h3>${escapeHtml(leadCandidate.label || strategyResearch.leader?.label || "Nog geen import-kandidaat")}</h3>
        </div>
        <div class="meta">${strategyResearch.generatedAt ? formatDate(strategyResearch.generatedAt) : "-"}</div>
      </div>
      <div class="driver-grid">
        <div class="mini-stat"><span class="kicker">Approved</span><strong>${strategyResearch.approvedCandidateCount || 0}</strong><div class="meta">${strategyResearch.importedCandidateCount || 0} imports</div></div>
        <div class="mini-stat"><span class="kicker">Genome</span><strong>${strategyResearch.genome?.candidateCount || 0}</strong><div class="meta">${strategyResearch.genome?.parentCount || 0} parents</div></div>
        <div class="mini-stat"><span class="kicker">Lead score</span><strong>${formatPct(leadCandidate.score?.overall || 0, 1)}</strong><div class="meta">${escapeHtml(leadCandidate.status || "observe")}</div></div>
      </div>
      <div class="note-line"><span class="kicker">Veiligheid</span><div class="tag-list">${renderTagList(leadCandidate.blockedReasons || [], leadCandidate.safe === false ? "Unsafe import" : "Veilige DSL")}</div></div>
      ${renderTimelineRows(candidateRows, "Nog geen import- of genome-kandidaten.")}
    </article>
  `;
}

function beginSnapshotEpoch() {
  snapshotEpoch += 1;
  return snapshotEpoch;
}

function isActiveSnapshotEpoch(epoch) {
  return epoch === snapshotEpoch;
}

function renderUniverse(snapshot) {
  const universe = snapshot.dashboard.universe || {};
  const selected = universe.selected || [];
  elements.universeSummary.innerHTML = [
    insightCard("Geselecteerd", `${universe.selectedCount || 0}/${universe.configuredSymbolCount || 0}`, `${formatPct(universe.selectionRate || 0, 1)} focus rate`, (universe.selectionRate || 0) >= 0.35 ? "positive" : "neutral"),
    insightCard("Eligible", `${universe.eligibleCount || 0}`, universe.suggestions?.[0] || "Geen universe-opmerking"),
    insightCard("Gem. score", `${formatPct(universe.averageScore || 0, 1)}`, selected[0] ? `${selected[0].symbol} leidt` : "Nog geen lead")
  ].join("");

  elements.universeList.innerHTML = selected.length
    ? selected
        .slice(0, UNIVERSE_RENDER_LIMIT)
        .map(
          (item) => `
            <article class="universe-card">
              <div class="section-head compact">
                <div>
                  <div class="kicker">${escapeHtml(item.symbol)}</div>
                  <h3>${escapeHtml(item.health || "watch")}</h3>
                </div>
                <div class="pill ${healthTone(item.health)}">${formatPct(item.score || 0, 1)}</div>
              </div>
              <div class="mini-grid">
                <div class="mini-stat"><span class="kicker">Spread</span><strong>${formatNumber(item.spreadBps || 0, 2)} bps</strong></div>
                <div class="mini-stat"><span class="kicker">Depth</span><strong>${formatMoney(item.totalDepthNotional || 0)}</strong></div>
                <div class="mini-stat"><span class="kicker">Book conf</span><strong>${formatPct(item.depthConfidence || 0, 1)}</strong></div>
                <div class="mini-stat"><span class="kicker">Tape</span><strong>${item.recentTradeCount || 0}</strong><div class="meta">rv ${formatPct(item.realizedVolPct || 0, 2)}</div></div>
              </div>
              <div class="note-line"><span class="kicker">Waarom erin</span><div class="tag-list">${renderTagList(item.reasons || [], "Geen universe-redenen")}</div></div>
            </article>
          `
        )
        .join("")
    : `<div class="empty">Nog geen universe-selectie beschikbaar.</div>`;
}

function renderAttribution(snapshot) {
  const attribution = snapshot.dashboard.strategyAttribution || {};
  const hottestStrategy = (attribution.topStrategies || [])[0] || {};
  const hottestFamily = (attribution.topFamilies || [])[0] || {};
  const hottestRegime = (attribution.topRegimes || [])[0] || {};
  elements.attributionSummary.innerHTML = [
    insightCard("Trades", `${attribution.sampleSize || 0}`, hottestStrategy.label ? `${hottestStrategy.label} bovenaan` : "Nog geen history"),
    insightCard("Top family", hottestFamily.label || "-", hottestFamily.edge == null ? "Geen edge" : `edge ${formatNumber(hottestFamily.edge || 0, 3)}`, healthTone(hottestFamily.health)),
    insightCard("Top regime", hottestRegime.label || "-", hottestRegime.winRate == null ? "Geen regime-data" : `win ${formatPct(hottestRegime.winRate || 0, 1)}`, healthTone(hottestRegime.health))
  ].join("");

  const cards = [
    ...(attribution.topStrategies || []).slice(0, 3).map((item) => ({ ...item, bucketLabel: "strategie" })),
    ...(attribution.topFamilies || []).slice(0, 2).map((item) => ({ ...item, bucketLabel: "family" }))
  ];
  elements.attributionList.innerHTML = cards.length
    ? cards
        .slice(0, ATTRIBUTION_RENDER_LIMIT)
        .map(
          (item) => `
            <article class="attribution-card">
              <div class="section-head compact">
                <div>
                  <div class="kicker">${escapeHtml(item.bucketLabel || "bucket")}</div>
                  <h3>${escapeHtml(item.label || item.id || "Attribution")}</h3>
                </div>
                <div class="pill ${healthTone(item.health)}">${escapeHtml(item.health || "neutral")}</div>
              </div>
              <div class="mini-grid">
                <div class="mini-stat"><span class="kicker">Edge</span><strong class="${toneClass(item.edge || 0)}">${formatNumber(item.edge || 0, 3)}</strong></div>
                <div class="mini-stat"><span class="kicker">Winrate</span><strong>${formatPct(item.winRate || 0, 1)}</strong></div>
                <div class="mini-stat"><span class="kicker">Gem. PnL</span><strong class="${toneClass(item.avgPnlQuote || 0)}">${formatMoney(item.avgPnlQuote || 0)}</strong></div>
                <div class="mini-stat"><span class="kicker">Confidence</span><strong>${formatPct(item.confidence || 0, 1)}</strong><div class="meta">${item.tradeCount || 0} trades</div></div>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty">Nog geen attribution-history beschikbaar.</div>`;
}

function renderPnlAttribution(snapshot) {
  const attribution = snapshot.dashboard.report?.attribution || {};
  const decomposition = snapshot.dashboard.report?.pnlDecomposition || {};
  const executionCost = snapshot.dashboard.report?.executionCostSummary || {};
  const topStrategy = (attribution.strategies || [])[0] || {};
  const topRegime = (attribution.regimes || [])[0] || {};
  const topStyle = (attribution.executionStyles || [])[0] || {};
  const topProvider = (attribution.newsProviders || [])[0] || {};
  elements.pnlAttributionSummary.innerHTML = [
    insightCard("Top strategie", topStrategy.id || "-", topStrategy.tradeCount ? `${topStrategy.tradeCount} trades | ${formatMoney(topStrategy.realizedPnl || 0)}` : "Nog geen attributie"),
    insightCard("Top regime", topRegime.id || "-", topRegime.tradeCount ? `${formatPct(topRegime.winRate || 0, 1)} win | ${formatMoney(topRegime.realizedPnl || 0)}` : "Nog geen regime-attributie"),
    insightCard("Exec budget", executionCost.status || "warmup", executionCost.worstStrategy ? `${executionCost.worstStrategy} | ${formatNumber(executionCost.averageTotalCostBps || 0, 2)} bps` : "Nog geen execution-cost budget", healthTone(executionCost.status || "warmup")),
    insightCard("PnL netto", formatMoney(decomposition.netRealizedPnl || 0), decomposition.totalFees ? `fees ${formatMoney(-(decomposition.totalFees || 0))}` : (topProvider.tradeCount ? `${topProvider.tradeCount} trades | ${formatMoney(topProvider.realizedPnl || 0)}` : "Nog geen bron-attributie"), toneClass(decomposition.netRealizedPnl || 0))
  ].join("");

  const cards = [
    {
      id: "decomposition",
      bucketLabel: "decomposition",
      realizedPnl: decomposition.netRealizedPnl || 0,
      tradeCount: (attribution.strategies || []).reduce((total, item) => total + (item.tradeCount || 0), 0),
      winRate: decomposition.averageCaptureEfficiency || 0,
      averagePnlPct: -(executionCost.averageTotalCostBps || 0) / 10_000,
      averageDurationMinutes: executionCost.averageTouchSlippageBps || 0
    },
    ...(attribution.strategies || []).slice(0, 2).map((item) => ({ ...item, bucketLabel: "strategie" })),
    ...(attribution.regimes || []).slice(0, 2).map((item) => ({ ...item, bucketLabel: "regime" })),
    ...(attribution.executionStyles || []).slice(0, 2).map((item) => ({ ...item, bucketLabel: "execution" })),
    ...(attribution.newsProviders || []).slice(0, 2).map((item) => ({ ...item, bucketLabel: "nieuwsbron" }))
  ];
  elements.pnlAttributionList.innerHTML = cards.length
    ? cards
        .slice(0, PNL_ATTRIBUTION_RENDER_LIMIT)
        .map(
          (item) => `
            <article class="attribution-card">
              <div class="section-head compact">
                <div>
                  <div class="kicker">${escapeHtml(item.bucketLabel || "bucket")}</div>
                  <h3>${escapeHtml(item.id || "Attributie")}</h3>
                </div>
                <div class="pill ${toneClass(item.realizedPnl || 0)}">${formatMoney(item.realizedPnl || 0)}</div>
              </div>
              <div class="mini-grid">
                <div class="mini-stat"><span class="kicker">${item.bucketLabel === "decomposition" ? "Trades" : "Trades"}</span><strong>${item.tradeCount || 0}</strong></div>
                <div class="mini-stat"><span class="kicker">${item.bucketLabel === "decomposition" ? "Capture" : "Winrate"}</span><strong>${item.bucketLabel === "decomposition" ? formatPct(item.winRate || 0, 1) : formatPct(item.winRate || 0, 1)}</strong></div>
                <div class="mini-stat"><span class="kicker">${item.bucketLabel === "decomposition" ? "Cost" : "Gem. PnL"}</span><strong class="${toneClass(item.averagePnlPct || 0)}">${item.bucketLabel === "decomposition" ? `${formatNumber(Math.abs(item.averagePnlPct || 0) * 10_000, 2)} bps` : formatPct(item.averagePnlPct || 0, 2)}</strong></div>
                <div class="mini-stat"><span class="kicker">${item.bucketLabel === "decomposition" ? "Slip" : "Duur"}</span><strong>${item.bucketLabel === "decomposition" ? `${formatNumber(item.averageDurationMinutes || 0, 2)} bps` : `${formatNumber(item.averageDurationMinutes || 0, 1)} min`}</strong></div>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty">Nog geen PnL-attributie beschikbaar.</div>`;
}

function renderOperations(snapshot) {
  const recorder = snapshot.dashboard.dataRecorder || {};
  const backups = snapshot.dashboard.safety?.backups || {};
  const recovery = snapshot.dashboard.safety?.recovery || {};
  const modelRegistry = snapshot.dashboard.ai?.modelRegistry || {};
  const parameterGovernor = snapshot.dashboard.ai?.parameterGovernor || {};
  const strategyRetirement = snapshot.dashboard.ai?.strategyRetirement || {};
  const ops = snapshot.dashboard.ops || {};
  const exchangeTruth = snapshot.dashboard.safety?.exchangeTruth || {};
  const exchangeSafety = snapshot.dashboard.safety?.exchangeSafety || {};
  const venueConfirmation = snapshot.dashboard.safety?.venueConfirmation || {};
  const orderLifecycle = snapshot.dashboard.safety?.orderLifecycle || {};
  const alerts = ops.alerts || {};
  const replayChaos = ops.replayChaos || {};
  const executionCost = snapshot.dashboard.report?.executionCostSummary || {};
  const service = ops.service || {};
  const readiness = ops.readiness || {};
  const executionCalibration = ops.executionCalibration || {};
  const thresholdTuning = ops.thresholdTuning || {};
  const capitalLadder = ops.capitalLadder || {};
  const capitalGovernor = ops.capitalGovernor || {};
  const alertDelivery = ops.alertDelivery || {};
  const alertSilenceMinutes = snapshot.configSummary?.operatorAlertSilenceMinutes || 180;
  const incidentLead = (ops.incidentTimeline || [])[0] || {};
  const leadRunbook = (ops.runbooks || [])[0] || {};
  const leadCalibration = Object.entries(executionCalibration.styles || {})[0] || [];
  const leadGovernor = (parameterGovernor.strategyScopes || [])[0] || (parameterGovernor.regimeScopes || [])[0] || {};
  elements.opsSummary.innerHTML = [
    insightCard("Recorder", `${recorder.filesWritten || 0} writes`, recorder.lastRecordAt ? `laatst ${formatDate(recorder.lastRecordAt)} | learn ${recorder.learningFrames || 0} | snap ${recorder.snapshotFrames || 0}` : `Nog geen recorder-run | learn ${recorder.learningFrames || 0} | snap ${recorder.snapshotFrames || 0}`),
    insightCard("Backups", `${backups.backupCount || 0}`, backups.lastBackupAt ? `laatst ${formatDate(backups.lastBackupAt)}` : "Nog geen backup"),
    insightCard("Registry", `${modelRegistry.registrySize || 0} snapshots`, modelRegistry.latestSnapshotAt ? `laatst ${formatDate(modelRegistry.latestSnapshotAt)}` : "Nog geen modelsnapshot"),
    insightCard("Recovery", recovery.uncleanShutdownDetected ? "Unclean" : "Clean", recovery.restoredFromBackupAt ? `restore ${formatDate(recovery.restoredFromBackupAt)}` : recovery.latestBackupAt ? `backup ${formatDate(recovery.latestBackupAt)}` : "Geen herstel nodig", recovery.uncleanShutdownDetected ? "negative" : "positive"),
    insightCard("Readiness", readiness.status || "ready", (readiness.reasons || [])[0] ? normalizeReasonLabel(readiness.reasons[0]) : "Bot is operationeel klaar", healthTone(readiness.status || "ready")),
    insightCard("Exchange truth", `${exchangeTruth.mismatchCount || 0} mismatches`, exchangeTruth.lastReconciledAt ? `laatst ${formatDate(exchangeTruth.lastReconciledAt)}` : "Nog geen reconcile", healthTone(exchangeTruth.status)),
    insightCard("Safety audit", exchangeSafety.status || "ready", exchangeSafety.notes?.[0] || "Geen extra exchange-safety waarschuwing", healthTone(exchangeSafety.status || "ready")),
    insightCard("Venue check", `${venueConfirmation.venueCount || venueConfirmation.confirmedCount || 0} venues`, venueConfirmation.routeAdvice?.preferredEntryStyle ? `${venueConfirmation.routeAdvice.preferredEntryStyle} | div ${formatNumber(venueConfirmation.averageDivergenceBps || 0, 2)} bps` : (venueConfirmation.notes || [])[0] || "Nog geen externe confirmatie", healthTone(venueConfirmation.status)),
    insightCard("Lifecycle", `${(orderLifecycle.pendingActions || []).length} acties`, leadRunbook.title || `${(orderLifecycle.positions || []).length} posities gevolgd`, (orderLifecycle.pendingActions || []).length ? "neutral" : "positive"),
    insightCard("Exec calib", `${executionCalibration.liveTradeCount || 0} live`, leadCalibration[0] ? `${leadCalibration[0]} ${formatNumber(leadCalibration[1]?.slippageBiasBps || 0, 2)} bps` : "Nog geen style-calibratie", healthTone(executionCalibration.status || "warmup")),
    insightCard("Exec budget", executionCost.status || "warmup", executionCost.worstStyle ? `${executionCost.worstStyle} | ${formatNumber(executionCost.averageTotalCostBps || 0, 2)} bps` : "Nog geen execution-cost budget", healthTone(executionCost.status || "warmup")),
    insightCard("Threshold", thresholdTuning.appliedRecommendation?.status || thresholdTuning.status || "stable", thresholdTuning.appliedRecommendation?.id ? normalizeReasonLabel(thresholdTuning.appliedRecommendation.id) : "Geen actieve probation", healthTone(thresholdTuning.appliedRecommendation?.status || thresholdTuning.status || "stable")),
    insightCard("Governor", leadGovernor.id || "-", leadGovernor.id ? `${leadGovernor.scopeType} | thr ${formatNumber(leadGovernor.thresholdShift || 0, 4)}` : "Nog geen scoped governor", healthTone(parameterGovernor.status || "warmup")),
    insightCard("Retirement", `${strategyRetirement.retireCount || 0} retire`, strategyRetirement.policies?.[0]?.id ? `${strategyRetirement.policies[0].id} | ${strategyRetirement.policies[0].status}` : "Geen strategy retirement", healthTone(strategyRetirement.status || "ready")),
    insightCard("Capital ladder", capitalLadder.stage || "paper", capitalLadder.notes?.[0] || "Nog geen ladder-notitie", healthTone(capitalLadder.stage || "paper")),
    insightCard("Capital governor", capitalGovernor.status || "warmup", capitalGovernor.notes?.[0] || "Nog geen capital governor update", healthTone(capitalGovernor.status || "warmup")),
    insightCard("Alerts", `${alerts.activeCount || alerts.count || 0}`, alerts.alerts?.[0]?.title || "Geen operator alerts", healthTone(alerts.status || "clear")),
    insightCard("Alert delivery", alertDelivery.status || "disabled", alertDelivery.lastDeliveryAt ? `laatst ${formatDate(alertDelivery.lastDeliveryAt)}` : alertDelivery.notes?.[0] || "Nog geen alert delivery", healthTone(alertDelivery.status || "disabled")),
    insightCard("Chaos lab", replayChaos.status || "warmup", replayChaos.worstStrategy ? `${replayChaos.worstStrategy} | ${replayChaos.worstScenario || "-"}` : "Nog geen replay chaos data", healthTone(replayChaos.status || "warmup")),
    insightCard("Service", service.watchdogStatus || "idle", service.lastHeartbeatAt ? `heartbeat ${formatDate(service.lastHeartbeatAt)}` : "Nog geen heartbeat", healthTone(service.watchdogStatus || "idle")),
    insightCard("Incidenten", `${(ops.incidentTimeline || []).length}`, incidentLead.type ? `${normalizeReasonLabel(incidentLead.type)} ${incidentLead.symbol || ""}`.trim() : "Geen recente incidenten", healthTone(incidentLead.severity || "neutral"))
  ].join("");

  const notes = [
    ...(ops.performanceChange?.notes || []),
    ...(alerts.alerts || []).map((item) => `${item.title}: ${item.action}`),
    ...(ops.runbooks || []).map((item) => `${item.title}: ${item.action}`),
    ...(exchangeTruth.notes || []),
    ...(exchangeSafety.notes || []),
    ...(venueConfirmation.notes || []),
    ...(strategyRetirement.notes || []),
    ...(executionCost.notes || []),
    ...(capitalGovernor.notes || []),
    ...(replayChaos.notes || []),
    ...(ops.shadowTrading?.notes || []),
    ...(capitalLadder.notes || []),
    ...(alertDelivery.notes || []),
    ...(parameterGovernor.notes || []),
    ...(executionCalibration.notes || []),
    ...(thresholdTuning.notes || []),
    ...(modelRegistry.notes || []),
    backups.lastReason ? `Laatste backup reden: ${backups.lastReason}` : "",
    recorder.rootDir ? `Feature store: ${recorder.rootDir}` : "",
    service.statusFile ? `Service statusfile: ${service.statusFile}` : ""
  ].filter(Boolean);
  elements.opsList.innerHTML = notes.length || (ops.incidentTimeline || []).length
    ? [
        ...(orderLifecycle.activeActions || []).slice(0, 6).map((item) => `
          <div class="event-row">
            <div>
              <strong>${escapeHtml(normalizeReasonLabel(item.type || "exchange_action"))}</strong>
              <div class="meta">${item.symbol ? `${escapeHtml(item.symbol)} | ` : ""}${item.startedAt ? formatDate(item.startedAt) : "-"}</div>
              <div>${escapeHtml(item.detail || item.stage || "Pending exchange action")}</div>
            </div>
            <div class="pill ${healthTone(item.severity || "neutral")}">${escapeHtml(item.stage || "pending")}</div>
          </div>
        `),
        ...(alerts.alerts || []).slice(0, 6).map((item) => `
          <div class="event-row">
            <div>
              <strong>${escapeHtml(item.title || "Alert")}</strong>
              <div class="meta">${escapeHtml(item.id || "-")} | ${item.acknowledgedAt ? `ack ${escapeHtml(formatDate(item.acknowledgedAt))}` : "nog niet bevestigd"}${item.silencedUntil ? ` | stil tot ${escapeHtml(formatDate(item.silencedUntil))}` : ""}</div>
              <div>${escapeHtml(item.reason || item.action || "Geen extra detail")}</div>
            </div>
            <div>
              <div class="pill ${healthTone(item.severity || "neutral")}">${escapeHtml(item.muted ? "muted" : item.severity || "info")}</div>
              <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; justify-content:flex-end;">
                ${item.acknowledgedAt ? "" : `<button class="secondary" data-alert-action="ack" data-alert-id="${escapeHtml(item.id || "")}">Ack</button>`}
                <button class="secondary" data-alert-action="silence" data-alert-id="${escapeHtml(item.id || "")}" data-alert-minutes="${escapeHtml(alertSilenceMinutes)}">Stil ${escapeHtml(String(Math.round(alertSilenceMinutes / 60) || 1))}u</button>
              </div>
            </div>
          </div>
        `),
        ...(ops.incidentTimeline || []).slice(0, 6).map((item) => `
          <div class="event-row">
            <div>
              <strong>${escapeHtml(normalizeReasonLabel(item.type || "incident"))}</strong>
              <div class="meta">${item.symbol ? `${escapeHtml(item.symbol)} | ` : ""}${item.at ? formatDate(item.at) : "-"}</div>
              <div>${escapeHtml(item.detail || "Geen extra detail")}</div>
            </div>
            <div class="pill ${healthTone(item.severity || "neutral")}">${escapeHtml(item.severity || "neutral")}</div>
          </div>
        `),
        ...(orderLifecycle.actionJournal || []).slice(0, 6).map((item) => `
          <div class="event-row">
            <div>
              <strong>${escapeHtml(normalizeReasonLabel(item.type || "action"))}</strong>
              <div class="meta">${item.symbol ? `${escapeHtml(item.symbol)} | ` : ""}${item.completedAt ? formatDate(item.completedAt) : "-"}</div>
              <div>${escapeHtml(item.error || item.detail || item.status || "Geen extra detail")}</div>
            </div>
            <div class="pill ${healthTone(item.severity || item.status || "neutral")}">${escapeHtml(item.status || "done")}</div>
          </div>
        `),
        ...notes.map((note) => `<div class="event-row"><div>${escapeHtml(note)}</div></div>`)
      ].join("")
    : `<div class="empty">Nog geen operations-notities.</div>`;
}
function renderGovernance(snapshot) {
  const registry = snapshot.dashboard.researchRegistry || {};
  const strategyResearch = snapshot.dashboard.strategyResearch || {};
  const governance = registry.governance || {};
  const leader = (registry.leaderboard || [])[0] || {};
  const modelRegistry = snapshot.dashboard.ai?.modelRegistry || {};
  const parameterGovernor = snapshot.dashboard.ai?.parameterGovernor || {};
  const promotionPolicy = modelRegistry.promotionPolicy || {};
  const offlineTrainer = snapshot.dashboard.offlineTrainer || {};
  const topBlocker = (offlineTrainer.blockerScorecards || [])[0] || {};
  const topRegime = (offlineTrainer.regimeScorecards || [])[0] || {};
  const thresholdPolicy = offlineTrainer.thresholdPolicy || {};
  const topThresholdRecommendation = (thresholdPolicy.recommendations || [])[0] || {};
  const exitLearning = offlineTrainer.exitLearning || {};
  const topExitReason = (offlineTrainer.exitScorecards || [])[0] || {};
  const featureDecay = offlineTrainer.featureDecay || {};
  const topResearchCandidate = (strategyResearch.approvedCandidates || [])[0] || (strategyResearch.candidates || [])[0] || {};
  const topGovernor = (parameterGovernor.strategyScopes || [])[0] || (parameterGovernor.regimeScopes || [])[0] || {};
  const opsThresholdTuning = snapshot.dashboard.ops?.thresholdTuning || {};
  const activeThreshold = opsThresholdTuning.appliedRecommendation || {};
  const topExitPolicy = (exitLearning.strategyPolicies || [])[0] || (exitLearning.regimePolicies || [])[0] || {};
  elements.governanceSummary.innerHTML = [
    insightCard("Research runs", `${registry.runCount || 0}`, registry.lastRunAt ? `laatst ${formatDate(registry.lastRunAt)}` : "Nog geen run"),
    insightCard("Promo kandidaten", `${(governance.promotionCandidates || []).length}`, leader.symbol ? `${leader.symbol} leidt` : "Nog geen kandidaat", (governance.promotionCandidates || []).length ? "positive" : "neutral"),
    insightCard("Import candidates", `${strategyResearch.approvedCandidateCount || 0}/${strategyResearch.candidateCount || 0}`, topResearchCandidate.label ? `${topResearchCandidate.label} ${topResearchCandidate.status || "observe"}` : "Nog geen importleider", healthTone(topResearchCandidate.status || "observe")),
    insightCard("Regimes", `${promotionPolicy.strongRegimeScorecardCount || 0}/${promotionPolicy.regimeScorecardCount || 0}`, (promotionPolicy.readyRegimes || [])[0] ? `${promotionPolicy.readyRegimes[0]} klaar` : "Nog geen sterk regime"),
    insightCard("Veto feedback", `${offlineTrainer.vetoFeedback?.badVetoCount || 0}/${offlineTrainer.vetoFeedback?.goodVetoCount || 0}`, topBlocker.id ? `${normalizeReasonLabel(topBlocker.id)} ${topBlocker.status || "observe"}` : "Nog geen blocker-patroon"),
    insightCard("Threshold tuning", `${(thresholdPolicy.recommendations || []).length}`, activeThreshold.id ? `${normalizeReasonLabel(activeThreshold.id)} ${activeThreshold.status || "probation"}` : topThresholdRecommendation.id ? `${normalizeReasonLabel(topThresholdRecommendation.id)} ${topThresholdRecommendation.action || "observe"}` : "Geen threshold-aanpassing"),
    insightCard("Exit learning", `${exitLearning.lateExitCount || 0}/${exitLearning.prematureExitCount || 0}`, topExitPolicy.id ? `${normalizeReasonLabel(topExitPolicy.id)} ${topExitPolicy.status || "balanced"}` : topExitReason.id ? `${normalizeReasonLabel(topExitReason.id)} ${topExitReason.status || "observe"}` : "Nog geen exit-leider"),
    insightCard("Parameter governor", `${topGovernor.id || "-"}`, topGovernor.id ? `${topGovernor.scopeType} | stop ${formatNumber(topGovernor.stopLossMultiplier || 1, 2)}` : "Nog geen governor-scope", healthTone(parameterGovernor.status || "warmup")),
    insightCard("Feature decay", `${featureDecay.degradedFeatureCount || 0}/${featureDecay.weakFeatureCount || 0}`, featureDecay.weakestFeature ? `${normalizeReasonLabel(featureDecay.weakestFeature)} zwakst` : "Nog geen decay-signaal", healthTone(featureDecay.status))
  ].join("");

  const advisoryCards = [
    promotionPolicy.readyLevel ? `
      <article class="registry-card">
        <div class="section-head compact">
          <div>
            <div class="kicker">promotiebeleid</div>
            <h3>${escapeHtml((promotionPolicy.readyLevel || "observe").replaceAll("_", " "))}</h3>
          </div>
          <div class="pill ${promotionPolicy.allowPromotion ? "positive" : "neutral"}">${promotionPolicy.shadowTradeCount || 0} shadow</div>
        </div>
        <div class="mini-grid">
          <div class="mini-stat"><span class="kicker">Edge</span><strong>${formatNumber(promotionPolicy.challengerEdge || 0, 3)}</strong></div>
          <div class="mini-stat"><span class="kicker">Paper</span><strong>${promotionPolicy.paperTradeCount || 0}</strong><div class="meta">${formatPct(promotionPolicy.paperWinRate || 0, 1)}</div></div>
          <div class="mini-stat"><span class="kicker">Live</span><strong>${promotionPolicy.liveTradeCount || 0}</strong><div class="meta">${promotionPolicy.liveQualityScore == null ? "-" : formatPct(promotionPolicy.liveQualityScore || 0, 1)}</div></div>
          <div class="mini-stat"><span class="kicker">Regimes</span><strong>${promotionPolicy.strongRegimeScorecardCount || 0}/${promotionPolicy.regimeScorecardCount || 0}</strong><div class="meta">${escapeHtml(((promotionPolicy.readyRegimes || []).slice(0, 2).join(", ")) || "geen ready")}</div></div>
        </div>
        <div class="note-line"><span class="kicker">Blockers</span><div class="tag-list">${renderTagList((promotionPolicy.blockerReasons || []).slice(0, 4).map(normalizeReasonLabel), promotionPolicy.allowPromotion ? "Promotie is groen" : "Nog geen blocker")}</div></div>
      </article>
    ` : "",
    topBlocker.id ? `
      <article class="registry-card">
        <div class="section-head compact">
          <div>
            <div class="kicker">veto learning</div>
            <h3>${escapeHtml(normalizeReasonLabel(topBlocker.id))}</h3>
          </div>
          <div class="pill ${healthTone(topBlocker.status)}">${escapeHtml(topBlocker.status || "observe")}</div>
        </div>
        <div class="mini-grid">
          <div class="mini-stat"><span class="kicker">Bad veto</span><strong>${topBlocker.badVetoCount || 0}</strong><div class="meta">${formatPct(topBlocker.badVetoRate || 0, 1)}</div></div>
          <div class="mini-stat"><span class="kicker">Good veto</span><strong>${topBlocker.goodVetoCount || 0}</strong><div class="meta">${formatPct(topBlocker.goodVetoRate || 0, 1)}</div></div>
          <div class="mini-stat"><span class="kicker">Gem. move</span><strong>${formatPct(topBlocker.averageMovePct || 0, 2)}</strong></div>
          <div class="mini-stat"><span class="kicker">Scope</span><strong>${(topBlocker.affectedStrategies || []).length}</strong><div class="meta">${escapeHtml(((topBlocker.affectedRegimes || []).slice(0, 2).join(", ")) || "regimes")}</div></div>
        </div>
      </article>
    ` : "",
    topRegime.id ? `
      <article class="registry-card">
        <div class="section-head compact">
          <div>
            <div class="kicker">regime scorecard</div>
            <h3>${escapeHtml(topRegime.id)}</h3>
          </div>
          <div class="pill ${healthTone(topRegime.status)}">${escapeHtml(topRegime.status || "observe")}</div>
        </div>
        <div class="mini-grid">
          <div class="mini-stat"><span class="kicker">Trades</span><strong>${topRegime.tradeCount || 0}</strong></div>
          <div class="mini-stat"><span class="kicker">Winrate</span><strong>${formatPct(topRegime.winRate || 0, 1)}</strong></div>
          <div class="mini-stat"><span class="kicker">PnL</span><strong class="${toneClass(topRegime.realizedPnl || 0)}">${formatMoney(topRegime.realizedPnl || 0)}</strong></div>
          <div class="mini-stat"><span class="kicker">Gov</span><strong>${formatPct(topRegime.governanceScore || 0, 1)}</strong></div>
        </div>
      </article>
    ` : "",
    topResearchCandidate.id ? `
      <article class="registry-card">
        <div class="section-head compact">
          <div>
            <div class="kicker">strategy import</div>
            <h3>${escapeHtml(topResearchCandidate.label || topResearchCandidate.id || "candidate")}</h3>
          </div>
          <div class="pill ${healthTone(topResearchCandidate.status)}">${escapeHtml(topResearchCandidate.status || "observe")}</div>
        </div>
        <div class="mini-grid">
          <div class="mini-stat"><span class="kicker">Score</span><strong>${formatPct(topResearchCandidate.score?.overall || 0, 1)}</strong></div>
          <div class="mini-stat"><span class="kicker">Stress</span><strong>${formatPct(topResearchCandidate.stress?.survivalScore || 0, 1)}</strong></div>
          <div class="mini-stat"><span class="kicker">Stop diff</span><strong>${formatNumber(topResearchCandidate.parameterDiffs?.stopLossPct || 0, 4)}</strong></div>
          <div class="mini-stat"><span class="kicker">Execution</span><strong>${escapeHtml(topResearchCandidate.parameterDiffs?.entryStyle || "-")}</strong></div>
        </div>
      </article>
    ` : "",
    (activeThreshold.id || topThresholdRecommendation.id) ? `
      <article class="registry-card">
        <div class="section-head compact">
          <div>
            <div class="kicker">threshold tuning</div>
            <h3>${escapeHtml(normalizeReasonLabel(activeThreshold.id || topThresholdRecommendation.id))}</h3>
          </div>
          <div class="pill ${healthTone(activeThreshold.status || topThresholdRecommendation.action)}">${escapeHtml(activeThreshold.status || topThresholdRecommendation.action || "observe")}</div>
        </div>
        <div class="mini-grid">
          <div class="mini-stat"><span class="kicker">Shift</span><strong>${formatNumber(activeThreshold.adjustment || topThresholdRecommendation.adjustment || 0, 4)}</strong></div>
          <div class="mini-stat"><span class="kicker">Confidence</span><strong>${formatPct(activeThreshold.confidence || topThresholdRecommendation.confidence || 0, 1)}</strong></div>
          <div class="mini-stat"><span class="kicker">Status</span><strong>${escapeHtml(activeThreshold.status || topThresholdRecommendation.action || "observe")}</strong></div>
          <div class="mini-stat"><span class="kicker">Scope</span><strong>${((activeThreshold.affectedStrategies || topThresholdRecommendation.affectedStrategies || [])).length}</strong><div class="meta">${escapeHtml((((activeThreshold.affectedRegimes || topThresholdRecommendation.affectedRegimes || [])).slice(0, 2).join(", ")) || "regimes")}</div></div>
        </div>
        <div class="note-line"><span class="kicker">Waarom</span><div class="tag-list">${renderTagList([topThresholdRecommendation.rationale].filter(Boolean), activeThreshold.appliedAt ? `actief sinds ${formatDate(activeThreshold.appliedAt)}` : "Geen extra context")}</div></div>
      </article>
    ` : "",
    topGovernor.id ? `
      <article class="registry-card">
        <div class="section-head compact">
          <div>
            <div class="kicker">parameter governor</div>
            <h3>${escapeHtml(normalizeReasonLabel(topGovernor.id))}</h3>
          </div>
          <div class="pill ${healthTone(topGovernor.status)}">${escapeHtml(topGovernor.status || "observe")}</div>
        </div>
        <div class="mini-grid">
          <div class="mini-stat"><span class="kicker">Thr shift</span><strong>${formatNumber(topGovernor.thresholdShift || 0, 4)}</strong></div>
          <div class="mini-stat"><span class="kicker">Stop</span><strong>${formatNumber(topGovernor.stopLossMultiplier || 1, 2)}</strong></div>
          <div class="mini-stat"><span class="kicker">TP</span><strong>${formatNumber(topGovernor.takeProfitMultiplier || 1, 2)}</strong></div>
          <div class="mini-stat"><span class="kicker">Hold</span><strong>${formatNumber(topGovernor.maxHoldMinutesMultiplier || 1, 2)}</strong></div>
        </div>
      </article>
    ` : "",
    topExitReason.id ? `
      <article class="registry-card">
        <div class="section-head compact">
          <div>
            <div class="kicker">exit learning</div>
            <h3>${escapeHtml(normalizeReasonLabel(topExitReason.id))}</h3>
          </div>
          <div class="pill ${healthTone(topExitReason.status)}">${escapeHtml(topExitReason.status || "observe")}</div>
        </div>
        <div class="mini-grid">
          <div class="mini-stat"><span class="kicker">Exit score</span><strong>${formatPct(topExitReason.averageExitScore || 0, 1)}</strong></div>
          <div class="mini-stat"><span class="kicker">Capture</span><strong>${formatPct(topExitReason.averageCapture || 0, 1)}</strong></div>
          <div class="mini-stat"><span class="kicker">Late exits</span><strong>${topExitReason.lateExitCount || 0}</strong></div>
          <div class="mini-stat"><span class="kicker">Te vroeg</span><strong>${topExitReason.prematureExitCount || 0}</strong></div>
        </div>
      </article>
    ` : "",
    featureDecay.weakestFeature ? `
      <article class="registry-card">
        <div class="section-head compact">
          <div>
            <div class="kicker">feature decay</div>
            <h3>${escapeHtml(normalizeReasonLabel(featureDecay.weakestFeature))}</h3>
          </div>
          <div class="pill ${healthTone(featureDecay.status)}">${escapeHtml(featureDecay.status || "watch")}</div>
        </div>
        <div class="mini-grid">
          <div class="mini-stat"><span class="kicker">Tracked</span><strong>${featureDecay.trackedFeatureCount || 0}</strong></div>
          <div class="mini-stat"><span class="kicker">Weak</span><strong>${featureDecay.weakFeatureCount || 0}</strong></div>
          <div class="mini-stat"><span class="kicker">Decayed</span><strong>${featureDecay.degradedFeatureCount || 0}</strong></div>
          <div class="mini-stat"><span class="kicker">Gem.</span><strong>${formatPct(featureDecay.averagePredictiveScore || 0, 1)}</strong></div>
        </div>
      </article>
    ` : ""
  ].filter(Boolean);

  elements.registryList.innerHTML = (registry.leaderboard || []).length || advisoryCards.length
    ? [
        ...advisoryCards,
        ...(registry.leaderboard || [])
          .slice(0, REGISTRY_RENDER_LIMIT)
          .map(
            (item) => `
            <article class="registry-card">
              <div class="section-head compact">
                <div>
                  <div class="kicker">${escapeHtml(item.symbol || "symbol")}</div>
                  <h3>${escapeHtml((item.status || "hold").replaceAll("_", " "))}</h3>
                </div>
                <div class="pill ${healthTone(item.status)}">${formatNumber(item.governanceScore || 0, 3)}</div>
              </div>
              <div class="mini-grid">
                <div class="mini-stat"><span class="kicker">PnL</span><strong class="${toneClass(item.realizedPnl || 0)}">${formatMoney(item.realizedPnl || 0)}</strong></div>
                <div class="mini-stat"><span class="kicker">Sharpe</span><strong>${formatNumber(item.averageSharpe || 0, 2)}</strong></div>
                <div class="mini-stat"><span class="kicker">Winrate</span><strong>${formatPct(item.averageWinRate || 0, 1)}</strong></div>
                <div class="mini-stat"><span class="kicker">DD max</span><strong>${formatPct(item.maxDrawdownPct || 0, 1)}</strong><div class="meta">${item.totalTrades || 0} trades</div></div>
              </div>
              <div class="note-line"><span class="kicker">Leidende strategieen</span><div class="tag-list">${renderTagList(item.leaders || [], "Nog geen leaders")}</div></div>
            </article>
          `
          )
      ].join("")
    : `<div class="empty">Nog geen research-registry beschikbaar.</div>`;
}

function renderStatus(snapshot) {
  const { manager, dashboard } = snapshot;
  elements.modeBadge.textContent = `Mode: ${manager.currentMode.toUpperCase()}`;
  elements.runStateBadge.textContent = `Bot: ${manager.runState}`;
  elements.healthBadge.textContent = summarizeHealth(dashboard.health);

  const message = transientMessage || manager.lastError?.message || dashboard.analysis?.lastError?.message || `Laatste cyclus ${formatDate(dashboard.overview.lastCycleAt)} | Laatste analyse ${formatDate(dashboard.overview.lastAnalysisAt)}`;
  elements.controlHint.textContent = message;

  const running = manager.runState === "running";
  elements.startBtn.disabled = busy || running;
  elements.stopBtn.disabled = busy || manager.runState === "stopped";
  elements.cycleBtn.disabled = busy || running;
  elements.refreshBtn.disabled = busy || running;
  elements.researchBtn.disabled = busy || running;
  elements.paperBtn.disabled = busy || manager.currentMode === "paper";
  elements.liveBtn.disabled = busy || manager.currentMode === "live";
  elements.decisionSearch.value = decisionSearchQuery;
  elements.decisionAllowedOnly.checked = decisionAllowedOnly;
}

function render(snapshot) {
  latestSnapshot = snapshot;
  renderStatus(snapshot);
  renderMetrics(snapshot);
  renderChart(snapshot);
  renderWindowCards(snapshot);
  renderPositions(snapshot);
  renderDecisions(snapshot);
  renderBlockedSetups(snapshot);
  renderTradeReplays(snapshot);
  renderUniverse(snapshot);
  renderAttribution(snapshot);
  renderPnlAttribution(snapshot);
  renderGovernance(snapshot);
  renderOperations(snapshot);
  renderTrades(snapshot);
  renderIntelligence(snapshot);
  renderWeights(snapshot);
  renderEvents(snapshot);
  renderResearch(snapshot);
  bindPersistentDetails();
}

function pickSnapshot(payload) {
  return payload.snapshot || payload;
}

async function refreshSnapshot() {
  if (busy) {
    return;
  }
  const epoch = snapshotEpoch;
  const snapshot = await api("/api/snapshot");
  if (!isActiveSnapshotEpoch(epoch)) {
    return;
  }
  render(snapshot);
}

async function runAction(label, action) {
  if (busy) {
    return;
  }
  busy = true;
  const actionEpoch = beginSnapshotEpoch();
  transientMessage = `${label}...`;
  if (latestSnapshot) {
    renderStatus(latestSnapshot);
  }
  try {
    const payload = await action();
    transientMessage = `${label} voltooid`;
    if (isActiveSnapshotEpoch(actionEpoch)) {
      render(pickSnapshot(payload));
    }
    window.setTimeout(() => {
      transientMessage = "";
      if (latestSnapshot) {
        renderStatus(latestSnapshot);
      }
    }, 2200);
  } catch (error) {
    transientMessage = error.message;
    if (latestSnapshot) {
      renderStatus(latestSnapshot);
    }
  } finally {
    busy = false;
    if (latestSnapshot) {
      renderStatus(latestSnapshot);
    }
  }
}

elements.startBtn.addEventListener("click", () => runAction("Bot starten", () => api("/api/start", "POST")));
elements.stopBtn.addEventListener("click", () => runAction("Bot stoppen", () => api("/api/stop", "POST")));
elements.cycleBtn.addEventListener("click", () => runAction("Losse cyclus draaien", () => api("/api/cycle", "POST")));
elements.refreshBtn.addEventListener("click", () => runAction("Analyse verversen", () => api("/api/refresh", "POST")));
elements.researchBtn.addEventListener("click", () => runAction("Research lab draaien", () => api("/api/research", "POST", { symbols: [] })));
elements.paperBtn.addEventListener("click", () => runAction("Naar paper trading schakelen", () => api("/api/mode", "POST", { mode: "paper" })));
elements.liveBtn.addEventListener("click", () => {
  const approved = window.confirm("Live trading stuurt echte orders naar Binance. Alleen doorgaan als je API keys en veiligheidsinstellingen kloppen.");
  if (!approved) {
    return;
  }
  runAction("Naar live trading schakelen", () => api("/api/mode", "POST", { mode: "live" }));
});
elements.decisionSearch.addEventListener("input", (event) => {
  decisionSearchQuery = `${event.target.value || ""}`.trim().toLowerCase();
  if (latestSnapshot) {
    renderDecisions(latestSnapshot);
  }
});
elements.decisionAllowedOnly.addEventListener("change", (event) => {
  decisionAllowedOnly = Boolean(event.target.checked);
  if (latestSnapshot) {
    renderDecisions(latestSnapshot);
  }
});
elements.opsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-alert-action]");
  if (!button) {
    return;
  }
  const alertId = `${button.dataset.alertId || ""}`.trim();
  if (!alertId) {
    return;
  }
  if (button.dataset.alertAction === "ack") {
    runAction("Alert bevestigen", () => api("/api/alerts/ack", "POST", { id: alertId }));
    return;
  }
  if (button.dataset.alertAction === "silence") {
    runAction("Alert tijdelijk stilzetten", () => api("/api/alerts/silence", "POST", {
      id: alertId,
      minutes: Number(button.dataset.alertMinutes || 180)
    }));
  }
});

setupThemeToggle();
setupCollapsiblePanels();
bindPersistentDetails();

refreshSnapshot().catch((error) => {
  transientMessage = error.message;
  elements.controlHint.textContent = error.message;
});
window.setInterval(() => {
  refreshSnapshot().catch((error) => {
    transientMessage = error.message;
    if (latestSnapshot) {
      renderStatus(latestSnapshot);
    }
  });
}, POLL_MS);


























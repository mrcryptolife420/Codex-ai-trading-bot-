const POLL_MS = 5000;

const elements = {
  modeBadge: document.querySelector("#modeBadge"),
  runStateBadge: document.querySelector("#runStateBadge"),
  healthBadge: document.querySelector("#healthBadge"),
  controlHint: document.querySelector("#controlHint"),
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
  if (["hot", "healthy", "positive", "promotion_candidate", "promote"].includes(normalized)) {
    return "positive";
  }
  if (["cold", "blocked", "negative", "hold", "paused"].includes(normalized)) {
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
      if (window.localStorage.getItem(storageKey) === "1") {
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
      "Content-Type": "application/json"
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
  const openCount = overview.openPositionCount || 0;
  const watchlist = snapshot.dashboard.watchlist || {};
  const universe = snapshot.dashboard.universe || {};
  const equitySeries = report.equitySeries || [];
  const cycleSeries = report.cycleSeries || [];

  elements.metrics.innerHTML = [
    metricCard("Mode", snapshot.manager.currentMode.toUpperCase(), `Loop: ${snapshot.manager.runState}`),
    metricCard("Vrije cash", formatMoney(overview.quoteFree), `Laatste update ${formatDate(overview.lastPortfolioUpdateAt)}`),
    metricCard("Equity", formatMoney(overview.equity), `Open exposure ${formatMoney(overview.openExposure)}`),
    metricCard("Open P/L", formatMoney(overview.totalUnrealizedPnl), `${openCount} open posities`, toneClass(overview.totalUnrealizedPnl)),
    metricCard("Vandaag", formatMoney(today.realizedPnl), `${today.tradeCount || 0} trades vandaag`, toneClass(today.realizedPnl)),
    metricCard("30 dagen", formatMoney(days30.realizedPnl), `${formatPct(days30.winRate || 0, 1)} win rate`, toneClass(days30.realizedPnl)),
    metricCard("Universe", `${watchlist.resolvedCount || universe.configuredSymbolCount || 0} pairs`, `${(watchlist.source || "configured_watchlist").replaceAll("_", " ")} | focus ${universe.selectedCount || 0}`),
    metricCard("Data history", `${equitySeries.length}/${snapshot.configSummary?.dashboardEquityPointLimit || equitySeries.length}`, `${cycleSeries.length} analyses | ${(snapshot.dashboard.topDecisions || []).length} setups`)
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
    .map((position) => {
      const rationale = position.entryRationale || {};
      const latestStructure = position.latestMarketStructureSummary || rationale.marketStructure || {};
      const latestCalendar = position.latestCalendarSummary || rationale.calendar || {};
      const latestExchange = position.latestExchangeSummary || rationale.exchange || {};
      const execution = position.entryExecutionAttribution || rationale.executionAttribution || {};
      const session = rationale.session || {};
      const drift = rationale.drift || {};
      const selfHeal = rationale.selfHeal || {};
      const marketSentiment = rationale.marketSentiment || {};
      const volatility = rationale.volatility || {};
      const signals = (rationale.topSignals || [])
        .slice(0, 4)
        .map((signal) => `<div class="mini-stat"><span class="kicker">${escapeHtml(signal.name)}</span><strong class="${toneClass(signal.contribution)}">${formatNumber(signal.contribution, 3)}</strong></div>`)
        .join("");
      const checks = (rationale.checks || [])
        .slice(0, 6)
        .map((check) => `<div class="mini-stat"><span class="kicker">${escapeHtml(check.label)}</span><strong class="${check.passed ? "positive" : "negative"}">${check.passed ? "Pass" : "Fail"}</strong><div class="meta">${escapeHtml(check.detail)}</div></div>`)
        .join("");
      const headlines = (rationale.headlines || [])
        .slice(0, 4)
        .map((headline) => `<div class="mini-stat"><span class="kicker">${escapeHtml(headline.source || "Nieuws")}</span><strong>${escapeHtml(headline.title)}</strong><div class="meta">${escapeHtml(headline.provider || "source")} | ${formatDate(headline.publishedAt)}</div></div>`)
        .join("");
      const bullishDrivers = renderDriverCards(rationale.bullishDrivers || [], "Geen bullish drivers gevonden.");
      const bearishDrivers = renderDriverCards(rationale.bearishDrivers || [], "Geen bearish drivers gevonden.");
      const officialNotices = renderDriverCards(rationale.officialNotices || [], "Geen officiele Binance notices.");
      const calendarEvents = renderCalendarCards(rationale.calendarEvents || latestCalendar.items || [], "Geen komende events.");
      const providerMeta = formatBreakdown(rationale.providerBreakdown || []);
      const sourceMeta = formatBreakdown(rationale.sourceBreakdown || []);
      const noticeMeta = formatBreakdown(rationale.announcementBreakdown || []);

      return `
        <article class="position-card">
          <div class="card-top">
            <div>
              <div class="pill">${escapeHtml(position.symbol)} | ${escapeHtml(position.brokerMode.toUpperCase())}</div>
              <h3>${escapeHtml(position.symbol)} positie</h3>
              <p class="meta">Open sinds ${formatDate(position.entryAt)} | ${formatNumber(position.ageMinutes, 1)} min actief</p>
            </div>
            <div class="pill ${toneClass(position.unrealizedPnl)}">${formatMoney(position.unrealizedPnl)} | ${formatPct(position.unrealizedPnlPct, 2)}</div>
          </div>
          <div class="mini-grid">
            <div class="mini-stat"><span class="kicker">Entry</span><strong>${formatNumber(position.entryPrice, 6)}</strong></div>
            <div class="mini-stat"><span class="kicker">Nu</span><strong>${formatNumber(position.currentPrice, 6)}</strong></div>
            <div class="mini-stat"><span class="kicker">Stop loss</span><strong>${formatNumber(position.stopLossPrice, 6)}</strong></div>
            <div class="mini-stat"><span class="kicker">Take profit</span><strong>${formatNumber(position.takeProfitPrice, 6)}</strong></div>
            <div class="mini-stat"><span class="kicker">Regime</span><strong>${escapeHtml(position.regimeAtEntry || "-")}</strong></div>
            <div class="mini-stat"><span class="kicker">Execution</span><strong>${escapeHtml(position.executionPlan?.entryStyle || "-")}</strong></div>
            <div class="mini-stat"><span class="kicker">Setup</span><strong>${escapeHtml(rationale.setupStyle || "-")}</strong></div>
            <div class="mini-stat"><span class="kicker">Freshness</span><strong>${rationale.freshnessHours == null ? "-" : `${formatNumber(rationale.freshnessHours, 1)}u`}</strong></div>
          </div>
          <div class="mini-grid">
            <div class="mini-stat"><span class="kicker">Providers</span><strong>${rationale.providerDiversity || 0}</strong><div class="meta">${escapeHtml(providerMeta)}</div></div>
            <div class="mini-stat"><span class="kicker">Bronnen</span><strong>${rationale.sourceDiversity || 0}</strong><div class="meta">${escapeHtml(sourceMeta)}</div></div>
            <div class="mini-stat"><span class="kicker">Nieuws kwaliteit</span><strong>${formatNumber(rationale.sourceQualityScore || 0, 2)}</strong><div class="meta">rel ${formatNumber(rationale.reliabilityScore || 0, 2)}</div></div>
            <div class="mini-stat"><span class="kicker">Social</span><strong>${rationale.socialCoverage || 0}</strong><div class="meta">sent ${formatPct(rationale.socialSentiment || 0, 1)}</div></div>
            <div class="mini-stat"><span class="kicker">Sentiment / risk</span><strong>${formatPct(rationale.newsSentiment || 0, 1)} / ${formatPct(rationale.newsRisk || 0, 1)}</strong></div>
          </div>
          <div class="mini-grid">
            <div class="mini-stat"><span class="kicker">Funding</span><strong>${formatNumber(latestStructure.fundingRate || 0, 6)}</strong></div>
            <div class="mini-stat"><span class="kicker">Basis</span><strong>${formatNumber(latestStructure.basisBps || 0, 2)} bps</strong></div>
            <div class="mini-stat"><span class="kicker">OI 5m</span><strong>${formatPct(latestStructure.openInterestChangePct || 0, 2)}</strong></div>
            <div class="mini-stat"><span class="kicker">Liquidaties</span><strong>${latestStructure.liquidationCount || 0}</strong><div class="meta">${formatMoney(latestStructure.liquidationNotional || 0)}</div></div>
            <div class="mini-stat"><span class="kicker">Book pressure</span><strong>${formatNumber(rationale.orderBook?.bookPressure || 0, 2)}</strong><div class="meta">micro ${formatNumber(rationale.orderBook?.microPriceEdgeBps || 0, 2)} bps</div></div>
            <div class="mini-stat"><span class="kicker">Pattern</span><strong>${escapeHtml(rationale.patterns?.dominantPattern || "none")}</strong><div class="meta">bull ${formatNumber(rationale.patterns?.bullishPatternScore || 0, 2)} / bear ${formatNumber(rationale.patterns?.bearishPatternScore || 0, 2)}</div></div>
            <div class="mini-stat"><span class="kicker">Strategy</span><strong>${escapeHtml(rationale.strategy?.strategyLabel || position.strategyAtEntry || "-")}</strong><div class="meta">fit ${formatPct(rationale.strategy?.fitScore || 0, 1)} | conf ${formatPct(rationale.strategy?.confidence || 0, 1)}</div></div>
          </div>
          <div class="mini-grid">
            <div class="mini-stat"><span class="kicker">Strategy gap</span><strong>${formatPct(rationale.strategy?.agreementGap || 0, 1)}</strong><div class="meta">${escapeHtml(rationale.strategy?.setupStyle || "-")}</div></div>
            <div class="mini-stat"><span class="kicker">Transformer</span><strong>${formatPct(rationale.transformer?.probability || 0, 1)}</strong><div class="meta">conf ${formatPct(rationale.transformer?.confidence || 0, 1)} | ${escapeHtml(rationale.transformer?.dominantHead || "trend")}</div></div>
            <div class="mini-stat"><span class="kicker">Committee</span><strong>${formatPct(rationale.committee?.probability || 0, 1)}</strong><div class="meta">agree ${formatPct(rationale.committee?.agreement || 0, 1)}</div></div>
            <div class="mini-stat"><span class="kicker">Vetoes</span><strong>${(rationale.committee?.vetoes || []).length}</strong><div class="meta">net ${formatNumber(rationale.committee?.netScore || 0, 3)}</div></div>
            <div class="mini-stat"><span class="kicker">RL action</span><strong>${escapeHtml(rationale.rlPolicy?.action || "balanced")}</strong><div class="meta">reward ${formatNumber(rationale.rlPolicy?.expectedReward || 0, 3)}</div></div>
            <div class="mini-stat"><span class="kicker">RL size</span><strong>${formatNumber(rationale.rlPolicy?.sizeMultiplier || 1, 2)}x</strong><div class="meta">pat ${formatNumber(rationale.rlPolicy?.patienceMultiplier || 1, 2)}x</div></div>
            <div class="mini-stat"><span class="kicker">RL bucket</span><strong>${escapeHtml(rationale.rlPolicy?.bucket || "-")}</strong><div class="meta">boost ${formatNumber(rationale.rlPolicy?.preferMakerBoost || 0, 2)}</div></div>
            <div class="mini-stat"><span class="kicker">Exec impact</span><strong>${formatNumber(execution.expectedImpactBps || 0, 2)} bps</strong><div class="meta">slip ${formatNumber(execution.realizedTouchSlippageBps || 0, 2)} bps</div></div>
            <div class="mini-stat"><span class="kicker">Maker / queue</span><strong>${formatPct(execution.makerFillRatio || 0, 1)}</strong><div class="meta">queue ${formatNumber(execution.queueImbalance || 0, 2)} | depth ${formatNumber(execution.depthConfidence || 0, 2)}</div></div>
            <div class="mini-stat"><span class="kicker">Pegged / STP</span><strong>${execution.peggedOrder ? "Ja" : "Nee"}</strong><div class="meta">stp ${(execution.preventedMatchCount || 0)} | qty ${formatNumber(execution.preventedQuantity || 0, 6)}</div></div>
            <div class="mini-stat"><span class="kicker">Amend / replace</span><strong>${(execution.amendmentCount || 0)}</strong><div class="meta">keep ${(execution.keepPriorityCount || 0)} | repl ${(execution.cancelReplaceCount || 0)}</div></div>
          </div>
          <div class="mini-grid">
            <div class="mini-stat"><span class="kicker">Macro sentiment</span><strong>${marketSentiment.fearGreedValue == null ? "-" : `${formatNumber(marketSentiment.fearGreedValue, 1)}`}</strong><div class="meta">${escapeHtml(marketSentiment.fearGreedClassification || "fear/greed")} | dom ${marketSentiment.btcDominancePct == null ? "-" : `${formatNumber(marketSentiment.btcDominancePct, 1)}%`}</div></div>
            <div class="mini-stat"><span class="kicker">Options vol</span><strong>${volatility.marketOptionIv == null ? "-" : `${formatNumber(volatility.marketOptionIv, 1)}`}</strong><div class="meta">${escapeHtml(volatility.regime || "unknown")} | prem ${formatNumber(volatility.ivPremium || 0, 1)}</div></div>
            <div class="mini-stat"><span class="kicker">Session</span><strong>${escapeHtml(session.sessionLabel || session.session || "-")}</strong><div class="meta">${session.utcHour == null ? "-" : `${formatNumber(session.utcHour, 2)} UTC`} | ${escapeHtml(session.dayLabel || "-")}</div></div>
            <div class="mini-stat"><span class="kicker">Funding window</span><strong>${session.hoursToFunding == null ? "-" : `${formatNumber(session.hoursToFunding, 2)}u`}</strong><div class="meta">liq ${formatPct(session.lowLiquidityScore || 0, 1)} | risk ${formatPct(session.riskScore || 0, 1)}</div></div>
            <div class="mini-stat"><span class="kicker">Drift</span><strong>${escapeHtml((drift.status || "normal").toUpperCase())}</strong><div class="meta">sev ${formatPct(drift.severity || 0, 1)} | conf ${formatPct(drift.averageCandidateConfidence || 0, 1)}</div></div>
            <div class="mini-stat"><span class="kicker">Self-heal</span><strong>${escapeHtml((selfHeal.mode || "normal").replaceAll("_", " "))}</strong><div class="meta">thr ${formatPct(selfHeal.thresholdPenalty || 0, 1)} | size ${formatNumber(selfHeal.sizeMultiplier || 1, 2)}x</div></div>
          </div>
          <div>
            <p class="kicker">Waarom geopend</p>
            <p>${escapeHtml(rationale.summary || "Geen rationale beschikbaar.")}</p>
          </div>
          <div class="note-line"><span class="kicker">Regime-redenen</span><div class="tag-list">${renderTagList(rationale.regimeReasons || [], "Geen regime-redenen")}</div></div>
          <div class="note-line"><span class="kicker">Execution-notes</span><div class="tag-list">${renderTagList(rationale.executionReasons || [], "Geen execution-notes")}</div></div>
          <div class="note-line"><span class="kicker">Execution-attributie</span><div class="tag-list">${renderTagList(execution.notes || [], formatExecutionMeta(execution))}</div></div>
          <div class="note-line"><span class="kicker">Blockers</span><div class="tag-list">${renderTagList(rationale.blockerReasons || [], "Geen blokkerende redenen")}</div></div>
          <div class="note-line"><span class="kicker">Strategy redenen</span><div class="tag-list">${renderTagList(rationale.strategy?.reasons || [], "Geen strategy-redenen")}</div></div>
          <div class="note-line"><span class="kicker">Strategy blockers</span><div class="tag-list">${renderTagList(rationale.strategy?.blockers || [], "Geen strategy-blockers")}</div></div>
          <div class="note-line"><span class="kicker">Committee vetoes</span><div class="tag-list">${renderTagList((rationale.committee?.vetoes || []).map((item) => item.label || item.id), "Geen vetoes")}</div></div>
          <div class="note-line"><span class="kicker">RL redenen</span><div class="tag-list">${renderTagList(rationale.rlPolicy?.reasons || [], "Geen RL-notities")}</div></div>
          <div class="note-line"><span class="kicker">Kalender</span><div class="tag-list">${renderTagList((latestCalendar.blockerReasons || []).concat(rationale.calendarBlockers || []), "Geen kalender-blockers")}</div></div>
          <div class="note-line"><span class="kicker">Macro</span><div class="tag-list">${renderTagList((rationale.marketSentiment?.reasons || []).concat(rationale.volatility?.reasons || []), "Geen macro/vol-context")}</div></div>
          <div class="note-line"><span class="kicker">Session</span><div class="tag-list">${renderTagList((rationale.sessionReasons || []).concat(rationale.sessionBlockers || []), "Geen session-notities")}</div></div>
          <div class="note-line"><span class="kicker">Drift</span><div class="tag-list">${renderTagList((rationale.driftReasons || []).concat(rationale.driftBlockers || []), "Geen drift-waarschuwingen")}</div></div>
          <div class="note-line"><span class="kicker">Self-heal</span><div class="tag-list">${renderTagList(rationale.selfHealIssues || [], "Self-heal normaal")}</div></div>
          <div class="note-line"><span class="kicker">Official notices</span><div class="tag-list">${renderTagList((rationale.announcementBreakdown || []).map((item) => `${item.name}:${item.count}`), noticeMeta || "Geen officiele notices")}</div></div>
          <div class="signal-list">${signals || `<div class="empty">Geen top-signalen beschikbaar.</div>`}</div>
          <div class="driver-grid">
            <div>
              <p class="kicker">Bullish drivers</p>
              <div class="headline-list">${bullishDrivers}</div>
            </div>
            <div>
              <p class="kicker">Bearish drivers</p>
              <div class="headline-list">${bearishDrivers}</div>
            </div>
          </div>
          <div class="driver-grid">
            <div>
              <p class="kicker">Officiele notices</p>
              <div class="headline-list">${officialNotices}</div>
            </div>
            <div>
              <p class="kicker">Kalender-events</p>
              <div class="headline-list">${calendarEvents}</div>
            </div>
          </div>
          <div class="driver-grid">
            <div>
              <p class="kicker">Strategy ranking</p>
              <div class="headline-list">${renderStrategyCards(rationale.strategy?.strategies || [], "Geen strategy-ranking.")}</div>
            </div>
            <div>
              <p class="kicker">Bullish agents</p>
              <div class="headline-list">${renderAgentCards(rationale.committee?.bullishAgents || [], "Geen bullish agent-confirmaties.")}</div>
            </div>
          </div>
          <div class="driver-grid">
            <div>
              <p class="kicker">Transformer attention</p>
              <div class="headline-list">${renderAttentionCards(rationale.transformer?.attention || [], "Geen transformer attention.")}</div>
            </div>
            <div>
              <p class="kicker">Strategy backup</p>
              <div class="headline-list">${renderStrategyCards((rationale.strategy?.strategies || []).slice(1), "Geen alternatieve strategieen.")}</div>
            </div>
          </div>
          <div class="check-list">${checks || `<div class="empty">Geen checks beschikbaar.</div>`}</div>
          <div class="headline-list">${headlines || `<div class="empty">Geen headlines beschikbaar.</div>`}</div>
        </article>
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
      decision.strategy?.family,
      decision.strategySummary?.strategyLabel,
      ...(decision.reasons || []),
      ...(decision.blockerReasons || []),
      ...(decision.regimeReasons || []),
      ...(decision.executionReasons || []),
      ...((decision.bullishSignals || []).map((item) => item.name)),
      ...((decision.bearishSignals || []).map((item) => item.name)),
      ...((decision.bullishDrivers || []).map((item) => item.title)),
      ...((decision.bearishDrivers || []).map((item) => item.title)),
      ...((decision.officialNotices || []).map((item) => item.title))
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

  elements.decisionsList.innerHTML = filtered
    .slice(0, decisionLimit)
    .map((decision, index) => {
      const edge = Number(decision.edgeToThreshold ?? (decision.probability || 0) - (decision.threshold || 0));
      const thresholdGap = Math.max(0, (decision.threshold || 0) - (decision.probability || 0));
      const verdictTone = decision.allow ? "positive" : edge < 0 ? "negative" : "neutral";
      const strategyLabel = decision.strategy?.strategyLabel || decision.strategySummary?.strategyLabel || decision.setupStyle || "setup";
      const familyLabel = decision.strategy?.familyLabel || decision.strategy?.family || "family";
      const leadBull = decision.bullishSignals?.[0]?.name || decision.bullishDrivers?.[0]?.title || "geen sterke bull-driver";
      const leadBear = decision.blockerReasons?.[0] || decision.bearishSignals?.[0]?.name || decision.bearishDrivers?.[0]?.title || "geen grote blocker";
      const whyText = decision.allow
        ? `Doorgelaten: model ${formatPct(decision.probability || 0, 1)} boven gate ${formatPct(decision.threshold || 0, 1)}, committee ${formatPct(decision.committee?.probability || 0, 1)} en calibratie ${formatPct(decision.calibrationConfidence || 0, 1)}.`
        : `Geblokkeerd: model ${formatPct(decision.probability || 0, 1)} bleef ${formatPct(thresholdGap || 0, 1)} onder gate ${formatPct(decision.threshold || 0, 1)} of kreeg een veto (${normalizeReasonLabel(leadBear)}).`;
      const open = index < 3 || decision.allow;
      return `
        <details class="decision-card fold-card ${decision.allow ? "allowed" : "blocked"}" ${open ? "open" : ""}>
          <summary class="fold-summary">
            <div class="fold-header">
              <div>
                <div class="reason-pill ${decision.allow ? "" : "blocked"}">${decision.allow ? "Trade kandidaat" : "Geblokkeerd"}</div>
                <h3>${escapeHtml(decision.symbol)}</h3>
                <p class="meta">${escapeHtml(strategyLabel)} | ${escapeHtml(familyLabel)} | ${escapeHtml(decision.regime || "unknown")}</p>
              </div>
              <div class="pill ${verdictTone}">model ${formatPct(decision.probability, 1)}</div>
            </div>
            <div class="fold-stats">
              <span class="summary-chip">gate ${formatPct(decision.threshold, 1)}</span>
              <span class="summary-chip ${verdictTone}">edge ${formatSignedPct(edge, 1)}</span>
              <span class="summary-chip">conf ${formatPct(decision.confidence || 0, 1)}</span>
              <span class="summary-chip">committee ${formatPct(decision.committee?.probability || 0, 1)}</span>
              <span class="summary-chip">strategy ${formatPct((decision.strategy?.fitScore || decision.strategySummary?.fitScore || 0), 1)}</span>
              <span class="summary-chip">book ${formatNumber(decision.orderBook?.bookPressure || 0, 2)}</span>
            </div>
          </summary>
          <div class="fold-body">
            <p class="decision-blurb">${escapeHtml(whyText)}</p>
            <div class="mini-grid compact-grid">
              <div class="mini-stat"><span class="kicker">Calibration</span><strong>${formatPct(decision.calibrationConfidence, 1)}</strong></div>
              <div class="mini-stat"><span class="kicker">Disagreement</span><strong>${formatPct(decision.disagreement || 0, 1)}</strong></div>
              <div class="mini-stat"><span class="kicker">Execution</span><strong>${escapeHtml(decision.executionStyle || "market")}</strong></div>
              <div class="mini-stat"><span class="kicker">Freshness</span><strong>${decision.freshnessHours == null ? "-" : `${formatNumber(decision.freshnessHours, 1)}u`}</strong></div>
              <div class="mini-stat"><span class="kicker">Providers</span><strong>${decision.providerDiversity || 0}</strong><div class="meta">${escapeHtml(formatBreakdown(decision.providerBreakdown || []))}</div></div>
              <div class="mini-stat"><span class="kicker">Social</span><strong>${decision.socialCoverage || 0}</strong><div class="meta">sent ${formatPct(decision.socialSentiment || 0, 1)}</div></div>
              <div class="mini-stat"><span class="kicker">Nieuws risk</span><strong>${formatPct(decision.newsRisk, 1)}</strong><div class="meta">ann ${formatPct(decision.announcementRisk || 0, 1)}</div></div>
              <div class="mini-stat"><span class="kicker">Universe</span><strong>${escapeHtml(decision.universe?.health || "watch")}</strong><div class="meta">score ${formatPct(decision.universe?.score || 0, 1)}</div></div>
            </div>
            <div class="mini-grid compact-grid">
              <div class="mini-stat"><span class="kicker">Funding</span><strong>${formatNumber(decision.marketStructure?.fundingRate || 0, 6)}</strong></div>
              <div class="mini-stat"><span class="kicker">Basis</span><strong>${formatNumber(decision.marketStructure?.basisBps || 0, 2)} bps</strong></div>
              <div class="mini-stat"><span class="kicker">OI 5m</span><strong>${formatPct(decision.marketStructure?.openInterestChangePct || 0, 2)}</strong></div>
              <div class="mini-stat"><span class="kicker">Long/short</span><strong>${formatNumber(decision.marketStructure?.globalLongShortRatio || 1, 2)}</strong><div class="meta">top ${formatNumber(decision.marketStructure?.topTraderLongShortRatio || 1, 2)}</div></div>
              <div class="mini-stat"><span class="kicker">Liquidaties</span><strong>${decision.marketStructure?.liquidationCount || 0}</strong><div class="meta">${formatMoney(decision.marketStructure?.liquidationNotional || 0)}</div></div>
              <div class="mini-stat"><span class="kicker">Book pressure</span><strong>${formatNumber(decision.orderBook?.bookPressure || 0, 2)}</strong><div class="meta">micro ${formatNumber(decision.orderBook?.microPriceEdgeBps || 0, 2)} bps</div></div>
              <div class="mini-stat"><span class="kicker">Pattern</span><strong>${escapeHtml(decision.patterns?.dominantPattern || "none")}</strong><div class="meta">bull ${formatNumber(decision.patterns?.bullishPatternScore || 0, 2)} / bear ${formatNumber(decision.patterns?.bearishPatternScore || 0, 2)}</div></div>
              <div class="mini-stat"><span class="kicker">Macro</span><strong>${decision.marketSentiment?.fearGreedValue == null ? "-" : `${formatNumber(decision.marketSentiment.fearGreedValue, 1)}`}</strong><div class="meta">${escapeHtml(decision.marketSentiment?.fearGreedClassification || "fear/greed")}</div></div>
              <div class="mini-stat"><span class="kicker">Options vol</span><strong>${decision.volatility?.marketOptionIv == null ? "-" : `${formatNumber(decision.volatility.marketOptionIv, 1)}`}</strong><div class="meta">${escapeHtml(decision.volatility?.regime || "unknown")} | prem ${formatNumber(decision.volatility?.ivPremium || 0, 1)}</div></div>
              <div class="mini-stat"><span class="kicker">Strategy</span><strong>${escapeHtml(strategyLabel)}</strong><div class="meta">fit ${formatPct((decision.strategy?.fitScore || decision.strategySummary?.fitScore || 0), 1)} | conf ${formatPct((decision.strategy?.confidence || decision.strategySummary?.confidence || 0), 1)}</div></div>
            </div>
            <div class="mini-grid compact-grid">
              <div class="mini-stat"><span class="kicker">ADX / DMI</span><strong>${formatNumber(decision.indicators?.adx14 || 0, 1)}</strong><div class="meta">dmi ${formatNumber(decision.indicators?.dmiSpread || 0, 2)} | tq ${formatNumber(decision.indicators?.trendQualityScore || 0, 2)}</div></div>
              <div class="mini-stat"><span class="kicker">Supertrend</span><strong>${decision.indicators?.supertrendDirection > 0 ? "up" : decision.indicators?.supertrendDirection < 0 ? "down" : "flat"}</strong><div class="meta">dist ${formatPct(decision.indicators?.supertrendDistancePct || 0, 2)} | flip ${formatNumber(decision.indicators?.supertrendFlipScore || 0, 2)}</div></div>
              <div class="mini-stat"><span class="kicker">Stoch RSI</span><strong>${formatNumber(decision.indicators?.stochRsiK || 0, 1)}</strong><div class="meta">signal ${formatNumber(decision.indicators?.stochRsiD || 0, 1)}</div></div>
              <div class="mini-stat"><span class="kicker">MFI</span><strong>${formatNumber(decision.indicators?.mfi14 || 0, 1)}</strong><div class="meta">cmf ${formatNumber(decision.indicators?.cmf20 || 0, 2)}</div></div>
              <div class="mini-stat"><span class="kicker">Keltner squeeze</span><strong>${formatPct(decision.indicators?.keltnerSqueezeScore || 0, 1)}</strong><div class="meta">release ${formatPct(decision.indicators?.squeezeReleaseScore || 0, 1)}</div></div>
            </div>
            <div class="mini-grid">
              <div class="mini-stat"><span class="kicker">Transformer</span><strong>${formatPct(decision.transformer?.probability || 0, 1)}</strong><div class="meta">conf ${formatPct(decision.transformer?.confidence || 0, 1)} | ${escapeHtml(decision.transformer?.dominantHead || "trend")}</div></div>
              <div class="mini-stat"><span class="kicker">Committee</span><strong>${formatPct(decision.committee?.probability || 0, 1)}</strong><div class="meta">agree ${formatPct(decision.committee?.agreement || 0, 1)} | net ${formatNumber(decision.committee?.netScore || 0, 3)}</div></div>
              <div class="mini-stat"><span class="kicker">Meta gate</span><strong>${formatPct(decision.meta?.score || 0, 1)}</strong><div class="meta">budget ${formatPct(decision.meta?.dailyBudgetFactor || 0, 1)}</div></div>
              <div class="mini-stat"><span class="kicker">Session</span><strong>${escapeHtml(decision.session?.sessionLabel || decision.session?.session || "-")}</strong><div class="meta">${decision.session?.utcHour == null ? "-" : `${formatNumber(decision.session.utcHour, 2)} UTC`} | ${escapeHtml(decision.session?.dayLabel || "-")}</div></div>
              <div class="mini-stat"><span class="kicker">Self-heal</span><strong>${escapeHtml((decision.selfHeal?.mode || "normal").replaceAll("_", " "))}</strong><div class="meta">thr ${formatPct(decision.selfHeal?.thresholdPenalty || 0, 1)} | size ${formatNumber(decision.selfHeal?.sizeMultiplier || 1, 2)}x</div></div>
              <div class="mini-stat"><span class="kicker">Exec impact</span><strong>${formatNumber(decision.executionAttribution?.expectedImpactBps || 0, 2)} bps</strong><div class="meta">maker ${formatPct(decision.executionAttribution?.makerFillRatio || 0, 1)}</div></div>
            </div>
            <div class="note-line"><span class="kicker">Score pad</span><div class="tag-list">${renderTagList([`model ${formatPct(decision.probability || 0, 1)}`, `gate ${formatPct(decision.threshold || 0, 1)}`, `edge ${formatSignedPct(edge || 0, 1)}`, `committee ${formatPct(decision.committee?.probability || 0, 1)}`, `calibratie ${formatPct(decision.calibrationConfidence || 0, 1)}`], "Geen scorepad")}</div></div>
            <div class="note-line"><span class="kicker">Waarom hoog</span><div class="tag-list">${renderTagList([normalizeReasonLabel(leadBull), ...(decision.bullishSignals || []).slice(0, 2).map((item) => `${item.name}:${formatNumber(item.contribution || 0, 2)}`)], "Geen bullish signaal")}</div></div>
            <div class="note-line"><span class="kicker">Waarom niet</span><div class="tag-list">${renderTagList([normalizeReasonLabel(leadBear), ...(decision.blockerReasons || []).slice(0, 4)], "Geen blockers")}</div></div>
            <div class="note-line"><span class="kicker">Strategy + execution</span><div class="tag-list">${renderTagList([...(decision.strategy?.reasons || decision.strategySummary?.reasons || []), ...(decision.executionReasons || [])], "Geen strategy/execution-notes")}</div></div>
            <div class="note-line"><span class="kicker">Macro + risk</span><div class="tag-list">${renderTagList([...(decision.marketStructure?.reasons || []), ...(decision.calendar?.blockerReasons || []), ...(decision.selfHealIssues || []), ...(decision.sessionBlockers || []), ...(decision.driftBlockers || [])], "Geen extra risk-flags")}</div></div>
            <div class="driver-grid">
              <div>
                <p class="kicker">Bullish drivers</p>
                <div class="headline-list">${renderDriverCards(decision.bullishDrivers || [], "Geen bullish drivers.")}</div>
              </div>
              <div>
                <p class="kicker">Bearish drivers</p>
                <div class="headline-list">${renderDriverCards(decision.bearishDrivers || [], "Geen bearish drivers.")}</div>
              </div>
            </div>
            <div class="driver-grid">
              <div>
                <p class="kicker">Officiele notices</p>
                <div class="headline-list">${renderDriverCards(decision.officialNotices || [], "Geen officiele notices.")}</div>
              </div>
              <div>
                <p class="kicker">Strategy ranking</p>
                <div class="headline-list">${renderStrategyCards(decision.strategy?.strategies || decision.strategySummary?.strategies || [], "Geen strategy-ranking.")}</div>
              </div>
            </div>
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
  const portfolio = snapshot.dashboard.portfolio || {};
  const exchange = snapshot.dashboard.exchange || {};
  const marketStructure = snapshot.dashboard.marketStructure || {};
  const volatility = snapshot.dashboard.volatility || {};
  const calendar = snapshot.dashboard.calendar || {};
  const safety = snapshot.dashboard.safety || {};
  const session = safety.session || {};
  const drift = safety.drift || {};
  const selfHeal = safety.selfHeal || {};
  const stableSnapshots = safety.stableModelSnapshots || [];
  const backups = safety.backups || {};
  const recovery = safety.recovery || {};
  const topCluster = (portfolio.clusters || [])[0];
  const topSector = (portfolio.sectors || [])[0];
  const topDecision = (snapshot.dashboard.topDecisions || [])[0] || {};
  const recorder = snapshot.dashboard.dataRecorder || {};

  const transformer = snapshot.dashboard.ai?.transformer || {};
  const rlPolicy = snapshot.dashboard.ai?.rlPolicy || {};
  const committee = snapshot.dashboard.ai?.committee || {};
  const strategy = snapshot.dashboard.ai?.strategy || {};
  const optimizer = snapshot.dashboard.ai?.optimizer || {};
  const modelRegistry = snapshot.dashboard.ai?.modelRegistry || {};
  const executionReport = snapshot.dashboard.report?.executionSummary || {};
  const latestStableSnapshot = stableSnapshots[0] || {};
  const topPolicy = (rlPolicy.topPolicies || [])[0] || {};
  const adaptiveGate = topDecision.optimizerApplied || {};
  const adaptiveThreshold = adaptiveGate.effectiveThreshold ?? topDecision.threshold ?? 0;
  const adaptiveBaseThreshold = adaptiveGate.baseThreshold ?? topDecision.baseThreshold ?? adaptiveThreshold;
  const adaptiveStrategyFloor = adaptiveGate.strategyConfidenceFloor ?? topDecision.strategyConfidenceFloor ?? strategy.confidence ?? 0;

  elements.aiSummary.innerHTML = [
    insightCard("Actief model", (deployment.active || "champion").toUpperCase(), `${deployment.shadowTradeCount || 0} shadow trades`),
    insightCard("Calibration", `${formatNumber((calibration.expectedCalibrationError || 0) * 100, 1)}% ECE`, `${calibration.observations || 0} observaties`, (calibration.expectedCalibrationError || 0) < 0.1 ? "positive" : "neutral"),
    insightCard("Transformer", transformer.averageError == null ? "Nog leeg" : `${formatNumber((transformer.averageError || 0) * 100, 1)}% fout`, `${transformer.observations || 0} learns`, transformer.averageError != null && transformer.averageError < 0.2 ? "positive" : "neutral"),
    insightCard("Committee", `${formatPct(committee.agreement || 0, 1)} agree`, `net ${formatNumber(committee.netScore || 0, 3)}`, (committee.agreement || 0) > 0.5 ? "positive" : "neutral"),
    insightCard("RL policy", topPolicy.action || "-", topPolicy.bucket ? `${topPolicy.bucket} | ${formatNumber(topPolicy.value || 0, 3)}` : "Nog geen policy-data", (rlPolicy.averageReward || 0) > 0 ? "positive" : (rlPolicy.averageReward || 0) < 0 ? "negative" : "neutral"),
    insightCard("Strategy", strategy.strategyLabel || topDecision.strategy?.strategyLabel || "-", `fit ${formatPct(strategy.fitScore || topDecision.strategy?.fitScore || 0, 1)} | conf ${formatPct(strategy.confidence || topDecision.strategy?.confidence || 0, 1)}`, (strategy.fitScore || topDecision.strategy?.fitScore || 0) > 0.55 ? "positive" : "neutral"),
    insightCard("Promoties", `${(deployment.promotions || []).length}`, deployment.lastPromotionAt ? `Laatste ${formatDate(deployment.lastPromotionAt)}` : "Nog geen promoties"),
    insightCard("Model registry", `${formatPct(modelRegistry.currentQualityScore || 0, 1)}`, modelRegistry.rollbackCandidate?.at ? `rollback ${formatDate(modelRegistry.rollbackCandidate.at)} | q ${formatNumber(modelRegistry.rollbackCandidate.qualityScore || 0, 2)}` : "Nog geen rollback-kandidaat", (modelRegistry.currentQualityScore || 0) >= 0.6 ? "positive" : "neutral")
  ].join("");

  elements.optimizerSummary.innerHTML = [
    insightCard("Optimizer sample", `${optimizer.sampleSize || 0} trades`, `confidence ${formatPct(optimizer.sampleConfidence || 0, 1)}`),
    insightCard("Adaptive gate", `${formatPct(adaptiveThreshold || 0, 1)}`, `base ${formatPct(adaptiveBaseThreshold || 0, 1)} | delta ${formatPct(adaptiveGate.thresholdAdjustment || 0, 1)}`, (adaptiveGate.thresholdAdjustment || 0) >= 0 ? "positive" : (adaptiveGate.thresholdAdjustment || 0) < 0 ? "negative" : "neutral"),
    insightCard("Strategy floor", `${formatPct(adaptiveStrategyFloor || 0, 1)}`, `family ${formatPct(adaptiveGate.familyConfidenceTilt || 0, 1)} | strategy ${formatPct(adaptiveGate.strategyConfidenceTilt || 0, 1)}`, (adaptiveGate.strategyConfidenceAdjustment || 0) >= 0 ? "positive" : (adaptiveGate.strategyConfidenceAdjustment || 0) < 0 ? "negative" : "neutral"),
    insightCard("Top strategy", optimizer.topStrategies?.[0]?.label || "-", optimizer.topStrategies?.[0] ? `${formatPct(optimizer.topStrategies[0].winRate || 0, 1)} win | ${optimizer.topStrategies[0].tradeCount} trades` : "Nog geen optimizer-history"),
    insightCard("Top family", optimizer.topFamilies?.[0]?.label || "-", optimizer.topFamilies?.[0] ? `${formatPct(optimizer.topFamilies[0].winRate || 0, 1)} win | ${optimizer.topFamilies[0].tradeCount} trades` : "Nog geen family-prior"),
    insightCard("Global tilts", `thr ${formatPct(optimizer.thresholdTilt || 0, 1)}`, `conf ${formatPct(optimizer.confidenceTilt || 0, 1)}`, (optimizer.thresholdTilt || 0) >= 0 ? "positive" : (optimizer.thresholdTilt || 0) < 0 ? "negative" : "neutral")
  ].join("");

  elements.streamSummary.innerHTML = [
    insightCard("Market stream", stream.publicStreamConnected ? "Verbonden" : "Niet verbonden", stream.lastPublicMessageAt ? `Laatste tick ${formatDate(stream.lastPublicMessageAt)}` : "Nog geen tick", stream.publicStreamConnected ? "positive" : "negative"),
    insightCard("Liquidation stream", stream.futuresStreamConnected ? "Verbonden" : "Niet verbonden", stream.lastFuturesMessageAt ? `Laatste liquidation ${formatDate(stream.lastFuturesMessageAt)}` : "Nog geen liquidation-tick", stream.futuresStreamConnected ? "positive" : "neutral"),
    insightCard("User stream", stream.userStreamConnected ? "Verbonden" : "Inactief", stream.lastUserMessageAt ? `Laatste event ${formatDate(stream.lastUserMessageAt)}` : "Geen account-events", stream.userStreamConnected ? "positive" : "neutral")
  ].join("");

  elements.executionSummary.innerHTML = [
    insightCard("Local book", `${stream.localBook?.healthySymbols || 0}/${stream.localBook?.activeSymbols || stream.localBook?.trackedSymbols || 0}`, `actief ${stream.localBook?.activeSymbols || 0} | conf ${formatNumber(stream.localBook?.averageDepthConfidence || 0, 2)} | resync ${stream.localBook?.totalResyncs || 0}`, (stream.localBook?.healthySymbols || 0) > 0 ? "positive" : "neutral"),
    insightCard("Entry slippage", `${formatNumber(executionReport.avgEntryTouchSlippageBps || 0, 2)} bps`, `exit ${formatNumber(executionReport.avgExitTouchSlippageBps || 0, 2)} bps`, (executionReport.avgEntryTouchSlippageBps || 0) <= 1.5 ? "positive" : "neutral"),
    insightCard("Maker ratio", `${formatPct(executionReport.avgMakerFillRatio || 0, 1)}`, `${executionReport.peggedCount || 0} pegged fills`, (executionReport.avgMakerFillRatio || 0) >= 0.35 ? "positive" : "neutral"),
    insightCard("STP / SOR", `${executionReport.preventedMatchCount || 0} matches`, `qty ${formatNumber(executionReport.totalPreventedQuantity || 0, 6)} | sor ${executionReport.sorCount || 0}`, (executionReport.preventedMatchCount || 0) === 0 ? "positive" : "neutral"),
    insightCard("Top style", executionReport.styles?.[0]?.style || "-", executionReport.styles?.[0] ? `${executionReport.styles[0].tradeCount} trades | ${formatMoney(executionReport.styles[0].realizedPnl || 0)}` : "Nog geen execution-history"),
    insightCard("Style slip", executionReport.styles?.[0] ? `${formatNumber(executionReport.styles[0].avgEntryTouchSlippageBps || 0, 2)} bps` : "-", executionReport.styles?.[0] ? `maker ${formatPct(executionReport.styles[0].avgMakerFillRatio || 0, 1)}` : "Nog geen style-stats")
  ].join("");

  elements.portfolioSummary.innerHTML = [
    insightCard("Top cluster", topCluster ? topCluster.name : "-", topCluster ? formatMoney(topCluster.exposure) : "Geen exposure"),
    insightCard("Top sector", topSector ? topSector.name : "-", topSector ? formatMoney(topSector.exposure) : "Geen exposure"),
    insightCard("Open clusters", `${(portfolio.clusters || []).length}`, `${(portfolio.sectors || []).length} sectoren actief`)
  ].join("");

  elements.newsSummary.innerHTML = [
    insightCard("Nieuws mesh", `${topDecision.providerDiversity || 0} providers`, topDecision.providerBreakdown ? formatBreakdown(topDecision.providerBreakdown) : "Nog geen bronverdeling"),
    insightCard("Dominant event", topDecision.dominantEventType || "-", topDecision.sourceBreakdown ? formatBreakdown(topDecision.sourceBreakdown) : "Nog geen bronverdeling"),
    insightCard("Freshness", topDecision.freshnessHours == null ? "-" : `${formatNumber(topDecision.freshnessHours, 1)} uur`, topDecision.sourceQualityScore == null ? "Nog geen nieuwsdata" : `kwaliteit ${formatNumber(topDecision.sourceQualityScore || 0, 2)} | rel ${formatNumber(topDecision.reliabilityScore || 0, 2)}`)
  ].join("");

  elements.marketStructureSummary.innerHTML = [
    insightCard("Funding", `${formatNumber(marketStructure.fundingRate || 0, 6)}`, marketStructure.nextFundingTime ? `Next funding ${formatDate(marketStructure.nextFundingTime)}` : "Nog geen funding-data", toneClass(-(marketStructure.fundingRate || 0))),
    insightCard("Basis", `${formatNumber(marketStructure.basisBps || 0, 2)} bps`, marketStructure.reasons ? renderTextList(marketStructure.reasons) : "Nog geen basis-signalen"),
    insightCard("Liquidaties", `${marketStructure.liquidationCount || 0}`, `${formatMoney(marketStructure.liquidationNotional || 0)} | risk ${formatNumber(marketStructure.riskScore || 0, 2)}`)
  ].join("");

  elements.volatilitySummary.innerHTML = [
    insightCard("Option IV", volatility.marketOptionIv == null ? "-" : `${formatNumber(volatility.marketOptionIv, 1)}`, volatility.marketHistoricalVol == null ? "Geen Deribit context" : `hist ${formatNumber(volatility.marketHistoricalVol || 0, 1)} | prem ${formatNumber(volatility.ivPremium || 0, 1)}`, (volatility.riskScore || 0) >= 0.75 ? "negative" : (volatility.regime || "calm") === "calm" ? "positive" : "neutral"),
    insightCard("Vol regime", volatility.regime || "unknown", volatility.coverage ? `${volatility.coverage} bronnen` : "Nog geen vol-feed", (volatility.regime || "unknown") === "stress" ? "negative" : (volatility.regime || "unknown") === "calm" ? "positive" : "neutral"),
    insightCard("Vol risk", `${formatPct(volatility.riskScore || 0, 1)}`, renderTextList(volatility.reasons || []), (volatility.riskScore || 0) >= 0.75 ? "negative" : "neutral")
  ].join("");

  elements.calendarSummary.innerHTML = [
    insightCard("Volgend event", calendar.nextEventType || "-", calendar.nextEventTitle || "Geen event in venster"),
    insightCard("Proximity", calendar.proximityHours == null ? "-" : `${formatNumber(calendar.proximityHours, 1)}u`, `risk ${formatNumber(calendar.riskScore || 0, 2)} | urgency ${formatNumber(calendar.urgencyScore || 0, 2)}`),
    insightCard("Exchange notices", `${exchange.coverage || 0}`, exchange.categoryCounts ? formatBreakdown(exchange.categoryCounts) : "Nog geen officiele notices")
  ].join("");

  elements.driftSummary.innerHTML = [
    insightCard("Drift status", (drift.status || "normal").toUpperCase(), `sev ${formatPct(drift.severity || 0, 1)} | avg conf ${formatPct(drift.averageCandidateConfidence || 0, 1)}`, (drift.severity || 0) >= 0.82 ? "negative" : (drift.severity || 0) >= 0.45 ? "neutral" : "positive"),
    insightCard("Feature drift", `${formatPct(drift.featureDriftScore || 0, 1)}`, `source ${formatPct(drift.sourceDriftScore || 0, 1)} | data ${formatPct(drift.dataScore || 0, 1)}`, (drift.featureDriftScore || 0) >= 0.55 ? "negative" : "positive"),
    insightCard("Cal / exec drift", `ECE ${formatPct(drift.calibrationScore || 0, 1)}`, `slip ${formatPct(drift.executionScore || 0, 1)} | perf ${formatPct(drift.performanceScore || 0, 1)}`, (drift.calibrationScore || 0) >= 0.4 || (drift.executionScore || 0) >= 0.45 ? "negative" : "neutral")
  ].join("");

  elements.safetySummary.innerHTML = [
    insightCard("Session", session.sessionLabel || session.session || "-", `${session.dayLabel || "-"} | ${session.utcHour == null ? "-" : `${formatNumber(session.utcHour, 2)} UTC`}`, session.lowLiquidity || session.inHardFundingBlock ? "negative" : session.isWeekend || session.inFundingCaution ? "neutral" : "positive"),
    insightCard("Funding window", session.hoursToFunding == null ? "-" : `${formatNumber(session.hoursToFunding, 2)}u`, `liq ${formatPct(session.lowLiquidityScore || 0, 1)} | risk ${formatPct(session.riskScore || 0, 1)}`, session.inHardFundingBlock ? "negative" : session.inFundingCaution ? "neutral" : "positive"),
    insightCard("Self-heal", (selfHeal.mode || "normal").replaceAll("_", " "), selfHeal.cooldownUntil ? `cooldown tot ${formatDate(selfHeal.cooldownUntil)}` : selfHeal.reason || "Geen actieve cooldown", selfHeal.active ? (selfHeal.mode === "paper_fallback" || selfHeal.mode === "paused" ? "negative" : "neutral") : "positive"),
    insightCard("Stable model", latestStableSnapshot.at ? `${latestStableSnapshot.tradeCount || 0} trades` : "Nog geen snapshot", latestStableSnapshot.at ? `${formatDate(latestStableSnapshot.at)} | win ${formatPct(latestStableSnapshot.winRate || 0, 1)}` : "Rollback backup nog leeg", latestStableSnapshot.at ? "positive" : "neutral"),
    insightCard("Backups", `${backups.backupCount || 0}`, backups.lastBackupAt ? `laatst ${formatDate(backups.lastBackupAt)} | ${backups.lastReason || "backup"}` : "Nog geen backup", (backups.backupCount || 0) > 0 ? "positive" : "neutral"),
    insightCard("Feature store", `${recorder.filesWritten || 0} frames`, recorder.lastRecordAt ? `laatst ${formatDate(recorder.lastRecordAt)}` : "Nog geen recorder-data", (recorder.filesWritten || 0) > 0 ? "positive" : "neutral"),
    insightCard("Recovery", recovery.uncleanShutdownDetected ? "Waarschuwing" : "Schoon", recovery.restoredFromBackupAt ? `restore ${formatDate(recovery.restoredFromBackupAt)}` : recovery.latestBackupAt ? `backup ${formatDate(recovery.latestBackupAt)}` : "Geen herstel nodig", recovery.uncleanShutdownDetected ? "negative" : "positive")
  ].join("");

  const upcomingEvents = snapshot.dashboard.upcomingEvents || [];
  elements.upcomingEventsList.innerHTML = upcomingEvents.length
    ? upcomingEvents
        .map((event) => `
          <div class="event-row">
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
          <div class="event-row">
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
        .map(
          (item, index) => `
            <details class="blocked-card fold-card blocked" ${index < 2 ? "open" : ""}>
              <summary class="fold-summary">
                <div class="fold-header">
                  <div>
                    <div class="reason-pill blocked">No trade</div>
                    <h3>${escapeHtml(item.symbol || "setup")}</h3>
                    <p class="meta">${escapeHtml(item.strategy?.strategyLabel || item.setupStyle || "Geblokkeerde setup")} | ${escapeHtml(item.regime || "unknown")}</p>
                  </div>
                  <div class="pill negative">model ${formatPct(item.probability || 0, 1)}</div>
                </div>
                <div class="fold-stats">
                  <span class="summary-chip">gate ${formatPct(item.threshold || 0, 1)}</span>
                  <span class="summary-chip negative">edge ${formatSignedPct(item.edgeToThreshold || 0, 1)}</span>
                  <span class="summary-chip">meta ${formatPct(item.meta?.score || 0, 1)}</span>
                  <span class="summary-chip">self-heal ${escapeHtml((item.selfHeal?.mode || "normal").replaceAll("_", " "))}</span>
                </div>
              </summary>
              <div class="fold-body">
                <p class="decision-blurb">${escapeHtml(item.summary || "Geen samenvatting beschikbaar.")}</p>
                <div class="mini-grid">
                  <div class="mini-stat"><span class="kicker">Strategie</span><strong>${escapeHtml(item.strategy?.familyLabel || item.strategy?.family || "-")}</strong><div class="meta">${escapeHtml(item.strategy?.strategyLabel || item.setupStyle || "-")} | fit ${formatPct(item.strategy?.fitScore || 0, 1)}</div></div>
                  <div class="mini-stat"><span class="kicker">Committee</span><strong>${formatPct(item.committee?.probability || 0, 1)}</strong><div class="meta">agree ${formatPct(item.committee?.agreement || 0, 1)}</div></div>
                  <div class="mini-stat"><span class="kicker">Meta gate</span><strong>${formatPct(item.meta?.score || 0, 1)}</strong><div class="meta">budget ${formatPct(item.meta?.dailyBudgetFactor || 0, 1)} | canary ${item.meta?.canaryActive ? "aan" : "uit"}</div></div>
                  <div class="mini-stat"><span class="kicker">Session</span><strong>${escapeHtml(item.session?.sessionLabel || item.session?.session || "-")}</strong><div class="meta">${escapeHtml(item.session?.dayLabel || "-")}</div></div>
                </div>
                <div class="note-line"><span class="kicker">Blockers</span><div class="tag-list">${renderTagList(item.blockerReasons || item.reasons || [], "Geen blockers")}</div></div>
                <div class="note-line"><span class="kicker">Regime</span><div class="tag-list">${renderTagList(item.regimeReasons || [], "Geen regime-redenen")}</div></div>
                <div class="note-line"><span class="kicker">Safety</span><div class="tag-list">${renderTagList([...(item.selfHealIssues || []), ...(item.sessionBlockers || []), ...(item.driftBlockers || [])], "Geen extra safety-flags")}</div></div>
              </div>
            </details>
          `
        )
        .join("")
    : `<div class="empty">Geen recente geblokkeerde setups.</div>`;
}

function renderTradeReplays(snapshot) {
  const replays = snapshot.dashboard.tradeReplays || [];
  elements.replayList.innerHTML = replays.length
    ? replays
        .map(
          (trade, index) => `
            <details class="replay-card fold-card" ${index < 2 ? "open" : ""}>
              <summary class="fold-summary">
                <div class="fold-header">
                  <div>
                    <div class="kicker">${escapeHtml(trade.symbol || "trade")}</div>
                    <h3>${escapeHtml(trade.strategy || trade.regime || "Trade replay")}</h3>
                    <p class="meta">${escapeHtml(trade.regime || "-")} | open ${formatDate(trade.entryAt)} | dicht ${formatDate(trade.exitAt)}</p>
                  </div>
                  <div class="pill ${toneClass(trade.pnlQuote || 0)}">${formatMoney(trade.pnlQuote || 0)}</div>
                </div>
                <div class="fold-stats">
                  <span class="summary-chip ${toneClass(trade.netPnlPct || 0)}">rendement ${formatPct(trade.netPnlPct || 0, 2)}</span>
                  <span class="summary-chip">entry ${escapeHtml(trade.entryExecution?.entryStyle || "-")}</span>
                  <span class="summary-chip">exit ${escapeHtml(trade.exitExecution?.entryStyle || "-")}</span>
                  <span class="summary-chip">duur ${formatNumber(trade.durationMinutes || 0, 1)} min</span>
                </div>
              </summary>
              <div class="fold-body">
                <div class="mini-grid">
                  <div class="mini-stat"><span class="kicker">Entry exec</span><strong>${escapeHtml(formatExecutionMeta(trade.entryExecution || {}))}</strong></div>
                  <div class="mini-stat"><span class="kicker">Exit exec</span><strong>${escapeHtml(formatExecutionMeta(trade.exitExecution || {}))}</strong></div>
                  <div class="mini-stat"><span class="kicker">Scale-outs</span><strong>${trade.scaleOutCount || 0}</strong></div>
                  <div class="mini-stat"><span class="kicker">Exit AI</span><strong>${escapeHtml((trade.exitIntelligence?.action || "hold").replaceAll("_", " "))}</strong><div class="meta">score ${formatPct(trade.exitIntelligence?.score || 0, 1)}</div></div>
                </div>
                <div class="note-line"><span class="kicker">Waarom open</span><div class="tag-list">${renderTagList([trade.whyOpened].filter(Boolean), "Geen entry-uitleg")}</div></div>
                <div class="note-line"><span class="kicker">Waarom dicht</span><div class="tag-list">${renderTagList([trade.whyClosed].filter(Boolean), "Geen exit-reden")}</div></div>
                <div class="note-line"><span class="kicker">Exit AI</span><div class="tag-list">${renderTagList([`${(trade.exitIntelligence?.action || "hold").replaceAll("_", " ")}`, ...(trade.exitIntelligence?.riskReasons || []), ...(trade.exitIntelligence?.positiveReasons || [])], "Geen exit-AI notities")}</div></div>
                <div class="note-line"><span class="kicker">Blockers bij entry</span><div class="tag-list">${renderTagList(trade.blockersAtEntry || [], "Geen blockers op entry")}</div></div>
                ${renderTimelineRows(trade.timeline || [], "Nog geen replay-timeline.")}
              </div>
            </details>
          `
        )
        .join("")
    : `<div class="empty">Nog geen trade replays beschikbaar.</div>`;
}

function renderResearch(snapshot) {
  const research = snapshot.dashboard.research;
  if (!research?.generatedAt) {
    elements.researchList.innerHTML = `<div class="empty">Nog geen research-run uitgevoerd.</div>`;
    return;
  }

  const leadReport = (research.reports || [])[0] || {};
  const leadExperiments = (leadReport.experiments || []).slice(0, 4).map((item) => ({
    label: `${item.tradeCount || 0} trades`,
    at: item.testEndAt || research.generatedAt,
    detail: `${formatMoney(item.realizedPnl || 0)} | win ${formatPct(item.winRate || 0, 1)} | sharpe ${formatNumber(item.sharpe || 0, 2)}${item.strategyLeaders?.length ? ` | ${item.strategyLeaders.join(", ")}` : ""}`
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
      <div class="note-line"><span class="kicker">Lead report</span><div class="tag-list">${renderTagList((leadReport.experiments || []).flatMap((item) => item.strategyLeaders || []).slice(0, 6), "Nog geen strategy leaders")}</div></div>
      ${renderTimelineRows(leadExperiments, "Nog geen experiment-vensters beschikbaar.")}
    </article>
  `;
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
  const topStrategy = (attribution.strategies || [])[0] || {};
  const topRegime = (attribution.regimes || [])[0] || {};
  const topStyle = (attribution.executionStyles || [])[0] || {};
  const topProvider = (attribution.newsProviders || [])[0] || {};
  elements.pnlAttributionSummary.innerHTML = [
    insightCard("Top strategie", topStrategy.id || "-", topStrategy.tradeCount ? `${topStrategy.tradeCount} trades | ${formatMoney(topStrategy.realizedPnl || 0)}` : "Nog geen attributie"),
    insightCard("Top regime", topRegime.id || "-", topRegime.tradeCount ? `${formatPct(topRegime.winRate || 0, 1)} win | ${formatMoney(topRegime.realizedPnl || 0)}` : "Nog geen regime-attributie"),
    insightCard("Top exec-style", topStyle.id || "-", topStyle.tradeCount ? `${formatPct(topStyle.winRate || 0, 1)} win | ${formatMoney(topStyle.realizedPnl || 0)}` : "Nog geen execution-attributie"),
    insightCard("Top newsbron", topProvider.id || "-", topProvider.tradeCount ? `${topProvider.tradeCount} trades | ${formatMoney(topProvider.realizedPnl || 0)}` : "Nog geen bron-attributie")
  ].join("");

  const cards = [
    ...(attribution.strategies || []).slice(0, 2).map((item) => ({ ...item, bucketLabel: "strategie" })),
    ...(attribution.regimes || []).slice(0, 2).map((item) => ({ ...item, bucketLabel: "regime" })),
    ...(attribution.executionStyles || []).slice(0, 2).map((item) => ({ ...item, bucketLabel: "execution" })),
    ...(attribution.newsProviders || []).slice(0, 2).map((item) => ({ ...item, bucketLabel: "nieuwsbron" }))
  ];
  elements.pnlAttributionList.innerHTML = cards.length
    ? cards
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
                <div class="mini-stat"><span class="kicker">Trades</span><strong>${item.tradeCount || 0}</strong></div>
                <div class="mini-stat"><span class="kicker">Winrate</span><strong>${formatPct(item.winRate || 0, 1)}</strong></div>
                <div class="mini-stat"><span class="kicker">Gem. PnL</span><strong class="${toneClass(item.averagePnlPct || 0)}">${formatPct(item.averagePnlPct || 0, 2)}</strong></div>
                <div class="mini-stat"><span class="kicker">Duur</span><strong>${formatNumber(item.averageDurationMinutes || 0, 1)} min</strong></div>
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
  elements.opsSummary.innerHTML = [
    insightCard("Recorder", `${recorder.filesWritten || 0} writes`, recorder.lastRecordAt ? `laatst ${formatDate(recorder.lastRecordAt)} | learn ${recorder.learningFrames || 0}` : `Nog geen recorder-run | learn ${recorder.learningFrames || 0}`),
    insightCard("Backups", `${backups.backupCount || 0}`, backups.lastBackupAt ? `laatst ${formatDate(backups.lastBackupAt)}` : "Nog geen backup"),
    insightCard("Registry", `${modelRegistry.registrySize || 0} snapshots`, modelRegistry.latestSnapshotAt ? `laatst ${formatDate(modelRegistry.latestSnapshotAt)}` : "Nog geen modelsnapshot"),
    insightCard("Recovery", recovery.uncleanShutdownDetected ? "Unclean" : "Clean", recovery.restoredFromBackupAt ? `restore ${formatDate(recovery.restoredFromBackupAt)}` : recovery.latestBackupAt ? `backup ${formatDate(recovery.latestBackupAt)}` : "Geen herstel nodig", recovery.uncleanShutdownDetected ? "negative" : "positive")
  ].join("");

  const notes = [
    ...(modelRegistry.notes || []),
    backups.lastReason ? `Laatste backup reden: ${backups.lastReason}` : "",
    recorder.rootDir ? `Feature store: ${recorder.rootDir}` : ""
  ].filter(Boolean);
  elements.opsList.innerHTML = notes.length
    ? notes.map((note) => `<div class="event-row"><div>${escapeHtml(note)}</div></div>`).join("")
    : `<div class="empty">Nog geen operations-notities.</div>`;
}
function renderGovernance(snapshot) {
  const registry = snapshot.dashboard.researchRegistry || {};
  const governance = registry.governance || {};
  const leader = (registry.leaderboard || [])[0] || {};
  elements.governanceSummary.innerHTML = [
    insightCard("Research runs", `${registry.runCount || 0}`, registry.lastRunAt ? `laatst ${formatDate(registry.lastRunAt)}` : "Nog geen run"),
    insightCard("Promo kandidaten", `${(governance.promotionCandidates || []).length}`, leader.symbol ? `${leader.symbol} leidt` : "Nog geen kandidaat", (governance.promotionCandidates || []).length ? "positive" : "neutral"),
    insightCard("Snapshots", `${governance.stableSnapshotCount || 0}`, governance.notes?.[0] || "Geen governance-notitie")
  ].join("");

  elements.registryList.innerHTML = (registry.leaderboard || []).length
    ? (registry.leaderboard || [])
        .slice(0, 5)
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
        .join("")
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
}

function pickSnapshot(payload) {
  return payload.snapshot || payload;
}

async function refreshSnapshot() {
  const snapshot = await api("/api/snapshot");
  render(snapshot);
}

async function runAction(label, action) {
  if (busy) {
    return;
  }
  busy = true;
  transientMessage = `${label}...`;
  if (latestSnapshot) {
    renderStatus(latestSnapshot);
  }
  try {
    const payload = await action();
    transientMessage = `${label} voltooid`;
    render(pickSnapshot(payload));
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

setupCollapsiblePanels();

refreshSnapshot().catch((error) => {
  transientMessage = error.message;
  elements.controlHint.textContent = error.message;
});
window.setInterval(() => {
  setupCollapsiblePanels();

refreshSnapshot().catch((error) => {
    transientMessage = error.message;
    if (latestSnapshot) {
      renderStatus(latestSnapshot);
    }
  });
}, POLL_MS);
















































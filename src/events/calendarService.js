import fs from "node:fs/promises";
import path from "node:path";
import { defaultCalendarEvents } from "../data/eventCalendarSeed.js";
import { clamp } from "../utils/math.js";
import { nowIso } from "../utils/time.js";
import { RequestBudget, isRequestBudgetCooldownError } from "../utils/requestBudget.js";
import { ExternalFeedRegistry } from "../runtime/externalFeedRegistry.js";

const BLS_CALENDAR_URL = "https://www.bls.gov/schedule/news_release/bls.ics";

const EMPTY_SUMMARY = {
  coverage: 0,
  riskScore: 0,
  bullishScore: 0,
  bearishScore: 0,
  urgencyScore: 0,
  confidence: 0,
  eventCounts: {},
  nextEventAt: null,
  nextEventTitle: null,
  nextEventType: null,
  proximityHours: null,
  highImpactCount: 0,
  blockerReasons: [],
  items: []
};

function unfoldIcsLines(ics) {
  const lines = `${ics || ""}`.split(/\r?\n/);
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.trim();
      continue;
    }
    unfolded.push(line.trimEnd());
  }
  return unfolded;
}

export function parseIcsEvents(ics) {
  const lines = unfoldIcsLines(ics);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        events.push(current);
      }
      current = null;
      continue;
    }
    if (!current) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const rawKey = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    const key = rawKey.split(";")[0];
    current[key] = value;
  }
  return events;
}

function parseIcsDate(value) {
  if (!value) {
    return null;
  }
  const normalized = `${value}`.replace(/Z$/, "");
  const match = normalized.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))).toISOString();
}

function classifyCalendarEvent(title = "") {
  const text = title.toLowerCase();
  if (text.includes("consumer price index") || text.includes("cpi")) {
    return { type: "macro_cpi", impact: 0.92, bias: 0 };
  }
  if (text.includes("producer price index") || text.includes("ppi")) {
    return { type: "macro_ppi", impact: 0.75, bias: 0 };
  }
  if (text.includes("employment situation") || text.includes("nonfarm")) {
    return { type: "macro_nfp", impact: 0.95, bias: 0 };
  }
  if (text.includes("etf")) {
    return { type: "etf_deadline", impact: 0.88, bias: 0 };
  }
  if (text.includes("unlock") || text.includes("vesting")) {
    return { type: "unlock", impact: 0.78, bias: -0.35 };
  }
  return { type: "calendar_event", impact: 0.55, bias: 0 };
}

function normalizeEvent(event) {
  const base = classifyCalendarEvent(event.title || event.summary || "");
  return {
    title: event.title || event.summary || "Untitled event",
    at: event.at || parseIcsDate(event.DTSTART) || null,
    type: event.type || base.type,
    impact: clamp(Number(event.impact ?? base.impact), 0, 1),
    bias: clamp(Number(event.bias ?? base.bias), -1, 1),
    symbols: Array.isArray(event.symbols) ? event.symbols.map((symbol) => `${symbol}`.toUpperCase()) : [],
    scope: event.scope || (Array.isArray(event.symbols) && event.symbols.length ? "symbol" : "market"),
    source: event.source || "Calendar",
    link: event.link || event.URL || ""
  };
}

function isRelevantToSymbol(event, symbol, aliases = []) {
  if (event.scope !== "symbol") {
    return true;
  }
  const upperAliases = aliases.map((alias) => `${alias}`.toUpperCase());
  return event.symbols.includes(symbol) || event.symbols.some((candidate) => upperAliases.includes(candidate));
}

async function fetchText(url, requestBudget, runtime) {
  const response = await requestBudget.fetchJson(url, {
    key: "bls_calendar",
    runtime,
    headers: {
      "User-Agent": "Mozilla/5.0 trading-bot"
    }
  });
  if (!response.ok) {
    throw new Error(`Calendar fetch failed: ${response.status}`);
  }
  return response.text();
}

async function loadUserEvents(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const sanitized = `${content || ""}`.replace(/^\uFEFF/, "").trim();
    if (!sanitized) {
      return [];
    }
    const parsed = JSON.parse(sanitized);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function summarizeCalendarEvents(events, symbol, aliases = [], lookbackDays = 30, now = nowIso()) {
  const nowMs = new Date(now).getTime();
  const maxMs = nowMs + lookbackDays * 86_400_000;
  const relevant = events
    .map(normalizeEvent)
    .filter((event) => event.at && isRelevantToSymbol(event, symbol, aliases))
    .filter((event) => {
      const atMs = new Date(event.at).getTime();
      return Number.isFinite(atMs) && atMs >= nowMs && atMs <= maxMs;
    })
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());

  if (!relevant.length) {
    return EMPTY_SUMMARY;
  }

  const eventCounts = {};
  let riskScore = 0;
  let bullishScore = 0;
  let bearishScore = 0;
  let confidence = 0;
  const blockerReasons = [];

  for (const event of relevant) {
    eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    const hoursUntil = Math.max(0, (new Date(event.at).getTime() - nowMs) / 3_600_000);
    const proximityWeight = 1 / (1 + hoursUntil / 24);
    riskScore += event.impact * proximityWeight;
    bullishScore += Math.max(0, event.bias) * event.impact * proximityWeight;
    bearishScore += Math.max(0, -event.bias) * event.impact * proximityWeight;
    confidence += event.source === "BLS" ? 0.18 : 0.12;
    if (hoursUntil <= 24 && event.impact >= 0.8) {
      blockerReasons.push(event.type);
    }
  }

  const nextEvent = relevant[0];
  const proximityHours = Math.max(0, (new Date(nextEvent.at).getTime() - nowMs) / 3_600_000);
  return {
    coverage: relevant.length,
    riskScore: clamp(riskScore / Math.max(relevant.length, 1), 0, 1),
    bullishScore: clamp(bullishScore, 0, 1),
    bearishScore: clamp(bearishScore, 0, 1),
    urgencyScore: clamp(1 / (1 + proximityHours / 12), 0, 1),
    confidence: clamp(confidence, 0, 1),
    eventCounts,
    nextEventAt: nextEvent.at,
    nextEventTitle: nextEvent.title,
    nextEventType: nextEvent.type,
    proximityHours: Number(proximityHours.toFixed(1)),
    highImpactCount: relevant.filter((event) => event.impact >= 0.8).length,
    blockerReasons: [...new Set(blockerReasons)],
    items: relevant.slice(0, 6)
  };
}

export class CalendarService {
  constructor({ config, runtime, logger, recordHistory = null }) {
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
    this.calendarFilePath = config.runtimeDir
      ? path.join(config.runtimeDir, "event-calendar.json")
      : path.join(process.cwd(), "runtime", "event-calendar.json");
    this.recordHistory = typeof recordHistory === "function" ? recordHistory : null;
    this.requestBudget = new RequestBudget({
      timeoutMs: 8_000,
      baseCooldownMs: Math.max(1, Number(config.sourceReliabilityFailureCooldownMinutes || 8)) * 60_000,
      maxCooldownMs: Math.max(1, Number(config.sourceReliabilityRateLimitCooldownMinutes || 30)) * 60_000,
      registry: new ExternalFeedRegistry(config),
      runtime,
      group: "calendar"
    });
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= this.config.calendarCacheMinutes * 60 * 1000;
  }

  async maybeRecordHistory({ symbol, aliases, summary, items = [], cacheState, cacheEntry = null } = {}) {
    if (!this.recordHistory || !symbol || !summary) {
      return;
    }
    const entry = cacheEntry || this.runtime.calendarCache;
    if (!entry) {
      return;
    }
    entry.historyRecorded = entry.historyRecorded || {};
    const historyKey = `${cacheState}:${symbol}`;
    if (entry.historyRecorded[historyKey]) {
      return;
    }
    try {
      await this.recordHistory({
        at: nowIso(),
        symbol,
        aliases,
        kind: "calendar",
        summary,
        items,
        cacheState
      });
      entry.historyRecorded[historyKey] = true;
    } catch (error) {
      this.logger.warn("Calendar history record failed", {
        symbol,
        error: error.message
      });
    }
  }

  async getEvents() {
    const cached = this.runtime.calendarCache;
    if (this.isFresh(cached)) {
      return {
        items: cached.items || [],
        cacheState: "cached",
        cacheEntry: cached
      };
    }

    try {
      let fetchFailed = false;
      const [ics, userEvents] = await Promise.all([
        fetchText(BLS_CALENDAR_URL, this.requestBudget, this.runtime).then((value) => {
          this.requestBudget.noteSuccess("bls_calendar", this.runtime);
          return value;
        }).catch((error) => {
          fetchFailed = true;
          if (!isRequestBudgetCooldownError(error)) {
            this.requestBudget.noteFailure("bls_calendar", Date.now(), this.runtime, error.message);
          }
          this.logger.warn("BLS calendar fetch failed", { error: error.message });
          return "";
        }),
        loadUserEvents(this.calendarFilePath)
      ]);
      const macroEvents = parseIcsEvents(ics)
        .map((event) => ({
          title: event.SUMMARY || "",
          at: parseIcsDate(event.DTSTART),
          source: "BLS",
          link: event.URL || ""
        }))
        .filter((event) => /consumer price index|producer price index|employment situation|nonfarm/i.test(event.title || ""));
      const items = [...defaultCalendarEvents, ...macroEvents, ...userEvents].map(normalizeEvent);
      if (fetchFailed && cached?.items?.length) {
        return {
          items: cached.items || [],
          cacheState: "fallback",
          cacheEntry: cached
        };
      }
      this.runtime.calendarCache = {
        fetchedAt: nowIso(),
        items,
        historyRecorded: {
          [`fresh_fetch:global`]: false,
          [`cached:global`]: false,
          [`fallback:global`]: false,
          [`degraded:global`]: false
        }
      };
      return {
        items,
        cacheState: fetchFailed ? "degraded" : "fresh_fetch",
        cacheEntry: this.runtime.calendarCache
      };
    } catch (error) {
      this.logger.warn("Calendar service failed", { error: error.message });
      return {
        items: cached?.items || [],
        cacheState: cached?.items ? "fallback" : "empty",
        cacheEntry: cached || null
      };
    }
  }

  async getSymbolSummary(symbol, aliases = []) {
    const { items: events, cacheState, cacheEntry } = await this.getEvents();
    const summary = summarizeCalendarEvents(events, symbol, aliases, this.config.calendarLookbackDays, nowIso());
    if (cacheState === "empty") {
      return summary;
    }
    await this.maybeRecordHistory({
      symbol,
      aliases,
      summary,
      items: summary.items || [],
      cacheState,
      cacheEntry
    });
    return summary;
  }
}

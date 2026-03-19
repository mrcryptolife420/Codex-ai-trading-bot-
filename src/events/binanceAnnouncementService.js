import { summarizeNews } from "../news/sentiment.js";
import { nowIso } from "../utils/time.js";
import { RequestBudget } from "../utils/requestBudget.js";
import { ExternalFeedRegistry } from "../runtime/externalFeedRegistry.js";

const CMS_CATALOGS = [
  { catalogId: 49, label: "latest_binance_news", category: "announcement" },
  { catalogId: 157, label: "maintenance_updates", category: "maintenance" },
  { catalogId: 161, label: "delistings", category: "delisting" }
];

const EMPTY_SUMMARY = {
  coverage: 0,
  sentimentScore: 0,
  riskScore: 0,
  confidence: 0,
  headlines: [],
  providerCounts: {},
  sourceCounts: {},
  bullishDrivers: [],
  bearishDrivers: [],
  dominantEventType: "general",
  eventBullishScore: 0,
  eventBearishScore: 0,
  eventRiskScore: 0,
  sourceQualityScore: 0,
  providerQualityScore: 0,
  reliabilityScore: 0,
  whitelistCoverage: 0,
  maxSeverity: 0,
  categoryCounts: {},
  latestNoticeAt: null,
  noticeFreshnessHours: null,
  highPriorityCount: 0,
  blockingNotice: null,
  items: []
};

function normalizePageSize(pageSize = 8) {
  const value = Number(pageSize);
  if (!Number.isFinite(value)) {
    return 8;
  }
  return Math.max(1, Math.min(Math.round(value), 10));
}

function buildCmsUrl(catalogId, pageSize = 8) {
  return `https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=${catalogId}&pageNo=1&pageSize=${normalizePageSize(pageSize)}`;
}
function escapeRegex(value) {
  return `${value}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAliasMatchers(aliases = []) {
  return aliases
    .filter(Boolean)
    .map((alias) => `${alias}`.trim())
    .filter(Boolean)
    .map((alias) => {
      if (alias.length <= 4) {
        return (text) => new RegExp(`(^|[^A-Za-z0-9])(?:\\$)?${escapeRegex(alias)}(?=[^A-Za-z0-9]|$)`).test(text);
      }
      return (text) => new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(alias)}(?=[^A-Za-z0-9]|$)`, "i").test(text);
    });
}

function isGenericNotice(article) {
  return /referral|advertising policy|convert entry point|campaign|promotion|gift card|binance pay|wallet maintenance|launchpool|earn|loan/i.test(article.title || "");
}

function isTradingRelevantGlobalNotice(article) {
  if (isGenericNotice(article)) {
    return false;
  }
  return /maintenance|system upgrade|websocket|api|spot trading|trading pairs?|deposits|withdrawals|delist|suspend|halt|order matching/i.test(article.title || "");
}

function isHighPriorityNotice(article, freshnessHours = Number.POSITIVE_INFINITY) {
  const title = article.title || "";
  if (isGenericNotice(article)) {
    return false;
  }
  if (/delist|suspend|halt|incident|outage|emergency/i.test(title)) {
    return true;
  }
  if (/maintenance|system upgrade|api|websocket/i.test(title)) {
    return freshnessHours <= 12;
  }
  return false;
}

function isGlobalExchangeNotice(article) {
  return isTradingRelevantGlobalNotice(article);
}

function matchesSymbol(article, aliases = []) {
  if (!aliases.length) {
    return true;
  }
  const text = `${article.title || ""} ${article.category || ""}`;
  if (buildAliasMatchers(aliases).some((matcher) => matcher(aliasTestText(text)))) {
    return true;
  }
  return article.globalNotice;
}

function aliasTestText(text) {
  return `${text || ""}`;
}

async function fetchJson(url, requestBudget, runtime, key) {
  const response = await requestBudget.fetchJson(url, {
    key,
    runtime,
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Origin": "https://www.binance.com",
      "Pragma": "no-cache",
      "Referer": "https://www.binance.com/en/support/announcement/",
      "User-Agent": "Mozilla/5.0 trading-bot"
    }
  });
  if (!response.ok) {
    throw new Error(`Binance CMS fetch failed: ${response.status}`);
  }
  return response.json();
}

async function fetchCatalogArticles(catalog, pageSize, requestBudget, runtime) {
  const attempts = [normalizePageSize(pageSize), 8, 5, 3]
    .filter((value, index, items) => items.indexOf(value) === index);
  let lastError = null;
  for (const size of attempts) {
    try {
      const feedKey = `binance_cms:${catalog.catalogId}`;
      const payload = await fetchJson(buildCmsUrl(catalog.catalogId, size), requestBudget, runtime, feedKey);
      requestBudget.noteSuccess(feedKey, runtime);
      return normalizeCmsArticles(payload, catalog);
    } catch (error) {
      lastError = error;
      if (error.code !== "REQUEST_BUDGET_COOLDOWN") {
        requestBudget.noteFailure(`binance_cms:${catalog.catalogId}`, Date.now(), runtime, error.message);
      }
      if (error?.message?.includes("400") && size > 3) {
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error(`Binance CMS fetch failed for catalog ${catalog.catalogId}`);
}
export function normalizeCmsArticles(payload, catalog) {
  const articles = payload?.data?.catalogs?.[0]?.articles || [];
  return articles.map((article) => ({
    id: article.id,
    code: article.code,
    title: article.title,
    description: catalog.label,
    link: article.code ? `https://www.binance.com/en/support/announcement/detail/${article.code}` : "",
    publishedAt: article.releaseDate ? new Date(article.releaseDate).toISOString() : null,
    source: "Binance",
    provider: "binance_support",
    category: catalog.category,
    catalogLabel: catalog.label,
    globalNotice: catalog.category !== "delisting" && isGlobalExchangeNotice(article)
  }));
}

export class BinanceAnnouncementService {
  constructor({ config, runtime, logger, recordHistory = null }) {
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
    this.recordHistory = typeof recordHistory === "function" ? recordHistory : null;
    this.requestBudget = new RequestBudget({
      timeoutMs: 8_000,
      baseCooldownMs: Math.max(1, Number(config.sourceReliabilityFailureCooldownMinutes || 8)) * 60_000,
      maxCooldownMs: Math.max(1, Number(config.sourceReliabilityRateLimitCooldownMinutes || 30)) * 60_000,
      registry: new ExternalFeedRegistry(config),
      runtime,
      group: "announcements"
    });
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= this.config.announcementCacheMinutes * 60 * 1000;
  }

  async maybeRecordHistory({ symbol, aliases, summary, items = [], cacheState, cacheEntry = null } = {}) {
    if (!this.recordHistory || !symbol || !summary) {
      return;
    }
    const entry = cacheEntry || this.runtime.exchangeNoticeCache?.[`notice:${symbol}`];
    if (!entry) {
      return;
    }
    entry.historyRecorded = entry.historyRecorded || {};
    if (entry.historyRecorded[cacheState]) {
      return;
    }
    try {
      await this.recordHistory({
        at: nowIso(),
        symbol,
        aliases,
        kind: "announcements",
        summary,
        items,
        cacheState
      });
      entry.historyRecorded[cacheState] = true;
    } catch (error) {
      this.logger.warn("Announcement history record failed", {
        symbol,
        error: error.message
      });
    }
  }

  async getSymbolSummary(symbol, aliases = []) {
    const cacheKey = `notice:${symbol}`;
    const cached = this.runtime.exchangeNoticeCache?.[cacheKey];
    if (this.isFresh(cached)) {
      await this.maybeRecordHistory({
        symbol,
        aliases,
        summary: cached.summary,
        items: cached.items || [],
        cacheState: "cached",
        cacheEntry: cached
      });
      return cached.summary;
    }

    try {
      const responses = await Promise.allSettled(CMS_CATALOGS.map((catalog) => fetchCatalogArticles(catalog, this.config.newsHeadlineLimit, this.requestBudget, this.runtime)));
      const items = [];
      let fulfilledCatalogs = 0;
      for (const response of responses) {
        if (response.status === "fulfilled") {
          fulfilledCatalogs += 1;
          items.push(...response.value);
          continue;
        }
        this.logger.warn("Binance announcement feed failed", {
          symbol,
          error: response.reason?.message || String(response.reason)
        });
      }
      if (fulfilledCatalogs === 0) {
        if (cached?.summary) {
          await this.maybeRecordHistory({
            symbol,
            aliases,
            summary: cached.summary,
            items: cached.items || [],
            cacheState: "fallback",
            cacheEntry: cached
          });
          return cached.summary;
        }
        return EMPTY_SUMMARY;
      }
      const filtered = items
        .filter((item) => matchesSymbol(item, aliases))
        .sort((left, right) => new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime());
      const summary = summarizeNews(filtered, this.config.announcementLookbackHours, nowIso(), {
        minSourceQuality: 0.8,
        minReliabilityScore: 0.82,
        strictWhitelist: false
      });
      const categoryCounts = filtered.reduce((counts, item) => {
        counts[item.category] = (counts[item.category] || 0) + 1;
        return counts;
      }, {});
      const latestNoticeAt = filtered[0]?.publishedAt || null;
      const noticeFreshnessHours = latestNoticeAt ? Number(((Date.now() - new Date(latestNoticeAt).getTime()) / 3_600_000).toFixed(1)) : null;
      const highPriorityItems = filtered.filter((item) => isHighPriorityNotice(item, item.publishedAt ? (Date.now() - new Date(item.publishedAt).getTime()) / 3_600_000 : Number.POSITIVE_INFINITY));
      const blockingNotice = highPriorityItems[0] || null;
      const enriched = {
        ...EMPTY_SUMMARY,
        ...summary,
        categoryCounts,
        latestNoticeAt,
        noticeFreshnessHours,
        highPriorityCount: highPriorityItems.length,
        blockingNotice,
        items: filtered.slice(0, 6)
      };
      this.runtime.exchangeNoticeCache = this.runtime.exchangeNoticeCache || {};
      this.runtime.exchangeNoticeCache[cacheKey] = {
        fetchedAt: nowIso(),
        summary: enriched,
        items: filtered,
        historyRecorded: {
          fresh_fetch: false,
          cached: false,
          fallback: false
        }
      };
      await this.maybeRecordHistory({
        symbol,
        aliases,
        summary: enriched,
        items: filtered,
        cacheState: "fresh_fetch",
        cacheEntry: this.runtime.exchangeNoticeCache[cacheKey]
      });
      return enriched;
    } catch (error) {
      this.logger.warn("Binance announcement fetch failed", {
        symbol,
        error: error.message
      });
      if (cached?.summary) {
        await this.maybeRecordHistory({
          symbol,
          aliases,
          summary: cached.summary,
          items: cached.items || [],
          cacheState: "fallback",
          cacheEntry: cached
        });
      }
      return cached?.summary || EMPTY_SUMMARY;
    }
  }
}





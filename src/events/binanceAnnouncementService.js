import { summarizeNews } from "../news/sentiment.js";
import { nowIso } from "../utils/time.js";

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

function isGlobalExchangeNotice(article) {
  return /binance|maintenance|system upgrade|websocket|api|spot trading|deposits|withdrawals/i.test(article.title || "");
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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Origin": "https://www.binance.com",
      "Pragma": "no-cache",
      "Referer": "https://www.binance.com/en/support/announcement/",
      "User-Agent": "Mozilla/5.0 trading-bot"
    },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) {
    throw new Error(`Binance CMS fetch failed: ${response.status}`);
  }
  return response.json();
}

async function fetchCatalogArticles(catalog, pageSize) {
  const attempts = [normalizePageSize(pageSize), 8, 5, 3]
    .filter((value, index, items) => items.indexOf(value) === index);
  let lastError = null;
  for (const size of attempts) {
    try {
      const payload = await fetchJson(buildCmsUrl(catalog.catalogId, size));
      return normalizeCmsArticles(payload, catalog);
    } catch (error) {
      lastError = error;
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
    globalNotice: catalog.category !== "delisting" || isGlobalExchangeNotice(article)
  }));
}

export class BinanceAnnouncementService {
  constructor({ config, runtime, logger }) {
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
  }

  isFresh(cacheEntry) {
    if (!cacheEntry?.fetchedAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(cacheEntry.fetchedAt).getTime();
    return ageMs <= this.config.announcementCacheMinutes * 60 * 1000;
  }

  async getSymbolSummary(symbol, aliases = []) {
    const cacheKey = `notice:${symbol}`;
    const cached = this.runtime.exchangeNoticeCache?.[cacheKey];
    if (this.isFresh(cached)) {
      return cached.summary;
    }

    try {
      const responses = await Promise.allSettled(CMS_CATALOGS.map((catalog) => fetchCatalogArticles(catalog, this.config.newsHeadlineLimit)));
      const items = [];
      for (const response of responses) {
        if (response.status === "fulfilled") {
          items.push(...response.value);
          continue;
        }
        this.logger.warn("Binance announcement feed failed", {
          symbol,
          error: response.reason?.message || String(response.reason)
        });
      }
      const filtered = items.filter((item) => matchesSymbol(item, aliases));
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
      const highPriorityItems = filtered.filter((item) => /delist|suspend|maintenance|upgrade/i.test(item.title || ""));
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
        items: filtered
      };
      return enriched;
    } catch (error) {
      this.logger.warn("Binance announcement fetch failed", {
        symbol,
        error: error.message
      });
      return cached?.summary || EMPTY_SUMMARY;
    }
  }
}

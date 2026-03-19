function decodeEntities(text) {
  return `${text || ""}`
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/gi, "'")
    .trim();
}

function stripHtml(text) {
  return decodeEntities(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTag(itemXml, tagName) {
  const match = itemXml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? stripHtml(match[1]) : "";
}

function extractAttr(itemXml, tagName, attrName, { filterAttr = null, filterValue = null } = {}) {
  const matches = [...`${itemXml || ""}`.matchAll(new RegExp(`<${tagName}\\b([^>]*)>`, "gi"))];
  for (const match of matches) {
    const attrs = match[1] || "";
    if (filterAttr && filterValue && !new RegExp(`${filterAttr}\\s*=\\s*["']${filterValue}["']`, "i").test(attrs)) {
      continue;
    }
    const attrMatch = attrs.match(new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, "i"));
    if (attrMatch) {
      return stripHtml(attrMatch[1]);
    }
  }
  return "";
}

function extractItems(xml) {
  return [...`${xml || ""}`.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
}

function extractEntries(xml) {
  return [...`${xml || ""}`.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
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
        return {
          alias,
          test: (text) => new RegExp(`(^|[^A-Za-z0-9])(?:\\$)?${escapeRegex(alias)}(?=[^A-Za-z0-9]|$)`).test(text)
        };
      }
      return {
        alias,
        test: (text) => new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(alias)}(?=[^A-Za-z0-9]|$)`, "i").test(text)
      };
    });
}

function matchesAliases(item, aliases = []) {
  if (!aliases.length) {
    return true;
  }
  const rawText = `${item.title || ""} ${item.description || ""} ${item.category || ""}`;
  const loweredText = rawText.toLowerCase();
  return buildAliasMatchers(aliases).some((matcher) => (matcher.alias.length <= 4 ? matcher.test(rawText) : matcher.test(loweredText)));
}

function filterItems(items, { aliases = [], lookbackHours = 24, limit = 12 }) {
  const cutoffMs = Date.now() - lookbackHours * 3_600_000;
  return items
    .filter((item) => matchesAliases(item, aliases))
    .filter((item) => {
      const publishedMs = new Date(item.publishedAt || Date.now()).getTime();
      return Number.isFinite(publishedMs) && publishedMs >= cutoffMs;
    })
    .sort((left, right) => new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime())
    .slice(0, limit);
}

export async function fetchXml(url, { requestBudget = null, runtime = null, key = url, fetchImpl = globalThis.fetch } = {}) {
  const response = requestBudget
    ? await requestBudget.fetchJson(url, {
        key,
        runtime,
        fetchImpl,
        headers: {
          "User-Agent": "Mozilla/5.0 trading-bot"
        }
      })
    : await fetchImpl(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 trading-bot"
        },
        signal: AbortSignal.timeout(8_000)
      });

  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status}`);
  }

  return response.text();
}

export function parseRssItems(xml, { provider, sourceFallback = "Unknown", channel = "news" } = {}) {
  return extractItems(xml).map((itemXml) => ({
    title: extractTag(itemXml, "title"),
    description: extractTag(itemXml, "description"),
    link: extractTag(itemXml, "link"),
    publishedAt: extractTag(itemXml, "pubDate"),
    source: extractTag(itemXml, "source") || extractTag(itemXml, "dc:creator") || sourceFallback,
    provider,
    channel
  }));
}

export function parseAtomItems(xml, { provider, sourceFallback = "Unknown", channel = "news" } = {}) {
  return extractEntries(xml).map((entryXml) => ({
    title: extractTag(entryXml, "title"),
    description: extractTag(entryXml, "summary") || extractTag(entryXml, "content"),
    link: extractAttr(entryXml, "link", "href", { filterAttr: "rel", filterValue: "alternate" }) || extractAttr(entryXml, "link", "href") || "",
    publishedAt: extractTag(entryXml, "published") || extractTag(entryXml, "updated"),
    source: extractTag(entryXml, "source") || sourceFallback,
    provider,
    channel
  }));
}

export function parseProviderItems(xml, options = {}, filterOptions = {}) {
  const rssItems = parseRssItems(xml, options);
  const atomItems = parseAtomItems(xml, options);
  const items = [...rssItems, ...atomItems].filter((item) => item.title);
  return filterItems(items, filterOptions);
}

import { clamp } from "../utils/math.js";

const EVENT_PATTERNS = [
  {
    type: "listing",
    bias: 0.8,
    risk: 0.1,
    severity: 0.5,
    halfLifeHours: 10,
    terms: ["list", "listing", "listed", "launchpool", "launchpad"]
  },
  {
    type: "delisting",
    bias: -0.95,
    risk: 0.95,
    severity: 1,
    halfLifeHours: 26,
    terms: ["delist", "delisting", "remove trading", "suspend trading"]
  },
  {
    type: "hack",
    bias: -1,
    risk: 1,
    severity: 1,
    halfLifeHours: 24,
    terms: ["hack", "exploit", "breach", "attack", "drain"]
  },
  {
    type: "regulation",
    bias: -0.45,
    risk: 0.7,
    severity: 0.75,
    halfLifeHours: 20,
    terms: ["sec", "lawsuit", "investigation", "ban", "regulator", "court", "filing"]
  },
  {
    type: "unlock",
    bias: -0.35,
    risk: 0.5,
    severity: 0.45,
    halfLifeHours: 36,
    terms: ["unlock", "vesting", "token release"]
  },
  {
    type: "partnership",
    bias: 0.55,
    risk: 0.15,
    severity: 0.35,
    halfLifeHours: 8,
    terms: ["partnership", "integration", "adoption", "collaboration"]
  },
  {
    type: "etf",
    bias: 0.75,
    risk: 0.2,
    severity: 0.6,
    halfLifeHours: 18,
    terms: ["etf", "approval", "approved", "filing"]
  },
  {
    type: "maintenance",
    bias: -0.1,
    risk: 0.45,
    severity: 0.55,
    halfLifeHours: 8,
    terms: ["maintenance", "system upgrade", "websocket system upgrade", "temporarily suspend", "network upgrade"]
  },
  {
    type: "token_swap",
    bias: 0.1,
    risk: 0.4,
    severity: 0.55,
    halfLifeHours: 18,
    terms: ["token swap", "redenomination", "rebranding", "migration"]
  },
  {
    type: "funding",
    bias: 0.45,
    risk: 0.1,
    severity: 0.25,
    halfLifeHours: 10,
    terms: ["fundraise", "funding", "investment", "backed"]
  }
];

const SOURCE_PROFILES = {
  Binance: { quality: 0.98, whitelisted: true },
  Reuters: { quality: 0.96, whitelisted: true },
  Bloomberg: { quality: 0.95, whitelisted: true },
  CoinDesk: { quality: 0.9, whitelisted: true },
  CNBC: { quality: 0.9, whitelisted: true },
  TheBlock: { quality: 0.88, whitelisted: true },
  Blockworks: { quality: 0.84, whitelisted: true },
  Decrypt: { quality: 0.82, whitelisted: true },
  Cointelegraph: { quality: 0.78, whitelisted: true },
  Reddit: { quality: 0.69, whitelisted: true },
  "r/CryptoCurrency": { quality: 0.72, whitelisted: true },
  "r/CryptoMarkets": { quality: 0.7, whitelisted: true },
  "r/Binance": { quality: 0.74, whitelisted: true },
  Messari: { quality: 0.82, whitelisted: true },
  Forbes: { quality: 0.72, whitelisted: true },
  "Yahoo Finance": { quality: 0.68, whitelisted: true },
  "Bitcoin.com News": { quality: 0.72, whitelisted: false },
  MSN: { quality: 0.5, whitelisted: false },
  "AOL.com": { quality: 0.45, whitelisted: false },
  Unknown: { quality: 0.38, whitelisted: false }
};

const PROVIDER_RELIABILITY = {
  google_news: 0.58,
  coindesk: 0.92,
  cointelegraph: 0.8,
  decrypt: 0.84,
  blockworks: 0.86,
  reddit_search: 0.66,
  binance_support: 0.99,
  unknown: 0.5
};

const REJECT_SOURCE_PATTERNS = [
  /sponsored/i,
  /press release/i,
  /advertorial/i,
  /globenewswire/i,
  /price prediction/i,
  /sponsored post/i
];

function normalizeHeadline(title) {
  return `${title || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSource(source) {
  const text = `${source || "Unknown"}`.trim();
  const direct = SOURCE_PROFILES[text];
  if (direct) {
    return text;
  }
  return Object.keys(SOURCE_PROFILES).find((name) => text.toLowerCase().includes(name.toLowerCase())) || text || "Unknown";
}

export function scoreSource(source) {
  const normalized = normalizeSource(source);
  return SOURCE_PROFILES[normalized]?.quality || SOURCE_PROFILES.Unknown.quality;
}

export function scoreProvider(provider) {
  return PROVIDER_RELIABILITY[provider || "unknown"] || PROVIDER_RELIABILITY.unknown;
}

function isWhitelistedSource(source) {
  const normalized = normalizeSource(source);
  return Boolean(SOURCE_PROFILES[normalized]?.whitelisted);
}

function isRejectedSource(source, title) {
  const raw = `${source || ""} ${title || ""}`;
  return REJECT_SOURCE_PATTERNS.some((pattern) => pattern.test(raw));
}

function uniqueByHeadline(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = normalizeHeadline(item.title).slice(0, 180);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function classifyHeadlineEvents(item) {
  const text = normalizeHeadline(item.title);
  const matches = EVENT_PATTERNS.filter((pattern) => pattern.terms.some((term) => text.includes(term)));
  if (!matches.length) {
    return {
      dominantType: "general",
      eventBias: 0,
      eventRisk: 0,
      severity: 0,
      halfLifeHours: 6,
      sourceQuality: scoreSource(item.source),
      providerReliability: scoreProvider(item.provider),
      matchedTypes: []
    };
  }

  const dominant = matches.sort((left, right) => right.severity - left.severity)[0];
  return {
    dominantType: dominant.type,
    eventBias: clamp(matches.reduce((total, match) => total + match.bias, 0) / matches.length, -1, 1),
    eventRisk: clamp(matches.reduce((total, match) => total + match.risk, 0) / matches.length, 0, 1),
    severity: clamp(Math.max(...matches.map((match) => match.severity)), 0, 1),
    halfLifeHours: Math.max(...matches.map((match) => match.halfLifeHours || 6)),
    sourceQuality: scoreSource(item.source),
    providerReliability: scoreProvider(item.provider),
    matchedTypes: matches.map((match) => match.type)
  };
}

export function evaluateReliability(item, options = {}) {
  const source = normalizeSource(item.source);
  const sourceQuality = scoreSource(source);
  const providerReliability = scoreProvider(item.provider);
  const whitelisted = isWhitelistedSource(source) || item.provider === "binance_support";
  const rejected = isRejectedSource(source, item.title);
  const reliabilityScore = clamp(sourceQuality * 0.68 + providerReliability * 0.32, 0, 1);
  const minSourceQuality = options.minSourceQuality ?? 0.68;
  const minReliabilityScore = options.minReliabilityScore ?? 0.64;
  const strictWhitelist = options.strictWhitelist ?? true;
  const allowed = !rejected && sourceQuality >= minSourceQuality && reliabilityScore >= minReliabilityScore && (!strictWhitelist || whitelisted || providerReliability >= 0.9);

  return {
    source,
    sourceQuality,
    providerReliability,
    reliabilityScore,
    whitelisted,
    rejected,
    allowed
  };
}

export function enrichNewsItems(items, options = {}) {
  return uniqueByHeadline(items)
    .map((item) => {
      const source = normalizeSource(item.source);
      const event = classifyHeadlineEvents({ ...item, source });
      const reliability = evaluateReliability({ ...item, source }, options);
      return {
        ...item,
        source,
        event,
        reliability
      };
    })
    .filter((item) => (options.filterLowQuality === false ? true : item.reliability.allowed));
}

export function summarizeEvents(items) {
  const eventCounts = {};
  let bullishScore = 0;
  let bearishScore = 0;
  let cumulativeRisk = 0;
  let cumulativeSourceQuality = 0;
  let cumulativeProviderQuality = 0;
  let cumulativeReliability = 0;
  let whitelistCount = 0;
  let maxSeverity = 0;

  for (const item of items) {
    const dominantType = item.event?.dominantType || "general";
    eventCounts[dominantType] = (eventCounts[dominantType] || 0) + 1;
    const weightedBias = (item.event?.eventBias || 0) * (item.reliability?.reliabilityScore || item.event?.sourceQuality || 0.5);
    bullishScore += Math.max(0, weightedBias);
    bearishScore += Math.max(0, -weightedBias);
    cumulativeRisk += item.event?.eventRisk || 0;
    cumulativeSourceQuality += item.reliability?.sourceQuality || item.event?.sourceQuality || 0.5;
    cumulativeProviderQuality += item.reliability?.providerReliability || item.event?.providerReliability || 0.5;
    cumulativeReliability += item.reliability?.reliabilityScore || 0.5;
    whitelistCount += item.reliability?.whitelisted ? 1 : 0;
    maxSeverity = Math.max(maxSeverity, item.event?.severity || 0);
  }

  const count = items.length || 1;
  const sortedEvents = Object.entries(eventCounts).sort((left, right) => right[1] - left[1]);
  return {
    eventCounts,
    dominantEventType: sortedEvents[0]?.[0] || "general",
    eventBullishScore: clamp(bullishScore / count, 0, 1),
    eventBearishScore: clamp(bearishScore / count, 0, 1),
    eventRiskScore: clamp(cumulativeRisk / count, 0, 1),
    sourceQualityScore: clamp(cumulativeSourceQuality / count, 0, 1),
    providerQualityScore: clamp(cumulativeProviderQuality / count, 0, 1),
    reliabilityScore: clamp(cumulativeReliability / count, 0, 1),
    whitelistCoverage: clamp(whitelistCount / count, 0, 1),
    maxSeverity: clamp(maxSeverity, 0, 1)
  };
}


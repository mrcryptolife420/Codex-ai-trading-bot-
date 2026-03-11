import { average, clamp } from "../utils/math.js";
import { enrichNewsItems, summarizeEvents } from "./eventClassifier.js";

const POSITIVE_WORDS = [
  "surge",
  "gain",
  "bullish",
  "approval",
  "approved",
  "partnership",
  "adoption",
  "launch",
  "listing",
  "upgrade",
  "record",
  "beats",
  "breakout",
  "inflows",
  "moon",
  "squeeze",
  "accumulation"
];

const NEGATIVE_WORDS = [
  "crash",
  "drop",
  "bearish",
  "lawsuit",
  "hack",
  "exploit",
  "delist",
  "bankruptcy",
  "ban",
  "fraud",
  "outflow",
  "liquidation",
  "investigation",
  "breach",
  "suspend",
  "dump",
  "rekt",
  "rug"
];

const HIGH_RISK_WORDS = [
  "hack",
  "exploit",
  "breach",
  "bankruptcy",
  "delist",
  "lawsuit",
  "fraud",
  "investigation",
  "attack",
  "suspend",
  "rug"
];

function countMatches(text, terms) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function toSortedCountMap(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

function halfLifeDecay(ageHours, halfLifeHours) {
  const safeHalfLife = Math.max(1, halfLifeHours || 6);
  return Math.exp((-Math.log(2) * ageHours) / safeHalfLife);
}

function summarizeDriver(item, nowMs) {
  const publishedMs = new Date(item.publishedAt || nowMs).getTime();
  const freshnessHours = Number.isFinite(publishedMs) ? Math.max(0, (nowMs - publishedMs) / 3_600_000) : null;
  return {
    title: item.title,
    source: item.source,
    provider: item.provider || "unknown",
    channel: item.channel || "news",
    publishedAt: item.publishedAt,
    score: clamp(item.score || 0, -1, 1),
    riskScore: clamp(item.riskScore || 0, 0, 1),
    dominantEventType: item.event?.dominantType || "general",
    sourceQuality: clamp(item.reliability?.sourceQuality || item.event?.sourceQuality || 0, 0, 1),
    reliabilityScore: clamp(item.reliability?.reliabilityScore || 0, 0, 1),
    whitelisted: Boolean(item.reliability?.whitelisted),
    freshnessHours: freshnessHours == null ? null : Number(freshnessHours.toFixed(1)),
    engagementScore: Number(item.engagementScore || 0),
    link: item.link
  };
}

export function scoreHeadline(headline) {
  const text = `${headline || ""}`.toLowerCase();
  const positive = countMatches(text, POSITIVE_WORDS);
  const negative = countMatches(text, NEGATIVE_WORDS);
  const riskHits = countMatches(text, HIGH_RISK_WORDS);
  const rawScore = clamp((positive - negative) / 3, -1, 1);
  const riskScore = clamp(riskHits / 2, 0, 1);
  return {
    score: rawScore,
    riskScore
  };
}

function emptySummary() {
  return {
    coverage: 0,
    sentimentScore: 0,
    riskScore: 0,
    confidence: 0,
    headlines: [],
    providerCounts: {},
    sourceCounts: {},
    channelCounts: {},
    providerDiversity: 0,
    sourceDiversity: 0,
    freshnessHours: null,
    freshnessScore: 0,
    positiveHeadlineCount: 0,
    negativeHeadlineCount: 0,
    bullishDrivers: [],
    bearishDrivers: [],
    eventCounts: {},
    dominantEventType: "general",
    eventBullishScore: 0,
    eventBearishScore: 0,
    eventRiskScore: 0,
    sourceQualityScore: 0,
    providerQualityScore: 0,
    reliabilityScore: 0,
    whitelistCoverage: 0,
    maxSeverity: 0,
    socialCoverage: 0,
    socialSentiment: 0,
    socialRisk: 0,
    socialEngagement: 0
  };
}

export function summarizeNews(items, lookbackHours, nowIso = new Date().toISOString(), options = {}) {
  const nowMs = new Date(nowIso).getTime();
  const cutoffMs = nowMs - lookbackHours * 60 * 60 * 1000;
  const relevantItems = enrichNewsItems(items, options).filter((item) => {
    const publishedMs = new Date(item.publishedAt || nowIso).getTime();
    return Number.isFinite(publishedMs) && publishedMs >= cutoffMs;
  });

  if (!relevantItems.length) {
    return emptySummary();
  }

  const scored = relevantItems.map((item) => {
    const analysis = scoreHeadline(item.title || "");
    const publishedMs = new Date(item.publishedAt || nowIso).getTime();
    const ageHours = Math.max(0, (nowMs - publishedMs) / 3_600_000);
    const recencyWeight = halfLifeDecay(ageHours, item.event?.halfLifeHours || 6);
    const sourceWeight = 0.4 + (item.reliability?.reliabilityScore || 0.5) * 0.85;
    const rawEngagement = Math.max(0, Number(item.engagementScore || 0));
    const engagementWeight = 1 + clamp(Math.log10(1 + rawEngagement) / 4, 0, 0.45);
    return {
      ...item,
      ...analysis,
      ageHours,
      recencyWeight,
      sourceWeight,
      engagementWeight,
      engagementScore: rawEngagement,
      compositeWeight: recencyWeight * sourceWeight * engagementWeight
    };
  });

  const eventSummary = summarizeEvents(scored);
  const providerCounts = toSortedCountMap(scored, "provider");
  const sourceCounts = toSortedCountMap(scored, "source");
  const channelCounts = toSortedCountMap(scored, "channel");
  const freshestHours = Math.min(...scored.map((item) => item.ageHours));
  const freshnessScore = clamp(1 / (1 + freshestHours / 4), 0, 1);
  const positiveHeadlineCount = scored.filter((item) => item.score > 0).length;
  const negativeHeadlineCount = scored.filter((item) => item.score < 0).length;
  const bullishDrivers = scored
    .filter((item) => item.score > 0 || (item.event?.eventBias || 0) > 0)
    .sort((left, right) => (right.score + (right.event?.eventBias || 0)) * right.compositeWeight - (left.score + (left.event?.eventBias || 0)) * left.compositeWeight)
    .slice(0, 3)
    .map((item) => summarizeDriver(item, nowMs));
  const bearishDrivers = scored
    .filter((item) => item.score < 0 || (item.event?.eventBias || 0) < 0 || item.riskScore > 0)
    .sort((left, right) => (right.riskScore + Math.max(0, -(right.score + (right.event?.eventBias || 0)))) * right.compositeWeight - (left.riskScore + Math.max(0, -(left.score + (left.event?.eventBias || 0)))) * left.compositeWeight)
    .slice(0, 3)
    .map((item) => summarizeDriver(item, nowMs));
  const weightedSentiment = average(scored.map((item) => item.score * item.compositeWeight));
  const weightedRisk = average(scored.map((item) => item.riskScore * item.compositeWeight));
  const socialItems = scored.filter((item) => (item.channel || "news") === "social");
  const socialSentiment = socialItems.length ? average(socialItems.map((item) => item.score * item.compositeWeight)) : 0;
  const socialRisk = socialItems.length ? average(socialItems.map((item) => item.riskScore * item.compositeWeight)) : 0;
  const socialEngagement = socialItems.length ? average(socialItems.map((item) => item.engagementScore || 0)) : 0;
  const confidence = clamp(
    scored.length / 10 * 0.38 +
      Object.keys(sourceCounts).length / 5 * 0.12 +
      Object.keys(providerCounts).length / 4 * 0.1 +
      freshnessScore * 0.1 +
      (eventSummary.reliabilityScore || 0) * 0.16 +
      (eventSummary.whitelistCoverage || 0) * 0.08 +
      Math.min(1, socialItems.length / 4) * 0.06,
    0,
    1
  );

  return {
    coverage: scored.length,
    sentimentScore: clamp(weightedSentiment * 1.1 + (eventSummary.eventBullishScore - eventSummary.eventBearishScore) * 0.6, -1, 1),
    riskScore: clamp(weightedRisk * 1.05 + eventSummary.eventRiskScore * 0.8 + eventSummary.maxSeverity * 0.12, 0, 1),
    confidence,
    headlines: scored.slice(0, 6).map((item) => ({
      title: item.title,
      source: item.source,
      provider: item.provider || "unknown",
      channel: item.channel || "news",
      publishedAt: item.publishedAt,
      score: item.score,
      riskScore: item.riskScore,
      link: item.link,
      dominantEventType: item.event?.dominantType || "general",
      sourceQuality: item.reliability?.sourceQuality || item.event?.sourceQuality || 0.5,
      reliabilityScore: item.reliability?.reliabilityScore || 0.5,
      whitelisted: Boolean(item.reliability?.whitelisted),
      severity: item.event?.severity || 0,
      freshnessHours: Number(item.ageHours.toFixed(1)),
      engagementScore: item.engagementScore || 0
    })),
    providerCounts,
    sourceCounts,
    channelCounts,
    providerDiversity: Object.keys(providerCounts).length,
    sourceDiversity: Object.keys(sourceCounts).length,
    freshnessHours: Number(freshestHours.toFixed(1)),
    freshnessScore,
    positiveHeadlineCount,
    negativeHeadlineCount,
    bullishDrivers,
    bearishDrivers,
    socialCoverage: socialItems.length,
    socialSentiment: clamp(socialSentiment, -1, 1),
    socialRisk: clamp(socialRisk, 0, 1),
    socialEngagement: Number(socialEngagement.toFixed(1)),
    ...eventSummary
  };
}

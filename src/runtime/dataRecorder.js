import fs from "node:fs/promises";
import path from "node:path";
import { appendJsonLine, ensureDir, listFiles, removeFile } from "../utils/fs.js";

const FEATURE_STORE_SCHEMA_VERSION = 6;

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function dayKey(at) {
  return `${at || new Date().toISOString()}`.slice(0, 10);
}

function normalizeNumericMap(values = {}, digits = 4) {
  return Object.fromEntries(
    Object.entries(values || {})
      .filter(([, value]) => Number.isFinite(value))
      .map(([name, value]) => [name, num(value, digits)])
  );
}

function pickTopNumericMap(values = {}, limit = 18, digits = 4) {
  return Object.fromEntries(
    Object.entries(normalizeNumericMap(values, digits))
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, limit)
  );
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function average(values = [], fallback = 0) {
  const filtered = arr(values).filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((total, value) => total + value, 0) / filtered.length : fallback;
}

function makeIndicatorFrame(source = {}) {
  return {
    adx14: num(source.adx14 || 0, 2),
    dmiSpread: num(source.dmiSpread || 0, 3),
    trendQualityScore: num(source.trendQualityScore || 0, 3),
    supertrendDirection: source.supertrendDirection || 0,
    supertrendDistancePct: num(source.supertrendDistancePct || 0, 4),
    stochRsiK: num(source.stochRsiK || 0, 2),
    stochRsiD: num(source.stochRsiD || 0, 2),
    mfi14: num(source.mfi14 || 0, 2),
    cmf20: num(source.cmf20 || 0, 3),
    keltnerSqueezeScore: num(source.keltnerSqueezeScore || 0, 3),
    squeezeReleaseScore: num(source.squeezeReleaseScore || 0, 3)
  };
}

function summarizeCandidateSnapshot(candidate = {}) {
  return {
    symbol: candidate.symbol || null,
    allow: Boolean(candidate.decision?.allow),
    probability: num(candidate.score?.probability || 0, 4),
    threshold: num(candidate.decision?.threshold || 0, 4),
    rankScore: num(candidate.decision?.rankScore || 0, 4),
    regime: candidate.regimeSummary?.regime || null,
    strategy: candidate.strategySummary?.activeStrategy || null,
    entryStyle: candidate.decision?.executionPlan?.entryStyle || null,
    quoteAmount: num(candidate.decision?.quoteAmount || 0, 2),
    market: {
      mid: num(candidate.marketSnapshot?.book?.mid || 0, 6),
      spreadBps: num(candidate.marketSnapshot?.book?.spreadBps || 0, 2),
      bookPressure: num(candidate.marketSnapshot?.book?.bookPressure || 0, 4),
      depthConfidence: num(candidate.marketSnapshot?.book?.depthConfidence || 0, 4),
      realizedVolPct: num(candidate.marketSnapshot?.market?.realizedVolPct || 0, 4)
    },
    venue: {
      status: candidate.venueConfirmationSummary?.status || null,
      divergenceBps: num(candidate.venueConfirmationSummary?.divergenceBps || 0, 2)
    },
    governance: {
      metaScore: num(candidate.metaSummary?.score || 0, 4),
      quorumStatus: candidate.qualityQuorumSummary?.status || null,
      capitalGovernor: candidate.decision?.capitalGovernorApplied?.status || null
    },
    dataQuality: summarizeDataQualitySnapshot(candidate.dataQualitySummary || {}),
    confidenceBreakdown: summarizeConfidenceBreakdown(candidate.confidenceBreakdown || {}),
    topRawFeatures: pickTopNumericMap(candidate.rawFeatures || {}, 8, 4)
  };
}

function summarizeDataQualitySnapshot(summary = {}) {
  const sources = arr(summary.sources || []).slice(0, 8);
  const degraded = sources.filter((item) => item.status === "degraded");
  const missing = sources.filter((item) => item.status === "missing");
  return {
    status: summary.status || "unknown",
    overallScore: num(summary.overallScore || 0, 4),
    freshnessScore: num(summary.freshnessScore || 0, 4),
    trustScore: num(summary.trustScore || 0, 4),
    coverageScore: num(summary.coverageScore || 0, 4),
    degradedButAllowed: Boolean(summary.degradedButAllowed),
    degradedCount: degraded.length,
    missingCount: missing.length,
    degradedSources: degraded.map((item) => item.label).slice(0, 4),
    missingSources: missing.map((item) => item.label).slice(0, 4),
    sources: sources.map((item) => ({
      label: item.label || null,
      status: item.status || "unknown",
      coverage: num(item.coverage || 0, 3),
      freshnessScore: num(item.freshnessScore || 0, 4),
      trustScore: num(item.trustScore || 0, 4),
      fallbackSource: item.fallbackSource || null
    }))
  };
}

function summarizeConfidenceBreakdown(summary = {}) {
  return {
    marketConfidence: num(summary.marketConfidence || 0, 4),
    dataConfidence: num(summary.dataConfidence || 0, 4),
    executionConfidence: num(summary.executionConfidence || 0, 4),
    modelConfidence: num(summary.modelConfidence || 0, 4),
    overallConfidence: num(summary.overallConfidence || 0, 4)
  };
}

function buildDataLineageSnapshot({
  dataQualitySummary = {},
  confidenceBreakdown = {},
  marketStateSummary = {},
  newsSummary = {},
  announcementSummary = {}
} = {}) {
  const sources = arr(dataQualitySummary.sources || []);
  const fallbackCount = sources.filter((item) => item.fallbackSource).length;
  const degradedCount = sources.filter((item) => item.status === "degraded").length;
  const missingCount = sources.filter((item) => item.status === "missing").length;
  return {
    dataStatus: dataQualitySummary.status || "unknown",
    featureCompleteness: num(marketStateSummary.featureCompleteness || 0, 4),
    freshnessScore: num(dataQualitySummary.freshnessScore || 0, 4),
    trustScore: num(dataQualitySummary.trustScore || 0, 4),
    coverageScore: num(dataQualitySummary.coverageScore || 0, 4),
    degradedButAllowed: Boolean(dataQualitySummary.degradedButAllowed),
    fallbackCount,
    degradedCount,
    missingCount,
    newsFreshnessHours: num(newsSummary.freshnessHours || 0, 2),
    announcementCoverage: num(announcementSummary.coverage || 0, 2),
    confidence: summarizeConfidenceBreakdown(confidenceBreakdown),
    sources: sources.map((item) => ({
      label: item.label || null,
      status: item.status || "unknown",
      coverage: num(item.coverage || 0, 3),
      freshnessScore: num(item.freshnessScore || 0, 4),
      trustScore: num(item.trustScore || 0, 4),
      fallbackSource: item.fallbackSource || null
    }))
  };
}

function buildRecordQuality({
  dataLineage = {},
  marketState = {},
  kind = "generic"
} = {}) {
  const completeness = clamp(
    average([
      dataLineage.featureCompleteness,
      dataLineage.coverageScore,
      dataLineage.trustScore,
      dataLineage.freshnessScore
    ], 0.55),
    0,
    1
  );
  const confidence = clamp(
    average([
      dataLineage.confidence?.dataConfidence,
      dataLineage.confidence?.marketConfidence,
      dataLineage.confidence?.overallConfidence,
      marketState.dataConfidence
    ], 0.55),
    0,
    1
  );
  const fallbackPenalty = Math.min(0.28, (dataLineage.fallbackCount || 0) * 0.05 + (dataLineage.missingCount || 0) * 0.04);
  const degradedPenalty = Math.min(0.22, (dataLineage.degradedCount || 0) * 0.05);
  const score = clamp(completeness * 0.52 + confidence * 0.48 - fallbackPenalty - degradedPenalty, 0, 1);
  return {
    kind,
    completeness: num(completeness, 4),
    confidence: num(confidence, 4),
    fallbackPenalty: num(fallbackPenalty, 4),
    degradedPenalty: num(degradedPenalty, 4),
    score: num(score, 4),
    tier: score >= 0.78 ? "high" : score >= 0.58 ? "medium" : "low"
  };
}

function sortCoverageMap(entries = []) {
  return arr(entries)
    .sort((left, right) => {
      if ((right.count || 0) !== (left.count || 0)) {
        return (right.count || 0) - (left.count || 0);
      }
      return (right.avgReliability || right.avgCoverage || 0) - (left.avgReliability || left.avgCoverage || 0);
    });
}

function updateSourceCoverage(current = {}, payload = {}) {
  const next = { ...(current || {}) };
  for (const item of arr(payload.items || [])) {
    const key = item.provider || item.source || "unknown";
    const previous = next[key] || {
      provider: key,
      count: 0,
      avgReliability: 0,
      avgFreshnessScore: 0,
      lastSeenAt: null,
      channels: {}
    };
    const total = (previous.count || 0) + 1;
    const reliability = num(item.reliabilityScore || 0, 4);
    const freshnessScore = num(payload.freshnessScore || 0, 4);
    const channel = item.channel || "news";
    next[key] = {
      provider: key,
      count: total,
      avgReliability: num((((previous.avgReliability || 0) * (previous.count || 0)) + reliability) / total, 4),
      avgFreshnessScore: num((((previous.avgFreshnessScore || 0) * (previous.count || 0)) + freshnessScore) / total, 4),
      lastSeenAt: payload.at || previous.lastSeenAt || null,
      channels: {
        ...(previous.channels || {}),
        [channel]: ((previous.channels || {})[channel] || 0) + 1
      }
    };
  }
  return Object.fromEntries(sortCoverageMap(Object.entries(next).map(([key, value]) => [key, value])));
}

function updateContextCoverage(current = {}, payload = {}) {
  const kind = payload.contextType || payload.kind || "unknown";
  const previous = current[kind] || {
    kind,
    count: 0,
    avgCoverage: 0,
    avgConfidence: 0,
    avgRiskScore: 0,
    highImpactCount: 0,
    lastSeenAt: null,
    nextEventAt: null
  };
  const total = (previous.count || 0) + 1;
  return {
    ...(current || {}),
    [kind]: {
      kind,
      count: total,
      avgCoverage: num((((previous.avgCoverage || 0) * (previous.count || 0)) + num(payload.summary?.coverage || 0, 4)) / total, 4),
      avgConfidence: num((((previous.avgConfidence || 0) * (previous.count || 0)) + num(payload.summary?.confidence || 0, 4)) / total, 4),
      avgRiskScore: num((((previous.avgRiskScore || 0) * (previous.count || 0)) + num(payload.summary?.riskScore || 0, 4)) / total, 4),
      highImpactCount: (previous.highImpactCount || 0) + (payload.summary?.highImpactCount || 0),
      lastSeenAt: payload.at || previous.lastSeenAt || null,
      nextEventAt: payload.summary?.nextEventAt || previous.nextEventAt || null
    }
  };
}

function summarizeSourceCoverage(summary = {}, limit = 6) {
  return sortCoverageMap(Object.values(summary || {}))
    .slice(0, limit)
    .map((item) => ({
      provider: item.provider || null,
      count: item.count || 0,
      avgReliability: num(item.avgReliability || 0, 4),
      avgFreshnessScore: num(item.avgFreshnessScore || 0, 4),
      lastSeenAt: item.lastSeenAt || null,
      channels: Object.entries(item.channels || {}).sort((left, right) => right[1] - left[1]).slice(0, 3)
    }));
}

function summarizeContextCoverage(summary = {}, limit = 4) {
  return arr(Object.values(summary || {}))
    .sort((left, right) => (right.count || 0) - (left.count || 0))
    .slice(0, limit)
    .map((item) => ({
      kind: item.kind || null,
      count: item.count || 0,
      avgCoverage: num(item.avgCoverage || 0, 4),
      avgConfidence: num(item.avgConfidence || 0, 4),
      avgRiskScore: num(item.avgRiskScore || 0, 4),
      highImpactCount: item.highImpactCount || 0,
      lastSeenAt: item.lastSeenAt || null,
      nextEventAt: item.nextEventAt || null
    }));
}

function restoreSourceCoverage(summary = {}) {
  if (Array.isArray(summary)) {
    return Object.fromEntries(
      arr(summary).map((item) => [
        item.provider || "unknown",
        {
          provider: item.provider || "unknown",
          count: item.count || 0,
          avgReliability: num(item.avgReliability || 0, 4),
          avgFreshnessScore: num(item.avgFreshnessScore || 0, 4),
          lastSeenAt: item.lastSeenAt || null,
          channels: Object.fromEntries(arr(item.channels || []))
        }
      ])
    );
  }
  return summary && typeof summary === "object" ? summary : {};
}

function restoreContextCoverage(summary = {}) {
  if (Array.isArray(summary)) {
    return Object.fromEntries(
      arr(summary).map((item) => [
        item.kind || "unknown",
        {
          kind: item.kind || "unknown",
          count: item.count || 0,
          avgCoverage: num(item.avgCoverage || 0, 4),
          avgConfidence: num(item.avgConfidence || 0, 4),
          avgRiskScore: num(item.avgRiskScore || 0, 4),
          highImpactCount: item.highImpactCount || 0,
          lastSeenAt: item.lastSeenAt || null,
          nextEventAt: item.nextEventAt || null
        }
      ])
    );
  }
  return summary && typeof summary === "object" ? summary : {};
}

function buildNewsHistoryPayload({
  at,
  symbol,
  aliases = [],
  summary = {},
  items = [],
  cacheState = "fresh_fetch"
} = {}) {
  const fallbackState = `${cacheState || ""}`.includes("fallback");
  const degradedState = cacheState === "degraded" || fallbackState;
  const dataLineage = {
    featureCompleteness: clamp(num(summary.coverage || 0, 4) / 4, 0, 1),
    freshnessScore: num(summary.freshnessScore || 0, 4),
    trustScore: num(summary.reliabilityScore || 0, 4),
    coverageScore: clamp(num(summary.coverage || 0, 4) / 4, 0, 1),
    degradedButAllowed: degradedState,
    fallbackCount: fallbackState ? 1 : 0,
    degradedCount: degradedState && !fallbackState ? 1 : 0,
    missingCount: 0,
    confidence: {
      dataConfidence: num(summary.confidence || 0, 4),
      marketConfidence: num(summary.confidence || 0, 4),
      overallConfidence: num(summary.confidence || 0, 4)
    }
  };
  return {
    schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
    frameType: "news_history",
    at,
    symbol: symbol || null,
    aliases: arr(aliases).slice(0, 8),
    cacheState,
    coverage: summary.coverage || 0,
    confidence: num(summary.confidence || 0, 4),
    reliabilityScore: num(summary.reliabilityScore || 0, 4),
    riskScore: num(summary.riskScore || 0, 4),
    freshnessScore: num(summary.freshnessScore || 0, 4),
    dominantEventType: summary.dominantEventType || "general",
    providerOperationalHealth: arr(summary.providerOperationalHealth || []).slice(0, 6).map((item) => ({
      provider: item.provider || null,
      score: num(item.score || 0, 4),
      cooldownUntil: item.cooldownUntil || null
    })),
    items: arr(items).slice(0, 8).map((item) => ({
      title: item.title || null,
      provider: item.provider || null,
      source: item.source || null,
      channel: item.channel || "news",
      publishedAt: item.publishedAt || null,
      dominantEventType: item.event?.dominantType || item.dominantEventType || "general",
      sentimentScore: num(item.score || 0, 4),
      riskScore: num(item.riskScore || 0, 4),
      reliabilityScore: num(item.reliability?.reliabilityScore || item.reliabilityScore || 0, 4),
      sourceQuality: num(item.reliability?.sourceQuality || item.sourceQuality || 0, 4),
      whitelisted: Boolean(item.reliability?.whitelisted || item.whitelisted),
      engagementScore: num(item.engagementScore || 0, 2),
      link: item.link || null
    })),
    recordQuality: buildRecordQuality({
      dataLineage,
      marketState: { dataConfidence: num(summary.confidence || 0, 4) },
      kind: "news"
    })
  };
}

function buildContextHistoryPayload({
  at,
  symbol,
  aliases = [],
  kind,
  summary = {},
  items = [],
  cacheState = "fresh_fetch"
} = {}) {
  const fallbackState = `${cacheState || ""}`.includes("fallback");
  const degradedState = cacheState === "degraded" || fallbackState;
  const dataLineage = {
    featureCompleteness: clamp(num(summary.coverage || 0, 4), 0, 1),
    freshnessScore: num(summary.freshnessScore || 0, 4),
    trustScore: num(summary.confidence || 0, 4),
    coverageScore: clamp(num(summary.coverage || 0, 4), 0, 1),
    degradedButAllowed: degradedState,
    fallbackCount: fallbackState ? 1 : 0,
    degradedCount: degradedState && !fallbackState ? 1 : 0,
    missingCount: 0,
    confidence: {
      dataConfidence: num(summary.confidence || 0, 4),
      marketConfidence: num(summary.confidence || 0, 4),
      overallConfidence: num(summary.confidence || 0, 4)
    }
  };
  return {
    schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
    frameType: "context_history",
    contextType: kind || "unknown",
    at,
    symbol: symbol || null,
    aliases: arr(aliases).slice(0, 8),
    cacheState,
    summary: {
      coverage: num(summary.coverage || 0, 3),
      confidence: num(summary.confidence || 0, 4),
      riskScore: num(summary.riskScore || 0, 4),
      freshnessScore: num(summary.freshnessScore || 0, 4),
      dominantEventType: summary.dominantEventType || summary.nextEventType || null,
      blockerReasons: arr(summary.blockerReasons || []).slice(0, 6),
      highImpactCount: summary.highImpactCount || summary.highPriorityCount || 0,
      nextEventAt: summary.nextEventAt || summary.latestNoticeAt || null,
      nextEventTitle: summary.nextEventTitle || summary.blockingNotice?.title || null
    },
    items: arr(items).slice(0, 8).map((item) => ({
      title: item.title || null,
      at: item.at || item.publishedAt || null,
      type: item.type || item.category || item.dominantEventType || null,
      source: item.source || null,
      provider: item.provider || null,
      impact: num(item.impact || item.severity || 0, 4),
      bias: num(item.bias || item.score || 0, 4),
      riskScore: num(item.riskScore || 0, 4),
      link: item.link || null
    })),
    recordQuality: buildRecordQuality({
      dataLineage,
      marketState: { dataConfidence: num(summary.confidence || 0, 4) },
      kind: `context_${kind || "unknown"}`
    })
  };
}

function makeDecisionFrame(candidate = {}) {
  return {
    symbol: candidate.symbol,
    allow: Boolean(candidate.decision?.allow),
    probability: num(candidate.score?.probability || 0, 4),
    confidence: num(candidate.score?.confidence || 0, 4),
    calibrationConfidence: num(candidate.score?.calibrationConfidence || 0, 4),
    threshold: num(candidate.decision?.threshold || 0, 4),
    rankScore: num(candidate.decision?.rankScore || 0, 4),
    regime: candidate.regimeSummary?.regime || null,
    strategy: candidate.strategySummary?.activeStrategy || null,
    family: candidate.strategySummary?.family || null,
    reasons: [...(candidate.decision?.reasons || [])].slice(0, 8),
    blockers: [...(candidate.blockerReasons || candidate.decision?.reasons || [])].slice(0, 8),
    providerDiversity: candidate.newsSummary?.providerDiversity || 0,
    reliabilityScore: num(candidate.newsSummary?.reliabilityScore || 0, 4),
    fundingRate: num(candidate.marketStructureSummary?.fundingRate || 0, 6),
    openInterestChangePct: num(candidate.marketStructureSummary?.openInterestChangePct || 0, 4),
    bookPressure: num(candidate.marketSnapshot?.book?.bookPressure || 0, 4),
    spreadBps: num(candidate.marketSnapshot?.book?.spreadBps || 0, 2),
    topSignals: (candidate.score?.contributions || []).slice(0, 5).map((item) => ({
      name: item.name,
      contribution: num(item.contribution || 0, 4),
      rawValue: num(item.rawValue || 0, 4)
    })),
    sequenceProbability: num(candidate.score?.sequence?.probability || 0, 4),
    sequenceConfidence: num(candidate.score?.sequence?.confidence || 0, 4),
    metaNeuralProbability: num(candidate.score?.metaNeural?.probability || 0, 4),
    metaNeuralConfidence: num(candidate.score?.metaNeural?.confidence || 0, 4),
    expertDominantRegime: candidate.score?.expertMix?.dominantRegime || null,
    indicators: makeIndicatorFrame(candidate.marketSnapshot?.market || {}),
    marketState: {
      direction: candidate.marketStateSummary?.direction || null,
      phase: candidate.marketStateSummary?.phase || null,
      trendMaturity: num(candidate.marketStateSummary?.trendMaturity || 0, 4),
      trendExhaustion: num(candidate.marketStateSummary?.trendExhaustion || 0, 4),
      rangeAcceptance: num(candidate.marketStateSummary?.rangeAcceptance || 0, 4),
      trendFailure: num(candidate.marketStateSummary?.trendFailure || 0, 4),
      dataConfidence: num(candidate.marketStateSummary?.dataConfidence || 0, 4),
      featureCompleteness: num(candidate.marketStateSummary?.featureCompleteness || 0, 4)
    },
    dataQuality: summarizeDataQualitySnapshot(candidate.dataQualitySummary || {}),
    signalQuality: {
      overallScore: num(candidate.signalQualitySummary?.overallScore || 0, 4),
      setupFit: num(candidate.signalQualitySummary?.setupFit || 0, 4),
      structureQuality: num(candidate.signalQualitySummary?.structureQuality || 0, 4),
      executionViability: num(candidate.signalQualitySummary?.executionViability || 0, 4),
      newsCleanliness: num(candidate.signalQualitySummary?.newsCleanliness || 0, 4),
      quorumQuality: num(candidate.signalQualitySummary?.quorumQuality || 0, 4)
    },
    confidenceBreakdown: summarizeConfidenceBreakdown(candidate.confidenceBreakdown || {}),
    dataLineage: buildDataLineageSnapshot({
      dataQualitySummary: candidate.dataQualitySummary,
      confidenceBreakdown: candidate.confidenceBreakdown,
      marketStateSummary: candidate.marketStateSummary,
      newsSummary: candidate.newsSummary,
      announcementSummary: candidate.announcementSummary
    }),
    recordQuality: buildRecordQuality({
      dataLineage: buildDataLineageSnapshot({
        dataQualitySummary: candidate.dataQualitySummary,
        confidenceBreakdown: candidate.confidenceBreakdown,
        marketStateSummary: candidate.marketStateSummary,
        newsSummary: candidate.newsSummary,
        announcementSummary: candidate.announcementSummary
      }),
      marketState: candidate.marketStateSummary || {},
      kind: "decision"
    })
  };
}

function pruneOldFiles(files = [], keepCount = 30) {
  return [...files].sort().reverse().slice(keepCount);
}

function safeStateNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

async function resolveLatestTimestamp(files = []) {
  const timestamps = [];
  for (const filePath of files) {
    try {
      const stats = await fs.stat(filePath);
      timestamps.push(stats.mtime.toISOString());
    } catch {
      // Ignore files that disappeared between listing and stat calls.
    }
  }
  return timestamps.sort().reverse()[0] || null;
}

async function readRecentJsonlFiles(filePaths = [], maxRecords = 120) {
  const records = [];
  for (const filePath of filePaths) {
    if (records.length >= maxRecords) {
      break;
    }
    try {
      const content = await fs.readFile(filePath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      for (const line of lines.reverse()) {
        try {
          records.push(JSON.parse(line));
        } catch {
          // Ignore malformed historical lines.
        }
        if (records.length >= maxRecords) {
          break;
        }
      }
    } catch {
      // Ignore files that disappear or cannot be read during bootstrap sampling.
    }
  }
  return records;
}

async function readAllJsonlFiles(filePaths = []) {
  const records = [];
  for (const filePath of filePaths) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          records.push(JSON.parse(line));
        } catch {
          // Ignore malformed lines while rebuilding file-truth state.
        }
      }
    } catch {
      // Ignore files that disappear or cannot be read while recounting.
    }
  }
  return records;
}

async function countJsonlRecords(filePaths = []) {
  let count = 0;
  for (const filePath of filePaths) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      count += content.split("\n").filter((line) => line.trim().length > 0).length;
    } catch {
      // Ignore files that disappear or cannot be read while recounting.
    }
  }
  return count;
}

function summarizeQualityStateFromRecords(records = []) {
  const qualityRecords = arr(records)
    .map((item) => ({
      at: item?.at || null,
      recordQuality: item?.recordQuality || null
    }))
    .filter((item) => item.recordQuality && item.recordQuality.score != null);
  const total = qualityRecords.length;
  const qualityByKind = {};
  for (const item of qualityRecords) {
    const quality = item.recordQuality;
    const kind = quality.kind || "generic";
    const previous = qualityByKind[kind] || {
      kind,
      count: 0,
      averageScore: 0,
      high: 0,
      medium: 0,
      low: 0
    };
    const nextCount = (previous.count || 0) + 1;
    qualityByKind[kind] = {
      kind,
      count: nextCount,
      averageScore: num((((previous.averageScore || 0) * (previous.count || 0)) + num(quality.score || 0, 4)) / nextCount, 4),
      high: (previous.high || 0) + (quality.tier === "high" ? 1 : 0),
      medium: (previous.medium || 0) + (quality.tier === "medium" ? 1 : 0),
      low: (previous.low || 0) + (quality.tier === "low" ? 1 : 0)
    };
  }
  const latestQualityEntry = qualityRecords.reduce((latest, item) => {
    const itemAt = new Date(item.at || 0).getTime();
    const latestAt = new Date(latest?.at || 0).getTime();
    if (!latest || (Number.isFinite(itemAt) && itemAt >= latestAt)) {
      return item;
    }
    return latest;
  }, null);
  return {
    recordQualityCount: total,
    averageRecordQuality: num(average(qualityRecords.map((item) => item.recordQuality?.score || 0), 0), 4),
    latestRecordQuality: latestQualityEntry?.recordQuality || null,
    qualityByKind
  };
}

function topCounts(values = [], limit = 6) {
  return Object.entries(
    arr(values).reduce((acc, value) => {
      if (!value) {
        return acc;
      }
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {})
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}

export class DataRecorder {
  constructor({ runtimeDir, config, logger }) {
    this.runtimeDir = runtimeDir;
    this.config = config;
    this.logger = logger;
    this.rootDir = path.join(runtimeDir, "feature-store");
    this.state = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      enabled: Boolean(config.dataRecorderEnabled),
      lastRecordAt: null,
      filesWritten: 0,
      cycleFrames: 0,
      decisionFrames: 0,
      tradeFrames: 0,
      learningFrames: 0,
      researchFrames: 0,
      snapshotFrames: 0,
      newsFrames: 0,
      contextFrames: 0,
      datasetFrames: 0,
      archivedFiles: 0,
      lineageCoverage: 0,
      recordQualityCount: 0,
      averageRecordQuality: 0,
      latestRecordQuality: null,
      qualityByKind: {},
      latestBootstrap: null,
      sourceCoverage: {},
      contextCoverage: {},
      datasetCuration: null,
      retention: {
        hotRetentionDays: config.dataRecorderRetentionDays || 21,
        coldRetentionDays: config.dataRecorderColdRetentionDays || 90,
        lastCompactionAt: null
      },
      lastPruneAt: null
    };
  }

  async init(previousState = null) {
    if (!this.config.dataRecorderEnabled) {
      return;
    }
    const buckets = ["cycles", "decisions", "trades", "learning", "research", "snapshots", "news", "contexts", "datasets"];
    await Promise.all(buckets.map((bucket) => ensureDir(path.join(this.rootDir, bucket))));
    await Promise.all(buckets.map((bucket) => ensureDir(path.join(this.rootDir, "archive", bucket))));

    const restored = previousState && typeof previousState === "object" ? previousState : {};
    const fileGroups = await Promise.all(
      buckets.map((bucket) => listFiles(path.join(this.rootDir, bucket)))
    );
    const archiveGroups = await Promise.all(
      buckets.map((bucket) => listFiles(path.join(this.rootDir, "archive", bucket)))
    );
    const existingFiles = fileGroups.flat();
    const archivedFiles = archiveGroups.flat();
    const fileTruthCounts = Object.fromEntries(await Promise.all(
      buckets.map(async (bucket, index) => [
        bucket,
        await countJsonlRecords([...(fileGroups[index] || []), ...(archiveGroups[index] || [])])
      ])
    ));
    const totalFrames = Object.values(fileTruthCounts).reduce((total, value) => total + (value || 0), 0);

    this.state = {
      ...this.state,
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      enabled: true,
      lastRecordAt: restored.lastRecordAt || this.state.lastRecordAt,
      filesWritten: totalFrames,
      cycleFrames: fileTruthCounts.cycles || 0,
      decisionFrames: fileTruthCounts.decisions || 0,
      tradeFrames: fileTruthCounts.trades || 0,
      learningFrames: fileTruthCounts.learning || 0,
      researchFrames: fileTruthCounts.research || 0,
      snapshotFrames: fileTruthCounts.snapshots || 0,
      newsFrames: fileTruthCounts.news || 0,
      contextFrames: fileTruthCounts.contexts || 0,
      datasetFrames: fileTruthCounts.datasets || 0,
      archivedFiles: archivedFiles.length,
      lineageCoverage: num(restored.lineageCoverage || 0, 4),
      recordQualityCount: safeStateNumber(restored.recordQualityCount, this.state.recordQualityCount),
      averageRecordQuality: num(restored.averageRecordQuality || 0, 4),
      latestRecordQuality: restored.latestRecordQuality || null,
      qualityByKind: restored.qualityByKind || {},
      latestBootstrap: restored.latestBootstrap || null,
      sourceCoverage: restoreSourceCoverage(restored.sourceCoverage),
      contextCoverage: restoreContextCoverage(restored.contextCoverage),
      datasetCuration: restored.datasetCuration || null,
      retention: {
        hotRetentionDays: safeStateNumber(restored.retention?.hotRetentionDays, this.config.dataRecorderRetentionDays || 21),
        coldRetentionDays: safeStateNumber(restored.retention?.coldRetentionDays, this.config.dataRecorderColdRetentionDays || 90),
        lastCompactionAt: restored.retention?.lastCompactionAt || null
      },
      lastPruneAt: restored.lastPruneAt || this.state.lastPruneAt
    };

    if (!this.state.lastRecordAt) {
      this.state.lastRecordAt = await resolveLatestTimestamp([...existingFiles, ...archivedFiles]);
    }
    await this.rebuildFileTruthState({ maxCoverageRecords: 800, preserveLastRecordAt: false });
  }

  async recordCycle({ at, mode, candidates = [], openedPosition = null, overview = {}, safety = {}, marketSentiment = {}, volatility = {} }) {
    if (!this.config.dataRecorderEnabled) {
      return null;
    }
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "cycle",
      at,
      mode,
      openPositions: overview.openPositions || 0,
      equity: num(overview.equity || 0, 2),
      quoteFree: num(overview.quoteFree || 0, 2),
      openedSymbol: openedPosition?.symbol || null,
      topDecision: candidates[0] ? makeDecisionFrame(candidates[0]) : null,
      selectedSymbols: candidates.slice(0, 5).map((candidate) => candidate.symbol),
      safety: {
        selfHealMode: safety.selfHeal?.mode || null,
        driftStatus: safety.drift?.status || null,
        session: safety.session?.session || null
      },
      market: {
        fearGreedValue: marketSentiment.fearGreedValue ?? null,
        btcDominancePct: num(marketSentiment.btcDominancePct || 0, 2),
        optionIv: num(volatility.marketOptionIv || 0, 2),
        ivPremium: num(volatility.ivPremium || 0, 2)
      }
    };
    await this.write("cycles", at, payload);
    this.state.cycleFrames += 1;
    return payload;
  }

  async recordDecisions({ at, candidates = [] }) {
    if (!this.config.dataRecorderEnabled || !candidates.length) {
      return 0;
    }
    const frames = candidates.slice(0, 12).map((candidate) => ({
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "decision",
      at,
      ...makeDecisionFrame(candidate),
      rawFeatureCount: Object.keys(candidate.rawFeatures || {}).length,
      topRawFeatures: pickTopNumericMap(candidate.rawFeatures || {}, 12, 4)
    }));
    for (const frame of frames) {
      await this.write("decisions", at, frame);
    }
    this.state.decisionFrames += frames.length;
    const lineaged = frames.filter((frame) => (frame.dataLineage?.sources || []).length > 0).length;
    this.state.lineageCoverage = num(
      ((this.state.lineageCoverage || 0) * Math.max(this.state.decisionFrames - frames.length, 0) + lineaged) /
      Math.max(this.state.decisionFrames, 1),
      4
    );
    return frames.length;
  }

  async recordTrade(trade) {
    if (!this.config.dataRecorderEnabled || !trade) {
      return null;
    }
    const at = trade.exitAt || trade.entryAt || new Date().toISOString();
    const entryRationale = trade.entryRationale || {};
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "trade",
      at,
      symbol: trade.symbol,
      pnlQuote: num(trade.pnlQuote || 0, 2),
      netPnlPct: num(trade.netPnlPct || 0, 4),
      labelScore: num(trade.labelScore || 0, 4),
      strategy: trade.strategyAtEntry || null,
      regime: trade.regimeAtEntry || null,
      reason: trade.reason || null,
      brokerMode: trade.brokerMode || null,
      entryStyle: trade.entryExecutionAttribution?.entryStyle || null,
      provider: trade.entryRationale?.providerBreakdown?.[0]?.name || null,
      executionQualityScore: num(trade.executionQualityScore || 0, 4),
      captureEfficiency: num(trade.captureEfficiency || 0, 4),
      sessionAtEntry: trade.sessionAtEntry || null,
      rawFeatureCount: Object.keys(trade.rawFeatures || {}).length,
      topRawFeatures: pickTopNumericMap(trade.rawFeatures || {}, 12, 4),
      indicators: makeIndicatorFrame(entryRationale.indicators || {}),
      headlines: (trade.entryRationale?.headlines || []).slice(0, 3).map((item) => item.title || item),
      blockers: [...(trade.entryRationale?.blockerReasons || [])].slice(0, 6),
      dataLineage: buildDataLineageSnapshot({
        dataQualitySummary: entryRationale.dataQuality,
        confidenceBreakdown: entryRationale.confidenceBreakdown,
        marketStateSummary: entryRationale.marketState,
        newsSummary: { freshnessHours: entryRationale.news?.freshnessHours || 0 },
        announcementSummary: { coverage: arr(entryRationale.officialNotices || []).length }
      }),
      recordQuality: buildRecordQuality({
        dataLineage: buildDataLineageSnapshot({
          dataQualitySummary: entryRationale.dataQuality,
          confidenceBreakdown: entryRationale.confidenceBreakdown,
          marketStateSummary: entryRationale.marketState,
          newsSummary: { freshnessHours: entryRationale.news?.freshnessHours || 0 },
          announcementSummary: { coverage: arr(entryRationale.officialNotices || []).length }
        }),
        marketState: entryRationale.marketState || {},
        kind: "trade"
      })
    };
    await this.write("trades", at, payload);
    this.state.tradeFrames += 1;
    return payload;
  }

  async recordLearningEvent({ trade, learning }) {
    if (!this.config.dataRecorderEnabled || !trade || !learning) {
      return null;
    }
    const at = trade.exitAt || trade.entryAt || new Date().toISOString();
    const rationale = trade.entryRationale || {};
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "learning",
      at,
      symbol: trade.symbol,
      brokerMode: trade.brokerMode || null,
      strategy: trade.strategyAtEntry || rationale.strategy?.activeStrategy || null,
      family: rationale.strategy?.family || null,
      regime: trade.regimeAtEntry || learning.regime || null,
      pnlQuote: num(trade.pnlQuote || 0, 2),
      netPnlPct: num(trade.netPnlPct || 0, 4),
      mfePct: num(trade.mfePct || 0, 4),
      maePct: num(trade.maePct || 0, 4),
      labelScore: num(learning.label?.labelScore ?? trade.labelScore ?? 0, 4),
      executionQualityScore: num(trade.executionQualityScore || 0, 4),
      captureEfficiency: num(trade.captureEfficiency || 0, 4),
      gate: {
        probability: num(rationale.probability || 0, 4),
        confidence: num(rationale.confidence || 0, 4),
        calibrationConfidence: num(rationale.calibrationConfidence || 0, 4),
        threshold: num(rationale.threshold || 0, 4),
        rankScore: num(rationale.rankScore || 0, 4)
      },
      model: {
        championBefore: num(learning.championLearning?.predictionBeforeUpdate || 0, 4),
        challengerBefore: num(learning.challengerLearning?.predictionBeforeUpdate || 0, 4),
        championError: num(learning.championLearning?.error || 0, 4),
        challengerError: num(learning.challengerLearning?.error || 0, 4),
        championSampleWeight: num(learning.championLearning?.sampleWeight || 0, 4),
        challengerSampleWeight: num(learning.challengerLearning?.sampleWeight || 0, 4),
        transformerAbsoluteError: num(learning.transformerLearning?.absoluteError || 0, 4),
        transformerProbability: num(learning.transformerLearning?.probability || 0, 4),
        sequenceTarget: num(learning.sequenceLearning?.target || 0, 4),
        metaTarget: num(learning.metaNeuralLearning?.target || 0, 4),
        executionSizingTarget: num(learning.executionNeuralLearning?.targets?.sizing || 0, 4),
        exitTarget: num(learning.exitNeuralLearning?.targets?.exit || 0, 4),
        calibrationObservations: learning.calibration?.observations || 0,
        calibrationEce: num(learning.calibration?.expectedCalibrationError || 0, 4),
        promotion: Boolean(learning.promotion)
      },
      news: {
        providerBreakdown: [...(rationale.providerBreakdown || [])].slice(0, 4),
        headlineTitles: (rationale.headlines || []).slice(0, 4).map((item) => item.title || item),
        officialNoticeCount: (rationale.officialNotices || []).length,
        dominantEventType: rationale.dominantEventType || rationale.exchange?.dominantEventType || null
      },
      rationale: {
        summary: rationale.summary || null,
        topSignals: (rationale.topSignals || []).slice(0, 8),
        sequenceDrivers: (rationale.sequence?.drivers || []).slice(0, 6),
        metaNeuralDrivers: (rationale.metaNeural?.drivers || []).slice(0, 6),
        expertMix: rationale.expertMix || null,
        strategyReasons: [...(rationale.strategy?.reasons || [])].slice(0, 6),
        blockerReasons: [...(rationale.blockerReasons || [])].slice(0, 8),
        executionReasons: [...(rationale.executionReasons || [])].slice(0, 6),
        checks: (rationale.checks || []).slice(0, 8)
      },
      indicators: makeIndicatorFrame(rationale.indicators || {}),
      dataLineage: buildDataLineageSnapshot({
        dataQualitySummary: rationale.dataQuality,
        confidenceBreakdown: rationale.confidenceBreakdown,
        marketStateSummary: rationale.marketState,
        newsSummary: { freshnessHours: rationale.news?.freshnessHours || 0 },
        announcementSummary: { coverage: arr(rationale.officialNotices || []).length }
      }),
      recordQuality: buildRecordQuality({
        dataLineage: buildDataLineageSnapshot({
          dataQualitySummary: rationale.dataQuality,
          confidenceBreakdown: rationale.confidenceBreakdown,
          marketStateSummary: rationale.marketState,
          newsSummary: { freshnessHours: rationale.news?.freshnessHours || 0 },
          announcementSummary: { coverage: arr(rationale.officialNotices || []).length }
        }),
        marketState: rationale.marketState || {},
        kind: "learning"
      }),
      rawFeatures: normalizeNumericMap(trade.rawFeatures || {}, 4),
      topRawFeatures: pickTopNumericMap(trade.rawFeatures || {}, 20, 4)
    };
    await this.write("learning", at, payload);
    this.state.learningFrames += 1;
    return payload;
  }

  async recordResearch(summary) {
    if (!this.config.dataRecorderEnabled || !summary?.generatedAt) {
      return null;
    }
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "research",
      at: summary.generatedAt,
      symbolCount: summary.symbolCount || 0,
      bestSymbol: summary.bestSymbol || null,
      totalTrades: summary.totalTrades || 0,
      realizedPnl: num(summary.realizedPnl || 0, 2),
      averageSharpe: num(summary.averageSharpe || 0, 3),
      averageWinRate: num(summary.averageWinRate || 0, 4),
      topFamilies: [...(summary.topFamilies || [])].slice(0, 4),
      topRegimes: [...(summary.topRegimes || [])].slice(0, 4)
    };
    await this.write("research", summary.generatedAt, payload);
    this.state.researchFrames += 1;
    return payload;
  }

  async recordSnapshotManifest({ at, mode, candidates = [], openedPosition = null, overview = {}, ops = {}, report = {} }) {
    if (!this.config.dataRecorderEnabled) {
      return null;
    }
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "snapshot_manifest",
      at,
      mode,
      equity: num(overview.equity || 0, 2),
      quoteFree: num(overview.quoteFree || 0, 2),
      openPositions: overview.openPositions || 0,
      openedSymbol: openedPosition?.symbol || null,
      readiness: ops.readiness?.status || null,
      alertStatus: ops.alerts?.status || null,
      exchangeSafety: ops.exchangeSafety?.status || null,
      capitalGovernor: ops.capitalGovernor?.status || null,
      executionCost: report.executionCostSummary?.status || null,
      dataRecorder: {
        lineageCoverage: num(this.state.lineageCoverage || 0, 4),
        archivedFiles: this.state.archivedFiles || 0
      },
      topCandidates: candidates.slice(0, 5).map(summarizeCandidateSnapshot)
    };
    await this.write("snapshots", at, payload);
    this.state.snapshotFrames += 1;
    return payload;
  }

  async recordTradeReplaySnapshot(trade) {
    if (!this.config.dataRecorderEnabled || !trade) {
      return null;
    }
    const at = trade.exitAt || trade.entryAt || new Date().toISOString();
    const rationale = trade.entryRationale || {};
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "trade_replay",
      at,
      symbol: trade.symbol,
      brokerMode: trade.brokerMode || null,
      strategy: trade.strategyAtEntry || rationale.strategy?.activeStrategy || null,
      regime: trade.regimeAtEntry || rationale.regimeSummary?.regime || null,
      pnlQuote: num(trade.pnlQuote || 0, 2),
      netPnlPct: num(trade.netPnlPct || 0, 4),
      entryPrice: num(trade.entryPrice || 0, 6),
      exitPrice: num(trade.exitPrice || 0, 6),
      reason: trade.reason || null,
      execution: {
        entryStyle: trade.entryExecutionAttribution?.entryStyle || null,
        exitStyle: trade.exitExecutionAttribution?.entryStyle || null,
        executionQualityScore: num(trade.executionQualityScore || 0, 4),
        captureEfficiency: num(trade.captureEfficiency || 0, 4)
      },
      gate: {
        probability: num(rationale.probability || trade.probabilityAtEntry || 0, 4),
        threshold: num(rationale.threshold || 0, 4),
        confidence: num(rationale.confidence || 0, 4)
      },
      dataLineage: buildDataLineageSnapshot({
        dataQualitySummary: rationale.dataQuality,
        confidenceBreakdown: rationale.confidenceBreakdown,
        marketStateSummary: rationale.marketState,
        newsSummary: { freshnessHours: rationale.news?.freshnessHours || 0 },
        announcementSummary: { coverage: arr(rationale.officialNotices || []).length }
      }),
      recordQuality: buildRecordQuality({
        dataLineage: buildDataLineageSnapshot({
          dataQualitySummary: rationale.dataQuality,
          confidenceBreakdown: rationale.confidenceBreakdown,
          marketStateSummary: rationale.marketState,
          newsSummary: { freshnessHours: rationale.news?.freshnessHours || 0 },
          announcementSummary: { coverage: arr(rationale.officialNotices || []).length }
        }),
        marketState: rationale.marketState || {},
        kind: "trade_replay"
      }),
      replayCheckpoints: (trade.replayCheckpoints || []).slice(-12),
      topRawFeatures: pickTopNumericMap(trade.rawFeatures || {}, 10, 4)
    };
    await this.write("snapshots", at, payload);
    this.state.snapshotFrames += 1;
    return payload;
  }

  async prune() {
    if (!this.config.dataRecorderEnabled) {
      return;
    }
    const hotKeepCount = Math.max(3, this.config.dataRecorderRetentionDays || 21);
    const coldKeepCount = Math.max(hotKeepCount, this.config.dataRecorderColdRetentionDays || 90);
    let archivedCount = 0;
    for (const bucket of ["cycles", "decisions", "trades", "learning", "research", "snapshots", "news", "contexts", "datasets"]) {
      const bucketDir = path.join(this.rootDir, bucket);
      const archiveDir = path.join(this.rootDir, "archive", bucket);
      await ensureDir(archiveDir);
      const files = [...(await listFiles(bucketDir))].sort().reverse();
      const hotFiles = files.slice(0, hotKeepCount);
      const toArchive = files.slice(hotKeepCount, coldKeepCount);
      const toDelete = files.slice(coldKeepCount);
      for (const file of toArchive) {
        const target = path.join(archiveDir, path.basename(file));
        try {
          await fs.rename(file, target);
          archivedCount += 1;
        } catch {
          await removeFile(file);
        }
      }
      for (const file of toDelete) {
        await removeFile(file);
      }
      const archiveFiles = [...(await listFiles(archiveDir))].sort().reverse();
      for (const file of pruneOldFiles(archiveFiles, coldKeepCount - hotFiles.length)) {
        await removeFile(file);
      }
    }
    this.state.archivedFiles = archivedCount;
    this.state.retention = {
      hotRetentionDays: hotKeepCount,
      coldRetentionDays: coldKeepCount,
      lastCompactionAt: new Date().toISOString()
    };
    this.state.lastPruneAt = new Date().toISOString();
    const archiveBuckets = await Promise.all(
      ["cycles", "decisions", "trades", "learning", "research", "snapshots", "news", "contexts", "datasets"].map((bucket) =>
        listFiles(path.join(this.rootDir, "archive", bucket))
      )
    );
    this.state.archivedFiles = archiveBuckets.flat().length;
  }

  async recordNewsHistory({ at, symbol, aliases = [], summary = {}, items = [], cacheState = "fresh_fetch" } = {}) {
    if (!this.config.dataRecorderEnabled || !symbol || !at) {
      return null;
    }
    const payload = buildNewsHistoryPayload({ at, symbol, aliases, summary, items, cacheState });
    await this.write("news", at, payload);
    this.state.newsFrames += 1;
    this.state.sourceCoverage = updateSourceCoverage(this.state.sourceCoverage || {}, payload);
    return payload;
  }

  async recordContextHistory({ at, symbol, aliases = [], kind, summary = {}, items = [], cacheState = "fresh_fetch" } = {}) {
    if (!this.config.dataRecorderEnabled || !symbol || !at || !kind) {
      return null;
    }
    const payload = buildContextHistoryPayload({ at, symbol, aliases, kind, summary, items, cacheState });
    await this.write("contexts", at, payload);
    this.state.contextFrames += 1;
    this.state.contextCoverage = updateContextCoverage(this.state.contextCoverage || {}, payload);
    return payload;
  }

  async recordDatasetCuration({ at, journal = {}, newsCache = {}, sourceReliability = {}, paperLearning = {} } = {}) {
    if (!this.config.dataRecorderEnabled || !at) {
      return null;
    }
    const trades = arr(journal.trades || []);
    const blockedSetups = arr(journal.blockedSetups || []);
    const counterfactuals = arr(journal.counterfactuals || []);
    const newsEntries = Object.values(newsCache || {});
    const recentOutcomes = trades.slice(-60).map((trade) => trade.paperLearningOutcome?.outcome).filter(Boolean);
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "dataset_curation",
      at,
      datasets: {
        featureStore: {
          decisionFrames: this.state.decisionFrames || 0,
          learningFrames: this.state.learningFrames || 0,
          tradeFrames: this.state.tradeFrames || 0,
          newsFrames: this.state.newsFrames || 0,
          snapshotFrames: this.state.snapshotFrames || 0
        },
        paperLearning: {
          tradeCount: trades.filter((trade) => (trade.brokerMode || "paper") === "paper").length,
          recentOutcomes: Object.fromEntries(
            Object.entries(
              recentOutcomes.reduce((acc, outcome) => {
                acc[outcome] = (acc[outcome] || 0) + 1;
                return acc;
              }, {})
            ).sort((left, right) => right[1] - left[1]).slice(0, 6)
          ),
          status: paperLearning.status || "unknown"
        },
        vetoReview: {
          blockedSetups: blockedSetups.length,
          counterfactuals: counterfactuals.length,
          badVetoCount: counterfactuals.filter((item) => item.outcome === "bad_veto").length,
          goodVetoCount: counterfactuals.filter((item) => item.outcome === "good_veto").length
        },
        exitLearning: {
          earlyExitCount: trades.filter((trade) => trade.paperLearningOutcome?.outcome === "early_exit").length,
          lateExitCount: trades.filter((trade) => trade.paperLearningOutcome?.outcome === "late_exit").length
        },
        executionLearning: {
          executionDragCount: trades.filter((trade) => trade.paperLearningOutcome?.executionQuality === "weak" || trade.paperLearningOutcome?.outcome === "execution_drag").length,
          avgExecutionQuality: num(average(trades.map((trade) => trade.executionQualityScore || 0), 0), 4)
        },
        regimeLearning: {
          topRegimes: Object.entries(
            trades.reduce((acc, trade) => {
              const regime = trade.regimeAtEntry || "unknown";
              acc[regime] = (acc[regime] || 0) + 1;
              return acc;
            }, {})
          ).sort((left, right) => right[1] - left[1]).slice(0, 6).map(([regime, count]) => ({ regime, count }))
        },
        newsHistory: {
          symbolCount: newsEntries.length,
          freshCoverage: newsEntries.filter((entry) => (entry.summary?.coverage || 0) > 0).length,
          avgReliability: num(average(newsEntries.map((entry) => entry.summary?.reliabilityScore || 0), 0), 4),
          operationalReliability: num(sourceReliability.operationalReliability || 0, 4),
          topSources: summarizeSourceCoverage(this.state.sourceCoverage || {}, 5)
        },
        contextHistory: {
          frameCount: this.state.contextFrames || 0,
          topContexts: summarizeContextCoverage(this.state.contextCoverage || {}, 4)
        },
        dataQuality: {
          lineageCoverage: num(this.state.lineageCoverage || 0, 4),
          archivedFiles: this.state.archivedFiles || 0,
          averageRecordQuality: num(this.state.averageRecordQuality || 0, 4),
          latestRecordQuality: this.state.latestRecordQuality || null,
          qualityByKind: arr(Object.values(this.state.qualityByKind || {}))
            .sort((left, right) => (right.count || 0) - (left.count || 0))
            .slice(0, 8)
            .map((item) => ({
              kind: item.kind || null,
              count: item.count || 0,
              averageScore: num(item.averageScore || 0, 4),
              high: item.high || 0,
              medium: item.medium || 0,
              low: item.low || 0
            })),
          hotRetentionDays: this.state.retention?.hotRetentionDays || this.config.dataRecorderRetentionDays || 21,
          coldRetentionDays: this.state.retention?.coldRetentionDays || this.config.dataRecorderColdRetentionDays || 90
        }
      }
    };
    await this.write("datasets", at, payload);
    this.state.datasetFrames += 1;
    this.state.datasetCuration = payload.datasets;
    return payload;
  }

  async loadHistoricalBootstrap({ maxFilesPerBucket = 14, maxRecordsPerBucket = 160 } = {}) {
    if (!this.config.dataRecorderEnabled) {
      return null;
    }
    const loadBucket = async (bucket) => {
      const liveFiles = await listFiles(path.join(this.rootDir, bucket));
      const archiveFiles = await listFiles(path.join(this.rootDir, "archive", bucket));
      const selected = [...liveFiles, ...archiveFiles].sort().reverse().slice(0, maxFilesPerBucket);
      return readRecentJsonlFiles(selected, maxRecordsPerBucket);
    };

    const [decisionRecords, tradeRecords, learningRecords, newsRecords, contextRecords, datasetRecords] = await Promise.all([
      loadBucket("decisions"),
      loadBucket("trades"),
      loadBucket("learning"),
      loadBucket("news"),
      loadBucket("contexts"),
      loadBucket("datasets")
    ]);

    const latestDataset = datasetRecords[0]?.datasets || null;
    const bootstrap = {
      generatedAt: new Date().toISOString(),
      status: decisionRecords.length || tradeRecords.length || learningRecords.length || newsRecords.length || contextRecords.length
        ? "ready"
        : "empty",
      decisions: {
        count: decisionRecords.length,
        topStrategies: topCounts(decisionRecords.map((item) => item.strategy), 5),
        topRegimes: topCounts(decisionRecords.map((item) => item.regime), 5)
      },
      trades: {
        count: tradeRecords.length,
        avgNetPnlPct: num(average(tradeRecords.map((item) => item.netPnlPct || 0), 0), 4),
        topStrategies: topCounts(tradeRecords.map((item) => item.strategy), 5),
        topRegimes: topCounts(tradeRecords.map((item) => item.regime), 5)
      },
      learning: {
        count: learningRecords.length,
        avgLabelScore: num(average(learningRecords.map((item) => item.labelScore || 0), 0), 4),
        topStrategies: topCounts(learningRecords.map((item) => item.strategy), 5),
        topFamilies: topCounts(learningRecords.map((item) => item.family), 5),
        topRegimes: topCounts(learningRecords.map((item) => item.regime), 5)
      },
      news: {
        count: newsRecords.length,
        topProviders: topCounts(newsRecords.flatMap((item) => arr(item.items || []).map((newsItem) => newsItem.provider || newsItem.source)), 6),
        topEventTypes: topCounts(newsRecords.flatMap((item) => arr(item.items || []).map((newsItem) => newsItem.dominantEventType)), 6)
      },
      contexts: {
        count: contextRecords.length,
        topKinds: topCounts(contextRecords.map((item) => item.contextType), 4),
        topEventTypes: topCounts(contextRecords.flatMap((item) => arr(item.items || []).map((contextItem) => contextItem.type)), 6)
      },
      latestDatasetCuration: latestDataset ? {
        paperLearningStatus: latestDataset.paperLearning?.status || "unknown",
        paperLearningOutcomes: latestDataset.paperLearning?.recentOutcomes || {},
        topVetoBlockerCount: latestDataset.vetoReview?.blockedSetups || 0,
        exitLearning: latestDataset.exitLearning || null,
        executionLearning: latestDataset.executionLearning || null,
        regimeLearning: latestDataset.regimeLearning || null,
        newsHistory: latestDataset.newsHistory || null,
        contextHistory: latestDataset.contextHistory || null,
        dataQuality: latestDataset.dataQuality || null
      } : null,
      warmStart: {
        paperLearningReady: (latestDataset?.paperLearning?.tradeCount || 0) >= 3,
        governanceFocus: latestDataset?.vetoReview?.badVetoCount > latestDataset?.vetoReview?.goodVetoCount
          ? "veto_review"
          : latestDataset?.executionLearning?.executionDragCount > 0
            ? "execution_learning"
            : latestDataset?.exitLearning?.earlyExitCount > 0
              ? "exit_learning"
              : "paper_learning",
        note: latestDataset
          ? `Warm start vanuit recorder: ${latestDataset.paperLearning?.status || "unknown"} paper learning met ${latestDataset.featureStore?.learningFrames || 0} learning frames.`
          : "Nog geen dataset-curation beschikbaar voor warm start."
      }
    };

    this.state.latestBootstrap = bootstrap;
    return bootstrap;
  }

  getSummary() {
    return {
      ...this.state,
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      retention: {
        hotRetentionDays: this.state.retention?.hotRetentionDays || this.config.dataRecorderRetentionDays || 21,
        coldRetentionDays: this.state.retention?.coldRetentionDays || this.config.dataRecorderColdRetentionDays || 90,
        lastCompactionAt: this.state.retention?.lastCompactionAt || null
      },
      latestBootstrap: this.state.latestBootstrap || null,
      qualityByKind: arr(Object.values(this.state.qualityByKind || {}))
        .sort((left, right) => (right.count || 0) - (left.count || 0))
        .slice(0, 8)
        .map((item) => ({
          kind: item.kind || null,
          count: item.count || 0,
          averageScore: num(item.averageScore || 0, 4),
          high: item.high || 0,
          medium: item.medium || 0,
          low: item.low || 0
        })),
      sourceCoverage: summarizeSourceCoverage(this.state.sourceCoverage || {}, 6),
      contextCoverage: summarizeContextCoverage(this.state.contextCoverage || {}, 4),
      rootDir: this.rootDir
    };
  }

  async rebuildFileTruthState({ maxCoverageRecords = 800, preserveLastRecordAt = false } = {}) {
    if (!this.config.dataRecorderEnabled) {
      return this.getSummary();
    }
    const buckets = ["cycles", "decisions", "trades", "learning", "research", "snapshots", "news", "contexts", "datasets"];
    const liveFiles = await Promise.all(buckets.map((bucket) => listFiles(path.join(this.rootDir, bucket))));
    const archiveFiles = await Promise.all(buckets.map((bucket) => listFiles(path.join(this.rootDir, "archive", bucket))));
    const allFiles = buckets.reduce((acc, bucket, index) => {
      acc[bucket] = [...(liveFiles[index] || []), ...(archiveFiles[index] || [])].sort();
      return acc;
    }, {});
    const counts = Object.fromEntries(await Promise.all(
      buckets.map(async (bucket) => [bucket, await countJsonlRecords(allFiles[bucket] || [])])
    ));
    const [qualityRecords, newsRecords, contextRecords, datasetRecords] = await Promise.all([
      readAllJsonlFiles(
        [
          ...(allFiles.decisions || []),
          ...(allFiles.trades || []),
          ...(allFiles.learning || []),
          ...(allFiles.research || []),
          ...(allFiles.snapshots || []),
          ...(allFiles.news || []),
          ...(allFiles.contexts || []),
          ...(allFiles.datasets || [])
        ]
      ),
      readAllJsonlFiles((allFiles.news || []).slice(-Math.max(1, maxCoverageRecords))),
      readAllJsonlFiles((allFiles.contexts || []).slice(-Math.max(1, maxCoverageRecords))),
      readAllJsonlFiles((allFiles.datasets || []).slice(-Math.max(1, maxCoverageRecords)))
    ]);
    const rebuiltSourceCoverage = newsRecords.reduce((current, payload) => updateSourceCoverage(current, payload), {});
    const rebuiltContextCoverage = contextRecords.reduce((current, payload) => updateContextCoverage(current, payload), {});
    const rebuiltQualityState = summarizeQualityStateFromRecords(qualityRecords);
    this.state = {
      ...this.state,
      filesWritten: Object.values(counts).reduce((total, value) => total + (value || 0), 0),
      cycleFrames: counts.cycles || 0,
      decisionFrames: counts.decisions || 0,
      tradeFrames: counts.trades || 0,
      learningFrames: counts.learning || 0,
      researchFrames: counts.research || 0,
      snapshotFrames: counts.snapshots || 0,
      newsFrames: counts.news || 0,
      contextFrames: counts.contexts || 0,
      datasetFrames: counts.datasets || 0,
      archivedFiles: archiveFiles.flat().length,
      recordQualityCount: rebuiltQualityState.recordQualityCount,
      averageRecordQuality: rebuiltQualityState.averageRecordQuality,
      latestRecordQuality: rebuiltQualityState.latestRecordQuality,
      qualityByKind: rebuiltQualityState.qualityByKind,
      sourceCoverage: Object.keys(rebuiltSourceCoverage).length ? rebuiltSourceCoverage : this.state.sourceCoverage,
      contextCoverage: Object.keys(rebuiltContextCoverage).length ? rebuiltContextCoverage : this.state.contextCoverage,
      datasetCuration: datasetRecords.at(-1)?.datasets || this.state.datasetCuration
    };
    if (!preserveLastRecordAt || !this.state.lastRecordAt) {
      this.state.lastRecordAt = await resolveLatestTimestamp([...liveFiles.flat(), ...archiveFiles.flat()]);
    }
    return this.getSummary();
  }

  touch(at, increment = 1) {
    this.state.lastRecordAt = at;
    this.state.filesWritten += increment;
  }

  async write(bucket, at, payload) {
    const filePath = path.join(this.rootDir, bucket, `${dayKey(at)}.jsonl`);
    await appendJsonLine(filePath, payload);
    if (payload?.recordQuality?.score != null) {
      const totalFrames = (this.state.recordQualityCount || 0) + 1;
      this.state.averageRecordQuality = num(
        ((this.state.averageRecordQuality || 0) * (this.state.recordQualityCount || 0) + num(payload.recordQuality.score || 0, 4)) / totalFrames,
        4
      );
      this.state.recordQualityCount = totalFrames;
      this.state.latestRecordQuality = payload.recordQuality;
      const kind = payload.recordQuality.kind || "generic";
      const previous = this.state.qualityByKind?.[kind] || {
        kind,
        count: 0,
        averageScore: 0,
        high: 0,
        medium: 0,
        low: 0
      };
      const kindTotal = (previous.count || 0) + 1;
      this.state.qualityByKind = {
        ...(this.state.qualityByKind || {}),
        [kind]: {
          kind,
          count: kindTotal,
          averageScore: num((((previous.averageScore || 0) * (previous.count || 0)) + num(payload.recordQuality.score || 0, 4)) / kindTotal, 4),
          high: (previous.high || 0) + (payload.recordQuality.tier === "high" ? 1 : 0),
          medium: (previous.medium || 0) + (payload.recordQuality.tier === "medium" ? 1 : 0),
          low: (previous.low || 0) + (payload.recordQuality.tier === "low" ? 1 : 0)
        }
      };
    }
    this.touch(at);
  }
}




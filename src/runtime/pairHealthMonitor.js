import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function ensureBucket(map, symbol) {
  if (!map.has(symbol)) {
    map.set(symbol, {
      symbol,
      tradeCount: 0,
      winCount: 0,
      realizedPnl: 0,
      avgNetPnlPct: 0,
      avgExecutionQuality: 0,
      avgSlippageDeltaBps: 0,
      timeoutCount: 0,
      cacheFallbackCount: 0,
      candidateFailureCount: 0,
      entryFailureCount: 0,
      newsFailureCount: 0,
      sourceCooldownHits: 0,
      lastIssueAt: null
    });
  }
  return map.get(symbol);
}

function parseEventTime(value) {
  const atMs = new Date(value || 0).getTime();
  return Number.isFinite(atMs) ? atMs : Number.NaN;
}

function markIssue(bucket, eventAt, field) {
  bucket[field] = (bucket[field] || 0) + 1;
  if (!bucket.lastIssueAt || parseEventTime(eventAt) > parseEventTime(bucket.lastIssueAt)) {
    bucket.lastIssueAt = eventAt || null;
  }
}

function eventMentionsTimeout(event = {}) {
  const text = `${event.error || event.message || event.reason || ""}`.toLowerCase();
  return text.includes("timeout") || text.includes("aborted");
}

export class PairHealthMonitor {
  constructor(config) {
    this.config = config;
  }

  buildSnapshot({ journal = {}, runtime = {}, watchlist = [], nowIso = new Date().toISOString() } = {}) {
    const lookbackHours = Math.max(6, Number(this.config.pairHealthLookbackHours || 72));
    const nowMs = new Date(nowIso).getTime();
    const minMs = nowMs - lookbackHours * 3_600_000;
    const buckets = new Map();
    const seedSymbols = new Set([
      ...(watchlist || []),
      ...((runtime.openPositions || []).map((position) => position.symbol)),
      ...((runtime.latestDecisions || []).map((decision) => decision.symbol)),
      ...((journal.trades || []).map((trade) => trade.symbol)),
      ...((journal.events || []).map((event) => event.symbol).filter(Boolean))
    ]);

    for (const symbol of seedSymbols) {
      ensureBucket(buckets, symbol);
    }

    for (const trade of journal.trades || []) {
      const tradeAtMs = parseEventTime(trade.exitAt || trade.entryAt);
      if (!Number.isFinite(tradeAtMs) || tradeAtMs < minMs || !trade.symbol) {
        continue;
      }
      const bucket = ensureBucket(buckets, trade.symbol);
      bucket.tradeCount += 1;
      bucket.winCount += (trade.pnlQuote || 0) > 0 ? 1 : 0;
      bucket.realizedPnl += trade.pnlQuote || 0;
      bucket.avgNetPnlPct += trade.netPnlPct || 0;
      bucket.avgExecutionQuality += trade.executionQualityScore || 0;
      const entrySlipDelta = trade.entryExecutionAttribution?.slippageDeltaBps;
      if (Number.isFinite(entrySlipDelta)) {
        bucket.avgSlippageDeltaBps += entrySlipDelta;
      }
    }

    for (const event of journal.events || []) {
      const eventAtMs = parseEventTime(event.at);
      if (!Number.isFinite(eventAtMs) || eventAtMs < minMs || !event.symbol) {
        continue;
      }
      const bucket = ensureBucket(buckets, event.symbol);
      if (event.type === "market_snapshot_cache_fallback") {
        markIssue(bucket, event.at, "cacheFallbackCount");
        if (eventMentionsTimeout(event)) {
          markIssue(bucket, event.at, "timeoutCount");
        }
      } else if (event.type === "candidate_evaluation_failed") {
        markIssue(bucket, event.at, "candidateFailureCount");
        if (eventMentionsTimeout(event)) {
          markIssue(bucket, event.at, "timeoutCount");
        }
      } else if (event.type === "position_open_failed") {
        markIssue(bucket, event.at, "entryFailureCount");
      } else if (event.type === "news_provider_failure") {
        markIssue(bucket, event.at, "newsFailureCount");
      } else if (event.type === "source_provider_cooldown") {
        markIssue(bucket, event.at, "sourceCooldownHits");
      }
    }

    const bySymbol = {};
    const quarantinedSymbols = [];
    const healthyScores = [];

    for (const [symbol, bucket] of buckets) {
      const tradeCount = bucket.tradeCount || 0;
      const avgNetPnlPct = tradeCount ? bucket.avgNetPnlPct / tradeCount : 0;
      const avgExecutionQuality = tradeCount ? bucket.avgExecutionQuality / tradeCount : 0.5;
      const avgSlippageDeltaBps = tradeCount ? bucket.avgSlippageDeltaBps / tradeCount : 0;
      const winRate = tradeCount ? bucket.winCount / tradeCount : 0.5;
      const infraPenalty = clamp(
        (bucket.timeoutCount || 0) * 0.12 +
          (bucket.cacheFallbackCount || 0) * 0.05 +
          (bucket.candidateFailureCount || 0) * 0.05 +
          (bucket.entryFailureCount || 0) * 0.08 +
          (bucket.newsFailureCount || 0) * 0.04 +
          (bucket.sourceCooldownHits || 0) * 0.03,
        0,
        0.9
      );
      const score = clamp(
        0.52 +
          avgNetPnlPct * 9 +
          (winRate - 0.5) * 0.22 +
          (avgExecutionQuality - 0.5) * 0.24 -
          clamp(avgSlippageDeltaBps / 10, 0, 0.2) -
          infraPenalty,
        0,
        1
      );
      const issueCount = (bucket.timeoutCount || 0) + (bucket.entryFailureCount || 0) + (bucket.candidateFailureCount || 0);
      const hasHardInfraIssue = issueCount > 0;
      const quarantineMinutes = Math.max(30, Number(this.config.pairHealthQuarantineMinutes || 180));
      const quarantineTriggered = issueCount >= this.config.pairHealthMaxInfraIssues ||
        (score < this.config.pairHealthMinScore && hasHardInfraIssue);
      const quarantinedUntil = bucket.lastIssueAt && quarantineTriggered
        ? new Date(parseEventTime(bucket.lastIssueAt) + quarantineMinutes * 60_000).toISOString()
        : null;
      const quarantined = Boolean(quarantinedUntil && parseEventTime(quarantinedUntil) > nowMs);
      const reasons = [];
      if (winRate >= 0.58 && tradeCount >= 3) {
        reasons.push("recent_pair_edge");
      }
      if (avgExecutionQuality >= 0.68 && tradeCount >= 2) {
        reasons.push("healthy_fill_quality");
      }
      if (avgSlippageDeltaBps <= 0.8 && tradeCount >= 2) {
        reasons.push("stable_execution_delta");
      }
      if ((bucket.timeoutCount || 0) > 0) {
        reasons.push("recent_timeout_noise");
      }
      if ((bucket.entryFailureCount || 0) > 0) {
        reasons.push("recent_entry_failures");
      }
      if ((bucket.cacheFallbackCount || 0) >= 2) {
        reasons.push("snapshot_cache_reliance");
      }
      if (quarantined) {
        reasons.push("pair_quarantined");
      }
      healthyScores.push(score);
      if (quarantined) {
        quarantinedSymbols.push(symbol);
      }
      bySymbol[symbol] = {
        symbol,
        score: num(score),
        health: score >= 0.72 ? "prime" : score >= 0.56 ? "ready" : score >= this.config.pairHealthMinScore ? "watch" : "fragile",
        tradeCount,
        winRate: num(winRate),
        realizedPnl: num(bucket.realizedPnl, 2),
        avgNetPnlPct: num(avgNetPnlPct),
        avgExecutionQuality: num(avgExecutionQuality),
        avgSlippageDeltaBps: num(avgSlippageDeltaBps, 2),
        infraPenalty: num(infraPenalty),
        timeoutCount: bucket.timeoutCount || 0,
        cacheFallbackCount: bucket.cacheFallbackCount || 0,
        candidateFailureCount: bucket.candidateFailureCount || 0,
        entryFailureCount: bucket.entryFailureCount || 0,
        newsFailureCount: bucket.newsFailureCount || 0,
        sourceCooldownHits: bucket.sourceCooldownHits || 0,
        lastIssueAt: bucket.lastIssueAt || null,
        quarantined,
        quarantinedUntil,
        reasons
      };
    }

    return {
      generatedAt: nowIso,
      trackedSymbols: Object.keys(bySymbol).length,
      averageScore: num(average(healthyScores)),
      quarantinedCount: quarantinedSymbols.length,
      quarantinedSymbols,
      bySymbol,
      suggestions: quarantinedSymbols.length
        ? [`${quarantinedSymbols[0]} staat tijdelijk in quarantine door recente infra/fill issues.`]
        : ["Geen pair quarantines actief."]
    };
  }

  evaluateSymbol(snapshot = {}, { symbol, marketSnapshot = {}, newsSummary = {}, timeframeSummary = {} } = {}) {
    const base = snapshot.bySymbol?.[symbol] || {
      symbol,
      score: 0.5,
      health: "watch",
      tradeCount: 0,
      quarantined: false,
      reasons: []
    };
    const spreadPenalty = clamp((marketSnapshot.book?.spreadBps || 0) / Math.max(this.config.maxSpreadBps || 25, 1) * 0.08, 0, 0.18);
    const depthBoost = clamp((marketSnapshot.book?.depthConfidence || 0) * 0.08, 0, 0.08);
    const newsPenalty = clamp(Math.max(0, this.config.newsMinReliabilityScore - (newsSummary.reliabilityScore || 0)) * 0.16, 0, 0.12);
    const tfPenalty = clamp(Math.max(0, 0.42 - (timeframeSummary.alignmentScore || 0)) * 0.12, 0, 0.1);
    const score = clamp((base.score || 0.5) + depthBoost - spreadPenalty - newsPenalty - tfPenalty, 0, 1);
    const reasons = [...(base.reasons || [])];
    if ((marketSnapshot.book?.spreadBps || 0) > (this.config.maxSpreadBps || 25) * 0.8) {
      reasons.push("pair_spread_soft_penalty");
    }
    if ((marketSnapshot.book?.depthConfidence || 0) >= 0.65) {
      reasons.push("pair_depth_confirmed");
    }
    if ((newsSummary.reliabilityScore || 0) < this.config.newsMinReliabilityScore) {
      reasons.push("pair_news_reliability_soft_penalty");
    }
    if ((timeframeSummary.alignmentScore || 0) < this.config.crossTimeframeMinAlignmentScore) {
      reasons.push("pair_timeframe_misaligned");
    }
    return {
      ...base,
      score: num(score),
      health: score >= 0.72 ? "prime" : score >= 0.56 ? "ready" : score >= this.config.pairHealthMinScore ? "watch" : "fragile",
      reasons: [...new Set(reasons)].slice(0, 8),
      quarantined: Boolean(base.quarantined),
      quarantineReason: base.quarantined ? (base.reasons || [])[0] || "pair_quarantined" : null
    };
  }
}

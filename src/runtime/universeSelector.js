import { clamp } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function average(values = []) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function buildHealth(score) {
  if (score >= 0.72) {
    return "prime";
  }
  if (score >= 0.58) {
    return "ready";
  }
  if (score >= 0.42) {
    return "watch";
  }
  return "cold";
}

function defaultProfile(symbol) {
  return {
    symbol,
    cluster: "other",
    sector: "other",
    betaGroup: "other"
  };
}

function buildRotationState({ journal = {}, openPositions = [], profiles = {}, nowIso = new Date().toISOString(), lookbackDays = 21, maxCoolingClusters = 2 } = {}) {
  const nowMs = new Date(nowIso).getTime();
  const minMs = nowMs - Math.max(1, lookbackDays) * 86400000;
  const byCluster = new Map();
  const openCounts = new Map();

  for (const position of openPositions || []) {
    const profile = profiles[position.symbol] || defaultProfile(position.symbol);
    openCounts.set(profile.cluster, (openCounts.get(profile.cluster) || 0) + 1);
  }

  for (const trade of journal.trades || []) {
    const atMs = new Date(trade.exitAt || trade.entryAt || 0).getTime();
    if (!Number.isFinite(atMs) || atMs < minMs) {
      continue;
    }
    const profile = profiles[trade.symbol] || defaultProfile(trade.symbol);
    if (!byCluster.has(profile.cluster)) {
      byCluster.set(profile.cluster, {
        cluster: profile.cluster,
        trades: 0,
        winCount: 0,
        pnlQuote: 0,
        pnlPct: 0
      });
    }
    const bucket = byCluster.get(profile.cluster);
    bucket.trades += 1;
    bucket.winCount += (trade.pnlQuote || 0) > 0 ? 1 : 0;
    bucket.pnlQuote += trade.pnlQuote || 0;
    bucket.pnlPct += trade.netPnlPct || 0;
  }

  const clusters = [...byCluster.values()].map((bucket) => {
    const openCount = openCounts.get(bucket.cluster) || 0;
    const winRate = bucket.trades ? bucket.winCount / bucket.trades : 0;
    const avgPnlPct = bucket.trades ? bucket.pnlPct / bucket.trades : 0;
    const score = clamp(0.48 + avgPnlPct * 6 + (winRate - 0.5) * 0.28 - openCount * 0.08, 0, 1);
    return {
      cluster: bucket.cluster,
      trades: bucket.trades,
      openCount,
      winRate: num(winRate),
      avgPnlPct: num(avgPnlPct),
      pnlQuote: num(bucket.pnlQuote, 2),
      score: num(score)
    };
  });

  const focusClusters = clusters.filter((item) => item.score >= 0.56).sort((a, b) => b.score - a.score).slice(0, 3).map((item) => item.cluster);
  const coolingClusters = clusters.filter((item) => item.score <= 0.42).sort((a, b) => a.score - b.score).slice(0, maxCoolingClusters).map((item) => item.cluster);

  return {
    byCluster: Object.fromEntries(clusters.map((item) => [item.cluster, item])),
    focusClusters,
    coolingClusters,
    note: focusClusters.length
      ? `${focusClusters[0]} krijgt momenteel voorrang in de focus-universe.`
      : "Geen sterke cluster-rotatie actief.",
    focusReason: focusClusters.length
      ? `${focusClusters.join(", ")} scoren beter op recente tradekwaliteit.`
      : "Universe draait neutraal zonder sterke cluster-tilt."
  };
}

export class UniverseSelector {
  constructor(config) {
    this.config = config;
  }

  scoreSymbol({ symbol, snapshot, hasOpenPosition = false, previousDecision = null, rotationState = null }) {
    if (!snapshot) {
      return {
        symbol,
        eligible: false,
        selected: false,
        score: 0,
        health: "cold",
        spreadBps: null,
        depthConfidence: 0,
        totalDepthNotional: 0,
        recentTradeCount: 0,
        realizedVolPct: 0,
        reasons: [],
        blockers: ["missing_market_snapshot"]
      };
    }

    const profile = this.config.symbolProfiles?.[symbol] || defaultProfile(symbol);
    const rotationBucket = rotationState?.byCluster?.[profile.cluster] || null;
    const focusClusters = rotationState?.focusClusters || [];
    const coolingClusters = rotationState?.coolingClusters || [];

    const book = snapshot.book || {};
    const market = snapshot.market || {};
    const stream = snapshot.stream || {};
    const isLightweight = Boolean(snapshot.lightweight);
    const spreadBps = safeNumber(book.spreadBps);
    const depthConfidence = safeNumber(book.depthConfidence || book.localBook?.depthConfidence);
    const totalDepthNotional = safeNumber(book.totalDepthNotional || book.localBook?.totalDepthNotional);
    const realizedVolPct = safeNumber(market.realizedVolPct);
    const recentTradeCount = safeNumber(stream.recentTradeCount || book.recentTradeCount);
    const tradeFlowImbalance = safeNumber(stream.tradeFlowImbalance || book.tradeFlowImbalance);
    const bookPressure = safeNumber(book.bookPressure);
    const queueRefreshScore = safeNumber(book.queueRefreshScore || book.localBook?.queueRefreshScore);
    const depthAgeMs = safeNumber(book.depthAgeMs || book.localBook?.depthAgeMs);
    const localBookSynced = Boolean(book.localBookSynced ?? book.localBook?.synced);
    const resilienceScore = safeNumber(book.resilienceScore || book.localBook?.resilienceScore);
    const previousRank = safeNumber(previousDecision?.rankScore);
    const previousFit = safeNumber(previousDecision?.strategy?.fitScore || previousDecision?.strategySummary?.fitScore);
    const universeMinDepthUsd = safeNumber(this.config.universeMinDepthUsd, 60000);
    const universeTargetVolPct = safeNumber(this.config.universeTargetVolPct, 0.018);

    const spreadScore = clamp(
      1 - Math.max(0, spreadBps - 1) / Math.max(this.config.maxSpreadBps * 1.4 - 1, 1),
      0,
      1
    );
    const liquidityScore = clamp(
      clamp(totalDepthNotional / Math.max(universeMinDepthUsd * 8, 1), 0, 1) * 0.58 + depthConfidence * 0.42,
      0,
      1
    );
    const activityScore = clamp(
      clamp(recentTradeCount / 28, 0, 1) * 0.6 + clamp((safeNumber(market.volumeZ) + 1.5) / 3.5, 0, 1) * 0.4,
      0,
      1
    );
    const orderflowScore = clamp(
      0.5 + bookPressure * 0.34 + tradeFlowImbalance * 0.16 + queueRefreshScore * 0.12,
      0,
      1
    );
    const volatilityScore = clamp(
      1 - Math.abs(realizedVolPct - universeTargetVolPct) / Math.max(universeTargetVolPct, 0.01),
      0,
      1
    );
    const trendScore = clamp(
      0.46 +
        safeNumber(market.emaTrendScore) * 2.1 +
        safeNumber(market.breakoutPct) * 18 +
        safeNumber(market.structureBreakScore) * 0.26 +
        Math.max(0, safeNumber(market.momentum20)) * 3.4,
      0,
      1
    );
    const freshnessScore = localBookSynced
      ? clamp(1 - depthAgeMs / Math.max(this.config.maxDepthEventAgeMs * 2, 1), 0, 1)
      : isLightweight
        ? clamp(0.42 + clamp(recentTradeCount / 30, 0, 1) * 0.18 + spreadScore * 0.12, 0.35, 0.82)
        : 0.42;
    const spreadStabilityScore = clamp(0.45 + spreadScore * 0.4 + depthConfidence * 0.18 - Math.abs(book.microPriceEdgeBps || 0) / 8, 0, 1);
    const executionScore = clamp(0.42 + resilienceScore * 0.26 + queueRefreshScore * 0.18 + depthConfidence * 0.14, 0, 1);
    const lightweightExecutionSupportScore = isLightweight
      ? clamp(
          0.08 +
            spreadScore * 0.2 +
            liquidityScore * 0.24 +
            activityScore * 0.16 +
            spreadStabilityScore * 0.12 +
            freshnessScore * 0.1,
          0,
          0.78
        )
      : 0;
    const executionGuardScore = isLightweight
      ? Math.max(executionScore, lightweightExecutionSupportScore)
      : executionScore;
    const executionTelemetryWeak = isLightweight && executionScore + 0.08 < executionGuardScore;
    const carryScore = clamp(
      (hasOpenPosition ? 0.15 : 0) +
        (previousDecision?.allow ? 0.08 : 0) +
        clamp(previousRank * 0.22, -0.03, 0.08) +
        clamp(previousFit * 0.08, 0, 0.06),
      0,
      0.3
    );
    const rotationScore = clamp(
      0.44 +
        safeNumber(rotationBucket?.score, 0.5) * 0.32 +
        (focusClusters.includes(profile.cluster) ? 0.12 : 0) -
        (coolingClusters.includes(profile.cluster) ? 0.14 : 0),
      0,
      1
    );

    const blockers = [];
    if (spreadBps > this.config.maxSpreadBps * 1.35) {
      blockers.push("universe_spread_guard");
    }
    if (!hasOpenPosition && depthConfidence < this.config.universeMinDepthConfidence) {
      const lightweightDepthFailure = isLightweight && spreadBps <= this.config.maxSpreadBps * 0.9 && recentTradeCount >= 2;
      if (!lightweightDepthFailure) {
        blockers.push("universe_thin_local_book");
      }
    }
    if (!hasOpenPosition && totalDepthNotional < universeMinDepthUsd * 0.35) {
      const lightweightDepthFailure = isLightweight && spreadBps <= this.config.maxSpreadBps && recentTradeCount >= 3;
      if (!lightweightDepthFailure) {
        blockers.push("universe_shallow_depth");
      }
    }
    if (this.config.enableLocalOrderBook && localBookSynced && depthAgeMs > this.config.maxDepthEventAgeMs * 2) {
      blockers.push("universe_stale_depth");
    }
    if (!hasOpenPosition && recentTradeCount < 2 && spreadBps > this.config.maxSpreadBps * 0.65) {
      blockers.push("universe_low_activity");
    }
    if (!hasOpenPosition && executionGuardScore < 0.32) {
      blockers.push("universe_execution_quality_weak");
    }

    const reasons = [];
    if (spreadScore >= 0.78) {
      reasons.push("tight_spread");
    }
    if (liquidityScore >= 0.62) {
      reasons.push("healthy_depth");
    }
    if (activityScore >= 0.55) {
      reasons.push("active_tape");
    }
    if (orderflowScore >= 0.58) {
      reasons.push("supportive_orderflow");
    }
    if (trendScore >= 0.58) {
      reasons.push("trend_or_breakout_ready");
    }
    if (volatilityScore >= 0.56) {
      reasons.push("clean_volatility_profile");
    }
    if (spreadStabilityScore >= 0.58) {
      reasons.push("stable_spread_profile");
    }
    if (executionGuardScore >= 0.56) {
      reasons.push(executionTelemetryWeak ? "execution_ready_prefilter" : "execution_ready_book");
    }
    if (focusClusters.includes(profile.cluster)) {
      reasons.push(`cluster_rotation_${profile.cluster}`);
    }
    if (hasOpenPosition) {
      reasons.push("existing_position_carried");
    } else if (previousDecision?.allow) {
      reasons.push("carried_from_previous_top_setup");
    }
    if (isLightweight) {
      reasons.push("lightweight_prefilter_scan");
    }

    const score = clamp(
      spreadScore * 0.16 +
        liquidityScore * 0.22 +
        activityScore * 0.1 +
        orderflowScore * 0.14 +
        volatilityScore * 0.09 +
        trendScore * 0.13 +
        freshnessScore * 0.05 +
        spreadStabilityScore * 0.06 +
        executionGuardScore * 0.05 +
        rotationScore * (this.config.universeRotationBoost || 0.08) +
        carryScore,
      0,
      1.25
    );
    const eligible = blockers.length === 0 && score >= this.config.universeMinScore;

    return {
      symbol,
      eligible,
      selected: false,
      score: num(score),
      health: buildHealth(score),
      cluster: profile.cluster,
      sector: profile.sector,
      spreadBps: num(spreadBps, 2),
      depthConfidence: num(depthConfidence, 3),
      totalDepthNotional: num(totalDepthNotional, 2),
      recentTradeCount: Math.round(recentTradeCount),
      realizedVolPct: num(realizedVolPct, 4),
      liquidityScore: num(liquidityScore),
      activityScore: num(activityScore),
      orderflowScore: num(orderflowScore),
      volatilityScore: num(volatilityScore),
      trendScore: num(trendScore),
      spreadStabilityScore: num(spreadStabilityScore),
      executionScore: num(executionScore),
      executionGuardScore: num(executionGuardScore),
      lightweightExecutionSupportScore: num(lightweightExecutionSupportScore),
      executionTelemetryWeak,
      rotationScore: num(rotationScore),
      carryScore: num(carryScore),
      reasons,
      blockers
    };
  }

  buildSnapshot({
    symbols = [],
    snapshotMap = {},
    openPositions = [],
    latestDecisions = [],
    journal = {},
    nowIso = new Date().toISOString()
  } = {}) {
    const rotationState = buildRotationState({
      journal,
      openPositions,
      profiles: this.config.symbolProfiles || {},
      nowIso,
      lookbackDays: this.config.universeRotationLookbackDays,
      maxCoolingClusters: this.config.universeRotationMaxCoolingClusters
    });
    const openSet = new Set((openPositions || []).map((position) => position.symbol));
    const previousMap = Object.fromEntries((latestDecisions || []).map((decision) => [decision.symbol, decision]));
    const entries = symbols.map((symbol) =>
      this.scoreSymbol({
        symbol,
        snapshot: snapshotMap[symbol],
        hasOpenPosition: openSet.has(symbol),
        previousDecision: previousMap[symbol] || null,
        rotationState
      })
    );
    entries.sort((left, right) => right.score - left.score);

    const selected = [];
    const seen = new Set();
    const preferredCarry = [
      ...new Set([
        ...(openPositions || []).map((position) => position.symbol),
        ...(latestDecisions || []).filter((decision) => decision.allow).slice(0, 2).map((decision) => decision.symbol)
      ])
    ];

    const pushSelection = (symbol) => {
      if (seen.has(symbol)) {
        return;
      }
      const entry = entries.find((item) => item.symbol === symbol);
      if (!entry) {
        return;
      }
      seen.add(symbol);
      selected.push({ ...entry, selected: true });
    };

    for (const symbol of preferredCarry) {
      pushSelection(symbol);
    }

    for (const entry of entries) {
      if (selected.length >= this.config.universeMaxSymbols) {
        break;
      }
      if (!entry.eligible) {
        continue;
      }
      pushSelection(entry.symbol);
    }

    const selectedSymbols = selected.map((entry) => entry.symbol);
    const annotatedEntries = entries.map((entry) => ({
      ...entry,
      selected: selectedSymbols.includes(entry.symbol)
    }));
    const averageScore = average(selected.map((entry) => entry.score));
    const eligibleCount = annotatedEntries.filter((entry) => entry.eligible).length;
    const suggestions = [
      selected[0]
        ? `${selected[0].symbol} leidt de focus-universe met score ${selected[0].score.toFixed(2)}.`
        : "Nog geen symbool scoort hoog genoeg voor de focus-universe.",
      eligibleCount > this.config.universeMaxSymbols
        ? `${eligibleCount} symbols waren universe-waardig; de bot focust nu op de beste ${selected.length}.`
        : `Universe-dekking ${selected.length}/${symbols.length} symbols.`,
      annotatedEntries.some((entry) => entry.blockers.length)
        ? `${annotatedEntries.filter((entry) => entry.blockers.length).length} symbols werden geweerd door spread/depth/activity guards.`
        : "Geen extra universe-blockers actief."
    ];

    return {
      generatedAt: nowIso,
      configuredSymbolCount: symbols.length,
      selectedCount: selected.length,
      eligibleCount,
      selectionRate: num(symbols.length ? selected.length / symbols.length : 0),
      averageScore: num(averageScore),
      selectedSymbols,
      rotation: {
        focusClusters: rotationState.focusClusters,
        coolingClusters: rotationState.coolingClusters,
        note: rotationState.note,
        focusReason: rotationState.focusReason
      },
      selected: selected.map((entry) => ({
        symbol: entry.symbol,
        score: entry.score,
        health: entry.health,
        cluster: entry.cluster,
        sector: entry.sector,
        spreadBps: entry.spreadBps,
        depthConfidence: entry.depthConfidence,
        totalDepthNotional: entry.totalDepthNotional,
        recentTradeCount: entry.recentTradeCount,
        realizedVolPct: entry.realizedVolPct,
        reasons: [...entry.reasons],
        blockers: [...entry.blockers],
        liquidityScore: entry.liquidityScore,
        activityScore: entry.activityScore,
        orderflowScore: entry.orderflowScore,
        volatilityScore: entry.volatilityScore,
        trendScore: entry.trendScore,
        spreadStabilityScore: entry.spreadStabilityScore,
        executionScore: entry.executionScore,
        executionGuardScore: entry.executionGuardScore,
        lightweightExecutionSupportScore: entry.lightweightExecutionSupportScore,
        executionTelemetryWeak: entry.executionTelemetryWeak,
        rotationScore: entry.rotationScore,
        carryScore: entry.carryScore
      })),
      skipped: annotatedEntries
        .filter((entry) => !entry.selected)
        .slice(0, 12)
        .map((entry) => ({
          symbol: entry.symbol,
          score: entry.score,
          health: entry.health,
          cluster: entry.cluster,
          sector: entry.sector,
          spreadBps: entry.spreadBps,
          depthConfidence: entry.depthConfidence,
          totalDepthNotional: entry.totalDepthNotional,
          recentTradeCount: entry.recentTradeCount,
          realizedVolPct: entry.realizedVolPct,
          reasons: [...entry.reasons],
          blockers: [...entry.blockers],
          executionScore: entry.executionScore,
          executionGuardScore: entry.executionGuardScore,
          lightweightExecutionSupportScore: entry.lightweightExecutionSupportScore,
          executionTelemetryWeak: entry.executionTelemetryWeak
        })),
      suggestions
    };
  }
}

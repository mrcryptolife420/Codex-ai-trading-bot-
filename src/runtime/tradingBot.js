import { assertValidConfig } from "../config/validate.js";
import { AdaptiveTradingModel } from "../ai/adaptiveModel.js";
import { MultiAgentCommittee } from "../ai/multiAgentCommittee.js";
import { ReinforcementExecutionPolicy } from "../ai/rlExecutionPolicy.js";
import { StrategyOptimizer } from "../ai/strategyOptimizer.js";
import { StrategyAttribution } from "../ai/strategyAttribution.js";
import { ExitIntelligence } from "../ai/exitIntelligence.js";
import { MetaDecisionGate } from "../ai/metaDecisionGate.js";
import { BinanceClient, normalizeKlines } from "../binance/client.js";
import { buildSymbolRules } from "../binance/symbolFilters.js";
import { LiveBroker } from "../execution/liveBroker.js";
import { PaperBroker } from "../execution/paperBroker.js";
import { ExecutionEngine } from "../execution/executionEngine.js";
import { NewsService } from "../news/newsService.js";
import { BinanceAnnouncementService } from "../events/binanceAnnouncementService.js";
import { CalendarService } from "../events/calendarService.js";
import { MarketStructureService } from "../market/marketStructureService.js";
import { MarketSentimentService, EMPTY_MARKET_SENTIMENT } from "../market/marketSentimentService.js";
import { VolatilityService, EMPTY_VOLATILITY_CONTEXT } from "../market/volatilityService.js";
import { OnChainLiteService, EMPTY_ONCHAIN } from "../market/onChainLiteService.js";
import { ReferenceVenueService } from "../market/referenceVenueService.js";
import { PortfolioOptimizer } from "../risk/portfolioOptimizer.js";
import { RiskManager } from "../risk/riskManager.js";
import { ParameterGovernor } from "../ai/parameterGovernor.js";
import { StateStore } from "../storage/stateStore.js";
import { buildPerformanceReport, buildTradeQualityReview } from "./reportBuilder.js";
import { DataRecorder } from "./dataRecorder.js";
import { ModelRegistry } from "./modelRegistry.js";
import { StateBackupManager } from "./stateBackupManager.js";
import { runResearchLab } from "./researchLab.js";
import { ResearchRegistry } from "./researchRegistry.js";
import { UniverseSelector } from "./universeSelector.js";
import { StrategyResearchMiner } from "./strategyResearchMiner.js";
import { resolveDynamicWatchlist } from "./watchlistResolver.js";
import { HealthMonitor } from "./healthMonitor.js";
import { DriftMonitor } from "./driftMonitor.js";
import { PairHealthMonitor } from "./pairHealthMonitor.js";
import { DivergenceMonitor } from "./divergenceMonitor.js";
import { OfflineTrainer } from "./offlineTrainer.js";
import { SelfHealManager } from "./selfHealManager.js";
import { StreamCoordinator } from "./streamCoordinator.js";
import { buildDeepScanPlan, buildLightweightSnapshot } from "./scanPlanner.js";
import { CapitalLadder } from "./capitalLadder.js";
import { buildSessionSummary } from "./sessionManager.js";
import { buildTimeframeConsensus } from "./timeframeConsensus.js";
import { buildExchangeSafetyAudit } from "./exchangeSafetyReconciler.js";
import { buildOperatorAlerts } from "./operatorAlertEngine.js";
import { buildOperatorAlertDispatchPlan, dispatchOperatorAlerts as deliverOperatorAlerts } from "./operatorAlertDispatcher.js";
import { buildStrategyRetirementSnapshot } from "./strategyRetirementEngine.js";
import { buildReplayChaosSummary } from "./replayChaosLab.js";
import { buildCapitalGovernor } from "./capitalGovernor.js";
import { buildCapitalPolicySnapshot } from "./capitalPolicyEngine.js";
import { buildFeatureVector } from "../strategy/features.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { computeMarketFeatures, computeOrderBookFeatures } from "../strategy/indicators.js";
import { buildTrendStateSummary } from "../strategy/trendState.js";
import { buildMarketStateSummary } from "../strategy/marketState.js";
import { buildConfidenceBreakdown, buildDataQualitySummary, buildSignalQualitySummary } from "../strategy/candidateInsights.js";
import { summarizeStrategyDsl } from "../research/strategyDsl.js";
import { minutesBetween, nowIso } from "../utils/time.js";
import { mapWithConcurrency } from "../utils/async.js";
import { average, clamp } from "../utils/math.js";

const EMPTY_NEWS = {
  coverage: 0,
  sentimentScore: 0,
  riskScore: 0,
  confidence: 0,
  headlines: [],
  dominantEventType: "general",
  eventBullishScore: 0,
  eventBearishScore: 0,
  eventRiskScore: 0,
  maxSeverity: 0,
  sourceQualityScore: 0,
  providerCounts: {},
  sourceCounts: {},
  channelCounts: {},
  providerDiversity: 0,
  sourceDiversity: 0,
  freshnessHours: null,
  freshnessScore: 0,
  positiveHeadlineCount: 0,
  negativeHeadlineCount: 0,
  socialCoverage: 0,
  socialSentiment: 0,
  socialRisk: 0,
  socialEngagement: 0,
  reliabilityScore: 0,
  whitelistCoverage: 0,
  bullishDrivers: [],
  bearishDrivers: []
};

const EMPTY_EXCHANGE = {
  coverage: 0,
  sentimentScore: 0,
  riskScore: 0,
  confidence: 0,
  headlines: [],
  dominantEventType: "general",
  eventBullishScore: 0,
  eventBearishScore: 0,
  eventRiskScore: 0,
  maxSeverity: 0,
  sourceQualityScore: 0,
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
  categoryCounts: {},
  latestNoticeAt: null,
  noticeFreshnessHours: null,
  highPriorityCount: 0,
  blockingNotice: null,
  items: []
};

const EMPTY_MARKET_STRUCTURE = {
  fundingRate: 0,
  nextFundingTime: null,
  basisRate: 0,
  basisBps: 0,
  openInterest: 0,
  openInterestUsd: 0,
  openInterestChangePct: 0,
  takerBuySellRatio: 1,
  takerImbalance: 0,
  liquidationCount: 0,
  liquidationNotional: 0,
  liquidationImbalance: 0,
  liquidationIntensity: 0,
  crowdingBias: 0,
  riskScore: 0,
  signalScore: 0,
  confidence: 0,
  reasons: [],
  lastUpdatedAt: null
};

const EMPTY_CALENDAR = {
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


function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, decimals = 4, fallback = 0) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : fallback;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function isSnapshotCacheFresh(snapshot, cacheMinutes = 0, nowMs = Date.now()) {
  const ttlMs = Math.max(0, Number(cacheMinutes || 0)) * 60_000;
  const cachedAtMs = new Date(snapshot?.cachedAt || 0).getTime();
  return ttlMs > 0 && Number.isFinite(cachedAtMs) && nowMs - cachedAtMs <= ttlMs;
}

function buildCachedSnapshotView({ symbol, cachedSnapshot, streamFeatures = {}, localBookSnapshot = null }) {
  if (!cachedSnapshot) {
    return null;
  }

  const fallbackBid = Number(localBookSnapshot?.bestBid || cachedSnapshot.book?.bid || 0);
  const fallbackAsk = Number(localBookSnapshot?.bestAsk || cachedSnapshot.book?.ask || 0);
  const effectiveTicker = streamFeatures.latestBookTicker?.bid && streamFeatures.latestBookTicker?.ask
    ? {
        bidPrice: streamFeatures.latestBookTicker.bid,
        askPrice: streamFeatures.latestBookTicker.ask
      }
    : {
        bidPrice: fallbackBid,
        askPrice: fallbackAsk
      };
  const effectiveOrderBook = localBookSnapshot?.bids?.length && localBookSnapshot?.asks?.length
    ? {
        bids: localBookSnapshot.bids,
        asks: localBookSnapshot.asks
      }
    : cachedSnapshot.book?.localBook?.bids?.length && cachedSnapshot.book?.localBook?.asks?.length
      ? {
          bids: cachedSnapshot.book.localBook.bids,
          asks: cachedSnapshot.book.localBook.asks
        }
      : {
          bids: [],
          asks: []
        };
  const refreshedBook = computeOrderBookFeatures(effectiveTicker, effectiveOrderBook);
  const bid = Number(refreshedBook.bid || fallbackBid || 0);
  const ask = Number(refreshedBook.ask || fallbackAsk || 0);
  const mid = Number(
    refreshedBook.mid ||
    cachedSnapshot.book?.mid ||
    (bid && ask ? (bid + ask) / 2 : bid || ask || 0)
  );

  return {
    ...cachedSnapshot,
    symbol,
    book: {
      ...(cachedSnapshot.book || {}),
      ...refreshedBook,
      bid,
      ask,
      mid,
      spreadBps: Number.isFinite(refreshedBook.spreadBps) ? refreshedBook.spreadBps : Number(cachedSnapshot.book?.spreadBps || 0),
      tradeFlowImbalance: Number(streamFeatures.tradeFlowImbalance ?? cachedSnapshot.book?.tradeFlowImbalance ?? 0),
      microTrend: Number(streamFeatures.microTrend ?? cachedSnapshot.book?.microTrend ?? 0),
      recentTradeCount: Number(streamFeatures.recentTradeCount ?? cachedSnapshot.book?.recentTradeCount ?? 0),
      localBook: localBookSnapshot || cachedSnapshot.book?.localBook || null,
      localBookSynced: Boolean(localBookSnapshot?.synced ?? cachedSnapshot.book?.localBookSynced),
      queueImbalance: Number(localBookSnapshot?.queueImbalance ?? cachedSnapshot.book?.queueImbalance ?? 0),
      queueRefreshScore: Number(localBookSnapshot?.queueRefreshScore ?? cachedSnapshot.book?.queueRefreshScore ?? 0),
      resilienceScore: Number(localBookSnapshot?.resilienceScore ?? cachedSnapshot.book?.resilienceScore ?? 0),
      depthConfidence: Number(localBookSnapshot?.depthConfidence ?? cachedSnapshot.book?.depthConfidence ?? 0),
      depthAgeMs: localBookSnapshot?.depthAgeMs ?? cachedSnapshot.book?.depthAgeMs ?? null,
      totalDepthNotional: Number(localBookSnapshot?.totalDepthNotional ?? cachedSnapshot.book?.totalDepthNotional ?? 0)
    },
    stream: {
      ...(cachedSnapshot.stream || {}),
      ...streamFeatures
    },
    fromCache: true
  };
}

function defaultProfile(symbol) {
  return { symbol, cluster: "other", sector: "other", betaGroup: "other" };
}

function getMomentum20(snapshot) {
  return Number.isFinite(snapshot?.market?.momentum20) ? snapshot.market.momentum20 : 0;
}

function requiresOperatorAck(alert = {}, mode = "paper") {
  if (alert.resolvedAt || alert.acknowledgedAt) {
    return false;
  }
  const severity = `${alert.severity || ""}`.toLowerCase();
  if (!["negative", "critical", "high"].includes(severity)) {
    return false;
  }
  if (mode !== "paper") {
    return true;
  }
  return !["capital_governor_blocked", "capital_governor_recovery", "execution_cost_budget_blocked", "readiness_degraded"].includes(alert.id || "");
}

function buildRelativeStrengthMap(snapshotMap = {}, symbols = [], config = {}) {
  const profiles = Object.fromEntries(symbols.map((symbol) => [symbol, config.symbolProfiles?.[symbol] || defaultProfile(symbol)]));
  const clusterMomenta = new Map();
  const sectorMomenta = new Map();
  for (const symbol of symbols) {
    const momentum20 = getMomentum20(snapshotMap[symbol]);
    const profile = profiles[symbol];
    if (!clusterMomenta.has(profile.cluster)) {
      clusterMomenta.set(profile.cluster, []);
    }
    if (!sectorMomenta.has(profile.sector)) {
      sectorMomenta.set(profile.sector, []);
    }
    clusterMomenta.get(profile.cluster).push(momentum20);
    sectorMomenta.get(profile.sector).push(momentum20);
  }
  const btcMomentum = getMomentum20(snapshotMap.BTCUSDT);
  const ethMomentum = getMomentum20(snapshotMap.ETHUSDT);
  return Object.fromEntries(symbols.map((symbol) => {
    const momentum20 = getMomentum20(snapshotMap[symbol]);
    const profile = profiles[symbol];
    const clusterValues = clusterMomenta.get(profile.cluster) || [momentum20];
    const sectorValues = sectorMomenta.get(profile.sector) || [momentum20];
    return [symbol, {
      relativeStrengthVsBtc: momentum20 - btcMomentum,
      relativeStrengthVsEth: momentum20 - ethMomentum,
      clusterRelativeStrength: momentum20 - average(clusterValues, momentum20),
      sectorRelativeStrength: momentum20 - average(sectorValues, momentum20)
    }];
  }));
}

function summarizeSignal(signal) {
  return {
    name: signal.name,
    contribution: num(signal.contribution, 4),
    rawValue: num(signal.rawValue || 0, 4),
    weight: num(signal.weight || 0, 4)
  };
}

function summarizeHeadline(item) {
  return {
    title: item.title,
    source: item.source,
    provider: item.provider || "unknown",
    channel: item.channel || "news",
    publishedAt: item.publishedAt,
    score: num(item.score || 0, 3),
    riskScore: num(item.riskScore || 0, 3),
    dominantEventType: item.dominantEventType || "general",
    sourceQuality: num(item.sourceQuality || 0, 3),
    severity: num(item.severity || 0, 3),
    freshnessHours: item.freshnessHours == null ? null : num(item.freshnessHours, 1),
    engagementScore: num(item.engagementScore || 0, 2),
    link: item.link
  };
}

function summarizeCandleContext(candles = [], limit = 24) {
  return arr(candles)
    .slice(-limit)
    .map((candle) => ({
      at: candle.closeTime || candle.openTime || null,
      open: num(candle.open || 0, 6),
      high: num(candle.high || 0, 6),
      low: num(candle.low || 0, 6),
      close: num(candle.close || 0, 6),
      volume: num(candle.volume || 0, 4)
    }));
}

function summarizeBreakdown(counts = {}, limit = 4) {
  return Object.entries(counts)
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function summarizeDriver(item) {
  return {
    title: item.title,
    source: item.source,
    provider: item.provider || "unknown",
    channel: item.channel || "news",
    dominantEventType: item.dominantEventType || "general",
    score: num(item.score || 0, 3),
    riskScore: num(item.riskScore || 0, 3),
    freshnessHours: item.freshnessHours == null ? null : num(item.freshnessHours, 1),
    engagementScore: num(item.engagementScore || 0, 2),
    publishedAt: item.publishedAt,
    link: item.link
  };
}

function summarizeSignalDrivers(signals = [], direction = "positive") {
  const filtered = signals.filter((signal) =>
    direction === "positive" ? signal.contribution > 0 : signal.contribution < 0
  );
  return filtered.slice(0, 3).map(summarizeSignal);
}

function summarizeOrderBook(book = {}) {
  return {
    spreadBps: num(book.spreadBps || 0, 2),
    depthImbalance: num(book.depthImbalance || 0, 3),
    weightedDepthImbalance: num(book.weightedDepthImbalance || 0, 3),
    microPriceEdgeBps: num(book.microPriceEdgeBps || 0, 2),
    wallImbalance: num(book.wallImbalance || 0, 3),
    bookPressure: num(book.bookPressure || 0, 3),
    orderbookImbalanceSignal: num(book.orderbookImbalanceSignal || 0, 3),
    queueImbalance: num(book.queueImbalance || book.localBook?.queueImbalance || 0, 3),
    queueRefreshScore: num(book.queueRefreshScore || book.localBook?.queueRefreshScore || 0, 3),
    resilienceScore: num(book.resilienceScore || book.localBook?.resilienceScore || 0, 3),
    depthConfidence: num(book.depthConfidence || book.localBook?.depthConfidence || 0, 3),
    totalDepthNotional: num(book.totalDepthNotional || book.localBook?.totalDepthNotional || 0, 2),
    depthAgeMs: book.depthAgeMs ?? book.localBook?.depthAgeMs ?? null,
    localBookSynced: Boolean(book.localBookSynced ?? book.localBook?.synced)
  };
}

function summarizePatterns(market = {}) {
  return {
    dominantPattern: market.dominantPattern || "none",
    bullishPatternScore: num(market.bullishPatternScore || 0, 3),
    bearishPatternScore: num(market.bearishPatternScore || 0, 3),
    insideBar: market.insideBar || 0,
    liquiditySweepLabel: market.liquiditySweepLabel || "none",
    structureBreakLabel: market.structureBreakLabel || "none"
  };
}

function summarizeIndicators(market = {}) {
  return {
    adx14: num(market.adx14 || 0, 2),
    plusDi14: num(market.plusDi14 || 0, 2),
    minusDi14: num(market.minusDi14 || 0, 2),
    dmiSpread: num(market.dmiSpread || 0, 3),
    trendQualityScore: num(market.trendQualityScore || 0, 3),
    supertrendDirection: market.supertrendDirection || 0,
    supertrendDistancePct: num(market.supertrendDistancePct || 0, 4),
    supertrendFlipScore: num(market.supertrendFlipScore || 0, 3),
    stochRsiK: num(market.stochRsiK || 0, 2),
    stochRsiD: num(market.stochRsiD || 0, 2),
    mfi14: num(market.mfi14 || 0, 2),
    cmf20: num(market.cmf20 || 0, 3),
    relativeStrengthVsBtc: num(market.relativeStrengthVsBtc || 0, 4),
    relativeStrengthVsEth: num(market.relativeStrengthVsEth || 0, 4),
    clusterRelativeStrength: num(market.clusterRelativeStrength || 0, 4),
    sectorRelativeStrength: num(market.sectorRelativeStrength || 0, 4),
    closeLocationQuality: num(market.closeLocationQuality || 0, 3),
    breakoutFollowThroughScore: num(market.breakoutFollowThroughScore || 0, 3),
    volumeAcceptanceScore: num(market.volumeAcceptanceScore || 0, 3),
    keltnerWidthPct: num(market.keltnerWidthPct || 0, 4),
    keltnerSqueezeScore: num(market.keltnerSqueezeScore || 0, 3),
    squeezeReleaseScore: num(market.squeezeReleaseScore || 0, 3)
  };
}

function summarizeUniverseSelection(universe = {}) {
  return {
    generatedAt: universe.generatedAt || null,
    configuredSymbolCount: universe.configuredSymbolCount || 0,
    selectedCount: universe.selectedCount || 0,
    eligibleCount: universe.eligibleCount || 0,
    selectionRate: num(universe.selectionRate || 0, 4),
    averageScore: num(universe.averageScore || 0, 4),
    selectedSymbols: [...(universe.selectedSymbols || [])],
    selected: arr(universe.selected || []).slice(0, 10).map((entry) => ({
      symbol: entry.symbol,
      score: num(entry.score || 0, 4),
      health: entry.health || "cold",
      spreadBps: num(entry.spreadBps || 0, 2),
      depthConfidence: num(entry.depthConfidence || 0, 3),
      totalDepthNotional: num(entry.totalDepthNotional || 0, 2),
      recentTradeCount: entry.recentTradeCount || 0,
      realizedVolPct: num(entry.realizedVolPct || 0, 4),
      reasons: [...(entry.reasons || [])],
      blockers: [...(entry.blockers || [])]
    })),
    skipped: arr(universe.skipped || []).slice(0, 10).map((entry) => ({
      symbol: entry.symbol,
      score: num(entry.score || 0, 4),
      health: entry.health || "cold",
      spreadBps: num(entry.spreadBps || 0, 2),
      depthConfidence: num(entry.depthConfidence || 0, 3),
      totalDepthNotional: num(entry.totalDepthNotional || 0, 2),
      recentTradeCount: entry.recentTradeCount || 0,
      realizedVolPct: num(entry.realizedVolPct || 0, 4),
      reasons: [...(entry.reasons || [])],
      blockers: [...(entry.blockers || [])]
    })),
    suggestions: [...(universe.suggestions || [])]
  };
}

function summarizeAttributionAdjustment(adjustment = {}) {
  return {
    strategyId: adjustment.strategyId || null,
    familyId: adjustment.familyId || null,
    regime: adjustment.regime || null,
    symbol: adjustment.symbol || null,
    rankBoost: num(adjustment.rankBoost || 0, 4),
    sizeBias: num(adjustment.sizeBias || 1, 4),
    confidence: num(adjustment.confidence || 0, 4),
    reasons: [...(adjustment.reasons || [])],
    strategyHealth: adjustment.strategyHealth || "neutral",
    familyHealth: adjustment.familyHealth || "neutral",
    regimeHealth: adjustment.regimeHealth || "neutral",
    symbolHealth: adjustment.symbolHealth || "neutral"
  };
}

function summarizeAttributionSnapshot(snapshot = {}) {
  const mapBucket = (item) => ({
    id: item.id,
    label: item.label,
    tradeCount: item.tradeCount || 0,
    weightedTrades: num(item.weightedTrades || 0, 2),
    winRate: num(item.winRate || 0, 4),
    avgPnlPct: num(item.avgPnlPct || 0, 4),
    avgPnlQuote: num(item.avgPnlQuote || 0, 2),
    confidence: num(item.confidence || 0, 4),
    performanceScore: num(item.performanceScore || 0, 4),
    edge: num(item.edge || 0, 4),
    health: item.health || "neutral"
  });
  return {
    generatedAt: snapshot.generatedAt || null,
    sampleSize: snapshot.sampleSize || 0,
    topStrategies: arr(snapshot.topStrategies || []).slice(0, 6).map(mapBucket),
    topFamilies: arr(snapshot.topFamilies || []).slice(0, 5).map(mapBucket),
    topRegimes: arr(snapshot.topRegimes || []).slice(0, 5).map(mapBucket),
    topSymbols: arr(snapshot.topSymbols || []).slice(0, 5).map(mapBucket),
    suggestions: [...(snapshot.suggestions || [])]
  };
}

function summarizeExitIntelligence(summary = {}) {
  return {
    action: summary.action || "hold",
    reason: summary.reason || null,
    confidence: num(summary.confidence || 0, 4),
    holdScore: num(summary.holdScore || 0, 4),
    trimScore: num(summary.trimScore || 0, 4),
    tightenScore: num(summary.tightenScore || 0, 4),
    exitScore: num(summary.exitScore || 0, 4),
    pnlPct: num(summary.pnlPct || 0, 4),
    drawdownFromHighPct: num(summary.drawdownFromHighPct || 0, 4),
    heldMinutes: num(summary.heldMinutes || 0, 1),
    progressToScaleOut: num(summary.progressToScaleOut || 0, 4),
    suggestedStopLossPrice: num(summary.suggestedStopLossPrice || 0, 6),
    shouldTightenStop: Boolean(summary.shouldTightenStop),
    positiveReasons: [...(summary.positiveReasons || [])],
    riskReasons: [...(summary.riskReasons || [])],
    neural: {
      confidence: num(summary.neural?.confidence || 0, 4),
      dominantAction: summary.neural?.dominantAction || null,
      holdScore: num(summary.neural?.holdScore || 0, 4),
      trimScore: num(summary.neural?.trimScore || 0, 4),
      trailScore: num(summary.neural?.trailScore || 0, 4),
      exitScore: num(summary.neural?.exitScore || 0, 4),
      drivers: arr(summary.neural?.drivers || []).slice(0, 4)
    },
    nextReviewBias: summary.nextReviewBias || "hold"
  };
}

function summarizeResearchRegistry(registry = {}) {
  const mapLeader = (item) => ({
    symbol: item.symbol,
    runs: item.runs || 0,
    experiments: item.experiments || 0,
    totalTrades: item.totalTrades || 0,
    realizedPnl: num(item.realizedPnl || 0, 2),
    averageSharpe: num(item.averageSharpe || 0, 3),
    averageWinRate: num(item.averageWinRate || 0, 4),
    maxDrawdownPct: num(item.maxDrawdownPct || 0, 4),
    governanceScore: num(item.governanceScore || 0, 4),
    status: item.status || "hold",
    leaders: [...(item.leaders || [])],
    lastRunAt: item.lastRunAt || null
  });
  return {
    generatedAt: registry.generatedAt || null,
    runCount: registry.runCount || 0,
    lastRunAt: registry.lastRunAt || null,
    bestSymbol: registry.bestSymbol || null,
    leaderboard: arr(registry.leaderboard || []).slice(0, 8).map(mapLeader),
    recentRuns: arr(registry.recentRuns || []).slice(0, 5).map((item) => ({
      generatedAt: item.generatedAt || null,
      symbolCount: item.symbolCount || 0,
      bestSymbol: item.bestSymbol || null,
      totalTrades: item.totalTrades || 0,
      realizedPnl: num(item.realizedPnl || 0, 2),
      averageSharpe: num(item.averageSharpe || 0, 3)
    })),
    strategyScorecards: arr(registry.strategyScorecards || []).slice(0, 8).map((item) => ({
      id: item.id,
      tradeCount: item.tradeCount || 0,
      realizedPnl: num(item.realizedPnl || 0, 2),
      governanceScore: num(item.governanceScore || 0, 4),
      averageReviewScore: num(item.averageReviewScore || 0, 4),
      averageWinRate: num(item.averageWinRate || 0, 4)
    })),
    governance: {
      promotionCandidates: arr(registry.governance?.promotionCandidates || []).slice(0, 5).map(mapLeader),
      observeList: arr(registry.governance?.observeList || []).slice(0, 5).map(mapLeader),
      blockedCount: registry.governance?.blockedCount || 0,
      stableSnapshotCount: registry.governance?.stableSnapshotCount || 0,
      notes: [...(registry.governance?.notes || [])]
    }
  };
}
function summarizeModelRegistry(registry = {}) {
  return {
    generatedAt: registry.generatedAt || null,
    currentQualityScore: num(registry.currentQualityScore || 0, 4),
    latestSnapshotAt: registry.latestSnapshotAt || null,
    latestReason: registry.latestReason || null,
    latestDeployment: registry.latestDeployment || null,
    registrySize: registry.registrySize || 0,
    rollbackCandidate: registry.rollbackCandidate
      ? {
          at: registry.rollbackCandidate.at || null,
          reason: registry.rollbackCandidate.reason || null,
          tradeCount: registry.rollbackCandidate.tradeCount || 0,
          winRate: num(registry.rollbackCandidate.winRate || 0, 4),
          realizedPnl: num(registry.rollbackCandidate.realizedPnl || 0, 2),
          averageSharpe: num(registry.rollbackCandidate.averageSharpe || 0, 3),
          maxDrawdownPct: num(registry.rollbackCandidate.maxDrawdownPct || 0, 4),
          qualityScore: num(registry.rollbackCandidate.qualityScore || 0, 4),
          rollbackReady: Boolean(registry.rollbackCandidate.rollbackReady)
        }
      : null,
    promotionPolicy: registry.promotionPolicy
      ? {
          allowPromotion: Boolean(registry.promotionPolicy.allowPromotion),
          readyLevel: registry.promotionPolicy.readyLevel || null,
          shadowTradeCount: registry.promotionPolicy.shadowTradeCount || 0,
          challengerEdge: num(registry.promotionPolicy.challengerEdge || 0, 4),
          paperTradeCount: registry.promotionPolicy.paperTradeCount || 0,
          paperWinRate: num(registry.promotionPolicy.paperWinRate || 0, 4),
          paperQualityScore: num(registry.promotionPolicy.paperQualityScore || 0, 4),
          liveTradeCount: registry.promotionPolicy.liveTradeCount || 0,
          liveQualityScore: registry.promotionPolicy.liveQualityScore == null ? null : num(registry.promotionPolicy.liveQualityScore || 0, 4),
          strategyScorecardCount: registry.promotionPolicy.strategyScorecardCount || 0,
          strongStrategyScorecardCount: registry.promotionPolicy.strongStrategyScorecardCount || 0,
          regimeScorecardCount: registry.promotionPolicy.regimeScorecardCount || 0,
          strongRegimeScorecardCount: registry.promotionPolicy.strongRegimeScorecardCount || 0,
          calibrationGovernanceStatus: registry.promotionPolicy.calibrationGovernanceStatus || "warmup",
          exitLearningStatus: registry.promotionPolicy.exitLearningStatus || "warmup",
          featureDecayStatus: registry.promotionPolicy.featureDecayStatus || "warmup",
          thresholdPolicyStatus: registry.promotionPolicy.thresholdPolicyStatus || "stable",
          thresholdRecommendationCount: registry.promotionPolicy.thresholdRecommendationCount || 0,
          readyRegimes: [...(registry.promotionPolicy.readyRegimes || [])],
          observeRegimes: [...(registry.promotionPolicy.observeRegimes || [])],
          regimePolicies: arr(registry.promotionPolicy.regimePolicies || []).slice(0, 6).map((item) => ({
            id: item.id || null,
            governanceScore: num(item.governanceScore || 0, 4),
            tradeCount: item.tradeCount || 0,
            status: item.status || "observe"
          })),
          blockerReasons: [...(registry.promotionPolicy.blockerReasons || [])]
        }
      : null,
    promotionHint: registry.promotionHint
      ? {
          symbol: registry.promotionHint.symbol || null,
          governanceScore: num(registry.promotionHint.governanceScore || 0, 4),
          status: registry.promotionHint.status || null
        }
      : null,
    entries: arr(registry.entries || []).slice(0, 8).map((entry) => ({
      at: entry.at || null,
      reason: entry.reason || null,
      tradeCount: entry.tradeCount || 0,
      winRate: num(entry.winRate || 0, 4),
      realizedPnl: num(entry.realizedPnl || 0, 2),
      averageSharpe: num(entry.averageSharpe || 0, 3),
      maxDrawdownPct: num(entry.maxDrawdownPct || 0, 4),
      calibrationEce: num(entry.calibrationEce || 0, 4),
      deploymentActive: entry.deploymentActive || null,
      source: entry.source || null,
      qualityScore: num(entry.qualityScore || 0, 4),
      rollbackReady: Boolean(entry.rollbackReady)
    })),
    notes: [...(registry.notes || [])]
  };
}
function summarizeStrategy(strategySummary = {}) {
  return {
    activeStrategy: strategySummary.activeStrategy || null,
    strategyLabel: strategySummary.strategyLabel || null,
    family: strategySummary.family || null,
    familyLabel: strategySummary.familyLabel || null,
    setupStyle: strategySummary.setupStyle || null,
    fitScore: num(strategySummary.fitScore || 0, 4),
    rawFitScore: num(strategySummary.rawFitScore || strategySummary.fitScore || 0, 4),
    optimizerBoost: num(strategySummary.optimizerBoost || 0, 4),
    score: num(strategySummary.score || 0, 4),
    confidence: num(strategySummary.confidence || 0, 4),
    agreementGap: num(strategySummary.agreementGap || 0, 4),
    reasons: [...(strategySummary.reasons || [])],
    blockers: [...(strategySummary.blockers || [])],
    familyRankings: arr(strategySummary.familyRankings || []).slice(0, 5).map((family) => ({
      family: family.family,
      familyLabel: family.familyLabel,
      strategyId: family.strategyId,
      strategyLabel: family.strategyLabel,
      fitScore: num(family.fitScore || 0, 4),
      confidence: num(family.confidence || 0, 4)
    })),
    strategies: arr(strategySummary.strategies || []).slice(0, 5).map((strategy) => ({
      id: strategy.id,
      label: strategy.label,
      family: strategy.family || null,
      familyLabel: strategy.familyLabel || null,
      setupStyle: strategy.setupStyle,
      score: num(strategy.score || 0, 4),
      confidence: num(strategy.confidence || 0, 4),
      fitScore: num(strategy.fitScore || 0, 4),
      rawFitScore: num(strategy.rawFitScore || strategy.fitScore || 0, 4),
      optimizerBoost: num(strategy.optimizerBoost || 0, 4),
      historicalTradeCount: strategy.historicalTradeCount || 0,
      historicalWinRate: strategy.historicalWinRate == null ? null : num(strategy.historicalWinRate, 4),
      reasons: [...(strategy.reasons || [])],
      blockers: [...(strategy.blockers || [])]
    }))
  };
}

function summarizeOptimizer(optimizer = {}) {
  const mapScorecard = (item) => ({
    id: item.id,
    label: item.label,
    tradeCount: item.tradeCount || 0,
    weightedTrades: num(item.weightedTrades || 0, 2),
    winRate: num(item.winRate || 0, 4),
    avgPnlPct: num(item.avgPnlPct || 0, 4),
    avgPnlQuote: num(item.avgPnlQuote || 0, 2),
    rewardScore: num(item.rewardScore || 0, 4),
    multiplier: num(item.multiplier || 1, 4),
    confidence: num(item.confidence || 0, 4),
    governanceScore: num(item.governanceScore || 0, 4),
    thompsonScore: num(item.thompsonScore || 0, 4),
    posteriorUncertainty: num(item.posteriorUncertainty || 0, 4),
    sizeBias: num(item.sizeBias || 1, 4),
    status: item.status || "warmup"
  });
  return {
    generatedAt: optimizer.generatedAt || null,
    sampleSize: optimizer.sampleSize || 0,
    sampleConfidence: num(optimizer.sampleConfidence || 0, 4),
    thresholdTilt: num(optimizer.thresholdTilt || 0, 4),
    confidenceTilt: num(optimizer.confidenceTilt || 0, 4),
    suggestions: [...(optimizer.suggestions || [])],
    topStrategies: arr(optimizer.topStrategies || []).slice(0, 5).map(mapScorecard),
    topFamilies: arr(optimizer.topFamilies || []).slice(0, 4).map(mapScorecard),
    topRegimes: arr(optimizer.topRegimes || []).slice(0, 4).map(mapScorecard),
    strategyScorecards: arr(optimizer.strategyScorecards || []).slice(0, 8).map(mapScorecard),
    familyScorecards: arr(optimizer.familyScorecards || []).slice(0, 6).map(mapScorecard),
    regimeScorecards: arr(optimizer.regimeScorecards || []).slice(0, 6).map(mapScorecard),
    strategyThresholdTilts: Object.fromEntries(Object.entries(optimizer.strategyThresholdTilts || {}).slice(0, 8).map(([key, value]) => [key, num(value || 0, 4)])),
    familyThresholdTilts: Object.fromEntries(Object.entries(optimizer.familyThresholdTilts || {}).slice(0, 6).map(([key, value]) => [key, num(value || 0, 4)])),
    regimeThresholdTilts: Object.fromEntries(Object.entries(optimizer.regimeThresholdTilts || {}).slice(0, 6).map(([key, value]) => [key, num(value || 0, 4)])),
    strategyConfidenceTilts: Object.fromEntries(Object.entries(optimizer.strategyConfidenceTilts || {}).slice(0, 8).map(([key, value]) => [key, num(value || 0, 4)])),
    familyConfidenceTilts: Object.fromEntries(Object.entries(optimizer.familyConfidenceTilts || {}).slice(0, 6).map(([key, value]) => [key, num(value || 0, 4)])),
    regimeConfidenceTilts: Object.fromEntries(Object.entries(optimizer.regimeConfidenceTilts || {}).slice(0, 6).map(([key, value]) => [key, num(value || 0, 4)]))
  };
}

function summarizeOptimizerApplied(applied = {}) {
  return {
    sampleSize: applied.sampleSize || 0,
    sampleConfidence: num(applied.sampleConfidence || 0, 4),
    baseThreshold: num(applied.baseThreshold || 0, 4),
    effectiveThreshold: num(applied.effectiveThreshold ?? applied.baseThreshold ?? 0, 4),
    thresholdAdjustment: num(applied.thresholdAdjustment || 0, 4),
    thresholdTuningAdjustment: num(applied.thresholdTuningAdjustment || 0, 4),
    strategyConfidenceFloor: num(applied.strategyConfidenceFloor || 0, 4),
    strategyConfidenceAdjustment: num(applied.strategyConfidenceAdjustment || 0, 4),
    globalThresholdTilt: num(applied.globalThresholdTilt || 0, 4),
    familyThresholdTilt: num(applied.familyThresholdTilt || 0, 4),
    strategyThresholdTilt: num(applied.strategyThresholdTilt || 0, 4),
    globalConfidenceTilt: num(applied.globalConfidenceTilt || 0, 4),
    familyConfidenceTilt: num(applied.familyConfidenceTilt || 0, 4),
    strategyConfidenceTilt: num(applied.strategyConfidenceTilt || 0, 4)
  };
}

function summarizeTransformer(transformer = {}) {
  return {
    probability: num(transformer.probability || 0, 4),
    confidence: num(transformer.confidence || 0, 4),
    dominantHead: transformer.dominantHead || "trend",
    headScores: Object.fromEntries(
      Object.entries(transformer.headScores || {}).map(([name, value]) => [name, num(value || 0, 3)])
    ),
    attention: arr(transformer.attention || []).slice(0, 3).map((item) => ({
      offset: item.offset,
      weight: num(item.weight || 0, 3),
      returnPct: num(item.returnPct || 0, 4),
      closeLocation: num(item.closeLocation || 0, 3)
    })),
    horizons: arr(transformer.horizons || []).map((item) => ({
      horizon: item.horizon,
      probability: num(item.probability || 0, 4),
      signal: num(item.signal || 0, 4)
    })),
    drivers: arr(transformer.drivers || []).slice(0, 4).map((item) => ({
      name: item.name,
      score: num(item.score || 0, 3),
      direction: item.direction || "neutral"
    }))
  };
}

function summarizeSequence(sequence = {}) {
  return {
    probability: num(sequence.probability || 0, 4),
    confidence: num(sequence.confidence || 0, 4),
    drivers: arr(sequence.drivers || []).slice(0, 4).map((item) => ({
      name: item.name,
      contribution: num(item.contribution || item.score || 0, 4),
      rawValue: num(item.rawValue || 0, 4)
    })),
    inputs: { ...(sequence.inputs || {}) }
  };
}

function summarizeExpertMix(summary = {}) {
  return {
    dominantRegime: summary.dominantRegime || null,
    secondaryRegime: summary.secondaryRegime || null,
    confidence: num(summary.confidence || 0, 4),
    weights: Object.fromEntries(Object.entries(summary.weights || {}).map(([name, value]) => [name, num(value || 0, 4)])),
    notes: [...(summary.notes || [])]
  };
}

function summarizeExecutionNeural(summary = {}) {
  return {
    preferMakerBoost: num(summary.preferMakerBoost || 0, 4),
    patienceMultiplier: num(summary.patienceMultiplier || 1, 4),
    sizeMultiplier: num(summary.sizeMultiplier || 1, 4),
    aggressiveness: num(summary.aggressiveness || 1, 4),
    confidence: num(summary.confidence || 0, 4),
    drivers: arr(summary.drivers || []).slice(0, 4).map((item) => ({
      name: item.name,
      contribution: num(item.contribution || 0, 4),
      rawValue: num(item.rawValue || 0, 4)
    })),
    inputs: { ...(summary.inputs || {}) }
  };
}

function summarizeMetaNeural(summary = {}) {
  return {
    action: summary.action || "pass",
    probability: num(summary.probability || 0, 4),
    confidence: num(summary.confidence || 0, 4),
    drivers: arr(summary.contributions || []).slice(0, 4).map((item) => ({
      name: item.name,
      contribution: num(item.contribution || 0, 4),
      rawValue: num(item.rawValue || 0, 4)
    })),
    inputs: { ...(summary.inputs || {}) }
  };
}

function summarizeAgent(agent = {}) {
  return {
    id: agent.id,
    label: agent.label,
    direction: agent.direction || "neutral",
    stance: num(agent.stance || 0, 3),
    confidence: num(agent.confidence || 0, 3),
    veto: agent.veto || null,
    reasons: [...(agent.reasons || [])]
  };
}

function summarizeCommittee(committee = {}) {
  return {
    probability: num(committee.probability || 0, 4),
    confidence: num(committee.confidence || 0, 4),
    agreement: num(committee.agreement || 0, 4),
    netScore: num(committee.netScore || 0, 4),
    sizeMultiplier: num(committee.sizeMultiplier || 1, 3),
    vetoes: arr(committee.vetoes || []).map((item) => ({
      id: item.id,
      agent: item.agent,
      label: item.label
    })),
    bullishAgents: arr(committee.bullishAgents || []).slice(0, 4).map(summarizeAgent),
    bearishAgents: arr(committee.bearishAgents || []).slice(0, 4).map(summarizeAgent),
    agents: arr(committee.agents || []).slice(0, 8).map(summarizeAgent)
  };
}

function summarizeRlPolicy(policy = {}) {
  return {
    action: policy.action || "balanced",
    bucket: policy.bucket || null,
    confidence: num(policy.confidence || 0, 4),
    expectedReward: num(policy.expectedReward || 0, 4),
    sizeMultiplier: num(policy.sizeMultiplier || 1, 3),
    patienceMultiplier: num(policy.patienceMultiplier || 1, 3),
    trailingMultiplier: num(policy.trailingMultiplier || 1, 3),
    preferMakerBoost: num(policy.preferMakerBoost || 0, 3),
    reasons: [...(policy.reasons || [])]
  };
}
function buildSetupStyle(candidate) {
  if (candidate.strategySummary?.setupStyle) {
    return candidate.strategySummary.setupStyle;
  }
  const topSignals = candidate.score.contributions.slice(0, 4).map((item) => item.name);
  if ((candidate.newsSummary.dominantEventType || "general") !== "general" && Math.abs(candidate.newsSummary.sentimentScore || 0) > 0.2) {
    return "news_repricing";
  }
  if (candidate.regimeSummary.regime === "breakout" || topSignals.includes("breakout_pct")) {
    return "breakout_continuation";
  }
  if (candidate.regimeSummary.regime === "trend" || topSignals.includes("momentum_20") || topSignals.includes("ema_gap")) {
    return "trend_following";
  }
  if (candidate.regimeSummary.regime === "range") {
    return "range_rotation";
  }
  if (candidate.regimeSummary.regime === "event_risk") {
    return "event_risk_filter";
  }
  return "hybrid_multi_signal";
}

function summarizeRegime(regimeSummary = {}) {
  return {
    regime: regimeSummary.regime || "range",
    confidence: num(regimeSummary.confidence || 0, 3),
    bias: num(regimeSummary.bias || 0, 3),
    reasons: [...(regimeSummary.reasons || [])]
  };
}

function summarizePortfolio(portfolioSummary = {}) {
  return {
    sameClusterCount: portfolioSummary.sameClusterCount || 0,
    sameSectorCount: portfolioSummary.sameSectorCount || 0,
    sameFamilyCount: portfolioSummary.sameFamilyCount || 0,
    sameRegimeCount: portfolioSummary.sameRegimeCount || 0,
    sameStrategyCount: portfolioSummary.sameStrategyCount || 0,
    maxCorrelation: num(portfolioSummary.maxCorrelation || 0, 3),
    sizeMultiplier: num(portfolioSummary.sizeMultiplier || 1, 3),
    allocatorScore: num(portfolioSummary.allocatorScore || 0, 4),
    strategyBudgetFactor: num(portfolioSummary.strategyBudgetFactor || 1, 4),
    familyBudgetFactor: num(portfolioSummary.familyBudgetFactor || 1, 4),
    regimeBudgetFactor: num(portfolioSummary.regimeBudgetFactor || 1, 4),
    clusterBudgetFactor: num(portfolioSummary.clusterBudgetFactor || 1, 4),
    sectorBudgetFactor: num(portfolioSummary.sectorBudgetFactor || 1, 4),
    factorBudgetFactor: num(portfolioSummary.factorBudgetFactor || 1, 4),
    dailyBudgetFactor: num(portfolioSummary.dailyBudgetFactor || 1, 4),
    clusterHeat: num(portfolioSummary.clusterHeat || 0, 4),
    sectorHeat: num(portfolioSummary.sectorHeat || 0, 4),
    familyHeat: num(portfolioSummary.familyHeat || 0, 4),
    regimeHeat: num(portfolioSummary.regimeHeat || 0, 4),
    strategyHeat: num(portfolioSummary.strategyHeat || 0, 4),
    factorHeat: num(portfolioSummary.factorHeat || 0, 4),
    portfolioHeat: num(portfolioSummary.portfolioHeat || 0, 4),
    portfolioCvarPct: num(portfolioSummary.portfolioCvarPct || 0, 4),
    drawdownPct: num(portfolioSummary.drawdownPct || 0, 4),
    drawdownBudgetUsage: num(portfolioSummary.drawdownBudgetUsage || 0, 4),
    regimeLossStreak: portfolioSummary.regimeLossStreak || 0,
    regimeKillSwitchActive: Boolean(portfolioSummary.regimeKillSwitchActive),
    sameFactorCount: portfolioSummary.sameFactorCount || 0,
    candidateFactors: [...(portfolioSummary.candidateFactors || [])],
    reasons: [...(portfolioSummary.reasons || [])],
    correlations: (portfolioSummary.correlations || []).map((item) => ({
      symbol: item.symbol,
      correlation: num(item.correlation || 0, 3)
    }))
  };
}

function summarizePlan(plan) {
  return plan
    ? {
        entryStyle: plan.entryStyle,
        fallbackStyle: plan.fallbackStyle,
        makerPatienceMs: plan.makerPatienceMs,
        preferMaker: Boolean(plan.preferMaker),
        usePeggedOrder: Boolean(plan.usePeggedOrder),
        pegPriceType: plan.pegPriceType || null,
        pegOffsetType: plan.pegOffsetType || null,
        pegOffsetValue: plan.pegOffsetValue ?? null,
        allowKeepPriority: Boolean(plan.allowKeepPriority),
        queueScore: num(plan.queueScore || 0, 3),
        queueImbalance: num(plan.queueImbalance || 0, 3),
        queueRefreshScore: num(plan.queueRefreshScore || 0, 3),
        resilienceScore: num(plan.resilienceScore || 0, 3),
        depthConfidence: num(plan.depthConfidence || 0, 3),
        expectedImpactBps: num(plan.expectedImpactBps || 0, 2),
        expectedSlippageBps: num(plan.expectedSlippageBps || 0, 2),
        expectedMakerFillPct: num(plan.expectedMakerFillPct || 0, 3),
        tradeFlow: num(plan.tradeFlow || 0, 3),
        trailingDelta: plan.trailingDelta,
        executionNeural: summarizeExecutionNeural(plan.executionNeural || {}),
        strategy: plan.strategy || null,
        strategyFit: num(plan.strategyFit || 0, 3),
        rationale: [...(plan.rationale || [])]
      }
    : null;
}

function summarizeExecutionAttribution(attribution = {}) {
  return {
    brokerMode: attribution.brokerMode || null,
    entryStyle: attribution.entryStyle || null,
    fallbackStyle: attribution.fallbackStyle || null,
    preferMaker: Boolean(attribution.preferMaker),
    requestedQuoteAmount: num(attribution.requestedQuoteAmount || 0, 2),
    executedQuote: num(attribution.executedQuote || 0, 2),
    executedQuantity: num(attribution.executedQuantity || 0, 8),
    completionRatio: num(attribution.completionRatio || 0, 3),
    expectedImpactBps: num(attribution.expectedImpactBps || 0, 2),
    expectedSlippageBps: num(attribution.expectedSlippageBps || 0, 2),
    realizedTouchSlippageBps: num(attribution.realizedTouchSlippageBps || 0, 2),
    realizedMidSlippageBps: num(attribution.realizedMidSlippageBps || 0, 2),
    slippageDeltaBps: num(attribution.slippageDeltaBps || 0, 2),
    latencyBps: num(attribution.latencyBps || 0, 2),
    queueDecayBps: num(attribution.queueDecayBps || 0, 2),
    spreadShockBps: num(attribution.spreadShockBps || 0, 2),
    liquidityShockBps: num(attribution.liquidityShockBps || 0, 2),
    makerFillRatio: num(attribution.makerFillRatio || 0, 3),
    takerFillRatio: num(attribution.takerFillRatio || 0, 3),
    depthConfidence: num(attribution.depthConfidence || 0, 3),
    queueImbalance: num(attribution.queueImbalance || 0, 3),
    queueRefreshScore: num(attribution.queueRefreshScore || 0, 3),
    resilienceScore: num(attribution.resilienceScore || 0, 3),
    tradeFlow: num(attribution.tradeFlow || 0, 3),
    usedSor: Boolean(attribution.usedSor),
    workingFloors: [...(attribution.workingFloors || [])],
    peggedOrder: Boolean(attribution.peggedOrder),
    pegPriceType: attribution.pegPriceType || null,
    pegOffsetType: attribution.pegOffsetType || null,
    pegOffsetValue: attribution.pegOffsetValue ?? null,
    peggedPrice: num(attribution.peggedPrice || 0, 6),
    selfTradePreventionMode: attribution.selfTradePreventionMode || null,
    preventedQuantity: num(attribution.preventedQuantity || 0, 8),
    preventedMatchCount: attribution.preventedMatchCount || 0,
    workingTimeMs: attribution.workingTimeMs || 0,
    amendmentCount: attribution.amendmentCount || 0,
    cancelReplaceCount: attribution.cancelReplaceCount || 0,
    keepPriorityCount: attribution.keepPriorityCount || 0,
    notes: [...(attribution.notes || [])]
  };
}

function summarizeStream(streamFeatures = {}) {
  return {
    tradeFlowImbalance: num(streamFeatures.tradeFlowImbalance || 0, 3),
    microTrend: num(streamFeatures.microTrend || 0, 4),
    recentTradeCount: streamFeatures.recentTradeCount || 0,
    liquidationCount: streamFeatures.liquidationCount || 0,
    liquidationNotional: num(streamFeatures.liquidationNotional || 0, 2),
    liquidationImbalance: num(streamFeatures.liquidationImbalance || 0, 3),
    latestBookTicker: streamFeatures.latestBookTicker || null,
    lastLiquidation: streamFeatures.lastLiquidation || null,
    lastUserEvent: streamFeatures.lastUserEvent || null,
    localBook: summarizeOrderBook(streamFeatures.localBook || {})
  };
}

function summarizeExchange(exchangeSummary = {}) {
  return {
    coverage: exchangeSummary.coverage || 0,
    riskScore: num(exchangeSummary.riskScore || 0, 3),
    sentimentScore: num(exchangeSummary.sentimentScore || 0, 3),
    latestNoticeAt: exchangeSummary.latestNoticeAt || null,
    noticeFreshnessHours: exchangeSummary.noticeFreshnessHours == null ? null : num(exchangeSummary.noticeFreshnessHours, 1),
    highPriorityCount: exchangeSummary.highPriorityCount || 0,
    categoryCounts: summarizeBreakdown(exchangeSummary.categoryCounts || {}),
    blockingNotice: exchangeSummary.blockingNotice || null
  };
}

function summarizeMarketStructureSummary(summary = {}) {
  return {
    fundingRate: num(summary.fundingRate || 0, 6),
    nextFundingTime: summary.nextFundingTime || null,
    basisBps: num(summary.basisBps || 0, 2),
    openInterestUsd: num(summary.openInterestUsd || 0, 2),
    openInterestChangePct: num(summary.openInterestChangePct || 0, 4),
    takerImbalance: num(summary.takerImbalance || 0, 3),
    globalLongShortRatio: num(summary.globalLongShortRatio || 1, 3, 1),
    globalLongShortImbalance: num(summary.globalLongShortImbalance || 0, 3),
    topTraderLongShortRatio: num(summary.topTraderLongShortRatio || 1, 3, 1),
    topTraderImbalance: num(summary.topTraderImbalance || 0, 3),
    leverageBuildupScore: num(summary.leverageBuildupScore || 0, 3),
    shortSqueezeScore: num(summary.shortSqueezeScore || 0, 3),
    longSqueezeScore: num(summary.longSqueezeScore || 0, 3),
    liquidationCount: summary.liquidationCount || 0,
    liquidationNotional: num(summary.liquidationNotional || 0, 2),
    liquidationImbalance: num(summary.liquidationImbalance || 0, 3),
    riskScore: num(summary.riskScore || 0, 3),
    signalScore: num(summary.signalScore || 0, 3),
    reasons: [...(summary.reasons || [])]
  };
}

function summarizeMarketSentiment(summary = {}) {
  return {
    coverage: summary.coverage || 0,
    fearGreedValue: summary.fearGreedValue == null ? null : num(summary.fearGreedValue, 2),
    fearGreedClassification: summary.fearGreedClassification || null,
    fearGreedPrevious: summary.fearGreedPrevious == null ? null : num(summary.fearGreedPrevious, 2),
    fearGreedDelta: summary.fearGreedDelta == null ? null : num(summary.fearGreedDelta, 2),
    contrarianScore: num(summary.contrarianScore || 0, 3),
    riskScore: num(summary.riskScore || 0, 3),
    btcDominancePct: summary.btcDominancePct == null ? null : num(summary.btcDominancePct, 2),
    altDominancePct: summary.altDominancePct == null ? null : num(summary.altDominancePct, 2),
    totalMarketCapUsd: summary.totalMarketCapUsd == null ? null : num(summary.totalMarketCapUsd, 2),
    totalVolume24hUsd: summary.totalVolume24hUsd == null ? null : num(summary.totalVolume24hUsd, 2),
    marketCapChangePct24h: summary.marketCapChangePct24h == null ? null : num(summary.marketCapChangePct24h, 2),
    confidence: num(summary.confidence || 0, 3),
    reasons: [...(summary.reasons || [])],
    lastUpdatedAt: summary.lastUpdatedAt || null
  };
}

function summarizeVolatility(summary = {}) {
  return {
    coverage: summary.coverage || 0,
    btcOptionIv: summary.btcOptionIv == null ? null : num(summary.btcOptionIv, 2),
    ethOptionIv: summary.ethOptionIv == null ? null : num(summary.ethOptionIv, 2),
    btcHistoricalVol: summary.btcHistoricalVol == null ? null : num(summary.btcHistoricalVol, 2),
    ethHistoricalVol: summary.ethHistoricalVol == null ? null : num(summary.ethHistoricalVol, 2),
    marketOptionIv: summary.marketOptionIv == null ? null : num(summary.marketOptionIv, 2),
    marketHistoricalVol: summary.marketHistoricalVol == null ? null : num(summary.marketHistoricalVol, 2),
    ivPremium: num(summary.ivPremium || 0, 2),
    riskScore: num(summary.riskScore || 0, 3),
    regime: summary.regime || "unknown",
    confidence: num(summary.confidence || 0, 3),
    reasons: [...(summary.reasons || [])],
    lastUpdatedAt: summary.lastUpdatedAt || null
  };
}

function summarizeCalendarSummary(summary = {}) {
  return {
    coverage: summary.coverage || 0,
    riskScore: num(summary.riskScore || 0, 3),
    bullishScore: num(summary.bullishScore || 0, 3),
    bearishScore: num(summary.bearishScore || 0, 3),
    urgencyScore: num(summary.urgencyScore || 0, 3),
    nextEventAt: summary.nextEventAt || null,
    nextEventTitle: summary.nextEventTitle || null,
    nextEventType: summary.nextEventType || null,
    proximityHours: summary.proximityHours == null ? null : num(summary.proximityHours, 1),
    blockerReasons: [...(summary.blockerReasons || [])],
    items: arr(summary.items || []).slice(0, 4)
  };
}

function summarizeSession(summary = {}) {
  return {
    session: summary.session || "unknown",
    sessionLabel: summary.sessionLabel || summary.session || "Unknown",
    utcHour: summary.utcHour == null ? null : num(summary.utcHour, 2),
    dayOfWeek: summary.dayOfWeek ?? null,
    dayLabel: summary.dayLabel || null,
    isWeekend: Boolean(summary.isWeekend),
    lowLiquidity: Boolean(summary.lowLiquidity),
    lowLiquidityScore: num(summary.lowLiquidityScore || 0, 3),
    riskScore: num(summary.riskScore || 0, 3),
    minutesToFunding: summary.minutesToFunding == null ? null : num(summary.minutesToFunding, 1),
    hoursToFunding: summary.hoursToFunding == null ? null : num(summary.hoursToFunding, 2),
    inFundingCaution: Boolean(summary.inFundingCaution),
    inHardFundingBlock: Boolean(summary.inHardFundingBlock),
    thresholdPenalty: num(summary.thresholdPenalty || 0, 4),
    sizeMultiplier: num(summary.sizeMultiplier ?? 1, 4),
    reasons: [...(summary.reasons || [])],
    blockerReasons: [...(summary.blockerReasons || [])]
  };
}

function summarizeDrift(summary = {}) {
  return {
    status: summary.status || "normal",
    severity: num(summary.severity || 0, 3),
    featureDriftScore: num(summary.featureDriftScore || 0, 3),
    sourceDriftScore: num(summary.sourceDriftScore || 0, 3),
    confidenceDriftScore: num(summary.confidenceDriftScore || 0, 3),
    calibrationScore: num(summary.calibrationScore || 0, 3),
    executionScore: num(summary.executionScore || 0, 3),
    dataScore: num(summary.dataScore || 0, 3),
    performanceScore: num(summary.performanceScore || 0, 3),
    averageCandidateConfidence: num(summary.averageCandidateConfidence || 0, 3),
    comparableFeatures: summary.comparableFeatures || 0,
    averageAbsZ: num(summary.averageAbsZ || 0, 3),
    maxAbsZ: num(summary.maxAbsZ || 0, 3),
    driftedFeatures: arr(summary.driftedFeatures || []).slice(0, 5).map((item) => ({
      name: item.name,
      zScore: num(item.zScore || 0, 3),
      rawValue: num(item.rawValue || 0, 3),
      mean: num(item.mean || 0, 3),
      count: item.count || 0
    })),
    reasons: [...(summary.reasons || [])],
    blockerReasons: [...(summary.blockerReasons || [])]
  };
}

function summarizeSelfHeal(summary = {}) {
  return {
    mode: summary.mode || "normal",
    active: Boolean(summary.active),
    reason: summary.reason || null,
    issues: [...(summary.issues || [])],
    actions: [...(summary.actions || [])],
    managerAction: summary.managerAction || null,
    sizeMultiplier: num(summary.sizeMultiplier ?? 1, 3),
    thresholdPenalty: num(summary.thresholdPenalty || 0, 3),
    lowRiskOnly: Boolean(summary.lowRiskOnly),
    learningAllowed: Boolean(summary.learningAllowed),
    cooldownUntil: summary.cooldownUntil || null,
    lastTriggeredAt: summary.lastTriggeredAt || null,
    lastRecoveryAt: summary.lastRecoveryAt || null,
    restoreSnapshotAt: summary.restoreSnapshotAt || null
  };
}

function summarizeModelBackup(snapshot = {}) {
  return {
    at: snapshot.at || null,
    reason: snapshot.reason || null,
    tradeCount: snapshot.tradeCount || 0,
    winRate: num(snapshot.winRate || 0, 4),
    realizedPnl: num(snapshot.realizedPnl || 0, 2),
    calibrationEce: num(snapshot.calibrationEce || 0, 4),
    deploymentActive: snapshot.deploymentActive || null
  };
}

function summarizeMeta(summary = {}) {
  return {
    action: summary.action || "pass",
    score: num(summary.score || 0, 4),
    confidence: num(summary.confidence || 0, 4),
    qualityScore: num(summary.qualityScore || 0, 4),
    qualityBand: summary.qualityBand || "unknown",
    qualityReasons: [...(summary.qualityReasons || [])],
    thresholdPenalty: num(summary.thresholdPenalty || 0, 4),
    sizeMultiplier: num(summary.sizeMultiplier ?? 1, 4),
    dailyBudgetFactor: num(summary.dailyBudgetFactor ?? 1, 4),
    dailyLossFraction: num(summary.dailyLossFraction || 0, 4),
    dailyTradeCount: summary.dailyTradeCount || 0,
    canaryActive: Boolean(summary.canaryActive),
    canaryTradesRemaining: summary.canaryTradesRemaining || 0,
    canarySizeMultiplier: num(summary.canarySizeMultiplier ?? 1, 4),
    historyConfidence: num(summary.historyConfidence || 0, 4),
    neuralProbability: num(summary.neuralProbability || 0, 4),
    neuralConfidence: num(summary.neuralConfidence || 0, 4),
    neuralDrivers: arr(summary.neuralDrivers || []).slice(0, 4),
    reasons: [...(summary.reasons || [])],
    notes: [...(summary.notes || [])]
  };
}
function summarizeTimeframeConsensus(summary = {}) {
  return {
    enabled: Boolean(summary.enabled),
    lowerInterval: summary.lowerInterval || null,
    higherInterval: summary.higherInterval || null,
    lowerBias: num(summary.lowerBias || 0, 4),
    higherBias: num(summary.higherBias || 0, 4),
    alignmentScore: num(summary.alignmentScore || 0, 4),
    directionAgreement: summary.directionAgreement ?? 0.5,
    volatilityGapPct: num(summary.volatilityGapPct || 0, 4),
    reasons: [...(summary.reasons || [])],
    blockerReasons: [...(summary.blockerReasons || [])],
    summary: summary.summary || null
  };
}

function summarizePairHealth(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    trackedSymbols: summary.trackedSymbols || 0,
    averageScore: num(summary.averageScore || 0, 4),
    quarantinedCount: summary.quarantinedCount || 0,
    quarantinedSymbols: [...(summary.quarantinedSymbols || [])],
    suggestions: [...(summary.suggestions || [])],
    leadSymbol: summary.leadSymbol || null,
    leadScore: summary.leadScore == null ? null : num(summary.leadScore, 4)
  };
}

function summarizeDivergenceSummary(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    strategyCount: summary.strategyCount || 0,
    comparableStrategyCount: summary.comparableStrategyCount || 0,
    averageScore: num(summary.averageScore || 0, 4),
    blockerCount: summary.blockerCount || 0,
    watchCount: summary.watchCount || 0,
    leadBlocker: summary.leadBlocker ? {
      id: summary.leadBlocker.id || null,
      divergenceScore: num(summary.leadBlocker.divergenceScore || 0, 4),
      status: summary.leadBlocker.status || null
    } : null,
    strategies: arr(summary.strategies || []).slice(0, 8).map((item) => ({
      id: item.id || null,
      divergenceScore: num(item.divergenceScore || 0, 4),
      status: item.status || null,
      paperTradeCount: item.paper?.tradeCount || 0,
      liveTradeCount: item.live?.tradeCount || 0,
      pnlGap: num(item.gaps?.pnlPct || 0, 4),
      slipGapBps: num(item.gaps?.slipBps || 0, 2),
      winRateGap: num(item.gaps?.winRate || 0, 4)
    })),
    notes: [...(summary.notes || [])]
  };
}

function summarizeOnChainLite(summary = {}) {
  return {
    coverage: summary.coverage || 0,
    stablecoinMarketCapUsd: num(summary.stablecoinMarketCapUsd || 0, 2),
    stablecoinVolumeUsd: num(summary.stablecoinVolumeUsd || 0, 2),
    stablecoinChangePct24h: num(summary.stablecoinChangePct24h || 0, 2),
    stablecoinDominancePct: num(summary.stablecoinDominancePct || 0, 2),
    stablecoinConcentrationPct: num(summary.stablecoinConcentrationPct || 0, 2),
    liquidityScore: num(summary.liquidityScore || 0, 4),
    riskOffScore: num(summary.riskOffScore || 0, 4),
    stressScore: num(summary.stressScore || 0, 4),
    marketBreadthScore: num(summary.marketBreadthScore || 0, 4),
    majorsPositiveRatio: num(summary.majorsPositiveRatio || 0, 4),
    majorsMomentumScore: num(summary.majorsMomentumScore || 0, 4),
    altLiquidityScore: num(summary.altLiquidityScore || 0, 4),
    trendingScore: num(summary.trendingScore || 0, 4),
    trendingSymbols: [...(summary.trendingSymbols || [])],
    proxyConfidence: num(summary.proxyConfidence || 0, 4),
    reasons: [...(summary.reasons || [])],
    lastUpdatedAt: summary.lastUpdatedAt || null
  };
}

function summarizeSourceReliability(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    providerCount: summary.providerCount || 0,
    averageScore: num(summary.averageScore || 0, 4),
    degradedCount: summary.degradedCount || 0,
    coolingDownCount: summary.coolingDownCount || 0,
    providers: arr(summary.providers || []).slice(0, 8).map((item) => ({
      provider: item.provider || null,
      score: num(item.score || 0, 4),
      coolingDown: Boolean(item.coolingDown),
      recentFailures: item.recentFailures || 0,
      lastError: item.lastError || null
    })),
    notes: [...(summary.notes || [])]
  };
}

function summarizeQualityQuorum(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    candidateCount: summary.candidateCount || 0,
    readyCount: summary.readyCount || 0,
    degradedCount: summary.degradedCount || 0,
    observeOnlyCount: summary.observeOnlyCount || 0,
    averageScore: num(summary.averageScore || 0, 4),
    status: summary.status || "ready",
    leadSymbol: summary.leadSymbol || null,
    leadStatus: summary.leadStatus || null,
    quorumScore: num(summary.quorumScore || summary.averageScore || 0, 4),
    observeOnly: Boolean(summary.observeOnly),
    blockerReasons: [...(summary.blockerReasons || [])],
    cautionReasons: [...(summary.cautionReasons || [])],
    checks: arr(summary.checks || []).slice(0, 8).map((item) => ({
      id: item.id || null,
      label: item.label || item.id || null,
      passed: Boolean(item.passed),
      critical: Boolean(item.critical),
      detail: item.detail || null
    })),
    notes: [...(summary.notes || [])]
  };
}

function summarizeOfflineTrainer(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    learningReadyTrades: summary.learningReadyTrades || 0,
    paperTrades: summary.paperTrades || 0,
    liveTrades: summary.liveTrades || 0,
    learningFrames: summary.learningFrames || 0,
    decisionFrames: summary.decisionFrames || 0,
    readinessScore: num(summary.readinessScore || 0, 4),
    status: summary.status || "warmup",
    counterfactuals: {
      total: summary.counterfactuals?.total || 0,
      missedWinners: summary.counterfactuals?.missedWinners || 0,
      blockedCorrectly: summary.counterfactuals?.blockedCorrectly || 0,
      falseNegatives: summary.counterfactuals?.falseNegatives || 0,
      averageMissedMovePct: num(summary.counterfactuals?.averageMissedMovePct || 0, 4)
    },
    vetoFeedback: {
      total: summary.vetoFeedback?.total || 0,
      blockerCount: summary.vetoFeedback?.blockerCount || 0,
      goodVetoCount: summary.vetoFeedback?.goodVetoCount || 0,
      badVetoCount: summary.vetoFeedback?.badVetoCount || 0,
      topBlocker: summary.vetoFeedback?.topBlocker || null
    },
    falsePositiveTrades: summary.falsePositiveTrades || 0,
    falseNegativeTrades: summary.falseNegativeTrades || 0,
    strategies: arr(summary.strategies || []).slice(0, 6),
    regimes: arr(summary.regimes || []).slice(0, 5),
    strategyScorecards: arr(summary.strategyScorecards || []).slice(0, 8).map((item) => ({
      id: item.id,
      tradeCount: item.tradeCount || 0,
      paperTradeCount: item.paperTradeCount || 0,
      liveTradeCount: item.liveTradeCount || 0,
      winRate: num(item.winRate || 0, 4),
      realizedPnl: num(item.realizedPnl || 0, 2),
      avgExecutionQuality: num(item.avgExecutionQuality || 0, 4),
      avgLabelScore: num(item.avgLabelScore || 0, 4),
      avgMovePct: num(item.avgMovePct || 0, 4),
      falsePositiveCount: item.falsePositiveCount || 0,
      falseNegativeCount: item.falseNegativeCount || 0,
      falsePositiveRate: num(item.falsePositiveRate || 0, 4),
      falseNegativeRate: num(item.falseNegativeRate || 0, 4),
      governanceScore: num(item.governanceScore || 0, 4),
      dominantError: item.dominantError || "balanced",
      status: item.status || "warmup"
    })),
    regimeScorecards: arr(summary.regimeScorecards || []).slice(0, 6).map((item) => ({
      id: item.id,
      tradeCount: item.tradeCount || 0,
      paperTradeCount: item.paperTradeCount || 0,
      liveTradeCount: item.liveTradeCount || 0,
      winRate: num(item.winRate || 0, 4),
      realizedPnl: num(item.realizedPnl || 0, 2),
      avgExecutionQuality: num(item.avgExecutionQuality || 0, 4),
      avgLabelScore: num(item.avgLabelScore || 0, 4),
      avgMovePct: num(item.avgMovePct || 0, 4),
      falsePositiveCount: item.falsePositiveCount || 0,
      falseNegativeCount: item.falseNegativeCount || 0,
      governanceScore: num(item.governanceScore || 0, 4),
      status: item.status || "warmup"
    })),
    blockerScorecards: arr(summary.blockerScorecards || []).slice(0, 6).map((item) => ({
      id: item.id,
      total: item.total || 0,
      goodVetoCount: item.goodVetoCount || 0,
      badVetoCount: item.badVetoCount || 0,
      goodVetoRate: num(item.goodVetoRate || 0, 4),
      badVetoRate: num(item.badVetoRate || 0, 4),
      averageMovePct: num(item.averageMovePct || 0, 4),
      governanceScore: num(item.governanceScore || 0, 4),
      affectedStrategies: [...(item.affectedStrategies || [])],
      affectedRegimes: [...(item.affectedRegimes || [])],
      status: item.status || "observe"
    })),
    thresholdPolicy: {
      status: summary.thresholdPolicy?.status || "stable",
      relaxCount: summary.thresholdPolicy?.relaxCount || 0,
      tightenCount: summary.thresholdPolicy?.tightenCount || 0,
      netThresholdShift: num(summary.thresholdPolicy?.netThresholdShift || 0, 4),
      topRecommendation: summary.thresholdPolicy?.topRecommendation
        ? {
            id: summary.thresholdPolicy.topRecommendation.id || null,
            action: summary.thresholdPolicy.topRecommendation.action || "observe",
            adjustment: num(summary.thresholdPolicy.topRecommendation.adjustment || 0, 4),
            confidence: num(summary.thresholdPolicy.topRecommendation.confidence || 0, 4),
            total: summary.thresholdPolicy.topRecommendation.total || 0,
            affectedStrategies: [...(summary.thresholdPolicy.topRecommendation.affectedStrategies || [])],
            affectedRegimes: [...(summary.thresholdPolicy.topRecommendation.affectedRegimes || [])],
            rationale: summary.thresholdPolicy.topRecommendation.rationale || null
          }
        : null,
      recommendations: arr(summary.thresholdPolicy?.recommendations || []).slice(0, 6).map((item) => ({
        id: item.id || null,
        action: item.action || "observe",
        adjustment: num(item.adjustment || 0, 4),
        confidence: num(item.confidence || 0, 4),
        total: item.total || 0,
        affectedStrategies: [...(item.affectedStrategies || [])],
        affectedRegimes: [...(item.affectedRegimes || [])],
        rationale: item.rationale || null
      })),
      notes: [...(summary.thresholdPolicy?.notes || [])]
    },
    exitLearning: {
      status: summary.exitLearning?.status || "warmup",
      averageExitScore: num(summary.exitLearning?.averageExitScore || 0, 4),
      prematureExitCount: summary.exitLearning?.prematureExitCount || 0,
      lateExitCount: summary.exitLearning?.lateExitCount || 0,
      topReason: summary.exitLearning?.topReason || null,
      strategyPolicies: arr(summary.exitLearning?.strategyPolicies || []).slice(0, 6).map((item) => ({
        id: item.id || null,
        tradeCount: item.tradeCount || 0,
        status: item.status || "balanced",
        scaleOutFractionMultiplier: num(item.scaleOutFractionMultiplier || 1, 4),
        scaleOutTriggerMultiplier: num(item.scaleOutTriggerMultiplier || 1, 4),
        trailingStopMultiplier: num(item.trailingStopMultiplier || 1, 4),
        maxHoldMinutesMultiplier: num(item.maxHoldMinutesMultiplier || 1, 4)
      })),
      regimePolicies: arr(summary.exitLearning?.regimePolicies || []).slice(0, 6).map((item) => ({
        id: item.id || null,
        tradeCount: item.tradeCount || 0,
        status: item.status || "balanced",
        scaleOutFractionMultiplier: num(item.scaleOutFractionMultiplier || 1, 4),
        scaleOutTriggerMultiplier: num(item.scaleOutTriggerMultiplier || 1, 4),
        trailingStopMultiplier: num(item.trailingStopMultiplier || 1, 4),
        maxHoldMinutesMultiplier: num(item.maxHoldMinutesMultiplier || 1, 4)
      })),
      notes: [...(summary.exitLearning?.notes || [])]
    },
    exitScorecards: arr(summary.exitScorecards || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      tradeCount: item.tradeCount || 0,
      averageExitScore: num(item.averageExitScore || 0, 4),
      averageCapture: num(item.averageCapture || 0, 4),
      realizedPnl: num(item.realizedPnl || 0, 2),
      prematureExitCount: item.prematureExitCount || 0,
      lateExitCount: item.lateExitCount || 0,
      governanceScore: num(item.governanceScore || 0, 4),
      status: item.status || "observe"
    })),
    featureDecay: {
      status: summary.featureDecay?.status || "warmup",
      trackedFeatureCount: summary.featureDecay?.trackedFeatureCount || 0,
      weakFeatureCount: summary.featureDecay?.weakFeatureCount || 0,
      degradedFeatureCount: summary.featureDecay?.degradedFeatureCount || 0,
      strongestFeature: summary.featureDecay?.strongestFeature || null,
      weakestFeature: summary.featureDecay?.weakestFeature || null,
      averagePredictiveScore: num(summary.featureDecay?.averagePredictiveScore || 0, 4),
      notes: [...(summary.featureDecay?.notes || [])]
    },
    retrainReadiness: summary.retrainReadiness ? {
      status: summary.retrainReadiness.status || "warmup",
      score: num(summary.retrainReadiness.score || 0, 4),
      datasetHealth: num(summary.retrainReadiness.datasetHealth || 0, 4),
      providerCoverage: summary.retrainReadiness.providerCoverage || 0,
      contextCoverage: summary.retrainReadiness.contextCoverage || 0,
      bootstrapStatus: summary.retrainReadiness.bootstrapStatus || "empty",
      priority: summary.retrainReadiness.priority || null,
      note: summary.retrainReadiness.note || null,
      paper: summary.retrainReadiness.paper ? {
        status: summary.retrainReadiness.paper.status || "warmup",
        score: num(summary.retrainReadiness.paper.score || 0, 4),
        tradeCount: summary.retrainReadiness.paper.tradeCount || 0,
        strategyCount: summary.retrainReadiness.paper.strategyCount || 0,
        regimeCount: summary.retrainReadiness.paper.regimeCount || 0,
        winRate: num(summary.retrainReadiness.paper.winRate || 0, 4),
        avgExecutionQuality: num(summary.retrainReadiness.paper.avgExecutionQuality || 0, 4),
        recommendation: summary.retrainReadiness.paper.recommendation || null
      } : null,
      live: summary.retrainReadiness.live ? {
        status: summary.retrainReadiness.live.status || "warmup",
        score: num(summary.retrainReadiness.live.score || 0, 4),
        tradeCount: summary.retrainReadiness.live.tradeCount || 0,
        strategyCount: summary.retrainReadiness.live.strategyCount || 0,
        regimeCount: summary.retrainReadiness.live.regimeCount || 0,
        winRate: num(summary.retrainReadiness.live.winRate || 0, 4),
        avgExecutionQuality: num(summary.retrainReadiness.live.avgExecutionQuality || 0, 4),
        recommendation: summary.retrainReadiness.live.recommendation || null
      } : null
    } : null,
    scopeRetrainReadiness: arr(summary.scopeRetrainReadiness || []).slice(0, 8).map((item) => ({
      id: item.id || null,
      type: item.type || null,
      totalCount: item.totalCount || 0,
      paperCount: item.paperCount || 0,
      liveCount: item.liveCount || 0,
      winRate: num(item.winRate || 0, 4),
      avgExecutionQuality: num(item.avgExecutionQuality || 0, 4),
      avgPnlPct: num(item.avgPnlPct || 0, 4),
      score: num(item.score || 0, 4),
      status: item.status || "warmup"
    })),
    featureDecayScorecards: arr(summary.featureDecayScorecards || []).slice(0, 8).map((item) => ({
      id: item.id || null,
      count: item.count || 0,
      predictiveScore: num(item.predictiveScore || 0, 4),
      meanShift: num(item.meanShift || 0, 4),
      direction: item.direction || "pro",
      status: item.status || "watch"
    })),
    calibrationGovernance: {
      falsePositiveRate: num(summary.calibrationGovernance?.falsePositiveRate || 0, 4),
      falseNegativeRate: num(summary.calibrationGovernance?.falseNegativeRate || 0, 4),
      governanceScore: num(summary.calibrationGovernance?.governanceScore || 0, 4),
      status: summary.calibrationGovernance?.status || "warmup",
      note: summary.calibrationGovernance?.note || null
    },
    regimeDeployment: {
      status: summary.regimeDeployment?.status || "warmup",
      readyRegimes: [...(summary.regimeDeployment?.readyRegimes || [])],
      observeRegimes: [...(summary.regimeDeployment?.observeRegimes || [])],
      cooldownRegimes: [...(summary.regimeDeployment?.cooldownRegimes || [])],
      note: summary.regimeDeployment?.note || null
    },
    falsePositiveByStrategy: arr(summary.falsePositiveByStrategy || []).slice(0, 5),
    falseNegativeByStrategy: arr(summary.falseNegativeByStrategy || []).slice(0, 5),
    notes: [...(summary.notes || [])]
  };
}

function summarizeThresholdTuningState(summary = {}) {
  return {
    status: summary.status || "stable",
    relaxCount: summary.relaxCount || 0,
    tightenCount: summary.tightenCount || 0,
    netThresholdShift: num(summary.netThresholdShift || 0, 4),
    activeThresholdShift: num(summary.activeThresholdShift || 0, 4),
    appliedRecommendation: summary.appliedRecommendation
      ? {
          id: summary.appliedRecommendation.id || null,
          action: summary.appliedRecommendation.action || "observe",
          adjustment: num(summary.appliedRecommendation.adjustment || 0, 4),
          confidence: num(summary.appliedRecommendation.confidence || 0, 4),
          status: summary.appliedRecommendation.status || "probation",
          appliedAt: summary.appliedRecommendation.appliedAt || null,
          reviewedAt: summary.appliedRecommendation.reviewedAt || null,
          affectedStrategies: [...(summary.appliedRecommendation.affectedStrategies || [])],
          affectedRegimes: [...(summary.appliedRecommendation.affectedRegimes || [])]
        }
      : null,
    recommendations: arr(summary.recommendations || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      action: item.action || "observe",
      adjustment: num(item.adjustment || 0, 4),
      confidence: num(item.confidence || 0, 4),
      total: item.total || 0
    })),
    history: arr(summary.history || []).slice(0, 8).map((item) => ({
      id: item.id || null,
      status: item.status || null,
      adjustment: num(item.adjustment || 0, 4),
      reviewedAt: item.reviewedAt || item.appliedAt || null,
      tradeCount: item.review?.tradeCount || item.baseline?.tradeCount || 0
    })),
    notes: [...(summary.notes || [])]
  };
}

function summarizeExchangeTruth(summary = {}) {
  return {
    status: summary.status || "unknown",
    freezeEntries: Boolean(summary.freezeEntries),
    mismatchCount: summary.mismatchCount || 0,
    runtimePositionCount: summary.runtimePositionCount || 0,
    exchangePositionCount: summary.exchangePositionCount || 0,
    openOrderCount: summary.openOrderCount || 0,
    openOrderListCount: summary.openOrderListCount || 0,
    lastReconciledAt: summary.lastReconciledAt || null,
    lastHealthyAt: summary.lastHealthyAt || null,
    orphanedSymbols: [...(summary.orphanedSymbols || [])],
    missingRuntimeSymbols: [...(summary.missingRuntimeSymbols || [])],
    unmatchedOrderSymbols: [...(summary.unmatchedOrderSymbols || [])],
    staleProtectiveSymbols: [...(summary.staleProtectiveSymbols || [])],
    recentFillSymbols: [...(summary.recentFillSymbols || [])],
    warnings: arr(summary.warnings || []).slice(0, 8).map((item) => ({
      symbol: item.symbol || null,
      issue: item.issue || null,
      error: item.error || null,
      quantity: item.quantity == null ? null : num(item.quantity || 0, 8)
    })),
    notes: [...(summary.notes || [])]
  };
}

function toBoolean(value, fallback = false) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }
  if (value == null) {
    return fallback;
  }
  return Boolean(value);
}

function summarizeExchangeCapabilities(summary = {}) {
  return {
    region: summary.region || "GLOBAL",
    venue: summary.venue || "binance",
    spotEnabled: toBoolean(summary.spotEnabled, true),
    marginEnabled: toBoolean(summary.marginEnabled),
    futuresEnabled: toBoolean(summary.futuresEnabled),
    shortingEnabled: toBoolean(summary.shortingEnabled),
    leveragedTokensEnabled: toBoolean(summary.leveragedTokensEnabled),
    spotBearMarketMode: summary.spotBearMarketMode || "defensive_rebounds",
    notes: [...(summary.notes || [])]
  };
}

function summarizeOrderLifecycle(summary = {}) {
  const positions = Object.values(summary.positions || {}).map((item) => ({
    id: item.id || null,
    symbol: item.symbol || null,
    state: item.state || "unknown",
    brokerMode: item.brokerMode || "paper",
    entryAt: item.entryAt || null,
    lastTransitionAt: item.lastTransitionAt || null,
    protectiveOrderListId: item.protectiveOrderListId || null,
    operatorMode: item.operatorMode || "normal",
    failureCount: item.failureCount || 0,
    manualReviewRequired: Boolean(item.manualReviewRequired),
    reconcileRequired: Boolean(item.reconcileRequired),
    recoveryAction: item.recoveryAction || null
  }));
  const pendingActions = arr(summary.pendingActions || []).slice(0, 12).map((item) => ({
    id: item.id || null,
    symbol: item.symbol || null,
    action: item.action || null,
    state: item.state || null,
    reason: item.reason || null,
    severity: item.severity || "neutral",
    recoveryAction: item.recoveryAction || null
  }));
  return {
    lastUpdatedAt: summary.lastUpdatedAt || null,
    positions,
    counts: {
      manualReview: positions.filter((item) => item.state === "manual_review").length,
      reconcileRequired: positions.filter((item) => item.state === "reconcile_required").length,
      protectOnly: positions.filter((item) => item.state === "protect_only").length,
      protectionPending: positions.filter((item) => item.state === "protection_pending").length
    },
    activeActions: Object.values(summary.activeActions || {}).slice(0, 10).map((item) => ({
      id: item.id || null,
      type: item.type || null,
      symbol: item.symbol || null,
      positionId: item.positionId || null,
      stage: item.stage || null,
      status: item.status || "pending",
      severity: item.severity || "neutral",
      startedAt: item.startedAt || null,
      updatedAt: item.updatedAt || null,
      detail: item.detail || null,
      recoveryAction: item.recoveryAction || null
    })),
    pendingActions,
    recentTransitions: arr(summary.recentTransitions || []).slice(0, 20).map((item) => ({
      at: item.at || null,
      symbol: item.symbol || null,
      state: item.state || null,
      previousState: item.previousState || null,
      detail: item.detail || null,
      severity: item.severity || "neutral"
    })),
    actionJournal: arr(summary.actionJournal || []).slice(0, 20).map((item) => ({
      id: item.id || null,
      type: item.type || null,
      symbol: item.symbol || null,
      stage: item.stage || null,
      status: item.status || null,
      severity: item.severity || "neutral",
      startedAt: item.startedAt || null,
      completedAt: item.completedAt || null,
      detail: item.detail || null,
      error: item.error || null,
      recoveryAction: item.recoveryAction || null
    }))
  };
}

function summarizeLifecycleInvariants({ exchangeTruth = {}, orderLifecycle = {} } = {}) {
  const pendingActions = arr(orderLifecycle.pendingActions || []);
  const hardStopCount = pendingActions.filter((item) => ["manual_review", "reconcile_required"].includes(item.state)).length
    + (exchangeTruth.freezeEntries ? 1 : 0);
  const autoRecoverableCount = pendingActions.filter((item) => ["protection_pending", "protect_only"].includes(item.state)).length;
  const blockerReasons = [
    ...(exchangeTruth.freezeEntries ? ["exchange_truth_freeze"] : []),
    ...pendingActions
      .filter((item) => ["manual_review", "reconcile_required", "protect_only", "protection_pending"].includes(item.state))
      .map((item) => item.state)
  ];
  return {
    status: hardStopCount > 0 ? "blocked" : autoRecoverableCount > 0 ? "degraded" : "ready",
    hardStopCount,
    autoRecoverableCount,
    blockerCount: blockerReasons.length,
    blockerReasons: [...new Set(blockerReasons)].slice(0, 8),
    notes: [
      exchangeTruth.freezeEntries ? "Nieuwe entries staan bevroren tot exchange truth weer schoon is." : null,
      hardStopCount > 0 ? `${hardStopCount} lifecycle state(s) vereisen operator-confirmatie of reconcile.` : null,
      autoRecoverableCount > 0 ? `${autoRecoverableCount} lifecycle state(s) zijn nog auto-recoverable maar vragen monitoring.` : null
    ].filter(Boolean)
  };
}

function summarizeShadowTrading(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    enabled: Boolean(summary.enabled),
    mode: summary.mode || "observe",
    candidateCount: summary.candidateCount || 0,
    simulatedEntries: arr(summary.simulatedEntries || []).slice(0, 6).map((item) => ({
      symbol: item.symbol || null,
      probability: num(item.probability || 0, 4),
      threshold: num(item.threshold || 0, 4),
      quoteAmount: num(item.quoteAmount || 0, 2),
      fillPrice: num(item.fillPrice || 0, 6),
      expectedSlippageBps: num(item.expectedSlippageBps || 0, 2),
      executionStyle: item.executionStyle || null,
      status: item.status || "observe"
    })),
    notes: [...(summary.notes || [])]
  };
}

function summarizePaperLearning(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    status: summary.status || "warmup",
    readinessStatus: summary.readinessStatus || "warmup",
    readinessScore: num(summary.readinessScore || 0, 4),
    safeCount: summary.safeCount || 0,
    probeCount: summary.probeCount || 0,
    shadowCount: summary.shadowCount || 0,
    averageLearningValueScore: num(summary.averageLearningValueScore || 0, 4),
    averageNoveltyScore: num(summary.averageNoveltyScore || 0, 4),
    blockerGroups: Object.fromEntries(Object.entries(summary.blockerGroups || {}).map(([key, value]) => [key, value || 0])),
    scopeReadiness: arr(summary.scopeReadiness || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      type: item.type || null,
      count: item.count || 0,
      readinessScore: num(item.readinessScore || 0, 4),
      status: item.status || "warmup",
      goodRate: num(item.goodRate || 0, 4),
      weakRate: num(item.weakRate || 0, 4)
    })),
    thresholdSandbox: summary.thresholdSandbox ? {
      status: summary.thresholdSandbox.status || "observe",
      scopeLabel: summary.thresholdSandbox.scopeLabel || null,
      thresholdShift: num(summary.thresholdSandbox.thresholdShift || 0, 4),
      sampleSize: summary.thresholdSandbox.sampleSize || 0
    } : null,
    reviewPacks: summary.reviewPacks ? {
      bestProbeWinner: summary.reviewPacks.bestProbeWinner || null,
      weakestProbe: summary.reviewPacks.weakestProbe || null,
      topMissedSetup: summary.reviewPacks.topMissedSetup || null
    } : null,
    paperToLiveReadiness: summary.paperToLiveReadiness ? {
      status: summary.paperToLiveReadiness.status || "warmup",
      score: num(summary.paperToLiveReadiness.score || 0, 4),
      topScope: summary.paperToLiveReadiness.topScope || null,
      blocker: summary.paperToLiveReadiness.blocker || null,
      note: summary.paperToLiveReadiness.note || null
    } : null,
    counterfactualTuning: summary.counterfactualTuning ? {
      status: summary.counterfactualTuning.status || "observe",
      blocker: summary.counterfactualTuning.blocker || null,
      action: summary.counterfactualTuning.action || null,
      adjustment: num(summary.counterfactualTuning.adjustment || 0, 4),
      confidence: num(summary.counterfactualTuning.confidence || 0, 4),
      note: summary.counterfactualTuning.note || null
    } : null,
    dailyBudget: summary.dailyBudget || null,
    topFamilies: arr(summary.topFamilies || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      count: item.count || 0
    })),
    topRegimes: arr(summary.topRegimes || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      count: item.count || 0
    })),
    topSessions: arr(summary.topSessions || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      count: item.count || 0
    })),
    topBlockers: arr(summary.topBlockers || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      count: item.count || 0
    })),
    recentOutcomes: arr(summary.recentOutcomes || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      count: item.count || 0
    })),
    probation: summary.probation ? {
      status: summary.probation.status || "warmup",
      eligibleProbeTrades: summary.probation.eligibleProbeTrades || 0,
      promotionReady: Boolean(summary.probation.promotionReady),
      rollbackRisk: Boolean(summary.probation.rollbackRisk),
      leadingOutcome: summary.probation.leadingOutcome || null,
      note: summary.probation.note || null
    } : null,
    notes: arr(summary.notes || []).slice(0, 6)
  };
}

function summarizeServiceState(summary = {}) {
  return {
    lastHeartbeatAt: summary.lastHeartbeatAt || null,
    watchdogStatus: summary.watchdogStatus || "idle",
    restartBackoffSeconds: summary.restartBackoffSeconds == null ? null : num(summary.restartBackoffSeconds || 0, 1),
    lastExitCode: summary.lastExitCode == null ? null : summary.lastExitCode,
    statusFile: summary.statusFile || null
  };
}

function summarizeExecutionCalibration(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    status: summary.status || "warmup",
    liveTradeCount: summary.liveTradeCount || 0,
    styles: Object.fromEntries(
      Object.entries(summary.styles || {}).map(([style, item]) => [style, {
        tradeCount: item.tradeCount || 0,
        slippageBiasBps: num(item.slippageBiasBps || 0, 2),
        makerFillBias: num(item.makerFillBias || 0, 4),
        latencyMultiplier: num(item.latencyMultiplier || 1, 3),
        queueDecayBiasBps: num(item.queueDecayBiasBps || 0, 2),
        spreadShockBiasBps: num(item.spreadShockBiasBps || 0, 2)
      }])
    ),
    notes: [...(summary.notes || [])]
  };
}

function resolvePaperOutcomeBucket(trade = {}) {
  if (trade.paperLearningOutcome?.outcome) {
    return trade.paperLearningOutcome.outcome;
  }
  if ((trade.pnlQuote || 0) > 0 && (trade.captureEfficiency || 0) >= 0.5) {
    return "good_trade";
  }
  if ((trade.pnlQuote || 0) > 0) {
    return "acceptable_trade";
  }
  if ((trade.mfePct || 0) >= 0.018 && (trade.captureEfficiency || 0) < 0.32) {
    return "early_exit";
  }
  if ((trade.maePct || 0) <= -0.02 && ["time_stop", "manual_exit", "stop_loss"].includes(trade.reason || "")) {
    return "late_exit";
  }
  if ((trade.executionQualityScore || 0) < 0.42) {
    return "execution_drag";
  }
  return "bad_trade";
}

function summarizeStrategyMeta(summary = {}) {
  return {
    preferredFamily: summary.preferredFamily || null,
    preferredExecutionStyle: summary.preferredExecutionStyle || null,
    familyAlignment: num(summary.familyAlignment || 0, 4),
    fitBoost: num(summary.fitBoost || 0, 4),
    thresholdShift: num(summary.thresholdShift || 0, 4),
    makerBias: num(summary.makerBias || 0, 4),
    sizeMultiplier: num(summary.sizeMultiplier ?? 1, 4),
    stopLossMultiplier: num(summary.stopLossMultiplier ?? 1, 4),
    holdMultiplier: num(summary.holdMultiplier ?? 1, 4),
    confidence: num(summary.confidence || 0, 4),
    families: arr(summary.families || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      probability: num(item.probability || 0, 4),
      confidence: num(item.confidence || 0, 4),
      preferred: Boolean(item.preferred)
    })),
    executionStyles: arr(summary.executionStyles || []).slice(0, 3).map((item) => ({
      id: item.id || null,
      probability: num(item.probability || 0, 4),
      confidence: num(item.confidence || 0, 4)
    })),
    drivers: arr(summary.drivers || []).slice(0, 4)
  };
}

function summarizeStrategyResearch(summary = {}) {
  const mapCandidate = (item) => ({
    ...summarizeStrategyDsl(item),
    status: item.status || "observe",
    promotionStage: item.promotionStage || (item.status || "observe"),
    paperReady: Boolean(item.paperReady),
    score: {
      overall: num(item.score?.overall || 0, 4),
      safetyScore: num(item.score?.safetyScore || 0, 4),
      governanceSupport: num(item.score?.governanceSupport || 0, 4),
      simplicityScore: num(item.score?.simplicityScore || 0, 4),
      noveltyScore: num(item.score?.noveltyScore || 0, 4),
      stressScore: num(item.score?.stressScore || 0, 4),
      robustnessScore: num(item.score?.robustnessScore || 0, 4),
      uniquenessScore: num(item.score?.uniquenessScore || 0, 4)
    },
    parameterDiffs: {
      stopLossPct: num(item.parameterDiffs?.stopLossPct || 0, 4),
      takeProfitPct: num(item.parameterDiffs?.takeProfitPct || 0, 4),
      trailingStopPct: num(item.parameterDiffs?.trailingStopPct || 0, 4),
      maxHoldMinutes: item.parameterDiffs?.maxHoldMinutes || 0,
      entryStyle: item.parameterDiffs?.entryStyle || null
    },
    stress: {
      status: item.stress?.status || "warmup",
      survivalScore: num(item.stress?.survivalScore || 0, 4),
      tailLossPct: num(item.stress?.tailLossPct || 0, 4),
      worstScenario: item.stress?.worstScenario || null
    },
    notes: [...(item.notes || [])].slice(0, 4)
  });
  return {
    generatedAt: summary.generatedAt || null,
    candidateCount: summary.candidateCount || 0,
    importedCandidateCount: summary.importedCandidateCount || 0,
    approvedCandidateCount: summary.approvedCandidateCount || 0,
    blockedCount: summary.blockedCount || 0,
    leader: summary.leader || null,
    genome: {
      parentCount: summary.genome?.parentCount || 0,
      candidateCount: summary.genome?.candidateCount || 0,
      notes: [...(summary.genome?.notes || [])]
    },
    approvedCandidates: arr(summary.approvedCandidates || []).slice(0, 6).map(mapCandidate),
    candidates: arr(summary.candidates || []).slice(0, 10).map(mapCandidate),
    notes: [...(summary.notes || [])]
  };
}

function summarizeParameterGovernor(summary = {}) {
  const mapScope = (item) => ({
    id: item.id || null,
    scopeType: item.scopeType || "strategy",
    tradeCount: item.tradeCount || 0,
    winRate: num(item.winRate || 0, 4),
    avgPnlPct: num(item.avgPnlPct || 0, 4),
    avgCapture: num(item.avgCapture || 0, 4),
    avgSlippageDeltaBps: num(item.avgSlippageDeltaBps || 0, 2),
    avgHoldMinutes: num(item.avgHoldMinutes || 0, 1),
    thresholdShift: num(item.thresholdShift || 0, 4),
    stopLossMultiplier: num(item.stopLossMultiplier || 1, 4),
    takeProfitMultiplier: num(item.takeProfitMultiplier || 1, 4),
    trailingStopMultiplier: num(item.trailingStopMultiplier || 1, 4),
    scaleOutTriggerMultiplier: num(item.scaleOutTriggerMultiplier || 1, 4),
    scaleOutFractionMultiplier: num(item.scaleOutFractionMultiplier || 1, 4),
    maxHoldMinutesMultiplier: num(item.maxHoldMinutesMultiplier || 1, 4),
    executionAggressivenessBias: num(item.executionAggressivenessBias || 1, 4),
    governanceScore: num(item.governanceScore || 0, 4),
    status: item.status || "observe"
  });
  return {
    generatedAt: summary.generatedAt || null,
    tradeCount: summary.tradeCount || 0,
    status: summary.status || "warmup",
    strategyScopes: arr(summary.strategyScopes || []).slice(0, 6).map(mapScope),
    regimeScopes: arr(summary.regimeScopes || []).slice(0, 6).map(mapScope),
    notes: [...(summary.notes || [])]
  };
}

function summarizeVenueConfirmation(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    symbol: summary.symbol || summary.leadSymbol || null,
    status: summary.status || "warmup",
    confirmed: Boolean(summary.confirmed),
    venueCount: summary.venueCount || 0,
    candidateCount: summary.candidateCount || 0,
    confirmedCount: summary.confirmedCount || 0,
    blockedCount: summary.blockedCount || 0,
    divergenceBps: summary.divergenceBps == null ? null : num(summary.divergenceBps, 2),
    averageDivergenceBps: summary.averageDivergenceBps == null ? null : num(summary.averageDivergenceBps, 2),
    averageHealthScore: summary.averageHealthScore == null ? null : num(summary.averageHealthScore, 4),
    blockerReasons: [...(summary.blockerReasons || [])],
    routeAdvice: {
      preferredEntryStyle: summary.routeAdvice?.preferredEntryStyle || null,
      preferMakerBoost: num(summary.routeAdvice?.preferMakerBoost || 0, 4),
      sizeMultiplier: num(summary.routeAdvice?.sizeMultiplier ?? 1, 4),
      aggressiveTakerAllowed: summary.routeAdvice?.aggressiveTakerAllowed !== false,
      confidence: num(summary.routeAdvice?.confidence || 0, 4),
      preferredVenues: [...(summary.routeAdvice?.preferredVenues || [])],
      degradedVenues: [...(summary.routeAdvice?.degradedVenues || [])]
    },
    venueHealth: arr(summary.venueHealth || []).slice(0, 5).map((item) => ({
      venue: item.venue || null,
      divergenceBps: item.divergenceBps == null ? null : num(item.divergenceBps || 0, 2),
      healthScore: num(item.healthScore || 0, 4),
      status: item.status || "watch"
    })),
    venues: arr(summary.venues || []).slice(0, 5).map((item) => ({
      venue: item.venue || null,
      mid: num(item.mid || 0, 8),
      divergenceBps: item.divergenceBps == null ? null : num(item.divergenceBps || 0, 2)
    })),
    notes: [...(summary.notes || [])]
  };
}

function summarizeCapitalLadder(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    stage: summary.stage || "paper",
    allowEntries: Boolean(summary.allowEntries),
    sizeMultiplier: num(summary.sizeMultiplier ?? 1, 4),
    approvedResearchCount: summary.approvedResearchCount || 0,
    liveTradeCount: summary.liveTradeCount || 0,
    promotionReadyLevel: summary.promotionReadyLevel || null,
    blockerReasons: [...(summary.blockerReasons || [])],
    notes: [...(summary.notes || [])]
  };
}

function summarizeCapitalGovernor(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    status: summary.status || "warmup",
    allowEntries: summary.allowEntries !== false,
    recoveryMode: Boolean(summary.recoveryMode),
    releaseReady: Boolean(summary.releaseReady),
    sizeMultiplier: num(summary.sizeMultiplier ?? 1, 4),
    dailyLossFraction: num(summary.dailyLossFraction || 0, 4),
    weeklyLossFraction: num(summary.weeklyLossFraction || 0, 4),
    drawdownPct: num(summary.drawdownPct || 0, 4),
    redDayStreak: summary.redDayStreak || 0,
    recoveryTradeCount: summary.recoveryTradeCount || 0,
    recoveryWinRate: num(summary.recoveryWinRate || 0, 4),
    recoveryAveragePnl: num(summary.recoveryAveragePnl || 0, 4),
    blockerReasons: [...(summary.blockerReasons || [])],
    notes: [...(summary.notes || [])],
    dailyLedger: arr(summary.dailyLedger || []).slice(-7).map((item) => ({
      day: item.day || null,
      pnlQuote: num(item.pnlQuote || 0, 2)
    }))
  };
}

function summarizeExchangeSafety(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    status: summary.status || "ready",
    freezeEntries: Boolean(summary.freezeEntries),
    riskScore: num(summary.riskScore || 0, 4),
    mismatchCount: summary.mismatchCount || 0,
    criticalPendingCount: summary.criticalPendingCount || 0,
    stalePendingCount: summary.stalePendingCount || 0,
    unresolvedLivePositions: summary.unresolvedLivePositions || 0,
    reconcileAgeMinutes: summary.reconcileAgeMinutes == null ? null : num(summary.reconcileAgeMinutes, 1),
    streamAgeMinutes: summary.streamAgeMinutes == null ? null : num(summary.streamAgeMinutes, 1),
    reasons: [...(summary.reasons || [])],
    notes: [...(summary.notes || [])],
    actions: [...(summary.actions || [])]
  };
}

function summarizeExecutionCost(summary = {}) {
  const mapBucket = (item) => ({
    id: item.id || null,
    tradeCount: item.tradeCount || 0,
    realizedPnl: num(item.realizedPnl || 0, 2),
    averageTotalCostBps: num(item.averageTotalCostBps || 0, 2),
    averageFeeBps: num(item.averageFeeBps || 0, 2),
    averageTouchSlippageBps: num(item.averageTouchSlippageBps || 0, 2),
    averageSlippageDeltaBps: num(item.averageSlippageDeltaBps || 0, 2),
    status: item.status || "ready"
  });
  return {
    status: summary.status || "warmup",
    averageTotalCostBps: num(summary.averageTotalCostBps || 0, 2),
    averageFeeBps: num(summary.averageFeeBps || 0, 2),
    averageTouchSlippageBps: num(summary.averageTouchSlippageBps || 0, 2),
    averageSlippageDeltaBps: num(summary.averageSlippageDeltaBps || 0, 2),
    worstStyle: summary.worstStyle || null,
    worstStrategy: summary.worstStrategy || null,
    styles: arr(summary.styles || []).slice(0, 6).map(mapBucket),
    strategies: arr(summary.strategies || []).slice(0, 6).map(mapBucket),
    regimes: arr(summary.regimes || []).slice(0, 5).map(mapBucket),
    notes: [...(summary.notes || [])]
  };
}

function summarizeStrategyRetirement(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    status: summary.status || "warmup",
    retireCount: summary.retireCount || 0,
    cooldownCount: summary.cooldownCount || 0,
    activeCount: summary.activeCount || 0,
    blockedStrategies: [...(summary.blockedStrategies || [])],
    cooldownStrategies: [...(summary.cooldownStrategies || [])],
    policies: arr(summary.policies || []).slice(0, 10).map((item) => ({
      id: item.id || null,
      tradeCount: item.tradeCount || 0,
      realizedPnl: num(item.realizedPnl || 0, 2),
      winRate: num(item.winRate || 0, 4),
      avgReviewScore: num(item.avgReviewScore || 0, 4),
      avgPnlPct: num(item.avgPnlPct || 0, 4),
      governanceScore: num(item.governanceScore || 0, 4),
      falsePositiveRate: num(item.falsePositiveRate || 0, 4),
      falseNegativeRate: num(item.falseNegativeRate || 0, 4),
      confidence: num(item.confidence || 0, 4),
      status: item.status || "observe",
      sizeMultiplier: num(item.sizeMultiplier ?? 1, 3),
      note: item.note || null
    })),
    notes: [...(summary.notes || [])]
  };
}

function summarizeReplayChaos(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    status: summary.status || "warmup",
    tradeCount: summary.tradeCount || 0,
    blockedSetupCount: summary.blockedSetupCount || 0,
    replayCoverage: num(summary.replayCoverage || 0, 4),
    missedWinnerCount: summary.missedWinnerCount || 0,
    worstStrategy: summary.worstStrategy || null,
    worstScenario: summary.worstScenario || null,
    activeScenarios: arr(summary.activeScenarios || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      count: item.count || 0
    })),
    recommendedActions: arr(summary.recommendedActions || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      count: item.count || 0,
      action: item.action || null
    })),
    scenarioLeaders: arr(summary.scenarioLeaders || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      tradeCount: item.tradeCount || 0,
      status: item.status || "observe",
      survivalScore: num(item.survivalScore || 0, 4),
      tailLossPct: num(item.tailLossPct || 0, 4),
      worstScenario: item.worstScenario || null,
      monteCarlo: {
        p05Pct: num(item.monteCarlo?.p05Pct || 0, 4),
        p50Pct: num(item.monteCarlo?.p50Pct || 0, 4),
        p95Pct: num(item.monteCarlo?.p95Pct || 0, 4)
      },
      notes: [...(item.notes || [])]
    })),
    notes: [...(summary.notes || [])]
  };
}

function summarizeOperatorAlerts(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    count: summary.count || 0,
    activeCount: summary.activeCount || 0,
    mutedCount: summary.mutedCount || 0,
    acknowledgedCount: summary.acknowledgedCount || 0,
    resolvedCount: summary.resolvedCount || 0,
    criticalCount: summary.criticalCount || 0,
    status: summary.status || "clear",
    alerts: arr(summary.alerts || []).slice(0, 8).map((item) => ({
      id: item.id || null,
      severity: item.severity || "info",
      state: item.state || "new",
      title: item.title || null,
      reason: item.reason || null,
      action: item.action || null,
      acknowledgedAt: item.acknowledgedAt || null,
      resolvedAt: item.resolvedAt || null,
      silencedUntil: item.silencedUntil || null,
      muted: Boolean(item.muted),
      lastDeliveredAt: item.lastDeliveredAt || null
    }))
  };
}

function summarizeTuningGovernance({ thresholdTuning = {}, parameterGovernor = {}, modelRegistry = {}, offlineTrainer = {} } = {}) {
  const appliedRecommendation = thresholdTuning.appliedRecommendation || null;
  const leadGovernor = (parameterGovernor.strategyScopes || [])[0] || (parameterGovernor.regimeScopes || [])[0] || null;
  const promotionPolicy = modelRegistry.promotionPolicy || {};
  return {
    status: appliedRecommendation?.status || parameterGovernor.status || promotionPolicy.readyLevel || "stable",
    thresholdRecommendationId: appliedRecommendation?.id || null,
    thresholdRecommendationStatus: appliedRecommendation?.status || thresholdTuning.status || "stable",
    governorScope: leadGovernor ? `${leadGovernor.scopeType}:${leadGovernor.id}` : null,
    governorThresholdShift: num(leadGovernor?.thresholdShift || 0, 4),
    promotionReadyLevel: promotionPolicy.readyLevel || null,
    allowPromotion: Boolean(promotionPolicy.allowPromotion),
    blockerReasons: [...new Set([
      ...(promotionPolicy.blockerReasons || []),
      ...(offlineTrainer.thresholdPolicy?.status === "blocked" ? ["threshold_policy_blocked"] : [])
    ])].slice(0, 8),
    notes: [
      appliedRecommendation?.id ? `Actieve threshold probation: ${appliedRecommendation.id}.` : null,
      leadGovernor?.id ? `Lead governor scope ${leadGovernor.scopeType}:${leadGovernor.id}.` : null,
      promotionPolicy.readyLevel ? `Promotion level ${promotionPolicy.readyLevel}.` : null
    ].filter(Boolean)
  };
}

function summarizeMarketState(summary = {}) {
  return {
    direction: summary.direction || "mixed",
    phase: summary.phase || "mixed_transition",
    trendMaturity: num(summary.trendMaturity || 0, 4),
    trendExhaustion: num(summary.trendExhaustion || 0, 4),
    rangeAcceptance: num(summary.rangeAcceptance || 0, 4),
    trendFailure: num(summary.trendFailure || 0, 4),
    dataConfidence: num(summary.dataConfidence || 0, 4),
    featureCompleteness: num(summary.featureCompleteness || 0, 4),
    uptrendScore: num(summary.uptrendScore || 0, 4),
    downtrendScore: num(summary.downtrendScore || 0, 4),
    rangeScore: num(summary.rangeScore || 0, 4),
    reasons: arr(summary.reasons || []).slice(0, 4)
  };
}

function summarizeCapitalPolicy({ capitalLadder = {}, capitalGovernor = {} } = {}) {
  const policyEngine = capitalGovernor.policyEngine || capitalLadder.policyEngine || {};
  return {
    stage: capitalLadder.stage || "paper",
    allowEntries: capitalLadder.allowEntries !== false && capitalGovernor.allowEntries !== false,
    sizeMultiplier: num((capitalLadder.sizeMultiplier ?? 1) * (capitalGovernor.sizeMultiplier ?? 1), 4),
    ladder: summarizeCapitalLadder(capitalLadder),
    governor: summarizeCapitalGovernor(capitalGovernor),
    status: policyEngine.status || capitalGovernor.status || capitalLadder.stage || "ready",
    deRiskLevel: num(policyEngine.deRiskLevel || 0, 4),
    budgets: policyEngine.budgets || null,
    factorBudgets: arr(policyEngine.factorBudgets || []).slice(0, 4),
    clusterBudgets: arr(policyEngine.clusterBudgets || []).slice(0, 4),
    regimeBudgets: arr(policyEngine.regimeBudgets || []).slice(0, 4),
    familyBudgets: arr(policyEngine.familyBudgets || []).slice(0, 4),
    familyKillSwitches: arr(policyEngine.familyKillSwitches || []).slice(0, 4),
    regimeLossStreaks: arr(policyEngine.regimeLossStreaks || []).slice(0, 6),
    notes: arr(policyEngine.notes || []).slice(0, 6)
  };
}

function summarizeDataRecorder(summary = {}) {
  return {
    schemaVersion: summary.schemaVersion || null,
    enabled: Boolean(summary.enabled),
    lastRecordAt: summary.lastRecordAt || null,
    filesWritten: summary.filesWritten || 0,
    cycleFrames: summary.cycleFrames || 0,
    decisionFrames: summary.decisionFrames || 0,
    tradeFrames: summary.tradeFrames || 0,
    learningFrames: summary.learningFrames || 0,
    researchFrames: summary.researchFrames || 0,
    snapshotFrames: summary.snapshotFrames || 0,
    newsFrames: summary.newsFrames || 0,
    contextFrames: summary.contextFrames || 0,
    datasetFrames: summary.datasetFrames || 0,
    archivedFiles: summary.archivedFiles || 0,
    lineageCoverage: num(summary.lineageCoverage || 0, 4),
    averageRecordQuality: num(summary.averageRecordQuality || 0, 4),
    latestRecordQuality: summary.latestRecordQuality
      ? {
          kind: summary.latestRecordQuality.kind || null,
          score: num(summary.latestRecordQuality.score || 0, 4),
          tier: summary.latestRecordQuality.tier || "unknown"
        }
      : null,
    retention: {
      hotRetentionDays: summary.retention?.hotRetentionDays || 0,
      coldRetentionDays: summary.retention?.coldRetentionDays || 0,
      lastCompactionAt: summary.retention?.lastCompactionAt || null
    },
    latestBootstrap: summary.latestBootstrap ? {
      generatedAt: summary.latestBootstrap.generatedAt || null,
      status: summary.latestBootstrap.status || "empty",
      decisions: {
        count: summary.latestBootstrap.decisions?.count || 0,
        topStrategies: arr(summary.latestBootstrap.decisions?.topStrategies || []).slice(0, 4),
        topRegimes: arr(summary.latestBootstrap.decisions?.topRegimes || []).slice(0, 4)
      },
      learning: {
        count: summary.latestBootstrap.learning?.count || 0,
        avgLabelScore: num(summary.latestBootstrap.learning?.avgLabelScore || 0, 4),
        topFamilies: arr(summary.latestBootstrap.learning?.topFamilies || []).slice(0, 4),
        topRegimes: arr(summary.latestBootstrap.learning?.topRegimes || []).slice(0, 4)
      },
      news: {
        count: summary.latestBootstrap.news?.count || 0,
        topProviders: arr(summary.latestBootstrap.news?.topProviders || []).slice(0, 4)
      },
      contexts: {
        count: summary.latestBootstrap.contexts?.count || 0,
        topKinds: arr(summary.latestBootstrap.contexts?.topKinds || []).slice(0, 4)
      },
      latestDatasetCuration: summary.latestBootstrap.latestDatasetCuration || null,
      warmStart: summary.latestBootstrap.warmStart || null
    } : null,
    qualityByKind: arr(summary.qualityByKind || []).slice(0, 8).map((item) => ({
      kind: item.kind || null,
      count: item.count || 0,
      averageScore: num(item.averageScore || 0, 4),
      high: item.high || 0,
      medium: item.medium || 0,
      low: item.low || 0
    })),
    sourceCoverage: arr(summary.sourceCoverage || []).slice(0, 6).map((item) => ({
      provider: item.provider || null,
      count: item.count || 0,
      avgReliability: num(item.avgReliability || 0, 4),
      avgFreshnessScore: num(item.avgFreshnessScore || 0, 4),
      lastSeenAt: item.lastSeenAt || null,
      channels: arr(item.channels || []).slice(0, 3)
    })),
    contextCoverage: arr(summary.contextCoverage || []).slice(0, 4).map((item) => ({
      kind: item.kind || null,
      count: item.count || 0,
      avgCoverage: num(item.avgCoverage || 0, 4),
      avgConfidence: num(item.avgConfidence || 0, 4),
      avgRiskScore: num(item.avgRiskScore || 0, 4),
      highImpactCount: item.highImpactCount || 0,
      lastSeenAt: item.lastSeenAt || null,
      nextEventAt: item.nextEventAt || null
    })),
    datasetCuration: summary.datasetCuration || null
  };
}

function resolveLifecycleRecoveryAction(state, position = {}, activeAction = null) {
  if (activeAction?.status === "failed") {
    return "force_reconcile";
  }
  if (state === "manual_review") {
    return "mark_reviewed";
  }
  if (state === "reconcile_required") {
    return "force_reconcile";
  }
  if (state === "protect_only") {
    return "allow_probe_only";
  }
  if (state === "protection_pending") {
    return "rebuild_protection";
  }
  if ((position.brokerMode || "") === "live" && !position.protectiveOrderListId && ["open", "recovered_open"].includes(state)) {
    return "rebuild_protection";
  }
  return "monitor";
}

function summarizeAlertDelivery(summary = {}) {
  return {
    generatedAt: summary.generatedAt || null,
    status: summary.status || "disabled",
    endpointCount: summary.endpointCount || 0,
    eligibleCount: summary.eligibleCount || 0,
    deliveredCount: summary.deliveredCount || 0,
    failedCount: summary.failedCount || 0,
    lastDeliveryAt: summary.lastDeliveryAt || null,
    lastError: summary.lastError || null,
    notes: [...(summary.notes || [])]
  };
}

function buildCandidateQualityQuorum({
  symbol,
  marketSnapshot,
  newsSummary,
  exchangeSummary = {},
  calendarSummary = {},
  pairHealthSummary = {},
  timeframeSummary = {},
  sourceReliabilitySummary = {},
  divergenceSummary = {},
  venueConfirmationSummary = {},
  config,
  nowIso: generatedAt = new Date().toISOString()
} = {}) {
  const checks = [
    {
      id: "local_book",
      label: "Local book",
      critical: true,
      passed: !config.enableLocalOrderBook || (
        Boolean(marketSnapshot?.book?.localBookSynced) &&
        (marketSnapshot?.book?.depthConfidence || 0) >= 0.22
      ),
      detail: !config.enableLocalOrderBook
        ? "disabled"
        : `sync ${marketSnapshot?.book?.localBookSynced ? "ok" : "missing"} | depth ${num(marketSnapshot?.book?.depthConfidence || 0, 2)}`
    },
    {
      id: "news_reliability",
      label: "News reliability",
      critical: false,
      passed: (newsSummary?.coverage || 0) === 0 || (newsSummary?.reliabilityScore || 0) >= config.newsMinReliabilityScore,
      detail: `${newsSummary?.coverage || 0} items | rel ${num(newsSummary?.reliabilityScore || 0, 2)}`
    },
    {
      id: "provider_ops",
      label: "Provider ops",
      critical: true,
      passed: (sourceReliabilitySummary?.providerCount || 0) === 0 || (
        (sourceReliabilitySummary?.averageScore || 0) >= config.sourceReliabilityMinOperationalScore &&
        (sourceReliabilitySummary?.degradedCount || 0) <= 1 &&
        (sourceReliabilitySummary?.coolingDownCount || 0) <= Math.max(1, Math.floor((sourceReliabilitySummary?.providerCount || 0) / 2))
      ),
      detail: `${sourceReliabilitySummary?.degradedCount || 0} degraded | avg ${num(sourceReliabilitySummary?.averageScore || 0, 2)}`
    },
    {
      id: "pair_health",
      label: "Pair health",
      critical: true,
      passed: !pairHealthSummary?.quarantined,
      detail: `${pairHealthSummary?.health || "watch"} | ${num(pairHealthSummary?.score || 0, 2)}`
    },
    {
      id: "timeframe",
      label: "Timeframe",
      critical: false,
      passed: !(timeframeSummary?.blockerReasons || []).length,
      detail: `align ${num(timeframeSummary?.alignmentScore || 0, 2)}`
    },
    {
      id: "divergence",
      label: "Divergence",
      critical: true,
      passed: (divergenceSummary?.leadBlocker?.status || "") !== "blocked",
      detail: `avg ${num(divergenceSummary?.averageScore || 0, 2)}`
    },
    {
      id: "calendar",
      label: "Calendar",
      critical: false,
      passed: (calendarSummary?.riskScore || 0) < 0.76 || (calendarSummary?.proximityHours || 999) > 12,
      detail: calendarSummary?.nextEventTitle
        ? `${calendarSummary.nextEventType || "event"} in ${num(calendarSummary?.proximityHours || 0, 1)}u`
        : "geen direct event"
    },
    {
      id: "exchange",
      label: "Exchange",
      critical: false,
      passed: (exchangeSummary?.riskScore || 0) < 0.72,
      detail: `${exchangeSummary?.highPriorityCount || 0} notices`
    },
    {
      id: "reference_venues",
      label: "Reference venues",
      critical: false,
      passed: (venueConfirmationSummary?.status || "warmup") !== "blocked",
      detail: venueConfirmationSummary?.venueCount
        ? `${venueConfirmationSummary.venueCount} venues | div ${num(venueConfirmationSummary?.divergenceBps || 0, 2)} bps`
        : "geen externe venue-confirmatie"
    }
  ];
  const failedCritical = checks.filter((check) => check.critical && !check.passed);
  const cautionReasons = checks.filter((check) => !check.passed && !check.critical).map((check) => check.id);
  const passedCount = checks.filter((check) => check.passed).length;
  const quorumScore = checks.length ? passedCount / checks.length : 1;
  const observeOnly = failedCritical.length >= 2 || (!checks.find((check) => check.id === "local_book")?.passed && !checks.find((check) => check.id === "provider_ops")?.passed);
  const status = observeOnly
    ? "observe_only"
    : failedCritical.length || cautionReasons.length >= 2
      ? "degraded"
      : cautionReasons.length
        ? "watch"
        : "ready";
  return {
    generatedAt,
    symbol: symbol || null,
    candidateCount: 1,
    readyCount: status === "ready" ? 1 : 0,
    degradedCount: status === "degraded" ? 1 : 0,
    observeOnlyCount: observeOnly ? 1 : 0,
    averageScore: num(quorumScore, 4),
    quorumScore: num(quorumScore, 4),
    status,
    leadSymbol: symbol || null,
    leadStatus: status,
    observeOnly,
    blockerReasons: failedCritical.map((check) => check.id),
    cautionReasons,
    checks,
    notes: [
      observeOnly
        ? `${symbol || "candidate"} draait in observe-only door ${failedCritical.map((check) => check.id).join(", ") || "meerdere quorum-fouten"}.`
        : status === "degraded"
          ? `${symbol || "candidate"} heeft degraded data quorum; risicovollere entries beter vermijden.`
          : `${symbol || "candidate"} voldoet aan de data quorum-checks.`
    ]
  };
}

function buildRuntimeQualityQuorum(candidates = [], nowIso = new Date().toISOString()) {
  const summaries = candidates.map((candidate) => candidate.qualityQuorumSummary).filter(Boolean);
  if (!summaries.length) {
    return summarizeQualityQuorum({ generatedAt: nowIso });
  }
  const lead = summaries[0];
  return {
    generatedAt: nowIso,
    candidateCount: summaries.length,
    readyCount: summaries.filter((item) => item.status === "ready").length,
    degradedCount: summaries.filter((item) => item.status === "degraded").length,
    observeOnlyCount: summaries.filter((item) => item.observeOnly).length,
    averageScore: num(summaries.reduce((total, item) => total + (item.quorumScore || item.averageScore || 0), 0) / summaries.length, 4),
    quorumScore: num(lead.quorumScore || lead.averageScore || 0, 4),
    status: lead.status || "ready",
    leadSymbol: lead.symbol || null,
    leadStatus: lead.status || "ready",
    observeOnly: Boolean(lead.observeOnly),
    blockerReasons: [...(lead.blockerReasons || [])],
    cautionReasons: [...(lead.cautionReasons || [])],
    checks: arr(lead.checks || []),
    notes: [
      `Quorum ready ${summaries.filter((item) => item.status === "ready").length}/${summaries.length}.`,
      ...(lead.notes || [])
    ]
  };
}

function buildHealth() {
  return {
    consecutiveFailures: 0,
    circuitOpen: false,
    reason: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    warnings: []
  };
}

export class TradingBot {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.store = new StateStore(config.runtimeDir);
    this.client = new BinanceClient({
      apiKey: config.binanceApiKey,
      apiSecret: config.binanceApiSecret,
      baseUrl: config.binanceApiBaseUrl,
      futuresBaseUrl: config.binanceFuturesApiBaseUrl,
      recvWindow: config.binanceRecvWindow,
      clockSyncSampleCount: config.clockSyncSampleCount,
      clockSyncMaxAgeMs: config.clockSyncMaxAgeMs,
      clockSyncMaxRttMs: config.clockSyncMaxRttMs,
      logger
    });
    this.risk = new RiskManager(config);
    this.health = new HealthMonitor(config, logger);
    this.driftMonitor = new DriftMonitor(config, logger);
    this.selfHeal = new SelfHealManager(config, logger);
    this.portfolio = new PortfolioOptimizer(config);
    this.execution = new ExecutionEngine(config);
    this.referenceVenue = new ReferenceVenueService(config, logger);
    this.committee = new MultiAgentCommittee(config);
    this.rlPolicy = new ReinforcementExecutionPolicy(undefined, config);
    this.strategyOptimizer = new StrategyOptimizer(config);
    this.parameterGovernor = new ParameterGovernor(config);
    this.strategyAttribution = new StrategyAttribution(config);
    this.exitIntelligence = new ExitIntelligence(config);
    this.metaGate = new MetaDecisionGate(config);
    this.researchRegistry = new ResearchRegistry(config);
    this.strategyResearchMiner = new StrategyResearchMiner(config, logger);
    this.modelRegistry = new ModelRegistry(config);
    this.dataRecorder = new DataRecorder({ runtimeDir: config.runtimeDir, config, logger });
    this.backupManager = new StateBackupManager({ runtimeDir: config.runtimeDir, config, logger });
    this.pairHealthMonitor = new PairHealthMonitor(config);
    this.divergenceMonitor = new DivergenceMonitor(config);
    this.offlineTrainer = new OfflineTrainer(config);
    this.universeSelector = new UniverseSelector(config);
    this.capitalLadder = new CapitalLadder(config);
    this.stream = new StreamCoordinator({ client: this.client, config, logger });
    this.symbolRules = {};
    this.marketCache = {};
  }

  applyHistoricalBootstrap(bootstrap = null) {
    if (!bootstrap || bootstrap.status === "empty") {
      return;
    }
    this.runtime.historicalBootstrap = bootstrap;
    this.runtime.ops = this.runtime.ops || {};
    this.runtime.ops.historicalBootstrap = {
      status: bootstrap.status || "ready",
      generatedAt: bootstrap.generatedAt || null,
      warmStart: bootstrap.warmStart || null
    };
    if (!this.runtime.paperLearning || !arr(this.runtime.paperLearning.notes || []).length) {
      this.runtime.paperLearning = {
        ...(this.runtime.paperLearning || {}),
        notes: [bootstrap.warmStart?.note].filter(Boolean)
      };
    } else if (bootstrap.warmStart?.note) {
      this.runtime.paperLearning.notes = [bootstrap.warmStart.note, ...arr(this.runtime.paperLearning.notes || [])].slice(0, 6);
    }
    if (!this.runtime.thresholdTuning?.warmStart) {
      this.runtime.thresholdTuning = {
        ...(this.runtime.thresholdTuning || {}),
        warmStart: {
          source: "data_recorder",
          focus: bootstrap.warmStart?.governanceFocus || null,
          generatedAt: bootstrap.generatedAt || null
        }
      };
    }
  }

  async init() {
    const validation = assertValidConfig(this.config);
    for (const warning of validation.warnings) {
      this.logger.warn("Configuration warning", { warning });
    }

    await this.store.init();
    this.runtime = await this.store.loadRuntime();
    this.runtime.openPositions = arr(this.runtime.openPositions);
    this.runtime.latestDecisions = arr(this.runtime.latestDecisions);
    this.runtime.newsCache = this.runtime.newsCache || {};
    this.runtime.exchangeNoticeCache = this.runtime.exchangeNoticeCache || {};
    this.runtime.marketStructureCache = this.runtime.marketStructureCache || {};
    this.runtime.marketSentimentCache = this.runtime.marketSentimentCache || null;
    this.runtime.volatilityContextCache = this.runtime.volatilityContextCache || null;
    this.runtime.calendarCache = this.runtime.calendarCache || null;
    this.runtime.health = this.runtime.health || buildHealth();
    this.runtime.executionPolicyState = this.runtime.executionPolicyState || null;
    this.runtime.aiTelemetry = this.runtime.aiTelemetry || {};
    this.runtime.marketSentiment = this.runtime.marketSentiment || {};
    this.runtime.volatilityContext = this.runtime.volatilityContext || {};
    this.runtime.onChainLite = this.runtime.onChainLite || summarizeOnChainLite(EMPTY_ONCHAIN);
    this.runtime.sourceReliability = this.runtime.sourceReliability || summarizeSourceReliability({});
    this.runtime.pairHealth = this.runtime.pairHealth || summarizePairHealth({});
    this.runtime.divergence = this.runtime.divergence || summarizeDivergenceSummary({});
    this.runtime.offlineTrainer = this.runtime.offlineTrainer || summarizeOfflineTrainer({});
    this.runtime.shadowTrading = this.runtime.shadowTrading || {};
    this.runtime.strategyResearch = this.runtime.strategyResearch || {};
    this.runtime.thresholdTuning = this.runtime.thresholdTuning || {};
    this.runtime.parameterGovernor = this.runtime.parameterGovernor || {};
    this.runtime.executionCalibration = this.runtime.executionCalibration || {};
    this.runtime.venueConfirmation = this.runtime.venueConfirmation || {};
    this.runtime.capitalLadder = this.runtime.capitalLadder || {};
    this.runtime.capitalGovernor = this.runtime.capitalGovernor || {};
    this.runtime.exchangeTruth = this.runtime.exchangeTruth || {};
    this.runtime.exchangeSafety = this.runtime.exchangeSafety || {};
    this.runtime.exchangeCapabilities = summarizeExchangeCapabilities(this.config.exchangeCapabilities || {});
    this.runtime.executionCost = this.runtime.executionCost || {};
    this.runtime.strategyRetirement = this.runtime.strategyRetirement || {};
    this.runtime.replayChaos = this.runtime.replayChaos || {};
    this.runtime.orderLifecycle = this.runtime.orderLifecycle || { lastUpdatedAt: null, positions: {}, recentTransitions: [], pendingActions: [], activeActions: {}, actionJournal: [] };
    this.runtime.ops = this.runtime.ops || {
      lastUpdatedAt: null,
      incidentTimeline: [],
      runbooks: [],
      performanceChange: null,
      readiness: null,
      alerts: { count: 0, activeCount: 0, criticalCount: 0, status: "clear", alerts: [] },
      alertState: { acknowledgedAtById: {}, silencedUntilById: {}, resolvedAtById: {}, delivery: { lastDeliveryAt: null, lastError: null, lastDeliveredAtById: {} } },
      alertDelivery: summarizeAlertDelivery({}),
      replayChaos: null
    };
    this.runtime.ops.alertState = this.runtime.ops.alertState || { acknowledgedAtById: {}, silencedUntilById: {}, resolvedAtById: {}, delivery: { lastDeliveryAt: null, lastError: null, lastDeliveredAtById: {} } };
    this.runtime.ops.alertState.acknowledgedAtById = this.runtime.ops.alertState.acknowledgedAtById || {};
    this.runtime.ops.alertState.silencedUntilById = this.runtime.ops.alertState.silencedUntilById || {};
    this.runtime.ops.alertState.resolvedAtById = this.runtime.ops.alertState.resolvedAtById || {};
    this.runtime.ops.alertState.delivery = this.runtime.ops.alertState.delivery || { lastDeliveryAt: null, lastError: null, lastDeliveredAtById: {} };
    this.runtime.ops.alertDelivery = this.runtime.ops.alertDelivery || summarizeAlertDelivery({});
    this.runtime.service = this.runtime.service || { lastHeartbeatAt: null, watchdogStatus: "idle", restartBackoffSeconds: null, lastExitCode: null, statusFile: null };
    this.runtime.counterfactualQueue = arr(this.runtime.counterfactualQueue);
    this.runtime.session = this.runtime.session || {};
    this.runtime.drift = this.runtime.drift || {};
    this.runtime.selfHeal = this.runtime.selfHeal || this.selfHeal.buildDefaultState();
    this.runtime.latestBlockedSetups = arr(this.runtime.latestBlockedSetups);
    this.runtime.universe = this.runtime.universe || summarizeUniverseSelection({});
    this.runtime.strategyAttribution = this.runtime.strategyAttribution || summarizeAttributionSnapshot({});
    this.runtime.researchRegistry = this.runtime.researchRegistry || summarizeResearchRegistry({});
    this.runtime.researchLab = this.runtime.researchLab || { lastRunAt: null, latestSummary: null };
    this.runtime.watchlistSummary = this.runtime.watchlistSummary || null;
    this.runtime.stream = this.runtime.stream || this.stream.getStatus();
    this.runtime.lastKnownBalance = Number.isFinite(this.runtime.lastKnownBalance) ? this.runtime.lastKnownBalance : null;
    this.runtime.lastKnownEquity = Number.isFinite(this.runtime.lastKnownEquity) ? this.runtime.lastKnownEquity : null;
    this.modelBackups = arr(await this.store.loadModelBackups());
    this.journal = await this.store.loadJournal();
    this.journal.trades = arr(this.journal.trades);
    this.journal.scaleOuts = arr(this.journal.scaleOuts);
    this.journal.blockedSetups = arr(this.journal.blockedSetups);
    this.journal.universeRuns = arr(this.journal.universeRuns);
    this.journal.researchRuns = arr(this.journal.researchRuns);
    this.journal.counterfactuals = arr(this.journal.counterfactuals);
    this.journal.equitySnapshots = arr(this.journal.equitySnapshots);
    this.journal.cycles = arr(this.journal.cycles);
    this.journal.events = arr(this.journal.events);

    await this.dataRecorder.init(this.runtime.dataRecorder || null);
    const historicalBootstrap = await this.dataRecorder.loadHistoricalBootstrap();
    await this.backupManager.init(this.runtime.stateBackups || null);
    this.applyHistoricalBootstrap(historicalBootstrap);
    this.runtime.dataRecorder = this.dataRecorder.getSummary();
    this.runtime.stateBackups = this.backupManager.getSummary();
    this.model = new AdaptiveTradingModel(await this.store.loadModel(), this.config);
    this.rlPolicy = new ReinforcementExecutionPolicy(this.runtime.executionPolicyState, this.config);
    this.news = new NewsService({
      config: this.config,
      runtime: this.runtime,
      logger: this.logger,
      recordEvent: this.recordEvent.bind(this),
      recordHistory: this.dataRecorder.recordNewsHistory.bind(this.dataRecorder)
    });
    this.exchangeNotices = new BinanceAnnouncementService({
      config: this.config,
      runtime: this.runtime,
      logger: this.logger,
      recordHistory: this.dataRecorder.recordContextHistory.bind(this.dataRecorder)
    });
    this.calendar = new CalendarService({
      config: this.config,
      runtime: this.runtime,
      logger: this.logger,
      recordHistory: this.dataRecorder.recordContextHistory.bind(this.dataRecorder)
    });
    this.marketStructure = new MarketStructureService({ client: this.client, config: this.config, runtime: this.runtime, logger: this.logger });
    this.marketSentiment = new MarketSentimentService({ config: this.config, runtime: this.runtime, logger: this.logger });
    this.onChainLite = new OnChainLiteService({ config: this.config, runtime: this.runtime, logger: this.logger });
    this.volatility = new VolatilityService({ config: this.config, runtime: this.runtime, logger: this.logger });
    this.runtime.strategyAttribution = summarizeAttributionSnapshot(
      this.strategyAttribution.buildSnapshot({ journal: this.journal, nowIso: nowIso() })
    );
    this.runtime.researchRegistry = summarizeResearchRegistry(
      this.researchRegistry.buildRegistry({
        journal: this.journal,
        latestSummary: this.runtime.researchLab?.latestSummary || null,
        modelBackups: this.modelBackups || [],
        nowIso: nowIso()
      })
    );

    await this.client.ping();
    await this.client.syncServerTime(true);

    if (this.config.enableDynamicWatchlist) {
      try {
        const resolvedWatchlist = await resolveDynamicWatchlist({
          client: this.client,
          config: this.config,
          logger: this.logger
        });
        if (resolvedWatchlist?.watchlist?.length) {
          this.config.watchlist = resolvedWatchlist.watchlist;
          this.config.symbolMetadata = { ...(this.config.symbolMetadata || {}), ...(resolvedWatchlist.symbolMetadata || {}) };
          this.config.symbolProfiles = { ...(this.config.symbolProfiles || {}), ...(resolvedWatchlist.symbolProfiles || {}) };
          this.config.marketCapRanks = { ...(this.config.marketCapRanks || {}), ...(resolvedWatchlist.marketCapRanks || {}) };
          this.runtime.watchlistSummary = resolvedWatchlist.summary;
          this.stream.setWatchlist(this.config.watchlist);
          this.logger.info("Dynamic watchlist resolved", {
            source: resolvedWatchlist.summary?.source || "unknown",
            symbols: resolvedWatchlist.watchlist.length
          });
        }
      } catch (error) {
        this.runtime.watchlistSummary = {
          enabled: false,
          source: "configured_watchlist",
          targetCount: this.config.watchlistTopN,
          resolvedCount: this.config.watchlist.length,
          generatedAt: nowIso(),
          notes: [`Dynamic watchlist fallback: ${error.message}`],
          topSymbols: this.config.watchlist.slice(0, 12).map((symbol, index) => ({
            symbol,
            name: symbol.replace(/USDT$/, ""),
            marketCapRank: index + 1,
            source: "configured_watchlist"
          }))
        };
        this.logger.warn("Dynamic watchlist resolution failed", { error: error.message });
      }
    }

    if (!this.runtime.watchlistSummary) {
      this.runtime.watchlistSummary = {
        enabled: false,
        source: "configured_watchlist",
        targetCount: this.config.watchlist.length,
        resolvedCount: this.config.watchlist.length,
        generatedAt: nowIso(),
        notes: ["Handmatige watchlist actief."],
        topSymbols: this.config.watchlist.slice(0, 12).map((symbol, index) => ({
          symbol,
          name: symbol.replace(/USDT$/, ""),
          marketCapRank: index + 1,
          source: "configured_watchlist"
        }))
      };
    }

    const exchangeInfo = await this.client.getExchangeInfo(this.config.watchlist);
    this.symbolRules = buildSymbolRules(exchangeInfo, this.config.baseQuoteAsset);
    if (!Object.keys(this.symbolRules).length) {
      throw new Error("No tradeable symbols were returned by Binance exchangeInfo.");
    }

    this.broker = this.config.botMode === "live"
      ? new LiveBroker({ client: this.client, config: this.config, logger: this.logger, symbolRules: this.symbolRules, stream: this.stream })
      : new PaperBroker(this.config, this.logger);

    try {
      await this.stream.init();
    } catch (error) {
      this.logger.warn("Stream initialization failed", { error: error.message });
      this.recordEvent("stream_init_failed", { error: error.message });
    }
    this.runtime.stream = this.stream.getStatus();

    const driftIssues = this.health.enforceClockDrift(this.client, this.runtime);
    if (driftIssues.length && this.config.botMode === "live") {
      throw new Error(`Clock drift too large for live mode: ${driftIssues.join(", ")}`);
    }

    const doctor = await this.broker.doctor(this.runtime);
    if (this.config.botMode === "live") {
      if (!doctor.canTrade) {
        throw new Error("Binance account reports canTrade=false.");
      }
      if (!doctor.permissions?.includes("SPOT")) {
        throw new Error("Binance account does not report SPOT permission.");
      }
    }

    const reconciliation = await this.broker.reconcileRuntime({
      runtime: this.runtime,
      journal: this.journal,
      getMarketSnapshot: this.getMarketSnapshot.bind(this)
    });
    await this.applyReconciliation(reconciliation);
    this.syncOrderLifecycleState("init_reconciliation");
    this.refreshOperationalViews({ report: buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config }), nowIso: nowIso() });
    await this.persist();
  }

  async getTimeframeSnapshot(symbol, interval, limit) {
    if (!interval || interval === this.config.klineInterval) {
      return null;
    }
    const rawKlines = await this.client.getKlines(symbol, interval, limit);
    const candles = normalizeKlines(rawKlines);
    return { interval, candles, market: computeMarketFeatures(candles) };
  }

  queueCounterfactualCandidate(candidate, queuedAt) {
    if (!candidate || candidate.decision?.allow) {
      return;
    }
    const entryPrice = Number(candidate.marketSnapshot?.book?.mid || 0);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return;
    }
    const dueAt = new Date(new Date(queuedAt).getTime() + Math.max(5, this.config.counterfactualLookaheadMinutes || 90) * 60000).toISOString();
    this.runtime.counterfactualQueue = [...(this.runtime.counterfactualQueue || []), {
      id: crypto.randomUUID(),
      symbol: candidate.symbol,
      queuedAt,
      dueAt,
      entryPrice,
      probability: candidate.score?.probability || 0,
      threshold: candidate.decision?.threshold || 0,
      strategy: candidate.strategySummary?.activeStrategy || null,
      strategyFamily: candidate.strategySummary?.family || null,
      regime: candidate.regimeSummary?.regime || null,
      marketPhase: candidate.marketStateSummary?.phase || null,
      blockerReasons: [...(candidate.decision?.reasons || [])].slice(0, 6),
      learningLane: candidate.decision?.learningLane || null,
      learningValueScore: num(candidate.decision?.learningValueScore || 0, 4),
      executionStyle: candidate.decision?.executionPlan?.entryStyle || null,
      signalQuality: candidate.signalQualitySummary?.overallScore || 0,
      executionViability: candidate.signalQualitySummary?.executionViability || 0,
      modelConfidence: candidate.confidenceBreakdown?.modelConfidence || 0
    }].slice(-(this.config.counterfactualQueueLimit || 40));
  }

  async resolveCounterfactualQueue(nowAt = nowIso(), snapshotMap = {}) {
    const due = [];
    const pending = [];
    const nowMs = new Date(nowAt).getTime();
    for (const item of arr(this.runtime.counterfactualQueue)) {
      const dueMs = new Date(item.dueAt || item.queuedAt || 0).getTime();
      if (Number.isFinite(dueMs) && dueMs <= nowMs) {
        due.push(item);
      } else {
        pending.push(item);
      }
    }
    this.runtime.counterfactualQueue = pending;
    for (const item of due) {
      try {
        const snapshot = snapshotMap[item.symbol] || this.marketCache[item.symbol] || await this.getMarketSnapshot(item.symbol);
        const currentPrice = Number(snapshot?.book?.mid || 0);
        if (!Number.isFinite(currentPrice) || !Number.isFinite(item.entryPrice) || item.entryPrice <= 0) {
          continue;
        }
        const realizedMovePct = currentPrice / item.entryPrice - 1;
        const winBar = Math.max(this.config.scaleOutTriggerPct || 0.014, (this.config.takeProfitPct || 0.03) * 0.35);
        const lossBar = -Math.max((this.config.stopLossPct || 0.018) * 0.5, 0.006);
        const outcome = realizedMovePct >= winBar
          ? (item.executionViability || 0) < 0.46 || (item.modelConfidence || 0) < 0.5
            ? "right_direction_wrong_timing"
            : "bad_veto"
          : realizedMovePct <= lossBar
            ? "good_veto"
            : realizedMovePct > 0 && realizedMovePct < winBar
              ? "late_veto"
              : "neutral";
        this.journal.counterfactuals.push({
          ...item,
          resolvedAt: nowAt,
          currentPrice,
          realizedMovePct: num(realizedMovePct, 4),
          outcome
        });
      } catch (error) {
        this.recordEvent("counterfactual_resolution_failed", { symbol: item.symbol, error: error.message });
      }
    }
    if (this.journal.counterfactuals.length > 1000) {
      this.journal.counterfactuals = this.journal.counterfactuals.slice(-1000);
    }
  }

  async close() {
    this.runtime.stream = this.stream.getStatus();
    this.runtime.lifecycle = this.runtime.lifecycle || {};
    this.runtime.lifecycle.activeRun = false;
    this.runtime.lifecycle.lastShutdownAt = nowIso();
    this.runtime.service = {
      ...(this.runtime.service || {}),
      lastHeartbeatAt: nowIso(),
      watchdogStatus: "stopped"
    };
    this.runtime.recovery = {
      ...(this.runtime.recovery || {}),
      uncleanShutdownDetected: false,
      latestBackupAt: this.backupManager.getSummary().lastBackupAt || this.runtime.recovery?.latestBackupAt || null
    };
    await this.backupManager.maybeBackup({
      runtime: this.runtime,
      journal: this.journal,
      modelState: this.model.getState(),
      modelBackups: this.modelBackups,
      modelRegistry: this.runtime.modelRegistry
    }, { reason: "shutdown", force: true, nowIso: nowIso() }).catch(() => {});
    this.runtime.stateBackups = this.backupManager.getSummary();
    this.syncOrderLifecycleState("shutdown");
    this.refreshOperationalViews({ nowIso: nowIso() });
    await this.persist().catch(() => {});
    await this.stream.close().catch(() => {});
  }

  async persist() {
    this.runtime.stream = this.stream.getStatus();
    this.runtime.executionPolicyState = this.rlPolicy.getState();
    this.runtime.dataRecorder = this.dataRecorder.getSummary();
    this.runtime.stateBackups = this.backupManager.getSummary();
    await this.store.saveRuntime(this.runtime);
    await this.store.saveJournal(this.journal);
    await this.store.saveModel(this.model.getState());
    await this.store.saveModelBackups(this.modelBackups || []);
  }

  recordEvent(type, payload) {
    this.journal.events.push({ at: nowIso(), type, ...payload });
  }

  resetExecutionPolicy(reason = "self_heal") {
    this.rlPolicy = new ReinforcementExecutionPolicy(undefined, this.config);
    this.runtime.executionPolicyState = null;
    this.recordEvent("execution_policy_reset", { reason });
  }

  maybeCaptureStableModelSnapshot(reason = "stable_model", report = null, force = false) {
    if (!this.config.selfHealRestoreStableModel) {
      return null;
    }
    const evaluation = report || buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config });
    const allTime = evaluation.windows?.allTime || evaluation;
    const calibration = this.model.getCalibrationSummary();
    const latest = this.modelBackups[0] || null;
    const latestAgeMs = latest?.at ? Date.now() - new Date(latest.at).getTime() : Number.MAX_SAFE_INTEGER;
    if (!force) {
      if ((allTime.tradeCount || 0) < this.config.stableModelMinTrades) {
        return null;
      }
      if ((calibration.expectedCalibrationError || 1) > this.config.stableModelMaxCalibrationEce) {
        return null;
      }
      if ((allTime.winRate || 0) < this.config.stableModelMinWinRate && (allTime.realizedPnl || 0) <= 0) {
        return null;
      }
      if (latestAgeMs < 6 * 3_600_000) {
        return null;
      }
    }
    const snapshot = this.modelRegistry.createSnapshot({
      reason,
      report: evaluation,
      calibration,
      deployment: this.model.getDeploymentSummary(),
      modelState: this.model.getState(),
      source: "runtime",
      nowIso: nowIso()
    });
    this.modelBackups = [snapshot, ...this.modelBackups].slice(0, this.config.stableModelMaxSnapshots);
    this.recordEvent("stable_model_snapshot", { reason, snapshotAt: snapshot.at, tradeCount: snapshot.tradeCount, winRate: snapshot.winRate });
    return snapshot;
  }

  restoreLatestStableModel(reason = "self_heal_restore") {
    const preferred = this.modelRegistry.chooseRollback(this.modelBackups || []);
    const snapshot = (this.modelBackups || []).find((item) => item.at === preferred?.at) || this.modelBackups[0];
    if (!snapshot?.modelState) {
      return null;
    }
    this.model = new AdaptiveTradingModel(snapshot.modelState, this.config);
    this.recordEvent("stable_model_restored", { reason, snapshotAt: snapshot.at });
    return snapshot;
  }

  collectScopedThresholdTrades(scope = {}, { beforeAt = null, afterAt = null } = {}) {
    return arr(this.journal.trades || [])
      .filter((trade) => trade.exitAt)
      .filter((trade) => {
        const exitMs = new Date(trade.exitAt || 0).getTime();
        if (!Number.isFinite(exitMs)) {
          return false;
        }
        if (beforeAt && exitMs >= new Date(beforeAt).getTime()) {
          return false;
        }
        if (afterAt && exitMs <= new Date(afterAt).getTime()) {
          return false;
        }
        const strategies = scope.affectedStrategies || [];
        const regimes = scope.affectedRegimes || [];
        const strategyId = trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || null;
        const regimeId = trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || null;
        const strategyMatch = !strategies.length || (strategyId && strategies.includes(strategyId));
        const regimeMatch = !regimes.length || (regimeId && regimes.includes(regimeId));
        return strategyMatch || regimeMatch;
      });
  }

  buildThresholdExperimentSnapshot(scope = {}, options = {}) {
    const sampleSize = this.config.thresholdProbationMinTrades || 6;
    const trades = this.collectScopedThresholdTrades(scope, options).slice(-sampleSize);
    const tradeCount = trades.length;
    const winRate = tradeCount ? trades.filter((trade) => (trade.pnlQuote || 0) > 0).length / tradeCount : 0;
    const avgPnlPct = tradeCount ? trades.reduce((total, trade) => total + (trade.netPnlPct || 0), 0) / tradeCount : 0;
    return {
      tradeCount,
      winRate: num(winRate, 4),
      avgPnlPct: num(avgPnlPct, 4)
    };
  }

  updateThresholdTuningState(offlineTrainerSummary = {}, referenceNow = nowIso()) {
    const previous = this.runtime.thresholdTuning || {};
    const policy = offlineTrainerSummary.thresholdPolicy || {};
    const next = {
      ...previous,
      status: policy.status || previous.status || "stable",
      relaxCount: policy.relaxCount || 0,
      tightenCount: policy.tightenCount || 0,
      netThresholdShift: num(policy.netThresholdShift || 0, 4),
      topRecommendation: policy.topRecommendation || null,
      recommendations: arr(policy.recommendations || []).slice(0, 6),
      notes: [...(policy.notes || [])],
      history: arr(previous.history || []).slice(0, 12),
      appliedRecommendation: previous.appliedRecommendation || null,
      activeThresholdShift: num(previous.activeThresholdShift || 0, 4)
    };
    const probationTrades = this.config.thresholdProbationMinTrades || 6;
    const probationWindowMs = (this.config.thresholdProbationWindowDays || 7) * 86_400_000;
    const active = next.appliedRecommendation;

    if (active?.status === "probation") {
      const reviewed = this.buildThresholdExperimentSnapshot(active, { afterAt: active.appliedAt });
      const ageMs = Math.max(0, new Date(referenceNow).getTime() - new Date(active.appliedAt || referenceNow).getTime());
      if (reviewed.tradeCount >= probationTrades || ageMs >= probationWindowMs) {
        const baseline = active.baseline || { tradeCount: 0, avgPnlPct: 0, winRate: 0 };
        const avgPnlDrop = (baseline.avgPnlPct || 0) - (reviewed.avgPnlPct || 0);
        const winRateDrop = (baseline.winRate || 0) - (reviewed.winRate || 0);
        if (
          reviewed.tradeCount &&
          (
            avgPnlDrop > (this.config.thresholdProbationMaxAvgPnlDropPct || 0.01) ||
            winRateDrop > (this.config.thresholdProbationMaxWinRateDrop || 0.08)
          )
        ) {
          next.history.unshift({ ...active, status: "rolled_back", reviewedAt: referenceNow, review: reviewed, baseline });
          next.appliedRecommendation = null;
          next.activeThresholdShift = 0;
          next.status = "rolled_back";
          next.notes = [
            `${active.id} werd automatisch teruggedraaid na zwakkere probation-resultaten.`,
            ...next.notes
          ].slice(0, 8);
          this.recordEvent("threshold_tuning_rolled_back", {
            id: active.id,
            adjustment: active.adjustment || 0,
            avgPnlDrop,
            winRateDrop
          });
        } else if (reviewed.tradeCount) {
          next.appliedRecommendation = { ...active, status: "confirmed", reviewedAt: referenceNow, review: reviewed };
          next.activeThresholdShift = num(active.adjustment || 0, 4);
          next.history.unshift({ ...active, status: "confirmed", reviewedAt: referenceNow, review: reviewed, baseline });
          next.status = "confirmed";
          this.recordEvent("threshold_tuning_confirmed", {
            id: active.id,
            adjustment: active.adjustment || 0,
            tradeCount: reviewed.tradeCount
          });
        } else {
          next.history.unshift({ ...active, status: "expired", reviewedAt: referenceNow, review: reviewed });
          next.appliedRecommendation = null;
          next.activeThresholdShift = 0;
          next.status = policy.status || "observe";
        }
      } else {
        next.activeThresholdShift = num(active.adjustment || 0, 4);
        next.status = "probation";
      }
    } else if (active?.status === "confirmed") {
      next.activeThresholdShift = num(active.adjustment || 0, 4);
      next.status = "confirmed";
    } else {
      next.activeThresholdShift = 0;
    }

    if (!next.appliedRecommendation && this.config.thresholdAutoApplyEnabled) {
      const recentHistoryIds = new Set(arr(next.history || []).slice(0, 4).map((item) => `${item.id}:${item.status}`));
      const candidate = arr(policy.recommendations || []).find((item) =>
        (item.confidence || 0) >= (this.config.thresholdAutoApplyMinConfidence || 0.58) &&
        Math.abs(item.adjustment || 0) > 0 &&
        !recentHistoryIds.has(`${item.id}:rolled_back`)
      );
      if (candidate) {
        const baseline = this.buildThresholdExperimentSnapshot(candidate, { beforeAt: referenceNow });
        next.appliedRecommendation = {
          ...candidate,
          status: "probation",
          appliedAt: referenceNow,
          reviewDueAt: new Date(new Date(referenceNow).getTime() + probationWindowMs).toISOString(),
          baseline
        };
        next.activeThresholdShift = num(candidate.adjustment || 0, 4);
        next.status = "probation";
        this.recordEvent("threshold_tuning_applied", {
          id: candidate.id,
          adjustment: candidate.adjustment || 0,
          confidence: candidate.confidence || 0
        });
      }
    }

    next.history = arr(next.history || []).slice(0, 12);
    this.runtime.thresholdTuning = next;
    return next;
  }

  refreshGovernanceViews(referenceNow = nowIso()) {
    const report = buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config });
    const rawResearchRegistry = this.researchRegistry.buildRegistry({ journal: this.journal, latestSummary: this.runtime.researchLab?.latestSummary || null, modelBackups: this.modelBackups || [], nowIso: referenceNow });
    const divergenceSummary = this.divergenceMonitor.buildSummary({ journal: this.journal, nowIso: referenceNow });
    const offlineTrainerSummary = this.offlineTrainer.buildSummary({ journal: this.journal, dataRecorder: this.dataRecorder.getSummary(), counterfactuals: this.journal.counterfactuals || [], nowIso: referenceNow });
    const rawStrategyResearch = this.strategyResearchMiner.buildSummary({
      journal: this.journal,
      researchRegistry: rawResearchRegistry,
      offlineTrainer: offlineTrainerSummary,
      importedCandidates: this.runtime.strategyResearch?.importedCandidates || [],
      nowIso: referenceNow
    });
    const executionCalibration = this.execution.buildPaperCalibration({ journal: this.journal, nowIso: referenceNow });
    const parameterGovernor = this.parameterGovernor.buildSnapshot({ journal: this.journal, nowIso: referenceNow });
    this.runtime.strategyAttribution = summarizeAttributionSnapshot(this.strategyAttribution.buildSnapshot({ journal: this.journal, nowIso: referenceNow }));
    this.runtime.researchRegistry = summarizeResearchRegistry(rawResearchRegistry);
    this.runtime.divergence = summarizeDivergenceSummary(divergenceSummary);
    this.runtime.offlineTrainer = summarizeOfflineTrainer(offlineTrainerSummary);
    this.runtime.modelRegistry = summarizeModelRegistry(this.modelRegistry.buildRegistry({ snapshots: this.modelBackups || [], report, researchRegistry: rawResearchRegistry, calibration: this.model.getCalibrationSummary(), deployment: this.model.getDeploymentSummary(), divergenceSummary, offlineTrainer: offlineTrainerSummary, nowIso: referenceNow }));
    this.runtime.strategyResearch = rawStrategyResearch;
    this.runtime.parameterGovernor = summarizeParameterGovernor(parameterGovernor);
    this.runtime.executionCalibration = summarizeExecutionCalibration(executionCalibration);
    this.runtime.executionCost = summarizeExecutionCost(report.executionCostSummary || {});
    this.runtime.capitalGovernor = summarizeCapitalGovernor(buildCapitalGovernor({
      journal: this.journal,
      runtime: this.runtime,
      config: this.config,
      nowIso: referenceNow
    }));
    this.runtime.strategyRetirement = summarizeStrategyRetirement(buildStrategyRetirementSnapshot({
      report,
      offlineTrainer: offlineTrainerSummary,
      journal: this.journal,
      config: this.config,
      nowIso: referenceNow
    }));
    this.runtime.replayChaos = summarizeReplayChaos(buildReplayChaosSummary({
      journal: this.journal,
      nowIso: referenceNow
    }));
    void this.dataRecorder.recordDatasetCuration({
      at: referenceNow,
      journal: this.journal,
      newsCache: this.runtime.newsCache || {},
      sourceReliability: this.runtime.sourceReliability || {},
      paperLearning: this.runtime.paperLearning || this.runtime.ops?.paperLearning || {}
    }).catch((error) => {
      this.logger.warn("Dataset curation record failed", { error: error.message });
    });
    this.runtime.capitalLadder = summarizeCapitalLadder(this.capitalLadder.buildSnapshot({
      botMode: this.config.botMode,
      modelRegistry: this.runtime.modelRegistry || {},
      strategyResearch: summarizeStrategyResearch(this.runtime.strategyResearch || {}),
      deployment: this.model.getDeploymentSummary(),
      report,
      nowIso: referenceNow
    }));
    this.runtime.dataRecorder = this.dataRecorder.getSummary();
    this.runtime.stateBackups = this.backupManager.getSummary();
    this.runtime.sourceReliability = summarizeSourceReliability(this.runtime.sourceReliability || {});
    this.updateThresholdTuningState(offlineTrainerSummary, referenceNow);
    this.syncOrderLifecycleState("governance_refresh");
    this.refreshOperationalViews({ report, nowIso: referenceNow });
    return { report, rawResearchRegistry, rawStrategyResearch, divergenceSummary, offlineTrainerSummary, executionCalibration, parameterGovernor };
  }

  syncOrderLifecycleState(reason = "runtime_sync") {
    const lifecycle = this.runtime.orderLifecycle || { lastUpdatedAt: null, positions: {}, recentTransitions: [], pendingActions: [], activeActions: {}, actionJournal: [] };
    const previousPositions = lifecycle.positions && typeof lifecycle.positions === "object" ? lifecycle.positions : {};
    const nextPositions = {};
    const transitions = arr(lifecycle.recentTransitions);
    const activeActions = lifecycle.activeActions && typeof lifecycle.activeActions === "object" ? lifecycle.activeActions : {};
    const previousActiveActions = lifecycle.activeActionsPrevious && typeof lifecycle.activeActionsPrevious === "object"
      ? lifecycle.activeActionsPrevious
      : {};
    const tradeIndex = new Map(arr(this.journal.trades).slice(-120).map((trade) => [trade.id, trade]));
    const transitionAt = nowIso();

    const pushTransition = ({ symbol, id, state, previousState = null, detail = null, severity = "neutral" } = {}) => {
      transitions.unshift({
        at: transitionAt,
        id: id || null,
        symbol: symbol || null,
        state: state || null,
        previousState,
        detail,
        severity
      });
    };

    for (const position of arr(this.runtime.openPositions)) {
      const previous = previousPositions[position.id] || {};
      const state = position.manualReviewRequired
        ? "manual_review"
        : position.operatorMode === "protect_only"
          ? "protect_only"
          : position.reconcileRequired
            ? "reconcile_required"
            : position.lifecycleState || (
              (position.brokerMode || this.config.botMode) === "live"
                ? (position.protectiveOrderListId ? "protected" : "open")
                : "simulated_open"
            );
      const view = {
        id: position.id,
        symbol: position.symbol,
        state,
        brokerMode: position.brokerMode || this.config.botMode,
        entryAt: position.entryAt || null,
        lastTransitionAt: previous.state !== state ? transitionAt : previous.lastTransitionAt || position.entryAt || transitionAt,
        protectiveOrderListId: position.protectiveOrderListId || null,
        operatorMode: position.operatorMode || "normal",
        failureCount: position.managementFailureCount || 0,
        manualReviewRequired: Boolean(position.manualReviewRequired),
        reconcileRequired: Boolean(position.reconcileRequired),
        recoveryAction: resolveLifecycleRecoveryAction(state, position)
      };
      nextPositions[position.id] = view;
      if (previous.state !== state) {
        pushTransition({
          symbol: position.symbol,
          id: position.id,
          state,
          previousState: previous.state || null,
          detail: reason,
          severity: ["manual_review", "reconcile_required"].includes(state)
            ? "negative"
            : ["protect_only", "protection_pending"].includes(state)
              ? "neutral"
              : "positive"
        });
      }
    }

    for (const [id, previous] of Object.entries(previousPositions)) {
      if (nextPositions[id]) {
        continue;
      }
      const trade = tradeIndex.get(id) || null;
      pushTransition({
        symbol: previous.symbol || trade?.symbol || null,
        id,
        state: trade ? "closed" : "removed",
        previousState: previous.state || null,
        detail: trade?.reason || reason,
        severity: trade && (trade.pnlQuote || 0) < 0 ? "negative" : "neutral"
      });
    }

    lifecycle.positions = nextPositions;
    lifecycle.lastUpdatedAt = transitionAt;
    lifecycle.recentTransitions = transitions.slice(0, 60);
    lifecycle.activeActions = activeActions;
    lifecycle.actionJournal = arr(lifecycle.actionJournal || []).slice(0, 80);
    const completedActionIds = new Set(lifecycle.actionJournal.map((item) => item.id).filter(Boolean));
    const currentActionIds = new Set(Object.keys(activeActions));
    for (const [actionId, previousAction] of Object.entries(previousActiveActions)) {
      if (currentActionIds.has(actionId) || completedActionIds.has(actionId)) {
        continue;
      }
      lifecycle.actionJournal.unshift({
        ...previousAction,
        completedAt: transitionAt,
        updatedAt: transitionAt,
        status: "disappeared",
        severity: "negative",
        error: "pending action disappeared without completion journal",
        detail: previousAction.detail || reason,
        recoveryAction: resolveLifecycleRecoveryAction(previousAction.stage || "reconcile_required", previousAction, previousAction)
      });
    }
    lifecycle.actionJournal = lifecycle.actionJournal.slice(0, 80);
    const stateActions = Object.values(nextPositions)
      .filter((item) => ["protect_only", "manual_review", "reconcile_required", "protection_pending"].includes(item.state))
      .map((item) => ({
        id: item.id,
        symbol: item.symbol,
        state: item.state,
        action: item.state === "manual_review"
          ? "manual_review"
          : item.state === "reconcile_required"
            ? "reconcile_exchange_position"
            : item.state === "protect_only"
              ? "protect_only_monitoring"
              : "rebuild_protection",
        reason: item.state === "protection_pending"
          ? "protective_order_missing"
          : item.state,
        severity: ["manual_review", "reconcile_required"].includes(item.state) ? "negative" : "neutral",
        recoveryAction: item.recoveryAction || resolveLifecycleRecoveryAction(item.state, item)
      }));
    const activeLifecycleActions = Object.values(activeActions).map((item) => ({
      id: item.id || null,
      symbol: item.symbol || null,
      state: item.stage || "pending",
      action: item.type || "exchange_action",
      reason: item.detail || item.type || "pending_exchange_action",
      severity: item.severity || "neutral",
      recoveryAction: item.recoveryAction || resolveLifecycleRecoveryAction(item.stage || "pending", item, item)
    }));
    lifecycle.pendingActions = [...activeLifecycleActions, ...stateActions].slice(0, 12);
    lifecycle.activeActionsPrevious = Object.fromEntries(Object.entries(activeActions).map(([id, item]) => [id, { ...item }]));
    this.runtime.orderLifecycle = lifecycle;
    return lifecycle;
  }

  buildIncidentTimeline(referenceNow = nowIso()) {
    const referenceMs = new Date(referenceNow).getTime();
    const cutoffMs = referenceMs - 48 * 3_600_000;
    const eventEntries = arr(this.journal.events || []).map((event) => ({
      at: event.at || null,
      type: event.type || "event",
      symbol: event.symbol || null,
      detail: event.error || event.rationale || event.reason || event.issue || null,
      severity: /fail|error|blocked|warning|reconcile|stale|freeze/i.test(event.type || "")
        ? "negative"
        : /scaled|opened|restored|snapshot|research/i.test(event.type || "")
          ? "positive"
          : "neutral"
    }));
    const warningEntries = arr(this.runtime.health?.warnings || []).map((warning) => ({
      at: warning.at || null,
      type: (warning.issues || [])[0] || "health_warning",
      symbol: warning.symbol || null,
      detail: warning.error || (warning.issues || []).join(", "),
      severity: "negative"
    }));
    const actionEntries = arr(this.runtime.orderLifecycle?.actionJournal || []).map((action) => ({
      at: action.completedAt || action.updatedAt || action.startedAt || null,
      type: `${action.type || "exchange_action"}_${action.status || "completed"}`,
      symbol: action.symbol || null,
      detail: action.error || action.detail || action.stage || null,
      severity: action.severity || ((action.status || "") === "failed" ? "negative" : "neutral")
    }));
    return [...eventEntries, ...warningEntries, ...actionEntries]
      .filter((item) => {
        const atMs = new Date(item.at || 0).getTime();
        return Number.isFinite(atMs) && atMs >= cutoffMs;
      })
      .sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime())
      .slice(0, 16);
  }

  buildOperatorRunbooks(report) {
    const runbooks = [];
    const exchangeTruth = this.runtime.exchangeTruth || {};
    const exchangeSafety = this.runtime.exchangeSafety || {};
    const lifecycle = this.runtime.orderLifecycle || {};
    const health = this.runtime.health || {};
    const selfHeal = this.runtime.selfHeal || {};
    const qualityQuorum = this.runtime.qualityQuorum || {};
    const drift = this.runtime.drift || {};
    const venueConfirmation = this.runtime.venueConfirmation || {};
    const capitalLadder = this.runtime.capitalLadder || {};
    const capitalGovernor = this.runtime.capitalGovernor || {};
    const alertDelivery = this.runtime.ops?.alertDelivery || {};
    const strategyResearch = this.runtime.strategyResearch || {};
    const strategyRetirement = this.runtime.strategyRetirement || {};
    const executionCost = this.runtime.executionCost || {};
    const replayChaos = this.runtime.replayChaos || {};

    if (exchangeTruth.freezeEntries) {
      runbooks.push({
        id: "exchange_truth_freeze",
        severity: "negative",
        title: "Nieuwe entries bevriezen",
        reason: exchangeTruth.notes?.[0] || "Exchange/runtime inventory mismatch.",
        action: "Laat alleen reconcile, beschermingsherstel en exits lopen tot de inventory weer matcht."
      });
    }
    if ((exchangeSafety.status || "") === "blocked") {
      runbooks.push({
        id: "exchange_safety_blocked",
        severity: "negative",
        title: "Exchange safety audit blokkeert entries",
        reason: exchangeSafety.notes?.[0] || "Een onafhankelijke exchange safety audit detecteerde te veel runtime-risico.",
        action: exchangeSafety.actions?.[0] || "Voer eerst reconcile en protective herstel uit."
      });
    }
    if ((lifecycle.pendingActions || []).some((item) => item.state === "manual_review")) {
      runbooks.push({
        id: "manual_review_positions",
        severity: "negative",
        title: "Positie in manual review",
        reason: "Een open positie had meerdere management-fouten.",
        action: "Controleer exchange orders, protective orders en open exposure voordat normale automation terug mag sturen."
      });
    }
    if ((lifecycle.pendingActions || []).some((item) => item.state === "reconcile_required")) {
      runbooks.push({
        id: "reconcile_required",
        severity: "negative",
        title: "Exchange reconcile nodig",
        reason: "Een positie heeft runtime-management maar mist een schone protective state.",
        action: "Draai reconcile/status, bevestig quantity en herbouw bescherming of flatten handmatig."
      });
    }
    if (Object.keys(lifecycle.activeActions || {}).length) {
      runbooks.push({
        id: "pending_exchange_actions",
        severity: "neutral",
        title: "Exchange actie nog in vlucht",
        reason: `${Object.keys(lifecycle.activeActions || {}).length} runtime action(s) zijn nog pending of recent gecrasht.`,
        action: "Controleer entry/exit/protection flows voor stuck actions voordat de bot opnieuw wordt gestart."
      });
    }
    if (health.circuitOpen) {
      runbooks.push({
        id: "health_circuit_open",
        severity: "negative",
        title: "Trading circuit open",
        reason: health.reason || "Te veel opeenvolgende runtime failures.",
        action: "Onderzoek de laatste cycle failures en heropen entries pas na een schone run."
      });
    }
    if (selfHeal.mode === "paper_calibration_probe") {
      runbooks.push({
        id: "paper_calibration_probe",
        severity: "neutral",
        title: "Paper calibration probe actief",
        reason: selfHeal.reason || "Calibration drift is te hoog voor normale paper sizing.",
        action: "Laat alleen kleine probe-entries lopen en volg calibration, quorum en recente paper outcomes tot de self-heal herstelt."
      });
    } else if (["paused", "paper_fallback"].includes(selfHeal.mode)) {
      runbooks.push({
        id: "self_heal_active",
        severity: "neutral",
        title: "Self-heal actief",
        reason: selfHeal.reason || "De bot draait in een defensieve modus.",
        action: "Gebruik doctor/status om de trigger te bevestigen en herstel alleen na stabiele telemetry."
      });
    }
    if (qualityQuorum.observeOnly) {
      runbooks.push({
        id: "quality_quorum_observe_only",
        severity: "neutral",
        title: "Observe-only data modus",
        reason: (qualityQuorum.blockerReasons || [])[0] || "Kwaliteitsquorum blokkeert nieuwe entries.",
        action: "Wacht op lokale book, provider of pair-health herstel voordat nieuwe trades worden geopend."
      });
    }
    if ((venueConfirmation.status || "") === "blocked") {
      runbooks.push({
        id: "reference_venue_divergence",
        severity: "negative",
        title: "Venue-confirmatie wijkt af",
        reason: venueConfirmation.notes?.[0] || "Reference venues bevestigen Binance niet.",
        action: "Controleer of Binance tape, spread of marktstructuur tijdelijk afwijkt voordat entries opnieuw live mogen."
      });
    }
    if ((strategyRetirement.retireCount || 0) > 0) {
      runbooks.push({
        id: "strategy_retirement",
        severity: "negative",
        title: "Strategie uit roulatie gehaald",
        reason: strategyRetirement.notes?.[0] || "Governance heeft een strategie tijdelijk retired.",
        action: "Review de strategie-scorecards en forceer geen nieuwe entries totdat de score herstelt."
      });
    }
    if ((executionCost.status || "") === "blocked") {
      runbooks.push({
        id: "execution_cost_blocked",
        severity: "neutral",
        title: "Execution cost budget te duur",
        reason: executionCost.notes?.[0] || "Slippage en fees liggen boven het toegestane budget.",
        action: "Verlaag entry-agressie of wacht op betere spread/depth voordat je opnieuw instapt."
      });
    }
    if (capitalLadder.allowEntries === false) {
      runbooks.push({
        id: "capital_ladder_shadow",
        severity: "neutral",
        title: "Capital ladder houdt live shadow-only",
        reason: capitalLadder.notes?.[0] || "Governance laat nog geen live capital deployment toe.",
        action: "Werk eerst promotion-policy, research-kandidaten en probation af voordat live sizing omhoog mag."
      });
    }
    if ((capitalGovernor.status || "") === "blocked") {
      runbooks.push({
        id: "capital_governor_blocked",
        severity: "negative",
        title: "Capital governor blokkeert nieuwe entries",
        reason: capitalGovernor.notes?.[0] || "Dag- of weekdrawdown blijft boven budget.",
        action: "Laat alleen recovery trades en kapitaalafbouw lopen tot de recovery-window herstelt."
      });
    } else if ((capitalGovernor.status || "") === "recovery") {
      runbooks.push({
        id: "capital_governor_recovery",
        severity: "neutral",
        title: "Capital governor draait in recovery",
        reason: capitalGovernor.notes?.[0] || "Nieuwe entries krijgen kleinere sizing.",
        action: "Bevestig eerst recovery winrate en gemiddelde PnL voordat sizing weer normaal wordt."
      });
    }
    if ((replayChaos.status || "") === "blocked") {
      runbooks.push({
        id: "replay_chaos_blocked",
        severity: "neutral",
        title: "Replay chaos lab ziet kwetsbare setup",
        reason: replayChaos.notes?.[2] || "De zwakste strategy-stressscore vraagt extra aandacht.",
        action: "Vergelijk replay checkpoints, stress scenario's en execution profile voor de zwakke strategie."
      });
    }
    if ((alertDelivery.status || "") === "failed") {
      runbooks.push({
        id: "alert_delivery_failed",
        severity: "neutral",
        title: "Operator alert delivery faalde",
        reason: alertDelivery.lastError || alertDelivery.notes?.[0] || "Webhook delivery kwam niet door.",
        action: "Controleer webhook URLs en netwerktoegang zodat kritieke alerts opnieuw kunnen worden afgeleverd."
      });
    }
    if ((strategyResearch.approvedCandidateCount || 0) > 0) {
      runbooks.push({
        id: "strategy_research_candidates",
        severity: "positive",
        title: "Nieuwe research-kandidaten klaar",
        reason: strategyResearch.notes?.[0] || "Er zijn nieuwe paper-kandidaten uit importer/genome research.",
        action: "Gebruik research/status om de nieuwe kandidaten te reviewen en neem ze alleen via paper probation op."
      });
    }
    if (arr(drift.blockerReasons || []).length) {
      runbooks.push({
        id: "drift_blockers",
        severity: "neutral",
        title: "Drift guard actief",
        reason: drift.blockerReasons[0] || "Drift-monitor blokkeert agressievere entries.",
        action: "Vergelijk recente fills, calibration en feature drift voordat thresholds weer worden verruimd."
      });
    }
    if ((this.runtime.thresholdTuning?.appliedRecommendation?.status || "") === "probation") {
      runbooks.push({
        id: "threshold_probation",
        severity: "neutral",
        title: "Threshold probation actief",
        reason: `${this.runtime.thresholdTuning.appliedRecommendation.id} draait tijdelijk met een aangepaste gate.`,
        action: "Volg winrate en gemiddelde PnL in deze scope tot de probation automatisch bevestigt of terugdraait."
      });
    }
    if (!runbooks.length && (report?.tradeQualityReview?.notes || []).length) {
      runbooks.push({
        id: "healthy_runtime",
        severity: "positive",
        title: "Runtime oogt stabiel",
        reason: report.tradeQualityReview.notes[0],
        action: "Blijf vooral counterfactuals, exit quality en exchange reconcile volgen."
      });
    }
    return runbooks.slice(0, 8);
  }

  buildPerformanceChangeView(report) {
    const today = report?.windows?.today || {};
    const days7 = report?.windows?.days7 || {};
    const todayAvgPnl = (today.tradeCount || 0) ? (today.realizedPnl || 0) / today.tradeCount : 0;
    const days7AvgPnl = (days7.tradeCount || 0) ? (days7.realizedPnl || 0) / days7.tradeCount : 0;
    const pnlDeltaPerTrade = todayAvgPnl - days7AvgPnl;
    const winRateDelta = (today.winRate || 0) - (days7.winRate || 0);
    const topStrategy = report?.attribution?.strategies?.[0] || null;
    const weakestStyle = [...arr(report?.executionSummary?.styles || [])]
      .sort((left, right) => (left.realizedPnl || 0) - (right.realizedPnl || 0))[0] || null;
    const tradeQuality = report?.tradeQualityReview || {};
    const decomposition = report?.pnlDecomposition || {};
    const executionCost = report?.executionCostSummary || {};
    const retiredStrategy = arr(this.runtime.strategyRetirement?.policies || []).find((item) => item.status === "retire") || null;
    const capitalGovernor = this.runtime.capitalGovernor || {};
    const status = pnlDeltaPerTrade > 5 || winRateDelta > 0.08
      ? "positive"
      : pnlDeltaPerTrade < -5 || winRateDelta < -0.08
        ? "negative"
        : "neutral";

    return {
      status,
      headline: status === "positive"
        ? "Recente performance ligt boven het 7-daags tempo."
        : status === "negative"
          ? "Recente performance ligt onder het 7-daags tempo."
          : "Performance beweegt rond het recente gemiddelde.",
      pnlDeltaPerTrade: num(pnlDeltaPerTrade, 2),
      winRateDelta: num(winRateDelta, 4),
      topStrategy: topStrategy?.id || null,
      weakestExecutionStyle: weakestStyle?.style || null,
      leadDriver: tradeQuality.notes?.[1] || tradeQuality.notes?.[0] || null,
      notes: [
        tradeQuality.notes?.[0] || "Nog geen trade-quality context beschikbaar.",
        topStrategy ? `${topStrategy.id} draagt nu het meeste bij.` : "Nog geen leidende strategie zichtbaar.",
        weakestStyle ? `${weakestStyle.style} is de zwakste execution-style in recente trades.` : "Nog geen duidelijke execution-stijl zwakker dan de rest.",
        decomposition.totalFees
          ? `Fees drukten recent ongeveer ${num(decomposition.totalFees || 0, 2)} USD op het resultaat.`
          : "Fee-impact is nog beperkt zichtbaar.",
        executionCost.worstStrategy
          ? `${executionCost.worstStrategy} is nu de duurste strategy-scope qua execution cost.`
          : "Nog geen uitgesproken execution-cost outlier zichtbaar.",
        retiredStrategy
          ? `${retiredStrategy.id} staat momenteel op retire en telt mee in governance-drag.`
          : "Geen strategie staat momenteel op retire.",
        this.runtime.thresholdTuning?.appliedRecommendation
          ? `Threshold probation: ${this.runtime.thresholdTuning.appliedRecommendation.id} (${this.runtime.thresholdTuning.appliedRecommendation.status}).`
          : "Geen actieve threshold probation.",
        this.runtime.executionCalibration?.status === "calibrated"
          ? "Paper execution gebruikt live fill-calibratie."
          : "Execution-calibratie warmt nog op.",
        this.runtime.capitalLadder?.stage
          ? `Capital ladder: ${this.runtime.capitalLadder.stage}.`
          : "Capital ladder warmt nog op.",
        capitalGovernor.status === "blocked"
          ? "Capital governor blokkeert momenteel nieuwe entries."
          : capitalGovernor.status === "recovery"
            ? `Capital governor recovery op ${num((capitalGovernor.sizeMultiplier || 1) * 100, 1)}% sizing.`
            : "Capital governor laat normale sizing toe.",
        (this.runtime.strategyResearch?.approvedCandidateCount || 0)
          ? `${this.runtime.strategyResearch.approvedCandidateCount} research-kandidaten klaar voor paper probation.`
          : "Nog geen nieuwe strategy research-kandidaten klaar."
      ]
    };
  }

  buildOperationalReadiness(referenceNow = nowIso()) {
    const reasons = [];
    if (!this.runtime.lastAnalysisAt) {
      reasons.push("analysis_not_ready");
    }
    if (this.runtime.health?.circuitOpen) {
      reasons.push("health_circuit_open");
    }
    if (this.runtime.exchangeTruth?.freezeEntries) {
      reasons.push("exchange_truth_freeze");
    }
    if ((this.runtime.exchangeSafety?.status || "") === "blocked") {
      reasons.push("exchange_safety_blocked");
    }
    if (arr(this.runtime.orderLifecycle?.pendingActions || []).some((item) => ["manual_review", "reconcile_required"].includes(item.state))) {
      reasons.push("lifecycle_attention_required");
    }
    if (this.config.botMode === "live" && this.runtime.capitalLadder?.allowEntries === false) {
      reasons.push("capital_ladder_shadow_only");
    }
    if (this.config.botMode === "live" && this.runtime.capitalGovernor?.allowEntries === false) {
      reasons.push("capital_governor_blocked");
    }
    if (arr(this.runtime.ops?.alerts?.alerts || []).some((item) => requiresOperatorAck(item, this.config.botMode))) {
      reasons.push("operator_ack_required");
    }
    return {
      checkedAt: referenceNow,
      ready: reasons.length === 0,
      status: reasons.includes("exchange_truth_freeze") || reasons.includes("health_circuit_open") || reasons.includes("exchange_safety_blocked") || reasons.includes("capital_governor_blocked")
        ? "blocked"
      : reasons.length
          ? "degraded"
          : "ready",
      reasons
    };
  }

  buildShadowTradingView(decisionSummaries = arr(this.runtime.latestDecisions), referenceNow = nowIso()) {
    const entries = arr(decisionSummaries);
    const eligible = entries.filter((item) => item.allow);
    const shadowLearning = this.config.botMode === "paper"
      ? entries
          .filter((item) => !item.allow && item.learningLane === "shadow")
          .slice(0, Math.min(this.config.shadowTradeDecisionLimit || 3, this.config.paperLearningShadowDailyLimit || 6))
      : [];
    const simulatedEntries = [...eligible, ...shadowLearning]
      .slice(0, Math.max(this.config.shadowTradeDecisionLimit || 3, shadowLearning.length))
      .map((decision) => {
        const marketSnapshot = this.marketCache[decision.symbol] || null;
        const fill = marketSnapshot
          ? this.execution.simulatePaperFill({
              marketSnapshot,
              side: "BUY",
              requestedQuoteAmount: decision.quoteAmount || 0,
              latencyMs: this.config.paperLatencyMs,
              plan: decision.executionPlan || { entryStyle: decision.executionStyle || "market", fallbackStyle: "none" }
            })
          : null;
        return {
          symbol: decision.symbol,
          probability: num(decision.probability || 0, 4),
          threshold: num(decision.threshold || 0, 4),
          quoteAmount: num(decision.quoteAmount || 0, 2),
          fillPrice: num(fill?.fillPrice || marketSnapshot?.book?.mid || 0, 6),
          expectedSlippageBps: num(fill?.expectedImpactBps || 0, 2),
          executionStyle: decision.executionStyle || decision.executionPlan?.entryStyle || null,
          learningLane: decision.learningLane || (decision.allow ? "safe" : null),
          learningValueScore: num(decision.learningValueScore || 0, 4),
          status: !decision.allow && decision.learningLane === "shadow"
            ? "shadow_learning"
            : this.config.botMode === "live"
              ? "shadow_live"
              : "shadow_paper"
        };
      });
    return {
      generatedAt: referenceNow,
      enabled: true,
      mode: this.config.botMode === "live" ? "shadow_live" : "shadow_paper",
      candidateCount: arr(decisionSummaries).length,
      simulatedEntries,
      notes: [
        simulatedEntries.length
          ? `${simulatedEntries.length} shadow entries volgen de live marktfase zonder echte orderplaatsing.`
          : "Nog geen tradebare setups beschikbaar voor shadow mode.",
        shadowLearning.length
          ? `${shadowLearning.length} near-miss setups lopen mee als shadow learning om paper sneller bij te scholen.`
          : "Geen extra near-miss shadow learning setups actief.",
        this.config.botMode === "live"
          ? "Gebruik shadow fills om echte live entries met paper gedrag te vergelijken."
          : "In paper mode laat shadow trading zien wat een extra live-achtige routing zou doen."
      ]
    };
  }

  buildPaperLearningSummary(decisionSummaries = arr(this.runtime.latestDecisions), referenceNow = nowIso()) {
    const entries = arr(decisionSummaries);
    const learningEntries = entries.filter((item) => item.learningLane);
    const laneCounts = learningEntries.reduce((acc, item) => {
      const lane = item.learningLane || "safe";
      acc[lane] = (acc[lane] || 0) + 1;
      return acc;
    }, {});
    const familyCounts = {};
    const regimeCounts = {};
    const sessionCounts = {};
    for (const item of learningEntries) {
      const family = item.paperLearning?.scope?.family || item.strategy?.family || null;
      const regime = item.paperLearning?.scope?.regime || item.regime || null;
      const session = item.paperLearning?.scope?.session || item.session?.session || null;
      if (family) {
        familyCounts[family] = (familyCounts[family] || 0) + 1;
      }
      if (regime) {
        regimeCounts[regime] = (regimeCounts[regime] || 0) + 1;
      }
      if (session) {
        sessionCounts[session] = (sessionCounts[session] || 0) + 1;
      }
    }
    const blockerCounts = {};
    const blockerGroups = { safety: 0, governance: 0, learning: 0, market: 0 };
    for (const item of entries.filter((entry) => !entry.allow)) {
      const reasons = arr(item.blockerReasons || item.reasons || []);
      for (const reason of reasons.slice(0, 3)) {
        blockerCounts[reason] = (blockerCounts[reason] || 0) + 1;
      }
      const categories = item.paperBlockerCategories || item.paperLearning?.blockerCategories || {};
      for (const [key, value] of Object.entries(categories)) {
        blockerGroups[key] = (blockerGroups[key] || 0) + (value || 0);
      }
    }
    const recentPaperTrades = arr(this.journal?.trades || [])
      .filter((trade) => (trade.brokerMode || "paper") === "paper" && trade.exitAt)
      .slice(-40);
    const recentProbeTrades = recentPaperTrades.filter((trade) => trade.learningLane === "probe");
    const outcomeCounts = {};
    for (const trade of recentPaperTrades) {
      const outcome = resolvePaperOutcomeBucket(trade);
      outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;
    }
    const budget = entries.find((item) => item.paperLearningBudget)?.paperLearningBudget || null;
    const topBlockers = Object.entries(blockerCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([id, count]) => ({ id, count }));
    const recentOutcomes = Object.entries(outcomeCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([id, count]) => ({ id, count }));
    const readinessByScope = (records, type, pickId) => Object.entries(
      records.reduce((acc, trade) => {
        const id = pickId(trade);
        if (!id) {
          return acc;
        }
        acc[id] = acc[id] || [];
        acc[id].push(trade);
        return acc;
      }, {})
    )
      .map(([id, trades]) => {
        const goodCount = trades.filter((trade) => ["good_trade", "acceptable_trade"].includes(resolvePaperOutcomeBucket(trade))).length;
        const weakCount = trades.filter((trade) => ["bad_trade", "early_exit", "late_exit", "execution_drag"].includes(resolvePaperOutcomeBucket(trade))).length;
        const goodRate = goodCount / Math.max(trades.length, 1);
        const weakRate = weakCount / Math.max(trades.length, 1);
        const readinessScore = clamp(0.3 + Math.min(0.28, trades.length / 10) + goodRate * 0.28 - weakRate * 0.22, 0, 1);
        return {
          id,
          type,
          count: trades.length,
          readinessScore,
          status: readinessScore >= 0.72 ? "paper_ready" : readinessScore >= 0.54 ? "building" : "warmup",
          goodRate,
          weakRate
        };
      })
      .sort((left, right) => right.readinessScore - left.readinessScore)
      .slice(0, 2);
    const scopeReadiness = [
      ...readinessByScope(recentProbeTrades, "strategy_family", (trade) => trade.strategyFamily || null),
      ...readinessByScope(recentProbeTrades, "regime", (trade) => trade.regimeAtEntry || null),
      ...readinessByScope(recentProbeTrades, "session", (trade) => trade.sessionAtEntry || null)
    ].sort((left, right) => right.readinessScore - left.readinessScore).slice(0, 6);
    const sandboxStates = learningEntries
      .map((item) => item.paperThresholdSandbox || item.paperLearning?.thresholdSandbox)
      .filter((item) => item?.status && item.status !== "warmup")
      .sort((left, right) => Math.abs(right.thresholdShift || 0) - Math.abs(left.thresholdShift || 0));
    const thresholdSandbox = sandboxStates[0]
      ? {
          status: sandboxStates[0].status,
          scopeLabel: [sandboxStates[0].scope?.family, sandboxStates[0].scope?.regime, sandboxStates[0].scope?.session].filter(Boolean).join(" · "),
          thresholdShift: sandboxStates[0].thresholdShift || 0,
          sampleSize: sandboxStates[0].sampleSize || 0
        }
      : null;
    const offlineTrainer = summarizeOfflineTrainer(this.runtime?.offlineTrainer || {});
    const tuningRecommendation = offlineTrainer.thresholdPolicy?.topRecommendation || null;
    const replayPacks = this.runtime?.ops?.replayChaos?.replayPacks || this.runtime?.replayChaos?.replayPacks || {};
    const reviewPacks = {
      bestProbeWinner: replayPacks.probeWinners?.[0]?.symbol || null,
      weakestProbe: replayPacks.paperMisses?.[0]?.symbol || null,
      topMissedSetup: replayPacks.nearMissSetups?.[0]?.symbol || null
    };
    const probeGoodCount = recentProbeTrades.filter((trade) => ["good_trade", "acceptable_trade"].includes(resolvePaperOutcomeBucket(trade))).length;
    const probeWeakCount = recentProbeTrades.filter((trade) => ["bad_trade", "early_exit", "late_exit", "execution_drag"].includes(resolvePaperOutcomeBucket(trade))).length;
    const promotionReady = recentProbeTrades.length >= 4 && probeGoodCount >= Math.ceil(recentProbeTrades.length * 0.6);
    const rollbackRisk = recentProbeTrades.length >= 3 && probeWeakCount >= Math.ceil(recentProbeTrades.length * 0.5);
    const avgLearningValue = average(learningEntries.map((item) => item.learningValueScore || 0), 0);
    const avgNovelty = average(learningEntries.map((item) => item.paperLearning?.noveltyScore || 0), 0);
    const readinessScore = clamp(
      0.24 +
        Math.min(0.22, recentProbeTrades.length / 18) +
        avgLearningValue * 0.18 +
        avgNovelty * 0.12 +
        (promotionReady ? 0.12 : 0) -
        (rollbackRisk ? 0.14 : 0) -
        Math.min(0.08, (topBlockers[0]?.count || 0) / 10),
      0,
      1
    );
    const readinessStatus = readinessScore >= 0.72
      ? "paper_ready"
      : readinessScore >= 0.54
        ? "building"
        : "warmup";
    const paperToLiveReadiness = {
      status: scopeReadiness[0]?.status || readinessStatus,
      score: clamp(
        readinessScore * 0.52 +
        (scopeReadiness[0]?.readinessScore || 0) * 0.28 +
        (promotionReady ? 0.12 : 0) -
        ((topBlockers[0]?.count || 0) >= 3 ? 0.08 : 0),
        0,
        1
      ),
      topScope: scopeReadiness[0]?.id || null,
      blocker: topBlockers[0]?.id || null,
      note: scopeReadiness[0]
        ? `${scopeReadiness[0].id} is momenteel de beste paper-scope voor een volgende probationstap.`
        : "Nog geen duidelijke paper-scope klaar voor een volgende stap."
    };
    const counterfactualTuning = tuningRecommendation
      ? {
          status: tuningRecommendation.action || "observe",
          blocker: tuningRecommendation.id || offlineTrainer.vetoFeedback?.topBlocker || null,
          action: tuningRecommendation.action || "observe",
          adjustment: tuningRecommendation.adjustment || 0,
          confidence: tuningRecommendation.confidence || 0,
          note: tuningRecommendation.rationale || `Counterfactual learning geeft nu vooral aandacht aan ${tuningRecommendation.id || "de huidige blocker-set"}.`
        }
      : {
          status: "observe",
          blocker: offlineTrainer.vetoFeedback?.topBlocker || null,
          action: "observe",
          adjustment: 0,
          confidence: 0,
          note: offlineTrainer.vetoFeedback?.topBlocker
            ? `Counterfactual learning volgt ${offlineTrainer.vetoFeedback.topBlocker} nog op, maar ziet nog geen harde aanpassing nodig.`
            : "Nog geen duidelijke counterfactual tuning-richting zichtbaar."
        };
    const probation = {
      status: recentProbeTrades.length < 3
        ? "warmup"
        : promotionReady
          ? "promote_candidate"
          : rollbackRisk
            ? "rollback_watch"
            : "observe",
      eligibleProbeTrades: recentProbeTrades.length,
      promotionReady,
      rollbackRisk,
      leadingOutcome: recentOutcomes[0]?.id || null,
      note: recentProbeTrades.length < 3
        ? "Nog te weinig gesloten probe-trades voor paper probation."
        : promotionReady
          ? "Recente probe-trades zijn sterk genoeg om paper-promotie te overwegen."
          : rollbackRisk
            ? "Recente probe-trades tonen zwakke uitkomsten; rollback of strakkere gating is verstandig."
            : "Paper-probation loopt nog; verzamel extra gesloten probe-trades."
    };
    return {
      generatedAt: referenceNow,
      status: learningEntries.length ? "active" : "observe",
      readinessStatus,
      readinessScore,
      safeCount: laneCounts.safe || 0,
      probeCount: laneCounts.probe || 0,
      shadowCount: laneCounts.shadow || 0,
      averageLearningValueScore: avgLearningValue,
      averageNoveltyScore: avgNovelty,
      blockerGroups,
      scopeReadiness,
      thresholdSandbox,
      reviewPacks,
      paperToLiveReadiness,
      counterfactualTuning,
      dailyBudget: budget,
      topFamilies: Object.entries(familyCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4)
        .map(([id, count]) => ({ id, count })),
      topRegimes: Object.entries(regimeCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4)
        .map(([id, count]) => ({ id, count })),
      topSessions: Object.entries(sessionCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4)
        .map(([id, count]) => ({ id, count })),
      topBlockers,
      recentOutcomes,
      probation,
      notes: [
        laneCounts.probe
          ? `${laneCounts.probe} probe-setup(s) draaien in deze cycle voor sneller paper learning.`
          : "Geen actieve probe-setups in deze cycle.",
        laneCounts.shadow
          ? `${laneCounts.shadow} shadow-setup(s) lopen mee als near-miss feedback.`
          : "Geen actieve shadow-learning setups in deze cycle.",
        budget
          ? `Dagbudget probes ${budget.probeUsed}/${budget.probeDailyLimit} en shadow ${budget.shadowUsed}/${budget.shadowDailyLimit}.`
          : "Nog geen paper learning budget zichtbaar.",
        thresholdSandbox
          ? `Paper threshold sandbox ${thresholdSandbox.status} in ${thresholdSandbox.scopeLabel || "scope onbekend"} (${num(thresholdSandbox.thresholdShift * 100, 1)}% shift).`
          : "Geen actieve paper threshold sandbox.",
        scopeReadiness[0]
          ? `Sterkste paper-scope: ${scopeReadiness[0].id} (${scopeReadiness[0].status}).`
          : "Nog geen paper-scope readiness zichtbaar.",
        paperToLiveReadiness.topScope
          ? `Paper-to-live readiness focust nu op ${paperToLiveReadiness.topScope}.`
          : "Paper-to-live readiness heeft nog geen duidelijke focus-scope.",
        counterfactualTuning.blocker
          ? `Counterfactual tuning kijkt nu vooral naar ${counterfactualTuning.blocker}.`
          : "Counterfactual tuning heeft nog geen dominante blocker.",
        topBlockers[0]
          ? `${topBlockers[0].id} blokkeert momenteel het vaakst in paper learning.`
          : "Nog geen dominante paper blocker zichtbaar.",
        recentOutcomes[0]
          ? `${recentOutcomes[0].id} is momenteel de meest voorkomende paper-uitkomst.`
          : "Nog geen gesloten paper trades om outcome-labels te tonen.",
        probation.note
      ].filter(Boolean)
    };
  }

  refreshOperationalViews({ report = null, nowIso: referenceNow = nowIso() } = {}) {
    const evaluation = report || buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config });
    this.runtime.capitalPolicy = buildCapitalPolicySnapshot({
      journal: this.journal,
      runtime: this.runtime,
      capitalGovernor: this.runtime.capitalGovernor || {},
      capitalLadder: this.runtime.capitalLadder || {},
      config: this.config,
      nowIso: referenceNow
    });
    const exchangeSafety = summarizeExchangeSafety(buildExchangeSafetyAudit({
      runtime: this.runtime,
      report: evaluation,
      config: this.config,
      streamStatus: this.stream.getStatus(),
      nowIso: referenceNow
    }));
    this.runtime.exchangeSafety = exchangeSafety;
    if ((this.config.botMode || "paper") === "live" && exchangeSafety.freezeEntries) {
      this.runtime.exchangeTruth = {
        ...(this.runtime.exchangeTruth || {}),
        freezeEntries: true,
        notes: [...new Set([...(this.runtime.exchangeTruth?.notes || []), ...(exchangeSafety.notes || [])])].slice(0, 6)
      };
    }
    this.runtime.shadowTrading = this.buildShadowTradingView(arr(this.runtime.latestDecisions), referenceNow);
    this.runtime.paperLearning = this.buildPaperLearningSummary(arr(this.runtime.latestDecisions), referenceNow);
    const readiness = this.buildOperationalReadiness(referenceNow);
    const alerts = summarizeOperatorAlerts(buildOperatorAlerts({
      runtime: this.runtime,
      report: evaluation,
      readiness,
      exchangeSafety,
      strategyRetirement: this.runtime.strategyRetirement || {},
      executionCost: this.runtime.executionCost || {},
      capitalGovernor: this.runtime.capitalGovernor || {},
      config: this.config,
      nowIso: referenceNow
    }));
    const alertDelivery = summarizeAlertDelivery(buildOperatorAlertDispatchPlan({
      alerts,
      config: this.config,
      nowIso: referenceNow
    }));
    this.runtime.ops = {
      lastUpdatedAt: referenceNow,
      incidentTimeline: this.buildIncidentTimeline(referenceNow),
      runbooks: this.buildOperatorRunbooks(evaluation),
      performanceChange: this.buildPerformanceChangeView(evaluation),
      readiness,
      alerts,
      alertState: this.runtime.ops?.alertState || { acknowledgedAtById: {}, silencedUntilById: {}, resolvedAtById: {}, notesById: {}, delivery: { lastDeliveryAt: null, lastError: null, lastDeliveredAtById: {} } },
      alertDelivery,
      replayChaos: summarizeReplayChaos(this.runtime.replayChaos || {}),
      paperLearning: summarizePaperLearning(this.runtime.paperLearning || {})
    };
    this.runtime.service = {
      ...(this.runtime.service || {}),
      lastHeartbeatAt: referenceNow,
      watchdogStatus: this.runtime.lifecycle?.activeRun ? "running" : (this.runtime.service?.watchdogStatus || "idle")
    };
    return this.runtime.ops;
  }

  async dispatchOperatorAlerts(referenceNow = nowIso()) {
    const deliveryResult = await deliverOperatorAlerts({
      alerts: this.runtime.ops?.alerts || {},
      runtime: this.runtime,
      config: this.config,
      nowIso: referenceNow
    });
    const result = summarizeAlertDelivery(deliveryResult);
    const currentAlertState = this.runtime.ops?.alertState || { acknowledgedAtById: {}, silencedUntilById: {}, resolvedAtById: {}, notesById: {}, delivery: { lastDeliveryAt: null, lastError: null, lastDeliveredAtById: {} } };
    this.runtime.ops = {
      ...(this.runtime.ops || {}),
      alertState: {
        ...currentAlertState,
        delivery: {
          ...(currentAlertState.delivery || {}),
          lastDeliveryAt: result.lastDeliveryAt || currentAlertState.delivery?.lastDeliveryAt || null,
          lastError: result.lastError || null,
          lastDeliveredAtById: {
            ...(currentAlertState.delivery?.lastDeliveredAtById || {}),
            ...(deliveryResult.lastDeliveredAtById || {})
          }
        }
      },
      alertDelivery: result
    };
    return result;
  }

  async acknowledgeAlert(alertId, { acknowledged = true, at = nowIso(), note = null } = {}) {
    if (!alertId) {
      throw new Error("Alert id ontbreekt.");
    }
    const currentAlertState = this.runtime.ops?.alertState || { acknowledgedAtById: {}, silencedUntilById: {}, resolvedAtById: {}, notesById: {}, delivery: { lastDeliveryAt: null, lastError: null, lastDeliveredAtById: {} } };
    const acknowledgedAtById = { ...(currentAlertState.acknowledgedAtById || {}) };
    const resolvedAtById = { ...(currentAlertState.resolvedAtById || {}) };
    if (acknowledged) {
      acknowledgedAtById[alertId] = at;
      delete resolvedAtById[alertId];
    } else {
      delete acknowledgedAtById[alertId];
    }
    this.runtime.ops = {
      ...(this.runtime.ops || {}),
      alertState: {
        ...currentAlertState,
        acknowledgedAtById,
        resolvedAtById,
        notesById: {
          ...(currentAlertState.notesById || {}),
          ...(note ? { [alertId]: note } : {})
        }
      }
    };
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  async silenceAlert(alertId, { minutes = this.config.operatorAlertSilenceMinutes || 180, at = nowIso() } = {}) {
    if (!alertId) {
      throw new Error("Alert id ontbreekt.");
    }
    const durationMinutes = Math.max(1, Number(minutes || this.config.operatorAlertSilenceMinutes || 180));
    const currentAlertState = this.runtime.ops?.alertState || { acknowledgedAtById: {}, silencedUntilById: {}, resolvedAtById: {}, notesById: {}, delivery: { lastDeliveryAt: null, lastError: null, lastDeliveredAtById: {} } };
    this.runtime.ops = {
      ...(this.runtime.ops || {}),
      alertState: {
        ...currentAlertState,
        silencedUntilById: {
          ...(currentAlertState.silencedUntilById || {}),
          [alertId]: new Date(new Date(at).getTime() + durationMinutes * 60_000).toISOString()
        }
      }
    };
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  async resolveAlert(alertId, { resolved = true, at = nowIso(), note = null } = {}) {
    if (!alertId) {
      throw new Error("Alert id ontbreekt.");
    }
    const currentAlertState = this.runtime.ops?.alertState || { acknowledgedAtById: {}, silencedUntilById: {}, resolvedAtById: {}, notesById: {}, delivery: { lastDeliveryAt: null, lastError: null, lastDeliveredAtById: {} } };
    const resolvedAtById = { ...(currentAlertState.resolvedAtById || {}) };
    if (resolved) {
      resolvedAtById[alertId] = at;
    } else {
      delete resolvedAtById[alertId];
    }
    this.runtime.ops = {
      ...(this.runtime.ops || {}),
      alertState: {
        ...currentAlertState,
        resolvedAtById,
        notesById: {
          ...(currentAlertState.notesById || {}),
          ...(note ? { [alertId]: note } : {})
        }
      }
    };
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  async forceReconcile({ note = null, at = nowIso() } = {}) {
    this.runtime.exchangeTruth = {
      ...(this.runtime.exchangeTruth || {}),
      freezeEntries: true,
      notes: [...new Set([...(this.runtime.exchangeTruth?.notes || []), note || "Operator force reconcile requested."])].slice(0, 8)
    };
    this.recordEvent("operator_force_reconcile", { at, note: note || null });
    this.syncOrderLifecycleState("operator_force_reconcile");
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  async markPositionReviewed(positionId, { note = null, at = nowIso() } = {}) {
    const position = arr(this.runtime.openPositions).find((item) => item.id === positionId);
    if (!position) {
      throw new Error("Positie niet gevonden.");
    }
    position.reviewedAt = at;
    position.reviewNote = note || null;
    if (position.manualReviewRequired) {
      position.manualReviewRequired = false;
      position.operatorMode = "protect_only";
      position.lifecycleState = "protect_only";
    }
    this.recordEvent("operator_mark_reviewed", { at, symbol: position.symbol, id: positionId, note: note || null });
    this.syncOrderLifecycleState("operator_mark_reviewed");
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  async setProbeOnly({ enabled = true, minutes = 90, note = null, at = nowIso() } = {}) {
    const until = enabled ? new Date(new Date(at).getTime() + Math.max(1, Number(minutes || 90)) * 60_000).toISOString() : null;
    this.runtime.probeOnly = {
      enabled: Boolean(enabled),
      until,
      note: note || null,
      updatedAt: at
    };
    this.recordEvent(enabled ? "operator_probe_only_enabled" : "operator_probe_only_disabled", { at, note: note || null, until });
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  updateSafetyState({ now = new Date(), candidateSummaries = arr(this.runtime.latestDecisions) } = {}) {
    const report = buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config, now });
    const driftSummary = this.config.enableDriftMonitoring
      ? this.driftMonitor.summarizeRuntime({
          runtime: this.runtime,
          report,
          stream: this.stream.getStatus(),
          health: this.health.getStatus(this.runtime),
          calibration: this.model.getCalibrationSummary(),
          candidateSummaries,
          botMode: this.config.botMode
        })
      : { status: "disabled", severity: 0, reasons: [], blockerReasons: [] };
    const previousSelfHeal = summarizeSelfHeal(this.runtime.selfHeal || this.selfHeal.buildDefaultState());
    const selfHealState = this.config.selfHealEnabled
      ? this.selfHeal.evaluate({
          previousState: this.runtime.selfHeal || this.selfHeal.buildDefaultState(),
          report,
          driftSummary,
          health: this.health.getStatus(this.runtime),
          calibration: this.model.getCalibrationSummary(),
          botMode: this.config.botMode,
          hasStableModel: (this.modelBackups || []).length > 0,
          now
        })
      : this.selfHeal.buildDefaultState();

    const triggerChanged = previousSelfHeal.lastTriggeredAt !== selfHealState.lastTriggeredAt;
    if (triggerChanged && (selfHealState.actions || []).includes("reset_rl_policy")) {
      this.resetExecutionPolicy(selfHealState.reason || "self_heal");
    }
    if (triggerChanged && (selfHealState.actions || []).includes("restore_stable_model")) {
      const restored = this.restoreLatestStableModel(selfHealState.reason || "self_heal_restore");
      if (restored) {
        selfHealState.restoreSnapshotAt = restored.at;
      }
    }
    if (previousSelfHeal.mode !== selfHealState.mode || previousSelfHeal.reason !== selfHealState.reason) {
      this.recordEvent("self_heal_state_changed", {
        from: previousSelfHeal.mode,
        to: selfHealState.mode,
        reason: selfHealState.reason,
        managerAction: selfHealState.managerAction || null
      });
    }

    if (candidateSummaries[0]?.session) {
      this.runtime.session = summarizeSession(candidateSummaries[0].session);
    } else if (!this.runtime.session || Object.keys(this.runtime.session).length === 0) {
      this.runtime.session = summarizeSession({});
    }
    this.runtime.drift = driftSummary;
    this.runtime.selfHeal = selfHealState;
    return { driftSummary, selfHealState, report };
  }

  async learnFromTrade(trade, logLabel = "Closed position") {
    if (!trade.rawFeatures || Object.keys(trade.rawFeatures).length === 0) {
      this.logger.warn("Closed trade had no learnable features; skipped model update", {
        symbol: trade.symbol,
        reason: trade.reason
      });
      return null;
    }

    const report = buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config });
    const rawResearchRegistry = this.researchRegistry.buildRegistry({
      journal: this.journal,
      latestSummary: this.runtime.researchLab?.latestSummary || null,
      modelBackups: this.modelBackups || [],
      nowIso: nowIso()
    });
    const divergenceSummary = this.divergenceMonitor.buildSummary({ journal: this.journal, nowIso: nowIso() });
    const offlineTrainerSummary = this.offlineTrainer.buildSummary({ journal: this.journal, dataRecorder: this.dataRecorder.getSummary(), counterfactuals: this.journal.counterfactuals || [], nowIso: nowIso() });
    trade.promotionPolicy = this.modelRegistry.buildPromotionPolicy({
      report,
      researchRegistry: rawResearchRegistry,
      calibration: this.model.getCalibrationSummary(),
      deployment: this.model.getDeploymentSummary(),
      divergenceSummary,
      offlineTrainer: offlineTrainerSummary
    });
    const learning = this.model.updateFromTrade(trade);
    Object.assign(trade, learning.label, { regimeAtEntry: trade.regimeAtEntry || learning.regime });
    const rlLearning = this.rlPolicy.updateFromTrade(trade, learning.label.labelScore);
    if (learning.promotion) {
      this.recordEvent("model_promotion", {
        regime: learning.regime,
        championError: learning.promotion.championError,
        challengerError: learning.promotion.challengerError
      });
    }
    if (rlLearning) {
      this.recordEvent("execution_policy_update", {
        symbol: trade.symbol,
        action: rlLearning.action,
        bucket: rlLearning.bucket,
        reward: rlLearning.reward
      });
    }

    if (learning.promotion || (trade.pnlQuote || 0) > 0) {
      this.maybeCaptureStableModelSnapshot(learning.promotion ? "promotion_snapshot" : "post_trade_snapshot", undefined, Boolean(learning.promotion));
    }

    await this.dataRecorder.recordTrade(trade);
    await this.dataRecorder.recordTradeReplaySnapshot(trade);
    await this.dataRecorder.recordLearningEvent({ trade, learning });
    this.refreshGovernanceViews(nowIso());

    this.logger.info(logLabel, {
      symbol: trade.symbol,
      reason: trade.reason,
      pnlQuote: trade.pnlQuote.toFixed(2),
      pnlPct: ((trade.netPnlPct || 0) * 100).toFixed(2),
      regime: learning.regime,
      labelScore: learning.label.labelScore.toFixed(3),
      promotion: Boolean(learning.promotion),
      rlAction: trade.executionPolicyDecision?.action || trade.entryRationale?.rlPolicy?.action || null
    });
    return {
      ...learning,
      rlLearning
    };
  }

  async applyReconciliation(reconciliation) {
    const previousFreeze = Boolean(this.runtime.exchangeTruth?.freezeEntries);
    for (const warning of reconciliation.warnings || []) {
      this.logger.warn("Broker reconciliation warning", warning);
      this.recordEvent("broker_reconciliation_warning", warning);
    }
    for (const position of reconciliation.recoveredPositions || []) {
      this.recordEvent("recovered_position", { symbol: position.symbol, quantity: position.quantity });
    }
    for (const trade of reconciliation.closedTrades || []) {
      this.journal.trades.push(trade);
      await this.learnFromTrade(trade, "Reconciled closed position");
    }
    if (reconciliation.exchangeTruth) {
      this.runtime.exchangeTruth = {
        ...(this.runtime.exchangeTruth || {}),
        ...reconciliation.exchangeTruth
      };
      const currentFreeze = Boolean(this.runtime.exchangeTruth.freezeEntries);
      if (currentFreeze !== previousFreeze) {
        this.recordEvent("exchange_truth_state_changed", {
          freezeEntries: currentFreeze,
          mismatchCount: this.runtime.exchangeTruth.mismatchCount || 0,
          status: this.runtime.exchangeTruth.status || "unknown"
        });
      }
    }
    this.syncOrderLifecycleState("broker_reconciliation");
  }

  async getMarketSnapshot(symbol) {
    const cachedSnapshot = this.marketCache[symbol] || null;
    const streamFeatures = this.stream.getSymbolStreamFeatures(symbol);
    const localBookSnapshot = this.stream.getOrderBookSnapshot?.(symbol) || null;
    if (isSnapshotCacheFresh(cachedSnapshot, this.config.marketSnapshotCacheMinutes)) {
      return buildCachedSnapshotView({ symbol, cachedSnapshot, streamFeatures, localBookSnapshot }) || cachedSnapshot;
    }

    try {
      const useLocalBook = Boolean(
        this.config.enableLocalOrderBook &&
        localBookSnapshot?.synced &&
        (localBookSnapshot.depthAgeMs || Number.MAX_SAFE_INTEGER) <= this.config.maxDepthEventAgeMs
      );
      const [rawKlines, restBookTicker, restOrderBook, lowerTimeframeSnapshot, higherTimeframeSnapshot] = await Promise.all([
        this.client.getKlines(symbol, this.config.klineInterval, this.config.klineLimit),
        streamFeatures.latestBookTicker?.bid && streamFeatures.latestBookTicker?.ask
          ? Promise.resolve(null)
          : this.client.getBookTicker(symbol),
        useLocalBook ? Promise.resolve(null) : this.client.getOrderBook(symbol, Math.max(10, this.config.streamDepthLevels || 20)),
        this.config.enableCrossTimeframeConsensus ? this.getTimeframeSnapshot(symbol, this.config.lowerTimeframeInterval, this.config.lowerTimeframeLimit).catch(() => null) : Promise.resolve(null),
        this.config.enableCrossTimeframeConsensus ? this.getTimeframeSnapshot(symbol, this.config.higherTimeframeInterval, this.config.higherTimeframeLimit).catch(() => null) : Promise.resolve(null)
      ]);
      const candles = normalizeKlines(rawKlines);
      const timeframes = {
        lower: lowerTimeframeSnapshot,
        higher: higherTimeframeSnapshot
      };
      const effectiveBookTicker = streamFeatures.latestBookTicker?.bid && streamFeatures.latestBookTicker?.ask
        ? {
            bidPrice: streamFeatures.latestBookTicker.bid,
            askPrice: streamFeatures.latestBookTicker.ask
          }
        : restBookTicker || {
            bidPrice: localBookSnapshot?.bestBid || 0,
            askPrice: localBookSnapshot?.bestAsk || 0
          };
      const effectiveOrderBook = useLocalBook
        ? {
            bids: localBookSnapshot?.bids || [],
            asks: localBookSnapshot?.asks || []
          }
        : restOrderBook;
      const book = computeOrderBookFeatures(effectiveBookTicker, effectiveOrderBook);
      if (streamFeatures.latestBookTicker?.bid && streamFeatures.latestBookTicker?.ask) {
        book.bid = streamFeatures.latestBookTicker.bid;
        book.ask = streamFeatures.latestBookTicker.ask;
        book.mid = streamFeatures.latestBookTicker.mid;
        book.spreadBps = book.mid ? ((book.ask - book.bid) / book.mid) * 10000 : book.spreadBps;
      }
      book.tradeFlowImbalance = streamFeatures.tradeFlowImbalance || 0;
      book.microTrend = streamFeatures.microTrend || 0;
      book.recentTradeCount = streamFeatures.recentTradeCount || 0;
      book.localBook = localBookSnapshot;
      book.localBookSynced = Boolean(localBookSnapshot?.synced);
      book.queueImbalance = localBookSnapshot?.queueImbalance || 0;
      book.queueRefreshScore = localBookSnapshot?.queueRefreshScore || 0;
      book.replenishmentScore = localBookSnapshot?.queueRefreshScore || 0;
      book.resilienceScore = localBookSnapshot?.resilienceScore || 0;
      book.depthConfidence = localBookSnapshot?.depthConfidence || 0;
      book.depthAgeMs = localBookSnapshot?.depthAgeMs ?? null;
      book.totalDepthNotional = localBookSnapshot?.totalDepthNotional || 0;
      const snapshot = {
        symbol,
        candles,
        market: computeMarketFeatures(candles),
        timeframes,
        book,
        stream: streamFeatures,
        cachedAt: nowIso(),
        fromCache: false
      };
      const issues = this.health.validateSnapshot(symbol, snapshot, this.runtime, nowIso());
      if (issues.length) {
        throw new Error(`Market snapshot invalid for ${symbol}: ${issues.join(",")}`);
      }
      this.marketCache[symbol] = snapshot;
      return snapshot;
    } catch (error) {
      if (cachedSnapshot) {
        this.logger.warn("Using cached market snapshot", { symbol, error: error.message });
        this.recordEvent("market_snapshot_cache_fallback", { symbol, error: error.message });
        return buildCachedSnapshotView({ symbol, cachedSnapshot, streamFeatures, localBookSnapshot }) || cachedSnapshot;
      }
      throw error;
    }
  }

  async getLatestMidPrices(symbols) {
    const mids = {};
    for (const symbol of [...new Set(arr(symbols).filter(Boolean))]) {
      const streamFeatures = this.stream.getSymbolStreamFeatures(symbol);
      if (streamFeatures.latestBookTicker?.mid) {
        mids[symbol] = streamFeatures.latestBookTicker.mid;
        continue;
      }
      try {
        mids[symbol] = (await this.getMarketSnapshot(symbol)).book.mid;
      } catch (error) {
        this.logger.warn("Mid-price refresh failed", { symbol, error: error.message });
      }
    }
    return mids;
  }

  buildOpenPositionContexts(snapshotMap = {}) {
    return this.runtime.openPositions
      .map((position) => {
        const marketSnapshot = snapshotMap[position.symbol] || this.marketCache[position.symbol];
        if (!marketSnapshot) {
          return null;
        }
        return {
          symbol: position.symbol,
          position,
          marketSnapshot,
          profile: this.config.symbolProfiles[position.symbol] || defaultProfile(position.symbol)
        };
      })
      .filter(Boolean);
  }

  buildCandidateChecks(candidate) {
    const explorationMode = ["paper_exploration", "paper_recovery_probe"].includes(candidate.decision.entryMode);
    const recoveryProbeMode = candidate.decision.entryMode === "paper_recovery_probe";
    const suppressedReasons = new Set(candidate.decision.suppressedReasons || []);
    return [
      {
        label: "Model confidence",
        passed: candidate.score.probability >= candidate.decision.threshold || explorationMode,
        detail: explorationMode
          ? `${num(candidate.score.probability * 100, 1)}% via ${recoveryProbeMode ? "paper recovery probe" : "paper warm-up override"} | base ${num((candidate.decision.baseThreshold || candidate.decision.threshold) * 100, 1)}%`
          : `${num(candidate.score.probability * 100, 1)}% vs ${num(candidate.decision.threshold * 100, 1)}% threshold | base ${num((candidate.decision.baseThreshold || candidate.decision.threshold) * 100, 1)}%`
      },
      {
        label: "Transformer challenger",
        passed: (candidate.score.transformer?.confidence || 0) < this.config.transformerMinConfidence || (candidate.score.transformer?.probability || 0) >= candidate.decision.threshold - 0.03,
        detail: `${num((candidate.score.transformer?.probability || 0) * 100, 1)}% @ ${candidate.score.transformer?.dominantHead || "trend"}`
      },
      {
        label: "Calibration",
        passed: (candidate.score.calibrationConfidence || 0) >= this.config.minCalibrationConfidence,
        detail: `${num((candidate.score.calibrationConfidence || 0) * 100, 1)}% calibrated confidence`
      },
      {
        label: "Committee",
        passed: (candidate.committeeSummary?.agreement || 0) >= this.config.committeeMinAgreement && !(candidate.committeeSummary?.vetoes || []).length,
        detail: `agree ${num((candidate.committeeSummary?.agreement || 0) * 100, 1)}% | net ${num(candidate.committeeSummary?.netScore || 0, 3)}`
      },
      {
        label: "Regime",
        passed: (candidate.regimeSummary.confidence || 0) >= this.config.minRegimeConfidence,
        detail: `${candidate.regimeSummary.regime} @ ${num((candidate.regimeSummary.confidence || 0) * 100, 1)}%`
      },
      {
        label: "Strategy fit",
        passed: (candidate.strategySummary?.confidence || 0) < (candidate.decision.strategyConfidenceFloor || this.config.strategyMinConfidence) || ((candidate.strategySummary?.fitScore || 0) >= 0.5 && !(candidate.strategySummary?.blockers || []).length),
        detail: `${candidate.strategySummary?.strategyLabel || "strategy"} @ ${num((candidate.strategySummary?.fitScore || 0) * 100, 1)}% | gap ${num((candidate.strategySummary?.agreementGap || 0) * 100, 1)}% | family ${candidate.strategySummary?.familyLabel || "-"}`
      },
      {
        label: "Strategy optimizer",
        passed: (candidate.strategySummary?.optimizerBoost || 0) > -0.035 || (candidate.optimizerSummary?.sampleSize || 0) < 6,
        detail: `bias ${num((candidate.strategySummary?.optimizerBoost || 0) * 100, 1)}% | thr ${num((candidate.decision.thresholdAdjustment || 0) * 100, 1)}% | strat floor ${num((candidate.decision.strategyConfidenceFloor || this.config.strategyMinConfidence) * 100, 1)}%`
      },
      {
        label: "Strategy meta",
        passed: (candidate.strategyMetaSummary?.confidence || 0) < 0.28 || (candidate.strategyMetaSummary?.familyAlignment || 0) >= -0.12,
        detail: `${candidate.strategyMetaSummary?.preferredFamily || candidate.strategySummary?.family || "-"} | maker ${num(candidate.strategyMetaSummary?.makerBias || 0, 2)} | fit ${num((candidate.strategyMetaSummary?.fitBoost || 0) * 100, 1)}%`
      },
      {
        label: "Universe selector",
        passed: candidate.universeSummary?.selected !== false,
        detail: `score ${num((candidate.universeSummary?.score || 0) * 100, 1)}% | ${candidate.universeSummary?.health || "watch"} | ${num(candidate.universeSummary?.spreadBps || 0, 2)} bps`
      },
      {
        label: "Strategy attribution",
        passed: (candidate.attributionSummary?.rankBoost || 0) > -0.018 || (candidate.attributionSummary?.confidence || 0) < 0.25,
        detail: `boost ${num((candidate.attributionSummary?.rankBoost || 0) * 100, 1)}% | conf ${num((candidate.attributionSummary?.confidence || 0) * 100, 1)}% | ${candidate.attributionSummary?.strategyHealth || "neutral"}`
      },
      {
        label: "Agreement",
        passed: (candidate.score.disagreement || 0) <= this.config.maxModelDisagreement,
        detail: `champ/challenger/transformer ${num((candidate.score.disagreement || 0) * 100, 1)}% spread`
      },
      {
        label: "Spread",
        passed: candidate.marketSnapshot.book.spreadBps <= this.config.maxSpreadBps,
        detail: `${num(candidate.marketSnapshot.book.spreadBps, 2)} bps`
      },
      {
        label: "Orderbook",
        passed: (candidate.marketSnapshot.book.bookPressure || 0) >= this.config.minBookPressureForEntry || explorationMode,
        detail: explorationMode
          ? `pressure ${num(candidate.marketSnapshot.book.bookPressure || 0, 2)} | paper floor ${num(candidate.decision.paperExploration?.minBookPressure || this.config.paperExplorationMinBookPressure || 0, 2)}`
          : `pressure ${num(candidate.marketSnapshot.book.bookPressure || 0, 2)} | micro ${num(candidate.marketSnapshot.book.microPriceEdgeBps || 0, 2)} bps`
      },
      {
        label: "Local book",
        passed: !this.config.enableLocalOrderBook || (candidate.marketSnapshot.book.depthConfidence || 0) >= 0.28,
        detail: `depth ${num(candidate.marketSnapshot.book.depthConfidence || 0, 2)} | queue ${num(candidate.marketSnapshot.book.queueImbalance || 0, 2)} | refresh ${num(candidate.marketSnapshot.book.queueRefreshScore || 0, 2)}`
      },
      {
        label: "Pattern context",
        passed: (candidate.marketSnapshot.market.bearishPatternScore || 0) < 0.72,
        detail: `${candidate.marketSnapshot.market.dominantPattern || "none"} | bull ${num(candidate.marketSnapshot.market.bullishPatternScore || 0, 2)} / bear ${num(candidate.marketSnapshot.market.bearishPatternScore || 0, 2)}`
      },
      {
        label: "RL execution",
        passed: (candidate.rlAdvice?.confidence || 0) >= 0.3,
        detail: `${candidate.rlAdvice?.action || "balanced"} | exp ${num(candidate.rlAdvice?.expectedReward || 0, 3)}`
      },
      {
        label: "News reliability",
        passed: (candidate.newsSummary.reliabilityScore || 0) >= this.config.newsMinReliabilityScore || (candidate.newsSummary.coverage || 0) === 0,
        detail: `${num(candidate.newsSummary.reliabilityScore || 0, 2)} reliability | ${num(candidate.newsSummary.whitelistCoverage || 0, 2)} whitelist`
      },
      {
        label: "Exchange notices",
        passed: (candidate.exchangeSummary.riskScore || 0) < 0.7,
        detail: candidate.exchangeSummary.coverage ? `${candidate.exchangeSummary.highPriorityCount || 0} high-priority notices` : "Geen relevante Binance notices"
      },
      {
        label: "Market structure",
        passed: (candidate.marketStructureSummary.riskScore || 0) < 0.82,
        detail: `Funding ${num(candidate.marketStructureSummary.fundingRate || 0, 6)} | OI ${num((candidate.marketStructureSummary.openInterestChangePct || 0) * 100, 2)}%`
      },
      {
        label: "Macro sentiment",
        passed: (candidate.marketSentimentSummary?.riskScore || 0) < 0.84 || (candidate.marketSentimentSummary?.contrarianScore || 0) >= -0.2,
        detail: candidate.marketSentimentSummary?.fearGreedValue == null ? "Fear & Greed niet beschikbaar" : `FG ${num(candidate.marketSentimentSummary?.fearGreedValue || 0, 1)} | dom ${num(candidate.marketSentimentSummary?.btcDominancePct || 0, 1)}%`
      },
      {
        label: "Cross timeframe",
        passed: !(candidate.timeframeSummary?.blockerReasons || []).length,
        detail: `${candidate.timeframeSummary?.higherInterval || "1h"}/${candidate.timeframeSummary?.lowerInterval || "5m"} align ${num((candidate.timeframeSummary?.alignmentScore || 0) * 100, 1)}%`
      },
      {
        label: "Pair health",
        passed: !(candidate.pairHealthSummary?.quarantined),
        detail: `${candidate.pairHealthSummary?.health || "watch"} | score ${num((candidate.pairHealthSummary?.score || 0) * 100, 1)}%`
      },
      {
        label: "Bear market mode",
        passed: !candidate.decision.downtrendPolicy?.strongDowntrend || !candidate.decision.downtrendPolicy?.shortingUnavailable || !candidate.decision.reasons?.includes("spot_downtrend_guard"),
        detail: `${candidate.decision.downtrendPolicy?.strongDowntrend ? "downtrend" : "normal"} | score ${num((candidate.decision.downtrendPolicy?.downtrendScore || 0) * 100, 1)}% | ${candidate.decision.exchangeCapabilitiesApplied?.spotBearMarketMode || "defensive_rebounds"}`
      },
      {
        label: "Data quorum",
        passed: !candidate.qualityQuorumSummary?.observeOnly && (candidate.qualityQuorumSummary?.status || "ready") !== "degraded",
        detail: `${candidate.qualityQuorumSummary?.status || "ready"} | score ${num((candidate.qualityQuorumSummary?.quorumScore || 0) * 100, 1)}% | ${(candidate.qualityQuorumSummary?.blockerReasons || [])[0] || "geen blocker"}`
      },
      {
        label: "Reference venues",
        passed: (candidate.venueConfirmationSummary?.status || "warmup") !== "blocked",
        detail: candidate.venueConfirmationSummary?.venueCount
          ? `${candidate.venueConfirmationSummary.venueCount} venues | div ${num(candidate.venueConfirmationSummary?.divergenceBps || 0, 2)} bps`
          : "Geen venue-confirmatie"
      },
      {
        label: "Stablecoin flow",
        passed: (candidate.onChainLiteSummary?.riskOffScore || 0) < 0.82 && (candidate.onChainLiteSummary?.stressScore || 0) < 0.78,
        detail: `liq ${num((candidate.onChainLiteSummary?.liquidityScore || 0) * 100, 1)}% | breadth ${num((candidate.onChainLiteSummary?.marketBreadthScore || 0) * 100, 1)}% | stress ${num((candidate.onChainLiteSummary?.stressScore || 0) * 100, 1)}%`
      },
      {
        label: "Options volatility",
        passed: (candidate.volatilitySummary?.riskScore || 0) < 0.86,
        detail: candidate.volatilitySummary?.marketOptionIv == null ? "Deribit IV niet beschikbaar" : `${candidate.volatilitySummary?.regime || "unknown"} | IV ${num(candidate.volatilitySummary?.marketOptionIv || 0, 1)} | premium ${num(candidate.volatilitySummary?.ivPremium || 0, 1)}`
      },
      {
        label: "Event calendar",
        passed: (candidate.calendarSummary.riskScore || 0) < 0.72 || (candidate.calendarSummary.proximityHours || 999) > 24,
        detail: candidate.calendarSummary.nextEventTitle ? `${candidate.calendarSummary.nextEventType} in ${num(candidate.calendarSummary.proximityHours || 0, 1)}u` : "Geen impact-event dichtbij"
      },
      {
        label: "Session logic",
        passed: !(candidate.sessionSummary?.blockerReasons || []).length,
        detail: `${candidate.sessionSummary?.sessionLabel || candidate.sessionSummary?.session || "unknown"} | risk ${num(candidate.sessionSummary?.riskScore || 0, 2)} | funding ${candidate.sessionSummary?.hoursToFunding == null ? "-" : `${num(candidate.sessionSummary?.hoursToFunding || 0, 1)}u`}`
      },
      {
        label: "Drift monitor",
        passed: !(candidate.driftSummary?.blockerReasons || []).length,
        detail: `sev ${num(candidate.driftSummary?.severity || 0, 2)} | feat ${num(candidate.driftSummary?.featureDriftScore || 0, 2)} | src ${num(candidate.driftSummary?.sourceDriftScore || 0, 2)}`
      },
      {
        label: "Self-heal",
        passed: !["paused", "paper_fallback"].includes(candidate.selfHealState?.mode) || (explorationMode && suppressedReasons.has("self_heal_pause_entries")),
        detail: `${candidate.selfHealState?.mode || "normal"} | size ${num(candidate.selfHealState?.sizeMultiplier ?? 1, 2)} | thr ${num(candidate.selfHealState?.thresholdPenalty || 0, 2)}${explorationMode && suppressedReasons.has("self_heal_pause_entries") ? " | paper leniency" : ""}`
      },
      {
        label: "Meta gate",
        passed: (candidate.metaSummary?.action || "pass") !== "block",
        detail: `score ${num((candidate.metaSummary?.score || 0) * 100, 1)}% | conf ${num((candidate.metaSummary?.confidence || 0) * 100, 1)}% | budget ${num((candidate.metaSummary?.dailyBudgetFactor || 1) * 100, 1)}%`
      },
      {
        label: "Portfolio overlap",
        passed: !(candidate.portfolioSummary.reasons || []).length,
        detail: `Corr ${num(candidate.portfolioSummary.maxCorrelation || 0, 2)} | cluster ${candidate.portfolioSummary.sameClusterCount || 0} | alloc ${num((candidate.portfolioSummary.allocatorScore || 0) * 100, 1)}%`
      },
      {
        label: "Capital ladder",
        passed: candidate.decision.capitalLadderApplied?.allowEntries !== false,
        detail: `${candidate.decision.capitalLadderApplied?.stage || "paper"} | size ${num((candidate.decision.capitalLadderApplied?.sizeMultiplier || 1) * 100, 1)}%`
      },
      {
        label: "Capital governor",
        passed: candidate.decision.capitalGovernorApplied?.blocked !== true || (explorationMode && (suppressedReasons.has("capital_governor_blocked") || suppressedReasons.has("capital_governor_recovery"))),
        detail: `${candidate.decision.capitalGovernorApplied?.status || "ready"} | size ${num((candidate.decision.capitalGovernorApplied?.sizeMultiplier || 1) * 100, 1)}%${explorationMode && (suppressedReasons.has("capital_governor_blocked") || suppressedReasons.has("capital_governor_recovery")) ? ` | ${recoveryProbeMode ? "paper recovery probe" : "paper leniency"}` : ""}`
      },
      {
        label: "Execution cost budget",
        passed: (candidate.decision.executionCostBudgetApplied?.status || "ready") !== "blocked" || (explorationMode && suppressedReasons.has("execution_cost_budget_exceeded")),
        detail: `${candidate.decision.executionCostBudgetApplied?.status || "ready"} | avg ${num(candidate.decision.executionCostBudgetApplied?.averageTotalCostBps || 0, 2)} bps${explorationMode && suppressedReasons.has("execution_cost_budget_exceeded") ? " | paper leniency" : ""}`
      }
    ];
  }

  buildCandidateSummary(candidate) {
    const eventText = candidate.newsSummary.coverage
      ? `${candidate.newsSummary.dominantEventType || "general"} nieuws`
      : "weinig nieuwsimpact";
    const providerText = candidate.newsSummary.providerDiversity
      ? `${candidate.newsSummary.providerDiversity} providers / ${candidate.newsSummary.sourceDiversity || 0} bronnen`
      : "beperkte nieuwsdekking";
    const socialText = candidate.newsSummary.socialCoverage
      ? `${candidate.newsSummary.socialCoverage} social posts`
      : "geen social confirmatie";
    const noticeText = candidate.exchangeSummary.coverage
      ? `${candidate.exchangeSummary.highPriorityCount || 0} Binance notices`
      : "geen exchange notices";
    const structureText = (candidate.marketStructureSummary.reasons || []).length
      ? candidate.marketStructureSummary.reasons.slice(0, 2).join(", ")
      : "rustige perp-structuur";
    const orderbookText = Math.abs(candidate.marketSnapshot.book.bookPressure || 0) > 0.18
      ? `orderbook pressure ${num(candidate.marketSnapshot.book.bookPressure || 0, 2)}`
      : "neutraal orderboek";
    const patternText = (candidate.marketSnapshot.market.dominantPattern || "none") !== "none"
      ? `pattern ${candidate.marketSnapshot.market.dominantPattern}`
      : "geen sterk candle-pattern";
    const calendarText = candidate.calendarSummary.nextEventTitle
      ? `${candidate.calendarSummary.nextEventType} in ${num(candidate.calendarSummary.proximityHours || 0, 1)}u`
      : "geen macro/unlock-event dichtbij";
    const macroText = candidate.marketSentimentSummary?.fearGreedValue == null
      ? "fear/greed onbekend"
      : `FG ${num(candidate.marketSentimentSummary.fearGreedValue || 0, 1)} / BTC dom ${num(candidate.marketSentimentSummary.btcDominancePct || 0, 1)}%`;
    const volatilityText = candidate.volatilitySummary?.marketOptionIv == null
      ? "option-IV onbekend"
      : `${candidate.volatilitySummary.regime || "unknown"} IV ${num(candidate.volatilitySummary.marketOptionIv || 0, 1)} / premium ${num(candidate.volatilitySummary.ivPremium || 0, 1)}`;
    const topSignal = candidate.score.contributions[0];
    const signalText = topSignal ? `${topSignal.name} (${num(topSignal.contribution, 3)})` : "gebalanceerde signalen";
    const executionText = candidate.decision.executionPlan?.entryStyle === "pegged_limit_maker" ? "pegged-maker-entry" : candidate.decision.executionPlan?.entryStyle === "limit_maker" ? "maker-entry" : "market-entry";
    const explorationText = candidate.decision.entryMode === "paper_exploration"
      ? `paper warm-up mode met kleinere testpositie (${num((candidate.decision.paperExploration?.sizeMultiplier || 0) * 100, 1)}%)`
      : candidate.decision.entryMode === "paper_recovery_probe"
        ? `paper recovery probe met extra kleine herstelpositie (${num((candidate.decision.paperExploration?.sizeMultiplier || 0) * 100, 1)}%)`
        : executionText;
    const paperGuardrailText = (candidate.decision.paperGuardrailRelief || []).length
      ? `${candidate.decision.entryMode === "paper_recovery_probe" ? "paper recovery probe versoepelde" : "paper leniency versoepelde"} ${candidate.decision.paperGuardrailRelief.join(", ")}`
      : null;
    const setupStyle = buildSetupStyle(candidate);
    const strategyText = candidate.strategySummary?.strategyLabel ? `${candidate.strategySummary.strategyLabel} (${num((candidate.strategySummary.fitScore || 0) * 100, 1)}%)` : setupStyle;
    const adaptiveThresholdText = (candidate.decision?.thresholdAdjustment || 0) !== 0
      ? `adaptieve threshold ${num((candidate.decision?.threshold || 0) * 100, 1)}% vanaf basis ${num((candidate.decision?.baseThreshold || candidate.decision?.threshold || 0) * 100, 1)}%`
      : `vaste threshold ${num((candidate.decision?.threshold || 0) * 100, 1)}%`;
    const sessionText = candidate.sessionSummary?.sessionLabel
      ? `${candidate.sessionSummary.sessionLabel}${candidate.sessionSummary.lowLiquidity ? " low-liquidity" : ""}${candidate.sessionSummary.isWeekend ? " weekend" : ""}`
      : "neutrale sessie";
    const driftText = (candidate.driftSummary?.severity || 0) > 0
      ? `drift ${num((candidate.driftSummary?.severity || 0) * 100, 1)}%`
      : "geen drift-waarschuwing";
    const selfHealText = candidate.selfHealState?.active
      ? `self-heal ${candidate.selfHealState.mode}`
      : "self-heal normaal";
    const metaText = candidate.metaSummary?.canaryActive
      ? `meta gate ${num((candidate.metaSummary.score || 0) * 100, 1)}% met canary-size ${num((candidate.metaSummary.canarySizeMultiplier || 1) * 100, 1)}% en dagbudget ${num((candidate.metaSummary.dailyBudgetFactor || 1) * 100, 1)}%`
      : `meta gate ${num((candidate.metaSummary?.score || 0) * 100, 1)}% met dagbudget ${num((candidate.metaSummary?.dailyBudgetFactor || 1) * 100, 1)}%`;
    const optimizerText = (candidate.strategySummary?.optimizerBoost || 0) !== 0
      ? `optimizer ${candidate.strategySummary.optimizerBoost > 0 ? "versterkte" : "temde"} die keuze met ${num(Math.abs(candidate.strategySummary.optimizerBoost || 0) * 100, 1)}% op basis van gesloten trade-history en zette ${adaptiveThresholdText}`
      : `geen optimizer-bias, ${adaptiveThresholdText}`;
    const universeText = candidate.universeSummary
      ? `focus-universe ${num((candidate.universeSummary.score || 0) * 100, 1)}% (${candidate.universeSummary.health || "watch"})`
      : "geen universe-score";
    const attributionText = candidate.attributionSummary
      ? `strategy-attribution ${candidate.attributionSummary.reasons?.join(", ") || "neutraal"} met boost ${num((candidate.attributionSummary.rankBoost || 0) * 100, 1)}%`
      : "neutrale strategy-history";
    const quorumText = candidate.qualityQuorumSummary?.status === "observe_only"
      ? `data quorum observe-only door ${candidate.qualityQuorumSummary.blockerReasons.join(", ") || "meerdere kritieke checks"}`
      : candidate.qualityQuorumSummary?.status === "degraded"
        ? `data quorum degraded (${candidate.qualityQuorumSummary.cautionReasons?.[0] || candidate.qualityQuorumSummary.blockerReasons?.[0] || "extra voorzichtigheid"})`
        : `data quorum ${candidate.qualityQuorumSummary?.status || "ready"} op ${num((candidate.qualityQuorumSummary?.quorumScore || 0) * 100, 1)}%`;
    const downtrendText = candidate.decision?.downtrendPolicy?.strongDowntrend && candidate.decision?.downtrendPolicy?.shortingUnavailable
      ? `spot bear-market mode actief op ${num((candidate.decision.downtrendPolicy.downtrendScore || 0) * 100, 1)}% downtrend`
      : "geen speciale bear-market modus";
    if (candidate.decision.allow) {
      return `${candidate.symbol} kreeg groen licht voor ${setupStyle} via ${strategyText} in regime ${candidate.regimeSummary.regime}: score ${num(candidate.score.probability * 100, 1)}%, ${eventText}, ${socialText}, ${noticeText}, ${structureText}, ${macroText}, ${volatilityText}, ${orderbookText}, ${patternText}, ${calendarText}, ${providerText}, ${sessionText}, ${driftText}, ${selfHealText}, ${metaText}, ${signalText} als sterkste driver, ${optimizerText}, ${universeText}, ${attributionText}, ${quorumText}, ${downtrendText}${paperGuardrailText ? `, ${paperGuardrailText}` : ""} en ${explorationText} als execution-plan.`;
    }
    return `${candidate.symbol} werd geblokkeerd door ${candidate.decision.reasons.join(", ")}. Setup ${setupStyle} via ${strategyText}, regime ${candidate.regimeSummary.regime}, score ${num(candidate.score.probability * 100, 1)}%, ${socialText}, ${noticeText}, ${structureText}, ${macroText}, ${volatilityText}, ${orderbookText}, ${patternText}, ${calendarText}, ${providerText}, ${sessionText}, ${driftText}, ${selfHealText}, ${metaText}, ${universeText}, ${attributionText}, ${quorumText}, ${downtrendText} en ${optimizerText}.`;
  }

  buildEntryRationale(candidate) {
    return {
      summary: this.buildCandidateSummary(candidate),
      setupStyle: buildSetupStyle(candidate),
      probability: num(candidate.score.probability, 4),
      rawProbability: num(candidate.score.rawProbability || 0, 4),
      confidence: num(candidate.score.confidence || 0, 4),
      calibrationConfidence: num(candidate.score.calibrationConfidence || 0, 4),
      disagreement: num(candidate.score.disagreement || 0, 4),
      baseThreshold: num(candidate.decision.baseThreshold || candidate.decision.threshold, 4),
      threshold: num(candidate.decision.threshold, 4),
      thresholdAdjustment: num(candidate.decision.thresholdAdjustment || 0, 4),
      thresholdTuningApplied: candidate.decision.thresholdTuningApplied || null,
      strategyConfidenceFloor: num(candidate.decision.strategyConfidenceFloor || this.config.strategyMinConfidence, 4),
      rankScore: num(candidate.decision.rankScore, 4),
      quoteAmount: num(candidate.decision.quoteAmount, 2),
      entryMode: candidate.decision.entryMode || "standard",
      learningLane: candidate.decision.learningLane || null,
      learningValueScore: num(candidate.decision.learningValueScore || 0, 4),
      paperLearningBudget: candidate.decision.paperLearningBudget || null,
      paperLearningSampling: candidate.decision.paperLearningSampling || null,
      suppressedReasons: candidate.decision.suppressedReasons || [],
      paperExploration: candidate.decision.paperExploration || null,
      paperGuardrailRelief: [...(candidate.decision.paperGuardrailRelief || [])],
      spreadBps: num(candidate.marketSnapshot.book.spreadBps, 2),
      realizedVolPct: num(candidate.marketSnapshot.market.realizedVolPct, 4),
      atrPct: num(candidate.marketSnapshot.market.atrPct, 4),
      edgeToThreshold: num(candidate.score.probability - candidate.decision.threshold, 4),
      newsSentiment: num(candidate.newsSummary.sentimentScore, 3),
      newsRisk: num(candidate.newsSummary.riskScore, 3),
      newsCoverage: candidate.newsSummary.coverage || 0,
      providerDiversity: candidate.newsSummary.providerDiversity || 0,
      sourceDiversity: candidate.newsSummary.sourceDiversity || 0,
      socialCoverage: candidate.newsSummary.socialCoverage || 0,
      socialSentiment: num(candidate.newsSummary.socialSentiment || 0, 3),
      socialRisk: num(candidate.newsSummary.socialRisk || 0, 3),
      socialEngagement: num(candidate.newsSummary.socialEngagement || 0, 2),
      freshnessHours: candidate.newsSummary.freshnessHours == null ? null : num(candidate.newsSummary.freshnessHours, 1),
      sourceQualityScore: num(candidate.newsSummary.sourceQualityScore || 0, 3),
      reliabilityScore: num(candidate.newsSummary.reliabilityScore || 0, 3),
      whitelistCoverage: num(candidate.newsSummary.whitelistCoverage || 0, 3),
      positiveHeadlineCount: candidate.newsSummary.positiveHeadlineCount || 0,
      negativeHeadlineCount: candidate.newsSummary.negativeHeadlineCount || 0,
      dominantEventType: candidate.newsSummary.dominantEventType || "general",
      announcementCoverage: candidate.exchangeSummary.coverage || 0,
      announcementSentiment: num(candidate.exchangeSummary.sentimentScore || 0, 3),
      announcementRisk: num(candidate.exchangeSummary.riskScore || 0, 3),
      announcementFreshnessHours: candidate.exchangeSummary.noticeFreshnessHours == null ? null : num(candidate.exchangeSummary.noticeFreshnessHours, 1),
      marketStructure: summarizeMarketStructureSummary(candidate.marketStructureSummary),
      marketSentiment: summarizeMarketSentiment(candidate.marketSentimentSummary),
      volatility: summarizeVolatility(candidate.volatilitySummary),
      calendar: summarizeCalendarSummary(candidate.calendarSummary),
      exchange: summarizeExchange(candidate.exchangeSummary),
      session: summarizeSession(candidate.sessionSummary),
      drift: summarizeDrift(candidate.driftSummary),
      selfHeal: summarizeSelfHeal(candidate.selfHealState),
      meta: summarizeMeta(candidate.metaSummary),
      qualityQuorum: summarizeQualityQuorum(candidate.qualityQuorumSummary),
      orderBook: summarizeOrderBook(candidate.marketSnapshot.book),
      patterns: summarizePatterns(candidate.marketSnapshot.market),
      indicators: summarizeIndicators(candidate.marketSnapshot.market),
      strategy: summarizeStrategy(candidate.strategySummary),
      universe: candidate.universeSummary ? { ...candidate.universeSummary } : null,
      strategyAttribution: summarizeAttributionAdjustment(candidate.attributionSummary),
      optimizer: summarizeOptimizer(candidate.optimizerSummary),
      optimizerApplied: summarizeOptimizerApplied(candidate.decision.optimizerApplied),
      transformer: summarizeTransformer(candidate.score.transformer),
      sequence: summarizeSequence(candidate.score.sequence),
      expertMix: summarizeExpertMix(candidate.score.expertMix),
      metaNeural: summarizeMetaNeural(candidate.score.metaNeural),
      executionNeural: summarizeExecutionNeural(candidate.score.executionNeural),
      strategyMeta: summarizeStrategyMeta(candidate.strategyMetaSummary || candidate.score.strategyMeta || {}),
      committee: summarizeCommittee(candidate.committeeSummary),
      rlPolicy: summarizeRlPolicy(candidate.rlAdvice),
      parameterGovernor: candidate.decision.parameterGovernorApplied || null,
      capitalGovernor: summarizeCapitalGovernor(candidate.decision.capitalGovernorApplied || this.runtime.capitalGovernor || {}),
      capitalLadder: summarizeCapitalLadder(candidate.decision.capitalLadderApplied || this.runtime.capitalLadder || {}),
      venueConfirmation: summarizeVenueConfirmation(candidate.venueConfirmationSummary || {}),
      stopLossPct: num(candidate.decision.stopLossPct, 4),
      takeProfitPct: num(candidate.decision.takeProfitPct, 4),
      blockerReasons: [...(candidate.decision.reasons || [])],
      regimeReasons: [...(candidate.regimeSummary.reasons || [])],
      executionReasons: [...(candidate.decision.executionPlan?.rationale || [])],
      sessionReasons: [...(candidate.sessionSummary?.reasons || [])],
      sessionBlockers: [...(candidate.sessionSummary?.blockerReasons || [])],
      driftReasons: [...(candidate.driftSummary?.reasons || [])],
      driftBlockers: [...(candidate.driftSummary?.blockerReasons || [])],
      selfHealIssues: [...(candidate.selfHealState?.issues || [])],
      calendarBlockers: [...(candidate.calendarSummary.blockerReasons || [])],
      providerBreakdown: summarizeBreakdown(candidate.newsSummary.providerCounts),
      sourceBreakdown: summarizeBreakdown(candidate.newsSummary.sourceCounts),
      channelBreakdown: summarizeBreakdown(candidate.newsSummary.channelCounts || {}),
      announcementBreakdown: summarizeBreakdown(candidate.exchangeSummary.categoryCounts || {}),
      bullishDrivers: arr(candidate.newsSummary.bullishDrivers).slice(0, 3).map(summarizeDriver),
      bearishDrivers: arr(candidate.newsSummary.bearishDrivers).slice(0, 3).map(summarizeDriver),
      bullishSignals: summarizeSignalDrivers(candidate.score.contributions, "positive"),
      bearishSignals: summarizeSignalDrivers(candidate.score.contributions, "negative"),
      regimeSummary: summarizeRegime(candidate.regimeSummary),
      portfolioSummary: summarizePortfolio(candidate.portfolioSummary),
      streamSnapshot: summarizeStream(candidate.streamFeatures),
      executionPlan: summarizePlan(candidate.decision.executionPlan),
      executionAttribution: summarizeExecutionAttribution({
        brokerMode: this.config.botMode,
        entryStyle: candidate.decision.executionPlan?.entryStyle,
        fallbackStyle: candidate.decision.executionPlan?.fallbackStyle,
        preferMaker: candidate.decision.executionPlan?.preferMaker,
        requestedQuoteAmount: candidate.decision.quoteAmount,
        completionRatio: candidate.marketSnapshot.book.entryEstimate?.completionRatio || 0,
        expectedImpactBps: candidate.decision.executionPlan?.expectedImpactBps,
        expectedSlippageBps: candidate.decision.executionPlan?.expectedSlippageBps,
        makerFillRatio: candidate.decision.executionPlan?.preferMaker ? candidate.decision.executionPlan?.expectedMakerFillPct || 0 : 0,
        takerFillRatio: candidate.decision.executionPlan?.preferMaker ? 1 - (candidate.decision.executionPlan?.expectedMakerFillPct || 0) : 1,
        depthConfidence: candidate.decision.executionPlan?.depthConfidence,
        queueImbalance: candidate.decision.executionPlan?.queueImbalance,
        queueRefreshScore: candidate.decision.executionPlan?.queueRefreshScore,
        resilienceScore: candidate.decision.executionPlan?.resilienceScore,
        tradeFlow: candidate.decision.executionPlan?.tradeFlow,
        peggedOrder: candidate.decision.executionPlan?.usePeggedOrder,
        pegPriceType: candidate.decision.executionPlan?.pegPriceType,
        pegOffsetType: candidate.decision.executionPlan?.pegOffsetType,
        pegOffsetValue: candidate.decision.executionPlan?.pegOffsetValue,
        notes: candidate.decision.executionPlan?.rationale || []
      }),
      deploymentActive: this.model.getDeploymentSummary().active,
      topSignals: candidate.score.contributions.slice(0, 5).map(summarizeSignal),
      challengerSignals: candidate.score.challengerContributions.slice(0, 3).map(summarizeSignal),
      checks: this.buildCandidateChecks(candidate),
      headlines: arr(candidate.newsSummary.headlines).slice(0, 4).map(summarizeHeadline),
      officialNotices: arr(candidate.exchangeSummary.items).slice(0, 4).map(summarizeHeadline),
      calendarEvents: arr(candidate.calendarSummary.items).slice(0, 4),
      candleContext: summarizeCandleContext(candidate.marketSnapshot.candles)
    };
  }

  async evaluateCandidate(symbol, balance, now, context = {}) {
    const aliases = this.config.symbolMetadata[symbol] || [symbol];
    const marketSnapshot = context.marketSnapshot || (await this.getMarketSnapshot(symbol));
    if (context.relativeStrengthSummary) {
      marketSnapshot.market = {
        ...(marketSnapshot.market || {}),
        ...context.relativeStrengthSummary
      };
    }
    const newsSummary = context.newsSummary || (await this.news.getSymbolSummary(symbol, aliases));
    const streamFeatures = marketSnapshot.stream || this.stream.getSymbolStreamFeatures(symbol);
    const exchangeSummary = context.exchangeSummary || (await this.exchangeNotices.getSymbolSummary(symbol, aliases));
    const calendarSummary = context.calendarSummary || (await this.calendar.getSymbolSummary(symbol, aliases));
    const marketStructureSummary = context.marketStructureSummary || (await this.marketStructure.getSymbolSummary(symbol, streamFeatures));
    const marketSentimentSummary = context.marketSentimentSummary || (this.config.enableMarketSentimentContext ? await this.marketSentiment.getSummary() : EMPTY_MARKET_SENTIMENT);
    const volatilitySummary = context.volatilitySummary || (this.config.enableVolatilityContext ? await this.volatility.getSummary() : EMPTY_VOLATILITY_CONTEXT);
    const onChainLiteSummary = context.onChainLiteSummary || (this.config.enableOnChainLiteContext ? await this.onChainLite.getSummary(marketSentimentSummary) : EMPTY_ONCHAIN);
    const sessionSummary = this.config.enableSessionLogic
      ? buildSessionSummary({ now, marketSnapshot, marketStructureSummary, config: this.config })
      : { session: "disabled", sessionLabel: "Disabled", sizeMultiplier: 1, thresholdPenalty: 0, reasons: [], blockerReasons: [] };
    const regimeSummary = this.model.inferRegime({
      marketFeatures: marketSnapshot.market,
      newsSummary,
      streamFeatures,
      bookFeatures: marketSnapshot.book,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      announcementSummary: exchangeSummary,
      calendarSummary
    });
    const optimizerSummary = context.optimizerSummary || this.strategyOptimizer.buildSnapshot({ journal: this.journal, nowIso: now.toISOString() });
    let strategySummary = evaluateStrategySet({
      symbol,
      marketSnapshot,
      newsSummary,
      announcementSummary: exchangeSummary,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      calendarSummary,
      regimeSummary,
      streamFeatures,
      optimizerSummary,
      exchangeCapabilities: this.runtime.exchangeCapabilities || this.config.exchangeCapabilities || {}
    });
    const timeframeSummary = this.config.enableCrossTimeframeConsensus
      ? buildTimeframeConsensus({ marketSnapshot, regimeSummary, strategySummary, config: this.config })
      : summarizeTimeframeConsensus({ enabled: false });
    const pairHealthSummary = context.pairHealthSummary || this.pairHealthMonitor.evaluateSymbol(context.pairHealthSnapshot || {}, { symbol, marketSnapshot, newsSummary, timeframeSummary });
    const divergenceSummary = context.divergenceSummary || this.divergenceMonitor.buildSummary({ journal: this.journal, nowIso: now.toISOString() });
    const sourceReliabilitySummary = context.sourceReliabilitySummary || summarizeSourceReliability(this.runtime.sourceReliability || {});
    const strategyMetaSummary = this.model.scoreStrategyMeta({
      score: {
        probability: strategySummary.fitScore || 0.5,
        confidence: strategySummary.confidence || 0
      },
      marketSnapshot,
      newsSummary,
      marketStructureSummary,
      strategySummary,
      timeframeSummary,
      pairHealthSummary,
      regimeSummary
    });
    strategySummary = {
      ...strategySummary,
      fitScore: clamp((strategySummary.fitScore || 0) + (strategyMetaSummary.fitBoost || 0), 0, 1),
      confidence: clamp((strategySummary.confidence || 0) + Math.max(-0.04, Math.min(0.04, strategyMetaSummary.familyAlignment || 0)), 0, 1),
      metaSelector: summarizeStrategyMeta(strategyMetaSummary),
      preferredExecutionStyle: strategyMetaSummary.preferredExecutionStyle || null
    };
    const venueConfirmationSummary = context.venueConfirmationSummary || await this.referenceVenue.getSymbolSummary(symbol, marketSnapshot, {
      referenceQuotes: context.referenceQuotes || null
    });
    const qualityQuorumSummary = buildCandidateQualityQuorum({
      symbol,
      marketSnapshot,
      newsSummary,
      exchangeSummary,
      calendarSummary,
      pairHealthSummary,
      timeframeSummary,
      sourceReliabilitySummary,
      divergenceSummary,
      venueConfirmationSummary,
      config: this.config,
      nowIso: now.toISOString()
    });
    const trendStateSummary = buildTrendStateSummary({
      marketFeatures: marketSnapshot.market,
      bookFeatures: marketSnapshot.book,
      newsSummary,
      announcementSummary: exchangeSummary,
      qualityQuorumSummary,
      venueConfirmationSummary,
      timeframeSummary
    });
    const marketStateSummary = buildMarketStateSummary({
      trendStateSummary,
      marketFeatures: marketSnapshot.market,
      bookFeatures: marketSnapshot.book,
      newsSummary,
      announcementSummary: exchangeSummary,
      qualityQuorumSummary,
      venueConfirmationSummary,
      timeframeSummary
    });
    const dataQualitySummary = buildDataQualitySummary({
      newsSummary,
      announcementSummary: exchangeSummary,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      onChainLiteSummary,
      qualityQuorumSummary,
      venueConfirmationSummary,
      bookFeatures: marketSnapshot.book
    });
    const attributionSummary = this.strategyAttribution.getAdjustment(context.attributionSnapshot || {}, {
      symbol,
      strategyId: strategySummary.activeStrategy || null,
      familyId: strategySummary.family || null,
      regime: regimeSummary.regime
    });
    const openPositionContexts = context.openPositionContexts || this.buildOpenPositionContexts();
    const portfolioSummary = this.portfolio.evaluateCandidate({
      symbol,
      runtime: this.runtime,
      journal: this.journal,
      marketSnapshot,
      candidateProfile: this.config.symbolProfiles[symbol] || defaultProfile(symbol),
      openPositionContexts,
      regimeSummary,
      strategySummary,
      marketStructureSummary,
      calendarSummary
    });
    const currentExposure = this.risk.getCurrentExposure(this.runtime);
    const totalEquityProxy = Math.max(balance.quoteFree + currentExposure, 1);
    const symbolStats = this.model.getSymbolStats(symbol);
    const rawFeatures = buildFeatureVector({
      symbolStats,
      marketFeatures: marketSnapshot.market,
      bookFeatures: marketSnapshot.book,
      trendStateSummary,
      venueConfirmationSummary,
      newsSummary,
      announcementSummary: exchangeSummary,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      calendarSummary,
      portfolioFeatures: {
        heat: currentExposure / totalEquityProxy,
        maxCorrelation: portfolioSummary.maxCorrelation || 0,
        familyBudgetFactor: portfolioSummary.familyBudgetFactor || 1,
        regimeBudgetFactor: portfolioSummary.regimeBudgetFactor || 1,
        strategyBudgetFactor: portfolioSummary.strategyBudgetFactor || 1,
        dailyBudgetFactor: portfolioSummary.dailyBudgetFactor || 1,
        clusterHeat: portfolioSummary.clusterHeat || 0,
        allocatorScore: portfolioSummary.allocatorScore || 0.5
      },
      streamFeatures,
      regimeSummary,
      strategySummary,
      timeframeSummary,
      onChainLiteSummary,
      pairHealthSummary,
      sessionSummary,
      now
    });
    const score = this.model.score(rawFeatures, {
      regimeSummary,
      marketFeatures: marketSnapshot.market,
      marketSnapshot,
      newsSummary,
      streamFeatures,
      bookFeatures: marketSnapshot.book,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      announcementSummary: exchangeSummary,
      calendarSummary,
      strategySummary,
      timeframeSummary,
      pairHealthSummary,
      divergenceSummary
    });
    const driftSummary = this.config.enableDriftMonitoring
      ? this.driftMonitor.evaluateCandidate({
          symbol,
          rawFeatures,
          score,
          regimeSummary,
          newsSummary,
          marketSnapshot,
          model: this.model
        })
      : { severity: 0, reasons: [], blockerReasons: [] };
    const provisionalRlAdvice = this.rlPolicy.advise({
      symbol,
      marketSnapshot,
      score,
      regimeSummary,
      committeeSummary: { agreement: 0.5, netScore: 0 },
      newsSummary
    });
    const provisionalPlan = this.execution.buildEntryPlan({
      symbol,
      marketSnapshot,
      score,
      decision: { regime: regimeSummary.regime },
      regimeSummary,
      strategySummary,
      portfolioSummary,
      committeeSummary: null,
      rlAdvice: provisionalRlAdvice,
      executionNeuralSummary: score.executionNeural,
      venueConfirmationSummary: context.venueConfirmationSummary || {},
      sessionSummary
    });
    const committeeSummary = this.committee.evaluate({
      symbol,
      score,
      transformerScore: score.transformer,
      marketSnapshot,
      newsSummary,
      announcementSummary: exchangeSummary,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      calendarSummary,
      portfolioSummary,
      regimeSummary,
      strategySummary,
      executionPlan: provisionalPlan,
      rlAdvice: provisionalRlAdvice
    });
    const rlAdvice = this.rlPolicy.advise({
      symbol,
      marketSnapshot,
      score,
      regimeSummary,
      committeeSummary,
      newsSummary
    });
    score.metaNeural = this.model.metaNeural.score({
      score,
      committeeSummary,
      strategySummary,
      marketSnapshot,
      newsSummary,
      marketStructureSummary,
      pairHealthSummary,
      timeframeSummary,
      divergenceSummary,
      threshold: this.config.modelThreshold
    });
    score.executionNeural = this.model.executionNeural.score({
      score,
      marketSnapshot,
      committeeSummary,
      strategySummary,
      pairHealthSummary,
      timeframeSummary
    });
    const metaSummary = this.config.enableMetaDecisionGate
      ? this.metaGate.evaluate({
          symbol,
          score,
          marketSnapshot,
          newsSummary,
          announcementSummary: exchangeSummary,
          marketStructureSummary,
          marketSentimentSummary,
          volatilitySummary,
          calendarSummary,
          committeeSummary,
          strategySummary,
          sessionSummary,
          driftSummary,
          selfHealState: this.runtime.selfHeal || this.selfHeal.buildDefaultState(),
          portfolioSummary,
          timeframeSummary,
          pairHealthSummary,
          onChainLiteSummary,
          divergenceSummary,
          metaNeuralSummary: score.metaNeural,
          journal: this.journal,
          nowIso: now.toISOString()
        })
      : summarizeMeta({});
    const decision = this.risk.evaluateEntry({
      symbol,
      score,
      marketSnapshot,
      newsSummary,
      announcementSummary: exchangeSummary,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      calendarSummary,
      committeeSummary,
      rlAdvice,
      strategySummary,
      sessionSummary,
      driftSummary,
      selfHealState: this.runtime.selfHeal || this.selfHeal.buildDefaultState(),
      metaSummary,
      runtime: this.runtime,
      journal: this.journal,
      balance,
      symbolStats,
      portfolioSummary,
      regimeSummary,
      thresholdTuningSummary: this.runtime.thresholdTuning || {},
      parameterGovernorSummary: this.runtime.parameterGovernor || {},
      capitalLadderSummary: this.runtime.capitalLadder || {},
      capitalGovernorSummary: this.runtime.capitalGovernor || {},
      executionCostSummary: this.runtime.executionCost || {},
      strategyRetirementSummary: this.runtime.strategyRetirement || {},
      timeframeSummary,
      pairHealthSummary,
      qualityQuorumSummary,
      onChainLiteSummary,
      divergenceSummary,
      trendStateSummary,
      marketStateSummary,
      venueConfirmationSummary,
      exchangeCapabilitiesSummary: this.runtime.exchangeCapabilities || this.config.exchangeCapabilities || {},
      strategyMetaSummary: score.strategyMeta || strategyMetaSummary,
      nowIso: now.toISOString()
    });
    decision.rankScore = num((decision.rankScore || 0) + (attributionSummary.rankBoost || 0), 4);
    decision.attributionSummary = attributionSummary;
    const probeOnlyState = this.runtime.probeOnly || {};
    const probeOnlyActive = Boolean(probeOnlyState.enabled) && (!probeOnlyState.until || new Date(probeOnlyState.until).getTime() > now.getTime());
    if (probeOnlyActive) {
      decision.quoteAmount = num((decision.quoteAmount || 0) * 0.32, 2);
      decision.reasons = [...new Set([...(decision.reasons || []), "operator_probe_only"])].slice(0, 10);
      decision.operatorAction = "probe_only";
      decision.autoRecovery = "operator_probe_window";
    }
    marketSnapshot.book.entryEstimate = this.stream.estimateFill?.(symbol, "BUY", { quoteAmount: decision.quoteAmount }) || null;
    decision.executionPlan = this.execution.buildEntryPlan({
      symbol,
      marketSnapshot,
      score,
      decision,
      regimeSummary,
      strategySummary,
      portfolioSummary,
      committeeSummary,
      rlAdvice,
      executionNeuralSummary: score.executionNeural,
      strategyMetaSummary: score.strategyMeta || strategyMetaSummary,
      capitalLadderSummary: this.runtime.capitalLadder || {},
      venueConfirmationSummary,
      sessionSummary
    });
    const signalQualitySummary = buildSignalQualitySummary({
      marketFeatures: marketSnapshot.market,
      bookFeatures: marketSnapshot.book,
      strategySummary,
      trendStateSummary,
      qualityQuorumSummary,
      venueConfirmationSummary,
      newsSummary
    });
    const confidenceBreakdown = buildConfidenceBreakdown({
      score,
      trendStateSummary,
      signalQualitySummary,
      venueConfirmationSummary,
      qualityQuorumSummary,
      strategySummary,
      executionPlan: decision.executionPlan
    });
    decision.committeeSummary = committeeSummary;
    decision.rlAdvice = rlAdvice;
    decision.strategySummary = strategySummary;
    decision.marketStateSummary = marketStateSummary;
    decision.dataQualitySummary = decision.dataQualitySummary || dataQualitySummary;
    decision.signalQualitySummary = decision.signalQualitySummary || signalQualitySummary;
    decision.confidenceBreakdown = confidenceBreakdown;
    return {
      symbol,
      marketSnapshot,
      newsSummary,
      exchangeSummary,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      onChainLiteSummary,
      calendarSummary,
      timeframeSummary,
      pairHealthSummary,
      trendStateSummary,
      marketStateSummary,
      dataQualitySummary,
      signalQualitySummary,
      confidenceBreakdown,
      venueConfirmationSummary,
      qualityQuorumSummary,
      divergenceSummary,
      streamFeatures,
      rawFeatures,
      score,
      regimeSummary,
      strategySummary,
      strategyMetaSummary: score.strategyMeta || strategyMetaSummary,
      optimizerSummary,
      portfolioSummary,
      attributionSummary,
      universeSummary: context.universeSummary || null,
      committeeSummary,
      rlAdvice,
      sessionSummary,
      driftSummary,
      selfHealState: this.runtime.selfHeal || this.selfHeal.buildDefaultState(),
      metaSummary,
      sourceReliabilitySummary,
      qualityQuorumSummary,
      venueConfirmationSummary,
      trendStateSummary,
      marketStateSummary,
      decision
    };
  }

  async manageOpenPositions() {
    const mids = {};
    const reconciliation = await this.broker.reconcileRuntime({
      runtime: this.runtime,
      journal: this.journal,
      getMarketSnapshot: this.getMarketSnapshot.bind(this)
    });
    await this.applyReconciliation(reconciliation);

    for (const position of [...this.runtime.openPositions]) {
      try {
        const aliases = this.config.symbolMetadata[position.symbol] || [position.symbol];
        const marketSnapshot = await this.getMarketSnapshot(position.symbol);
        marketSnapshot.book.exitEstimate = this.stream.estimateFill?.(position.symbol, "SELL", { quantity: position.quantity }) || null;
        mids[position.symbol] = marketSnapshot.book.mid;
        const newsSummary = await this.news.getSymbolSummary(position.symbol, aliases);
        const exchangeSummary = await this.exchangeNotices.getSymbolSummary(position.symbol, aliases);
        const calendarSummary = await this.calendar.getSymbolSummary(position.symbol, aliases);
        const marketStructureSummary = await this.marketStructure.getSymbolSummary(position.symbol, marketSnapshot.stream || this.stream.getSymbolStreamFeatures(position.symbol));
        const marketSentimentSummary = this.config.enableMarketSentimentContext ? await this.marketSentiment.getSummary() : EMPTY_MARKET_SENTIMENT;
        const onChainLiteSummary = this.config.enableOnChainLiteContext ? await this.onChainLite.getSummary(marketSentimentSummary) : EMPTY_ONCHAIN;
        const strategySummary = position.strategyDecision || position.entryRationale?.strategy || {};
        const regimeSummary = this.model.inferRegime({ marketFeatures: marketSnapshot.market, newsSummary, streamFeatures: marketSnapshot.stream || {}, bookFeatures: marketSnapshot.book, marketStructureSummary, marketSentimentSummary, volatilitySummary: this.runtime.volatilityContext || EMPTY_VOLATILITY_CONTEXT, announcementSummary: exchangeSummary, calendarSummary });
        const timeframeSummary = this.config.enableCrossTimeframeConsensus ? buildTimeframeConsensus({ marketSnapshot, regimeSummary, strategySummary, config: this.config }) : summarizeTimeframeConsensus({ enabled: false });
        const currentPrice = marketSnapshot.book.mid || position.lastMarkedPrice || position.entryPrice;
        const currentValue = currentPrice * safeNumber(position.quantity || 0);
        const totalCost = safeNumber(position.totalCost || position.notional || currentValue, currentValue);
        const pnlPct = totalCost ? (currentValue - totalCost) / totalCost : 0;
        const highestPrice = Math.max(safeNumber(position.highestPrice, position.entryPrice), safeNumber(position.entryPrice, currentPrice));
        const drawdownFromHighPct = highestPrice ? (currentPrice - highestPrice) / highestPrice : 0;
        const heldMinutes = minutesBetween(position.entryAt, nowIso());
        const progressToScaleOut = clamp(
          pnlPct / Math.max(position.scaleOutTrailOffsetPct || this.config.scaleOutTriggerPct || 0.01, 0.004),
          -1,
          2.2
        );
        const timePressure = clamp(heldMinutes / Math.max(this.config.maxHoldMinutes || 1, 1), 0, 1.5);
        const spreadPressure = clamp(safeNumber(marketSnapshot.book.spreadBps) / Math.max(this.config.exitOnSpreadShockBps || 1, 1), 0, 1.5);
        const entrySlipDelta = safeNumber(position.entryExecutionAttribution?.slippageDeltaBps);
        const executionRegretScore = clamp(Math.max(0, entrySlipDelta) / 8 + Math.max(0, -safeNumber(marketSnapshot.book.bookPressure)) * 0.18, 0, 1);
        const exitNeuralSummary = this.model.scoreExit({
          pnlPct,
          drawdownFromHighPct,
          heldMinutes,
          maxHoldMinutes: this.config.maxHoldMinutes,
          bookPressure: marketSnapshot.book.bookPressure,
          signalScore: marketStructureSummary.signalScore,
          riskScore: marketStructureSummary.riskScore,
          higherBias: timeframeSummary.higherBias,
          alignmentScore: timeframeSummary.alignmentScore,
          onChainLiquidity: onChainLiteSummary.liquidityScore,
          onChainStress: onChainLiteSummary.stressScore,
          spreadPressure,
          timePressure,
          executionRegretScore,
          progressToScaleOut
        });
        const exitIntelligenceSummary = this.config.enableExitIntelligence
          ? this.exitIntelligence.evaluate({
              position,
              marketSnapshot,
              newsSummary,
              announcementSummary: exchangeSummary,
              marketStructureSummary,
              calendarSummary,
              marketSentimentSummary,
              onChainLiteSummary,
              timeframeSummary,
              regimeSummary,
              exitNeuralSummary,
              runtime: this.runtime,
              journal: this.journal,
              nowIso: nowIso()
            })
          : summarizeExitIntelligence({ action: "disabled", nextReviewBias: "disabled" });
        if (exitIntelligenceSummary.shouldTightenStop && exitIntelligenceSummary.suggestedStopLossPrice > (position.stopLossPrice || 0)) {
          position.stopLossPrice = exitIntelligenceSummary.suggestedStopLossPrice;
          this.recordEvent("position_stop_tightened", {
            symbol: position.symbol,
            stopLossPrice: position.stopLossPrice,
            reason: exitIntelligenceSummary.reason || "protect_winner"
          });
        }
        const exitDecision = this.risk.evaluateExit({
          position,
          currentPrice: marketSnapshot.book.mid,
          newsSummary,
          announcementSummary: exchangeSummary,
          marketStructureSummary,
          calendarSummary,
          marketSnapshot,
          exitIntelligenceSummary,
          exitPolicySummary: this.runtime.offlineTrainer?.exitLearning || {},
          parameterGovernorSummary: this.runtime.parameterGovernor || {},
          nowIso: nowIso()
        });
        position.highestPrice = exitDecision.updatedHigh;
        position.lowestPrice = exitDecision.updatedLow;
        position.lastMarkedPrice = marketSnapshot.book.mid;
        position.latestSpreadBps = marketSnapshot.book.spreadBps;
        position.latestNewsSummary = newsSummary;
        position.latestExchangeSummary = exchangeSummary;
        position.latestCalendarSummary = calendarSummary;
        position.latestMarketStructureSummary = marketStructureSummary;
        position.latestTimeframeSummary = timeframeSummary;
        position.latestOnChainLiteSummary = onChainLiteSummary;
        position.latestExitIntelligence = exitIntelligenceSummary;
        position.latestExitPolicy = exitDecision.exitPolicy || null;
        position.replayCheckpoints = arr(position.replayCheckpoints || []);
        position.replayCheckpoints.push({ at: nowIso(), price: num(marketSnapshot.book.mid, 6), spreadBps: num(marketSnapshot.book.spreadBps || 0, 2), bookPressure: num(marketSnapshot.book.bookPressure || 0, 3), newsRisk: num(newsSummary.riskScore || 0, 3), tfAlignment: num(timeframeSummary.alignmentScore || 0, 4), onChainStress: num(onChainLiteSummary.stressScore || 0, 4) });
        position.replayCheckpoints = position.replayCheckpoints.slice(-24);
        position.lastReviewedAt = nowIso();
        if (!position.manualReviewRequired && !position.reconcileRequired) {
          position.managementFailureCount = 0;
          position.operatorMode = "normal";
          if (!position.lifecycleState || ["protect_only", "manual_review", "reconcile_required"].includes(position.lifecycleState)) {
            position.lifecycleState = position.protectiveOrderListId ? "protected" : ((position.brokerMode || this.config.botMode) === "live" ? "open" : "simulated_open");
          }
        }
        if (exitDecision.shouldScaleOut) {
          if (position.manualReviewRequired || position.operatorMode === "protect_only") {
            this.recordEvent("position_scale_out_skipped", {
              symbol: position.symbol,
              reason: position.manualReviewRequired ? "manual_review" : "protect_only"
            });
            continue;
          }
          const scaleOut = await this.broker.scaleOutPosition({
            position,
            rules: this.symbolRules[position.symbol],
            marketSnapshot,
            fraction: exitDecision.scaleOutFraction,
            reason: exitDecision.scaleOutReason,
            runtime: this.runtime
          });
          scaleOut.exitIntelligenceSummary = exitIntelligenceSummary;
          this.journal.scaleOuts.push(scaleOut);
          this.recordEvent("position_scaled_out", {
            symbol: position.symbol,
            reason: scaleOut.reason,
            realizedPnl: scaleOut.realizedPnl,
            fraction: scaleOut.fraction
          });
          if (scaleOut.protectionWarning) {
            this.recordEvent("position_scale_out_protection_pending", {
              symbol: position.symbol,
              error: scaleOut.protectionWarning
            });
          }
          continue;
        }
        if (!exitDecision.shouldExit) {
          continue;
        }
        const trade = await this.broker.exitPosition({
          position,
          rules: this.symbolRules[position.symbol],
          marketSnapshot,
          reason: exitDecision.reason,
          runtime: this.runtime
        });
        trade.exitIntelligenceSummary = exitIntelligenceSummary;
        trade.replayCheckpoints = arr(position.replayCheckpoints || []);
        this.journal.trades.push(trade);
        await this.learnFromTrade(trade, "Closed position");
      } catch (error) {
        const safeguardedStateChange = Boolean(error.positionSafeguarded);
        if (!safeguardedStateChange) {
          position.managementFailureCount = (position.managementFailureCount || 0) + 1;
          if ((position.managementFailureCount || 0) >= (this.config.positionFailureManualReviewCount || 4)) {
            position.operatorMode = "manual_review";
            position.manualReviewRequired = true;
            position.lifecycleState = "manual_review";
          } else if ((position.managementFailureCount || 0) >= (this.config.positionFailureProtectOnlyCount || 2)) {
            position.operatorMode = "protect_only";
            position.lifecycleState = "protect_only";
          }
        }
        position.lastManagementError = error.message;
        position.lastManagementErrorAt = nowIso();
        this.logger.warn("Position management failed", { symbol: position.symbol, error: error.message });
        this.recordEvent("position_management_failed", {
          symbol: position.symbol,
          error: error.message,
          failureCount: position.managementFailureCount || 0,
          operatorMode: position.operatorMode || "normal",
          safeguardedStateChange
        });
      }
    }
    this.syncOrderLifecycleState("position_review");
    return mids;
  }

  async scanCandidates(balance, options = {}) {
    const readOnly = Boolean(options.readOnly);
    const scanMode = options.mode || (readOnly ? "preview" : "cycle");
    const now = new Date();
    const symbols = [...new Set([...this.config.watchlist, ...this.runtime.openPositions.map((position) => position.symbol)])];
    const shallowSnapshotMap = Object.fromEntries(symbols.map((symbol) => [
      symbol,
      buildLightweightSnapshot({
        symbol,
        config: this.config,
        streamFeatures: this.stream.getSymbolStreamFeatures(symbol),
        localBookSnapshot: this.stream.getOrderBookSnapshot?.(symbol) || null,
        cachedSnapshot: this.marketCache[symbol] || null
      })
    ]));
    const scanPlan = buildDeepScanPlan({
      config: this.config,
      watchlist: this.config.watchlist,
      openPositions: this.runtime.openPositions,
      latestDecisions: this.runtime.latestDecisions,
      shallowSnapshotMap,
      universeSelector: this.universeSelector,
      nowIso: now.toISOString()
    });
    if (!readOnly) {
      this.stream.setLocalBookUniverse(scanPlan.localBookSymbols || []);
    } else if (scanMode === "research") {
      this.logger.info("Read-only research scan keeps existing local-book universe", {
        localBookSymbols: (scanPlan.localBookSymbols || []).length
      });
    }
    const snapshotEntries = await mapWithConcurrency(scanPlan.deepScanSymbols || symbols, this.config.marketSnapshotConcurrency || 4, async (symbol) => {
      try {
        return [symbol, await this.getMarketSnapshot(symbol)];
      } catch (error) {
        this.logger.warn("Snapshot prefetch failed", { symbol, error: error.message });
        return [symbol, null];
      }
    });
    const snapshotMap = {
      ...shallowSnapshotMap,
      ...Object.fromEntries(snapshotEntries.filter(([, snapshot]) => snapshot))
    };
    const relativeStrengthMap = buildRelativeStrengthMap(snapshotMap, Object.keys(snapshotMap), this.config);
    const openPositionContexts = this.buildOpenPositionContexts(snapshotMap);
    const optimizerSnapshot = this.strategyOptimizer.buildSnapshot({ journal: this.journal, nowIso: now.toISOString() });
    const attributionSnapshot = this.strategyAttribution.buildSnapshot({ journal: this.journal, nowIso: now.toISOString() });
    const sharedMarketSentimentSummary = this.config.enableMarketSentimentContext ? await this.marketSentiment.getSummary() : EMPTY_MARKET_SENTIMENT;
    const sharedVolatilitySummary = this.config.enableVolatilityContext ? await this.volatility.getSummary() : EMPTY_VOLATILITY_CONTEXT;
    const sharedOnChainLiteSummary = this.config.enableOnChainLiteContext ? await this.onChainLite.getSummary(sharedMarketSentimentSummary) : EMPTY_ONCHAIN;
    const pairHealthSnapshot = this.pairHealthMonitor.buildSnapshot({ journal: this.journal, runtime: this.runtime, watchlist: this.config.watchlist, nowIso: now.toISOString() });
    const divergenceSummary = this.divergenceMonitor.buildSummary({ journal: this.journal, nowIso: now.toISOString() });
    const offlineTrainerSummary = this.offlineTrainer.buildSummary({ journal: this.journal, dataRecorder: this.dataRecorder.getSummary(), counterfactuals: this.journal.counterfactuals || [], nowIso: now.toISOString() });
    const sourceReliabilitySummary = summarizeSourceReliability(this.runtime.sourceReliability || {});
    if (!readOnly) {
      this.runtime.aiTelemetry.strategyOptimizer = summarizeOptimizer(optimizerSnapshot);
      this.runtime.strategyAttribution = summarizeAttributionSnapshot(attributionSnapshot);
      this.runtime.marketSentiment = summarizeMarketSentiment(sharedMarketSentimentSummary);
      this.runtime.volatilityContext = summarizeVolatility(sharedVolatilitySummary);
      this.runtime.onChainLite = summarizeOnChainLite(sharedOnChainLiteSummary);
      this.runtime.divergence = summarizeDivergenceSummary(divergenceSummary);
      this.runtime.offlineTrainer = summarizeOfflineTrainer(offlineTrainerSummary);
      this.runtime.sourceReliability = sourceReliabilitySummary;
    }
    const universeSnapshot = scanPlan.universeSnapshot;
    if (!readOnly) {
      this.runtime.universe = summarizeUniverseSelection(universeSnapshot);
      this.journal.universeRuns.push({
        at: now.toISOString(),
        selectedSymbols: [...(universeSnapshot.selectedSymbols || [])],
        selectedCount: universeSnapshot.selectedCount || 0,
        eligibleCount: universeSnapshot.eligibleCount || 0,
        averageScore: num(universeSnapshot.averageScore || 0, 4),
        bestSymbol: universeSnapshot.selectedSymbols?.[0] || null
      });
    }
    const universeEntryMap = Object.fromEntries(
      [...arr(universeSnapshot.selected || []), ...arr(universeSnapshot.skipped || [])].map((entry) => [entry.symbol, entry])
    );
    const symbolsToEvaluate = (universeSnapshot.selectedSymbols || []).length ? universeSnapshot.selectedSymbols : this.config.watchlist;
    const candidateEntries = await mapWithConcurrency(
      symbolsToEvaluate.filter((symbol) => this.symbolRules[symbol]),
      Math.max(1, this.config.candidateEvaluationConcurrency || 3),
      async (symbol) => {
        try {
          const candidate = await this.evaluateCandidate(symbol, balance, now, {
            marketSnapshot: snapshotMap[symbol],
            openPositionContexts,
            optimizerSummary: optimizerSnapshot,
            attributionSnapshot,
            universeSummary: universeEntryMap[symbol] || null,
            marketSentimentSummary: sharedMarketSentimentSummary,
            volatilitySummary: sharedVolatilitySummary,
            onChainLiteSummary: sharedOnChainLiteSummary,
            pairHealthSnapshot,
            divergenceSummary,
            sourceReliabilitySummary,
            relativeStrengthSummary: relativeStrengthMap[symbol] || null
          });
          return candidate;
        } catch (error) {
          this.logger.warn("Candidate evaluation failed", { symbol, error: error.message });
          if (!readOnly) {
            this.recordEvent("candidate_evaluation_failed", { symbol, error: error.message });
          }
          return null;
        }
      }
    );
    const candidates = candidateEntries.filter(Boolean);
    if (!readOnly) {
      for (const candidate of candidates) {
        if (!candidate.decision.allow) {
          this.queueCounterfactualCandidate(candidate, now.toISOString());
        }
      }
    }

    candidates.sort((left, right) => right.decision.rankScore - left.decision.rankScore);
    if (!readOnly) {
      this.runtime.pairHealth = summarizePairHealth({ ...pairHealthSnapshot, leadSymbol: candidates[0]?.symbol || null, leadScore: candidates[0]?.pairHealthSummary?.score ?? null });
      this.runtime.qualityQuorum = summarizeQualityQuorum(buildRuntimeQualityQuorum(candidates, now.toISOString()));
      this.runtime.venueConfirmation = summarizeVenueConfirmation(this.referenceVenue.summarizeRuntime(candidates, now.toISOString()));
      this.runtime.latestDecisions = candidates.slice(0, this.config.dashboardDecisionLimit).map((candidate) => ({
      symbol: candidate.symbol,
      summary: this.buildCandidateSummary(candidate),
      setupStyle: buildSetupStyle(candidate),
      strategy: summarizeStrategy(candidate.strategySummary),
      strategyMeta: summarizeStrategyMeta(candidate.strategyMetaSummary || candidate.score.strategyMeta || {}),
      probability: num(candidate.score.probability, 4),
      rawProbability: num(candidate.score.rawProbability || 0, 4),
      confidence: num(candidate.score.confidence || 0, 4),
      calibrationConfidence: num(candidate.score.calibrationConfidence || 0, 4),
      disagreement: num(candidate.score.disagreement || 0, 4),
      allow: candidate.decision.allow,
      reasons: candidate.decision.reasons,
      blockerReasons: [...(candidate.decision.reasons || [])],
      regimeReasons: [...(candidate.regimeSummary.reasons || [])],
      executionReasons: [...(candidate.decision.executionPlan?.rationale || [])],
      rankScore: num(candidate.decision.rankScore, 4),
      threshold: num(candidate.decision.threshold, 4),
      quoteAmount: num(candidate.decision.quoteAmount, 2),
      learningLane: candidate.decision.learningLane || null,
      learningValueScore: num(candidate.decision.learningValueScore || 0, 4),
      paperLearningBudget: candidate.decision.paperLearningBudget || null,
      spreadBps: num(candidate.marketSnapshot.book.spreadBps, 2),
      realizedVolPct: num(candidate.marketSnapshot.market.realizedVolPct, 4),
      edgeToThreshold: num(candidate.score.probability - candidate.decision.threshold, 4),
      newsSentiment: num(candidate.newsSummary.sentimentScore, 3),
      newsRisk: num(candidate.newsSummary.riskScore, 3),
      announcementRisk: num(candidate.exchangeSummary.riskScore || 0, 3),
      dominantEventType: candidate.newsSummary.dominantEventType || "general",
      providerDiversity: candidate.newsSummary.providerDiversity || 0,
      sourceDiversity: candidate.newsSummary.sourceDiversity || 0,
      socialCoverage: candidate.newsSummary.socialCoverage || 0,
      socialSentiment: num(candidate.newsSummary.socialSentiment || 0, 3),
      socialRisk: num(candidate.newsSummary.socialRisk || 0, 3),
      socialEngagement: num(candidate.newsSummary.socialEngagement || 0, 2),
      freshnessHours: candidate.newsSummary.freshnessHours == null ? null : num(candidate.newsSummary.freshnessHours, 1),
      sourceQualityScore: num(candidate.newsSummary.sourceQualityScore || 0, 3),
      reliabilityScore: num(candidate.newsSummary.reliabilityScore || 0, 3),
      whitelistCoverage: num(candidate.newsSummary.whitelistCoverage || 0, 3),
      venueConfirmation: summarizeVenueConfirmation(candidate.venueConfirmationSummary || {}),
      capitalLadder: summarizeCapitalLadder(candidate.decision.capitalLadderApplied || {}),
      parameterGovernor: candidate.decision.parameterGovernorApplied || null,
      regime: candidate.regimeSummary.regime,
      regimeConfidence: num(candidate.regimeSummary.confidence || 0, 3),
      baseThreshold: num(candidate.decision.baseThreshold || candidate.decision.threshold, 4),
      threshold: num(candidate.decision.threshold, 4),
      thresholdAdjustment: num(candidate.decision.thresholdAdjustment || 0, 4),
      thresholdTuningApplied: candidate.decision.thresholdTuningApplied || null,
      strategyConfidenceFloor: num(candidate.decision.strategyConfidenceFloor || this.config.strategyMinConfidence, 4),
      executionStyle: candidate.decision.executionPlan?.entryStyle || "market",
      providerBreakdown: summarizeBreakdown(candidate.newsSummary.providerCounts),
      sourceBreakdown: summarizeBreakdown(candidate.newsSummary.sourceCounts),
      channelBreakdown: summarizeBreakdown(candidate.newsSummary.channelCounts || {}),
      announcementBreakdown: summarizeBreakdown(candidate.exchangeSummary.categoryCounts || {}),
      bullishDrivers: arr(candidate.newsSummary.bullishDrivers).slice(0, 2).map(summarizeDriver),
      bearishDrivers: arr(candidate.newsSummary.bearishDrivers).slice(0, 2).map(summarizeDriver),
      officialNotices: arr(candidate.exchangeSummary.items).slice(0, 3).map(summarizeHeadline),
      calendarEvents: arr(candidate.calendarSummary.items).slice(0, 3),
      bullishSignals: summarizeSignalDrivers(candidate.score.contributions, "positive"),
      bearishSignals: summarizeSignalDrivers(candidate.score.contributions, "negative"),
      portfolioSummary: summarizePortfolio(candidate.portfolioSummary),
      exchangeSummary: summarizeExchange(candidate.exchangeSummary),
      marketStructure: summarizeMarketStructureSummary(candidate.marketStructureSummary),
      marketSentiment: summarizeMarketSentiment(candidate.marketSentimentSummary),
      volatility: summarizeVolatility(candidate.volatilitySummary),
      calendar: summarizeCalendarSummary(candidate.calendarSummary),
      timeframe: summarizeTimeframeConsensus(candidate.timeframeSummary),
      pairHealth: { symbol: candidate.pairHealthSummary?.symbol || candidate.symbol, score: num(candidate.pairHealthSummary?.score || 0, 4), health: candidate.pairHealthSummary?.health || "watch", quarantined: Boolean(candidate.pairHealthSummary?.quarantined), reasons: [...(candidate.pairHealthSummary?.reasons || [])].slice(0, 4) },
      qualityQuorum: summarizeQualityQuorum(candidate.qualityQuorumSummary),
      trendState: candidate.trendStateSummary ? {
        direction: candidate.trendStateSummary.direction || "mixed",
        phase: candidate.trendStateSummary.phase || "mixed_transition",
        uptrendScore: num(candidate.trendStateSummary.uptrendScore || 0, 4),
        downtrendScore: num(candidate.trendStateSummary.downtrendScore || 0, 4),
        rangeScore: num(candidate.trendStateSummary.rangeScore || 0, 4),
        rangeAcceptanceScore: num(candidate.trendStateSummary.rangeAcceptanceScore || 0, 4),
        dataConfidenceScore: num(candidate.trendStateSummary.dataConfidenceScore || 0, 4),
        completenessScore: num(candidate.trendStateSummary.completenessScore || 0, 4),
        reasons: [...(candidate.trendStateSummary.reasons || [])].slice(0, 4)
      } : null,
      marketState: summarizeMarketState(candidate.marketStateSummary || buildMarketStateSummary({
        trendStateSummary: candidate.trendStateSummary || {}
      })),
      dataQuality: candidate.dataQualitySummary ? {
        status: candidate.dataQualitySummary.status || "ready",
        overallScore: num(candidate.dataQualitySummary.overallScore || 0, 4),
        freshnessScore: num(candidate.dataQualitySummary.freshnessScore || 0, 4),
        trustScore: num(candidate.dataQualitySummary.trustScore || 0, 4),
        coverageScore: num(candidate.dataQualitySummary.coverageScore || 0, 4),
        degradedButAllowed: Boolean(candidate.dataQualitySummary.degradedButAllowed),
        degradedCount: candidate.dataQualitySummary.degradedCount || 0,
        missingCount: candidate.dataQualitySummary.missingCount || 0,
        sources: arr(candidate.dataQualitySummary.sources || []).slice(0, 6)
      } : null,
      signalQuality: candidate.signalQualitySummary ? {
        overallScore: num(candidate.signalQualitySummary.overallScore || 0, 4),
        setupFit: num(candidate.signalQualitySummary.setupFit || 0, 4),
        structureQuality: num(candidate.signalQualitySummary.structureQuality || 0, 4),
        executionViability: num(candidate.signalQualitySummary.executionViability || 0, 4),
        newsCleanliness: num(candidate.signalQualitySummary.newsCleanliness || 0, 4),
        quorumQuality: num(candidate.signalQualitySummary.quorumQuality || 0, 4)
      } : null,
      confidenceBreakdown: candidate.confidenceBreakdown ? {
        marketConfidence: num(candidate.confidenceBreakdown.marketConfidence || 0, 4),
        dataConfidence: num(candidate.confidenceBreakdown.dataConfidence || 0, 4),
        executionConfidence: num(candidate.confidenceBreakdown.executionConfidence || 0, 4),
        modelConfidence: num(candidate.confidenceBreakdown.modelConfidence || 0, 4),
        overallConfidence: num(candidate.confidenceBreakdown.overallConfidence || 0, 4)
      } : null,
      riskPolicy: {
        downtrendPolicy: candidate.decision.downtrendPolicy || null,
        qualityQuorum: summarizeQualityQuorum(candidate.qualityQuorumSummary),
        capitalPolicy: summarizeCapitalPolicy({
          capitalLadder: candidate.decision.capitalLadderApplied || {},
          capitalGovernor: {
            ...(candidate.decision.capitalGovernorApplied || {}),
            policyEngine: this.runtime?.capitalPolicy || {}
          }
        })
      },
      executionBudget: summarizeExecutionCost(candidate.decision.executionCostBudgetApplied || this.runtime.executionCost || {}),
      paperLearning: candidate.decision.paperLearningSampling ? {
        lane: candidate.decision.learningLane || null,
        learningValueScore: num(candidate.decision.learningValueScore || 0, 4),
        noveltyScore: num(candidate.decision.paperLearningSampling?.noveltyScore || 0, 4),
        rarityScore: num(candidate.decision.paperLearningSampling?.rarityScore || 0, 4),
        scope: {
          family: candidate.decision.paperLearningSampling?.scope?.family || null,
          regime: candidate.decision.paperLearningSampling?.scope?.regime || null,
          session: candidate.decision.paperLearningSampling?.scope?.session || null
        },
        probeCaps: candidate.decision.paperLearningSampling?.probeCaps || null,
        budget: candidate.decision.paperLearningBudget || null,
        blockerCategories: candidate.decision.paperBlockerCategories || {},
        thresholdSandbox: candidate.decision.paperThresholdSandbox || null
      } : null,
      onChainLite: summarizeOnChainLite(candidate.onChainLiteSummary),
      orderBook: summarizeOrderBook(candidate.marketSnapshot.book),
      patterns: summarizePatterns(candidate.marketSnapshot.market),
      indicators: summarizeIndicators(candidate.marketSnapshot.market),
      universe: candidate.universeSummary ? { ...candidate.universeSummary } : null,
      strategyAttribution: summarizeAttributionAdjustment(candidate.attributionSummary),
      executionPlan: summarizePlan(candidate.decision.executionPlan),
      executionAttribution: summarizeExecutionAttribution({
        brokerMode: this.config.botMode,
        entryStyle: candidate.decision.executionPlan?.entryStyle,
        fallbackStyle: candidate.decision.executionPlan?.fallbackStyle,
        preferMaker: candidate.decision.executionPlan?.preferMaker,
        requestedQuoteAmount: candidate.decision.quoteAmount,
        completionRatio: candidate.marketSnapshot.book.entryEstimate?.completionRatio || 0,
        expectedImpactBps: candidate.decision.executionPlan?.expectedImpactBps,
        expectedSlippageBps: candidate.decision.executionPlan?.expectedSlippageBps,
        makerFillRatio: candidate.decision.executionPlan?.preferMaker ? candidate.decision.executionPlan?.expectedMakerFillPct || 0 : 0,
        takerFillRatio: candidate.decision.executionPlan?.preferMaker ? 1 - (candidate.decision.executionPlan?.expectedMakerFillPct || 0) : 1,
        depthConfidence: candidate.decision.executionPlan?.depthConfidence,
        queueImbalance: candidate.decision.executionPlan?.queueImbalance,
        queueRefreshScore: candidate.decision.executionPlan?.queueRefreshScore,
        resilienceScore: candidate.decision.executionPlan?.resilienceScore,
        tradeFlow: candidate.decision.executionPlan?.tradeFlow,
        peggedOrder: candidate.decision.executionPlan?.usePeggedOrder,
        pegPriceType: candidate.decision.executionPlan?.pegPriceType,
        pegOffsetType: candidate.decision.executionPlan?.pegOffsetType,
        pegOffsetValue: candidate.decision.executionPlan?.pegOffsetValue,
        notes: candidate.decision.executionPlan?.rationale || []
      }),
      streamSnapshot: summarizeStream(candidate.streamFeatures),
      strategySummary: summarizeStrategy(candidate.strategySummary),
      optimizer: summarizeOptimizer(candidate.optimizerSummary),
      optimizerApplied: summarizeOptimizerApplied(candidate.decision.optimizerApplied),
      topSignals: candidate.score.contributions.slice(0, 4).map(summarizeSignal),
      transformer: summarizeTransformer(candidate.score.transformer),
      sequence: summarizeSequence(candidate.score.sequence),
      expertMix: summarizeExpertMix(candidate.score.expertMix),
      metaNeural: summarizeMetaNeural(candidate.score.metaNeural),
      executionNeural: summarizeExecutionNeural(candidate.score.executionNeural),
      committee: summarizeCommittee(candidate.committeeSummary),
      rlPolicy: summarizeRlPolicy(candidate.rlAdvice),
      session: summarizeSession(candidate.sessionSummary),
      drift: summarizeDrift(candidate.driftSummary),
      selfHeal: summarizeSelfHeal(candidate.selfHealState),
      paperGuardrailRelief: [...(candidate.decision.paperGuardrailRelief || [])],
      meta: summarizeMeta(candidate.metaSummary),
      sessionReasons: [...(candidate.sessionSummary?.reasons || [])],
      sessionBlockers: [...(candidate.sessionSummary?.blockerReasons || [])],
      driftReasons: [...(candidate.driftSummary?.reasons || [])],
      driftBlockers: [...(candidate.driftSummary?.blockerReasons || [])],
      selfHealIssues: [...(candidate.selfHealState?.issues || [])],
      headlines: arr(candidate.newsSummary.headlines).slice(0, 3).map(summarizeHeadline),
      entryStatus: candidate.decision.allow ? "eligible" : "blocked",
      entryOpened: false,
      entryAttempted: false,
      executionBlockers: []
    }));
      const blockedCandidates = this.runtime.latestDecisions.filter((decision) => !decision.allow).slice(0, this.config.dashboardDecisionLimit).map((decision) => ({
      ...decision,
      blockedAt: now.toISOString()
      }));
      this.runtime.latestBlockedSetups = blockedCandidates;
      this.journal.blockedSetups.push(...blockedCandidates.slice(0, 4));
      this.runtime.marketSentiment = candidates[0]
        ? summarizeMarketSentiment(candidates[0].marketSentimentSummary)
        : this.runtime.marketSentiment || summarizeMarketSentiment(EMPTY_MARKET_SENTIMENT);
      this.runtime.volatilityContext = candidates[0]
        ? summarizeVolatility(candidates[0].volatilitySummary)
        : this.runtime.volatilityContext || summarizeVolatility(EMPTY_VOLATILITY_CONTEXT);
      this.runtime.onChainLite = candidates[0]
        ? summarizeOnChainLite(candidates[0].onChainLiteSummary)
        : this.runtime.onChainLite || summarizeOnChainLite(EMPTY_ONCHAIN);
      this.runtime.session = candidates[0]
        ? summarizeSession(candidates[0].sessionSummary)
        : this.runtime.session || summarizeSession({});
    }
    return candidates;
  }

  async scanCandidatesReadOnly(balance) {
    return this.scanCandidates(balance, { readOnly: true, mode: "preview" });
  }

  async scanCandidatesForCycle(balance) {
    return this.scanCandidates(balance, { readOnly: false, mode: "cycle" });
  }

  async scanCandidatesForResearch(balance) {
    return this.scanCandidates(balance, { readOnly: true, mode: "research" });
  }

  async openBestCandidate(candidates, { executionBlockers = [] } = {}) {
    const botMode = this.config?.botMode || this.runtime?.mode || "paper";
    const attempt = {
      status: "idle",
      selectedSymbol: null,
      openedPosition: null,
      attemptedSymbols: [],
      blockedReasons: [...(executionBlockers || [])],
      entryErrors: []
    };
    if (!this.health.canEnterNewPositions(this.runtime)) {
      attempt.status = "health_blocked";
      attempt.blockedReasons.push("health_circuit_open");
      return attempt;
    }
    if (botMode === "live" && this.runtime.exchangeTruth?.freezeEntries) {
      attempt.status = "runtime_blocked";
      attempt.blockedReasons.push("exchange_truth_freeze");
      return attempt;
    }
    if (attempt.blockedReasons.length) {
      attempt.status = "runtime_blocked";
      return attempt;
    }
    const allowedCandidates = candidates.filter((item) => item.decision.allow);
    if (!allowedCandidates.length) {
      attempt.status = "no_allowed_candidates";
      return attempt;
    }

    for (const candidate of allowedCandidates) {
      attempt.selectedSymbol = attempt.selectedSymbol || candidate.symbol;
      attempt.attemptedSymbols.push(candidate.symbol);
      const entryRationale = this.buildEntryRationale(candidate);
      try {
        const position = await this.broker.enterPosition({
          symbol: candidate.symbol,
          quoteAmount: candidate.decision.quoteAmount,
          rules: this.symbolRules[candidate.symbol],
          marketSnapshot: candidate.marketSnapshot,
          decision: candidate.decision,
          score: candidate.score,
          rawFeatures: candidate.rawFeatures,
          strategySummary: candidate.strategySummary,
          newsSummary: candidate.newsSummary,
          entryRationale,
          runtime: this.runtime
        });
        this.recordEvent("position_opened", {
          symbol: position.symbol,
          probability: candidate.score.probability,
          regime: candidate.regimeSummary.regime,
          strategy: candidate.strategySummary?.activeStrategy || null,
          executionStyle: candidate.decision.executionPlan?.entryStyle || "market",
          rationale: entryRationale.summary,
          protectiveOrderListId: position.protectiveOrderListId || null,
          metaScore: candidate.metaSummary?.score || 0,
          canaryActive: Boolean(candidate.metaSummary?.canaryActive)
        });
        attempt.status = "opened";
        attempt.selectedSymbol = candidate.symbol;
        attempt.openedPosition = position;
        return attempt;
      } catch (error) {
        this.logger.warn("Position entry failed", { symbol: candidate.symbol, error: error.message });
        this.recordEvent("position_open_failed", { symbol: candidate.symbol, error: error.message });
        if (error.recoveredTrade) {
          this.journal.trades.push(error.recoveredTrade);
          this.recordEvent("entry_recovered_flat", {
            symbol: error.recoveredTrade.symbol,
            pnlQuote: error.recoveredTrade.pnlQuote,
            reason: error.recoveredTrade.reason
          });
        }
        if (error.openPosition) {
          this.recordEvent("entry_requires_runtime_recovery", {
            symbol: error.openPosition.symbol,
            quantity: error.openPosition.quantity
          });
        }
        attempt.entryErrors.push({ symbol: candidate.symbol, error: error.message });
        if (error.preventFurtherEntries) {
          attempt.status = "runtime_blocked";
          attempt.blockedReasons.push(error.blockedReason || "entry_recovery_required");
          break;
        }
      }
    }

    if (attempt.status === "runtime_blocked") {
      attempt.blockedReasons = [...new Set(attempt.blockedReasons.filter(Boolean))];
      return attempt;
    }
    attempt.status = attempt.entryErrors.length ? "entry_failed" : "no_allowed_candidates";
    return attempt;
  }

  applyEntryAttemptToDecisions(entryAttempt = {}) {
    const openedSymbol = entryAttempt.openedPosition?.symbol || null;
    const attemptedSymbols = new Set(arr(entryAttempt.attemptedSymbols));
    const errorMap = new Map(arr(entryAttempt.entryErrors).map((item) => [item.symbol, item.error]));
    const primaryBlockedReasons = arr(entryAttempt.blockedReasons);
    const firstAllowedSymbol = arr(this.runtime.latestDecisions).find((decision) => decision.allow)?.symbol || null;

    this.runtime.latestDecisions = arr(this.runtime.latestDecisions).map((decision) => {
      let entryStatus = decision.allow ? "eligible" : "blocked";
      let executionBlockers = arr(decision.executionBlockers);
      const entryAttempted = attemptedSymbols.has(decision.symbol);

      if (!decision.allow) {
        entryStatus = "blocked";
        executionBlockers = arr(decision.blockerReasons);
      } else if (openedSymbol && decision.symbol === openedSymbol) {
        entryStatus = "opened";
        executionBlockers = [];
      } else if (errorMap.has(decision.symbol)) {
        entryStatus = "entry_failed";
        executionBlockers = [errorMap.get(decision.symbol)];
      } else if (primaryBlockedReasons.length && decision.symbol === firstAllowedSymbol) {
        entryStatus = "runtime_blocked";
        executionBlockers = [...primaryBlockedReasons];
      } else if (openedSymbol) {
        entryStatus = decision.symbol === firstAllowedSymbol ? "opened_elsewhere" : "standby";
        executionBlockers = decision.symbol === firstAllowedSymbol ? [] : ["higher_ranked_setup_selected"];
      }

      return {
        ...decision,
        entryStatus,
        entryOpened: entryStatus === "opened",
        entryAttempted,
        executionBlockers
      };
    });
    this.runtime.lastEntryAttempt = {
      status: entryAttempt.status || "idle",
      selectedSymbol: entryAttempt.selectedSymbol || null,
      openedSymbol,
      attemptedSymbols: [...attemptedSymbols],
      blockedReasons: [...primaryBlockedReasons],
      entryErrors: arr(entryAttempt.entryErrors),
      at: nowIso()
    };
  }

  trimJournal() {
    if (this.journal.trades.length > 2000) {
      this.journal.trades = this.journal.trades.slice(-2000);
    }
    if (this.journal.scaleOuts.length > 2000) {
      this.journal.scaleOuts = this.journal.scaleOuts.slice(-2000);
    }
    if (this.journal.blockedSetups.length > 2000) {
      this.journal.blockedSetups = this.journal.blockedSetups.slice(-2000);
    }
    if (this.journal.universeRuns.length > 1000) {
      this.journal.universeRuns = this.journal.universeRuns.slice(-1000);
    }
    if (this.journal.researchRuns.length > 120) {
      this.journal.researchRuns = this.journal.researchRuns.slice(-120);
    }
    if (this.journal.equitySnapshots.length > 5000) {
      this.journal.equitySnapshots = this.journal.equitySnapshots.slice(-5000);
    }
    if (this.journal.cycles.length > 2000) {
      this.journal.cycles = this.journal.cycles.slice(-2000);
    }
    if (this.journal.events.length > 2000) {
      this.journal.events = this.journal.events.slice(-2000);
    }
  }

  async updatePortfolioSnapshot(midPrices = {}) {
    const balance = await this.broker.getBalance(this.runtime);
    const equity = await this.broker.getEquity(this.runtime, midPrices);
    this.runtime.lastKnownBalance = balance.quoteFree;
    this.runtime.lastKnownEquity = equity;
    this.runtime.lastPortfolioUpdateAt = nowIso();
    return { balance, equity };
  }

  async maybeRunExchangeTruthLoop({ force = false, now = new Date() } = {}) {
    if (this.config.botMode !== "live" || !this.broker?.reconcileRuntime) {
      return null;
    }
    const lastReconciledAt = this.runtime.exchangeTruth?.lastReconciledAt || null;
    const intervalMs = Math.max(15, Number(this.config.exchangeTruthLoopIntervalSeconds || 90)) * 1000;
    if (!force && lastReconciledAt) {
      const ageMs = now.getTime() - new Date(lastReconciledAt).getTime();
      if (Number.isFinite(ageMs) && ageMs < intervalMs) {
        return null;
      }
    }
    const reconciliation = await this.broker.reconcileRuntime({
      runtime: this.runtime,
      journal: this.journal,
      getMarketSnapshot: this.getMarketSnapshot.bind(this)
    });
    await this.applyReconciliation(reconciliation);
    return reconciliation;
  }

  async refreshAnalysis() {
    try {
      const midPrices = await this.getLatestMidPrices(this.runtime.openPositions.map((position) => position.symbol));
      for (const position of this.runtime.openPositions) {
        if (Number.isFinite(midPrices[position.symbol])) {
          position.lastMarkedPrice = midPrices[position.symbol];
        }
      }
      const balance = await this.broker.getBalance(this.runtime);
      await this.maybeRunExchangeTruthLoop();
      const candidates = await this.scanCandidatesForCycle(balance);
      const equity = await this.broker.getEquity(this.runtime, midPrices);
      this.runtime.lastKnownBalance = balance.quoteFree;
      this.runtime.lastKnownEquity = equity;
      this.runtime.lastPortfolioUpdateAt = nowIso();
      this.runtime.lastAnalysisAt = nowIso();
      this.runtime.lastAnalysisError = null;
      this.syncOrderLifecycleState("analysis_refresh");
      this.refreshGovernanceViews(this.runtime.lastAnalysisAt);
      this.trimJournal();
      await this.persist();
      return { quoteFree: balance.quoteFree, equity, topCandidates: candidates.slice(0, 5) };
    } catch (error) {
      this.runtime.lastAnalysisError = { at: nowIso(), message: error.message };
      await this.persist();
      throw error;
    }
  }

  async runResearch(options = {}) {
    const symbols = (options.symbols || []).map((symbol) => `${symbol}`.trim().toUpperCase()).filter(Boolean);
    const result = await runResearchLab({ config: this.config, logger: this.logger, symbols });
    const fetchedCandidates = await this.strategyResearchMiner.fetchWhitelistedCandidates();
    this.runtime.researchLab = {
      lastRunAt: result.generatedAt,
      latestSummary: result
    };
    if (fetchedCandidates.length) {
      this.runtime.strategyResearch = this.strategyResearchMiner.buildSummary({
        journal: this.journal,
        researchRegistry: this.runtime.researchRegistry || {},
        offlineTrainer: this.runtime.offlineTrainer || {},
        importedCandidates: fetchedCandidates,
        nowIso: result.generatedAt
      });
      this.recordEvent("strategy_research_imported", {
        candidateCount: fetchedCandidates.length
      });
    }
    this.journal.researchRuns.push(result);
    await this.dataRecorder.recordResearch(result);
    this.refreshGovernanceViews(nowIso());
    this.recordEvent("research_run_completed", {
      symbolCount: result.symbolCount,
      bestSymbol: result.bestSymbol,
      realizedPnl: result.realizedPnl
    });
    await this.backupManager.maybeBackup({
      runtime: this.runtime,
      journal: this.journal,
      modelState: this.model.getState(),
      modelBackups: this.modelBackups,
      modelRegistry: this.runtime.modelRegistry
    }, { reason: "research", force: true, nowIso: result.generatedAt });
    this.runtime.stateBackups = this.backupManager.getSummary();
    this.trimJournal();
    await this.persist();
    return result;
  }

  async runCycleCore() {
    const cycleAt = nowIso();
    this.logger.info("Starting cycle", { mode: this.config.botMode, watchlist: this.config.watchlist.length });
    this.updateSafetyState({ now: new Date(cycleAt), candidateSummaries: arr(this.runtime.latestDecisions) });
    try {
      await this.client.syncServerTime();
    } catch (error) {
      this.logger.warn("Clock sync refresh failed", { error: error.message });
      this.recordEvent("clock_sync_refresh_failed", { error: error.message });
    }
    const driftIssues = this.health.enforceClockDrift(this.client, this.runtime);
    const markedPrices = await this.manageOpenPositions();
    const balance = await this.broker.getBalance(this.runtime);
    const candidates = await this.scanCandidatesForCycle(balance);
    await this.resolveCounterfactualQueue(cycleAt);
    const executionBlockers = this.config.botMode === "live" ? driftIssues : [];
    const entryAttempt = await this.openBestCandidate(candidates, { executionBlockers });
    const openedPosition = entryAttempt.openedPosition || null;
    this.applyEntryAttemptToDecisions(entryAttempt);
    this.syncOrderLifecycleState("entry_attempt");
    const portfolio = await this.updatePortfolioSnapshot(markedPrices);
    this.journal.equitySnapshots.push({
      at: cycleAt,
      equity: portfolio.equity,
      quoteFree: portfolio.balance.quoteFree,
      openPositions: this.runtime.openPositions.length
    });
    this.journal.cycles.push({
      at: cycleAt,
      equity: portfolio.equity,
      quoteFree: portfolio.balance.quoteFree,
      openPositions: this.runtime.openPositions.length,
      openedSymbol: openedPosition?.symbol || null,
      topSymbol: this.runtime.latestDecisions[0]?.symbol || null,
      activeRegime: this.runtime.latestDecisions[0]?.regime || null,
      activeStrategy: this.runtime.latestDecisions[0]?.strategy?.activeStrategy || null,
      circuitOpen: this.runtime.health?.circuitOpen || false,
      driftIssues,
      entryStatus: entryAttempt.status || "idle",
      selectedSymbol: entryAttempt.selectedSymbol || null,
      openedSymbol: entryAttempt.openedPosition?.symbol || null
    });
    const safety = this.updateSafetyState({ now: new Date(cycleAt), candidateSummaries: arr(this.runtime.latestDecisions) });
    this.runtime.lastCycleAt = cycleAt;
    this.runtime.lastAnalysisAt = cycleAt;
    this.runtime.lastAnalysisError = null;
    this.runtime.service = {
      ...(this.runtime.service || {}),
      lastHeartbeatAt: cycleAt,
      watchdogStatus: "running"
    };
    const governance = this.refreshGovernanceViews(cycleAt);
    await this.dataRecorder.recordDecisions({ at: cycleAt, candidates });
    await this.dataRecorder.recordCycle({
      at: cycleAt,
      mode: this.config.botMode,
      candidates,
      openedPosition,
      entryAttempt,
      overview: {
        equity: portfolio.equity,
        quoteFree: portfolio.balance.quoteFree,
        openPositions: this.runtime.openPositions.length
      },
      safety: {
        session: this.runtime.session,
        drift: this.runtime.drift,
        selfHeal: this.runtime.selfHeal
      },
      marketSentiment: this.runtime.marketSentiment,
      volatility: this.runtime.volatilityContext
    });
    await this.dataRecorder.recordSnapshotManifest({
      at: cycleAt,
      mode: this.config.botMode,
      candidates,
      openedPosition,
      overview: {
        equity: portfolio.equity,
        quoteFree: portfolio.balance.quoteFree,
        openPositions: this.runtime.openPositions.length
      },
      ops: {
        readiness: this.runtime.ops?.readiness || {},
        alerts: this.runtime.ops?.alerts || {},
        exchangeSafety: this.runtime.exchangeSafety || {},
        capitalGovernor: this.runtime.capitalGovernor || {}
      },
      report: governance.report || {}
    });
    await this.dataRecorder.recordDatasetCuration({
      at: cycleAt,
      journal: this.journal,
      newsCache: this.runtime.newsCache || {},
      sourceReliability: this.runtime.sourceReliability || {},
      paperLearning: this.runtime.paperLearning || this.runtime.ops?.paperLearning || {}
    });
    await this.dispatchOperatorAlerts(cycleAt);
    await this.backupManager.maybeBackup({
      runtime: this.runtime,
      journal: this.journal,
      modelState: this.model.getState(),
      modelBackups: this.modelBackups,
      modelRegistry: this.runtime.modelRegistry
    }, { reason: openedPosition ? "cycle_with_entry" : "cycle", nowIso: cycleAt });
    this.runtime.dataRecorder = this.dataRecorder.getSummary();
    this.runtime.stateBackups = this.backupManager.getSummary();
    return {
      cycleAt,
      openedPosition,
      topCandidates: this.runtime.latestDecisions,
      quoteFree: portfolio.balance.quoteFree,
      equity: portfolio.equity,
      openPositions: this.runtime.openPositions.length,
      driftIssues,
      entryAttempt,
      health: this.health.getStatus(this.runtime),
      stream: this.stream.getStatus(),
      calibration: this.model.getCalibrationSummary(),
      deployment: this.model.getDeploymentSummary(),
      driftMonitoring: summarizeDrift(safety.driftSummary),
      selfHeal: summarizeSelfHeal(safety.selfHealState)
    };
  }

  async runCycle() {
    try {
      const result = await this.runCycleCore();
      this.health.recordSuccess(this.runtime);
      this.updateSafetyState({ now: new Date(), candidateSummaries: arr(this.runtime.latestDecisions) });
      this.runtime.service = {
        ...(this.runtime.service || {}),
        lastHeartbeatAt: nowIso(),
        watchdogStatus: "running"
      };
      this.refreshOperationalViews({ nowIso: nowIso() });
      this.trimJournal();
      await this.persist();
      return result;
    } catch (error) {
      this.health.recordFailure(this.runtime, error);
      this.runtime.lastAnalysisError = { at: nowIso(), message: error.message };
      this.runtime.service = {
        ...(this.runtime.service || {}),
        lastHeartbeatAt: nowIso(),
        watchdogStatus: "degraded"
      };
      this.recordEvent("cycle_failure", { error: error.message });
      this.refreshOperationalViews({ nowIso: nowIso() });
      this.trimJournal();
      await this.persist();
      throw error;
    }
  }

  buildPositionView(position) {
    const markPrice = position.lastMarkedPrice || position.entryPrice;
    const marketValue = markPrice * position.quantity;
    const unrealizedPnl = marketValue - (position.totalCost || position.notional || 0);
    const unrealizedPnlPct = position.totalCost ? unrealizedPnl / position.totalCost : 0;
    return {
      id: position.id,
      symbol: position.symbol,
      brokerMode: position.brokerMode || this.config.botMode,
      recovered: Boolean(position.recovered),
      entryAt: position.entryAt,
      lastReviewedAt: position.lastReviewedAt || null,
      ageMinutes: num(minutesBetween(position.entryAt), 1),
      entryPrice: num(position.entryPrice, 6),
      currentPrice: num(markPrice, 6),
      quantity: num(position.quantity, 8),
      notional: num(position.notional || position.quantity * position.entryPrice, 2),
      totalCost: num(position.totalCost || position.notional || 0, 2),
      marketValue: num(marketValue, 2),
      unrealizedPnl: num(unrealizedPnl, 2),
      unrealizedPnlPct: num(unrealizedPnlPct, 4),
      entryFee: num(position.entryFee || 0, 2),
      highestPrice: num(position.highestPrice || position.entryPrice, 6),
      lowestPrice: num(position.lowestPrice || position.entryPrice, 6),
      stopLossPrice: num(position.stopLossPrice || 0, 6),
      takeProfitPrice: num(position.takeProfitPrice || 0, 6),
      trailingStopPct: num(position.trailingStopPct || 0, 4),
      latestSpreadBps: num(position.latestSpreadBps || 0, 2),
      probabilityAtEntry: position.probabilityAtEntry == null ? null : num(position.probabilityAtEntry, 4),
      regimeAtEntry: position.regimeAtEntry || null,
      strategyAtEntry: position.strategyAtEntry || position.entryRationale?.strategy?.activeStrategy || null,
      lifecycleState: position.lifecycleState || ((position.brokerMode || this.config.botMode) === "live" ? (position.protectiveOrderListId ? "protected" : "open") : "simulated_open"),
      operatorMode: position.operatorMode || "normal",
      managementFailureCount: position.managementFailureCount || 0,
      manualReviewRequired: Boolean(position.manualReviewRequired),
      reconcileRequired: Boolean(position.reconcileRequired),
      executionPlan: summarizePlan(position.executionPlan),
      entryExecutionAttribution: summarizeExecutionAttribution(position.entryExecutionAttribution || {}),
      protectiveOrderListId: position.protectiveOrderListId || null,
      protectiveOrderStatus: position.protectiveOrderStatus || null,
      latestExitIntelligence: summarizeExitIntelligence(position.latestExitIntelligence || {}),
      latestNewsSummary: position.latestNewsSummary || position.newsSummary || EMPTY_NEWS,
      latestExchangeSummary: position.latestExchangeSummary || EMPTY_EXCHANGE,
      latestCalendarSummary: position.latestCalendarSummary || EMPTY_CALENDAR,
      latestMarketStructureSummary: position.latestMarketStructureSummary || EMPTY_MARKET_STRUCTURE,
      entryRationale: {
        summary: `${position.symbol} staat open sinds ${position.entryAt}.`,
        setupStyle: "legacy_position",
        probability: position.probabilityAtEntry == null ? null : num(position.probabilityAtEntry, 4),
        confidence: null,
        baseThreshold: this.config.modelThreshold,
        threshold: this.config.modelThreshold,
        thresholdAdjustment: 0,
        strategyConfidenceFloor: this.config.strategyMinConfidence,
        optimizerApplied: summarizeOptimizerApplied(),
        newsSentiment: position.newsSummary?.sentimentScore ?? 0,
        newsRisk: position.newsSummary?.riskScore ?? 0,
        newsCoverage: position.newsSummary?.coverage ?? 0,
        providerDiversity: position.newsSummary?.providerDiversity ?? 0,
        sourceDiversity: position.newsSummary?.sourceDiversity ?? 0,
        socialCoverage: position.newsSummary?.socialCoverage ?? 0,
        socialSentiment: position.newsSummary?.socialSentiment ?? 0,
        socialRisk: position.newsSummary?.socialRisk ?? 0,
        socialEngagement: position.newsSummary?.socialEngagement ?? 0,
        freshnessHours: position.newsSummary?.freshnessHours ?? null,
        sourceQualityScore: position.newsSummary?.sourceQualityScore ?? 0,
        reliabilityScore: position.newsSummary?.reliabilityScore ?? 0,
        whitelistCoverage: position.newsSummary?.whitelistCoverage ?? 0,
        positiveHeadlineCount: position.newsSummary?.positiveHeadlineCount ?? 0,
        negativeHeadlineCount: position.newsSummary?.negativeHeadlineCount ?? 0,
        announcementCoverage: position.latestExchangeSummary?.coverage ?? 0,
        announcementSentiment: position.latestExchangeSummary?.sentimentScore ?? 0,
        announcementRisk: position.latestExchangeSummary?.riskScore ?? 0,
        announcementFreshnessHours: position.latestExchangeSummary?.noticeFreshnessHours ?? null,
        blockerReasons: [],
        regimeReasons: [],
        executionReasons: [],
        calendarBlockers: [...(position.latestCalendarSummary?.blockerReasons || [])],
        providerBreakdown: summarizeBreakdown(position.newsSummary?.providerCounts || {}),
        sourceBreakdown: summarizeBreakdown(position.newsSummary?.sourceCounts || {}),
        channelBreakdown: summarizeBreakdown(position.newsSummary?.channelCounts || {}),
        announcementBreakdown: summarizeBreakdown(position.latestExchangeSummary?.categoryCounts || {}),
        bullishDrivers: arr(position.newsSummary?.bullishDrivers || []).slice(0, 3).map(summarizeDriver),
        bearishDrivers: arr(position.newsSummary?.bearishDrivers || []).slice(0, 3).map(summarizeDriver),
        bullishSignals: [],
        bearishSignals: [],
        regimeSummary: summarizeRegime({ regime: position.regimeAtEntry || "range" }),
        portfolioSummary: summarizePortfolio({}),
        streamSnapshot: summarizeStream({}),
        executionPlan: summarizePlan(position.executionPlan),
        executionAttribution: summarizeExecutionAttribution(position.entryExecutionAttribution || {}),
        marketStructure: summarizeMarketStructureSummary(position.latestMarketStructureSummary || EMPTY_MARKET_STRUCTURE),
        marketSentiment: summarizeMarketSentiment(this.runtime.marketSentiment || EMPTY_MARKET_SENTIMENT),
        volatility: summarizeVolatility(this.runtime.volatilityContext || EMPTY_VOLATILITY_CONTEXT),
        calendar: summarizeCalendarSummary(position.latestCalendarSummary || EMPTY_CALENDAR),
        exchange: summarizeExchange(position.latestExchangeSummary || EMPTY_EXCHANGE),
        session: summarizeSession(this.runtime.session || {}),
        drift: summarizeDrift(this.runtime.drift || {}),
        selfHeal: summarizeSelfHeal(this.runtime.selfHeal || {}),
        meta: summarizeMeta(position.entryRationale?.meta || {}),
        orderBook: summarizeOrderBook({ spreadBps: position.latestSpreadBps || 0 }),
        patterns: summarizePatterns({ dominantPattern: "none", bullishPatternScore: 0, bearishPatternScore: 0, insideBar: 0 }),
        strategy: summarizeStrategy({ activeStrategy: position.strategyAtEntry || null }),
        universe: position.entryRationale?.universe || null,
        strategyAttribution: summarizeAttributionAdjustment(position.entryRationale?.strategyAttribution || {}),
        transformer: summarizeTransformer({}),
        committee: summarizeCommittee({}),
        rlPolicy: summarizeRlPolicy({}),
        topSignals: [],
        challengerSignals: [],
        checks: [],
        headlines: [],
        officialNotices: arr(position.latestExchangeSummary?.items || []).slice(0, 3).map(summarizeHeadline),
        calendarEvents: arr(position.latestCalendarSummary?.items || []).slice(0, 3),
        ...(position.entryRationale || {})
      }
    };
  }

  buildDashboardPositionView(positionView) {
    const rationale = positionView.entryRationale || {};
    const strategy = rationale.strategy || {};
    const exitIntelligence = positionView.latestExitIntelligence || {};
    return {
      id: positionView.id,
      symbol: positionView.symbol,
      ageMinutes: positionView.ageMinutes,
      entryPrice: positionView.entryPrice,
      currentPrice: positionView.currentPrice,
      stopLossPrice: positionView.stopLossPrice,
      unrealizedPnl: positionView.unrealizedPnl,
      unrealizedPnlPct: positionView.unrealizedPnlPct,
      regimeAtEntry: positionView.regimeAtEntry || null,
      strategyAtEntry: positionView.strategyAtEntry || null,
      lifecycle: {
        state: positionView.lifecycleState || "unknown",
        operatorMode: positionView.operatorMode || "normal",
        managementFailureCount: positionView.managementFailureCount || 0,
        manualReviewRequired: Boolean(positionView.manualReviewRequired),
        reconcileRequired: Boolean(positionView.reconcileRequired)
      },
      latestExitIntelligence: {
        action: exitIntelligence.action || "hold",
        confidence: num(exitIntelligence.confidence || 0, 4),
        reason: exitIntelligence.reason || null,
        riskReasons: arr(exitIntelligence.riskReasons || []).slice(0, 3)
      },
      entryRationale: {
        summary: rationale.summary || null,
        setupStyle: rationale.setupStyle || null,
        strategy: {
          strategyLabel: strategy.strategyLabel || strategy.activeStrategy || positionView.strategyAtEntry || null,
          reasons: arr(strategy.reasons || []).slice(0, 2)
        },
        executionReasons: arr(rationale.executionReasons || []).slice(0, 2),
        session: {
          session: rationale.session?.session || null,
          sessionLabel: rationale.session?.sessionLabel || rationale.session?.session || null
        },
        selfHealIssues: arr(rationale.selfHealIssues || rationale.selfHeal?.issues || []).slice(0, 2),
        sessionBlockers: arr(rationale.sessionBlockers || rationale.session?.blockerReasons || []).slice(0, 2),
        headlines: arr(rationale.headlines || []).slice(0, 2).map((item) => item.title || item)
      }
    };
  }

  buildMissedTradeAnalysis(decision = {}, blockerReasons = [], strategy = {}) {
    const offlineTrainer = summarizeOfflineTrainer(this.runtime?.offlineTrainer || {});
    const blockerSet = new Set(blockerReasons.filter(Boolean));
    const blockerCard = offlineTrainer.blockerScorecards.find((item) => blockerSet.has(item.id));
    const strategyId = strategy.activeStrategy || strategy.id || strategy.strategyId || strategy.strategyLabel || null;
    const strategyCard = offlineTrainer.strategyScorecards.find((item) => item.id === strategyId);
    const recentCounterfactuals = arr(this.journal?.counterfactuals || [])
      .filter((item) => {
        const itemBlockers = arr(item.blockerReasons || []);
        const blockerMatch = itemBlockers.some((itemBlocker) => blockerSet.has(itemBlocker));
        const strategyMatch = strategyId && (item.strategy === strategyId || item.strategyAtEntry === strategyId);
        const regimeMatch = decision.marketState?.phase && item.marketPhase === decision.marketState.phase;
        return blockerMatch || strategyMatch || regimeMatch;
      })
      .slice(-12);
    const badVetoCount = recentCounterfactuals.filter((item) => ["missed_winner", "bad_veto"].includes(item.outcome)).length;
    const goodVetoCount = recentCounterfactuals.filter((item) => ["blocked_correctly", "good_veto"].includes(item.outcome)).length;
    const lateVetoCount = recentCounterfactuals.filter((item) => item.outcome === "late_veto").length;
    const timingIssueCount = recentCounterfactuals.filter((item) => item.outcome === "right_direction_wrong_timing").length;
    const averageRecentMovePct = num(average(recentCounterfactuals.map((item) => item.realizedMovePct || 0), 0), 4);
    const summary = blockerCard
      ? blockerCard.badVetoRate >= 0.45
        ? `Historisch was deze blokkade vaker te streng (${Math.round((blockerCard.badVetoRate || 0) * 100)}% gemiste winnaars).`
        : blockerCard.goodVetoRate >= 0.55
          ? `Historisch was deze blokkade meestal terecht (${Math.round((blockerCard.goodVetoRate || 0) * 100)}% goede veto's).`
          : "Deze blokkade is gemengd: bekijk recente gemiste trades en veto-uitkomsten."
      : recentCounterfactuals.length
        ? "Er zijn recente vergelijkbare gemiste-trade voorbeelden beschikbaar."
        : offlineTrainer.counterfactuals.total
          ? "Counterfactual learning is actief, maar er is nog weinig specifieke historie voor deze setup."
          : "Nog te weinig gemiste-trade historie voor een sterke analyse.";
    return {
      available: Boolean(blockerCard || strategyCard || recentCounterfactuals.length || offlineTrainer.counterfactuals.total),
      summary,
      blockerId: blockerCard?.id || null,
      blockerStatus: blockerCard?.status || null,
      badVetoRate: blockerCard?.badVetoRate ?? null,
      goodVetoRate: blockerCard?.goodVetoRate ?? null,
      averageMissedMovePct: blockerCard?.averageMovePct ?? offlineTrainer.counterfactuals.averageMissedMovePct ?? null,
      strategyStatus: strategyCard?.status || null,
      strategyFalseNegativeRate: strategyCard?.falseNegativeRate ?? null,
      recentMatches: recentCounterfactuals.length,
      recentBadVetoCount: badVetoCount,
      recentGoodVetoCount: goodVetoCount,
      recentLateVetoCount: lateVetoCount,
      recentTimingIssueCount: timingIssueCount,
      recentAverageMovePct: averageRecentMovePct,
      recommendation: badVetoCount > goodVetoCount
        ? "Deze blokkade lijkt vaak te streng. Volg shadow/probe cases extra op."
        : goodVetoCount > badVetoCount
          ? "Deze blokkade lijkt meestal terecht. Gebruik dit vooral als bevestiging."
          : "Gebruik deze analyse als context, niet als harde override."
    };
  }

  buildDashboardDecisionView(decision = {}) {
    const strategy = decision.strategy || decision.strategySummary || {};
    const blockerReasons = [
      ...arr(decision.blockerReasons || decision.reasons || []),
      ...arr(decision.sessionBlockers || decision.session?.blockerReasons || []),
      ...arr(decision.driftBlockers || decision.drift?.blockerReasons || []),
      ...arr(decision.selfHealIssues || decision.selfHeal?.issues || [])
    ];
    const dataSources = arr(decision.dataQuality?.sources || decision.dataQualitySummary?.sources || []).slice(0, 5);
    const degradedSources = dataSources.filter((item) => ["degraded", "missing"].includes(item.status)).map((item) => item.label);
    const operatorAction = blockerReasons.includes("exchange_truth_freeze")
      ? "Wacht op reconcile en bevestig exchange truth voordat entries terug mogen."
      : blockerReasons.includes("reconcile_required")
        ? "Controleer protective state en runtime/exchange inventory."
        : blockerReasons.includes("local_book_quality_too_low")
          ? "Wacht op gezonde local-book depth of schakel over op observe-only."
          : blockerReasons.includes("quality_quorum_degraded")
            ? "Review degraded datasources voordat je deze setup vertrouwt."
            : blockerReasons.includes("committee_veto")
              ? "Geblokkeerd door leer/governance: eerdere vergelijkbare setups scoorden te zwak of werden terecht gevetoed. Bekijk gemiste-trade analyse om te zien of deze blokkade te streng was."
              : blockerReasons[0] || null;
    const autoRecovery = blockerReasons.some((item) => ["protection_pending", "protect_only"].includes(item))
      ? "Protective herstel of protect-only monitoring kan dit automatisch herstellen."
      : blockerReasons.includes("paper_calibration_probe")
        ? "Paper probe kan blijven leren tot calibration weer gezond is."
        : degradedSources.length
          ? `Datasources in herstel: ${degradedSources.join(", ")}.`
          : null;
    return {
      symbol: decision.symbol,
      summary: decision.summary || null,
      setupStyle: decision.setupStyle || null,
      regime: decision.regime || null,
      allow: Boolean(decision.allow),
      entryStatus: decision.entryStatus || (decision.allow ? "eligible" : "blocked"),
      entryOpened: Boolean(decision.entryOpened),
      entryAttempted: Boolean(decision.entryAttempted),
      executionBlockers: arr(decision.executionBlockers || []).slice(0, 4),
      probability: num(decision.probability || 0, 4),
      threshold: num(decision.threshold || 0, 4),
      edgeToThreshold: num(decision.edgeToThreshold ?? ((decision.probability || 0) - (decision.threshold || 0)), 4),
      executionStyle: decision.executionStyle || decision.executionAttribution?.entryStyle || null,
      freshnessHours: decision.freshnessHours == null ? null : num(decision.freshnessHours, 1),
      providerDiversity: decision.providerDiversity || 0,
      reliabilityScore: num(decision.reliabilityScore || 0, 3),
      dominantEventType: decision.dominantEventType || "general",
      reasons: arr(decision.reasons || []).slice(0, 4),
      blockerReasons: blockerReasons.slice(0, 4),
      operatorAction,
      autoRecovery,
      missedTradeAnalysis: this.buildMissedTradeAnalysis(decision, blockerReasons, strategy),
      bullishSignals: arr(decision.bullishSignals || []).slice(0, 2).map(summarizeSignal),
      bearishSignals: arr(decision.bearishSignals || []).slice(0, 2).map(summarizeSignal),
      bullishDrivers: arr(decision.bullishDrivers || []).slice(0, 2).map(summarizeDriver),
      bearishDrivers: arr(decision.bearishDrivers || []).slice(0, 2).map(summarizeDriver),
      strategy: {
        strategyLabel: strategy.strategyLabel || strategy.label || strategy.activeStrategy || null,
        family: strategy.family || null,
        familyLabel: strategy.familyLabel || strategy.family || null,
        fitScore: num(strategy.fitScore || 0, 4)
      },
      orderBook: {
        bookPressure: num(decision.orderBook?.bookPressure || 0, 3)
      },
      marketStructure: {
        fundingRate: num(decision.marketStructure?.fundingRate || 0, 6),
        riskScore: num(decision.marketStructure?.riskScore || 0, 3),
        reasons: arr(decision.marketStructure?.reasons || []).slice(0, 2)
      },
      timeframe: {
        alignmentScore: num(decision.timeframe?.alignmentScore || 0, 4),
        blockerReasons: arr(decision.timeframe?.blockerReasons || []).slice(0, 2)
      },
      pairHealth: {
        score: num(decision.pairHealth?.score || 0, 4),
        health: decision.pairHealth?.health || null,
        quarantined: Boolean(decision.pairHealth?.quarantined)
      },
      qualityQuorum: {
        status: decision.qualityQuorum?.status || null,
        quorumScore: num(decision.qualityQuorum?.quorumScore || decision.qualityQuorum?.averageScore || 0, 4),
        observeOnly: Boolean(decision.qualityQuorum?.observeOnly),
        blockerReasons: arr(decision.qualityQuorum?.blockerReasons || []).slice(0, 3),
        cautionReasons: arr(decision.qualityQuorum?.cautionReasons || []).slice(0, 3)
      },
      trendState: {
        direction: decision.trendState?.direction || decision.trendStateSummary?.direction || null,
        phase: decision.trendState?.phase || decision.trendStateSummary?.phase || null,
        uptrendScore: num(decision.trendState?.uptrendScore || decision.trendStateSummary?.uptrendScore || 0, 4),
        downtrendScore: num(decision.trendState?.downtrendScore || decision.trendStateSummary?.downtrendScore || 0, 4),
        rangeScore: num(decision.trendState?.rangeScore || decision.trendStateSummary?.rangeScore || 0, 4),
        rangeAcceptanceScore: num(decision.trendState?.rangeAcceptanceScore || decision.trendStateSummary?.rangeAcceptanceScore || 0, 4),
        dataConfidenceScore: num(decision.trendState?.dataConfidenceScore || decision.trendStateSummary?.dataConfidenceScore || 0, 4),
        completenessScore: num(decision.trendState?.completenessScore || decision.trendStateSummary?.completenessScore || 0, 4),
        reasons: arr(decision.trendState?.reasons || decision.trendStateSummary?.reasons || []).slice(0, 3)
      },
      marketState: summarizeMarketState(
        decision.marketState ||
        decision.marketStateSummary ||
        buildMarketStateSummary({
          trendStateSummary: decision.trendState || decision.trendStateSummary || {}
        })
      ),
      dataQuality: {
        status: decision.dataQuality?.status || decision.dataQualitySummary?.status || null,
        overallScore: num(decision.dataQuality?.overallScore || decision.dataQualitySummary?.overallScore || 0, 4),
        freshnessScore: num(decision.dataQuality?.freshnessScore || decision.dataQualitySummary?.freshnessScore || 0, 4),
        trustScore: num(decision.dataQuality?.trustScore || decision.dataQualitySummary?.trustScore || 0, 4),
        coverageScore: num(decision.dataQuality?.coverageScore || decision.dataQualitySummary?.coverageScore || 0, 4),
        degradedButAllowed: Boolean(decision.dataQuality?.degradedButAllowed || decision.dataQualitySummary?.degradedButAllowed),
        degradedSourceLabels: degradedSources.slice(0, 4),
        sources: arr(decision.dataQuality?.sources || decision.dataQualitySummary?.sources || []).slice(0, 5)
      },
      signalQuality: {
        overallScore: num(decision.signalQuality?.overallScore || decision.signalQualitySummary?.overallScore || 0, 4),
        setupFit: num(decision.signalQuality?.setupFit || decision.signalQualitySummary?.setupFit || 0, 4),
        structureQuality: num(decision.signalQuality?.structureQuality || decision.signalQualitySummary?.structureQuality || 0, 4),
        executionViability: num(decision.signalQuality?.executionViability || decision.signalQualitySummary?.executionViability || 0, 4),
        newsCleanliness: num(decision.signalQuality?.newsCleanliness || decision.signalQualitySummary?.newsCleanliness || 0, 4),
        quorumQuality: num(decision.signalQuality?.quorumQuality || decision.signalQualitySummary?.quorumQuality || 0, 4)
      },
      confidenceBreakdown: {
        marketConfidence: num(decision.confidenceBreakdown?.marketConfidence || 0, 4),
        dataConfidence: num(decision.confidenceBreakdown?.dataConfidence || 0, 4),
        executionConfidence: num(decision.confidenceBreakdown?.executionConfidence || 0, 4),
        modelConfidence: num(decision.confidenceBreakdown?.modelConfidence || 0, 4),
        overallConfidence: num(decision.confidenceBreakdown?.overallConfidence || 0, 4)
      },
      paperLearning: decision.paperLearning ? {
        lane: decision.paperLearning.lane || null,
        learningValueScore: num(decision.paperLearning.learningValueScore || 0, 4),
        noveltyScore: num(decision.paperLearning.noveltyScore || 0, 4),
        scope: {
          family: decision.paperLearning.scope?.family || null,
          regime: decision.paperLearning.scope?.regime || null
        },
        probeCaps: decision.paperLearning.probeCaps || null,
        budget: decision.paperLearning.budget || null
      } : null,
      selfHealIssues: arr(decision.selfHealIssues || decision.selfHeal?.issues || []).slice(0, 2),
      sessionBlockers: arr(decision.sessionBlockers || decision.session?.blockerReasons || []).slice(0, 2),
      driftBlockers: arr(decision.driftBlockers || decision.drift?.blockerReasons || []).slice(0, 2),
      session: {
        session: decision.session?.session || null,
        sessionLabel: decision.session?.sessionLabel || decision.session?.session || null,
        blockerReasons: arr(decision.session?.blockerReasons || []).slice(0, 2)
      },
      downtrendPolicy: {
        downtrendScore: num(decision.downtrendPolicy?.downtrendScore || 0, 4),
        strongDowntrend: Boolean(decision.downtrendPolicy?.strongDowntrend),
        shortingUnavailable: Boolean(decision.downtrendPolicy?.shortingUnavailable),
        spotOnly: Boolean(decision.downtrendPolicy?.spotOnly)
      },
      riskPolicy: decision.riskPolicy || {
        downtrendPolicy: decision.downtrendPolicy || null,
        qualityQuorum: decision.qualityQuorum || null,
        capitalPolicy: summarizeCapitalPolicy({
          capitalLadder: decision.capitalLadder || decision.capitalLadderApplied || {},
          capitalGovernor: {
            ...(decision.capitalGovernor || decision.capitalGovernorApplied || {}),
            policyEngine: this.runtime?.capitalPolicy || {}
          }
        })
      },
      executionBudget: decision.executionBudget || summarizeExecutionCost(decision.executionCostBudget || decision.executionCostBudgetApplied || {}),
      meta: {
        qualityScore: num(decision.meta?.qualityScore ?? decision.meta?.score ?? 0, 4),
        qualityBand: decision.meta?.qualityBand || null,
        neuralProbability: num(decision.meta?.neuralProbability || 0, 4),
        neuralConfidence: num(decision.meta?.neuralConfidence || 0, 4)
      },
      sequence: {
        probability: num(decision.sequence?.probability || 0, 4),
        confidence: num(decision.sequence?.confidence || 0, 4)
      },
      expertMix: {
        dominantRegime: decision.expertMix?.dominantRegime || null,
        confidence: num(decision.expertMix?.confidence || 0, 4)
      }
    };
  }

  buildDashboardTradeView(tradeView) {
    return {
      id: tradeView.id,
      symbol: tradeView.symbol,
      entryAt: tradeView.entryAt,
      exitAt: tradeView.exitAt,
      durationMinutes: tradeView.durationMinutes,
      entryPrice: tradeView.entryPrice,
      exitPrice: tradeView.exitPrice,
      pnlQuote: tradeView.pnlQuote,
      netPnlPct: tradeView.netPnlPct,
      reason: tradeView.reason || null,
      entryExecutionAttribution: {
        entryStyle: tradeView.entryExecutionAttribution?.entryStyle || null,
        realizedTouchSlippageBps: num(tradeView.entryExecutionAttribution?.realizedTouchSlippageBps || 0, 2)
      },
      exitExecutionAttribution: {
        entryStyle: tradeView.exitExecutionAttribution?.entryStyle || null,
        realizedTouchSlippageBps: num(tradeView.exitExecutionAttribution?.realizedTouchSlippageBps || 0, 2)
      }
    };
  }

  buildTradeView(trade) {
    return {
      id: trade.id,
      symbol: trade.symbol,
      entryAt: trade.entryAt,
      exitAt: trade.exitAt,
      durationMinutes: trade.exitAt && trade.entryAt ? num(minutesBetween(trade.entryAt, trade.exitAt), 1) : null,
      entryPrice: num(trade.entryPrice, 6),
      exitPrice: num(trade.exitPrice, 6),
      quantity: num(trade.quantity, 8),
      totalCost: num(trade.totalCost || 0, 2),
      proceeds: num(trade.proceeds || 0, 2),
      pnlQuote: num(trade.pnlQuote || 0, 2),
      netPnlPct: num(trade.netPnlPct || 0, 4),
      mfePct: num(trade.mfePct || 0, 4),
      maePct: num(trade.maePct || 0, 4),
      labelScore: num(trade.labelScore || 0, 4),
      brokerMode: trade.brokerMode || null,
      executionQualityScore: num(trade.executionQualityScore || 0, 4),
      captureEfficiency: num(trade.captureEfficiency || 0, 4),
      entryExecutionAttribution: summarizeExecutionAttribution(trade.entryExecutionAttribution || {}),
      exitExecutionAttribution: summarizeExecutionAttribution(trade.exitExecutionAttribution || {}),
      regimeAtEntry: trade.regimeAtEntry || null,
      strategyAtEntry: trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || null,
      strategyDecision: trade.strategyDecision || trade.entryRationale?.strategy || null,
      entrySpreadBps: num(trade.entrySpreadBps || 0, 2),
      exitSpreadBps: num(trade.exitSpreadBps || 0, 2),
      reason: trade.reason,
      exitSource: trade.exitSource || null,
      exitIntelligence: summarizeExitIntelligence(trade.exitIntelligenceSummary || {}),
      review: buildTradeQualityReview(trade),
      entryRationale: trade.entryRationale || null
    };
  }

  buildScaleOutView(event) {
    return {
      id: event.id,
      positionId: event.positionId || null,
      symbol: event.symbol,
      at: event.at,
      fraction: num(event.fraction || 0, 4),
      quantity: num(event.quantity || 0, 8),
      price: num(event.price || 0, 6),
      realizedPnl: num(event.realizedPnl || 0, 2),
      reason: event.reason || null,
      brokerMode: event.brokerMode || null,
      executionAttribution: summarizeExecutionAttribution(event.executionAttribution || {})
    };
  }

  buildTradeReplayView(trade) {
    const scaleOuts = arr(this.journal.scaleOuts || [])
      .filter((event) => event.positionId === trade.id)
      .map((event) => this.buildScaleOutView(event));
    const rationale = trade.entryRationale || {};
    const headlines = arr(rationale.headlines || []).slice(0, 3).map((item) => item.title || item);
    const committee = rationale.committee || {};
    const exitIntelligence = trade.exitIntelligenceSummary || {};
    const gateDetail = `model ${num(rationale.probability || trade.probabilityAtEntry || 0, 3)} | gate ${num(rationale.threshold || 0, 3)} | conf ${num(rationale.confidence || 0, 3)}`;
    const alternateExits = [
      rationale.takeProfitPct != null
        ? { label: "take_profit", price: num((trade.entryPrice || 0) * (1 + (rationale.takeProfitPct || 0)), 6), source: "entry_plan" }
        : null,
      rationale.stopLossPct != null
        ? { label: "stop_loss", price: num((trade.entryPrice || 0) * (1 - (rationale.stopLossPct || 0)), 6), source: "entry_plan" }
        : null,
      exitIntelligence.suggestedStopLossPrice
        ? { label: "ai_trail", price: num(exitIntelligence.suggestedStopLossPrice || 0, 6), source: "exit_ai" }
        : null
    ].filter(Boolean);
    return {
      id: trade.id,
      symbol: trade.symbol,
      entryAt: trade.entryAt,
      exitAt: trade.exitAt,
      durationMinutes: trade.exitAt && trade.entryAt ? num(minutesBetween(trade.entryAt, trade.exitAt), 1) : null,
      entryPrice: num(trade.entryPrice || 0, 6),
      exitPrice: num(trade.exitPrice || 0, 6),
      pnlQuote: num(trade.pnlQuote || 0, 2),
      netPnlPct: num(trade.netPnlPct || 0, 4),
      strategy: trade.strategyAtEntry || rationale.strategy?.strategyLabel || rationale.strategy?.activeStrategy || null,
      regime: trade.regimeAtEntry || rationale.regimeSummary?.regime || null,
      whyOpened: rationale.summary || `${trade.symbol} trade geopend.`,
      whyClosed: trade.reason || null,
      entryExecution: summarizeExecutionAttribution(trade.entryExecutionAttribution || {}),
      exitExecution: summarizeExecutionAttribution(trade.exitExecutionAttribution || {}),
      exitIntelligence: summarizeExitIntelligence(trade.exitIntelligenceSummary || {}),
      scaleOuts,
      meta: summarizeMeta(rationale.meta || {}),
      metaNeural: summarizeMetaNeural(rationale.metaNeural || {}),
      sequence: summarizeSequence(rationale.sequence || {}),
      expertMix: summarizeExpertMix(rationale.expertMix || {}),
      blockersAtEntry: arr(rationale.blockerReasons || []).slice(0, 5),
      vetoChain: arr(rationale.blockerReasons || []).slice(0, 5),
      headlines,
      candleContext: arr(rationale.candleContext || []).slice(0, 24),
      pnlAttribution: {
        executionStyle: trade.entryExecutionAttribution?.entryStyle || null,
        provider: trade.entryRationale?.providerBreakdown?.[0]?.name || null,
        captureEfficiency: num(trade.captureEfficiency || 0, 4)
      },
      review: buildTradeQualityReview(trade),
      alternateExits,
      replayCheckpoints: arr(trade.replayCheckpoints || []).slice(-12),
      timeline: [
        { at: trade.entryAt, type: "analysis", label: "Gate", detail: gateDetail },
        { at: trade.entryAt, type: "entry", label: "Entry", detail: rationale.summary || `${trade.symbol} entry` },
        { at: trade.entryAt, type: "committee", label: "Committee", detail: `agree ${num(committee.agreement || 0, 3)} | net ${num(committee.netScore || 0, 3)} | vetoes ${(committee.vetoes || []).length}` },
        ...(rationale.sequence ? [{ at: trade.entryAt, type: "sequence", label: "Sequence", detail: `p ${num(rationale.sequence.probability || 0, 3)} | c ${num(rationale.sequence.confidence || 0, 3)}` }] : []),
        ...(rationale.expertMix ? [{ at: trade.entryAt, type: "experts", label: "Experts", detail: `${rationale.expertMix.dominantRegime || "range"} | ${((rationale.expertMix.confidence || 0) * 100).toFixed(0)}%` }] : []),
        ...(headlines.length ? [{ at: trade.entryAt, type: "news", label: "Nieuws", detail: headlines.join(" | ") }] : []),
        ...(arr(rationale.checks || []).slice(0, 3).map((check) => ({ at: trade.entryAt, type: "check", label: check.label || "Check", detail: `${check.passed ? "pass" : "fail"} | ${check.detail || ""}`.trim() }))),
        ...scaleOuts.map((event) => ({ at: event.at, type: "scale_out", label: "Scale-out", detail: `${event.reason || "partial_exit"} | ${num((event.fraction || 0) * 100, 1)}% | ${num(event.realizedPnl || 0, 2)} USD` })),
        ...(trade.exitIntelligenceSummary ? [{ at: trade.exitAt, type: "exit_ai", label: "Exit AI", detail: `${trade.exitIntelligenceSummary.action || "hold"} | ${(trade.exitIntelligenceSummary.riskReasons || []).slice(0, 3).join(", ")}` }] : []),
        { at: trade.exitAt, type: "exit", label: "Exit", detail: `${trade.reason || "exit"} | ${num(trade.pnlQuote || 0, 2)} USD` }
      ]
    };
  }

  buildResearchView(summary = this.runtime.researchLab?.latestSummary || null) {
    if (!summary) {
      return null;
    }
    return {
      generatedAt: summary.generatedAt || null,
      symbolCount: summary.symbolCount || 0,
      bestSymbol: summary.bestSymbol || null,
      totalTrades: summary.totalTrades || 0,
      realizedPnl: num(summary.realizedPnl || 0, 2),
      averageSharpe: num(summary.averageSharpe || 0, 3),
      averageWinRate: num(summary.averageWinRate || 0, 4),
      topFamilies: arr(summary.topFamilies || []).slice(0, 6),
      topRegimes: arr(summary.topRegimes || []).slice(0, 6),
      strategyScorecards: arr(summary.strategyScorecards || []).slice(0, 8),
      reports: arr(summary.reports || []).slice(0, 6).map((report) => ({
        symbol: report.symbol,
        experimentCount: report.experimentCount || 0,
        totalTrades: report.totalTrades || 0,
        realizedPnl: num(report.realizedPnl || 0, 2),
        averageWinRate: num(report.averageWinRate || 0, 4),
        averageSharpe: num(report.averageSharpe || 0, 3),
        maxDrawdownPct: num(report.maxDrawdownPct || 0, 4),
        strategyLeaders: [...(report.strategyLeaders || [])],
        familyLeaders: arr(report.familyLeaders || []).slice(0, 4),
        regimeLeaders: arr(report.regimeLeaders || []).slice(0, 4),
        strategyScorecards: arr(report.strategyScorecards || []).slice(0, 6),
        experiments: arr(report.experiments || []).slice(0, 4).map((item) => ({
          testStartAt: item.testStartAt,
          testEndAt: item.testEndAt,
          tradeCount: item.tradeCount || 0,
          realizedPnl: num(item.realizedPnl || 0, 2),
          winRate: num(item.winRate || 0, 4),
          sharpe: num(item.sharpe || 0, 3),
          expectancy: num(item.expectancy || 0, 2),
          strategyLeaders: [...(item.strategyLeaders || [])],
          strategyScorecards: arr(item.strategyScorecards || []).slice(0, 4),
          familyLeaders: arr(item.familyLeaders || []).slice(0, 4),
          regimeLeaders: arr(item.regimeLeaders || []).slice(0, 4)
        }))
      }))
    };
  }

  buildModelWeightsView() {
    return [...this.model.getWeightView(), ...this.rlPolicy.getWeightView()]
      .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))
      .slice(0, 16)
      .map((entry) => ({ name: entry.name, weight: num(entry.weight, 4) }));
  }

  buildPortfolioView() {
    const clusters = {};
    const sectors = {};
    for (const position of this.runtime.openPositions) {
      const profile = this.config.symbolProfiles[position.symbol] || defaultProfile(position.symbol);
      const notional = position.notional || position.quantity * position.entryPrice;
      clusters[profile.cluster] = (clusters[profile.cluster] || 0) + notional;
      sectors[profile.sector] = (sectors[profile.sector] || 0) + notional;
    }
    return {
      clusters: Object.entries(clusters).map(([name, exposure]) => ({ name, exposure: num(exposure, 2) })).sort((a, b) => b.exposure - a.exposure),
      sectors: Object.entries(sectors).map(([name, exposure]) => ({ name, exposure: num(exposure, 2) })).sort((a, b) => b.exposure - a.exposure)
    };
  }

  async runDoctor() {
    const report = buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config });
    const balance = await this.broker.getBalance(this.runtime);
    await this.maybeRunExchangeTruthLoop();
    const previewCandidates = await this.scanCandidatesReadOnly(balance);
    return {
      mode: this.config.botMode,
      validation: this.config.validation,
      broker: await this.broker.doctor(this.runtime),
      clockOffsetMs: this.client.getClockOffsetMs(),
      clockSync: this.client.getClockSyncState ? this.client.getClockSyncState() : null,
      health: this.health.getStatus(this.runtime),
      stream: this.stream.getStatus(),
      calibration: this.model.getCalibrationSummary(),
      deployment: this.model.getDeploymentSummary(),
      drift: summarizeDrift(this.runtime.drift || {}),
      selfHeal: summarizeSelfHeal(this.runtime.selfHeal || {}),
      pairHealth: summarizePairHealth(this.runtime.pairHealth || {}),
      qualityQuorum: summarizeQualityQuorum(this.runtime.qualityQuorum || {}),
      divergence: summarizeDivergenceSummary(this.runtime.divergence || {}),
      offlineTrainer: summarizeOfflineTrainer(this.runtime.offlineTrainer || {}),
      sourceReliability: summarizeSourceReliability(this.runtime.sourceReliability || {}),
      exchangeCapabilities: summarizeExchangeCapabilities(this.runtime.exchangeCapabilities || this.config.exchangeCapabilities || {}),
      session: summarizeSession(this.runtime.session || {}),
      marketSentiment: summarizeMarketSentiment(this.runtime.marketSentiment || EMPTY_MARKET_SENTIMENT),
      onChainLite: summarizeOnChainLite(this.runtime.onChainLite || EMPTY_ONCHAIN),
      volatility: summarizeVolatility(this.runtime.volatilityContext || EMPTY_VOLATILITY_CONTEXT),
      stableModelSnapshots: arr(this.modelBackups || []).slice(0, 3).map(summarizeModelBackup),
      dataRecorder: summarizeDataRecorder(this.runtime.dataRecorder || this.dataRecorder.getSummary()),
      report: {
        ...report,
        recentTrades: report.recentTrades.map((trade) => this.buildTradeView(trade)),
        recentScaleOuts: report.recentScaleOuts.map((event) => this.buildScaleOutView(event))
      },
      research: this.buildResearchView(),
      universe: summarizeUniverseSelection(this.runtime.universe || {}),
      strategyAttribution: summarizeAttributionSnapshot(this.runtime.strategyAttribution || {}),
      researchRegistry: summarizeResearchRegistry(this.runtime.researchRegistry || {}),
      previewTopCandidates: previewCandidates.slice(0, 3).map((candidate) => this.buildEntryRationale(candidate))
    };
  }

  async getDashboardSnapshot() {
    await this.maybeRunExchangeTruthLoop();
    if (!Number.isFinite(this.runtime.lastKnownBalance) || !Number.isFinite(this.runtime.lastKnownEquity)) {
      await this.updatePortfolioSnapshot();
    }

    const fullPositions = this.runtime.openPositions.map((position) => this.buildPositionView(position));
    const positions = fullPositions.map((position) => this.buildDashboardPositionView(position));
    const totalUnrealizedPnl = fullPositions.reduce((total, position) => total + position.unrealizedPnl, 0);
    const report = buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config });
    const fullTopDecisions = arr(this.runtime.latestDecisions).slice(0, this.config.dashboardDecisionLimit || 12);
    const fullBlockedSetups = arr(this.runtime.latestBlockedSetups).slice(0, this.config.dashboardDecisionLimit || 12);
    const topDecision = fullTopDecisions[0] || {};
    const leadPosition = fullPositions[0] || null;
    const exchangeOverview = topDecision.exchangeSummary || leadPosition?.entryRationale?.exchange || summarizeExchange(EMPTY_EXCHANGE);
    const marketStructureOverview = topDecision.marketStructure || leadPosition?.entryRationale?.marketStructure || summarizeMarketStructureSummary(EMPTY_MARKET_STRUCTURE);
    const marketSentimentOverview = topDecision.marketSentiment || leadPosition?.entryRationale?.marketSentiment || summarizeMarketSentiment(this.runtime.marketSentiment || EMPTY_MARKET_SENTIMENT);
    const volatilityOverview = topDecision.volatility || leadPosition?.entryRationale?.volatility || summarizeVolatility(this.runtime.volatilityContext || EMPTY_VOLATILITY_CONTEXT);
    const calendarOverview = topDecision.calendar || leadPosition?.entryRationale?.calendar || summarizeCalendarSummary(EMPTY_CALENDAR);

    return {
      generatedAt: nowIso(),
      analysis: {
        lastError: this.runtime.lastAnalysisError || null
      },
      overview: {
        mode: this.config.botMode,
        lastCycleAt: this.runtime.lastCycleAt,
        lastAnalysisAt: this.runtime.lastAnalysisAt,
        lastPortfolioUpdateAt: this.runtime.lastPortfolioUpdateAt,
        quoteFree: num(this.runtime.lastKnownBalance || 0, 2),
        equity: num(this.runtime.lastKnownEquity || 0, 2),
        openPositionCount: positions.length,
        totalUnrealizedPnl: num(totalUnrealizedPnl, 2),
        openExposure: num(report.openExposure || 0, 2),
        watchlistSize: this.config.watchlist.length
      },
      exchangeCapabilities: summarizeExchangeCapabilities(this.runtime.exchangeCapabilities || this.config.exchangeCapabilities || {}),
      health: this.health.getStatus(this.runtime),
      stream: this.stream.getStatus(),
      ai: {
        calibration: this.model.getCalibrationSummary(),
        deployment: this.model.getDeploymentSummary(),
        transformer: this.model.getTransformerSummary(),
        strategyMeta: topDecision.strategyMeta || leadPosition?.entryRationale?.strategyMeta || summarizeStrategyMeta({}),
        parameterGovernor: summarizeParameterGovernor(this.runtime.parameterGovernor || {}),
        strategyRetirement: summarizeStrategyRetirement(this.runtime.strategyRetirement || {}),
        rlPolicy: this.rlPolicy.getSummary(),
        committee: topDecision.committee || leadPosition?.entryRationale?.committee || summarizeCommittee({}),
        strategy: topDecision.strategy || topDecision.strategySummary || leadPosition?.entryRationale?.strategy || summarizeStrategy({}),
        optimizer: this.runtime.aiTelemetry?.strategyOptimizer || summarizeOptimizer(this.strategyOptimizer.buildSnapshot({ journal: this.journal, nowIso: nowIso() })),
        modelRegistry: summarizeModelRegistry(this.runtime.modelRegistry || {})
      },
      safety: {
        session: topDecision.session || this.runtime.session || leadPosition?.entryRationale?.session || summarizeSession({}),
        drift: summarizeDrift(this.runtime.drift || {}),
        selfHeal: summarizeSelfHeal(this.runtime.selfHeal || {}),
        venueConfirmation: summarizeVenueConfirmation(this.runtime.venueConfirmation || {}),
        exchangeTruth: summarizeExchangeTruth(this.runtime.exchangeTruth || {}),
        exchangeSafety: summarizeExchangeSafety(this.runtime.exchangeSafety || {}),
        orderLifecycle: summarizeOrderLifecycle(this.runtime.orderLifecycle || {}),
        lifecycleInvariants: summarizeLifecycleInvariants({
          exchangeTruth: this.runtime.exchangeTruth || {},
          orderLifecycle: this.runtime.orderLifecycle || {}
        }),
        stableModelSnapshots: arr(this.modelBackups || []).slice(0, 3).map(summarizeModelBackup),
        backups: this.runtime.stateBackups || this.backupManager.getSummary(),
        recovery: this.runtime.recovery || {}
      },
      ops: {
        incidentTimeline: arr(this.runtime.ops?.incidentTimeline || []).slice(0, 16),
        runbooks: arr(this.runtime.ops?.runbooks || []).slice(0, 8),
        performanceChange: this.runtime.ops?.performanceChange || null,
        readiness: this.runtime.ops?.readiness || null,
        alerts: summarizeOperatorAlerts(this.runtime.ops?.alerts || {}),
        replayChaos: summarizeReplayChaos(this.runtime.ops?.replayChaos || this.runtime.replayChaos || {}),
        shadowTrading: summarizeShadowTrading(this.runtime.shadowTrading || {}),
        service: summarizeServiceState(this.runtime.service || {}),
        thresholdTuning: summarizeThresholdTuningState(this.runtime.thresholdTuning || {}),
        executionCalibration: summarizeExecutionCalibration(this.runtime.executionCalibration || {}),
        capitalLadder: summarizeCapitalLadder(this.runtime.capitalLadder || {}),
        capitalGovernor: summarizeCapitalGovernor(this.runtime.capitalGovernor || {}),
        capitalPolicy: summarizeCapitalPolicy({
          capitalLadder: this.runtime.capitalLadder || {},
          capitalGovernor: {
            ...(this.runtime.capitalGovernor || {}),
            policyEngine: this.runtime?.capitalPolicy || {}
          }
        }),
        tuningGovernance: summarizeTuningGovernance({
          thresholdTuning: this.runtime.thresholdTuning || {},
          parameterGovernor: this.runtime.parameterGovernor || {},
          modelRegistry: this.runtime.modelRegistry || {},
          offlineTrainer: this.runtime.offlineTrainer || {}
        }),
        alertDelivery: summarizeAlertDelivery(this.runtime.ops?.alertDelivery || {}),
        paperLearning: summarizePaperLearning(this.runtime.ops?.paperLearning || this.runtime.paperLearning || {})
      },
      portfolio: this.buildPortfolioView(),
      exchange: exchangeOverview,
      marketStructure: marketStructureOverview,
      marketSentiment: marketSentimentOverview,
      volatility: volatilityOverview,
      onChainLite: summarizeOnChainLite(this.runtime.onChainLite || EMPTY_ONCHAIN),
      calendar: calendarOverview,
      sourceReliability: summarizeSourceReliability(this.runtime.sourceReliability || {}),
      pairHealth: summarizePairHealth(this.runtime.pairHealth || {}),
      qualityQuorum: summarizeQualityQuorum(this.runtime.qualityQuorum || {}),
      divergence: summarizeDivergenceSummary(this.runtime.divergence || {}),
      offlineTrainer: summarizeOfflineTrainer(this.runtime.offlineTrainer || {}),
      upcomingEvents: arr(topDecision.calendarEvents || leadPosition?.entryRationale?.calendarEvents || []).slice(0, 4),
      officialNotices: arr(topDecision.officialNotices || leadPosition?.entryRationale?.officialNotices || []).slice(0, 4),
      watchlist: this.runtime.watchlistSummary || null,
      positions,
      topDecisions: fullTopDecisions.map((decision) => this.buildDashboardDecisionView(decision)),
      blockedSetups: fullBlockedSetups.map((decision) => this.buildDashboardDecisionView(decision)),
      tradeReplays: report.recentTrades.slice(0, 6).map((trade) => this.buildTradeReplayView(trade)),
      universe: summarizeUniverseSelection(this.runtime.universe || {}),
      strategyAttribution: summarizeAttributionSnapshot(this.runtime.strategyAttribution || {}),
      research: this.buildResearchView(),
      strategyResearch: summarizeStrategyResearch(this.runtime.strategyResearch || {}),
      researchRegistry: summarizeResearchRegistry(this.runtime.researchRegistry || {}),
      dataRecorder: summarizeDataRecorder(this.runtime.dataRecorder || this.dataRecorder.getSummary()),
      report: {
        tradeQualityReview: report.tradeQualityReview || null,
        recentReviews: arr(report.recentReviews || []).slice(0, 12),
        equitySeries: arr(report.equitySeries || []).slice(-(this.config.dashboardEquityPointLimit || 1440)).map((item) => ({
          at: item.at,
          equity: num(item.equity || 0, 2)
        })),
        recentEvents: arr(report.recentEvents || []).slice(0, 16).map((event) => ({
          at: event.at || null,
          type: event.type || null,
          symbol: event.symbol || null,
          rationale: event.rationale || null,
          error: event.error || null
        })),
        executionSummary: {
          avgExpectedEntrySlippageBps: num(report.executionSummary?.avgExpectedEntrySlippageBps || 0, 2),
          avgEntryTouchSlippageBps: num(report.executionSummary?.avgEntryTouchSlippageBps || 0, 2),
          avgSlippageDeltaBps: num(report.executionSummary?.avgSlippageDeltaBps || 0, 2),
          avgExecutionQualityScore: num(report.executionSummary?.avgExecutionQualityScore || 0, 3),
          avgMakerFillRatio: num(report.executionSummary?.avgMakerFillRatio || 0, 3),
          styles: arr(report.executionSummary?.styles || []).slice(0, 6).map((item) => ({
            style: item.style || item.id || null,
            tradeCount: item.tradeCount || 0,
            realizedPnl: num(item.realizedPnl || 0, 2),
            avgEntryTouchSlippageBps: num(item.avgEntryTouchSlippageBps || 0, 2),
            avgExpectedEntrySlippageBps: num(item.avgExpectedEntrySlippageBps || 0, 2),
            avgSlippageDeltaBps: num(item.avgSlippageDeltaBps || 0, 2),
            avgMakerFillRatio: num(item.avgMakerFillRatio || 0, 3)
          })),
          strategies: arr(report.executionSummary?.strategies || []).slice(0, 6).map((item) => ({
            id: item.id || null,
            tradeCount: item.tradeCount || 0,
            realizedPnl: num(item.realizedPnl || 0, 2),
            averageExecutionQuality: num(item.averageExecutionQuality || 0, 3),
            avgExpectedEntrySlippageBps: num(item.avgExpectedEntrySlippageBps || 0, 2),
            avgSlippageDeltaBps: num(item.avgSlippageDeltaBps || 0, 2)
          }))
        },
        executionCostSummary: summarizeExecutionCost(report.executionCostSummary || this.runtime.executionCost || {}),
        pnlDecomposition: {
          netRealizedPnl: num(report.pnlDecomposition?.netRealizedPnl || 0, 2),
          grossMovePnl: num(report.pnlDecomposition?.grossMovePnl || 0, 2),
          totalFees: num(report.pnlDecomposition?.totalFees || 0, 2),
          executionDragEstimate: num(report.pnlDecomposition?.executionDragEstimate || 0, 2),
          latencyDragEstimate: num(report.pnlDecomposition?.latencyDragEstimate || 0, 2),
          queueDragEstimate: num(report.pnlDecomposition?.queueDragEstimate || 0, 2),
          averageCaptureEfficiency: num(report.pnlDecomposition?.averageCaptureEfficiency || 0, 4),
          notes: [...(report.pnlDecomposition?.notes || [])]
        },
        recentTrades: report.recentTrades.map((trade) => this.buildDashboardTradeView(this.buildTradeView(trade))),
        windows: Object.fromEntries(Object.entries(report.windows || {}).map(([name, stats]) => [name, {
          tradeCount: stats.tradeCount || 0,
          realizedPnl: num(stats.realizedPnl || 0, 2),
          winRate: num(stats.winRate || 0, 4),
          averagePnlPct: num(stats.averagePnlPct || 0, 4),
          profitFactor: Number.isFinite(stats.profitFactor) ? num(stats.profitFactor, 3) : null
        }]))
      },
      modelWeights: this.buildModelWeightsView(),
      configSummary: {
        dashboardPort: this.config.dashboardPort,
        dashboardEquityPointLimit: this.config.dashboardEquityPointLimit,
        dashboardCyclePointLimit: this.config.dashboardCyclePointLimit,
        dashboardDecisionLimit: this.config.dashboardDecisionLimit,
        operatorAlertSilenceMinutes: this.config.operatorAlertSilenceMinutes
      }
    };
  }

  async getStatus() {
    const dashboard = await this.getDashboardSnapshot();
    return {
      mode: dashboard.overview.mode,
      lastCycleAt: dashboard.overview.lastCycleAt,
      quoteFree: dashboard.overview.quoteFree,
      equity: dashboard.overview.equity,
      openPositions: dashboard.positions,
      topDecisions: dashboard.topDecisions,
      health: dashboard.health,
      stream: dashboard.stream,
      ai: dashboard.ai,
      portfolio: dashboard.portfolio,
      exchangeCapabilities: dashboard.exchangeCapabilities,
      exchange: dashboard.exchange,
      marketStructure: dashboard.marketStructure,
      qualityQuorum: dashboard.qualityQuorum,
      offlineTrainer: dashboard.offlineTrainer,
      strategyResearch: dashboard.strategyResearch,
      calendar: dashboard.calendar,
      safety: dashboard.safety,
      ops: dashboard.ops,
      report: dashboard.report,
      modelWeights: dashboard.modelWeights
    };
  }
}

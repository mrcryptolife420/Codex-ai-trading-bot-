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
import { PortfolioOptimizer } from "../risk/portfolioOptimizer.js";
import { RiskManager } from "../risk/riskManager.js";
import { StateStore } from "../storage/stateStore.js";
import { buildPerformanceReport } from "./reportBuilder.js";
import { DataRecorder } from "./dataRecorder.js";
import { ModelRegistry } from "./modelRegistry.js";
import { StateBackupManager } from "./stateBackupManager.js";
import { runResearchLab } from "./researchLab.js";
import { ResearchRegistry } from "./researchRegistry.js";
import { UniverseSelector } from "./universeSelector.js";
import { resolveDynamicWatchlist } from "./watchlistResolver.js";
import { HealthMonitor } from "./healthMonitor.js";
import { DriftMonitor } from "./driftMonitor.js";
import { SelfHealManager } from "./selfHealManager.js";
import { StreamCoordinator } from "./streamCoordinator.js";
import { buildDeepScanPlan, buildLightweightSnapshot } from "./scanPlanner.js";
import { buildSessionSummary } from "./sessionManager.js";
import { buildFeatureVector } from "../strategy/features.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { computeMarketFeatures, computeOrderBookFeatures } from "../strategy/indicators.js";
import { minutesBetween, nowIso } from "../utils/time.js";
import { mapWithConcurrency } from "../utils/async.js";

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
  return {
    generatedAt: optimizer.generatedAt || null,
    sampleSize: optimizer.sampleSize || 0,
    sampleConfidence: num(optimizer.sampleConfidence || 0, 4),
    thresholdTilt: num(optimizer.thresholdTilt || 0, 4),
    confidenceTilt: num(optimizer.confidenceTilt || 0, 4),
    suggestions: [...(optimizer.suggestions || [])],
    topStrategies: arr(optimizer.topStrategies || []).slice(0, 5).map((item) => ({
      id: item.id,
      label: item.label,
      tradeCount: item.tradeCount || 0,
      weightedTrades: num(item.weightedTrades || 0, 2),
      winRate: num(item.winRate || 0, 4),
      avgPnlPct: num(item.avgPnlPct || 0, 4),
      avgPnlQuote: num(item.avgPnlQuote || 0, 2),
      rewardScore: num(item.rewardScore || 0, 4),
      multiplier: num(item.multiplier || 1, 4),
      confidence: num(item.confidence || 0, 4)
    })),
    topFamilies: arr(optimizer.topFamilies || []).slice(0, 4).map((item) => ({
      id: item.id,
      label: item.label,
      tradeCount: item.tradeCount || 0,
      weightedTrades: num(item.weightedTrades || 0, 2),
      winRate: num(item.winRate || 0, 4),
      avgPnlPct: num(item.avgPnlPct || 0, 4),
      rewardScore: num(item.rewardScore || 0, 4),
      multiplier: num(item.multiplier || 1, 4),
      confidence: num(item.confidence || 0, 4)
    })),
    strategyThresholdTilts: Object.fromEntries(Object.entries(optimizer.strategyThresholdTilts || {}).slice(0, 8).map(([key, value]) => [key, num(value || 0, 4)])),
    familyThresholdTilts: Object.fromEntries(Object.entries(optimizer.familyThresholdTilts || {}).slice(0, 6).map(([key, value]) => [key, num(value || 0, 4)])),
    strategyConfidenceTilts: Object.fromEntries(Object.entries(optimizer.strategyConfidenceTilts || {}).slice(0, 8).map(([key, value]) => [key, num(value || 0, 4)])),
    familyConfidenceTilts: Object.fromEntries(Object.entries(optimizer.familyConfidenceTilts || {}).slice(0, 6).map(([key, value]) => [key, num(value || 0, 4)]))
  };
}

function summarizeOptimizerApplied(applied = {}) {
  return {
    sampleSize: applied.sampleSize || 0,
    sampleConfidence: num(applied.sampleConfidence || 0, 4),
    baseThreshold: num(applied.baseThreshold || 0, 4),
    effectiveThreshold: num(applied.effectiveThreshold ?? applied.baseThreshold ?? 0, 4),
    thresholdAdjustment: num(applied.thresholdAdjustment || 0, 4),
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
    maxCorrelation: num(portfolioSummary.maxCorrelation || 0, 3),
    sizeMultiplier: num(portfolioSummary.sizeMultiplier || 1, 3),
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
    reasons: [...(summary.reasons || [])],
    notes: [...(summary.notes || [])]
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
    this.committee = new MultiAgentCommittee(config);
    this.rlPolicy = new ReinforcementExecutionPolicy(undefined, config);
    this.strategyOptimizer = new StrategyOptimizer(config);
    this.strategyAttribution = new StrategyAttribution(config);
    this.exitIntelligence = new ExitIntelligence(config);
    this.metaGate = new MetaDecisionGate(config);
    this.researchRegistry = new ResearchRegistry(config);
    this.modelRegistry = new ModelRegistry(config);
    this.dataRecorder = new DataRecorder({ runtimeDir: config.runtimeDir, config, logger });
    this.backupManager = new StateBackupManager({ runtimeDir: config.runtimeDir, config, logger });
    this.universeSelector = new UniverseSelector(config);
    this.stream = new StreamCoordinator({ client: this.client, config, logger });
    this.symbolRules = {};
    this.marketCache = {};
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
    this.journal.equitySnapshots = arr(this.journal.equitySnapshots);
    this.journal.cycles = arr(this.journal.cycles);
    this.journal.events = arr(this.journal.events);

    await this.dataRecorder.init(this.runtime.dataRecorder || null);
    await this.backupManager.init(this.runtime.stateBackups || null);
    this.runtime.dataRecorder = this.dataRecorder.getSummary();
    this.runtime.stateBackups = this.backupManager.getSummary();
    this.model = new AdaptiveTradingModel(await this.store.loadModel(), this.config);
    this.rlPolicy = new ReinforcementExecutionPolicy(this.runtime.executionPolicyState, this.config);
    this.news = new NewsService({ config: this.config, runtime: this.runtime, logger: this.logger });
    this.exchangeNotices = new BinanceAnnouncementService({ config: this.config, runtime: this.runtime, logger: this.logger });
    this.calendar = new CalendarService({ config: this.config, runtime: this.runtime, logger: this.logger });
    this.marketStructure = new MarketStructureService({ client: this.client, config: this.config, runtime: this.runtime, logger: this.logger });
    this.marketSentiment = new MarketSentimentService({ config: this.config, runtime: this.runtime, logger: this.logger });
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
    await this.persist();
  }

  async close() {
    this.runtime.stream = this.stream.getStatus();
    this.runtime.lifecycle = this.runtime.lifecycle || {};
    this.runtime.lifecycle.activeRun = false;
    this.runtime.lifecycle.lastShutdownAt = nowIso();
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

  refreshGovernanceViews(referenceNow = nowIso()) {
    const report = buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config });
    const rawResearchRegistry = this.researchRegistry.buildRegistry({
      journal: this.journal,
      latestSummary: this.runtime.researchLab?.latestSummary || null,
      modelBackups: this.modelBackups || [],
      nowIso: referenceNow
    });
    this.runtime.strategyAttribution = summarizeAttributionSnapshot(
      this.strategyAttribution.buildSnapshot({ journal: this.journal, nowIso: referenceNow })
    );
    this.runtime.researchRegistry = summarizeResearchRegistry(rawResearchRegistry);
    this.runtime.modelRegistry = summarizeModelRegistry(
      this.modelRegistry.buildRegistry({
        snapshots: this.modelBackups || [],
        report,
        researchRegistry: rawResearchRegistry,
        calibration: this.model.getCalibrationSummary(),
        deployment: this.model.getDeploymentSummary(),
        nowIso: referenceNow
      })
    );
    this.runtime.dataRecorder = this.dataRecorder.getSummary();
    this.runtime.stateBackups = this.backupManager.getSummary();
    return { report, rawResearchRegistry };
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
    trade.promotionPolicy = this.modelRegistry.buildPromotionPolicy({
      report,
      researchRegistry: rawResearchRegistry,
      calibration: this.model.getCalibrationSummary(),
      deployment: this.model.getDeploymentSummary()
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
      const [rawKlines, restBookTicker, restOrderBook] = await Promise.all([
        this.client.getKlines(symbol, this.config.klineInterval, this.config.klineLimit),
        streamFeatures.latestBookTicker?.bid && streamFeatures.latestBookTicker?.ask
          ? Promise.resolve(null)
          : this.client.getBookTicker(symbol),
        useLocalBook ? Promise.resolve(null) : this.client.getOrderBook(symbol, Math.max(10, this.config.streamDepthLevels || 20))
      ]);
      const candles = normalizeKlines(rawKlines);
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
      book.resilienceScore = localBookSnapshot?.resilienceScore || 0;
      book.depthConfidence = localBookSnapshot?.depthConfidence || 0;
      book.depthAgeMs = localBookSnapshot?.depthAgeMs ?? null;
      book.totalDepthNotional = localBookSnapshot?.totalDepthNotional || 0;
      const snapshot = {
        symbol,
        candles,
        market: computeMarketFeatures(candles),
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
    const explorationMode = candidate.decision.entryMode === "paper_exploration";
    return [
      {
        label: "Model confidence",
        passed: candidate.score.probability >= candidate.decision.threshold || explorationMode,
        detail: explorationMode
          ? `${num(candidate.score.probability * 100, 1)}% via paper warm-up override | base ${num((candidate.decision.baseThreshold || candidate.decision.threshold) * 100, 1)}%`
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
        passed: !["paused", "paper_fallback"].includes(candidate.selfHealState?.mode),
        detail: `${candidate.selfHealState?.mode || "normal"} | size ${num(candidate.selfHealState?.sizeMultiplier ?? 1, 2)} | thr ${num(candidate.selfHealState?.thresholdPenalty || 0, 2)}`
      },
      {
        label: "Meta gate",
        passed: (candidate.metaSummary?.action || "pass") !== "block",
        detail: `score ${num((candidate.metaSummary?.score || 0) * 100, 1)}% | conf ${num((candidate.metaSummary?.confidence || 0) * 100, 1)}% | budget ${num((candidate.metaSummary?.dailyBudgetFactor || 1) * 100, 1)}%`
      },
      {
        label: "Portfolio overlap",
        passed: !(candidate.portfolioSummary.reasons || []).length,
        detail: `Corr ${num(candidate.portfolioSummary.maxCorrelation || 0, 2)} | cluster ${candidate.portfolioSummary.sameClusterCount || 0}`
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
      : executionText;
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
    if (candidate.decision.allow) {
      return `${candidate.symbol} kreeg groen licht voor ${setupStyle} via ${strategyText} in regime ${candidate.regimeSummary.regime}: score ${num(candidate.score.probability * 100, 1)}%, ${eventText}, ${socialText}, ${noticeText}, ${structureText}, ${macroText}, ${volatilityText}, ${orderbookText}, ${patternText}, ${calendarText}, ${providerText}, ${sessionText}, ${driftText}, ${selfHealText}, ${metaText}, ${signalText} als sterkste driver, ${optimizerText}, ${universeText}, ${attributionText} en ${explorationText} als execution-plan.`;
    }
    return `${candidate.symbol} werd geblokkeerd door ${candidate.decision.reasons.join(", ")}. Setup ${setupStyle} via ${strategyText}, regime ${candidate.regimeSummary.regime}, score ${num(candidate.score.probability * 100, 1)}%, ${socialText}, ${noticeText}, ${structureText}, ${macroText}, ${volatilityText}, ${orderbookText}, ${patternText}, ${calendarText}, ${providerText}, ${sessionText}, ${driftText}, ${selfHealText}, ${metaText}, ${universeText}, ${attributionText} en ${optimizerText}.`;
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
      strategyConfidenceFloor: num(candidate.decision.strategyConfidenceFloor || this.config.strategyMinConfidence, 4),
      rankScore: num(candidate.decision.rankScore, 4),
      quoteAmount: num(candidate.decision.quoteAmount, 2),
      entryMode: candidate.decision.entryMode || "standard",
      suppressedReasons: candidate.decision.suppressedReasons || [],
      paperExploration: candidate.decision.paperExploration || null,
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
      orderBook: summarizeOrderBook(candidate.marketSnapshot.book),
      patterns: summarizePatterns(candidate.marketSnapshot.market),
      indicators: summarizeIndicators(candidate.marketSnapshot.market),
      strategy: summarizeStrategy(candidate.strategySummary),
      universe: candidate.universeSummary ? { ...candidate.universeSummary } : null,
      strategyAttribution: summarizeAttributionAdjustment(candidate.attributionSummary),
      optimizer: summarizeOptimizer(candidate.optimizerSummary),
      optimizerApplied: summarizeOptimizerApplied(candidate.decision.optimizerApplied),
      transformer: summarizeTransformer(candidate.score.transformer),
      committee: summarizeCommittee(candidate.committeeSummary),
      rlPolicy: summarizeRlPolicy(candidate.rlAdvice),
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
    const newsSummary = context.newsSummary || (await this.news.getSymbolSummary(symbol, aliases));
    const streamFeatures = marketSnapshot.stream || this.stream.getSymbolStreamFeatures(symbol);
    const exchangeSummary = context.exchangeSummary || (await this.exchangeNotices.getSymbolSummary(symbol, aliases));
    const calendarSummary = context.calendarSummary || (await this.calendar.getSymbolSummary(symbol, aliases));
    const marketStructureSummary = context.marketStructureSummary || (await this.marketStructure.getSymbolSummary(symbol, streamFeatures));
    const marketSentimentSummary = context.marketSentimentSummary || (this.config.enableMarketSentimentContext ? await this.marketSentiment.getSummary() : EMPTY_MARKET_SENTIMENT);
    const volatilitySummary = context.volatilitySummary || (this.config.enableVolatilityContext ? await this.volatility.getSummary() : EMPTY_VOLATILITY_CONTEXT);
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
    const strategySummary = evaluateStrategySet({
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
      optimizerSummary
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
      marketSnapshot,
      candidateProfile: this.config.symbolProfiles[symbol] || defaultProfile(symbol),
      openPositionContexts,
      regimeSummary
    });
    const currentExposure = this.risk.getCurrentExposure(this.runtime);
    const totalEquityProxy = Math.max(balance.quoteFree + currentExposure, 1);
    const symbolStats = this.model.getSymbolStats(symbol);
    const rawFeatures = buildFeatureVector({
      symbolStats,
      marketFeatures: marketSnapshot.market,
      bookFeatures: marketSnapshot.book,
      newsSummary,
      announcementSummary: exchangeSummary,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      calendarSummary,
      portfolioFeatures: {
        heat: currentExposure / totalEquityProxy,
        maxCorrelation: portfolioSummary.maxCorrelation || 0
      },
      streamFeatures,
      regimeSummary,
      strategySummary,
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
      calendarSummary
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
      rlAdvice: provisionalRlAdvice
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
      nowIso: now.toISOString()
    });
    decision.rankScore = num((decision.rankScore || 0) + (attributionSummary.rankBoost || 0), 4);
    decision.attributionSummary = attributionSummary;
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
      rlAdvice
    });
    decision.committeeSummary = committeeSummary;
    decision.rlAdvice = rlAdvice;
    decision.strategySummary = strategySummary;
    return {
      symbol,
      marketSnapshot,
      newsSummary,
      exchangeSummary,
      marketStructureSummary,
      marketSentimentSummary,
      volatilitySummary,
      calendarSummary,
      streamFeatures,
      rawFeatures,
      score,
      regimeSummary,
      strategySummary,
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
      const aliases = this.config.symbolMetadata[position.symbol] || [position.symbol];
      const marketSnapshot = await this.getMarketSnapshot(position.symbol);
      marketSnapshot.book.exitEstimate = this.stream.estimateFill?.(position.symbol, "SELL", { quantity: position.quantity }) || null;
      mids[position.symbol] = marketSnapshot.book.mid;
      const newsSummary = await this.news.getSymbolSummary(position.symbol, aliases);
      const exchangeSummary = await this.exchangeNotices.getSymbolSummary(position.symbol, aliases);
      const calendarSummary = await this.calendar.getSymbolSummary(position.symbol, aliases);
      const marketStructureSummary = await this.marketStructure.getSymbolSummary(position.symbol, marketSnapshot.stream || this.stream.getSymbolStreamFeatures(position.symbol));
      const exitIntelligenceSummary = this.config.enableExitIntelligence
        ? this.exitIntelligence.evaluate({
            position,
            marketSnapshot,
            newsSummary,
            announcementSummary: exchangeSummary,
            marketStructureSummary,
            calendarSummary,
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
      position.latestExitIntelligence = exitIntelligenceSummary;
      position.lastReviewedAt = nowIso();
      if (exitDecision.shouldScaleOut) {
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
      this.journal.trades.push(trade);
      await this.learnFromTrade(trade, "Closed position");
    }
    return mids;
  }

  async scanCandidates(balance) {
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
    this.stream.setLocalBookUniverse(scanPlan.localBookSymbols || []);
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
    const openPositionContexts = this.buildOpenPositionContexts(snapshotMap);
    const optimizerSnapshot = this.strategyOptimizer.buildSnapshot({ journal: this.journal, nowIso: now.toISOString() });
    const attributionSnapshot = this.strategyAttribution.buildSnapshot({ journal: this.journal, nowIso: now.toISOString() });
    this.runtime.aiTelemetry.strategyOptimizer = summarizeOptimizer(optimizerSnapshot);
    this.runtime.strategyAttribution = summarizeAttributionSnapshot(attributionSnapshot);
    const universeSnapshot = scanPlan.universeSnapshot;
    this.runtime.universe = summarizeUniverseSelection(universeSnapshot);
    this.journal.universeRuns.push({
      at: now.toISOString(),
      selectedSymbols: [...(universeSnapshot.selectedSymbols || [])],
      selectedCount: universeSnapshot.selectedCount || 0,
      eligibleCount: universeSnapshot.eligibleCount || 0,
      averageScore: num(universeSnapshot.averageScore || 0, 4),
      bestSymbol: universeSnapshot.selectedSymbols?.[0] || null
    });
    const universeEntryMap = Object.fromEntries(
      [...arr(universeSnapshot.selected || []), ...arr(universeSnapshot.skipped || [])].map((entry) => [entry.symbol, entry])
    );
    const symbolsToEvaluate = (universeSnapshot.selectedSymbols || []).length ? universeSnapshot.selectedSymbols : this.config.watchlist;
    const candidates = [];

    for (const symbol of symbolsToEvaluate) {
      if (!this.symbolRules[symbol]) {
        continue;
      }
      try {
        const candidate = await this.evaluateCandidate(symbol, balance, now, {
          marketSnapshot: snapshotMap[symbol],
          openPositionContexts,
          optimizerSummary: optimizerSnapshot,
          attributionSnapshot,
          universeSummary: universeEntryMap[symbol] || null
        });
        candidates.push(candidate);
      } catch (error) {
        this.logger.warn("Candidate evaluation failed", { symbol, error: error.message });
        this.recordEvent("candidate_evaluation_failed", { symbol, error: error.message });
      }
    }

    candidates.sort((left, right) => right.decision.rankScore - left.decision.rankScore);
    this.runtime.latestDecisions = candidates.slice(0, this.config.dashboardDecisionLimit).map((candidate) => ({
      symbol: candidate.symbol,
      summary: this.buildCandidateSummary(candidate),
      setupStyle: buildSetupStyle(candidate),
      strategy: summarizeStrategy(candidate.strategySummary),
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
      regime: candidate.regimeSummary.regime,
      regimeConfidence: num(candidate.regimeSummary.confidence || 0, 3),
      baseThreshold: num(candidate.decision.baseThreshold || candidate.decision.threshold, 4),
      threshold: num(candidate.decision.threshold, 4),
      thresholdAdjustment: num(candidate.decision.thresholdAdjustment || 0, 4),
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
      committee: summarizeCommittee(candidate.committeeSummary),
      rlPolicy: summarizeRlPolicy(candidate.rlAdvice),
      session: summarizeSession(candidate.sessionSummary),
      drift: summarizeDrift(candidate.driftSummary),
      selfHeal: summarizeSelfHeal(candidate.selfHealState),
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
    this.runtime.session = candidates[0]
      ? summarizeSession(candidates[0].sessionSummary)
      : this.runtime.session || summarizeSession({});
    return candidates;
  }

  async openBestCandidate(candidates, { executionBlockers = [] } = {}) {
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
        attempt.entryErrors.push({ symbol: candidate.symbol, error: error.message });
      }
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

  async refreshAnalysis() {
    try {
      const midPrices = await this.getLatestMidPrices(this.runtime.openPositions.map((position) => position.symbol));
      for (const position of this.runtime.openPositions) {
        if (Number.isFinite(midPrices[position.symbol])) {
          position.lastMarkedPrice = midPrices[position.symbol];
        }
      }
      const balance = await this.broker.getBalance(this.runtime);
      const candidates = await this.scanCandidates(balance);
      const equity = await this.broker.getEquity(this.runtime, midPrices);
      this.runtime.lastKnownBalance = balance.quoteFree;
      this.runtime.lastKnownEquity = equity;
      this.runtime.lastPortfolioUpdateAt = nowIso();
      this.runtime.lastAnalysisAt = nowIso();
      this.runtime.lastAnalysisError = null;
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
    this.runtime.researchLab = {
      lastRunAt: result.generatedAt,
      latestSummary: result
    };
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
    const candidates = await this.scanCandidates(balance);
    const executionBlockers = this.config.botMode === "live" ? driftIssues : [];
    const entryAttempt = await this.openBestCandidate(candidates, { executionBlockers });
    const openedPosition = entryAttempt.openedPosition || null;
    this.applyEntryAttemptToDecisions(entryAttempt);
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
    this.refreshGovernanceViews(cycleAt);
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
      this.trimJournal();
      await this.persist();
      return result;
    } catch (error) {
      this.health.recordFailure(this.runtime, error);
      this.runtime.lastAnalysisError = { at: nowIso(), message: error.message };
      this.recordEvent("cycle_failure", { error: error.message });
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

  buildDashboardDecisionView(decision = {}) {
    const strategy = decision.strategy || decision.strategySummary || {};
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
      blockerReasons: arr(decision.blockerReasons || []).slice(0, 4),
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
      session: {
        session: decision.session?.session || null,
        sessionLabel: decision.session?.sessionLabel || decision.session?.session || null,
        blockerReasons: arr(decision.session?.blockerReasons || []).slice(0, 2)
      },
      meta: {
        qualityScore: num(decision.meta?.qualityScore ?? decision.meta?.score ?? 0, 4),
        qualityBand: decision.meta?.qualityBand || null
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
    const gateDetail = `model ${num(rationale.probability || trade.probabilityAtEntry || 0, 3)} | gate ${num(rationale.threshold || 0, 3)} | conf ${num(rationale.confidence || 0, 3)}`;
    return {
      id: trade.id,
      symbol: trade.symbol,
      entryAt: trade.entryAt,
      exitAt: trade.exitAt,
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
      blockersAtEntry: arr(rationale.blockerReasons || []).slice(0, 5),
      headlines,
      candleContext: arr(rationale.candleContext || []).slice(0, 24),
      pnlAttribution: {
        executionStyle: trade.entryExecutionAttribution?.entryStyle || null,
        provider: trade.entryRationale?.providerBreakdown?.[0]?.name || null,
        captureEfficiency: num(trade.captureEfficiency || 0, 4)
      },
      timeline: [
        { at: trade.entryAt, type: "analysis", label: "Gate", detail: gateDetail },
        { at: trade.entryAt, type: "entry", label: "Entry", detail: rationale.summary || `${trade.symbol} entry` },
        { at: trade.entryAt, type: "committee", label: "Committee", detail: `agree ${num(committee.agreement || 0, 3)} | net ${num(committee.netScore || 0, 3)} | vetoes ${(committee.vetoes || []).length}` },
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
        experiments: arr(report.experiments || []).slice(0, 4).map((item) => ({
          testStartAt: item.testStartAt,
          testEndAt: item.testEndAt,
          tradeCount: item.tradeCount || 0,
          realizedPnl: num(item.realizedPnl || 0, 2),
          winRate: num(item.winRate || 0, 4),
          sharpe: num(item.sharpe || 0, 3),
          expectancy: num(item.expectancy || 0, 2),
          strategyLeaders: [...(item.strategyLeaders || [])],
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
    const previewCandidates = await this.scanCandidates(balance);
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
      session: summarizeSession(this.runtime.session || {}),
      marketSentiment: summarizeMarketSentiment(this.runtime.marketSentiment || EMPTY_MARKET_SENTIMENT),
      volatility: summarizeVolatility(this.runtime.volatilityContext || EMPTY_VOLATILITY_CONTEXT),
      stableModelSnapshots: arr(this.modelBackups || []).slice(0, 3).map(summarizeModelBackup),
      dataRecorder: this.runtime.dataRecorder || this.dataRecorder.getSummary(),
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
      health: this.health.getStatus(this.runtime),
      stream: this.stream.getStatus(),
      ai: {
        calibration: this.model.getCalibrationSummary(),
        deployment: this.model.getDeploymentSummary(),
        transformer: this.model.getTransformerSummary(),
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
        stableModelSnapshots: arr(this.modelBackups || []).slice(0, 3).map(summarizeModelBackup),
        backups: this.runtime.stateBackups || this.backupManager.getSummary(),
        recovery: this.runtime.recovery || {}
      },
      portfolio: this.buildPortfolioView(),
      exchange: exchangeOverview,
      marketStructure: marketStructureOverview,
      marketSentiment: marketSentimentOverview,
      volatility: volatilityOverview,
      calendar: calendarOverview,
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
      researchRegistry: summarizeResearchRegistry(this.runtime.researchRegistry || {}),
      dataRecorder: this.runtime.dataRecorder || this.dataRecorder.getSummary(),
      report: {
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
        dashboardDecisionLimit: this.config.dashboardDecisionLimit
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
      exchange: dashboard.exchange,
      marketStructure: dashboard.marketStructure,
      calendar: dashboard.calendar,
      safety: dashboard.safety,
      report: dashboard.report,
      modelWeights: dashboard.modelWeights
    };
  }
}
































































































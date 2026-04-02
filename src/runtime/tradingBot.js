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
import { StateStore, migrateJournal, migrateRuntime } from "../storage/stateStore.js";
import { buildPerformanceReport, buildTradePnlBreakdown, buildTradeQualityReview } from "./reportBuilder.js";
import { DataRecorder } from "./dataRecorder.js";
import { ModelRegistry } from "./modelRegistry.js";
import { StateBackupManager } from "./stateBackupManager.js";
import { MarketHistoryStore } from "../storage/marketHistoryStore.js";
import { runResearchLab } from "./researchLab.js";
import { backfillHistoricalCandles } from "./marketHistory.js";
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
import { buildMarketConditionSummary } from "./marketConditionController.js";
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
import { minutesBetween, nowIso, sameUtcDay } from "../utils/time.js";
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

function incrementCount(counter = {}, key) {
  if (!key) {
    return counter;
  }
  counter[key] = (counter[key] || 0) + 1;
  return counter;
}

function summarizeCountMap(counter = {}, limit = 8) {
  return Object.entries(counter || {})
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}

function classifySignalRejectionCategory(reason = "") {
  const normalized = `${reason || ""}`.trim().toLowerCase();
  if (!normalized) {
    return "other";
  }
  if (normalized.startsWith("committee_")) {
    return "committee";
  }
  if (
    normalized.includes("live_paper_divergence") ||
    normalized.includes("entry_requires_runtime_recovery") ||
    normalized.includes("broker_mode_mismatch") ||
    normalized.includes("mode_mismatch")
  ) {
    return "mode_mismatch";
  }
  if (
    normalized.startsWith("capital_") ||
    normalized.startsWith("quality_quorum") ||
    normalized.startsWith("meta_gate") ||
    normalized.startsWith("strategy_") ||
    normalized.includes("_budget_") ||
    normalized.includes("_kill_switch_")
  ) {
    return "governance";
  }
  if (normalized.includes("timeframe") || normalized.includes("higher_tf_conflict") || normalized.includes("lower_tf_conflict")) {
    return "timeframe";
  }
  if (normalized.startsWith("model_")) {
    return "model";
  }
  if (
    normalized.startsWith("execution_cost_") ||
    normalized.includes("spread") ||
    normalized.includes("orderbook") ||
    normalized.includes("local_book") ||
    normalized.includes("book_quality") ||
    normalized.includes("reference_venue") ||
    normalized.includes("execution") ||
    normalized.includes("liquidity_guard") ||
    normalized.includes("maker") ||
    normalized.includes("taker")
  ) {
    return "execution";
  }
  if (
    normalized.includes("cooldown") ||
    normalized.includes("weekend") ||
    normalized.includes("session") ||
    normalized.includes("funding")
  ) {
    return "session";
  }
  if (
    normalized.includes("volatility") ||
    normalized.includes("pattern") ||
    normalized.includes("structure") ||
    normalized.includes("sentiment") ||
    normalized.includes("liquidation") ||
    normalized.includes("news") ||
    normalized.includes("event") ||
    normalized.includes("trend") ||
    normalized.includes("weakness") ||
    normalized.includes("acceptance") ||
    normalized.includes("downside") ||
    normalized.includes("onchain") ||
    normalized.includes("crowded")
  ) {
    return "market";
  }
  if (
    normalized.includes("exposure") ||
    normalized.includes("loss_streak") ||
    normalized.includes("drawdown") ||
    normalized.includes("position_already_open") ||
    normalized.includes("portfolio")
  ) {
    return "portfolio";
  }
  if (normalized.includes("trade_size") || normalized.includes("minimum")) {
    return "sizing";
  }
  if (
    normalized.includes("quarantine") ||
    normalized.includes("operator") ||
    normalized.includes("self_heal") ||
    normalized.includes("provider") ||
    normalized.includes("drift") ||
    normalized.includes("divergence")
  ) {
    return "ops";
  }
  if (normalized.includes("exchange")) {
    return "execution";
  }
  return "other";
}

function resolveStatusTone(value) {
  const normalized = `${value || ""}`.toLowerCase();
  if (["healthy", "ready", "running", "positive", "clear", "paper", "eligible", "active"].includes(normalized)) {
    return "positive";
  }
  if (["blocked", "critical", "failed", "negative", "stopped", "live", "manual_review"].includes(normalized)) {
    return "negative";
  }
  return "neutral";
}

function isUsableCounterfactual(item = {}) {
  return !item.resolutionFailed && item.outcome !== "resolution_failed";
}

function titleize(value) {
  return `${value || "-"}`
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeReason(value, fallback = "-") {
  const text = `${value || ""}`.trim();
  return text ? titleize(text) : fallback;
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
  return !["capital_governor_blocked", "capital_governor_recovery", "execution_cost_budget_blocked", "readiness_degraded", "paper_signal_flow_stalled"].includes(alert.id || "");
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
    localBookSynced: Boolean(book.localBookSynced ?? book.localBook?.synced),
    bookSource: book.bookSource || null,
    bookFallbackReady: Boolean(book.bookFallbackReady)
  };
}

function sumDepthNotional(levels = []) {
  return arr(levels).reduce((total, [price, quantity]) => total + Number(price || 0) * Number(quantity || 0), 0);
}

function deriveOrderBookQuality({
  book = {},
  orderBook = {},
  localBookSnapshot = null,
  streamFeatures = {},
  config = {}
} = {}) {
  const localBookSynced = Boolean(localBookSnapshot?.synced);
  const restDepthNotional = sumDepthNotional(orderBook?.bids || []) + sumDepthNotional(orderBook?.asks || []);
  const levelCount = arr(orderBook?.bids || []).length + arr(orderBook?.asks || []).length;
  const spreadQuality = clamp(
    1 - Number(book.spreadBps || 0) / Math.max((config.maxSpreadBps || 25) * 1.5, 1),
    0,
    1
  );
  const levelCoverage = clamp(levelCount / Math.max((config.streamDepthLevels || 20) * 2, 1), 0, 1);
  const notionalCoverage = clamp(restDepthNotional / Math.max((config.universeMinDepthUsd || 30_000) * 4, 1), 0, 1);
  const recentTradeCoverage = clamp(Number(streamFeatures.recentTradeCount || 0) / 24, 0, 1);
  const fallbackDepthConfidence = clamp(
    0.16 + spreadQuality * 0.26 + levelCoverage * 0.22 + notionalCoverage * 0.18 + recentTradeCoverage * 0.18,
    0,
    0.88
  );
  const depthConfidence = localBookSynced
    ? Number(localBookSnapshot?.depthConfidence || 0)
    : fallbackDepthConfidence;
  const totalDepthNotional = localBookSynced
    ? Number(localBookSnapshot?.totalDepthNotional || restDepthNotional || 0)
    : restDepthNotional;
  const bookSource = localBookSynced
    ? "local_book"
    : restDepthNotional > 0
      ? "rest_book"
      : "ticker_only";
  const bookFallbackReady = !localBookSynced &&
    bookSource === "rest_book" &&
    depthConfidence >= 0.34 &&
    totalDepthNotional >= Math.max((config.universeMinDepthUsd || 30_000) * 0.8, 25_000) &&
    Number(book.spreadBps || 0) > 0 &&
    Number(book.spreadBps || 0) <= Math.max((config.maxSpreadBps || 25) * 0.7, 10);
  return {
    localBookSynced,
    depthConfidence,
    totalDepthNotional,
    bookSource,
    bookFallbackReady
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
    status: snapshot.status || "warmup",
    sampleSize: snapshot.sampleSize || 0,
    recentTradeCount: snapshot.recentTradeCount || 0,
    latestTradeAt: snapshot.latestTradeAt || null,
    freshnessHours: num(snapshot.freshnessHours || 0, 1),
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

function summarizeMissedTradeLearning(summary = {}) {
  const strictestBlocker = summary.blockerAttribution?.strictestBlocker || null;
  const topFailure = arr(summary.failureLibrary || [])[0] || null;
  const topMissedSetup = summary.reviewPacks?.topMissedSetup || null;
  const counterfactualTuning = summary.counterfactualTuning || {};
  const totalCounterfactuals = summary.counterfactuals?.total || 0;
  const missedWinners = summary.counterfactuals?.missedWinners || 0;
  const badVetoShare = totalCounterfactuals ? missedWinners / totalCounterfactuals : 0;
  const status = strictestBlocker?.badVetoRate >= 0.42 || badVetoShare >= 0.34
    ? "priority"
    : totalCounterfactuals >= 6 || strictestBlocker || topFailure
      ? "watch"
      : totalCounterfactuals > 0
        ? "observe"
        : "warmup";
  return {
    status,
    totalCounterfactuals,
    missedWinners,
    blockedCorrectly: summary.counterfactuals?.blockedCorrectly || 0,
    averageMissedMovePct: num(summary.counterfactuals?.averageMissedMovePct || strictestBlocker?.averageMovePct || 0, 4),
    topBlocker: strictestBlocker
      ? {
          id: strictestBlocker.id || null,
          badVetoRate: num(strictestBlocker.badVetoRate || 0, 4),
          governanceScore: num(strictestBlocker.governanceScore || 0, 4)
        }
      : null,
    tuning: {
      blocker: counterfactualTuning.blocker || null,
      action: counterfactualTuning.action || "observe",
      confidence: num(counterfactualTuning.confidence || 0, 4)
    },
    topMissedSetup,
    topFailure: topFailure
      ? {
          id: topFailure.id || null,
          count: topFailure.count || 0,
          status: topFailure.status || "observe"
        }
      : null,
    note: topMissedSetup
      ? `${topMissedSetup} is nu de duidelijkste gemiste setup om review op te doen.`
      : strictestBlocker?.id
        ? `${titleize(strictestBlocker.id)} lijkt nu de strengste gemiste-trade blocker.`
        : totalCounterfactuals
          ? "Counterfactual learning bouwt genoeg cases op om blokkades te vergelijken."
          : "Nog te weinig counterfactual cases voor een sterke missed-trade les."
  };
}

function summarizeExitIntelligenceDigest({
  positions = [],
  recentTrades = [],
  exitLearning = {}
} = {}) {
  const openSignals = positions
    .map((position) => ({
      symbol: position.symbol || null,
      action: position.latestExitIntelligence?.action || "hold",
      confidence: num(position.latestExitIntelligence?.confidence || 0, 4),
      reason: position.latestExitIntelligence?.reason || null,
      riskReasons: arr(position.latestExitIntelligence?.riskReasons || []).slice(0, 3),
      shouldTightenStop: Boolean(position.latestExitIntelligence?.shouldTightenStop)
    }))
    .filter((item) => item.symbol);
  const actionPriority = new Map([
    ["exit", 4],
    ["trim", 3],
    ["trail", 2],
    ["hold", 1]
  ]);
  const leadSignal = [...openSignals]
    .sort((left, right) => {
      const actionDelta = (actionPriority.get(right.action) || 0) - (actionPriority.get(left.action) || 0);
      return actionDelta !== 0 ? actionDelta : (right.confidence || 0) - (left.confidence || 0);
    })[0] || null;
  const exitCount = openSignals.filter((item) => item.action === "exit").length;
  const trimCount = openSignals.filter((item) => item.action === "trim").length;
  const trailCount = openSignals.filter((item) => item.action === "trail").length;
  const tightenCount = openSignals.filter((item) => item.shouldTightenStop).length;
  const recentExitActions = recentTrades
    .map((trade) => trade.exitIntelligenceSummary?.action || null)
    .filter(Boolean);
  const leadPolicy = positions.find((position) => position.latestExitPolicy)?.latestExitPolicy || {};
  const status = exitCount > 0
    ? "urgent"
    : trimCount > 0 || trailCount > 0 || (exitLearning.status === "watch" || exitLearning.status === "repair")
      ? "watch"
      : openSignals.length || recentExitActions.length || exitLearning.status === "stable"
        ? "stable"
        : "warmup";
  return {
    status,
    openPositionCount: openSignals.length,
    exitCount,
    trimCount,
    trailCount,
    tightenCount,
    recentExitCount: recentExitActions.filter((item) => item === "exit").length,
    averageConfidence: num(average(openSignals.map((item) => item.confidence || 0), 0), 4),
    leadSignal: leadSignal
      ? {
          symbol: leadSignal.symbol,
          action: leadSignal.action,
          confidence: num(leadSignal.confidence || 0, 4),
          reason: leadSignal.reason || null,
          riskReasons: arr(leadSignal.riskReasons || []).slice(0, 3)
        }
      : null,
    learning: {
      status: exitLearning.status || "warmup",
      topReason: exitLearning.topReason || null,
      prematureExitCount: exitLearning.prematureExitCount || 0,
      lateExitCount: exitLearning.lateExitCount || 0,
      averageExitScore: num(exitLearning.averageExitScore || 0, 4)
    },
    activePolicy: summarizeExitPolicyDigest(leadPolicy),
    note: leadSignal?.symbol
      ? `${leadSignal.symbol} vraagt nu exit focus via ${titleize(leadSignal.action)}.`
      : exitLearning.topReason
        ? `${titleize(exitLearning.topReason)} is nu het sterkste exit-learning patroon.`
        : openSignals.length
          ? "Open posities worden nu actief door exit-AI bewaakt."
          : "Nog geen open positie of duidelijke exit-learning focus zichtbaar."
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
    adaptiveSelection: {
      applied: Boolean(strategySummary.adaptiveSelection?.applied),
      changedActiveStrategy: Boolean(strategySummary.adaptiveSelection?.changedActiveStrategy),
      preferredStrategy: strategySummary.adaptiveSelection?.preferredStrategy || null,
      preferredFamily: strategySummary.adaptiveSelection?.preferredFamily || null,
      notes: arr(strategySummary.adaptiveSelection?.notes || []).slice(0, 3)
    },
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
      adaptiveBoost: num(strategy.adaptiveBoost || 0, 4),
      adaptiveConfidenceBoost: num(strategy.adaptiveConfidenceBoost || 0, 4),
      historicalTradeCount: strategy.historicalTradeCount || 0,
      historicalWinRate: strategy.historicalWinRate == null ? null : num(strategy.historicalWinRate, 4),
      adaptiveAllocation: summarizeStrategyAllocation(strategy.adaptiveAllocation || {}),
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
    status: optimizer.status || "warmup",
    sampleSize: optimizer.sampleSize || 0,
    recentTradeCount: optimizer.recentTradeCount || 0,
    latestTradeAt: optimizer.latestTradeAt || null,
    freshnessHours: num(optimizer.freshnessHours || 0, 1),
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
    regimeLatestTradeAt: portfolioSummary.regimeLatestTradeAt || null,
    regimeLastTradeAgeHours: Number.isFinite(portfolioSummary.regimeLastTradeAgeHours) ? num(portfolioSummary.regimeLastTradeAgeHours || 0, 1) : null,
    regimeKillSwitchActive: Boolean(portfolioSummary.regimeKillSwitchActive),
    regimeKillSwitchStale: Boolean(portfolioSummary.regimeKillSwitchStale),
    regimeKillSwitchSoftenedInPaper: Boolean(portfolioSummary.regimeKillSwitchSoftenedInPaper),
    clusterExposureSoftenedInPaper: Boolean(portfolioSummary.clusterExposureSoftenedInPaper),
    regimeExposureSoftenedInPaper: Boolean(portfolioSummary.regimeExposureSoftenedInPaper),
    selfPositionExcluded: Boolean(portfolioSummary.selfPositionExcluded),
    unknownClusterOverlapIgnored: Boolean(portfolioSummary.unknownClusterOverlapIgnored),
    unknownSectorOverlapIgnored: Boolean(portfolioSummary.unknownSectorOverlapIgnored),
    sameFactorCount: portfolioSummary.sameFactorCount || 0,
    candidateFactors: [...(portfolioSummary.candidateFactors || [])],
    reasons: [...(portfolioSummary.reasons || [])],
    hardReasons: [...(portfolioSummary.hardReasons || [])],
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
    strategyProfile: summary.strategyProfile || null,
    triggerConfirmed: Boolean(summary.triggerConfirmed),
    lowerDirectionalThreshold: num(summary.lowerDirectionalThreshold || 0, 4),
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
      group: item.group || "news",
      score: num(item.score || 0, 4),
      coolingDown: Boolean(item.coolingDown),
      recentFailures: item.recentFailures || 0,
      lastError: item.lastError || null
    })),
    externalFeeds: summary.externalFeeds ? {
      providerCount: summary.externalFeeds.providerCount || 0,
      averageScore: num(summary.externalFeeds.averageScore || 0, 4),
      degradedCount: summary.externalFeeds.degradedCount || 0,
      coolingDownCount: summary.externalFeeds.coolingDownCount || 0,
      providers: arr(summary.externalFeeds.providers || []).slice(0, 8).map((item) => ({
        provider: item.provider || null,
        group: item.group || "external",
        score: num(item.score || 0, 4),
        coolingDown: Boolean(item.coolingDown),
        recentFailures: item.recentFailures || 0,
        lastError: item.lastError || null
      })),
      notes: [...(summary.externalFeeds.notes || [])]
    } : null,
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
    historyCoverage: {
      status: summary.historyCoverage?.status || "unknown",
      symbolCount: summary.historyCoverage?.symbolCount || 0,
      coveredSymbolCount: summary.historyCoverage?.coveredSymbolCount || 0,
      staleSymbolCount: summary.historyCoverage?.staleSymbolCount || 0,
      gapSymbolCount: summary.historyCoverage?.gapSymbolCount || 0,
      uncoveredSymbolCount: summary.historyCoverage?.uncoveredSymbolCount || 0,
      partitionedSymbolCount: summary.historyCoverage?.partitionedSymbolCount || 0,
      notes: arr(summary.historyCoverage?.notes || []).slice(0, 4)
    },
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
    conditionScorecards: arr(summary.conditionScorecards || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      tradeCount: item.tradeCount || 0,
      winRate: num(item.winRate || 0, 4),
      realizedPnl: num(item.realizedPnl || 0, 2),
      governanceScore: num(item.governanceScore || 0, 4),
      status: item.status || "warmup"
    })),
    conditionStrategyScorecards: arr(summary.conditionStrategyScorecards || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      conditionId: item.conditionId || null,
      strategyId: item.strategyId || null,
      familyId: item.familyId || null,
      tradeCount: item.tradeCount || 0,
      governanceScore: num(item.governanceScore || 0, 4),
      falseNegativeRate: num(item.falseNegativeRate || 0, 4),
      falsePositiveRate: num(item.falsePositiveRate || 0, 4),
      status: item.status || "warmup"
    })),
    conditionFamilyScorecards: arr(summary.conditionFamilyScorecards || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      conditionId: item.conditionId || null,
      familyId: item.familyId || null,
      tradeCount: item.tradeCount || 0,
      governanceScore: num(item.governanceScore || 0, 4),
      falseNegativeRate: num(item.falseNegativeRate || 0, 4),
      falsePositiveRate: num(item.falsePositiveRate || 0, 4),
      status: item.status || "warmup"
    })),
    conditionSessionFamilyScorecards: arr(summary.conditionSessionFamilyScorecards || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      conditionId: item.conditionId || null,
      sessionId: item.sessionId || null,
      familyId: item.familyId || null,
      tradeCount: item.tradeCount || 0,
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
    blockerConditionScorecards: arr(summary.blockerConditionScorecards || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      conditionId: item.conditionId || null,
      familyId: item.familyId || null,
      strategyId: item.strategyId || null,
      count: item.count || 0,
      action: item.action || "observe",
      confidence: num(item.confidence || 0, 4),
      thresholdShift: num(item.thresholdShift || 0, 4),
      missedWinnerRate: num(item.missedWinnerRate || 0, 4),
      goodVetoRate: num(item.goodVetoRate || 0, 4)
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
    missedTradeTuning: summarizeMissedTradeTuning(summary.missedTradeTuning || {}),
    outcomeScopeLearning: summarizeOutcomeScopeLearning(summary.outcomeScopeScorecards || {}),
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
      conditionPolicies: arr(summary.exitLearning?.conditionPolicies || []).slice(0, 6).map((item) => ({
        id: item.id || null,
        conditionId: item.conditionId || null,
        familyId: item.familyId || null,
        tradeCount: item.tradeCount || 0,
        status: item.status || "balanced",
        preferredExitStyle: item.preferredExitStyle || "balanced",
        trailTightnessBias: num(item.trailTightnessBias || 0, 4),
        trimBias: num(item.trimBias || 0, 4),
        holdTolerance: num(item.holdTolerance || 0, 4),
        maxHoldBias: num(item.maxHoldBias || 0, 4)
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
    exitConditionScorecards: arr(summary.exitConditionScorecards || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      conditionId: item.conditionId || null,
      familyId: item.familyId || null,
      tradeCount: item.tradeCount || 0,
      preferredExitStyle: item.preferredExitStyle || "balanced",
      trailTightnessBias: num(item.trailTightnessBias || 0, 4),
      trimBias: num(item.trimBias || 0, 4),
      holdTolerance: num(item.holdTolerance || 0, 4),
      maxHoldBias: num(item.maxHoldBias || 0, 4)
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
    featureGovernance: {
      status: summary.featureGovernance?.status || "warmup",
      attribution: {
        trackedFeatureCount: summary.featureGovernance?.attribution?.trackedFeatureCount || 0,
        topPositive: arr(summary.featureGovernance?.attribution?.topPositive || []).slice(0, 6).map((item) => ({
          id: item.id || null,
          group: item.group || "context",
          tier: item.tier || "atomic",
          tradeCount: item.tradeCount || 0,
          signedEdge: num(item.signedEdge || 0, 4),
          predictiveScore: num(item.predictiveScore || 0, 4),
          influenceScore: num(item.influenceScore || 0, 4),
          status: item.status || null
        })),
        topNegative: arr(summary.featureGovernance?.attribution?.topNegative || []).slice(0, 6).map((item) => ({
          id: item.id || null,
          group: item.group || "context",
          tier: item.tier || "atomic",
          tradeCount: item.tradeCount || 0,
          signedEdge: num(item.signedEdge || 0, 4),
          predictiveScore: num(item.predictiveScore || 0, 4),
          influenceScore: num(item.influenceScore || 0, 4),
          status: item.status || null
        }))
      },
      parityAudit: {
        status: summary.featureGovernance?.parityAudit?.status || "warmup",
        trackedFeatureCount: summary.featureGovernance?.parityAudit?.trackedFeatureCount || 0,
        alignedCount: summary.featureGovernance?.parityAudit?.alignedCount || 0,
        watchCount: summary.featureGovernance?.parityAudit?.watchCount || 0,
        misalignedCount: summary.featureGovernance?.parityAudit?.misalignedCount || 0,
        missingInLive: [...(summary.featureGovernance?.parityAudit?.missingInLive || [])].slice(0, 8),
        details: arr(summary.featureGovernance?.parityAudit?.details || []).slice(0, 8).map((item) => ({
          id: item.id || null,
          status: item.status || "aligned",
          paperCoverage: num(item.paperCoverage || 0, 4),
          liveCoverage: num(item.liveCoverage || 0, 4),
          coverageGap: num(item.coverageGap || 0, 4),
          predictiveScore: num(item.predictiveScore || 0, 4)
        }))
      },
      pruning: {
        status: summary.featureGovernance?.pruning?.status || "warmup",
        activeFeatures: [...(summary.featureGovernance?.pruning?.activeFeatures || [])].slice(0, 8),
        shadowFeatures: [...(summary.featureGovernance?.pruning?.shadowFeatures || [])].slice(0, 8),
        guardOnlyFeatures: [...(summary.featureGovernance?.pruning?.guardOnlyFeatures || [])].slice(0, 8),
        dropCandidates: [...(summary.featureGovernance?.pruning?.dropCandidates || [])].slice(0, 8),
        recommendations: arr(summary.featureGovernance?.pruning?.recommendations || []).slice(0, 8).map((item) => ({
          id: item.id || null,
          action: item.action || "observe_only",
          status: item.status || "shadow",
          group: item.group || "context",
          tier: item.tier || "atomic",
          predictiveScore: num(item.predictiveScore || 0, 4),
          influenceScore: num(item.influenceScore || 0, 4),
          parityStatus: item.parityStatus || "aligned",
          redundancyScore: num(item.redundancyScore || 0, 4),
          rationale: item.rationale || null
        }))
      },
      guardEffectiveness: {
        status: summary.featureGovernance?.guardEffectiveness?.status || "warmup",
        topReliableGuard: summary.featureGovernance?.guardEffectiveness?.topReliableGuard || null,
        topRetuneGuard: summary.featureGovernance?.guardEffectiveness?.topRetuneGuard || null,
        scorecards: arr(summary.featureGovernance?.guardEffectiveness?.scorecards || []).slice(0, 8).map((item) => ({
          id: item.id || null,
          total: item.total || 0,
          goodVetoCount: item.goodVetoCount || 0,
          badVetoCount: item.badVetoCount || 0,
          lateVetoCount: item.lateVetoCount || 0,
          timingIssueCount: item.timingIssueCount || 0,
          precision: num(item.precision || 0, 4),
          missRate: num(item.missRate || 0, 4),
          governanceScore: num(item.governanceScore || 0, 4),
          status: item.status || "watch"
        }))
      },
      notes: [...(summary.featureGovernance?.notes || [])]
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
        freshnessScore: num(summary.retrainReadiness.paper.freshnessScore || 0, 4),
        latestTradeAt: summary.retrainReadiness.paper.latestTradeAt || null,
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
        freshnessScore: num(summary.retrainReadiness.live.freshnessScore || 0, 4),
        latestTradeAt: summary.retrainReadiness.live.latestTradeAt || null,
        recommendation: summary.retrainReadiness.live.recommendation || null
      } : null
    } : null,
    retrainFocusPlan: summary.retrainFocusPlan ? {
      status: summary.retrainFocusPlan.status || "warmup",
      readyScopes: summary.retrainFocusPlan.readyScopes || 0,
      buildingScopes: summary.retrainFocusPlan.buildingScopes || 0,
      warmupScopes: summary.retrainFocusPlan.warmupScopes || 0,
      nextAction: summary.retrainFocusPlan.nextAction || null,
      note: summary.retrainFocusPlan.note || null,
      topScope: summary.retrainFocusPlan.topScope ? {
        id: summary.retrainFocusPlan.topScope.id || null,
        type: summary.retrainFocusPlan.topScope.type || null,
        status: summary.retrainFocusPlan.topScope.status || "warmup",
        score: num(summary.retrainFocusPlan.topScope.score || 0, 4)
      } : null,
      weakestScope: summary.retrainFocusPlan.weakestScope ? {
        id: summary.retrainFocusPlan.weakestScope.id || null,
        type: summary.retrainFocusPlan.weakestScope.type || null,
        status: summary.retrainFocusPlan.weakestScope.status || "warmup",
        score: num(summary.retrainFocusPlan.weakestScope.score || 0, 4)
      } : null
    } : null,
    retrainExecutionPlan: summary.retrainExecutionPlan ? {
      status: summary.retrainExecutionPlan.status || "warmup",
      cadence: summary.retrainExecutionPlan.cadence || null,
      batchType: summary.retrainExecutionPlan.batchType || null,
      operatorAction: summary.retrainExecutionPlan.operatorAction || null,
      gatingReasons: [...(summary.retrainExecutionPlan.gatingReasons || [])],
      selectedScopes: arr(summary.retrainExecutionPlan.selectedScopes || []).slice(0, 4).map((item) => ({
        id: item.id || null,
        type: item.type || null,
        status: item.status || "warmup",
        score: num(item.score || 0, 4),
        paperCount: item.paperCount || 0,
        liveCount: item.liveCount || 0
      })),
      probationScopes: arr(summary.retrainExecutionPlan.probationScopes || []).slice(0, 4).map((item) => ({
        id: item.id || null,
        type: item.type || null,
        status: item.status || "warmup",
        score: num(item.score || 0, 4)
      })),
      rollbackWatchScopes: arr(summary.retrainExecutionPlan.rollbackWatchScopes || []).slice(0, 4).map((item) => ({
        id: item.id || null,
        type: item.type || null,
        score: num(item.score || 0, 4),
        avgPnlPct: num(item.avgPnlPct || 0, 4),
        liveCount: item.liveCount || 0
      })),
      notes: [...(summary.retrainExecutionPlan.notes || [])]
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
      freshnessScore: num(item.freshnessScore || 0, 4),
      latestTradeAt: item.latestTradeAt || null,
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
    policyTransitionCandidatesByCondition: arr(summary.policyTransitionCandidatesByCondition || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      conditionId: item.conditionId || null,
      strategyId: item.strategyId || null,
      familyId: item.familyId || null,
      action: item.action || "observe",
      confidence: num(item.confidence || 0, 4),
      conditionCount: item.conditionCount || 0,
      stableConditionCount: item.stableConditionCount || 0,
      weakConditionCount: item.weakConditionCount || 0,
      scope: item.scope || null,
      reason: item.reason || null
    })),
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
    averageActiveLearningScore: num(summary.averageActiveLearningScore || 0, 4),
    recencyFreshnessScore: num(summary.recencyFreshnessScore || 0, 4),
    blockerGroups: Object.fromEntries(Object.entries(summary.blockerGroups || {}).map(([key, value]) => [key, value || 0])),
    scopeReadiness: arr(summary.scopeReadiness || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      type: item.type || null,
      count: item.count || 0,
      readinessScore: num(item.readinessScore || 0, 4),
      status: item.status || "warmup",
      goodRate: num(item.goodRate || 0, 4),
      weakRate: num(item.weakRate || 0, 4),
      source: item.source || "probe_trades",
      latestObservedAt: item.latestObservedAt || null
    })),
    inputHealth: summary.inputHealth ? {
      status: summary.inputHealth.status || "fresh",
      staleClosedLearning: Boolean(summary.inputHealth.staleClosedLearning),
      latestClosedLearningAt: summary.inputHealth.latestClosedLearningAt || null,
      latestProbeClosedAt: summary.inputHealth.latestProbeClosedAt || null,
      latestLiveClosedAt: summary.inputHealth.latestLiveClosedAt || null,
      latestShadowReviewAt: summary.inputHealth.latestShadowReviewAt || null,
      latestScopeSource: summary.inputHealth.latestScopeSource || null,
      closedLearningAgeHours: num(summary.inputHealth.closedLearningAgeHours || 0, 1),
      shadowReviewAgeHours: num(summary.inputHealth.shadowReviewAgeHours || 0, 1),
      note: summary.inputHealth.note || null
    } : null,
    thresholdSandbox: summary.thresholdSandbox ? {
      status: summary.thresholdSandbox.status || "observe",
      scopeLabel: summary.thresholdSandbox.scopeLabel || null,
      thresholdShift: num(summary.thresholdSandbox.thresholdShift || 0, 4),
      sampleSize: summary.thresholdSandbox.sampleSize || 0
    } : null,
    reviewPacks: summary.reviewPacks ? {
      bestProbeWinner: summary.reviewPacks.bestProbeWinner || null,
      weakestProbe: summary.reviewPacks.weakestProbe || null,
      topMissedSetup: summary.reviewPacks.topMissedSetup || null,
      topExecutionDrag: summary.reviewPacks.topExecutionDrag || null,
      topQualityTrap: summary.reviewPacks.topQualityTrap || null,
      topProbationRisk: summary.reviewPacks.topProbationRisk || null
    } : null,
    recentProbeReviews: arr(summary.recentProbeReviews || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      symbol: item.symbol || null,
      outcome: item.outcome || "neutral",
      reason: item.reason || null,
      pnlQuote: num(item.pnlQuote || 0, 2),
      netPnlPct: num(item.netPnlPct || 0, 4),
      learningLane: item.learningLane || "safe",
      closedAt: item.closedAt || null,
      lesson: item.lesson || null
    })),
    recentShadowReviews: arr(summary.recentShadowReviews || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      symbol: item.symbol || null,
      outcome: item.outcome || "neutral",
      blocker: item.blocker || null,
      realizedMovePct: num(item.realizedMovePct || 0, 4),
      resolvedAt: item.resolvedAt || null,
      bestBranch: item.bestBranch ? {
        id: item.bestBranch.id || null,
        outcome: item.bestBranch.outcome || null,
        adjustedMovePct: num(item.bestBranch.adjustedMovePct || 0, 4)
      } : null,
      lesson: item.lesson || null
    })),
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
    activeLearning: summary.activeLearning ? {
      status: summary.activeLearning.status || "observe",
      score: num(summary.activeLearning.score || 0, 4),
      focusReason: summary.activeLearning.focusReason || null,
      focusScopes: arr(summary.activeLearning.focusScopes || []).slice(0, 4).map((item) => ({
        id: item.id || null,
        count: item.count || 0,
        score: num(item.score || 0, 4),
        topReason: item.topReason || null
      })),
      topCandidates: arr(summary.activeLearning.topCandidates || []).slice(0, 4).map((item) => ({
        symbol: item.symbol || null,
        score: num(item.score || 0, 4),
        reason: item.reason || null,
        noveltyScore: num(item.noveltyScore || 0, 4),
        rarityScore: num(item.rarityScore || 0, 4),
        disagreementScore: num(item.disagreementScore || 0, 4),
        uncertaintyScore: num(item.uncertaintyScore || 0, 4),
        priorityBand: item.priorityBand || "observe",
        scopeLabel: item.scopeLabel || null
      })),
      note: summary.activeLearning.note || null
    } : null,
    experimentScopes: arr(summary.experimentScopes || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      source: item.source || null,
      score: num(item.score || 0, 4),
      status: item.status || "observe",
      action: item.action || "observe",
      reason: item.reason || null
    })),
    scopeCoaching: summary.scopeCoaching ? {
      strongest: summary.scopeCoaching.strongest ? {
        id: summary.scopeCoaching.strongest.id || null,
        status: summary.scopeCoaching.strongest.status || "warmup",
        score: num(summary.scopeCoaching.strongest.score || 0, 4),
        action: summary.scopeCoaching.strongest.action || "observe",
        source: summary.scopeCoaching.strongest.source || "probe_trades"
      } : null,
      weakest: summary.scopeCoaching.weakest ? {
        id: summary.scopeCoaching.weakest.id || null,
        status: summary.scopeCoaching.weakest.status || "warmup",
        score: num(summary.scopeCoaching.weakest.score || 0, 4),
        action: summary.scopeCoaching.weakest.action || "observe",
        source: summary.scopeCoaching.weakest.source || "probe_trades"
      } : null,
      note: summary.scopeCoaching.note || null
    } : null,
    benchmarkLanes: summary.benchmarkLanes ? {
      actualProbeWinRate: num(summary.benchmarkLanes.actualProbeWinRate || 0, 4),
      actualProbeAvgPnlPct: num(summary.benchmarkLanes.actualProbeAvgPnlPct || 0, 4),
      safeLaneWinRate: num(summary.benchmarkLanes.safeLaneWinRate || 0, 4),
      shadowTakeWinRate: num(summary.benchmarkLanes.shadowTakeWinRate || 0, 4),
      shadowSkipWinRate: num(summary.benchmarkLanes.shadowSkipWinRate || 0, 4),
      alwaysTakeWinRate: num(summary.benchmarkLanes.alwaysTakeWinRate || 0, 4),
      alwaysSkipWinRate: num(summary.benchmarkLanes.alwaysSkipWinRate || 0, 4),
      fixedThresholdWinRate: num(summary.benchmarkLanes.fixedThresholdWinRate || 0, 4),
      simpleExitWinRate: num(summary.benchmarkLanes.simpleExitWinRate || 0, 4),
      rankedLanes: arr(summary.benchmarkLanes.rankedLanes || []).slice(0, 7).map((item) => ({
        id: item.id || null,
        score: num(item.score || 0, 4),
        deltaVsProbe: num(item.deltaVsProbe || 0, 4)
      })),
      bestLane: summary.benchmarkLanes.bestLane || null,
      note: summary.benchmarkLanes.note || null
    } : null,
    miscalibration: summary.miscalibration ? {
      status: summary.miscalibration.status || "observe",
      averageAbsoluteError: num(summary.miscalibration.averageAbsoluteError || 0, 4),
      overconfidentCount: summary.miscalibration.overconfidentCount || 0,
      underconfidentCount: summary.miscalibration.underconfidentCount || 0,
      topIssue: summary.miscalibration.topIssue || null,
      note: summary.miscalibration.note || null
    } : null,
    failureLibrary: arr(summary.failureLibrary || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      count: item.count || 0,
      status: item.status || "observe",
      note: item.note || null
    })),
    coaching: summary.coaching ? {
      whatWorked: summary.coaching.whatWorked || null,
      tooStrict: summary.coaching.tooStrict || null,
      tooLoose: summary.coaching.tooLoose || null,
      nextReview: summary.coaching.nextReview || null
    } : null,
    blockerAttribution: summary.blockerAttribution ? {
      status: summary.blockerAttribution.status || "observe",
      dominantBlocker: summary.blockerAttribution.dominantBlocker || null,
      strictestBlocker: summary.blockerAttribution.strictestBlocker ? {
        id: summary.blockerAttribution.strictestBlocker.id || null,
        badVetoRate: num(summary.blockerAttribution.strictestBlocker.badVetoRate || 0, 4),
        governanceScore: num(summary.blockerAttribution.strictestBlocker.governanceScore || 0, 4),
        affectedStrategies: arr(summary.blockerAttribution.strictestBlocker.affectedStrategies || []).slice(0, 3),
        affectedRegimes: arr(summary.blockerAttribution.strictestBlocker.affectedRegimes || []).slice(0, 3)
      } : null,
      safestBlocker: summary.blockerAttribution.safestBlocker ? {
        id: summary.blockerAttribution.safestBlocker.id || null,
        goodVetoRate: num(summary.blockerAttribution.safestBlocker.goodVetoRate || 0, 4),
        governanceScore: num(summary.blockerAttribution.safestBlocker.governanceScore || 0, 4)
      } : null,
      nextAction: summary.blockerAttribution.nextAction || "observe",
      note: summary.blockerAttribution.note || null
    } : null,
    challengerPolicy: summary.challengerPolicy ? {
      status: summary.challengerPolicy.status || "observe",
      leadingLane: summary.challengerPolicy.leadingLane || null,
      challengerEdge: num(summary.challengerPolicy.challengerEdge || 0, 4),
      targetScope: summary.challengerPolicy.targetScope || null,
      recommendation: summary.challengerPolicy.recommendation || "observe",
      note: summary.challengerPolicy.note || null
    } : null,
    challengerScorecards: arr(summary.challengerScorecards || []).slice(0, 6).map((item) => ({
      id: item.id || null,
      sampleCount: item.sampleCount || 0,
      winRate: num(item.winRate || 0, 4),
      avgPnlPct: num(item.avgPnlPct || 0, 4),
      score: num(item.score || 0, 4),
      edgeVsProbe: num(item.edgeVsProbe || 0, 4),
      status: item.status || "observe",
      source: item.source || "observed",
      scope: item.scope || null
    })),
    abExperiments: arr(summary.abExperiments || []).slice(0, 5).map((item) => ({
      id: item.id || null,
      type: item.type || null,
      baseline: item.baseline || null,
      challenger: item.challenger || null,
      baselineScore: num(item.baselineScore || 0, 4),
      challengerScore: num(item.challengerScore || 0, 4),
      deltaScore: num(item.deltaScore || 0, 4),
      winner: item.winner || null,
      recommendation: item.recommendation || "observe",
      note: item.note || null
    })),
    promotionRoadmap: summary.promotionRoadmap ? {
      status: summary.promotionRoadmap.status || "blocked",
      allowPromotion: Boolean(summary.promotionRoadmap.allowPromotion),
      readyLevel: summary.promotionRoadmap.readyLevel || null,
      blockerReasons: arr(summary.promotionRoadmap.blockerReasons || []).slice(0, 4),
      nextGate: summary.promotionRoadmap.nextGate || null,
      promotionHint: summary.promotionRoadmap.promotionHint ? {
        symbol: summary.promotionRoadmap.promotionHint.symbol || null,
        governanceScore: num(summary.promotionRoadmap.promotionHint.governanceScore || 0, 4),
        status: summary.promotionRoadmap.promotionHint.status || "observe"
      } : null,
      note: summary.promotionRoadmap.note || null
    } : null,
    executionInsights: summary.executionInsights ? {
      status: summary.executionInsights.status || "watch",
      averageSetupScore: num(summary.executionInsights.averageSetupScore || 0, 4),
      averageExecutionScore: num(summary.executionInsights.averageExecutionScore || 0, 4),
      averageOutcomeScore: num(summary.executionInsights.averageOutcomeScore || 0, 4),
      executionDragCount: summary.executionInsights.executionDragCount || 0,
      setupDragCount: summary.executionInsights.setupDragCount || 0,
      followThroughDragCount: summary.executionInsights.followThroughDragCount || 0,
      averageSlippageDeltaBps: num(summary.executionInsights.averageSlippageDeltaBps || 0, 4),
      averageLatencyBps: num(summary.executionInsights.averageLatencyBps || 0, 4),
      bestExecutionStyle: summary.executionInsights.bestExecutionStyle ? {
        id: summary.executionInsights.bestExecutionStyle.id || null,
        realizedPnl: num(summary.executionInsights.bestExecutionStyle.realizedPnl || 0, 2),
        winRate: num(summary.executionInsights.bestExecutionStyle.winRate || 0, 4)
      } : null,
      weakestExecutionStyle: summary.executionInsights.weakestExecutionStyle ? {
        id: summary.executionInsights.weakestExecutionStyle.id || null,
        realizedPnl: num(summary.executionInsights.weakestExecutionStyle.realizedPnl || 0, 2),
        winRate: num(summary.executionInsights.weakestExecutionStyle.winRate || 0, 4)
      } : null,
      note: summary.executionInsights.note || null
    } : null,
    policyTransitions: summary.policyTransitions ? {
      status: summary.policyTransitions.status || "observe",
      autoApplyEnabled: Boolean(summary.policyTransitions.autoApplyEnabled),
      candidates: arr(summary.policyTransitions.candidates || []).slice(0, 6).map((item) => ({
        id: item.id || null,
        type: item.type || null,
        action: item.action || "observe",
        confidence: num(item.confidence || 0, 4),
        scope: item.scope || null,
        reason: item.reason || null,
        blocker: item.blocker || null,
        source: item.source || null,
        allocatorMode: item.allocatorMode || null,
        preferredStrategy: item.preferredStrategy || null,
        approved: Boolean(item.approved)
      })),
      note: summary.policyTransitions.note || null
    } : null,
    operatorGuardrails: summary.operatorGuardrails ? {
      status: summary.operatorGuardrails.status || "observe",
      requireManualApproval: Boolean(summary.operatorGuardrails.requireManualApproval),
      blockedBy: arr(summary.operatorGuardrails.blockedBy || []).slice(0, 4),
      safeAutoActions: arr(summary.operatorGuardrails.safeAutoActions || []).slice(0, 4),
      note: summary.operatorGuardrails.note || null
    } : null,
    operatorActions: summary.operatorActions ? {
      status: summary.operatorActions.status || "idle",
      activeOverrides: arr(summary.operatorActions.activeOverrides || []).slice(0, 6).map((item) => ({
        id: item.id || null,
        status: item.status || null,
        note: item.note || null,
        approvedAt: item.approvedAt || null
      })),
      history: arr(summary.operatorActions.history || []).slice(0, 10).map((item) => ({
        id: item.id || null,
        action: item.action || null,
        note: item.note || null,
        at: item.at || null,
        scope: item.scope || null,
        status: item.status || null
      })),
      note: summary.operatorActions.note || null
    } : null,
    reviewQueue: arr(summary.reviewQueue || []).slice(0, 4).map((item) => ({
      type: item.type || null,
      id: item.id || null,
      priority: item.priority || "normal",
      note: item.note || null
    })),
    counterfactualBranches: summary.counterfactualBranches ? {
      topBranch: summary.counterfactualBranches.topBranch || null,
      branchCount: summary.counterfactualBranches.branchCount || 0,
      note: summary.counterfactualBranches.note || null
    } : null,
    primaryScope: summary.primaryScope ? {
      id: summary.primaryScope.id || null,
      type: summary.primaryScope.type || null,
      status: summary.primaryScope.status || "warmup",
      score: num(summary.primaryScope.score || 0, 4),
      source: summary.primaryScope.source || "probe_trades"
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
      executionDragCount: summary.probation.executionDragCount || 0,
      qualityTrapCount: summary.probation.qualityTrapCount || 0,
      weakSetupCount: summary.probation.weakSetupCount || 0,
      followThroughFailedCount: summary.probation.followThroughFailedCount || 0,
      dominantWeakness: summary.probation.dominantWeakness || null,
      note: summary.probation.note || null
    } : null,
    notes: arr(summary.notes || []).slice(0, 6)
  };
}

function summarizePaperLearningGuidance(guidance = {}) {
  return {
    active: Boolean(guidance.active),
    sourceStatus: guidance.sourceStatus || "warmup",
    preferredLane: guidance.preferredLane || null,
    guidanceStrength: num(guidance.guidanceStrength || 0, 4),
    priorityBoost: num(guidance.priorityBoost || 0, 4),
    probeBoost: num(guidance.probeBoost || 0, 4),
    shadowBoost: num(guidance.shadowBoost || 0, 4),
    cautionPenalty: num(guidance.cautionPenalty || 0, 4),
    focusReason: guidance.focusReason || null,
    benchmarkLead: guidance.benchmarkLead || null,
    challengerRecommendation: guidance.challengerRecommendation || null,
    targetScope: guidance.targetScope || null,
    targetScopeMatched: Boolean(guidance.targetScopeMatched),
    focusCandidateSymbol: guidance.focusCandidateSymbol || null,
    matchedScopes: arr(guidance.matchedScopes || []).slice(0, 3).map((item) => ({
      id: item.id || null,
      type: item.type || null,
      status: item.status || "warmup",
      readinessScore: num(item.readinessScore || 0, 4),
      matchScore: num(item.matchScore || 0, 4)
    })),
    note: guidance.note || null
  };
}

function summarizeOfflineLearningGuidance(guidance = {}) {
  return {
    active: Boolean(guidance.active),
    sourceStatus: guidance.sourceStatus || "warmup",
    thresholdShift: num(guidance.thresholdShift || 0, 4),
    sizeMultiplier: num(guidance.sizeMultiplier || 1, 4),
    cautionPenalty: num(guidance.cautionPenalty || 0, 4),
    confidence: num(guidance.confidence || 0, 4),
    featurePenalty: num(guidance.featurePenalty || 0, 4),
    featureTrustPenalty: num(guidance.featureTrustPenalty || 0, 4),
    adjacentScopePressure: num(guidance.adjacentScopePressure || 0, 4),
    independentWeakGroupPressure: num(guidance.independentWeakGroupPressure || 0, 4),
    correlatedWeakFeaturePressure: num(guidance.correlatedWeakFeaturePressure || 0, 4),
    adjacentFeaturePressure: num(guidance.adjacentFeaturePressure || 0, 4),
    executionCaution: num(guidance.executionCaution || 0, 4),
    executionCostBufferBps: num(guidance.executionCostBufferBps || 0, 2),
    benchmarkLead: guidance.benchmarkLead || null,
    focusReason: guidance.focusReason || null,
    impactedFeatures: [...(guidance.impactedFeatures || [])].slice(0, 6),
    featurePressureSources: [...(guidance.featurePressureSources || [])].slice(0, 4).map((item) => ({
      source: item.source || null,
      featureCount: item.featureCount || 0,
      penalty: num(item.penalty || 0, 4)
    })),
    impactedFeatureGroups: arr(guidance.impactedFeatureGroups || []).slice(0, 4).map((item) => ({
      group: item.group || "context",
      featureCount: item.featureCount || 0,
      sourceCount: item.sourceCount || 0,
      penalty: num(item.penalty || 0, 4),
      topFeatures: [...(item.topFeatures || [])].slice(0, 3),
      sourceTypes: [...(item.sourceTypes || [])].slice(0, 3)
    })),
    matchedOutcomeScopes: arr(guidance.matchedOutcomeScopes || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      scopeType: item.scopeType || null,
      status: item.status || "observe",
      confidence: num(item.confidence || 0, 4),
      thresholdShift: num(item.thresholdShift || 0, 4),
      sizeMultiplier: num(item.sizeMultiplier || 1, 4),
      cautionPenalty: num(item.cautionPenalty || 0, 4),
      note: item.note || null
    })),
    note: guidance.note || null
  };
}

function inferFeatureGovernanceGroup(name = "") {
  if (name.includes("execution") || name.includes("book_") || name.includes("queue_") || name.includes("spread") || name.includes("depth_") || name.includes("microprice")) {
    return "execution";
  }
  if (name.includes("vol") || name.includes("atr") || name.includes("squeeze")) {
    return "volatility";
  }
  if (name.includes("volume") || name === "cmf" || name === "mfi_centered" || name === "obv_slope") {
    return "volume";
  }
  if (name.includes("regime_")) {
    return "regime";
  }
  if (name.includes("structure") || name.includes("vwap") || name.includes("liquidity_sweep") || name.includes("trend_failure")) {
    return "market_structure";
  }
  if (name.includes("momentum") || name.includes("rsi") || name.includes("stoch") || name.includes("macd")) {
    return "momentum";
  }
  if (name.includes("trend") || name.includes("ema") || name.includes("adx") || name.includes("dmi") || name.includes("supertrend")) {
    return "trend";
  }
  if (name.includes("risk") || name.includes("calendar") || name.includes("pair_") || name.includes("portfolio_")) {
    return "risk";
  }
  return "context";
}

function summarizeLowConfidencePressure(pressure = {}) {
  return {
    active: Boolean(pressure.active),
    primaryDriver: pressure.primaryDriver || null,
    edgeToThreshold: num(pressure.edgeToThreshold || 0, 4),
    edgeToBaseThreshold: num(pressure.edgeToBaseThreshold || 0, 4),
    thresholdPenaltyPressure: num(pressure.thresholdPenaltyPressure || 0, 4),
    thresholdRelief: num(pressure.thresholdRelief || 0, 4),
    calibrationWarmup: num(pressure.calibrationWarmup || 0, 4),
    calibrationWarmupGap: num(pressure.calibrationWarmupGap || 0, 4),
    calibrationConfidenceGap: num(pressure.calibrationConfidenceGap || 0, 4),
    disagreementPressure: num(pressure.disagreementPressure || 0, 4),
    blendDrag: num(pressure.blendDrag || 0, 4),
    challengerNeutralDrag: num(pressure.challengerNeutralDrag || 0, 4),
    transformerNeutralDrag: num(pressure.transformerNeutralDrag || 0, 4),
    sequenceNeutralDrag: num(pressure.sequenceNeutralDrag || 0, 4),
    dominantBlendDragSource: pressure.dominantBlendDragSource || null,
    modelConfidenceGap: num(pressure.modelConfidenceGap || 0, 4),
    dataConfidenceGap: num(pressure.dataConfidenceGap || 0, 4),
    executionConfidenceGap: num(pressure.executionConfidenceGap || 0, 4),
    featureTrustPenalty: num(pressure.featureTrustPenalty || 0, 4),
    dominantFeaturePressureSource: pressure.dominantFeaturePressureSource || null,
    dominantFeaturePressureGroup: pressure.dominantFeaturePressureGroup || null,
    independentWeakGroupCount: pressure.independentWeakGroupCount || 0,
    featureTrustNarrowPressure: Boolean(pressure.featureTrustNarrowPressure),
    executionCaution: num(pressure.executionCaution || 0, 4),
    signalQuality: num(pressure.signalQuality || 0, 4),
    dataQuality: num(pressure.dataQuality || 0, 4),
    reliefEligible: Boolean(pressure.reliefEligible),
    note: pressure.note || null
  };
}

function summarizeLowConfidenceAudit(summary = {}) {
  return {
    status: summary.status || "quiet",
    nearMissCount: summary.nearMissCount || 0,
    candidateCount: summary.candidateCount || 0,
    dominantDriver: summary.dominantDriver || null,
    averageEdgeToThreshold: num(summary.averageEdgeToThreshold || 0, 4),
    averageCalibrationWarmup: num(summary.averageCalibrationWarmup || 0, 4),
    averageThresholdPenaltyPressure: num(summary.averageThresholdPenaltyPressure || 0, 4),
    averageFeatureTrustPenalty: num(summary.averageFeatureTrustPenalty || 0, 4),
    averageExecutionCaution: num(summary.averageExecutionCaution || 0, 4),
    topDrivers: arr(summary.topDrivers || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      count: item.count || 0
    })),
    topFeatures: arr(summary.topFeatures || []).slice(0, 5).map((item) => ({
      id: item.id || null,
      count: item.count || 0
    })),
    examples: arr(summary.examples || []).slice(0, 4).map((item) => ({
      symbol: item.symbol || null,
      strategy: item.strategy || null,
      edgeToThreshold: num(item.edgeToThreshold || 0, 4),
      primaryDriver: item.primaryDriver || null
    })),
    note: summary.note || null
  };
}

function summarizeOutcomeScopeLearning(summary = {}) {
  const topActionable = summary.topActionable || null;
  const mapScope = (item) => ({
    id: item.id || null,
    scopeType: item.scopeType || null,
    tradeCount: item.tradeCount || 0,
    counterfactualCount: item.counterfactualCount || 0,
    status: item.status || "observe",
    thresholdShift: num(item.thresholdShift || 0, 4),
    sizeMultiplier: num(item.sizeMultiplier || 1, 4),
    cautionPenalty: num(item.cautionPenalty || 0, 4),
    confidence: num(item.confidence || 0, 4),
    badVetoRate: num(item.badVetoRate || 0, 4),
    executionDragRate: num(item.executionDragRate || 0, 4),
    qualityTrapRate: num(item.qualityTrapRate || 0, 4),
    note: item.note || null
  });
  return {
    status: summary.status || "warmup",
    topActionable: topActionable ? mapScope(topActionable) : null,
    family: arr(summary.family || []).slice(0, 5).map(mapScope),
    regime: arr(summary.regime || []).slice(0, 5).map(mapScope),
    session: arr(summary.session || []).slice(0, 5).map(mapScope),
    condition: arr(summary.condition || []).slice(0, 5).map(mapScope),
    notes: [...(summary.notes || [])]
  };
}

function summarizeServiceState(summary = {}, config = {}, referenceNow = nowIso()) {
  const thresholdMs = Math.max(60000, (config.tradingIntervalSeconds || 60) * 3 * 1000);
  const referenceTime = new Date(referenceNow).getTime();
  const heartbeatTime = summary.lastHeartbeatAt ? new Date(summary.lastHeartbeatAt).getTime() : Number.NaN;
  const heartbeatAgeMs = Number.isFinite(referenceTime) && Number.isFinite(heartbeatTime)
    ? Math.max(0, referenceTime - heartbeatTime)
    : null;
  const watchdogStatus = summary.watchdogStatus || "idle";
  const heartbeatStale = heartbeatAgeMs == null
    ? ["running", "degraded"].includes(watchdogStatus)
    : heartbeatAgeMs > thresholdMs;
  const initWarnings = arr(summary.initWarnings || []).slice(-6).map((item) => ({
    type: item?.type || "bootstrap_warning",
    error: item?.error || null,
    at: item?.at || null
  }));
  return {
    lastHeartbeatAt: summary.lastHeartbeatAt || null,
    watchdogStatus,
    restartBackoffSeconds: summary.restartBackoffSeconds == null ? null : num(summary.restartBackoffSeconds || 0, 1),
    lastExitCode: summary.lastExitCode == null ? null : summary.lastExitCode,
    statusFile: summary.statusFile || null,
    heartbeatAgeSeconds: heartbeatAgeMs == null ? null : num(heartbeatAgeMs / 1000, 1),
    heartbeatStale,
    heartbeatThresholdSeconds: num(thresholdMs / 1000, 1),
    recoveryActive: Boolean((summary.restartBackoffSeconds || 0) > 0 || watchdogStatus === "degraded"),
    initWarnings,
    bootstrapWarningCount: initWarnings.length,
    bootstrapDegraded: initWarnings.length > 0,
    dashboardFeeds: summarizeDashboardFeedHealth(summary.dashboardFeeds || {}, config, referenceNow)
  };
}

function summarizeDashboardFeedHealth(summary = {}, config = {}, referenceNow = nowIso()) {
  const referenceTime = new Date(referenceNow).getTime();
  const staleAfterSeconds = Math.max(30, (config.tradingIntervalSeconds || 60) * 2);
  const feeds = Object.entries(summary || {}).map(([id, item]) => {
    const lastSuccessMs = item?.lastSuccessAt ? new Date(item.lastSuccessAt).getTime() : Number.NaN;
    const ageSeconds = Number.isFinite(referenceTime) && Number.isFinite(lastSuccessMs)
      ? Math.max(0, (referenceTime - lastSuccessMs) / 1000)
      : null;
    const stale = ageSeconds != null && ageSeconds > staleAfterSeconds;
    const baseStatus = item?.status || (item?.lastError ? "failed" : item?.lastSuccessAt ? "ready" : "idle");
    const status = baseStatus === "ready" && stale ? "degraded" : baseStatus;
    return {
      id,
      status,
      lastAttemptAt: item?.lastAttemptAt || null,
      lastSuccessAt: item?.lastSuccessAt || null,
      lastError: item?.lastError || null,
      successCount: item?.successCount || 0,
      failureCount: item?.failureCount || 0,
      lastDurationMs: item?.lastDurationMs == null ? null : num(item.lastDurationMs || 0, 1),
      ageSeconds: ageSeconds == null ? null : num(ageSeconds, 1),
      stale,
      context: item?.context || null
    };
  });
  const degradedFeeds = feeds.filter((item) => ["degraded", "failed"].includes(item.status));
  return {
    status: degradedFeeds.some((item) => item.status === "failed")
      ? "failed"
      : degradedFeeds.length
        ? "degraded"
        : feeds.some((item) => item.status === "ready")
          ? "ready"
          : feeds.some((item) => item.status === "disabled")
            ? "disabled"
            : "idle",
    staleAfterSeconds,
    feedCount: feeds.length,
    degradedCount: degradedFeeds.length,
    degradedFeeds: degradedFeeds.slice(0, 4),
    feeds: feeds.slice(0, 8)
  };
}

function summarizeMarketHistory(summary = {}) {
  const aggregate = summary.aggregate || {};
  const symbols = summary.symbols || {};
  return {
    generatedAt: summary.generatedAt || null,
    interval: summary.interval || null,
    status: summary.status || aggregate.status || "unknown",
    selection: {
      explicit: Boolean(summary.selection?.explicit),
      maxSymbols: summary.selection?.maxSymbols || 0,
      candidateCount: summary.selection?.candidateCount || 0,
      selectedCount: summary.selection?.selectedCount || 0,
      openPositionIncludedCount: summary.selection?.openPositionIncludedCount || 0,
      blockedIncludedCount: summary.selection?.blockedIncludedCount || 0,
      decisionIncludedCount: summary.selection?.decisionIncludedCount || 0,
      replayIncludedCount: summary.selection?.replayIncludedCount || 0,
      recentTradeIncludedCount: summary.selection?.recentTradeIncludedCount || 0,
      watchlistIncludedCount: summary.selection?.watchlistIncludedCount || 0,
      omittedCount: summary.selection?.omittedCount || 0
    },
    repair: {
      status: summary.repair?.status || "idle",
      context: summary.repair?.context || null,
      attemptedCount: summary.repair?.attemptedCount || 0,
      repairedCount: summary.repair?.repairedCount || 0,
      failedCount: summary.repair?.failedCount || 0,
      skippedDueCooldownCount: summary.repair?.skippedDueCooldownCount || 0,
      attemptedSymbols: arr(summary.repair?.attemptedSymbols || []).slice(0, 6),
      repairedSymbols: arr(summary.repair?.repairedSymbols || []).slice(0, 6),
      failedSymbols: arr(summary.repair?.failedSymbols || []).slice(0, 6),
      focusedSymbols: arr(summary.repair?.focusedSymbols || []).slice(0, 6).map((item) => ({
        symbol: item.symbol || null,
        source: item.source || null,
        score: num(item.score || 0, 4)
      })),
      lastRunAt: summary.repair?.lastRunAt || null,
      note: summary.repair?.note || null
    },
    aggregate: {
      status: aggregate.status || "unknown",
      symbolCount: aggregate.symbolCount || 0,
      coveredSymbolCount: aggregate.coveredSymbolCount || 0,
      staleSymbolCount: aggregate.staleSymbolCount || 0,
      gapSymbolCount: aggregate.gapSymbolCount || 0,
      uncoveredSymbolCount: aggregate.uncoveredSymbolCount || 0,
      partitionedSymbolCount: aggregate.partitionedSymbolCount || 0,
      staleSymbols: arr(aggregate.staleSymbols || []).slice(0, 8),
      gapSymbols: arr(aggregate.gapSymbols || []).slice(0, 8),
      uncoveredSymbols: arr(aggregate.uncoveredSymbols || []).slice(0, 8)
    },
    symbols: Object.fromEntries(
      Object.entries(symbols).slice(0, 12).map(([symbol, item]) => [symbol, {
        count: item.count || 0,
        gapCount: item.gapCount || 0,
        stale: Boolean(item.stale),
        freshnessLagCandles: item.freshnessLagCandles == null ? null : item.freshnessLagCandles,
        coverageRatio: num(item.coverageRatio || 0, 4),
        partitionCount: item.partitionCount || 0,
        firstOpenTime: item.firstOpenTime || null,
        lastOpenTime: item.lastOpenTime || null
      }])
    ),
    notes: arr(summary.notes || []).slice(0, 6)
  };
}

function normalizeHistorySymbols(items = []) {
  const ordered = [];
  const seen = new Set();
  for (const item of arr(items)) {
    const raw = typeof item === "string" ? item : item?.symbol;
    const symbol = `${raw || ""}`.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    ordered.push(symbol);
  }
  return ordered;
}

export function resolveMarketHistoryCoverageSymbols({
  symbols = null,
  watchlist = [],
  openPositions = [],
  blockedSymbols = [],
  decisionSymbols = [],
  replaySymbols = [],
  trades = [],
  maxSymbols = null,
  recentTradeLimit = 18
} = {}) {
  const explicitSymbols = normalizeHistorySymbols(symbols);
  if (explicitSymbols.length) {
    const explicitMax = Number.isFinite(maxSymbols) && maxSymbols > 0 ? Math.max(1, Math.floor(maxSymbols)) : explicitSymbols.length;
    const selectedSymbols = explicitSymbols.slice(0, explicitMax);
    return {
      symbols: selectedSymbols,
      selection: {
        explicit: true,
        maxSymbols: explicitMax,
        candidateCount: explicitSymbols.length,
        selectedCount: selectedSymbols.length,
        openPositionIncludedCount: 0,
        blockedIncludedCount: 0,
        decisionIncludedCount: 0,
        replayIncludedCount: 0,
        recentTradeIncludedCount: 0,
        watchlistIncludedCount: 0,
        omittedCount: Math.max(0, explicitSymbols.length - selectedSymbols.length)
      }
    };
  }

  const watchlistSymbols = normalizeHistorySymbols(watchlist);
  const openPositionSymbols = normalizeHistorySymbols(openPositions);
  const blockedFocusSymbols = normalizeHistorySymbols(blockedSymbols);
  const decisionFocusSymbols = normalizeHistorySymbols(decisionSymbols);
  const replayFocusSymbols = normalizeHistorySymbols(replaySymbols);
  const recentTradeSymbols = normalizeHistorySymbols(arr(trades).slice(-Math.max(1, recentTradeLimit)).reverse());
  const configuredMax = Number.isFinite(maxSymbols) && maxSymbols > 0 ? Math.floor(maxSymbols) : null;
  const resolvedMax = Math.max(
    configuredMax || 0,
    openPositionSymbols.length,
    Math.min(
      openPositionSymbols.length + blockedFocusSymbols.length + decisionFocusSymbols.length,
      Math.max(configuredMax || 0, 5)
    ),
    watchlistSymbols.length || 12
  );
  const orderedSymbols = [];
  const seen = new Set();
  const addSymbols = (items = []) => {
    for (const symbol of items) {
      if (seen.has(symbol)) {
        continue;
      }
      seen.add(symbol);
      orderedSymbols.push(symbol);
    }
  };
  addSymbols(openPositionSymbols);
  addSymbols(blockedFocusSymbols);
  addSymbols(decisionFocusSymbols);
  addSymbols(replayFocusSymbols);
  addSymbols(recentTradeSymbols);
  addSymbols(watchlistSymbols);
  const selectedSymbols = orderedSymbols.slice(0, resolvedMax);
  const selectedSet = new Set(selectedSymbols);
  return {
    symbols: selectedSymbols,
    selection: {
      explicit: false,
      maxSymbols: resolvedMax,
      candidateCount: orderedSymbols.length,
      selectedCount: selectedSymbols.length,
      openPositionIncludedCount: openPositionSymbols.filter((symbol) => selectedSet.has(symbol)).length,
      blockedIncludedCount: blockedFocusSymbols.filter((symbol) => selectedSet.has(symbol)).length,
      decisionIncludedCount: decisionFocusSymbols.filter((symbol) => selectedSet.has(symbol)).length,
      replayIncludedCount: replayFocusSymbols.filter((symbol) => selectedSet.has(symbol)).length,
      recentTradeIncludedCount: recentTradeSymbols.filter((symbol) => selectedSet.has(symbol)).length,
      watchlistIncludedCount: watchlistSymbols.filter((symbol) => selectedSet.has(symbol)).length,
      omittedCount: Math.max(0, orderedSymbols.length - selectedSymbols.length)
    }
  };
}

function buildMarketHistoryAggregate(items = []) {
  const staleSymbols = items.filter((item) => item.stale).map((item) => item.symbol);
  const gapSymbols = items.filter((item) => (item.gapCount || 0) > 0).map((item) => item.symbol);
  const uncoveredSymbols = items.filter((item) => !(item.count > 0)).map((item) => item.symbol);
  return {
    symbolCount: items.length,
    coveredSymbolCount: items.filter((item) => (item.count || 0) > 0).length,
    staleSymbolCount: staleSymbols.length,
    gapSymbolCount: gapSymbols.length,
    uncoveredSymbolCount: uncoveredSymbols.length,
    partitionedSymbolCount: items.filter((item) => (item.partitionCount || 0) > 1).length,
    staleSymbols,
    gapSymbols,
    uncoveredSymbols,
    status: uncoveredSymbols.length
      ? "missing"
      : staleSymbols.length || gapSymbols.length
        ? "degraded"
        : items.length
          ? "ready"
          : "empty"
  };
}

function buildTradeReplayHistoryCoverage(trade = {}, marketHistory = {}) {
  const symbolSummary = marketHistory?.symbols?.[trade.symbol] || null;
  if (!symbolSummary) {
    return {
      status: "missing",
      coversTradeWindow: false,
      gapCount: 0,
      freshnessLagCandles: null,
      partitionCount: 0,
      coverageRatio: 0,
      note: "Geen lokale market-history dekking voor dit symbool."
    };
  }
  const entryTime = new Date(trade.entryAt || 0).getTime();
  const exitTime = new Date(trade.exitAt || trade.entryAt || 0).getTime();
  const coversTradeWindow = Number.isFinite(entryTime) && Number.isFinite(exitTime)
    ? (symbolSummary.firstOpenTime || Number.POSITIVE_INFINITY) <= entryTime && (symbolSummary.lastOpenTime || 0) >= exitTime
    : false;
  return {
    status: symbolSummary.gapCount > 0
      ? "gappy"
      : symbolSummary.stale
        ? "stale"
        : coversTradeWindow
          ? "covered"
          : "partial",
    coversTradeWindow,
    gapCount: symbolSummary.gapCount || 0,
    freshnessLagCandles: symbolSummary.freshnessLagCandles == null ? null : symbolSummary.freshnessLagCandles,
    partitionCount: symbolSummary.partitionCount || 0,
    coverageRatio: num(symbolSummary.coverageRatio || 0, 4),
    note: symbolSummary.gapCount > 0
      ? "Lokale history bevat gaten binnen deze replay-dekking."
      : symbolSummary.stale
        ? "Lokale history loopt achter op de verwachte laatste candle."
        : coversTradeWindow
          ? "Lokale history dekt de volledige trade-window."
          : "Lokale history dekt deze trade maar gedeeltelijk."
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

function isPaperQualityTrapTrade(trade = {}) {
  return trade.paperLearningOutcome?.outcome === "quality_trap" || (
    (trade.captureEfficiency || 0) < 0.25 &&
    (trade.mfePct || 0) > 0.012
  );
}

function buildPaperOutcomeSignal(trade = {}) {
  const outcome = resolvePaperOutcomeBucket(trade);
  const review = buildTradeQualityReview(trade);
  const executionDrag = outcome === "execution_drag" || review.verdict === "execution_drag" || (
    (trade.executionQualityScore || 0) < 0.42 &&
    (trade.pnlQuote || 0) <= 0
  );
  return {
    outcome,
    review,
    executionDrag,
    qualityTrap: isPaperQualityTrapTrade(trade),
    weakSetup: review.verdict === "weak_setup",
    followThroughFailed: review.verdict === "follow_through_failed"
  };
}

function summarizePaperTradeReview(trade = {}) {
  const outcome = trade.paperLearningOutcome?.outcome || resolvePaperOutcomeBucket(trade);
  const lesson = trade.paperLearningOutcome?.executionQuality === "weak"
    ? "Execution was hier waarschijnlijk te duur of te traag."
    : trade.paperLearningOutcome?.exitQuality === "weak"
      ? "De exit kon hier waarschijnlijk slimmer of later."
      : trade.paperLearningOutcome?.riskQuality === "weak"
        ? "De risico-keuze was hier waarschijnlijk te ruim of te vroeg."
        : trade.paperLearningOutcome?.entryQuality === "strong"
          ? "De entry was goed; de les zit vooral in follow-through en exit."
          : "Deze trade voedt de paper-leerlus voor entry, exit en risk.";
  return {
    id: trade.id || null,
    symbol: trade.symbol || null,
    outcome,
    reason: trade.reason || null,
    pnlQuote: num(trade.pnlQuote || 0, 2),
    netPnlPct: num(trade.netPnlPct || 0, 4),
    learningLane: trade.learningLane || "safe",
    closedAt: trade.exitAt || null,
    lesson
  };
}

function pickCounterfactualBlocker(item = {}) {
  const blockers = arr(item.blockerReasons || []).filter(Boolean);
  if (!blockers.length) {
    return item.reason || null;
  }
  const preferredPaperBlocker = [
    "exchange_truth_freeze",
    "reconcile_required",
    "quality_quorum_observe_only",
    "higher_tf_conflict",
    "local_book_quality_too_low",
    "quality_quorum_degraded",
    "model_confidence_too_low",
    "committee_veto",
    "execution_cost_budget_exceeded",
    "capital_governor_blocked",
    "capital_governor_recovery"
  ].find((reason) => blockers.includes(reason));
  return preferredPaperBlocker || blockers[0] || item.reason || null;
}

function summarizeCounterfactualReview(item = {}) {
  const branch = arr(item.branches || []).find((entry) => ["winner", "small_winner"].includes(entry.outcome)) || arr(item.branches || [])[0] || null;
  const lesson = item.outcome === "bad_veto"
    ? "Deze blokkade lijkt te streng; vergelijkbare setups liepen vaker door."
    : item.outcome === "good_veto"
      ? "Deze blokkade was waarschijnlijk juist; skippen was hier veiliger."
      : item.outcome === "right_direction_wrong_timing"
        ? "De richting klopte, maar timing of uitvoering kon beter."
        : item.outcome === "late_veto"
          ? "De setup kwam laat op gang; extra timing-review is nuttig."
          : "Deze shadow-case blijft bruikbaar als vergelijkingsmateriaal.";
  return {
    id: item.id || null,
    symbol: item.symbol || null,
    outcome: item.outcome || "neutral",
    blocker: pickCounterfactualBlocker(item),
    realizedMovePct: num(item.realizedMovePct || 0, 4),
    resolvedAt: item.resolvedAt || null,
    bestBranch: branch ? {
      id: branch.id || branch.kind || null,
      outcome: branch.outcome || null,
      adjustedMovePct: num(branch.adjustedMovePct || 0, 4)
    } : null,
    lesson
  };
}

function summarizeQueuedCounterfactualReview(item = {}) {
  const scenarios = arr(item.branchScenarios || []);
  const branch = scenarios.find((entry) => entry.id === "maker_bias")
    || scenarios.find((entry) => entry.kind === "execution")
    || scenarios[0]
    || null;
  const branchLabel = branch?.id || branch?.kind || null;
  const blocker = pickCounterfactualBlocker(item);
  const lesson = blocker
    ? "Deze geblokkeerde setup wordt nog gevolgd om te zien of de blokkade te streng was."
    : "Deze shadow-case staat nog open en voedt de gemiste-trade analyse zodra de review afrondt.";
  return {
    id: item.id || null,
    symbol: item.symbol || null,
    outcome: "shadow_watch",
    blocker,
    realizedMovePct: null,
    resolvedAt: item.queuedAt || item.dueAt || null,
    bestBranch: branchLabel ? {
      id: branchLabel,
      outcome: "pending_review",
      adjustedMovePct: null
    } : null,
    lesson
  };
}

function shadowReviewSortTime(item = {}) {
  const at = item.resolvedAt || item.reviewedAt || item.queuedAt || item.dueAt || null;
  const time = at ? new Date(at).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
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

function summarizeStrategyAllocation(summary = {}) {
  return {
    status: summary.status || "warmup",
    tradeCount: summary.tradeCount || 0,
    bucketCount: summary.bucketCount || 0,
    lastTradeAt: summary.lastTradeAt || null,
    preferredFamily: summary.preferredFamily || null,
    preferredStrategy: summary.preferredStrategy || null,
    activeFamily: summary.activeFamily || null,
    activeStrategy: summary.activeStrategy || null,
    regime: summary.regime || null,
    session: summary.session || null,
    posture: summary.posture || "neutral",
    fitBoost: num(summary.fitBoost || 0, 4),
    confidenceBoost: num(summary.confidenceBoost || 0, 4),
    thresholdShift: num(summary.thresholdShift || 0, 4),
    sizeMultiplier: num(summary.sizeMultiplier ?? 1, 4),
    budgetMultiplier: num(summary.budgetMultiplier ?? 1, 4),
    budgetLane: summary.budgetLane || "standard",
    convictionScore: num(summary.convictionScore || 0, 4),
    marketRisk: num(summary.marketRisk || 0, 4),
    explorationWeight: num(summary.explorationWeight || 0, 4),
    confidence: num(summary.confidence || 0, 4),
    activeBias: num(summary.activeBias || 0, 4),
    scopes: arr(summary.scopes || []).slice(0, 5).map((item) => ({
      id: item.id || null,
      label: item.label || null,
      signal: num(item.signal || 0, 4),
      confidence: num(item.confidence || 0, 4),
      trades: item.trades || 0,
      ageHours: item.ageHours == null ? null : num(item.ageHours, 1)
    })),
    topFamilies: arr(summary.topFamilies || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      context: item.context || null,
      signal: num(item.signal || 0, 4),
      confidence: num(item.confidence || 0, 4),
      trades: item.trades || 0,
      lastTradeAt: item.lastTradeAt || null
    })),
    topStrategies: arr(summary.topStrategies || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      context: item.context || null,
      signal: num(item.signal || 0, 4),
      confidence: num(item.confidence || 0, 4),
      trades: item.trades || 0,
      lastTradeAt: item.lastTradeAt || null
    })),
    topConditions: arr(summary.topConditions || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      condition: item.condition || null,
      signal: num(item.signal || 0, 4),
      confidence: num(item.confidence || 0, 4),
      trades: item.trades || 0,
      lastTradeAt: item.lastTradeAt || null
    })),
    notes: arr(summary.notes || []).slice(0, 4)
  };
}

function summarizeMarketCondition(summary = {}) {
  return {
    conditionId: summary.conditionId || "unknown_condition",
    confidence: num(summary.conditionConfidence || summary.confidence || 0, 4),
    risk: num(summary.conditionRisk || summary.risk || 0, 4),
    transitionState: summary.conditionTransitionState || summary.transitionState || "stable",
    posture: summary.posture || "balanced",
    regime: summary.regime || null,
    session: summary.session || null,
    phase: summary.phase || null,
    drivers: arr(summary.drivers || []).slice(0, 3),
    notes: arr(summary.notes || []).slice(0, 2),
    candidates: arr(summary.candidates || []).slice(0, 4).map((item) => ({
      id: item.id || null,
      score: num(item.score || 0, 4),
      transitionState: item.transitionState || "stable"
    }))
  };
}

function summarizeMissedTradeTuning(summary = {}) {
  return {
    status: summary.status || "warmup",
    topBlocker: summary.topBlocker || null,
    action: summary.action || "observe",
    confidence: num(summary.confidence || 0, 4),
    thresholdShift: num(summary.thresholdShift || 0, 4),
    paperProbeEligible: Boolean(summary.paperProbeEligible),
    shadowPriority: Boolean(summary.shadowPriority),
    blockerSofteningRecommendation: summary.blockerSofteningRecommendation || null,
    blockerHardeningRecommendation: summary.blockerHardeningRecommendation || null,
    scope: {
      conditionId: summary.scope?.conditionId || null,
      familyId: summary.scope?.familyId || null,
      strategyId: summary.scope?.strategyId || null
    },
    note: summary.note || null
  };
}

function summarizeAdaptivePolicy({
  strategyAllocation = {},
  paperLearning = {},
  marketCondition = {},
  policyTransitions = []
} = {}) {
  const value = (input, fallback = 0) => Number.isFinite(input) ? input : fallback;
  const favoredFamily = strategyAllocation.preferredFamily || strategyAllocation.topFamilies?.[0]?.id || null;
  const favoredStrategy = strategyAllocation.preferredStrategy || strategyAllocation.topStrategies?.[0]?.id || null;
  const cooledStrategy = arr(policyTransitions).find((item) => ["cooldown_candidate", "shadow_only", "probe_only"].includes(item.action))?.id || null;
  return {
    favoredFamily,
    favoredStrategy,
    cooledStrategy,
    confidence: num(
      Math.max(
        value(strategyAllocation.confidence, 0),
        value(marketCondition.confidence, 0) * 0.7,
        value(paperLearning.readinessScore, 0) * 0.4
      ),
      4
    ),
    posture: strategyAllocation.posture || marketCondition.posture || "neutral",
    note: strategyAllocation.notes?.[0] || paperLearning.policyTransitions?.note || null
  };
}

function summarizeExitPolicyDigest(summary = {}) {
  return {
    preferredExitStyle: summary.preferredExitStyle || "balanced",
    trimBias: num(summary.trimBias || 0, 4),
    trailBias: num(summary.trailTightnessBias || 0, 4),
    holdTolerance: num(summary.holdTolerance || 0, 4),
    maxHoldBias: num(summary.maxHoldBias || 0, 4),
    sources: arr(summary.sources || []).slice(0, 4)
  };
}

function summarizeOpportunityRanking(decisions = []) {
  const top = arr(decisions)
    .filter((item) => Number.isFinite(item.opportunityScore))
    .sort((left, right) => (right.opportunityScore || 0) - (left.opportunityScore || 0))
    .slice(0, 4);
  return {
    leader: top[0]
      ? {
          symbol: top[0].symbol || null,
          opportunityScore: num(top[0].opportunityScore || 0, 4),
          setupStyle: top[0].setupStyle || null
        }
      : null,
    items: top.map((item) => ({
      symbol: item.symbol || null,
      opportunityScore: num(item.opportunityScore || 0, 4),
      edgeToThreshold: num(item.edgeToThreshold || 0, 4),
      allow: Boolean(item.allow)
    })),
    note: top[0]
      ? `${top[0].symbol} leidt nu de opportunity ranking.`
      : "Nog geen opportunity ranking beschikbaar."
  };
}

function summarizePromotionByConditionDigest({
  policyTransitions = [],
  paperLearningTransitions = [],
  rolloutCandidates = []
} = {}) {
  const priority = new Map([
    ["live_ready", 6],
    ["guarded_live_candidate", 5],
    ["promote_candidate", 4],
    ["paper_ready", 3],
    ["priority_probe", 3],
    ["probe_only", 2],
    ["shadow_only", 2],
    ["cooldown_candidate", 1],
    ["retire_candidate", 0]
  ]);
  const rankedTransitions = [...arr(policyTransitions), ...arr(paperLearningTransitions)]
    .filter((item) => item?.id || item?.strategyId)
    .sort((left, right) => {
      const priorityDelta = (priority.get(right.action) || 0) - (priority.get(left.action) || 0);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return (right.confidence || 0) - (left.confidence || 0);
    });
  const top = arr(rolloutCandidates)[0] || rankedTransitions[0] || null;
  const action = top?.action || "observe";
  const status = ["live_ready", "guarded_live_candidate", "promote_candidate", "paper_ready"].includes(action)
    ? "positive"
    : ["cooldown_candidate", "retire_candidate"].includes(action)
      ? "negative"
      : top
        ? "neutral"
        : "warmup";
  const blockers = arr(top?.guardedLiveBlockers || []);
  const headlineId = top?.id || top?.strategyId || null;
  const headlineCondition = top?.conditionId || null;
  return {
    status,
    action,
    id: headlineId,
    conditionId: headlineCondition,
    confidence: num(top?.confidence || 0, 4),
    reason: top?.reason || null,
    blockers,
    note: headlineId
      ? blockers.length
        ? `${titleize(headlineId)} blijft nu op ${titleize(action)}${headlineCondition ? ` binnen ${titleize(headlineCondition)}` : ""} en wacht op ${humanizeReason(blockers[0])}.`
        : `${titleize(headlineId)} staat nu op ${titleize(action)}${headlineCondition ? ` binnen ${titleize(headlineCondition)}` : ""}.`
      : "Nog geen condition-aware policy transition klaar."
  };
}

function summarizeHistoryCoverageDigest(historyCoverage = {}) {
  const status = historyCoverage.status || "unknown";
  const uncoveredCount = historyCoverage.uncoveredSymbolCount || 0;
  const gapCount = historyCoverage.gapSymbolCount || 0;
  const staleCount = historyCoverage.staleSymbolCount || 0;
  const urgent = status === "missing" || uncoveredCount > 0 || gapCount > 0;
  const watch = !urgent && staleCount > 0;
  return {
    status: urgent ? "urgent" : watch ? "watch" : status === "ready" ? "stable" : "warmup",
    uncoveredCount,
    gapCount,
    staleCount,
    note: urgent
      ? uncoveredCount > 0
        ? `${uncoveredCount} history-symbolen missen nog dekking voor replay of governance.`
        : `${gapCount} history-symbolen hebben nog gaten voor replay of offline learning.`
      : watch
        ? `${staleCount} history-symbolen lopen nog achter op de laatste gesloten candle.`
        : status === "ready"
          ? "History-dekking is stabiel genoeg voor replay en governance."
          : "History-dekking warmt nog op."
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
    recentTradeCount: summary.recentTradeCount || 0,
    latestTradeAt: summary.latestTradeAt || null,
    freshnessHours: num(summary.freshnessHours || 0, 1),
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
    allowProbeEntries: Boolean(summary.allowProbeEntries),
    recoveryMode: Boolean(summary.recoveryMode),
    releaseReady: Boolean(summary.releaseReady),
    sizeMultiplier: num(summary.sizeMultiplier ?? 1, 4),
    dailyLossFraction: num(summary.dailyLossFraction || 0, 4),
    weeklyLossFraction: num(summary.weeklyLossFraction || 0, 4),
    drawdownPct: num(summary.drawdownPct || 0, 4),
    redDayStreak: summary.redDayStreak || 0,
    latestTradeAt: summary.latestTradeAt || null,
    lastClosedTradeAgeHours: summary.lastClosedTradeAgeHours == null ? null : num(summary.lastClosedTradeAgeHours, 1),
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
    averageBudgetCostBps: num(item.averageBudgetCostBps || 0, 2),
    averageExcessFeeBps: num(item.averageExcessFeeBps || 0, 2),
    averageTouchSlippageBps: num(item.averageTouchSlippageBps || 0, 2),
    averageSlippageDeltaBps: num(item.averageSlippageDeltaBps || 0, 2),
    status: item.status || "ready"
  });
  return {
    status: summary.status || "warmup",
    stale: Boolean(summary.stale),
    latestTradeAt: summary.latestTradeAt || null,
    freshnessHours: summary.freshnessHours == null ? null : num(summary.freshnessHours, 1),
    averageTotalCostBps: num(summary.averageTotalCostBps || 0, 2),
    averageFeeBps: num(summary.averageFeeBps || 0, 2),
    averageBudgetCostBps: num(summary.averageBudgetCostBps || 0, 2),
    averageExcessFeeBps: num(summary.averageExcessFeeBps || 0, 2),
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

function summarizeSignalFlow(summary = {}) {
  const lastCycle = summary.lastCycle || {};
  const topRejectionReasons = summarizeCountMap(lastCycle.rejectionReasons || {}, 5);
  const topRejectionCategories = summarizeCountMap(lastCycle.rejectionCategories || {}, 5);
  const dominantBlocker = topRejectionReasons[0]?.id || null;
  const dominantCategory = topRejectionCategories[0]?.id || null;
  const flowStatus =
    (lastCycle.allowedSignals || 0) > 0 && (lastCycle.entriesAttempted || 0) === 0
      ? "blocked"
      : (lastCycle.entriesExecuted || 0) > (lastCycle.entriesPersisted || 0)
        ? "degraded"
        : (lastCycle.generatedSignals || 0) > 0 && (lastCycle.allowedSignals || 0) === 0
          ? "inactive"
          : (lastCycle.entriesExecuted || 0) > 0
            ? "active"
            : (lastCycle.generatedSignals || 0) > 0
              ? "watch"
              : "idle";
  return {
    symbolsScanned: summary.symbolsScanned || 0,
    candidatesScored: summary.candidatesScored || 0,
    generatedSignals: summary.generatedSignals || 0,
    rejectedSignals: summary.rejectedSignals || 0,
    allowedSignals: summary.allowedSignals || 0,
    entriesAttempted: summary.entriesAttempted || 0,
    entriesExecuted: summary.entriesExecuted || 0,
    entriesPersisted: summary.entriesPersisted || 0,
    entriesPersistFailed: summary.entriesPersistFailed || 0,
    paperTradesAttempted: summary.paperTradesAttempted || 0,
    paperTradesExecuted: summary.paperTradesExecuted || 0,
    paperTradesPersisted: summary.paperTradesPersisted || 0,
    consecutiveCyclesWithSignalsNoPaperTrade: summary.consecutiveCyclesWithSignalsNoPaperTrade || 0,
    lastGeneratedAt: summary.lastGeneratedAt || null,
    lastRejectedAt: summary.lastRejectedAt || null,
    lastPaperTradeAttemptAt: summary.lastPaperTradeAttemptAt || null,
    lastPaperTradeExecutedAt: summary.lastPaperTradeExecutedAt || null,
    lastPaperTradePersistedAt: summary.lastPaperTradePersistedAt || null,
    rejectionReasons: summarizeCountMap(summary.rejectionReasons || {}, 10),
    rejectionCategories: summarizeCountMap(summary.rejectionCategories || {}, 8),
    lastCycle: {
      at: lastCycle.at || null,
      symbolsScanned: lastCycle.symbolsScanned || 0,
      candidatesScored: lastCycle.candidatesScored || 0,
      generatedSignals: lastCycle.generatedSignals || 0,
      rejectedSignals: lastCycle.rejectedSignals || 0,
      allowedSignals: lastCycle.allowedSignals || 0,
      entriesAttempted: lastCycle.entriesAttempted || 0,
      entriesExecuted: lastCycle.entriesExecuted || 0,
      entriesPersisted: lastCycle.entriesPersisted || 0,
      entriesPersistFailed: lastCycle.entriesPersistFailed || 0,
      paperTradesAttempted: lastCycle.paperTradesAttempted || 0,
      paperTradesExecuted: lastCycle.paperTradesExecuted || 0,
      paperTradesPersisted: lastCycle.paperTradesPersisted || 0,
      entryStatus: lastCycle.entryStatus || "idle",
      openedSymbol: lastCycle.openedSymbol || null,
      topRejectionReasons,
      topRejectionCategories
    },
    tradingFlowHealth: {
      status: flowStatus,
      dominantBlocker,
      dominantCategory,
      headline:
        dominantBlocker
          ? `${titleize(dominantBlocker)} blokkeert nu de flow`
          : flowStatus === "active"
            ? "Trading flow actief"
            : flowStatus === "inactive"
              ? "Signalen worden gegenereerd maar niets komt door de entry-gate"
              : flowStatus === "blocked"
                ? "Geldige setups raken de execution flow niet"
                : flowStatus === "degraded"
                  ? "Execution en persistence lopen niet volledig gelijk"
                  : "Nog geen trading-flow activiteit zichtbaar",
      counters: {
        symbolsScanned: lastCycle.symbolsScanned || 0,
        candidatesScored: lastCycle.candidatesScored || 0,
        generatedSignals: lastCycle.generatedSignals || 0,
        rejectedSignals: lastCycle.rejectedSignals || 0,
        allowedSignals: lastCycle.allowedSignals || 0,
        attempted: lastCycle.entriesAttempted || 0,
        executed: lastCycle.entriesExecuted || 0,
        persisted: lastCycle.entriesPersisted || 0
      }
    },
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

function normalizePolicyTransitionAction(action = "") {
  const normalized = `${action || ""}`.trim().toLowerCase();
  if ([
    "promote_candidate",
    "cooldown_candidate",
    "retire_candidate",
    "priority_probe",
    "probe_only",
    "shadow_only",
    "paper_ready",
    "guarded_live_candidate",
    "live_ready"
  ].includes(normalized)) {
    return normalized;
  }
  return "observe";
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
    deterministicReplayPlan: summary.deterministicReplayPlan ? {
      status: summary.deterministicReplayPlan.status || "warmup",
      nextPackType: summary.deterministicReplayPlan.nextPackType || null,
      packCount: summary.deterministicReplayPlan.packCount || 0,
      worstScenario: summary.deterministicReplayPlan.worstScenario || null,
      coverageNeeds: [...(summary.deterministicReplayPlan.coverageNeeds || [])],
      operatorGoal: summary.deterministicReplayPlan.operatorGoal || null,
      selectedCases: arr(summary.deterministicReplayPlan.selectedCases || []).slice(0, 6).map((item) => ({
        kind: item.kind || null,
        symbol: item.symbol || null,
        strategy: item.strategy || null,
        outcome: item.outcome || null,
        pnlQuote: num(item.pnlQuote || 0, 2),
        netPnlPct: num(item.netPnlPct || item.realizedMovePct || 0, 4),
        reason: item.reason || null
      })),
      notes: [...(summary.deterministicReplayPlan.notes || [])]
    } : null,
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

function summarizeEffectiveBudget({ equity = 0, quoteFree = 0, capitalPolicy = {} } = {}) {
  const equityBase = Math.max(0, safeNumber(equity, 0));
  const freeQuote = Math.max(0, safeNumber(quoteFree, 0));
  const sizeMultiplier = Math.max(0, safeNumber(capitalPolicy?.sizeMultiplier, 1));
  const policyBudget = equityBase * sizeMultiplier;
  const deployableBudget = Math.min(freeQuote, policyBudget);
  return {
    policyBudget: num(policyBudget, 2),
    deployableBudget: num(deployableBudget, 2),
    quoteFree: num(freeQuote, 2),
    equity: num(equityBase, 2),
    sizeMultiplier: num(sizeMultiplier, 4),
    cashCapped: freeQuote + 0.005 < policyBudget,
    utilizationPct: num(policyBudget > 0 ? deployableBudget / policyBudget : 0, 4)
  };
}

function summarizeSizingGuide({ config = {}, effectiveBudget = {}, mode = "paper" } = {}) {
  const deployableBudget = Math.max(0, safeNumber(effectiveBudget.deployableBudget, 0));
  const stopLossPct = Math.max(0.0001, safeNumber(config.stopLossPct, 0.018));
  const maxPositionFraction = Math.max(0, safeNumber(config.maxPositionFraction, 0.15));
  const maxTotalExposureFraction = Math.max(0, safeNumber(config.maxTotalExposureFraction, 0.6));
  const riskPerTrade = Math.max(0, safeNumber(config.riskPerTrade, 0.01));
  const minTradeUsdt = Math.max(0, safeNumber(config.minTradeUsdt, 25));
  const perTradeCapByPosition = deployableBudget * maxPositionFraction;
  const perTradeCapByRisk = stopLossPct > 0 ? (deployableBudget * riskPerTrade) / stopLossPct : perTradeCapByPosition;
  const targetQuote = Math.max(minTradeUsdt, Math.min(perTradeCapByPosition, perTradeCapByRisk));
  const exposureCap = deployableBudget * maxTotalExposureFraction;
  const paperProbeMultiplier = Math.max(0, safeNumber(config.paperExplorationSizeMultiplier, 0.45));
  const paperRecoveryMultiplier = Math.max(0, safeNumber(config.paperRecoveryProbeSizeMultiplier, 0.22));
  const paperProbeQuote = Math.max(minTradeUsdt, targetQuote * paperProbeMultiplier);
  const paperRecoveryQuote = Math.max(5, minTradeUsdt * paperRecoveryMultiplier);
  const idealConcurrentPositions = targetQuote > 0
    ? Math.max(1, Math.min(safeNumber(config.maxOpenPositions, 1), Math.floor(exposureCap / targetQuote) || 1))
    : 0;
  const minTradeDominates = targetQuote === minTradeUsdt && Math.min(perTradeCapByPosition, perTradeCapByRisk) < minTradeUsdt;
  return {
    mode,
    deployableBudget: num(deployableBudget, 2),
    targetQuote: num(targetQuote, 2),
    perTradeCapByPosition: num(perTradeCapByPosition, 2),
    perTradeCapByRisk: num(perTradeCapByRisk, 2),
    exposureCap: num(exposureCap, 2),
    paperProbeQuote: num(paperProbeQuote, 2),
    paperRecoveryQuote: num(paperRecoveryQuote, 2),
    idealConcurrentPositions,
    minTradeUsdt: num(minTradeUsdt, 2),
    minTradeDominates,
    notes: [
      `Normale trade mikt op ongeveer ${num(targetQuote, 2)} ${config.baseQuoteAsset || "USDT"}.`,
      mode === "paper"
        ? `Paper probe gebruikt ongeveer ${num(paperProbeQuote, 2)} ${config.baseQuoteAsset || "USDT"}, recovery probe ongeveer ${num(paperRecoveryQuote, 2)}.`
        : `Live sizing blijft begrensd door ongeveer ${num(perTradeCapByRisk, 2)} risk-cap en ${num(perTradeCapByPosition, 2)} position-cap.`,
      minTradeDominates
        ? `Minimum trade van ${num(minTradeUsdt, 2)} domineert; kleinere sizing kan niet door de exchange-floor heen.`
        : `Exposure-cap laat ongeveer ${idealConcurrentPositions} gelijktijdige positie(s) van deze grootte toe.`
    ].filter(Boolean)
  };
}

function summarizeTradeReasonView(trade = {}, pnl = {}) {
  const rawReason = trade.reason || null;
  if (rawReason === "stop_loss" && safeNumber(trade.exitPrice, 0) > safeNumber(trade.entryPrice, 0)) {
    return {
      reasonLabel: "protective_stop",
      reasonNote: pnl.grossMovePnl > 0 && pnl.netRealizedPnl < 0
        ? "Bruto hoger gesloten, maar fees en execution maakten de trade netto rood."
        : "De stop loss was omhoog getrokken en sloot beschermend boven entry."
    };
  }
  if (pnl.grossMovePnl > 0 && pnl.netRealizedPnl < 0) {
    return {
      reasonLabel: rawReason,
      reasonNote: "Bruto prijsbeweging was groen, maar round-trip kosten draaiden de trade netto rood."
    };
  }
  return {
    reasonLabel: rawReason,
    reasonNote: null
  };
}

function summarizeDataRecorder(summary = {}) {
  const replayFrames = summary.replayFrames || 0;
  const snapshotFrames = summary.snapshotFrames || 0;
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
    snapshotFrames,
    replayFrames,
    snapshotManifestFrames: Math.max(0, snapshotFrames - replayFrames),
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

function summarizeAdaptationHealth(summary = {}) {
  return {
    status: summary.status || "warmup",
    learnsFromClosedTrades: summary.learnsFromClosedTrades !== false,
    supportsMarketAdaptation: summary.supportsMarketAdaptation !== false,
    learnableTradeCount: summary.learnableTradeCount || 0,
    learningFrames: summary.learningFrames || 0,
    offlineReadinessScore: num(summary.offlineReadinessScore || 0, 4),
    lastLearningTradeAt: summary.lastLearningTradeAt || null,
    learningAgeHours: summary.learningAgeHours == null ? null : num(summary.learningAgeHours, 1),
    calibrationObservations: summary.calibrationObservations || 0,
    calibrationEce: num(summary.calibrationEce || 0, 4),
    lastCalibrationUpdateAt: summary.lastCalibrationUpdateAt || null,
    calibrationAgeHours: summary.calibrationAgeHours == null ? null : num(summary.calibrationAgeHours, 1),
    lastPromotionAt: summary.lastPromotionAt || null,
    deploymentActive: summary.deploymentActive || null,
    optimizerStatus: summary.optimizerStatus || "warmup",
    attributionStatus: summary.attributionStatus || "warmup",
    parameterGovernorStatus: summary.parameterGovernorStatus || "warmup",
    strategyAllocation: summarizeStrategyAllocation(summary.strategyAllocation || {}),
    adaptiveInputs: {
      enabledCount: summary.adaptiveInputs?.enabledCount || 0,
      totalCount: summary.adaptiveInputs?.totalCount || 0,
      items: arr(summary.adaptiveInputs?.items || []).slice(0, 10).map((item) => ({
        id: item.id || null,
        enabled: Boolean(item.enabled)
      }))
    },
    notes: [...(summary.notes || [])]
  };
}

export function buildCandidateQualityQuorum({
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
  const hasNewsCoverage = (newsSummary?.coverage || 0) > 0;
  const providerOpsScope = hasNewsCoverage
    ? {
        providerCount: sourceReliabilitySummary?.providerCount || 0,
        averageScore: sourceReliabilitySummary?.averageScore || 0,
        degradedCount: sourceReliabilitySummary?.degradedCount || 0,
        coolingDownCount: sourceReliabilitySummary?.coolingDownCount || 0,
        label: "news"
      }
    : {
        providerCount: sourceReliabilitySummary?.externalFeeds?.providerCount ?? sourceReliabilitySummary?.providerCount ?? 0,
        averageScore: sourceReliabilitySummary?.externalFeeds?.averageScore ?? sourceReliabilitySummary?.averageScore ?? 0,
        degradedCount: sourceReliabilitySummary?.externalFeeds?.degradedCount ?? sourceReliabilitySummary?.degradedCount ?? 0,
        coolingDownCount: sourceReliabilitySummary?.externalFeeds?.coolingDownCount ?? sourceReliabilitySummary?.coolingDownCount ?? 0,
        label: sourceReliabilitySummary?.externalFeeds ? "external" : "news"
      };
  const localBookDepthConfidence = marketSnapshot?.book?.depthConfidence || 0;
  const localBookFallbackReady = Boolean(marketSnapshot?.book?.bookFallbackReady);
  const localBookPassed = !config.enableLocalOrderBook || (
    (
      Boolean(marketSnapshot?.book?.localBookSynced) &&
      localBookDepthConfidence >= 0.22
    ) ||
    localBookFallbackReady
  );
  const localBookDetail = !config.enableLocalOrderBook
    ? "disabled"
    : localBookFallbackReady
      ? `rest fallback | depth ${num(localBookDepthConfidence, 2)}`
      : `sync ${marketSnapshot?.book?.localBookSynced ? "ok" : "missing"} | depth ${num(localBookDepthConfidence, 2)}`;
  const checks = [
    {
      id: "local_book",
      label: "Local book",
      critical: true,
      passed: localBookPassed,
      detail: localBookDetail
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
      passed: (providerOpsScope.providerCount || 0) === 0 || (
        (providerOpsScope.averageScore || 0) >= config.sourceReliabilityMinOperationalScore &&
        (providerOpsScope.degradedCount || 0) <= 1 &&
        (providerOpsScope.coolingDownCount || 0) <= Math.max(1, Math.floor((providerOpsScope.providerCount || 0) / 2))
      ),
      detail: `${providerOpsScope.label} ${providerOpsScope.degradedCount || 0} degraded | avg ${num(providerOpsScope.averageScore || 0, 2)}`
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
  const softPaperCriticalFailures = new Set(["local_book", "provider_ops", "pair_health"]);
  const paperSoftInfraOnly = (config?.botMode || "paper") === "paper" &&
    failedCritical.length > 0 &&
    failedCritical.every((check) => softPaperCriticalFailures.has(check.id)) &&
    (divergenceSummary?.leadBlocker?.status || "") !== "blocked";
  const observeOnly = !paperSoftInfraOnly &&
    (failedCritical.length >= 2 || (!checks.find((check) => check.id === "local_book")?.passed && !checks.find((check) => check.id === "provider_ops")?.passed));
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

function isCorruptStateLoadError(error) {
  return error instanceof SyntaxError || error?.name === "SyntaxError";
}

function resolveHistoryAutoRepairBudget(config = {}, context = "runtime") {
  const configured = Number(config.historyAutoRepairMaxSymbols);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(4, Math.floor(configured));
  }
  const defaults = {
    bootstrap: 3,
    runtime: 3,
    research: 2,
    doctor: 1,
    report: 1,
    dashboard_snapshot: 1
  };
  return defaults[context] ?? 1;
}

function resolveHistoryEdgeCloseness(value) {
  const edge = Math.abs(Number(value));
  if (!Number.isFinite(edge)) {
    return 0;
  }
  return clamp(1 - Math.min(1, edge / 0.08), 0, 1);
}

function scoreDecisionHistoryFocus(item = {}) {
  const opportunity = clamp(Number(item.opportunityScore ?? item.rankScore ?? 0), 0, 1);
  const learningValue = clamp(Number(item.learningValueScore || 0), 0, 1);
  const edgeCloseness = resolveHistoryEdgeCloseness(item.edgeToThreshold);
  const laneBonus = item.learningLane === "probe"
    ? 0.18
    : item.learningLane === "shadow"
      ? 0.1
      : 0;
  return num((opportunity * 0.48) + (learningValue * 0.24) + (edgeCloseness * 0.2) + laneBonus, 4);
}

function scoreBlockedHistoryFocus(item = {}) {
  const base = scoreDecisionHistoryFocus(item);
  const tuningBonus = item.missedTradeTuning?.paperProbeEligible ? 0.12 : 0;
  const blockerBonus = arr(item.blockerReasons || []).length ? 0.06 : 0;
  return num(base + tuningBonus + blockerBonus + 0.08, 4);
}

function scoreReplayHistoryFocus(trade = {}, index = 0) {
  const recency = clamp(1 - Math.min(index, 8) / 8, 0.2, 1);
  const moveMagnitude = clamp(Math.abs(Number(trade.netPnlPct || 0)) * 20, 0, 0.5);
  const durationWeight = clamp((Number(trade.durationMinutes || 0) || 0) / 240, 0, 0.2);
  return num(recency + moveMagnitude + durationWeight, 4);
}

function sortHistoryFocusEntries(items = [], scorer = () => 0) {
  return arr(items)
    .map((item, index) => ({
      ...item,
      historyFocusScore: scorer(item, index),
      historyFocusOrder: index
    }))
    .sort((left, right) => {
      const scoreDelta = (right.historyFocusScore || 0) - (left.historyFocusScore || 0);
      return scoreDelta !== 0 ? scoreDelta : left.historyFocusOrder - right.historyFocusOrder;
    });
}

function buildHistoryFocusInputs({
  blockedSetups = [],
  decisions = [],
  trades = [],
  limit = 12
} = {}) {
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 12, 16));
  const blockedEntries = sortHistoryFocusEntries(blockedSetups, scoreBlockedHistoryFocus).slice(0, cappedLimit);
  const decisionEntries = sortHistoryFocusEntries(decisions, scoreDecisionHistoryFocus).slice(0, cappedLimit);
  const replayEntries = sortHistoryFocusEntries(trades, scoreReplayHistoryFocus).slice(0, Math.min(cappedLimit, 8));
  const focusMap = new Map();
  const noteFocus = (items = [], source) => {
    for (const item of items) {
      const symbol = `${item?.symbol || ""}`.trim().toUpperCase();
      if (!symbol) {
        continue;
      }
      const current = focusMap.get(symbol) || {
        primarySource: source,
        score: 0,
        sources: []
      };
      const score = Number(item.historyFocusScore || 0);
      const nextSources = [...new Set([...current.sources, source])];
      focusMap.set(symbol, {
        primarySource: score > (current.score || 0) ? source : current.primarySource,
        score: Math.max(current.score || 0, score),
        sources: nextSources
      });
    }
  };
  noteFocus(blockedEntries, "blocked");
  noteFocus(decisionEntries, "decision");
  noteFocus(replayEntries, "replay");
  return {
    blockedSymbols: blockedEntries,
    decisionSymbols: decisionEntries,
    replaySymbols: replayEntries,
    focusBySymbol: Object.fromEntries(
      [...focusMap.entries()].map(([symbol, meta]) => [symbol, {
        primarySource: meta.primarySource || null,
        score: num(meta.score || 0, 4),
        sources: [...(meta.sources || [])]
      }])
    )
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
    this.historyStore = new MarketHistoryStore({ rootDir: config.historyDir, logger, partitionGranularity: config.historyPartitionGranularity || "month" });
    this.pairHealthMonitor = new PairHealthMonitor(config);
    this.divergenceMonitor = new DivergenceMonitor(config);
    this.offlineTrainer = new OfflineTrainer(config);
    this.universeSelector = new UniverseSelector(config);
    this.capitalLadder = new CapitalLadder(config);
    this.stream = new StreamCoordinator({ client: this.client, config, logger });
    this.symbolRules = {};
    this.marketCache = {};
    this.persistPromise = null;
    this.observabilityCache = {
      reportVersion: 0,
      reportBuiltVersion: -1,
      report: null
    };
  }

  markReportDirty() {
    this.observabilityCache = this.observabilityCache || {
      reportVersion: 0,
      reportBuiltVersion: -1,
      report: null
    };
    this.observabilityCache.reportVersion = (this.observabilityCache.reportVersion || 0) + 1;
  }

  getPerformanceReport() {
    this.observabilityCache = this.observabilityCache || {
      reportVersion: 0,
      reportBuiltVersion: -1,
      report: null
    };
    if (this.observabilityCache.report && this.observabilityCache.reportBuiltVersion === this.observabilityCache.reportVersion) {
      return this.observabilityCache.report;
    }
    const report = buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config });
    this.observabilityCache.report = report;
    this.observabilityCache.reportBuiltVersion = this.observabilityCache.reportVersion;
    return report;
  }

  buildPublicReportView(report = this.getPerformanceReport()) {
    return {
      generatedAt: nowIso(),
      tradeCount: report.tradeCount || 0,
      realizedPnl: num(report.realizedPnl || 0, 2),
      winRate: num(report.winRate || 0, 4),
      averagePnlPct: num(report.averagePnlPct || 0, 4),
      profitFactor: Number.isFinite(report.profitFactor) ? num(report.profitFactor, 3) : null,
      maxDrawdownPct: num(report.maxDrawdownPct || 0, 4),
      openExposure: num(report.openExposure || 0, 2),
      openPositions: report.openPositions || 0,
      openExposureReview: {
        manualReviewCount: report.openExposureReview?.manualReviewCount || 0,
        reconcileRequiredCount: report.openExposureReview?.reconcileRequiredCount || 0,
        protectionPendingCount: report.openExposureReview?.protectionPendingCount || 0,
        unreconciledCount: report.openExposureReview?.unreconciledCount || 0,
        manualReviewExposure: num(report.openExposureReview?.manualReviewExposure || 0, 2),
        reconcileRequiredExposure: num(report.openExposureReview?.reconcileRequiredExposure || 0, 2),
        protectionPendingExposure: num(report.openExposureReview?.protectionPendingExposure || 0, 2),
        unreconciledExposure: num(report.openExposureReview?.unreconciledExposure || 0, 2),
        notes: arr(report.openExposureReview?.notes || [])
      },
      scaleOutSummary: {
        count: report.scaleOutSummary?.count || 0,
        realizedPnl: num(report.scaleOutSummary?.realizedPnl || 0, 2),
        averageFraction: num(report.scaleOutSummary?.averageFraction || 0, 4)
      },
      executionSummary: report.executionSummary || {},
      executionCostSummary: report.executionCostSummary || {},
      pnlDecomposition: report.pnlDecomposition || {},
      tradeQualityReview: report.tradeQualityReview || null,
      attribution: report.attribution || {},
      windows: report.windows || {},
      modes: report.modes || {},
      marketHistory: summarizeMarketHistory(this.runtime.marketHistory || {}),
      recentTrades: report.recentTrades.map((trade) => this.buildTradeView(trade)),
      recentScaleOuts: report.recentScaleOuts.map((event) => this.buildScaleOutView(event)),
      recentEvents: report.recentEvents || [],
      recentBlockedSetups: report.recentBlockedSetups || [],
      recentResearchRuns: report.recentResearchRuns || [],
      recentReviews: report.recentReviews || []
    };
  }

  buildDoctorChecks({ report, balance, previewCandidates = [], now = new Date() }) {
    const thresholdMs = Math.max(60_000, (this.config.tradingIntervalSeconds || 60) * 3 * 1000);
    const analysisAgeMs = this.runtime.lastAnalysisAt ? now.getTime() - new Date(this.runtime.lastAnalysisAt).getTime() : Number.POSITIVE_INFINITY;
    const portfolioAgeMs = this.runtime.lastPortfolioUpdateAt ? now.getTime() - new Date(this.runtime.lastPortfolioUpdateAt).getTime() : Number.POSITIVE_INFINITY;
    const balanceDelta = Math.abs((balance?.quoteFree || 0) - (this.runtime.lastKnownBalance || 0));
    const serviceState = summarizeServiceState(this.runtime.service || {}, this.config, now.toISOString());
    const ackAlerts = arr(this.runtime.ops?.alerts?.alerts || []).filter((item) => requiresOperatorAck(item, this.config.botMode));
    const dataRecorderSummary = this.dataRecorder.getSummary();
    const marketHistoryFeed = serviceState.dashboardFeeds?.feeds?.find((item) => item.id === "market_history") || null;
    const signalFlow = summarizeSignalFlow(this.runtime.signalFlow || {});
    const adaptation = summarizeAdaptationHealth(this.runtime.adaptation || this.buildAdaptationHealthSnapshot(now.toISOString()));
    const dataRecorderAgeMs = dataRecorderSummary?.lastRecordAt ? now.getTime() - new Date(dataRecorderSummary.lastRecordAt).getTime() : Number.POSITIVE_INFINITY;
    const recentClosedTrades = arr(this.journal.trades || []).slice(-12);
    const replayCoverage = recentClosedTrades.length
      ? recentClosedTrades.filter((trade) => arr(trade.replayCheckpoints || []).length > 0).length / recentClosedTrades.length
      : 1;
    const checks = [
      {
        id: "analysis_fresh",
        passed: Number.isFinite(analysisAgeMs) && analysisAgeMs <= thresholdMs,
        severity: "high",
        detail: this.runtime.lastAnalysisAt
          ? `Laatste analyse ${Math.round(analysisAgeMs / 1000)}s geleden.`
          : "Nog geen analyse beschikbaar."
      },
      {
        id: "portfolio_snapshot_fresh",
        passed: Number.isFinite(portfolioAgeMs) && portfolioAgeMs <= thresholdMs,
        severity: "high",
        detail: this.runtime.lastPortfolioUpdateAt
          ? `Portfolio snapshot ${Math.round(portfolioAgeMs / 1000)}s geleden.`
          : "Nog geen portfolio snapshot beschikbaar."
      },
      {
        id: "balance_snapshot_synced",
        passed: balanceDelta <= 0.01,
        severity: "medium",
        detail: `Broker balance delta ${num(balanceDelta, 2)} USD.`
      },
      {
        id: "service_watchdog_healthy",
        passed: serviceState.watchdogStatus !== "degraded",
        severity: "high",
        detail: `Service watchdog status ${serviceState.watchdogStatus}.`
      },
      {
        id: "service_heartbeat_fresh",
        passed: !serviceState.heartbeatStale,
        severity: "high",
        detail: serviceState.lastHeartbeatAt
          ? `Service heartbeat ${num(serviceState.heartbeatAgeSeconds || 0, 1)}s geleden.`
          : "Service heartbeat nog niet beschikbaar."
      },
      {
        id: "bootstrap_components_ready",
        passed: !serviceState.bootstrapDegraded,
        severity: "high",
        detail: serviceState.bootstrapWarningCount
          ? `${serviceState.bootstrapWarningCount} bootstrap warning(s): ${serviceState.initWarnings.map((item) => item.type).join(", ")}.`
          : "Geen bootstrap warnings gedetecteerd."
      },
      {
        id: "operator_alerts_acknowledged",
        passed: ackAlerts.length === 0,
        severity: "medium",
        detail: ackAlerts.length
          ? `${ackAlerts.length} alert(s) vereisen operator-ack.`
          : "Geen open alerts met operator-ack vereist."
      },
      {
        id: "report_exposure_finite",
        passed: Number.isFinite(report.openExposure || 0),
        severity: "high",
        detail: `Open exposure ${num(report.openExposure || 0, 2)} USD.`
      },
      {
        id: "data_recorder_fresh",
        passed: !this.config.dataRecorderEnabled || (Number.isFinite(dataRecorderAgeMs) && dataRecorderAgeMs <= thresholdMs * 2),
        severity: "medium",
        detail: !this.config.dataRecorderEnabled
          ? "Data recorder uitgeschakeld."
          : dataRecorderSummary?.lastRecordAt
            ? `Laatste recorder-frame ${Math.round(dataRecorderAgeMs / 1000)}s geleden.`
            : "Nog geen data-recorder frames beschikbaar."
      },
      {
        id: "dashboard_feed_market_history",
        passed: !marketHistoryFeed || !["failed", "degraded"].includes(marketHistoryFeed.status),
        severity: "medium",
        detail: !marketHistoryFeed
          ? "Nog geen dashboard-feed status voor market history."
          : marketHistoryFeed.status === "failed"
            ? `Market history refresh faalde: ${marketHistoryFeed.lastError || "unknown error"}.`
            : marketHistoryFeed.status === "degraded"
              ? `Market history snapshot is stale na ${num(marketHistoryFeed.ageSeconds || 0, 1)}s.`
              : `Market history feed ${marketHistoryFeed.status}.`
      },
      {
        id: "trade_replay_coverage",
        passed: recentClosedTrades.length < 3 || replayCoverage >= 0.5,
        severity: "low",
        detail: `${Math.round(replayCoverage * 100)}% replay coverage over ${recentClosedTrades.length} recente trades.`
      },
      {
        id: "preview_candidates_available",
        passed: Array.isArray(previewCandidates),
        severity: "low",
        detail: `${previewCandidates.length || 0} read-only preview candidates berekend.`
      },
      {
        id: "paper_signal_flow",
        passed: (this.config.botMode || "paper") !== "paper" || (signalFlow.consecutiveCyclesWithSignalsNoPaperTrade || 0) < (this.config.paperSilentFailureCycleThreshold || 3),
        severity: "medium",
        detail: (this.config.botMode || "paper") !== "paper"
          ? "Signal-flow stall check is alleen relevant in paper mode."
          : `${signalFlow.consecutiveCyclesWithSignalsNoPaperTrade || 0} opeenvolgende cycles met signalen maar zonder paper fill.`
      },
      {
        id: "adaptive_learning_recent",
        passed: adaptation.status !== "stalled",
        severity: "medium",
        detail: adaptation.lastLearningTradeAt
          ? `Laatste leertrade ${num(adaptation.learningAgeHours || 0, 1)}u geleden; status ${adaptation.status}.`
          : "Nog geen leerbare closed trades om online adaptatie te voeden."
      }
    ];
    const blockingFailures = checks.filter((item) => !item.passed && item.severity === "high");
    const warningFailures = checks.filter((item) => !item.passed && item.severity !== "high");
    return {
      status: blockingFailures.length
        ? "blocked"
        : warningFailures.length
          ? "degraded"
          : "ready",
      checkedAt: now.toISOString(),
      checks
    };
  }

  noteBootstrapWarning(type, error, at = nowIso()) {
    this.runtime.service = this.runtime.service || {};
    const warnings = arr(this.runtime.service.initWarnings || []);
    const nextWarning = {
      type: type || "bootstrap_warning",
      error: error?.message || error || null,
      at
    };
    const deduped = warnings.filter((item) => item?.type !== nextWarning.type);
    this.runtime.service.initWarnings = [...deduped, nextWarning].slice(-6);
  }

  ensureDashboardFeedState(feedId) {
    this.runtime.service = this.runtime.service || {};
    this.runtime.service.dashboardFeeds = this.runtime.service.dashboardFeeds || {};
    this.runtime.service.dashboardFeeds[feedId] = {
      status: this.runtime.service.dashboardFeeds[feedId]?.status || "idle",
      lastAttemptAt: this.runtime.service.dashboardFeeds[feedId]?.lastAttemptAt || null,
      lastSuccessAt: this.runtime.service.dashboardFeeds[feedId]?.lastSuccessAt || null,
      lastError: this.runtime.service.dashboardFeeds[feedId]?.lastError || null,
      successCount: this.runtime.service.dashboardFeeds[feedId]?.successCount || 0,
      failureCount: this.runtime.service.dashboardFeeds[feedId]?.failureCount || 0,
      lastDurationMs: this.runtime.service.dashboardFeeds[feedId]?.lastDurationMs ?? null,
      context: this.runtime.service.dashboardFeeds[feedId]?.context || null
    };
    return this.runtime.service.dashboardFeeds[feedId];
  }

  noteDashboardFeedSuccess(feedId, { at = nowIso(), durationMs = null, context = null } = {}) {
    const feed = this.ensureDashboardFeedState(feedId);
    const recovered = ["failed", "degraded"].includes(feed.status);
    feed.status = "ready";
    feed.lastAttemptAt = at;
    feed.lastSuccessAt = at;
    feed.lastError = null;
    feed.successCount = (feed.successCount || 0) + 1;
    feed.lastDurationMs = Number.isFinite(durationMs) ? num(durationMs, 1) : null;
    feed.context = context || null;
    if (recovered) {
      this.logger?.info?.("Dashboard feed recovered", { feedId, context, durationMs: feed.lastDurationMs });
      this.recordEvent("dashboard_feed_recovered", {
        feedId,
        context,
        durationMs: feed.lastDurationMs
      });
    }
    return feed;
  }

  noteDashboardFeedFailure(feedId, error, { at = nowIso(), durationMs = null, context = null } = {}) {
    const feed = this.ensureDashboardFeedState(feedId);
    const message = error?.message || `${error || "unknown_error"}`;
    const shouldLog = feed.status !== "failed" || feed.lastError !== message;
    feed.status = "failed";
    feed.lastAttemptAt = at;
    feed.lastError = message;
    feed.failureCount = (feed.failureCount || 0) + 1;
    feed.lastDurationMs = Number.isFinite(durationMs) ? num(durationMs, 1) : null;
    feed.context = context || null;
    if (shouldLog) {
      this.logger?.warn?.("Dashboard feed failed", { feedId, context, error: message });
      this.recordEvent("dashboard_feed_failed", {
        feedId,
        context,
        error: message
      });
    }
    return feed;
  }

  async maybeRepairMarketHistoryCoverage({ summaries = [], referenceNow = nowIso(), context = "runtime" } = {}) {
    const repairEnabled = this.config.historyCacheEnabled !== false && this.config.historyAutoRepairEnabled !== false;
    const repairState = {
      status: "idle",
      context,
      attemptedCount: 0,
      repairedCount: 0,
      failedCount: 0,
      skippedDueCooldownCount: 0,
      attemptedSymbols: [],
      repairedSymbols: [],
      failedSymbols: [],
      lastRunAt: referenceNow,
      note: repairEnabled ? "Geen history repair nodig." : "History auto-repair is uitgeschakeld."
    };
    this.runtime.ops = this.runtime.ops || {};
    const persistedRepairState = this.runtime.ops.marketHistoryRepair || {};
    const perSymbolState = persistedRepairState.symbols || {};
    if (!repairEnabled) {
      this.runtime.ops.marketHistoryRepair = {
        ...persistedRepairState,
        ...repairState,
        symbols: perSymbolState
      };
      return repairState;
    }
    const cooldownMinutes = Math.max(5, Number(this.config.historyAutoRepairCooldownMinutes || 30));
    const cooldownMs = cooldownMinutes * 60_000;
    const maxRepairSymbols = Math.max(0, resolveHistoryAutoRepairBudget(this.config, context));
    const targetCount = Math.max(
      Number(this.config.klineLimit || 180),
      Math.min(Number(this.config.researchTrainCandles || 240), 240)
    );
    const nowMs = new Date(referenceNow).getTime();
    const candidates = arr(summaries)
      .map((item, index) => ({
        ...item,
        index,
        repairPriority: !(item.count > 0)
          ? 3
          : (item.gapCount || 0) > 0
            ? 2
            : item.stale
              ? 1
              : 0
      }))
      .filter((item) => item.repairPriority > 0);
    const dueCandidates = [];
    for (const item of candidates) {
      const lastAttemptAt = perSymbolState[item.symbol]?.lastAttemptAt || null;
      const lastAttemptMs = lastAttemptAt ? new Date(lastAttemptAt).getTime() : 0;
      if (lastAttemptMs && Number.isFinite(lastAttemptMs) && (nowMs - lastAttemptMs) < cooldownMs) {
        repairState.skippedDueCooldownCount += 1;
        continue;
      }
      dueCandidates.push(item);
    }
    const selected = dueCandidates
      .sort((left, right) => {
        const priorityDelta = (right.repairPriority || 0) - (left.repairPriority || 0);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        const focusSourceRank = (item) => item.historyFocus?.primarySource === "blocked"
          ? 3
          : item.historyFocus?.primarySource === "decision"
            ? 2
            : item.historyFocus?.primarySource === "replay"
              ? 1
              : 0;
        const focusDelta = focusSourceRank(right) - focusSourceRank(left);
        if (focusDelta !== 0) {
          return focusDelta;
        }
        const focusScoreDelta = (right.historyFocus?.score || 0) - (left.historyFocus?.score || 0);
        return focusScoreDelta !== 0 ? focusScoreDelta : left.index - right.index;
      })
      .slice(0, maxRepairSymbols);
    if (!selected.length) {
      const budgetBlocked = maxRepairSymbols === 0 && dueCandidates.length > 0;
      repairState.status = budgetBlocked
        ? "deferred"
        : repairState.skippedDueCooldownCount
          ? "cooldown"
          : "idle";
      repairState.note = budgetBlocked
        ? `History repair is uitgesteld voor ${titleize(context)}; runtime-cycles warmen deze dekking verder op.`
        : repairState.skippedDueCooldownCount
          ? `History repair wacht nog op cooldown voor ${repairState.skippedDueCooldownCount} symbolen.`
          : "Geen history repair nodig.";
      this.runtime.ops.marketHistoryRepair = {
        ...persistedRepairState,
        ...repairState,
        symbols: perSymbolState
      };
      return repairState;
    }
    repairState.status = "repairing";
    repairState.focusedSymbols = selected.map((item) => ({
      symbol: item.symbol,
      source: item.historyFocus?.primarySource || null,
      score: num(item.historyFocus?.score || 0, 4)
    }));
    for (const item of selected) {
      repairState.attemptedCount += 1;
      repairState.attemptedSymbols.push(item.symbol);
      perSymbolState[item.symbol] = {
        ...(perSymbolState[item.symbol] || {}),
        lastAttemptAt: referenceNow,
        lastContext: context,
        lastRequestedPriority: item.repairPriority
      };
      try {
        await backfillHistoricalCandles({
          config: this.config,
          logger: this.logger,
          symbol: item.symbol,
          interval: this.config.klineInterval,
          targetCount,
          client: this.client,
          store: this.historyStore,
          refreshLatest: true
        });
        repairState.repairedCount += 1;
        repairState.repairedSymbols.push(item.symbol);
        perSymbolState[item.symbol] = {
          ...perSymbolState[item.symbol],
          lastSuccessAt: referenceNow,
          lastError: null
        };
      } catch (error) {
        repairState.failedCount += 1;
        repairState.failedSymbols.push(item.symbol);
        perSymbolState[item.symbol] = {
          ...perSymbolState[item.symbol],
          lastError: error?.message || "unknown error"
        };
      }
    }
    repairState.status = repairState.failedCount && !repairState.repairedCount
      ? "failed"
      : repairState.repairedCount
        ? "repaired"
        : "repairing";
    const leadFocus = repairState.focusedSymbols[0] || null;
    repairState.note = repairState.repairedCount
      ? `${repairState.repairedCount} history-symbolen kregen een auto-repair poging vanuit ${titleize(context)}${leadFocus?.source ? ` met ${leadFocus.source}-focus eerst` : ""}.`
      : repairState.failedCount
        ? `History repair faalde voor ${repairState.failedCount} symbolen.`
        : "Geen history repair nodig.";
    this.runtime.ops.marketHistoryRepair = {
      ...persistedRepairState,
      ...repairState,
      symbols: perSymbolState
    };
    return repairState;
  }

  async safeRefreshMarketHistorySnapshot({ symbols = null, referenceNow = nowIso(), context = "runtime" } = {}) {
    const startedAt = Date.now();
    try {
      const result = await this.refreshMarketHistorySnapshot({ symbols, referenceNow, context });
      this.noteDashboardFeedSuccess("market_history", {
        at: referenceNow,
        durationMs: Date.now() - startedAt,
        context
      });
      return result;
    } catch (error) {
      this.noteDashboardFeedFailure("market_history", error, {
        at: referenceNow,
        durationMs: Date.now() - startedAt,
        context
      });
      return summarizeMarketHistory(this.runtime.marketHistory || {});
    }
  }

  async refreshMarketHistorySnapshot({ symbols = null, referenceNow = nowIso(), context = "runtime" } = {}) {
    if (this.config.historyCacheEnabled === false) {
      this.runtime.marketHistory = summarizeMarketHistory({
        generatedAt: referenceNow,
        interval: this.config.klineInterval,
        status: "disabled",
        selection: {
          explicit: false,
          maxSymbols: 0,
          candidateCount: 0,
          selectedCount: 0,
          openPositionIncludedCount: 0,
          blockedIncludedCount: 0,
          decisionIncludedCount: 0,
          replayIncludedCount: 0,
          recentTradeIncludedCount: 0,
          watchlistIncludedCount: 0,
          omittedCount: 0
        },
        aggregate: { status: "disabled", symbolCount: 0, coveredSymbolCount: 0, staleSymbolCount: 0, gapSymbolCount: 0, uncoveredSymbolCount: 0, partitionedSymbolCount: 0, staleSymbols: [], gapSymbols: [], uncoveredSymbols: [] },
        symbols: {},
        notes: ["History cache staat uit; replay en offline learning gebruiken geen persistente candles."]
      });
      return this.runtime.marketHistory;
    }
    const historyFocus = buildHistoryFocusInputs({
      blockedSetups: arr(this.runtime?.latestBlockedSetups || []),
      decisions: arr(this.runtime?.latestDecisions || []),
      trades: arr(this.journal?.trades || []).slice().reverse(),
      limit: this.config.dashboardDecisionLimit || 12
    });
    const { symbols: selectedSymbols, selection } = resolveMarketHistoryCoverageSymbols({
      symbols,
      watchlist: this.config.watchlist,
      openPositions: this.runtime?.openPositions || [],
      blockedSymbols: historyFocus.blockedSymbols,
      decisionSymbols: historyFocus.decisionSymbols,
      replaySymbols: historyFocus.replaySymbols,
      trades: this.journal?.trades || [],
      maxSymbols: this.config.researchMaxSymbols || this.config.watchlist.length || 12,
      recentTradeLimit: 18
    });
    let summaries = [];
    for (const symbol of selectedSymbols) {
      const summary = await this.historyStore.verifySeries({
        symbol,
        interval: this.config.klineInterval,
        referenceNow,
        freshnessThresholdMultiplier: this.config.historyVerifyFreshnessMultiplier || 4
      });
      summaries.push({
        ...summary,
        historyFocus: historyFocus.focusBySymbol[symbol] || null
      });
    }
    const repair = await this.maybeRepairMarketHistoryCoverage({ summaries, referenceNow, context });
    if (repair.attemptedCount > 0) {
      const repairedSet = new Set(repair.attemptedSymbols);
      const repairedSummaries = new Map();
      for (const symbol of repair.attemptedSymbols) {
        const refreshed = await this.historyStore.verifySeries({
          symbol,
          interval: this.config.klineInterval,
          referenceNow,
          freshnessThresholdMultiplier: this.config.historyVerifyFreshnessMultiplier || 4
        });
        repairedSummaries.set(symbol, {
          ...refreshed,
          historyFocus: historyFocus.focusBySymbol[symbol] || null
        });
      }
      summaries = summaries.map((item) => repairedSet.has(item.symbol) ? (repairedSummaries.get(item.symbol) || item) : item);
    }
    const aggregate = buildMarketHistoryAggregate(summaries);
    this.runtime.marketHistory = summarizeMarketHistory({
      generatedAt: referenceNow,
      interval: this.config.klineInterval,
      status: aggregate.status,
      selection,
      repair,
      aggregate,
      symbols: Object.fromEntries(summaries.map((item) => [item.symbol, item])),
      notes: [
        selection.explicit
          ? `${selection.selectedCount} expliciete history-symbolen gecontroleerd.`
          : `${selection.selectedCount} history-symbolen gecontroleerd (${selection.openPositionIncludedCount} open posities, ${selection.blockedIncludedCount} blocked-focus, ${selection.decisionIncludedCount} focus-decisions, ${selection.replayIncludedCount} replay-focus, ${selection.recentTradeIncludedCount} recente trades, ${selection.watchlistIncludedCount} watchlist).`,
        selection.omittedCount
          ? `${selection.omittedCount} lagere-prioriteit symbolen vallen buiten het huidige history-budget.`
          : "Alle geselecteerde focus-symbolen vallen binnen het huidige history-budget.",
        aggregate.partitionedSymbolCount
          ? `${aggregate.partitionedSymbolCount} symbolen gebruiken al partities in de lokale history-store.`
          : "History-store gebruikt nog geen meerpartitie-dekking voor de huidige symbolen.",
        repair.note || null,
        aggregate.gapSymbolCount
          ? `${aggregate.gapSymbolCount} symbolen hebben nog gaten die backfill of verify vragen.`
          : "Geen openstaande history gaps in de gecontroleerde symbolen.",
        aggregate.staleSymbolCount
          ? `${aggregate.staleSymbolCount} symbolen lopen achter op de verwachte laatste gesloten candle.`
          : "History freshness is gezond voor de gecontroleerde symbolen."
      ].filter(Boolean)
    });
    return this.runtime.marketHistory;
  }

  applyHistoricalBootstrap(bootstrap = null) {
    if (!bootstrap || bootstrap.status === "empty") {
      return;
    }
    const warmStart = bootstrap.warmStart || {};
    const warmStartFresh = warmStart.fresh !== false;
    const existingWarmStart = this.runtime.thresholdTuning?.warmStart || null;
    const existingWarmStartAt = existingWarmStart?.generatedAt ? new Date(existingWarmStart.generatedAt).getTime() : 0;
    const nextWarmStartAt = (warmStart.sourceAt || bootstrap.generatedAt) ? new Date(warmStart.sourceAt || bootstrap.generatedAt).getTime() : 0;
    const shouldReplaceRecorderWarmStart = !existingWarmStart ||
      existingWarmStart.source !== "data_recorder" ||
      nextWarmStartAt >= existingWarmStartAt;
    this.runtime.historicalBootstrap = bootstrap;
    this.runtime.ops = this.runtime.ops || {};
    this.runtime.ops.historicalBootstrap = {
      status: bootstrap.status || "ready",
      generatedAt: bootstrap.generatedAt || null,
      warmStart: warmStart || null,
      stale: !warmStartFresh,
      warmStartApplied: Boolean(warmStartFresh && warmStart.governanceFocus)
    };
    if (!warmStartFresh) {
      if (existingWarmStart?.source === "data_recorder") {
        this.runtime.thresholdTuning = {
          ...(this.runtime.thresholdTuning || {}),
          warmStart: {
            ...existingWarmStart,
            source: "data_recorder",
            focus: null,
            generatedAt: warmStart.sourceAt || bootstrap.generatedAt || existingWarmStart.generatedAt || null,
            stale: true,
            note: warmStart.note || existingWarmStart.note || "Recorder warm start is te oud en is geneutraliseerd."
          }
        };
      }
      return;
    }
    if (!this.runtime.paperLearning || !arr(this.runtime.paperLearning.notes || []).length) {
      this.runtime.paperLearning = {
        ...(this.runtime.paperLearning || {}),
        notes: [warmStart.note].filter(Boolean)
      };
    } else if (warmStart.note) {
      this.runtime.paperLearning.notes = [warmStart.note, ...arr(this.runtime.paperLearning.notes || [])].slice(0, 6);
    }
    if (shouldReplaceRecorderWarmStart) {
      this.runtime.thresholdTuning = {
        ...(this.runtime.thresholdTuning || {}),
        warmStart: {
          source: "data_recorder",
          focus: warmStart.governanceFocus || null,
          generatedAt: warmStart.sourceAt || bootstrap.generatedAt || null,
          stale: false,
          note: warmStart.note || null
        }
      };
    }
  }

  buildRecoveredStateBundle(backup = null, sourceError = null, recoveryMeta = {}) {
    const restoredAt = backup?.at || nowIso();
    const payload = backup?.payload || {};
    const hasRecoverableState = payload && typeof payload === "object" && (payload.runtime || payload.journal || payload.modelState);
    if (!hasRecoverableState) {
      const error = new Error("Geen geldige state-backup beschikbaar voor herstel.");
      error.cause = sourceError || null;
      throw error;
    }
    const runtime = migrateRuntime(payload.runtime || clone(DEFAULT_RUNTIME));
    const journal = migrateJournal(payload.journal || clone(DEFAULT_JOURNAL));
    const modelState = payload.modelState && typeof payload.modelState === "object"
      ? payload.modelState
      : structuredClone(DEFAULT_MODEL);
    const modelBackups = arr(payload.modelBackups || []);
    runtime.recovery = {
      ...(runtime.recovery || {}),
      uncleanShutdownDetected: true,
      restoredFromBackupAt: restoredAt,
      latestBackupAt: restoredAt,
      corruptPrimaryState: recoveryMeta.corruptFilePath || sourceError?.filePath
        ? {
            filePath: recoveryMeta.corruptFilePath || sourceError?.filePath || null,
            kind: recoveryMeta.corruptionKind || sourceError?.corruptionKind || "invalid_json",
            quarantinedTo: recoveryMeta.quarantinePath || null,
            recoveredAt: restoredAt
          }
        : null
    };
    runtime.stateBackups = {
      ...(runtime.stateBackups || {}),
      restoredFromBackupAt: restoredAt,
      lastBackupAt: restoredAt
    };
    runtime.service = runtime.service && typeof runtime.service === "object" ? runtime.service : {};
    runtime.service.initWarnings = arr(runtime.service.initWarnings || []);
    if (recoveryMeta.corruptFilePath || sourceError?.filePath) {
      runtime.service.initWarnings.unshift(
        `Corrupt primary state recovered from backup: ${(recoveryMeta.corruptFilePath || sourceError?.filePath || "unknown").split(/[\\\\/]/).at(-1)}`
      );
      runtime.service.initWarnings = runtime.service.initWarnings.slice(0, 8);
    }
    journal.events = arr(journal.events);
    journal.events.push({
      at: restoredAt,
      type: "state_restored_from_backup",
      reason: sourceError?.message || "corrupt_primary_state",
      filePath: recoveryMeta.corruptFilePath || sourceError?.filePath || null,
      corruptionKind: recoveryMeta.corruptionKind || sourceError?.corruptionKind || null,
      quarantinedTo: recoveryMeta.quarantinePath || null
    });
    return {
      runtime,
      journal,
      modelState,
      modelBackups,
      restoredFromBackupAt: restoredAt
    };
  }

  recoverStaleLifecycleActions(reason = "restart_recovery", at = nowIso()) {
    const recoveryActive = Boolean(this.runtime?.recovery?.uncleanShutdownDetected || this.runtime?.recovery?.restoredFromBackupAt);
    if (!recoveryActive) {
      return false;
    }
    const lifecycle = this.runtime.orderLifecycle || { lastUpdatedAt: null, positions: {}, recentTransitions: [], pendingActions: [], activeActions: {}, actionJournal: [] };
    const activeActions = lifecycle.activeActions && typeof lifecycle.activeActions === "object" ? lifecycle.activeActions : {};
    const activeEntries = Object.entries(activeActions);
    if (!activeEntries.length) {
      lifecycle.activeActionsPrevious = lifecycle.activeActionsPrevious && typeof lifecycle.activeActionsPrevious === "object"
        ? lifecycle.activeActionsPrevious
        : {};
      this.runtime.orderLifecycle = lifecycle;
      return false;
    }
    const previous = lifecycle.activeActionsPrevious && typeof lifecycle.activeActionsPrevious === "object"
      ? { ...lifecycle.activeActionsPrevious }
      : {};
    for (const [actionId, action] of activeEntries) {
      previous[actionId] = {
        ...action,
        staleAt: at,
        recoveryOrigin: reason,
        recoveryAction: action?.recoveryAction || resolveLifecycleRecoveryAction(action?.stage || "reconcile_required", action, action)
      };
    }
    lifecycle.activeActionsPrevious = previous;
    lifecycle.activeActions = {};
    lifecycle.pendingActions = [];
    this.runtime.orderLifecycle = lifecycle;
    this.journal = this.journal || { events: [] };
    this.journal.events = arr(this.journal.events || []);
    this.journal.events.push({
      at,
      type: "lifecycle_actions_recovered_after_restart",
      reason,
      count: activeEntries.length
    });
    return true;
  }

  async loadPersistedStateWithBackupFallback() {
    try {
      return {
        runtime: await this.store.loadRuntime(),
        modelBackups: arr(await this.store.loadModelBackups()),
        journal: await this.store.loadJournal(),
        modelState: await this.store.loadModel(),
        restoredFromBackupAt: null
      };
    } catch (error) {
      if (!isCorruptStateLoadError(error)) {
        throw error;
      }
      const corruptFilePath = error?.filePath || null;
      const corruptionKind = error?.corruptionKind || "invalid_json";
      this.logger?.warn?.("Primary state load failed, attempting backup restore", {
        error: error.message,
        filePath: corruptFilePath,
        corruptionKind
      });
      let quarantinePath = null;
      if (corruptFilePath) {
        try {
          quarantinePath = await this.store.quarantineCorruptFile(corruptFilePath);
          if (quarantinePath) {
            this.logger?.warn?.("Corrupt primary state file quarantined", {
              filePath: corruptFilePath,
              quarantinedTo: quarantinePath,
              corruptionKind
            });
          }
        } catch (quarantineError) {
          this.logger?.warn?.("Corrupt primary state file could not be quarantined", {
            filePath: corruptFilePath,
            error: quarantineError.message
          });
        }
      }
      const backup = await this.backupManager.loadLatestBackup();
      const recovered = this.buildRecoveredStateBundle(backup, error, {
        corruptFilePath,
        corruptionKind,
        quarantinePath
      });
      try {
        await this.store.saveRuntime(recovered.runtime);
        await this.store.saveJournal(recovered.journal);
        await this.store.saveModel(recovered.modelState);
        await this.store.saveModelBackups(recovered.modelBackups);
      } catch (persistError) {
        this.logger?.warn?.("Recovered state could not be persisted immediately", {
          error: persistError.message
        });
      }
      return recovered;
    }
  }

  async init() {
    const validation = assertValidConfig(this.config);
    for (const warning of validation.warnings) {
      this.logger.warn("Configuration warning", { warning });
    }

    await this.store.init();
    try {
      await this.historyStore.init();
    } catch (error) {
      this.logger.warn("Market history initialization failed", { error: error.message });
      this.noteBootstrapWarning("market_history_init_failed", error);
    }
    try {
      await this.backupManager.init(null);
    } catch (error) {
      this.logger.warn("State backup initialization failed", { error: error.message });
      this.noteBootstrapWarning("state_backup_init_failed", error);
    }
    const persistedState = await this.loadPersistedStateWithBackupFallback();
    this.runtime = persistedState.runtime;
    this.runtime.openPositions = arr(this.runtime.openPositions);
    this.runtime.latestDecisions = arr(this.runtime.latestDecisions);
    this.runtime.newsCache = this.runtime.newsCache || {};
    this.runtime.exchangeNoticeCache = this.runtime.exchangeNoticeCache || {};
    this.runtime.marketStructureCache = this.runtime.marketStructureCache || {};
    this.runtime.externalFeedHealth = this.runtime.externalFeedHealth || {};
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
    this.runtime.signalFlow = this.runtime.signalFlow || {
      symbolsScanned: 0,
      candidatesScored: 0,
      generatedSignals: 0,
      rejectedSignals: 0,
      allowedSignals: 0,
      entriesAttempted: 0,
      entriesExecuted: 0,
      entriesPersisted: 0,
      entriesPersistFailed: 0,
      paperTradesAttempted: 0,
      paperTradesExecuted: 0,
      paperTradesPersisted: 0,
      rejectionReasons: {},
      rejectionCategories: {},
      consecutiveCyclesWithSignalsNoPaperTrade: 0,
      lastCycle: {}
    };
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
    this.runtime.ops.signalFlow = this.runtime.ops.signalFlow || summarizeSignalFlow(this.runtime.signalFlow || {});
    this.runtime.service = this.runtime.service || { lastHeartbeatAt: null, watchdogStatus: "idle", restartBackoffSeconds: null, lastExitCode: null, statusFile: null, initWarnings: [] };
    this.runtime.service.initWarnings = arr(this.runtime.service.initWarnings || []);
    this.runtime.service.dashboardFeeds = this.runtime.service.dashboardFeeds || {};
    this.runtime.marketHistory = summarizeMarketHistory(this.runtime.marketHistory || {});
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
    this.modelBackups = arr(persistedState.modelBackups);
    this.journal = persistedState.journal;
    this.journal.trades = arr(this.journal.trades);
    this.journal.scaleOuts = arr(this.journal.scaleOuts);
    this.journal.blockedSetups = arr(this.journal.blockedSetups);
    this.journal.universeRuns = arr(this.journal.universeRuns);
    this.journal.researchRuns = arr(this.journal.researchRuns);
    this.journal.counterfactuals = arr(this.journal.counterfactuals);
    this.journal.equitySnapshots = arr(this.journal.equitySnapshots);
    this.journal.cycles = arr(this.journal.cycles);
    this.journal.events = arr(this.journal.events);
    const recoveredLifecycleActions = this.recoverStaleLifecycleActions(
      persistedState.restoredFromBackupAt ? "backup_restore" : "unclean_restart"
    );
    if (recoveredLifecycleActions) {
      this.syncOrderLifecycleState("restart_recovery");
    }

    let historicalBootstrap = null;
    try {
      await this.dataRecorder.init(this.runtime.dataRecorder || null);
      historicalBootstrap = await this.dataRecorder.loadHistoricalBootstrap();
    } catch (error) {
      this.logger.warn("Data recorder initialization failed", { error: error.message });
      this.noteBootstrapWarning("data_recorder_init_failed", error);
    }
    try {
      await this.backupManager.init(this.runtime.stateBackups || null);
      if (persistedState.restoredFromBackupAt) {
        await this.backupManager.noteRestore(persistedState.restoredFromBackupAt);
      }
    } catch (error) {
      this.logger.warn("State backup restore initialization failed", { error: error.message });
      this.noteBootstrapWarning("state_backup_restore_init_failed", error);
    }
    this.applyHistoricalBootstrap(historicalBootstrap);
    const marketHistoryRefreshAt = nowIso();
    try {
      await this.refreshMarketHistorySnapshot({ referenceNow: marketHistoryRefreshAt });
      this.noteDashboardFeedSuccess("market_history", {
        at: marketHistoryRefreshAt,
        context: "bootstrap"
      });
    } catch (error) {
      this.logger.warn("Market history snapshot refresh failed", { error: error.message });
      this.noteBootstrapWarning("market_history_snapshot_failed", error);
      this.noteDashboardFeedFailure("market_history", error, {
        at: marketHistoryRefreshAt,
        context: "bootstrap"
      });
    }
    this.runtime.dataRecorder = this.dataRecorder.getSummary();
    this.runtime.stateBackups = this.backupManager.getSummary();
    this.model = new AdaptiveTradingModel(persistedState.modelState, this.config);
    this.rlPolicy = new ReinforcementExecutionPolicy(this.runtime.executionPolicyState, this.config);
    this.referenceVenue.setRuntime?.(this.runtime);
    this.strategyResearchMiner.setRuntime?.(this.runtime);
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
          logger: this.logger,
          runtime: this.runtime
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
      this.noteBootstrapWarning("stream_init_failed", error);
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
    this.refreshOperationalViews({ report: this.getPerformanceReport(), nowIso: nowIso() });
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
    const entryStyle = candidate.decision?.executionPlan?.entryStyle || candidate.decision?.executionStyle || null;
    const expectedSlippageBps = num(candidate.decision?.executionPlan?.expectedSlippageBps || 0, 2);
    const branchScenarios = [
      {
        id: "base",
        label: "Normale follow-up",
        kind: "baseline"
      },
      {
        id: "smaller_probe",
        label: "Kleinere probe",
        kind: "size",
        sizeMultiplier: 0.5
      },
      {
        id: "maker_bias",
        label: "Maker-uitvoering",
        kind: "execution",
        slippageBps: Math.max(0, expectedSlippageBps - 3)
      },
      {
        id: "earlier_take_profit",
        label: "Snellere exit",
        kind: "exit",
        takeProfitFactor: 0.65
      },
      {
        id: "market_entry",
        label: "Market-entry",
        kind: "execution",
        slippageBps: Math.max(expectedSlippageBps + 3, 3)
      },
      {
        id: "tighter_stop",
        label: "Strakkere stop",
        kind: "risk",
        stopLossFactor: 0.72
      },
      {
        id: "longer_hold",
        label: "Langer vasthouden",
        kind: "hold",
        holdBiasPct: 0.0035
      }
    ];
    this.runtime.counterfactualQueue = [...(this.runtime.counterfactualQueue || []), {
      id: crypto.randomUUID(),
      symbol: candidate.symbol,
      brokerMode: this.config.botMode,
      queuedAt,
      dueAt,
      entryPrice,
      probability: candidate.score?.probability || 0,
      threshold: candidate.decision?.threshold || 0,
      strategy: candidate.strategySummary?.activeStrategy || null,
      strategyFamily: candidate.strategySummary?.family || null,
      regime: candidate.regimeSummary?.regime || null,
      marketPhase: candidate.marketStateSummary?.phase || null,
      sessionAtEntry: candidate.sessionSummary?.session || null,
      blockerReasons: [...(candidate.decision?.reasons || [])].slice(0, 6),
      learningLane: candidate.decision?.learningLane || null,
      learningValueScore: num(candidate.decision?.learningValueScore || 0, 4),
      executionStyle: entryStyle,
      signalQuality: candidate.signalQualitySummary?.overallScore || 0,
      executionViability: candidate.signalQualitySummary?.executionViability || 0,
      modelConfidence: candidate.confidenceBreakdown?.modelConfidence || 0,
      expectedSlippageBps,
      branchScenarios
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
    const retryPending = [...pending];
    for (const item of due) {
      try {
        const snapshot = snapshotMap[item.symbol] || this.marketCache[item.symbol] || await this.getMarketSnapshot(item.symbol);
        const currentPrice = Number(snapshot?.book?.mid || 0);
        if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(item.entryPrice) || item.entryPrice <= 0) {
          const retryCount = (item.retryCount || 0) + 1;
          if (retryCount <= 3) {
            retryPending.push({
              ...item,
              retryCount,
              lastError: "invalid_counterfactual_snapshot",
              dueAt: new Date(new Date(nowAt).getTime() + 5 * 60000).toISOString()
            });
            continue;
          }
          this.journal.counterfactuals.push({
            ...item,
            resolvedAt: nowAt,
            outcome: "resolution_failed",
            resolutionFailed: true,
            error: "invalid_counterfactual_snapshot",
            branches: arr(item.branchScenarios || []).map((branch) => ({
              id: branch.id || branch.kind || "branch",
              label: branch.label || branch.id || "Alternatief",
              kind: branch.kind || "baseline",
              outcome: "unresolved",
              adjustedMovePct: null
            }))
          });
          this.markReportDirty();
          this.recordEvent("counterfactual_resolution_failed", { symbol: item.symbol, error: "invalid_counterfactual_snapshot" });
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
        const branches = arr(item.branchScenarios).map((branch) => {
          let adjustedMovePct = realizedMovePct;
          if (branch.kind === "size") {
            adjustedMovePct *= branch.sizeMultiplier || 1;
          } else if (branch.kind === "execution") {
            adjustedMovePct += Math.max(0, (item.expectedSlippageBps || 0) - (branch.slippageBps || 0)) / 10000;
          } else if (branch.kind === "exit") {
            adjustedMovePct = Math.min(realizedMovePct, winBar * (branch.takeProfitFactor || 1));
          } else if (branch.kind === "risk") {
            if (adjustedMovePct < 0) {
              adjustedMovePct = Math.max(adjustedMovePct, lossBar * (branch.stopLossFactor || 1));
            }
          } else if (branch.kind === "hold") {
            if (adjustedMovePct > 0) {
              adjustedMovePct += branch.holdBiasPct || 0;
            } else if (adjustedMovePct > lossBar * 0.5) {
              adjustedMovePct += (branch.holdBiasPct || 0) * 0.35;
            }
          }
          const branchOutcome = adjustedMovePct >= winBar
            ? "winner"
            : adjustedMovePct <= lossBar
              ? "loser"
              : adjustedMovePct > 0
                ? "small_winner"
                : "flat";
          return {
            id: branch.id || branch.kind || "branch",
            label: branch.label || branch.id || "Alternatief",
            kind: branch.kind || "baseline",
            adjustedMovePct: num(adjustedMovePct, 4),
            outcome: branchOutcome
          };
        });
        this.journal.counterfactuals.push({
          ...item,
          resolvedAt: nowAt,
          currentPrice,
          realizedMovePct: num(realizedMovePct, 4),
          outcome,
          branches
        });
        this.markReportDirty();
      } catch (error) {
        const retryCount = (item.retryCount || 0) + 1;
        if (retryCount <= 3) {
          retryPending.push({
            ...item,
            retryCount,
            lastError: error.message,
            dueAt: new Date(new Date(nowAt).getTime() + 5 * 60000).toISOString()
          });
          continue;
        }
        this.journal.counterfactuals.push({
          ...item,
          resolvedAt: nowAt,
          outcome: "resolution_failed",
          resolutionFailed: true,
          error: error.message,
          branches: arr(item.branchScenarios || []).map((branch) => ({
            id: branch.id || branch.kind || "branch",
            label: branch.label || branch.id || "Alternatief",
            kind: branch.kind || "baseline",
            outcome: "unresolved",
            adjustedMovePct: null
          }))
        });
        this.markReportDirty();
        this.recordEvent("counterfactual_resolution_failed", { symbol: item.symbol, error: error.message });
      }
    }
    this.runtime.counterfactualQueue = retryPending.slice(-(this.config.counterfactualQueueLimit || 40));
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
    this.syncOrderLifecycleState("shutdown");
    this.refreshOperationalViews({ nowIso: nowIso() });
    await this.backupManager.maybeBackup({
      runtime: this.runtime,
      journal: this.journal,
      modelState: this.model.getState(),
      modelBackups: this.modelBackups,
      modelRegistry: this.runtime.modelRegistry
    }, { reason: "shutdown", force: true, nowIso: nowIso() }).catch((error) => {
      this.logger?.warn?.("Shutdown backup failed", { error: error.message });
    });
    this.runtime.stateBackups = this.backupManager.getSummary();
    await this.persist().catch((error) => {
      this.logger?.warn?.("Shutdown persist failed", { error: error.message });
    });
    await this.stream.close().catch((error) => {
      this.logger?.warn?.("Stream shutdown failed", { error: error.message });
    });
  }

  async persist() {
    this.runtime.stream = this.stream.getStatus();
    this.runtime.executionPolicyState = this.rlPolicy.getState();
    this.runtime.dataRecorder = this.dataRecorder.getSummary();
    this.runtime.stateBackups = this.backupManager.getSummary();
    const runtimeSnapshot = structuredClone(this.runtime);
    const journalSnapshot = structuredClone(this.journal);
    const modelSnapshot = structuredClone(this.model.getState());
    const modelBackupsSnapshot = structuredClone(this.modelBackups || []);

    const chainedPersist = (this.persistPromise || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await this.store.saveRuntime(runtimeSnapshot);
        await this.store.saveJournal(journalSnapshot);
        await this.store.saveModel(modelSnapshot);
        await this.store.saveModelBackups(modelBackupsSnapshot);
      });

    this.persistPromise = chainedPersist;
    try {
      await chainedPersist;
    } finally {
      if (this.persistPromise === chainedPersist) {
        this.persistPromise = null;
      }
    }
  }

  recordEvent(type, payload) {
    this.journal.events.push({ at: nowIso(), type, ...payload });
    this.markReportDirty();
  }

  ensureSignalFlowMetrics() {
    this.runtime = this.runtime || {};
    this.runtime.signalFlow = this.runtime.signalFlow || {
      symbolsScanned: 0,
      candidatesScored: 0,
      generatedSignals: 0,
      rejectedSignals: 0,
      allowedSignals: 0,
      entriesAttempted: 0,
      entriesExecuted: 0,
      entriesPersisted: 0,
      entriesPersistFailed: 0,
      paperTradesAttempted: 0,
      paperTradesExecuted: 0,
      paperTradesPersisted: 0,
      rejectionReasons: {},
      rejectionCategories: {},
      consecutiveCyclesWithSignalsNoPaperTrade: 0,
      lastCycle: {},
      notes: []
    };
    this.runtime.signalFlow.rejectionReasons = this.runtime.signalFlow.rejectionReasons || {};
    this.runtime.signalFlow.rejectionCategories = this.runtime.signalFlow.rejectionCategories || {};
    this.runtime.signalFlow.lastCycle = this.runtime.signalFlow.lastCycle || {};
    this.runtime.signalFlow.notes = arr(this.runtime.signalFlow.notes || []);
    return this.runtime.signalFlow;
  }

  noteCandidateSignalFlow(candidates = [], at = nowIso(), { symbolsScanned = null, candidatesScored = null } = {}) {
    const metrics = this.ensureSignalFlowMetrics();
    const rejectionReasons = {};
    const rejectionCategories = {};
    const rejectedCandidates = arr(candidates).filter((candidate) => !candidate?.decision?.allow);
    for (const candidate of rejectedCandidates) {
      const reasons = [...new Set(arr(candidate.decision?.reasons || []).filter(Boolean))];
      const categories = [...new Set(reasons.map(classifySignalRejectionCategory))];
      for (const reason of reasons) {
        incrementCount(metrics.rejectionReasons, reason);
        incrementCount(rejectionReasons, reason);
      }
      for (const category of categories) {
        incrementCount(metrics.rejectionCategories, category);
        incrementCount(rejectionCategories, category);
      }
      this.logger?.info?.("Candidate rejected", {
        symbol: candidate.symbol,
        strategy: candidate.strategySummary?.activeStrategy || null,
        regime: candidate.regimeSummary?.regime || null,
        probability: num(candidate.score?.probability || 0, 4),
        threshold: num(candidate.decision?.threshold || 0, 4),
        quoteAmount: num(candidate.decision?.quoteAmount || 0, 2),
        entryMode: candidate.decision?.entryMode || "standard",
        reasons,
        rejectionCategories: categories
      });
    }
    const scannedCount = Number.isFinite(symbolsScanned) ? Math.max(0, symbolsScanned) : candidates.length;
    const scoredCount = Number.isFinite(candidatesScored) ? Math.max(0, candidatesScored) : candidates.length;
    metrics.symbolsScanned += scannedCount;
    metrics.candidatesScored += scoredCount;
    metrics.generatedSignals += candidates.length;
    metrics.rejectedSignals += rejectedCandidates.length;
    metrics.allowedSignals += Math.max(0, candidates.length - rejectedCandidates.length);
    if (candidates.length) {
      metrics.lastGeneratedAt = at;
    }
    if (rejectedCandidates.length) {
      metrics.lastRejectedAt = at;
    }
    metrics.lastCycle = {
      at,
      symbolsScanned: scannedCount,
      candidatesScored: scoredCount,
      generatedSignals: candidates.length,
      rejectedSignals: rejectedCandidates.length,
      allowedSignals: Math.max(0, candidates.length - rejectedCandidates.length),
      entriesAttempted: 0,
      entriesExecuted: 0,
      entriesPersisted: 0,
      entriesPersistFailed: 0,
      paperTradesAttempted: 0,
      paperTradesExecuted: 0,
      paperTradesPersisted: 0,
      entryStatus: "idle",
      openedSymbol: null,
      rejectionReasons,
      rejectionCategories
    };
    metrics.notes = [
      candidates.length
        ? `${candidates.length} signalen geëvalueerd uit ${scannedCount} gescande symbols.`
        : "Geen signalen geëvalueerd in de laatste cycle.",
      rejectedCandidates.length
        ? `${rejectedCandidates.length} signalen afgewezen; topcategorie ${summarizeCountMap(rejectionCategories, 1)[0]?.id || "unknown"}.`
        : "Geen signalen afgewezen in de laatste cycle."
    ].filter(Boolean);
    if (this.runtime.ops) {
      const summary = summarizeSignalFlow(metrics);
      this.runtime.ops.signalFlow = summary;
      this.runtime.ops.tradingFlowHealth = summary.tradingFlowHealth;
    }
    this.markReportDirty();
    return metrics;
  }

  noteEntryAttempt({ candidate = {}, at = nowIso() } = {}) {
    const metrics = this.ensureSignalFlowMetrics();
    metrics.entriesAttempted += 1;
    metrics.lastEntryAttemptAt = at;
    metrics.lastCycle = {
      ...(metrics.lastCycle || {}),
      entriesAttempted: (metrics.lastCycle?.entriesAttempted || 0) + 1
    };
    if (this.runtime.ops) {
      const summary = summarizeSignalFlow(metrics);
      this.runtime.ops.signalFlow = summary;
      this.runtime.ops.tradingFlowHealth = summary.tradingFlowHealth;
    }
    this.markReportDirty();
    return metrics;
  }

  noteEntryExecuted({ candidate = {}, position = null, at = nowIso() } = {}) {
    const metrics = this.ensureSignalFlowMetrics();
    metrics.entriesExecuted += 1;
    metrics.lastEntryExecutedAt = at;
    metrics.lastCycle = {
      ...(metrics.lastCycle || {}),
      entriesExecuted: (metrics.lastCycle?.entriesExecuted || 0) + 1,
      openedSymbol: position?.symbol || candidate.symbol || null
    };
    if (this.runtime.ops) {
      const summary = summarizeSignalFlow(metrics);
      this.runtime.ops.signalFlow = summary;
      this.runtime.ops.tradingFlowHealth = summary.tradingFlowHealth;
    }
    this.markReportDirty();
    return metrics;
  }

  noteEntryPersisted({ position = null, at = nowIso() } = {}) {
    if (!position) {
      return this.ensureSignalFlowMetrics();
    }
    const metrics = this.ensureSignalFlowMetrics();
    metrics.entriesPersisted += 1;
    metrics.lastEntryPersistedAt = at;
    metrics.lastCycle = {
      ...(metrics.lastCycle || {}),
      entriesPersisted: (metrics.lastCycle?.entriesPersisted || 0) + 1
    };
    this.recordEvent("entry_persisted", {
      symbol: position.symbol,
      positionId: position.id || null,
      brokerMode: position.brokerMode || this.config.botMode
    });
    if (this.runtime.ops) {
      const summary = summarizeSignalFlow(metrics);
      this.runtime.ops.signalFlow = summary;
      this.runtime.ops.tradingFlowHealth = summary.tradingFlowHealth;
    }
    return metrics;
  }

  noteEntryPersistFailed({ symbol = null, position = null, error = null, at = nowIso() } = {}) {
    const metrics = this.ensureSignalFlowMetrics();
    metrics.entriesPersistFailed += 1;
    metrics.lastEntryPersistFailedAt = at;
    metrics.lastCycle = {
      ...(metrics.lastCycle || {}),
      entriesPersistFailed: (metrics.lastCycle?.entriesPersistFailed || 0) + 1
    };
    this.recordEvent("entry_persist_failed", {
      symbol: symbol || position?.symbol || null,
      positionId: position?.id || null,
      error: error?.message || `${error || "unknown_error"}`
    });
    if (this.runtime.ops) {
      const summary = summarizeSignalFlow(metrics);
      this.runtime.ops.signalFlow = summary;
      this.runtime.ops.tradingFlowHealth = summary.tradingFlowHealth;
    }
    this.markReportDirty();
    return metrics;
  }

  notePaperTradeAttempt({ candidate = {}, at = nowIso() } = {}) {
    if ((this.config?.botMode || this.runtime?.mode || "paper") !== "paper") {
      return this.ensureSignalFlowMetrics();
    }
    const metrics = this.ensureSignalFlowMetrics();
    metrics.paperTradesAttempted += 1;
    metrics.lastPaperTradeAttemptAt = at;
    metrics.lastCycle = {
      ...(metrics.lastCycle || {}),
      paperTradesAttempted: (metrics.lastCycle?.paperTradesAttempted || 0) + 1
    };
    this.logger?.info?.("Paper trade attempted", {
      symbol: candidate.symbol || null,
      probability: num(candidate.score?.probability || 0, 4),
      threshold: num(candidate.decision?.threshold || 0, 4),
      quoteAmount: num(candidate.decision?.quoteAmount || 0, 2),
      entryMode: candidate.decision?.entryMode || "standard"
    });
    if (this.runtime.ops) {
      const summary = summarizeSignalFlow(metrics);
      this.runtime.ops.signalFlow = summary;
      this.runtime.ops.tradingFlowHealth = summary.tradingFlowHealth;
    }
    this.markReportDirty();
    return metrics;
  }

  notePaperTradeExecuted({ candidate = {}, position = null, at = nowIso() } = {}) {
    if ((this.config?.botMode || this.runtime?.mode || "paper") !== "paper") {
      return this.ensureSignalFlowMetrics();
    }
    const metrics = this.ensureSignalFlowMetrics();
    metrics.paperTradesExecuted += 1;
    metrics.lastPaperTradeExecutedAt = at;
    metrics.lastCycle = {
      ...(metrics.lastCycle || {}),
      paperTradesExecuted: (metrics.lastCycle?.paperTradesExecuted || 0) + 1,
      openedSymbol: position?.symbol || candidate.symbol || null
    };
    this.recordEvent("paper_trade_executed", {
      symbol: position?.symbol || candidate.symbol || null,
      positionId: position?.id || null,
      quoteAmount: num(candidate.decision?.quoteAmount || position?.notional || 0, 2),
      entryMode: candidate.decision?.entryMode || "standard"
    });
    if (this.runtime.ops) {
      const summary = summarizeSignalFlow(metrics);
      this.runtime.ops.signalFlow = summary;
      this.runtime.ops.tradingFlowHealth = summary.tradingFlowHealth;
    }
    return metrics;
  }

  notePaperTradePersisted({ position = null, at = nowIso() } = {}) {
    if ((this.config?.botMode || this.runtime?.mode || "paper") !== "paper" || !position) {
      return this.ensureSignalFlowMetrics();
    }
    const metrics = this.ensureSignalFlowMetrics();
    metrics.paperTradesPersisted += 1;
    metrics.lastPaperTradePersistedAt = at;
    metrics.lastCycle = {
      ...(metrics.lastCycle || {}),
      paperTradesPersisted: (metrics.lastCycle?.paperTradesPersisted || 0) + 1
    };
    this.recordEvent("paper_trade_persisted", {
      symbol: position.symbol,
      positionId: position.id || null
    });
    if (this.runtime.ops) {
      const summary = summarizeSignalFlow(metrics);
      this.runtime.ops.signalFlow = summary;
      this.runtime.ops.tradingFlowHealth = summary.tradingFlowHealth;
    }
    return metrics;
  }

  finalizeSignalFlowCycle({ at = nowIso(), entryAttempt = {}, openedPosition = null } = {}) {
    const metrics = this.ensureSignalFlowMetrics();
    const generatedSignals = metrics.lastCycle?.generatedSignals || 0;
    const eligiblePaperFlow =
      (metrics.lastCycle?.allowedSignals || 0) > 0 ||
      (metrics.lastCycle?.entriesAttempted || 0) > 0 ||
      (metrics.lastCycle?.paperTradesAttempted || 0) > 0;
    if (
      (this.config?.botMode || this.runtime?.mode || "paper") === "paper" &&
      generatedSignals > 0 &&
      eligiblePaperFlow
    ) {
      metrics.consecutiveCyclesWithSignalsNoPaperTrade = openedPosition
        ? 0
        : (metrics.consecutiveCyclesWithSignalsNoPaperTrade || 0) + 1;
    } else {
      metrics.consecutiveCyclesWithSignalsNoPaperTrade = 0;
    }
    metrics.lastCycle = {
      ...(metrics.lastCycle || {}),
      at,
      entryStatus: entryAttempt.status || "idle",
      openedSymbol: openedPosition?.symbol || metrics.lastCycle?.openedSymbol || null
    };
    const topReason = summarizeCountMap(metrics.lastCycle?.rejectionReasons || {}, 1)[0]?.id || null;
    const topCategory = summarizeCountMap(metrics.lastCycle?.rejectionCategories || {}, 1)[0]?.id || null;
    this.recordEvent("signal_flow_cycle", {
      symbolsScanned: metrics.lastCycle.symbolsScanned || 0,
      candidatesScored: metrics.lastCycle.candidatesScored || 0,
      generatedSignals: metrics.lastCycle.generatedSignals || 0,
      rejectedSignals: metrics.lastCycle.rejectedSignals || 0,
      allowedSignals: metrics.lastCycle.allowedSignals || 0,
      entriesAttempted: metrics.lastCycle.entriesAttempted || 0,
      entriesExecuted: metrics.lastCycle.entriesExecuted || 0,
      entriesPersisted: metrics.lastCycle.entriesPersisted || 0,
      entriesPersistFailed: metrics.lastCycle.entriesPersistFailed || 0,
      paperTradesAttempted: metrics.lastCycle.paperTradesAttempted || 0,
      paperTradesExecuted: metrics.lastCycle.paperTradesExecuted || 0,
      paperTradesPersisted: metrics.lastCycle.paperTradesPersisted || 0,
      eligiblePaperFlow,
      entryStatus: entryAttempt.status || "idle",
      openedSymbol: openedPosition?.symbol || null,
      topRejectionReason: topReason,
      topRejectionCategory: topCategory
    });
    if (this.runtime.ops) {
      const summary = summarizeSignalFlow(metrics);
      this.runtime.ops.signalFlow = summary;
      this.runtime.ops.tradingFlowHealth = summary.tradingFlowHealth;
    }
    this.markReportDirty();
    return metrics;
  }

  async safeRecordDataRecorder(action, write) {
    try {
      await write();
      this.runtime.dataRecorder = this.dataRecorder.getSummary();
      return true;
    } catch (error) {
      this.logger.warn("Data recorder write failed", { action, error: error.message });
      this.recordEvent("data_recorder_write_failed", { action, error: error.message });
      return false;
    }
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
        return strategyMatch && regimeMatch;
      });
  }

  buildThresholdScopeFreshness(scope = {}, referenceNow = nowIso()) {
    const maxIdleHours = safeNumber(this.config?.thresholdTuningMaxIdleHours, 24 * 7);
    const trades = this.collectScopedThresholdTrades(scope, { beforeAt: referenceNow });
    const latestTradeAt = [...trades].reverse().map((trade) => trade.exitAt || trade.entryAt || null).find(Boolean) || null;
    const latestTradeAgeHours = latestTradeAt ? Math.max(0, (new Date(referenceNow).getTime() - new Date(latestTradeAt).getTime()) / 3_600_000) : null;
    return {
      tradeCount: trades.length,
      latestTradeAt,
      latestTradeAgeHours: Number.isFinite(latestTradeAgeHours) ? num(latestTradeAgeHours, 1) : null,
      stale: !latestTradeAt || latestTradeAgeHours > maxIdleHours
    };
  }

  buildThresholdExperimentSnapshot(scope = {}, options = {}) {
    const sampleSize = this.config?.thresholdProbationMinTrades || 6;
    const lookbackHours = safeNumber(this.config?.thresholdTuningMaxIdleHours, 24 * 7);
    const trades = this.collectScopedThresholdTrades(scope, options)
      .filter((trade) => {
        const exitAt = trade.exitAt || trade.entryAt || null;
        if (!exitAt) {
          return false;
        }
        const referenceAt = options.beforeAt || options.afterAt || nowIso();
        const ageHours = Math.max(0, (new Date(referenceAt).getTime() - new Date(exitAt).getTime()) / 3_600_000);
        return ageHours <= lookbackHours;
      })
      .slice(-sampleSize);
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
    const probationTrades = this.config?.thresholdProbationMinTrades || 6;
    const probationWindowMs = (this.config.thresholdProbationWindowDays || 7) * 86_400_000;
    const active = next.appliedRecommendation;

    if (active?.status === "probation") {
      const freshness = this.buildThresholdScopeFreshness(active, referenceNow);
      if (freshness.stale) {
        next.history.unshift({ ...active, status: "stale", reviewedAt: referenceNow, review: freshness });
        next.appliedRecommendation = null;
        next.activeThresholdShift = 0;
        next.status = policy.status || "observe";
        next.notes = [
          `${active.id} werd losgelaten omdat de laatste relevante closed trade te oud is.`,
          ...next.notes
        ].slice(0, 8);
      } else {
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
      }
    } else if (active?.status === "confirmed") {
      const freshness = this.buildThresholdScopeFreshness(active, referenceNow);
      if (freshness.stale) {
        next.history.unshift({ ...active, status: "stale", reviewedAt: referenceNow, review: freshness });
        next.appliedRecommendation = null;
        next.activeThresholdShift = 0;
        next.status = policy.status || "observe";
        next.notes = [
          `${active.id} bevestiging is vervallen door stale trade-input.`,
          ...next.notes
        ].slice(0, 8);
      } else {
        next.activeThresholdShift = num(active.adjustment || 0, 4);
        next.status = "confirmed";
      }
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
      const candidateFreshness = candidate ? this.buildThresholdScopeFreshness(candidate, referenceNow) : null;
      if (candidate && !candidateFreshness?.stale) {
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
      } else if (candidate && candidateFreshness?.stale) {
        next.notes = [
          `${candidate.id} werd niet auto-toegepast omdat de relevante closed trades stale zijn.`,
          ...next.notes
        ].slice(0, 8);
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
    const offlineTrainerSummary = this.offlineTrainer.buildSummary({ journal: this.journal, dataRecorder: this.dataRecorder.getSummary(), counterfactuals: this.journal.counterfactuals || [], historySummary: this.runtime.marketHistory || {}, nowIso: referenceNow });
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
    this.applyOperatorPolicyOverrides(referenceNow);
    this.runtime.replayChaos = summarizeReplayChaos(buildReplayChaosSummary({
      journal: this.journal,
      nowIso: referenceNow
    }));
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
    this.runtime.sourceReliability = this.buildSourceReliabilitySnapshot();
    this.updateThresholdTuningState(offlineTrainerSummary, referenceNow);
    this.syncOrderLifecycleState("governance_refresh");
    this.refreshOperationalViews({ report, nowIso: referenceNow });
    void this.dataRecorder.recordDatasetCuration({
      at: referenceNow,
      journal: this.journal,
      newsCache: this.runtime.newsCache || {},
      sourceReliability: this.runtime.sourceReliability || {},
      paperLearning: this.runtime.paperLearning || this.runtime.ops?.paperLearning || {},
      offlineTrainer: offlineTrainerSummary
    }).then(() => {
      this.runtime.dataRecorder = this.dataRecorder.getSummary();
    }).catch((error) => {
      this.logger.warn("Dataset curation record failed", { error: error.message });
    });
    return { report, rawResearchRegistry, rawStrategyResearch, divergenceSummary, offlineTrainerSummary, executionCalibration, parameterGovernor };
  }

  ensureOperatorPolicyState() {
    this.runtime.operatorPolicyState = this.runtime.operatorPolicyState || {
      approvals: [],
      dismissals: [],
      history: [],
      strategyOverrides: {}
    };
    this.runtime.operatorPolicyState.approvals = arr(this.runtime.operatorPolicyState.approvals).slice(0, 40);
    this.runtime.operatorPolicyState.dismissals = arr(this.runtime.operatorPolicyState.dismissals).slice(0, 40);
    this.runtime.operatorPolicyState.history = arr(this.runtime.operatorPolicyState.history).slice(0, 80);
    this.runtime.operatorPolicyState.strategyOverrides = this.runtime.operatorPolicyState.strategyOverrides && typeof this.runtime.operatorPolicyState.strategyOverrides === "object"
      ? this.runtime.operatorPolicyState.strategyOverrides
      : {};
    return this.runtime.operatorPolicyState;
  }

  ensureDiagnosticsActionState() {
    this.runtime.ops = this.runtime.ops || {};
    this.runtime.ops.diagnosticsActions = this.runtime.ops.diagnosticsActions || {
      history: []
    };
    this.runtime.ops.diagnosticsActions.history = arr(this.runtime.ops.diagnosticsActions.history).slice(0, 80);
    return this.runtime.ops.diagnosticsActions;
  }

  ensurePromotionState() {
    this.runtime.ops = this.runtime.ops || {};
    this.runtime.ops.promotionState = this.runtime.ops.promotionState || {
      active: [],
      history: []
    };
    this.runtime.ops.promotionState.active = arr(this.runtime.ops.promotionState.active).slice(0, 12);
    this.runtime.ops.promotionState.history = arr(this.runtime.ops.promotionState.history).slice(0, 80);
    return this.runtime.ops.promotionState;
  }

  evaluatePromotionProbations(referenceNow = nowIso()) {
    const promotionState = this.ensurePromotionState();
    const nowMs = new Date(referenceNow).getTime();
    const active = [];
    const history = arr(promotionState.history || []);
    for (const item of arr(promotionState.active || [])) {
      const approvedAtMs = new Date(item.approvedAt || 0).getTime();
      const sinceApproved = Number.isFinite(approvedAtMs)
        ? arr(this.journal?.trades || []).filter((trade) => {
            const exitMs = new Date(trade.exitAt || trade.entryAt || 0).getTime();
            if (!Number.isFinite(exitMs) || exitMs < approvedAtMs) {
              return false;
            }
            if (item.symbol) {
              return `${trade.symbol || ""}`.trim().toUpperCase() === `${item.symbol || ""}`.trim().toUpperCase();
            }
            const family = trade.strategyFamily || trade.strategyDecision?.family || null;
            const regime = trade.regimeAtEntry || null;
            const session = trade.sessionAtEntry || null;
            const scopeId = [family, regime, session].filter(Boolean).join(" | ");
            return scopeId === item.scope || `${trade.strategyAtEntry || ""}`.trim() === `${item.id || ""}`.trim();
          })
        : [];
      const completedTrades = sinceApproved.filter((trade) => Boolean(trade.exitAt));
      const weakTrades = completedTrades.filter((trade) => ["bad_trade", "early_exit", "late_exit", "execution_drag"].includes(resolvePaperOutcomeBucket(trade)));
      const goodTrades = completedTrades.filter((trade) => ["good_trade", "acceptable_trade"].includes(resolvePaperOutcomeBucket(trade)));
      const completedSignals = completedTrades.map((trade) => buildPaperOutcomeSignal(trade));
      const executionDragCount = completedSignals.filter((item) => item.executionDrag).length;
      const qualityTrapCount = completedSignals.filter((item) => item.qualityTrap).length;
      const weakSetupCount = completedSignals.filter((item) => item.weakSetup).length;
      const followThroughFailedCount = completedSignals.filter((item) => item.followThroughFailed).length;
      const avgReviewComposite = average(completedSignals.map((item) => item.review.compositeScore || 0), 0);
      const dominantWeakness = [
        ["execution_drag", executionDragCount],
        ["quality_trap", qualityTrapCount],
        ["weak_setup", weakSetupCount],
        ["follow_through_failed", followThroughFailedCount]
      ].sort((left, right) => right[1] - left[1])[0];
      const avgExecutionQuality = average(completedTrades.map((trade) => trade.executionQualityScore || 0), 0);
      const avgNetPnlPct = average(completedTrades.map((trade) => trade.netPnlPct || 0), 0);
      const targetSampleCount = Math.max(2, Number(item.targetSampleCount || 3));
      const weakLossLimit = Math.max(1, Number(item.weakLossLimit || 2));
      const expiresAtMs = new Date(item.expiresAt || 0).getTime();
      const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
      const rollbackRecommended =
        weakTrades.length >= weakLossLimit ||
        qualityTrapCount >= Math.max(1, Math.ceil(targetSampleCount * 0.34)) ||
        (executionDragCount >= Math.max(1, Math.ceil(targetSampleCount * 0.5)) && avgExecutionQuality < 0.58) ||
        weakSetupCount >= Math.max(1, Math.ceil(targetSampleCount * 0.5));
      const complete = completedTrades.length >= targetSampleCount && !rollbackRecommended;
      const healthyOutcomeMix =
        executionDragCount <= Math.max(1, Math.floor(targetSampleCount * 0.25)) &&
        qualityTrapCount === 0 &&
        weakSetupCount <= Math.max(1, Math.floor(targetSampleCount * 0.34)) &&
        followThroughFailedCount <= Math.max(1, Math.floor(targetSampleCount * 0.34)) &&
        avgReviewComposite >= 0.5;
      const verdict = rollbackRecommended
        ? "rollback"
        : complete && goodTrades.length >= Math.ceil(targetSampleCount * 0.6) && avgExecutionQuality >= 0.55 && avgNetPnlPct >= -0.002 && healthyOutcomeMix
          ? "go"
          : complete || expired
            ? "hold"
            : "hold";
      const next = {
        ...item,
        completedTrades: completedTrades.length,
        goodTrades: goodTrades.length,
        weakTrades: weakTrades.length,
        executionDragCount,
        qualityTrapCount,
        weakSetupCount,
        followThroughFailedCount,
        avgExecutionQuality: num(avgExecutionQuality, 4),
        avgNetPnlPct: num(avgNetPnlPct, 4),
        avgReviewComposite: num(avgReviewComposite, 4),
        dominantWeakness: dominantWeakness?.[1] ? dominantWeakness[0] : null,
        rollbackRecommended,
        expired,
        targetSampleCount,
        weakLossLimit,
        verdict,
        status: rollbackRecommended
          ? "rollback_recommended"
          : expired
            ? "expired"
            : complete
              ? "ready_for_review"
              : "active",
        note: item.note || null
      };
      if (rollbackRecommended || expired || complete) {
        history.unshift({
          at: referenceNow,
          action: rollbackRecommended
            ? (item.scope ? "guardrail_scope_rollback_recommended" : "guardrail_live_rollback_recommended")
            : expired
              ? "guardrail_probation_expired"
              : "guardrail_probation_ready",
          symbol: item.symbol || null,
          scope: item.scope || null,
          stage: item.stage || null,
          status: next.status,
          governanceScore: num(item.governanceScore || 0, 4),
          executionDragCount,
          qualityTrapCount,
          weakSetupCount,
          followThroughFailedCount,
          avgReviewComposite: num(avgReviewComposite, 4),
          dominantWeakness: dominantWeakness?.[1] ? dominantWeakness[0] : null,
          verdict,
          note: rollbackRecommended
            ? dominantWeakness?.[1]
              ? `Rollback guardrail geraakt door ${humanizeReason(dominantWeakness[0])} in probation-uitkomsten.`
              : "Rollback guardrail geraakt door zwakke probation-uitkomsten."
            : expired
              ? "Probation verstreken zonder expliciete operatorbeslissing."
              : healthyOutcomeMix
                ? "Probation haalde het sample-doel en is klaar voor review."
                : "Probation haalde wel samples, maar de outcome-mix blijft nog te zwak voor promotie."
        });
      } else {
        active.push(next);
      }
    }
    promotionState.active = active.slice(0, 12);
    promotionState.history = history.slice(0, 80);
    return promotionState;
  }

  recordDiagnosticsAction({
    action = null,
    target = null,
    note = null,
    status = "completed",
    detail = null,
    at = nowIso()
  } = {}) {
    const state = this.ensureDiagnosticsActionState();
    state.history.unshift({
      at,
      action,
      target,
      note: note || null,
      status,
      detail: detail || null
    });
    state.history = state.history.slice(0, 80);
    this.recordEvent("operator_diagnostics_action", {
      at,
      action,
      target,
      status,
      note: note || null
    });
    return state;
  }

  resetExternalFeedHealth({ group = null, feed = null, note = null, at = nowIso() } = {}) {
    const bucket = this.runtime.externalFeedHealth && typeof this.runtime.externalFeedHealth === "object"
      ? this.runtime.externalFeedHealth
      : {};
    const touched = [];
    for (const [key, state] of Object.entries(bucket)) {
      if (!state || typeof state !== "object") {
        continue;
      }
      if (group && state.group !== group) {
        continue;
      }
      if (feed && state.feed !== feed) {
        continue;
      }
      state.cooldownUntil = null;
      state.recentFailures = 0;
      state.lastError = null;
      touched.push({
        key,
        group: state.group || null,
        feed: state.feed || null
      });
    }
    this.runtime.sourceReliability = this.buildSourceReliabilitySnapshot();
    this.recordDiagnosticsAction({
      action: "reset_external_feeds",
      target: feed || group || "all",
      note,
      detail: touched.length
        ? `${touched.length} external feed cooldown(s) gewist.`
        : "Geen matching external feeds gevonden.",
      at
    });
    return {
      resetCount: touched.length,
      targets: touched
    };
  }

  applyOperatorPolicyOverrides(referenceNow = nowIso()) {
    const state = this.ensureOperatorPolicyState();
    const overrides = state.strategyOverrides || {};
    const summary = this.runtime.strategyRetirement || { policies: [], notes: [] };
    const policies = arr(summary.policies || []).map((item) => ({ ...item }));
    for (const [id, override] of Object.entries(overrides)) {
      if (!override?.status) {
        continue;
      }
      const existingIndex = policies.findIndex((item) => item.id === id);
      const next = existingIndex >= 0
        ? {
            ...policies[existingIndex],
            status: override.status,
            sizeMultiplier: override.status === "retire" ? 0 : override.status === "cooldown" ? Math.min(0.72, policies[existingIndex].sizeMultiplier || 0.72) : 1,
            note: override.note || policies[existingIndex].note || "Operator policy override actief.",
            overriddenByOperator: true,
            approvedAt: override.approvedAt || referenceNow
          }
        : {
            id,
            tradeCount: 0,
            realizedPnl: 0,
            winRate: 0,
            avgReviewScore: 0,
            avgPnlPct: 0,
            governanceScore: 0,
            falsePositiveRate: 0,
            falseNegativeRate: 0,
            confidence: 0.5,
            status: override.status,
            sizeMultiplier: override.status === "retire" ? 0 : override.status === "cooldown" ? 0.72 : 1,
            note: override.note || "Operator policy override actief.",
            overriddenByOperator: true,
            approvedAt: override.approvedAt || referenceNow
          };
      if (existingIndex >= 0) {
        policies[existingIndex] = next;
      } else {
        policies.push(next);
      }
    }
    policies.sort((left, right) => {
      const severity = { retire: 0, cooldown: 1, observe: 2, active: 3 };
      const delta = (severity[left.status] || 9) - (severity[right.status] || 9);
      return delta !== 0 ? delta : (left.governanceScore || 0) - (right.governanceScore || 0);
    });
    summary.policies = policies.slice(0, 12);
    summary.retireCount = policies.filter((item) => item.status === "retire").length;
    summary.cooldownCount = policies.filter((item) => item.status === "cooldown").length;
    summary.activeCount = policies.filter((item) => item.status === "active").length;
    summary.blockedStrategies = policies.filter((item) => item.status === "retire").map((item) => item.id);
    summary.cooldownStrategies = policies.filter((item) => item.status === "cooldown").map((item) => item.id);
    summary.status = summary.retireCount ? "blocked" : summary.cooldownCount ? "watch" : policies.length ? "ready" : "warmup";
    summary.notes = [
      Object.keys(overrides).length
        ? `${Object.keys(overrides).length} operator policy override(s) actief.`
        : (summary.notes || [])[0] || "Geen operator policy overrides actief.",
      ...(arr(summary.notes || []).slice(0, 2))
    ].slice(0, 4);
    this.runtime.strategyRetirement = summary;
    return summary;
  }

  async approvePolicyTransition({ id, action, note = null, at = nowIso() } = {}) {
    const transitionId = `${id || ""}`.trim();
    const normalizedAction = normalizePolicyTransitionAction(action);
    if (!transitionId || normalizedAction === "observe") {
      throw new Error("Ongeldige policy transition.");
    }
    const state = this.ensureOperatorPolicyState();
    const candidates = arr(this.runtime.paperLearning?.policyTransitions?.candidates || this.runtime.ops?.paperLearning?.policyTransitions?.candidates || []);
    const candidate = candidates.find((item) => item.id === transitionId && item.action === normalizedAction);
    if (!candidate) {
      throw new Error("Policy transition kandidaat niet gevonden.");
    }
    state.approvals.unshift({
      id: transitionId,
      action: normalizedAction,
      type: candidate.type || null,
      scope: candidate.scope || null,
      note: note || null,
      approvedAt: at
    });
    state.approvals = state.approvals.slice(0, 40);
    state.history.unshift({
      id: transitionId,
      action: normalizedAction,
      note: note || null,
      at,
      scope: candidate.scope || null,
      status: "approved"
    });
    state.history = state.history.slice(0, 80);
    state.dismissals = state.dismissals.filter((item) => !(item.id === transitionId && item.action === normalizedAction));
    if (candidate.type === "strategy" && ["retire_candidate", "cooldown_candidate"].includes(normalizedAction)) {
      state.strategyOverrides[transitionId] = {
        status: normalizedAction === "retire_candidate" ? "retire" : "cooldown",
        note: note || candidate.reason || null,
        approvedAt: at
      };
      this.applyOperatorPolicyOverrides(at);
    }
    this.recordEvent("operator_policy_transition_approved", {
      at,
      id: transitionId,
      action: normalizedAction,
      note: note || null
    });
    this.refreshGovernanceViews(at);
    return {
      approved: true,
      id: transitionId,
      action: normalizedAction
    };
  }

  async rejectPolicyTransition({ id, action, note = null, at = nowIso() } = {}) {
    const transitionId = `${id || ""}`.trim();
    const normalizedAction = normalizePolicyTransitionAction(action);
    if (!transitionId || normalizedAction === "observe") {
      throw new Error("Ongeldige policy transition.");
    }
    const state = this.ensureOperatorPolicyState();
    state.dismissals.unshift({
      id: transitionId,
      action: normalizedAction,
      note: note || null,
      dismissedAt: at
    });
    state.dismissals = state.dismissals.slice(0, 40);
    state.history.unshift({
      id: transitionId,
      action: normalizedAction,
      note: note || null,
      at,
      scope: null,
      status: "rejected"
    });
    state.history = state.history.slice(0, 80);
    this.recordEvent("operator_policy_transition_rejected", {
      at,
      id: transitionId,
      action: normalizedAction,
      note: note || null
    });
    this.refreshGovernanceViews(at);
    return {
      rejected: true,
      id: transitionId,
      action: normalizedAction
    };
  }

  async revertPolicyTransition({ id, note = null, at = nowIso() } = {}) {
    const transitionId = `${id || ""}`.trim();
    if (!transitionId) {
      throw new Error("Ongeldige policy transition.");
    }
    const state = this.ensureOperatorPolicyState();
    delete state.strategyOverrides[transitionId];
    state.approvals = state.approvals.filter((item) => item.id !== transitionId);
    state.history.unshift({
      id: transitionId,
      action: "revert_override",
      note: note || null,
      at,
      scope: transitionId,
      status: "reverted"
    });
    state.history = state.history.slice(0, 80);
    this.recordEvent("operator_policy_transition_reverted", {
      at,
      id: transitionId,
      note: note || null
    });
    this.refreshGovernanceViews(at);
    return {
      reverted: true,
      id: transitionId
    };
  }

  async performDiagnosticsAction({ action, target = null, note = null, minutes = null, at = nowIso() } = {}) {
    const normalizedAction = `${action || ""}`.trim().toLowerCase();
    if (!normalizedAction) {
      throw new Error("Ongeldige diagnostics action.");
    }
    if (normalizedAction === "ack_alert") {
      await this.acknowledgeAlert(target, { acknowledged: true, note, at });
      this.recordDiagnosticsAction({
        action: normalizedAction,
        target,
        note,
        detail: `Alert ${target || "unknown"} acknowledged.`,
        at
      });
      await this.store.saveRuntime(this.runtime);
      return this.getDashboardSnapshot();
    }
    if (normalizedAction === "force_reconcile") {
      await this.forceReconcile({ note, at });
      this.recordDiagnosticsAction({
        action: normalizedAction,
        target,
        note,
        detail: "Exchange truth op freeze gezet voor reconcile.",
        at
      });
      await this.store.saveRuntime(this.runtime);
      return this.getDashboardSnapshot();
    }
    if (normalizedAction === "enable_probe_only") {
      const durationMinutes = Math.max(1, Number(minutes ?? 90));
      await this.setProbeOnly({ enabled: true, minutes: durationMinutes, note, at });
      this.recordDiagnosticsAction({
        action: normalizedAction,
        target,
        note,
        detail: `Probe-only actief voor ${durationMinutes} minuten.`,
        at
      });
      await this.store.saveRuntime(this.runtime);
      return this.getDashboardSnapshot();
    }
    if (normalizedAction === "reset_external_feeds") {
      const result = this.resetExternalFeedHealth({ group: target || null, note, at });
      this.refreshOperationalViews({ nowIso: at });
      await this.store.saveRuntime(this.runtime);
      return {
        ...(await this.getDashboardSnapshot()),
        diagnosticsActionResult: result
      };
    }
    throw new Error("Onbekende diagnostics action.");
  }

  async approvePromotionCandidate({ symbol, note = null, at = nowIso() } = {}) {
    const candidateSymbol = `${symbol || ""}`.trim().toUpperCase();
    if (!candidateSymbol) {
      throw new Error("Promotion symbool ontbreekt.");
    }
    const promotionState = this.ensurePromotionState();
    const researchCandidates = arr(this.runtime.researchRegistry?.governance?.promotionCandidates || []);
    const candidate = researchCandidates.find((item) => `${item.symbol || ""}`.trim().toUpperCase() === candidateSymbol);
    if (!candidate) {
      throw new Error("Promotion kandidaat niet gevonden.");
    }
    promotionState.active = promotionState.active.filter((item) => item.symbol !== candidateSymbol);
    promotionState.active.unshift({
      symbol: candidateSymbol,
      stage: "guarded_live_probation",
      status: "active",
      governanceScore: num(candidate.governanceScore || 0, 4),
      candidateStatus: candidate.status || "observe",
      approvedAt: at,
      expiresAt: new Date(new Date(at).getTime() + 72 * 60 * 60 * 1000).toISOString(),
      targetSampleCount: 3,
      weakLossLimit: 2,
      note: note || null
    });
    promotionState.active = promotionState.active.slice(0, 12);
    promotionState.history.unshift({
      at,
      action: "approve_guarded_live",
      symbol: candidateSymbol,
      stage: "guarded_live_probation",
      status: "approved",
      governanceScore: num(candidate.governanceScore || 0, 4),
      note: note || null
    });
    promotionState.history = promotionState.history.slice(0, 80);
    this.recordEvent("operator_promotion_candidate_approved", {
      at,
      symbol: candidateSymbol,
      note: note || null
    });
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  async approvePromotionScope({ scopeId, note = null, at = nowIso() } = {}) {
    const normalizedScope = `${scopeId || ""}`.trim();
    if (!normalizedScope) {
      throw new Error("Promotion scope ontbreekt.");
    }
    const promotionState = this.ensurePromotionState();
    const candidates = arr(this.runtime.paperLearning?.policyTransitions?.candidates || this.runtime.ops?.paperLearning?.policyTransitions?.candidates || []);
    const candidate = candidates.find((item) => `${item.scope || item.id || ""}`.trim() === normalizedScope || `${item.id || ""}`.trim() === normalizedScope);
    if (!candidate) {
      throw new Error("Promotion scope kandidaat niet gevonden.");
    }
    const key = `${candidate.type || "scope"}:${normalizedScope}`;
    promotionState.active = promotionState.active.filter((item) => item.key !== key);
    promotionState.active.unshift({
      key,
      type: candidate.type || "scope",
      symbol: null,
      scope: normalizedScope,
      id: candidate.id || normalizedScope,
      stage: "guarded_scope_probation",
      status: "active",
      governanceScore: num(candidate.confidence || 0, 4),
      candidateStatus: candidate.action || "observe",
      approvedAt: at,
      expiresAt: new Date(new Date(at).getTime() + 72 * 60 * 60 * 1000).toISOString(),
      targetSampleCount: 3,
      weakLossLimit: 2,
      note: note || null
    });
    promotionState.active = promotionState.active.slice(0, 12);
    promotionState.history.unshift({
      at,
      action: "approve_guarded_scope",
      symbol: null,
      scope: normalizedScope,
      stage: "guarded_scope_probation",
      status: "approved",
      governanceScore: num(candidate.confidence || 0, 4),
      note: note || null
    });
    promotionState.history = promotionState.history.slice(0, 80);
    this.recordEvent("operator_promotion_scope_approved", {
      at,
      scope: normalizedScope,
      id: candidate.id || null,
      note: note || null
    });
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  async rollbackPromotionCandidate({ symbol, note = null, at = nowIso() } = {}) {
    const candidateSymbol = `${symbol || ""}`.trim().toUpperCase();
    if (!candidateSymbol) {
      throw new Error("Promotion symbool ontbreekt.");
    }
    const promotionState = this.ensurePromotionState();
    const active = promotionState.active.find((item) => item.symbol === candidateSymbol);
    if (!active) {
      throw new Error("Geen actieve guarded-live probation gevonden voor dit symbool.");
    }
    promotionState.active = promotionState.active.filter((item) => item.symbol !== candidateSymbol);
    promotionState.history.unshift({
      at,
      action: "rollback_guarded_live",
      symbol: candidateSymbol,
      stage: active.stage || "guarded_live_probation",
      status: "rolled_back",
      governanceScore: num(active.governanceScore || 0, 4),
      note: note || null
    });
    promotionState.history = promotionState.history.slice(0, 80);
    this.recordEvent("operator_promotion_candidate_rolled_back", {
      at,
      symbol: candidateSymbol,
      note: note || null
    });
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  async rollbackPromotionScope({ scopeId, note = null, at = nowIso() } = {}) {
    const normalizedScope = `${scopeId || ""}`.trim();
    if (!normalizedScope) {
      throw new Error("Promotion scope ontbreekt.");
    }
    const promotionState = this.ensurePromotionState();
    const active = promotionState.active.find((item) => item.scope === normalizedScope);
    if (!active) {
      throw new Error("Geen actieve scope probation gevonden.");
    }
    promotionState.active = promotionState.active.filter((item) => item.scope !== normalizedScope);
    promotionState.history.unshift({
      at,
      action: "rollback_guarded_scope",
      symbol: null,
      scope: normalizedScope,
      stage: active.stage || "guarded_scope_probation",
      status: "rolled_back",
      governanceScore: num(active.governanceScore || 0, 4),
      note: note || null
    });
    promotionState.history = promotionState.history.slice(0, 80);
    this.recordEvent("operator_promotion_scope_rolled_back", {
      at,
      scope: normalizedScope,
      note: note || null
    });
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
  }

  async decidePromotionProbation({ key = null, decision, note = null, at = nowIso() } = {}) {
    const probationKey = `${key || ""}`.trim();
    const normalizedDecision = `${decision || ""}`.trim().toLowerCase();
    if (!probationKey || !["promote", "hold", "close"].includes(normalizedDecision)) {
      throw new Error("Ongeldige probation beslissing.");
    }
    const promotionState = this.ensurePromotionState();
    const active = promotionState.active.find((item) => (item.key || item.symbol || item.scope || item.id) === probationKey);
    if (!active) {
      throw new Error("Actieve probation niet gevonden.");
    }
    if (normalizedDecision === "promote") {
      promotionState.active = promotionState.active.filter((item) => (item.key || item.symbol || item.scope || item.id) !== probationKey);
      promotionState.history.unshift({
        at,
        action: "promote_probation",
        symbol: active.symbol || null,
        scope: active.scope || null,
        stage: active.stage || null,
        status: "promoted",
        verdict: active.verdict || null,
        governanceScore: num(active.governanceScore || 0, 4),
        note: note || "Operator promoveerde deze probation na review."
      });
    } else if (normalizedDecision === "hold") {
      active.expiresAt = new Date(new Date(at).getTime() + 48 * 60 * 60 * 1000).toISOString();
      active.status = "active";
      active.note = note || active.note || "Operator houdt probation open voor extra samples.";
      promotionState.history.unshift({
        at,
        action: "hold_probation",
        symbol: active.symbol || null,
        scope: active.scope || null,
        stage: active.stage || null,
        status: "held",
        verdict: active.verdict || null,
        governanceScore: num(active.governanceScore || 0, 4),
        note: note || "Operator houdt probation open."
      });
    } else if (normalizedDecision === "close") {
      promotionState.active = promotionState.active.filter((item) => (item.key || item.symbol || item.scope || item.id) !== probationKey);
      promotionState.history.unshift({
        at,
        action: "close_probation",
        symbol: active.symbol || null,
        scope: active.scope || null,
        stage: active.stage || null,
        status: "closed",
        verdict: active.verdict || null,
        governanceScore: num(active.governanceScore || 0, 4),
        note: note || "Operator sloot probation zonder promotie."
      });
    }
    promotionState.history = promotionState.history.slice(0, 80);
    this.recordEvent("operator_probation_decision", {
      at,
      key: probationKey,
      decision: normalizedDecision,
      note: note || null
    });
    this.refreshOperationalViews({ nowIso: at });
    await this.store.saveRuntime(this.runtime);
    return this.getDashboardSnapshot();
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
    const tradeIndex = new Map(arr(this.journal?.trades).slice(-120).map((trade) => [trade.id, trade]));
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
    const exchangeTruthActions = [];
    if (arr(this.runtime.exchangeTruth?.unmatchedOrderSymbols || []).length) {
      exchangeTruthActions.push({
        id: "exchange-truth-unmatched-orders",
        symbol: arr(this.runtime.exchangeTruth.unmatchedOrderSymbols).join(", "),
        state: "reconcile_required",
        action: "resolve_unmatched_orders",
        reason: "unmatched_open_orders",
        severity: "negative",
        recoveryAction: "Controleer open exchange-orders zonder runtime-positie en cancel of reconcile ze voordat nieuwe entries terugkomen."
      });
    }
    if (arr(this.runtime.exchangeTruth?.orphanedSymbols || []).length) {
      exchangeTruthActions.push({
        id: "exchange-truth-orphaned-balance",
        symbol: arr(this.runtime.exchangeTruth.orphanedSymbols).join(", "),
        state: "reconcile_required",
        action: "resolve_orphaned_balance",
        reason: "orphaned_exchange_balance",
        severity: "negative",
        recoveryAction: "Bevestig unmanaged exchange-balances, herstel runtime-state of flatten handmatig voordat automation nieuwe exposure opent."
      });
    }
    if (arr(this.runtime.exchangeTruth?.manualInterferenceSymbols || []).length) {
      exchangeTruthActions.push({
        id: "exchange-truth-manual-interference",
        symbol: arr(this.runtime.exchangeTruth.manualInterferenceSymbols).join(", "),
        state: "manual_review",
        action: "resolve_manual_exchange_interference",
        reason: "manual_exchange_exit_order",
        severity: "negative",
        recoveryAction: "Controleer handmatige SELL-orders met unmanaged balance, cancel of rond ze handmatig af voordat runtime-state wordt hersteld."
      });
    }
    const activeLifecycleActions = Object.values(activeActions).map((item) => ({
      id: item.id || null,
      symbol: item.symbol || null,
      state: item.stage || "pending",
      action: item.type || "exchange_action",
      reason: item.detail || item.type || "pending_exchange_action",
      severity: item.severity || "neutral",
      recoveryAction: item.recoveryAction || resolveLifecycleRecoveryAction(item.stage || "pending", item, item)
    }));
    lifecycle.pendingActions = [...activeLifecycleActions, ...stateActions, ...exchangeTruthActions].slice(0, 12);
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
    const signalFlow = summarizeSignalFlow(this.runtime.signalFlow || {});
    const adaptation = summarizeAdaptationHealth(this.runtime.adaptation || {});

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
    if ((this.config.botMode || "paper") === "paper" && (signalFlow.consecutiveCyclesWithSignalsNoPaperTrade || 0) >= (this.config.paperSilentFailureCycleThreshold || 3)) {
      runbooks.push({
        id: "paper_signal_flow_stalled",
        severity: "negative",
        title: "Signalen lopen vast voor paper entries",
        reason: signalFlow.lastCycle.topRejectionReasons[0]?.id || "Signalen worden wel gegenereerd, maar bereiken de paper execution-pad niet.",
        action: `Controleer signal-flow metrics, top reject-categorie ${signalFlow.lastCycle.topRejectionCategories[0]?.id || "unknown"} en entry-flow events om de blokkade gericht te herstellen.`
      });
    }
    if (adaptation.status === "stalled") {
      runbooks.push({
        id: "adaptive_learning_stalled",
        severity: "neutral",
        title: "Online learning staat stil",
        reason: adaptation.notes?.find((note) => /stil|zonder nieuwe closes/i.test(note)) || adaptation.notes?.[1] || "Er kwamen recent geen leerbare closed trades meer binnen.",
        action: "Controleer paper signal flow, closed-trade persist en learning-event frames zodat nieuwe closes de modellen weer kunnen bijwerken."
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
    const serviceState = summarizeServiceState(this.runtime.service || {}, this.config, referenceNow);
    const selfHeal = summarizeSelfHeal(this.runtime.selfHeal || {});
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
    if ((this.runtime.exchangeTruth?.unmatchedOrderSymbols || []).length) {
      reasons.push("exchange_truth_unmatched_orders");
    }
    if ((this.runtime.exchangeTruth?.orphanedSymbols || []).length) {
      reasons.push("exchange_truth_orphaned_balance");
    }
    if ((this.runtime.exchangeTruth?.manualInterferenceSymbols || []).length) {
      reasons.push("exchange_truth_manual_interference");
    }
    if (serviceState.watchdogStatus === "degraded") {
      reasons.push("service_watchdog_degraded");
    }
    if (serviceState.heartbeatStale) {
      reasons.push("service_heartbeat_stale");
    }
    if (serviceState.recoveryActive) {
      reasons.push("service_restart_backoff_active");
    }
    if (serviceState.bootstrapDegraded) {
      reasons.push("service_bootstrap_degraded");
    }
    if (["paused", "paper_fallback"].includes(selfHeal.mode || "")) {
      reasons.push("self_heal_paused");
    }
    const signalFlow = summarizeSignalFlow(this.runtime.signalFlow || {});
    if (
      this.config.botMode === "paper" &&
      (signalFlow.consecutiveCyclesWithSignalsNoPaperTrade || 0) >= (this.config.paperSilentFailureCycleThreshold || 3)
    ) {
      reasons.push("paper_signal_flow_stalled");
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
      status: reasons.includes("exchange_truth_freeze") || reasons.includes("health_circuit_open") || reasons.includes("exchange_safety_blocked") || reasons.includes("capital_governor_blocked") || reasons.includes("self_heal_paused")
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
    const botMode = this.config?.botMode || "paper";
    const learningEntries = entries.filter((item) => item.learningLane);
    const recencyWeight = (at) => {
      const timestamp = new Date(at || 0).getTime();
      const nowMs = new Date(referenceNow).getTime();
      if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs)) {
        return 0.35;
      }
      const ageHours = Math.max(0, (nowMs - timestamp) / 3_600_000);
      return clamp(1 - Math.min(1, ageHours / (24 * 5)), 0.25, 1);
    };
    const weightedAverage = (records, valueFn, atFn, fallback = 0) => {
      let weightedSum = 0;
      let weightSum = 0;
      for (const record of records) {
        const value = Number(valueFn(record));
        if (!Number.isFinite(value)) {
          continue;
        }
        const weight = recencyWeight(atFn(record));
        weightedSum += value * weight;
        weightSum += weight;
      }
      return weightSum ? weightedSum / weightSum : fallback;
    };
    const laneKeys = {
      safe: new Set(),
      probe: new Set(),
      shadow: new Set()
    };
    const isShadowReviewCase = (item = {}) => (
      item.learningLane === "shadow" ||
      arr(item.branches || []).length > 0 ||
      arr(item.branchScenarios || []).length > 0
    );
    const recordLaneKey = (lane, key) => {
      if (!laneKeys[lane] || !key) {
        return;
      }
      laneKeys[lane].add(key);
    };
    for (const item of learningEntries) {
      recordLaneKey(item.learningLane || "safe", item.id || item.symbol || `${item.learningLane}:${item.summary || ""}`);
    }
    for (const trade of arr(this.journal?.trades || [])) {
      if ((trade.brokerMode || "paper") !== "paper") {
        continue;
      }
      const at = trade.exitAt || trade.entryAt;
      if (!at || !sameUtcDay(at, referenceNow)) {
        continue;
      }
      recordLaneKey(trade.learningLane || "safe", trade.id || `${trade.symbol || "trade"}:${at}`);
    }
    for (const position of arr(this.runtime?.openPositions || [])) {
      if ((position.brokerMode || this.config.botMode) !== "paper") {
        continue;
      }
      if (!position.entryAt || !sameUtcDay(position.entryAt, referenceNow)) {
        continue;
      }
      recordLaneKey(position.learningLane || "safe", position.id || `${position.symbol || "position"}:${position.entryAt}`);
    }
    for (const item of arr(this.journal?.counterfactuals || [])) {
      if ((item.brokerMode || "paper") !== "paper") {
        continue;
      }
      if (!isShadowReviewCase(item) || !isUsableCounterfactual(item)) {
        continue;
      }
      const at = item.resolvedAt || item.queuedAt || item.at;
      if (!at || !sameUtcDay(at, referenceNow)) {
        continue;
      }
      recordLaneKey("shadow", item.id || `${item.symbol || "shadow"}:${at}`);
    }
    for (const item of arr(this.runtime?.counterfactualQueue || [])) {
      if ((item.brokerMode || "paper") !== "paper") {
        continue;
      }
      if (!isShadowReviewCase(item)) {
        continue;
      }
      const at = item.queuedAt || item.dueAt;
      if (!at || !sameUtcDay(at, referenceNow)) {
        continue;
      }
      recordLaneKey("shadow", item.id || `${item.symbol || "shadow"}:${at}`);
    }
    const laneCounts = {
      safe: laneKeys.safe.size,
      probe: laneKeys.probe.size,
      shadow: laneKeys.shadow.size
    };
    const probeBudgetUsed = [
      ...arr(this.journal?.trades || []).filter(
        (trade) => (trade.brokerMode || "paper") === botMode &&
          trade.learningLane === "probe" &&
          trade.entryAt &&
          sameUtcDay(trade.entryAt, referenceNow)
      ),
      ...arr(this.runtime?.openPositions || []).filter(
        (position) => (position.brokerMode || botMode) === botMode &&
          position.learningLane === "probe" &&
          position.entryAt &&
          sameUtcDay(position.entryAt, referenceNow)
      )
    ].length;
    const shadowBudgetUsed = [
      ...arr(this.journal?.counterfactuals || []).filter(
        (item) => (item.brokerMode || "paper") === botMode &&
          item.learningLane === "shadow" &&
          sameUtcDay(item.resolvedAt || item.queuedAt || item.at, referenceNow)
      ),
      ...arr(this.runtime?.counterfactualQueue || []).filter(
        (item) => (item.brokerMode || "paper") === botMode &&
          item.learningLane === "shadow" &&
          sameUtcDay(item.queuedAt || item.dueAt, referenceNow)
      )
    ].length;
    const recentPaperTrades = arr(this.journal?.trades || [])
      .filter((trade) => (trade.brokerMode || "paper") === "paper" && trade.exitAt)
      .slice(-40);
    const familyCounts = {};
    const regimeCounts = {};
    const sessionCounts = {};
    const scopeEvidence = [
      ...learningEntries.map((item) => ({
        family: item.paperLearning?.scope?.family || item.strategy?.family || null,
        regime: item.paperLearning?.scope?.regime || item.regime || null,
        session: item.paperLearning?.scope?.session || item.session?.session || null
      })),
      ...recentPaperTrades.map((trade) => ({
        family: trade.strategyFamily || trade.entryRationale?.strategy?.family || null,
        regime: trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || null,
        session: trade.sessionAtEntry || trade.entryRationale?.session?.session || null
      })),
      ...arr(this.journal?.counterfactuals || [])
        .filter((item) => (item.brokerMode || "paper") === "paper" && isUsableCounterfactual(item))
        .map((item) => ({
        family: item.strategyFamily || null,
        regime: item.regime || null,
        session: item.sessionAtEntry || null
      })),
      ...arr(this.runtime?.counterfactualQueue || [])
        .filter((item) => (item.brokerMode || "paper") === "paper")
        .map((item) => ({
        family: item.strategyFamily || item.paperLearning?.scope?.family || null,
        regime: item.regime || item.paperLearning?.scope?.regime || null,
        session: item.sessionAtEntry || item.paperLearning?.scope?.session || null
      }))
    ];
    for (const item of scopeEvidence) {
      const family = item.family || null;
      const regime = item.regime || null;
      const session = item.session || null;
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
    const recentProbeTrades = recentPaperTrades.filter((trade) => trade.learningLane === "probe");
    const latestTimestamp = (values = []) => {
      let bestValue = null;
      let bestTime = Number.NEGATIVE_INFINITY;
      for (const value of values) {
        if (!value) {
          continue;
        }
        const timestamp = new Date(value).getTime();
        if (!Number.isFinite(timestamp) || timestamp <= bestTime) {
          continue;
        }
        bestTime = timestamp;
        bestValue = value;
      }
      return bestValue;
    };
    const ageHoursFrom = (value) => {
      if (!value) {
        return Number.POSITIVE_INFINITY;
      }
      const timestamp = new Date(value).getTime();
      const nowTimestamp = new Date(referenceNow).getTime();
      if (!Number.isFinite(timestamp) || !Number.isFinite(nowTimestamp)) {
        return Number.POSITIVE_INFINITY;
      }
      return Math.max(0, (nowTimestamp - timestamp) / 3_600_000);
    };
    const outcomeCounts = {};
    for (const trade of recentPaperTrades) {
      const outcome = resolvePaperOutcomeBucket(trade);
      outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;
    }
    const budgetSeed = entries.find((item) => item.paperLearningBudget)?.paperLearningBudget || {};
    const probeDailyLimit = budgetSeed.probeDailyLimit || this.config.paperLearningProbeDailyLimit || 0;
    const shadowDailyLimit = budgetSeed.shadowDailyLimit || this.config.paperLearningShadowDailyLimit || 0;
    const budget = {
      probeDailyLimit,
      probeUsed: probeBudgetUsed,
      probeRemaining: Math.max(0, probeDailyLimit - probeBudgetUsed),
      shadowDailyLimit,
      shadowUsed: shadowBudgetUsed,
      shadowRemaining: Math.max(0, shadowDailyLimit - shadowBudgetUsed)
    };
    const topBlockers = Object.entries(blockerCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([id, count]) => ({ id, count }));
    const summarizeScopeReadiness = (records, type, pickId, options = {}) => Object.entries(
      records.reduce((acc, record) => {
        const id = pickId(record);
        if (!id) {
          return acc;
        }
        acc[id] = acc[id] || [];
        acc[id].push(record);
        return acc;
      }, {})
    )
      .map(([id, items]) => {
        const latestObservedAt = latestTimestamp(items.map((item) => options.evidenceOnly
          ? item.resolvedAt || item.queuedAt || item.generatedAt || null
          : item.exitAt || item.entryAt || null));
        if (options.evidenceOnly) {
          const avgLearning = average(items.map((item) => item.learningValueScore || 0), 0);
          const avgNovelty = average(items.map((item) => item.paperLearning?.noveltyScore || 0), 0);
          const avgActive = average(items.map((item) => item.paperLearning?.activeLearning?.score || 0), 0);
          const freshness = weightedAverage(
            items,
            () => 1,
            (item) => item.resolvedAt || item.queuedAt || item.generatedAt || referenceNow,
            0.45
          );
          const readinessScore = clamp(
            0.18 +
              Math.min(0.24, items.length / 8) +
              avgLearning * 0.22 +
              avgNovelty * 0.16 +
              avgActive * 0.16 +
              freshness * 0.12,
            0,
            1
          );
          return {
            id,
            type,
            count: items.length,
            readinessScore,
            status: readinessScore >= 0.68 ? "building" : readinessScore >= 0.48 ? "warming" : "warmup",
            goodRate: avgActive,
            weakRate: Math.max(0, 1 - avgLearning),
            freshness,
            latestObservedAt,
            source: options.source || "shadow_learning"
          };
        }
        const goodCount = items.filter((trade) => ["good_trade", "acceptable_trade"].includes(resolvePaperOutcomeBucket(trade))).length;
        const weakCount = items.filter((trade) => ["bad_trade", "early_exit", "late_exit", "execution_drag"].includes(resolvePaperOutcomeBucket(trade))).length;
        const goodRate = goodCount / Math.max(items.length, 1);
        const weakRate = weakCount / Math.max(items.length, 1);
        const freshness = weightedAverage(items, () => 1, (trade) => trade.exitAt || trade.entryAt, 0.4);
        const readinessScore = clamp(0.26 + Math.min(0.24, items.length / 10) + goodRate * 0.26 - weakRate * 0.2 + freshness * 0.14, 0, 1);
        return {
          id,
          type,
          count: items.length,
          readinessScore,
          status: readinessScore >= 0.72 ? "paper_ready" : readinessScore >= 0.54 ? "building" : "warmup",
          goodRate,
          weakRate,
          freshness,
          latestObservedAt,
          source: options.source || "probe_trades"
        };
      })
      .sort((left, right) => right.readinessScore - left.readinessScore)
      .slice(0, 2);
    const probeScopeReadiness = [
      ...summarizeScopeReadiness(recentProbeTrades, "strategy_family", (trade) => trade.strategyFamily || null),
      ...summarizeScopeReadiness(recentProbeTrades, "regime", (trade) => trade.regimeAtEntry || null),
      ...summarizeScopeReadiness(recentProbeTrades, "session", (trade) => trade.sessionAtEntry || null)
    ];
    const sandboxStates = learningEntries
      .map((item) => item.paperThresholdSandbox || item.paperLearning?.thresholdSandbox)
      .filter((item) => item?.status && item.status !== "warmup")
      .sort((left, right) => Math.abs(right.thresholdShift || 0) - Math.abs(left.thresholdShift || 0));
    const thresholdSandbox = sandboxStates[0]
      ? {
          status: sandboxStates[0].status,
          scopeLabel: [sandboxStates[0].scope?.family, sandboxStates[0].scope?.regime, sandboxStates[0].scope?.session].filter(Boolean).join(" | "),
          thresholdShift: sandboxStates[0].thresholdShift || 0,
          sampleSize: sandboxStates[0].sampleSize || 0
        }
      : null;
    const offlineTrainer = summarizeOfflineTrainer(this.runtime?.offlineTrainer || {});
    const tuningRecommendation = offlineTrainer.thresholdPolicy?.topRecommendation || null;
    const counterfactuals = arr(this.journal?.counterfactuals || [])
      .filter((item) => (item.brokerMode || "paper") === "paper" && isUsableCounterfactual(item))
      .slice(-80);
    const replayPacks = this.runtime?.ops?.replayChaos?.replayPacks || this.runtime?.replayChaos?.replayPacks || {};
    let reviewPacks = {
      bestProbeWinner: replayPacks.probeWinners?.[0]?.symbol || null,
      weakestProbe: replayPacks.paperMisses?.[0]?.symbol || null,
      topMissedSetup: replayPacks.nearMissSetups?.[0]?.symbol || null
    };
    const recentProbeReviews = recentProbeTrades
      .slice(-4)
      .reverse()
      .map((trade) => summarizePaperTradeReview(trade));
    const resolvedShadowReviews = counterfactuals
      .filter((item) => item.learningLane === "shadow" || arr(item.branches || []).length > 0)
      .slice(-6)
      .map((item) => summarizeCounterfactualReview(item));
    const queuedShadowReviews = arr(this.runtime?.counterfactualQueue || [])
      .filter((item) => (item.brokerMode || "paper") === "paper" && isShadowReviewCase(item))
      .slice(-6)
      .map((item) => summarizeQueuedCounterfactualReview(item));
    const recentShadowReviews = [...resolvedShadowReviews, ...queuedShadowReviews]
      .sort((left, right) => shadowReviewSortTime(right) - shadowReviewSortTime(left))
      .filter((item, index, items) => item?.symbol && items.findIndex((entry) => entry?.symbol === item.symbol) === index)
      .slice(0, 6);
    const latestProbeClosedAt = latestTimestamp(recentProbeTrades.map((trade) => trade.exitAt || trade.entryAt || null));
    const latestLiveClosedAt = latestTimestamp(arr(this.journal?.trades || [])
      .filter((trade) => (trade.brokerMode || "paper") === "live")
      .map((trade) => trade.exitAt || trade.entryAt || null));
    const latestShadowReviewAt = latestTimestamp([
      ...counterfactuals.filter((item) => isShadowReviewCase(item)).map((item) => item.resolvedAt || item.reviewedAt || item.queuedAt || null),
      ...arr(this.runtime?.counterfactualQueue || [])
        .filter((item) => (item.brokerMode || "paper") === "paper" && isShadowReviewCase(item))
        .map((item) => item.queuedAt || item.generatedAt || null)
    ]);
    const shadowLearningEvidence = [
      ...counterfactuals
        .filter((item) => isShadowReviewCase(item))
        .slice(-20)
        .map((item) => ({
          symbol: item.symbol || null,
          strategy: {
            family: item.strategyFamily || null
          },
          regime: item.regime || null,
          session: {
            session: item.sessionAtEntry || null
          },
          learningValueScore: clamp(num(item.learningValueScore || 0.48, 4), 0, 1),
          paperLearning: {
            scope: {
              family: item.strategyFamily || null,
              regime: item.regime || null,
              session: item.sessionAtEntry || null
            },
            noveltyScore: clamp(num(item.learningValueScore || 0.52, 4), 0.3, 1),
            activeLearning: {
              score: clamp(num((item.learningValueScore || 0.42) + Math.min(0.18, arr(item.branches || []).length * 0.06), 4), 0, 1),
              focusReason: item.outcome ? `${item.outcome}_review` : "shadow_review"
            }
          }
        })),
      ...arr(this.runtime?.counterfactualQueue || [])
        .filter((item) => (item.brokerMode || "paper") === "paper" && isShadowReviewCase(item))
        .slice(-20)
        .map((item) => ({
          symbol: item.symbol || null,
          strategy: {
            family: item.strategyFamily || null
          },
          regime: item.regime || null,
          session: {
            session: item.sessionAtEntry || null
          },
          learningValueScore: clamp(num(item.learningValueScore || 0.46, 4), 0, 1),
          paperLearning: {
            scope: {
              family: item.strategyFamily || null,
              regime: item.regime || null,
              session: item.sessionAtEntry || null
            },
            noveltyScore: clamp(num(item.learningValueScore || 0.5, 4), 0.3, 1),
            activeLearning: {
              score: clamp(num((item.learningValueScore || 0.4) + Math.min(0.16, arr(item.branchScenarios || []).length * 0.05), 4), 0, 1),
              focusReason: "shadow_review"
            }
          }
        }))
    ];
    const shadowOutcomeCounts = {};
    for (const item of counterfactuals.filter((entry) => isShadowReviewCase(entry))) {
      if (!item?.outcome) {
        continue;
      }
      shadowOutcomeCounts[item.outcome] = (shadowOutcomeCounts[item.outcome] || 0) + 1;
    }
    for (const item of arr(this.runtime?.counterfactualQueue || []).filter((entry) => (entry.brokerMode || "paper") === "paper" && isShadowReviewCase(entry))) {
      shadowOutcomeCounts.shadow_watch = (shadowOutcomeCounts.shadow_watch || 0) + 1;
    }
    const recentOutcomes = Object.entries({
      ...outcomeCounts,
      ...Object.fromEntries(
        Object.entries(shadowOutcomeCounts).map(([id, count]) => [id, count + (outcomeCounts[id] || 0)])
      )
    })
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([id, count]) => ({ id, count }));
    const evidenceScopeReadiness = [
      ...summarizeScopeReadiness(shadowLearningEvidence, "strategy_family", (item) => item.paperLearning?.scope?.family || item.strategy?.family || null, { evidenceOnly: true }),
      ...summarizeScopeReadiness(shadowLearningEvidence, "regime", (item) => item.paperLearning?.scope?.regime || item.regime || null, { evidenceOnly: true }),
      ...summarizeScopeReadiness(shadowLearningEvidence, "session", (item) => item.paperLearning?.scope?.session || item.session?.session || null, { evidenceOnly: true })
    ];
    const scopeReadiness = [...probeScopeReadiness, ...evidenceScopeReadiness]
      .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id && candidate.type === item.type) === index)
      .sort((left, right) => {
        if ((left.source === "probe_trades") !== (right.source === "probe_trades")) {
          return left.source === "probe_trades" ? -1 : 1;
        }
        return right.readinessScore - left.readinessScore;
      })
      .slice(0, 6);
    const scoredLearningEntries = [...learningEntries, ...shadowLearningEvidence]
      .filter((item) => item && (item.symbol || item.learningValueScore || item.paperLearning?.activeLearning?.score))
      .filter((item, index, all) => {
        const key = [
          item.symbol || "",
          item.paperLearning?.activeLearning?.focusReason || "",
          item.paperLearning?.scope?.family || item.strategy?.family || "",
          item.paperLearning?.scope?.regime || item.regime || "",
          item.paperLearning?.scope?.session || item.session?.session || ""
        ].join("|");
        return all.findIndex((candidate) => {
          const candidateKey = [
            candidate.symbol || "",
            candidate.paperLearning?.activeLearning?.focusReason || "",
            candidate.paperLearning?.scope?.family || candidate.strategy?.family || "",
            candidate.paperLearning?.scope?.regime || candidate.regime || "",
            candidate.paperLearning?.scope?.session || candidate.session?.session || ""
          ].join("|");
          return candidateKey === key;
        }) === index;
      });
    const recentProbeSignals = recentProbeTrades.map((trade) => ({ trade, signal: buildPaperOutcomeSignal(trade) }));
    const probeGoodCount = recentProbeSignals.filter(({ signal }) => ["good_trade", "acceptable_trade"].includes(signal.outcome)).length;
    const probeWeakCount = recentProbeSignals.filter(({ signal }) => ["bad_trade", "early_exit", "late_exit", "execution_drag"].includes(signal.outcome)).length;
    const probeExecutionDragCount = recentProbeSignals.filter(({ signal }) => signal.executionDrag).length;
    const probeQualityTrapCount = recentProbeSignals.filter(({ signal }) => signal.qualityTrap).length;
    const probeWeakSetupCount = recentProbeSignals.filter(({ signal }) => signal.weakSetup).length;
    const probeFollowThroughFailedCount = recentProbeSignals.filter(({ signal }) => signal.followThroughFailed).length;
    const dominantProbationWeakness = [
      ["execution_drag", probeExecutionDragCount],
      ["quality_trap", probeQualityTrapCount],
      ["weak_setup", probeWeakSetupCount],
      ["follow_through_failed", probeFollowThroughFailedCount]
    ].sort((left, right) => right[1] - left[1])[0];
    const promotionReady = recentProbeTrades.length >= 4 &&
      probeGoodCount >= Math.ceil(recentProbeTrades.length * 0.6) &&
      probeExecutionDragCount <= Math.max(1, Math.floor(recentProbeTrades.length * 0.25)) &&
      probeQualityTrapCount === 0 &&
      probeWeakSetupCount <= Math.max(1, Math.floor(recentProbeTrades.length * 0.34));
    const rollbackRisk = recentProbeTrades.length >= 3 && (
      probeWeakCount >= Math.ceil(recentProbeTrades.length * 0.5) ||
      probeExecutionDragCount >= Math.ceil(recentProbeTrades.length * 0.5) ||
      probeQualityTrapCount >= Math.max(1, Math.ceil(recentProbeTrades.length * 0.34))
    );
    const avgLearningValue = average(scoredLearningEntries.map((item) => item.learningValueScore || 0), 0);
    const avgNovelty = average(scoredLearningEntries.map((item) => item.paperLearning?.noveltyScore || 0), 0);
    const avgActiveLearning = average(scoredLearningEntries.map((item) => item.paperLearning?.activeLearning?.score || 0), 0);
    const recencyFreshnessScore = weightedAverage(
      recentPaperTrades,
      () => 1,
      (trade) => trade.exitAt || trade.entryAt,
      0.35
    );
    const readinessScore = clamp(
      0.24 +
        Math.min(0.22, recentProbeTrades.length / 18) +
        avgLearningValue * 0.18 +
        avgNovelty * 0.12 +
        avgActiveLearning * 0.08 +
        recencyFreshnessScore * 0.08 +
        (promotionReady ? 0.12 : 0) -
        Math.min(0.08, probeExecutionDragCount * 0.025) -
        Math.min(0.08, probeQualityTrapCount * 0.03) -
        Math.min(0.05, probeWeakSetupCount * 0.016) -
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
    const latestClosedLearningAt = latestTimestamp([latestProbeClosedAt, latestLiveClosedAt]);
    const closedLearningAgeHours = ageHoursFrom(latestClosedLearningAt);
    const shadowReviewAgeHours = ageHoursFrom(latestShadowReviewAt);
    const staleClosedLearning = !latestClosedLearningAt || closedLearningAgeHours >= 72;
    const freshestEvidenceScope = evidenceScopeReadiness[0] ||
      scopeReadiness.find((item) => item.source && item.source !== "probe_trades") ||
      null;
    const displayPrimaryScope = staleClosedLearning && freshestEvidenceScope
      ? freshestEvidenceScope
      : scopeReadiness[0] || null;
    const inputHealth = {
      status: staleClosedLearning ? "stalled" : "fresh",
      staleClosedLearning,
      latestClosedLearningAt,
      latestProbeClosedAt,
      latestLiveClosedAt,
      latestShadowReviewAt,
      latestScopeSource: displayPrimaryScope?.source || null,
      closedLearningAgeHours,
      shadowReviewAgeHours,
      note: staleClosedLearning
        ? latestClosedLearningAt
          ? `Geen nieuwe probe/live closed trades sinds ${latestClosedLearningAt}; gebruik daarom ${displayPrimaryScope?.source === "shadow_learning" ? "freshere shadow-learning" : "de laatst beschikbare evidence"} als huidige leerscope.`
          : `Nog geen probe/live closed trades beschikbaar; gebruik daarom ${displayPrimaryScope?.source === "shadow_learning" ? "shadow-learning" : "active learning"} als tijdelijke leerscope.`
        : latestClosedLearningAt
          ? `Laatste probe/live closed trade op ${latestClosedLearningAt}.`
          : "Learning input wordt ververst zodra nieuwe probe/live closes binnenkomen."
    };
    const promotedScope = probeScopeReadiness[0] || scopeReadiness[0] || null;
    const paperToLiveReadiness = {
      status: promotedScope?.status || readinessStatus,
      score: clamp(
        readinessScore * 0.52 +
        (promotedScope?.readinessScore || 0) * 0.28 +
        (promotionReady ? 0.12 : 0) -
        Math.min(0.08, probeExecutionDragCount * 0.025) -
        Math.min(0.08, probeQualityTrapCount * 0.03) -
        ((topBlockers[0]?.count || 0) >= 3 ? 0.08 : 0),
        0,
        1
      ),
      topScope: promotedScope?.id || null,
      blocker: dominantProbationWeakness?.[1] ? dominantProbationWeakness[0] : topBlockers[0]?.id || null,
      note: promotedScope
        ? dominantProbationWeakness?.[1]
          ? `${promotedScope.id} is de beste paper-scope, maar ${humanizeReason(dominantProbationWeakness[0])} remt nog de volgende promotion-stap.`
          : `${promotedScope.id} is momenteel de beste paper-scope voor een volgende probationstap.`
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
      executionDragCount: probeExecutionDragCount,
      qualityTrapCount: probeQualityTrapCount,
      weakSetupCount: probeWeakSetupCount,
      followThroughFailedCount: probeFollowThroughFailedCount,
      dominantWeakness: dominantProbationWeakness?.[1] ? dominantProbationWeakness[0] : null,
      note: recentProbeTrades.length < 3
        ? "Nog te weinig gesloten probe-trades voor paper probation."
        : promotionReady
          ? "Recente probe-trades zijn sterk genoeg om paper-promotie te overwegen."
          : dominantProbationWeakness?.[1]
            ? `Probation blijft nog te zwak door ${humanizeReason(dominantProbationWeakness[0])}.`
          : rollbackRisk
            ? "Recente probe-trades tonen zwakke uitkomsten; rollback of strakkere gating is verstandig."
          : "Paper-probation loopt nog; verzamel extra gesloten probe-trades."
    };
    const rankedActiveCandidates = scoredLearningEntries
      .map((item) => ({
        symbol: item.symbol || null,
        score: clamp(
          (item.paperLearning?.activeLearning?.score || 0) +
          (item.paperLearning?.allocatorGovernance?.priorityBoost || 0),
          0,
          1
        ),
        reason: item.paperLearning?.activeLearning?.focusReason || null,
        noveltyScore: item.paperLearning?.noveltyScore || 0,
        rarityScore: item.paperLearning?.rarityScore || 0,
        disagreementScore: item.paperLearning?.activeLearning?.disagreementScore || 0,
        uncertaintyScore: item.paperLearning?.activeLearning?.uncertaintyScore || 0,
        allocatorGovernance: item.paperLearning?.allocatorGovernance || null,
        scopeLabel: [
          item.paperLearning?.scope?.family || item.strategy?.family || null,
          item.paperLearning?.scope?.regime || item.regime || null,
          item.paperLearning?.scope?.session || item.session?.session || null
        ].filter(Boolean).join(" | ") || null
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map((item) => ({
        ...item,
        priorityBand: item.score >= 0.75
          ? "high_priority"
          : item.score >= 0.58
            ? "priority"
            : "observe"
      }));
    const focusScopeStats = new Map();
    for (const item of scoredLearningEntries) {
      const family = item.paperLearning?.scope?.family || item.strategy?.family || null;
      const regime = item.paperLearning?.scope?.regime || item.regime || null;
      const session = item.paperLearning?.scope?.session || item.session?.session || null;
      const scopeId = [family, regime, session].filter(Boolean).join(" | ");
      if (!scopeId) {
        continue;
      }
      if (!focusScopeStats.has(scopeId)) {
        focusScopeStats.set(scopeId, {
          id: scopeId,
          count: 0,
          scoreSum: 0,
          topReason: null
        });
      }
      const bucket = focusScopeStats.get(scopeId);
      bucket.count += 1;
      bucket.scoreSum += item.paperLearning?.activeLearning?.score || 0;
      if (!bucket.topReason && item.paperLearning?.activeLearning?.focusReason) {
        bucket.topReason = item.paperLearning.activeLearning.focusReason;
      }
    }
    const focusScopes = [...focusScopeStats.values()]
      .map((item) => ({
        id: item.id,
        count: item.count,
        score: item.count ? item.scoreSum / item.count : 0,
        topReason: item.topReason || null
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);
    const experimentScopes = [
      ...scopeReadiness.map((item) => ({
        id: item.id,
        source: "readiness",
        score: item.readinessScore || 0,
        status: item.status || "warmup",
        action: item.status === "paper_ready"
          ? "probation"
          : item.status === "building"
            ? "sandbox"
            : "observe",
        reason: item.status === "paper_ready"
          ? "Sterk genoeg voor een volgende paper probationstap."
          : item.status === "building"
            ? "Goed genoeg voor extra sandbox- of probe-aandacht."
            : "Nog vooral leerdata verzamelen."
      })),
      ...focusScopes.map((item) => ({
        id: item.id,
        source: "focus",
        score: item.score || 0,
        status: item.score >= 0.68 ? "priority" : "observe",
        action: item.score >= 0.68 ? "sample_more" : "observe",
        reason: item.topReason
          ? `Active learning focust hier nu op ${item.topReason}.`
          : "Deze scope levert nu extra leerwaarde op."
      }))
    ]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);
    const scopeCoaching = {
      strongest: displayPrimaryScope
        ? {
            id: displayPrimaryScope.id,
            status: displayPrimaryScope.status,
            score: displayPrimaryScope.readinessScore || 0,
            action: displayPrimaryScope.status === "paper_ready" ? "probation" : "sandbox",
            source: displayPrimaryScope.source || "probe_trades"
          }
        : null,
      weakest: scopeReadiness.length
        ? {
            id: scopeReadiness[scopeReadiness.length - 1].id,
            status: scopeReadiness[scopeReadiness.length - 1].status,
            score: scopeReadiness[scopeReadiness.length - 1].readinessScore || 0,
            action: "collect_more_data",
            source: scopeReadiness[scopeReadiness.length - 1].source || "probe_trades"
          }
        : null,
      note: displayPrimaryScope
        ? staleClosedLearning && displayPrimaryScope.source !== "probe_trades"
          ? `${displayPrimaryScope.id} is nu de versere leerscope, omdat probe/live closed trades stilvallen sinds ${latestClosedLearningAt || "de laatste closed learning update"}.`
          : displayPrimaryScope.source === "shadow_learning"
            ? `${displayPrimaryScope.id} springt nu uit de shadow-learning data; bevestig dit nog met extra probes.`
            : `${displayPrimaryScope.id} is nu het sterkst; ${scopeReadiness[scopeReadiness.length - 1]?.id || "andere scopes"} hebben nog meer leerdata nodig.`
        : "Nog geen duidelijke scope-coaching beschikbaar."
    };
    const activeLearning = {
      status: rankedActiveCandidates[0]?.score >= 0.65 ? "priority" : rankedActiveCandidates.length ? "observe" : "warmup",
      score: rankedActiveCandidates[0]?.score || avgActiveLearning || 0,
      focusReason: rankedActiveCandidates[0]?.reason || null,
      focusScopes,
      topCandidates: rankedActiveCandidates,
      note: rankedActiveCandidates[0]
        ? `${rankedActiveCandidates[0].symbol || "De top candidate"} is nu het meest informatieve leergeval door ${titleize(rankedActiveCandidates[0].reason || "active learning")}.`
        : "Nog geen uitgesproken active-learning kandidaat zichtbaar."
    };
    const performanceReport = buildPerformanceReport({ journal: this.journal, runtime: this.runtime, config: this.config });
    const paperReportTrades = arr(performanceReport.recentTrades || []).filter((trade) => (trade.brokerMode || "paper") === "paper");
    const paperTradeQualityReviews = paperReportTrades.map((trade) => ({ trade, review: buildTradeQualityReview(trade) }));
    const topExecutionDragTrade = paperTradeQualityReviews
      .filter((item) => buildPaperOutcomeSignal(item.trade).executionDrag)
      .sort((left, right) => (left.review.executionScore || 0) - (right.review.executionScore || 0))[0]?.trade || null;
    const topQualityTrapTrade = paperTradeQualityReviews
      .filter((item) => buildPaperOutcomeSignal(item.trade).qualityTrap)
      .sort((left, right) => (right.trade.mfePct || 0) - (left.trade.mfePct || 0))[0]?.trade || null;
    reviewPacks = {
      ...reviewPacks,
      topExecutionDrag: topExecutionDragTrade?.symbol || null,
      topQualityTrap: topQualityTrapTrade?.symbol || null,
      topProbationRisk: topQualityTrapTrade?.symbol || topExecutionDragTrade?.symbol || null
    };
    const averageSetupReviewScore = average(paperTradeQualityReviews.map((item) => item.review.setupScore || 0), 0);
    const averageExecutionReviewScore = average(paperTradeQualityReviews.map((item) => item.review.executionScore || 0), 0);
    const averageOutcomeReviewScore = average(paperTradeQualityReviews.map((item) => item.review.outcomeScore || 0), 0);
    const executionDragCount = paperTradeQualityReviews.filter((item) => item.review.verdict === "execution_drag").length;
    const setupDragCount = paperTradeQualityReviews.filter((item) => item.review.verdict === "weak_setup").length;
    const followThroughDragCount = paperTradeQualityReviews.filter((item) => item.review.verdict === "follow_through_failed").length;
    const slippageSamples = paperReportTrades
      .map((trade) => trade.entryExecutionAttribution?.slippageDeltaBps)
      .filter((value) => Number.isFinite(value));
    const latencySamples = paperReportTrades
      .map((trade) => trade.entryExecutionAttribution?.latencyBps)
      .filter((value) => Number.isFinite(value));
    const avgSlippageDeltaBps = average(slippageSamples, 0);
    const avgLatencyBps = average(latencySamples, 0);
    const bestExecutionStyle = performanceReport.attribution?.executionStyles?.[0] || null;
    const weakestExecutionStyle = [...arr(performanceReport.attribution?.executionStyles || [])]
      .sort((left, right) => (left.realizedPnl || 0) - (right.realizedPnl || 0))[0] || null;
    const blockerScorecards = arr(offlineTrainer.blockerScorecards || []);
    const strictestBlocker = [...blockerScorecards]
      .sort((left, right) => {
        const strictnessDelta = (right.badVetoRate || 0) - (left.badVetoRate || 0);
        return strictnessDelta !== 0 ? strictnessDelta : (left.governanceScore || 0) - (right.governanceScore || 0);
      })[0] || null;
    const safestBlocker = [...blockerScorecards]
      .sort((left, right) => {
        const safetyDelta = (right.goodVetoRate || 0) - (left.goodVetoRate || 0);
        return safetyDelta !== 0 ? safetyDelta : (right.governanceScore || 0) - (left.governanceScore || 0);
      })[0] || null;
    const thresholdRecommendation = offlineTrainer.thresholdPolicy?.topRecommendation || null;
    const branchStats = new Map();
    for (const item of counterfactuals) {
      for (const branch of arr(item.branches || [])) {
        const key = branch.id || branch.kind || "branch";
        if (!branchStats.has(key)) {
          branchStats.set(key, { id: key, winnerCount: 0, total: 0 });
        }
        const bucket = branchStats.get(key);
        bucket.total += 1;
        if (["winner", "small_winner"].includes(branch.outcome)) {
          bucket.winnerCount += 1;
        }
      }
    }
    const safeTrades = recentPaperTrades.filter((trade) => trade.learningLane === "safe");
    const actualProbeWinRate = recentProbeTrades.length
      ? recentProbeTrades.filter((trade) => ["good_trade", "acceptable_trade"].includes(resolvePaperOutcomeBucket(trade))).length / recentProbeTrades.length
      : 0;
    const actualProbeAvgPnlPct = average(recentProbeTrades.map((trade) => trade.netPnlPct || 0), 0);
    const safeLaneWinRate = safeTrades.length
      ? safeTrades.filter((trade) => ["good_trade", "acceptable_trade"].includes(resolvePaperOutcomeBucket(trade))).length / safeTrades.length
      : 0;
    const shadowTakeWinRate = counterfactuals.length
      ? counterfactuals.filter((item) => ["bad_veto", "missed_winner", "right_direction_wrong_timing"].includes(item.outcome)).length / counterfactuals.length
      : 0;
    const shadowSkipWinRate = counterfactuals.length
      ? counterfactuals.filter((item) => ["good_veto", "blocked_correctly"].includes(item.outcome)).length / counterfactuals.length
      : 0;
    const benchmarkLaneEntries = [
      { id: "probe_lane", score: actualProbeWinRate + Math.max(0, actualProbeAvgPnlPct) * 8 },
      { id: "safe_lane", score: safeLaneWinRate },
      { id: "shadow_take", score: shadowTakeWinRate },
      { id: "shadow_skip", score: shadowSkipWinRate }
    ].sort((left, right) => right.score - left.score);
    const alwaysTakeWinRate = (recentPaperTrades.length + counterfactuals.length)
      ? (
        recentPaperTrades.filter((trade) => ["good_trade", "acceptable_trade"].includes(resolvePaperOutcomeBucket(trade))).length +
        counterfactuals.filter((item) => ["bad_veto", "missed_winner", "right_direction_wrong_timing"].includes(item.outcome)).length
      ) / (recentPaperTrades.length + counterfactuals.length)
      : 0;
    const alwaysSkipWinRate = counterfactuals.length
      ? counterfactuals.filter((item) => ["good_veto", "blocked_correctly", "neutral"].includes(item.outcome)).length / counterfactuals.length
      : shadowSkipWinRate;
    const fixedThresholdTrades = recentPaperTrades.filter((trade) => Number.isFinite(trade.probabilityAtEntry) && trade.probabilityAtEntry >= 0.55);
    const fixedThresholdWinRate = fixedThresholdTrades.length
      ? fixedThresholdTrades.filter((trade) => ["good_trade", "acceptable_trade"].includes(resolvePaperOutcomeBucket(trade))).length / fixedThresholdTrades.length
      : 0;
    const simpleExitStats = branchStats.get("earlier_take_profit");
    const simpleExitWinRate = simpleExitStats?.total ? simpleExitStats.winnerCount / simpleExitStats.total : 0;
    const expandedBenchmarkEntries = [
      ...benchmarkLaneEntries,
      { id: "always_take", score: alwaysTakeWinRate },
      { id: "always_skip", score: alwaysSkipWinRate },
      { id: "fixed_threshold", score: fixedThresholdWinRate },
      { id: "simple_exit", score: simpleExitWinRate }
    ]
      .map((item) => ({
        ...item,
        deltaVsProbe: item.id === "probe_lane"
          ? 0
          : num(item.score - (actualProbeWinRate + Math.max(0, actualProbeAvgPnlPct) * 8), 4)
      }))
      .sort((left, right) => right.score - left.score);
    const benchmarkLanes = {
      actualProbeWinRate,
      actualProbeAvgPnlPct,
      safeLaneWinRate,
      shadowTakeWinRate,
      shadowSkipWinRate,
      alwaysTakeWinRate,
      alwaysSkipWinRate,
      fixedThresholdWinRate,
      simpleExitWinRate,
      rankedLanes: expandedBenchmarkEntries.slice(0, 7),
      bestLane: expandedBenchmarkEntries[0]?.id || null,
      note: expandedBenchmarkEntries[0]?.id === "shadow_take"
        ? "Shadow-cases tonen nu relatief vaak dat near-miss setups toch doorliepen."
        : expandedBenchmarkEntries[0]?.id === "safe_lane"
          ? "De veilige lane presteert nu stabieler dan probes."
          : expandedBenchmarkEntries[0]?.id === "probe_lane"
            ? "De probe-lane levert nu de beste leer- en resultaatmix."
            : expandedBenchmarkEntries[0]?.id === "always_take"
              ? "Een brede take-benchmark doet het nu opvallend goed; paper kan mogelijk nog te streng zijn."
              : expandedBenchmarkEntries[0]?.id === "fixed_threshold"
                ? "Een eenvoudige threshold-benchmark blijft nu verrassend competitief."
            : "Shadow-skip blijft voorlopig de veiligste benchmark."
    };
    const challengerScorecards = [
      {
        id: "probe_lane",
        sampleCount: recentProbeTrades.length,
        winRate: actualProbeWinRate,
        avgPnlPct: actualProbeAvgPnlPct,
        score: actualProbeWinRate + Math.max(0, actualProbeAvgPnlPct) * 8,
        source: "observed",
        scope: scopeReadiness[0]?.id || null
      },
      {
        id: "safe_lane",
        sampleCount: safeTrades.length,
        winRate: safeLaneWinRate,
        avgPnlPct: average(safeTrades.map((trade) => trade.netPnlPct || 0), 0),
        score: safeLaneWinRate,
        source: "observed",
        scope: null
      },
      {
        id: "shadow_take",
        sampleCount: counterfactuals.length,
        winRate: shadowTakeWinRate,
        avgPnlPct: average(counterfactuals
          .filter((item) => ["bad_veto", "missed_winner", "right_direction_wrong_timing"].includes(item.outcome))
          .map((item) => item.realizedMovePct || item.bestBranch?.adjustedMovePct || 0), 0),
        score: shadowTakeWinRate,
        source: "counterfactual",
        scope: focusScopes[0]?.id || null
      },
      {
        id: "always_take",
        sampleCount: recentPaperTrades.length + counterfactuals.length,
        winRate: alwaysTakeWinRate,
        avgPnlPct: average([
          ...recentPaperTrades.map((trade) => trade.netPnlPct || 0),
          ...counterfactuals.map((item) => item.realizedMovePct || 0)
        ], 0),
        score: alwaysTakeWinRate,
        source: "synthetic",
        scope: null
      },
      {
        id: "fixed_threshold",
        sampleCount: fixedThresholdTrades.length,
        winRate: fixedThresholdWinRate,
        avgPnlPct: average(fixedThresholdTrades.map((trade) => trade.netPnlPct || 0), 0),
        score: fixedThresholdWinRate,
        source: "synthetic",
        scope: scopeReadiness[0]?.id || null
      }
    ]
      .filter((item) => item.sampleCount > 0)
      .map((item) => ({
        ...item,
        edgeVsProbe: num(item.score - (actualProbeWinRate + Math.max(0, actualProbeAvgPnlPct) * 8), 4),
        status: item.id === "probe_lane"
          ? "baseline"
          : item.score >= (actualProbeWinRate + Math.max(0, actualProbeAvgPnlPct) * 8) + 0.02
            ? "challenger"
            : item.score >= (actualProbeWinRate + Math.max(0, actualProbeAvgPnlPct) * 8) - 0.02
              ? "close"
              : "lagging"
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
    const buildScopeComparison = (type, left, right) => {
      if (!left || !right || left.id === right.id) {
        return null;
      }
      return {
        id: `${type}:${left.id}->${right.id}`,
        type,
        baseline: left.id,
        challenger: right.id,
        baselineScore: left.readinessScore || left.score || 0,
        challengerScore: right.readinessScore || right.score || 0,
        deltaScore: num((right.readinessScore || right.score || 0) - (left.readinessScore || left.score || 0), 4),
        winner: (right.readinessScore || right.score || 0) > (left.readinessScore || left.score || 0) ? right.id : left.id,
        recommendation: (right.readinessScore || right.score || 0) > (left.readinessScore || left.score || 0) + 0.03
          ? "promote_challenger_scope"
          : "observe",
        note: `${titleize(right.id)} wordt nu vergeleken met ${titleize(left.id)} binnen ${titleize(type)}.`
      };
    };
    const familyScopes = scopeReadiness.filter((item) => item.type === "strategy_family");
    const regimeScopes = scopeReadiness.filter((item) => item.type === "regime");
    const sessionScopes = scopeReadiness.filter((item) => item.type === "session");
    const abExperiments = [
      buildScopeComparison("strategy_family", familyScopes[0], familyScopes[1] || focusScopes[0] ? {
        id: (familyScopes[1] || focusScopes[0])?.id,
        score: (familyScopes[1] || focusScopes[0])?.readinessScore || (familyScopes[1] || focusScopes[0])?.score || 0
      } : null),
      buildScopeComparison("regime", regimeScopes[0], regimeScopes[1]),
      buildScopeComparison("session", sessionScopes[0], sessionScopes[1]),
      challengerScorecards[0] && challengerScorecards[1]
        ? {
            id: `lane:${challengerScorecards[1].id}->${challengerScorecards[0].id}`,
            type: "policy_lane",
            baseline: challengerScorecards[0].id,
            challenger: challengerScorecards[1].id,
            baselineScore: challengerScorecards[0].score || 0,
            challengerScore: challengerScorecards[1].score || 0,
            deltaScore: num((challengerScorecards[1].score || 0) - (challengerScorecards[0].score || 0), 4),
            winner: (challengerScorecards[0].score || 0) >= (challengerScorecards[1].score || 0) ? challengerScorecards[0].id : challengerScorecards[1].id,
            recommendation: Math.abs((challengerScorecards[1].score || 0) - (challengerScorecards[0].score || 0)) >= 0.02 ? "review_policy_gap" : "collect_more_samples",
            note: `${titleize(challengerScorecards[1].id)} wordt gespiegeld aan ${titleize(challengerScorecards[0].id)} als policy challenger.`
          }
        : null
    ].filter(Boolean).slice(0, 5);
    const modelPromotionPolicy = this.runtime?.modelRegistry?.promotionPolicy || {};
    const promotionHint = this.runtime?.modelRegistry?.promotionHint || this.runtime?.researchRegistry?.governance?.promotionCandidates?.[0] || null;
    const benchmarkLeader = benchmarkLanes.rankedLanes?.[0] || null;
    const blockerAttribution = {
      status: strictestBlocker?.status || (topBlockers[0] ? "review" : "observe"),
      dominantBlocker: topBlockers[0]?.id || null,
      strictestBlocker: strictestBlocker
        ? {
            id: strictestBlocker.id || null,
            badVetoRate: strictestBlocker.badVetoRate || 0,
            governanceScore: strictestBlocker.governanceScore || 0,
            affectedStrategies: arr(strictestBlocker.affectedStrategies || []).slice(0, 3),
            affectedRegimes: arr(strictestBlocker.affectedRegimes || []).slice(0, 3)
          }
        : null,
      safestBlocker: safestBlocker
        ? {
            id: safestBlocker.id || null,
            goodVetoRate: safestBlocker.goodVetoRate || 0,
            governanceScore: safestBlocker.governanceScore || 0
          }
        : null,
      nextAction: thresholdRecommendation?.action || ((strictestBlocker?.badVetoRate || 0) > 0.4 ? "relax_review" : "observe"),
      note: thresholdRecommendation?.rationale ||
        (strictestBlocker
          ? `${titleize(strictestBlocker.id)} lijkt nu de meeste false negatives te veroorzaken.`
          : topBlockers[0]?.id
            ? `${titleize(topBlockers[0].id)} domineert de blokkades, maar heeft nog onvoldoende veto-review data.`
            : "Nog geen duidelijke blocker-attribution beschikbaar.")
    };
    const challengerPolicy = {
      status: benchmarkLeader?.id && benchmarkLeader.id !== "probe_lane"
        ? "candidate"
        : rankedActiveCandidates.length
          ? "observe"
          : "warmup",
      leadingLane: benchmarkLeader?.id || null,
      challengerEdge: modelPromotionPolicy.challengerEdge != null
        ? modelPromotionPolicy.challengerEdge
        : benchmarkLeader?.deltaVsProbe || 0,
      targetScope: experimentScopes[0]?.id || focusScopes[0]?.id || null,
      recommendation: benchmarkLeader?.id === "always_take"
        ? "review_thresholds"
        : benchmarkLeader?.id === "shadow_take"
          ? "sample_more_shadow"
          : benchmarkLeader?.id === "safe_lane"
            ? "stabilize_execution"
            : benchmarkLeader?.id === "fixed_threshold"
              ? "compare_simple_policy"
              : rankedActiveCandidates[0]
                ? "keep_probe_champion"
                : "observe",
      note: benchmarkLeader?.id === "always_take"
        ? "De challenger suggereert dat de huidige gating mogelijk te streng is tegenover een eenvoudige take-policy."
        : benchmarkLeader?.id === "shadow_take"
          ? "Shadow-take cases verslaan nu de probe-lane; extra shadow sampling kan leerwaarde opleveren."
          : benchmarkLeader?.id === "safe_lane"
            ? "De veilige lane is voorlopig stabieler dan agressievere challengers."
            : benchmarkLeader?.id === "fixed_threshold"
              ? "Een simpele threshold challenger blijft competitief en verdient side-by-side review."
              : rankedActiveCandidates[0]
                ? `${rankedActiveCandidates[0].symbol || "De top candidate"} blijft de beste challenger-case voor extra data.`
                : "Nog geen uitgesproken challenger zichtbaar."
    };
    const promotionRoadmap = {
      status: modelPromotionPolicy.allowPromotion
        ? modelPromotionPolicy.readyLevel || "ready"
        : modelPromotionPolicy.readyLevel || "blocked",
      allowPromotion: Boolean(modelPromotionPolicy.allowPromotion),
      readyLevel: modelPromotionPolicy.readyLevel || null,
      blockerReasons: arr(modelPromotionPolicy.blockerReasons || []).slice(0, 4),
      nextGate: modelPromotionPolicy.allowPromotion
        ? modelPromotionPolicy.readyLevel === "paper"
          ? "guarded_live_probation"
          : modelPromotionPolicy.readyLevel === "probation"
            ? "finish_probation"
            : "promote"
        : modelPromotionPolicy.blockerReasons?.[0] || "collect_more_data",
      promotionHint: promotionHint
        ? {
            symbol: promotionHint.symbol || null,
            governanceScore: promotionHint.governanceScore || 0,
            status: promotionHint.status || "observe"
          }
        : null,
      note: modelPromotionPolicy.allowPromotion
        ? modelPromotionPolicy.readyLevel === "paper"
          ? "Paper-resultaten zijn rijp voor guarded live probation, maar nog niet voor volledige promotie."
          : "Promotiebeleid staat grotendeels groen; bewaak nu vooral probation en execution-kwaliteit."
        : modelPromotionPolicy.blockerReasons?.length
          ? `Promotie wacht nu vooral op ${titleize(modelPromotionPolicy.blockerReasons[0])}.`
          : paperToLiveReadiness.topScope
            ? `${paperToLiveReadiness.topScope} bouwt richting promotie, maar het formele policy-signaal is nog niet groen.`
            : "Nog geen duidelijke promotieroute zichtbaar."
    };
    const executionInsights = {
      status: averageExecutionReviewScore >= 0.62 && avgSlippageDeltaBps <= 1.5
        ? "stable"
        : averageExecutionReviewScore >= 0.48
          ? "watch"
          : "repair",
      averageSetupScore: averageSetupReviewScore,
      averageExecutionScore: averageExecutionReviewScore,
      averageOutcomeScore: averageOutcomeReviewScore,
      executionDragCount,
      setupDragCount,
      followThroughDragCount,
      averageSlippageDeltaBps: avgSlippageDeltaBps,
      averageLatencyBps: avgLatencyBps,
      bestExecutionStyle: bestExecutionStyle
        ? {
            id: bestExecutionStyle.id || null,
            realizedPnl: bestExecutionStyle.realizedPnl || 0,
            winRate: bestExecutionStyle.winRate || 0
          }
        : null,
      weakestExecutionStyle: weakestExecutionStyle
        ? {
            id: weakestExecutionStyle.id || null,
            realizedPnl: weakestExecutionStyle.realizedPnl || 0,
            winRate: weakestExecutionStyle.winRate || 0
          }
        : null,
      note: executionDragCount > setupDragCount && executionDragCount > 0
        ? "Execution is momenteel vaker de beperkende factor dan setupkwaliteit."
        : followThroughDragCount > executionDragCount && followThroughDragCount > 0
          ? "Setups komen door, maar de follow-through blijft te zwak na entry."
          : averageExecutionReviewScore >= 0.62
          ? "Execution-kwaliteit is voorlopig stabiel genoeg om challengers inhoudelijk te vergelijken."
            : "Execution heeft nog toezicht nodig voordat policy-vergelijkingen echt zuiver zijn."
    };
    const historyCoverage = offlineTrainer.historyCoverage || {};
    const strategyRetirement = this.runtime?.strategyRetirement || {};
    const offlineTrainerConditionTransitions = arr(this.runtime?.offlineTrainer?.policyTransitionCandidatesByCondition || []);
    const retirementPolicies = arr(strategyRetirement.policies || []);
    const operatorPolicyState = this.ensureOperatorPolicyState();
    const recentDismissals = arr(operatorPolicyState.dismissals || []).filter((item) => {
      const at = new Date(item.dismissedAt || 0).getTime();
      return Number.isFinite(at) && (new Date(referenceNow).getTime() - at) <= 24 * 60 * 60 * 1000;
    });
    const approvedTransitions = arr(operatorPolicyState.approvals || []).slice(0, 10);
    const allocatorPolicyCandidates = [];
    const allocatorCandidateKeys = new Set();
    for (const item of scoredLearningEntries) {
      const allocatorGovernance = item.paperLearning?.allocatorGovernance || null;
      if (!allocatorGovernance?.applied) {
        continue;
      }
      const scopeLabel = [
        item.paperLearning?.scope?.family || item.strategy?.family || null,
        item.paperLearning?.scope?.regime || item.regime || null,
        item.paperLearning?.scope?.session || item.session?.session || null
      ].filter(Boolean).join(" | ") || item.symbol || null;
      if (!scopeLabel) {
        continue;
      }
      if (allocatorGovernance.mode === "priority_probe") {
        const key = `allocator_priority:${scopeLabel}`;
        if (allocatorCandidateKeys.has(key)) {
          continue;
        }
        allocatorCandidateKeys.add(key);
        allocatorPolicyCandidates.push({
          id: item.symbol || allocatorGovernance.activeStrategy || scopeLabel,
          type: "allocator_scope",
          action: "promote_candidate",
          confidence: clamp(
            0.44 +
            (item.paperLearning?.activeLearning?.score || 0) * 0.22 +
            (allocatorGovernance.priorityBoost || 0) * 0.8 +
            (allocatorGovernance.confidence || 0) * 0.14,
            0,
            0.96
          ),
          scope: scopeLabel,
          reason: `${item.symbol || allocatorGovernance.activeStrategy || "Deze scope"} krijgt allocator-prioriteit als probe-case.`,
          blocker: null,
          source: "adaptive_allocator",
          allocatorMode: allocatorGovernance.mode,
          preferredStrategy: allocatorGovernance.preferredStrategy || allocatorGovernance.activeStrategy || null
        });
        continue;
      }
      if (["shadow_only", "probe_only"].includes(allocatorGovernance.mode)) {
        const strategyId = allocatorGovernance.activeStrategy || item.strategy?.activeStrategy || item.symbol || scopeLabel;
        const key = `allocator_cool:${strategyId}`;
        if (allocatorCandidateKeys.has(key)) {
          continue;
        }
        allocatorCandidateKeys.add(key);
        allocatorPolicyCandidates.push({
          id: strategyId,
          type: "strategy",
          action: "cooldown_candidate",
          confidence: clamp(
            0.42 +
            (allocatorGovernance.confidence || 0) * 0.22 +
            Math.abs(allocatorGovernance.activeBias || 0) * 0.28,
            0,
            0.92
          ),
          scope: scopeLabel,
          reason: `${strategyId} wordt door de allocator afgekoeld naar ${allocatorGovernance.mode === "shadow_only" ? "shadow learning" : "probe-only"}.`,
          blocker: null,
          source: "adaptive_allocator",
          allocatorMode: allocatorGovernance.mode,
          preferredStrategy: allocatorGovernance.preferredStrategy || null
        });
      }
    }
    const scopedTransitionCandidates = [
      ...challengerScorecards
        .filter((item) => item.status === "challenger")
        .slice(0, 2)
        .map((item) => ({
          id: item.id,
          type: item.id.includes("lane") ? "policy_lane" : "policy",
          action: "promote_candidate",
          confidence: clamp(0.42 + Math.min(item.sampleCount || 0, 12) * 0.03 + Math.max(0, item.edgeVsProbe || 0) * 3, 0, 0.96),
          scope: item.scope || null,
          reason: `${titleize(item.id)} presteert nu beter dan de probe-baseline.`,
          blocker: modelPromotionPolicy.allowPromotion ? null : (modelPromotionPolicy.blockerReasons || [])[0] || null
        })),
      ...retirementPolicies
        .filter((item) => ["retire", "cooldown"].includes(item.status))
        .slice(0, 3)
        .map((item) => ({
          id: item.id,
          type: "strategy",
          action: item.status === "retire" ? "retire_candidate" : "cooldown_candidate",
          confidence: item.confidence || 0.5,
          scope: item.id,
          reason: item.note || `${item.id} vraagt governance-ingreep.`,
          blocker: null
        })),
      ...offlineTrainerConditionTransitions
        .slice(0, 4)
        .map((item) => ({
          id: item.id,
          type: "condition_strategy",
          action: item.action || "observe",
          confidence: item.confidence || 0.5,
          scope: item.scope || `${item.conditionId || "unknown"} | ${item.strategyId || item.id}`,
          reason: item.reason || `${item.id} vraagt condition-aware policy review.`,
          blocker: null,
          source: "condition_policy",
          conditionId: item.conditionId || null,
          preferredStrategy: item.strategyId || item.id || null
        })),
      ...allocatorPolicyCandidates
    ]
      .filter((item) => !recentDismissals.some((dismissed) => dismissed.id === item.id && dismissed.action === item.action))
      .sort((left, right) => (right.confidence || 0) - (left.confidence || 0))
      .slice(0, 6);
    const operatorGuardrails = {
      status: scopedTransitionCandidates.length ? "review_required" : "observe",
      requireManualApproval: true,
      blockedBy: [
        ...(modelPromotionPolicy.allowPromotion ? [] : arr(modelPromotionPolicy.blockerReasons || []).slice(0, 2)),
        ...(retirementPolicies.some((item) => item.status === "retire") ? ["strategy_retirement_active"] : []),
        ...(executionInsights.status === "repair" ? ["execution_quality_not_stable"] : []),
        ...((historyCoverage.status === "missing" || (historyCoverage.uncoveredSymbolCount || 0) > 0) ? ["history_coverage_not_ready"] : []),
        ...((historyCoverage.gapSymbolCount || 0) > 0 ? ["history_gap_not_ready"] : []),
        ...((historyCoverage.staleSymbolCount || 0) > 0 ? ["history_freshness_not_ready"] : [])
      ].filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 4),
      safeAutoActions: [
        "collect_more_samples",
        "compare_simple_policy",
        "sample_more_shadow"
      ],
      note: scopedTransitionCandidates.length
        ? "Policy-overgangen zijn bewust alleen advisory totdat promotion, retirement en execution-guardrails tegelijk groen zijn."
        : "Nog geen policy-overgangen die operator-review vragen."
    };
    const activeOverrides = Object.entries(operatorPolicyState.strategyOverrides || {}).map(([id, item]) => ({
      id,
      status: item.status || null,
      note: item.note || null,
      approvedAt: item.approvedAt || null
    }));
    const operatorActions = {
      status: activeOverrides.length ? "active_overrides" : (operatorPolicyState.history?.length ? "history" : "idle"),
      activeOverrides,
      history: arr(operatorPolicyState.history || []).slice(0, 10).map((item) => ({
        id: item.id || null,
        action: item.action || null,
        note: item.note || null,
        at: item.at || null,
        scope: item.scope || null,
        status: item.status || null
      })),
      note: activeOverrides.length
        ? `${activeOverrides.length} operator override(s) zijn nu actief.`
        : operatorPolicyState.history?.length
          ? "Eerdere operator-acties blijven zichtbaar in de history."
          : "Nog geen operator-acties uitgevoerd op policy-transitions."
    };
    const policyTransitions = {
      status: scopedTransitionCandidates.length ? "candidate_actions" : "observe",
      autoApplyEnabled: false,
      candidates: scopedTransitionCandidates.map((item) => ({
        ...item,
        approved: approvedTransitions.some((approved) => approved.id === item.id && approved.action === item.action)
      })),
      note: scopedTransitionCandidates[0]
        ? scopedTransitionCandidates[0].source === "adaptive_allocator"
          ? `${titleize(scopedTransitionCandidates[0].id)} is nu de sterkste allocator-gedreven policy-kandidaat.`
          : `${titleize(scopedTransitionCandidates[0].id)} is nu de sterkste policy-overgangskandidaat.`
        : "Nog geen policy-promotie of retirement die de huidige guardrails haalt."
    };
    const miscalibrationSamples = recentPaperTrades
      .filter((trade) => Number.isFinite(trade.probabilityAtEntry))
      .map((trade) => {
        const predicted = clamp(trade.probabilityAtEntry || 0, 0, 1);
        const actual = ["good_trade", "acceptable_trade"].includes(resolvePaperOutcomeBucket(trade)) ? 1 : 0;
        return {
          error: Math.abs(predicted - actual),
          overconfident: predicted >= 0.6 && actual === 0,
          underconfident: predicted <= 0.45 && actual === 1
        };
      });
    const overconfidentCount = miscalibrationSamples.filter((item) => item.overconfident).length;
    const underconfidentCount = miscalibrationSamples.filter((item) => item.underconfident).length;
    const averageAbsoluteError = average(miscalibrationSamples.map((item) => item.error), 0);
    const miscalibration = {
      status: averageAbsoluteError >= 0.42 ? "elevated" : averageAbsoluteError >= 0.28 ? "watch" : "stable",
      averageAbsoluteError,
      overconfidentCount,
      underconfidentCount,
      topIssue: overconfidentCount > underconfidentCount
        ? "overconfidence"
        : underconfidentCount > overconfidentCount
          ? "underconfidence"
          : "balanced",
      note: overconfidentCount > underconfidentCount
        ? "De bot overschatte recent vaker paperkansen dan nodig."
        : underconfidentCount > overconfidentCount
          ? "De bot liet recent vaker winners liggen door te lage confidence."
          : "Confidence en uitkomsten lopen voorlopig redelijk gelijk."
    };
    const failureCounts = {};
    for (const trade of recentPaperTrades) {
      const bucket = resolvePaperOutcomeBucket(trade);
      if (["bad_trade", "early_exit", "late_exit", "execution_drag"].includes(bucket)) {
        failureCounts[bucket] = (failureCounts[bucket] || 0) + 1;
      }
      if ((trade.executionQualityScore || 0) < 0.42 && (trade.pnlQuote || 0) <= 0) {
        failureCounts.execution_drag = (failureCounts.execution_drag || 0) + 1;
      }
      if (isPaperQualityTrapTrade(trade)) {
        failureCounts.quality_trap = (failureCounts.quality_trap || 0) + 1;
      }
    }
    for (const item of counterfactuals) {
      if (["bad_veto", "right_direction_wrong_timing", "late_veto"].includes(item.outcome)) {
        failureCounts[item.outcome] = (failureCounts[item.outcome] || 0) + 1;
      }
    }
    const failureLibrary = Object.entries(failureCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([id, count]) => ({
        id,
        count,
        status: count >= 4 ? "priority" : count >= 2 ? "watch" : "observe",
        note: id === "bad_veto"
          ? "Blokkades waren hier vaker te streng."
          : id === "execution_drag"
            ? "Execution-kosten drukten deze papertrades weg."
            : id === "quality_trap"
              ? "Goede setup, maar de kwaliteit van uitvoering of follow-through bleef te zwak."
              : `${titleize(id)} komt nu vaker terug in paper learning.`
      }));
    const coaching = {
      whatWorked: benchmarkLanes.bestLane === "probe_lane"
        ? "Probes leveren nu de beste mix van leerwaarde en resultaat."
        : benchmarkLanes.bestLane === "safe_lane"
          ? "De veilige lane presteert nu stabieler dan agressievere leerpaden."
          : benchmarkLanes.bestLane === "shadow_take"
            ? "Shadow-cases laten zien dat meer near-miss setups waardevol kunnen zijn."
            : benchmarkLanes.bestLane === "always_take"
              ? "Een brede take-baseline doet het opvallend goed; paper is mogelijk te streng."
              : benchmarkLanes.bestLane === "fixed_threshold"
                ? "Een eenvoudige thresholdregel houdt goed stand als benchmark."
                : "De paper-lanes bouwen nog basisinzichten op.",
      tooStrict: counterfactualTuning.blocker
        ? `${titleize(counterfactualTuning.blocker)} lijkt nu de strengste rem voor paper-learning.`
        : topBlockers[0]?.id
          ? `${titleize(topBlockers[0].id)} blokkeert nu het vaakst.`
          : "Nog geen duidelijke te-strenge blocker zichtbaar.",
      tooLoose: failureLibrary[0]
        ? `${titleize(failureLibrary[0].id)} is nu de grootste foutcluster en vraagt strakkere gating.`
        : "Nog geen duidelijke te-losse paperzone zichtbaar.",
      nextReview: reviewPacks.topMissedSetup
        ? `Bekijk ${reviewPacks.topMissedSetup} als gemiste setup en ${reviewPacks.topProbationRisk || reviewPacks.weakestProbe || "de zwakste probe"} als eerstvolgende kwaliteitsreview.`
        : experimentScopes[0]
          ? `Volgende focus: ${experimentScopes[0].id} via ${experimentScopes[0].action}.`
          : "Nog geen duidelijke volgende reviewfocus beschikbaar."
    };
    const reviewQueue = [
      recentProbeReviews[0]
        ? {
            type: "probe_trade",
            id: recentProbeReviews[0].symbol || recentProbeReviews[0].id || "probe",
            priority: recentProbeReviews[0].outcome === "bad_trade" || recentProbeReviews[0].outcome === "early_exit" ? "high" : "normal",
            note: recentProbeReviews[0].lesson || "Bekijk deze probe-trade opnieuw."
          }
        : null,
      recentShadowReviews[0]
        ? {
            type: "shadow_case",
            id: recentShadowReviews[0].symbol || recentShadowReviews[0].id || "shadow",
            priority: recentShadowReviews[0].outcome === "bad_veto" ? "high" : "normal",
            note: recentShadowReviews[0].lesson || "Bekijk deze shadow-case opnieuw."
          }
        : null,
      rankedActiveCandidates[0]
        ? {
            type: "active_candidate",
            id: rankedActiveCandidates[0].symbol || "candidate",
            priority: rankedActiveCandidates[0].priorityBand === "high_priority" ? "high" : "normal",
            note: rankedActiveCandidates[0].allocatorGovernance?.mode === "shadow_only"
              ? `${rankedActiveCandidates[0].symbol || "Deze candidate"} wordt nu allocator-gestuurd als shadow-only leercase.`
              : rankedActiveCandidates[0].allocatorGovernance?.mode === "priority_probe"
                ? `${rankedActiveCandidates[0].symbol || "Deze candidate"} krijgt allocator-prioriteit als probe-case.`
                : `${rankedActiveCandidates[0].symbol || "Deze candidate"} is nu de meest informatieve active-learning case.`
          }
        : null
    ].filter(Boolean);
    const topBranch = [...branchStats.values()]
      .map((item) => ({
        id: item.id,
        score: item.total ? item.winnerCount / item.total : 0,
        total: item.total
      }))
      .sort((left, right) => right.score - left.score)[0] || null;
    const counterfactualBranches = {
      topBranch: topBranch?.id || null,
      branchCount: branchStats.size,
      note: topBranch
        ? `${titleize(topBranch.id)} levert momenteel de beste alternatieve uitkomst op in counterfactuals.`
        : "Nog geen vertakte counterfactual cases beschikbaar."
    };
    return {
      generatedAt: referenceNow,
      status: laneCounts.safe + laneCounts.probe + laneCounts.shadow > 0 || recentProbeReviews.length || recentShadowReviews.length
        ? "active"
        : "observe",
      readinessStatus,
      readinessScore,
      safeCount: laneCounts.safe || 0,
      probeCount: laneCounts.probe || 0,
      shadowCount: laneCounts.shadow || 0,
      averageLearningValueScore: avgLearningValue,
      averageNoveltyScore: avgNovelty,
      averageActiveLearningScore: avgActiveLearning,
      recencyFreshnessScore,
      blockerGroups,
      scopeReadiness,
      inputHealth,
      thresholdSandbox,
      reviewPacks,
      recentProbeReviews,
      recentShadowReviews,
      paperToLiveReadiness,
      counterfactualTuning,
      activeLearning,
      scopeCoaching,
      experimentScopes,
      benchmarkLanes,
      miscalibration,
      failureLibrary,
      coaching,
      blockerAttribution,
      challengerPolicy,
      promotionRoadmap,
      executionInsights,
      policyTransitions,
      operatorGuardrails,
      operatorActions,
      challengerScorecards,
      abExperiments,
      reviewQueue,
      counterfactualBranches,
      primaryScope: displayPrimaryScope
        ? {
            id: displayPrimaryScope.id,
            type: displayPrimaryScope.type,
            status: displayPrimaryScope.status,
            score: displayPrimaryScope.readinessScore || 0,
            source: displayPrimaryScope.source || "probe_trades"
          }
        : focusScopes[0]
          ? {
              id: focusScopes[0].id,
              type: "active_learning",
              status: activeLearning.status || "observe",
              score: focusScopes[0].score || 0,
              source: "active_learning"
            }
          : null,
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
        inputHealth.status === "stalled"
          ? `Geen nieuwe probe/live closed trades sinds ${latestClosedLearningAt || "nog geen closed trades"}; leerinput valt nu terug op ${displayPrimaryScope?.source === "shadow_learning" ? "shadow-learning" : "frissere evidence"}.`
          : inputHealth.note,
        displayPrimaryScope
          ? displayPrimaryScope.source === "shadow_learning"
            ? `Sterkste leerscope komt nu uit shadow-learning: ${displayPrimaryScope.id} (${displayPrimaryScope.status}).`
            : `Sterkste paper-scope: ${displayPrimaryScope.id} (${displayPrimaryScope.status}).`
          : "Nog geen paper-scope readiness zichtbaar.",
        paperToLiveReadiness.topScope
          ? `Paper-to-live readiness focust nu op ${paperToLiveReadiness.topScope}.`
          : "Paper-to-live readiness heeft nog geen duidelijke focus-scope.",
        counterfactualTuning.blocker
          ? `Counterfactual tuning kijkt nu vooral naar ${counterfactualTuning.blocker}.`
          : "Counterfactual tuning heeft nog geen dominante blocker.",
        activeLearning.focusReason
          ? `Active learning focust nu vooral op ${activeLearning.focusReason}.`
          : "Active learning heeft nog geen uitgesproken focus.",
        rankedActiveCandidates[0]?.allocatorGovernance?.mode === "shadow_only"
          ? `${rankedActiveCandidates[0].symbol || "De top candidate"} wordt door de allocator afgekoeld naar shadow learning.`
          : rankedActiveCandidates[0]?.allocatorGovernance?.mode === "priority_probe"
            ? `${rankedActiveCandidates[0].symbol || "De top candidate"} krijgt extra allocator-prioriteit als probe.`
            : "Allocator-governance houdt de paper-lanes voorlopig neutraal.",
        benchmarkLanes.bestLane
          ? `Benchmark lane nu sterkst: ${benchmarkLanes.bestLane}.`
          : "Nog geen benchmark lane zichtbaar.",
        miscalibration.topIssue && miscalibration.status !== "stable"
          ? `Confidence-mismatch: ${miscalibration.topIssue}.`
          : "Confidence en paper-uitkomsten liggen voorlopig redelijk op lijn.",
        failureLibrary[0]
          ? `${failureLibrary[0].id} is nu de grootste paper failure cluster.`
          : "Nog geen duidelijke paper failure cluster zichtbaar.",
        counterfactualBranches.topBranch
          ? `Counterfactual branching wijst nu naar ${counterfactualBranches.topBranch} als sterkste alternatief.`
          : "Nog geen sterke counterfactual branch zichtbaar.",
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

  buildAdaptationHealthSnapshot(referenceNow = nowIso()) {
    const referenceMs = new Date(referenceNow).getTime();
    const closedTrades = arr(this.journal?.trades || []).filter((trade) => trade?.exitAt);
    const learnableTrades = closedTrades.filter((trade) => trade.rawFeatures && Object.keys(trade.rawFeatures).length > 0);
    const latestLearningTradeAt = learnableTrades
      .map((trade) => trade.exitAt || trade.entryAt || null)
      .filter(Boolean)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;
    const learningAgeHours = latestLearningTradeAt
      ? Math.max(0, (referenceMs - new Date(latestLearningTradeAt).getTime()) / 3_600_000)
      : null;
    const calibration = this.model?.getCalibrationSummary ? (this.model.getCalibrationSummary() || {}) : {};
    const deployment = this.model?.getDeploymentSummary ? (this.model.getDeploymentSummary() || {}) : {};
    const dataRecorderSummary = this.dataRecorder?.getSummary ? (this.dataRecorder.getSummary() || {}) : {};
    const offlineTrainer = summarizeOfflineTrainer(this.runtime?.offlineTrainer || {});
    const optimizerSummary = this.runtime?.aiTelemetry?.strategyOptimizer || {};
    const parameterGovernor = this.runtime?.parameterGovernor || {};
    const attribution = this.runtime?.strategyAttribution || {};
    const strategyAllocation = this.model?.getStrategyAllocationSummary ? (this.model.getStrategyAllocationSummary() || {}) : {};
    const lastCalibrationUpdateAt = calibration.lastUpdatedAt || null;
    const calibrationAgeHours = lastCalibrationUpdateAt
      ? Math.max(0, (referenceMs - new Date(lastCalibrationUpdateAt).getTime()) / 3_600_000)
      : null;
    const adaptiveInputs = [
      { id: "strategy_allocation_bandit", enabled: true },
      { id: "cross_timeframe_consensus", enabled: Boolean(this.config.enableCrossTimeframeConsensus) },
      { id: "market_sentiment", enabled: Boolean(this.config.enableMarketSentimentContext) },
      { id: "on_chain_lite", enabled: Boolean(this.config.enableOnChainLiteContext) },
      { id: "volatility", enabled: Boolean(this.config.enableVolatilityContext) },
      { id: "local_order_book", enabled: Boolean(this.config.enableLocalOrderBook) },
      { id: "news", enabled: Boolean(this.news) },
      { id: "exchange_notices", enabled: Boolean(this.exchangeNotices) },
      { id: "calendar", enabled: Boolean(this.calendar) },
      { id: "market_structure", enabled: Boolean(this.marketStructure) }
    ];
    const enabledAdaptiveInputs = adaptiveInputs.filter((item) => item.enabled);
    const calibrationMinObservations = Math.max(4, Math.round(safeNumber(this.config.calibrationMinObservations, 12)));
    const hasLearningHistory = learnableTrades.length > 0;
    const learningStalled = hasLearningHistory && Number.isFinite(learningAgeHours) && learningAgeHours >= 72;
    const calibrationBuilding = (calibration.observations || 0) < calibrationMinObservations;
    const status = !hasLearningHistory
      ? "warmup"
      : learningStalled
        ? "stalled"
        : calibrationBuilding
          ? "building"
          : "active";
    const notes = [
      "Gesloten trades met raw features updaten champion, challenger, transformer, sequence, meta, execution, exit, strategy-meta, calibrator en RL policy.",
      !hasLearningHistory
        ? "Nog geen gesloten trades met leerbare raw features; online adaptatie warmt nog op."
        : latestLearningTradeAt
          ? `Laatste leertrade op ${latestLearningTradeAt}.`
          : null,
      learningStalled
        ? `De online leerlus staat stil sinds ${latestLearningTradeAt}; zonder nieuwe closes verschuift adaptatie vooral naar actuele marktfeatures en shadow evidence.`
        : null,
      calibrationBuilding
        ? `Calibratie heeft ${calibration.observations || 0}/${calibrationMinObservations} observaties en blijft daarom nog in bouwfase.`
        : null,
      deployment.active
        ? `Actieve deployment: ${deployment.active}.`
        : null,
      strategyAllocation.topStrategies?.[0]?.id
        ? `Adaptive allocator bevoordeelt nu ${strategyAllocation.topStrategies[0].id}${strategyAllocation.topStrategies[0].context ? ` binnen ${strategyAllocation.topStrategies[0].context}` : ""}.`
        : null
    ].filter(Boolean);
    return {
      status,
      learnsFromClosedTrades: true,
      supportsMarketAdaptation: enabledAdaptiveInputs.length > 0,
      learnableTradeCount: learnableTrades.length,
      learningFrames: dataRecorderSummary.learningFrames || 0,
      offlineReadinessScore: offlineTrainer.readinessScore || 0,
      lastLearningTradeAt: latestLearningTradeAt,
      learningAgeHours,
      calibrationObservations: calibration.observations || 0,
      calibrationEce: calibration.expectedCalibrationError || 0,
      lastCalibrationUpdateAt,
      calibrationAgeHours,
      lastPromotionAt: deployment.lastPromotionAt || null,
      deploymentActive: deployment.active || null,
      optimizerStatus: optimizerSummary.status || "warmup",
      attributionStatus: attribution.status || "warmup",
      parameterGovernorStatus: parameterGovernor.status || "warmup",
      strategyAllocation: summarizeStrategyAllocation(strategyAllocation),
      adaptiveInputs: {
        enabledCount: enabledAdaptiveInputs.length,
        totalCount: adaptiveInputs.length,
        items: adaptiveInputs
      },
      notes
    };
  }

  refreshOperationalViews({ report = null, nowIso: referenceNow = nowIso() } = {}) {
    const evaluation = report || this.getPerformanceReport();
    const existingOps = this.runtime.ops || {};
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
    this.runtime.adaptation = summarizeAdaptationHealth(this.buildAdaptationHealthSnapshot(referenceNow));
    const promotionState = this.evaluatePromotionProbations(referenceNow);
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
    const signalFlowSummary = summarizeSignalFlow(this.runtime.signalFlow || {});
    this.runtime.ops = {
      ...existingOps,
      lastUpdatedAt: referenceNow,
      incidentTimeline: this.buildIncidentTimeline(referenceNow),
      runbooks: this.buildOperatorRunbooks(evaluation),
      performanceChange: this.buildPerformanceChangeView(evaluation),
      readiness,
      alerts,
      alertState: existingOps.alertState || { acknowledgedAtById: {}, silencedUntilById: {}, resolvedAtById: {}, notesById: {}, delivery: { lastDeliveryAt: null, lastError: null, lastDeliveredAtById: {} } },
      alertDelivery,
      replayChaos: summarizeReplayChaos(this.runtime.replayChaos || {}),
      paperLearning: summarizePaperLearning(this.runtime.paperLearning || {}),
      adaptation: summarizeAdaptationHealth(this.runtime.adaptation || {}),
      signalFlow: signalFlowSummary,
      tradingFlowHealth: signalFlowSummary.tradingFlowHealth,
      diagnosticsActions: existingOps.diagnosticsActions || { history: [] },
      promotionState
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
    const offlineTrainerSummary = this.offlineTrainer.buildSummary({ journal: this.journal, dataRecorder: this.dataRecorder.getSummary(), counterfactuals: this.journal.counterfactuals || [], historySummary: this.runtime.marketHistory || {}, nowIso: nowIso() });
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

    await this.safeRecordDataRecorder("trade", async () => this.dataRecorder.recordTrade(trade));
    await this.safeRecordDataRecorder("trade_replay", async () => this.dataRecorder.recordTradeReplaySnapshot(trade));
    await this.safeRecordDataRecorder("learning_event", async () => this.dataRecorder.recordLearningEvent({ trade, learning }));
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
      this.markReportDirty();
    }
    for (const trade of reconciliation.closedTrades || []) {
      this.journal.trades.push(trade);
      this.markReportDirty();
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
      book.queueImbalance = localBookSnapshot?.queueImbalance || 0;
      book.queueRefreshScore = localBookSnapshot?.queueRefreshScore || 0;
      book.replenishmentScore = localBookSnapshot?.queueRefreshScore || 0;
      book.resilienceScore = localBookSnapshot?.resilienceScore || 0;
      const orderBookQuality = deriveOrderBookQuality({
        book,
        orderBook: effectiveOrderBook,
        localBookSnapshot,
        streamFeatures,
        config: this.config
      });
      book.localBookSynced = orderBookQuality.localBookSynced;
      book.depthConfidence = orderBookQuality.depthConfidence;
      book.depthAgeMs = orderBookQuality.localBookSynced ? localBookSnapshot?.depthAgeMs ?? null : null;
      book.totalDepthNotional = orderBookQuality.totalDepthNotional;
      book.bookSource = orderBookQuality.bookSource;
      book.bookFallbackReady = orderBookQuality.bookFallbackReady;
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

  resolveEntryExitPolicyPreview({ marketConditionSummary = {}, strategySummary = {} } = {}) {
    const exitLearning = this.runtime?.offlineTrainer?.exitLearning || {};
    const conditionPolicies = arr(exitLearning.conditionPolicies || []);
    const strategyPolicies = arr(exitLearning.strategyPolicies || []);
    const conditionId = marketConditionSummary.conditionId || null;
    const familyId = strategySummary.family || null;
    const strategyId = strategySummary.activeStrategy || null;
    const conditionMatch = conditionPolicies.find((item) =>
      item?.conditionId === conditionId &&
      (!item.familyId || !familyId || item.familyId === familyId) &&
      (item.tradeCount || 0) >= 3
    );
    const strategyMatch = strategyPolicies.find((item) =>
      item?.id === strategyId &&
      (item.tradeCount || 0) >= 3
    );
    const summary = conditionMatch || strategyMatch || {};
    return {
      ...summarizeExitPolicyDigest(summary),
      active: Boolean(conditionMatch || strategyMatch),
      source: conditionMatch ? "condition_policy" : strategyMatch ? "strategy_policy" : null,
      conditionId: conditionMatch?.conditionId || null,
      familyId: conditionMatch?.familyId || familyId || null,
      confidence: num(
        conditionMatch
          ? clamp((conditionMatch.tradeCount || 0) / 12, 0, 1)
          : strategyMatch
            ? clamp((strategyMatch.tradeCount || 0) / 16, 0, 1)
            : 0,
        4
      )
    };
  }

  buildAdaptiveDecisionContext(candidate) {
    const marketCondition = summarizeMarketCondition(candidate.marketConditionSummary || {});
    const strategyAllocation = summarizeStrategyAllocation(candidate.strategyAllocationSummary || candidate.score?.strategyAllocation || {});
    const paperLearning = summarizePaperLearning(this.runtime?.ops?.paperLearning || this.runtime?.paperLearning || {});
    const paperLearningGuidance = summarizePaperLearningGuidance(candidate.decision?.paperLearningGuidance || {});
    const offlineLearningGuidance = summarizeOfflineLearningGuidance(candidate.decision?.offlineLearningGuidance || {});
    const lowConfidencePressure = summarizeLowConfidencePressure(candidate.decision?.lowConfidencePressure || {});
    const policyTransitions = arr(this.runtime?.offlineTrainer?.policyTransitionCandidatesByCondition || []);
    const adaptivePolicy = summarizeAdaptivePolicy({
      strategyAllocation,
      paperLearning,
      marketCondition,
      policyTransitions
    });
    const missedTradeTuning = summarizeMissedTradeTuning(candidate.decision?.missedTradeTuningApplied || {});
    const exitPolicy = candidate.decision?.exitPolicy || this.resolveEntryExitPolicyPreview({
      marketConditionSummary: candidate.marketConditionSummary || {},
      strategySummary: candidate.strategySummary || {}
    });
    return {
      marketCondition,
      strategyAllocation,
      adaptivePolicy,
      paperLearningGuidance,
      offlineLearningGuidance,
      lowConfidencePressure,
      missedTradeTuning,
      exitPolicy,
      opportunityScore: num(candidate.decision?.opportunityScore || 0, 4)
    };
  }

  buildLowConfidenceAudit(candidates = []) {
    const nearMisses = arr(candidates)
      .filter((candidate) =>
        !candidate?.decision?.allow &&
        arr(candidate?.decision?.reasons || []).includes("model_confidence_too_low") &&
        safeNumber(candidate?.signalQualitySummary?.overallScore, 0) >= 0.58 &&
        safeNumber(candidate?.dataQualitySummary?.overallScore, 0) >= 0.56 &&
        safeNumber(candidate?.score?.probability, 0) >= safeNumber(candidate?.decision?.threshold, 0) - 0.05
      )
      .sort((left, right) =>
        safeNumber(right?.decision?.lowConfidencePressure?.edgeToThreshold, safeNumber(right?.score?.probability, 0) - safeNumber(right?.decision?.threshold, 0)) -
        safeNumber(left?.decision?.lowConfidencePressure?.edgeToThreshold, safeNumber(left?.score?.probability, 0) - safeNumber(left?.decision?.threshold, 0))
      );
    const driverCounts = new Map();
    const featureCounts = new Map();
    for (const candidate of nearMisses) {
      const pressure = candidate?.decision?.lowConfidencePressure || {};
      const driver = pressure.primaryDriver || "model_confidence";
      driverCounts.set(driver, (driverCounts.get(driver) || 0) + 1);
      for (const feature of arr(candidate?.decision?.offlineLearningGuidance?.impactedFeatures || [])) {
        featureCounts.set(feature, (featureCounts.get(feature) || 0) + 1);
      }
    }
    const topDrivers = [...driverCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([id, count]) => ({ id, count }));
    const topFeatures = [...featureCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([id, count]) => ({ id, count }));
    const dominantDriver = topDrivers[0]?.id || null;
    const averageEdgeToThreshold = average(
      nearMisses.map((candidate) => safeNumber(candidate?.decision?.lowConfidencePressure?.edgeToThreshold, safeNumber(candidate?.score?.probability, 0) - safeNumber(candidate?.decision?.threshold, 0))),
      0
    );
    const averageCalibrationWarmup = average(
      nearMisses.map((candidate) => safeNumber(candidate?.decision?.lowConfidencePressure?.calibrationWarmup, candidate?.score?.calibrator?.warmupProgress || 0)),
      0
    );
    const averageThresholdPenaltyPressure = average(
      nearMisses.map((candidate) => safeNumber(candidate?.decision?.lowConfidencePressure?.thresholdPenaltyPressure, 0)),
      0
    );
    const averageFeatureTrustPenalty = average(
      nearMisses.map((candidate) => safeNumber(candidate?.decision?.lowConfidencePressure?.featureTrustPenalty, 0)),
      0
    );
    const averageExecutionCaution = average(
      nearMisses.map((candidate) => safeNumber(candidate?.decision?.lowConfidencePressure?.executionCaution, 0)),
      0
    );
    const note =
      dominantDriver === "calibration_warmup"
        ? "Calibrator-warmup blokkeert nu relatief vaak high-quality near misses."
        : dominantDriver === "calibration_confidence"
          ? "Calibrated confidence blijft nu vaker de rem dan setupkwaliteit."
          : dominantDriver === "threshold_penalty_stack"
            ? "Threshold-penalties stapelen nu zichtbaar op bij de beste near misses."
            : dominantDriver === "feature_trust"
              ? "Zwakke of gedegradeerde features drukken nu te vaak anders sterke setups omlaag."
              : dominantDriver === "execution_quality"
                ? "Execution-confidence en cost-caution houden nu de beste near misses tegen."
                : dominantDriver === "data_quality"
                  ? "Datakwaliteit en quorum trekken nu high-quality near misses onder de lijn."
                  : dominantDriver === "model_disagreement"
                    ? "Model disagreement is nu de dominante confidence-rem."
                    : nearMisses.length
                      ? "Model confidence blijft de dominante rem op high-quality near misses."
                      : "Nog geen duidelijke high-quality low-confidence bottleneck in de huidige cycle.";
    return {
      status: nearMisses.length >= 3 ? "priority" : nearMisses.length > 0 ? "watch" : "quiet",
      nearMissCount: nearMisses.length,
      candidateCount: arr(candidates).length,
      dominantDriver,
      averageEdgeToThreshold: num(averageEdgeToThreshold, 4),
      averageCalibrationWarmup: num(averageCalibrationWarmup, 4),
      averageThresholdPenaltyPressure: num(averageThresholdPenaltyPressure, 4),
      averageFeatureTrustPenalty: num(averageFeatureTrustPenalty, 4),
      averageExecutionCaution: num(averageExecutionCaution, 4),
      topDrivers: topDrivers.slice(0, 4),
      topFeatures: topFeatures.slice(0, 5),
      examples: nearMisses.slice(0, 4).map((candidate) => ({
        symbol: candidate.symbol || null,
        strategy: candidate.strategySummary?.activeStrategy || null,
        edgeToThreshold: num(safeNumber(candidate?.decision?.lowConfidencePressure?.edgeToThreshold, safeNumber(candidate?.score?.probability, 0) - safeNumber(candidate?.decision?.threshold, 0)), 4),
        primaryDriver: candidate?.decision?.lowConfidencePressure?.primaryDriver || null
      })),
      note
    };
  }

  buildPaperLearningGuidance({
    symbol = null,
    strategySummary = {},
    regimeSummary = {},
    sessionSummary = {}
  } = {}) {
    const paperLearning = summarizePaperLearning(this.runtime?.ops?.paperLearning || this.runtime?.paperLearning || {});
    if ((this.config?.botMode || "paper") !== "paper" || paperLearning.status === "warmup") {
      return {
        active: false,
        sourceStatus: paperLearning.status || "warmup",
        note: "Paper learning guidance is nog in warmup."
      };
    }

    const normalize = (value) => String(value || "").trim().toLowerCase();
    const family = strategySummary.family || null;
    const regime = regimeSummary.regime || null;
    const session = sessionSummary.session || null;
    const benchmarkLead = paperLearning.benchmarkLanes?.bestLane || paperLearning.challengerPolicy?.leadingLane || null;
    const challengerRecommendation = paperLearning.challengerPolicy?.recommendation || null;
    const targetScope = paperLearning.challengerPolicy?.targetScope || paperLearning.paperToLiveReadiness?.topScope || null;
    const focusCandidate = arr(paperLearning.activeLearning?.topCandidates || []).find((item) => item.symbol === symbol) || null;
    const strongestScope = paperLearning.scopeCoaching?.strongest || null;
    const targetScopeMatched = Boolean(
      targetScope &&
      [family, regime, session].filter(Boolean).some((part) => normalize(targetScope).includes(normalize(part)))
    );
    const matchedScopes = arr(paperLearning.scopeReadiness || [])
      .map((item) => {
        let matchScore = 0;
        if (item.type === "strategy_family" && family && normalize(item.id) === normalize(family)) {
          matchScore = 1;
        } else if (item.type === "regime" && regime && normalize(item.id) === normalize(regime)) {
          matchScore = 0.84;
        } else if (item.type === "session" && session && normalize(item.id) === normalize(session)) {
          matchScore = 0.68;
        } else if (item.id && [family, regime, session].filter(Boolean).some((part) => normalize(item.id).includes(normalize(part)))) {
          matchScore = 0.52;
        }
        return {
          ...item,
          matchScore
        };
      })
      .filter((item) => item.matchScore > 0)
      .sort((left, right) => {
        const scoreDelta = (right.matchScore || 0) - (left.matchScore || 0);
        return scoreDelta !== 0 ? scoreDelta : (right.readinessScore || 0) - (left.readinessScore || 0);
      })
      .slice(0, 3);

    let priorityBoost = 0;
    let probeBoost = 0;
    let shadowBoost = 0;
    let cautionPenalty = 0;
    let preferredLane = null;
    const topScope = matchedScopes[0] || null;

    if (topScope) {
      if (topScope.status === "paper_ready") {
        priorityBoost += 0.05;
        probeBoost += 0.03;
        preferredLane = "probe";
      } else if (topScope.status === "building") {
        priorityBoost += 0.03;
        probeBoost += 0.02;
        preferredLane = preferredLane || "probe";
      } else if (topScope.status === "warmup") {
        shadowBoost += 0.02;
      }
    }

    if (focusCandidate) {
      priorityBoost += focusCandidate.priorityBand === "high_priority" ? 0.04 : 0.025;
      if (focusCandidate.priorityBand !== "observe") {
        probeBoost += 0.02;
      }
    }

    if (symbol && symbol === paperLearning.reviewPacks?.topMissedSetup) {
      priorityBoost += 0.035;
      probeBoost += 0.025;
      preferredLane = preferredLane || "probe";
    } else if (symbol && symbol === paperLearning.reviewPacks?.weakestProbe) {
      shadowBoost += 0.03;
      preferredLane = preferredLane || "shadow";
    } else if (symbol && symbol === paperLearning.reviewPacks?.bestProbeWinner) {
      priorityBoost += 0.02;
    }

    if (benchmarkLead === "shadow_take") {
      shadowBoost += 0.05;
      priorityBoost += 0.02;
      preferredLane = preferredLane || "shadow";
    } else if (["always_take", "fixed_threshold"].includes(benchmarkLead)) {
      probeBoost += 0.04;
      priorityBoost += 0.03;
      preferredLane = preferredLane || "probe";
    } else if (benchmarkLead === "probe_lane") {
      probeBoost += 0.025;
      priorityBoost += 0.015;
      preferredLane = preferredLane || "probe";
    } else if (benchmarkLead === "safe_lane") {
      cautionPenalty += 0.025;
    } else if (benchmarkLead === "always_skip") {
      cautionPenalty += 0.06;
      shadowBoost += 0.02;
      preferredLane = preferredLane || "shadow";
    } else if (benchmarkLead === "simple_exit") {
      cautionPenalty += 0.045;
    }

    if (challengerRecommendation === "sample_more_shadow") {
      shadowBoost += 0.04;
      preferredLane = preferredLane || "shadow";
    } else if (challengerRecommendation === "review_thresholds") {
      probeBoost += 0.03;
      priorityBoost += 0.025;
      preferredLane = preferredLane || "probe";
    } else if (challengerRecommendation === "keep_probe_champion") {
      probeBoost += 0.02;
      priorityBoost += 0.015;
      preferredLane = preferredLane || "probe";
    } else if (challengerRecommendation === "stabilize_execution") {
      cautionPenalty += 0.02;
    } else if (challengerRecommendation === "compare_simple_policy") {
      cautionPenalty += 0.03;
    }

    if (targetScopeMatched) {
      priorityBoost += 0.02;
      probeBoost += 0.015;
    }
    if (strongestScope?.id && [family, regime, session].filter(Boolean).some((part) => normalize(strongestScope.id).includes(normalize(part)))) {
      priorityBoost += 0.015;
    }

    priorityBoost = clamp(priorityBoost, 0, 0.1);
    probeBoost = clamp(probeBoost, 0, 0.08);
    shadowBoost = clamp(shadowBoost, 0, 0.08);
    cautionPenalty = clamp(cautionPenalty, 0, 0.06);
    const guidanceStrength = clamp(priorityBoost + probeBoost + shadowBoost - cautionPenalty * 0.6, 0, 1);
    const focusReason = focusCandidate?.reason ||
      (benchmarkLead === "shadow_take" ? "benchmark_shadow_take_edge" :
        ["always_take", "fixed_threshold"].includes(benchmarkLead) ? "benchmark_threshold_gap" :
          targetScopeMatched ? "scope_readiness_match" :
            strongestScope ? "scope_readiness_followup" : "paper_learning_guidance");

    const noteParts = [];
    if (topScope) {
      noteParts.push(`${topScope.id} staat op ${topScope.status}.`);
    }
    if (benchmarkLead) {
      noteParts.push(`Benchmark: ${benchmarkLead}.`);
    }
    if (challengerRecommendation) {
      noteParts.push(`Challenger: ${challengerRecommendation}.`);
    }

    return {
      active: guidanceStrength > 0 || cautionPenalty > 0,
      sourceStatus: paperLearning.status || "observe",
      preferredLane,
      guidanceStrength,
      priorityBoost,
      probeBoost,
      shadowBoost,
      cautionPenalty,
      focusReason,
      benchmarkLead,
      challengerRecommendation,
      targetScope,
      targetScopeMatched,
      focusCandidateSymbol: focusCandidate?.symbol || null,
      matchedScopes,
      note: noteParts.join(" ") || paperLearning.challengerPolicy?.note || paperLearning.coaching?.nextReview || "Paper learning guidance is actief."
    };
  }

  buildOfflineLearningGuidance({
    strategySummary = {},
    regimeSummary = {},
    sessionSummary = {},
    marketConditionSummary = {},
    rawFeatures = {}
  } = {}) {
    const offlineTrainer = this.runtime?.offlineTrainer || {};
    const outcomeScopeLearning = offlineTrainer.outcomeScopeScorecards || {};
    const featureGovernance = offlineTrainer.featureGovernance || {};
    const paperLearning = summarizePaperLearning(this.runtime?.ops?.paperLearning || this.runtime?.paperLearning || {});
    const normalize = (value) => String(value || "").trim().toLowerCase();
    const family = strategySummary.family || null;
    const regime = regimeSummary.regime || null;
    const session = sessionSummary.session || null;
    const conditionId = marketConditionSummary.conditionId || null;

    const scopeMatches = [
      { scopeType: "condition", id: conditionId, weight: 1, items: arr(outcomeScopeLearning.condition || []) },
      { scopeType: "family", id: family, weight: 0.92, items: arr(outcomeScopeLearning.family || []) },
      { scopeType: "regime", id: regime, weight: 0.72, items: arr(outcomeScopeLearning.regime || []) },
      { scopeType: "session", id: session, weight: 0.55, items: arr(outcomeScopeLearning.session || []) }
    ]
      .map((scope) => {
        const match = scope.id
          ? scope.items.find((item) => normalize(item.id) === normalize(scope.id))
          : null;
        return match ? { ...match, scopeType: scope.scopeType, matchWeight: scope.weight } : null;
      })
      .filter(Boolean)
      .sort((left, right) => (right.matchWeight || 0) - (left.matchWeight || 0));

    const weightedConfidence = scopeMatches.reduce(
      (total, item) => total + Math.max(0.15, (item.confidence || 0)) * (item.matchWeight || 0),
      0
    );
    let thresholdShift = weightedConfidence
      ? scopeMatches.reduce(
          (total, item) => total + (item.thresholdShift || 0) * Math.max(0.15, (item.confidence || 0)) * (item.matchWeight || 0),
          0
        ) / weightedConfidence
      : 0;
    let sizeMultiplier = 1 + (weightedConfidence
      ? scopeMatches.reduce(
          (total, item) => total + ((item.sizeMultiplier || 1) - 1) * Math.max(0.15, (item.confidence || 0)) * (item.matchWeight || 0),
          0
        ) / weightedConfidence
      : 0);
    let cautionPenalty = weightedConfidence
      ? scopeMatches.reduce(
          (total, item) => total + (item.cautionPenalty || 0) * Math.max(0.15, (item.confidence || 0)) * (item.matchWeight || 0),
          0
        ) / weightedConfidence
      : 0;

    const benchmarkLead = paperLearning.benchmarkLanes?.bestLane || paperLearning.challengerPolicy?.leadingLane || null;
    if (benchmarkLead === "always_skip") {
      thresholdShift += 0.005;
      sizeMultiplier *= 0.94;
      cautionPenalty += 0.06;
    } else if (benchmarkLead === "simple_exit") {
      thresholdShift += 0.0025;
      sizeMultiplier *= 0.95;
      cautionPenalty += 0.045;
    } else if (benchmarkLead === "safe_lane") {
      thresholdShift += 0.0015;
      sizeMultiplier *= 0.98;
      cautionPenalty += 0.02;
    }

    const impactedFeatures = [];
    const rawFeatureMap = rawFeatures && typeof rawFeatures === "object" ? rawFeatures : {};
    const dropCandidates = new Set(arr(featureGovernance.pruning?.dropCandidates || []));
    const guardOnly = new Set(arr(featureGovernance.pruning?.guardOnlyFeatures || []));
    const missingInLive = new Set(arr(featureGovernance.parityAudit?.missingInLive || []));
    const topNegative = new Map(arr(featureGovernance.attribution?.topNegative || []).map((item) => [item.id, item]));
    const parityDetails = new Map(arr(featureGovernance.parityAudit?.details || []).map((item) => [item.id, item]));
    const pruningRecommendations = new Map(arr(featureGovernance.pruning?.recommendations || []).map((item) => [item.id, item]));
    const impactedFeatureEntries = [];
    let featurePenalty = 0;

    for (const [id, value] of Object.entries(rawFeatureMap)) {
      if (!Number.isFinite(value)) {
        continue;
      }
      const absValue = Math.abs(value);
      let penalty = 0;
      let source = null;
      if (dropCandidates.has(id) && absValue >= 0.28) {
        penalty = 0.018;
        source = "pruning_drop_candidate";
      } else if (guardOnly.has(id) && absValue >= 0.22) {
        penalty = 0.016;
        source = "pruning_guard_only";
      } else if (missingInLive.has(id) && absValue >= 0.18) {
        penalty = 0.014;
        source = "parity_missing_in_live";
      } else if (topNegative.has(id) && absValue >= 0.3) {
        penalty = Math.max(0.01, Math.min(0.02, (topNegative.get(id)?.influenceScore || 0.1) * 0.1));
        source = "inverse_attribution";
      }
      if (penalty > 0) {
        const group = topNegative.get(id)?.group ||
          pruningRecommendations.get(id)?.group ||
          parityDetails.get(id)?.group ||
          inferFeatureGovernanceGroup(id);
        impactedFeatures.push(id);
        impactedFeatureEntries.push({
          id,
          group,
          source,
          penalty,
          absValue: num(absValue, 4)
        });
      }
    }

    const groupedFeatureEntries = new Map();
    const sourcePressure = new Map();
    for (const item of impactedFeatureEntries) {
      if (!groupedFeatureEntries.has(item.group)) {
        groupedFeatureEntries.set(item.group, {
          group: item.group,
          features: [],
          sources: new Set()
        });
      }
      const bucket = groupedFeatureEntries.get(item.group);
      bucket.features.push(item);
      bucket.sources.add(item.source);
      if (!sourcePressure.has(item.source)) {
        sourcePressure.set(item.source, { source: item.source, featureCount: 0, penalty: 0 });
      }
      const sourceBucket = sourcePressure.get(item.source);
      sourceBucket.featureCount += 1;
      sourceBucket.penalty += item.penalty;
    }

    const impactedFeatureGroups = [...groupedFeatureEntries.values()]
      .map((bucket) => {
        const rankedFeatures = bucket.features
          .slice()
          .sort((left, right) => (right.penalty || 0) - (left.penalty || 0) || (right.absValue || 0) - (left.absValue || 0));
        const strongestPenalty = rankedFeatures[0]?.penalty || 0;
        const correlatedPenalty = rankedFeatures
          .slice(1)
          .reduce((total, item, index) => total + item.penalty * (index === 0 ? 0.45 : 0.3), 0);
        const penalty = strongestPenalty +
          Math.min(0.01, correlatedPenalty) +
          (bucket.sources.size >= 2 ? Math.min(0.008, bucket.sources.size * 0.003) : 0);
        return {
          group: bucket.group,
          featureCount: rankedFeatures.length,
          sourceCount: bucket.sources.size,
          sourceTypes: [...bucket.sources],
          topFeatures: rankedFeatures.slice(0, 3).map((item) => item.id),
          penalty: num(penalty, 4)
        };
      })
      .sort((left, right) => (right.penalty || 0) - (left.penalty || 0) || (right.featureCount || 0) - (left.featureCount || 0));

    featurePenalty = impactedFeatureGroups.reduce((total, item) => total + (item.penalty || 0), 0);

    const adjacentScopePressure = clamp(
      scopeMatches
        .filter((item) => (item.status || "") === "tighten" || (item.cautionPenalty || 0) >= 0.05 || (item.executionDragRate || 0) >= 0.18 || (item.qualityTrapRate || 0) >= 0.16)
        .reduce((total, item) => total + (item.matchWeight || 0), 0),
      0,
      1.8
    );
    const independentWeakGroupPressure = impactedFeatureGroups.length >= 2
      ? Math.min(0.036, impactedFeatureGroups.length * 0.011)
      : 0;
    const correlatedWeakFeaturePressure = impactedFeatureEntries.length > impactedFeatureGroups.length
      ? Math.min(0.016, (impactedFeatureEntries.length - impactedFeatureGroups.length) * 0.004)
      : 0;
    const adjacentFeaturePressure = clamp(
      adjacentScopePressure * Math.min(0.016, impactedFeatureGroups.length * 0.005 + (impactedFeatureGroups.length >= 2 ? 0.003 : 0)),
      0,
      0.024
    );
    const featureTrustPenalty = clamp(
      featurePenalty + independentWeakGroupPressure + correlatedWeakFeaturePressure + adjacentFeaturePressure,
      0,
      0.12
    );
    const executionCautionBase = weightedConfidence
      ? scopeMatches.reduce(
          (total, item) => total + (
            ((item.executionDragRate || 0) * 0.72) +
            ((item.qualityTrapRate || 0) * 0.68) +
            ((item.earlyExitRate || 0) * 0.24) +
            ((item.lateExitRate || 0) * 0.16)
          ) * Math.max(0.15, (item.confidence || 0)) * (item.matchWeight || 0),
          0
        ) / weightedConfidence
      : 0;
    let executionCaution = executionCautionBase;
    if (benchmarkLead === "simple_exit") {
      executionCaution += 0.045;
    } else if (benchmarkLead === "always_skip") {
      executionCaution += 0.03;
    }
    executionCaution = clamp(executionCaution + adjacentScopePressure * 0.018, 0, 0.18);

    featurePenalty = clamp(featurePenalty, 0, 0.08);
    if (featureTrustPenalty > 0) {
      thresholdShift += Math.min(0.008, featureTrustPenalty * 0.09);
      sizeMultiplier *= (1 - featureTrustPenalty * 0.9);
      cautionPenalty += featureTrustPenalty;
    }
    if (executionCaution > 0) {
      thresholdShift += Math.min(0.006, executionCaution * 0.05);
      sizeMultiplier *= (1 - executionCaution * 0.7);
      cautionPenalty += executionCaution * 0.65;
    }

    thresholdShift = num(clamp(thresholdShift, -0.018, 0.018), 4);
    sizeMultiplier = num(clamp(sizeMultiplier, 0.84, 1.08), 4);
    cautionPenalty = num(clamp(cautionPenalty, 0, 0.14), 4);
    const confidence = num(clamp(
      weightedConfidence * 0.72 +
        Math.min(0.28, featureTrustPenalty * 1.8) +
        (benchmarkLead === "always_skip" || benchmarkLead === "simple_exit" ? 0.08 : 0),
      0,
      1
    ), 4);
    const focusReason = benchmarkLead === "always_skip"
      ? "benchmark_always_skip_caution"
      : benchmarkLead === "simple_exit"
        ? "benchmark_simple_exit_caution"
        : impactedFeatures.length
          ? "feature_governance_pressure"
          : scopeMatches[0]
            ? `${scopeMatches[0].scopeType}_outcome_scope`
            : "offline_learning_guidance";
    const noteParts = [];
    if (scopeMatches[0]) {
      noteParts.push(`${scopeMatches[0].scopeType}:${scopeMatches[0].id} geeft nu outcome-bias.`);
    }
    if (benchmarkLead === "always_skip") {
      noteParts.push("Always-skip benchmark blijft opvallend sterk.");
    } else if (benchmarkLead === "simple_exit") {
      noteParts.push("Simple-exit benchmark blijft opvallend competitief.");
    }
    if (impactedFeatures.length) {
      noteParts.push(`Feature pressure op ${impactedFeatures.slice(0, 3).join(", ")}.`);
    }
    if (impactedFeatureGroups[0]) {
      noteParts.push(`Sterkste zwakke featuregroep: ${impactedFeatureGroups[0].group}.`);
    }
    if (sourcePressure.size) {
      noteParts.push(`Dominante bron: ${[...sourcePressure.values()].sort((left, right) => (right.penalty || 0) - (left.penalty || 0))[0]?.source || "feature_governance"}.`);
    }
    if (executionCaution >= 0.06) {
      noteParts.push("Execution drag of quality traps duwen nu extra cost-caution.");
    }

    return {
      active: Boolean(scopeMatches.length || featureTrustPenalty > 0 || executionCaution > 0 || ["always_skip", "simple_exit", "safe_lane"].includes(benchmarkLead || "")),
      sourceStatus: outcomeScopeLearning.status || featureGovernance.status || "warmup",
      thresholdShift,
      sizeMultiplier,
      cautionPenalty,
      confidence,
      featurePenalty: num(featurePenalty, 4),
      featureTrustPenalty: num(featureTrustPenalty, 4),
      adjacentScopePressure: num(adjacentScopePressure, 4),
      independentWeakGroupPressure: num(independentWeakGroupPressure, 4),
      correlatedWeakFeaturePressure: num(correlatedWeakFeaturePressure, 4),
      adjacentFeaturePressure: num(adjacentFeaturePressure, 4),
      executionCaution: num(executionCaution, 4),
      executionCostBufferBps: num(clamp(executionCaution * 8, 0, 2.6), 2),
      benchmarkLead,
      focusReason,
      impactedFeatures: [...new Set(impactedFeatures)].slice(0, 6),
      featurePressureSources: [...sourcePressure.values()]
        .map((item) => ({
          source: item.source,
          featureCount: item.featureCount,
          penalty: num(item.penalty || 0, 4)
        }))
        .sort((left, right) => (right.penalty || 0) - (left.penalty || 0) || (right.featureCount || 0) - (left.featureCount || 0))
        .slice(0, 4),
      impactedFeatureGroups: impactedFeatureGroups.slice(0, 4),
      matchedOutcomeScopes: scopeMatches.slice(0, 4),
      note: noteParts.join(" ") || outcomeScopeLearning.notes?.[0] || featureGovernance.notes?.[0] || "Offline learning guidance warmt nog op."
    };
  }

  applyFamilyOpportunityBudget(candidates = [], { readOnly = false } = {}) {
    const ranked = arr(candidates);
    if (ranked.length < 3 || (this.config?.botMode || "paper") !== "paper") {
      return ranked;
    }
    const leadingWindow = Math.min(ranked.length, Math.max(4, Math.min(this.config?.dashboardDecisionLimit || 6, 6)));
    const softCap = 1;
    const gapAllowance = 0.05;
    const pool = ranked.slice(0, leadingWindow);
    const reordered = [];
    const deferred = [];
    const familyCounts = new Map();

    while (pool.length) {
      const lead = pool[0];
      const leadFamily = lead?.strategySummary?.family || "unknown_family";
      const leadCount = familyCounts.get(leadFamily) || 0;
      if (leadCount >= softCap) {
        const alternateIndex = pool.findIndex((candidate, index) => {
          if (index === 0) {
            return false;
          }
          const family = candidate?.strategySummary?.family || "unknown_family";
          const familyCount = familyCounts.get(family) || 0;
          const scoreGap = (lead.decision?.opportunityScore ?? lead.decision?.rankScore ?? 0) -
            (candidate.decision?.opportunityScore ?? candidate.decision?.rankScore ?? 0);
          return familyCount < softCap && scoreGap <= gapAllowance;
        });
        if (alternateIndex > 0) {
          const [alternate] = pool.splice(alternateIndex, 1);
          reordered.push(alternate);
          deferred.push(lead.symbol);
          familyCounts.set(alternate.strategySummary?.family || "unknown_family", (familyCounts.get(alternate.strategySummary?.family || "unknown_family") || 0) + 1);
          continue;
        }
      }
      reordered.push(pool.shift());
      familyCounts.set(leadFamily, leadCount + 1);
    }

    const finalOrder = [...reordered, ...ranked.slice(leadingWindow)];
    finalOrder.forEach((candidate, index) => {
      candidate.decision.familyOpportunityBudget = {
        applied: deferred.length > 0,
        leadingWindow,
        softCap,
        reordered: deferred.includes(candidate.symbol),
        family: candidate.strategySummary?.family || null,
        slot: index
      };
    });
    if (!readOnly && deferred.length) {
      this.recordEvent("family_opportunity_budget_applied", {
        leadingWindow,
        softCap,
        deferredSymbols: [...new Set(deferred)]
      });
    }
    return finalOrder;
  }

  buildEntryRationale(candidate) {
    const adaptiveContext = candidate.decision.adaptiveContext || this.buildAdaptiveDecisionContext(candidate);
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
      opportunityScore: num(candidate.decision.opportunityScore || 0, 4),
      quoteAmount: num(candidate.decision.quoteAmount, 2),
      entryMode: candidate.decision.entryMode || "standard",
      learningLane: candidate.decision.learningLane || null,
      learningValueScore: num(candidate.decision.learningValueScore || 0, 4),
      paperLearningBudget: candidate.decision.paperLearningBudget || null,
      paperLearningSampling: candidate.decision.paperLearningSampling || null,
      paperLearningGuidance: summarizePaperLearningGuidance(candidate.decision.paperLearningGuidance || {}),
      offlineLearningGuidance: summarizeOfflineLearningGuidance(candidate.decision.offlineLearningGuidance || {}),
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
      strategyAllocation: summarizeStrategyAllocation(candidate.strategyAllocationSummary || candidate.score.strategyAllocation || {}),
      adaptivePolicy: candidate.decision.adaptivePolicy || adaptiveContext.adaptivePolicy,
      marketCondition: candidate.marketConditionSummary || null,
      missedTradeTuning: candidate.decision.missedTradeTuningApplied || null,
      exitPolicy: candidate.decision.exitPolicy || adaptiveContext.exitPolicy,
      adaptiveContext,
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
    const routerTrendStateSummary = buildTrendStateSummary({
      marketFeatures: marketSnapshot.market,
      bookFeatures: marketSnapshot.book,
      newsSummary,
      announcementSummary: exchangeSummary,
      timeframeSummary: {}
    });
    const routerMarketStateSummary = buildMarketStateSummary({
      trendStateSummary: routerTrendStateSummary,
      marketFeatures: marketSnapshot.market,
      bookFeatures: marketSnapshot.book,
      newsSummary,
      announcementSummary: exchangeSummary,
      timeframeSummary: {}
    });
    const routerMarketConditionSummary = buildMarketConditionSummary({
      marketSnapshot,
      regimeSummary,
      sessionSummary,
      trendStateSummary: routerTrendStateSummary,
      marketStateSummary: routerMarketStateSummary,
      newsSummary,
      announcementSummary: exchangeSummary,
      calendarSummary,
      volatilitySummary,
      marketSentimentSummary
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
      sessionSummary,
      strategyAllocationScorer: (strategyCandidate = {}) => this.model.scoreStrategyAllocation({
        score: {
          probability: strategyCandidate.fitScore || 0.5,
          confidence: strategyCandidate.confidence || 0
        },
        marketSnapshot,
        newsSummary,
        marketStructureSummary,
        strategySummary: {
          family: strategyCandidate.family || "trend_following",
          activeStrategy: strategyCandidate.id || "trend_following",
          fitScore: strategyCandidate.fitScore || 0.5,
          confidence: strategyCandidate.confidence || 0
        },
        regimeSummary,
        sessionSummary,
        marketConditionSummary: routerMarketConditionSummary
      }),
      optimizerSummary,
      exchangeCapabilities: this.runtime.exchangeCapabilities || this.config.exchangeCapabilities || {}
    });
    const timeframeSummary = this.config.enableCrossTimeframeConsensus
      ? buildTimeframeConsensus({ marketSnapshot, regimeSummary, strategySummary, config: this.config })
      : summarizeTimeframeConsensus({ enabled: false });
    const pairHealthSummary = context.pairHealthSummary || this.pairHealthMonitor.evaluateSymbol(context.pairHealthSnapshot || {}, { symbol, marketSnapshot, newsSummary, timeframeSummary });
    const divergenceSummary = context.divergenceSummary || this.divergenceMonitor.buildSummary({ journal: this.journal, nowIso: now.toISOString() });
    const sourceReliabilitySummary = context.sourceReliabilitySummary || this.buildSourceReliabilitySnapshot();
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
    const strategyAllocationSummary = this.model.scoreStrategyAllocation({
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
      regimeSummary,
      sessionSummary,
      marketConditionSummary: routerMarketConditionSummary
    });
    const combinedStrategyMetaSummary = {
      ...strategyMetaSummary,
      fitBoost: clamp((strategyMetaSummary.fitBoost || 0) + (strategyAllocationSummary.fitBoost || 0), -0.12, 0.12),
      thresholdShift: clamp((strategyMetaSummary.thresholdShift || 0) + (strategyAllocationSummary.thresholdShift || 0), -0.05, 0.05),
      sizeMultiplier: clamp(
        (strategyMetaSummary.sizeMultiplier || 1) *
        (strategyAllocationSummary.sizeMultiplier || 1) *
        (strategyAllocationSummary.budgetMultiplier || 1),
        0.68,
        1.24
      ),
      confidence: clamp(((strategyMetaSummary.confidence || 0) * 0.6) + ((strategyAllocationSummary.confidence || 0) * 0.4), 0, 1),
      strategyAllocation: summarizeStrategyAllocation(strategyAllocationSummary)
    };
    strategySummary = {
      ...strategySummary,
      fitScore: clamp((strategySummary.fitScore || 0) + (combinedStrategyMetaSummary.fitBoost || 0), 0, 1),
      confidence: clamp(
        (strategySummary.confidence || 0) +
        Math.max(-0.04, Math.min(0.04, strategyMetaSummary.familyAlignment || 0)) +
        Math.max(-0.03, Math.min(0.03, strategyAllocationSummary.confidenceBoost || 0)),
        0,
        1
      ),
      metaSelector: summarizeStrategyMeta(combinedStrategyMetaSummary),
      adaptiveSelector: summarizeStrategyAllocation(strategyAllocationSummary),
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
    const marketConditionSummary = buildMarketConditionSummary({
      marketSnapshot,
      regimeSummary,
      sessionSummary,
      timeframeSummary,
      trendStateSummary,
      marketStateSummary,
      newsSummary,
      announcementSummary: exchangeSummary,
      calendarSummary,
      volatilitySummary,
      marketSentimentSummary,
      qualityQuorumSummary,
      pairHealthSummary,
      venueConfirmationSummary
    });
    const conditionAwareStrategyAllocationSummary = this.model.scoreStrategyAllocation({
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
      regimeSummary,
      sessionSummary,
      marketConditionSummary
    });
    strategySummary = {
      ...strategySummary,
      adaptiveSelector: summarizeStrategyAllocation(conditionAwareStrategyAllocationSummary)
    };
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
      strategyMetaSummary: combinedStrategyMetaSummary,
      strategyAllocationSummary: conditionAwareStrategyAllocationSummary,
      timeframeSummary,
      pairHealthSummary,
      divergenceSummary,
      marketConditionSummary
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
      missedTradeTuningSummary: this.runtime.offlineTrainer?.missedTradeTuning || {},
      timeframeSummary,
      pairHealthSummary,
      qualityQuorumSummary,
      onChainLiteSummary,
      divergenceSummary,
      trendStateSummary,
      marketStateSummary,
      marketConditionSummary,
      paperLearningGuidance: this.buildPaperLearningGuidance({
        symbol,
        strategySummary,
        regimeSummary,
        sessionSummary
      }),
      offlineLearningGuidance: this.buildOfflineLearningGuidance({
        strategySummary,
        regimeSummary,
        sessionSummary,
        marketConditionSummary,
        rawFeatures
      }),
      venueConfirmationSummary,
      exchangeCapabilitiesSummary: this.runtime.exchangeCapabilities || this.config.exchangeCapabilities || {},
      strategyMetaSummary: score.strategyMeta || combinedStrategyMetaSummary,
      strategyAllocationSummary: score.strategyAllocation || conditionAwareStrategyAllocationSummary,
      nowIso: now.toISOString()
    });
    decision.rankScore = num((decision.rankScore || 0) + (attributionSummary.rankBoost || 0), 4);
    decision.attributionSummary = attributionSummary;
    const probeOnlyState = this.runtime.probeOnly || {};
    const probeOnlyActive = Boolean(probeOnlyState.enabled) && (!probeOnlyState.until || new Date(probeOnlyState.until).getTime() > now.getTime());
    if (probeOnlyActive) {
      decision.quoteAmount = num((decision.quoteAmount || 0) * 0.32, 2);
      decision.reasons = [...new Set([...(decision.reasons || []), "operator_probe_only"])].slice(0, 10);
      decision.operatorAction = "Alleen probe-entries zijn nu toegestaan. Gebruik deze periode om extra leertrades gecontroleerd te volgen.";
      decision.autoRecovery = "De probe-only periode loopt automatisch af zodra het operatorvenster sluit.";
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
      strategyMetaSummary: score.strategyMeta || combinedStrategyMetaSummary,
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
    decision.exitPolicy = this.resolveEntryExitPolicyPreview({
      marketConditionSummary,
      strategySummary
    });
    decision.adaptivePolicy = summarizeAdaptivePolicy({
      strategyAllocation: summarizeStrategyAllocation(score.strategyAllocation || conditionAwareStrategyAllocationSummary || {}),
      paperLearning: summarizePaperLearning(this.runtime?.ops?.paperLearning || this.runtime?.paperLearning || {}),
      marketCondition: summarizeMarketCondition(marketConditionSummary),
      policyTransitions: arr(this.runtime?.offlineTrainer?.policyTransitionCandidatesByCondition || [])
    });
    decision.adaptiveContext = this.buildAdaptiveDecisionContext({
      ...{
        symbol,
        score,
        decision,
        strategySummary,
        strategyAllocationSummary: score.strategyAllocation || conditionAwareStrategyAllocationSummary,
        marketConditionSummary
      }
    });
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
      marketConditionSummary,
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
      strategyMetaSummary: score.strategyMeta || combinedStrategyMetaSummary,
      strategyAllocationSummary: score.strategyAllocation || conditionAwareStrategyAllocationSummary,
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
        const marketConditionSummary = buildMarketConditionSummary({
          marketSnapshot,
          regimeSummary,
          sessionSummary: this.runtime.session || {},
          timeframeSummary,
          trendStateSummary: position.entryRationale?.trendState || position.entryRationale?.trendStateSummary || {},
          marketStateSummary: position.entryRationale?.marketState || position.entryRationale?.marketStateSummary || {},
          newsSummary,
          announcementSummary: exchangeSummary,
          calendarSummary,
          volatilitySummary: this.runtime.volatilityContext || EMPTY_VOLATILITY_CONTEXT,
          marketSentimentSummary,
          qualityQuorumSummary: this.runtime.qualityQuorum || {},
          pairHealthSummary: this.runtime.pairHealth?.[position.symbol] || {},
          venueConfirmationSummary: this.runtime.venueConfirmation || {}
        });
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
              strategySummary,
              marketConditionSummary,
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
        position.latestMarketConditionSummary = marketConditionSummary;
        position.latestExitIntelligence = exitIntelligenceSummary;
        position.latestExitPolicy = exitDecision.exitPolicy || null;
        position.replayCheckpoints = arr(position.replayCheckpoints || []);
        position.replayCheckpoints.push({ at: nowIso(), price: num(marketSnapshot.book.mid, 6), spreadBps: num(marketSnapshot.book.spreadBps || 0, 2), bookPressure: num(marketSnapshot.book.bookPressure || 0, 3), newsRisk: num(newsSummary.riskScore || 0, 3), tfAlignment: num(timeframeSummary.alignmentScore || 0, 4), onChainStress: num(onChainLiteSummary.stressScore || 0, 4) });
        position.replayCheckpoints = position.replayCheckpoints.slice(-24);
        position.lastReviewedAt = nowIso();
        if (!position.manualReviewRequired && !position.reconcileRequired) {
          position.managementFailureCount = 0;
          const brokerMode = position.brokerMode || this.config.botMode;
          const protectionMissing = brokerMode === "live" && this.config.enableExchangeProtection && !position.protectiveOrderListId;
          if (position.operatorMode === "protect_only") {
            position.lifecycleState = "protect_only";
          } else {
            position.operatorMode = "normal";
            if (protectionMissing) {
              position.lifecycleState = "protection_pending";
            } else if (!position.lifecycleState || ["protect_only", "manual_review", "reconcile_required", "protection_pending"].includes(position.lifecycleState)) {
              position.lifecycleState = position.protectiveOrderListId ? "protected" : (brokerMode === "live" ? "open" : "simulated_open");
            }
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
          if (scaleOut?.closedTrade) {
            scaleOut.closedTrade.exitIntelligenceSummary = exitIntelligenceSummary;
            scaleOut.closedTrade.replayCheckpoints = arr(position.replayCheckpoints || []);
            this.journal.trades.push(scaleOut.closedTrade);
            this.markReportDirty();
            await this.learnFromTrade(scaleOut.closedTrade, "Closed position");
            this.recordEvent("position_closed_via_protective_fill", {
              symbol: scaleOut.closedTrade.symbol,
              reason: scaleOut.closedTrade.reason
            });
            continue;
          }
          scaleOut.exitIntelligenceSummary = exitIntelligenceSummary;
          this.journal.scaleOuts.push(scaleOut);
          this.markReportDirty();
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
        this.markReportDirty();
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
    const offlineTrainerSummary = this.offlineTrainer.buildSummary({ journal: this.journal, dataRecorder: this.dataRecorder.getSummary(), counterfactuals: this.journal.counterfactuals || [], historySummary: this.runtime.marketHistory || {}, nowIso: now.toISOString() });
    const sourceReliabilitySummary = this.buildSourceReliabilitySnapshot();
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
      this.noteCandidateSignalFlow(candidates, now.toISOString(), {
        symbolsScanned: symbolsToEvaluate.length,
        candidatesScored: candidates.length
      });
    }

    candidates.sort((left, right) => (right.decision.opportunityScore ?? right.decision.rankScore) - (left.decision.opportunityScore ?? left.decision.rankScore));
    const rankedCandidates = this.applyFamilyOpportunityBudget(candidates, { readOnly });
    if (!readOnly) {
      this.runtime.pairHealth = summarizePairHealth({ ...pairHealthSnapshot, leadSymbol: rankedCandidates[0]?.symbol || null, leadScore: rankedCandidates[0]?.pairHealthSummary?.score ?? null });
      this.runtime.qualityQuorum = summarizeQualityQuorum(buildRuntimeQualityQuorum(rankedCandidates, now.toISOString()));
      this.runtime.venueConfirmation = summarizeVenueConfirmation(this.referenceVenue.summarizeRuntime(rankedCandidates, now.toISOString()));
      this.runtime.latestDecisions = rankedCandidates.slice(0, this.config.dashboardDecisionLimit).map((candidate) => ({
      symbol: candidate.symbol,
      summary: this.buildCandidateSummary(candidate),
      setupStyle: buildSetupStyle(candidate),
      strategy: summarizeStrategy(candidate.strategySummary),
      strategyMeta: summarizeStrategyMeta(candidate.strategyMetaSummary || candidate.score.strategyMeta || {}),
      strategyAllocation: summarizeStrategyAllocation(candidate.strategyAllocationSummary || candidate.score.strategyAllocation || {}),
      marketCondition: candidate.marketConditionSummary || null,
      missedTradeTuning: candidate.decision.missedTradeTuningApplied || null,
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
      opportunityScore: num(candidate.decision.opportunityScore || 0, 4),
      threshold: num(candidate.decision.threshold, 4),
      quoteAmount: num(candidate.decision.quoteAmount, 2),
      learningLane: candidate.decision.learningLane || null,
      learningValueScore: num(candidate.decision.learningValueScore || 0, 4),
      paperLearningBudget: candidate.decision.paperLearningBudget || null,
      paperLearningGuidance: summarizePaperLearningGuidance(candidate.decision.paperLearningGuidance || {}),
      offlineLearningGuidance: summarizeOfflineLearningGuidance(candidate.decision.offlineLearningGuidance || {}),
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
      lowConfidencePressure: summarizeLowConfidencePressure(candidate.decision.lowConfidencePressure || {}),
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
        activeLearning: candidate.decision.paperActiveLearning ? {
          score: num(candidate.decision.paperActiveLearning.activeLearningScore || 0, 4),
          focusReason: candidate.decision.paperActiveLearning.focusReason || null,
          nearMissScore: num(candidate.decision.paperActiveLearning.nearMissScore || 0, 4),
          disagreementScore: num(candidate.decision.paperActiveLearning.disagreementScore || 0, 4),
          uncertaintyScore: num(candidate.decision.paperActiveLearning.uncertaintyScore || 0, 4)
        } : null,
        guidance: summarizePaperLearningGuidance(candidate.decision.paperLearningGuidance || {}),
        scope: {
          family: candidate.decision.paperLearningSampling?.scope?.family || null,
          regime: candidate.decision.paperLearningSampling?.scope?.regime || null,
          session: candidate.decision.paperLearningSampling?.scope?.session || null
        },
        allocatorGovernance: candidate.decision.strategyAllocationGovernance || null,
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
      strategyRetirement: candidate.decision.strategyRetirementApplied ? {
        active: Boolean(candidate.decision.strategyRetirementApplied.active),
        status: candidate.decision.strategyRetirementApplied.status || "ready",
        blocked: Boolean(candidate.decision.strategyRetirementApplied.blocked),
        sizeMultiplier: num(candidate.decision.strategyRetirementApplied.sizeMultiplier || 1, 4),
        confidence: num(candidate.decision.strategyRetirementApplied.confidence || 0, 4),
        reason: candidate.decision.strategyRetirementApplied.reason || null
      } : null,
      sessionReasons: [...(candidate.sessionSummary?.reasons || [])],
      sessionBlockers: [...(candidate.sessionSummary?.blockerReasons || [])],
      driftReasons: [...(candidate.driftSummary?.reasons || [])],
      driftBlockers: [...(candidate.driftSummary?.blockerReasons || [])],
      selfHealIssues: [...(candidate.selfHealState?.issues || [])],
      headlines: arr(candidate.newsSummary.headlines).slice(0, 3).map(summarizeHeadline),
      entryStatus: candidate.decision.allow ? "eligible" : "blocked",
      entryOpened: false,
      entryAttempted: false,
      executionBlockers: [],
      adaptivePolicy: candidate.decision.adaptivePolicy || null,
      exitPolicy: candidate.decision.exitPolicy || null,
      adaptiveContext: candidate.decision.adaptiveContext || null,
      familyOpportunityBudget: candidate.decision.familyOpportunityBudget || null
    }));
      this.runtime.ops = this.runtime.ops || {};
      this.runtime.ops.lowConfidenceAudit = summarizeLowConfidenceAudit(this.buildLowConfidenceAudit(rankedCandidates));
      const blockedCandidates = this.runtime.latestDecisions.filter((decision) => !decision.allow).slice(0, this.config.dashboardDecisionLimit).map((decision) => ({
      ...decision,
      blockedAt: now.toISOString()
      }));
      this.runtime.latestBlockedSetups = blockedCandidates;
      this.journal.blockedSetups.push(...blockedCandidates.slice(0, 4));
      if (blockedCandidates.length) {
        this.markReportDirty();
      }
      this.runtime.marketSentiment = rankedCandidates[0]
        ? summarizeMarketSentiment(rankedCandidates[0].marketSentimentSummary)
        : this.runtime.marketSentiment || summarizeMarketSentiment(EMPTY_MARKET_SENTIMENT);
      this.runtime.volatilityContext = rankedCandidates[0]
        ? summarizeVolatility(rankedCandidates[0].volatilitySummary)
        : this.runtime.volatilityContext || summarizeVolatility(EMPTY_VOLATILITY_CONTEXT);
      this.runtime.onChainLite = rankedCandidates[0]
        ? summarizeOnChainLite(rankedCandidates[0].onChainLiteSummary)
        : this.runtime.onChainLite || summarizeOnChainLite(EMPTY_ONCHAIN);
      this.runtime.session = rankedCandidates[0]
        ? summarizeSession(rankedCandidates[0].sessionSummary)
        : this.runtime.session || summarizeSession({});
    }
    return rankedCandidates;
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
    const symbolExchangeConflicts = new Map();
    for (const symbol of arr(this.runtime.exchangeTruth?.unmatchedOrderSymbols || [])) {
      if (symbol) {
        symbolExchangeConflicts.set(symbol, "unmatched_open_orders");
      }
    }
    for (const symbol of arr(this.runtime.exchangeTruth?.orphanedSymbols || [])) {
      if (symbol && !symbolExchangeConflicts.has(symbol)) {
        symbolExchangeConflicts.set(symbol, "orphaned_exchange_balance");
      }
    }
    const attempt = {
      status: "idle",
      selectedSymbol: null,
      openedPosition: null,
      attemptedSymbols: [],
      blockedReasons: [...(executionBlockers || [])],
      entryErrors: [],
      symbolBlockers: []
    };
    if (!this.health.canEnterNewPositions(this.runtime)) {
      attempt.status = "health_blocked";
      attempt.blockedReasons.push("health_circuit_open");
      this.logger?.info?.("Entry flow blocked", { status: attempt.status, blockedReasons: attempt.blockedReasons });
      this.recordEvent("entry_flow_blocked", { status: attempt.status, blockedReasons: [...attempt.blockedReasons] });
      return attempt;
    }
    if (botMode === "live" && this.runtime.exchangeTruth?.freezeEntries) {
      attempt.status = "runtime_blocked";
      attempt.blockedReasons.push("exchange_truth_freeze");
      this.logger?.info?.("Entry flow blocked", { status: attempt.status, blockedReasons: attempt.blockedReasons });
      this.recordEvent("entry_flow_blocked", { status: attempt.status, blockedReasons: [...attempt.blockedReasons] });
      return attempt;
    }
    if (attempt.blockedReasons.length) {
      attempt.status = "runtime_blocked";
      this.logger?.info?.("Entry flow blocked", { status: attempt.status, blockedReasons: attempt.blockedReasons });
      this.recordEvent("entry_flow_blocked", { status: attempt.status, blockedReasons: [...attempt.blockedReasons] });
      return attempt;
    }
    const allowedCandidates = candidates.filter((item) => item.decision.allow);
    if (!allowedCandidates.length) {
      attempt.status = "no_allowed_candidates";
      this.logger?.info?.("Entry flow blocked", {
        status: attempt.status,
        candidateCount: candidates.length,
        topRejectionCategory: summarizeCountMap(this.runtime?.signalFlow?.lastCycle?.rejectionCategories || {}, 1)[0]?.id || null
      });
      this.recordEvent("entry_flow_blocked", {
        status: attempt.status,
        blockedReasons: summarizeCountMap(this.runtime?.signalFlow?.lastCycle?.rejectionReasons || {}, 3).map((item) => item.id),
        candidateCount: candidates.length
      });
      return attempt;
    }

    for (const candidate of allowedCandidates) {
      attempt.selectedSymbol = attempt.selectedSymbol || candidate.symbol;
      const symbolConflict = botMode === "live" ? symbolExchangeConflicts.get(candidate.symbol) : null;
      if (symbolConflict) {
        attempt.symbolBlockers.push({ symbol: candidate.symbol, reason: symbolConflict });
        continue;
      }
      const invalidExecutionState = [];
      if (!this.symbolRules[candidate.symbol]) {
        invalidExecutionState.push("missing_symbol_rules");
      }
      if (!Number.isFinite(candidate.decision?.quoteAmount) || (candidate.decision?.quoteAmount || 0) <= 0) {
        invalidExecutionState.push("invalid_quote_amount");
      }
      if (!candidate.decision?.executionPlan) {
        invalidExecutionState.push("missing_execution_plan");
      }
      if (!candidate.strategySummary?.activeStrategy) {
        invalidExecutionState.push("missing_strategy_summary");
      }
      if (!candidate.rawFeatures || typeof candidate.rawFeatures !== "object") {
        invalidExecutionState.push("missing_raw_features");
      }
      if (
        !Number.isFinite(candidate.marketSnapshot?.book?.mid) &&
        !(Number.isFinite(candidate.marketSnapshot?.book?.bid) && Number.isFinite(candidate.marketSnapshot?.book?.ask))
      ) {
        invalidExecutionState.push("missing_market_price");
      }
      if (invalidExecutionState.length) {
        attempt.symbolBlockers.push({ symbol: candidate.symbol, reason: invalidExecutionState[0] });
        this.logger?.warn?.("Allowed candidate skipped before execution", {
          symbol: candidate.symbol,
          reasons: invalidExecutionState
        });
        this.recordEvent("entry_candidate_invalid", {
          symbol: candidate.symbol,
          reasons: invalidExecutionState
        });
        continue;
      }
      attempt.attemptedSymbols.push(candidate.symbol);
      this.noteEntryAttempt({ candidate });
      if (botMode === "paper") {
        this.notePaperTradeAttempt({ candidate });
      }
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
        position.marketConditionAtEntry = position.marketConditionAtEntry || entryRationale.marketCondition?.conditionId || null;
        position.allocatorPostureAtEntry = position.allocatorPostureAtEntry || entryRationale.adaptivePolicy?.posture || entryRationale.strategyAllocation?.posture || null;
        position.opportunityScoreAtEntry = position.opportunityScoreAtEntry ?? entryRationale.opportunityScore ?? null;
        position.missedTradeTuningApplied = position.missedTradeTuningApplied || entryRationale.missedTradeTuning || null;
        position.exitPolicyApplied = position.exitPolicyApplied || entryRationale.exitPolicy || null;
        position.adaptivePolicyAtEntry = position.adaptivePolicyAtEntry || entryRationale.adaptivePolicy || null;
        position.adaptiveContext = position.adaptiveContext || entryRationale.adaptiveContext || null;
        this.noteEntryExecuted({ candidate, position });
        if (botMode === "paper") {
          this.notePaperTradeExecuted({ candidate, position });
        }
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
        this.markReportDirty();
        attempt.status = "opened";
        attempt.selectedSymbol = candidate.symbol;
        attempt.openedPosition = position;
        return attempt;
      } catch (error) {
        this.logger.warn("Position entry failed", { symbol: candidate.symbol, error: error.message });
        this.recordEvent("position_open_failed", { symbol: candidate.symbol, error: error.message });
        if (error.recoveredTrade) {
          this.journal.trades.push(error.recoveredTrade);
          this.markReportDirty();
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
      this.logger?.info?.("Entry flow blocked", {
        status: attempt.status,
        blockedReasons: attempt.blockedReasons,
        symbolBlockers: attempt.symbolBlockers
      });
      this.recordEvent("entry_flow_blocked", {
        status: attempt.status,
        blockedReasons: [...attempt.blockedReasons],
        symbolBlockers: arr(attempt.symbolBlockers).map((item) => item.reason)
      });
      return attempt;
    }
    if (!attempt.attemptedSymbols.length && attempt.symbolBlockers.length) {
      attempt.status = "runtime_blocked";
      attempt.blockedReasons = [...new Set(attempt.symbolBlockers.map((item) => item.reason).filter(Boolean))];
      this.logger?.info?.("Entry flow blocked", {
        status: attempt.status,
        blockedReasons: attempt.blockedReasons,
        symbolBlockers: attempt.symbolBlockers
      });
      this.recordEvent("entry_flow_blocked", {
        status: attempt.status,
        blockedReasons: [...attempt.blockedReasons],
        symbolBlockers: arr(attempt.symbolBlockers).map((item) => item.reason)
      });
      return attempt;
    }
    attempt.status = attempt.entryErrors.length ? "entry_failed" : "no_allowed_candidates";
    if (attempt.status !== "opened") {
      this.logger?.info?.("Entry flow blocked", {
        status: attempt.status,
        blockedReasons: attempt.blockedReasons,
        entryErrors: attempt.entryErrors
      });
      this.recordEvent("entry_flow_blocked", {
        status: attempt.status,
        blockedReasons: [...attempt.blockedReasons],
        entryErrors: arr(attempt.entryErrors).map((item) => item.error)
      });
    }
    return attempt;
  }

  applyEntryAttemptToDecisions(entryAttempt = {}) {
    const openedSymbol = entryAttempt.openedPosition?.symbol || null;
    const attemptedSymbols = new Set(arr(entryAttempt.attemptedSymbols));
    const errorMap = new Map(arr(entryAttempt.entryErrors).map((item) => [item.symbol, item.error]));
    const symbolBlockerMap = new Map(arr(entryAttempt.symbolBlockers).map((item) => [item.symbol, item.reason]));
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
      } else if (symbolBlockerMap.has(decision.symbol)) {
        entryStatus = "runtime_blocked";
        executionBlockers = [symbolBlockerMap.get(decision.symbol)];
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
      symbolBlockers: arr(entryAttempt.symbolBlockers),
      entryErrors: arr(entryAttempt.entryErrors),
      at: nowIso()
    };
  }

  trimJournal() {
    let trimmed = false;
    if (this.journal.trades.length > 2000) {
      this.journal.trades = this.journal.trades.slice(-2000);
      trimmed = true;
    }
    if (this.journal.scaleOuts.length > 2000) {
      this.journal.scaleOuts = this.journal.scaleOuts.slice(-2000);
      trimmed = true;
    }
    if (this.journal.blockedSetups.length > 2000) {
      this.journal.blockedSetups = this.journal.blockedSetups.slice(-2000);
      trimmed = true;
    }
    if (this.journal.counterfactuals.length > 2000) {
      this.journal.counterfactuals = this.journal.counterfactuals.slice(-2000);
      trimmed = true;
    }
    if (this.journal.universeRuns.length > 1000) {
      this.journal.universeRuns = this.journal.universeRuns.slice(-1000);
    }
    if (this.journal.researchRuns.length > 120) {
      this.journal.researchRuns = this.journal.researchRuns.slice(-120);
      trimmed = true;
    }
    if (this.journal.equitySnapshots.length > 5000) {
      this.journal.equitySnapshots = this.journal.equitySnapshots.slice(-5000);
      trimmed = true;
    }
    if (this.journal.cycles.length > 2000) {
      this.journal.cycles = this.journal.cycles.slice(-2000);
      trimmed = true;
    }
    if (this.journal.events.length > 2000) {
      this.journal.events = this.journal.events.slice(-2000);
      trimmed = true;
    }
    if (trimmed) {
      this.markReportDirty();
    }
  }

  async updatePortfolioSnapshot(midPrices = {}) {
    const balance = await this.broker.getBalance(this.runtime);
    const equity = await this.broker.getEquity(this.runtime, midPrices);
    this.runtime.lastKnownBalance = balance.quoteFree;
    this.runtime.lastKnownEquity = equity;
    this.runtime.lastPortfolioUpdateAt = nowIso();
    this.markReportDirty();
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
      const analysisAt = nowIso();
      this.refreshGovernanceViews(analysisAt);
      const candidates = await this.scanCandidatesForCycle(balance);
      const equity = await this.broker.getEquity(this.runtime, midPrices);
      this.runtime.lastKnownBalance = balance.quoteFree;
      this.runtime.lastKnownEquity = equity;
      this.runtime.lastPortfolioUpdateAt = analysisAt;
      this.runtime.lastAnalysisAt = analysisAt;
      await this.resolveCounterfactualQueue(this.runtime.lastAnalysisAt);
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
    const result = await runResearchLab({ config: this.config, logger: this.logger, symbols, historyStore: this.historyStore });
    this.runtime.researchLab = {
      lastRunAt: result.generatedAt,
      latestSummary: result
    };
    let fetchedCandidates = [];
    try {
      fetchedCandidates = await this.strategyResearchMiner.fetchWhitelistedCandidates();
    } catch (error) {
      this.logger.warn("Strategy research imports failed", { error: error.message });
      this.recordEvent("strategy_research_import_failed", { error: error.message });
    }
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
    this.markReportDirty();
    await this.safeRecordDataRecorder("research", async () => this.dataRecorder.recordResearch(result));
    await this.safeRefreshMarketHistorySnapshot({ symbols, referenceNow: result.generatedAt, context: "research" });
    this.refreshGovernanceViews(result.generatedAt);
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
    this.refreshGovernanceViews(cycleAt);
    const balance = await this.broker.getBalance(this.runtime);
    const candidates = await this.scanCandidatesForCycle(balance);
    await this.resolveCounterfactualQueue(cycleAt);
    const executionBlockers = this.config.botMode === "live" ? driftIssues : [];
    const entryAttempt = await this.openBestCandidate(candidates, { executionBlockers });
    const openedPosition = entryAttempt.openedPosition || null;
    this.finalizeSignalFlowCycle({ at: cycleAt, entryAttempt, openedPosition });
    this.applyEntryAttemptToDecisions(entryAttempt);
    this.syncOrderLifecycleState("entry_attempt");
    const portfolio = await this.updatePortfolioSnapshot(markedPrices);
    this.journal.equitySnapshots.push({
      at: cycleAt,
      brokerMode: this.config.botMode,
      equity: portfolio.equity,
      quoteFree: portfolio.balance.quoteFree,
      openPositions: this.runtime.openPositions.length
    });
    this.markReportDirty();
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
    this.markReportDirty();
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
    await this.safeRecordDataRecorder("decisions", async () => this.dataRecorder.recordDecisions({ at: cycleAt, candidates }));
    await this.safeRecordDataRecorder("cycle", async () => this.dataRecorder.recordCycle({
      at: cycleAt,
      mode: this.config.botMode,
      candidates,
      openedPosition,
      entryAttempt,
      signalFlow: summarizeSignalFlow(this.runtime.signalFlow || {}),
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
    }));
    await this.safeRecordDataRecorder("snapshot_manifest", async () => this.dataRecorder.recordSnapshotManifest({
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
        capitalGovernor: this.runtime.capitalGovernor || {},
        signalFlow: summarizeSignalFlow(this.runtime.signalFlow || {})
      },
      report: governance.report || {}
    }));
    await this.safeRecordDataRecorder("dataset_curation", async () => this.dataRecorder.recordDatasetCuration({
      at: cycleAt,
      journal: this.journal,
      newsCache: this.runtime.newsCache || {},
      sourceReliability: this.runtime.sourceReliability || {},
      paperLearning: this.runtime.paperLearning || this.runtime.ops?.paperLearning || {},
      offlineTrainer: governance.offlineTrainerSummary || this.runtime.offlineTrainer || {}
    }));
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
      try {
        await this.persist();
      } catch (error) {
        if (result.openedPosition) {
          this.noteEntryPersistFailed({ position: result.openedPosition, error, at: nowIso() });
          await this.persist().catch(() => {});
        }
        throw error;
      }
      if (result.openedPosition) {
        this.noteEntryPersisted({ position: result.openedPosition, at: nowIso() });
        if ((this.config?.botMode || "paper") === "paper") {
          this.notePaperTradePersisted({ position: result.openedPosition, at: nowIso() });
        }
        await this.persist();
      }
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
    const regimeId = decision.regime || decision.regimeAtEntry || null;
    const activeMode = this.config?.botMode || "paper";
    const strategyCard = offlineTrainer.strategyScorecards.find((item) => item.id === strategyId);
    const recentCounterfactuals = arr(this.journal?.counterfactuals || [])
      .filter((item) => {
        const modeMatch = (item.brokerMode || "paper") === activeMode;
        const usableMatch = isUsableCounterfactual(item);
        const itemBlockers = arr(item.blockerReasons || []);
        const blockerMatch = itemBlockers.some((itemBlocker) => blockerSet.has(itemBlocker));
        const strategyMatch = strategyId && (item.strategy === strategyId || item.strategyAtEntry === strategyId);
        const regimeMatch = regimeId && (item.regime === regimeId || item.regimeAtEntry === regimeId);
        const phaseMatch = decision.marketState?.phase && item.marketPhase === decision.marketState.phase;
        return (
          modeMatch &&
          usableMatch &&
          (blockerSet.size ? blockerMatch : true) &&
          (strategyId ? strategyMatch : true) &&
          (regimeId ? regimeMatch : true) &&
          (decision.marketState?.phase ? phaseMatch : true)
        );
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
    const lowConfidencePressure = summarizeLowConfidencePressure(decision.lowConfidencePressure || {});
    const blockerReasons = [
      ...arr(decision.blockerReasons || decision.reasons || []),
      ...arr(decision.sessionBlockers || decision.session?.blockerReasons || []),
      ...arr(decision.driftBlockers || decision.drift?.blockerReasons || []),
      ...arr(decision.selfHealIssues || decision.selfHeal?.issues || [])
    ];
    const dataSources = arr(decision.dataQuality?.sources || decision.dataQualitySummary?.sources || []).slice(0, 5);
    const degradedSources = dataSources.filter((item) => ["degraded", "missing"].includes(item.status)).map((item) => item.label);
    const incomingOperatorAction = decision.operatorAction === "probe_only"
      ? "Alleen probe-entries zijn nu toegestaan. Gebruik deze periode om extra leertrades gecontroleerd te volgen."
      : decision.operatorAction || null;
    const incomingAutoRecovery = decision.autoRecovery === "operator_probe_window"
      ? "De probe-only periode loopt automatisch af zodra het operatorvenster sluit."
      : decision.autoRecovery || null;
    const prioritizedPaperBlocker = this.config?.botMode === "paper"
      ? [
          "exchange_truth_freeze",
          "reconcile_required",
          "quality_quorum_observe_only",
          "higher_tf_conflict",
          "local_book_quality_too_low",
          "quality_quorum_degraded",
          "regime_kill_switch_active",
          "model_confidence_too_low",
          "committee_veto",
          "execution_cost_budget_exceeded",
          "capital_governor_blocked"
        ].find((reason) => blockerReasons.includes(reason)) || blockerReasons[0]
      : blockerReasons[0];
    const operatorAction = incomingOperatorAction || ((prioritizedPaperBlocker === "exchange_truth_freeze")
      ? "Wacht op reconcile en bevestig exchange truth voordat entries terug mogen."
      : prioritizedPaperBlocker === "reconcile_required"
        ? "Controleer protective state en runtime/exchange inventory."
        : prioritizedPaperBlocker === "higher_tf_conflict"
          ? "Hogere timeframes spreken deze setup tegen. Wacht op betere alignment of behandel dit alleen als leergeval."
        : prioritizedPaperBlocker === "local_book_quality_too_low"
          ? "De local book is nu te zwak. Wacht op betere depth of laat dit alleen als lichte paper-reviewcase meelopen."
        : prioritizedPaperBlocker === "quality_quorum_degraded"
          ? "De datasources zijn nu te zwak of onvolledig. Gebruik dit vooral als leergeval tot de kwaliteit herstelt."
        : prioritizedPaperBlocker === "regime_kill_switch_active"
          ? "De regime kill switch houdt paper nu in recovery. Laat alleen gecontroleerde probe-cases lopen tot nieuwe data de drawdown-context verbetert."
        : prioritizedPaperBlocker === "model_confidence_too_low"
          ? lowConfidencePressure.note || "Modelconfidence is te laag voor een normale entry. Vergelijk vergelijkbare probe- en shadow-cases voordat je versoepelt."
        : prioritizedPaperBlocker === "committee_veto"
          ? "Geblokkeerd door leer/governance: eerdere vergelijkbare setups scoorden te zwak of werden terecht gevetoed. Bekijk gemiste-trade analyse om te zien of deze blokkade te streng was."
        : prioritizedPaperBlocker === "execution_cost_budget_exceeded"
          ? "Execution is nu te duur. Wacht op betere spread/depth of laat alleen lichtere probes door."
        : prioritizedPaperBlocker === "capital_governor_blocked"
          ? "Capital governor houdt entries nu tegen. Laat paper vooral leren via probe/shadow tot de recovery verbetert."
          : blockerReasons[0] ? titleize(blockerReasons[0]).replace(/_/g, " ") : null);
    const autoRecovery = incomingAutoRecovery || (blockerReasons.some((item) => ["protection_pending", "protect_only"].includes(item))
      ? "Protective herstel of protect-only monitoring kan dit automatisch herstellen."
      : blockerReasons.includes("paper_calibration_probe")
        ? "Paper probe kan blijven leren tot calibration weer gezond is."
        : degradedSources.length
          ? `Datasources in herstel: ${degradedSources.join(", ")}.`
          : null);
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
      opportunityScore: num(decision.opportunityScore || 0, 4),
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
      strategyAllocation: summarizeStrategyAllocation(decision.strategyAllocation || decision.strategyAllocationSummary || {}),
      adaptivePolicy: decision.adaptivePolicy || decision.adaptiveContext?.adaptivePolicy || null,
      marketCondition: decision.marketCondition || decision.marketConditionSummary || null,
      missedTradeTuning: decision.missedTradeTuning || decision.missedTradeTuningApplied || null,
      exitPolicy: decision.exitPolicy || decision.adaptiveContext?.exitPolicy || null,
      adaptiveContext: decision.adaptiveContext || null,
      committee: summarizeCommittee(decision.committee || decision.committeeSummary || {}),
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
      lowConfidencePressure,
      paperLearning: decision.paperLearning ? {
        lane: decision.paperLearning.lane || null,
        learningValueScore: num(decision.paperLearning.learningValueScore || 0, 4),
        noveltyScore: num(decision.paperLearning.noveltyScore || 0, 4),
        scope: {
          family: decision.paperLearning.scope?.family || null,
          regime: decision.paperLearning.scope?.regime || null
        },
        allocatorGovernance: decision.paperLearning.allocatorGovernance || null,
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
      reasonLabel: tradeView.reasonLabel || tradeView.reason || null,
      reasonNote: tradeView.reasonNote || null,
      grossMovePnl: num(tradeView.grossMovePnl || 0, 2),
      totalFees: num(tradeView.totalFees || 0, 2),
      netAfterFees: num(tradeView.netAfterFees || 0, 2),
      executionDragEstimate: num(tradeView.executionDragEstimate || 0, 2),
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
    const pnl = buildTradePnlBreakdown(trade, this.config);
    const reasonView = summarizeTradeReasonView(trade, pnl);
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
      grossMovePnl: num(pnl.grossMovePnl || 0, 2),
      totalFees: num(pnl.totalFees || 0, 2),
      netAfterFees: num(pnl.netAfterFees || 0, 2),
      executionDragEstimate: num(pnl.executionDragEstimate || 0, 2),
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
      marketConditionAtEntry: trade.marketConditionAtEntry || trade.entryRationale?.marketCondition?.conditionId || null,
      allocatorPostureAtEntry: trade.allocatorPostureAtEntry || trade.entryRationale?.adaptivePolicy?.posture || trade.entryRationale?.strategyAllocation?.posture || null,
      opportunityScoreAtEntry: num(trade.opportunityScoreAtEntry ?? trade.entryRationale?.opportunityScore ?? 0, 4),
      strategyAtEntry: trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || null,
      strategyDecision: trade.strategyDecision || trade.entryRationale?.strategy || null,
      entrySpreadBps: num(trade.entrySpreadBps || 0, 2),
      exitSpreadBps: num(trade.exitSpreadBps || 0, 2),
      reason: trade.reason,
      reasonLabel: reasonView.reasonLabel,
      reasonNote: reasonView.reasonNote,
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
    const replayCheckpoints = arr(trade.replayCheckpoints || []).slice(-12).map((item) => ({
      at: item.at || null,
      price: num(item.price || 0, 6),
      label: item.label || null,
      note: item.note || null
    }));
    const bestAlternateExit = alternateExits
      .filter((item) => Number.isFinite(item.price))
      .sort((left, right) => Math.abs((right.price || 0) - (trade.entryPrice || 0)) - Math.abs((left.price || 0) - (trade.entryPrice || 0)))[0] || null;
    const actualMovePct = Number.isFinite(trade.netPnlPct) ? trade.netPnlPct : ((trade.entryPrice && trade.exitPrice) ? (trade.exitPrice / trade.entryPrice) - 1 : 0);
    const alternateMovePct = bestAlternateExit?.price && Number.isFinite(trade.entryPrice) && trade.entryPrice > 0
      ? (bestAlternateExit.price / trade.entryPrice) - 1
      : null;
    const review = buildTradeQualityReview(trade);
    const historyCoverage = buildTradeReplayHistoryCoverage(trade, this.runtime?.marketHistory || {});
    const decisionInputs = [
      {
        label: "Gate",
        detail: `p ${num(rationale.probability || trade.probabilityAtEntry || 0, 3)} vs gate ${num(rationale.threshold || 0, 3)}`
      },
      {
        label: "Confidence",
        detail: `${num((rationale.confidence || rationale.confidenceBreakdown?.overallConfidence || 0) * 100, 1)}% overall`
      },
      {
        label: "Markt",
        detail: titleize(rationale.marketState?.phase || rationale.regimeSummary?.regime || trade.regimeAtEntry || "unknown")
      },
      {
        label: "Execution",
        detail: titleize(trade.entryExecutionAttribution?.entryStyle || rationale.executionStyle || "unknown")
      }
    ];
    const outcomeCompare = [
      {
        label: "Verwacht vs echt",
        baseline: `${num(((rationale.probability || trade.probabilityAtEntry || 0) - (rationale.threshold || 0)) * 100, 1)}% gate-edge`,
        challenger: `${num(actualMovePct * 100, 1)}% realized`,
        delta: num((((actualMovePct || 0) - ((rationale.probability || trade.probabilityAtEntry || 0) - (rationale.threshold || 0))) * 100), 1)
      },
      {
        label: "Execution vs outcome",
        baseline: `entry ${num(trade.entryExecutionAttribution?.realizedTouchSlippageBps || 0, 2)} bps`,
        challenger: `${titleize(review.verdict || "observe")} | score ${num((review.compositeScore || 0) * 100, 1)}%`,
        delta: num(((review.executionScore || 0) - (review.outcomeScore || 0)) * 100, 1)
      },
      bestAlternateExit
        ? {
            label: "Actual vs alternative",
            baseline: `actual ${num(actualMovePct * 100, 1)}%`,
            challenger: `${titleize(bestAlternateExit.label || bestAlternateExit.source || "alternative")} ${num((alternateMovePct || 0) * 100, 1)}%`,
            delta: num((((alternateMovePct || 0) - (actualMovePct || 0)) * 100), 1)
          }
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
      decisionInputs,
      blockersAtEntry: arr(rationale.blockerReasons || []).slice(0, 5),
      vetoChain: arr(rationale.blockerReasons || []).slice(0, 5),
      headlines,
      candleContext: arr(rationale.candleContext || []).slice(0, 24),
      historyCoverage,
      pnlAttribution: {
        executionStyle: trade.entryExecutionAttribution?.entryStyle || null,
        provider: trade.entryRationale?.providerBreakdown?.[0]?.name || null,
        captureEfficiency: num(trade.captureEfficiency || 0, 4)
      },
      review,
      reviewScores: {
        setup: num(review.setupScore || 0, 4),
        execution: num(review.executionScore || 0, 4),
        outcome: num(review.outcomeScore || 0, 4),
        composite: num(review.compositeScore || 0, 4),
        verdict: review.verdict || null
      },
      gateSnapshot: {
        probability: num(rationale.probability || trade.probabilityAtEntry || 0, 4),
        threshold: num(rationale.threshold || 0, 4),
        edgeToThreshold: num((rationale.probability || trade.probabilityAtEntry || 0) - (rationale.threshold || 0), 4),
        confidence: num(rationale.confidence || rationale.confidenceBreakdown?.overallConfidence || 0, 4),
        committeeAgreement: num(committee.agreement || 0, 4),
        committeeNetScore: num(committee.netScore || 0, 4)
      },
      executionSnapshot: {
        entryStyle: trade.entryExecutionAttribution?.entryStyle || rationale.executionStyle || null,
        exitStyle: trade.exitExecutionAttribution?.entryStyle || null,
        entrySlippageBps: num(trade.entryExecutionAttribution?.realizedTouchSlippageBps || 0, 2),
        exitSlippageBps: num(trade.exitExecutionAttribution?.realizedTouchSlippageBps || 0, 2),
        scaleOutCount: scaleOuts.length
      },
      alternateExits,
      replayCheckpoints,
      outcomeCompare,
      timeline: [
        { at: trade.entryAt, type: "analysis", label: "Gate", detail: gateDetail },
        { at: trade.entryAt, type: "entry", label: "Entry", detail: rationale.summary || `${trade.symbol} entry` },
        { at: trade.entryAt, type: "committee", label: "Committee", detail: `agree ${num(committee.agreement || 0, 3)} | net ${num(committee.netScore || 0, 3)} | vetoes ${(committee.vetoes || []).length}` },
        ...(rationale.sequence ? [{ at: trade.entryAt, type: "sequence", label: "Sequence", detail: `p ${num(rationale.sequence.probability || 0, 3)} | c ${num(rationale.sequence.confidence || 0, 3)}` }] : []),
        ...(rationale.expertMix ? [{ at: trade.entryAt, type: "experts", label: "Experts", detail: `${rationale.expertMix.dominantRegime || "range"} | ${((rationale.expertMix.confidence || 0) * 100).toFixed(0)}%` }] : []),
        ...(headlines.length ? [{ at: trade.entryAt, type: "news", label: "Nieuws", detail: headlines.join(" | ") }] : []),
        ...(arr(rationale.checks || []).slice(0, 3).map((check) => ({ at: trade.entryAt, type: "check", label: check.label || "Check", detail: `${check.passed ? "pass" : "fail"} | ${check.detail || ""}`.trim() }))),
        ...replayCheckpoints.map((item) => ({
          at: item.at,
          type: "checkpoint",
          label: item.label || "Checkpoint",
          detail: `${num(item.price || 0, 6)}${item.note ? ` | ${item.note}` : ""}`
        })),
        ...scaleOuts.map((event) => ({ at: event.at, type: "scale_out", label: "Scale-out", detail: `${event.reason || "partial_exit"} | ${num((event.fraction || 0) * 100, 1)}% | ${num(event.realizedPnl || 0, 2)} USD` })),
        ...(trade.exitIntelligenceSummary ? [{ at: trade.exitAt, type: "exit_ai", label: "Exit AI", detail: `${trade.exitIntelligenceSummary.action || "hold"} | ${(trade.exitIntelligenceSummary.riskReasons || []).slice(0, 3).join(", ")}` }] : []),
        { at: trade.exitAt, type: "exit", label: "Exit", detail: `${trade.reason || "exit"} | ${num(trade.pnlQuote || 0, 2)} USD` }
      ]
    };
  }

  buildDecisionExplanationView(decision = {}) {
    const blockerChain = arr(decision.blockerReasons || []).slice(0, 5);
    const explainSteps = [
      {
        label: "Setup",
        detail: decision.summary || decision.setupStyle || `${decision.symbol || "Setup"} wordt gevalueerd.`
      },
      {
        label: decision.allow ? "Waarom nu" : "Waarom niet",
        detail: decision.allow
          ? decision.operatorAction || decision.reasons?.[0] || "De setup haalde de huidige gating."
          : decision.operatorAction || blockerChain[0] || "De setup haalde de gating niet."
      },
      {
        label: "Data & kwaliteit",
        detail: `${titleize(decision.dataQuality?.status || "unknown")} | quorum ${num((decision.qualityQuorum?.quorumScore || 0) * 100, 1)}% | confidence ${num((decision.confidenceBreakdown?.overallConfidence || 0) * 100, 1)}%`
      },
      {
        label: "Volgende actie",
        detail: decision.autoRecovery || decision.operatorAction || "Geen directe operatoractie nodig."
      }
    ];
    return {
      symbol: decision.symbol || null,
      status: decision.allow ? "tradeable" : "blocked",
      headline: decision.allow
        ? `${decision.symbol || "Setup"} is tradebaar binnen ${titleize(decision.marketState?.phase || decision.regime || "huidige regime")}.`
        : `${decision.symbol || "Setup"} werd geblokkeerd door ${titleize(blockerChain[0] || "onduidelijke gating")}.`,
      setup: decision.setupStyle || decision.strategy?.strategyLabel || decision.strategy?.familyLabel || null,
      blockerChain,
      operatorAction: decision.operatorAction || null,
      autoRecovery: decision.autoRecovery || null,
      qualityStatus: decision.dataQuality?.status || null,
      quorumStatus: decision.qualityQuorum?.status || null,
      confidence: num(decision.confidenceBreakdown?.overallConfidence || 0, 4),
      explainSteps,
      inputs: [
        {
          label: "Model",
          detail: `p ${num(decision.probability || 0, 3)} vs gate ${num(decision.threshold || 0, 3)}`
        },
        {
          label: "Kwaliteit",
          detail: `${titleize(decision.dataQuality?.status || "unknown")} | signal ${num((decision.signalQuality?.overallScore || 0) * 100, 1)}%`
        },
        {
          label: "Regime",
          detail: titleize(decision.marketState?.phase || decision.regime || decision.trendState?.phase || "unknown")
        },
        {
          label: "Execution",
          detail: titleize(decision.executionStyle || decision.executionBudget?.status || "unknown")
        }
      ],
      guardrails: [
        ...arr(decision.blockerReasons || []).slice(0, 3),
        ...arr(decision.qualityQuorum?.blockerReasons || []).slice(0, 2)
      ].slice(0, 4)
    };
  }

  buildTradeReplayDigest(replay = {}) {
    const stages = arr(replay.timeline || []).slice(0, 6).map((item) => ({
      at: item.at || null,
      type: item.type || null,
      label: item.label || null,
      detail: item.detail || null
    }));
    return {
      id: replay.id || null,
      symbol: replay.symbol || null,
      strategy: replay.strategy || null,
      regime: replay.regime || null,
      pnlQuote: num(replay.pnlQuote || 0, 2),
      netPnlPct: num(replay.netPnlPct || 0, 4),
      whyOpened: replay.whyOpened || null,
      whyClosed: replay.whyClosed || null,
      decisionInputs: arr(replay.decisionInputs || []).slice(0, 4),
      blockersAtEntry: arr(replay.blockersAtEntry || []).slice(0, 4),
      reviewScores: replay.reviewScores || null,
      gateSnapshot: replay.gateSnapshot || null,
      executionSnapshot: replay.executionSnapshot || null,
      outcomeCompare: arr(replay.outcomeCompare || []).slice(0, 3),
      alternateExits: arr(replay.alternateExits || []).slice(0, 3),
      keyStages: stages,
      fullTimeline: arr(replay.timeline || []).slice(0, 10),
      historyCoverage: replay.historyCoverage || null,
      keyTakeaway: replay.review?.summary || replay.whyClosed || replay.whyOpened || "Replay beschikbaar."
    };
  }

  buildOperatorDiagnosticsSnapshot({
    topDecisions = [],
    blockedSetups = [],
    tradeReplays = [],
    readiness = {},
    alerts = {},
    sourceReliability = {},
    qualityQuorum = {},
    safety = {},
    paperLearning = {},
    adaptation = {},
    diagnosticsActions = {},
    dashboardFeedHealth = {},
    learningInsights = {}
  } = {}) {
    const openAlerts = arr(alerts.alerts || []).filter((item) => !item.resolvedAt);
    const unackedAlerts = openAlerts.filter((item) => !item.acknowledgedAt);
    const blockerCounts = new Map();
    const noteBlocker = (value) => {
      if (!value) {
        return;
      }
      blockerCounts.set(value, (blockerCounts.get(value) || 0) + 1);
    };
    arr(readiness.reasons || []).forEach(noteBlocker);
    blockedSetups.forEach((decision) => arr(decision.blockerReasons || []).forEach(noteBlocker));
    openAlerts.forEach((alert) => noteBlocker(alert.id || alert.type || alert.severity));
    arr(dashboardFeedHealth.degradedFeeds || []).forEach((item) => noteBlocker(item.id));
    const dominantBlockers = [...blockerCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([id, count]) => ({
        id,
        count,
        category: /local_book|provider|calendar|reference|feed|quorum/.test(id) ? "infra"
          : /capital|committee|model|policy|retire|promot/.test(id) ? "governance"
            : /reconcile|exchange|protect|manual_review|alert/.test(id) ? "safety"
              : /execution|spread|slippage/.test(id) ? "execution"
                : "market"
      }));
    const actionItems = [
      readiness.reasons?.[0]
        ? {
            title: "Readiness",
            detail: titleize(readiness.reasons[0]),
            tone: resolveStatusTone(readiness.status || "unknown")
          }
        : null,
      dashboardFeedHealth.degradedFeeds?.[0]
        ? {
            title: "Dashboard feed",
            detail: `${titleize(dashboardFeedHealth.degradedFeeds[0].id)} | ${titleize(dashboardFeedHealth.degradedFeeds[0].status)}${dashboardFeedHealth.degradedFeeds[0].lastError ? ` | ${dashboardFeedHealth.degradedFeeds[0].lastError}` : ""}`,
            tone: dashboardFeedHealth.degradedFeeds[0].status === "failed" ? "negative" : "neutral"
          }
        : null,
      dominantBlockers[0]
        ? {
            title: "Dominante rem",
            detail: `${titleize(dominantBlockers[0].id)} | ${dominantBlockers[0].count}x`,
            tone: dominantBlockers[0].category === "infra" || dominantBlockers[0].category === "safety" ? "negative" : "neutral"
          }
        : null,
      (sourceReliability.externalFeeds?.coolingDownCount || 0) > 0
        ? {
            title: "External feeds",
            detail: `${sourceReliability.externalFeeds.coolingDownCount} cooldown actief`,
            tone: "negative"
          }
        : null,
      (qualityQuorum.observeOnly || qualityQuorum.status === "observe_only")
        ? {
            title: "Quality quorum",
            detail: `Observe only door ${titleize((qualityQuorum.blockerReasons || [])[0] || "kwaliteit")}`,
            tone: "negative"
          }
        : null,
      safety.orderLifecycle?.pendingActions?.[0]
        ? {
            title: "Lifecycle",
            detail: `${titleize(safety.orderLifecycle.pendingActions[0].state || "pending")} | ${safety.orderLifecycle.pendingActions[0].symbol || "actie open"}`,
            tone: "negative"
          }
        : null,
      paperLearning.promotionRoadmap?.note
        ? {
            title: "Promotion",
            detail: paperLearning.promotionRoadmap.note,
            tone: paperLearning.promotionRoadmap.allowPromotion ? "positive" : "neutral"
          }
        : null,
      adaptation.status && !["active", "warmup"].includes(adaptation.status)
        ? {
            title: "Adaptation",
            detail: `${titleize(adaptation.status)} | ${adaptation.lastLearningTradeAt ? `laatste leertrade ${adaptation.lastLearningTradeAt}` : "nog geen leertrades"}`,
            tone: adaptation.status === "stalled" ? "negative" : "neutral"
          }
        : null,
      learningInsights.missedTrades?.status === "priority"
        ? {
            title: "Missed-trade learning",
            detail: learningInsights.missedTrades.note || "Counterfactual learning ziet nu een te strenge blocker.",
            tone: "negative"
          }
        : null,
      ["priority", "watch"].includes(learningInsights.confidence?.status)
        ? {
            title: "Confidence bottleneck",
            detail: learningInsights.confidence.note || "High-quality near misses vallen nu te vaak onder de confidence-threshold.",
            tone: learningInsights.confidence.status === "priority" ? "negative" : "neutral"
          }
        : null,
      ["urgent", "watch"].includes(learningInsights.exits?.status)
        ? {
            title: "Exit AI",
            detail: learningInsights.exits.note || "Exit intelligence vraagt nu extra aandacht.",
            tone: learningInsights.exits.status === "urgent" ? "negative" : "neutral"
          }
        : null,
      ["urgent", "watch"].includes(learningInsights.history?.status)
        ? {
            title: "History dekking",
            detail: learningInsights.history.note || "Replay- of governance-dekking mist nog history truth.",
            tone: learningInsights.history.status === "urgent" ? "negative" : "neutral"
          }
        : null
    ].filter(Boolean).slice(0, 6);
    const tradeableCount = topDecisions.filter((item) => item.allow).length;
    const topExternalFeed = arr(sourceReliability.externalFeeds?.providers || []).find((item) => item.coolingDown || item.score < 0.5) || null;
    const focusSymbol = blockedSetups[0]?.symbol || topDecisions[0]?.symbol || null;
    const quickActions = [
      unackedAlerts[0]
        ? {
            action: "ack_alert",
            target: unackedAlerts[0].id || null,
            label: `Ack ${titleize(unackedAlerts[0].id || "alert")}`,
            detail: unackedAlerts[0].title || unackedAlerts[0].summary || "Open operator alert bevestigen.",
            tone: "negative"
          }
        : null,
      safety.orderLifecycle?.pendingActions?.[0]
        ? {
            action: "force_reconcile",
            target: safety.orderLifecycle.pendingActions[0].symbol || null,
            label: `Force reconcile${safety.orderLifecycle.pendingActions[0].symbol ? ` ${safety.orderLifecycle.pendingActions[0].symbol}` : ""}`,
            detail: "Zet exchange truth op freeze en dwing handmatige lifecycle-reconcile af.",
            tone: "negative"
          }
        : null,
      topExternalFeed?.group
        ? {
            action: "reset_external_feeds",
            target: topExternalFeed.group,
            label: `Reset ${titleize(topExternalFeed.group)} feeds`,
            detail: `${titleize(topExternalFeed.provider || topExternalFeed.group)} zit op cooldown of degraded.`,
            tone: "neutral"
          }
        : null,
      focusSymbol
        ? {
            action: "research_focus_symbol",
            target: focusSymbol,
            label: `Research ${focusSymbol}`,
            detail: "Draai direct context/research voor het symbool dat nu de meeste aandacht vraagt.",
            tone: "neutral"
          }
        : null,
      (!tradeableCount || (qualityQuorum.observeOnly || qualityQuorum.status === "observe_only"))
        ? {
            action: "enable_probe_only",
            target: focusSymbol,
            label: "Enable probe-only",
            detail: "Open tijdelijk alleen kleine leertrades om gecontroleerd data op te bouwen.",
            tone: "neutral"
          }
        : null,
      readiness.status && readiness.status !== "ready"
        ? {
            action: "refresh_analysis",
            target: null,
            label: "Refresh analysis",
            detail: "Herbouw direct de analyse- en governance-snapshot.",
            tone: "neutral"
          }
        : null
    ].filter(Boolean).slice(0, 6);
    const recentActions = arr(diagnosticsActions.history || []).slice(0, 6).map((item) => ({
      at: item.at || null,
      action: item.action || null,
      target: item.target || null,
      note: item.note || null,
      status: item.status || null,
      detail: item.detail || null
    }));
    return {
      status: readiness.status || "unknown",
      headline: tradeableCount
        ? `${tradeableCount} tradebare setup(s), ${blockedSetups.length} geblokkeerd en ${openAlerts.length} open alert(s).`
        : `${blockedSetups.length} geblokkeerde setup(s) en ${openAlerts.length} open alert(s) sturen nu de bot.`,
      dominantBlockers,
      actionItems,
      counts: {
        tradeable: tradeableCount,
        blocked: blockedSetups.length,
        alerts: openAlerts.length,
        replays: tradeReplays.length
      },
      nextOperatorFocus: actionItems[0]?.detail || paperLearning.coaching?.nextReview || "Geen directe operatorfocus.",
      quickActions,
      recentActions
    };
  }

  buildPromotionPipelineSnapshot({
    paperLearning = {},
    modelRegistry = {},
    researchRegistry = {},
    promotionState = {},
    offlineTrainer = {},
    tradingFlowHealth = {},
    executionSummary = {}
  } = {}) {
    const roadmap = paperLearning.promotionRoadmap || {};
    const probation = paperLearning.probation || {};
    const paperToLiveReadiness = paperLearning.paperToLiveReadiness || {};
    const reviewPacks = paperLearning.reviewPacks || {};
    const benchmarkLanes = paperLearning.benchmarkLanes || {};
    const executionInsights = paperLearning.executionInsights || {};
    const historyCoverage = offlineTrainer.historyCoverage || {};
    const transitions = [
      ...arr(paperLearning.policyTransitions?.candidates || []),
      ...arr(offlineTrainer.policyTransitionCandidatesByCondition || [])
    ].slice(0, 8);
    const guardrails = arr(paperLearning.operatorGuardrails?.blockedBy || []).slice(0, 4);
    const activeOverrides = arr(paperLearning.operatorActions?.activeOverrides || []).slice(0, 4);
    const researchCandidates = arr(researchRegistry.governance?.promotionCandidates || []).slice(0, 4);
    const activePromotions = arr(promotionState.active || []).slice(0, 4).map((item) => ({
      key: item.key || null,
      type: item.type || (item.symbol ? "symbol" : "scope"),
      symbol: item.symbol || null,
      scope: item.scope || null,
      id: item.id || null,
      stage: item.stage || "guarded_live_probation",
      status: item.status || "active",
      governanceScore: num(item.governanceScore || 0, 4),
      approvedAt: item.approvedAt || null,
      expiresAt: item.expiresAt || null,
      targetSampleCount: item.targetSampleCount || 0,
      weakLossLimit: item.weakLossLimit || 0,
      completedTrades: item.completedTrades || 0,
      goodTrades: item.goodTrades || 0,
      weakTrades: item.weakTrades || 0,
      executionDragCount: item.executionDragCount || 0,
      qualityTrapCount: item.qualityTrapCount || 0,
      weakSetupCount: item.weakSetupCount || 0,
      followThroughFailedCount: item.followThroughFailedCount || 0,
      avgExecutionQuality: num(item.avgExecutionQuality || 0, 4),
      avgNetPnlPct: num(item.avgNetPnlPct || 0, 4),
      avgReviewComposite: num(item.avgReviewComposite || 0, 4),
      dominantWeakness: item.dominantWeakness || null,
      verdict: item.verdict || "hold",
      rollbackRecommended: Boolean(item.rollbackRecommended),
      expired: Boolean(item.expired),
      note: item.note || null
    }));
    const promotionHistory = arr(promotionState.history || []).slice(0, 8).map((item) => ({
      at: item.at || null,
      action: item.action || null,
      symbol: item.symbol || null,
      stage: item.stage || null,
      status: item.status || null,
      verdict: item.verdict || null,
      governanceScore: num(item.governanceScore || 0, 4),
      note: item.note || null
    }));
    return {
      status: activePromotions.length
        ? "guarded_live_active"
        : roadmap.status || modelRegistry.promotionPolicy?.readyLevel || "observe",
      allowPromotion: Boolean(roadmap.allowPromotion || modelRegistry.promotionPolicy?.allowPromotion),
      readyLevel: activePromotions.length
        ? "guarded_live_probation"
        : roadmap.readyLevel || modelRegistry.promotionPolicy?.readyLevel || null,
      nextGate: activePromotions.length
        ? "collect_guarded_live_outcomes"
        : roadmap.nextGate || null,
      blockerReasons: arr(roadmap.blockerReasons || modelRegistry.promotionPolicy?.blockerReasons || []).slice(0, 4),
      note: activePromotions.length
        ? `${activePromotions.length} guarded-live probation override(s) actief.`
        : roadmap.note || "Nog geen duidelijke promotieroute.",
      candidateTransitions: transitions,
      guardedLiveCandidates: researchCandidates.map((item) => ({
        symbol: item.symbol || null,
        governanceScore: num(item.governanceScore || 0, 4),
        status: item.status || "observe",
        approved: activePromotions.some((promotion) => promotion.symbol === item.symbol)
      })),
      rolloutCandidates: transitions
        .filter((item) => item.scope || item.id)
        .map((item) => {
          const rawAction = item.action || "observe";
          const guardedLiveBlockers = [];
          if (["guarded_live_candidate", "live_ready"].includes(rawAction)) {
            const confidenceFloor = rawAction === "live_ready" ? 0.84 : 0.72;
            if ((item.confidence || 0) < confidenceFloor) {
              guardedLiveBlockers.push("condition_confidence_not_ready");
            }
            const readinessFloor = rawAction === "live_ready" ? 0.82 : 0.68;
            if ((paperToLiveReadiness.score || 0) < readinessFloor) {
              guardedLiveBlockers.push("paper_readiness_not_ready");
            }
            if (paperToLiveReadiness.blocker) {
              guardedLiveBlockers.push("paper_scope_blocker_active");
            }
            if (probation.rollbackRisk) {
              guardedLiveBlockers.push("probation_rollback_risk");
            }
            if (!probation.promotionReady) {
              guardedLiveBlockers.push("probation_quality_not_ready");
            }
            if (probation.dominantWeakness === "execution_drag" || (executionInsights.executionDragCount || 0) >= 2) {
              guardedLiveBlockers.push("execution_drag_not_ready");
            }
            if (probation.dominantWeakness === "quality_trap" || (probation.qualityTrapCount || 0) > 0) {
              guardedLiveBlockers.push("quality_trap_not_ready");
            }
            if ((benchmarkLanes.bestLane || null) === "always_skip") {
              guardedLiveBlockers.push("benchmark_skip_bias_active");
            }
            if ((benchmarkLanes.bestLane || null) === "simple_exit") {
              guardedLiveBlockers.push("benchmark_execution_caution_active");
            }
            if ((executionSummary.avgExecutionQualityScore || 0) < 0.55) {
              guardedLiveBlockers.push("execution_quality_not_ready");
            }
            if ((executionSummary.avgSlippageDeltaBps || 0) > 2.2) {
              guardedLiveBlockers.push("execution_slippage_not_ready");
            }
            if ((tradingFlowHealth.counters?.executed || 0) > (tradingFlowHealth.counters?.persisted || 0)) {
              guardedLiveBlockers.push("persistence_truth_not_ready");
            }
            if (historyCoverage.status === "missing" || (historyCoverage.uncoveredSymbolCount || 0) > 0) {
              guardedLiveBlockers.push("history_coverage_not_ready");
            }
            if ((historyCoverage.gapSymbolCount || 0) > 0) {
              guardedLiveBlockers.push("history_gap_not_ready");
            }
            if (rawAction === "live_ready" && (historyCoverage.staleSymbolCount || 0) > 0) {
              guardedLiveBlockers.push("history_freshness_not_ready");
            }
          }
          const effectiveAction =
            guardedLiveBlockers.length && rawAction === "live_ready"
              ? "guarded_live_candidate"
              : guardedLiveBlockers.length && rawAction === "guarded_live_candidate"
                ? "paper_ready"
                : rawAction;
          return {
            id: item.id || null,
            scope: item.scope || item.id || null,
            type: item.type || "scope",
            rawAction,
            action: effectiveAction,
            conditionId: item.conditionId || null,
            confidence: num(item.confidence || 0, 4),
            reason: item.reason || null,
            blocker: item.blocker || null,
            approved: activePromotions.some((promotion) => promotion.scope === (item.scope || item.id)),
            guardedLiveReady: guardedLiveBlockers.length === 0,
            guardedLiveBlockers,
            note: guardedLiveBlockers.length
              ? `${titleize(item.id || item.scope || "scope")} wacht op ${humanizeReason(guardedLiveBlockers[0])}${reviewPacks.topProbationRisk ? `; review ${reviewPacks.topProbationRisk} eerst.` : ""}.`
              : item.reason || null
          };
        })
        .slice(0, 6),
      activePromotions,
      readinessScorecards: activePromotions.map((item) => ({
        key: item.key || item.symbol || item.scope || item.id,
        label: item.symbol || item.scope || item.id || null,
        verdict: item.verdict || "hold",
        completedTrades: item.completedTrades || 0,
        targetSampleCount: item.targetSampleCount || 0,
        goodTrades: item.goodTrades || 0,
        weakTrades: item.weakTrades || 0,
        executionDragCount: item.executionDragCount || 0,
        qualityTrapCount: item.qualityTrapCount || 0,
        weakSetupCount: item.weakSetupCount || 0,
        dominantWeakness: item.dominantWeakness || null,
        avgExecutionQuality: num(item.avgExecutionQuality || 0, 4),
        avgReviewComposite: num(item.avgReviewComposite || 0, 4),
        avgNetPnlPct: num(item.avgNetPnlPct || 0, 4),
        note: item.verdict === "go"
          ? "Probation haalde de sample-doelen en blijft kwalitatief stabiel."
          : item.verdict === "rollback"
            ? item.dominantWeakness
              ? `Probation raakte de rollback-grens door ${humanizeReason(item.dominantWeakness)}.`
              : "Probation raakte de rollback-grens door zwakke uitkomsten."
            : "Probation heeft nog operator-review of extra samples nodig."
      })),
      promotionHistory,
      activeOverrides,
      probationGuardrails: activePromotions.map((item) => ({
        key: item.key || item.symbol || item.scope || item.id,
        label: item.symbol || item.scope || item.id || null,
        status: item.status || "active",
        detail: item.rollbackRecommended
          ? item.dominantWeakness
            ? `${item.weakTrades}/${item.weakLossLimit} zwakke trades sinds approve; focus op ${humanizeReason(item.dominantWeakness)}.`
            : `${item.weakTrades}/${item.weakLossLimit} zwakke trades sinds approve.`
          : item.expired
            ? "Probation expired."
            : `${item.completedTrades}/${item.targetSampleCount} gesloten trades verzameld.`,
        expiresAt: item.expiresAt || null
      })),
      operatorGuardrails: {
        status: guardrails.length || probation.rollbackRisk ? "review_required" : "observe",
        blockedBy: [
          ...guardrails,
          ...(probation.rollbackRisk ? ["probation_rollback_risk"] : []),
          ...((probation.qualityTrapCount || 0) > 0 ? ["quality_trap_not_ready"] : []),
          ...((executionInsights.executionDragCount || 0) >= 2 ? ["execution_drag_not_ready"] : []),
          ...((benchmarkLanes.bestLane || null) === "always_skip" ? ["benchmark_skip_bias_active"] : []),
          ...((benchmarkLanes.bestLane || null) === "simple_exit" ? ["benchmark_execution_caution_active"] : [])
        ].filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 6),
        note: probation.rollbackRisk
          ? reviewPacks.topProbationRisk
            ? `Probation guardrails blijven actief; review ${reviewPacks.topProbationRisk} eerst voor promotie.`
            : "Probation guardrails blijven actief door zwakke paper-uitkomsten."
          : guardrails[0]
            ? `Promotion guardrails wachten nu vooral op ${humanizeReason(guardrails[0])}.`
            : "Nog geen extra promotion guardrails actief."
      },
      guardrails
    };
  }

  buildResearchView(summary = this.runtime.researchLab?.latestSummary || this.journal?.researchRuns?.at(-1) || null) {
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

  buildSourceReliabilitySnapshot() {
    return summarizeSourceReliability(this.news?.reliability?.buildSummary(this.runtime) || this.runtime.sourceReliability || {});
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
    const referenceNow = nowIso();
    await this.maybeRunExchangeTruthLoop();
    await this.safeRefreshMarketHistorySnapshot({ referenceNow, context: "doctor" });
    const balance = await this.broker.getBalance(this.runtime);
    const report = this.getPerformanceReport();
    const previewCandidates = await this.scanCandidatesReadOnly(balance);
    const checks = this.buildDoctorChecks({ report, balance, previewCandidates, now: new Date() });
    const marketHistorySummary = summarizeMarketHistory(this.runtime.marketHistory || {});
    const adaptationSummary = summarizeAdaptationHealth(this.runtime.adaptation || this.buildAdaptationHealthSnapshot(referenceNow));
    const previewTopCandidates = previewCandidates.slice(0, 3).map((candidate) => this.buildEntryRationale(candidate));
    const previewLead = previewTopCandidates[0] || {};
    const leadManagedPosition = this.runtime.openPositions[0] || null;
    const offlineTrainerSummary = summarizeOfflineTrainer(this.runtime.offlineTrainer || {});
    const marketConditionDigest = summarizeMarketCondition(
      previewLead.marketCondition ||
      leadManagedPosition?.latestMarketConditionSummary ||
      leadManagedPosition?.entryRationale?.marketCondition ||
      {}
    );
    const adaptivePolicyDigest = summarizeAdaptivePolicy({
      strategyAllocation: previewLead.strategyAllocation || this.model.getStrategyAllocationSummary?.() || {},
      paperLearning: summarizePaperLearning(this.runtime.ops?.paperLearning || this.runtime.paperLearning || {}),
      marketCondition: marketConditionDigest,
      policyTransitions: offlineTrainerSummary.policyTransitionCandidatesByCondition || []
    });
    const missedTradeTuningDigest = summarizeMissedTradeTuning(offlineTrainerSummary.missedTradeTuning || {});
    const exitPolicyDigest = summarizeExitPolicyDigest(leadManagedPosition?.latestExitPolicy || {});
    const opportunityRankingDigest = summarizeOpportunityRanking(previewTopCandidates);
    const promotionPipeline = this.buildPromotionPipelineSnapshot({
      paperLearning: summarizePaperLearning(this.runtime.ops?.paperLearning || this.runtime.paperLearning || {}),
      modelRegistry: summarizeModelRegistry(this.runtime.modelRegistry || {}),
      researchRegistry: summarizeResearchRegistry(this.runtime.researchRegistry || {}),
      promotionState: this.runtime.ops?.promotionState || {},
      offlineTrainer: offlineTrainerSummary,
      tradingFlowHealth: summarizeSignalFlow(this.runtime.signalFlow || {}).tradingFlowHealth || {},
      executionSummary: report.executionSummary || {}
    });
    const promotionByConditionDigest = summarizePromotionByConditionDigest({
      policyTransitions: offlineTrainerSummary.policyTransitionCandidatesByCondition || [],
      paperLearningTransitions: summarizePaperLearning(this.runtime.ops?.paperLearning || this.runtime.paperLearning || {}).policyTransitions?.candidates || [],
      rolloutCandidates: promotionPipeline.rolloutCandidates || []
    });
    const lowConfidenceAudit = summarizeLowConfidenceAudit(this.buildLowConfidenceAudit(previewCandidates));
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
      adaptation: adaptationSummary,
      drift: summarizeDrift(this.runtime.drift || {}),
      selfHeal: summarizeSelfHeal(this.runtime.selfHeal || {}),
      pairHealth: summarizePairHealth(this.runtime.pairHealth || {}),
      qualityQuorum: summarizeQualityQuorum(this.runtime.qualityQuorum || {}),
      divergence: summarizeDivergenceSummary(this.runtime.divergence || {}),
      offlineTrainer: offlineTrainerSummary,
      marketCondition: marketConditionDigest,
      adaptivePolicy: adaptivePolicyDigest,
      missedTradeTuning: missedTradeTuningDigest,
      exitPolicy: exitPolicyDigest,
      opportunityRanking: opportunityRankingDigest,
      promotionByCondition: promotionByConditionDigest,
      lowConfidenceAudit,
      promotionPipeline,
      marketHistory: marketHistorySummary,
      replayChaos: summarizeReplayChaos(this.runtime.replayChaos || {}),
      sourceReliability: this.buildSourceReliabilitySnapshot(),
      exchangeCapabilities: summarizeExchangeCapabilities(this.runtime.exchangeCapabilities || this.config.exchangeCapabilities || {}),
      session: summarizeSession(this.runtime.session || {}),
      marketSentiment: summarizeMarketSentiment(this.runtime.marketSentiment || EMPTY_MARKET_SENTIMENT),
      onChainLite: summarizeOnChainLite(this.runtime.onChainLite || EMPTY_ONCHAIN),
      volatility: summarizeVolatility(this.runtime.volatilityContext || EMPTY_VOLATILITY_CONTEXT),
      signalFlow: summarizeSignalFlow(this.runtime.signalFlow || {}),
      stableModelSnapshots: arr(this.modelBackups || []).slice(0, 3).map(summarizeModelBackup),
      dataRecorder: summarizeDataRecorder(this.dataRecorder.getSummary()),
      readiness: this.buildOperationalReadiness(),
      checks,
      report: this.buildPublicReportView(report),
      research: this.buildResearchView(),
      explainability: {
        replays: arr(report.recentTrades || []).slice(0, 3).map((trade) => this.buildTradeReplayDigest(this.buildTradeReplayView(trade))),
        replayChaos: summarizeReplayChaos(this.runtime.replayChaos || {})
      },
      universe: summarizeUniverseSelection(this.runtime.universe || {}),
      strategyAttribution: summarizeAttributionSnapshot(this.runtime.strategyAttribution || {}),
      researchRegistry: summarizeResearchRegistry(this.runtime.researchRegistry || {}),
      previewTopCandidates
    };
  }

  async getDashboardSnapshot() {
    const referenceNow = nowIso();
    await this.maybeRunExchangeTruthLoop();
    await this.safeRefreshMarketHistorySnapshot({ referenceNow, context: "dashboard_snapshot" });
    if (!Number.isFinite(this.runtime.lastKnownBalance) || !Number.isFinite(this.runtime.lastKnownEquity)) {
      await this.updatePortfolioSnapshot();
    }

    const fullPositions = this.runtime.openPositions.map((position) => this.buildPositionView(position));
    const positions = fullPositions.map((position) => this.buildDashboardPositionView(position));
    const totalUnrealizedPnl = fullPositions.reduce((total, position) => total + position.unrealizedPnl, 0);
    const report = this.getPerformanceReport();
    const fullTopDecisions = arr(this.runtime.latestDecisions).slice(0, this.config.dashboardDecisionLimit || 12);
    const fullBlockedSetups = arr(this.runtime.latestBlockedSetups).slice(0, this.config.dashboardDecisionLimit || 12);
    const topDecision = fullTopDecisions[0] || {};
    const leadPosition = fullPositions[0] || null;
    const exchangeOverview = topDecision.exchangeSummary || leadPosition?.entryRationale?.exchange || summarizeExchange(EMPTY_EXCHANGE);
    const marketStructureOverview = topDecision.marketStructure || leadPosition?.entryRationale?.marketStructure || summarizeMarketStructureSummary(EMPTY_MARKET_STRUCTURE);
    const marketSentimentOverview = topDecision.marketSentiment || leadPosition?.entryRationale?.marketSentiment || summarizeMarketSentiment(this.runtime.marketSentiment || EMPTY_MARKET_SENTIMENT);
    const volatilityOverview = topDecision.volatility || leadPosition?.entryRationale?.volatility || summarizeVolatility(this.runtime.volatilityContext || EMPTY_VOLATILITY_CONTEXT);
    const calendarOverview = topDecision.calendar || leadPosition?.entryRationale?.calendar || summarizeCalendarSummary(EMPTY_CALENDAR);
    const dashboardTopDecisions = fullTopDecisions.map((decision) => this.buildDashboardDecisionView(decision));
    const dashboardBlockedSetups = fullBlockedSetups.map((decision) => this.buildDashboardDecisionView(decision));
    const tradeReplays = report.recentTrades.slice(0, 6).map((trade) => this.buildTradeReplayView(trade));
    const sourceReliabilitySummary = this.buildSourceReliabilitySnapshot();
    const qualityQuorumSummary = summarizeQualityQuorum(this.runtime.qualityQuorum || {});
    const orderLifecycleSummary = summarizeOrderLifecycle(this.runtime.orderLifecycle || {});
    const exchangeTruthSummary = summarizeExchangeTruth(this.runtime.exchangeTruth || {});
    const paperLearningSummary = summarizePaperLearning(this.runtime.ops?.paperLearning || this.runtime.paperLearning || {});
    const adaptationSummary = summarizeAdaptationHealth(this.runtime.adaptation || this.buildAdaptationHealthSnapshot(referenceNow));
    const offlineTrainerSummary = summarizeOfflineTrainer(this.runtime.offlineTrainer || {});
    const serviceSummary = summarizeServiceState(this.runtime.service || {}, this.config, referenceNow);
    const readinessSummary = this.buildOperationalReadiness(referenceNow);
    const alertsSummary = summarizeOperatorAlerts(buildOperatorAlerts({
      runtime: this.runtime,
      report,
      readiness: readinessSummary,
      exchangeSafety: this.runtime.exchangeSafety || {},
      strategyRetirement: this.runtime.strategyRetirement || {},
      executionCost: this.runtime.executionCost || {},
      capitalGovernor: this.runtime.capitalGovernor || {},
      config: this.config,
      nowIso: referenceNow
    }));
    const marketHistorySummary = summarizeMarketHistory(this.runtime.marketHistory || {});
    const performanceChangeSummary = this.buildPerformanceChangeView(report);
    const runbooksSummary = this.buildOperatorRunbooks(report);
    const capitalPolicySummary = summarizeCapitalPolicy({
      capitalLadder: this.runtime.capitalLadder || {},
      capitalGovernor: {
        ...(this.runtime.capitalGovernor || {}),
        policyEngine: this.runtime?.capitalPolicy || {}
      }
    });
    const effectiveBudget = summarizeEffectiveBudget({
      equity: this.runtime.lastKnownEquity || 0,
      quoteFree: this.runtime.lastKnownBalance || 0,
      capitalPolicy: capitalPolicySummary
    });
    capitalPolicySummary.effectiveBudget = effectiveBudget;
    const sizingGuide = summarizeSizingGuide({
      config: this.config,
      effectiveBudget,
      mode: this.config.botMode
    });
    const signalFlowSummary = summarizeSignalFlow(this.runtime.signalFlow || {});
    const lowConfidenceAudit = summarizeLowConfidenceAudit(this.runtime.ops?.lowConfidenceAudit || {});
    const learningInsights = {
      missedTrades: summarizeMissedTradeLearning({
        ...paperLearningSummary,
        counterfactuals: offlineTrainerSummary.counterfactuals || {}
      }),
      history: summarizeHistoryCoverageDigest(offlineTrainerSummary.historyCoverage || {}),
      confidence: lowConfidenceAudit,
      exits: summarizeExitIntelligenceDigest({
        positions: fullPositions,
        recentTrades: arr(report.recentTrades || []).slice(0, 12),
        exitLearning: offlineTrainerSummary.exitLearning || {}
      })
    };
    const marketConditionDigest = summarizeMarketCondition(
      topDecision.marketCondition ||
      leadPosition?.latestMarketConditionSummary ||
      leadPosition?.entryRationale?.marketCondition ||
      {}
    );
    const adaptivePolicyDigest = summarizeAdaptivePolicy({
      strategyAllocation: topDecision.strategyAllocation || leadPosition?.entryRationale?.strategyAllocation || this.model.getStrategyAllocationSummary?.() || {},
      paperLearning: paperLearningSummary,
      marketCondition: marketConditionDigest,
      policyTransitions: [
        ...arr(paperLearningSummary.policyTransitions?.candidates || []),
        ...arr(offlineTrainerSummary.policyTransitionCandidatesByCondition || [])
      ]
    });
    const missedTradeTuningDigest = summarizeMissedTradeTuning(offlineTrainerSummary.missedTradeTuning || {});
    const exitPolicyDigest = summarizeExitPolicyDigest(leadPosition?.latestExitPolicy || {});
    const opportunityRankingDigest = summarizeOpportunityRanking(dashboardTopDecisions);
    const promotionPipeline = this.buildPromotionPipelineSnapshot({
      paperLearning: paperLearningSummary,
      modelRegistry: summarizeModelRegistry(this.runtime.modelRegistry || {}),
      researchRegistry: summarizeResearchRegistry(this.runtime.researchRegistry || {}),
      promotionState: this.runtime.ops?.promotionState || {},
      offlineTrainer: offlineTrainerSummary,
      tradingFlowHealth: signalFlowSummary.tradingFlowHealth || {},
      executionSummary: report.executionSummary || {}
    });
    const promotionByConditionDigest = summarizePromotionByConditionDigest({
      policyTransitions: offlineTrainerSummary.policyTransitionCandidatesByCondition || [],
      paperLearningTransitions: paperLearningSummary.policyTransitions?.candidates || [],
      rolloutCandidates: promotionPipeline.rolloutCandidates || []
    });
    const operatorDiagnostics = this.buildOperatorDiagnosticsSnapshot({
      topDecisions: dashboardTopDecisions,
      blockedSetups: dashboardBlockedSetups,
      tradeReplays,
      readiness: readinessSummary,
      alerts: alertsSummary,
      sourceReliability: sourceReliabilitySummary,
      qualityQuorum: qualityQuorumSummary,
      safety: {
        orderLifecycle: orderLifecycleSummary,
        exchangeTruth: exchangeTruthSummary
      },
      paperLearning: paperLearningSummary,
      adaptation: adaptationSummary,
      diagnosticsActions: this.runtime.ops?.diagnosticsActions || {},
      dashboardFeedHealth: serviceSummary.dashboardFeeds || {},
      learningInsights
    });
    const explainability = {
      decisions: [...dashboardTopDecisions, ...dashboardBlockedSetups]
        .slice(0, 4)
        .map((decision) => this.buildDecisionExplanationView(decision)),
      replays: tradeReplays.slice(0, 4).map((trade) => this.buildTradeReplayDigest(trade)),
      note: tradeReplays.length
        ? "Trade replays en decision explainers laten nu dezelfde beslisketen zien."
        : "Explainability volgt zodra er recente trades of beslissingen zijn."
    };
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
        effectiveBudget,
        sizingGuide,
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
        strategyAllocation: topDecision.strategyAllocation || leadPosition?.entryRationale?.strategyAllocation || summarizeStrategyAllocation(this.model.getStrategyAllocationSummary?.() || {}),
        parameterGovernor: summarizeParameterGovernor(this.runtime.parameterGovernor || {}),
        strategyRetirement: summarizeStrategyRetirement(this.runtime.strategyRetirement || {}),
        rlPolicy: this.rlPolicy.getSummary(),
        committee: topDecision.committee || leadPosition?.entryRationale?.committee || summarizeCommittee({}),
        strategy: topDecision.strategy || topDecision.strategySummary || leadPosition?.entryRationale?.strategy || summarizeStrategy({}),
        optimizer: this.runtime.aiTelemetry?.strategyOptimizer || summarizeOptimizer(this.strategyOptimizer.buildSnapshot({ journal: this.journal, nowIso: nowIso() })),
        modelRegistry: summarizeModelRegistry(this.runtime.modelRegistry || {}),
        adaptation: adaptationSummary
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
        runbooks: arr(runbooksSummary || []).slice(0, 8),
        performanceChange: performanceChangeSummary,
        readiness: readinessSummary,
        alerts: alertsSummary,
        replayChaos: summarizeReplayChaos(this.runtime.ops?.replayChaos || this.runtime.replayChaos || {}),
        shadowTrading: summarizeShadowTrading(this.runtime.shadowTrading || {}),
      service: serviceSummary,
      thresholdTuning: summarizeThresholdTuningState(this.runtime.thresholdTuning || {}),
      executionCalibration: summarizeExecutionCalibration(this.runtime.executionCalibration || {}),
        capitalLadder: summarizeCapitalLadder(this.runtime.capitalLadder || {}),
        capitalGovernor: summarizeCapitalGovernor(this.runtime.capitalGovernor || {}),
        capitalPolicy: capitalPolicySummary,
        sizingGuide,
        tuningGovernance: summarizeTuningGovernance({
          thresholdTuning: this.runtime.thresholdTuning || {},
          parameterGovernor: this.runtime.parameterGovernor || {},
          modelRegistry: this.runtime.modelRegistry || {},
          offlineTrainer: this.runtime.offlineTrainer || {}
        }),
        alertDelivery: summarizeAlertDelivery(this.runtime.ops?.alertDelivery || {}),
        paperLearning: paperLearningSummary,
        adaptation: adaptationSummary,
        marketCondition: marketConditionDigest,
        adaptivePolicy: adaptivePolicyDigest,
        missedTradeTuning: missedTradeTuningDigest,
        exitPolicy: exitPolicyDigest,
        opportunityRanking: opportunityRankingDigest,
        promotionByCondition: promotionByConditionDigest,
        lowConfidenceAudit,
        learningInsights,
        signalFlow: summarizeSignalFlow(this.runtime.signalFlow || {})
      },
      portfolio: this.buildPortfolioView(),
      exchange: exchangeOverview,
      marketStructure: marketStructureOverview,
      marketSentiment: marketSentimentOverview,
      volatility: volatilityOverview,
      onChainLite: summarizeOnChainLite(this.runtime.onChainLite || EMPTY_ONCHAIN),
      calendar: calendarOverview,
      sourceReliability: this.buildSourceReliabilitySnapshot(),
      pairHealth: summarizePairHealth(this.runtime.pairHealth || {}),
      qualityQuorum: summarizeQualityQuorum(this.runtime.qualityQuorum || {}),
      divergence: summarizeDivergenceSummary(this.runtime.divergence || {}),
      offlineTrainer: offlineTrainerSummary,
      marketHistory: marketHistorySummary,
      upcomingEvents: arr(topDecision.calendarEvents || leadPosition?.entryRationale?.calendarEvents || []).slice(0, 4),
      officialNotices: arr(topDecision.officialNotices || leadPosition?.entryRationale?.officialNotices || []).slice(0, 4),
      watchlist: this.runtime.watchlistSummary || null,
      positions,
      topDecisions: dashboardTopDecisions,
      blockedSetups: dashboardBlockedSetups,
      tradeReplays,
      operatorDiagnostics,
      explainability,
      promotionPipeline,
      universe: summarizeUniverseSelection(this.runtime.universe || {}),
      strategyAttribution: summarizeAttributionSnapshot(this.runtime.strategyAttribution || {}),
      research: this.buildResearchView(),
      strategyResearch: summarizeStrategyResearch(this.runtime.strategyResearch || {}),
      researchRegistry: summarizeResearchRegistry(this.runtime.researchRegistry || {}),
      dataRecorder: summarizeDataRecorder(this.dataRecorder.getSummary()),
      report: {
        openExposureReview: report.openExposureReview || {
          manualReviewCount: 0,
          reconcileRequiredCount: 0,
          protectionPendingCount: 0,
          unreconciledCount: 0,
          manualReviewExposure: 0,
          reconcileRequiredExposure: 0,
          protectionPendingExposure: 0,
          unreconciledExposure: 0,
          notes: []
        },
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
      lastAnalysisAt: dashboard.overview.lastAnalysisAt,
      quoteFree: dashboard.overview.quoteFree,
      equity: dashboard.overview.equity,
      readiness: dashboard.ops?.readiness || null,
      overview: dashboard.overview,
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
      research: dashboard.research,
      dataRecorder: dashboard.dataRecorder,
      marketHistory: dashboard.marketHistory,
      explainability: dashboard.explainability,
      promotionPipeline: dashboard.promotionPipeline,
      operatorDiagnostics: dashboard.operatorDiagnostics,
      calendar: dashboard.calendar,
      safety: dashboard.safety,
      signalFlow: dashboard.ops?.signalFlow || null,
      ops: dashboard.ops,
      report: dashboard.report,
      modelWeights: dashboard.modelWeights
    };
  }

  async getReport() {
    const referenceNow = nowIso();
    await this.maybeRunExchangeTruthLoop();
    await this.safeRefreshMarketHistorySnapshot({ referenceNow, context: "report" });
    if (!Number.isFinite(this.runtime.lastKnownBalance) || !Number.isFinite(this.runtime.lastKnownEquity)) {
      await this.updatePortfolioSnapshot();
    }
    return this.buildPublicReportView(this.getPerformanceReport());
  }
}

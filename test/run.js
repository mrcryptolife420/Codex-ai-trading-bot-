import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdaptiveTradingModel } from "../src/ai/adaptiveModel.js";
import { ParameterGovernor } from "../src/ai/parameterGovernor.js";
import { StrategyMetaSelector } from "../src/ai/strategyMetaSelector.js";
import { ExecutionEngine } from "../src/execution/executionEngine.js";
import { BinanceClient } from "../src/binance/client.js";
import { buildSymbolRules, resolveMarketBuyQuantity } from "../src/binance/symbolFilters.js";
import { scoreHeadline, summarizeNews } from "../src/news/sentiment.js";
import { parseProviderItems } from "../src/news/rssFeed.js";
import { normalizeCmsArticles } from "../src/events/binanceAnnouncementService.js";
import { summarizeMarketStructure } from "../src/market/marketStructureService.js";
import { summarizeMarketSentiment } from "../src/market/marketSentimentService.js";
import { ReferenceVenueService } from "../src/market/referenceVenueService.js";
import { summarizeVolatilityContext } from "../src/market/volatilityService.js";
import { LocalOrderBookEngine } from "../src/market/localOrderBook.js";
import { parseIcsEvents, summarizeCalendarEvents } from "../src/events/calendarService.js";
import { normalizeStrategyDsl } from "../src/research/strategyDsl.js";
import { PortfolioOptimizer } from "../src/risk/portfolioOptimizer.js";
import { RiskManager } from "../src/risk/riskManager.js";
import { loadConfig } from "../src/config/index.js";
import { validateConfig } from "../src/config/validate.js";
import { resolveExchangeCapabilities } from "../src/config/exchangeCapabilities.js";
import { HealthMonitor } from "../src/runtime/healthMonitor.js";
import { LiveBroker } from "../src/execution/liveBroker.js";
import { buildPerformanceReport } from "../src/runtime/reportBuilder.js";
import { computeMarketFeatures, computeOrderBookFeatures } from "../src/strategy/indicators.js";
import { evaluateStrategySet } from "../src/strategy/strategyRouter.js";
import { StrategyOptimizer } from "../src/ai/strategyOptimizer.js";
import { StrategyAttribution } from "../src/ai/strategyAttribution.js";
import { ExitIntelligence } from "../src/ai/exitIntelligence.js";
import { MetaDecisionGate } from "../src/ai/metaDecisionGate.js";
import { ResearchRegistry } from "../src/runtime/researchRegistry.js";
import { ModelRegistry } from "../src/runtime/modelRegistry.js";
import { UniverseSelector } from "../src/runtime/universeSelector.js";
import { buildDeepScanPlan, buildLightweightSnapshot } from "../src/runtime/scanPlanner.js";
import { resolveDynamicWatchlist } from "../src/runtime/watchlistResolver.js";
import { buildSessionSummary } from "../src/runtime/sessionManager.js";
import { DriftMonitor } from "../src/runtime/driftMonitor.js";
import { SelfHealManager } from "../src/runtime/selfHealManager.js";
import { buildWalkForwardWindows, runWalkForwardExperiment } from "../src/runtime/researchLab.js";
import { DataRecorder } from "../src/runtime/dataRecorder.js";
import { StateBackupManager } from "../src/runtime/stateBackupManager.js";
import { StateStore } from "../src/storage/stateStore.js";
import { PairHealthMonitor } from "../src/runtime/pairHealthMonitor.js";
import { DivergenceMonitor } from "../src/runtime/divergenceMonitor.js";
import { CapitalLadder } from "../src/runtime/capitalLadder.js";
import { OfflineTrainer } from "../src/runtime/offlineTrainer.js";
import { StrategyResearchMiner } from "../src/runtime/strategyResearchMiner.js";
import { buildTimeframeConsensus } from "../src/runtime/timeframeConsensus.js";
import { SourceReliabilityEngine } from "../src/news/sourceReliabilityEngine.js";
import { OnChainLiteService } from "../src/market/onChainLiteService.js";
import { buildExchangeSafetyAudit } from "../src/runtime/exchangeSafetyReconciler.js";
import { buildOperatorAlerts } from "../src/runtime/operatorAlertEngine.js";
import { buildOperatorAlertDispatchPlan, dispatchOperatorAlerts } from "../src/runtime/operatorAlertDispatcher.js";
import { buildStrategyRetirementSnapshot } from "../src/runtime/strategyRetirementEngine.js";
import { buildReplayChaosSummary } from "../src/runtime/replayChaosLab.js";
import { buildCapitalGovernor } from "../src/runtime/capitalGovernor.js";
import { TradingBot } from "../src/runtime/tradingBot.js";
import { BotManager } from "../src/runtime/botManager.js";
import { StreamCoordinator } from "../src/runtime/streamCoordinator.js";

async function runCheck(name, fn) {
  await fn();
  console.log(`ok - ${name}`);
}

function makeConfig(overrides = {}) {
  const config = {
    botMode: "paper",
    watchlist: ["BTCUSDT"],
    enableDynamicWatchlist: true,
    watchlistTopN: 100,
    watchlistFetchPerPage: 250,
    dynamicWatchlistMinSymbols: 40,
    watchlistExcludeStablecoins: true,
    watchlistExcludeLeveragedTokens: true,
    watchlistInclude: [],
    watchlistExclude: [],
    baseQuoteAsset: "USDT",
    startingCash: 10000,
    maxOpenPositions: 2,
    maxPositionFraction: 0.15,
    maxTotalExposureFraction: 0.5,
    riskPerTrade: 0.01,
    maxDailyDrawdown: 0.04,
    userRegion: "BE",
    exchangeCapabilitiesEnabled: [],
    exchangeCapabilitiesDisabled: [],
    modelThreshold: 0.55,
    minModelConfidence: 0.53,
    paperFeeBps: 10,
    paperSlippageBps: 6,
    stopLossPct: 0.02,
    takeProfitPct: 0.03,
    trailingStopPct: 0.01,
    maxSpreadBps: 25,
    maxRealizedVolPct: 0.07,
    maxHoldMinutes: 360,
    klineInterval: "15m",
    maxServerTimeDriftMs: 450,
    clockSyncSampleCount: 5,
    clockSyncMaxAgeMs: 300000,
    clockSyncMaxRttMs: 1200,
    maxKlineStalenessMultiplier: 2,
    healthMaxConsecutiveFailures: 2,
    dashboardPort: 3011,
    dashboardEquityPointLimit: 1440,
    dashboardCyclePointLimit: 720,
    dashboardDecisionLimit: 24,
    exchangeCapabilities: resolveExchangeCapabilities({ userRegion: "BE", exchangeCapabilitiesEnabled: [], exchangeCapabilitiesDisabled: [] }),
    announcementLookbackHours: 48,
    announcementCacheMinutes: 15,
    marketStructureCacheMinutes: 3,
    marketStructureLookbackPoints: 12,
    calendarLookbackDays: 30,
    calendarCacheMinutes: 30,
    newsMinSourceQuality: 0.68,
    newsMinReliabilityScore: 0.64,
    newsStrictWhitelist: true,
    enableRedditSentiment: true,
    redditSentimentSubreddits: ["CryptoCurrency", "CryptoMarkets", "Binance"],
    minCalibrationConfidence: 0.16,
    minRegimeConfidence: 0.4,
    abstainBand: 0.02,
    maxModelDisagreement: 0.28,
    calibrationBins: 10,
    calibrationMinObservations: 12,
    calibrationPriorStrength: 4,
    modelLearningRate: 0.06,
    modelL2: 0.0005,
    challengerLearningRate: 0.08,
    challengerL2: 0.00035,
    challengerWindowTrades: 40,
    challengerMinTrades: 12,
    challengerPromotionMargin: 0.01,
    enableStrategyRouter: true,
    strategyMinConfidence: 0.4,
    enableTransformerChallenger: true,
    transformerLookbackCandles: 24,
    transformerLearningRate: 0.03,
    transformerMinConfidence: 0.12,
    strategyMetaLearningRate: 0.022,
    strategyMetaL2: 0.00055,
    enableMultiAgentCommittee: true,
    committeeMinConfidence: 0.44,
    committeeMinAgreement: 0.32,
    enableRlExecution: true,
    enableSessionLogic: true,
    sessionLowLiquiditySpreadBps: 6,
    sessionLowLiquidityDepthUsd: 150000,
    sessionCautionMinutesToFunding: 45,
    sessionHardBlockMinutesToFunding: 8,
    sessionWeekendRiskMultiplier: 0.82,
    sessionOffHoursRiskMultiplier: 0.88,
    sessionFundingRiskMultiplier: 0.78,
    blockWeekendHighRiskStrategies: true,
    enableDriftMonitoring: true,
    driftMinFeatureStatCount: 20,
    driftFeatureScoreAlert: 1.35,
    driftFeatureScoreBlock: 1.85,
    driftLowReliabilityAlert: 0.6,
    driftCalibrationEceAlert: 0.18,
    driftCalibrationEceBlock: 0.28,
    driftExecutionSlipAlertBps: 4,
    driftExecutionSlipBlockBps: 8,
    driftPredictionConfidenceAlert: 0.12,
    driftMinCandidateCount: 3,
    selfHealEnabled: true,
    selfHealSwitchToPaper: true,
    selfHealResetRlOnTrigger: true,
    selfHealRestoreStableModel: true,
    selfHealCooldownMinutes: 180,
    selfHealMaxRecentLossStreak: 3,
    selfHealWarningLossStreak: 2,
    selfHealMaxRecentDrawdownPct: 0.03,
    selfHealWarningDrawdownPct: 0.018,
    selfHealPaperCalibrationProbeSizeMultiplier: 0.22,
    selfHealPaperCalibrationProbeThresholdPenalty: 0.03,
    lossStreakLookbackMinutes: 720,
    stableModelMaxSnapshots: 5,
    stableModelMinTrades: 6,
    stableModelMaxCalibrationEce: 0.14,
    stableModelMinWinRate: 0.45,
    streamTradeBufferSize: 120,
    makerMinSpreadBps: 4,
    aggressiveEntryThreshold: 0.72,
    baseMakerPatienceMs: 3500,
    maxMakerPatienceMs: 12000,
    targetAnnualizedVolatility: 0.35,
    maxLossStreak: 3,
    maxSymbolLossStreak: 2,
    minBookPressureForEntry: -0.28,
    paperExplorationEnabled: true,
    paperExplorationThresholdBuffer: 0.06,
    paperExplorationSizeMultiplier: 0.45,
    paperExplorationCooldownMinutes: 90,
    paperExplorationMinBookPressure: -0.28,
    paperRecoveryProbeEnabled: true,
    paperRecoveryProbeThresholdBuffer: 0.035,
    paperRecoveryProbeSizeMultiplier: 0.22,
    paperRecoveryProbeCooldownMinutes: 60,
    paperRecoveryProbeMinBookPressure: -0.28,
    paperRecoveryProbeAllowMinTradeOverride: true,
    exitOnSpreadShockBps: 20,
    minVolTargetFraction: 0.4,
    maxVolTargetFraction: 1.05,
    maxPairCorrelation: 0.82,
    maxClusterPositions: 1,
    maxSectorPositions: 2,
    enableUniverseSelector: true,
    universeMaxSymbols: 24,
    universeMinScore: 0.28,
    universeMinDepthConfidence: 0.16,
    universeMinDepthUsd: 30000,
    universeTargetVolPct: 0.018,
    enableExitIntelligence: true,
    exitIntelligenceMinConfidence: 0.52,
    exitIntelligenceTrimScore: 0.6,
    exitIntelligenceExitScore: 0.72,
    strategyAttributionMinTrades: 6,
    researchPromotionMinSharpe: 0.35,
    researchPromotionMinTrades: 6,
    researchPromotionMaxDrawdownPct: 0.12,
    enableExchangeProtection: true,
    enableEventDrivenData: false,
    enableLocalOrderBook: true,
    streamDepthLevels: 20,
    streamDepthSnapshotLimit: 200,
    maxDepthEventAgeMs: 15000,
    localBookBootstrapWaitMs: 50,
    localBookWarmupMs: 1500,
    enableSmartExecution: true,
    enablePeggedOrders: true,
    defaultPegOffsetLevels: 1,
    maxPeggedImpactBps: 3.5,
    enableStpTelemetryQuery: true,
    stpTelemetryLimit: 20,
    enableTrailingProtection: true,
    minTradeUsdt: 25,
    liveStopLimitBufferPct: 0.002,
    stpMode: "NONE",
    liveTradingAcknowledged: "",
    binanceApiKey: "",
    binanceApiSecret: "",
    binanceFuturesApiBaseUrl: "https://fapi.binance.com",
    reportLookbackTrades: 50,
    enableMetaDecisionGate: true,
    metaMinConfidence: 0.42,
    metaBlockScore: 0.44,
    metaCautionScore: 0.55,
    enableCanaryLiveMode: true,
    canaryLiveTradeCount: 5,
    canaryLiveSizeMultiplier: 0.35,
    capitalLadderSeedMultiplier: 0.18,
    capitalLadderScaledMultiplier: 0.55,
    capitalLadderFullMultiplier: 1,
    capitalLadderMinApprovedCandidates: 1,
    capitalGovernorWeeklyDrawdownPct: 0.08,
    capitalGovernorBadDayStreak: 3,
    capitalGovernorRecoveryTrades: 4,
    capitalGovernorRecoveryMinWinRate: 0.55,
    capitalGovernorMinSizeMultiplier: 0.25,
    dailyRiskBudgetFloor: 0.35,
    portfolioMaxCvarPct: 0.028,
    portfolioDrawdownBudgetPct: 0.05,
    portfolioRegimeKillSwitchLossStreak: 3,
    maxEntriesPerDay: 12,
    scaleOutTriggerPct: 0.014,
    scaleOutFraction: 0.4,
    scaleOutMinNotionalUsd: 35,
    scaleOutTrailOffsetPct: 0.003,
    researchCandleLimit: 900,
    researchTrainCandles: 240,
    researchTestCandles: 72,
    researchStepCandles: 72,
    researchMaxWindows: 6,
    researchMaxSymbols: 4,
    exchangeTruthFreezeMismatchCount: 2,
    exchangeTruthRecentFillLookbackMinutes: 30,
    positionFailureProtectOnlyCount: 2,
    positionFailureManualReviewCount: 4,
    shadowTradeDecisionLimit: 3,
    thresholdAutoApplyEnabled: true,
    thresholdAutoApplyMinConfidence: 0.58,
    thresholdProbationMinTrades: 6,
    thresholdProbationWindowDays: 7,
    thresholdProbationMaxAvgPnlDropPct: 0.01,
    thresholdProbationMaxWinRateDrop: 0.08,
    thresholdRelaxStep: 0.012,
    thresholdTightenStep: 0.01,
    thresholdTuningMaxRecommendations: 5,
    featureDecayMinTrades: 8,
    featureDecayWeakScore: 0.18,
    featureDecayBlockedScore: 0.1,
    executionCalibrationMinLiveTrades: 6,
    executionCalibrationLookbackTrades: 48,
    executionCalibrationMaxBpsAdjust: 6,
    parameterGovernorMinTrades: 4,
    parameterGovernorMaxThresholdShift: 0.03,
    parameterGovernorMaxStopLossMultiplierDelta: 0.14,
    parameterGovernorMaxTakeProfitMultiplierDelta: 0.18,
    referenceVenueFetchEnabled: false,
    referenceVenueQuoteUrls: [],
    referenceVenueMinQuotes: 2,
    referenceVenueMaxDivergenceBps: 18,
    strategyResearchFetchEnabled: false,
    strategyResearchFeedUrls: [],
    strategyResearchPaperScoreFloor: 0.64,
    strategyGenomeMaxChildren: 4,
    paperLatencyMs: 220,
    paperMakerFillFloor: 0.22,
    paperPartialFillMinRatio: 0.35,
    backtestLatencyMs: 260,
    backtestSyntheticDepthUsd: 140000,
    dataRecorderEnabled: true,
    dataRecorderRetentionDays: 21,
    modelRegistryMinScore: 0.56,
    modelRegistryRollbackDrawdownPct: 0.08,
    modelRegistryMaxEntries: 12,
    stateBackupEnabled: true,
    stateBackupIntervalMinutes: 30,
    stateBackupRetention: 6,
    serviceRestartDelaySeconds: 8,
    serviceRestartBackoffMultiplier: 1.8,
    serviceRestartMaxDelaySeconds: 180,
    serviceStatusFilename: "service-status.json",
    serviceMaxRestartsPerHour: 20,
    operatorAlertMaxItems: 8,
    operatorAlertWebhookUrls: [],
    operatorAlertDispatchMinSeverity: "high",
    operatorAlertDispatchCooldownMinutes: 30,
    operatorAlertSilenceMinutes: 180,
    gitShortClonePath: "C:\\code\\Codex-ai-trading-bot",
    ...overrides
  };
  config.exchangeCapabilities = resolveExchangeCapabilities(config);
  return config;
}

const exchangeInfo = {
  symbols: [
    {
      symbol: "BTCUSDT",
      status: "TRADING",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      defaultSelfTradePreventionMode: "NONE",
      allowedSelfTradePreventionModes: ["NONE", "EXPIRE_TAKER"],
      filters: [
        { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "1000000", tickSize: "0.01" },
        { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
        { filterType: "MARKET_LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
        { filterType: "MIN_NOTIONAL", minNotional: "10" }
      ]
    }
  ]
};
const rules = buildSymbolRules(exchangeInfo, "USDT").BTCUSDT;

await runCheck("adaptive model learns and calibrates from trade labels", async () => {
  const config = makeConfig();
  const model = new AdaptiveTradingModel(undefined, config);
  const features = { momentum_5: 1.2, news_sentiment: 0.6, regime_trend: 1 };
  const context = {
    regimeSummary: { regime: "trend", confidence: 0.8, bias: 0.3, reasons: ["persistent_trend"] },
    marketFeatures: { momentum5: 0.01, momentum20: 0.015, emaGap: 0.005, realizedVolPct: 0.02 },
    newsSummary: { sentimentScore: 0.2 },
    streamFeatures: { tradeFlowImbalance: 0.1, microTrend: 0.001 }
  };
  const before = model.score(features, context);
  for (let index = 0; index < 16; index += 1) {
    model.updateFromTrade({
      symbol: "BTCUSDT",
      rawFeatures: features,
      netPnlPct: 0.03,
      mfePct: 0.05,
      maePct: -0.01,
      executionQualityScore: 0.8,
      regimeAtEntry: "trend",
      exitAt: `2026-03-08T10:${String(index).padStart(2, "0")}:00.000Z`
    });
  }
  const after = model.score(features, context);
  assert.ok(model.getSymbolStats("BTCUSDT").trades >= 16);
  assert.ok(model.getCalibrationSummary().observations >= 16);
  assert.ok(after.calibrationConfidence >= before.calibrationConfidence);
});

await runCheck("adaptive model exposes transformer challenger outputs", async () => {
  const config = makeConfig();
  const model = new AdaptiveTradingModel(undefined, config);
  const candles = Array.from({ length: 30 }, (_, index) => ({
    open: 100 + index * 0.5,
    high: 100.6 + index * 0.5,
    low: 99.8 + index * 0.5,
    close: 100.4 + index * 0.5,
    volume: 10 + index
  }));
  const score = model.score(
    { momentum_20: 1.1, ema_gap: 0.7, breakout_pct: 0.4, book_pressure: 0.8, news_sentiment: 0.3 },
    {
      regimeSummary: { regime: "trend", confidence: 0.75, bias: 0.22, reasons: ["persistent_trend"] },
      marketFeatures: { momentum20: 0.02, emaGap: 0.01 },
      marketSnapshot: {
        candles,
        market: { momentum20: 0.02, emaGap: 0.01 },
        book: { bookPressure: 0.32 },
        stream: { tradeFlowImbalance: 0.14 }
      },
      newsSummary: { sentimentScore: 0.2, riskScore: 0.1 },
      streamFeatures: { tradeFlowImbalance: 0.14, microTrend: 0.001 }
    }
  );
  assert.ok(score.transformer);
  assert.equal(score.transformer.horizons.length, 3);
  assert.ok(score.transformer.confidence >= 0);
});

await runCheck("adaptive model exposes strategy meta guidance", async () => {
  const config = makeConfig();
  const model = new AdaptiveTradingModel(undefined, config);
  const score = model.score(
    { momentum_20: 1.05, ema_gap: 0.55, breakout_pct: 0.22, book_pressure: 0.34, news_sentiment: 0.12 },
    {
      regimeSummary: { regime: "trend", confidence: 0.76, bias: 0.2, reasons: ["persistent_trend"] },
      marketFeatures: { momentum20: 0.021, emaGap: 0.008, realizedVolPct: 0.018, breakoutPct: 0.004 },
      marketSnapshot: {
        market: { momentum20: 0.021, emaGap: 0.008, realizedVolPct: 0.018, trendStrength: 0.42, breakoutPct: 0.004, rsi14: 58, priceZScore: -0.18 },
        book: { bookPressure: 0.34, spreadBps: 4.2, depthConfidence: 0.76, queueImbalance: 0.18 }
      },
      newsSummary: { sentimentScore: 0.12, riskScore: 0.06 },
      streamFeatures: { tradeFlowImbalance: 0.16, microTrend: 0.0012 },
      strategySummary: { family: "trend_following", activeStrategy: "ema_trend", fitScore: 0.66, agreementGap: 0.04 },
      timeframeSummary: { alignmentScore: 0.58 },
      marketStructureSummary: { riskScore: 0.08 },
      pairHealthSummary: { score: 0.84 }
    }
  );
  assert.ok(score.strategyMeta);
  assert.equal(score.strategyMeta.families.length, 4);
  assert.equal(score.strategyMeta.executionStyles.length, 3);
  assert.equal(typeof score.strategyMeta.preferredFamily, "string");
});

await runCheck("strategy meta selector learns family and execution preferences", async () => {
  const selector = new StrategyMetaSelector(undefined, makeConfig());
  const context = {
    score: { probability: 0.61, confidence: 0.46 },
    marketSnapshot: {
      market: { realizedVolPct: 0.019, trendStrength: 0.48, breakoutPct: 0.004, rsi14: 57, priceZScore: -0.12 },
      book: { bookPressure: 0.28, spreadBps: 4.1, depthConfidence: 0.78, queueImbalance: 0.16 }
    },
    strategySummary: { family: "trend_following", activeStrategy: "ema_trend", fitScore: 0.68, agreementGap: 0.03 },
    timeframeSummary: { alignmentScore: 0.6 },
    regimeSummary: { regime: "trend", confidence: 0.78 },
    newsSummary: { riskScore: 0.05 },
    marketStructureSummary: { riskScore: 0.08 },
    pairHealthSummary: { score: 0.86 }
  };
  const before = selector.score(context);
  for (let index = 0; index < 14; index += 1) {
    selector.updateFromTrade({
      strategyDecision: { family: "trend_following" },
      regimeAtEntry: "trend",
      executionQualityScore: 0.84,
      entryExecutionAttribution: { entryStyle: "limit_maker" },
      entryRationale: {
        probability: 0.61,
        confidence: 0.46,
        indicators: { trendStrength: 0.48, rsi14: 57 },
        orderBook: { bookPressure: 0.28, spreadBps: 4.1, depthConfidence: 0.78, queueImbalance: 0.16 },
        strategy: { family: "trend_following", activeStrategy: "ema_trend" },
        timeframe: { alignmentScore: 0.6 },
        regimeSummary: { regime: "trend", confidence: 0.78 },
        newsRisk: 0.05,
        marketStructure: { riskScore: 0.08 },
        pairHealth: { score: 0.86 }
      },
      rawFeatures: { breakout_pct: 0.004, price_zscore: -0.12 },
      exitAt: `2026-03-08T10:${String(index).padStart(2, "0")}:00.000Z`
    }, { labelScore: 0.82 });
  }
  const after = selector.score(context);
  assert.equal(after.preferredFamily, "trend_following");
  assert.ok(["limit_maker", "pegged_limit_maker"].includes(after.preferredExecutionStyle));
  assert.ok(after.confidence > before.confidence);
});

await runCheck("strategy DSL blocks unsafe imports and keeps safe research candidates scorable", async () => {
  const unsafe = normalizeStrategyDsl({
    label: "Unsafe martingale",
    family: "trend_following",
    indicators: ["ema_gap", "book_pressure"],
    entryRules: [{ indicator: "ema_gap", operator: "gt", threshold: 0.001 }],
    riskProfile: { stopLossPct: 0.02, takeProfitPct: 0.03, allowMartingale: true },
    executionHints: { entryStyle: "market" },
    tags: ["martingale"]
  });
  assert.equal(unsafe.safety.safe, false);
  assert.ok(unsafe.safety.blockedReasons.includes("martingale"));

  const imported = normalizeStrategyDsl({
    id: "feed_trend_alpha",
    label: "Feed trend alpha",
    family: "trend_following",
    indicators: ["ema_gap", "breakout_pct", "adx14", "book_pressure"],
    entryRules: [
      { indicator: "ema_gap", operator: "gt", threshold: 0.0014 },
      { indicator: "breakout_pct", operator: "gt", threshold: 0.0016 }
    ],
    exitRules: [{ indicator: "book_pressure", operator: "lt", threshold: -0.34 }],
    riskProfile: { stopLossPct: 0.014, takeProfitPct: 0.028, trailingStopPct: 0.009, maxHoldMinutes: 240 },
    executionHints: { entryStyle: "limit_maker", preferMaker: true },
    referenceStrategies: ["ema_trend"],
    sourceType: "whitelisted_feed",
    source: "https://feed.example/alpha"
  });
  const miner = new StrategyResearchMiner(makeConfig({ strategyGenomeMaxChildren: 2, strategyResearchPaperScoreFloor: 0.6 }));
  const summary = miner.buildSummary({
    journal: {
      trades: [
        { strategyAtEntry: "ema_trend", netPnlPct: 0.018, pnlQuote: 16, mfePct: 0.026, maePct: -0.008, entryAt: "2026-03-07T10:00:00.000Z", exitAt: "2026-03-07T11:30:00.000Z" },
        { strategyAtEntry: "ema_trend", netPnlPct: 0.012, pnlQuote: 9, mfePct: 0.021, maePct: -0.006, entryAt: "2026-03-06T10:00:00.000Z", exitAt: "2026-03-06T11:10:00.000Z" }
      ]
    },
    researchRegistry: { strategyScorecards: [{ id: "ema_trend", governanceScore: 0.74 }] },
    offlineTrainer: { strategyScorecards: [{ id: "ema_trend", governanceScore: 0.72 }] },
    importedCandidates: [imported],
    nowIso: "2026-03-11T09:00:00.000Z"
  });
  assert.equal(summary.importedCandidates.length, 1);
  assert.ok(summary.candidates.some((item) => item.id === "feed_trend_alpha"));
  assert.ok(summary.genome.candidateCount > 0);
});

await runCheck("symbol filters enforce minimum notional", async () => {
  assert.equal(resolveMarketBuyQuantity(100, 50000, rules).valid, true);
  assert.equal(resolveMarketBuyQuantity(5, 50000, rules).valid, false);
});

await runCheck("news sentiment captures event categories and risk", async () => {
  const positive = scoreHeadline("Bitcoin ETF approval sparks bullish breakout and inflows");
  const negative = scoreHeadline("Major exploit and hack trigger delist fears");
  assert.ok(positive.score > 0);
  assert.ok(negative.score < 0);
  assert.ok(negative.riskScore > 0);

  const summary = summarizeNews(
    [
      {
        title: "Ethereum partnership boosts adoption and inflows",
        source: "Example",
        publishedAt: "2026-03-08T10:00:00.000Z",
        link: "https://example.com/1"
      },
      {
        title: "Exchange hack investigation hits altcoin sentiment",
        source: "Example",
        publishedAt: "2026-03-08T11:00:00.000Z",
        link: "https://example.com/2"
      }
    ],
    24,
    "2026-03-08T12:00:00.000Z"
  ,
    { filterLowQuality: false, strictWhitelist: false, minSourceQuality: 0, minReliabilityScore: 0 }
  );
  assert.ok(summary.confidence > 0);
  assert.ok(summary.coverage >= 2);
  assert.equal(typeof summary.dominantEventType, "string");
  assert.ok(summary.providerDiversity >= 1);
  assert.ok(summary.sourceDiversity >= 1);
  assert.ok(Array.isArray(summary.bullishDrivers));
  assert.ok(Array.isArray(summary.bearishDrivers));
});

await runCheck("news sentiment tracks social coverage separately", async () => {
  const summary = summarizeNews(
    [
      {
        title: "BTC to the moon says Reddit traders",
        source: "r/CryptoCurrency",
        provider: "reddit_search",
        channel: "social",
        engagementScore: 42,
        publishedAt: "2026-03-08T10:30:00.000Z",
        link: "https://reddit.example/1"
      },
      {
        title: "Bitcoin breakout confirmed by ETF inflows",
        source: "CoinDesk",
        provider: "coindesk",
        channel: "news",
        publishedAt: "2026-03-08T10:45:00.000Z",
        link: "https://example.com/etf"
      }
    ],
    24,
    "2026-03-08T12:00:00.000Z",
    { filterLowQuality: false, strictWhitelist: false, minSourceQuality: 0, minReliabilityScore: 0 }
  );
  assert.equal(summary.socialCoverage, 1);
  assert.ok(summary.socialSentiment >= 0);
  assert.ok(summary.channelCounts.social >= 1);
});

await runCheck("indicator layer computes orderbook pressure and candle patterns", async () => {
  const candles = [
    { open: 100, high: 101, low: 97, close: 98, volume: 10 },
    { open: 97.5, high: 103, low: 97, close: 102.5, volume: 18 },
    { open: 102.5, high: 104, low: 101.8, close: 103.7, volume: 17 },
    { open: 103.6, high: 105.2, low: 103.4, close: 105, volume: 21 },
    { open: 104.8, high: 106.4, low: 104.7, close: 106.1, volume: 24 },
    { open: 106, high: 107.2, low: 105.8, close: 107, volume: 25 },
    { open: 106.8, high: 107.6, low: 106.4, close: 107.4, volume: 19 },
    { open: 107.2, high: 108.1, low: 106.9, close: 107.9, volume: 18 },
    { open: 107.7, high: 108.5, low: 107.5, close: 108.2, volume: 17 },
    { open: 108, high: 109.2, low: 107.9, close: 109, volume: 22 },
    { open: 108.9, high: 109.8, low: 108.6, close: 109.5, volume: 21 },
    { open: 109.3, high: 110.1, low: 109.1, close: 109.9, volume: 20 },
    { open: 109.8, high: 110.7, low: 109.5, close: 110.4, volume: 19 },
    { open: 110.2, high: 111.3, low: 110, close: 111, volume: 23 },
    { open: 110.7, high: 112.1, low: 110.6, close: 111.9, volume: 27 },
    { open: 111.6, high: 112.8, low: 111.4, close: 112.3, volume: 26 },
    { open: 112.1, high: 113.1, low: 111.8, close: 112.7, volume: 24 },
    { open: 112.5, high: 113.8, low: 112.2, close: 113.4, volume: 29 },
    { open: 113.2, high: 114.4, low: 113, close: 114, volume: 28 },
    { open: 113.5, high: 115.5, low: 113.4, close: 115.2, volume: 35 }
  ];
  const market = computeMarketFeatures(candles);
  const book = computeOrderBookFeatures(
    { bidPrice: "115.18", askPrice: "115.22" },
    {
      bids: [["115.18", "8"], ["115.17", "6"], ["115.16", "5"]],
      asks: [["115.22", "3"], ["115.23", "2"], ["115.24", "1.5"]]
    }
  );
  assert.ok(market.bullishPatternScore >= 0);
  assert.ok(typeof market.dominantPattern === "string");
  assert.ok(book.bookPressure > 0);
  assert.ok(book.microPriceEdgeBps >= 0);
  assert.equal(typeof market.liquiditySweepLabel, "string");
  assert.equal(typeof market.structureBreakLabel, "string");
  assert.ok(Number.isFinite(market.priceZScore));
  assert.ok(Number.isFinite(market.adx14));
  assert.ok(Number.isFinite(market.stochRsiK));
  assert.ok(Number.isFinite(market.mfi14));
  assert.ok(Number.isFinite(market.cmf20));
  assert.ok(Number.isFinite(market.keltnerSqueezeScore));
  assert.ok(Number.isFinite(market.supertrendDistancePct));
});

await runCheck("rss parser tags providers and filters aliases", async () => {
  const recentRssDate = new Date(Date.now() - 60 * 60 * 1000).toUTCString();
  const xml = `
    <rss>
      <channel>
        <item>
          <title>Bitcoin ETF inflows rise</title>
          <link>https://example.com/btc</link>
          <pubDate>${recentRssDate}</pubDate>
          <description>Bitcoin momentum improves.</description>
        </item>
        <item>
          <title>Oil prices drift lower</title>
          <link>https://example.com/oil</link>
          <pubDate>${recentRssDate}</pubDate>
          <description>Macro update only.</description>
        </item>
      </channel>
    </rss>
  `;
  const items = parseProviderItems(
    xml,
    { provider: "coindesk", sourceFallback: "CoinDesk" },
    { aliases: ["BTC", "Bitcoin"], lookbackHours: 24, limit: 5 }
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].provider, "coindesk");
  assert.equal(items[0].source, "CoinDesk");
});

await runCheck("atom parser supports blockworks style feeds", async () => {
  const recentAtomDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const xml = `
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title><![CDATA[Bitcoin funding turns negative]]></title>
        <updated>${recentAtomDate}</updated>
        <link rel="alternate" href="https://example.com/funding" />
        <summary>BTC derivatives update</summary>
      </entry>
    </feed>
  `;
  const items = parseProviderItems(
    xml,
    { provider: "blockworks", sourceFallback: "Blockworks" },
    { aliases: ["BTC", "Bitcoin"], lookbackHours: 24, limit: 5 }
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].provider, "blockworks");
  assert.equal(items[0].source, "Blockworks");
});

await runCheck("binance cms articles normalize into official notice items", async () => {
  const articles = normalizeCmsArticles(
    {
      data: {
        catalogs: [
          {
            articles: [
              {
                id: 1,
                code: "abc123",
                title: "Binance Will Delist XYZUSDT",
                releaseDate: 1772791211666
              }
            ]
          }
        ]
      }
    },
    { catalogId: 161, label: "delistings", category: "delisting" }
  );
  assert.equal(articles.length, 1);
  assert.equal(articles[0].provider, "binance_support");
  assert.ok(articles[0].link.includes("abc123"));
});

await runCheck("binance cms generic notices are not treated as global trading alerts", async () => {
  const articles = normalizeCmsArticles(
    {
      data: {
        catalogs: [
          {
            articles: [
              {
                id: 2,
                code: "promo-1",
                title: "Binance Referral Campaign Starts Today",
                releaseDate: 1772791211666
              }
            ]
          }
        ]
      }
    },
    { catalogId: 49, label: "latest_binance_news", category: "announcement" }
  );
  assert.equal(articles.length, 1);
  assert.equal(articles[0].globalNotice, false);
});

await runCheck("market structure summary combines funding oi and liquidations", async () => {
  const summary = summarizeMarketStructure(
    {
      premium: { lastFundingRate: "0.0004", nextFundingTime: 1772985600000, time: 1772963647001 },
      openInterest: { openInterest: "83347.200" },
      openInterestHist: [
        { sumOpenInterest: "82000", sumOpenInterestValue: "5500000000", timestamp: 1772962500000 },
        { sumOpenInterest: "83347.2", sumOpenInterestValue: "5640000000", timestamp: 1772963400000 }
      ],
      takerLongShort: [
        { buySellRatio: "1.31", sellVol: "142.2", buyVol: "187.2", timestamp: 1772963100000 }
      ],
      basis: [
        { basisRate: "0.0006", basis: "40", timestamp: 1772963400000 }
      ]
    },
    {
      liquidationCount: 4,
      liquidationNotional: 350000,
      liquidationImbalance: -0.6
    }
  );
  assert.ok(summary.riskScore > 0);
  assert.ok(summary.reasons.length > 0);
  assert.equal(summary.liquidationCount, 4);
  assert.ok(summary.globalLongShortRatio >= 1);
  assert.ok(summary.leverageBuildupScore >= 0);
});

await runCheck("market structure summary tolerates non-array payloads", async () => {
  const summary = summarizeMarketStructure({
    premium: { lastFundingRate: "-0.0002" },
    openInterest: { openInterest: "12345" },
    openInterestHist: { message: "temporarily unavailable" },
    takerLongShort: null,
    basis: { error: "bad payload" },
    globalLongShort: undefined,
    topLongShortPosition: "n/a"
  });
  assert.equal(summary.openInterest, 12345);
  assert.equal(summary.openInterestChangePct, 0);
  assert.equal(summary.globalLongShortRatio, 1);
  assert.ok(Array.isArray(summary.reasons));
});

await runCheck("market sentiment summary captures fear greed and dominance", async () => {
  const summary = summarizeMarketSentiment({
    fearGreedPayload: {
      data: [
        { value: "21", value_classification: "Extreme Fear" },
        { value: "34", value_classification: "Fear" }
      ]
    },
    globalPayload: {
      data: {
        market_cap_percentage: { btc: 58.2 },
        total_market_cap: { usd: 3100000000000 },
        total_volume: { usd: 182000000000 },
        market_cap_change_percentage_24h_usd: -3.4
      }
    }
  });
  assert.equal(summary.fearGreedClassification, "Extreme Fear");
  assert.ok(summary.contrarianScore > 0);
  assert.ok(summary.riskScore > 0);
  assert.ok(summary.reasons.includes("extreme_fear"));
});

await runCheck("volatility context summarizes deribit option and historical vol", async () => {
  const summary = summarizeVolatilityContext({
    btcOptions: [
      { mark_iv: 74, open_interest: 1200, underlying_price: 68000 },
      { mark_iv: 70, open_interest: 900, underlying_price: 68000 }
    ],
    ethOptions: [
      { mark_iv: 68, open_interest: 800, underlying_price: 3600 }
    ],
    btcHistoricalVol: [[1772962500000, 55], [1772963400000, 58]],
    ethHistoricalVol: [[1772962500000, 49], [1772963400000, 52]]
  });
  assert.ok(summary.marketOptionIv > 0);
  assert.ok(summary.marketHistoricalVol > 0);
  assert.ok(summary.ivPremium > 0);
  assert.ok(["elevated", "stress"].includes(summary.regime));
});

await runCheck("calendar service parses ics events and summarizes imminent macro risk", async () => {
  const ics = `
BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Consumer Price Index for All Urban Consumers (CPI-U)
DTSTART:20260309T133000Z
URL:https://www.bls.gov
END:VEVENT
BEGIN:VEVENT
SUMMARY:Employment Situation
DTSTART:20260310T133000Z
URL:https://www.bls.gov
END:VEVENT
END:VCALENDAR
  `;
  const events = parseIcsEvents(ics).map((event) => ({
    title: event.SUMMARY,
    at: "2026-03-09T13:30:00.000Z",
    source: "BLS",
    link: event.URL || ""
  }));
  const summary = summarizeCalendarEvents(events, "BTCUSDT", ["BTC", "Bitcoin"], 30, "2026-03-08T12:00:00.000Z");
  assert.equal(summary.coverage >= 1, true);
  assert.ok(summary.riskScore > 0);
  assert.equal(summary.nextEventType, "macro_cpi");
});
await runCheck("portfolio optimizer flags overlap and high correlation", async () => {
  const optimizer = new PortfolioOptimizer(makeConfig({ maxPairCorrelation: 0.5 }));
  const candles = Array.from({ length: 20 }, (_, index) => ({ close: 100 + index, high: 101 + index, low: 99 + index }));
  const summary = optimizer.evaluateCandidate({
    symbol: "BTCUSDT",
    runtime: { openPositions: [{ symbol: "ETHUSDT" }] },
    marketSnapshot: { candles, market: { realizedVolPct: 0.02 } },
    candidateProfile: { cluster: "majors", sector: "layer1" },
    openPositionContexts: [
      {
        symbol: "ETHUSDT",
        marketSnapshot: { candles },
        profile: { cluster: "majors", sector: "layer1" }
      }
    ],
    regimeSummary: { regime: "trend" }
  });
  assert.ok(summary.reasons.includes("cluster_exposure_limit_hit"));
  assert.ok(summary.reasons.includes("pair_correlation_too_high"));
});

await runCheck("risk manager blocks abstain and drawdown conditions", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: { probability: 0.64, calibrationConfidence: 0.1, disagreement: 0.3, shouldAbstain: true },
    marketSnapshot: {
      book: { spreadBps: 30, bookPressure: -0.5, microPriceEdgeBps: -2 },
      market: { realizedVolPct: 0.03, atrPct: 0.01, bearishPatternScore: 0.8, bullishPatternScore: 0, dominantPattern: "shooting_star" }
    },
    newsSummary: { riskScore: 0.1, sentimentScore: 0, eventBullishScore: 0, eventBearishScore: 0, confidence: 0.3 },
    runtime: { openPositions: [{ notional: 9000, quantity: 0.18, entryPrice: 50000 }] },
    journal: { trades: [
      { symbol: "ETHUSDT", exitAt: "2026-03-08T09:00:00.000Z", pnlQuote: -500 },
      { symbol: "BTCUSDT", exitAt: "2026-03-08T08:00:00.000Z", pnlQuote: -250 },
      { symbol: "BTCUSDT", exitAt: "2026-03-08T07:00:00.000Z", pnlQuote: -180 }
    ] },
    balance: { quoteFree: 8000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { reasons: ["pair_correlation_too_high"], sizeMultiplier: 0.4, maxCorrelation: 0.9 },
    regimeSummary: { regime: "high_vol" },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.ok(decision.reasons.includes("model_uncertainty_abstain"));
  assert.ok(decision.reasons.includes("spread_too_wide"));
  assert.ok(decision.reasons.includes("orderbook_sell_pressure"));
  assert.ok(decision.reasons.includes("bearish_pattern_stack"));
  assert.ok(decision.reasons.includes("symbol_loss_streak_guard"));
  assert.ok(decision.reasons.includes("daily_drawdown_limit_hit"));
  assert.ok(decision.reasons.includes("max_total_exposure_reached"));
  assert.ok(decision.reasons.includes("pair_correlation_too_high"));
});

await runCheck("risk manager applies threshold probation shifts and scoped exit policies", async () => {
  const manager = new RiskManager(makeConfig());
  const entry = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: { probability: 0.56, calibrationConfidence: 0.34, disagreement: 0.08, shouldAbstain: false },
    marketSnapshot: {
      book: { spreadBps: 6, bookPressure: 0.14, microPriceEdgeBps: 0.4 },
      market: { realizedVolPct: 0.018, atrPct: 0.009, bearishPatternScore: 0.12, bullishPatternScore: 0.42 }
    },
    newsSummary: { riskScore: 0.08, sentimentScore: 0.12, eventBullishScore: 0.04, eventBearishScore: 0 },
    runtime: {
      openPositions: [],
      thresholdTuning: {
        appliedRecommendation: {
          id: "committee_low_agreement",
          status: "probation",
          adjustment: -0.015,
          confidence: 0.64,
          affectedStrategies: ["ema_trend"],
          affectedRegimes: ["trend"]
        }
      }
    },
    journal: { trades: [] },
    balance: { quoteFree: 10000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { reasons: [], sizeMultiplier: 1, maxCorrelation: 0.1, allocatorScore: 0.62 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.7 },
    regimeSummary: { regime: "trend" },
    thresholdTuningSummary: {
      appliedRecommendation: {
        id: "committee_low_agreement",
        status: "probation",
        adjustment: -0.015,
        confidence: 0.64,
        affectedStrategies: ["ema_trend"],
        affectedRegimes: ["trend"]
      }
    },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(entry.allow, true);
  assert.equal(entry.thresholdTuningApplied.id, "committee_low_agreement");
  assert.ok(entry.threshold < entry.baseThreshold);

  const exit = manager.evaluateExit({
    position: {
      id: "pos-1",
      symbol: "BTCUSDT",
      entryAt: "2026-03-08T08:00:00.000Z",
      entryPrice: 100,
      highestPrice: 104,
      lowestPrice: 99,
      quantity: 1,
      notional: 100,
      totalCost: 100,
      trailingStopPct: 0.01,
      scaleOutFraction: 0.4,
      scaleOutTriggerPrice: 101.2,
      strategyAtEntry: "ema_trend",
      regimeAtEntry: "trend"
    },
    currentPrice: 102.4,
    newsSummary: { riskScore: 0.1, sentimentScore: 0.1 },
    marketSnapshot: { book: { spreadBps: 3, bookPressure: 0.08 }, market: { bearishPatternScore: 0.08 } },
    exitIntelligenceSummary: { action: "trim", confidence: 0.7, trimScore: 0.72, trimFraction: 0.4, reason: "protect_winner" },
    exitPolicySummary: {
      strategyPolicies: [{ id: "ema_trend", scaleOutFractionMultiplier: 1.08, scaleOutTriggerMultiplier: 0.94, trailingStopMultiplier: 0.9, maxHoldMinutesMultiplier: 0.84 }],
      regimePolicies: [{ id: "trend", scaleOutFractionMultiplier: 1.04, scaleOutTriggerMultiplier: 0.96, trailingStopMultiplier: 0.94, maxHoldMinutesMultiplier: 0.9 }]
    },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(exit.shouldScaleOut, true);
  assert.ok(exit.scaleOutFraction > 0.4);
  assert.equal(exit.exitPolicy.active, true);
});

await runCheck("config validation blocks unsafe live mode", async () => {
  const result = validateConfig(makeConfig({
    botMode: "live",
    enableExchangeProtection: false,
    binanceApiKey: "",
    binanceApiSecret: "",
    liveTradingAcknowledged: ""
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes("LIVE_TRADING_ACKNOWLEDGED")));
});

await runCheck("health monitor flags stale snapshots and opens circuit", async () => {
  const runtime = { health: { warnings: [] } };
  const monitor = new HealthMonitor(makeConfig(), { warn() {} });
  const issues = monitor.validateSnapshot(
    "BTCUSDT",
    {
      candles: [{ closeTime: new Date("2026-03-08T09:00:00.000Z").getTime() }],
      book: { bid: 100, ask: 99 }
    },
    runtime,
    "2026-03-08T10:00:00.000Z"
  );
  assert.ok(issues.includes("stale_candles"));
  assert.ok(issues.includes("crossed_order_book"));
  monitor.recordFailure(runtime, new Error("boom"));
  monitor.recordFailure(runtime, new Error("boom2"));
  assert.equal(runtime.health.circuitOpen, true);
});

await runCheck("binance client estimates effective drift from midpoint clock sync samples", async () => {
  const serverTimes = [2920, 3022, 3121];
  const nowValues = [1000, 1040, 1100, 1144, 1200, 1242, 1242];
  let fetchIndex = 0;
  let nowIndex = 0;
  const client = new BinanceClient({
    apiKey: "",
    apiSecret: "",
    baseUrl: "https://api.binance.com",
    clockSyncSampleCount: 3,
    clockSyncMaxAgeMs: 60_000,
    clockSyncMaxRttMs: 500,
    nowFn: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)],
    fetchImpl: async () => ({
      ok: true,
      async text() {
        const value = serverTimes[Math.min(fetchIndex++, serverTimes.length - 1)];
        return JSON.stringify({ serverTime: value });
      }
    })
  });
  await client.syncServerTime(true);
  const state = client.getClockSyncState();
  assert.equal(client.getClockOffsetMs(), 1900);
  assert.ok(state.estimatedDriftMs <= 25);
  assert.equal(state.sampleCount, 3);
});

await runCheck("binance client retries non-json gateway failures", async () => {
  let attempts = 0;
  const client = new BinanceClient({
    apiKey: "",
    apiSecret: "",
    baseUrl: "https://api.binance.com",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return {
          ok: false,
          status: 503,
          async text() {
            return "<html>temporarily unavailable</html>";
          }
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true });
        }
      };
    }
  });
  const payload = await client.publicRequest("GET", "/api/v3/ping");
  assert.deepEqual(payload, { ok: true });
  assert.equal(attempts, 3);
});

await runCheck("binance api-key requests retry non-json failures", async () => {
  let attempts = 0;
  const client = new BinanceClient({
    apiKey: "test-key",
    apiSecret: "test-secret",
    baseUrl: "https://api.binance.com",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return {
          ok: false,
          status: 503,
          async text() {
            return "<html>gateway error</html>";
          }
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ listenKey: "abc123" });
        }
      };
    }
  });
  const payload = await client.apiKeyRequest("POST", "/api/v3/userDataStream");
  assert.equal(payload.listenKey, "abc123");
  assert.equal(attempts, 3);
});

await runCheck("health monitor uses sync quality instead of raw clock offset", async () => {
  const runtime = { health: { warnings: [] } };
  const monitor = new HealthMonitor(makeConfig({ maxServerTimeDriftMs: 100 }), { warn() {} });
  const noIssues = monitor.enforceClockDrift({
    getClockOffsetMs() {
      return 1900;
    },
    getClockSyncState() {
      return {
        offsetMs: 1900,
        estimatedDriftMs: 24,
        bestRttMs: 48,
        sampleCount: 3,
        stale: false,
        syncAgeMs: 1200
      };
    }
  }, runtime);
  assert.deepEqual(noIssues, []);

  const staleIssues = monitor.enforceClockDrift({
    getClockOffsetMs() {
      return 1900;
    },
    getClockSyncState() {
      return {
        offsetMs: 1900,
        estimatedDriftMs: 160,
        bestRttMs: 320,
        sampleCount: 2,
        stale: true,
        syncAgeMs: 120000
      };
    }
  }, runtime);
  assert.ok(staleIssues.includes("clock_sync_stale"));
  assert.ok(staleIssues.includes("clock_drift_too_large"));
});

await runCheck("health monitor clears stale cycle failures after a successful run", async () => {
  const runtime = {
    health: {
      warnings: [
        { at: "2026-03-10T18:32:59.943Z", issues: ["cycle_failure"], error: "clamp is not defined" },
        { at: "2026-03-10T18:32:27.146Z", issues: ["cycle_failure"], error: "safeNumber is not defined" },
        { at: "2026-03-10T18:31:00.000Z", issues: ["clock_sync_stale"] }
      ]
    }
  };
  const monitor = new HealthMonitor(makeConfig(), { warn() {} });
  monitor.recordSuccess(runtime);
  assert.equal(runtime.health.warnings.length, 1);
  assert.deepEqual(runtime.health.warnings[0].issues, ["clock_sync_stale"]);
});

await runCheck("local order book engine waits for startup depth before priming", async () => {
  let engine;
  let sawBufferedEventBeforeSnapshot = false;
  const client = {
    async getOrderBook() {
      sawBufferedEventBeforeSnapshot = engine.getBucket("BTCUSDT").buffer.length > 0;
      return {
        lastUpdateId: 100,
        bids: [["50000", "1.2"], ["49990", "1.4"]],
        asks: [["50010", "1.1"], ["50020", "1.5"]]
      };
    }
  };
  engine = new LocalOrderBookEngine({ client, config: makeConfig({ localBookBootstrapWaitMs: 60, localBookWarmupMs: 1200 }), logger: { warn() {}, info() {} } });
  const priming = engine.ensurePrimed("BTCUSDT");
  setTimeout(() => {
    engine.handleDepthEvent("BTCUSDT", { U: 101, u: 102, E: Date.now() + 1500, b: [["50000", "1.6"]], a: [["50010", "0.9"]] });
  }, 10);
  await priming;
  const snapshot = engine.getSnapshot("BTCUSDT");
  assert.equal(sawBufferedEventBeforeSnapshot, true);
  assert.equal(snapshot.synced, true);
  assert.equal(snapshot.warmupActive, true);
  assert.ok(snapshot.depthAgeMs >= 0);
});

await runCheck("local order book engine synchronizes depth and estimates fill impact", async () => {
  const client = {
    async getOrderBook() {
      return {
        lastUpdateId: 100,
        bids: [["50000", "1.2"], ["49990", "1.4"]],
        asks: [["50010", "1.1"], ["50020", "1.5"]]
      };
    }
  };
  const engine = new LocalOrderBookEngine({ client, config: makeConfig(), logger: { warn() {} } });
  await engine.ensurePrimed("BTCUSDT");
  engine.handleDepthEvent("BTCUSDT", { U: 101, u: 102, E: Date.now(), b: [["50000", "1.6"]], a: [["50010", "0.9"]] });
  const snapshot = engine.getSnapshot("BTCUSDT");
  const estimate = engine.estimateFill("BTCUSDT", "BUY", { quoteAmount: 1200 });
  assert.equal(snapshot.synced, true);
  assert.ok(snapshot.depthConfidence > 0);
  assert.ok(estimate.averagePrice > 0);
  assert.ok(estimate.completionRatio > 0);
});

await runCheck("execution engine prefers maker when spread allows it", async () => {
  const engine = new ExecutionEngine(makeConfig({ botMode: "live" }));
  const plan = engine.buildEntryPlan({
    symbol: "BTCUSDT",
    marketSnapshot: { book: { spreadBps: 8, tradeFlowImbalance: 0.1 } },
    score: { probability: 0.68 },
    decision: {},
    regimeSummary: { regime: "trend" },
    portfolioSummary: { sizeMultiplier: 1 }
  });
  assert.equal(plan.entryStyle, "limit_maker");
  assert.equal(plan.fallbackStyle, "cancel_replace_market");
});

await runCheck("execution engine upgrades to pegged maker on strong local book", async () => {
  const engine = new ExecutionEngine(makeConfig({ botMode: "live" }));
  const plan = engine.buildEntryPlan({
    symbol: "BTCUSDT",
    marketSnapshot: {
      book: {
        spreadBps: 8,
        tradeFlowImbalance: 0.12,
        localBook: {
          synced: true,
          depthConfidence: 0.82,
          queueImbalance: 0.18,
          queueRefreshScore: 0.24,
          resilienceScore: 0.12
        },
        entryEstimate: {
          touchSlippageBps: 0.4,
          midSlippageBps: 0.8,
          completionRatio: 1
        }
      }
    },
    score: { probability: 0.64 },
    decision: { quoteAmount: 500 },
    regimeSummary: { regime: "range" },
    strategySummary: { activeStrategy: "vwap_reversion", family: "mean_reversion", fitScore: 0.68 },
    portfolioSummary: { sizeMultiplier: 1 }
  });
  assert.equal(plan.entryStyle, "pegged_limit_maker");
  assert.equal(plan.usePeggedOrder, true);
  assert.equal(plan.pegPriceType, "PRIMARY_PEG");
});

await runCheck("execution engine folds strategy meta, ladder and governor into the entry plan", async () => {
  const engine = new ExecutionEngine(makeConfig({ botMode: "live" }));
  const plan = engine.buildEntryPlan({
    symbol: "BTCUSDT",
    marketSnapshot: {
      book: {
        spreadBps: 7,
        tradeFlowImbalance: 0.08,
        localBook: {
          synced: false,
          depthConfidence: 0.62,
          queueImbalance: 0.14,
          queueRefreshScore: 0.18,
          resilienceScore: 0.11
        },
        entryEstimate: {
          touchSlippageBps: 0.8,
          midSlippageBps: 0.5,
          completionRatio: 1
        }
      }
    },
    score: { probability: 0.63 },
    decision: {
      quoteAmount: 500,
      parameterGovernorApplied: { executionAggressivenessBias: 0.84 }
    },
    regimeSummary: { regime: "trend" },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.72 },
    portfolioSummary: { sizeMultiplier: 1 },
    strategyMetaSummary: {
      preferredFamily: "trend_following",
      preferredExecutionStyle: "limit_maker",
      familyAlignment: 0.18,
      makerBias: 0.12,
      sizeMultiplier: 1.08,
      holdMultiplier: 1.04,
      confidence: 0.66
    },
    capitalLadderSummary: { stage: "seed", sizeMultiplier: 0.18 }
  });
  assert.equal(plan.entryStyle, "limit_maker");
  assert.equal(plan.strategyMeta.preferredExecutionStyle, "limit_maker");
  assert.equal(plan.sizeMultiplier, 0.35);
  assert.ok(plan.rationale.some((item) => item.startsWith("gov_exec:0.840")));
});

await runCheck("execution engine simulates queue decay and spread shock in paper fills", async () => {
  const engine = new ExecutionEngine(makeConfig());
  const fill = engine.simulatePaperFill({
    marketSnapshot: {
      book: {
        ask: 100.2,
        bid: 100,
        mid: 100.1,
        spreadBps: 14,
        tradeFlowImbalance: -0.22,
        localBook: { depthConfidence: 0.28, queueImbalance: -0.24, queueRefreshScore: 0.08, resilienceScore: 0.06 },
        entryEstimate: { touchSlippageBps: 1.4, midSlippageBps: 0.9 }
      },
      market: { realizedVolPct: 0.031 }
    },
    side: "BUY",
    requestedQuoteAmount: 400,
    latencyMs: 320,
    plan: {
      entryStyle: "limit_maker",
      fallbackStyle: "cancel_replace_market",
      makerPatienceMs: 4200,
      expectedMakerFillPct: 0.52,
      expectedImpactBps: 1.1,
      expectedSlippageBps: 0.9,
      depthConfidence: 0.28,
      queueImbalance: -0.24,
      queueRefreshScore: 0.08,
      tradeFlow: -0.22,
      preferMaker: true
    }
  });
  assert.ok(fill.queueDecayBps > 0);
  assert.ok(fill.spreadShockBps > 0);
  assert.ok(fill.liquidityShockBps > 0);
  assert.ok(fill.expectedImpactBps >= 1.1);
});

await runCheck("execution engine derives paper calibration from live fills", async () => {
  const engine = new ExecutionEngine(makeConfig());
  const calibration = engine.buildPaperCalibration({
    journal: {
      trades: [
        { brokerMode: "live", entryExecutionAttribution: { entryStyle: "limit_maker", slippageDeltaBps: 2.4, makerFillRatio: 0.72, latencyBps: 1.8, queueDecayBps: 1.2, spreadShockBps: 0.9 } },
        { brokerMode: "live", entryExecutionAttribution: { entryStyle: "limit_maker", slippageDeltaBps: 1.8, makerFillRatio: 0.65, latencyBps: 1.1, queueDecayBps: 0.8, spreadShockBps: 0.6 } },
        { brokerMode: "live", entryExecutionAttribution: { entryStyle: "market", slippageDeltaBps: 3.2, makerFillRatio: 0.08, latencyBps: 0.6, queueDecayBps: 0.1, spreadShockBps: 0.4 } },
        { brokerMode: "live", entryExecutionAttribution: { entryStyle: "market", slippageDeltaBps: 2.7, makerFillRatio: 0.04, latencyBps: 0.5, queueDecayBps: 0.2, spreadShockBps: 0.5 } },
        { brokerMode: "live", entryExecutionAttribution: { entryStyle: "market", slippageDeltaBps: 2.9, makerFillRatio: 0.03, latencyBps: 0.7, queueDecayBps: 0.2, spreadShockBps: 0.6 } },
        { brokerMode: "live", entryExecutionAttribution: { entryStyle: "market", slippageDeltaBps: 2.5, makerFillRatio: 0.05, latencyBps: 0.6, queueDecayBps: 0.2, spreadShockBps: 0.5 } }
      ]
    },
    nowIso: "2026-03-11T09:00:00.000Z"
  });
  assert.equal(calibration.status, "calibrated");
  assert.ok(calibration.styles.limit_maker.slippageBiasBps > 0);
  assert.ok(calibration.styles.market.latencyMultiplier > 0.8);
});

await runCheck("live broker places protective OCO after a buy", async () => {
  const clientCalls = [];
  const client = {
    async placeOrder(params) {
      clientCalls.push({ type: "order", params });
      return {
        orderId: 42,
        executedQty: "0.01000000",
        cummulativeQuoteQty: "700.00",
        fills: [{ price: "70000", qty: "0.01", commission: "0.7", commissionAsset: "USDT" }]
      };
    },
    async placeOrderListOco(params) {
      clientCalls.push({ type: "oco", params });
      return {
        orderListId: 999,
        listClientOrderId: "protect-1",
        orders: [{ orderId: 1 }, { orderId: 2 }],
        listStatusType: "EXEC_STARTED"
      };
    }
  };
  const broker = new LiveBroker({
    client,
    config: makeConfig({ enableSmartExecution: false, stpMode: "EXPIRE_TAKER" }),
    logger: { warn() {}, info() {} },
    symbolRules: { BTCUSDT: rules }
  });
  const runtime = { openPositions: [] };
  const position = await broker.enterPosition({
    symbol: "BTCUSDT",
    rules,
    quoteAmount: 700,
    marketSnapshot: { book: { bid: 69990, ask: 70010, mid: 70000, spreadBps: 2 } },
    decision: { stopLossPct: 0.02, takeProfitPct: 0.03, executionPlan: { entryStyle: "market", fallbackStyle: "none" }, regime: "trend" },
    score: { probability: 0.7, regime: "trend" },
    rawFeatures: { momentum_5: 1 },
    newsSummary: { sentimentScore: 0.1 },
    runtime
  });
  assert.equal(runtime.openPositions.length, 1);
  assert.equal(position.protectiveOrderListId, 999);
  const ocoCall = clientCalls.find((call) => call.type === "oco");
  assert.equal(ocoCall.params.side, "SELL");
  assert.equal(ocoCall.params.aboveType, "LIMIT_MAKER");
  assert.equal(ocoCall.params.belowType, "STOP_LOSS_LIMIT");
});

await runCheck("live broker reconciles a filled protective order", async () => {
  const client = {
    async getAccountInfo() {
      return {
        balances: [{ asset: "BTC", free: "0", locked: "0" }],
        canTrade: true,
        accountType: "SPOT",
        permissions: ["SPOT"]
      };
    },
    async getOrderList() {
      return { listStatusType: "ALL_DONE", orders: [{ orderId: 55 }] };
    },
    async getOrder() {
      return {
        orderId: 55,
        executedQty: "0.01000000",
        cummulativeQuoteQty: "720.00",
        status: "FILLED",
        type: "LIMIT_MAKER"
      };
    },
    async getMyTrades() {
      return [{ price: "72000", commission: "0.72", commissionAsset: "USDT" }];
    }
  };
  const runtime = {
    openPositions: [
      {
        id: "pos-1",
        symbol: "BTCUSDT",
        entryAt: "2026-03-08T10:00:00.000Z",
        entryPrice: 70000,
        quantity: 0.01,
        totalCost: 700.7,
        rawFeatures: { momentum_5: 1 },
        newsSummary: {},
        protectiveOrderListId: 123,
        notional: 700,
        highestPrice: 71000,
        lowestPrice: 69500,
        regimeAtEntry: "trend"
      }
    ]
  };
  const broker = new LiveBroker({
    client,
    config: makeConfig({ allowRecoverUnsyncedPositions: false }),
    logger: { warn() {}, info() {} },
    symbolRules: { BTCUSDT: rules }
  });
  const reconciliation = await broker.reconcileRuntime({
    runtime,
    journal: { trades: [] },
    getMarketSnapshot: async () => ({ book: { mid: 72000 } })
  });
  assert.equal(reconciliation.closedTrades.length, 1);
  assert.equal(runtime.openPositions.length, 0);
  assert.equal(reconciliation.closedTrades[0].reason, "protective_take_profit");
});

await runCheck("live broker rebuilds stale protection after an unfilled ALL_DONE order list", async () => {
  let rebuiltOrderListId = null;
  const client = {
    async getAccountInfo() {
      return {
        balances: [{ asset: "BTC", free: "0.01000000", locked: "0" }],
        canTrade: true,
        accountType: "SPOT",
        permissions: ["SPOT"]
      };
    },
    async getOrderList() {
      return { listStatusType: "ALL_DONE", orders: [{ orderId: 55 }] };
    },
    async getOrder() {
      return {
        orderId: 55,
        status: "CANCELED",
        type: "LIMIT_MAKER"
      };
    },
    async placeOrderListOco() {
      rebuiltOrderListId = 999;
      return {
        orderListId: rebuiltOrderListId,
        listClientOrderId: "rebuild-1",
        listStatusType: "NEW",
        orders: [{ orderId: 91 }, { orderId: 92 }]
      };
    }
  };
  const runtime = {
    openPositions: [
      {
        id: "pos-1",
        symbol: "BTCUSDT",
        entryAt: "2026-03-08T10:00:00.000Z",
        entryPrice: 70000,
        quantity: 0.01,
        totalCost: 700.7,
        rawFeatures: { momentum_5: 1 },
        newsSummary: {},
        protectiveOrderListId: 123,
        protectiveListClientOrderId: "old-list",
        protectiveOrders: [{ orderId: 55 }],
        protectiveOrderStatus: "NEW",
        protectiveOrderPlacedAt: "2026-03-08T10:01:00.000Z",
        stopLossPrice: 68600,
        takeProfitPrice: 72100,
        notional: 700,
        highestPrice: 71000,
        lowestPrice: 69500,
        regimeAtEntry: "trend"
      }
    ]
  };
  const broker = new LiveBroker({
    client,
    config: makeConfig({ botMode: "live", allowRecoverUnsyncedPositions: false, enableStpTelemetryQuery: false }),
    logger: { warn() {}, info() {} },
    symbolRules: { BTCUSDT: rules }
  });
  const reconciliation = await broker.reconcileRuntime({
    runtime,
    journal: { trades: [] },
    getMarketSnapshot: async () => ({ book: { mid: 72000 } })
  });
  assert.equal(reconciliation.closedTrades.length, 0);
  assert.equal(runtime.openPositions[0].protectiveOrderListId, rebuiltOrderListId);
  assert.equal(runtime.openPositions[0].protectiveOrders.length, 2);
  assert.equal(runtime.openPositions[0].protectiveOrderStatus, "NEW");
});

await runCheck("live broker auto-flattens filled entries when protection setup fails", async () => {
  const placedSides = [];
  const client = {
    async placeOrder(params) {
      placedSides.push(params.side);
      if (params.side === "BUY") {
        return {
          orderId: 1,
          executedQty: "0.01000000",
          cummulativeQuoteQty: "700.00",
          fills: [{ price: "70000", commission: "0.70", commissionAsset: "USDT" }]
        };
      }
      return {
        orderId: 2,
        executedQty: params.quantity,
        cummulativeQuoteQty: "698.50",
        fills: [{ price: "69850", commission: "0.70", commissionAsset: "USDT" }]
      };
    },
    async placeOrderListOco() {
      throw new Error("oco endpoint unavailable");
    }
  };
  const runtime = { openPositions: [] };
  const broker = new LiveBroker({
    client,
    config: makeConfig({ botMode: "live", enableSmartExecution: false, enableStpTelemetryQuery: false }),
    logger: { warn() {}, info() {} },
    symbolRules: { BTCUSDT: rules }
  });
  await assert.rejects(
    broker.enterPosition({
      symbol: "BTCUSDT",
      rules,
      quoteAmount: 700,
      marketSnapshot: { book: { bid: 69990, ask: 70010, mid: 70000, spreadBps: 2 } },
      decision: { stopLossPct: 0.02, takeProfitPct: 0.03, executionPlan: { entryStyle: "market", fallbackStyle: "none" }, regime: "trend" },
      score: { probability: 0.7, regime: "trend" },
      rawFeatures: { momentum_5: 1 },
      newsSummary: { sentimentScore: 0.1 },
      runtime
    }),
    (error) => {
      assert.equal(error.preventFurtherEntries, true);
      assert.equal(error.blockedReason, "entry_recovered_after_partial_fill");
      assert.equal(error.recoveredTrade?.reason, "entry_recovery_flatten");
      return true;
    }
  );
  assert.deepEqual(placedSides, ["BUY", "SELL"]);
  assert.equal(runtime.openPositions.length, 0);
  assert.ok(Array.isArray(runtime.orderLifecycle?.actionJournal));
  assert.ok(runtime.orderLifecycle.actionJournal.some((item) => item.type === "protective_build" && item.status === "failed"));
  assert.ok(runtime.orderLifecycle.actionJournal.some((item) => item.type === "entry_open" && item.status === "recovered"));
});

await runCheck("live broker keeps the remainder managed after a partial exit fill", async () => {
  let rebuiltProtection = 0;
  const client = {
    async cancelOrderList() {
      return { orderListId: 77, listStatusType: "ALL_DONE" };
    },
    async placeOrder() {
      return {
        orderId: 88,
        status: "PARTIALLY_FILLED",
        executedQty: "0.00400000",
        cummulativeQuoteQty: "288.00",
        fills: []
      };
    },
    async getOrder() {
      return {
        orderId: 88,
        status: "PARTIALLY_FILLED",
        executedQty: "0.00400000",
        cummulativeQuoteQty: "288.00"
      };
    },
    async getMyTrades() {
      return [{ price: "72000", qty: "0.004", commission: "0.20", commissionAsset: "USDT" }];
    },
    async placeOrderListOco() {
      rebuiltProtection += 1;
      return {
        orderListId: 501,
        listClientOrderId: "rebuild-protect",
        orders: [{ orderId: 91 }, { orderId: 92 }],
        listStatusType: "EXEC_STARTED"
      };
    }
  };
  const runtime = {
    openPositions: [
      {
        id: "pos-1",
        symbol: "BTCUSDT",
        entryAt: "2026-03-08T10:00:00.000Z",
        entryPrice: 70000,
        quantity: 0.01,
        totalCost: 700.7,
        entryFee: 0.7,
        notional: 700,
        stopLossPrice: 68600,
        takeProfitPrice: 72100,
        trailingStopPct: 0.01,
        highestPrice: 71000,
        lowestPrice: 69500,
        lastMarkedPrice: 70500,
        latestSpreadBps: 2,
        protectiveOrderListId: 123,
        protectiveOrders: [{ orderId: 11 }, { orderId: 12 }],
        protectiveOrderStatus: "NEW",
        executionPlan: { strategyId: "ema_trend", strategyType: "trend_following" },
        brokerMode: "live"
      }
    ]
  };
  const broker = new LiveBroker({
    client,
    config: makeConfig({ botMode: "live", enableStpTelemetryQuery: false }),
    logger: { warn() {}, info() {} },
    symbolRules: { BTCUSDT: rules }
  });

  let error = null;
  try {
    await broker.exitPosition({
      position: runtime.openPositions[0],
      rules,
      marketSnapshot: { book: { bid: 71990, ask: 72010, mid: 72000, spreadBps: 2 } },
      reason: "risk_exit",
      runtime
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error);
  assert.equal(error.positionSafeguarded, true);
  assert.equal(runtime.openPositions.length, 1);
  assert.ok(runtime.openPositions[0].quantity < 0.01);
  assert.equal(runtime.openPositions[0].protectiveOrderListId, 501);
  assert.equal(rebuiltProtection, 1);
});

await runCheck("strategy router selects a mean reversion setup in range conditions", async () => {
  const summary = evaluateStrategySet({
    symbol: "BTCUSDT",
    marketSnapshot: {
      market: {
        rsi14: 31,
        vwapGapPct: -0.011,
        realizedVolPct: 0.011,
        momentum5: -0.004,
        momentum20: -0.0008,
        emaGap: -0.0002,
        bullishPatternScore: 0.42,
        bearishPatternScore: 0.08,
        rangeCompression: 0.92,
        breakoutPct: -0.002,
        volumeZ: 0.3,
        closeLocation: 0.79,
        trendPersistence: 0.54,
        obvSlope: 0.03,
        trendStrength: -0.0004
      },
      book: {
        bookPressure: 0.24,
        tradeFlowImbalance: 0.08
      }
    },
    newsSummary: { riskScore: 0.08, sentimentScore: 0.03 },
    announcementSummary: { riskScore: 0.02 },
    calendarSummary: { riskScore: 0.04 },
    marketStructureSummary: { signalScore: 0.06, crowdingBias: 0.02, fundingRate: 0.00001 },
    regimeSummary: { regime: "range", confidence: 0.72 },
    streamFeatures: { tradeFlowImbalance: 0.08 }
  });
  assert.ok(["mean_reversion", "vwap_reversion", "zscore_reversion"].includes(summary.activeStrategy));
  assert.equal(summary.family, "mean_reversion");
  assert.ok(summary.fitScore > 0.3);
});

await runCheck("strategy router selects donchian breakout in expansion conditions", async () => {
  const summary = evaluateStrategySet({
    symbol: "BTCUSDT",
    marketSnapshot: {
      market: {
        rsi14: 63,
        vwapGapPct: 0.005,
        vwapSlopePct: 0.003,
        realizedVolPct: 0.018,
        momentum5: 0.011,
        momentum20: 0.024,
        emaGap: 0.008,
        emaTrendScore: 0.009,
        emaTrendSlopePct: 0.002,
        bullishPatternScore: 0.32,
        bearishPatternScore: 0.04,
        rangeCompression: 0.58,
        breakoutPct: 0.012,
        donchianBreakoutPct: 0.014,
        donchianPosition: 0.96,
        donchianWidthPct: 0.018,
        bollingerSqueezeScore: 0.61,
        atrExpansion: 0.42,
        volumeZ: 1.8,
        closeLocation: 0.92,
        trendPersistence: 0.84,
        obvSlope: 0.19,
        trendStrength: 0.012,
        structureBreakScore: 1,
        liquiditySweepScore: 0,
        wickSkew: -0.08,
        adx14: 31,
        dmiSpread: 0.24,
        trendQualityScore: 0.54,
        supertrendDirection: 1,
        supertrendDistancePct: 0.011,
        keltnerSqueezeScore: 0.74,
        squeezeReleaseScore: 0.69,
        stochRsiK: 72,
        stochRsiD: 66,
        mfi14: 68,
        cmf20: 0.14
      },
      book: {
        bookPressure: 0.41,
        weightedDepthImbalance: 0.35,
        microPriceEdgeBps: 1.4,
        wallImbalance: 0.18,
        spreadBps: 6
      }
    },
    newsSummary: { riskScore: 0.05, sentimentScore: 0.12 },
    announcementSummary: { riskScore: 0.02 },
    calendarSummary: { riskScore: 0.04 },
    marketStructureSummary: { signalScore: 0.22, crowdingBias: 0.08, fundingRate: 0.00003, openInterestChangePct: 0.04, takerImbalance: 0.22 },
    regimeSummary: { regime: "breakout", confidence: 0.82 },
    streamFeatures: { tradeFlowImbalance: 0.21 }
  });
  assert.ok(["donchian_breakout", "atr_breakout", "open_interest_breakout", "breakout"].includes(summary.activeStrategy));
  assert.equal(summary.family, "breakout");
});

await runCheck("exchange capability resolver keeps Belgium profile spot-first by default", async () => {
  const capabilities = resolveExchangeCapabilities({
    userRegion: "BE",
    exchangeCapabilitiesEnabled: [],
    exchangeCapabilitiesDisabled: []
  });
  assert.equal(capabilities.region, "BE");
  assert.equal(capabilities.spotEnabled, true);
  assert.equal(capabilities.shortingEnabled, false);
  assert.equal(capabilities.marginEnabled, false);
  assert.equal(capabilities.futuresEnabled, false);
});

await runCheck("risk manager normalizes persisted string capability flags before applying downtrend guards", async () => {
  const manager = new RiskManager(makeConfig({ botMode: "live", userRegion: "BE" }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.6,
      calibrationConfidence: 0.9,
      shouldAbstain: false,
      committee: { netScore: 0.2, confidence: 0.7, agreement: 0.8, vetoes: [] },
      transformer: { probability: 0.62, confidence: 0.1 }
    },
    marketSnapshot: {
      market: {
        momentum20: -0.03,
        emaGap: -0.015,
        dmiSpread: -0.18,
        supertrendDirection: -1,
        bearishPatternScore: 0.44,
        realizedVolPct: 0.01
      },
      book: { spreadBps: 4, bookPressure: 0.12 }
    },
    newsSummary: { riskScore: 0.05 },
    announcementSummary: { riskScore: 0.01 },
    marketStructureSummary: { longSqueezeScore: 0.46 },
    marketSentimentSummary: { riskScore: 0.3 },
    volatilitySummary: { riskScore: 0.2 },
    calendarSummary: { riskScore: 0.05, proximityHours: 72 },
    committeeSummary: { vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.5, expectedReward: 0.03 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.68, confidence: 0.5, blockers: [], agreementGap: 0.04 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.82 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 1, blockerReasons: [] },
    exchangeCapabilitiesSummary: { region: "BE", spotEnabled: "true", shortingEnabled: "false", marginEnabled: "false", futuresEnabled: "false" },
    nowIso: "2026-03-11T10:00:00.000Z"
  });
  assert.equal(decision.exchangeCapabilitiesApplied.shortingEnabled, false);
  assert.equal(decision.downtrendPolicy.shortingUnavailable, true);
  assert.ok(decision.reasons.includes("spot_downtrend_guard"));
});

await runCheck("strategy router surfaces bear rally reclaim during spot-only downtrends", async () => {
  const summary = evaluateStrategySet({
    symbol: "BTCUSDT",
    marketSnapshot: {
      market: {
        momentum20: -0.024,
        emaGap: -0.013,
        dmiSpread: -0.16,
        supertrendDirection: -1,
        vwapGapPct: -0.021,
        priceZScore: -2.1,
        rsi14: 28,
        stochRsiK: 14,
        closeLocation: 0.84,
        wickSkew: -0.62,
        liquiditySweepScore: 0.72,
        bullishPatternScore: 0.36,
        bearishPatternScore: 0.18,
        realizedVolPct: 0.028,
        cmf20: 0.08,
        volumeZ: 1.1
      },
      book: {
        bookPressure: 0.22,
        weightedDepthImbalance: 0.18,
        microPriceEdgeBps: 1.4
      }
    },
    newsSummary: { riskScore: 0.08, sentimentScore: 0 },
    announcementSummary: { riskScore: 0.02 },
    calendarSummary: { riskScore: 0.04 },
    marketStructureSummary: { longSqueezeScore: 0.44, signalScore: 0.12 },
    marketSentimentSummary: { riskScore: 0.42, contrarianScore: 0.18 },
    volatilitySummary: { riskScore: 0.46 },
    regimeSummary: { regime: "trend", confidence: 0.78 },
    streamFeatures: { tradeFlowImbalance: 0.18 },
    exchangeCapabilities: resolveExchangeCapabilities({ userRegion: "BE" })
  });
  assert.equal(summary.family, "mean_reversion");
  assert.ok(summary.strategies.some((item) => item.id === "bear_rally_reclaim" && item.fitScore > 0.45));
});


await runCheck("risk manager ignores stale loss streaks outside the lookback window", async () => {
  const manager = new RiskManager(makeConfig({ lossStreakLookbackMinutes: 60 }));
  const streak = manager.getLossStreak({
    trades: [
      { symbol: "BTCUSDT", exitAt: "2026-03-08T00:00:00.000Z", pnlQuote: -10 },
      { symbol: "BTCUSDT", exitAt: "2026-03-08T00:30:00.000Z", pnlQuote: -12 },
      { symbol: "BTCUSDT", exitAt: "2026-03-08T01:00:00.000Z", pnlQuote: -9 }
    ]
  }, null, {
    nowIso: "2026-03-08T04:00:00.000Z",
    lookbackMinutes: 60
  });
  assert.equal(streak, 0);
});

await runCheck("self heal ignores calibration drift until enough observations exist", async () => {
  const manager = new SelfHealManager(makeConfig({ lossStreakLookbackMinutes: 60 }), { warn() {} });
  const state = manager.evaluate({
    previousState: manager.buildDefaultState(),
    report: {
      recentTrades: [
        { exitAt: "2026-03-08T00:00:00.000Z", pnlQuote: -10 },
        { exitAt: "2026-03-08T00:30:00.000Z", pnlQuote: -12 },
        { exitAt: "2026-03-08T01:00:00.000Z", pnlQuote: -9 }
      ],
      windows: { today: { realizedPnl: 0 } }
    },
    driftSummary: { severity: 0.2 },
    health: { circuitOpen: false },
    calibration: { observations: 3, expectedCalibrationError: 0.9 },
    botMode: "paper",
    hasStableModel: false,
    now: new Date("2026-03-08T04:00:00.000Z")
  });
  assert.equal(state.mode, "normal");
  assert.deepEqual(state.issues, []);
});

await runCheck("self heal clears recovered circuit pauses in paper mode", async () => {
  const manager = new SelfHealManager(makeConfig({ selfHealCooldownMinutes: 180 }), { warn() {} });
  const state = manager.evaluate({
    previousState: {
      ...manager.buildDefaultState(),
      mode: "paused",
      active: true,
      reason: "health_circuit_open",
      issues: ["health_circuit_open"],
      cooldownUntil: "2026-03-08T06:00:00.000Z",
      lastTriggeredAt: "2026-03-08T03:00:00.000Z"
    },
    report: { recentTrades: [], windows: { today: { realizedPnl: 0 } } },
    driftSummary: { severity: 0.1 },
    health: { circuitOpen: false },
    calibration: { observations: 12, expectedCalibrationError: 0.02 },
    botMode: "paper",
    hasStableModel: false,
    now: new Date("2026-03-08T04:00:00.000Z")
  });
  assert.equal(state.mode, "normal");
  assert.equal(state.active, false);
  assert.ok(state.lastRecoveryAt);
});

await runCheck("self heal uses paper calibration probe instead of full pause on calibration break", async () => {
  const manager = new SelfHealManager(makeConfig({
    selfHealPaperCalibrationProbeSizeMultiplier: 0.24,
    selfHealPaperCalibrationProbeThresholdPenalty: 0.035
  }), { warn() {} });
  const state = manager.evaluate({
    previousState: manager.buildDefaultState(),
    report: { recentTrades: [], windows: { today: { realizedPnl: 0 } } },
    driftSummary: { severity: 0.1 },
    health: { circuitOpen: false },
    calibration: { observations: 18, expectedCalibrationError: 0.31 },
    botMode: "paper",
    hasStableModel: true,
    now: new Date("2026-03-08T04:00:00.000Z")
  });
  assert.equal(state.mode, "paper_calibration_probe");
  assert.equal(state.active, true);
  assert.equal(state.reason, "calibration_break");
  assert.equal(state.learningAllowed, true);
  assert.equal(state.sizeMultiplier, 0.24);
  assert.equal(state.thresholdPenalty, 0.035);
  assert.ok(state.actions.includes("paper_probe_entries"));
  assert.ok(state.actions.includes("reset_rl_policy"));
  assert.ok(state.actions.includes("restore_stable_model"));
});

await runCheck("self heal keeps live calibration break on hard fallback behavior", async () => {
  const manager = new SelfHealManager(makeConfig(), { warn() {} });
  const state = manager.evaluate({
    previousState: manager.buildDefaultState(),
    report: { recentTrades: [], windows: { today: { realizedPnl: 0 } } },
    driftSummary: { severity: 0.1 },
    health: { circuitOpen: false },
    calibration: { observations: 18, expectedCalibrationError: 0.31 },
    botMode: "live",
    hasStableModel: false,
    now: new Date("2026-03-08T04:00:00.000Z")
  });
  assert.equal(state.mode, "paper_fallback");
  assert.equal(state.learningAllowed, false);
});

await runCheck("strategy optimizer builds recency-weighted priors", async () => {
  const optimizer = new StrategyOptimizer(makeConfig());
  const snapshot = optimizer.buildSnapshot({
    journal: {
      trades: [
        { exitAt: "2026-03-08T10:00:00.000Z", strategyAtEntry: "ema_trend", netPnlPct: 0.021, pnlQuote: 42, labelScore: 0.82 },
        { exitAt: "2026-03-07T10:00:00.000Z", strategyAtEntry: "ema_trend", netPnlPct: 0.014, pnlQuote: 18, labelScore: 0.74 },
        { exitAt: "2026-03-06T10:00:00.000Z", strategyAtEntry: "vwap_reversion", netPnlPct: -0.011, pnlQuote: -9, labelScore: 0.32 }
      ]
    },
    nowIso: "2026-03-08T12:00:00.000Z"
  });
  assert.equal(snapshot.sampleSize, 3);
  assert.ok(snapshot.topStrategies.length >= 1);
  assert.equal(snapshot.topStrategies[0].id, "ema_trend");
  assert.ok(snapshot.strategyPriors.ema_trend.rewardScore > snapshot.strategyPriors.vwap_reversion.rewardScore);
  assert.ok(snapshot.strategyThresholdTilts.ema_trend > 0);
  assert.ok(snapshot.familyThresholdTilts.trend_following > 0);
});

await runCheck("reference venue service blocks large cross-venue divergence", async () => {
  const service = new ReferenceVenueService(makeConfig({ referenceVenueMinQuotes: 2, referenceVenueMaxDivergenceBps: 15 }));
  const summary = await service.getSymbolSummary("BTCUSDT", { book: { mid: 100 } }, {
    referenceQuotes: [
      { venue: "OKX", bid: 100.8, ask: 101.0 },
      { venue: "Bybit", bid: 100.9, ask: 101.1 }
    ]
  });
  assert.equal(summary.status, "blocked");
  assert.ok(summary.blockerReasons.includes("reference_venue_divergence"));
  const runtime = service.summarizeRuntime([{ venueConfirmationSummary: summary }], "2026-03-11T10:00:00.000Z");
  assert.equal(runtime.blockedCount, 1);
});

await runCheck("parameter governor builds scoped adjustments from closed trades", async () => {
  const governor = new ParameterGovernor(makeConfig({ parameterGovernorMinTrades: 2 }));
  const snapshot = governor.buildSnapshot({
    journal: {
      trades: [
        {
          strategyAtEntry: "ema_trend",
          regimeAtEntry: "trend",
          entryAt: "2026-03-08T10:00:00.000Z",
          exitAt: "2026-03-08T12:00:00.000Z",
          pnlQuote: 18,
          netPnlPct: 0.018,
          mfePct: 0.028,
          maePct: -0.007,
          entryExecutionAttribution: { slippageDeltaBps: 1.2 }
        },
        {
          strategyAtEntry: "ema_trend",
          regimeAtEntry: "trend",
          entryAt: "2026-03-07T10:00:00.000Z",
          exitAt: "2026-03-07T12:30:00.000Z",
          pnlQuote: 11,
          netPnlPct: 0.011,
          mfePct: 0.022,
          maePct: -0.006,
          entryExecutionAttribution: { slippageDeltaBps: 0.9 }
        }
      ]
    },
    nowIso: "2026-03-11T10:00:00.000Z"
  });
  assert.equal(snapshot.status, "active");
  assert.ok(snapshot.strategyScopes.some((item) => item.id === "ema_trend"));
  const resolved = governor.resolve(snapshot, { strategyId: "ema_trend", regimeId: "trend" });
  assert.equal(resolved.active, true);
  assert.ok(resolved.maxHoldMinutesMultiplier > 0);
});

await runCheck("capital ladder enforces shadow gating before live promotion is ready", async () => {
  const ladder = new CapitalLadder(makeConfig());
  const snapshot = ladder.buildSnapshot({
    botMode: "live",
    modelRegistry: {
      promotionPolicy: {
        allowPromotion: false,
        blockerReasons: ["model_probation"]
      }
    },
    strategyResearch: { approvedCandidateCount: 0 },
    report: { modes: { live: { tradeCount: 0 } }, windows: { today: { tradeCount: 0 } } },
    nowIso: "2026-03-11T10:00:00.000Z"
  });
  assert.equal(snapshot.stage, "shadow");
  assert.equal(snapshot.allowEntries, false);
  assert.ok(snapshot.blockerReasons.includes("model_probation"));
});

await runCheck("risk manager adapts thresholds from optimizer priors", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.607,
      calibrationConfidence: 0.42,
      disagreement: 0.08,
      shouldAbstain: false,
      transformer: { probability: 0.63, confidence: 0.24 }
    },
    marketSnapshot: {
      book: { spreadBps: 4, bookPressure: 0.22, microPriceEdgeBps: 1.4 },
      market: { realizedVolPct: 0.02, atrPct: 0.01, bearishPatternScore: 0.1, bullishPatternScore: 0.24, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.05, sentimentScore: 0.08, eventBullishScore: 0.04, eventBearishScore: 0, socialSentiment: 0.02, socialRisk: 0 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0.01 },
    marketStructureSummary: { riskScore: 0.08, signalScore: 0.12, crowdingBias: 0.08, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.04, bullishScore: 0, urgencyScore: 0 },
    committeeSummary: { agreement: 0.58, probability: 0.63, netScore: 0.11, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.02 },
    strategySummary: {
      activeStrategy: "ema_trend",
      family: "trend_following",
      fitScore: 0.58,
      confidence: 0.44,
      blockers: [],
      agreementGap: 0.06,
      optimizer: {
        sampleSize: 18,
        sampleConfidence: 0.81,
        thresholdTilt: 0.01,
        confidenceTilt: 0.005,
        familyThresholdTilts: { trend_following: 0.012 },
        strategyThresholdTilts: { ema_trend: 0.018 },
        familyConfidenceTilts: { trend_following: 0.01 },
        strategyConfidenceTilts: { ema_trend: 0.015 }
      }
    },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0 },
    regimeSummary: { regime: "trend" },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.ok(decision.allow);
  assert.ok(decision.threshold < decision.baseThreshold);
  assert.ok(decision.strategyConfidenceFloor < makeConfig().strategyMinConfidence);
  assert.ok(decision.optimizerApplied.strategyThresholdTilt > 0);
});

await runCheck("risk manager applies parameter governor, venue confirmation and capital ladder controls", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.63,
      calibrationConfidence: 0.48,
      disagreement: 0.05,
      shouldAbstain: false,
      transformer: { probability: 0.64, confidence: 0.22 }
    },
    marketSnapshot: {
      book: { spreadBps: 4, bookPressure: 0.21, microPriceEdgeBps: 1.1, mid: 100 },
      market: { realizedVolPct: 0.019, atrPct: 0.009, bearishPatternScore: 0.04, bullishPatternScore: 0.16 }
    },
    newsSummary: { riskScore: 0.04, sentimentScore: 0.08, eventBullishScore: 0.03, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0.01 },
    marketStructureSummary: { riskScore: 0.08, signalScore: 0.12, crowdingBias: 0.04, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.04, bullishScore: 0, urgencyScore: 0 },
    committeeSummary: { agreement: 0.6, probability: 0.65, netScore: 0.12, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.03 },
    strategySummary: {
      activeStrategy: "ema_trend",
      family: "trend_following",
      fitScore: 0.64,
      confidence: 0.48,
      blockers: [],
      agreementGap: 0.04,
      optimizer: { sampleSize: 12, sampleConfidence: 0.74 }
    },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 10000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, allocatorScore: 0.64, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.76 },
    parameterGovernorSummary: {
      strategyScopes: [{
        id: "ema_trend",
        scopeType: "strategy",
        thresholdShift: -0.02,
        stopLossMultiplier: 1.08,
        takeProfitMultiplier: 0.96,
        trailingStopMultiplier: 1.02,
        scaleOutTriggerMultiplier: 1.03,
        scaleOutFractionMultiplier: 0.94,
        maxHoldMinutesMultiplier: 1.12,
        executionAggressivenessBias: 0.9
      }],
      regimeScopes: []
    },
    capitalLadderSummary: { stage: "seed", allowEntries: true, sizeMultiplier: 0.18 },
    venueConfirmationSummary: { status: "confirmed", confirmed: true, venueCount: 2, divergenceBps: 3.2 },
    strategyMetaSummary: {
      thresholdShift: -0.01,
      sizeMultiplier: 1.08,
      stopLossMultiplier: 0.98,
      holdMultiplier: 1.06
    },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.capitalLadderApplied.stage, "seed");
  assert.ok(decision.parameterGovernorApplied.active);
  assert.ok(decision.venueConfirmationSummary.confirmed);
  assert.ok(decision.maxHoldMinutes > makeConfig().maxHoldMinutes);
  assert.ok(decision.quoteAmount < 250);
});

await runCheck("risk manager blocks entries when the data quorum falls to observe-only", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.64,
      calibrationConfidence: 0.42,
      disagreement: 0.04,
      shouldAbstain: false,
      transformer: { probability: 0.65, confidence: 0.2 }
    },
    marketSnapshot: {
      book: { spreadBps: 4, bookPressure: 0.2, microPriceEdgeBps: 0.8 },
      market: { realizedVolPct: 0.018, atrPct: 0.009, bearishPatternScore: 0.04, bullishPatternScore: 0.14 }
    },
    newsSummary: { riskScore: 0.04, sentimentScore: 0.06, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.08, signalScore: 0.1, crowdingBias: 0.06, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.04, bullishScore: 0, urgencyScore: 0 },
    committeeSummary: { agreement: 0.62, probability: 0.66, netScore: 0.14, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.03 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.62, confidence: 0.46, blockers: [], agreementGap: 0.04, optimizer: { sampleSize: 12, sampleConfidence: 0.7 } },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.74 },
    qualityQuorumSummary: { status: "observe_only", observeOnly: true, quorumScore: 0.38, blockerReasons: ["local_book", "provider_ops"] },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.ok(decision.reasons.includes("quality_quorum_observe_only"));
});

await runCheck("risk manager blocks retired strategies and hot execution cost scopes", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.66,
      calibrationConfidence: 0.42,
      disagreement: 0.04,
      shouldAbstain: false,
      transformer: { probability: 0.65, confidence: 0.2 }
    },
    marketSnapshot: {
      book: { spreadBps: 4, bookPressure: 0.22, microPriceEdgeBps: 0.8 },
      market: { realizedVolPct: 0.018, atrPct: 0.009, bearishPatternScore: 0.04, bullishPatternScore: 0.14 }
    },
    newsSummary: { riskScore: 0.04, sentimentScore: 0.06, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.08, signalScore: 0.1, crowdingBias: 0.06, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.04, bullishScore: 0, urgencyScore: 0 },
    committeeSummary: { agreement: 0.62, probability: 0.66, netScore: 0.14, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.03 },
    strategySummary: { activeStrategy: "donchian_breakout", family: "breakout", fitScore: 0.62, confidence: 0.46, blockers: [], agreementGap: 0.04, optimizer: { sampleSize: 12, sampleConfidence: 0.7 } },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "breakout", confidence: 0.74 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.88, blockerReasons: [] },
    strategyRetirementSummary: {
      policies: [{ id: "donchian_breakout", status: "retire", sizeMultiplier: 0, confidence: 0.8, note: "governance retired" }]
    },
    executionCostSummary: {
      status: "blocked",
      strategies: [{ id: "donchian_breakout", status: "blocked", averageTotalCostBps: 19, averageSlippageDeltaBps: 5 }],
      regimes: [{ id: "breakout", status: "blocked", averageTotalCostBps: 17, averageSlippageDeltaBps: 4.8 }]
    },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.ok(decision.reasons.includes("strategy_retired"));
  assert.ok(decision.reasons.includes("execution_cost_budget_exceeded"));
});

await runCheck("risk manager respects capital governor recovery and blocking states", async () => {
  const manager = new RiskManager(makeConfig({ botMode: "live" }));
  const blocked = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: { probability: 0.67, calibrationConfidence: 0.42, disagreement: 0.04, shouldAbstain: false, transformer: { probability: 0.65, confidence: 0.2 } },
    marketSnapshot: { book: { spreadBps: 4, bookPressure: 0.22, microPriceEdgeBps: 0.8 }, market: { realizedVolPct: 0.018, atrPct: 0.009, bearishPatternScore: 0.04, bullishPatternScore: 0.14 } },
    newsSummary: { riskScore: 0.04, sentimentScore: 0.06, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.08, signalScore: 0.1, crowdingBias: 0.06, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.04, bullishScore: 0, urgencyScore: 0 },
    committeeSummary: { agreement: 0.62, probability: 0.66, netScore: 0.14, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.03 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.62, confidence: 0.46, blockers: [], agreementGap: 0.04 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.74 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.88, blockerReasons: [] },
    capitalGovernorSummary: { status: "blocked", allowEntries: false, sizeMultiplier: 0, recoveryMode: true, notes: ["weekly drawdown"] },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(blocked.allow, false);
  assert.ok(blocked.reasons.includes("capital_governor_blocked"));

  const recovery = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: { probability: 0.69, calibrationConfidence: 0.42, disagreement: 0.04, shouldAbstain: false, transformer: { probability: 0.68, confidence: 0.2 } },
    marketSnapshot: { book: { spreadBps: 4, bookPressure: 0.24, microPriceEdgeBps: 0.8 }, market: { realizedVolPct: 0.018, atrPct: 0.009, bearishPatternScore: 0.04, bullishPatternScore: 0.14 } },
    newsSummary: { riskScore: 0.04, sentimentScore: 0.06, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.08, signalScore: 0.1, crowdingBias: 0.06, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.04, bullishScore: 0, urgencyScore: 0 },
    committeeSummary: { agreement: 0.62, probability: 0.66, netScore: 0.14, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.03 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.62, confidence: 0.46, blockers: [], agreementGap: 0.04 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.74 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.88, blockerReasons: [] },
    capitalGovernorSummary: { status: "recovery", allowEntries: true, sizeMultiplier: 0.42, recoveryMode: true, notes: ["recovery sizing"] },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(recovery.allow, true);
  assert.equal(recovery.capitalGovernorApplied.status, "recovery");
  assert.ok(recovery.quoteAmount < 500);
});

await runCheck("risk manager blocks aggressive spot longs during strong downtrends when shorting is unavailable", async () => {
  const manager = new RiskManager(makeConfig({ botMode: "live", userRegion: "BE" }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.61,
      calibrationConfidence: 0.44,
      disagreement: 0.04,
      shouldAbstain: false,
      transformer: { probability: 0.6, confidence: 0.16 }
    },
    marketSnapshot: {
      book: { spreadBps: 4, bookPressure: 0.04, microPriceEdgeBps: 0.1 },
      market: {
        realizedVolPct: 0.026,
        atrPct: 0.011,
        bearishPatternScore: 0.58,
        bullishPatternScore: 0.08,
        momentum20: -0.032,
        emaGap: -0.018,
        dmiSpread: -0.22,
        supertrendDirection: -1
      }
    },
    newsSummary: { riskScore: 0.05, sentimentScore: 0.01, eventBullishScore: 0, eventBearishScore: 0, socialSentiment: 0, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.12, signalScore: 0.05, crowdingBias: 0.04, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0, longSqueezeScore: 0.42 },
    calendarSummary: { riskScore: 0.05, bullishScore: 0, urgencyScore: 0 },
    committeeSummary: { agreement: 0.58, probability: 0.6, netScore: 0.1, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.02 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.66, confidence: 0.48, blockers: [], agreementGap: 0.05 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.76 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.92, blockerReasons: [] },
    exchangeCapabilitiesSummary: resolveExchangeCapabilities({ userRegion: "BE" }),
    nowIso: "2026-03-11T10:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.ok(decision.reasons.includes("spot_downtrend_guard"));
  assert.equal(decision.exchangeCapabilitiesApplied.shortingEnabled, false);
  assert.equal(decision.downtrendPolicy.strongDowntrend, true);
});

await runCheck("risk manager rewards stronger portfolio allocator scores in rank ordering", async () => {
  const manager = new RiskManager(makeConfig());
  const commonInput = {
    symbol: "BTCUSDT",
    score: {
      probability: 0.68,
      calibrationConfidence: 0.42,
      disagreement: 0.04,
      shouldAbstain: false,
      transformer: { probability: 0.65, confidence: 0.2 }
    },
    marketSnapshot: {
      book: { spreadBps: 4, bookPressure: 0.2, microPriceEdgeBps: 0.8 },
      market: { realizedVolPct: 0.018, atrPct: 0.009, bearishPatternScore: 0.04, bullishPatternScore: 0.14 }
    },
    newsSummary: { riskScore: 0.04, sentimentScore: 0.06, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.08, signalScore: 0.1, crowdingBias: 0.06, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.04, bullishScore: 0, urgencyScore: 0 },
    committeeSummary: { agreement: 0.62, probability: 0.66, netScore: 0.14, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.03 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.62, confidence: 0.46, blockers: [], agreementGap: 0.04, optimizer: { sampleSize: 12, sampleConfidence: 0.7 } },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    regimeSummary: { regime: "trend", confidence: 0.74 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.88, blockerReasons: [] },
    nowIso: "2026-03-08T10:00:00.000Z"
  };
  const lowAllocator = manager.evaluateEntry({
    ...commonInput,
    portfolioSummary: { sizeMultiplier: 1, allocatorScore: 0.18, maxCorrelation: 0, reasons: [] }
  });
  const highAllocator = manager.evaluateEntry({
    ...commonInput,
    portfolioSummary: { sizeMultiplier: 1, allocatorScore: 0.82, maxCorrelation: 0, reasons: [] }
  });
  assert.ok(highAllocator.rankScore > lowAllocator.rankScore);
});

await runCheck("risk manager can allow small paper warm-up entries near threshold", async () => {
  const manager = new RiskManager(makeConfig({ paperExplorationMinBookPressure: -0.42 }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.468,
      calibrationConfidence: 0.22,
      disagreement: 0.06,
      shouldAbstain: false,
      calibrator: { warmupProgress: 0.15, globalConfidence: 0.15 },
      transformer: { probability: 0.49, confidence: 0.04 }
    },
    marketSnapshot: {
      book: { spreadBps: 2, bookPressure: -0.34, microPriceEdgeBps: 0.2 },
      market: { realizedVolPct: 0.018, atrPct: 0.01, bearishPatternScore: 0.08, bullishPatternScore: 0.22, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.08, sentimentScore: 0.04, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.14, signalScore: 0.06, crowdingBias: 0.04, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.32, contrarianScore: 0.18 },
    volatilitySummary: { riskScore: 0.52, ivPremium: 5 },
    calendarSummary: { riskScore: 0.1, bullishScore: 0, urgencyScore: 0.08 },
    committeeSummary: { agreement: 0.31, probability: 0.46, netScore: -0.06, sizeMultiplier: 0.92, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.35, expectedReward: 0.01 },
    strategySummary: {
      activeStrategy: "ema_trend",
      family: "trend_following",
      fitScore: 0.47,
      confidence: 0.42,
      blockers: [],
      agreementGap: 0.03,
      optimizer: { sampleSize: 0, sampleConfidence: 0 }
    },
    sessionSummary: { blockerReasons: [], lowLiquidity: false, riskScore: 0.02, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.08 },
    selfHealState: { mode: "normal", active: false, sizeMultiplier: 1, thresholdPenalty: 0, lowRiskOnly: false },
    metaSummary: { action: "pass", score: 0.61, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.72 },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.entryMode, "paper_exploration");
  assert.ok(decision.quoteAmount >= makeConfig().minTradeUsdt);
  assert.ok(decision.suppressedReasons.includes("model_confidence_too_low"));
});

await runCheck("risk manager can keep paper exploration available after warm-up when only soft blockers remain", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "ETHUSDT",
    score: {
      probability: 0.492,
      calibrationConfidence: 0.46,
      disagreement: 0.04,
      shouldAbstain: false,
      calibrator: { warmupProgress: 1, globalConfidence: 0.92 },
      transformer: { probability: 0.5, confidence: 0.08 }
    },
    marketSnapshot: {
      book: { spreadBps: 3, bookPressure: -0.18, microPriceEdgeBps: 0.15 },
      market: { realizedVolPct: 0.014, atrPct: 0.009, bearishPatternScore: 0.06, bullishPatternScore: 0.12, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.06, sentimentScore: 0.05, eventBullishScore: 0.03, eventBearishScore: 0, socialSentiment: 0.02, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.1, signalScore: 0.04, crowdingBias: 0.03, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.26, contrarianScore: 0.14 },
    volatilitySummary: { riskScore: 0.44, ivPremium: 4 },
    calendarSummary: { riskScore: 0.08, bullishScore: 0, urgencyScore: 0.05 },
    committeeSummary: { agreement: 0.33, probability: 0.49, netScore: -0.04, sizeMultiplier: 0.95, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.38, expectedReward: 0.012 },
    strategySummary: {
      activeStrategy: "vwap_trend",
      family: "trend_following",
      fitScore: 0.52,
      confidence: 0.44,
      blockers: [],
      agreementGap: 0.04,
      optimizer: { sampleSize: 0, sampleConfidence: 0 }
    },
    sessionSummary: { blockerReasons: [], lowLiquidity: false, riskScore: 0.01, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.06 },
    selfHealState: { mode: "normal", active: false, sizeMultiplier: 1, thresholdPenalty: 0, lowRiskOnly: false },
    metaSummary: { action: "pass", score: 0.64, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "range", confidence: 0.68 },
    nowIso: "2026-03-08T12:00:00.000Z"
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.entryMode, "paper_exploration");
  assert.ok(decision.suppressedReasons.includes("model_confidence_too_low"));
});

await runCheck("risk manager keeps paper exploration available for governance pauses and paper-only guardrails", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "SOLUSDT",
    score: {
      probability: 0.5,
      calibrationConfidence: 0.44,
      disagreement: 0.04,
      shouldAbstain: false,
      transformer: { probability: 0.51, confidence: 0.08 }
    },
    marketSnapshot: {
      book: { spreadBps: 3, bookPressure: -0.14, microPriceEdgeBps: 0.22 },
      market: { realizedVolPct: 0.013, atrPct: 0.008, bearishPatternScore: 0.05, bullishPatternScore: 0.12, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.05, sentimentScore: 0.06, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.02, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.09, signalScore: 0.05, crowdingBias: 0.03, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.24, contrarianScore: 0.12 },
    volatilitySummary: { riskScore: 0.4, ivPremium: 3 },
    calendarSummary: { riskScore: 0.06, bullishScore: 0, urgencyScore: 0.03 },
    committeeSummary: { agreement: 0.34, probability: 0.49, netScore: -0.03, sizeMultiplier: 0.95, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.36, expectedReward: 0.01 },
    strategySummary: {
      activeStrategy: "ema_trend",
      family: "trend_following",
      fitScore: 0.51,
      confidence: 0.44,
      blockers: [],
      agreementGap: 0.03,
      optimizer: { sampleSize: 8, sampleConfidence: 0.6 }
    },
    sessionSummary: { blockerReasons: [], lowLiquidity: false, riskScore: 0.01, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.1 },
    selfHealState: { mode: "paused", active: true, sizeMultiplier: 0, thresholdPenalty: 0.12, lowRiskOnly: true, issues: ["drawdown_limit"] },
    metaSummary: { action: "pass", score: 0.65, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.7 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.9, blockerReasons: [] },
    executionCostSummary: {
      status: "blocked",
      strategies: [{ id: "ema_trend", status: "blocked", averageTotalCostBps: 18, averageSlippageDeltaBps: 4 }]
    },
    capitalGovernorSummary: { status: "blocked", allowEntries: false, sizeMultiplier: 0, recoveryMode: false, notes: ["paper keep learning"] },
    nowIso: "2026-03-08T13:00:00.000Z"
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.entryMode, "paper_exploration");
  assert.ok(decision.suppressedReasons.includes("self_heal_pause_entries"));
  assert.ok(decision.suppressedReasons.includes("execution_cost_budget_exceeded"));
  assert.ok(decision.suppressedReasons.includes("capital_governor_blocked"));
  assert.ok(decision.paperGuardrailRelief.includes("self_heal_pause_entries"));
});

await runCheck("risk manager uses paper recovery probe for capital governor recovery with sub-min trade sizing", async () => {
  const manager = new RiskManager(makeConfig({
    maxPositionFraction: 0.05,
    riskPerTrade: 0.002,
    minTradeUsdt: 25,
    paperRecoveryProbeSizeMultiplier: 0.22
  }));
  const decision = manager.evaluateEntry({
    symbol: "ADAUSDT",
    score: {
      probability: 0.508,
      calibrationConfidence: 0.52,
      disagreement: 0.03,
      shouldAbstain: false,
      transformer: { probability: 0.52, confidence: 0.09 }
    },
    marketSnapshot: {
      book: { spreadBps: 2.5, bookPressure: -0.12, microPriceEdgeBps: 0.16 },
      market: { realizedVolPct: 0.015, atrPct: 0.01, bearishPatternScore: 0.04, bullishPatternScore: 0.14, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.05, sentimentScore: 0.04, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.11, signalScore: 0.04, crowdingBias: 0.02, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.24, contrarianScore: 0.12 },
    volatilitySummary: { riskScore: 0.42, ivPremium: 4 },
    calendarSummary: { riskScore: 0.07, bullishScore: 0, urgencyScore: 0.02 },
    committeeSummary: { agreement: 0.35, probability: 0.51, netScore: -0.02, sizeMultiplier: 0.96, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.37, expectedReward: 0.01 },
    strategySummary: {
      activeStrategy: "pullback_trend",
      family: "trend_following",
      fitScore: 0.55,
      confidence: 0.46,
      blockers: [],
      agreementGap: 0.03,
      optimizer: { sampleSize: 10, sampleConfidence: 0.62 }
    },
    sessionSummary: { blockerReasons: [], lowLiquidity: false, riskScore: 0.01, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.06 },
    selfHealState: { mode: "normal", active: false, sizeMultiplier: 1, thresholdPenalty: 0, lowRiskOnly: false },
    metaSummary: { action: "pass", score: 0.64, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 120 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.72 },
    capitalGovernorSummary: { status: "blocked", allowEntries: false, sizeMultiplier: 0, recoveryMode: true, notes: ["drawdown recovery active"] },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.88, blockerReasons: [] },
    nowIso: "2026-03-11T09:00:00.000Z"
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.entryMode, "paper_recovery_probe");
  assert.ok(decision.suppressedReasons.includes("capital_governor_blocked"));
  assert.ok(decision.suppressedReasons.includes("capital_governor_recovery"));
  assert.ok(decision.suppressedReasons.includes("trade_size_below_minimum"));
  assert.ok(decision.paperGuardrailRelief.includes("trade_size_below_minimum"));
  assert.ok(decision.quoteAmount > 0);
  assert.ok(decision.quoteAmount < makeConfig().minTradeUsdt);
  assert.equal(decision.paperExploration?.allowMinTradeOverride, true);
});

await runCheck("risk manager keeps paper recovery probe blocked when market quality blockers remain", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "ADAUSDT",
    score: {
      probability: 0.528,
      calibrationConfidence: 0.5,
      disagreement: 0.03,
      shouldAbstain: false,
      transformer: { probability: 0.53, confidence: 0.09 }
    },
    marketSnapshot: {
      book: { spreadBps: 2.5, bookPressure: -0.41, microPriceEdgeBps: 0.16 },
      market: { realizedVolPct: 0.015, atrPct: 0.01, bearishPatternScore: 0.04, bullishPatternScore: 0.14, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.05, sentimentScore: 0.04, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.11, signalScore: 0.04, crowdingBias: 0.02, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.24, contrarianScore: 0.12 },
    volatilitySummary: { riskScore: 0.42, ivPremium: 4 },
    calendarSummary: { riskScore: 0.07, bullishScore: 0, urgencyScore: 0.02 },
    committeeSummary: { agreement: 0.35, probability: 0.53, netScore: -0.02, sizeMultiplier: 0.96, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.37, expectedReward: 0.01 },
    strategySummary: {
      activeStrategy: "pullback_trend",
      family: "trend_following",
      fitScore: 0.55,
      confidence: 0.46,
      blockers: [],
      agreementGap: 0.03,
      optimizer: { sampleSize: 10, sampleConfidence: 0.62 }
    },
    sessionSummary: { blockerReasons: [], lowLiquidity: false, riskScore: 0.01, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.06 },
    selfHealState: { mode: "normal", active: false, sizeMultiplier: 1, thresholdPenalty: 0, lowRiskOnly: false },
    metaSummary: { action: "pass", score: 0.64, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 120 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.72 },
    capitalGovernorSummary: { status: "blocked", allowEntries: false, sizeMultiplier: 0, recoveryMode: true, notes: ["drawdown recovery active"] },
    qualityQuorumSummary: { status: "degraded", observeOnly: false, quorumScore: 0.51, blockerReasons: ["local_book_quality_too_low"], cautionReasons: [] },
    nowIso: "2026-03-11T09:05:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.notEqual(decision.entryMode, "paper_recovery_probe");
  assert.ok(decision.reasons.includes("orderbook_sell_pressure"));
  assert.ok(decision.reasons.includes("quality_quorum_degraded"));
});

await runCheck("risk manager keeps health-circuit self heal as a hard paper block", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "SOLUSDT",
    score: {
      probability: 0.5,
      calibrationConfidence: 0.44,
      disagreement: 0.04,
      shouldAbstain: false,
      transformer: { probability: 0.51, confidence: 0.08 }
    },
    marketSnapshot: {
      book: { spreadBps: 3, bookPressure: -0.14, microPriceEdgeBps: 0.22 },
      market: { realizedVolPct: 0.013, atrPct: 0.008, bearishPatternScore: 0.05, bullishPatternScore: 0.12, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.05, sentimentScore: 0.06, eventBullishScore: 0.02, eventBearishScore: 0, socialSentiment: 0.02, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.09, signalScore: 0.05, crowdingBias: 0.03, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.24, contrarianScore: 0.12 },
    volatilitySummary: { riskScore: 0.4, ivPremium: 3 },
    calendarSummary: { riskScore: 0.06, bullishScore: 0, urgencyScore: 0.03 },
    committeeSummary: { agreement: 0.34, probability: 0.49, netScore: -0.03, sizeMultiplier: 0.95, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.36, expectedReward: 0.01 },
    strategySummary: {
      activeStrategy: "ema_trend",
      family: "trend_following",
      fitScore: 0.51,
      confidence: 0.44,
      blockers: [],
      agreementGap: 0.03
    },
    sessionSummary: { blockerReasons: [], lowLiquidity: false, riskScore: 0.01, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.1 },
    selfHealState: { mode: "paused", active: true, sizeMultiplier: 0, thresholdPenalty: 0.12, lowRiskOnly: true, issues: ["health_circuit_open"] },
    metaSummary: { action: "pass", score: 0.65, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.7 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.9, blockerReasons: [] },
    nowIso: "2026-03-08T13:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.ok(decision.reasons.includes("self_heal_pause_entries"));
});

await runCheck("execution engine applies committee, rl and strategy modifiers", async () => {
  const engine = new ExecutionEngine(makeConfig({ botMode: "live" }));
  const plan = engine.buildEntryPlan({
    symbol: "BTCUSDT",
    marketSnapshot: { book: { spreadBps: 8, tradeFlowImbalance: 0.25 } },
    score: { probability: 0.66 },
    decision: { regime: "trend" },
    regimeSummary: { regime: "trend" },
    strategySummary: { activeStrategy: "trend_following", fitScore: 0.74 },
    portfolioSummary: { sizeMultiplier: 0.9 },
    committeeSummary: { agreement: 0.72, netScore: 0.18 },
    rlAdvice: { action: "aggressive", patienceMultiplier: 1.2, sizeMultiplier: 1.08, preferMakerBoost: 0.18, expectedReward: 0.12 }
  });
  assert.equal(plan.rlAction, "aggressive");
  assert.equal(plan.strategy, "trend_following");
  assert.ok(plan.makerPatienceMs > 3000);
  assert.ok(plan.entryStyle === "limit_maker" || plan.entryStyle === "market");
});

await runCheck("performance report summarizes journal metrics", async () => {
  const report = buildPerformanceReport({
    journal: {
      trades: [
        {
          pnlQuote: 10,
          netPnlPct: 0.01,
          entryExecutionAttribution: { entryStyle: "pegged_limit_maker", makerFillRatio: 0.82, realizedTouchSlippageBps: 0.3, peggedOrder: true },
          exitExecutionAttribution: { entryStyle: "market_exit", realizedTouchSlippageBps: 0.6 }
        },
        {
          pnlQuote: -5,
          netPnlPct: -0.005,
          entryExecutionAttribution: { entryStyle: "market", makerFillRatio: 0, realizedTouchSlippageBps: 1.8, preventedQuantity: 0.001, preventedMatchCount: 1 },
          exitExecutionAttribution: { entryStyle: "market_exit", realizedTouchSlippageBps: 1.1 }
        }
      ],
      equitySnapshots: [
        { equity: 10000 },
        { equity: 9900 },
        { equity: 10100 }
      ]
    },
    runtime: {
      openPositions: [{ notional: 300 }]
    },
    config: {
      reportLookbackTrades: 50
    }
  });
  assert.equal(report.tradeCount, 2);
  assert.ok(report.maxDrawdownPct > 0);
  assert.equal(report.openExposure, 300);
  assert.ok(report.executionSummary.styles.length >= 1);
  assert.ok(report.executionSummary.avgEntryTouchSlippageBps >= 0);
});

await runCheck("performance report respects dashboard series limits", async () => {
  const report = buildPerformanceReport({
    journal: {
      trades: [],
      equitySnapshots: Array.from({ length: 500 }, (_, index) => ({ equity: 10000 + index })),
      cycles: Array.from({ length: 320 }, (_, index) => ({ at: `2026-03-08T10:${String(index % 60).padStart(2, "0")}:00.000Z`, cycle: index }))
    },
    runtime: {
      openPositions: []
    },
    config: {
      reportLookbackTrades: 50,
      dashboardEquityPointLimit: 144,
      dashboardCyclePointLimit: 72
    }
  });
  assert.equal(report.equitySeries.length, 144);
  assert.equal(report.cycleSeries.length, 72);
});

await runCheck("adaptive model keeps cold-start setups eligible when calibration is still warming up", async () => {
  const model = new AdaptiveTradingModel(undefined, makeConfig());
  const score = model.score(
    { momentum_20: 1.1, ema_gap: 0.45, breakout_pct: 0.18, book_pressure: 0.22 },
    {
      regimeSummary: { regime: "trend", confidence: 0.7, bias: 0.2, reasons: ["persistent_trend"] },
      marketFeatures: { momentum20: 0.02, emaGap: 0.01 },
      marketSnapshot: {
        candles: Array.from({ length: 24 }, (_, index) => ({ open: 100 + index, high: 101 + index, low: 99 + index, close: 100.5 + index, volume: 10 + index })),
        market: { momentum20: 0.02, emaGap: 0.01 },
        book: { bookPressure: 0.24 },
        stream: { tradeFlowImbalance: 0.08 }
      },
      newsSummary: { sentimentScore: 0.08, riskScore: 0.04 },
      streamFeatures: { tradeFlowImbalance: 0.08, microTrend: 0.001 }
    }
  );
  assert.ok(score.calibrationConfidence >= 0.22);
  assert.equal(score.shouldAbstain, false);
});









await runCheck("risk manager exits on spread shock and orderbook reversal", async () => {
  const manager = new RiskManager(makeConfig({ exitOnSpreadShockBps: 12 }));
  const decision = manager.evaluateExit({
    position: {
      entryAt: "2026-03-08T08:00:00.000Z",
      entryPrice: 100,
      stopLossPrice: 95,
      takeProfitPrice: 110,
      trailingStopPct: 0.01,
      highestPrice: 104,
      lowestPrice: 99
    },
    currentPrice: 104.2,
    newsSummary: { riskScore: 0, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.6, signalScore: -0.2, liquidationCount: 2, liquidationImbalance: -0.7 },
    calendarSummary: { riskScore: 0, proximityHours: 999 },
    marketSnapshot: {
      book: { spreadBps: 14, bookPressure: -0.7 },
      market: { bearishPatternScore: 0.6 }
    },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.shouldExit, true);
  assert.ok(["spread_shock_exit", "orderbook_reversal_exit", "liquidation_shock_exit"].includes(decision.reason));
});
await runCheck("session manager flags weekend funding and low liquidity windows", async () => {
  const paperSummary = buildSessionSummary({
    now: new Date("2026-03-08T23:55:00.000Z"),
    marketSnapshot: {
      book: { spreadBps: 9, totalDepthNotional: 50000, depthConfidence: 0.2 },
      market: { realizedVolPct: 0.05 }
    },
    marketStructureSummary: { nextFundingTime: "2026-03-09T00:00:00.000Z" },
    config: makeConfig()
  });
  assert.equal(paperSummary.isWeekend, true);
  assert.equal(paperSummary.inFundingCaution, true);
  assert.equal(paperSummary.inHardFundingBlock, true);
  assert.equal(paperSummary.lowLiquidity, true);
  assert.ok(!paperSummary.blockerReasons.includes("funding_settlement_window"));
  assert.ok(paperSummary.reasons.includes("funding_settlement_window_watch"));

  const liveSummary = buildSessionSummary({
    now: new Date("2026-03-08T23:55:00.000Z"),
    marketSnapshot: {
      book: { spreadBps: 9, totalDepthNotional: 50000, depthConfidence: 0.2 },
      market: { realizedVolPct: 0.05 }
    },
    marketStructureSummary: { nextFundingTime: "2026-03-09T00:00:00.000Z" },
    config: makeConfig({ botMode: "live" })
  });
  assert.ok(liveSummary.blockerReasons.includes("funding_settlement_window"));
});

await runCheck("adaptive model reports feature drift after learning a baseline", async () => {
  const config = makeConfig();
  const model = new AdaptiveTradingModel(undefined, config);
  for (let index = 0; index < 24; index += 1) {
    model.updateFromTrade({
      symbol: "BTCUSDT",
      rawFeatures: { momentum_5: 0.2, news_sentiment: 0.1, session_risk: 0.1, book_pressure: 0.05, regime_trend: 1 },
      netPnlPct: 0.01,
      mfePct: 0.02,
      maePct: -0.005,
      executionQualityScore: 0.7,
      regimeAtEntry: "trend",
      exitAt: `2026-03-08T12:${String(index).padStart(2, "0")}:00.000Z`
    });
  }
  const drift = model.assessFeatureDrift({ momentum_5: 3, news_sentiment: -2, session_risk: 0.9, book_pressure: -2, regime_trend: 1 }, "trend");
  assert.ok(drift.comparableFeatures >= 5);
  assert.ok(drift.averageAbsZ > 1);
});

await runCheck("drift monitor escalates candidate and runtime drift", async () => {
  const monitor = new DriftMonitor(makeConfig(), { warn() {} });
  const candidate = monitor.evaluateCandidate({
    symbol: "BTCUSDT",
    rawFeatures: { momentum_5: 2 },
    score: {},
    regimeSummary: { regime: "trend" },
    newsSummary: { reliabilityScore: 0.2, coverage: 3 },
    marketSnapshot: { book: { depthConfidence: 0.1 } },
    model: {
      assessFeatureDrift() {
        return {
          comparableFeatures: 6,
          averageAbsZ: 2.3,
          maxAbsZ: 4.1,
          driftedFeatures: [{ name: "momentum_5", zScore: 4.1, rawValue: 2, mean: 0.1, count: 24 }]
        };
      }
    }
  });
  assert.ok(candidate.blockerReasons.includes("feature_drift_too_high"));
  assert.ok(candidate.blockerReasons.includes("local_book_quality_too_low"));

  const runtime = monitor.summarizeRuntime({
    runtime: {},
    report: {
      executionSummary: { avgEntryTouchSlippageBps: 10 },
      windows: { today: { realizedPnl: -400 } },
      maxDrawdownPct: 0.04
    },
    stream: { localBook: { trackedSymbols: 10, healthySymbols: 2 } },
    health: { circuitOpen: false },
    calibration: { observations: 24, expectedCalibrationError: 0.31 },
    candidateSummaries: [
      { drift: candidate, confidence: 0.05 },
      { drift: candidate, confidence: 0.08 },
      { drift: candidate, confidence: 0.1 }
    ],
    botMode: "live"
  });
  assert.equal(runtime.status, "critical");
  assert.ok(runtime.blockerReasons.includes("live_drift_guard"));
});

await runCheck("self heal manager falls back to paper on critical live degradation", async () => {
  const manager = new SelfHealManager(makeConfig(), { warn() {} });
  const state = manager.evaluate({
    previousState: manager.buildDefaultState(),
    report: {
      recentTrades: [{ pnlQuote: -10 }, { pnlQuote: -12 }, { pnlQuote: -8 }],
      windows: { today: { realizedPnl: -380 } },
      maxDrawdownPct: 0.04
    },
    driftSummary: { severity: 0.9 },
    health: { circuitOpen: false },
    calibration: { observations: 24, expectedCalibrationError: 0.3 },
    botMode: "live",
    hasStableModel: true,
    now: new Date("2026-03-08T12:00:00.000Z")
  });
  assert.equal(state.mode, "paper_fallback");
  assert.ok(state.actions.includes("switch_to_paper"));
  assert.ok(state.actions.includes("reset_rl_policy"));
  assert.ok(state.actions.includes("restore_stable_model"));
});

await runCheck("bot manager stops instead of switching live positions to paper", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-manager-"));
  try {
    const envPath = path.join(tempDir, ".env");
    await fs.writeFile(envPath, "BOT_MODE=live\n");
    const manager = new BotManager({ projectRoot: tempDir, logger: { warn() {}, error() {} } });
    manager.config = { botMode: "live", envPath };
    manager.bot = {
      runtime: {
        openPositions: [{ symbol: "BTCUSDT" }]
      },
      async refreshAnalysis() {}
    };
    let reinitialized = false;
    manager.reinitializeBot = async () => {
      reinitialized = true;
    };
    manager.runState = "running";
    const result = await manager.applySelfHealManagerAction({
      managerAction: "switch_to_paper",
      reason: "drawdown_guard"
    });
    const env = await fs.readFile(envPath, "utf8");
    assert.equal(result, "paper_switch_blocked_open_positions");
    assert.equal(reinitialized, false);
    assert.equal(manager.stopRequested, true);
    assert.equal(manager.stopReason, "self_heal_live_positions_open");
    assert.match(env, /BOT_MODE=live/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("bot manager surfaces readiness blockers from the dashboard snapshot", async () => {
  const manager = new BotManager({ projectRoot: process.cwd(), logger: { warn() {}, error() {} } });
  const readiness = manager.buildOperationalReadiness({
    manager: {
      runState: "running",
      currentMode: "live",
      lastError: { message: "cycle failed" }
    },
    dashboard: {
      overview: { lastAnalysisAt: "2026-03-11T08:00:00.000Z" },
      health: { circuitOpen: true },
      safety: {
        exchangeTruth: { freezeEntries: true },
        orderLifecycle: { pendingActions: [{ state: "manual_review" }] }
      }
    }
  });
  assert.equal(readiness.ok, false);
  assert.ok(readiness.reasons.includes("manager_error"));
  assert.ok(readiness.reasons.includes("health_circuit_open"));
  assert.ok(readiness.reasons.includes("exchange_truth_freeze"));
});

await runCheck("config validation blocks inverted drift thresholds", async () => {
  const result = validateConfig(makeConfig({
    driftFeatureScoreAlert: 2,
    driftFeatureScoreBlock: 1.5
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("DRIFT_FEATURE_SCORE_BLOCK")));
});

await runCheck("config loader parses recorder and backup settings", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-config-"));
  try {
    await fs.writeFile(path.join(tempDir, ".env"), [
      "WATCHLIST=BTCUSDT",
      "DATA_RECORDER_ENABLED=true",
      "DATA_RECORDER_RETENTION_DAYS=17",
      "MODEL_REGISTRY_MIN_SCORE=0.63",
      "MODEL_REGISTRY_ROLLBACK_DRAWDOWN_PCT=0.07",
      "MODEL_REGISTRY_MAX_ENTRIES=9",
      "STATE_BACKUP_ENABLED=true",
      "STATE_BACKUP_INTERVAL_MINUTES=45",
      "STATE_BACKUP_RETENTION=8",
      "SERVICE_RESTART_DELAY_SECONDS=11",
      "SERVICE_MAX_RESTARTS_PER_HOUR=14",
      "GIT_SHORT_CLONE_PATH=C:\\code\\short-bot"
    ].join("\n"));
    const config = await loadConfig(tempDir);
    assert.equal(config.dataRecorderEnabled, true);
    assert.equal(config.dataRecorderRetentionDays, 17);
    assert.equal(config.modelRegistryMinScore, 0.63);
    assert.equal(config.modelRegistryRollbackDrawdownPct, 0.07);
    assert.equal(config.modelRegistryMaxEntries, 9);
    assert.equal(config.stateBackupEnabled, true);
    assert.equal(config.stateBackupIntervalMinutes, 45);
    assert.equal(config.stateBackupRetention, 8);
    assert.equal(config.serviceRestartDelaySeconds, 11);
    assert.equal(config.serviceMaxRestartsPerHour, 14);
    assert.equal(config.gitShortClonePath, "C:\\code\\short-bot");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("data recorder restores persisted summary across restarts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-recorder-restore-"));
  try {
    await fs.mkdir(path.join(tempDir, "feature-store", "decisions"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "feature-store", "decisions", "2026-03-10.jsonl"), "{}\n");
    const recorder = new DataRecorder({
      runtimeDir: tempDir,
      config: { dataRecorderEnabled: true, dataRecorderRetentionDays: 21 },
      logger: { info() {}, warn() {} }
    });
    await recorder.init({
      lastRecordAt: "2026-03-10T09:00:00.000Z",
      filesWritten: 9,
      cycleFrames: 3,
      decisionFrames: 12,
      tradeFrames: 2,
      learningFrames: 2,
      researchFrames: 1,
      snapshotFrames: 4
    });
    const summary = recorder.getSummary();
    assert.equal(summary.filesWritten, 9);
    assert.equal(summary.learningFrames, 2);
    assert.equal(summary.snapshotFrames, 4);
    assert.equal(summary.lastRecordAt, "2026-03-10T09:00:00.000Z");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("state backup manager restores existing backup count and timestamp", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-backup-restore-"));
  try {
    const manager = new StateBackupManager({
      runtimeDir: tempDir,
      config: { stateBackupEnabled: true, stateBackupRetention: 6, stateBackupIntervalMinutes: 30 },
      logger: { info() {}, warn() {} }
    });
    await fs.mkdir(path.join(tempDir, "backups"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "backups", "backup-2026-03-10T08-11-49.918Z.json"), JSON.stringify({ at: "2026-03-10T08:11:49.918Z" }));
    await manager.init({ backupCount: 0 });
    const summary = manager.getSummary();
    assert.equal(summary.backupCount, 1);
    assert.equal(summary.lastBackupAt, "2026-03-10T08:11:49.918Z");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("state store removes stale temp files during init", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-state-store-"));
  try {
    await fs.writeFile(path.join(tempDir, "model.json.123.tmp"), "{}");
    const store = new StateStore(tempDir);
    await store.init();
    await assert.rejects(fs.access(path.join(tempDir, "model.json.123.tmp")));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("state store migrates runtime and journal schemas forward", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-state-store-migrate-"));
  try {
    await fs.writeFile(path.join(tempDir, "runtime.json"), JSON.stringify({
      openPositions: [{ symbol: "BTCUSDT" }],
      health: { consecutiveFailures: 1 }
    }));
    await fs.writeFile(path.join(tempDir, "journal.json"), JSON.stringify({
      trades: [{ symbol: "BTCUSDT", exitAt: "2026-03-10T10:00:00.000Z" }]
    }));
    const store = new StateStore(tempDir);
    const runtime = await store.loadRuntime();
    const journal = await store.loadJournal();
    assert.equal(runtime.schemaVersion, 6);
    assert.deepEqual(runtime.qualityQuorum, {});
    assert.equal(runtime.exchangeTruth.status, "unknown");
    assert.deepEqual(runtime.orderLifecycle.positions, {});
    assert.deepEqual(runtime.orderLifecycle.activeActions, {});
    assert.ok(Array.isArray(runtime.orderLifecycle.actionJournal));
    assert.deepEqual(runtime.executionCalibration, {});
    assert.deepEqual(runtime.strategyResearch, {});
    assert.deepEqual(runtime.parameterGovernor, {});
    assert.deepEqual(runtime.venueConfirmation, {});
    assert.deepEqual(runtime.capitalLadder, {});
    assert.deepEqual(runtime.capitalGovernor, {});
    assert.ok(Array.isArray(runtime.ops.incidentTimeline));
    assert.deepEqual(runtime.ops.alertState.acknowledgedAtById, {});
    assert.equal(runtime.health.consecutiveFailures, 1);
    assert.equal(journal.schemaVersion, 2);
    assert.equal(journal.trades.length, 1);
    assert.ok(Array.isArray(journal.counterfactuals));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("data recorder stores rich learning events for paper retraining", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-recorder-"));
  try {
    const recorder = new DataRecorder({
      runtimeDir: tempDir,
      config: { dataRecorderEnabled: true, dataRecorderRetentionDays: 21 },
      logger: { info() {}, warn() {} }
    });
    await recorder.init();
    await recorder.recordLearningEvent({
      trade: {
        symbol: "BTCUSDT",
        brokerMode: "paper",
        exitAt: "2026-03-10T10:30:00.000Z",
        pnlQuote: 24.4,
        netPnlPct: 0.018,
        mfePct: 0.026,
        maePct: -0.007,
        regimeAtEntry: "trend",
        strategyAtEntry: "ema_trend",
        executionQualityScore: 0.82,
        captureEfficiency: 0.74,
        rawFeatures: { momentum_5: 1.2, adx_strength: 1.7, stoch_rsi: -0.8, cmf: 0.42 },
        entryRationale: {
          probability: 0.61,
          confidence: 0.42,
          calibrationConfidence: 0.33,
          threshold: 0.55,
          rankScore: 0.19,
          summary: "Trend continuation bevestigd door ADX en supertrend.",
          indicators: { adx14: 28.4, dmiSpread: 0.18, trendQualityScore: 0.42, supertrendDirection: 1, supertrendDistancePct: 0.006, stochRsiK: 18.4, stochRsiD: 22.6, mfi14: 41.8, cmf20: 0.12, keltnerSqueezeScore: 0.73, squeezeReleaseScore: 0.66 },
          topSignals: [{ name: "adx_strength", contribution: 0.18, rawValue: 1.7 }],
          providerBreakdown: [{ name: "coindesk", count: 2 }],
          headlines: [{ title: "ETF inflows support BTC" }],
          officialNotices: [],
          blockerReasons: [],
          executionReasons: ["pegged maker"],
          strategy: { family: "trend_following", reasons: ["adx rising"] },
          checks: [{ label: "spread", passed: true, detail: "tight book" }]
        }
      },
      learning: {
        regime: "trend",
        label: { labelScore: 0.91 },
        championLearning: { predictionBeforeUpdate: 0.58, error: 0.21, sampleWeight: 1.4 },
        challengerLearning: { predictionBeforeUpdate: 0.56, error: 0.24, sampleWeight: 1.5 },
        transformerLearning: { absoluteError: 0.17, probability: 0.6 },
        calibration: { observations: 18, expectedCalibrationError: 0.07 },
        promotion: null
      }
    });
    const stored = await fs.readFile(path.join(tempDir, "feature-store", "learning", "2026-03-10.jsonl"), "utf8");
    const payload = JSON.parse(stored.trim());
    assert.equal(payload.schemaVersion, 3);
    assert.equal(payload.frameType, "learning");
    assert.equal(payload.symbol, "BTCUSDT");
    assert.equal(payload.model.calibrationObservations, 18);
    assert.equal(payload.rawFeatures.momentum_5, 1.2);
    assert.equal(payload.indicators.supertrendDirection, 1);
    assert.ok(payload.rationale.topSignals.length >= 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("data recorder stores deterministic snapshot manifests and trade replay frames", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-recorder-snapshot-"));
  try {
    const recorder = new DataRecorder({
      runtimeDir: tempDir,
      config: { dataRecorderEnabled: true, dataRecorderRetentionDays: 21 },
      logger: { info() {}, warn() {} }
    });
    await recorder.init();
    await recorder.recordSnapshotManifest({
      at: "2026-03-10T11:00:00.000Z",
      mode: "paper",
      candidates: [{
        symbol: "BTCUSDT",
        marketSnapshot: { book: { mid: 68000, spreadBps: 2.4, bookPressure: 0.18, depthConfidence: 0.74 }, market: { realizedVolPct: 0.021 } },
        score: { probability: 0.63 },
        rawFeatures: { adx: 0.9, momentum_5: 1.2 },
        regimeSummary: { regime: "trend" },
        strategySummary: { activeStrategy: "ema_trend" },
        metaSummary: { score: 0.61 },
        qualityQuorumSummary: { status: "ready" },
        venueConfirmationSummary: { status: "confirmed", divergenceBps: 3.2 },
        decision: {
          allow: true,
          threshold: 0.55,
          rankScore: 0.12,
          quoteAmount: 250,
          executionPlan: { entryStyle: "limit_maker" },
          capitalGovernorApplied: { status: "recovery" }
        }
      }],
      overview: { equity: 10050, quoteFree: 9800, openPositions: 1 },
      ops: { readiness: { status: "ready" }, alerts: { status: "clear" }, exchangeSafety: { status: "ready" }, capitalGovernor: { status: "recovery" } },
      report: { executionCostSummary: { status: "caution" } }
    });
    await recorder.recordTradeReplaySnapshot({
      symbol: "BTCUSDT",
      brokerMode: "paper",
      exitAt: "2026-03-10T11:30:00.000Z",
      pnlQuote: 18.4,
      netPnlPct: 0.014,
      entryPrice: 67850,
      exitPrice: 68120,
      strategyAtEntry: "ema_trend",
      regimeAtEntry: "trend",
      executionQualityScore: 0.76,
      captureEfficiency: 0.71,
      entryExecutionAttribution: { entryStyle: "limit_maker" },
      exitExecutionAttribution: { entryStyle: "market" },
      replayCheckpoints: [{ at: "2026-03-10T11:15:00.000Z", price: 67940 }],
      rawFeatures: { momentum_5: 1.2 },
      entryRationale: { probability: 0.63, threshold: 0.55, confidence: 0.41 }
    });
    const stored = await fs.readFile(path.join(tempDir, "feature-store", "snapshots", "2026-03-10.jsonl"), "utf8");
    const lines = stored.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].frameType, "snapshot_manifest");
    assert.equal(lines[1].frameType, "trade_replay");
    assert.equal(recorder.getSummary().snapshotFrames, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});


await runCheck("meta decision gate applies canary and daily budget awareness", async () => {
  const gate = new MetaDecisionGate(makeConfig({ botMode: "live" }));
  const meta = gate.evaluate({
    symbol: "BTCUSDT",
    score: { probability: 0.61 },
    marketSnapshot: { book: { bookPressure: 0.18, depthConfidence: 0.62 } },
    newsSummary: { reliabilityScore: 0.78, riskScore: 0.08, coverage: 3 },
    announcementSummary: { riskScore: 0.02 },
    marketStructureSummary: { signalScore: 0.12, longSqueezeScore: 0.08, crowdingBias: 0.04 },
    marketSentimentSummary: { contrarianScore: 0.18 },
    volatilitySummary: { riskScore: 0.14 },
    calendarSummary: { riskScore: 0.08 },
    committeeSummary: { netScore: 0.16, agreement: 0.66 },
    strategySummary: { activeStrategy: "ema_trend", fitScore: 0.64 },
    sessionSummary: { riskScore: 0.12 },
    driftSummary: { severity: 0.1 },
    selfHealState: { lowRiskOnly: false },
    portfolioSummary: { maxCorrelation: 0.2 },
    journal: {
      trades: [
        { exitAt: "2026-03-08T09:00:00.000Z", pnlQuote: -40, brokerMode: "live", symbol: "BTCUSDT", strategyAtEntry: "ema_trend", netPnlPct: -0.01 }
      ]
    },
    nowIso: "2026-03-08T12:00:00.000Z"
  });
  assert.equal(meta.canaryActive, true);
  assert.ok(meta.sizeMultiplier < 1);
  assert.ok(meta.dailyBudgetFactor <= 1);
});

await runCheck("paper broker rounds tiny partial fills to a valid exchange lot", async () => {
  const broker = new (await import("../src/execution/paperBroker.js")).PaperBroker(makeConfig(), { warn() {}, info() {} });
  broker.execution.simulatePaperFill = () => ({
    fillPrice: 200,
    executedQuote: 160,
    executedQuantity: 0.8,
    completionRatio: 0.4,
    makerFillRatio: 0.4,
    takerFillRatio: 0,
    workingTimeMs: 1500,
    notes: ["partial_fill"]
  });
  const coarseRules = {
    ...rules,
    minQty: 1,
    maxQty: 100000,
    stepSize: 1,
    marketMinQty: 1,
    marketMaxQty: 100000,
    marketStepSize: 1,
    minNotional: 5,
    maxNotional: Number.MAX_SAFE_INTEGER
  };
  const runtime = { openPositions: [], paperPortfolio: { quoteFree: 10000, feesPaid: 0, realizedPnl: 0 } };
  const position = await broker.enterPosition({
    symbol: "TESTUSDT",
    quoteAmount: 400,
    rules: coarseRules,
    marketSnapshot: { book: { bid: 199.8, ask: 200, mid: 199.9, spreadBps: 10 } },
    decision: { stopLossPct: 0.02, takeProfitPct: 0.03, executionPlan: { entryStyle: "limit_maker", fallbackStyle: "none" }, regime: "range" },
    score: { probability: 0.64, regime: "range" },
    rawFeatures: { momentum_5: 0.1 },
    strategySummary: { activeStrategy: "vwap_reversion" },
    newsSummary: { sentimentScore: 0 },
    runtime
  });
  assert.equal(position.quantity, 1);
  assert.ok(position.totalCost > 0);
});

await runCheck("paper broker can scale out and keep the remainder open", async () => {
  const broker = new (await import("../src/execution/paperBroker.js")).PaperBroker(makeConfig(), { warn() {}, info() {} });
  const runtime = { openPositions: [], paperPortfolio: { quoteFree: 10000, feesPaid: 0, realizedPnl: 0 } };
  const position = await broker.enterPosition({
    symbol: "BTCUSDT",
    quoteAmount: 900,
    rules,
    marketSnapshot: { book: { bid: 69990, ask: 70010, mid: 70000, spreadBps: 2 } },
    decision: { stopLossPct: 0.02, takeProfitPct: 0.03, scaleOutPlan: { triggerPct: 0.01, fraction: 0.4, minNotionalUsd: 35, trailOffsetPct: 0.003 }, executionPlan: { entryStyle: "market", fallbackStyle: "none" }, regime: "trend" },
    score: { probability: 0.7, regime: "trend" },
    rawFeatures: { momentum_5: 1 },
    strategySummary: { activeStrategy: "ema_trend" },
    newsSummary: { sentimentScore: 0.1 },
    runtime
  });
  const scaleOut = await broker.scaleOutPosition({
    position,
    marketSnapshot: { book: { bid: 70500, mid: 70510, exitEstimate: { averagePrice: 70500 } } },
    fraction: 0.4,
    reason: "partial_take_profit",
    runtime
  });
  assert.ok(scaleOut.realizedPnl !== 0);
  assert.ok(position.quantity > 0);
  assert.equal(position.scaleOutCount, 1);
});

await runCheck("research lab builds walk-forward windows and summary", async () => {
  const candles = Array.from({ length: 420 }, (_, index) => ({
    openTime: index,
    closeTime: 1772960000000 + index * 900000,
    open: 100 + index * 0.2,
    high: 100.4 + index * 0.2 + (index % 7 === 0 ? 0.8 : 0.2),
    low: 99.8 + index * 0.2 - (index % 5 === 0 ? 0.6 : 0.15),
    close: 100.2 + index * 0.2 + (index % 6 === 0 ? 0.35 : 0),
    volume: 12 + (index % 20)
  }));
  const config = makeConfig({ researchTrainCandles: 180, researchTestCandles: 48, researchStepCandles: 48, researchMaxWindows: 4 });
  const windows = buildWalkForwardWindows(candles.length, config);
  const report = runWalkForwardExperiment({ candles, config, symbol: "BTCUSDT" });
  assert.ok(windows.length >= 1);
  assert.equal(report.symbol, "BTCUSDT");
  assert.ok(report.experimentCount >= 1);
});

await runCheck("dynamic watchlist excludes stablecoin lookalikes like USD1", async () => {
  const config = makeConfig({ watchlistTopN: 5, dynamicWatchlistMinSymbols: 1 });
  const client = {
    async getExchangeInfo() {
      return {
        symbols: [
          { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" },
          { symbol: "USD1USDT", status: "TRADING", baseAsset: "USD1", quoteAsset: "USDT" },
          { symbol: "PYUSDUSDT", status: "TRADING", baseAsset: "PYUSD", quoteAsset: "USDT" }
        ]
      };
    },
    async publicRequest() {
      return [
        { symbol: "BTCUSDT", quoteVolume: "150000000" },
        { symbol: "USD1USDT", quoteVolume: "125000000" },
        { symbol: "PYUSDUSDT", quoteVolume: "95000000" }
      ];
    }
  };
  const watchlist = await resolveDynamicWatchlist({
    client,
    config,
    logger: { warn() {} },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return [
          { symbol: "usd1", name: "World Liberty Financial USD", market_cap_rank: 40, market_cap: 1000000000 },
          { symbol: "pyusd", name: "PayPal USD", market_cap_rank: 60, market_cap: 900000000 },
          { symbol: "btc", name: "Bitcoin", market_cap_rank: 1, market_cap: 1000000000000 }
        ];
      }
    })
  });
  assert.deepEqual(watchlist.watchlist, ["BTCUSDT"]);
});

await runCheck("universe selector focuses liquid symbols and carries open positions", async () => {
  const selector = new UniverseSelector(makeConfig({ universeMaxSymbols: 2 }));
  const snapshot = selector.buildSnapshot({
    symbols: ["BTCUSDT", "ETHUSDT", "DOGEUSDT"],
    openPositions: [{ symbol: "DOGEUSDT" }],
    latestDecisions: [{ symbol: "BTCUSDT", allow: true, rankScore: 0.18 }],
    snapshotMap: {
      BTCUSDT: {
        book: { spreadBps: 2.2, depthConfidence: 0.82, totalDepthNotional: 680000, bookPressure: 0.18, queueRefreshScore: 0.64, depthAgeMs: 120, localBookSynced: true },
        market: { realizedVolPct: 0.019, volumeZ: 1.2, emaTrendScore: 0.08, breakoutPct: 0.012, structureBreakScore: 0.44, momentum20: 0.03 },
        stream: { recentTradeCount: 24, tradeFlowImbalance: 0.14 }
      },
      ETHUSDT: {
        book: { spreadBps: 9.5, depthConfidence: 0.2, totalDepthNotional: 18000, bookPressure: -0.08, queueRefreshScore: 0.12, depthAgeMs: 4800, localBookSynced: true },
        market: { realizedVolPct: 0.045, volumeZ: -0.6, emaTrendScore: -0.02, breakoutPct: -0.004, structureBreakScore: 0.04, momentum20: -0.01 },
        stream: { recentTradeCount: 1, tradeFlowImbalance: -0.08 }
      },
      DOGEUSDT: {
        book: { spreadBps: 4.4, depthConfidence: 0.36, totalDepthNotional: 120000, bookPressure: 0.06, queueRefreshScore: 0.32, depthAgeMs: 220, localBookSynced: true },
        market: { realizedVolPct: 0.021, volumeZ: 0.4, emaTrendScore: 0.02, breakoutPct: 0.003, structureBreakScore: 0.12, momentum20: 0.015 },
        stream: { recentTradeCount: 10, tradeFlowImbalance: 0.05 }
      }
    }
  });
  assert.deepEqual(snapshot.selectedSymbols, ["DOGEUSDT", "BTCUSDT"]);
  assert.ok(snapshot.skipped.some((item) => item.symbol === "ETHUSDT"));
});

await runCheck("lightweight snapshots stay usable for top-100 prefiltering", async () => {
  const snapshot = buildLightweightSnapshot({
    symbol: "SOLUSDT",
    config: makeConfig(),
    streamFeatures: {
      latestBookTicker: { bid: 120, ask: 120.12, bidQty: 85, askQty: 82, mid: 120.06, eventTime: Date.now() },
      recentTradeCount: 16,
      tradeFlowImbalance: 0.22,
      microTrend: 0.0032
    },
    cachedSnapshot: {
      market: { realizedVolPct: 0.018, volumeZ: 1.1, emaTrendScore: 0.06, breakoutPct: 0.008 },
      book: { totalDepthNotional: 185000 },
      cachedAt: "2026-03-09T10:00:00.000Z"
    }
  });
  assert.equal(snapshot.lightweight, true);
  assert.ok(snapshot.book.depthConfidence > 0.2);
  assert.ok(snapshot.book.totalDepthNotional > 50000);
  assert.ok(snapshot.market.realizedVolPct > 0);
});

await runCheck("scan planner keeps open positions and caps deep scans", async () => {
  const watchlist = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "LINKUSDT",
    "AVAXUSDT",
    "SUIUSDT",
    "APTUSDT"
  ];
  const plan = buildDeepScanPlan({
    config: makeConfig({ watchlist, universeMaxSymbols: 6, marketSnapshotBudgetSymbols: 7, localBookMaxSymbols: 4 }),
    watchlist,
    openPositions: [{ symbol: "DOGEUSDT" }],
    latestDecisions: [{ symbol: "LINKUSDT", allow: true, rankScore: 0.18 }],
    shallowSnapshotMap: {},
    universeSelector: {
      buildSnapshot() {
        return {
          generatedAt: "2026-03-09T12:00:00.000Z",
          configuredSymbolCount: watchlist.length,
          selectedCount: 6,
          eligibleCount: 7,
          selectionRate: 0.6,
          averageScore: 0.58,
          selectedSymbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT"],
          selected: [],
          skipped: [],
          suggestions: []
        };
      }
    },
    nowIso: "2026-03-09T12:00:00.000Z"
  });

  assert.equal(plan.deepScanSymbols.length, 7);
  assert.equal(plan.deepScanSymbols[0], "DOGEUSDT");
  assert.ok(plan.deepScanSymbols.includes("BTCUSDT"));
  assert.ok(plan.localBookSymbols.length <= 4);
});

await runCheck("exit intelligence escalates when profit starts reversing into risk", async () => {
  const intelligence = new ExitIntelligence(makeConfig());
  const summary = intelligence.evaluate({
    position: {
      symbol: "BTCUSDT",
      entryAt: "2026-03-08T06:00:00.000Z",
      entryPrice: 100,
      quantity: 1,
      totalCost: 100,
      highestPrice: 107,
      stopLossPrice: 97,
      scaleOutTrailOffsetPct: 0.01
    },
    marketSnapshot: {
      book: { mid: 103.4, spreadBps: 18, depthConfidence: 0.62, bookPressure: -0.42 },
      market: { bearishPatternScore: 0.48, bullishPatternScore: 0.04 }
    },
    newsSummary: { coverage: 3, sentimentScore: -0.08, riskScore: 0.71 },
    announcementSummary: { riskScore: 0.18 },
    marketStructureSummary: { signalScore: -0.22, riskScore: 0.74, confidence: 0.66, liquidationImbalance: -0.52 },
    calendarSummary: { coverage: 1, riskScore: 0.46 },
    nowIso: "2026-03-08T11:30:00.000Z"
  });
  assert.ok(["trim", "exit"].includes(summary.action));
  assert.ok(summary.riskReasons.length >= 1);
});

await runCheck("strategy attribution builds a positive adjustment for hot strategy history", async () => {
  const attribution = new StrategyAttribution(makeConfig({ strategyAttributionMinTrades: 2 }));
  const snapshot = attribution.buildSnapshot({
    journal: {
      trades: [
        { symbol: "BTCUSDT", exitAt: "2026-03-08T10:00:00.000Z", pnlQuote: 42, netPnlPct: 0.032, labelScore: 1, strategyAtEntry: "ema_trend", regimeAtEntry: "trend" },
        { symbol: "BTCUSDT", exitAt: "2026-03-08T14:00:00.000Z", pnlQuote: 31, netPnlPct: 0.025, labelScore: 1, strategyAtEntry: "ema_trend", regimeAtEntry: "trend" },
        { symbol: "ETHUSDT", exitAt: "2026-03-07T10:00:00.000Z", pnlQuote: -18, netPnlPct: -0.014, labelScore: 0, strategyAtEntry: "vwap_reversion", regimeAtEntry: "range" }
      ]
    },
    nowIso: "2026-03-09T12:00:00.000Z"
  });
  const adjustment = attribution.getAdjustment(snapshot, {
    symbol: "BTCUSDT",
    strategyId: "ema_trend",
    familyId: "trend_following",
    regime: "trend"
  });
  assert.equal(snapshot.topStrategies[0].id, "ema_trend");
  assert.ok(adjustment.rankBoost > 0);
});

await runCheck("performance report builds pnl attribution buckets", async () => {
  const report = buildPerformanceReport({
    journal: {
      trades: [
        {
          symbol: "BTCUSDT",
          entryAt: "2026-03-08T08:00:00.000Z",
          exitAt: "2026-03-08T10:00:00.000Z",
          pnlQuote: 14,
          netPnlPct: 0.011,
          strategyAtEntry: "ema_trend",
          regimeAtEntry: "trend",
          entryExecutionAttribution: { entryStyle: "pegged_limit_maker" },
          entryRationale: { providerBreakdown: [{ name: "cointelegraph" }] }
        },
        {
          symbol: "ETHUSDT",
          entryAt: "2026-03-08T11:00:00.000Z",
          exitAt: "2026-03-08T12:30:00.000Z",
          pnlQuote: -3,
          netPnlPct: -0.004,
          strategyAtEntry: "vwap_reversion",
          regimeAtEntry: "range",
          entryExecutionAttribution: { entryStyle: "market" },
          entryRationale: { providerBreakdown: [{ name: "google_news" }] }
        }
      ]
    },
    runtime: { openPositions: [] },
    config: { reportLookbackTrades: 50 }
  });
  assert.equal(report.attribution.strategies[0].id, "ema_trend");
  assert.equal(report.attribution.executionStyles[0].id, "pegged_limit_maker");
  assert.equal(report.attribution.newsProviders[0].id, "cointelegraph");
});

await runCheck("performance report exposes execution cost budgets and pnl decomposition", async () => {
  const report = buildPerformanceReport({
    journal: {
      trades: [
        {
          symbol: "BTCUSDT",
          entryAt: "2026-03-08T08:00:00.000Z",
          exitAt: "2026-03-08T10:00:00.000Z",
          entryPrice: 70000,
          exitPrice: 70210,
          quantity: 0.01,
          totalCost: 701.2,
          proceeds: 700.9,
          entryFee: 0.7,
          pnlQuote: -0.3,
          netPnlPct: -0.0004,
          captureEfficiency: 0.44,
          strategyAtEntry: "ema_trend",
          regimeAtEntry: "trend",
          entryExecutionAttribution: { entryStyle: "market", realizedTouchSlippageBps: 4.2, slippageDeltaBps: 2.4, latencyBps: 0.8, queueDecayBps: 0.2 },
          exitExecutionAttribution: { entryStyle: "market", realizedTouchSlippageBps: 3.1, slippageDeltaBps: 1.3, latencyBps: 0.5, queueDecayBps: 0.1 },
          entryRationale: { providerBreakdown: [{ name: "cointelegraph" }] }
        },
        {
          symbol: "ETHUSDT",
          entryAt: "2026-03-08T11:00:00.000Z",
          exitAt: "2026-03-08T12:30:00.000Z",
          entryPrice: 2050,
          exitPrice: 2061,
          quantity: 0.08,
          totalCost: 164.4,
          proceeds: 164.55,
          entryFee: 0.16,
          pnlQuote: 0.15,
          netPnlPct: 0.0009,
          captureEfficiency: 0.63,
          strategyAtEntry: "vwap_reversion",
          regimeAtEntry: "range",
          entryExecutionAttribution: { entryStyle: "pegged_limit_maker", realizedTouchSlippageBps: 0.8, slippageDeltaBps: -0.1, latencyBps: 0.2, queueDecayBps: 0.05 },
          exitExecutionAttribution: { entryStyle: "market_exit", realizedTouchSlippageBps: 1.4, slippageDeltaBps: 0.4, latencyBps: 0.2, queueDecayBps: 0.05 },
          entryRationale: { providerBreakdown: [{ name: "google_news" }] }
        }
      ]
    },
    runtime: { openPositions: [] },
    config: { reportLookbackTrades: 50, executionCostBudgetWarnBps: 6, executionCostBudgetBlockBps: 10 }
  });
  assert.equal(report.executionCostSummary.worstStrategy, "ema_trend");
  assert.ok(report.executionCostSummary.averageTotalCostBps > 0);
  assert.ok(Number.isFinite(report.pnlDecomposition.totalFees));
  assert.ok(Number.isFinite(report.pnlDecomposition.executionDragEstimate));
});

await runCheck("strategy retirement engine retires weak strategies", async () => {
  const summary = buildStrategyRetirementSnapshot({
    report: {
      tradeQualityReview: {
        strategyScorecards: [
          {
            id: "donchian_breakout",
            tradeCount: 6,
            realizedPnl: -48,
            winRate: 0.17,
            avgReviewScore: 0.31,
            governanceScore: 0.28,
            falseNegativeCount: 0
          }
        ]
      },
      attribution: {
        strategies: [
          { id: "donchian_breakout", tradeCount: 6, realizedPnl: -48, winRate: 0.17, averagePnlPct: -0.012 }
        ]
      }
    },
    offlineTrainer: {
      strategyScorecards: [
        {
          id: "donchian_breakout",
          tradeCount: 6,
          realizedPnl: -48,
          winRate: 0.17,
          avgMovePct: -0.012,
          falsePositiveRate: 0.46,
          falseNegativeRate: 0.08,
          governanceScore: 0.22,
          status: "cooldown"
        }
      ]
    },
    journal: {
      trades: [{ symbol: "BTCUSDT", pnlQuote: -12, strategyAtEntry: "donchian_breakout" }]
    },
    config: makeConfig(),
    nowIso: "2026-03-09T12:00:00.000Z"
  });
  assert.equal(summary.retireCount, 1);
  assert.equal(summary.policies[0].id, "donchian_breakout");
  assert.equal(summary.policies[0].status, "retire");
});

await runCheck("exchange safety audit blocks stale live reconciliation", async () => {
  const audit = buildExchangeSafetyAudit({
    runtime: {
      openPositions: [
        { symbol: "BTCUSDT", brokerMode: "live", protectiveOrderListId: null, reconcileRequired: true }
      ],
      exchangeTruth: {
        mismatchCount: 1,
        lastReconciledAt: "2026-03-09T09:00:00.000Z"
      },
      orderLifecycle: {
        pendingActions: [
          { state: "reconcile_required", updatedAt: "2026-03-09T09:05:00.000Z" }
        ]
      }
    },
    report: {
      recentEvents: [{ type: "broker_reconciliation_warning" }]
    },
    config: makeConfig({ botMode: "live" }),
    streamStatus: {
      lastPublicMessageAt: "2026-03-09T09:10:00.000Z"
    },
    nowIso: "2026-03-09T10:00:00.000Z"
  });
  assert.equal(audit.status, "blocked");
  assert.equal(audit.freezeEntries, true);
  assert.ok(audit.reasons.includes("exchange_truth_mismatch"));
});

await runCheck("operator alerts surface critical safety issues", async () => {
  const alerts = buildOperatorAlerts({
    runtime: {
      health: { circuitOpen: true, reason: "too_many_failures" },
      orderLifecycle: { pendingActions: [{ state: "manual_review" }] },
      selfHeal: { mode: "paused", reason: "calibration_break" },
      thresholdTuning: { appliedRecommendation: { status: "probation", id: "book_pressure" } },
      ops: {
        alertState: {
          acknowledgedAtById: { self_heal_paused: "2026-03-09T09:30:00.000Z" },
          silencedUntilById: { readiness_degraded: "2026-03-09T12:30:00.000Z" },
          delivery: { lastDeliveredAtById: { health_circuit_open: "2026-03-09T09:45:00.000Z" } }
        }
      }
    },
    readiness: { status: "blocked", reasons: ["exchange_safety_blocked"] },
    exchangeSafety: { status: "blocked", notes: ["reconcile needed"], actions: ["run reconcile"] },
    strategyRetirement: { retireCount: 1, policies: [{ id: "donchian_breakout", status: "retire" }] },
    executionCost: { status: "blocked", notes: ["execution costs too high"] },
    capitalGovernor: { status: "blocked", notes: ["weekly drawdown exceeded"] },
    config: makeConfig(),
    nowIso: "2026-03-09T10:00:00.000Z"
  });
  assert.equal(alerts.criticalCount, 3);
  assert.ok(alerts.alerts.some((item) => item.id === "capital_governor_blocked"));
  assert.ok(alerts.alerts.some((item) => item.id === "health_circuit_open"));
  assert.ok(alerts.alerts.some((item) => item.id === "execution_cost_budget_blocked"));
  assert.ok(alerts.alerts.some((item) => item.id === "self_heal_paused" && item.acknowledgedAt));
});

await runCheck("capital governor blocks entries after weekly drawdown breach", async () => {
  const summary = buildCapitalGovernor({
    journal: {
      trades: [
        { exitAt: "2026-03-05T10:00:00.000Z", pnlQuote: -180 },
        { exitAt: "2026-03-06T10:00:00.000Z", pnlQuote: -220 },
        { exitAt: "2026-03-07T10:00:00.000Z", pnlQuote: -190 },
        { exitAt: "2026-03-08T10:00:00.000Z", pnlQuote: -140 }
      ],
      scaleOuts: [],
      equitySnapshots: [
        { at: "2026-03-05T00:00:00.000Z", equity: 10000 },
        { at: "2026-03-08T00:00:00.000Z", equity: 9200 }
      ]
    },
    runtime: {},
    config: makeConfig({ capitalGovernorWeeklyDrawdownPct: 0.05 }),
    nowIso: "2026-03-08T12:00:00.000Z"
  });
  assert.equal(summary.status, "blocked");
  assert.equal(summary.allowEntries, false);
  assert.ok(summary.blockerReasons.includes("capital_governor_weekly_drawdown_limit"));
});

await runCheck("operator alert dispatcher builds and dispatches webhook plans safely", async () => {
  const alerts = buildOperatorAlerts({
    runtime: {
      health: { circuitOpen: true },
      ops: {
        alertState: {
          acknowledgedAtById: {},
          silencedUntilById: {},
          delivery: { lastDeliveredAtById: {} }
        }
      }
    },
    exchangeSafety: {},
    config: makeConfig({ operatorAlertWebhookUrls: ["https://example.com/hook"] }),
    nowIso: "2026-03-09T10:00:00.000Z"
  });
  const plan = buildOperatorAlertDispatchPlan({
    alerts,
    config: makeConfig({ operatorAlertWebhookUrls: ["https://example.com/hook"] }),
    nowIso: "2026-03-09T10:00:00.000Z"
  });
  assert.equal(plan.status, "pending");
  let sent = 0;
  const summary = await dispatchOperatorAlerts({
    alerts,
    runtime: { ops: { alertState: { delivery: { lastDeliveredAtById: {} } } } },
    config: makeConfig({ operatorAlertWebhookUrls: ["https://example.com/hook"] }),
    nowIso: "2026-03-09T10:00:00.000Z",
    fetchImpl: async () => {
      sent += 1;
      return { ok: true, status: 200 };
    }
  });
  assert.equal(sent, 1);
  assert.equal(summary.status, "delivered");
  assert.ok(summary.lastDeliveredAtById.health_circuit_open);
});

await runCheck("reference venue service produces route advice and venue health", async () => {
  const service = new ReferenceVenueService(makeConfig({ referenceVenueMinQuotes: 2, referenceVenueMaxDivergenceBps: 18 }));
  const summary = await service.getSymbolSummary("BTCUSDT", {
    book: { mid: 68000 }
  }, {
    referenceQuotes: [
      { venue: "kraken", mid: 68005, bid: 68000, ask: 68010 },
      { venue: "coinbase", mid: 68008, bid: 68002, ask: 68014 }
    ]
  });
  assert.equal(summary.status, "confirmed");
  assert.equal(summary.routeAdvice.aggressiveTakerAllowed, true);
  assert.ok(summary.venueHealth.length >= 2);
  assert.ok(summary.routeAdvice.preferredVenues.includes("kraken"));
});

await runCheck("replay chaos lab summarizes vulnerable strategies", async () => {
  const summary = buildReplayChaosSummary({
    journal: {
      trades: [
        {
          symbol: "BTCUSDT",
          strategyAtEntry: "ema_trend",
          netPnlPct: -0.012,
          pnlQuote: -8,
          replayCheckpoints: [{ at: "2026-03-09T09:00:00.000Z", price: 70000 }]
        },
        {
          symbol: "BTCUSDT",
          strategyAtEntry: "ema_trend",
          netPnlPct: -0.008,
          pnlQuote: -5,
          replayCheckpoints: [{ at: "2026-03-09T10:00:00.000Z", price: 69800 }]
        }
      ],
      blockedSetups: [
        { outcome: "missed_winner" }
      ]
    },
    nowIso: "2026-03-09T12:00:00.000Z"
  });
  assert.equal(summary.tradeCount, 2);
  assert.equal(summary.missedWinnerCount, 1);
  assert.equal(summary.worstStrategy, "ema_trend");
  assert.ok(summary.scenarioLeaders.length >= 1);
});

await runCheck("execution cost and pnl decomposition stay finite on randomized trade samples", async () => {
  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const trades = Array.from({ length: 20 }, (_, index) => {
    const entryPrice = 100 + nextRand() * 20;
    const exitPrice = entryPrice * (0.985 + nextRand() * 0.04);
    const quantity = 0.5 + nextRand() * 1.5;
    const totalCost = entryPrice * quantity + 0.2;
    const grossExit = exitPrice * quantity;
    const proceeds = grossExit - 0.18;
    return {
      symbol: index % 2 === 0 ? "BTCUSDT" : "ETHUSDT",
      entryAt: `2026-03-08T${String(index).padStart(2, "0")}:00:00.000Z`,
      exitAt: `2026-03-08T${String(index).padStart(2, "0")}:30:00.000Z`,
      entryPrice,
      exitPrice,
      quantity,
      totalCost,
      proceeds,
      entryFee: 0.2,
      pnlQuote: proceeds - totalCost,
      netPnlPct: totalCost ? (proceeds - totalCost) / totalCost : 0,
      captureEfficiency: nextRand(),
      strategyAtEntry: index % 3 === 0 ? "ema_trend" : "vwap_reversion",
      regimeAtEntry: index % 2 === 0 ? "trend" : "range",
      entryExecutionAttribution: {
        entryStyle: index % 2 === 0 ? "market" : "pegged_limit_maker",
        realizedTouchSlippageBps: nextRand() * 4,
        slippageDeltaBps: nextRand() * 2,
        latencyBps: nextRand(),
        queueDecayBps: nextRand()
      },
      exitExecutionAttribution: {
        entryStyle: "market_exit",
        realizedTouchSlippageBps: nextRand() * 3,
        slippageDeltaBps: nextRand() * 1.5,
        latencyBps: nextRand(),
        queueDecayBps: nextRand()
      },
      entryRationale: { providerBreakdown: [{ name: "google_news" }] }
    };
  });
  const report = buildPerformanceReport({
    journal: { trades },
    runtime: { openPositions: [] },
    config: { reportLookbackTrades: 50 }
  });
  assert.ok(["warmup", "ready", "caution", "blocked"].includes(report.executionCostSummary.status));
  assert.ok(Number.isFinite(report.executionCostSummary.averageTotalCostBps));
  assert.ok(Number.isFinite(report.pnlDecomposition.netRealizedPnl));
  assert.ok(Number.isFinite(report.pnlDecomposition.executionDragEstimate));
});

await runCheck("model registry picks a healthy rollback candidate", async () => {
  const registry = new ModelRegistry(makeConfig());
  const snapshot = registry.buildRegistry({
    snapshots: [
      {
        at: "2026-03-08T10:00:00.000Z",
        reason: "stable",
        tradeCount: 14,
        winRate: 0.64,
        realizedPnl: 180,
        averageSharpe: 0.74,
        maxDrawdownPct: 0.04,
        calibrationEce: 0.06,
        deploymentActive: "champion"
      },
      {
        at: "2026-03-07T10:00:00.000Z",
        reason: "weak",
        tradeCount: 8,
        winRate: 0.42,
        realizedPnl: -60,
        averageSharpe: -0.2,
        maxDrawdownPct: 0.16,
        calibrationEce: 0.22,
        deploymentActive: "challenger"
      }
    ],
    report: { realizedPnl: 120, winRate: 0.58, maxDrawdownPct: 0.05 },
    researchRegistry: { governance: { promotionCandidates: [{ symbol: "BTCUSDT", governanceScore: 0.72, status: "promote" }] }, leaderboard: [{ averageSharpe: 0.66 }] },
    calibration: { expectedCalibrationError: 0.08 },
    deployment: { active: "champion" },
    nowIso: "2026-03-09T12:00:00.000Z"
  });
  assert.equal(snapshot.rollbackCandidate?.reason, "stable");
  assert.equal(snapshot.promotionHint?.symbol, "BTCUSDT");
  assert.ok(snapshot.currentQualityScore > 0.5);
});

await runCheck("model registry surfaces regime-ready promotion hints", async () => {
  const registry = new ModelRegistry(makeConfig());
  const snapshot = registry.buildRegistry({
    snapshots: [],
    report: {
      windows: { allTime: { tradeCount: 18, winRate: 0.61, realizedPnl: 210 } },
      modes: { paper: { tradeCount: 18, winRate: 0.61, realizedPnl: 210 }, live: { tradeCount: 4, winRate: 0.5, realizedPnl: 22 } },
      maxDrawdownPct: 0.05
    },
    researchRegistry: { governance: { promotionCandidates: [{ symbol: "BTCUSDT", governanceScore: 0.74, status: "promote" }] }, leaderboard: [{ averageSharpe: 0.72 }] },
    calibration: { expectedCalibrationError: 0.07 },
    deployment: { active: "champion", shadowTradeCount: 28, championError: 0.12, challengerError: 0.09 },
    divergenceSummary: { averageScore: 0.14 },
    offlineTrainer: {
      readinessScore: 0.62,
      thresholdPolicy: { status: "adjust", recommendations: [{ id: "provider_ops", action: "relax" }] },
      featureDecay: { status: "healthy" },
      exitLearning: { status: "ready" },
      calibrationGovernance: { status: "ready" },
      strategyScorecards: [{ id: "ema_trend", tradeCount: 8, governanceScore: 0.66 }, { id: "vwap_reversion", tradeCount: 6, governanceScore: 0.54 }],
      regimeScorecards: [{ id: "trend", tradeCount: 7, governanceScore: 0.64 }, { id: "range", tradeCount: 5, governanceScore: 0.57 }]
    },
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  assert.ok(snapshot.promotionPolicy.readyRegimes.includes("trend"));
  assert.equal(snapshot.promotionPolicy.thresholdRecommendationCount, 1);
  assert.equal(snapshot.promotionPolicy.exitLearningStatus, "ready");
  assert.ok(snapshot.notes.some((note) => note.includes("regimes")));
});

await runCheck("research registry surfaces promotion candidates from walk-forward results", async () => {
  const registry = new ResearchRegistry(makeConfig({ researchPromotionMinTrades: 5 }));
  const snapshot = registry.buildRegistry({
    journal: {
      researchRuns: [
        {
          generatedAt: "2026-03-08T18:00:00.000Z",
          symbolCount: 2,
          bestSymbol: "BTCUSDT",
          totalTrades: 14,
          realizedPnl: 182,
          averageSharpe: 0.78,
          reports: [
            {
              symbol: "BTCUSDT",
              experimentCount: 3,
              totalTrades: 9,
              realizedPnl: 144,
              averageWinRate: 0.66,
              averageSharpe: 0.82,
              maxDrawdownPct: 0.06,
              experiments: [{ strategyLeaders: ["ema_trend", "donchian_breakout"] }]
            },
            {
              symbol: "ETHUSDT",
              experimentCount: 2,
              totalTrades: 5,
              realizedPnl: 38,
              averageWinRate: 0.54,
              averageSharpe: 0.24,
              maxDrawdownPct: 0.11,
              experiments: [{ strategyLeaders: ["vwap_reversion"] }]
            }
          ]
        }
      ]
    },
    modelBackups: [{ at: "2026-03-08T12:00:00.000Z" }],
    nowIso: "2026-03-09T12:00:00.000Z"
  });
  assert.equal(snapshot.runCount, 1);
  assert.ok(snapshot.governance.promotionCandidates.some((item) => item.symbol === "BTCUSDT"));
});

await runCheck("dashboard decision view preserves blocked-setup safety context", async () => {
  const bot = Object.create(TradingBot.prototype);
  const view = bot.buildDashboardDecisionView({
    symbol: "BTCUSDT",
    allow: false,
    probability: 0.58,
    threshold: 0.6,
    sessionBlockers: ["session_liquidity_guard"],
    driftBlockers: ["drift_confidence_guard"],
    selfHealIssues: ["loss_streak_warning"],
    session: { session: "asia", sessionLabel: "Asia", blockerReasons: ["session_liquidity_guard"] },
    drift: { blockerReasons: ["drift_confidence_guard"] },
    selfHeal: { issues: ["loss_streak_warning"] },
    qualityQuorum: { status: "degraded", quorumScore: 0.75, blockerReasons: [], cautionReasons: ["calendar"] }
  });
  assert.deepEqual(view.sessionBlockers, ["session_liquidity_guard"]);
  assert.deepEqual(view.driftBlockers, ["drift_confidence_guard"]);
  assert.deepEqual(view.selfHealIssues, ["loss_streak_warning"]);
});

await runCheck("stream coordinator ignores stale book tickers and falls back to fresh local book", async () => {
  const coordinator = new StreamCoordinator({
    client: {
      getStreamBaseUrl() {
        return "wss://stream.binance.com:9443";
      },
      getFuturesStreamBaseUrl() {
        return "wss://fstream.binance.com";
      }
    },
    config: makeConfig({ watchlist: ["BTCUSDT"], maxDepthEventAgeMs: 1000 }),
    logger: { warn() {}, info() {} }
  });
  coordinator.orderBook.getSnapshot = () => ({
    bestBid: 101,
    bestAsk: 103,
    bids: [[101, 1.2]],
    asks: [[103, 1.1]],
    mid: 102,
    lastEventAt: new Date().toISOString()
  });
  coordinator.state.symbols.BTCUSDT.bookTicker = {
    bid: 99,
    ask: 101,
    bidQty: 1,
    askQty: 1,
    mid: 100,
    eventTime: Date.now() - 5_000
  };
  const features = coordinator.getSymbolStreamFeatures("BTCUSDT");
  assert.equal(features.latestBookTicker.mid, 102);
  assert.equal(features.latestBookTicker.bid, 101);
  assert.equal(features.latestBookTicker.ask, 103);
});

await runCheck("stream coordinator status does not expose the raw listen key", async () => {
  const coordinator = new StreamCoordinator({
    client: {
      getStreamBaseUrl() {
        return "wss://stream.binance.com:9443";
      },
      getFuturesStreamBaseUrl() {
        return "wss://fstream.binance.com";
      }
    },
    config: makeConfig({ watchlist: ["BTCUSDT"] }),
    logger: { warn() {}, info() {} }
  });
  coordinator.state.listenKey = "super-secret-listen-key";
  const status = coordinator.getStatus();
  assert.equal(Object.prototype.hasOwnProperty.call(status, "listenKey"), false);
  assert.equal(status.userStreamSessionActive, true);
});

await runCheck("trading bot blocks further entries after recovering a failed live exposure", async () => {
  const bot = Object.create(TradingBot.prototype);
  const attempted = [];
  bot.health = {
    canEnterNewPositions() {
      return true;
    }
  };
  bot.broker = {
    async enterPosition({ symbol }) {
      attempted.push(symbol);
      const error = new Error("entry recovered");
      error.preventFurtherEntries = true;
      error.blockedReason = "entry_recovered_after_partial_fill";
      error.recoveredTrade = { symbol, reason: "entry_recovery_flatten", pnlQuote: -1.5 };
      throw error;
    }
  };
  bot.buildEntryRationale = () => ({ summary: "test" });
  bot.logger = { warn() {} };
  bot.runtime = {};
  bot.journal = { trades: [] };
  bot.symbolRules = { BTCUSDT: {}, ETHUSDT: {} };
  const events = [];
  bot.recordEvent = (type, payload) => {
    events.push({ type, ...(payload || {}) });
  };
  const candidates = [
    {
      symbol: "BTCUSDT",
      decision: { allow: true, quoteAmount: 100, executionPlan: {} },
      marketSnapshot: {},
      score: { probability: 0.62 },
      rawFeatures: {},
      strategySummary: {},
      newsSummary: {},
      regimeSummary: {},
      metaSummary: {}
    },
    {
      symbol: "ETHUSDT",
      decision: { allow: true, quoteAmount: 100, executionPlan: {} },
      marketSnapshot: {},
      score: { probability: 0.6 },
      rawFeatures: {},
      strategySummary: {},
      newsSummary: {},
      regimeSummary: {},
      metaSummary: {}
    }
  ];
  const attempt = await bot.openBestCandidate(candidates);
  assert.equal(attempt.status, "runtime_blocked");
  assert.deepEqual(attempt.attemptedSymbols, ["BTCUSDT"]);
  assert.deepEqual(attempted, ["BTCUSDT"]);
  assert.equal(bot.journal.trades.length, 1);
  assert.ok(events.some((event) => event.type === "entry_recovered_flat"));
});

await runCheck("pair health monitor quarantines noisy symbols", async () => {
  const monitor = new PairHealthMonitor(makeConfig({ pairHealthMinScore: 0.45, pairHealthMaxInfraIssues: 2, pairHealthQuarantineMinutes: 180 }));
  const snapshot = monitor.buildSnapshot({
    journal: {
      trades: [
        { symbol: "BTCUSDT", exitAt: "2026-03-09T10:00:00.000Z", pnlQuote: -14, netPnlPct: -0.012, executionQualityScore: 0.42, entryExecutionAttribution: { slippageDeltaBps: 4.2 } }
      ],
      events: [
        { type: "market_snapshot_cache_fallback", symbol: "BTCUSDT", at: "2026-03-10T10:00:00.000Z", error: "timeout" },
        { type: "candidate_evaluation_failed", symbol: "BTCUSDT", at: "2026-03-10T11:00:00.000Z", error: "aborted due to timeout" },
        { type: "position_open_failed", symbol: "BTCUSDT", at: "2026-03-10T11:30:00.000Z", error: "maker order expired" }
      ]
    },
    runtime: {},
    watchlist: ["BTCUSDT"],
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  const btc = snapshot.bySymbol.BTCUSDT;
  assert.equal(btc.quarantined, true);
  assert.ok(btc.score < 0.45);
});

await runCheck("timeframe consensus blocks conflicting trend signals", async () => {
  const summary = buildTimeframeConsensus({
    marketSnapshot: {
      timeframes: {
        lower: { interval: "5m", market: { emaTrendScore: 0.8, momentum20: 0.02, breakoutPct: 0.014, supertrendDirection: 1, realizedVolPct: 0.018 } },
        higher: { interval: "1h", market: { emaTrendScore: -0.7, momentum20: -0.018, breakoutPct: -0.01, supertrendDirection: -1, realizedVolPct: 0.021 } }
      }
    },
    regimeSummary: { regime: "trend" },
    strategySummary: { family: "trend_following" },
    config: makeConfig({ enableCrossTimeframeConsensus: true, crossTimeframeMinAlignmentScore: 0.42, crossTimeframeMaxVolGapPct: 0.03 })
  });
  assert.ok(summary.alignmentScore < 0.42);
  assert.ok(summary.blockerReasons.includes("cross_timeframe_misalignment"));
});

await runCheck("divergence monitor flags strategy drift between paper and live", async () => {
  const monitor = new DivergenceMonitor(makeConfig({ divergenceMinPaperTrades: 2, divergenceMinLiveTrades: 2, divergenceAlertScore: 0.2, divergenceBlockScore: 0.4, divergenceAlertSlipGapBps: 2 }));
  const summary = monitor.buildSummary({
    journal: {
      trades: [
        { strategyAtEntry: "ema_trend", brokerMode: "paper", exitAt: "2026-03-08T10:00:00.000Z", pnlQuote: 25, netPnlPct: 0.02, executionQualityScore: 0.72, entryExecutionAttribution: { slippageDeltaBps: 0.4 } },
        { strategyAtEntry: "ema_trend", brokerMode: "paper", exitAt: "2026-03-08T12:00:00.000Z", pnlQuote: 22, netPnlPct: 0.018, executionQualityScore: 0.7, entryExecutionAttribution: { slippageDeltaBps: 0.6 } },
        { strategyAtEntry: "ema_trend", brokerMode: "live", exitAt: "2026-03-09T10:00:00.000Z", pnlQuote: -12, netPnlPct: -0.011, executionQualityScore: 0.42, entryExecutionAttribution: { slippageDeltaBps: 6.2 } },
        { strategyAtEntry: "ema_trend", brokerMode: "live", exitAt: "2026-03-09T12:00:00.000Z", pnlQuote: -9, netPnlPct: -0.008, executionQualityScore: 0.45, entryExecutionAttribution: { slippageDeltaBps: 5.8 } }
      ]
    },
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  assert.equal(summary.strategies[0].id, "ema_trend");
  assert.ok(["watch", "blocked"].includes(summary.strategies[0].status));
});

await runCheck("source reliability engine cools down providers after rate limits", async () => {
  const engine = new SourceReliabilityEngine(makeConfig({ sourceReliabilityMinOperationalScore: 0.2, sourceReliabilityMaxRecentFailures: 2, sourceReliabilityRateLimitCooldownMinutes: 15, sourceReliabilityTimeoutCooldownMinutes: 10, sourceReliabilityFailureCooldownMinutes: 5 }));
  const runtime = {};
  engine.noteFailure(runtime, "reddit_search", "429 rate limit", "2026-03-10T10:00:00.000Z");
  const gate = engine.shouldUseProvider(runtime, "reddit_search", "2026-03-10T10:01:00.000Z");
  assert.equal(gate.allow, false);
  assert.equal(gate.reason, "provider_cooldown_active");
});

await runCheck("offline trainer summarizes learning readiness and counterfactuals", async () => {
  const trainer = new OfflineTrainer(makeConfig());
  const summary = trainer.buildSummary({
    journal: {
      trades: [
        { symbol: "BTCUSDT", exitAt: "2026-03-09T10:00:00.000Z", pnlQuote: 20, netPnlPct: 0.015, executionQualityScore: 0.71, labelScore: 0.82, rawFeatures: { a: 1 }, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", brokerMode: "paper" },
        { symbol: "ETHUSDT", exitAt: "2026-03-09T14:00:00.000Z", pnlQuote: -5, netPnlPct: -0.004, executionQualityScore: 0.58, labelScore: 0.41, rawFeatures: { a: 1 }, strategyAtEntry: "vwap_reversion", regimeAtEntry: "range", brokerMode: "paper" }
      ]
    },
    dataRecorder: { learningFrames: 8, decisionFrames: 14 },
    counterfactuals: [
      { outcome: "missed_winner", realizedMovePct: 0.019 },
      { outcome: "blocked_correctly", realizedMovePct: -0.011 }
    ],
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  assert.equal(summary.counterfactuals.total, 2);
  assert.ok(summary.readinessScore > 0.24);
});

await runCheck("offline trainer builds blocker and regime veto scorecards", async () => {
  const trainer = new OfflineTrainer(makeConfig());
  const summary = trainer.buildSummary({
    journal: {
      trades: [
        { symbol: "BTCUSDT", exitAt: "2026-03-09T10:00:00.000Z", pnlQuote: 18, netPnlPct: 0.014, executionQualityScore: 0.7, labelScore: 0.78, captureEfficiency: 0.66, mfePct: 0.024, rawFeatures: { momentum_5: 1.2, breakout_pct: 0.4 }, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", brokerMode: "paper", reason: "take_profit" },
        { symbol: "ETHUSDT", exitAt: "2026-03-09T14:00:00.000Z", pnlQuote: -7, netPnlPct: -0.006, executionQualityScore: 0.52, labelScore: 0.4, captureEfficiency: 0.12, mfePct: 0.019, rawFeatures: { momentum_5: -0.2, breakout_pct: -0.1 }, strategyAtEntry: "vwap_reversion", regimeAtEntry: "range", brokerMode: "paper", reason: "time_stop" },
        { symbol: "SOLUSDT", exitAt: "2026-03-09T16:00:00.000Z", pnlQuote: 8, netPnlPct: 0.009, executionQualityScore: 0.64, labelScore: 0.67, captureEfficiency: 0.44, mfePct: 0.028, rawFeatures: { momentum_5: 0.9, breakout_pct: 0.35 }, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", brokerMode: "paper", reason: "take_profit" },
        { symbol: "AVAXUSDT", exitAt: "2026-03-09T18:00:00.000Z", pnlQuote: -4, netPnlPct: -0.004, executionQualityScore: 0.49, labelScore: 0.43, captureEfficiency: 0.18, mfePct: 0.014, rawFeatures: { momentum_5: -0.4, breakout_pct: -0.06 }, strategyAtEntry: "vwap_reversion", regimeAtEntry: "range", brokerMode: "paper", reason: "time_stop" },
        { symbol: "BNBUSDT", exitAt: "2026-03-09T20:00:00.000Z", pnlQuote: 11, netPnlPct: 0.011, executionQualityScore: 0.69, labelScore: 0.71, captureEfficiency: 0.59, mfePct: 0.022, rawFeatures: { momentum_5: 1.05, breakout_pct: 0.31 }, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", brokerMode: "paper", reason: "take_profit" },
        { symbol: "DOGEUSDT", exitAt: "2026-03-09T21:00:00.000Z", pnlQuote: -3, netPnlPct: -0.003, executionQualityScore: 0.46, labelScore: 0.44, captureEfficiency: 0.16, mfePct: 0.012, rawFeatures: { momentum_5: -0.35, breakout_pct: -0.05 }, strategyAtEntry: "vwap_reversion", regimeAtEntry: "range", brokerMode: "paper", reason: "time_stop" },
        { symbol: "XRPUSDT", exitAt: "2026-03-09T22:00:00.000Z", pnlQuote: 7, netPnlPct: 0.008, executionQualityScore: 0.61, labelScore: 0.65, captureEfficiency: 0.41, mfePct: 0.024, rawFeatures: { momentum_5: 0.88, breakout_pct: 0.28 }, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", brokerMode: "paper", reason: "take_profit" },
        { symbol: "ADAUSDT", exitAt: "2026-03-09T23:00:00.000Z", pnlQuote: -5, netPnlPct: -0.005, executionQualityScore: 0.48, labelScore: 0.41, captureEfficiency: 0.14, mfePct: 0.016, rawFeatures: { momentum_5: -0.45, breakout_pct: -0.08 }, strategyAtEntry: "vwap_reversion", regimeAtEntry: "range", brokerMode: "paper", reason: "time_stop" }
      ]
    },
    dataRecorder: { learningFrames: 10, decisionFrames: 18 },
    counterfactuals: [
      { outcome: "missed_winner", realizedMovePct: 0.022, blockerReasons: ["provider_ops"], regime: "trend", strategy: "ema_trend" },
      { outcome: "missed_winner", realizedMovePct: 0.016, blockerReasons: ["provider_ops"], regime: "trend", strategy: "ema_trend" },
      { outcome: "blocked_correctly", realizedMovePct: -0.01, blockerReasons: ["exchange_notice_risk"], regime: "event_risk", strategy: "donchian_breakout" }
    ],
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  assert.equal(summary.vetoFeedback.badVetoCount, 2);
  assert.ok(summary.blockerScorecards.some((item) => item.id === "provider_ops" && item.status === "relax"));
  assert.ok(summary.regimeScorecards.some((item) => item.id === "trend"));
  assert.equal(summary.thresholdPolicy.status, "adjust");
  assert.ok(summary.thresholdPolicy.recommendations.some((item) => item.id === "provider_ops" && item.action === "relax"));
  assert.ok(summary.exitLearning.averageExitScore > 0);
  assert.ok(summary.exitScorecards.some((item) => item.id === "take_profit"));
  assert.ok(summary.exitLearning.strategyPolicies.some((item) => item.id === "ema_trend"));
  assert.ok(summary.exitLearning.regimePolicies.some((item) => item.id === "trend"));
  assert.ok(summary.featureDecay.trackedFeatureCount >= 2);
  assert.ok(summary.calibrationGovernance.governanceScore > 0);
  assert.ok(summary.regimeDeployment.readyRegimes.includes("trend"));
});

await runCheck("adaptive model exposes expert mix and neural overlays", async () => {
  const model = new AdaptiveTradingModel(undefined, makeConfig({ enableTransformerChallenger: false }));
  const rawFeatures = {
    momentum_20: 0.011,
    ema_gap: 0.0048,
    breakout_pct: 0.007,
    realized_vol_pct: 0.019,
    book_pressure: 0.15
  };
  const marketSnapshot = {
    candles: Array.from({ length: 24 }, (_, index) => ({
      openTime: `2026-03-10T${String(index).padStart(2, "0")}:00:00.000Z`,
      closeTime: `2026-03-10T${String(index).padStart(2, "0")}:15:00.000Z`,
      open: 100 + index * 0.1,
      high: 100.3 + index * 0.1,
      low: 99.8 + index * 0.1,
      close: 100.12 + index * 0.14,
      volume: 1200 + index * 18
    })),
    market: { emaTrendScore: 0.62, momentum20: 0.011, breakoutPct: 0.007, realizedVolPct: 0.019 },
    book: {
      spreadBps: 4.2,
      bookPressure: 0.15,
      depthConfidence: 0.64,
      tradeFlowImbalance: 0.09,
      localBook: { depthConfidence: 0.64, queueImbalance: 0.11, queueRefreshScore: 0.18, resilienceScore: 0.22 },
      entryEstimate: { touchSlippageBps: 0.8, midSlippageBps: 0.5 }
    },
    timeframes: {
      lower: { market: { emaTrendScore: 0.55, momentum20: 0.01, breakoutPct: 0.006, supertrendDirection: 1, realizedVolPct: 0.018 } },
      higher: { market: { emaTrendScore: 0.48, momentum20: 0.008, breakoutPct: 0.004, supertrendDirection: 1, realizedVolPct: 0.021 } }
    }
  };
  const score = model.score(rawFeatures, {
    regimeSummary: { regime: "trend", confidence: 0.74, bias: 0.31 },
    marketFeatures: marketSnapshot.market,
    marketSnapshot,
    bookFeatures: marketSnapshot.book,
    newsSummary: { reliabilityScore: 0.74, riskScore: 0.18, eventRiskScore: 0.08 },
    marketStructureSummary: { signalScore: 0.24, riskScore: 0.28, longSqueezeScore: 0.12, crowdingBias: 0.08 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.72 },
    timeframeSummary: { enabled: true, alignmentScore: 0.7, lowerBias: 0.18, higherBias: 0.24, directionAgreement: 1, volatilityGapPct: 0.003 },
    pairHealthSummary: { score: 0.68 },
    divergenceSummary: { averageScore: 0.12 }
  });
  assert.ok(score.sequence.probability >= 0 && score.sequence.probability <= 1);
  assert.ok(score.metaNeural.probability >= 0 && score.metaNeural.probability <= 1);
  assert.ok(score.executionNeural.confidence >= 0);
  assert.ok(["trend", "range", "breakout", "high_vol", "event_risk"].includes(score.expertMix.dominantRegime));
});

await runCheck("adaptive model learns from sequence meta and execution overlays", async () => {
  const model = new AdaptiveTradingModel(undefined, makeConfig({ enableTransformerChallenger: false }));
  const rawFeatures = { momentum_20: 0.01, ema_gap: 0.004, breakout_pct: 0.006, realized_vol_pct: 0.018 };
  const marketSnapshot = {
    candles: Array.from({ length: 24 }, (_, index) => ({
      open: 50 + index * 0.05,
      high: 50.2 + index * 0.05,
      low: 49.8 + index * 0.05,
      close: 50.08 + index * 0.08,
      volume: 600 + index * 14
    })),
    market: { emaTrendScore: 0.52, momentum20: 0.01, breakoutPct: 0.006, realizedVolPct: 0.018 },
    book: {
      spreadBps: 4,
      bookPressure: 0.12,
      depthConfidence: 0.58,
      tradeFlowImbalance: 0.06,
      localBook: { depthConfidence: 0.58, queueImbalance: 0.08, queueRefreshScore: 0.11, resilienceScore: 0.16 },
      entryEstimate: { touchSlippageBps: 0.7, midSlippageBps: 0.45 }
    },
    timeframes: {
      lower: { market: { emaTrendScore: 0.51, momentum20: 0.009, breakoutPct: 0.005, supertrendDirection: 1, realizedVolPct: 0.017 } },
      higher: { market: { emaTrendScore: 0.47, momentum20: 0.007, breakoutPct: 0.003, supertrendDirection: 1, realizedVolPct: 0.02 } }
    }
  };
  const score = model.score(rawFeatures, {
    regimeSummary: { regime: "trend", confidence: 0.7, bias: 0.28 },
    marketFeatures: marketSnapshot.market,
    marketSnapshot,
    bookFeatures: marketSnapshot.book,
    newsSummary: { reliabilityScore: 0.72, riskScore: 0.16, eventRiskScore: 0.05 },
    marketStructureSummary: { signalScore: 0.22, riskScore: 0.24, longSqueezeScore: 0.1, crowdingBias: 0.06 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.7 },
    timeframeSummary: { enabled: true, alignmentScore: 0.68, lowerBias: 0.16, higherBias: 0.21, directionAgreement: 1, volatilityGapPct: 0.003 },
    pairHealthSummary: { score: 0.66 },
    divergenceSummary: { averageScore: 0.1 }
  });
  const learning = model.updateFromTrade({
    symbol: "BTCUSDT",
    exitAt: "2026-03-10T12:00:00.000Z",
    brokerMode: "paper",
    pnlQuote: 24,
    netPnlPct: 0.018,
    mfePct: 0.024,
    maePct: -0.004,
    captureEfficiency: 0.64,
    executionQualityScore: 0.72,
    rawFeatures,
    regimeAtEntry: "trend",
    strategyAtEntry: "ema_trend",
    entryExecutionAttribution: {
      entryStyle: "limit_maker",
      makerFillRatio: 0.68,
      takerFillRatio: 0.32,
      slippageDeltaBps: 0.8,
      workingTimeMs: 1800,
      depthConfidence: 0.58,
      queueImbalance: 0.08,
      queueRefreshScore: 0.11,
      resilienceScore: 0.16,
      tradeFlow: 0.06
    },
    entryRationale: {
      probability: score.probability,
      confidence: score.confidence,
      calibrationConfidence: score.calibrationConfidence,
      strategy: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.7 },
      sequence: score.sequence,
      metaNeural: score.metaNeural,
      executionNeural: score.executionNeural,
      expertMix: score.expertMix,
      timeframe: { alignmentScore: 0.68 },
      orderBook: { bookPressure: 0.12 },
      committee: { netScore: 0.2, agreement: 0.62 },
      pairHealth: { score: 0.66 }
    },
    exitIntelligenceSummary: {
      action: "trail",
      heldMinutes: 75,
      progressToScaleOut: 1.1,
      onChainStress: 0.22,
      timeframeAlignment: 0.68,
      executionRegretScore: 0.08
    }
  });
  assert.ok(learning.sequenceLearning);
  assert.ok(learning.metaNeuralLearning);
  assert.ok(learning.executionNeuralLearning);
  assert.ok(learning.exitNeuralLearning);
});

await runCheck("offline trainer reports false positive and false negative scorecards", async () => {
  const trainer = new OfflineTrainer(makeConfig());
  const summary = trainer.buildSummary({
    journal: {
      trades: [
        { symbol: "BTCUSDT", exitAt: "2026-03-09T10:00:00.000Z", pnlQuote: -12, netPnlPct: -0.011, executionQualityScore: 0.42, labelScore: 0.39, rawFeatures: { a: 1 }, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", brokerMode: "paper" },
        { symbol: "ETHUSDT", exitAt: "2026-03-09T14:00:00.000Z", pnlQuote: 16, netPnlPct: 0.013, executionQualityScore: 0.66, labelScore: 0.74, rawFeatures: { a: 1 }, strategyAtEntry: "vwap_reversion", regimeAtEntry: "range", brokerMode: "paper" }
      ]
    },
    dataRecorder: { learningFrames: 9, decisionFrames: 14 },
    counterfactuals: [
      { outcome: "missed_winner", realizedMovePct: 0.022, strategy: "breakout_strategy" },
      { outcome: "blocked_correctly", realizedMovePct: -0.009, strategy: "ema_trend" }
    ],
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  assert.equal(summary.falsePositiveTrades, 1);
  assert.equal(summary.falseNegativeTrades, 1);
  assert.ok(summary.falsePositiveByStrategy.some((item) => item.id === "ema_trend"));
  assert.ok(summary.falseNegativeByStrategy.some((item) => item.id === "breakout_strategy"));
});

await runCheck("on-chain lite summary captures stablecoin liquidity context", async () => {
  const service = new OnChainLiteService({ config: makeConfig(), runtime: {}, logger: null, fetchImpl: async () => ({ ok: true, json: async () => [] }) });
  const summary = service.summarize([
    { market_cap: 110000000000, total_volume: 54000000000, price_change_percentage_24h: 1.1 },
    { market_cap: 62000000000, total_volume: 16000000000, price_change_percentage_24h: 0.4 }
  ], { totalMarketCapUsd: 2500000000000 });
  assert.ok(summary.liquidityScore > 0.4);
  assert.ok(summary.stablecoinDominancePct > 0);
});
await runCheck("strategy optimizer exposes bayesian scorecards", async () => {
  const optimizer = new StrategyOptimizer(makeConfig());
  const snapshot = optimizer.buildSnapshot({
    journal: {
      trades: [
        { strategyAtEntry: "ema_trend", pnlQuote: 18, netPnlPct: 0.015, labelScore: 0.74, exitAt: "2026-03-05T10:00:00.000Z", brokerMode: "paper" },
        { strategyAtEntry: "ema_trend", pnlQuote: 12, netPnlPct: 0.01, labelScore: 0.68, exitAt: "2026-03-06T10:00:00.000Z", brokerMode: "paper" },
        { strategyAtEntry: "vwap_reversion", pnlQuote: -6, netPnlPct: -0.005, labelScore: 0.42, exitAt: "2026-03-07T10:00:00.000Z", brokerMode: "paper" },
        { strategyAtEntry: "ema_trend", pnlQuote: 9, netPnlPct: 0.008, labelScore: 0.63, exitAt: "2026-03-08T10:00:00.000Z", brokerMode: "live" }
      ]
    },
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  assert.ok(snapshot.strategyScorecards.length >= 2);
  assert.ok(snapshot.topStrategies[0].thompsonScore >= snapshot.topStrategies[0].rewardScore);
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot.strategyThresholdTilts, "ema_trend"));
});

await runCheck("portfolio optimizer v2 returns allocator score and budgets", async () => {
  const optimizer = new PortfolioOptimizer(makeConfig({ maxFamilyPositions: 2, maxRegimePositions: 2 }));
  const summary = optimizer.evaluateCandidate({
    symbol: "ETHUSDT",
    runtime: { lastKnownEquity: 10000 },
    journal: {
      trades: [
        { symbol: "BTCUSDT", strategyAtEntry: "ema_trend", strategyDecision: { family: "trend_following" }, regimeAtEntry: "trend", netPnlPct: 0.012, exitAt: "2026-03-08T10:00:00.000Z", pnlQuote: 22 },
        { symbol: "ETHUSDT", strategyAtEntry: "ema_trend", strategyDecision: { family: "trend_following" }, regimeAtEntry: "trend", netPnlPct: -0.006, exitAt: "2026-03-09T11:00:00.000Z", pnlQuote: -8 }
      ],
      scaleOuts: []
    },
    marketSnapshot: { candles: Array.from({ length: 20 }, (_, index) => ({ close: 100 + index, high: 101 + index, low: 99 + index })), market: { realizedVolPct: 0.02 } },
    candidateProfile: { cluster: "layer1", sector: "layer1" },
    openPositionContexts: [
      { symbol: "BTCUSDT", profile: { cluster: "layer1", sector: "layer1" }, marketSnapshot: { candles: Array.from({ length: 20 }, (_, index) => ({ close: 200 + index, high: 201 + index, low: 199 + index })) }, position: { notional: 1200, entryPrice: 200, quantity: 6, strategyDecision: { family: "trend_following" }, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", entryRationale: { strategy: { family: "trend_following", activeStrategy: "ema_trend" }, regimeSummary: { regime: "trend" } } } }
    ],
    regimeSummary: { regime: "trend" },
    strategySummary: { family: "trend_following", activeStrategy: "ema_trend" }
  });
  assert.ok(summary.allocatorScore > 0);
  assert.ok(summary.strategyBudgetFactor > 0);
  assert.ok(summary.dailyBudgetFactor > 0);
  assert.ok(summary.clusterHeat > 0);
});

await runCheck("portfolio optimizer tracks factor budgets and factor heat", async () => {
  const optimizer = new PortfolioOptimizer(makeConfig({ maxFamilyPositions: 2, maxRegimePositions: 2 }));
  const summary = optimizer.evaluateCandidate({
    symbol: "SOLUSDT",
    runtime: { lastKnownEquity: 10000 },
    journal: {
      trades: [
        { symbol: "BTCUSDT", strategyAtEntry: "ema_trend", strategyDecision: { family: "trend_following" }, regimeAtEntry: "trend", netPnlPct: 0.015, exitAt: "2026-03-08T10:00:00.000Z", pnlQuote: 24 },
        { symbol: "ETHUSDT", strategyAtEntry: "ema_trend", strategyDecision: { family: "trend_following" }, regimeAtEntry: "trend", netPnlPct: 0.009, exitAt: "2026-03-09T11:00:00.000Z", pnlQuote: 10 }
      ],
      scaleOuts: []
    },
    marketSnapshot: { candles: Array.from({ length: 20 }, (_, index) => ({ close: 90 + index, high: 91 + index, low: 89 + index })), market: { realizedVolPct: 0.018 } },
    candidateProfile: { cluster: "layer1", sector: "layer1" },
    openPositionContexts: [
      { symbol: "BTCUSDT", profile: { cluster: "layer1", sector: "layer1" }, marketSnapshot: { candles: Array.from({ length: 20 }, (_, index) => ({ close: 200 + index, high: 201 + index, low: 199 + index })) }, position: { notional: 1800, entryPrice: 200, quantity: 9, strategyDecision: { family: "trend_following" }, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", entryRationale: { strategy: { family: "trend_following", activeStrategy: "ema_trend" }, regimeSummary: { regime: "trend" } } } }
    ],
    regimeSummary: { regime: "trend" },
    strategySummary: { family: "trend_following", activeStrategy: "ema_trend" },
    marketStructureSummary: { crowdingBias: 0.12 },
    calendarSummary: { riskScore: 0.12 }
  });
  assert.ok(summary.candidateFactors.includes("momentum"));
  assert.ok(summary.factorBudgetFactor > 0);
  assert.ok(summary.factorHeat > 0);
});

await runCheck("portfolio optimizer enforces cvar budgets and regime kill switches", async () => {
  const optimizer = new PortfolioOptimizer(makeConfig({ portfolioMaxCvarPct: 0.02, portfolioRegimeKillSwitchLossStreak: 2 }));
  const summary = optimizer.evaluateCandidate({
    symbol: "ETHUSDT",
    runtime: { lastKnownEquity: 9500 },
    journal: {
      trades: [
        { symbol: "BTCUSDT", strategyAtEntry: "ema_trend", strategyDecision: { family: "trend_following" }, regimeAtEntry: "trend", netPnlPct: -0.032, exitAt: "2026-03-08T10:00:00.000Z", pnlQuote: -40 },
        { symbol: "SOLUSDT", strategyAtEntry: "ema_trend", strategyDecision: { family: "trend_following" }, regimeAtEntry: "trend", netPnlPct: -0.028, exitAt: "2026-03-09T10:00:00.000Z", pnlQuote: -36 },
        { symbol: "ADAUSDT", strategyAtEntry: "ema_trend", strategyDecision: { family: "trend_following" }, regimeAtEntry: "trend", netPnlPct: -0.022, exitAt: "2026-03-10T10:00:00.000Z", pnlQuote: -24 }
      ],
      scaleOuts: [],
      equitySnapshots: [
        { equity: 10000 },
        { equity: 9800 },
        { equity: 9560 },
        { equity: 9480 }
      ]
    },
    marketSnapshot: { candles: Array.from({ length: 20 }, (_, index) => ({ close: 100 + index, high: 101 + index, low: 99 + index })), market: { realizedVolPct: 0.02 } },
    candidateProfile: { cluster: "layer1", sector: "layer1" },
    openPositionContexts: [],
    regimeSummary: { regime: "trend" },
    strategySummary: { family: "trend_following", activeStrategy: "ema_trend" }
  });
  assert.equal(summary.regimeKillSwitchActive, true);
  assert.ok(summary.reasons.includes("portfolio_cvar_budget_hit"));
  assert.ok(summary.reasons.includes("regime_kill_switch_active"));
});

await runCheck("on-chain lite v2 summary captures majors and trending proxies", async () => {
  const service = new OnChainLiteService({ config: makeConfig(), runtime: {}, logger: null, fetchImpl: async () => ({ ok: true, json: async () => [] }) });
  const summary = service.summarize({
    stablecoins: [
      { market_cap: 110000000000, total_volume: 54000000000, price_change_percentage_24h: 1.1 },
      { market_cap: 62000000000, total_volume: 16000000000, price_change_percentage_24h: 0.4 }
    ],
    majors: [
      { market_cap: 1000000000000, price_change_percentage_24h: 2.4 },
      { market_cap: 400000000000, price_change_percentage_24h: 1.6 },
      { market_cap: 120000000000, price_change_percentage_24h: -0.8 }
    ],
    trending: [{ symbol: "BTC" }, { symbol: "ETH" }, { symbol: "SOL" }]
  }, { totalMarketCapUsd: 2500000000000 });
  assert.ok(summary.marketBreadthScore > 0);
  assert.ok(summary.majorsMomentumScore > 0);
  assert.ok(summary.trendingSymbols.length === 3);
});

await runCheck("performance report exposes trade quality review and scorecards", async () => {
  const report = buildPerformanceReport({
    journal: {
      trades: [
        { id: "1", symbol: "BTCUSDT", strategyAtEntry: "ema_trend", entryAt: "2026-03-09T10:00:00.000Z", exitAt: "2026-03-09T12:00:00.000Z", pnlQuote: 14, netPnlPct: 0.012, mfePct: 0.02, maePct: -0.004, labelScore: 0.72, executionQualityScore: 0.68, captureEfficiency: 0.62, entryExecutionAttribution: { entryStyle: "limit_maker", slippageDeltaBps: 0.8, realizedTouchSlippageBps: 1.4, makerFillRatio: 0.66 }, entryRationale: { probability: 0.62, threshold: 0.54, strategy: { fitScore: 0.7 }, meta: { qualityScore: 0.66 }, timeframe: { alignmentScore: 0.64 } } },
        { id: "2", symbol: "ETHUSDT", strategyAtEntry: "vwap_reversion", entryAt: "2026-03-09T13:00:00.000Z", exitAt: "2026-03-09T14:00:00.000Z", pnlQuote: -9, netPnlPct: -0.008, mfePct: 0.004, maePct: -0.01, labelScore: 0.4, executionQualityScore: 0.46, captureEfficiency: 0.18, entryExecutionAttribution: { entryStyle: "market", slippageDeltaBps: 3.2, realizedTouchSlippageBps: 4.8, makerFillRatio: 0.1 }, entryRationale: { probability: 0.55, threshold: 0.53, strategy: { fitScore: 0.48 }, meta: { qualityScore: 0.44 }, timeframe: { alignmentScore: 0.42 } } }
      ],
      scaleOuts: [],
      blockedSetups: [],
      researchRuns: [],
      equitySnapshots: [{ equity: 10000 }, { equity: 10020 }, { equity: 10005 }],
      counterfactuals: [{ outcome: "missed_winner", strategy: "ema_trend", realizedMovePct: 0.018 }],
      events: []
    },
    runtime: { openPositions: [] },
    config: makeConfig(),
    now: new Date("2026-03-10T12:00:00.000Z")
  });
  assert.ok(report.tradeQualityReview.averageCompositeScore > 0);
  assert.ok(report.tradeQualityReview.strategyScorecards.length >= 2);
  assert.ok(report.recentReviews.length >= 2);
});

console.log("All checks passed.");






















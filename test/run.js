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
import { NewsService } from "../src/news/newsService.js";
import { parseProviderItems } from "../src/news/rssFeed.js";
import { BinanceAnnouncementService, normalizeCmsArticles } from "../src/events/binanceAnnouncementService.js";
import { summarizeMarketStructure } from "../src/market/marketStructureService.js";
import { summarizeMarketSentiment } from "../src/market/marketSentimentService.js";
import { ReferenceVenueService } from "../src/market/referenceVenueService.js";
import { summarizeVolatilityContext } from "../src/market/volatilityService.js";
import { LocalOrderBookEngine } from "../src/market/localOrderBook.js";
import { CalendarService, parseIcsEvents, summarizeCalendarEvents } from "../src/events/calendarService.js";
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
import { classifyRegime } from "../src/ai/regimeModel.js";
import { buildFeatureVector } from "../src/strategy/features.js";
import { evaluateStrategySet } from "../src/strategy/strategyRouter.js";
import { buildTrendStateSummary } from "../src/strategy/trendState.js";
import { buildMarketStateSummary } from "../src/strategy/marketState.js";
import { buildConfidenceBreakdown, buildDataQualitySummary, buildSignalQualitySummary } from "../src/strategy/candidateInsights.js";
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
import { buildCapitalPolicySnapshot } from "../src/runtime/capitalPolicyEngine.js";
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
    paperLearningProbeDailyLimit: 4,
    paperLearningShadowDailyLimit: 6,
    paperLearningNearMissThresholdBuffer: 0.025,
    paperLearningMinSignalQuality: 0.4,
    paperLearningMinDataQuality: 0.52,
    paperLearningMaxProbePerSessionPerDay: 2,
    paperLearningSandboxEnabled: true,
    paperLearningSandboxMinClosedTrades: 3,
    paperLearningSandboxMaxThresholdShift: 0.01,
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
    operatorAlertDiscordWebhookUrls: [],
    operatorAlertTelegramBotToken: "",
    operatorAlertTelegramChatId: "",
    operatorAlertDispatchMinSeverity: "high",
    operatorAlertDispatchCooldownMinutes: 30,
    operatorAlertSilenceMinutes: 180,
    exchangeTruthLoopIntervalSeconds: 90,
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
  assert.ok(summary.candidates[0].score.robustnessScore >= 0);
  assert.ok(summary.candidates[0].score.uniquenessScore >= 0);
  assert.ok(summary.candidates[0].promotionStage);
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
    nowIso: "2026-03-08T12:00:00.000Z"
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
  assert.ok(fill.makerMissRate >= 0);
  assert.ok(fill.partialFillRecoveryCostBps >= 0);
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
        swingStructureScore: -0.46,
        downsideAccelerationScore: 0.34,
        anchoredVwapGapPct: -0.012,
        supertrendDirection: -1,
        bearishPatternScore: 0.44,
        realizedVolPct: 0.01,
        trendMaturityScore: 0.62
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

await runCheck("market feature computation surfaces non-duplicate trend-state indicators", async () => {
  const candles = Array.from({ length: 36 }, (_, index) => {
    const drift = index < 24 ? index * 0.45 : 24 * 0.45 + (index - 24) * 0.82;
    const close = 100 + drift;
    return {
      open: close - 0.18,
      high: close + 0.44,
      low: close - 0.36,
      close,
      volume: 1200 + index * 20 + (index > 28 ? 180 : 0)
    };
  });
  const features = computeMarketFeatures(candles);
  assert.ok(features.swingStructureScore > 0.2);
  assert.ok(features.upsideAccelerationScore > 0);
  assert.ok(features.trendMaturityScore > 0);
  assert.ok(Number.isFinite(features.anchoredVwapGapPct));
  assert.ok(features.closeLocationQuality > 0);
  assert.ok(features.breakoutFollowThroughScore >= 0);
  assert.ok(features.volumeAcceptanceScore > 0);
});

await runCheck("market feature computation keeps anchored VWAP finite on short histories", async () => {
  const candles = Array.from({ length: 6 }, (_, index) => ({
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.4 + index,
    volume: 1000 + index * 10
  }));
  const features = computeMarketFeatures(candles);
  assert.ok(Number.isFinite(features.anchoredVwapGapPct));
  assert.ok(Number.isFinite(features.anchoredVwapSlopePct));
});

await runCheck("regime model uses trend-state features to classify persistent trends", async () => {
  const regime = classifyRegime({
    marketFeatures: {
      breakoutPct: 0.003,
      donchianBreakoutPct: 0.004,
      emaGap: 0.011,
      momentum20: 0.021,
      dmiSpread: 0.24,
      swingStructureScore: 0.58,
      higherHighRate: 0.88,
      lowerLowRate: 0.1,
      trendMaturityScore: 0.72,
      trendExhaustionScore: 0.24,
      trendQualityScore: 0.48,
      trendPersistence: 0.82,
      upsideAccelerationScore: 0.34,
      downsideAccelerationScore: 0.08,
      bullishPatternScore: 0.14,
      bearishPatternScore: 0.04,
      anchoredVwapGapPct: 0.011,
      supertrendDirection: 1,
      realizedVolPct: 0.018
    },
    newsSummary: { eventRiskScore: 0.04, sentimentScore: 0.06, socialCoverage: 1 },
    streamFeatures: { tradeFlowImbalance: 0.12, microTrend: 0.0011 },
    marketStructureSummary: { signalScore: 0.16, crowdingBias: 0.1, fundingRate: 0.00002, liquidationIntensity: 0.08 },
    marketSentimentSummary: { riskScore: 0.22, contrarianScore: 0.12, fearGreedValue: 61 },
    volatilitySummary: { riskScore: 0.21, regime: "calm" },
    announcementSummary: { riskScore: 0.02, highPriorityCount: 0, maxSeverity: 0.1 },
    calendarSummary: { riskScore: 0.05, urgencyScore: 0.08, highImpactCount: 0 },
    bookFeatures: { bookPressure: 0.18 }
  });
  assert.equal(regime.regime, "trend");
  assert.ok(regime.reasons.includes("trend_maturity"));
  assert.equal(regime.trendState.direction, "uptrend");
});

await runCheck("trend state summary detects sideways tapes and soft data confidence", async () => {
  const summary = buildTrendStateSummary({
    marketFeatures: {
      momentum20: 0.0004,
      emaGap: 0.0002,
      dmiSpread: 0.01,
      trendQualityScore: 0.08,
      trendPersistence: 0.52,
      swingStructureScore: 0.02,
      trendMaturityScore: 0.14,
      trendExhaustionScore: 0.12,
      realizedVolPct: 0.011,
      vwapGapPct: 0.0006,
      bollingerPosition: 0.51
    },
    bookFeatures: { spreadBps: 4, bookPressure: 0.01, depthConfidence: 0.44 },
    newsSummary: { confidence: 0.28, providerDiversity: 1, freshnessScore: 0.2 },
    announcementSummary: { freshnessScore: 0.22 },
    qualityQuorumSummary: { status: "degraded", quorumScore: 0.42 },
    venueConfirmationSummary: { status: "blocked", confirmed: false, averageHealthScore: 0.2 },
    timeframeSummary: { blockerReasons: ["higher_tf_conflict"] }
  });
  assert.equal(summary.direction, "sideways");
  assert.ok(summary.rangeScore > summary.uptrendScore);
  assert.ok(summary.dataConfidenceScore < 0.55);
  assert.ok(summary.reasons.includes("data_confidence_soft"));
});

await runCheck("market state summary exposes canonical market-state aliases", async () => {
  const trendStateSummary = buildTrendStateSummary({
    marketFeatures: {
      momentum20: 0.022,
      emaGap: 0.0075,
      dmiSpread: 0.22,
      swingStructureScore: 0.48,
      trendMaturityScore: 0.64,
      trendExhaustionScore: 0.24,
      realizedVolPct: 0.016,
      supertrendDirection: 1
    },
    bookFeatures: { spreadBps: 6, bookPressure: 0.24, depthConfidence: 0.72 },
    newsSummary: { confidence: 0.7, providerDiversity: 2, freshnessScore: 0.8 },
    timeframeSummary: {}
  });
  const marketState = buildMarketStateSummary({
    trendStateSummary,
    marketFeatures: { trendFailureScore: 0.18 }
  });
  assert.equal(marketState.direction, trendStateSummary.direction);
  assert.equal(marketState.phase, trendStateSummary.phase);
  assert.ok(marketState.trendMaturity > 0.5);
  assert.ok(marketState.dataConfidence > 0.5);
  assert.equal(marketState.trendFailure, 0.18);
});

await runCheck("candidate insight summaries expose data quality, signal quality and confidence breakdown", async () => {
  const trendStateSummary = buildTrendStateSummary({
    marketFeatures: {
      momentum20: 0.009,
      emaGap: 0.004,
      dmiSpread: 0.16,
      trendQualityScore: 0.38,
      trendPersistence: 0.72,
      swingStructureScore: 0.42,
      trendMaturityScore: 0.61,
      trendExhaustionScore: 0.21,
      realizedVolPct: 0.018,
      vwapGapPct: 0.006,
      anchoredVwapAcceptanceScore: 0.58,
      bollingerPosition: 0.68
    },
    bookFeatures: { spreadBps: 4, bookPressure: 0.16, depthConfidence: 0.66, totalDepthNotional: 250000, freshnessScore: 0.9 },
    newsSummary: { confidence: 0.7, providerDiversity: 3, freshnessScore: 0.72 },
    announcementSummary: { freshnessScore: 0.64 },
    qualityQuorumSummary: { status: "degraded", quorumScore: 0.74, observeOnly: false },
    venueConfirmationSummary: { confirmed: true, status: "confirmed", averageHealthScore: 0.82, venueCount: 2 },
    timeframeSummary: { blockerReasons: [] }
  });
  const dataQuality = buildDataQualitySummary({
    newsSummary: { coverage: 0.8, freshnessScore: 0.72, reliabilityScore: 0.76, confidence: 0.7 },
    announcementSummary: { coverage: 0.5, freshnessScore: 0.64, confidence: 0.58, riskScore: 0.08 },
    marketStructureSummary: { coverage: 1, signalScore: 0.14, riskScore: 0.12, fundingRate: 0.00002 },
    marketSentimentSummary: { coverage: 1, confidence: 0.68 },
    volatilitySummary: { coverage: 1, confidence: 0.7 },
    onChainLiteSummary: { coverage: 0.5, confidence: 0.54 },
    qualityQuorumSummary: { status: "degraded", quorumScore: 0.74, observeOnly: false },
    venueConfirmationSummary: { confirmed: true, status: "confirmed", averageHealthScore: 0.82, venueCount: 2 },
    bookFeatures: { totalDepthNotional: 250000, freshnessScore: 0.9, depthConfidence: 0.66 }
  });
  const signalQuality = buildSignalQualitySummary({
    marketFeatures: { trendQualityScore: 0.44, trendExhaustionScore: 0.2 },
    bookFeatures: { spreadBps: 4, depthConfidence: 0.66 },
    strategySummary: { fitScore: 0.62 },
    trendStateSummary,
    qualityQuorumSummary: { quorumScore: 0.74, status: "degraded", observeOnly: false },
    venueConfirmationSummary: { confirmed: true, status: "confirmed" },
    newsSummary: { riskScore: 0.08, reliabilityScore: 0.76, confidence: 0.7, socialRisk: 0.06 }
  });
  const confidence = buildConfidenceBreakdown({
    score: { calibrationConfidence: 0.61, disagreement: 0.08 },
    trendStateSummary,
    signalQualitySummary: signalQuality,
    venueConfirmationSummary: { confirmed: true, status: "confirmed" },
    qualityQuorumSummary: { quorumScore: 0.74, averageScore: 0.74 },
    strategySummary: { confidence: 0.58 },
    executionPlan: { depthConfidence: 0.66 }
  });
  assert.equal(dataQuality.status, "degraded");
  assert.ok(dataQuality.degradedButAllowed);
  assert.ok(signalQuality.overallScore > 0.5);
  assert.ok(confidence.overallConfidence > 0.5);
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

await runCheck("risk manager current exposure ignores invalid position values", async () => {
  const manager = new RiskManager(makeConfig());
  const exposure = manager.getCurrentExposure({
    openPositions: [
      { notional: 120 },
      { quantity: 2, entryPrice: 15 },
      { notional: Number.NaN, quantity: 1.5, entryPrice: 20 },
      { quantity: Number.NaN, entryPrice: 50 }
    ]
  });
  assert.equal(exposure, 180);
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
  assert.ok(decision.trendStateTuningApplied);
  assert.ok(decision.venueConfirmationSummary.confirmed);
  assert.ok(decision.maxHoldMinutes > makeConfig().maxHoldMinutes);
  assert.ok(decision.quoteAmount < 250);
});

await runCheck("risk manager keeps trend-state size tuning inside hard capital caps", async () => {
  const manager = new RiskManager(makeConfig({
    maxPositionFraction: 0.1,
    riskPerTrade: 0.1,
    maxTotalExposureFraction: 0.1
  }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.8,
      calibrationConfidence: 0.9,
      disagreement: 0.02,
      shouldAbstain: false,
      transformer: { probability: 0.78, confidence: 0.4 }
    },
    marketSnapshot: {
      book: { spreadBps: 2, bookPressure: 0.28, microPriceEdgeBps: 1.2 },
      market: {
        realizedVolPct: 0.015,
        atrPct: 0.008,
        bullishPatternScore: 0.16,
        bearishPatternScore: 0.02,
        trendMaturityScore: 0.72,
        trendExhaustionScore: 0.18,
        swingStructureScore: 0.54,
        upsideAccelerationScore: 0.18,
        downsideAccelerationScore: 0.04
      }
    },
    newsSummary: { riskScore: 0.03, sentimentScore: 0.06 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0.01 },
    marketStructureSummary: { riskScore: 0.04, signalScore: 0.12, crowdingBias: 0.04, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.03, bullishScore: 0, urgencyScore: 0 },
    committeeSummary: { agreement: 0.7, probability: 0.79, netScore: 0.18, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.5, expectedReward: 0.04 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.72, confidence: 0.62, blockers: [], agreementGap: 0.08, optimizer: { sampleSize: 20, sampleConfidence: 0.8 } },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.02 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.82 },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.ok(decision.allow);
  assert.ok(decision.trendStateTuningApplied.active);
  assert.equal(decision.quoteAmount <= 100, true);
});

await runCheck("risk manager exposes quality summaries and blocks exhausted fragile trend entries", async () => {
  const manager = new RiskManager(makeConfig({ maxSpreadBps: 18 }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.66,
      calibrationConfidence: 0.54,
      disagreement: 0.06,
      shouldAbstain: false,
      transformer: { probability: 0.63, confidence: 0.22 }
    },
    marketSnapshot: {
      book: { spreadBps: 18, bookPressure: 0.08, microPriceEdgeBps: 0.3, depthConfidence: 0.18, totalDepthNotional: 20000, freshnessScore: 0.42 },
      market: {
        realizedVolPct: 0.022,
        atrPct: 0.01,
        bullishPatternScore: 0.12,
        bearishPatternScore: 0.05,
        momentum20: 0.014,
        emaGap: 0.007,
        dmiSpread: 0.24,
        trendPersistence: 0.82,
        trendQualityScore: 0.34,
        trendExhaustionScore: 0.82,
        trendMaturityScore: 0.84,
        swingStructureScore: 0.4,
        upsideAccelerationScore: 0.22,
        downsideAccelerationScore: 0.02,
        anchoredVwapAcceptanceScore: 0.62,
        supertrendDirection: 1
      }
    },
    newsSummary: { riskScore: 0.12, sentimentScore: 0.05, reliabilityScore: 0.58, confidence: 0.52, freshnessScore: 0.34, socialRisk: 0.08 },
    announcementSummary: { riskScore: 0.04, sentimentScore: 0.01, confidence: 0.45, freshnessScore: 0.4, coverage: 0.2 },
    marketStructureSummary: { riskScore: 0.12, signalScore: 0.08, crowdingBias: 0.1, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0, coverage: 1 },
    marketSentimentSummary: { riskScore: 0.28, contrarianScore: 0.02, confidence: 0.56, coverage: 1 },
    volatilitySummary: { riskScore: 0.18, confidence: 0.62, coverage: 1 },
    onChainLiteSummary: { liquidityScore: 0.48, marketBreadthScore: 0.44, majorsMomentumScore: 0.32, confidence: 0.5, coverage: 0.5 },
    calendarSummary: { riskScore: 0.03, urgencyScore: 0 },
    committeeSummary: { agreement: 0.64, probability: 0.67, netScore: 0.12, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.42, expectedReward: 0.02 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.64, confidence: 0.52, blockers: [], agreementGap: 0.04, optimizer: { sampleSize: 14, sampleConfidence: 0.72 } },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.74 },
    qualityQuorumSummary: { status: "degraded", quorumScore: 0.62, observeOnly: false },
    executionCostSummary: { blocked: true, sizeMultiplier: 0.7 },
    venueConfirmationSummary: { status: "blocked", confirmed: false, averageHealthScore: 0.22, blockerReasons: ["reference_venue_divergence"], venueCount: 2 },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.ok(decision.reasons.length > 0);
  assert.ok(decision.dataQualitySummary.overallScore > 0);
  assert.ok(decision.signalQualitySummary.overallScore > 0);
  assert.ok(decision.confidenceBreakdown.executionConfidence < 0.5);
  assert.ok(
    decision.reasons.includes("execution_cost_budget_exceeded") ||
    decision.reasons.includes("reference_venue_divergence") ||
    decision.reasons.includes("trend_exhausted_execution_fragile")
  );
});

await runCheck("risk manager de-risks crowded trend entries when execution confidence is fragile", async () => {
  const manager = new RiskManager(makeConfig({ maxSpreadBps: 16 }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.68,
      calibrationConfidence: 0.57,
      disagreement: 0.04,
      shouldAbstain: false,
      transformer: { probability: 0.66, confidence: 0.28 }
    },
    marketSnapshot: {
      book: { spreadBps: 15, bookPressure: 0.11, microPriceEdgeBps: 0.1, depthConfidence: 0.16, totalDepthNotional: 18000, freshnessScore: 0.48 },
      market: {
        realizedVolPct: 0.024,
        atrPct: 0.011,
        bullishPatternScore: 0.09,
        bearishPatternScore: 0.04,
        momentum20: 0.017,
        emaGap: 0.008,
        dmiSpread: 0.26,
        trendPersistence: 0.81,
        trendQualityScore: 0.39,
        trendExhaustionScore: 0.79,
        trendMaturityScore: 0.88,
        swingStructureScore: 0.42,
        upsideAccelerationScore: 0.63,
        downsideAccelerationScore: 0.03,
        anchoredVwapAcceptanceScore: 0.58,
        supertrendDirection: 1
      }
    },
    newsSummary: { riskScore: 0.08, sentimentScore: 0.04, reliabilityScore: 0.62, confidence: 0.58, freshnessScore: 0.46, socialRisk: 0.09 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0.01, confidence: 0.5, freshnessScore: 0.45, coverage: 0.5 },
    marketStructureSummary: { riskScore: 0.11, signalScore: 0.09, crowdingBias: 0.08, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0, coverage: 1 },
    marketSentimentSummary: { riskScore: 0.22, contrarianScore: 0.01, confidence: 0.6, coverage: 1 },
    volatilitySummary: { riskScore: 0.14, confidence: 0.61, coverage: 1 },
    onChainLiteSummary: { liquidityScore: 0.5, marketBreadthScore: 0.46, majorsMomentumScore: 0.31, confidence: 0.52, coverage: 0.6 },
    calendarSummary: { riskScore: 0.02, urgencyScore: 0 },
    committeeSummary: { agreement: 0.67, probability: 0.69, netScore: 0.14, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.42, expectedReward: 0.02 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.66, confidence: 0.56, blockers: [], agreementGap: 0.04, optimizer: { sampleSize: 12, sampleConfidence: 0.72 } },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.76 },
    qualityQuorumSummary: { status: "ready", quorumScore: 0.8, observeOnly: false },
    executionCostSummary: { strategies: [{ id: "ema_trend", status: "blocked", averageTotalCostBps: 9 }] },
    venueConfirmationSummary: { status: "blocked", confirmed: false, averageHealthScore: 0.24, blockerReasons: ["reference_venue_divergence"], venueCount: 2 },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.ok(decision.confidenceBreakdown.executionConfidence < 0.5);
  assert.ok(
    decision.reasons.includes("execution_cost_budget_exceeded") ||
    decision.reasons.includes("reference_venue_divergence") ||
    decision.reasons.includes("model_confidence_too_low")
  );
});


await runCheck("risk manager only applies scoped threshold tuning when both strategy and regime scope match", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.61,
      calibrationConfidence: 0.48,
      disagreement: 0.03,
      shouldAbstain: false,
      transformer: { probability: 0.6, confidence: 0.2 }
    },
    marketSnapshot: {
      book: { spreadBps: 4, bookPressure: 0.18, microPriceEdgeBps: 0.7 },
      market: { realizedVolPct: 0.017, atrPct: 0.009, bullishPatternScore: 0.1, bearishPatternScore: 0.03 }
    },
    newsSummary: { riskScore: 0.04, sentimentScore: 0.04 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.06, signalScore: 0.1, crowdingBias: 0.04, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.03, urgencyScore: 0 },
    committeeSummary: { agreement: 0.62, probability: 0.63, netScore: 0.12, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.03 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.62, confidence: 0.48, blockers: [], agreementGap: 0.04, optimizer: { sampleSize: 12, sampleConfidence: 0.7 } },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.72 },
    thresholdTuningSummary: {
      appliedRecommendation: {
        id: "scoped-adjustment",
        status: "confirmed",
        adjustment: -0.03,
        confidence: 0.8,
        affectedStrategies: ["ema_trend"],
        affectedRegimes: ["breakout"]
      }
    },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.thresholdTuningApplied.status, "out_of_scope");
  assert.equal(decision.thresholdTuningApplied.adjustment, 0);
});

await runCheck("feature vector includes venue confirmation and trend-state signals", async () => {
  const trendStateSummary = buildTrendStateSummary({
    marketFeatures: {
      momentum20: 0.012,
      emaGap: 0.006,
      dmiSpread: 0.22,
      trendQualityScore: 0.44,
      trendPersistence: 0.78,
      swingStructureScore: 0.58,
      trendMaturityScore: 0.68,
      trendExhaustionScore: 0.22,
      realizedVolPct: 0.019,
      vwapGapPct: 0.008,
      bollingerPosition: 0.76,
      upsideAccelerationScore: 0.34,
      downsideAccelerationScore: 0.06,
      supertrendDirection: 1
    },
    bookFeatures: { spreadBps: 4, bookPressure: 0.22, depthConfidence: 0.72 },
    newsSummary: { confidence: 0.7, providerDiversity: 2, freshnessScore: 0.6 },
    announcementSummary: { freshnessScore: 0.5 },
    qualityQuorumSummary: { status: "ready", quorumScore: 0.82 },
    venueConfirmationSummary: { confirmed: true, status: "confirmed", averageHealthScore: 0.82 },
    timeframeSummary: { blockerReasons: [] }
  });
  const rawFeatures = buildFeatureVector({
    symbolStats: { avgPnlPct: 0.01, winRate: 0.56 },
    marketFeatures: {
      momentum5: 0.004,
      momentum20: 0.012,
      emaGap: 0.006,
      emaTrendScore: 0.008,
      emaTrendSlopePct: 0.002,
      rsi14: 61,
      adx14: 28,
      dmiSpread: 0.22,
      trendQualityScore: 0.44,
      supertrendDistancePct: 0.01,
      supertrendDirection: 1,
      supertrendFlipScore: 0,
      stochRsiK: 68,
      stochRsiD: 63,
      mfi14: 64,
      cmf20: 0.12,
      macdHistogramPct: 0.0014,
      atrPct: 0.01,
      atrExpansion: 0.24,
      realizedVolPct: 0.019,
      volumeZ: 1.1,
      breakoutPct: 0.004,
      donchianBreakoutPct: 0.005,
      donchianPosition: 0.84,
      donchianWidthPct: 0.022,
      trendStrength: 0.011,
      vwapGapPct: 0.008,
      vwapSlopePct: 0.0016,
      anchoredVwapGapPct: 0.012,
      anchoredVwapSlopePct: 0.001,
      obvSlope: 0.14,
      rangeCompression: 0.78,
      bollingerSqueezeScore: 0.42,
      bollingerPosition: 0.76,
      priceZScore: 0.88,
      keltnerWidthPct: 0.02,
      keltnerSqueezeScore: 0.48,
      squeezeReleaseScore: 0.52,
      candleBodyRatio: 0.62,
      wickSkew: -0.08,
      closeLocation: 0.82,
      trendPersistence: 0.78,
      swingStructureScore: 0.58,
      trendMaturityScore: 0.68,
      trendExhaustionScore: 0.22,
      upsideAccelerationScore: 0.34,
      downsideAccelerationScore: 0.06,
      relativeStrengthVsBtc: 0.006,
      relativeStrengthVsEth: 0.004,
      clusterRelativeStrength: 0.003,
      sectorRelativeStrength: 0.002,
      closeLocationQuality: 0.84,
      breakoutFollowThroughScore: 0.62,
      volumeAcceptanceScore: 0.58,
      liquiditySweepScore: 0,
      structureBreakScore: 1,
      bullishPatternScore: 0.14,
      bearishPatternScore: 0.04,
      insideBar: 0
    },
    trendStateSummary,
    bookFeatures: { spreadBps: 4, depthImbalance: 0.18, weightedDepthImbalance: 0.16, microPriceEdgeBps: 0.9, bookPressure: 0.22, wallImbalance: 0.08, orderbookImbalanceSignal: 0.14, queueImbalance: 0.1, queueRefreshScore: 0.12, replenishmentScore: 0.16, resilienceScore: 0.18, depthConfidence: 0.72, bidConcentration: 0.58, askConcentration: 0.42 },
    venueConfirmationSummary: { confirmed: true, status: "confirmed", divergenceBps: 2.8, averageHealthScore: 0.82 },
    newsSummary: { sentimentScore: 0.08, confidence: 0.7, riskScore: 0.08, freshnessScore: 0.6, providerDiversity: 2, sourceDiversity: 1.2, socialSentiment: 0.04, socialRisk: 0.02, socialCoverage: 1.5, operationalReliability: 0.8, eventBullishScore: 0.02, eventBearishScore: 0, eventRiskScore: 0.04 },
    announcementSummary: { sentimentScore: 0.01, riskScore: 0.02, freshnessScore: 0.5, maxSeverity: 0.1, eventBullishScore: 0, eventBearishScore: 0, eventRiskScore: 0.01 },
    marketStructureSummary: { fundingRate: 0.00002, basisBps: 6, openInterestChangePct: 0.02, takerImbalance: 0.12, crowdingBias: 0.08, globalLongShortImbalance: 0.06, topTraderImbalance: 0.04, leverageBuildupScore: 0.14, shortSqueezeScore: 0.1, longSqueezeScore: 0.08, riskScore: 0.16, signalScore: 0.18, liquidationImbalance: 0.06, liquidationIntensity: 0.08 },
    marketSentimentSummary: { contrarianScore: 0.08, btcDominancePct: 54, riskScore: 0.24 },
    volatilitySummary: { marketOptionIv: 46, marketHistoricalVol: 39, ivPremium: 2, riskScore: 0.22, regime: "calm" },
    calendarSummary: { riskScore: 0.06, bullishScore: 0.02, bearishScore: 0, urgencyScore: 0.08 },
    portfolioFeatures: { heat: 0.12, maxCorrelation: 0.24, familyBudgetFactor: 1, regimeBudgetFactor: 1, strategyBudgetFactor: 1, dailyBudgetFactor: 1, clusterHeat: 0.18, allocatorScore: 0.64 },
    streamFeatures: { tradeFlowImbalance: 0.12, microTrend: 0.0014 },
    regimeSummary: { regime: "trend" },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.7, confidence: 0.62, agreementGap: 0.08, optimizerBoost: 0.02 },
    sessionSummary: { session: "europe", isWeekend: false, lowLiquidity: false, inFundingCaution: false, riskScore: 0.08 },
    timeframeSummary: { lowerBias: 0.12, higherBias: 0.2, alignmentScore: 0.72, volatilityGapPct: 0.002, blockerReasons: [] },
    onChainLiteSummary: { liquidityScore: 0.62, riskOffScore: 0.22, stressScore: 0.18, stablecoinDominancePct: 8.4, stablecoinConcentrationPct: 56, marketBreadthScore: 0.6, majorsMomentumScore: 0.64, altLiquidityScore: 0.58, trendingScore: 0.18 },
    pairHealthSummary: { score: 0.7, infraPenalty: 0, quarantined: false },
    now: new Date("2026-03-10T10:00:00.000Z")
  });
  assert.ok(rawFeatures.swing_structure > 0);
  assert.ok(rawFeatures.trend_maturity > 0);
  assert.ok(rawFeatures.venue_confirmation > 0);
  assert.ok(rawFeatures.trend_state_up > 0);
  assert.ok(rawFeatures.data_confidence > 0);
  assert.ok(rawFeatures.feature_completeness > 0);
  assert.ok(rawFeatures.relative_strength_btc > 0);
  assert.ok(rawFeatures.breakout_follow_through > 0);
  assert.ok(rawFeatures.replenishment_quality > 0);
});

await runCheck("risk manager carries trend state summary into the decision and softens low-confidence size", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.66,
      calibrationConfidence: 0.44,
      disagreement: 0.04,
      shouldAbstain: false,
      transformer: { probability: 0.65, confidence: 0.18 }
    },
    marketSnapshot: {
      book: { spreadBps: 4, bookPressure: 0.18, microPriceEdgeBps: 0.8, depthConfidence: 0.3 },
      market: {
        realizedVolPct: 0.018,
        atrPct: 0.009,
        bullishPatternScore: 0.12,
        bearishPatternScore: 0.03,
        momentum20: 0.011,
        emaGap: 0.005,
        dmiSpread: 0.18,
        swingStructureScore: 0.42,
        trendMaturityScore: 0.61,
        trendExhaustionScore: 0.24,
        upsideAccelerationScore: 0.22,
        downsideAccelerationScore: 0.04,
        supertrendDirection: 1,
        trendQualityScore: 0.38,
        trendPersistence: 0.7,
        vwapGapPct: 0.007,
        bollingerPosition: 0.72
      }
    },
    newsSummary: { riskScore: 0.04, sentimentScore: 0.06, confidence: 0.25, providerDiversity: 1, freshnessScore: 0.2 },
    announcementSummary: { riskScore: 0.02, sentimentScore: 0, freshnessScore: 0.18 },
    marketStructureSummary: { riskScore: 0.06, signalScore: 0.1, crowdingBias: 0.05, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    calendarSummary: { riskScore: 0.04, urgencyScore: 0 },
    committeeSummary: { agreement: 0.62, probability: 0.67, netScore: 0.12, sizeMultiplier: 1, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.4, expectedReward: 0.03 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following", fitScore: 0.64, confidence: 0.46, blockers: [], agreementGap: 0.04, optimizer: { sampleSize: 12, sampleConfidence: 0.7 } },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.01 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.74 },
    qualityQuorumSummary: { status: "degraded", quorumScore: 0.46, averageScore: 0.46 },
    venueConfirmationSummary: { status: "blocked", confirmed: false, averageHealthScore: 0.18, blockerReasons: ["reference_venue_divergence"] },
    timeframeSummary: { alignmentScore: 0.62, blockerReasons: ["higher_tf_conflict"] },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.ok(["uptrend", "mixed"].includes(decision.trendStateSummary.direction));
  assert.ok(decision.trendStateSummary.dataConfidenceScore < 0.55);
  assert.ok(decision.trendStateTuningApplied.notes.includes("soft_data_confidence"));
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
        swingStructureScore: -0.52,
        downsideAccelerationScore: 0.38,
        anchoredVwapGapPct: -0.015,
        trendMaturityScore: 0.64,
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

await runCheck("risk manager keeps paper recovery probes alive through soft governance and learning blockers", async () => {
  const manager = new RiskManager(makeConfig({
    maxPositionFraction: 0.05,
    riskPerTrade: 0.002,
    minTradeUsdt: 25,
    paperRecoveryProbeSizeMultiplier: 0.22
  }));
  const decision = manager.evaluateEntry({
    symbol: "XRPUSDT",
    score: {
      probability: 0.512,
      calibrationConfidence: 0.49,
      disagreement: 0.04,
      shouldAbstain: false,
      transformer: { probability: 0.515, confidence: 0.08 }
    },
    marketSnapshot: {
      book: { spreadBps: 2.2, bookPressure: -0.14, microPriceEdgeBps: 0.18 },
      market: { realizedVolPct: 0.014, atrPct: 0.009, bearishPatternScore: 0.03, bullishPatternScore: 0.16, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.06, sentimentScore: 0.03, eventBullishScore: 0.01, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.12, signalScore: 0.05, crowdingBias: 0.03, fundingRate: 0.00002, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.21, contrarianScore: 0.1 },
    volatilitySummary: { riskScore: 0.36, ivPremium: 3 },
    calendarSummary: { riskScore: 0.06, bullishScore: 0, urgencyScore: 0.02 },
    committeeSummary: {
      agreement: 0.42,
      probability: 0.5,
      netScore: -0.01,
      sizeMultiplier: 0.95,
      vetoes: [{ id: "committee_guard" }]
    },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.39, expectedReward: 0.01 },
    strategySummary: {
      activeStrategy: "pullback_trend",
      family: "trend_following",
      fitScore: 0.54,
      confidence: 0.47,
      blockers: ["context_window"],
      agreementGap: 0.04,
      optimizer: { sampleSize: 6, sampleConfidence: 0.58 }
    },
    sessionSummary: { blockerReasons: [], lowLiquidity: false, riskScore: 0.01, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.05 },
    selfHealState: { mode: "normal", active: false, sizeMultiplier: 1, thresholdPenalty: 0, lowRiskOnly: false },
    metaSummary: { action: "pass", score: 0.63, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 150 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: {
      sizeMultiplier: 1,
      maxCorrelation: 0,
      reasons: ["strategy_budget_cooled", "cluster_budget_cooled", "regime_budget_cooled"]
    },
    regimeSummary: { regime: "trend", confidence: 0.71 },
    capitalGovernorSummary: { status: "blocked", allowEntries: false, sizeMultiplier: 0, recoveryMode: true, notes: ["drawdown recovery active"] },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.9, blockerReasons: [] },
    nowIso: "2026-03-12T09:00:00.000Z"
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.entryMode, "paper_recovery_probe");
  assert.equal(decision.learningLane, "probe");
  assert.ok(decision.suppressedReasons.includes("committee_veto"));
  assert.ok(decision.suppressedReasons.includes("strategy_context_mismatch"));
  assert.ok(decision.suppressedReasons.includes("strategy_budget_cooled"));
  assert.ok(decision.suppressedReasons.includes("cluster_budget_cooled"));
  assert.ok(decision.suppressedReasons.includes("regime_budget_cooled"));
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

await runCheck("risk manager allows paper recovery probe through mild degraded local-book quality", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "SEIUSDT",
    score: {
      probability: 0.518,
      calibrationConfidence: 0.51,
      disagreement: 0.05,
      shouldAbstain: false,
      transformer: { probability: 0.52, confidence: 0.08 }
    },
    marketSnapshot: {
      book: { spreadBps: 2.4, bookPressure: -0.16, microPriceEdgeBps: 0.14, depthConfidence: 0.18 },
      market: { realizedVolPct: 0.014, atrPct: 0.009, bearishPatternScore: 0.03, bullishPatternScore: 0.12, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.05, sentimentScore: 0.03, eventBullishScore: 0.01, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.11, signalScore: 0.04, crowdingBias: 0.01, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.22, contrarianScore: 0.11 },
    volatilitySummary: { riskScore: 0.34, ivPremium: 3 },
    calendarSummary: { riskScore: 0.05, bullishScore: 0, urgencyScore: 0.02 },
    committeeSummary: { agreement: 0.44, probability: 0.5, netScore: -0.01, sizeMultiplier: 0.96, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.36, expectedReward: 0.01 },
    strategySummary: {
      activeStrategy: "pullback_trend",
      family: "trend_following",
      fitScore: 0.56,
      confidence: 0.48,
      blockers: [],
      agreementGap: 0.03,
      optimizer: { sampleSize: 8, sampleConfidence: 0.6 }
    },
    sessionSummary: { blockerReasons: [], lowLiquidity: false, riskScore: 0.01, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: ["local_book_quality_too_low"], severity: 0.22 },
    selfHealState: { mode: "normal", active: false, sizeMultiplier: 1, thresholdPenalty: 0, lowRiskOnly: false },
    metaSummary: { action: "pass", score: 0.63, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 400 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.7 },
    qualityQuorumSummary: { status: "degraded", observeOnly: false, quorumScore: 0.62, blockerReasons: [], cautionReasons: ["local_book_quality_too_low"] },
    capitalGovernorSummary: { status: "blocked", allowEntries: false, sizeMultiplier: 0, recoveryMode: true, notes: ["drawdown recovery active"] },
    nowIso: "2026-03-12T10:00:00.000Z"
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.entryMode, "paper_recovery_probe");
  assert.ok(decision.suppressedReasons.includes("capital_governor_blocked"));
  assert.ok(decision.suppressedReasons.includes("quality_quorum_degraded"));
  assert.ok(decision.suppressedReasons.includes("local_book_quality_too_low"));
});

await runCheck("risk manager marks informative blocked paper setups as shadow learning even when they are not near threshold", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "TIAUSDT",
    score: {
      probability: 0.44,
      calibrationConfidence: 0.41,
      disagreement: 0.14,
      shouldAbstain: false,
      transformer: { probability: 0.54, confidence: 0.32 }
    },
    marketSnapshot: {
      book: { spreadBps: 3.2, bookPressure: -0.11, microPriceEdgeBps: 0.09, depthConfidence: 0.71 },
      market: { realizedVolPct: 0.016, atrPct: 0.01, bearishPatternScore: 0.04, bullishPatternScore: 0.11, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.07, sentimentScore: 0.02, eventBullishScore: 0, eventBearishScore: 0, socialSentiment: 0, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.1, signalScore: 0.03, crowdingBias: 0.01, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.2, contrarianScore: 0.08 },
    volatilitySummary: { riskScore: 0.32, ivPremium: 2 },
    calendarSummary: { riskScore: 0.05, bullishScore: 0, urgencyScore: 0.01 },
    committeeSummary: { agreement: 0.31, probability: 0.41, netScore: -0.12, sizeMultiplier: 0.94, vetoes: [{ id: "committee_guard" }] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.34, expectedReward: 0.008 },
    strategySummary: {
      activeStrategy: "vwap_trend",
      family: "trend_following",
      fitScore: 0.53,
      confidence: 0.46,
      blockers: [],
      agreementGap: 0.05,
      optimizer: { sampleSize: 4, sampleConfidence: 0.44 }
    },
    sessionSummary: { blockerReasons: ["session_liquidity_guard"], lowLiquidity: false, riskScore: 0.01, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.08 },
    selfHealState: { mode: "normal", active: false, sizeMultiplier: 1, thresholdPenalty: 0, lowRiskOnly: false },
    metaSummary: { action: "pass", score: 0.62, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: { trades: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "range", confidence: 0.68 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.9, blockerReasons: [] },
    nowIso: "2026-03-12T11:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.learningLane, "shadow");
  assert.ok(decision.paperActiveLearning.activeLearningScore >= 0.5);
});

await runCheck("risk manager treats paper entry cooldown and daily budget as soft exploration blockers", async () => {
  const manager = new RiskManager(makeConfig());
  const decision = manager.evaluateEntry({
    symbol: "ARBUSDT",
    score: {
      probability: 0.494,
      calibrationConfidence: 0.45,
      disagreement: 0.05,
      shouldAbstain: false,
      transformer: { probability: 0.5, confidence: 0.08 }
    },
    marketSnapshot: {
      book: { spreadBps: 2.8, bookPressure: -0.16, microPriceEdgeBps: 0.16, depthConfidence: 0.82 },
      market: { realizedVolPct: 0.014, atrPct: 0.009, bearishPatternScore: 0.04, bullishPatternScore: 0.13, dominantPattern: "none" }
    },
    newsSummary: { riskScore: 0.05, sentimentScore: 0.04, eventBullishScore: 0.01, eventBearishScore: 0, socialSentiment: 0.01, socialRisk: 0 },
    announcementSummary: { riskScore: 0.01, sentimentScore: 0 },
    marketStructureSummary: { riskScore: 0.1, signalScore: 0.03, crowdingBias: 0.01, fundingRate: 0.00001, liquidationImbalance: 0, liquidationIntensity: 0 },
    marketSentimentSummary: { riskScore: 0.22, contrarianScore: 0.1 },
    volatilitySummary: { riskScore: 0.35, ivPremium: 3 },
    calendarSummary: { riskScore: 0.05, bullishScore: 0, urgencyScore: 0.01 },
    committeeSummary: { agreement: 0.36, probability: 0.49, netScore: -0.03, sizeMultiplier: 0.95, vetoes: [] },
    rlAdvice: { sizeMultiplier: 1, confidence: 0.35, expectedReward: 0.008 },
    strategySummary: {
      activeStrategy: "ema_trend",
      family: "trend_following",
      fitScore: 0.52,
      confidence: 0.44,
      blockers: [],
      agreementGap: 0.04,
      optimizer: { sampleSize: 5, sampleConfidence: 0.48 }
    },
    sessionSummary: { blockerReasons: [], lowLiquidity: false, riskScore: 0.01, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.06 },
    selfHealState: { mode: "normal", active: false, sizeMultiplier: 1, thresholdPenalty: 0, lowRiskOnly: false },
    metaSummary: { action: "pass", score: 0.63, dailyTradeCount: makeConfig().maxEntriesPerDay, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: { openPositions: [] },
    journal: {
      trades: [
        {
          symbol: "ARBUSDT",
          brokerMode: "paper",
          entryAt: "2026-03-12T10:45:00.000Z",
          exitAt: "2026-03-12T10:57:00.000Z",
          pnlQuote: -1
        }
      ]
    },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "range", confidence: 0.67 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, quorumScore: 0.88, blockerReasons: [] },
    nowIso: "2026-03-12T11:00:00.000Z"
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.entryMode, "paper_exploration");
  assert.ok(decision.suppressedReasons.includes("daily_entry_budget_reached"));
});

await runCheck("risk manager blocks extra paper probes after the daily learning budget is exhausted", async () => {
  const manager = new RiskManager(makeConfig({
    paperLearningProbeDailyLimit: 0,
    paperExplorationThresholdBuffer: 0.06
  }));
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
    runtime: {
      openPositions: [],
      counterfactualQueue: []
    },
    journal: { trades: [], counterfactuals: [] },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.72 },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.paperLearningBudget.probeRemaining, 0);
});

await runCheck("risk manager ignores live probe and shadow history when tracking paper learning budgets", async () => {
  const manager = new RiskManager(makeConfig({
    paperLearningProbeDailyLimit: 4,
    paperLearningShadowDailyLimit: 6,
    paperLearningMaxProbePerFamilyPerDay: 1,
    paperLearningMaxProbePerRegimePerDay: 1,
    paperLearningMaxProbePerSessionPerDay: 1
  }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.472,
      calibrationConfidence: 0.24,
      disagreement: 0.08,
      shouldAbstain: false,
      transformer: { probability: 0.49, confidence: 0.05 }
    },
    marketSnapshot: {
      book: { spreadBps: 2, bookPressure: -0.26, microPriceEdgeBps: 0.2 },
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
    sessionSummary: { session: "asia", blockerReasons: [], lowLiquidity: false, riskScore: 0.02, sizeMultiplier: 1 },
    driftSummary: { blockerReasons: [], severity: 0.08 },
    selfHealState: { mode: "normal", active: false, sizeMultiplier: 1, thresholdPenalty: 0, lowRiskOnly: false },
    metaSummary: { action: "pass", score: 0.61, dailyTradeCount: 0, sizeMultiplier: 1, thresholdPenalty: 0 },
    runtime: {
      openPositions: [{ brokerMode: "live", learningLane: "probe", entryAt: "2026-03-08T08:30:00.000Z", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia" }],
      counterfactualQueue: [{ brokerMode: "live", learningLane: "shadow", queuedAt: "2026-03-08T09:00:00.000Z" }]
    },
    journal: {
      trades: [{ brokerMode: "live", learningLane: "probe", entryAt: "2026-03-08T08:00:00.000Z", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia" }],
      counterfactuals: [{ brokerMode: "live", learningLane: "shadow", resolvedAt: "2026-03-08T09:15:00.000Z" }]
    },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.72 },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.paperLearningBudget.probeUsed, 0);
  assert.equal(decision.paperLearningBudget.shadowUsed, 0);
  assert.equal(decision.paperLearningSampling.probeCaps.familyUsed, 0);
  assert.equal(decision.paperLearningSampling.probeCaps.regimeUsed, 0);
  assert.equal(decision.paperLearningSampling.probeCaps.sessionUsed, 0);
});

await runCheck("risk manager ignores live pnl and loss streak when paper mode evaluates risk history", async () => {
  const manager = new RiskManager(makeConfig({ botMode: "paper" }));
  const journal = {
    trades: [
      { brokerMode: "live", exitAt: "2026-03-08T08:00:00.000Z", pnlQuote: -40, symbol: "BTCUSDT" },
      { brokerMode: "live", exitAt: "2026-03-08T09:00:00.000Z", pnlQuote: -20, symbol: "BTCUSDT" },
      { brokerMode: "paper", exitAt: "2026-03-08T10:30:00.000Z", pnlQuote: 5, symbol: "BTCUSDT" }
    ],
    scaleOuts: [
      { brokerMode: "live", at: "2026-03-08T11:00:00.000Z", realizedPnl: -6 }
    ]
  };
  assert.equal(manager.getDailyRealizedPnl(journal, "2026-03-08T12:00:00.000Z"), 5);
  assert.equal(manager.getLossStreak(journal, "BTCUSDT", { nowIso: "2026-03-08T12:00:00.000Z", lookbackMinutes: 60 * 24 }), 0);
  assert.equal(manager.getRecentTradeForSymbol(journal, "BTCUSDT").brokerMode, "paper");
});

await runCheck("risk manager spreads paper probes across strategy families and regimes", async () => {
  const manager = new RiskManager(makeConfig({
    paperLearningProbeDailyLimit: 4,
    paperLearningMaxProbePerFamilyPerDay: 1,
    paperLearningMaxProbePerRegimePerDay: 1
  }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: {
      probability: 0.472,
      calibrationConfidence: 0.24,
      disagreement: 0.08,
      shouldAbstain: false,
      transformer: { probability: 0.49, confidence: 0.05 }
    },
    marketSnapshot: {
      book: { spreadBps: 2, bookPressure: -0.26, microPriceEdgeBps: 0.2 },
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
    journal: {
      trades: [
        {
          learningLane: "probe",
          entryAt: "2026-03-08T09:00:00.000Z",
          strategyFamily: "trend_following",
          regimeAtEntry: "trend"
        }
      ],
      counterfactuals: []
    },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "trend", confidence: 0.72 },
    nowIso: "2026-03-08T10:00:00.000Z"
  });
  assert.equal(decision.paperLearningSampling.canOpenProbe, false);
  assert.equal(decision.paperLearningSampling.probeCaps.familyUsed, 1);
  assert.equal(decision.paperLearningSampling.probeCaps.regimeUsed, 1);
});

await runCheck("risk manager spreads paper probes across sessions", async () => {
  const manager = new RiskManager(makeConfig({
    paperLearningProbeDailyLimit: 4,
    paperLearningMaxProbePerFamilyPerDay: 3,
    paperLearningMaxProbePerRegimePerDay: 3,
    paperLearningMaxProbePerSessionPerDay: 1
  }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: { probability: 0.56, disagreement: 0.04, confidence: 0.48, committeeConfidence: 0.5, modelConfidence: 0.48, uncertainty: 0.08 },
    features: {},
    marketSnapshot: {
      book: { spreadBps: 2, bookPressure: -0.05, depthConfidence: 0.8 },
      market: { realizedVolPct: 0.02 },
      marketState: { phase: "trend" }
    },
    newsSummary: { riskScore: 0.1, confidence: 0.7 },
    regimeSummary: { regime: "trend" },
    strategySummary: { family: "trend_following" },
    timeframeSummary: { blockerReasons: [], alignmentScore: 0.62 },
    sessionSummary: { session: "asia", blockerReasons: [], lowLiquidity: false, riskScore: 0.02, sizeMultiplier: 1 },
    qualityQuorumSummary: { status: "ready", observeOnly: false, blockerReasons: [] },
    driftSummary: { status: "ready", blockerReasons: [] },
    capitalGovernorSummary: { allowEntries: true, status: "ready", sizeMultiplier: 1 },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0.002 },
    portfolioSummary: { allocatorScore: 0.55 },
    exchangeCapabilities: { spotOnly: true, shortingEnabled: false },
    nowIso: "2026-03-11T12:00:00.000Z",
    journal: {
      trades: [{
        entryAt: "2026-03-11T09:00:00.000Z",
        learningLane: "probe",
        strategyFamily: "mean_reversion",
        regimeAtEntry: "range",
        sessionAtEntry: "asia"
      }],
      counterfactuals: []
    },
    runtime: { openPositions: [], counterfactualQueue: [] }
  });
  assert.equal(decision.paperLearningSampling.probeCaps.sessionUsed, 1);
  assert.equal(decision.paperLearningSampling.canOpenProbe, false);
  assert.equal(decision.paperLearningSampling.probeCaps.sessionLimit, 1);
});

await runCheck("risk manager blocks repetitive paper probes when novelty is too low", async () => {
  const manager = new RiskManager(makeConfig({
    paperLearningMinNoveltyScore: 0.95,
    paperLearningMaxProbePerFamilyPerDay: 4,
    paperLearningMaxProbePerRegimePerDay: 4
  }));
  const decision = manager.evaluateEntry({
    symbol: "ETHUSDT",
    score: {
      probability: 0.486,
      calibrationConfidence: 0.3,
      disagreement: 0.07,
      shouldAbstain: false,
      transformer: { probability: 0.5, confidence: 0.06 }
    },
    marketSnapshot: {
      book: { spreadBps: 2, bookPressure: -0.18, microPriceEdgeBps: 0.14 },
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
    journal: {
      trades: [
        {
          learningLane: "probe",
          entryAt: "2026-03-08T09:00:00.000Z",
          strategyFamily: "trend_following",
          regimeAtEntry: "range"
        },
        {
          learningLane: "probe",
          entryAt: "2026-03-08T10:00:00.000Z",
          strategyFamily: "trend_following",
          regimeAtEntry: "range"
        }
      ],
      counterfactuals: []
    },
    balance: { quoteFree: 1000 },
    symbolStats: { avgPnlPct: 0 },
    portfolioSummary: { sizeMultiplier: 1, maxCorrelation: 0, reasons: [] },
    regimeSummary: { regime: "range", confidence: 0.68 },
    nowIso: "2026-03-08T14:00:00.000Z"
  });
  assert.equal(decision.allow, false);
  assert.ok(decision.reasons.includes("paper_learning_novelty_too_low"));
  assert.ok(decision.paperLearningSampling.noveltyScore < 0.95);
});

await runCheck("risk manager applies paper threshold sandbox shifts per scope", async () => {
  const manager = new RiskManager(makeConfig({
    botMode: "paper",
    paperLearningSandboxEnabled: true,
    paperLearningSandboxMinClosedTrades: 3,
    paperLearningSandboxMaxThresholdShift: 0.01
  }));
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: { probability: 0.56, disagreement: 0.05 },
    rawFeatures: {},
    marketSnapshot: {
      book: { spreadBps: 4, ask: 100, bid: 99.9, mid: 99.95, bookPressure: 0.18 },
      market: { realizedVolPct: 0.02 }
    },
    marketStructureSummary: { riskScore: 0.1 },
    newsSummary: { riskScore: 0.1, reliabilityScore: 0.8 },
    announcementSummary: { riskScore: 0.05 },
    calendarSummary: { riskScore: 0.05 },
    volatilitySummary: { riskScore: 0.15 },
    regimeSummary: { regime: "trend" },
    strategySummary: { family: "trend_following", activeStrategy: "ema_trend" },
    sessionSummary: { session: "asia" },
    runtime: { openPositions: [], counterfactualQueue: [] },
    journal: {
      trades: [
        { brokerMode: "paper", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia", exitAt: "2026-03-11T10:00:00.000Z", netPnlPct: 0.011, executionQualityScore: 0.65, paperLearningOutcome: { outcome: "good_trade" } },
        { brokerMode: "paper", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia", exitAt: "2026-03-11T11:00:00.000Z", netPnlPct: 0.008, executionQualityScore: 0.61, paperLearningOutcome: { outcome: "good_trade" } },
        { brokerMode: "paper", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia", exitAt: "2026-03-11T12:00:00.000Z", netPnlPct: 0.004, executionQualityScore: 0.58, paperLearningOutcome: { outcome: "acceptable_trade" } }
      ],
      scaleOuts: [],
      counterfactuals: []
    },
    rules,
    balance: { quoteFree: 1000 },
    nowIso: "2026-03-12T12:00:00.000Z",
    quoteBalance: 1000,
    remainingExposureBudget: 300,
    portfolioSummary: {},
    symbolStats: { avgPnlPct: 0.003 },
    qualityQuorumSummary: { status: "ready", quorumScore: 1, observeOnly: false, blockerReasons: [], cautionReasons: [] }
  });
  assert.equal(decision.paperThresholdSandbox.status, "relax");
  assert.ok(decision.paperThresholdSandbox.thresholdShift < 0);
  assert.ok(decision.threshold < decision.paperThresholdSandbox.thresholdBeforeSandbox);
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

await runCheck("performance report keeps open exposure finite with invalid positions", async () => {
  const report = buildPerformanceReport({
    journal: {
      trades: [],
      equitySnapshots: []
    },
    runtime: {
      openPositions: [
        { notional: 300 },
        { notional: Number.NaN, quantity: 2, entryPrice: 15 },
        { quantity: Number.NaN, entryPrice: 40 }
      ]
    },
    config: {
      reportLookbackTrades: 50
    }
  });
  assert.equal(report.openExposure, 330);
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

await runCheck("bot manager requires ack for unresolved critical alerts", async () => {
  const manager = new BotManager({ projectRoot: process.cwd(), logger: { warn() {}, error() {} } });
  const readiness = manager.buildOperationalReadiness({
    manager: { runState: "running", currentMode: "paper" },
    dashboard: {
      overview: { lastAnalysisAt: "2026-03-11T08:00:00.000Z" },
      ops: {
        alerts: {
          alerts: [{ id: "exchange_truth_freeze", severity: "negative", acknowledgedAt: null, resolvedAt: null }]
        }
      },
      safety: { orderLifecycle: { pendingActions: [] } }
    }
  });
  assert.equal(readiness.ok, false);
  assert.ok(readiness.reasons.includes("operator_ack_required"));
});

await runCheck("bot manager does not require ack in paper for governance-only alerts", async () => {
  const manager = new BotManager({ projectRoot: process.cwd(), logger: { warn() {}, error() {} } });
  const readiness = manager.buildOperationalReadiness({
    manager: { runState: "running", currentMode: "paper" },
    dashboard: {
      overview: { lastAnalysisAt: "2026-03-11T08:00:00.000Z" },
      ops: {
        alerts: {
          alerts: [
            { id: "capital_governor_blocked", severity: "critical", acknowledgedAt: null, resolvedAt: null },
            { id: "execution_cost_budget_blocked", severity: "high", acknowledgedAt: null, resolvedAt: null }
          ]
        }
      },
      safety: { orderLifecycle: { pendingActions: [] } }
    }
  });
  assert.equal(readiness.reasons.includes("operator_ack_required"), false);
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
      "DATA_RECORDER_COLD_RETENTION_DAYS=61",
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
    assert.equal(config.dataRecorderColdRetentionDays, 61);
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
    const decisionFile = path.join(tempDir, "feature-store", "decisions", "2026-03-10.jsonl");
    const tradeFile = path.join(tempDir, "feature-store", "trades", "2026-03-10.jsonl");
    await fs.mkdir(path.join(tempDir, "feature-store", "decisions"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "feature-store", "trades"), { recursive: true });
    await fs.writeFile(
      decisionFile,
      `${JSON.stringify({ at: "2026-03-10T08:00:00.000Z", recordQuality: { kind: "decision", score: 0.82, tier: "high" } })}\n${JSON.stringify({ at: "2026-03-10T10:00:00.000Z", recordQuality: { kind: "decision", score: 0.58, tier: "medium" } })}\n`
    );
    await fs.writeFile(
      tradeFile,
      `${JSON.stringify({ at: "2026-03-10T12:30:00.000Z", recordQuality: { kind: "trade", score: 0.41, tier: "low" } })}\n`
    );
    await fs.utimes(decisionFile, new Date("2026-03-10T10:00:00.000Z"), new Date("2026-03-10T10:00:00.000Z"));
    await fs.utimes(tradeFile, new Date("2026-03-10T12:30:00.000Z"), new Date("2026-03-10T12:30:00.000Z"));
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
      snapshotFrames: 4,
      recordQualityCount: 99,
      averageRecordQuality: 0.99,
      sourceCoverage: [
        { provider: "coindesk", count: 2, avgReliability: 0.81, avgFreshnessScore: 0.88, lastSeenAt: "2026-03-10T08:00:00.000Z", channels: [["news", 2]] }
      ],
      contextCoverage: [
        { kind: "calendar", count: 1, avgCoverage: 0.7, avgConfidence: 0.66, avgRiskScore: 0.2, highImpactCount: 1, lastSeenAt: "2026-03-10T08:00:00.000Z", nextEventAt: "2026-03-10T13:30:00.000Z" }
      ]
    });
    const summary = recorder.getSummary();
    assert.equal(summary.filesWritten, 3);
    assert.equal(summary.decisionFrames, 2);
    assert.equal(summary.tradeFrames, 1);
    assert.equal(summary.learningFrames, 0);
    assert.equal(summary.snapshotFrames, 0);
    assert.equal(summary.lastRecordAt, "2026-03-10T12:30:00.000Z");
    assert.equal(summary.recordQualityCount, 3);
    assert.equal(summary.averageRecordQuality, 0.6033);
    assert.equal(summary.latestRecordQuality?.kind, "trade");
    assert.equal(summary.latestRecordQuality?.score, 0.41);
    assert.equal(summary.qualityByKind.find((item) => item.kind === "decision")?.count, 2);
    assert.equal(summary.qualityByKind.find((item) => item.kind === "trade")?.count, 1);
    assert.equal(summary.sourceCoverage[0].provider, "coindesk");
    assert.equal(summary.contextCoverage[0].kind, "calendar");
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
    assert.deepEqual(runtime.ops.alertState.resolvedAtById, {});
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
    assert.equal(payload.schemaVersion, 6);
    assert.equal(payload.frameType, "learning");
    assert.equal(payload.symbol, "BTCUSDT");
    assert.equal(payload.model.calibrationObservations, 18);
    assert.equal(payload.rawFeatures.momentum_5, 1.2);
    assert.equal(payload.indicators.supertrendDirection, 1);
    assert.equal(payload.recordQuality.kind, "learning");
    assert.ok(payload.recordQuality.score >= 0);
    assert.ok(payload.rationale.topSignals.length >= 1);
    assert.equal(recorder.getSummary().qualityByKind[0].kind, "learning");
    assert.equal(recorder.getSummary().qualityByKind[0].count, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("data recorder stores decision quality through the shared recorder path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-recorder-decisions-"));
  try {
    const recorder = new DataRecorder({
      runtimeDir: tempDir,
      config: { dataRecorderEnabled: true, dataRecorderRetentionDays: 21 },
      logger: { info() {}, warn() {} }
    });
    await recorder.init();
    await recorder.recordDecisions({
      at: "2026-03-10T11:00:00.000Z",
      candidates: [{
        symbol: "BTCUSDT",
        score: { probability: 0.62, confidence: 0.58, calibrationConfidence: 0.54 },
        decision: { allow: true, threshold: 0.55, rankScore: 0.13, reasons: [] },
        regimeSummary: { regime: "trend" },
        strategySummary: { activeStrategy: "ema_trend", family: "trend_following" },
        marketSnapshot: { book: { bookPressure: 0.18, spreadBps: 2.2 }, market: { adx14: 25 } },
        dataQualitySummary: { status: "ready", overallScore: 0.74, freshnessScore: 0.71, trustScore: 0.78, coverageScore: 0.81, sources: [{ label: "news", status: "ready", coverage: 1, freshnessScore: 0.7, trustScore: 0.8 }] },
        confidenceBreakdown: { marketConfidence: 0.7, dataConfidence: 0.78, executionConfidence: 0.69, modelConfidence: 0.66, overallConfidence: 0.71 },
        marketStateSummary: { direction: "uptrend", phase: "healthy_continuation", trendMaturity: 0.52, trendExhaustion: 0.21, rangeAcceptance: 0.18, trendFailure: 0.14, dataConfidence: 0.78, featureCompleteness: 1 },
        newsSummary: { coverage: 2, freshnessHours: 2.4, reliabilityScore: 0.81 },
        announcementSummary: { coverage: 1 },
        rawFeatures: { momentum_5: 1.2 }
      }]
    });
    const stored = await fs.readFile(path.join(tempDir, "feature-store", "decisions", "2026-03-10.jsonl"), "utf8");
    const payload = JSON.parse(stored.trim());
    assert.equal(payload.recordQuality.kind, "decision");
    assert.equal(recorder.getSummary().decisionFrames, 1);
    assert.equal(recorder.getSummary().qualityByKind[0].kind, "decision");
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

await runCheck("data recorder stores historical news frames and dataset curation summaries", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-recorder-news-"));
  try {
    const recorder = new DataRecorder({
      runtimeDir: tempDir,
      config: { dataRecorderEnabled: true, dataRecorderRetentionDays: 21, dataRecorderColdRetentionDays: 90 },
      logger: { info() {}, warn() {} }
    });
    await recorder.init();
    await recorder.recordNewsHistory({
      at: "2026-03-12T08:00:00.000Z",
      symbol: "BTCUSDT",
      aliases: ["BTC", "Bitcoin"],
      summary: {
        coverage: 3,
        confidence: 0.62,
        reliabilityScore: 0.71,
        riskScore: 0.18,
        freshnessScore: 0.84,
        dominantEventType: "etf_flow",
        providerOperationalHealth: [{ provider: "coindesk", score: 0.9 }]
      },
      items: [
        {
          title: "ETF inflows support Bitcoin",
          provider: "coindesk",
          source: "CoinDesk",
          channel: "news",
          publishedAt: "2026-03-12T07:15:00.000Z",
          score: 0.48,
          riskScore: 0.12,
          reliability: { reliabilityScore: 0.82, sourceQuality: 0.8, whitelisted: true },
          event: { dominantType: "etf_flow" },
          link: "https://example.com/btc"
        }
      ]
    });
    await recorder.recordDatasetCuration({
      at: "2026-03-12T08:05:00.000Z",
      newsCache: {
        BTCUSDT: { summary: { coverage: 3, reliabilityScore: 0.71 } },
        ETHUSDT: { summary: { coverage: 1, reliabilityScore: 0.64 } }
      },
      sourceReliability: { operationalReliability: 0.77 },
      paperLearning: { status: "building" },
      journal: {
        trades: [
          { brokerMode: "paper", regimeAtEntry: "trend", executionQualityScore: 0.74, paperLearningOutcome: { outcome: "good_trade", executionQuality: "solid" } },
          { brokerMode: "paper", regimeAtEntry: "range", executionQualityScore: 0.41, paperLearningOutcome: { outcome: "early_exit", executionQuality: "weak" } }
        ],
        blockedSetups: [{ symbol: "SOLUSDT" }],
        counterfactuals: [{ outcome: "bad_veto" }, { outcome: "good_veto" }]
      }
    });
    const newsStored = await fs.readFile(path.join(tempDir, "feature-store", "news", "2026-03-12.jsonl"), "utf8");
    const datasetStored = await fs.readFile(path.join(tempDir, "feature-store", "datasets", "2026-03-12.jsonl"), "utf8");
    const newsPayload = JSON.parse(newsStored.trim());
    const datasetPayload = JSON.parse(datasetStored.trim());
    assert.equal(newsPayload.frameType, "news_history");
    assert.equal(newsPayload.symbol, "BTCUSDT");
    assert.equal(newsPayload.items[0].dominantEventType, "etf_flow");
    assert.equal(datasetPayload.frameType, "dataset_curation");
    assert.equal(datasetPayload.datasets.paperLearning.status, "building");
    assert.equal(datasetPayload.datasets.vetoReview.badVetoCount, 1);
    assert.equal(recorder.getSummary().newsFrames, 1);
    assert.equal(recorder.getSummary().datasetFrames, 1);
    assert.equal(recorder.getSummary().sourceCoverage[0].provider, "coindesk");
    assert.equal(datasetPayload.datasets.newsHistory.topSources[0].provider, "coindesk");
    assert.equal(datasetPayload.datasets.dataQuality.qualityByKind[0].kind, "news");
    assert.ok(recorder.getSummary().datasetCuration.dataQuality.hotRetentionDays >= 21);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("data recorder stores announcement and calendar context history frames", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-recorder-context-"));
  try {
    const recorder = new DataRecorder({
      runtimeDir: tempDir,
      config: { dataRecorderEnabled: true, dataRecorderRetentionDays: 21, dataRecorderColdRetentionDays: 90 },
      logger: { info() {}, warn() {} }
    });
    await recorder.init();
    await recorder.recordContextHistory({
      at: "2026-03-12T09:00:00.000Z",
      symbol: "BTCUSDT",
      aliases: ["BTC"],
      kind: "announcements",
      summary: {
        coverage: 2,
        confidence: 0.77,
        riskScore: 0.28,
        dominantEventType: "maintenance",
        blockerReasons: ["maintenance"],
        highPriorityCount: 1,
        latestNoticeAt: "2026-03-12T08:30:00.000Z"
      },
      items: [{ title: "Scheduled maintenance", publishedAt: "2026-03-12T08:30:00.000Z", category: "maintenance", source: "Binance", severity: 0.9 }]
    });
    await recorder.recordContextHistory({
      at: "2026-03-12T09:02:00.000Z",
      symbol: "BTCUSDT",
      aliases: ["BTC"],
      kind: "calendar",
      summary: {
        coverage: 1,
        confidence: 0.68,
        riskScore: 0.35,
        nextEventType: "macro_cpi",
        nextEventTitle: "US CPI",
        nextEventAt: "2026-03-12T13:30:00.000Z",
        blockerReasons: ["macro_cpi"],
        highImpactCount: 1
      },
      items: [{ title: "US CPI", at: "2026-03-12T13:30:00.000Z", type: "macro_cpi", source: "BLS", impact: 0.92 }]
    });
    const stored = await fs.readFile(path.join(tempDir, "feature-store", "contexts", "2026-03-12.jsonl"), "utf8");
    const lines = stored.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].frameType, "context_history");
    assert.equal(lines[0].contextType, "announcements");
    assert.equal(lines[1].contextType, "calendar");
    assert.equal(lines[1].summary.dominantEventType, "macro_cpi");
    assert.equal(recorder.getSummary().contextCoverage[0].kind, "announcements");
    assert.equal(recorder.getSummary().contextCoverage[1].kind, "calendar");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("news service records a cached history use once per cache snapshot", async () => {
  const runtime = {
    newsCache: {
      BTCUSDT: {
        fetchedAt: new Date(Date.now() - 60_000).toISOString(),
        summary: { coverage: 2, confidence: 0.61, reliabilityScore: 0.72, freshnessScore: 0.8 },
        items: [{ title: "Cached headline", provider: "coindesk" }]
      }
    }
  };
  const calls = [];
  const service = new NewsService({
    config: makeConfig({ newsCacheMinutes: 30 }),
    runtime,
    logger: { info() {}, warn() {} },
    recordHistory: async (payload) => { calls.push(payload); }
  });
  await service.getSymbolSummary("BTCUSDT", ["BTC"]);
  await service.getSymbolSummary("BTCUSDT", ["BTC"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cacheState, "cached");
});

await runCheck("announcement service records a cached context use once per cache snapshot", async () => {
  const runtime = {
    exchangeNoticeCache: {
      "notice:BTCUSDT": {
        fetchedAt: new Date(Date.now() - 60_000).toISOString(),
        summary: { coverage: 1, confidence: 0.74, riskScore: 0.2 },
        items: [{ title: "Maintenance", type: "maintenance" }]
      }
    }
  };
  const calls = [];
  const service = new BinanceAnnouncementService({
    config: makeConfig({ announcementCacheMinutes: 30 }),
    runtime,
    logger: { info() {}, warn() {} },
    recordHistory: async (payload) => { calls.push(payload); }
  });
  await service.getSymbolSummary("BTCUSDT", ["BTC"]);
  await service.getSymbolSummary("BTCUSDT", ["BTC"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cacheState, "cached");
  assert.equal(calls[0].kind, "announcements");
});

await runCheck("calendar service records a cached context use once per cache snapshot", async () => {
  const runtime = {
    calendarCache: {
      fetchedAt: new Date(Date.now() - 60_000).toISOString(),
      items: [
        { title: "US CPI", at: "2026-03-12T12:30:00.000Z", impact: 0.9, type: "macro_cpi", source: "BLS" }
      ]
    }
  };
  const calls = [];
  const service = new CalendarService({
    config: makeConfig({ calendarCacheMinutes: 30 }),
    runtime,
    logger: { info() {}, warn() {} },
    recordHistory: async (payload) => { calls.push(payload); }
  });
  await service.getSymbolSummary("BTCUSDT", ["BTC"]);
  await service.getSymbolSummary("BTCUSDT", ["BTC"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cacheState, "cached");
  assert.equal(calls[0].kind, "calendar");
});

await runCheck("calendar service records cached context separately per symbol", async () => {
  const runtime = {
    calendarCache: {
      fetchedAt: new Date(Date.now() - 60_000).toISOString(),
      items: [
        { title: "US CPI", at: "2026-03-12T12:30:00.000Z", impact: 0.9, type: "macro_cpi", source: "BLS" }
      ]
    }
  };
  const calls = [];
  const service = new CalendarService({
    config: makeConfig({ calendarCacheMinutes: 30 }),
    runtime,
    logger: { info() {}, warn() {} },
    recordHistory: async (payload) => { calls.push(payload); }
  });
  await service.getSymbolSummary("BTCUSDT", ["BTC"]);
  await service.getSymbolSummary("ETHUSDT", ["ETH"]);
  await service.getSymbolSummary("BTCUSDT", ["BTC"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].symbol, "BTCUSDT");
  assert.equal(calls[1].symbol, "ETHUSDT");
  assert.equal(calls[0].cacheState, "cached");
  assert.equal(calls[1].cacheState, "cached");
});

await runCheck("calendar service records stale cached fallback as fallback history", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("network down");
  };
  const runtime = {
    calendarCache: {
      fetchedAt: "2026-03-10T08:00:00.000Z",
      items: [
        { title: "US CPI", at: "2026-03-12T12:30:00.000Z", impact: 0.9, type: "macro_cpi", source: "BLS" }
      ]
    }
  };
  const calls = [];
  try {
    const service = new CalendarService({
      config: makeConfig({ calendarCacheMinutes: 1 }),
      runtime,
      logger: { info() {}, warn() {} },
      recordHistory: async (payload) => { calls.push(payload); }
    });
    await service.getSymbolSummary("BTCUSDT", ["BTC"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cacheState, "fallback");
  } finally {
    global.fetch = originalFetch;
  }
});

await runCheck("data recorder builds historical bootstrap summary from stored frames", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-recorder-bootstrap-"));
  try {
    const recorder = new DataRecorder({
      runtimeDir: tempDir,
      config: { dataRecorderEnabled: true, dataRecorderRetentionDays: 21, dataRecorderColdRetentionDays: 90 },
      logger: { info() {}, warn() {} }
    });
    await recorder.init();
    await recorder.recordNewsHistory({
      at: "2026-03-12T08:00:00.000Z",
      symbol: "BTCUSDT",
      summary: { coverage: 2, confidence: 0.66, reliabilityScore: 0.74, freshnessScore: 0.82 },
      items: [{ title: "BTC headline", provider: "coindesk", source: "CoinDesk", channel: "news", publishedAt: "2026-03-12T07:55:00.000Z", reliability: { reliabilityScore: 0.81 }, event: { dominantType: "etf_flow" } }]
    });
    await recorder.recordContextHistory({
      at: "2026-03-12T08:02:00.000Z",
      symbol: "BTCUSDT",
      kind: "calendar",
      summary: { coverage: 1, confidence: 0.71, riskScore: 0.33, nextEventType: "macro_cpi", nextEventAt: "2026-03-12T13:30:00.000Z" },
      items: [{ title: "US CPI", at: "2026-03-12T13:30:00.000Z", type: "macro_cpi", source: "BLS", impact: 0.92 }]
    });
    await recorder.recordLearningEvent({
      trade: {
        symbol: "BTCUSDT",
        brokerMode: "paper",
        strategyAtEntry: "ema_trend",
        regimeAtEntry: "trend",
        pnlQuote: 12.4,
        netPnlPct: 0.012,
        labelScore: 0.77,
        rawFeatures: {},
        entryRationale: {
          strategy: { family: "trend_following", activeStrategy: "ema_trend" },
          marketState: { dataConfidence: 0.8 },
          dataQuality: { sources: [], coverageScore: 0.8, freshnessScore: 0.82, trustScore: 0.79, status: "ready" },
          confidenceBreakdown: { dataConfidence: 0.79, marketConfidence: 0.76, overallConfidence: 0.78 }
        }
      },
      learning: { label: { labelScore: 0.77 } }
    });
    await recorder.recordDatasetCuration({
      at: "2026-03-12T08:05:00.000Z",
      paperLearning: { status: "building" },
      newsCache: { BTCUSDT: { summary: { coverage: 2, reliabilityScore: 0.74 } } },
      sourceReliability: { operationalReliability: 0.8 },
      journal: {
        trades: [{ brokerMode: "paper", regimeAtEntry: "trend", strategyAtEntry: "ema_trend", executionQualityScore: 0.67, paperLearningOutcome: { outcome: "good_trade", executionQuality: "solid" } }],
        blockedSetups: [{ symbol: "BTCUSDT" }],
        counterfactuals: [{ outcome: "bad_veto" }]
      }
    });
    const bootstrap = await recorder.loadHistoricalBootstrap();
    assert.equal(bootstrap.status, "ready");
    assert.equal(bootstrap.learning.topFamilies[0].id, "trend_following");
    assert.equal(bootstrap.news.topProviders[0].id, "coindesk");
    assert.equal(bootstrap.contexts.topKinds[0].id, "calendar");
    assert.equal(bootstrap.latestDatasetCuration.paperLearningStatus, "building");
    assert.equal(recorder.getSummary().latestBootstrap.status, "ready");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await runCheck("data recorder compacts old files into archive before deletion", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-recorder-archive-"));
  try {
    const recorder = new DataRecorder({
      runtimeDir: tempDir,
      config: { dataRecorderEnabled: true, dataRecorderRetentionDays: 3, dataRecorderColdRetentionDays: 5 },
      logger: { info() {}, warn() {} }
    });
    await recorder.init();
    const bucketDir = path.join(tempDir, "feature-store", "decisions");
    for (const day of ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]) {
      await fs.writeFile(path.join(bucketDir, `${day}.jsonl`), "{}\n");
    }
    await recorder.prune();
    const hotFiles = (await fs.readdir(bucketDir)).sort();
    const archiveDir = path.join(tempDir, "feature-store", "archive", "decisions");
    const archivedFiles = (await fs.readdir(archiveDir)).sort();
    assert.deepEqual(hotFiles, ["2026-03-04.jsonl", "2026-03-05.jsonl", "2026-03-06.jsonl"]);
    assert.deepEqual(archivedFiles, ["2026-03-02.jsonl", "2026-03-03.jsonl"]);
    assert.equal(recorder.getSummary().retention.hotRetentionDays, 3);
    assert.equal(recorder.getSummary().retention.coldRetentionDays, 5);
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

await runCheck("paper broker persists learning lanes on positions and closed trades", async () => {
  const broker = new (await import("../src/execution/paperBroker.js")).PaperBroker(makeConfig(), { warn() {}, info() {} });
  const runtime = { openPositions: [], paperPortfolio: { quoteFree: 10000, feesPaid: 0, realizedPnl: 0 } };
  const position = await broker.enterPosition({
    symbol: "BTCUSDT",
    quoteAmount: 900,
    rules,
    marketSnapshot: { book: { bid: 69990, ask: 70010, mid: 70000, spreadBps: 2 } },
    decision: {
      stopLossPct: 0.02,
      takeProfitPct: 0.03,
      executionPlan: { entryStyle: "market", fallbackStyle: "none" },
      regime: "trend",
      sessionSummary: { session: "asia" },
      learningLane: "probe",
      learningValueScore: 0.73,
      paperLearningBudget: { probeDailyLimit: 4, probeUsed: 1, probeRemaining: 3 }
    },
    score: { probability: 0.7, regime: "trend" },
    rawFeatures: { momentum_5: 1 },
    strategySummary: { activeStrategy: "ema_trend" },
    newsSummary: { sentimentScore: 0.1 },
    runtime
  });
  assert.equal(position.learningLane, "probe");
  assert.equal(position.learningValueScore, 0.73);
  assert.equal(position.sessionAtEntry, "asia");
  const trade = await broker.exitPosition({
    position,
    marketSnapshot: { book: { bid: 70500, mid: 70510, spreadBps: 2, exitEstimate: { averagePrice: 70500 } } },
    reason: "test_exit",
    runtime
  });
  assert.equal(trade.learningLane, "probe");
  assert.equal(trade.learningValueScore, 0.73);
  assert.equal(trade.sessionAtEntry, "asia");
  assert.equal(typeof trade.paperLearningOutcome?.outcome, "string");
  assert.equal(typeof trade.paperLearningOutcome?.entryQuality, "string");
  assert.equal(typeof trade.paperLearningOutcome?.exitQuality, "string");
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
          resolvedAtById: {},
          delivery: { lastDeliveredAtById: { health_circuit_open: "2026-03-09T09:45:00.000Z" } }
        }
      }
    },
    readiness: { status: "blocked", reasons: ["exchange_safety_blocked"] },
    exchangeSafety: { status: "blocked", notes: ["reconcile needed"], actions: ["run reconcile"] },
    strategyRetirement: { retireCount: 1, policies: [{ id: "donchian_breakout", status: "retire" }] },
    executionCost: { status: "blocked", notes: ["execution costs too high"] },
    capitalGovernor: { status: "blocked", notes: ["weekly drawdown exceeded"] },
    config: makeConfig({ botMode: "live" }),
    nowIso: "2026-03-09T10:00:00.000Z"
  });
  assert.equal(alerts.criticalCount, 3);
  assert.ok(alerts.alerts.some((item) => item.id === "capital_governor_blocked"));
  assert.ok(alerts.alerts.some((item) => item.id === "health_circuit_open"));
  assert.ok(alerts.alerts.some((item) => item.id === "execution_cost_budget_blocked"));
  assert.ok(alerts.alerts.some((item) => item.id === "self_heal_paused" && item.acknowledgedAt && item.state === "acked"));
});

await runCheck("operator alerts soften governance-only blockers in paper mode", async () => {
  const alerts = buildOperatorAlerts({
    runtime: {
      health: {},
      orderLifecycle: { pendingActions: [] },
      selfHeal: { mode: "paper_calibration_probe", reason: "calibration_break" },
      thresholdTuning: {},
      ops: { alertState: {} }
    },
    readiness: { status: "degraded", reasons: ["capital_governor_blocked", "operator_ack_required"] },
    exchangeSafety: { status: "ready" },
    strategyRetirement: { retireCount: 0, policies: [] },
    executionCost: { status: "blocked", notes: ["execution costs too high"] },
    capitalGovernor: { status: "blocked", notes: ["weekly drawdown exceeded"] },
    config: makeConfig({ botMode: "paper" }),
    nowIso: "2026-03-09T10:00:00.000Z"
  });
  const capitalAlert = alerts.alerts.find((item) => item.id === "capital_governor_blocked");
  const executionAlert = alerts.alerts.find((item) => item.id === "execution_cost_budget_blocked");
  assert.equal(capitalAlert.severity, "medium");
  assert.equal(executionAlert.severity, "medium");
  assert.equal(alerts.criticalCount, 0);
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

await runCheck("capital governor ignores live history when evaluating paper mode", async () => {
  const summary = buildCapitalGovernor({
    journal: {
      trades: [
        { brokerMode: "live", exitAt: "2026-03-05T10:00:00.000Z", pnlQuote: -180 },
        { brokerMode: "live", exitAt: "2026-03-06T10:00:00.000Z", pnlQuote: -220 },
        { brokerMode: "paper", exitAt: "2026-03-08T10:00:00.000Z", pnlQuote: 12 }
      ],
      scaleOuts: [
        { brokerMode: "live", at: "2026-03-08T11:00:00.000Z", realizedPnl: -20 }
      ],
      equitySnapshots: [
        { brokerMode: "live", at: "2026-03-05T00:00:00.000Z", equity: 10000 },
        { brokerMode: "live", at: "2026-03-08T00:00:00.000Z", equity: 9200 },
        { brokerMode: "paper", at: "2026-03-08T00:00:00.000Z", equity: 10000 },
        { brokerMode: "paper", at: "2026-03-08T12:00:00.000Z", equity: 10012 }
      ]
    },
    runtime: {},
    config: makeConfig({ botMode: "paper", capitalGovernorWeeklyDrawdownPct: 0.05 }),
    nowIso: "2026-03-08T12:00:00.000Z"
  });
  assert.equal(summary.status, "ready");
  assert.equal(summary.allowEntries, true);
  assert.equal(summary.dailyLossFraction, 0);
  assert.equal(summary.weeklyLossFraction, 0);
});

await runCheck("operator alert dispatcher builds and dispatches webhook plans safely", async () => {
  const alerts = buildOperatorAlerts({
    runtime: {
      health: { circuitOpen: true },
      ops: {
        alertState: {
          acknowledgedAtById: {},
          silencedUntilById: {},
          resolvedAtById: {},
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

await runCheck("operator alert dispatcher supports discord and telegram channels", async () => {
  const alerts = buildOperatorAlerts({
    runtime: {
      health: { circuitOpen: true },
      ops: {
        alertState: {
          acknowledgedAtById: {},
          silencedUntilById: {},
          resolvedAtById: {},
          delivery: { lastDeliveredAtById: {} }
        }
      }
    },
    config: makeConfig({
      operatorAlertDiscordWebhookUrls: ["https://discord.example/hook"],
      operatorAlertTelegramBotToken: "token",
      operatorAlertTelegramChatId: "12345"
    }),
    nowIso: "2026-03-09T10:00:00.000Z"
  });
  const plan = buildOperatorAlertDispatchPlan({
    alerts,
    config: makeConfig({
      operatorAlertDiscordWebhookUrls: ["https://discord.example/hook"],
      operatorAlertTelegramBotToken: "token",
      operatorAlertTelegramChatId: "12345"
    }),
    nowIso: "2026-03-09T10:00:00.000Z"
  });
  assert.equal(plan.endpointCount, 2);
  assert.ok(plan.endpoints.some((item) => item.kind === "discord"));
  assert.ok(plan.endpoints.some((item) => item.kind === "telegram"));
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
          replayCheckpoints: [{ at: "2026-03-09T10:00:00.000Z", price: 69800 }],
          protectionWarning: "rebuild_failed",
          exitExecutionAttribution: { partialFillRatio: 0.35 }
        }
      ],
      blockedSetups: [
        {
          outcome: "missed_winner",
          blockerReasons: ["reference_venue_divergence", "local_book_quality_too_low"],
          dataQuality: { missingCount: 1 },
          reasons: ["missing_news"]
        }
      ]
    },
    nowIso: "2026-03-09T12:00:00.000Z"
  });
  assert.equal(summary.tradeCount, 2);
  assert.equal(summary.missedWinnerCount, 1);
  assert.equal(summary.worstStrategy, "ema_trend");
  assert.ok(summary.scenarioLeaders.length >= 1);
  assert.ok(summary.activeScenarios.some((item) => item.id === "stale_book"));
  assert.ok(summary.activeScenarios.some((item) => item.id === "venue_divergence"));
  assert.ok(summary.activeScenarios.some((item) => item.id === "partial_fill"));
  assert.ok(summary.recommendedActions.some((item) => item.id === "partial_fill"));
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
  bot.runtime = {
    offlineTrainer: {
      counterfactuals: { total: 4, averageMissedMovePct: 0.018 },
      blockerScorecards: [
        {
          id: "committee_veto",
          badVetoRate: 0.5,
          goodVetoRate: 0.25,
          averageMovePct: 0.021,
          status: "review"
        }
      ],
      strategyScorecards: [
        {
          id: "ema_trend",
          falseNegativeRate: 0.33,
          status: "watch"
        }
      ]
    }
  };
  bot.journal = {
    counterfactuals: [
      { brokerMode: "paper", outcome: "bad_veto", blockerReasons: ["committee_veto"], strategy: "ema_trend", marketPhase: "range_acceptance", realizedMovePct: 0.024 },
      { brokerMode: "live", outcome: "bad_veto", blockerReasons: ["committee_veto"], strategy: "ema_trend", marketPhase: "range_acceptance", realizedMovePct: 0.052 }
    ]
  };
  const view = bot.buildDashboardDecisionView({
    symbol: "BTCUSDT",
    allow: false,
    blockerReasons: ["committee_veto"],
    probability: 0.58,
    threshold: 0.6,
    sessionBlockers: ["session_liquidity_guard"],
    driftBlockers: ["drift_confidence_guard"],
    selfHealIssues: ["loss_streak_warning"],
    session: { session: "asia", sessionLabel: "Asia", blockerReasons: ["session_liquidity_guard"] },
    drift: { blockerReasons: ["drift_confidence_guard"] },
    selfHeal: { issues: ["loss_streak_warning"] },
    qualityQuorum: { status: "degraded", quorumScore: 0.75, blockerReasons: [], cautionReasons: ["calendar"] },
    trendState: { direction: "sideways", phase: "range_acceptance", uptrendScore: 0.2, downtrendScore: 0.18, rangeScore: 0.76, rangeAcceptanceScore: 0.71, dataConfidenceScore: 0.62, completenessScore: 0.64, reasons: ["range_acceptance"] },
    marketState: { direction: "sideways", phase: "range_acceptance", trendMaturity: 0.22, trendExhaustion: 0.18, rangeAcceptance: 0.71, trendFailure: 0.16, dataConfidence: 0.62, featureCompleteness: 0.64, reasons: ["range_acceptance"] },
    dataQuality: { status: "degraded", overallScore: 0.63, freshnessScore: 0.58, trustScore: 0.66, coverageScore: 0.61, degradedButAllowed: true, sources: [{ label: "news", status: "degraded" }] },
    signalQuality: { overallScore: 0.57, setupFit: 0.58, structureQuality: 0.61, executionViability: 0.42, newsCleanliness: 0.63, quorumQuality: 0.54 },
    confidenceBreakdown: { marketConfidence: 0.56, dataConfidence: 0.62, executionConfidence: 0.41, modelConfidence: 0.58, overallConfidence: 0.54 },
    executionCostBudget: { status: "watch" }
  });
  assert.deepEqual(view.sessionBlockers, ["session_liquidity_guard"]);
  assert.deepEqual(view.driftBlockers, ["drift_confidence_guard"]);
  assert.deepEqual(view.selfHealIssues, ["loss_streak_warning"]);
  assert.equal(view.trendState.phase, "range_acceptance");
  assert.equal(view.dataQuality.degradedButAllowed, true);
  assert.equal(view.signalQuality.executionViability, 0.42);
  assert.equal(view.confidenceBreakdown.executionConfidence, 0.41);
  assert.equal(view.marketState.phase, "range_acceptance");
  assert.equal(view.executionBudget.status, "watch");
  assert.ok(view.operatorAction);
  assert.ok(view.dataQuality.degradedSourceLabels.includes("news"));
  assert.equal(view.missedTradeAnalysis.available, true);
  assert.equal(view.missedTradeAnalysis.blockerId, "committee_veto");
  assert.equal(view.missedTradeAnalysis.recentMatches, 1);
  assert.equal(view.missedTradeAnalysis.recentAverageMovePct, 0.024);
});

await runCheck("dashboard decision view translates common operator blockers into readable guidance", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.runtime = { offlineTrainer: { counterfactuals: { total: 0, averageMissedMovePct: 0 }, blockerScorecards: [], strategyScorecards: [] } };
  bot.journal = { counterfactuals: [] };
  const view = bot.buildDashboardDecisionView({
    symbol: "DOGEUSDT",
    allow: false,
    blockerReasons: ["capital_governor_blocked", "model_confidence_too_low"],
    dataQuality: { status: "ready", overallScore: 0.72, freshnessScore: 0.7, trustScore: 0.68, coverageScore: 0.75, degradedButAllowed: false, sources: [] },
    signalQuality: { overallScore: 0.58, setupFit: 0.61, structureQuality: 0.56, executionViability: 0.49, newsCleanliness: 0.64, quorumQuality: 0.71 },
    confidenceBreakdown: { marketConfidence: 0.55, dataConfidence: 0.7, executionConfidence: 0.48, modelConfidence: 0.41, overallConfidence: 0.53 }
  });
  assert.ok(view.operatorAction.includes("Capital governor houdt entries nu tegen."));
  assert.equal(view.missedTradeAnalysis.available, false);
});

await runCheck("dashboard decision view preserves readable operator fields and maps probe-only codes", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.runtime = { offlineTrainer: { counterfactuals: { total: 0, averageMissedMovePct: 0 }, blockerScorecards: [], strategyScorecards: [] } };
  bot.journal = { counterfactuals: [] };
  const readableView = bot.buildDashboardDecisionView({
    symbol: "BTCUSDT",
    allow: false,
    operatorAction: "Gebruik deze setup alleen als leergeval.",
    autoRecovery: "Wacht tot de datafeed vanzelf herstelt."
  });
  assert.equal(readableView.operatorAction, "Gebruik deze setup alleen als leergeval.");
  assert.equal(readableView.autoRecovery, "Wacht tot de datafeed vanzelf herstelt.");

  const probeOnlyView = bot.buildDashboardDecisionView({
    symbol: "ETHUSDT",
    allow: false,
    operatorAction: "probe_only",
    autoRecovery: "operator_probe_window"
  });
  assert.ok(probeOnlyView.operatorAction.includes("Alleen probe-entries"));
  assert.ok(probeOnlyView.autoRecovery.includes("probe-only periode"));
});

await runCheck("doctor preview scan uses explicit read-only candidate scan mode", async () => {
  const bot = Object.create(TradingBot.prototype);
  let called = 0;
  bot.config = makeConfig();
  bot.journal = { trades: [], scaleOuts: [], blockedSetups: [], cycles: [], equitySnapshots: [], events: [] };
  bot.runtime = {
    mode: "paper",
    openPositions: [],
    drift: {},
    selfHeal: {},
    pairHealth: {},
    qualityQuorum: {},
    divergence: {},
    offlineTrainer: {},
    sourceReliability: {},
    exchangeCapabilities: bot.config.exchangeCapabilities,
    session: {},
    marketSentiment: {},
    onChainLite: {},
    volatilityContext: {},
    dataRecorder: {}
  };
  bot.broker = {
    getBalance: async () => ({ quoteFree: 1000 }),
    doctor: async () => ({ ok: true })
  };
  bot.health = { getStatus: () => ({ ok: true }) };
  bot.stream = { getStatus: () => ({ publicStreamConnected: true }) };
  bot.model = {
    getCalibrationSummary: () => ({}),
    getDeploymentSummary: () => ({})
  };
  bot.client = { getClockOffsetMs: () => 0, getClockSyncState: () => ({}) };
  bot.dataRecorder = { getSummary: () => ({ filesWritten: 0 }) };
  bot.buildResearchView = () => null;
  bot.maybeRunExchangeTruthLoop = async () => null;
  bot.scanCandidatesReadOnly = async () => {
    called += 1;
    return [];
  };
  const report = await bot.runDoctor();
  assert.equal(called, 1);
  assert.equal(report.mode, "paper");
});

await runCheck("scanCandidatesReadOnly does not mutate runtime journals or local-book universe", async () => {
  const bot = Object.create(TradingBot.prototype);
  let localBookCalls = 0;
  bot.config = makeConfig({
    watchlist: ["BTCUSDT"],
    enableUniverseSelector: false,
    candidateEvaluationConcurrency: 1,
    marketSnapshotConcurrency: 1
  });
  bot.logger = { warn() {}, info() {} };
  bot.marketCache = {};
  bot.symbolRules = { BTCUSDT: { minNotional: 5 } };
  bot.runtime = {
    openPositions: [],
    latestDecisions: [{ symbol: "ETHUSDT", allow: true }],
    aiTelemetry: {},
    pairHealth: {},
    qualityQuorum: {},
    venueConfirmation: {},
    marketSentiment: {},
    volatilityContext: {},
    onChainLite: {},
    divergence: {},
    offlineTrainer: {},
    sourceReliability: {},
    universe: {},
    session: {}
  };
  bot.journal = {
    universeRuns: [],
    blockedSetups: [],
    counterfactuals: [],
    trades: [],
    scaleOuts: []
  };
  bot.stream = {
    getSymbolStreamFeatures() {
      return {};
    },
    getOrderBookSnapshot() {
      return null;
    },
    setLocalBookUniverse() {
      localBookCalls += 1;
    }
  };
  bot.buildOpenPositionContexts = () => ({});
  bot.getMarketSnapshot = async () => ({
    symbol: "BTCUSDT",
    market: { realizedVolPct: 0.01, atrPct: 0.008 },
    book: { spreadBps: 3, bookPressure: 0.1 }
  });
  bot.strategyOptimizer = { buildSnapshot: () => ({}) };
  bot.strategyAttribution = { buildSnapshot: () => ({}) };
  bot.marketSentiment = { getSummary: async () => ({}) };
  bot.volatility = { getSummary: async () => ({}) };
  bot.onChainLite = { getSummary: async () => ({}) };
  bot.pairHealthMonitor = { buildSnapshot: () => ({}) };
  bot.divergenceMonitor = { buildSummary: () => ({}) };
  bot.offlineTrainer = { buildSummary: () => ({}) };
  bot.dataRecorder = {
    getSummary: () => ({
      schemaVersion: 6,
      enabled: true,
      learningFrames: 8,
      decisionFrames: 14,
      newsFrames: 3,
      contextFrames: 2,
      datasetFrames: 1,
      archivedFiles: 4,
      lineageCoverage: 0.81,
      averageRecordQuality: 0.74,
      latestRecordQuality: { kind: "learning", score: 0.77, tier: "medium" },
      qualityByKind: [{ kind: "learning", count: 8, averageScore: 0.74, high: 2, medium: 5, low: 1 }],
      sourceCoverage: [{ provider: "coindesk", count: 3, avgReliability: 0.82, avgFreshnessScore: 0.88, lastSeenAt: "2026-03-12T08:10:00.000Z", channels: [["news", 3]] }],
      contextCoverage: [{ kind: "calendar", count: 2, avgCoverage: 0.71, avgConfidence: 0.66, avgRiskScore: 0.3, highImpactCount: 1, lastSeenAt: "2026-03-12T08:15:00.000Z", nextEventAt: "2026-03-12T13:30:00.000Z" }],
      retention: { hotRetentionDays: 21, coldRetentionDays: 90, lastCompactionAt: "2026-03-12T08:00:00.000Z" }
    })
  };
  bot.evaluateCandidate = async () => ({
    symbol: "BTCUSDT",
    decision: { allow: false, rankScore: 0.5 }
  });
  const beforeRuntime = JSON.stringify(bot.runtime);
  const beforeJournal = JSON.stringify(bot.journal);
  const candidates = await bot.scanCandidatesReadOnly({ quoteFree: 1000 });
  assert.equal(candidates.length, 1);
  assert.equal(localBookCalls, 0);
  assert.equal(JSON.stringify(bot.runtime), beforeRuntime);
  assert.equal(JSON.stringify(bot.journal), beforeJournal);
});

await runCheck("scanCandidatesForResearch does not mutate runtime journals or local-book universe", async () => {
  const bot = Object.create(TradingBot.prototype);
  let localBookCalls = 0;
  bot.config = makeConfig({
    watchlist: ["BTCUSDT"],
    enableUniverseSelector: false,
    candidateEvaluationConcurrency: 1,
    marketSnapshotConcurrency: 1
  });
  bot.logger = { warn() {}, info() {} };
  bot.marketCache = {};
  bot.symbolRules = { BTCUSDT: { minNotional: 5 } };
  bot.runtime = {
    openPositions: [],
    latestDecisions: [],
    aiTelemetry: {},
    pairHealth: {},
    qualityQuorum: {},
    venueConfirmation: {},
    marketSentiment: {},
    volatilityContext: {},
    onChainLite: {},
    divergence: {},
    offlineTrainer: {},
    sourceReliability: {},
    universe: {},
    session: {}
  };
  bot.journal = { universeRuns: [], blockedSetups: [], counterfactuals: [], trades: [], scaleOuts: [] };
  bot.stream = {
    getSymbolStreamFeatures() { return {}; },
    getOrderBookSnapshot() { return null; },
    setLocalBookUniverse() { localBookCalls += 1; }
  };
  bot.buildOpenPositionContexts = () => ({});
  bot.getMarketSnapshot = async () => ({ symbol: "BTCUSDT", market: { realizedVolPct: 0.01, atrPct: 0.008 }, book: { spreadBps: 3, bookPressure: 0.1 } });
  bot.strategyOptimizer = { buildSnapshot: () => ({}) };
  bot.strategyAttribution = { buildSnapshot: () => ({}) };
  bot.marketSentiment = { getSummary: async () => ({}) };
  bot.volatility = { getSummary: async () => ({}) };
  bot.onChainLite = { getSummary: async () => ({}) };
  bot.pairHealthMonitor = { buildSnapshot: () => ({}) };
  bot.divergenceMonitor = { buildSummary: () => ({}) };
  bot.offlineTrainer = { buildSummary: () => ({}) };
  bot.dataRecorder = { getSummary: () => ({}) };
  bot.evaluateCandidate = async () => ({ symbol: "BTCUSDT", decision: { allow: false, rankScore: 0.5 } });
  const beforeRuntime = JSON.stringify(bot.runtime);
  const beforeJournal = JSON.stringify(bot.journal);
  const candidates = await bot.scanCandidatesForResearch({ quoteFree: 1000 });
  assert.equal(candidates.length, 1);
  assert.equal(localBookCalls, 0);
  assert.equal(JSON.stringify(bot.runtime), beforeRuntime);
  assert.equal(JSON.stringify(bot.journal), beforeJournal);
});

await runCheck("shadow trading view includes near-miss shadow learning candidates in paper mode", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper", shadowTradeDecisionLimit: 2, paperLearningShadowDailyLimit: 3, paperLatencyMs: 220 });
  bot.marketCache = {
    BTCUSDT: { book: { mid: 70000, ask: 70010, bid: 69990 } },
    ETHUSDT: { book: { mid: 3500, ask: 3502, bid: 3498 } }
  };
  bot.execution = {
    simulatePaperFill({ marketSnapshot }) {
      return { fillPrice: marketSnapshot.book.mid, expectedImpactBps: 1.2 };
    }
  };
  const view = bot.buildShadowTradingView([
    {
      symbol: "BTCUSDT",
      allow: true,
      quoteAmount: 250,
      probability: 0.61,
      threshold: 0.52,
      executionStyle: "market"
    },
    {
      symbol: "ETHUSDT",
      allow: false,
      quoteAmount: 120,
      probability: 0.49,
      threshold: 0.51,
      executionStyle: "limit_maker",
      learningLane: "shadow",
      learningValueScore: 0.66
    }
  ], "2026-03-12T12:00:00.000Z");
  assert.equal(view.simulatedEntries.length, 2);
  assert.ok(view.simulatedEntries.some((item) => item.status === "shadow_learning" && item.symbol === "ETHUSDT"));
});

await runCheck("lifecycle sync records disappeared pending actions and recovery actions", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig();
  bot.runtime = {
    openPositions: [],
    orderLifecycle: {
      lastUpdatedAt: null,
      positions: {},
      recentTransitions: [],
      pendingActions: [],
      activeActions: {},
      activeActionsPrevious: {
        stale_action: {
          id: "stale_action",
          type: "entry",
          symbol: "BTCUSDT",
          stage: "protect_only",
          status: "pending",
          severity: "neutral",
          detail: "waiting"
        }
      },
      actionJournal: []
    }
  };
  bot.journal = { trades: [] };
  const lifecycle = bot.syncOrderLifecycleState("test_disappearance");
  assert.equal(lifecycle.actionJournal[0].status, "disappeared");
  assert.equal(lifecycle.actionJournal[0].recoveryAction, "allow_probe_only");
});

await runCheck("trading bot stores resolve notes and operator probe-only state", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig();
  bot.runtime = {
    openPositions: [{ id: "pos-1", symbol: "BTCUSDT", manualReviewRequired: true, operatorMode: "manual_review", lifecycleState: "manual_review" }],
    ops: { alertState: { acknowledgedAtById: {}, silencedUntilById: {}, resolvedAtById: {}, notesById: {}, delivery: {} }, alerts: { alerts: [] } }
  };
  bot.store = { saveRuntime: async () => {} };
  bot.recordEvent = () => {};
  bot.syncOrderLifecycleState = () => ({});
  bot.refreshOperationalViews = () => ({});
  bot.getDashboardSnapshot = () => ({ ok: true });
  await bot.resolveAlert("alert-1", { resolved: true, note: "fixed upstream" });
  await bot.markPositionReviewed("pos-1", { note: "checked on exchange" });
  await bot.setProbeOnly({ enabled: true, minutes: 15, note: "safe tiny probes" });
  assert.equal(bot.runtime.ops.alertState.notesById["alert-1"], "fixed upstream");
  assert.equal(bot.runtime.openPositions[0].operatorMode, "protect_only");
  assert.equal(bot.runtime.probeOnly.enabled, true);
});

await runCheck("capital policy engine summarizes budgets and family kill switches", async () => {
  const snapshot = buildCapitalPolicySnapshot({
    journal: {
      trades: [
        { symbol: "BTCUSDT", exitAt: "2026-03-10T10:00:00.000Z", netPnlPct: -0.021, pnlQuote: -20, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", strategyDecision: { family: "trend_following" } },
        { symbol: "ETHUSDT", exitAt: "2026-03-10T12:00:00.000Z", netPnlPct: -0.018, pnlQuote: -16, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", strategyDecision: { family: "trend_following" } }
      ],
      scaleOuts: [],
      equitySnapshots: [{ equity: 10000 }, { equity: 9700 }]
    },
    runtime: {
      offlineTrainer: {
        strategyScorecards: [{ id: "trend_following", status: "cooldown", governanceScore: 0.34, dominantError: "false_positive_bias" }]
      }
    },
    capitalGovernor: { status: "recovery", sizeMultiplier: 0.6, weeklyLossFraction: 0.04, monthlyLossFraction: 0.06, allowEntries: true },
    capitalLadder: { stage: "limited_live", sizeMultiplier: 0.4, allowEntries: true },
    config: makeConfig(),
    nowIso: "2026-03-11T12:00:00.000Z"
  });
  assert.equal(snapshot.status, "degraded");
  assert.ok(snapshot.familyKillSwitches.some((item) => item.id === "trend_following"));
  assert.ok(snapshot.factorBudgets.length >= 1);
});

await runCheck("dashboard snapshot exposes lifecycle invariants, tuning governance and paper learning", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.model = {
    getCalibrationSummary: () => ({}),
    getDeploymentSummary: () => ({}),
    getTransformerSummary: () => ({})
  };
  bot.rlPolicy = { getSummary: () => ({}) };
  bot.strategyOptimizer = { buildSnapshot: () => ({}) };
  bot.backupManager = { getSummary: () => ({ backupCount: 0 }) };
  bot.dataRecorder = { getSummary: () => ({}) };
  bot.health = { getStatus: () => ({}) };
  bot.stream = { getStatus: () => ({}) };
  bot.maybeRunExchangeTruthLoop = async () => null;
  bot.updatePortfolioSnapshot = async () => null;
  bot.buildPositionView = (position) => position;
  bot.buildDashboardPositionView = (position) => position;
  bot.buildTradeReplayView = (trade) => trade;
  bot.buildTradeView = (trade) => trade;
  bot.buildModelWeightsView = () => [];
  bot.runtime = {
    mode: "paper",
    dataRecorder: {
      schemaVersion: 6,
      enabled: true,
      learningFrames: 8,
      decisionFrames: 14,
      newsFrames: 3,
      contextFrames: 2,
      datasetFrames: 1,
      archivedFiles: 4,
      lineageCoverage: 0.81,
      averageRecordQuality: 0.74,
      latestRecordQuality: { kind: "learning", score: 0.77, tier: "medium" },
      qualityByKind: [{ kind: "learning", count: 8, averageScore: 0.74, high: 2, medium: 5, low: 1 }],
      sourceCoverage: [{ provider: "coindesk", count: 3, avgReliability: 0.82, avgFreshnessScore: 0.88, lastSeenAt: "2026-03-12T08:10:00.000Z", channels: [["news", 3]] }],
      contextCoverage: [{ kind: "calendar", count: 2, avgCoverage: 0.71, avgConfidence: 0.66, avgRiskScore: 0.3, highImpactCount: 1, lastSeenAt: "2026-03-12T08:15:00.000Z", nextEventAt: "2026-03-12T13:30:00.000Z" }],
      retention: { hotRetentionDays: 21, coldRetentionDays: 90, lastCompactionAt: "2026-03-12T08:00:00.000Z" }
    },
    lastKnownBalance: 1000,
    lastKnownEquity: 1000,
    lastCycleAt: null,
    lastAnalysisAt: null,
    lastPortfolioUpdateAt: null,
    openPositions: [],
    latestDecisions: [],
    latestBlockedSetups: [],
    ops: { incidentTimeline: [], runbooks: [], alerts: {}, replayChaos: {}, service: {}, thresholdTuning: {}, executionCalibration: {}, capitalLadder: {}, capitalGovernor: {}, alertDelivery: {}, paperLearning: { status: "active", probeCount: 2, shadowCount: 1, notes: ["probe day"] } },
    thresholdTuning: { appliedRecommendation: { id: "trend_relax", status: "probation" } },
    parameterGovernor: { status: "active", strategyScopes: [{ scopeType: "strategy", id: "ema_trend", thresholdShift: -0.01 }], regimeScopes: [], notes: [] },
    modelRegistry: { promotionPolicy: { readyLevel: "paper", allowPromotion: false, blockerReasons: ["sample_size_low"] } },
    offlineTrainer: { thresholdPolicy: { status: "observe" } },
    exchangeTruth: { freezeEntries: true, mismatchCount: 2 },
    orderLifecycle: { pendingActions: [{ state: "manual_review" }], positions: {}, activeActions: {}, recentTransitions: [], actionJournal: [] },
    exchangeSafety: {},
    marketSentiment: {},
    onChainLite: {},
    volatilityContext: {},
    sourceReliability: {},
    session: {},
    pairHealth: {},
    qualityQuorum: {},
    divergence: {},
    service: {}
  };
  bot.journal = { trades: [], scaleOuts: [], events: [] };
  bot.config = makeConfig();
  bot.buildPortfolioView = () => ({});
  bot.buildResearchView = () => null;
  bot.buildDashboardDecisionView = TradingBot.prototype.buildDashboardDecisionView;
  const snapshot = await bot.getDashboardSnapshot();
  assert.equal(snapshot.safety.lifecycleInvariants.status, "blocked");
  assert.equal(snapshot.ops.tuningGovernance.thresholdRecommendationId, "trend_relax");
  assert.equal(snapshot.ops.tuningGovernance.governorScope, "strategy:ema_trend");
  assert.equal(snapshot.ops.paperLearning.status, "active");
  assert.equal(snapshot.ops.paperLearning.probeCount, 2);
  assert.equal(snapshot.dataRecorder.retention.coldRetentionDays, 90);
  assert.equal(snapshot.dataRecorder.latestRecordQuality.kind, "learning");
  assert.equal(snapshot.dataRecorder.qualityByKind[0].kind, "learning");
  assert.equal(snapshot.dataRecorder.sourceCoverage[0].provider, "coindesk");
  assert.equal(snapshot.dataRecorder.contextCoverage[0].kind, "calendar");
});

await runCheck("trading bot paper learning summary tracks blockers and recent outcomes", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper" });
  bot.runtime = {
    latestDecisions: [
      {
        allow: true,
        learningLane: "probe",
        learningValueScore: 0.72,
        paperLearning: { noveltyScore: 0.64, scope: { family: "trend_following", regime: "trend" } },
        paperLearningBudget: { probeDailyLimit: 4, probeUsed: 1, probeRemaining: 3, shadowDailyLimit: 6, shadowUsed: 1, shadowRemaining: 5 }
      },
      {
        allow: false,
        learningLane: "shadow",
        blockerReasons: ["committee_veto", "execution_cost_budget_exceeded"],
        learningValueScore: 0.68,
        paperLearning: { noveltyScore: 0.58, scope: { family: "mean_reversion", regime: "range" } }
      },
      {
        allow: false,
        blockerReasons: ["committee_veto"],
        paperLearning: { noveltyScore: 0.4, scope: { family: "trend_following", regime: "trend" } }
      }
    ]
  };
  bot.journal = {
    trades: [
      { brokerMode: "paper", exitAt: "2026-03-11T10:00:00.000Z", paperLearningOutcome: { outcome: "good_trade" } },
      { brokerMode: "paper", exitAt: "2026-03-11T12:00:00.000Z", paperLearningOutcome: { outcome: "early_exit" } },
      { brokerMode: "paper", exitAt: "2026-03-11T14:00:00.000Z", pnlQuote: -5, executionQualityScore: 0.35, reason: "time_stop", mfePct: 0.01, maePct: -0.01 }
    ]
  };
  const summary = TradingBot.prototype.buildPaperLearningSummary.call(bot, bot.runtime.latestDecisions, "2026-03-11T15:00:00.000Z");
  assert.equal(summary.probeCount, 1);
  assert.equal(summary.shadowCount, 1);
  assert.equal(summary.topBlockers[0].id, "committee_veto");
  assert.ok(summary.recentOutcomes.some((item) => item.id === "good_trade"));
  assert.ok(summary.recentOutcomes.some((item) => item.id === "early_exit"));
  assert.equal(summary.probation.status, "warmup");
});

await runCheck("trading bot applies historical bootstrap warm start", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.runtime = { ops: {}, thresholdTuning: {}, paperLearning: {} };
  TradingBot.prototype.applyHistoricalBootstrap.call(bot, {
    status: "ready",
    generatedAt: "2026-03-12T09:00:00.000Z",
    warmStart: {
      governanceFocus: "veto_review",
      note: "Warm start vanuit recorder."
    }
  });
  assert.equal(bot.runtime.historicalBootstrap.status, "ready");
  assert.equal(bot.runtime.ops.historicalBootstrap.warmStart.governanceFocus, "veto_review");
  assert.equal(bot.runtime.thresholdTuning.warmStart.focus, "veto_review");
  assert.equal(bot.runtime.paperLearning.notes[0], "Warm start vanuit recorder.");
});

await runCheck("trading bot threshold experiment snapshot respects combined strategy and regime scope", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.journal = {
    trades: [
      { exitAt: "2026-03-11T10:00:00.000Z", strategyAtEntry: "ema_trend", regimeAtEntry: "trend", netPnlPct: 0.01, pnlQuote: 10 },
      { exitAt: "2026-03-11T11:00:00.000Z", strategyAtEntry: "ema_trend", regimeAtEntry: "range", netPnlPct: -0.02, pnlQuote: -5 },
      { exitAt: "2026-03-11T12:00:00.000Z", strategyAtEntry: "mean_reversion", regimeAtEntry: "trend", netPnlPct: 0.03, pnlQuote: 7 }
    ]
  };
  const snapshot = TradingBot.prototype.buildThresholdExperimentSnapshot.call(bot, {
    affectedStrategies: ["ema_trend"],
    affectedRegimes: ["trend"]
  });
  assert.equal(snapshot.tradeCount, 1);
  assert.equal(snapshot.winRate, 1);
  assert.equal(snapshot.avgPnlPct, 0.01);
});

await runCheck("trading bot paper learning summary surfaces probe probation candidates", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper" });
  bot.runtime = {
    latestDecisions: [
      {
        allow: true,
        learningLane: "probe",
        learningValueScore: 0.76,
        paperLearning: { noveltyScore: 0.7, scope: { family: "trend_following", regime: "trend" } },
        paperLearningBudget: { probeDailyLimit: 4, probeUsed: 2, probeRemaining: 2, shadowDailyLimit: 6, shadowUsed: 1, shadowRemaining: 5 }
      }
    ]
  };
  bot.journal = {
    trades: [
      { brokerMode: "paper", learningLane: "probe", exitAt: "2026-03-11T10:00:00.000Z", paperLearningOutcome: { outcome: "good_trade" } },
      { brokerMode: "paper", learningLane: "probe", exitAt: "2026-03-11T11:00:00.000Z", paperLearningOutcome: { outcome: "acceptable_trade" } },
      { brokerMode: "paper", learningLane: "probe", exitAt: "2026-03-11T12:00:00.000Z", paperLearningOutcome: { outcome: "good_trade" } },
      { brokerMode: "paper", learningLane: "probe", exitAt: "2026-03-11T13:00:00.000Z", paperLearningOutcome: { outcome: "acceptable_trade" } }
    ]
  };
  const summary = TradingBot.prototype.buildPaperLearningSummary.call(bot, bot.runtime.latestDecisions, "2026-03-11T15:00:00.000Z");
  assert.equal(summary.readinessStatus, "paper_ready");
  assert.ok(summary.readinessScore > 0.72);
  assert.equal(summary.probation.status, "promote_candidate");
  assert.equal(summary.probation.promotionReady, true);
  assert.equal(summary.probation.rollbackRisk, false);
});

await runCheck("trading bot missed trade analysis narrows recent matches by blocker strategy regime and phase", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.runtime = {
    offlineTrainer: {
      blockerScorecards: [
        { id: "committee_veto", status: "observe", badVetoRate: 0.4, goodVetoRate: 0.2, averageMovePct: 0.01, count: 4 }
      ],
      strategyScorecards: [
        { id: "ema_trend", status: "observe", falseNegativeRate: 0.5 }
      ],
      counterfactuals: { total: 4, averageMissedMovePct: 0.01 }
    }
  };
  bot.journal = {
    counterfactuals: [
      { outcome: "bad_veto", blockerReasons: ["committee_veto"], strategy: "ema_trend", regime: "trend", marketPhase: "healthy_continuation", realizedMovePct: 0.02 },
      { outcome: "bad_veto", blockerReasons: ["committee_veto"], strategy: "ema_trend", regime: "range", marketPhase: "healthy_continuation", realizedMovePct: 0.04 },
      { outcome: "good_veto", blockerReasons: ["committee_veto"], strategy: "mean_reversion", marketPhase: "healthy_continuation", realizedMovePct: 0.001 },
      { outcome: "bad_veto", blockerReasons: ["other_blocker"], strategy: "ema_trend", marketPhase: "range_acceptance", realizedMovePct: 0.03 }
    ]
  };
  const analysis = TradingBot.prototype.buildMissedTradeAnalysis.call(
    bot,
    { regime: "trend", marketState: { phase: "healthy_continuation" } },
    ["committee_veto"],
    { activeStrategy: "ema_trend" }
  );
  assert.equal(analysis.recentMatches, 1);
  assert.equal(analysis.recentBadVetoCount, 1);
  assert.equal(analysis.recentGoodVetoCount, 0);
  assert.equal(analysis.recentAverageMovePct, 0.02);
});

await runCheck("trading bot missed trade analysis ignores resolution_failed counterfactuals", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.runtime = {
    offlineTrainer: {
      blockerScorecards: [],
      strategyScorecards: [],
      counterfactuals: { total: 1, averageMissedMovePct: 0.01 }
    }
  };
  bot.journal = {
    counterfactuals: [
      {
        outcome: "resolution_failed",
        resolutionFailed: true,
        blockerReasons: ["committee_veto"],
        strategy: "ema_trend",
        regime: "trend",
        marketPhase: "healthy_continuation",
        realizedMovePct: 0.05
      }
    ]
  };
  const analysis = TradingBot.prototype.buildMissedTradeAnalysis.call(
    bot,
    { regime: "trend", marketState: { phase: "healthy_continuation" } },
    ["committee_veto"],
    { activeStrategy: "ema_trend" }
  );
  assert.equal(analysis.recentMatches, 0);
  assert.equal(analysis.recentBadVetoCount, 0);
  assert.equal(analysis.recentAverageMovePct, 0);
});

await runCheck("trading bot paper learning summary exposes scope readiness and sandbox", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper" });
  bot.runtime = {
    offlineTrainer: {
      vetoFeedback: { topBlocker: "committee_veto" },
      thresholdPolicy: {
        topRecommendation: {
          id: "committee_veto",
          action: "relax",
          adjustment: -0.006,
          confidence: 0.64,
          rationale: "Gemiste winnaars stapelen zich op voor deze blocker."
        }
      }
    },
    latestDecisions: [
      {
        allow: true,
        learningLane: "probe",
        learningValueScore: 0.74,
        session: { session: "asia" },
        paperLearning: { noveltyScore: 0.68, scope: { family: "trend_following", regime: "trend", session: "asia" } },
        paperThresholdSandbox: { status: "relax", thresholdShift: -0.008, sampleSize: 4, scope: { family: "trend_following", regime: "trend", session: "asia" } },
        paperBlockerCategories: {}
      },
      {
        allow: false,
        blockerReasons: ["committee_veto", "capital_governor_blocked"],
        paperBlockerCategories: { learning: 1, governance: 1 },
        paperLearning: { noveltyScore: 0.52, scope: { family: "trend_following", regime: "trend", session: "asia" } }
      }
    ],
    ops: {
      replayChaos: {
        replayPacks: {
          probeWinners: [{ symbol: "BTCUSDT" }],
          paperMisses: [{ symbol: "ETHUSDT" }],
          nearMissSetups: [{ symbol: "SOLUSDT" }]
        }
      }
    }
  };
  bot.journal = {
    trades: [
      { brokerMode: "paper", learningLane: "probe", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia", exitAt: "2026-03-11T10:00:00.000Z", netPnlPct: 0.01, executionQualityScore: 0.64, paperLearningOutcome: { outcome: "good_trade" } },
      { brokerMode: "paper", learningLane: "probe", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia", exitAt: "2026-03-11T11:00:00.000Z", netPnlPct: 0.005, executionQualityScore: 0.58, paperLearningOutcome: { outcome: "acceptable_trade" } },
      { brokerMode: "paper", learningLane: "probe", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia", exitAt: "2026-03-11T12:00:00.000Z", netPnlPct: -0.002, executionQualityScore: 0.51, paperLearningOutcome: { outcome: "early_exit" } }
    ]
  };
  const summary = bot.buildPaperLearningSummary(bot.runtime.latestDecisions, "2026-03-12T12:00:00.000Z");
  assert.equal(summary.scopeReadiness[0].id, "trend_following");
  assert.equal(summary.thresholdSandbox.status, "relax");
  assert.equal(summary.reviewPacks.bestProbeWinner, "BTCUSDT");
  assert.equal(summary.blockerGroups.learning, 1);
  assert.equal(summary.paperToLiveReadiness.topScope, "trend_following");
  assert.equal(summary.counterfactualTuning.blocker, "committee_veto");
  assert.equal(summary.counterfactualTuning.status, "relax");
});

await runCheck("trading bot paper learning summary exposes active learning benchmarks and failure clusters", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper" });
  bot.runtime = {
    latestDecisions: [
      {
        symbol: "BTCUSDT",
        allow: true,
        learningLane: "probe",
        learningValueScore: 0.81,
        paperLearning: {
          noveltyScore: 0.66,
          activeLearning: {
            score: 0.78,
            focusReason: "threshold_near_miss"
          },
          scope: { family: "trend_following", regime: "trend", session: "asia" }
        }
      },
      {
        symbol: "ETHUSDT",
        allow: false,
        blockerReasons: ["committee_veto"],
        learningLane: "shadow",
        learningValueScore: 0.74,
        paperLearning: {
          noveltyScore: 0.72,
          activeLearning: {
            score: 0.82,
            focusReason: "model_disagreement"
          },
          scope: { family: "mean_reversion", regime: "range", session: "europe" }
        }
      }
    ],
    offlineTrainer: {},
    ops: {
      replayChaos: {
        replayPacks: {}
      }
    }
  };
  bot.journal = {
    trades: [
      {
        symbol: "BTCUSDT",
        brokerMode: "paper",
        learningLane: "probe",
        strategyFamily: "trend_following",
        regimeAtEntry: "trend",
        sessionAtEntry: "asia",
        probabilityAtEntry: 0.74,
        exitAt: "2026-03-11T10:00:00.000Z",
        netPnlPct: -0.012,
        pnlQuote: -8,
        executionQualityScore: 0.33,
        mfePct: 0.022,
        captureEfficiency: 0.18,
        paperLearningOutcome: { outcome: "early_exit" }
      },
      {
        symbol: "ETHUSDT",
        brokerMode: "paper",
        learningLane: "safe",
        strategyFamily: "trend_following",
        regimeAtEntry: "trend",
        sessionAtEntry: "asia",
        probabilityAtEntry: 0.58,
        exitAt: "2026-03-11T12:00:00.000Z",
        netPnlPct: 0.011,
        pnlQuote: 5,
        executionQualityScore: 0.61,
        mfePct: 0.012,
        captureEfficiency: 0.58,
        paperLearningOutcome: { outcome: "good_trade" }
      }
    ],
    counterfactuals: [
      {
        symbol: "SOLUSDT",
        outcome: "bad_veto",
        branches: [
          { id: "maker_bias", outcome: "winner" },
          { id: "smaller_probe", outcome: "flat" }
        ]
      },
      {
        symbol: "BNBUSDT",
        outcome: "good_veto",
        branches: [
          { id: "maker_bias", outcome: "small_winner" },
          { id: "earlier_take_profit", outcome: "flat" }
        ]
      }
    ]
  };
  const summary = bot.buildPaperLearningSummary(bot.runtime.latestDecisions, "2026-03-11T15:00:00.000Z");
  assert.equal(summary.activeLearning.topCandidates[0].symbol, "ETHUSDT");
  assert.equal(summary.activeLearning.topCandidates[0].priorityBand, "high_priority");
  assert.ok(summary.activeLearning.focusScopes.some((item) => item.id === "mean_reversion · range · europe"));
  assert.equal(summary.benchmarkLanes.bestLane, "safe_lane");
  assert.ok(summary.benchmarkLanes.rankedLanes.some((item) => item.id === "always_take"));
  assert.ok(summary.benchmarkLanes.rankedLanes.some((item) => item.id === "fixed_threshold"));
  assert.equal(summary.failureLibrary[0].id, "early_exit");
  assert.equal(summary.counterfactualBranches.topBranch, "maker_bias");
  assert.equal(summary.miscalibration.topIssue, "overconfidence");
  assert.equal(summary.recentProbeReviews[0].outcome, "early_exit");
  assert.equal(summary.recentProbeReviews[0].symbol, "BTCUSDT");
  assert.equal(summary.recentShadowReviews[0].outcome, "good_veto");
  assert.equal(summary.recentShadowReviews[0].bestBranch.id, "maker_bias");
});

await runCheck("trading bot queues richer counterfactual branch scenarios for paper review", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper", counterfactualLookaheadMinutes: 90, counterfactualQueueLimit: 40 });
  bot.runtime = { counterfactualQueue: [] };
  bot.queueCounterfactualCandidate({
    symbol: "BTCUSDT",
    marketSnapshot: { book: { mid: 100 } },
    score: { probability: 0.58 },
    strategySummary: { activeStrategy: "ema_trend", family: "trend_following" },
    regimeSummary: { regime: "trend" },
    marketStateSummary: { phase: "healthy_continuation" },
    sessionSummary: { session: "europe" },
    signalQualitySummary: { overallScore: 0.62, executionViability: 0.55 },
    confidenceBreakdown: { modelConfidence: 0.57 },
    decision: {
      threshold: 0.61,
      reasons: ["committee_veto"],
      learningLane: "shadow",
      learningValueScore: 0.72,
      executionPlan: {
        entryStyle: "maker",
        expectedSlippageBps: 4
      }
    }
  }, "2026-03-12T10:00:00.000Z");
  assert.equal(bot.runtime.counterfactualQueue.length, 1);
  const ids = bot.runtime.counterfactualQueue[0].branchScenarios.map((item) => item.id);
  assert.ok(ids.includes("market_entry"));
  assert.ok(ids.includes("tighter_stop"));
  assert.ok(ids.includes("longer_hold"));
});

await runCheck("trading bot paper learning summary only uses branchable shadow cases for shadow reviews", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper" });
  bot.runtime = { latestDecisions: [], offlineTrainer: {}, ops: { replayChaos: { replayPacks: {} } } };
  bot.journal = {
    trades: [],
    counterfactuals: [
      {
        symbol: "LATEUSDT",
        brokerMode: "paper",
        outcome: "bad_veto",
        resolvedAt: "2026-03-11T12:30:00.000Z"
      },
      {
        symbol: "SHADOWUSDT",
        brokerMode: "paper",
        outcome: "good_veto",
        learningLane: "shadow",
        resolvedAt: "2026-03-11T12:00:00.000Z",
        branches: [
          { id: "maker_bias", outcome: "small_winner" }
        ]
      },
      {
        symbol: "LIVEUSDT",
        brokerMode: "live",
        outcome: "bad_veto",
        learningLane: "shadow",
        resolvedAt: "2026-03-11T11:45:00.000Z",
        branches: [
          { id: "maker_bias", outcome: "winner" }
        ]
      }
    ]
  };
  const summary = bot.buildPaperLearningSummary([], "2026-03-11T15:00:00.000Z");
  assert.equal(summary.recentShadowReviews.length, 1);
  assert.equal(summary.recentShadowReviews[0].symbol, "SHADOWUSDT");
});

await runCheck("trading bot paper learning summary keeps daily lane counts after refresh with empty decisions", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper", paperLearningProbeDailyLimit: 4, paperLearningShadowDailyLimit: 6 });
  bot.runtime = {
    latestDecisions: [],
    openPositions: [
      { id: "safe-open", symbol: "BTCUSDT", brokerMode: "paper", learningLane: "safe", entryAt: "2026-03-11T09:00:00.000Z" },
      { id: "probe-open", symbol: "ETHUSDT", brokerMode: "paper", learningLane: "probe", entryAt: "2026-03-11T09:30:00.000Z" }
    ],
    counterfactualQueue: [
      { id: "shadow-queue", symbol: "SOLUSDT", brokerMode: "paper", learningLane: "shadow", queuedAt: "2026-03-11T10:30:00.000Z", strategyFamily: "breakout", marketPhase: "range_acceptance", sessionAtEntry: "europe" },
      { id: "shadow-queue-live", symbol: "AVAXUSDT", brokerMode: "live", learningLane: "shadow", queuedAt: "2026-03-11T10:45:00.000Z", strategyFamily: "trend_following", marketPhase: "trend", sessionAtEntry: "us" }
    ],
    offlineTrainer: {}
  };
  bot.journal = {
    trades: [
      { id: "safe-trade", symbol: "ADAUSDT", brokerMode: "paper", learningLane: "safe", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia", entryAt: "2026-03-11T08:00:00.000Z", exitAt: "2026-03-11T10:00:00.000Z", paperLearningOutcome: { outcome: "good_trade" } },
      { id: "probe-trade", symbol: "XRPUSDT", brokerMode: "paper", learningLane: "probe", strategyFamily: "trend_following", regimeAtEntry: "trend", sessionAtEntry: "asia", entryAt: "2026-03-11T08:30:00.000Z", exitAt: "2026-03-11T11:00:00.000Z", paperLearningOutcome: { outcome: "bad_trade" } }
    ],
    counterfactuals: [
      { id: "shadow-1", symbol: "BNBUSDT", brokerMode: "paper", learningLane: "shadow", strategyFamily: "breakout", marketPhase: "range_acceptance", sessionAtEntry: "europe", resolvedAt: "2026-03-11T09:15:00.000Z" },
      { id: "shadow-2", symbol: "DOGEUSDT", brokerMode: "paper", learningLane: "shadow", strategyFamily: "breakout", marketPhase: "range_acceptance", sessionAtEntry: "europe", resolvedAt: "2026-03-11T10:45:00.000Z" },
      { id: "shadow-live", symbol: "LINKUSDT", brokerMode: "live", learningLane: "shadow", strategyFamily: "trend_following", marketPhase: "trend", sessionAtEntry: "us", resolvedAt: "2026-03-11T11:15:00.000Z" }
    ]
  };
  const summary = bot.buildPaperLearningSummary([], "2026-03-11T12:00:00.000Z");
  assert.equal(summary.safeCount, 2);
  assert.equal(summary.probeCount, 2);
  assert.equal(summary.shadowCount, 3);
  assert.equal(summary.dailyBudget.probeUsed, 2);
  assert.equal(summary.dailyBudget.shadowUsed, 3);
  assert.equal(summary.topFamilies[0].id, "breakout");
  assert.equal(summary.topRegimes[0].id, "trend");
  assert.equal(summary.topSessions[0].id, "europe");
  assert.ok(summary.topSessions.every((item) => item.id !== "us"));
});

await runCheck("trading bot paper learning summary counts closed probe trades on exit day", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper" });
  bot.runtime = { latestDecisions: [], openPositions: [], counterfactualQueue: [], offlineTrainer: {}, ops: { replayChaos: { replayPacks: {} } } };
  bot.journal = {
    trades: [
      {
        id: "overnight-probe",
        symbol: "BTCUSDT",
        brokerMode: "paper",
        learningLane: "probe",
        strategyFamily: "trend_following",
        regimeAtEntry: "trend",
        sessionAtEntry: "asia",
        entryAt: "2026-03-11T23:30:00.000Z",
        exitAt: "2026-03-12T01:10:00.000Z",
        paperLearningOutcome: { outcome: "good_trade" }
      }
    ],
    counterfactuals: []
  };
  const summary = bot.buildPaperLearningSummary([], "2026-03-12T08:00:00.000Z");
  assert.equal(summary.probeCount, 1);
  assert.equal(summary.dailyBudget.probeUsed, 0);
});

await runCheck("trading bot paper learning summary counts branchable counterfactual reviews as shadow learning without consuming budget", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper", paperLearningProbeDailyLimit: 4, paperLearningShadowDailyLimit: 6 });
  bot.runtime = {
    latestDecisions: [],
    openPositions: [],
    counterfactualQueue: [
      {
        id: "queue-review",
        symbol: "SOLUSDT",
        brokerMode: "paper",
        queuedAt: "2026-03-12T07:20:00.000Z",
        branchScenarios: [{ id: "maker_bias", kind: "execution" }]
      }
    ],
    offlineTrainer: {},
    ops: { replayChaos: { replayPacks: {} } }
  };
  bot.journal = {
    trades: [],
    counterfactuals: [
      {
        id: "resolved-review",
        symbol: "ETHUSDT",
        brokerMode: "paper",
        resolvedAt: "2026-03-12T06:45:00.000Z",
        branches: [{ id: "base", outcome: "winner", adjustedMovePct: 0.012 }]
      }
    ]
  };
  const summary = bot.buildPaperLearningSummary([], "2026-03-12T08:00:00.000Z");
  assert.equal(summary.shadowCount, 2);
  assert.equal(summary.dailyBudget.shadowUsed, 0);
  assert.equal(summary.recentShadowReviews.length, 2);
  assert.equal(summary.recentShadowReviews[0].symbol, "ETHUSDT");
  assert.equal(summary.recentShadowReviews[1].symbol, "SOLUSDT");
  assert.equal(summary.recentShadowReviews[1].outcome, "shadow_watch");
  assert.equal(summary.recentShadowReviews[1].bestBranch.id, "maker_bias");
});

await runCheck("trading bot paper learning summary uses runtime journal truth for shadow budget instead of stale decision snapshots", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper", paperLearningProbeDailyLimit: 4, paperLearningShadowDailyLimit: 6 });
  bot.runtime = {
    latestDecisions: [
      {
        symbol: "BTCUSDT",
        learningLane: "shadow",
        learningValueScore: 0.22,
        paperLearningBudget: {
          probeDailyLimit: 4,
          probeUsed: 0,
          probeRemaining: 4,
          shadowDailyLimit: 6,
          shadowUsed: 0,
          shadowRemaining: 6
        },
        paperLearning: {
          noveltyScore: 0.2,
          activeLearning: { score: 0.24, focusReason: "near_threshold" },
          scope: { family: "trend_following", regime: "trend", session: "asia" }
        },
        strategy: { family: "trend_following" },
        regime: "trend",
        session: { session: "asia" }
      }
    ],
    openPositions: [],
    counterfactualQueue: [
      {
        id: "queued-shadow-budget",
        symbol: "ETHUSDT",
        brokerMode: "paper",
        learningLane: "shadow",
        queuedAt: "2026-03-12T07:20:00.000Z"
      }
    ],
    offlineTrainer: {},
    ops: { replayChaos: { replayPacks: {} } }
  };
  bot.journal = {
    trades: [],
    counterfactuals: [
      {
        id: "resolved-shadow-budget",
        symbol: "SOLUSDT",
        brokerMode: "paper",
        learningLane: "shadow",
        resolvedAt: "2026-03-12T06:45:00.000Z"
      }
    ]
  };
  const summary = bot.buildPaperLearningSummary(bot.runtime.latestDecisions, "2026-03-12T08:00:00.000Z");
  assert.equal(summary.dailyBudget.shadowUsed, 2);
  assert.equal(summary.dailyBudget.shadowRemaining, 4);
});

await runCheck("trading bot paper learning summary stays active from shadow review evidence and keeps session coverage", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper", paperLearningProbeDailyLimit: 4, paperLearningShadowDailyLimit: 6 });
  bot.runtime = {
    latestDecisions: [],
    openPositions: [],
    counterfactualQueue: [
      {
        id: "queued-shadow",
        symbol: "ADAUSDT",
        brokerMode: "paper",
        queuedAt: "2026-03-12T07:35:00.000Z",
        strategyFamily: "breakout",
        regime: "range",
        sessionAtEntry: "europe",
        learningValueScore: 0.58,
        branchScenarios: [{ id: "maker_bias", kind: "execution" }]
      }
    ],
    offlineTrainer: {},
    ops: { replayChaos: { replayPacks: {} } }
  };
  bot.journal = {
    trades: [],
    counterfactuals: [
      {
        id: "resolved-shadow",
        symbol: "BTCUSDT",
        brokerMode: "paper",
        strategyFamily: "trend_following",
        regime: "trend",
        sessionAtEntry: "asia",
        learningValueScore: 0.66,
        resolvedAt: "2026-03-12T06:50:00.000Z",
        outcome: "bad_veto",
        branches: [{ id: "base", outcome: "winner", adjustedMovePct: 0.018 }]
      }
    ]
  };
  const summary = bot.buildPaperLearningSummary([], "2026-03-12T08:00:00.000Z");
  assert.equal(summary.status, "active");
  assert.equal(summary.shadowCount, 2);
  assert.ok(summary.averageLearningValueScore > 0.5);
  assert.ok(summary.averageActiveLearningScore > 0.4);
  assert.ok(summary.topSessions.some((item) => item.id === "asia"));
  assert.ok(summary.topSessions.some((item) => item.id === "europe"));
  assert.equal(summary.activeLearning.status, "priority");
});

await runCheck("trading bot paper learning summary combines current cycle learning with shadow evidence for active learning", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper", paperLearningProbeDailyLimit: 4, paperLearningShadowDailyLimit: 6 });
  bot.runtime = {
    latestDecisions: [
      {
        symbol: "LTCUSDT",
        learningLane: "shadow",
        learningValueScore: 0.22,
        paperLearning: {
          noveltyScore: 0.18,
          activeLearning: { score: 0.24, focusReason: "near_threshold" },
          scope: { family: "trend_following", regime: "trend", session: "asia" }
        },
        strategy: { family: "trend_following" },
        regime: "trend",
        session: { session: "asia" }
      }
    ],
    openPositions: [],
    counterfactualQueue: [],
    offlineTrainer: {},
    ops: { replayChaos: { replayPacks: {} } }
  };
  bot.journal = {
    trades: [],
    counterfactuals: [
      {
        id: "rich-shadow",
        symbol: "AVAXUSDT",
        brokerMode: "paper",
        strategyFamily: "breakout",
        regime: "range",
        sessionAtEntry: "europe",
        learningValueScore: 0.8,
        resolvedAt: "2026-03-12T06:45:00.000Z",
        outcome: "bad_veto",
        branches: [{ id: "maker_bias", outcome: "winner", adjustedMovePct: 0.02 }]
      }
    ]
  };
  const summary = bot.buildPaperLearningSummary(bot.runtime.latestDecisions, "2026-03-12T08:00:00.000Z");
  assert.ok(summary.averageLearningValueScore > 0.45);
  assert.ok(summary.averageActiveLearningScore > 0.4);
  assert.ok(summary.activeLearning.topCandidates.some((item) => item.symbol === "AVAXUSDT"));
});

await runCheck("trading bot paper learning summary ignores resolution_failed counterfactuals", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper", paperLearningProbeDailyLimit: 4, paperLearningShadowDailyLimit: 6 });
  bot.runtime = {
    latestDecisions: [],
    openPositions: [],
    counterfactualQueue: [],
    offlineTrainer: {},
    ops: { replayChaos: { replayPacks: {} } }
  };
  bot.journal = {
    trades: [],
    counterfactuals: [
      {
        id: "failed-shadow",
        symbol: "BTCUSDT",
        brokerMode: "paper",
        learningLane: "shadow",
        resolvedAt: "2026-03-12T06:45:00.000Z",
        outcome: "resolution_failed",
        resolutionFailed: true,
        branches: [{ id: "maker_bias", outcome: "unresolved" }]
      }
    ]
  };
  const summary = bot.buildPaperLearningSummary(bot.runtime.latestDecisions, "2026-03-12T08:00:00.000Z");
  assert.equal(summary.shadowCount, 0);
  assert.equal(summary.recentShadowReviews.length, 0);
  assert.equal(summary.benchmarkLanes.shadowTakeWinRate, 0);
});

await runCheck("trading bot retries unresolved counterfactual cases instead of dropping them immediately", async () => {
  const bot = Object.create(TradingBot.prototype);
  bot.config = makeConfig({ botMode: "paper", counterfactualQueueLimit: 40 });
  bot.runtime = {
    counterfactualQueue: [
      {
        id: "retry-shadow",
        symbol: "BTCUSDT",
        brokerMode: "paper",
        queuedAt: "2026-03-12T06:00:00.000Z",
        dueAt: "2026-03-12T07:00:00.000Z",
        entryPrice: 100,
        branchScenarios: [{ id: "base", kind: "baseline" }]
      }
    ]
  };
  bot.journal = { counterfactuals: [] };
  bot.marketCache = {};
  bot.recordEvent = () => {};
  bot.getMarketSnapshot = async () => ({ book: { mid: Number.NaN } });
  await bot.resolveCounterfactualQueue("2026-03-12T08:00:00.000Z", {});
  assert.equal(bot.runtime.counterfactualQueue.length, 1);
  assert.equal(bot.runtime.counterfactualQueue[0].retryCount, 1);
  assert.equal(bot.runtime.counterfactualQueue[0].lastError, "invalid_counterfactual_snapshot");
  assert.equal(bot.journal.counterfactuals.length, 0);
});

await runCheck("replay chaos summary counts paper misses as replay signals", async () => {
  const summary = buildReplayChaosSummary({
    journal: {
      trades: [
        { strategyAtEntry: "ema_trend", exitAt: "2026-03-11T10:00:00.000Z", replayCheckpoints: [{ at: "2026-03-11T09:00:00.000Z", price: 100 }], paperLearningOutcome: { outcome: "early_exit" } },
        { strategyAtEntry: "ema_trend", exitAt: "2026-03-11T11:00:00.000Z", replayCheckpoints: [{ at: "2026-03-11T10:00:00.000Z", price: 101 }], paperLearningOutcome: { outcome: "good_trade" } }
      ],
      blockedSetups: []
    },
    nowIso: "2026-03-11T15:00:00.000Z"
  });
  assert.equal(summary.paperMissCount, 1);
  assert.ok(summary.activeScenarios.some((item) => item.id === "paper_miss"));
});

await runCheck("replay chaos summary builds automatic replay packs", async () => {
  const summary = buildReplayChaosSummary({
    journal: {
      trades: [
        { symbol: "BTCUSDT", strategyAtEntry: "ema_trend", learningLane: "probe", exitAt: "2026-03-11T10:00:00.000Z", pnlQuote: 12, netPnlPct: 0.01, paperLearningOutcome: { outcome: "good_trade" } },
        { symbol: "ETHUSDT", strategyAtEntry: "ema_trend", learningLane: "probe", exitAt: "2026-03-11T11:00:00.000Z", pnlQuote: -8, netPnlPct: -0.006, reason: "time_stop", paperLearningOutcome: { outcome: "early_exit" } }
      ],
      blockedSetups: [
        { symbol: "SOLUSDT", strategy: "ema_trend", outcome: "missed_winner", realizedMovePct: 0.018, blockerReasons: ["committee_veto"] }
      ]
    },
    nowIso: "2026-03-11T15:00:00.000Z"
  });
  assert.equal(summary.replayPacks.probeWinners[0].symbol, "BTCUSDT");
  assert.equal(summary.replayPacks.paperMisses[0].symbol, "ETHUSDT");
  assert.equal(summary.replayPacks.nearMissSetups[0].symbol, "SOLUSDT");
  assert.equal(summary.deterministicReplayPlan.nextPackType, "paper_miss_pack");
  assert.ok(summary.deterministicReplayPlan.selectedCases.length >= 2);
});

await runCheck("replay chaos summary keeps paper replay packs free from live trades", async () => {
  const summary = buildReplayChaosSummary({
    journal: {
      trades: [
        { symbol: "BTCUSDT", brokerMode: "paper", strategyAtEntry: "ema_trend", learningLane: "probe", exitAt: "2026-03-11T10:00:00.000Z", pnlQuote: 12, netPnlPct: 0.01, paperLearningOutcome: { outcome: "good_trade" } },
        { symbol: "ETHUSDT", brokerMode: "paper", strategyAtEntry: "ema_trend", learningLane: "probe", exitAt: "2026-03-11T11:00:00.000Z", pnlQuote: -8, netPnlPct: -0.006, paperLearningOutcome: { outcome: "early_exit" } },
        { symbol: "SOLUSDT", brokerMode: "live", strategyAtEntry: "ema_trend", learningLane: "probe", exitAt: "2026-03-11T12:00:00.000Z", pnlQuote: 50, netPnlPct: 0.025, paperLearningOutcome: { outcome: "good_trade" } },
        { symbol: "BNBUSDT", brokerMode: "live", strategyAtEntry: "ema_trend", learningLane: "probe", exitAt: "2026-03-11T13:00:00.000Z", pnlQuote: -22, netPnlPct: -0.018, paperLearningOutcome: { outcome: "bad_trade" } }
      ],
      blockedSetups: []
    },
    nowIso: "2026-03-11T15:00:00.000Z"
  });
  assert.equal(summary.replayPacks.probeWinners.length, 1);
  assert.equal(summary.replayPacks.probeWinners[0].symbol, "BTCUSDT");
  assert.equal(summary.replayPacks.paperMisses.length, 1);
  assert.equal(summary.replayPacks.paperMisses[0].symbol, "ETHUSDT");
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
        { symbol: "BTCUSDT", exitAt: "2026-03-09T10:00:00.000Z", pnlQuote: 20, netPnlPct: 0.015, executionQualityScore: 0.71, labelScore: 0.82, rawFeatures: { a: 1 }, strategyAtEntry: "ema_trend", strategyFamily: "trend_following", entryRationale: { strategy: { family: "trend_following" } }, regimeAtEntry: "trend", brokerMode: "paper" },
        { symbol: "ETHUSDT", exitAt: "2026-03-09T14:00:00.000Z", pnlQuote: -5, netPnlPct: -0.004, executionQualityScore: 0.58, labelScore: 0.41, rawFeatures: { a: 1 }, strategyAtEntry: "vwap_reversion", strategyFamily: "mean_reversion", entryRationale: { strategy: { family: "mean_reversion" } }, regimeAtEntry: "range", brokerMode: "paper" }
      ]
    },
    dataRecorder: {
      learningFrames: 8,
      decisionFrames: 14,
      averageRecordQuality: 0.74,
      lineageCoverage: 0.81,
      sourceCoverage: [{ provider: "coindesk", count: 3 }],
      contextCoverage: [{ kind: "calendar", count: 2 }],
      latestBootstrap: { status: "ready", warmStart: { paperLearningReady: true } }
    },
    counterfactuals: [
      { outcome: "missed_winner", realizedMovePct: 0.019 },
      { outcome: "blocked_correctly", realizedMovePct: -0.011 }
    ],
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  assert.equal(summary.counterfactuals.total, 2);
  assert.equal(summary.counterfactuals.missedWinners, 1);
  assert.equal(summary.counterfactuals.blockedCorrectly, 1);
  assert.ok(summary.readinessScore > 0.24);
  assert.equal(summary.retrainReadiness.bootstrapStatus, "ready");
  assert.ok(summary.retrainReadiness.paper.score > 0);
  assert.ok(summary.retrainReadiness.paper.score > summary.retrainReadiness.live.score);
  assert.ok(summary.retrainReadiness.paper.freshnessScore > summary.retrainReadiness.live.freshnessScore);
  assert.equal(summary.scopeRetrainReadiness[0].type, "family");
  assert.equal(summary.retrainFocusPlan.status, summary.retrainReadiness.status);
  assert.equal(summary.retrainFocusPlan.topScope?.type, "family");
  assert.ok(summary.retrainFocusPlan.nextAction);
  assert.ok(summary.retrainExecutionPlan.batchType);
  assert.ok(Array.isArray(summary.retrainExecutionPlan.selectedScopes));
});

await runCheck("offline trainer freshness-aware retrain readiness penalizes stale tracks", async () => {
  const trainer = new OfflineTrainer(makeConfig());
  const summary = trainer.buildSummary({
    journal: {
      trades: [
        {
          symbol: "BTCUSDT",
          exitAt: "2026-03-11T12:00:00.000Z",
          pnlQuote: 8,
          netPnlPct: 0.01,
          executionQualityScore: 0.68,
          labelScore: 0.74,
          rawFeatures: { a: 1 },
          strategyAtEntry: "ema_trend",
          regimeAtEntry: "trend",
          brokerMode: "paper"
        },
        {
          symbol: "ETHUSDT",
          exitAt: "2026-01-05T12:00:00.000Z",
          pnlQuote: 9,
          netPnlPct: 0.011,
          executionQualityScore: 0.69,
          labelScore: 0.75,
          rawFeatures: { a: 1 },
          strategyAtEntry: "ema_trend",
          regimeAtEntry: "trend",
          brokerMode: "live"
        }
      ]
    },
    dataRecorder: { learningFrames: 4, decisionFrames: 8, averageRecordQuality: 0.74, lineageCoverage: 0.8 },
    counterfactuals: [],
    nowIso: "2026-03-12T12:00:00.000Z"
  });
  assert.ok(summary.retrainReadiness.paper.freshnessScore > summary.retrainReadiness.live.freshnessScore);
  assert.ok(summary.retrainReadiness.paper.score > summary.retrainReadiness.live.score);
  assert.ok(summary.scopeRetrainReadiness.every((item) => item.freshnessScore >= 0));
});

await runCheck("offline trainer ignores resolution_failed counterfactuals in learning summary", async () => {
  const trainer = new OfflineTrainer(makeConfig());
  const summary = trainer.buildSummary({
    journal: {
      trades: [
        { symbol: "BTCUSDT", exitAt: "2026-03-09T10:00:00.000Z", pnlQuote: 20, netPnlPct: 0.015, executionQualityScore: 0.71, labelScore: 0.82, rawFeatures: { a: 1 }, strategyAtEntry: "ema_trend", regimeAtEntry: "trend", brokerMode: "paper" }
      ]
    },
    dataRecorder: { learningFrames: 2, decisionFrames: 4 },
    counterfactuals: [
      { outcome: "bad_veto", realizedMovePct: 0.018, blockerReasons: ["committee_veto"] },
      { outcome: "resolution_failed", resolutionFailed: true, blockerReasons: ["committee_veto"] }
    ],
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  assert.equal(summary.counterfactuals.total, 1);
  assert.equal(summary.vetoFeedback.badVetoCount, 1);
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
      { outcome: "bad_veto", realizedMovePct: 0.022, blockerReasons: ["provider_ops"], regime: "trend", strategy: "ema_trend", marketPhase: "late_crowded" },
      { outcome: "late_veto", realizedMovePct: 0.016, blockerReasons: ["provider_ops"], regime: "trend", strategy: "ema_trend", marketPhase: "late_crowded" },
      { outcome: "good_veto", realizedMovePct: -0.01, blockerReasons: ["exchange_notice_risk"], regime: "event_risk", strategy: "donchian_breakout", marketPhase: "range_acceptance" }
    ],
    nowIso: "2026-03-10T12:00:00.000Z"
  });
  assert.equal(summary.vetoFeedback.badVetoCount, 1);
  assert.equal(summary.vetoFeedback.lateVetoCount, 1);
  assert.ok(summary.blockerScorecards.some((item) => item.id === "provider_ops" && item.lateVetoCount >= 1));
  assert.ok(summary.regimeScorecards.some((item) => item.id === "trend"));
  assert.ok(["stable", "adjust"].includes(summary.thresholdPolicy.status));
  assert.ok(Array.isArray(summary.thresholdPolicy.recommendations));
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






















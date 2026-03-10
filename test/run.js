import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdaptiveTradingModel } from "../src/ai/adaptiveModel.js";
import { ExecutionEngine } from "../src/execution/executionEngine.js";
import { buildSymbolRules, resolveMarketBuyQuantity } from "../src/binance/symbolFilters.js";
import { scoreHeadline, summarizeNews } from "../src/news/sentiment.js";
import { parseProviderItems } from "../src/news/rssFeed.js";
import { normalizeCmsArticles } from "../src/events/binanceAnnouncementService.js";
import { summarizeMarketStructure } from "../src/market/marketStructureService.js";
import { summarizeMarketSentiment } from "../src/market/marketSentimentService.js";
import { summarizeVolatilityContext } from "../src/market/volatilityService.js";
import { LocalOrderBookEngine } from "../src/market/localOrderBook.js";
import { parseIcsEvents, summarizeCalendarEvents } from "../src/events/calendarService.js";
import { PortfolioOptimizer } from "../src/risk/portfolioOptimizer.js";
import { RiskManager } from "../src/risk/riskManager.js";
import { loadConfig } from "../src/config/index.js";
import { validateConfig } from "../src/config/validate.js";
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

async function runCheck(name, fn) {
  await fn();
  console.log(`ok - ${name}`);
}

function makeConfig(overrides = {}) {
  return {
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
    maxServerTimeDriftMs: 1500,
    maxKlineStalenessMultiplier: 2,
    healthMaxConsecutiveFailures: 2,
    dashboardPort: 3011,
    dashboardEquityPointLimit: 1440,
    dashboardCyclePointLimit: 720,
    dashboardDecisionLimit: 24,
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
    paperExplorationMinBookPressure: -0.42,
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
    dailyRiskBudgetFloor: 0.35,
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
    serviceMaxRestartsPerHour: 20,
    gitShortClonePath: "C:\\code\\Codex-ai-trading-bot",
    ...overrides
  };
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

await runCheck("risk manager can allow small paper warm-up entries near threshold", async () => {
  const manager = new RiskManager(makeConfig());
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
      researchFrames: 1
    });
    const summary = recorder.getSummary();
    assert.equal(summary.filesWritten, 9);
    assert.equal(summary.learningFrames, 2);
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
    assert.equal(payload.symbol, "BTCUSDT");
    assert.equal(payload.model.calibrationObservations, 18);
    assert.equal(payload.rawFeatures.momentum_5, 1.2);
    assert.equal(payload.indicators.supertrendDirection, 1);
    assert.ok(payload.rationale.topSignals.length >= 1);
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

console.log("All checks passed.");




















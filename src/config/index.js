import fs from "node:fs/promises";
import path from "node:path";
import { coinAliases } from "../data/coinAliases.js";
import { getCoinProfile } from "../data/coinProfiles.js";
import { validateConfig } from "./validate.js";

const DEFAULTS = {
  botMode: "paper",
  baseQuoteAsset: "USDT",
  startingCash: 10_000,
  maxOpenPositions: 3,
  maxPositionFraction: 0.15,
  maxTotalExposureFraction: 0.6,
  riskPerTrade: 0.01,
  maxDailyDrawdown: 0.04,
  minModelConfidence: 0.58,
  entryCooldownMinutes: 30,
  minTradeUsdt: 25,
  tradingIntervalSeconds: 120,
  paperFeeBps: 10,
  paperSlippageBps: 6,
  stopLossPct: 0.018,
  takeProfitPct: 0.03,
  trailingStopPct: 0.012,
  maxHoldMinutes: 360,
  maxSpreadBps: 25,
  maxRealizedVolPct: 0.07,
  watchlist: [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "LINKUSDT",
    "AVAXUSDT",
    "DOGEUSDT",
    "TRXUSDT",
    "LTCUSDT",
    "DOTUSDT",
    "UNIUSDT",
    "AAVEUSDT",
    "NEARUSDT",
    "SUIUSDT",
    "APTUSDT",
    "BCHUSDT"
  ],
  klineInterval: "15m",
  klineLimit: 180,
  newsLookbackHours: 20,
  newsCacheMinutes: 10,
  newsHeadlineLimit: 12,
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
  enableMarketSentimentContext: true,
  marketSentimentCacheMinutes: 15,
  alternativeApiBaseUrl: "https://api.alternative.me",
  coinGeckoApiBaseUrl: "https://api.coingecko.com/api/v3",
  enableVolatilityContext: true,
  volatilityCacheMinutes: 20,
  deribitApiBaseUrl: "https://www.deribit.com/api/v2",
  modelLearningRate: 0.06,
  modelL2: 0.0005,
  modelThreshold: 0.62,
  challengerLearningRate: 0.08,
  challengerL2: 0.00035,
  challengerWindowTrades: 40,
  challengerMinTrades: 12,
  challengerPromotionMargin: 0.01,
  enableStrategyRouter: true,
  strategyMinConfidence: 0.46,
  enableTransformerChallenger: true,
  transformerLookbackCandles: 24,
  transformerLearningRate: 0.03,
  transformerMinConfidence: 0.18,
  enableMultiAgentCommittee: true,
  committeeMinConfidence: 0.48,
  committeeMinAgreement: 0.38,
  enableRlExecution: true,
  minCalibrationConfidence: 0.3,
  calibrationBins: 10,
  calibrationMinObservations: 12,
  calibrationPriorStrength: 4,
  minRegimeConfidence: 0.45,
  abstainBand: 0.035,
  maxModelDisagreement: 0.22,
  enableEventDrivenData: true,
  enableLocalOrderBook: true,
  streamTradeBufferSize: 120,
  streamDepthLevels: 20,
  streamDepthSnapshotLimit: 200,
  maxDepthEventAgeMs: 2500,
  enableSmartExecution: true,
  enablePeggedOrders: true,
  defaultPegOffsetLevels: 1,
  maxPeggedImpactBps: 3.5,
  enableStpTelemetryQuery: true,
  stpTelemetryLimit: 20,
  makerMinSpreadBps: 4,
  aggressiveEntryThreshold: 0.72,
  baseMakerPatienceMs: 3500,
  maxMakerPatienceMs: 12000,
  enableTrailingProtection: true,
  enableSessionLogic: true,
  sessionLowLiquiditySpreadBps: 6,
  sessionLowLiquidityDepthUsd: 250000,
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
  targetAnnualizedVolatility: 0.35,
  maxLossStreak: 3,
  maxSymbolLossStreak: 2,
  minBookPressureForEntry: -0.28,
  exitOnSpreadShockBps: 20,
  minVolTargetFraction: 0.4,
  maxVolTargetFraction: 1.05,
  maxPairCorrelation: 0.82,
  maxClusterPositions: 1,
  maxSectorPositions: 2,
  enableUniverseSelector: true,
  universeMaxSymbols: 10,
  universeMinScore: 0.34,
  universeMinDepthConfidence: 0.22,
  universeMinDepthUsd: 60000,
  universeTargetVolPct: 0.018,
  enableExitIntelligence: true,
  exitIntelligenceMinConfidence: 0.52,
  exitIntelligenceTrimScore: 0.6,
  exitIntelligenceExitScore: 0.72,
  strategyAttributionMinTrades: 6,
  researchPromotionMinSharpe: 0.35,
  researchPromotionMinTrades: 6,
  researchPromotionMaxDrawdownPct: 0.12,
  binanceApiBaseUrl: "https://api.binance.com",
  binanceFuturesApiBaseUrl: "https://fapi.binance.com",
  binanceRecvWindow: 5000,
  enableExchangeProtection: true,
  allowRecoverUnsyncedPositions: false,
  stpMode: "NONE",
  liveStopLimitBufferPct: 0.002,
  maxServerTimeDriftMs: 1500,
  maxKlineStalenessMultiplier: 3,
  healthMaxConsecutiveFailures: 3,
  reportLookbackTrades: 50,
  enableMetaDecisionGate: true,
  metaMinConfidence: 0.42,
  metaBlockScore: 0.44,
  metaCautionScore: 0.55,
  enableCanaryLiveMode: true,
  canaryLiveTradeCount: 5,
  canaryLiveSizeMultiplier: 0.35,
  dailyRiskBudgetFloor: 0.35,
  maxEntriesPerDay: 8,
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
  liveTradingAcknowledged: "",
  dashboardPort: 3011
};

function parseEnvContent(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value.replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(`${value}`.trim().toLowerCase());
}

function parseCsv(value, fallback) {
  if (!value) {
    return fallback;
  }
  const items = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function parseTextCsv(value, fallback) {
  if (!value) {
    return fallback;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function normalizeMode(value, fallback) {
  const normalized = `${value || fallback}`.trim().toLowerCase();
  return normalized === "live" ? "live" : "paper";
}

export async function loadConfig(projectRoot = process.cwd()) {
  const envPath = path.join(projectRoot, ".env");
  let fileEnv = {};
  try {
    const content = await fs.readFile(envPath, "utf8");
    fileEnv = parseEnvContent(content);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const env = {
    ...fileEnv,
    ...process.env
  };

  const botMode = normalizeMode(env.BOT_MODE, DEFAULTS.botMode);
  const watchlist = parseCsv(env.WATCHLIST, DEFAULTS.watchlist);
  const runtimeDir = path.join(projectRoot, "data", "runtime");

  const config = {
    projectRoot,
    runtimeDir,
    envPath,
    botMode,
    baseQuoteAsset: env.BASE_QUOTE_ASSET || DEFAULTS.baseQuoteAsset,
    startingCash: parseNumber(env.STARTING_CASH, DEFAULTS.startingCash),
    maxOpenPositions: parseNumber(env.MAX_OPEN_POSITIONS, DEFAULTS.maxOpenPositions),
    maxPositionFraction: parseNumber(env.MAX_POSITION_FRACTION, DEFAULTS.maxPositionFraction),
    maxTotalExposureFraction: parseNumber(env.MAX_TOTAL_EXPOSURE_FRACTION, DEFAULTS.maxTotalExposureFraction),
    riskPerTrade: parseNumber(env.RISK_PER_TRADE, DEFAULTS.riskPerTrade),
    maxDailyDrawdown: parseNumber(env.MAX_DAILY_DRAWDOWN, DEFAULTS.maxDailyDrawdown),
    minModelConfidence: parseNumber(env.MIN_MODEL_CONFIDENCE, DEFAULTS.minModelConfidence),
    entryCooldownMinutes: parseNumber(env.ENTRY_COOLDOWN_MINUTES, DEFAULTS.entryCooldownMinutes),
    minTradeUsdt: parseNumber(env.MIN_TRADE_USDT, DEFAULTS.minTradeUsdt),
    tradingIntervalSeconds: parseNumber(env.TRADING_INTERVAL_SECONDS, DEFAULTS.tradingIntervalSeconds),
    paperFeeBps: parseNumber(env.PAPER_FEE_BPS, DEFAULTS.paperFeeBps),
    paperSlippageBps: parseNumber(env.PAPER_SLIPPAGE_BPS, DEFAULTS.paperSlippageBps),
    stopLossPct: parseNumber(env.STOP_LOSS_PCT, DEFAULTS.stopLossPct),
    takeProfitPct: parseNumber(env.TAKE_PROFIT_PCT, DEFAULTS.takeProfitPct),
    trailingStopPct: parseNumber(env.TRAILING_STOP_PCT, DEFAULTS.trailingStopPct),
    maxHoldMinutes: parseNumber(env.MAX_HOLD_MINUTES, DEFAULTS.maxHoldMinutes),
    maxSpreadBps: parseNumber(env.MAX_SPREAD_BPS, DEFAULTS.maxSpreadBps),
    maxRealizedVolPct: parseNumber(env.MAX_REALIZED_VOL_PCT, DEFAULTS.maxRealizedVolPct),
    watchlist,
    klineInterval: env.KLINE_INTERVAL || DEFAULTS.klineInterval,
    klineLimit: parseNumber(env.KLINE_LIMIT, DEFAULTS.klineLimit),
    newsLookbackHours: parseNumber(env.NEWS_LOOKBACK_HOURS, DEFAULTS.newsLookbackHours),
    newsCacheMinutes: parseNumber(env.NEWS_CACHE_MINUTES, DEFAULTS.newsCacheMinutes),
    newsHeadlineLimit: parseNumber(env.NEWS_HEADLINE_LIMIT, DEFAULTS.newsHeadlineLimit),
    announcementLookbackHours: parseNumber(env.ANNOUNCEMENT_LOOKBACK_HOURS, DEFAULTS.announcementLookbackHours),
    announcementCacheMinutes: parseNumber(env.ANNOUNCEMENT_CACHE_MINUTES, DEFAULTS.announcementCacheMinutes),
    marketStructureCacheMinutes: parseNumber(env.MARKET_STRUCTURE_CACHE_MINUTES, DEFAULTS.marketStructureCacheMinutes),
    marketStructureLookbackPoints: parseNumber(env.MARKET_STRUCTURE_LOOKBACK_POINTS, DEFAULTS.marketStructureLookbackPoints),
    calendarLookbackDays: parseNumber(env.CALENDAR_LOOKBACK_DAYS, DEFAULTS.calendarLookbackDays),
    calendarCacheMinutes: parseNumber(env.CALENDAR_CACHE_MINUTES, DEFAULTS.calendarCacheMinutes),
    newsMinSourceQuality: parseNumber(env.NEWS_MIN_SOURCE_QUALITY, DEFAULTS.newsMinSourceQuality),
    newsMinReliabilityScore: parseNumber(env.NEWS_MIN_RELIABILITY_SCORE, DEFAULTS.newsMinReliabilityScore),
    newsStrictWhitelist: parseBoolean(env.NEWS_STRICT_WHITELIST, DEFAULTS.newsStrictWhitelist),
    enableRedditSentiment: parseBoolean(env.ENABLE_REDDIT_SENTIMENT, DEFAULTS.enableRedditSentiment),
    redditSentimentSubreddits: parseTextCsv(env.REDDIT_SENTIMENT_SUBREDDITS, DEFAULTS.redditSentimentSubreddits),
    enableMarketSentimentContext: parseBoolean(env.ENABLE_MARKET_SENTIMENT_CONTEXT, DEFAULTS.enableMarketSentimentContext),
    marketSentimentCacheMinutes: parseNumber(env.MARKET_SENTIMENT_CACHE_MINUTES, DEFAULTS.marketSentimentCacheMinutes),
    alternativeApiBaseUrl: env.ALTERNATIVE_API_BASE_URL || DEFAULTS.alternativeApiBaseUrl,
    coinGeckoApiBaseUrl: env.COINGECKO_API_BASE_URL || DEFAULTS.coinGeckoApiBaseUrl,
    enableVolatilityContext: parseBoolean(env.ENABLE_VOLATILITY_CONTEXT, DEFAULTS.enableVolatilityContext),
    volatilityCacheMinutes: parseNumber(env.VOLATILITY_CACHE_MINUTES, DEFAULTS.volatilityCacheMinutes),
    deribitApiBaseUrl: env.DERIBIT_API_BASE_URL || DEFAULTS.deribitApiBaseUrl,
    modelLearningRate: parseNumber(env.MODEL_LEARNING_RATE, DEFAULTS.modelLearningRate),
    modelL2: parseNumber(env.MODEL_L2, DEFAULTS.modelL2),
    modelThreshold: parseNumber(env.MODEL_THRESHOLD, DEFAULTS.modelThreshold),
    challengerLearningRate: parseNumber(env.CHALLENGER_LEARNING_RATE, DEFAULTS.challengerLearningRate),
    challengerL2: parseNumber(env.CHALLENGER_L2, DEFAULTS.challengerL2),
    challengerWindowTrades: parseNumber(env.CHALLENGER_WINDOW_TRADES, DEFAULTS.challengerWindowTrades),
    challengerMinTrades: parseNumber(env.CHALLENGER_MIN_TRADES, DEFAULTS.challengerMinTrades),
    challengerPromotionMargin: parseNumber(env.CHALLENGER_PROMOTION_MARGIN, DEFAULTS.challengerPromotionMargin),
    enableStrategyRouter: parseBoolean(env.ENABLE_STRATEGY_ROUTER, DEFAULTS.enableStrategyRouter),
    strategyMinConfidence: parseNumber(env.STRATEGY_MIN_CONFIDENCE, DEFAULTS.strategyMinConfidence),
    enableTransformerChallenger: parseBoolean(env.ENABLE_TRANSFORMER_CHALLENGER, DEFAULTS.enableTransformerChallenger),
    transformerLookbackCandles: parseNumber(env.TRANSFORMER_LOOKBACK_CANDLES, DEFAULTS.transformerLookbackCandles),
    transformerLearningRate: parseNumber(env.TRANSFORMER_LEARNING_RATE, DEFAULTS.transformerLearningRate),
    transformerMinConfidence: parseNumber(env.TRANSFORMER_MIN_CONFIDENCE, DEFAULTS.transformerMinConfidence),
    enableMultiAgentCommittee: parseBoolean(env.ENABLE_MULTI_AGENT_COMMITTEE, DEFAULTS.enableMultiAgentCommittee),
    committeeMinConfidence: parseNumber(env.COMMITTEE_MIN_CONFIDENCE, DEFAULTS.committeeMinConfidence),
    committeeMinAgreement: parseNumber(env.COMMITTEE_MIN_AGREEMENT, DEFAULTS.committeeMinAgreement),
    enableRlExecution: parseBoolean(env.ENABLE_RL_EXECUTION, DEFAULTS.enableRlExecution),
    minCalibrationConfidence: parseNumber(env.MIN_CALIBRATION_CONFIDENCE, DEFAULTS.minCalibrationConfidence),
    calibrationBins: parseNumber(env.CALIBRATION_BINS, DEFAULTS.calibrationBins),
    calibrationMinObservations: parseNumber(env.CALIBRATION_MIN_OBSERVATIONS, DEFAULTS.calibrationMinObservations),
    calibrationPriorStrength: parseNumber(env.CALIBRATION_PRIOR_STRENGTH, DEFAULTS.calibrationPriorStrength),
    minRegimeConfidence: parseNumber(env.MIN_REGIME_CONFIDENCE, DEFAULTS.minRegimeConfidence),
    abstainBand: parseNumber(env.ABSTAIN_BAND, DEFAULTS.abstainBand),
    maxModelDisagreement: parseNumber(env.MAX_MODEL_DISAGREEMENT, DEFAULTS.maxModelDisagreement),
    enableEventDrivenData: parseBoolean(env.ENABLE_EVENT_DRIVEN_DATA, DEFAULTS.enableEventDrivenData),
    enableLocalOrderBook: parseBoolean(env.ENABLE_LOCAL_ORDER_BOOK, DEFAULTS.enableLocalOrderBook),
    streamTradeBufferSize: parseNumber(env.STREAM_TRADE_BUFFER_SIZE, DEFAULTS.streamTradeBufferSize),
    streamDepthLevels: parseNumber(env.STREAM_DEPTH_LEVELS, DEFAULTS.streamDepthLevels),
    streamDepthSnapshotLimit: parseNumber(env.STREAM_DEPTH_SNAPSHOT_LIMIT, DEFAULTS.streamDepthSnapshotLimit),
    maxDepthEventAgeMs: parseNumber(env.MAX_DEPTH_EVENT_AGE_MS, DEFAULTS.maxDepthEventAgeMs),
    enableSmartExecution: parseBoolean(env.ENABLE_SMART_EXECUTION, DEFAULTS.enableSmartExecution),
    enablePeggedOrders: parseBoolean(env.ENABLE_PEGGED_ORDERS, DEFAULTS.enablePeggedOrders),
    defaultPegOffsetLevels: parseNumber(env.DEFAULT_PEG_OFFSET_LEVELS, DEFAULTS.defaultPegOffsetLevels),
    maxPeggedImpactBps: parseNumber(env.MAX_PEGGED_IMPACT_BPS, DEFAULTS.maxPeggedImpactBps),
    enableStpTelemetryQuery: parseBoolean(env.ENABLE_STP_TELEMETRY_QUERY, DEFAULTS.enableStpTelemetryQuery),
    stpTelemetryLimit: parseNumber(env.STP_TELEMETRY_LIMIT, DEFAULTS.stpTelemetryLimit),
    makerMinSpreadBps: parseNumber(env.MAKER_MIN_SPREAD_BPS, DEFAULTS.makerMinSpreadBps),
    aggressiveEntryThreshold: parseNumber(env.AGGRESSIVE_ENTRY_THRESHOLD, DEFAULTS.aggressiveEntryThreshold),
    baseMakerPatienceMs: parseNumber(env.BASE_MAKER_PATIENCE_MS, DEFAULTS.baseMakerPatienceMs),
    maxMakerPatienceMs: parseNumber(env.MAX_MAKER_PATIENCE_MS, DEFAULTS.maxMakerPatienceMs),
    enableTrailingProtection: parseBoolean(env.ENABLE_TRAILING_PROTECTION, DEFAULTS.enableTrailingProtection),
    enableSessionLogic: parseBoolean(env.ENABLE_SESSION_LOGIC, DEFAULTS.enableSessionLogic),
    sessionLowLiquiditySpreadBps: parseNumber(env.SESSION_LOW_LIQUIDITY_SPREAD_BPS, DEFAULTS.sessionLowLiquiditySpreadBps),
    sessionLowLiquidityDepthUsd: parseNumber(env.SESSION_LOW_LIQUIDITY_DEPTH_USD, DEFAULTS.sessionLowLiquidityDepthUsd),
    sessionCautionMinutesToFunding: parseNumber(env.SESSION_CAUTION_MINUTES_TO_FUNDING, DEFAULTS.sessionCautionMinutesToFunding),
    sessionHardBlockMinutesToFunding: parseNumber(env.SESSION_HARD_BLOCK_MINUTES_TO_FUNDING, DEFAULTS.sessionHardBlockMinutesToFunding),
    sessionWeekendRiskMultiplier: parseNumber(env.SESSION_WEEKEND_RISK_MULTIPLIER, DEFAULTS.sessionWeekendRiskMultiplier),
    sessionOffHoursRiskMultiplier: parseNumber(env.SESSION_OFF_HOURS_RISK_MULTIPLIER, DEFAULTS.sessionOffHoursRiskMultiplier),
    sessionFundingRiskMultiplier: parseNumber(env.SESSION_FUNDING_RISK_MULTIPLIER, DEFAULTS.sessionFundingRiskMultiplier),
    blockWeekendHighRiskStrategies: parseBoolean(env.BLOCK_WEEKEND_HIGH_RISK_STRATEGIES, DEFAULTS.blockWeekendHighRiskStrategies),
    enableDriftMonitoring: parseBoolean(env.ENABLE_DRIFT_MONITORING, DEFAULTS.enableDriftMonitoring),
    driftMinFeatureStatCount: parseNumber(env.DRIFT_MIN_FEATURE_STAT_COUNT, DEFAULTS.driftMinFeatureStatCount),
    driftFeatureScoreAlert: parseNumber(env.DRIFT_FEATURE_SCORE_ALERT, DEFAULTS.driftFeatureScoreAlert),
    driftFeatureScoreBlock: parseNumber(env.DRIFT_FEATURE_SCORE_BLOCK, DEFAULTS.driftFeatureScoreBlock),
    driftLowReliabilityAlert: parseNumber(env.DRIFT_LOW_RELIABILITY_ALERT, DEFAULTS.driftLowReliabilityAlert),
    driftCalibrationEceAlert: parseNumber(env.DRIFT_CALIBRATION_ECE_ALERT, DEFAULTS.driftCalibrationEceAlert),
    driftCalibrationEceBlock: parseNumber(env.DRIFT_CALIBRATION_ECE_BLOCK, DEFAULTS.driftCalibrationEceBlock),
    driftExecutionSlipAlertBps: parseNumber(env.DRIFT_EXECUTION_SLIP_ALERT_BPS, DEFAULTS.driftExecutionSlipAlertBps),
    driftExecutionSlipBlockBps: parseNumber(env.DRIFT_EXECUTION_SLIP_BLOCK_BPS, DEFAULTS.driftExecutionSlipBlockBps),
    driftPredictionConfidenceAlert: parseNumber(env.DRIFT_PREDICTION_CONFIDENCE_ALERT, DEFAULTS.driftPredictionConfidenceAlert),
    driftMinCandidateCount: parseNumber(env.DRIFT_MIN_CANDIDATE_COUNT, DEFAULTS.driftMinCandidateCount),
    selfHealEnabled: parseBoolean(env.SELF_HEAL_ENABLED, DEFAULTS.selfHealEnabled),
    selfHealSwitchToPaper: parseBoolean(env.SELF_HEAL_SWITCH_TO_PAPER, DEFAULTS.selfHealSwitchToPaper),
    selfHealResetRlOnTrigger: parseBoolean(env.SELF_HEAL_RESET_RL_ON_TRIGGER, DEFAULTS.selfHealResetRlOnTrigger),
    selfHealRestoreStableModel: parseBoolean(env.SELF_HEAL_RESTORE_STABLE_MODEL, DEFAULTS.selfHealRestoreStableModel),
    selfHealCooldownMinutes: parseNumber(env.SELF_HEAL_COOLDOWN_MINUTES, DEFAULTS.selfHealCooldownMinutes),
    selfHealMaxRecentLossStreak: parseNumber(env.SELF_HEAL_MAX_RECENT_LOSS_STREAK, DEFAULTS.selfHealMaxRecentLossStreak),
    selfHealWarningLossStreak: parseNumber(env.SELF_HEAL_WARNING_LOSS_STREAK, DEFAULTS.selfHealWarningLossStreak),
    selfHealMaxRecentDrawdownPct: parseNumber(env.SELF_HEAL_MAX_RECENT_DRAWDOWN_PCT, DEFAULTS.selfHealMaxRecentDrawdownPct),
    selfHealWarningDrawdownPct: parseNumber(env.SELF_HEAL_WARNING_DRAWDOWN_PCT, DEFAULTS.selfHealWarningDrawdownPct),
    lossStreakLookbackMinutes: parseNumber(env.LOSS_STREAK_LOOKBACK_MINUTES, DEFAULTS.lossStreakLookbackMinutes),
    stableModelMaxSnapshots: parseNumber(env.STABLE_MODEL_MAX_SNAPSHOTS, DEFAULTS.stableModelMaxSnapshots),
    stableModelMinTrades: parseNumber(env.STABLE_MODEL_MIN_TRADES, DEFAULTS.stableModelMinTrades),
    stableModelMaxCalibrationEce: parseNumber(env.STABLE_MODEL_MAX_CALIBRATION_ECE, DEFAULTS.stableModelMaxCalibrationEce),
    stableModelMinWinRate: parseNumber(env.STABLE_MODEL_MIN_WIN_RATE, DEFAULTS.stableModelMinWinRate),
    targetAnnualizedVolatility: parseNumber(env.TARGET_ANNUALIZED_VOLATILITY, DEFAULTS.targetAnnualizedVolatility),
    maxLossStreak: parseNumber(env.MAX_LOSS_STREAK, DEFAULTS.maxLossStreak),
    maxSymbolLossStreak: parseNumber(env.MAX_SYMBOL_LOSS_STREAK, DEFAULTS.maxSymbolLossStreak),
    minBookPressureForEntry: parseNumber(env.MIN_BOOK_PRESSURE_FOR_ENTRY, DEFAULTS.minBookPressureForEntry),
    exitOnSpreadShockBps: parseNumber(env.EXIT_ON_SPREAD_SHOCK_BPS, DEFAULTS.exitOnSpreadShockBps),
    minVolTargetFraction: parseNumber(env.MIN_VOL_TARGET_FRACTION, DEFAULTS.minVolTargetFraction),
    maxVolTargetFraction: parseNumber(env.MAX_VOL_TARGET_FRACTION, DEFAULTS.maxVolTargetFraction),
    maxPairCorrelation: parseNumber(env.MAX_PAIR_CORRELATION, DEFAULTS.maxPairCorrelation),
    maxClusterPositions: parseNumber(env.MAX_CLUSTER_POSITIONS, DEFAULTS.maxClusterPositions),
    maxSectorPositions: parseNumber(env.MAX_SECTOR_POSITIONS, DEFAULTS.maxSectorPositions),
    enableUniverseSelector: parseBoolean(env.ENABLE_UNIVERSE_SELECTOR, DEFAULTS.enableUniverseSelector),
    universeMaxSymbols: parseNumber(env.UNIVERSE_MAX_SYMBOLS, DEFAULTS.universeMaxSymbols),
    universeMinScore: parseNumber(env.UNIVERSE_MIN_SCORE, DEFAULTS.universeMinScore),
    universeMinDepthConfidence: parseNumber(env.UNIVERSE_MIN_DEPTH_CONFIDENCE, DEFAULTS.universeMinDepthConfidence),
    universeMinDepthUsd: parseNumber(env.UNIVERSE_MIN_DEPTH_USD, DEFAULTS.universeMinDepthUsd),
    universeTargetVolPct: parseNumber(env.UNIVERSE_TARGET_VOL_PCT, DEFAULTS.universeTargetVolPct),
    enableExitIntelligence: parseBoolean(env.ENABLE_EXIT_INTELLIGENCE, DEFAULTS.enableExitIntelligence),
    exitIntelligenceMinConfidence: parseNumber(env.EXIT_INTELLIGENCE_MIN_CONFIDENCE, DEFAULTS.exitIntelligenceMinConfidence),
    exitIntelligenceTrimScore: parseNumber(env.EXIT_INTELLIGENCE_TRIM_SCORE, DEFAULTS.exitIntelligenceTrimScore),
    exitIntelligenceExitScore: parseNumber(env.EXIT_INTELLIGENCE_EXIT_SCORE, DEFAULTS.exitIntelligenceExitScore),
    strategyAttributionMinTrades: parseNumber(env.STRATEGY_ATTRIBUTION_MIN_TRADES, DEFAULTS.strategyAttributionMinTrades),
    researchPromotionMinSharpe: parseNumber(env.RESEARCH_PROMOTION_MIN_SHARPE, DEFAULTS.researchPromotionMinSharpe),
    researchPromotionMinTrades: parseNumber(env.RESEARCH_PROMOTION_MIN_TRADES, DEFAULTS.researchPromotionMinTrades),
    researchPromotionMaxDrawdownPct: parseNumber(env.RESEARCH_PROMOTION_MAX_DRAWDOWN_PCT, DEFAULTS.researchPromotionMaxDrawdownPct),
    binanceApiKey: env.BINANCE_API_KEY || "",
    binanceApiSecret: env.BINANCE_API_SECRET || "",
    binanceFuturesApiBaseUrl: env.BINANCE_FUTURES_API_BASE_URL || DEFAULTS.binanceFuturesApiBaseUrl,
    binanceRecvWindow: parseNumber(env.BINANCE_RECV_WINDOW, DEFAULTS.binanceRecvWindow),
    binanceApiBaseUrl: env.BINANCE_API_BASE_URL || DEFAULTS.binanceApiBaseUrl,
    enableExchangeProtection: parseBoolean(env.ENABLE_EXCHANGE_PROTECTION, DEFAULTS.enableExchangeProtection),
    allowRecoverUnsyncedPositions: parseBoolean(env.ALLOW_RECOVER_UNSYNCED_POSITIONS, DEFAULTS.allowRecoverUnsyncedPositions),
    stpMode: (env.STP_MODE || DEFAULTS.stpMode).trim().toUpperCase(),
    liveStopLimitBufferPct: parseNumber(env.LIVE_STOP_LIMIT_BUFFER_PCT, DEFAULTS.liveStopLimitBufferPct),
    maxServerTimeDriftMs: parseNumber(env.MAX_SERVER_TIME_DRIFT_MS, DEFAULTS.maxServerTimeDriftMs),
    maxKlineStalenessMultiplier: parseNumber(env.MAX_KLINE_STALENESS_MULTIPLIER, DEFAULTS.maxKlineStalenessMultiplier),
    healthMaxConsecutiveFailures: parseNumber(env.HEALTH_MAX_CONSECUTIVE_FAILURES, DEFAULTS.healthMaxConsecutiveFailures),
    reportLookbackTrades: parseNumber(env.REPORT_LOOKBACK_TRADES, DEFAULTS.reportLookbackTrades),
    enableMetaDecisionGate: parseBoolean(env.ENABLE_META_DECISION_GATE, DEFAULTS.enableMetaDecisionGate),
    metaMinConfidence: parseNumber(env.META_MIN_CONFIDENCE, DEFAULTS.metaMinConfidence),
    metaBlockScore: parseNumber(env.META_BLOCK_SCORE, DEFAULTS.metaBlockScore),
    metaCautionScore: parseNumber(env.META_CAUTION_SCORE, DEFAULTS.metaCautionScore),
    enableCanaryLiveMode: parseBoolean(env.ENABLE_CANARY_LIVE_MODE, DEFAULTS.enableCanaryLiveMode),
    canaryLiveTradeCount: parseNumber(env.CANARY_LIVE_TRADE_COUNT, DEFAULTS.canaryLiveTradeCount),
    canaryLiveSizeMultiplier: parseNumber(env.CANARY_LIVE_SIZE_MULTIPLIER, DEFAULTS.canaryLiveSizeMultiplier),
    dailyRiskBudgetFloor: parseNumber(env.DAILY_RISK_BUDGET_FLOOR, DEFAULTS.dailyRiskBudgetFloor),
    maxEntriesPerDay: parseNumber(env.MAX_ENTRIES_PER_DAY, DEFAULTS.maxEntriesPerDay),
    scaleOutTriggerPct: parseNumber(env.SCALE_OUT_TRIGGER_PCT, DEFAULTS.scaleOutTriggerPct),
    scaleOutFraction: parseNumber(env.SCALE_OUT_FRACTION, DEFAULTS.scaleOutFraction),
    scaleOutMinNotionalUsd: parseNumber(env.SCALE_OUT_MIN_NOTIONAL_USD, DEFAULTS.scaleOutMinNotionalUsd),
    scaleOutTrailOffsetPct: parseNumber(env.SCALE_OUT_TRAIL_OFFSET_PCT, DEFAULTS.scaleOutTrailOffsetPct),
    researchCandleLimit: parseNumber(env.RESEARCH_CANDLE_LIMIT, DEFAULTS.researchCandleLimit),
    researchTrainCandles: parseNumber(env.RESEARCH_TRAIN_CANDLES, DEFAULTS.researchTrainCandles),
    researchTestCandles: parseNumber(env.RESEARCH_TEST_CANDLES, DEFAULTS.researchTestCandles),
    researchStepCandles: parseNumber(env.RESEARCH_STEP_CANDLES, DEFAULTS.researchStepCandles),
    researchMaxWindows: parseNumber(env.RESEARCH_MAX_WINDOWS, DEFAULTS.researchMaxWindows),
    researchMaxSymbols: parseNumber(env.RESEARCH_MAX_SYMBOLS, DEFAULTS.researchMaxSymbols),
    liveTradingAcknowledged: env.LIVE_TRADING_ACKNOWLEDGED || DEFAULTS.liveTradingAcknowledged,
    dashboardPort: parseNumber(env.DASHBOARD_PORT, DEFAULTS.dashboardPort),
    symbolMetadata: Object.fromEntries(watchlist.map((symbol) => [symbol, coinAliases[symbol] || [symbol]])),
    symbolProfiles: Object.fromEntries(watchlist.map((symbol) => [symbol, getCoinProfile(symbol)]))
  };

  config.validation = validateConfig(config);
  return config;
}






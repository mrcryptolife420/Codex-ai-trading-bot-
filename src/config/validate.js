function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertRange(name, value, min, max, errors) {
  if (!isFiniteNumber(value) || value < min || value > max) {
    errors.push(`${name} must be between ${min} and ${max}.`);
  }
}

export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(config.watchlist) || config.watchlist.length === 0) {
    errors.push("WATCHLIST must contain at least one symbol.");
  }
  if (new Set(config.watchlist).size !== config.watchlist.length) {
    errors.push("WATCHLIST contains duplicate symbols.");
  }
  if (!Array.isArray(config.redditSentimentSubreddits) || config.redditSentimentSubreddits.length === 0) {
    warnings.push("REDDIT_SENTIMENT_SUBREDDITS is empty; Reddit sentiment is disabled even if ENABLE_REDDIT_SENTIMENT=true.");
  }

  assertRange("MAX_OPEN_POSITIONS", config.maxOpenPositions, 1, 20, errors);
  assertRange("MAX_POSITION_FRACTION", config.maxPositionFraction, 0.001, 1, errors);
  assertRange("MAX_TOTAL_EXPOSURE_FRACTION", config.maxTotalExposureFraction, 0.01, 1, errors);
  assertRange("RISK_PER_TRADE", config.riskPerTrade, 0.0001, 0.2, errors);
  assertRange("MAX_DAILY_DRAWDOWN", config.maxDailyDrawdown, 0.001, 0.5, errors);
  assertRange("MODEL_THRESHOLD", config.modelThreshold, 0.5, 0.99, errors);
  assertRange("MIN_MODEL_CONFIDENCE", config.minModelConfidence, 0.5, 0.99, errors);
  assertRange("STOP_LOSS_PCT", config.stopLossPct, 0.001, 0.2, errors);
  assertRange("TAKE_PROFIT_PCT", config.takeProfitPct, 0.001, 0.5, errors);
  assertRange("TRAILING_STOP_PCT", config.trailingStopPct, 0.001, 0.2, errors);
  assertRange("MAX_SPREAD_BPS", config.maxSpreadBps, 1, 500, errors);
  assertRange("MAX_REALIZED_VOL_PCT", config.maxRealizedVolPct, 0.001, 0.5, errors);
  assertRange("PAPER_LATENCY_MS", config.paperLatencyMs, 0, 5000, errors);
  assertRange("PAPER_MAKER_FILL_FLOOR", config.paperMakerFillFloor, 0, 1, errors);
  assertRange("PAPER_PARTIAL_FILL_MIN_RATIO", config.paperPartialFillMinRatio, 0, 1, errors);
  assertRange("BACKTEST_LATENCY_MS", config.backtestLatencyMs, 0, 5000, errors);
  assertRange("BACKTEST_SYNTHETIC_DEPTH_USD", config.backtestSyntheticDepthUsd, 1000, 500000000, errors);
  assertRange("MAX_SERVER_TIME_DRIFT_MS", config.maxServerTimeDriftMs, 100, 60_000, errors);
  assertRange("MAX_KLINE_STALENESS_MULTIPLIER", config.maxKlineStalenessMultiplier, 1, 20, errors);
  assertRange("HEALTH_MAX_CONSECUTIVE_FAILURES", config.healthMaxConsecutiveFailures, 1, 20, errors);
  assertRange("DASHBOARD_PORT", config.dashboardPort, 1, 65535, errors);
  assertRange("WATCHLIST_TOP_N", config.watchlistTopN, 5, 150, errors);
  assertRange("WATCHLIST_FETCH_PER_PAGE", config.watchlistFetchPerPage, 50, 250, errors);
  assertRange("DYNAMIC_WATCHLIST_MIN_SYMBOLS", config.dynamicWatchlistMinSymbols, 5, 150, errors);
  assertRange("DASHBOARD_EQUITY_POINT_LIMIT", config.dashboardEquityPointLimit, 120, 10000, errors);
  assertRange("DASHBOARD_CYCLE_POINT_LIMIT", config.dashboardCyclePointLimit, 60, 5000, errors);
  assertRange("DASHBOARD_DECISION_LIMIT", config.dashboardDecisionLimit, 5, 200, errors);
  assertRange("MARKET_SNAPSHOT_CACHE_MINUTES", config.marketSnapshotCacheMinutes, 1, 60, errors);
  assertRange("MARKET_SNAPSHOT_CONCURRENCY", config.marketSnapshotConcurrency, 1, 20, errors);
  assertRange("MARKET_SNAPSHOT_BUDGET_SYMBOLS", config.marketSnapshotBudgetSymbols, 4, 120, errors);
  assertRange("LOCAL_BOOK_MAX_SYMBOLS", config.localBookMaxSymbols, 4, 120, errors);
  assertRange("MIN_CALIBRATION_CONFIDENCE", config.minCalibrationConfidence, 0, 1, errors);
  assertRange("MIN_REGIME_CONFIDENCE", config.minRegimeConfidence, 0, 1, errors);
  assertRange("ABSTAIN_BAND", config.abstainBand, 0, 0.2, errors);
  assertRange("MAX_MODEL_DISAGREEMENT", config.maxModelDisagreement, 0, 1, errors);
  assertRange("CHALLENGER_PROMOTION_MARGIN", config.challengerPromotionMargin, 0, 0.2, errors);
  assertRange("STRATEGY_MIN_CONFIDENCE", config.strategyMinConfidence, 0, 1, errors);
  assertRange("TRANSFORMER_LOOKBACK_CANDLES", config.transformerLookbackCandles, 8, 120, errors);
  assertRange("TRANSFORMER_LEARNING_RATE", config.transformerLearningRate, 0.0001, 0.5, errors);
  assertRange("TRANSFORMER_MIN_CONFIDENCE", config.transformerMinConfidence, 0, 1, errors);
  assertRange("COMMITTEE_MIN_CONFIDENCE", config.committeeMinConfidence, 0, 1, errors);
  assertRange("COMMITTEE_MIN_AGREEMENT", config.committeeMinAgreement, 0, 1, errors);
  assertRange("CALIBRATION_BINS", config.calibrationBins, 3, 50, errors);
  assertRange("STREAM_TRADE_BUFFER_SIZE", config.streamTradeBufferSize, 10, 2000, errors);
  assertRange("STREAM_DEPTH_LEVELS", config.streamDepthLevels, 5, 100, errors);
  assertRange("STREAM_DEPTH_SNAPSHOT_LIMIT", config.streamDepthSnapshotLimit, 20, 5000, errors);
  assertRange("MAX_DEPTH_EVENT_AGE_MS", config.maxDepthEventAgeMs, 100, 60_000, errors);
  assertRange("MAKER_MIN_SPREAD_BPS", config.makerMinSpreadBps, 0, 100, errors);
  assertRange("DEFAULT_PEG_OFFSET_LEVELS", config.defaultPegOffsetLevels, 0, 10, errors);
  assertRange("MAX_PEGGED_IMPACT_BPS", config.maxPeggedImpactBps, 0.1, 50, errors);
  assertRange("STP_TELEMETRY_LIMIT", config.stpTelemetryLimit, 1, 1000, errors);
  assertRange("AGGRESSIVE_ENTRY_THRESHOLD", config.aggressiveEntryThreshold, 0.5, 0.99, errors);
  assertRange("BASE_MAKER_PATIENCE_MS", config.baseMakerPatienceMs, 250, 60_000, errors);
  assertRange("MAX_MAKER_PATIENCE_MS", config.maxMakerPatienceMs, 500, 120_000, errors);
  assertRange("SESSION_LOW_LIQUIDITY_SPREAD_BPS", config.sessionLowLiquiditySpreadBps, 0.1, 100, errors);
  assertRange("SESSION_LOW_LIQUIDITY_DEPTH_USD", config.sessionLowLiquidityDepthUsd, 1000, 50000000, errors);
  assertRange("SESSION_CAUTION_MINUTES_TO_FUNDING", config.sessionCautionMinutesToFunding, 1, 720, errors);
  assertRange("SESSION_HARD_BLOCK_MINUTES_TO_FUNDING", config.sessionHardBlockMinutesToFunding, 1, 180, errors);
  assertRange("SESSION_WEEKEND_RISK_MULTIPLIER", config.sessionWeekendRiskMultiplier, 0.1, 1, errors);
  assertRange("SESSION_OFF_HOURS_RISK_MULTIPLIER", config.sessionOffHoursRiskMultiplier, 0.1, 1, errors);
  assertRange("SESSION_FUNDING_RISK_MULTIPLIER", config.sessionFundingRiskMultiplier, 0.1, 1, errors);
  assertRange("DRIFT_MIN_FEATURE_STAT_COUNT", config.driftMinFeatureStatCount, 4, 500, errors);
  assertRange("DRIFT_FEATURE_SCORE_ALERT", config.driftFeatureScoreAlert, 0.1, 6, errors);
  assertRange("DRIFT_FEATURE_SCORE_BLOCK", config.driftFeatureScoreBlock, 0.2, 8, errors);
  assertRange("DRIFT_LOW_RELIABILITY_ALERT", config.driftLowReliabilityAlert, 0, 1, errors);
  assertRange("DRIFT_CALIBRATION_ECE_ALERT", config.driftCalibrationEceAlert, 0, 1, errors);
  assertRange("DRIFT_CALIBRATION_ECE_BLOCK", config.driftCalibrationEceBlock, 0, 1, errors);
  assertRange("DRIFT_EXECUTION_SLIP_ALERT_BPS", config.driftExecutionSlipAlertBps, 0.1, 100, errors);
  assertRange("DRIFT_EXECUTION_SLIP_BLOCK_BPS", config.driftExecutionSlipBlockBps, 0.1, 250, errors);
  assertRange("DRIFT_PREDICTION_CONFIDENCE_ALERT", config.driftPredictionConfidenceAlert, 0, 1, errors);
  assertRange("DRIFT_MIN_CANDIDATE_COUNT", config.driftMinCandidateCount, 1, 25, errors);
  assertRange("SELF_HEAL_COOLDOWN_MINUTES", config.selfHealCooldownMinutes, 1, 1440, errors);
  assertRange("SELF_HEAL_MAX_RECENT_LOSS_STREAK", config.selfHealMaxRecentLossStreak, 1, 20, errors);
  assertRange("SELF_HEAL_WARNING_LOSS_STREAK", config.selfHealWarningLossStreak, 1, 20, errors);
  assertRange("SELF_HEAL_MAX_RECENT_DRAWDOWN_PCT", config.selfHealMaxRecentDrawdownPct, 0.001, 0.5, errors);
  assertRange("SELF_HEAL_WARNING_DRAWDOWN_PCT", config.selfHealWarningDrawdownPct, 0.001, 0.5, errors);
  assertRange("LOSS_STREAK_LOOKBACK_MINUTES", config.lossStreakLookbackMinutes, 30, 10080, errors);
  assertRange("STABLE_MODEL_MAX_SNAPSHOTS", config.stableModelMaxSnapshots, 1, 50, errors);
  assertRange("STABLE_MODEL_MIN_TRADES", config.stableModelMinTrades, 1, 500, errors);
  assertRange("STABLE_MODEL_MAX_CALIBRATION_ECE", config.stableModelMaxCalibrationEce, 0, 1, errors);
  assertRange("STABLE_MODEL_MIN_WIN_RATE", config.stableModelMinWinRate, 0, 1, errors);
  assertRange("TARGET_ANNUALIZED_VOLATILITY", config.targetAnnualizedVolatility, 0.05, 2, errors);
  assertRange("MIN_VOL_TARGET_FRACTION", config.minVolTargetFraction, 0.1, 2, errors);
  assertRange("MAX_VOL_TARGET_FRACTION", config.maxVolTargetFraction, 0.1, 3, errors);
  assertRange("MAX_PAIR_CORRELATION", config.maxPairCorrelation, 0, 1, errors);
  assertRange("MAX_CLUSTER_POSITIONS", config.maxClusterPositions, 1, 10, errors);
  assertRange("MAX_SECTOR_POSITIONS", config.maxSectorPositions, 1, 10, errors);
  assertRange("MIN_BOOK_PRESSURE_FOR_ENTRY", config.minBookPressureForEntry, -1, 1, errors);
  assertRange("PAPER_EXPLORATION_THRESHOLD_BUFFER", config.paperExplorationThresholdBuffer, 0, 0.2, errors);
  assertRange("PAPER_EXPLORATION_SIZE_MULTIPLIER", config.paperExplorationSizeMultiplier, 0.1, 1, errors);
  assertRange("PAPER_EXPLORATION_COOLDOWN_MINUTES", config.paperExplorationCooldownMinutes, 0, 1440, errors);
  assertRange("PAPER_EXPLORATION_MIN_BOOK_PRESSURE", config.paperExplorationMinBookPressure, -1, 1, errors);
  assertRange("ANNOUNCEMENT_LOOKBACK_HOURS", config.announcementLookbackHours, 1, 168, errors);
  assertRange("ANNOUNCEMENT_CACHE_MINUTES", config.announcementCacheMinutes, 1, 240, errors);
  assertRange("MARKET_STRUCTURE_CACHE_MINUTES", config.marketStructureCacheMinutes, 1, 120, errors);
  assertRange("MARKET_STRUCTURE_LOOKBACK_POINTS", config.marketStructureLookbackPoints, 2, 100, errors);
  assertRange("CALENDAR_LOOKBACK_DAYS", config.calendarLookbackDays, 1, 180, errors);
  assertRange("CALENDAR_CACHE_MINUTES", config.calendarCacheMinutes, 1, 720, errors);
  assertRange("NEWS_MIN_SOURCE_QUALITY", config.newsMinSourceQuality, 0, 1, errors);
  assertRange("NEWS_MIN_RELIABILITY_SCORE", config.newsMinReliabilityScore, 0, 1, errors);
  assertRange("META_MIN_CONFIDENCE", config.metaMinConfidence, 0, 1, errors);
  assertRange("META_BLOCK_SCORE", config.metaBlockScore, 0, 1, errors);
  assertRange("META_CAUTION_SCORE", config.metaCautionScore, 0, 1, errors);
  assertRange("CANARY_LIVE_TRADE_COUNT", config.canaryLiveTradeCount, 1, 100, errors);
  assertRange("CANARY_LIVE_SIZE_MULTIPLIER", config.canaryLiveSizeMultiplier, 0.05, 1, errors);
  assertRange("DAILY_RISK_BUDGET_FLOOR", config.dailyRiskBudgetFloor, 0.05, 1, errors);
  assertRange("MAX_ENTRIES_PER_DAY", config.maxEntriesPerDay, 1, 100, errors);
  assertRange("SCALE_OUT_TRIGGER_PCT", config.scaleOutTriggerPct, 0.001, 0.2, errors);
  assertRange("SCALE_OUT_FRACTION", config.scaleOutFraction, 0.05, 0.95, errors);
  assertRange("SCALE_OUT_MIN_NOTIONAL_USD", config.scaleOutMinNotionalUsd, 5, 100000, errors);
  assertRange("SCALE_OUT_TRAIL_OFFSET_PCT", config.scaleOutTrailOffsetPct, 0, 0.1, errors);
  assertRange("RESEARCH_CANDLE_LIMIT", config.researchCandleLimit, 180, 2000, errors);
  assertRange("RESEARCH_TRAIN_CANDLES", config.researchTrainCandles, 60, 1000, errors);
  assertRange("RESEARCH_TEST_CANDLES", config.researchTestCandles, 24, 500, errors);
  assertRange("RESEARCH_STEP_CANDLES", config.researchStepCandles, 12, 500, errors);
  assertRange("RESEARCH_MAX_WINDOWS", config.researchMaxWindows, 1, 30, errors);
  assertRange("RESEARCH_MAX_SYMBOLS", config.researchMaxSymbols, 1, 20, errors);

  if (config.maxPositionFraction > config.maxTotalExposureFraction) {
    errors.push("MAX_POSITION_FRACTION cannot exceed MAX_TOTAL_EXPOSURE_FRACTION.");
  }
  if (config.paperMakerFillFloor > config.paperPartialFillMinRatio) {
    warnings.push("PAPER_MAKER_FILL_FLOOR is above PAPER_PARTIAL_FILL_MIN_RATIO; maker fills may dominate the paper execution model.");
  }
  if (config.stopLossPct >= config.takeProfitPct) {
    warnings.push("TAKE_PROFIT_PCT is not larger than STOP_LOSS_PCT; reward/risk may be unattractive.");
  }
  if (config.maxTotalExposureFraction > 0.8) {
    warnings.push("MAX_TOTAL_EXPOSURE_FRACTION above 0.8 is aggressive for an autonomous bot.");
  }
  if (config.enableEventDrivenData && typeof WebSocket === "undefined") {
    warnings.push("Event-driven data is enabled, but WebSocket is not available in this runtime.");
  }
  if (config.enablePeggedOrders && !config.enableSmartExecution) {
    warnings.push("ENABLE_PEGGED_ORDERS has no effect while ENABLE_SMART_EXECUTION=false.");
  }
  if (config.enableLocalOrderBook && !config.enableEventDrivenData) {
    warnings.push("ENABLE_LOCAL_ORDER_BOOK works best with ENABLE_EVENT_DRIVEN_DATA=true.");
  }
  if (config.marketSnapshotBudgetSymbols < config.universeMaxSymbols) {
    warnings.push("MARKET_SNAPSHOT_BUDGET_SYMBOLS is smaller than UNIVERSE_MAX_SYMBOLS; some universe-selected pairs may only use cached/lightweight data.");
  }
  if (config.enableMarketSentimentContext === false) {
    warnings.push("ENABLE_MARKET_SENTIMENT_CONTEXT=false removes fear/greed and market-breadth context.");
  }
  if (config.enableVolatilityContext === false) {
    warnings.push("ENABLE_VOLATILITY_CONTEXT=false removes Deribit options-vol context.");
  }
  if (config.sessionHardBlockMinutesToFunding >= config.sessionCautionMinutesToFunding) {
    errors.push("SESSION_HARD_BLOCK_MINUTES_TO_FUNDING must be smaller than SESSION_CAUTION_MINUTES_TO_FUNDING.");
  }
  if (config.driftFeatureScoreBlock <= config.driftFeatureScoreAlert) {
    errors.push("DRIFT_FEATURE_SCORE_BLOCK must be larger than DRIFT_FEATURE_SCORE_ALERT.");
  }
  if (config.driftCalibrationEceBlock <= config.driftCalibrationEceAlert) {
    errors.push("DRIFT_CALIBRATION_ECE_BLOCK must be larger than DRIFT_CALIBRATION_ECE_ALERT.");
  }
  if (config.driftExecutionSlipBlockBps <= config.driftExecutionSlipAlertBps) {
    errors.push("DRIFT_EXECUTION_SLIP_BLOCK_BPS must be larger than DRIFT_EXECUTION_SLIP_ALERT_BPS.");
  }
  if (config.selfHealWarningLossStreak > config.selfHealMaxRecentLossStreak) {
    errors.push("SELF_HEAL_WARNING_LOSS_STREAK cannot exceed SELF_HEAL_MAX_RECENT_LOSS_STREAK.");
  }
  if (config.selfHealWarningDrawdownPct > config.selfHealMaxRecentDrawdownPct) {
    errors.push("SELF_HEAL_WARNING_DRAWDOWN_PCT cannot exceed SELF_HEAL_MAX_RECENT_DRAWDOWN_PCT.");
  }
  if (config.metaBlockScore >= config.metaCautionScore) {
    errors.push("META_BLOCK_SCORE must be smaller than META_CAUTION_SCORE.");
  }
  if (config.researchTrainCandles <= config.researchTestCandles) {
    warnings.push("RESEARCH_TRAIN_CANDLES is not larger than RESEARCH_TEST_CANDLES; walk-forward studies may be noisy.");
  }
  const effectiveUniverseLimit = config.enableDynamicWatchlist ? config.watchlistTopN : config.watchlist.length;
  if (config.universeMaxSymbols > effectiveUniverseLimit) {
    warnings.push("UNIVERSE_MAX_SYMBOLS is larger than the effective watchlist size; the universe selector will effectively scan everything.");
  }
  if (config.dynamicWatchlistMinSymbols > config.watchlistTopN) {
    errors.push("DYNAMIC_WATCHLIST_MIN_SYMBOLS cannot exceed WATCHLIST_TOP_N.");
  }
  if (config.exitIntelligenceExitScore <= config.exitIntelligenceTrimScore) {
    errors.push("EXIT_INTELLIGENCE_EXIT_SCORE must be larger than EXIT_INTELLIGENCE_TRIM_SCORE.");
  }
  if (config.researchPromotionMaxDrawdownPct <= 0) {
    errors.push("RESEARCH_PROMOTION_MAX_DRAWDOWN_PCT must be positive.");
  }
  if (config.paperExplorationMinBookPressure < config.minBookPressureForEntry) {
    warnings.push("PAPER_EXPLORATION_MIN_BOOK_PRESSURE is looser than MIN_BOOK_PRESSURE_FOR_ENTRY; paper warm-up entries may tolerate mild sell pressure.");
  }

  if (config.botMode === "live") {
    if (!config.binanceApiKey || !config.binanceApiSecret) {
      errors.push("Live mode requires BINANCE_API_KEY and BINANCE_API_SECRET.");
    }
    if (config.liveTradingAcknowledged !== "I_UNDERSTAND_LIVE_TRADING_RISK") {
      errors.push("Set LIVE_TRADING_ACKNOWLEDGED=I_UNDERSTAND_LIVE_TRADING_RISK before live trading.");
    }
    if (!config.enableExchangeProtection) {
      errors.push("Live mode requires ENABLE_EXCHANGE_PROTECTION=true.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function assertValidConfig(config) {
  const result = validateConfig(config);
  if (!result.valid) {
    throw new Error(`Invalid configuration: ${result.errors.join(" ")}`);
  }
  return result;
}









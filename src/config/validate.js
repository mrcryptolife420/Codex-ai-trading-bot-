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
  assertRange("OPTIMIZER_BAYES_PRIOR_ALPHA", config.optimizerBayesPriorAlpha, 0.1, 10, errors);
  assertRange("OPTIMIZER_BAYES_PRIOR_BETA", config.optimizerBayesPriorBeta, 0.1, 10, errors);
  assertRange("OPTIMIZER_BAYES_EXPLORATION", config.optimizerBayesExploration, 0, 1, errors);
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
  assertRange("MAX_SERVER_TIME_DRIFT_MS", config.maxServerTimeDriftMs, 50, 60_000, errors);
  assertRange("CLOCK_SYNC_SAMPLE_COUNT", config.clockSyncSampleCount, 1, 12, errors);
  assertRange("CLOCK_SYNC_MAX_AGE_MS", config.clockSyncMaxAgeMs, 1_000, 3_600_000, errors);
  assertRange("CLOCK_SYNC_MAX_RTT_MS", config.clockSyncMaxRttMs, 50, 10_000, errors);
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
  assertRange("MODEL_PROMOTION_MIN_SHADOW_TRADES", config.modelPromotionMinShadowTrades, 1, 500, errors);
  assertRange("MODEL_PROMOTION_MIN_PAPER_TRADES", config.modelPromotionMinPaperTrades, 1, 500, errors);
  assertRange("MODEL_PROMOTION_MIN_PAPER_WIN_RATE", config.modelPromotionMinPaperWinRate, 0, 1, errors);
  assertRange("MODEL_PROMOTION_MAX_PAPER_DRAWDOWN_PCT", config.modelPromotionMaxPaperDrawdownPct, 0.001, 0.5, errors);
  assertRange("MODEL_PROMOTION_MIN_PAPER_QUALITY", config.modelPromotionMinPaperQuality, 0, 1, errors);
  assertRange("MODEL_PROMOTION_MIN_LIVE_TRADES", config.modelPromotionMinLiveTrades, 0, 500, errors);
  assertRange("MODEL_PROMOTION_MIN_LIVE_QUALITY", config.modelPromotionMinLiveQuality, 0, 1, errors);
  assertRange("STRATEGY_MIN_CONFIDENCE", config.strategyMinConfidence, 0, 1, errors);
  assertRange("TRANSFORMER_LOOKBACK_CANDLES", config.transformerLookbackCandles, 8, 120, errors);
  assertRange("TRANSFORMER_LEARNING_RATE", config.transformerLearningRate, 0.0001, 0.5, errors);
  assertRange("TRANSFORMER_MIN_CONFIDENCE", config.transformerMinConfidence, 0, 1, errors);
  assertRange("SEQUENCE_CHALLENGER_LEARNING_RATE", config.sequenceChallengerLearningRate, 0.0001, 0.5, errors);
  assertRange("SEQUENCE_CHALLENGER_L2", config.sequenceChallengerL2, 0, 0.1, errors);
  assertRange("META_NEURAL_LEARNING_RATE", config.metaNeuralLearningRate, 0.0001, 0.5, errors);
  assertRange("META_NEURAL_L2", config.metaNeuralL2, 0, 0.1, errors);
  assertRange("EXIT_NEURAL_LEARNING_RATE", config.exitNeuralLearningRate, 0.0001, 0.5, errors);
  assertRange("EXIT_NEURAL_L2", config.exitNeuralL2, 0, 0.1, errors);
  assertRange("EXECUTION_NEURAL_LEARNING_RATE", config.executionNeuralLearningRate, 0.0001, 0.5, errors);
  assertRange("EXECUTION_NEURAL_L2", config.executionNeuralL2, 0, 0.1, errors);
  assertRange("STRATEGY_META_LEARNING_RATE", config.strategyMetaLearningRate, 0.0001, 0.5, errors);
  assertRange("STRATEGY_META_L2", config.strategyMetaL2, 0, 0.1, errors);
  assertRange("COMMITTEE_MIN_CONFIDENCE", config.committeeMinConfidence, 0, 1, errors);
  assertRange("COMMITTEE_MIN_AGREEMENT", config.committeeMinAgreement, 0, 1, errors);
  assertRange("CALIBRATION_BINS", config.calibrationBins, 3, 50, errors);
  assertRange("STREAM_TRADE_BUFFER_SIZE", config.streamTradeBufferSize, 10, 2000, errors);
  assertRange("STREAM_DEPTH_LEVELS", config.streamDepthLevels, 5, 100, errors);
  assertRange("STREAM_DEPTH_SNAPSHOT_LIMIT", config.streamDepthSnapshotLimit, 20, 5000, errors);
  assertRange("MAX_DEPTH_EVENT_AGE_MS", config.maxDepthEventAgeMs, 100, 60_000, errors);
  assertRange("LOCAL_BOOK_BOOTSTRAP_WAIT_MS", config.localBookBootstrapWaitMs, 0, 5_000, errors);
  assertRange("LOCAL_BOOK_WARMUP_MS", config.localBookWarmupMs, 0, 30_000, errors);
  assertRange("LOWER_TIMEFRAME_LIMIT", config.lowerTimeframeLimit, 20, 500, errors);
  assertRange("HIGHER_TIMEFRAME_LIMIT", config.higherTimeframeLimit, 20, 500, errors);
  assertRange("CROSS_TIMEFRAME_MIN_ALIGNMENT_SCORE", config.crossTimeframeMinAlignmentScore, 0, 1, errors);
  assertRange("CROSS_TIMEFRAME_MAX_VOL_GAP_PCT", config.crossTimeframeMaxVolGapPct, 0.001, 0.25, errors);
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
  assertRange("SELF_HEAL_PAPER_CALIBRATION_PROBE_SIZE_MULTIPLIER", config.selfHealPaperCalibrationProbeSizeMultiplier, 0.05, 1, errors);
  assertRange("SELF_HEAL_PAPER_CALIBRATION_PROBE_THRESHOLD_PENALTY", config.selfHealPaperCalibrationProbeThresholdPenalty, 0, 0.2, errors);
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
  assertRange("MAX_FAMILY_POSITIONS", config.maxFamilyPositions, 1, 10, errors);
  assertRange("MAX_REGIME_POSITIONS", config.maxRegimePositions, 1, 10, errors);
  assertRange("PAIR_HEALTH_LOOKBACK_HOURS", config.pairHealthLookbackHours, 6, 720, errors);
  assertRange("PAIR_HEALTH_MIN_SCORE", config.pairHealthMinScore, 0, 1, errors);
  assertRange("PAIR_HEALTH_QUARANTINE_MINUTES", config.pairHealthQuarantineMinutes, 10, 1440, errors);
  assertRange("PAIR_HEALTH_MAX_INFRA_ISSUES", config.pairHealthMaxInfraIssues, 1, 20, errors);
  assertRange("UNIVERSE_MAX_SYMBOLS", config.universeMaxSymbols, 4, 120, errors);
  assertRange("UNIVERSE_MIN_SCORE", config.universeMinScore, 0, 1, errors);
  assertRange("UNIVERSE_MIN_DEPTH_CONFIDENCE", config.universeMinDepthConfidence, 0, 1, errors);
  assertRange("UNIVERSE_MIN_DEPTH_USD", config.universeMinDepthUsd, 1000, 500000000, errors);
  assertRange("UNIVERSE_TARGET_VOL_PCT", config.universeTargetVolPct, 0.001, 0.5, errors);
  assertRange("UNIVERSE_ROTATION_LOOKBACK_DAYS", config.universeRotationLookbackDays, 3, 180, errors);
  assertRange("UNIVERSE_ROTATION_BOOST", config.universeRotationBoost, 0, 0.5, errors);
  assertRange("UNIVERSE_ROTATION_MAX_COOLING_CLUSTERS", config.universeRotationMaxCoolingClusters, 0, 12, errors);
  assertRange("EXIT_INTELLIGENCE_MIN_CONFIDENCE", config.exitIntelligenceMinConfidence, 0, 1, errors);
  assertRange("EXIT_INTELLIGENCE_TRIM_SCORE", config.exitIntelligenceTrimScore, 0, 1, errors);
  assertRange("EXIT_INTELLIGENCE_TRAIL_SCORE", config.exitIntelligenceTrailScore, 0, 1, errors);
  assertRange("EXIT_INTELLIGENCE_EXIT_SCORE", config.exitIntelligenceExitScore, 0, 1, errors);
  assertRange("TRADE_QUALITY_MIN_SCORE", config.tradeQualityMinScore, 0, 1, errors);
  assertRange("TRADE_QUALITY_CAUTION_SCORE", config.tradeQualityCautionScore, 0, 1, errors);
  assertRange("DIVERGENCE_MIN_PAPER_TRADES", config.divergenceMinPaperTrades, 1, 500, errors);
  assertRange("DIVERGENCE_MIN_LIVE_TRADES", config.divergenceMinLiveTrades, 1, 500, errors);
  assertRange("DIVERGENCE_ALERT_SCORE", config.divergenceAlertScore, 0, 1, errors);
  assertRange("DIVERGENCE_BLOCK_SCORE", config.divergenceBlockScore, 0, 1, errors);
  assertRange("DIVERGENCE_ALERT_SLIP_GAP_BPS", config.divergenceAlertSlipGapBps, 0.1, 250, errors);
  assertRange("OFFLINE_TRAINER_MIN_READINESS", config.offlineTrainerMinReadiness, 0, 1, errors);
  assertRange("MODEL_PROMOTION_PROBATION_LIVE_TRADES", config.modelPromotionProbationLiveTrades, 1, 100, errors);
  assertRange("EXCHANGE_TRUTH_FREEZE_MISMATCH_COUNT", config.exchangeTruthFreezeMismatchCount, 1, 20, errors);
  assertRange("EXCHANGE_TRUTH_RECENT_FILL_LOOKBACK_MINUTES", config.exchangeTruthRecentFillLookbackMinutes, 1, 240, errors);
  assertRange("EXCHANGE_TRUTH_LOOP_INTERVAL_SECONDS", config.exchangeTruthLoopIntervalSeconds, 15, 3600, errors);
  assertRange("POSITION_FAILURE_PROTECT_ONLY_COUNT", config.positionFailureProtectOnlyCount, 1, 20, errors);
  assertRange("POSITION_FAILURE_MANUAL_REVIEW_COUNT", config.positionFailureManualReviewCount, 1, 30, errors);
  assertRange("SHADOW_TRADE_DECISION_LIMIT", config.shadowTradeDecisionLimit, 1, 20, errors);
  assertRange("THRESHOLD_AUTO_APPLY_MIN_CONFIDENCE", config.thresholdAutoApplyMinConfidence, 0, 1, errors);
  assertRange("THRESHOLD_PROBATION_MIN_TRADES", config.thresholdProbationMinTrades, 1, 100, errors);
  assertRange("THRESHOLD_PROBATION_WINDOW_DAYS", config.thresholdProbationWindowDays, 1, 90, errors);
  assertRange("THRESHOLD_PROBATION_MAX_AVG_PNL_DROP_PCT", config.thresholdProbationMaxAvgPnlDropPct, 0, 0.2, errors);
  assertRange("THRESHOLD_PROBATION_MAX_WIN_RATE_DROP", config.thresholdProbationMaxWinRateDrop, 0, 0.5, errors);
  assertRange("THRESHOLD_RELAX_STEP", config.thresholdRelaxStep, 0.001, 0.05, errors);
  assertRange("THRESHOLD_TIGHTEN_STEP", config.thresholdTightenStep, 0.001, 0.05, errors);
  assertRange("THRESHOLD_TUNING_MAX_RECOMMENDATIONS", config.thresholdTuningMaxRecommendations, 1, 20, errors);
  assertRange("FEATURE_DECAY_MIN_TRADES", config.featureDecayMinTrades, 3, 100, errors);
  assertRange("FEATURE_DECAY_WEAK_SCORE", config.featureDecayWeakScore, 0, 1, errors);
  assertRange("FEATURE_DECAY_BLOCKED_SCORE", config.featureDecayBlockedScore, 0, 1, errors);
  assertRange("EXECUTION_CALIBRATION_MIN_LIVE_TRADES", config.executionCalibrationMinLiveTrades, 1, 200, errors);
  assertRange("EXECUTION_CALIBRATION_LOOKBACK_TRADES", config.executionCalibrationLookbackTrades, 4, 500, errors);
  assertRange("EXECUTION_CALIBRATION_MAX_BPS_ADJUST", config.executionCalibrationMaxBpsAdjust, 0.5, 50, errors);
  assertRange("PARAMETER_GOVERNOR_MIN_TRADES", config.parameterGovernorMinTrades, 2, 100, errors);
  assertRange("PARAMETER_GOVERNOR_MAX_THRESHOLD_SHIFT", config.parameterGovernorMaxThresholdShift, 0.001, 0.08, errors);
  assertRange("PARAMETER_GOVERNOR_MAX_STOP_LOSS_MULTIPLIER_DELTA", config.parameterGovernorMaxStopLossMultiplierDelta, 0.01, 0.4, errors);
  assertRange("PARAMETER_GOVERNOR_MAX_TAKE_PROFIT_MULTIPLIER_DELTA", config.parameterGovernorMaxTakeProfitMultiplierDelta, 0.01, 0.5, errors);
  assertRange("REFERENCE_VENUE_MIN_QUOTES", config.referenceVenueMinQuotes, 1, 10, errors);
  assertRange("REFERENCE_VENUE_MAX_DIVERGENCE_BPS", config.referenceVenueMaxDivergenceBps, 0.5, 250, errors);
  assertRange("STRATEGY_RESEARCH_PAPER_SCORE_FLOOR", config.strategyResearchPaperScoreFloor, 0.2, 1, errors);
  assertRange("STRATEGY_GENOME_MAX_CHILDREN", config.strategyGenomeMaxChildren, 1, 20, errors);
  assertRange("COUNTERFACTUAL_LOOKAHEAD_MINUTES", config.counterfactualLookaheadMinutes, 5, 1440, errors);
  assertRange("COUNTERFACTUAL_QUEUE_LIMIT", config.counterfactualQueueLimit, 5, 500, errors);
  assertRange("MIN_BOOK_PRESSURE_FOR_ENTRY", config.minBookPressureForEntry, -1, 1, errors);
  assertRange("PAPER_EXPLORATION_THRESHOLD_BUFFER", config.paperExplorationThresholdBuffer, 0, 0.2, errors);
  assertRange("PAPER_EXPLORATION_SIZE_MULTIPLIER", config.paperExplorationSizeMultiplier, 0.1, 1, errors);
  assertRange("PAPER_EXPLORATION_COOLDOWN_MINUTES", config.paperExplorationCooldownMinutes, 0, 1440, errors);
  assertRange("PAPER_EXPLORATION_MIN_BOOK_PRESSURE", config.paperExplorationMinBookPressure, -1, 1, errors);
  assertRange("PAPER_RECOVERY_PROBE_THRESHOLD_BUFFER", config.paperRecoveryProbeThresholdBuffer, 0, 0.2, errors);
  assertRange("PAPER_RECOVERY_PROBE_SIZE_MULTIPLIER", config.paperRecoveryProbeSizeMultiplier, 0.05, 1, errors);
  assertRange("PAPER_RECOVERY_PROBE_COOLDOWN_MINUTES", config.paperRecoveryProbeCooldownMinutes, 0, 1440, errors);
  assertRange("PAPER_RECOVERY_PROBE_MIN_BOOK_PRESSURE", config.paperRecoveryProbeMinBookPressure, -1, 1, errors);
  assertRange("ANNOUNCEMENT_LOOKBACK_HOURS", config.announcementLookbackHours, 1, 168, errors);
  assertRange("ONCHAIN_LITE_TRENDING_LIMIT", config.onChainLiteTrendingLimit, 1, 20, errors);
  assertRange("ANNOUNCEMENT_CACHE_MINUTES", config.announcementCacheMinutes, 1, 240, errors);
  assertRange("MARKET_STRUCTURE_CACHE_MINUTES", config.marketStructureCacheMinutes, 1, 120, errors);
  assertRange("MARKET_STRUCTURE_LOOKBACK_POINTS", config.marketStructureLookbackPoints, 2, 100, errors);
  assertRange("CALENDAR_LOOKBACK_DAYS", config.calendarLookbackDays, 1, 180, errors);
  assertRange("CALENDAR_CACHE_MINUTES", config.calendarCacheMinutes, 1, 720, errors);
  assertRange("NEWS_MIN_SOURCE_QUALITY", config.newsMinSourceQuality, 0, 1, errors);
  assertRange("NEWS_MIN_RELIABILITY_SCORE", config.newsMinReliabilityScore, 0, 1, errors);
  assertRange("SOURCE_RELIABILITY_MIN_OPERATIONAL_SCORE", config.sourceReliabilityMinOperationalScore, 0, 1, errors);
  assertRange("SOURCE_RELIABILITY_MAX_RECENT_FAILURES", config.sourceReliabilityMaxRecentFailures, 1, 20, errors);
  assertRange("SOURCE_RELIABILITY_RATE_LIMIT_COOLDOWN_MINUTES", config.sourceReliabilityRateLimitCooldownMinutes, 1, 1440, errors);
  assertRange("SOURCE_RELIABILITY_TIMEOUT_COOLDOWN_MINUTES", config.sourceReliabilityTimeoutCooldownMinutes, 1, 1440, errors);
  assertRange("SOURCE_RELIABILITY_FAILURE_COOLDOWN_MINUTES", config.sourceReliabilityFailureCooldownMinutes, 1, 1440, errors);
  assertRange("META_MIN_CONFIDENCE", config.metaMinConfidence, 0, 1, errors);
  assertRange("META_BLOCK_SCORE", config.metaBlockScore, 0, 1, errors);
  assertRange("META_CAUTION_SCORE", config.metaCautionScore, 0, 1, errors);
  assertRange("CANARY_LIVE_TRADE_COUNT", config.canaryLiveTradeCount, 1, 100, errors);
  assertRange("CANARY_LIVE_SIZE_MULTIPLIER", config.canaryLiveSizeMultiplier, 0.05, 1, errors);
  assertRange("CAPITAL_LADDER_SEED_MULTIPLIER", config.capitalLadderSeedMultiplier, 0.01, 1, errors);
  assertRange("CAPITAL_LADDER_SCALED_MULTIPLIER", config.capitalLadderScaledMultiplier, 0.05, 1, errors);
  assertRange("CAPITAL_LADDER_FULL_MULTIPLIER", config.capitalLadderFullMultiplier, 0.1, 1.5, errors);
  assertRange("CAPITAL_LADDER_MIN_APPROVED_CANDIDATES", config.capitalLadderMinApprovedCandidates, 0, 20, errors);
  assertRange("CAPITAL_GOVERNOR_WEEKLY_DRAWDOWN_PCT", config.capitalGovernorWeeklyDrawdownPct, 0.005, 0.5, errors);
  assertRange("CAPITAL_GOVERNOR_BAD_DAY_STREAK", config.capitalGovernorBadDayStreak, 1, 10, errors);
  assertRange("CAPITAL_GOVERNOR_RECOVERY_TRADES", config.capitalGovernorRecoveryTrades, 1, 50, errors);
  assertRange("CAPITAL_GOVERNOR_RECOVERY_MIN_WIN_RATE", config.capitalGovernorRecoveryMinWinRate, 0, 1, errors);
  assertRange("CAPITAL_GOVERNOR_MIN_SIZE_MULTIPLIER", config.capitalGovernorMinSizeMultiplier, 0.05, 1, errors);
  assertRange("DAILY_RISK_BUDGET_FLOOR", config.dailyRiskBudgetFloor, 0.05, 1, errors);
  assertRange("PORTFOLIO_MAX_CVAR_PCT", config.portfolioMaxCvarPct, 0.001, 0.2, errors);
  assertRange("PORTFOLIO_DRAWDOWN_BUDGET_PCT", config.portfolioDrawdownBudgetPct, 0.005, 0.5, errors);
  assertRange("PORTFOLIO_REGIME_KILL_SWITCH_LOSS_STREAK", config.portfolioRegimeKillSwitchLossStreak, 1, 20, errors);
  assertRange("MAX_ENTRIES_PER_DAY", config.maxEntriesPerDay, 1, 100, errors);
  assertRange("MAX_ENTRIES_PER_SYMBOL_PER_DAY", config.maxEntriesPerSymbolPerDay, 1, 24, errors);
  assertRange("SYMBOL_LOSS_COOLDOWN_MINUTES", config.symbolLossCooldownMinutes, 0, 1440, errors);
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
  assertRange("DATA_RECORDER_RETENTION_DAYS", config.dataRecorderRetentionDays, 3, 365, errors);
  assertRange("MODEL_REGISTRY_MIN_SCORE", config.modelRegistryMinScore, 0, 1, errors);
  assertRange("MODEL_REGISTRY_ROLLBACK_DRAWDOWN_PCT", config.modelRegistryRollbackDrawdownPct, 0.001, 0.5, errors);
  assertRange("MODEL_REGISTRY_MAX_ENTRIES", config.modelRegistryMaxEntries, 1, 100, errors);
  assertRange("STATE_BACKUP_INTERVAL_MINUTES", config.stateBackupIntervalMinutes, 1, 1440, errors);
  assertRange("STATE_BACKUP_RETENTION", config.stateBackupRetention, 1, 100, errors);
  assertRange("SERVICE_RESTART_DELAY_SECONDS", config.serviceRestartDelaySeconds, 1, 3600, errors);
  assertRange("SERVICE_RESTART_BACKOFF_MULTIPLIER", config.serviceRestartBackoffMultiplier, 1, 10, errors);
  assertRange("SERVICE_RESTART_MAX_DELAY_SECONDS", config.serviceRestartMaxDelaySeconds, 1, 7200, errors);
  assertRange("SERVICE_MAX_RESTARTS_PER_HOUR", config.serviceMaxRestartsPerHour, 1, 500, errors);
  assertRange("OPERATOR_ALERT_MAX_ITEMS", config.operatorAlertMaxItems, 1, 50, errors);
  assertRange("OPERATOR_ALERT_DISPATCH_COOLDOWN_MINUTES", config.operatorAlertDispatchCooldownMinutes, 1, 1440, errors);

  if ((config.userRegion || "").toUpperCase() === "BE" && config.exchangeCapabilities?.shortingEnabled) {
    warnings.push("Belgium capability profile has shorting enabled via override; verify your Binance account and local eligibility before enabling any short-biased automation.");
  }
  assertRange("OPERATOR_ALERT_SILENCE_MINUTES", config.operatorAlertSilenceMinutes, 1, 10080, errors);
  if ((config.operatorAlertTelegramBotToken && !config.operatorAlertTelegramChatId) || (!config.operatorAlertTelegramBotToken && config.operatorAlertTelegramChatId)) {
    warnings.push("Configure both OPERATOR_ALERT_TELEGRAM_BOT_TOKEN and OPERATOR_ALERT_TELEGRAM_CHAT_ID to enable Telegram alert delivery.");
  }

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
  if (config.clockSyncMaxRttMs > config.maxServerTimeDriftMs * 4) {
    warnings.push("CLOCK_SYNC_MAX_RTT_MS is much larger than MAX_SERVER_TIME_DRIFT_MS; stale high-latency sync samples may hide transport issues.");
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
  if (config.enableOnChainLiteContext === false) {
    warnings.push("ENABLE_ONCHAIN_LITE_CONTEXT=false removes stablecoin liquidity context.");
  }
  if (config.enableCrossTimeframeConsensus && config.lowerTimeframeInterval === config.higherTimeframeInterval) {
    warnings.push("Cross-timeframe consensus uses identical intervals; alignment signal will be less informative.");
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
  if (config.exitIntelligenceTrimScore <= config.exitIntelligenceTrailScore) {
    errors.push("EXIT_INTELLIGENCE_TRIM_SCORE must be larger than EXIT_INTELLIGENCE_TRAIL_SCORE.");
  }
  if (config.exitIntelligenceExitScore <= config.exitIntelligenceTrimScore) {
    errors.push("EXIT_INTELLIGENCE_EXIT_SCORE must be larger than EXIT_INTELLIGENCE_TRIM_SCORE.");
  }
  if (config.tradeQualityCautionScore <= config.tradeQualityMinScore) {
    errors.push("TRADE_QUALITY_CAUTION_SCORE must be larger than TRADE_QUALITY_MIN_SCORE.");
  }
  if (config.divergenceBlockScore <= config.divergenceAlertScore) {
    errors.push("DIVERGENCE_BLOCK_SCORE must be larger than DIVERGENCE_ALERT_SCORE.");
  }
  if (config.positionFailureManualReviewCount < config.positionFailureProtectOnlyCount) {
    errors.push("POSITION_FAILURE_MANUAL_REVIEW_COUNT cannot be smaller than POSITION_FAILURE_PROTECT_ONLY_COUNT.");
  }
  if (config.thresholdProbationMaxWinRateDrop >= 0.25) {
    warnings.push("THRESHOLD_PROBATION_MAX_WIN_RATE_DROP is wide; threshold experiments may stay active despite weaker trade quality.");
  }
  if (config.featureDecayBlockedScore >= config.featureDecayWeakScore) {
    errors.push("FEATURE_DECAY_BLOCKED_SCORE must be smaller than FEATURE_DECAY_WEAK_SCORE.");
  }
  if (config.executionCalibrationLookbackTrades < config.executionCalibrationMinLiveTrades) {
    errors.push("EXECUTION_CALIBRATION_LOOKBACK_TRADES cannot be smaller than EXECUTION_CALIBRATION_MIN_LIVE_TRADES.");
  }
  if (config.portfolioDrawdownBudgetPct < config.maxDailyDrawdown) {
    warnings.push("PORTFOLIO_DRAWDOWN_BUDGET_PCT is tighter than MAX_DAILY_DRAWDOWN; allocator cooling may trigger before the global drawdown guard.");
  }
  if (config.serviceRestartMaxDelaySeconds < config.serviceRestartDelaySeconds) {
    errors.push("SERVICE_RESTART_MAX_DELAY_SECONDS cannot be smaller than SERVICE_RESTART_DELAY_SECONDS.");
  }
  if (config.researchPromotionMaxDrawdownPct <= 0) {
    errors.push("RESEARCH_PROMOTION_MAX_DRAWDOWN_PCT must be positive.");
  }
  if (config.paperExplorationMinBookPressure < config.minBookPressureForEntry) {
    warnings.push("PAPER_EXPLORATION_MIN_BOOK_PRESSURE is looser than MIN_BOOK_PRESSURE_FOR_ENTRY; paper warm-up entries may tolerate mild sell pressure.");
  }
  if (!config.dataRecorderEnabled) {
    warnings.push("DATA_RECORDER_ENABLED=false disables the richer feature-store for replay and retraining.");
  }
  if (!config.stateBackupEnabled) {
    warnings.push("STATE_BACKUP_ENABLED=false removes automatic runtime backups and crash-recovery snapshots.");
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

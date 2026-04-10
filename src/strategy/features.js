import { average, clamp } from "../utils/math.js";

function buildExecutionStressProfile({
  bookFeatures = {},
  marketFeatures = {},
  regimeSummary = {},
  strategySummary = {},
  executionQualityComposite = 0,
  breakoutQualityComposite = 0
} = {}) {
  const highVolBreakoutContext =
    regimeSummary.regime === "high_vol" &&
    strategySummary.family === "breakout";
  const spreadBps = Number(bookFeatures.spreadBps || 0);
  const depthConfidence = Number(bookFeatures.depthConfidence || 0);
  const replenishmentScore = Number.isFinite(bookFeatures.replenishmentScore)
    ? (bookFeatures.replenishmentScore + 1) / 2
    : Number.isFinite(bookFeatures.queueRefreshScore)
      ? (bookFeatures.queueRefreshScore + 1) / 2
      : 0.5;
  const relativeVolBps = Math.max(
    Number(marketFeatures.realizedVolPct || 0) * 10_000,
    Number(marketFeatures.atrPct || 0) * 10_000,
    Number(marketFeatures.donchianWidthPct || 0) * 10_000,
    1
  );
  const spreadToVolRatio = spreadBps / Math.max(relativeVolBps, 1);
  const marketableExecutionContext =
    executionQualityComposite >= 0.58 &&
    breakoutQualityComposite >= 0.55 &&
    depthConfidence >= 0.5 &&
    replenishmentScore >= 0.48 &&
    spreadBps <= 12;
  const breakoutExecutionRelief = highVolBreakoutContext && marketableExecutionContext
    ? clamp(
      (executionQualityComposite - 0.58) * 0.95 +
      (breakoutQualityComposite - 0.55) * 0.75 +
      Math.max(0, 0.1 - spreadToVolRatio) * 2.5,
      0,
      0.42
    )
    : 0;
  const executionFeatureDamp = 1 - breakoutExecutionRelief;
  return {
    highVolBreakoutContext,
    marketableExecutionContext,
    spreadToVolRatio,
    breakoutExecutionRelief,
    executionFeatureDamp
  };
}

function regimeFlags(regime) {
  return {
    regime_trend: regime === "trend" ? 1 : 0,
    regime_range: regime === "range" ? 1 : 0,
    regime_breakout: regime === "breakout" ? 1 : 0,
    regime_high_vol: regime === "high_vol" ? 1 : 0,
    regime_event_risk: regime === "event_risk" ? 1 : 0
  };
}

function strategyFlags(strategySummary = {}) {
  const active = strategySummary.activeStrategy || "";
  const family = strategySummary.family || "";
  return {
    strategy_family_breakout: family === "breakout" ? 1 : 0,
    strategy_family_mean_reversion: family === "mean_reversion" ? 1 : 0,
    strategy_family_trend_following: family === "trend_following" ? 1 : 0,
    strategy_family_market_structure: family === "market_structure" ? 1 : 0,
    strategy_family_derivatives: family === "derivatives" ? 1 : 0,
    strategy_family_orderflow: family === "orderflow" ? 1 : 0,
    strategy_family_range_grid: family === "range_grid" ? 1 : 0,
    strategy_ema_trend: active === "ema_trend" ? 1 : 0,
    strategy_donchian_breakout: active === "donchian_breakout" ? 1 : 0,
    strategy_vwap_trend: active === "vwap_trend" ? 1 : 0,
    strategy_bollinger_squeeze: active === "bollinger_squeeze" ? 1 : 0,
    strategy_atr_breakout: active === "atr_breakout" ? 1 : 0,
    strategy_vwap_reversion: active === "vwap_reversion" ? 1 : 0,
    strategy_zscore_reversion: active === "zscore_reversion" ? 1 : 0,
    strategy_liquidity_sweep: active === "liquidity_sweep" ? 1 : 0,
    strategy_market_structure_break: active === "market_structure_break" ? 1 : 0,
    strategy_funding_rate_extreme: active === "funding_rate_extreme" ? 1 : 0,
    strategy_open_interest_breakout: active === "open_interest_breakout" ? 1 : 0,
    strategy_orderbook_imbalance: active === "orderbook_imbalance" ? 1 : 0,
    strategy_range_grid_reversion: active === "range_grid_reversion" ? 1 : 0,
    strategy_fit: clamp((strategySummary.fitScore || 0) * 3, 0, 3),
    strategy_confidence: clamp((strategySummary.confidence || 0) * 3, 0, 3),
    strategy_agreement: clamp((strategySummary.agreementGap || 0) * 3, 0, 3),
    strategy_optimizer_bias: clamp((strategySummary.optimizerBoost || 0) * 12, -3, 3)
  };
}

export function buildFeatureVector({
  symbolStats,
  marketFeatures,
  bookFeatures,
  trendStateSummary = {},
  venueConfirmationSummary = {},
  newsSummary,
  announcementSummary = {},
  marketStructureSummary = {},
  marketSentimentSummary = {},
  volatilitySummary = {},
  calendarSummary = {},
  portfolioFeatures = {},
  streamFeatures = {},
  regimeSummary = { regime: "range" },
  strategySummary = {},
  sessionSummary = {},
  timeframeSummary = {},
  onChainLiteSummary = {},
  orderflowSummary = {},
  volumeProfileSummary = {},
  globalMarketContextSummary = {},
  pairHealthSummary = {},
  now = new Date()
}) {
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const cycle = (hour / 24) * Math.PI * 2;
  const relativeStrengthComposite = average(
    [
      marketFeatures.relativeStrengthVsBtc,
      marketFeatures.relativeStrengthVsEth,
      marketFeatures.clusterRelativeStrength,
      marketFeatures.sectorRelativeStrength
    ].filter((value) => Number.isFinite(value)),
    0
  );
  const realizedVolPct = Number.isFinite(marketFeatures.realizedVolPct) ? marketFeatures.realizedVolPct : 0;
  const upsideAcceleration = Math.max(0, Number.isFinite(marketFeatures.upsideAccelerationScore) ? marketFeatures.upsideAccelerationScore : 0);
  const downsideAcceleration = Math.max(0, Number.isFinite(marketFeatures.downsideAccelerationScore) ? marketFeatures.downsideAccelerationScore : 0);
  const accelerationSum = upsideAcceleration + downsideAcceleration;
  const fallbackUpsideVolPct = accelerationSum > 0 ? realizedVolPct * (upsideAcceleration / accelerationSum) : 0;
  const fallbackDownsideVolPct = accelerationSum > 0 ? realizedVolPct * (downsideAcceleration / accelerationSum) : 0;
  const upsideRealizedVolPct = Number.isFinite(marketFeatures.upsideRealizedVolPct) ? marketFeatures.upsideRealizedVolPct : fallbackUpsideVolPct;
  const downsideRealizedVolPct = Number.isFinite(marketFeatures.downsideRealizedVolPct) ? marketFeatures.downsideRealizedVolPct : fallbackDownsideVolPct;
  const downsideVolDominance = (downsideRealizedVolPct - upsideRealizedVolPct) / Math.max(upsideRealizedVolPct + downsideRealizedVolPct, 1e-9);
  const acceptanceQuality = average(
    [
      marketFeatures.closeLocationQuality,
      marketFeatures.volumeAcceptanceScore,
      marketFeatures.anchoredVwapAcceptanceScore,
      Number.isFinite(marketFeatures.anchoredVwapRejectionScore) ? 1 - marketFeatures.anchoredVwapRejectionScore : null,
      marketFeatures.breakoutFollowThroughScore
    ].filter((value) => Number.isFinite(value)),
    0.5
  );
  const trendQualityComposite = average(
    [
      Math.max(0, marketFeatures.trendQualityScore || 0),
      marketFeatures.trendPersistence,
      marketFeatures.trendMaturityScore,
      marketFeatures.closeLocationQuality,
      marketFeatures.anchoredVwapAcceptanceScore,
      Math.max(0, Math.min(1, relativeStrengthComposite * 40 + 0.5))
    ].filter((value) => Number.isFinite(value)),
    0.5
  );
  const breakoutQualityComposite = average(
    [
      marketFeatures.breakoutFollowThroughScore,
      marketFeatures.volumeAcceptanceScore,
      Math.max(0, marketFeatures.structureBreakScore || 0),
      marketFeatures.closeLocationQuality,
      marketFeatures.keltnerSqueezeScore,
      Math.max(0, Math.min(1, relativeStrengthComposite * 40 + 0.5))
    ].filter((value) => Number.isFinite(value)),
    0.5
  );
  const executionQualityComposite = average(
    [
      bookFeatures.depthConfidence,
      Number.isFinite(bookFeatures.replenishmentScore) ? (bookFeatures.replenishmentScore + 1) / 2 : null,
      Number.isFinite(bookFeatures.queueRefreshScore) ? (bookFeatures.queueRefreshScore + 1) / 2 : null,
      Number.isFinite(bookFeatures.resilienceScore) ? (bookFeatures.resilienceScore + 1) / 2 : null,
      Math.max(0, Math.min(1, 1 - (bookFeatures.spreadBps || 0) / 25)),
      venueConfirmationSummary.averageHealthScore
    ].filter((value) => Number.isFinite(value)),
    0.5
  );
  const executionStressProfile = buildExecutionStressProfile({
    bookFeatures,
    marketFeatures,
    regimeSummary,
    strategySummary,
    executionQualityComposite,
    breakoutQualityComposite
  });
  const dampExecutionStress = (value, { positiveOnly = false } = {}) => {
    const numeric = Number.isFinite(value) ? value : 0;
    if (!executionStressProfile.breakoutExecutionRelief) {
      return numeric;
    }
    if (positiveOnly) {
      return numeric * clamp(1 - executionStressProfile.breakoutExecutionRelief * 0.7, 0.62, 1);
    }
    return numeric * clamp(executionStressProfile.executionFeatureDamp, 0.58, 1);
  };
  return {
    momentum_5: clamp(marketFeatures.momentum5 * 25, -3, 3),
    momentum_20: clamp(marketFeatures.momentum20 * 15, -3, 3),
    ema_gap: clamp(marketFeatures.emaGap * 60, -3, 3),
    ema_trend_score: clamp((marketFeatures.emaTrendScore || 0) * 180, -3, 3),
    ema_trend_slope: clamp((marketFeatures.emaTrendSlopePct || 0) * 220, -3, 3),
    rsi_centered: clamp((marketFeatures.rsi14 - 50) / 15, -3, 3),
    adx_strength: clamp(((marketFeatures.adx14 || 18) - 18) / 7, 0, 4),
    dmi_spread: clamp((marketFeatures.dmiSpread || 0) * 7, -4, 4),
    trend_quality: clamp((marketFeatures.trendQualityScore || 0) * 3.5, -4, 4),
    trend_quality_composite: clamp(trendQualityComposite * 3, 0, 3),
    supertrend_bias: clamp(((marketFeatures.supertrendDistancePct || 0) * 130) + ((marketFeatures.supertrendDirection || 0) * 0.9), -4, 4),
    supertrend_flip: clamp((marketFeatures.supertrendFlipScore || 0) * 2.5, -3, 3),
    stoch_rsi: clamp((((marketFeatures.stochRsiK || 50) - 50) / 16), -3, 3),
    stoch_cross: clamp((((marketFeatures.stochRsiK || 50) - (marketFeatures.stochRsiD || 50)) / 10), -3, 3),
    mfi_centered: clamp((((marketFeatures.mfi14 || 50) - 50) / 15), -3, 3),
    cmf: clamp((marketFeatures.cmf20 || 0) * 8, -4, 4),
    macd_hist: clamp(marketFeatures.macdHistogramPct * 250, -3, 3),
    atr_pct: clamp(marketFeatures.atrPct * 50, 0, 4),
    atr_expansion: clamp((marketFeatures.atrExpansion || 0) * 6, -3, 3),
    realized_vol: clamp(marketFeatures.realizedVolPct * 50, 0, 4),
    upside_realized_vol: clamp((marketFeatures.upsideRealizedVolPct || 0) * 55, 0, 4),
    downside_realized_vol: clamp((marketFeatures.downsideRealizedVolPct || 0) * 55, 0, 4),
    downside_vol_dominance: clamp(downsideVolDominance * 4, -4, 4),
    volume_z: clamp(marketFeatures.volumeZ, -4, 4),
    breakout_pct: clamp(marketFeatures.breakoutPct * 40, -3, 3),
    donchian_breakout: clamp((marketFeatures.donchianBreakoutPct || 0) * 55, -3, 3),
    donchian_position: clamp(((marketFeatures.donchianPosition || 0) - 0.5) * 6, -3, 3),
    donchian_width: clamp((marketFeatures.donchianWidthPct || 0) * 45, 0, 4),
    trend_strength: clamp(marketFeatures.trendStrength * 30, -3, 3),
    vwap_gap: clamp(marketFeatures.vwapGapPct * 55, -3, 3),
    vwap_slope: clamp((marketFeatures.vwapSlopePct || 0) * 220, -3, 3),
    obv_slope: clamp(marketFeatures.obvSlope * 3, -4, 4),
    range_compression: clamp((1 - marketFeatures.rangeCompression) * 6, -3, 3),
    bollinger_squeeze: clamp((marketFeatures.bollingerSqueezeScore || 0) * 3, 0, 3),
    bollinger_position: clamp(((marketFeatures.bollingerPosition || 0) - 0.5) * 6, -3, 3),
    price_zscore: clamp((marketFeatures.priceZScore || 0) / 1.2, -4, 4),
    keltner_width: clamp((marketFeatures.keltnerWidthPct || 0) * 45, 0, 4),
    keltner_squeeze: clamp((marketFeatures.keltnerSqueezeScore || 0) * 3, 0, 3),
    squeeze_release: clamp((marketFeatures.squeezeReleaseScore || 0) * 3, 0, 3),
    candle_body: clamp((marketFeatures.candleBodyRatio - 0.5) * 5, -3, 3),
    wick_skew: clamp(-marketFeatures.wickSkew * 3, -3, 3),
    close_location: clamp((marketFeatures.closeLocation - 0.5) * 5, -3, 3),
    trend_persistence: clamp((marketFeatures.trendPersistence - 0.5) * 6, -3, 3),
    swing_structure: clamp((marketFeatures.swingStructureScore || 0) * 3, -3, 3),
    trend_maturity: clamp((marketFeatures.trendMaturityScore || 0) * 3, 0, 3),
    trend_exhaustion: clamp((marketFeatures.trendExhaustionScore || 0) * 3, 0, 3),
    upside_acceleration: clamp((marketFeatures.upsideAccelerationScore || 0) * 3, 0, 3),
    downside_acceleration: clamp((marketFeatures.downsideAccelerationScore || 0) * 3, 0, 3),
    relative_strength_btc: clamp((marketFeatures.relativeStrengthVsBtc || 0) * 90, -4, 4),
    relative_strength_eth: clamp((marketFeatures.relativeStrengthVsEth || 0) * 90, -4, 4),
    relative_strength_cluster: clamp((marketFeatures.clusterRelativeStrength || 0) * 90, -4, 4),
    relative_strength_sector: clamp((marketFeatures.sectorRelativeStrength || 0) * 90, -4, 4),
    relative_strength_composite: clamp(relativeStrengthComposite * 90, -4, 4),
    anchored_vwap_gap: clamp((marketFeatures.anchoredVwapGapPct || 0) * 55, -3, 3),
    anchored_vwap_slope: clamp((marketFeatures.anchoredVwapSlopePct || 0) * 220, -3, 3),
    anchored_vwap_acceptance: clamp((marketFeatures.anchoredVwapAcceptanceScore || 0) * 3, 0, 3),
    anchored_vwap_rejection: clamp((marketFeatures.anchoredVwapRejectionScore || 0) * 3, 0, 3),
    close_location_quality: clamp((marketFeatures.closeLocationQuality || 0) * 3, 0, 3),
    breakout_follow_through: clamp((marketFeatures.breakoutFollowThroughScore || 0) * 3, 0, 3),
    volume_acceptance: clamp((marketFeatures.volumeAcceptanceScore || 0) * 3, 0, 3),
    acceptance_quality: clamp(acceptanceQuality * 3, 0, 3),
    breakout_quality_composite: clamp(breakoutQualityComposite * 3, 0, 3),
    bullish_fvg_active: marketFeatures.bullishFvgActive ? 1 : 0,
    bearish_fvg_active: marketFeatures.bearishFvgActive ? 1 : 0,
    fvg_fill_progress: clamp((marketFeatures.fvgFillProgress || 0) * 3, 0, 3),
    fvg_width_pct: clamp((marketFeatures.fvgWidthPct || 0) * 220, 0, 3),
    fvg_respect_score: clamp((marketFeatures.fvgRespectScore || 0) * 3, 0, 3),
    bullish_bos_active: marketFeatures.bullishBosActive ? 1 : 0,
    bearish_bos_active: marketFeatures.bearishBosActive ? 1 : 0,
    bos_strength: clamp((marketFeatures.bosStrengthScore || 0) * 3, 0, 3),
    structure_shift: clamp((marketFeatures.structureShiftScore || 0) * 3, -3, 3),
    swing_high_break: clamp((marketFeatures.swingHighBreakScore || 0) * 3, 0, 3),
    swing_low_break: clamp((marketFeatures.swingLowBreakScore || 0) * 3, 0, 3),
    cvd_value: clamp((marketFeatures.cvdValue || 0) / 3, -3, 3),
    cvd_slope: clamp((marketFeatures.cvdSlope || 0) * 40, -3, 3),
    cvd_momentum: clamp((marketFeatures.cvdMomentum || 0) * 40, -3, 3),
    cvd_divergence: clamp((marketFeatures.cvdDivergenceScore || 0) * 3, 0, 3),
    cvd_confirmation: clamp((marketFeatures.cvdConfirmationScore || 0) * 3, 0, 3),
    cvd_trend_alignment: clamp((marketFeatures.cvdTrendAlignment || 0) * 3, -3, 3),
    range_width_pct: clamp((marketFeatures.rangeWidthPct || 0) * 140, 0, 4),
    range_top_distance_pct: clamp((marketFeatures.rangeTopDistancePct || 0) * 160, 0, 4),
    range_bottom_distance_pct: clamp((marketFeatures.rangeBottomDistancePct || 0) * 160, 0, 4),
    range_mean_revert_score: clamp((marketFeatures.rangeMeanRevertScore || 0) * 3, 0, 3),
    range_boundary_respect: clamp((marketFeatures.rangeBoundaryRespectScore || 0) * 3, 0, 3),
    trend_failure: clamp((marketFeatures.trendFailureScore || 0) * 3, 0, 3),
    liquidity_sweep: clamp((marketFeatures.liquiditySweepScore || 0) * 3, -3, 3),
    structure_break: clamp((marketFeatures.structureBreakScore || 0) * 3, -3, 3),
    bullish_pattern: clamp((marketFeatures.bullishPatternScore || 0) * 3, 0, 3),
    bearish_pattern: clamp((marketFeatures.bearishPatternScore || 0) * 3, 0, 3),
    inside_bar: clamp((marketFeatures.insideBar || 0) * 2, 0, 2),
    spread_bps: clamp(dampExecutionStress(bookFeatures.spreadBps / 10, { positiveOnly: true }), 0, 5),
    depth_imbalance: clamp(dampExecutionStress(bookFeatures.depthImbalance * 4), -4, 4),
    weighted_depth_imbalance: clamp(dampExecutionStress((bookFeatures.weightedDepthImbalance || 0) * 4), -4, 4),
    microprice_edge: clamp(dampExecutionStress((bookFeatures.microPriceEdgeBps || 0) / 2.5), -4, 4),
    book_pressure: clamp((bookFeatures.bookPressure || 0) * 4, -4, 4),
    wall_imbalance: clamp((bookFeatures.wallImbalance || 0) * 4, -4, 4),
    orderbook_signal: clamp((bookFeatures.orderbookImbalanceSignal || 0) * 4, -4, 4),
    queue_imbalance: clamp(dampExecutionStress((bookFeatures.queueImbalance || 0) * 4), -4, 4),
    queue_refresh: clamp(dampExecutionStress((bookFeatures.queueRefreshScore || 0) * 4), -4, 4),
    replenishment_quality: clamp(dampExecutionStress((bookFeatures.replenishmentScore ?? bookFeatures.queueRefreshScore ?? 0) * 4), -4, 4),
    book_resilience: clamp(dampExecutionStress((bookFeatures.resilienceScore || 0) * 4), -4, 4),
    depth_confidence: clamp((bookFeatures.depthConfidence || 0) * 4, 0, 4),
    execution_quality_composite: clamp(executionQualityComposite * 3, 0, 3),
    venue_confirmation: venueConfirmationSummary.confirmed ? 1 : (venueConfirmationSummary.status || "") === "blocked" ? -1 : 0,
    venue_divergence: clamp((venueConfirmationSummary.divergenceBps || 0) / 6, 0, 4),
    venue_health: clamp(((venueConfirmationSummary.averageHealthScore || 0.5) - 0.5) * 6, -3, 3),
    trend_state_up: clamp((trendStateSummary.uptrendScore || 0) * 3, 0, 3),
    trend_state_down: clamp((trendStateSummary.downtrendScore || 0) * 3, 0, 3),
    trend_state_range: clamp((trendStateSummary.rangeScore || 0) * 3, 0, 3),
    data_confidence: clamp((trendStateSummary.dataConfidenceScore || 0) * 3, 0, 3),
    feature_completeness: clamp((trendStateSummary.completenessScore || 0) * 3, 0, 3),
    bid_concentration_delta: clamp(((bookFeatures.bidConcentration || 0) - (bookFeatures.askConcentration || 0)) * 10, -3, 3),
    news_sentiment: clamp(newsSummary.sentimentScore * 3, -3, 3),
    news_confidence: clamp(newsSummary.confidence * 2, 0, 2),
    news_risk: clamp(newsSummary.riskScore * 3, 0, 3),
    news_freshness: clamp((newsSummary.freshnessScore || 0) * 2, 0, 2),
    news_diversity: clamp(((newsSummary.providerDiversity || 0) + (newsSummary.sourceDiversity || 0) * 0.5) / 3, 0, 3),
    social_sentiment: clamp((newsSummary.socialSentiment || 0) * 3, -3, 3),
    social_risk: clamp((newsSummary.socialRisk || 0) * 3, 0, 3),
    social_coverage: clamp((newsSummary.socialCoverage || 0) / 2, 0, 3),
    source_operational_reliability: clamp((newsSummary.operationalReliability || 0.7) * 3, 0, 3),
    announcement_sentiment: clamp((announcementSummary.sentimentScore || 0) * 3, -3, 3),
    announcement_risk: clamp((announcementSummary.riskScore || 0) * 3, 0, 3),
    announcement_freshness: clamp((announcementSummary.freshnessScore || 0) * 2, 0, 2),
    official_notice_severity: clamp((announcementSummary.maxSeverity || 0) * 3, 0, 3),
    event_bullish: clamp((newsSummary.eventBullishScore || 0) * 3 + (announcementSummary.eventBullishScore || 0) * 2, 0, 3),
    event_bearish: clamp((newsSummary.eventBearishScore || 0) * 3 + (announcementSummary.eventBearishScore || 0) * 2, 0, 3),
    event_risk: clamp((newsSummary.eventRiskScore || 0) * 2 + (announcementSummary.eventRiskScore || 0) * 2 + (calendarSummary.riskScore || 0), 0, 3),
    funding_rate: clamp((marketStructureSummary.fundingRate || 0) * 4000, -3, 3),
    funding_extreme: clamp(Math.abs(marketStructureSummary.fundingRate || 0) * 6000, 0, 3),
    funding_reversion_edge: clamp((-(marketStructureSummary.fundingRate || 0) * 5000) - (marketStructureSummary.crowdingBias || 0) * 2, -4, 4),
    basis_bps: clamp((marketStructureSummary.basisBps || 0) / 12, -4, 4),
    open_interest_change: clamp((marketStructureSummary.openInterestChangePct || 0) * 90, -4, 4),
    open_interest_breakout: clamp(((marketStructureSummary.openInterestChangePct || 0) * 120) + ((marketFeatures.breakoutPct || 0) * 35), -4, 4),
    taker_bias: clamp((marketStructureSummary.takerImbalance || 0) * 4, -4, 4),
    crowding_bias: clamp((marketStructureSummary.crowdingBias || 0) * 4, -4, 4),
    global_long_short_bias: clamp((marketStructureSummary.globalLongShortImbalance || 0) * 4, -4, 4),
    top_trader_bias: clamp((marketStructureSummary.topTraderImbalance || 0) * 4, -4, 4),
    leverage_buildup: clamp((marketStructureSummary.leverageBuildupScore || 0) * 3, 0, 3),
    short_squeeze_risk: clamp((marketStructureSummary.shortSqueezeScore || 0) * 3, 0, 3),
    long_squeeze_risk: clamp((marketStructureSummary.longSqueezeScore || 0) * 3, 0, 3),
    market_structure_risk: clamp((marketStructureSummary.riskScore || 0) * 3, 0, 3),
    market_structure_signal: clamp((marketStructureSummary.signalScore || 0) * 4, -4, 4),
    liquidation_imbalance: clamp((marketStructureSummary.liquidationImbalance || 0) * 4, -4, 4),
    liquidation_intensity: clamp((marketStructureSummary.liquidationIntensity || 0) * 3, 0, 3),
    fear_greed_contrarian: clamp((marketSentimentSummary.contrarianScore || 0) * 3, -3, 3),
    fear_greed_extreme: clamp(Math.abs(marketSentimentSummary.contrarianScore || 0) * 3, 0, 3),
    btc_dominance: clamp(((marketSentimentSummary.btcDominancePct || 52) - 52) / 6, -3, 3),
    macro_sentiment_risk: clamp((marketSentimentSummary.riskScore || 0) * 3, 0, 3),
    options_iv: clamp(((volatilitySummary.marketOptionIv || 0) - 45) / 10, 0, 4),
    historical_vol_context: clamp(((volatilitySummary.marketHistoricalVol || 0) - 35) / 10, 0, 4),
    iv_premium: clamp((volatilitySummary.ivPremium || 0) / 6, -2, 4),
    volatility_surface_risk: clamp((volatilitySummary.riskScore || 0) * 3, 0, 3),
    vol_regime_stress: volatilitySummary.regime === "stress" ? 1 : volatilitySummary.regime === "elevated" ? 0.5 : 0,
    calendar_risk: clamp((calendarSummary.riskScore || 0) * 3, 0, 3),
    calendar_bullish: clamp((calendarSummary.bullishScore || 0) * 3, 0, 3),
    calendar_bearish: clamp((calendarSummary.bearishScore || 0) * 3, 0, 3),
    calendar_proximity: clamp((calendarSummary.urgencyScore || 0) * 3, 0, 3),
    trade_flow: clamp((streamFeatures.tradeFlowImbalance || 0) * 4, -4, 4),
    orderflow_delta: clamp((orderflowSummary.delta || 0) * 0.5, -4, 4),
    orderflow_delta_ratio: clamp((orderflowSummary.deltaRatio || 0) * 6, -4, 4),
    orderflow_pressure_buy: orderflowSummary.pressure === "buy" ? 1 : 0,
    orderflow_pressure_sell: orderflowSummary.pressure === "sell" ? 1 : 0,
    orderflow_quality: clamp(
      orderflowSummary.dataQuality === "high"
        ? 1
        : orderflowSummary.dataQuality === "medium"
          ? 0.6
          : orderflowSummary.dataQuality === "low"
            ? 0.3
            : 0,
      0,
      1
    ),
    micro_trend: clamp((streamFeatures.microTrend || 0) * 800, -4, 4),
    volume_poc_distance: clamp((volumeProfileSummary.context?.distanceToPocPct || 0) * 80, -4, 4),
    volume_value_area_bias: volumeProfileSummary.context?.inValueArea == null ? 0 : (volumeProfileSummary.context?.inValueArea ? 1 : -1),
    vwap_deviation: clamp((volumeProfileSummary.vwap?.deviationPct || 0) * 100, -4, 4),
    vwap_context_above: volumeProfileSummary.context?.vwapContext === "above_vwap" ? 1 : 0,
    vwap_context_below: volumeProfileSummary.context?.vwapContext === "below_vwap" ? 1 : 0,
    portfolio_heat: clamp((portfolioFeatures.heat || 0) * 3, 0, 3),
    correlation_pressure: clamp((portfolioFeatures.maxCorrelation || 0) * 3, 0, 3),
    portfolio_family_budget: clamp((portfolioFeatures.familyBudgetFactor || 1) * 2 - 1, -2, 2),
    portfolio_regime_budget: clamp((portfolioFeatures.regimeBudgetFactor || 1) * 2 - 1, -2, 2),
    portfolio_strategy_budget: clamp((portfolioFeatures.strategyBudgetFactor || 1) * 2 - 1, -2, 2),
    portfolio_daily_budget: clamp((portfolioFeatures.dailyBudgetFactor || 1) * 2 - 1, -2, 2),
    portfolio_cluster_heat: clamp((portfolioFeatures.clusterHeat || 0) * 6, 0, 4),
    portfolio_allocator_score: clamp((portfolioFeatures.allocatorScore || 0.5) * 4 - 2, -2, 2),
    symbol_edge: clamp((symbolStats.avgPnlPct || 0) * 40, -3, 3),
    symbol_win_rate: clamp(((symbolStats.winRate || 0.5) - 0.5) * 6, -3, 3),
    pair_health_score: clamp((pairHealthSummary.score || 0.5) * 4 - 2, -2, 2),
    pair_health_infra: clamp((pairHealthSummary.infraPenalty || 0) * 4, 0, 4),
    pair_quarantined: pairHealthSummary.quarantined ? 1 : 0,
    tf_lower_bias: clamp((timeframeSummary.lowerBias || 0) * 3, -3, 3),
    tf_higher_bias: clamp((timeframeSummary.higherBias || 0) * 3, -3, 3),
    tf_alignment: clamp((timeframeSummary.alignmentScore || 0) * 4 - 2, -2, 2),
    tf_vol_gap: clamp((timeframeSummary.volatilityGapPct || 0) * 100, 0, 4),
    tf_conflict: (timeframeSummary.blockerReasons || []).length ? 1 : 0,
    stablecoin_liquidity: clamp((onChainLiteSummary.liquidityScore || 0) * 3, 0, 3),
    stablecoin_risk_off: clamp((onChainLiteSummary.riskOffScore || 0) * 3, 0, 3),
    stablecoin_stress: clamp((onChainLiteSummary.stressScore || 0) * 3, 0, 3),
    stablecoin_dominance: clamp(((onChainLiteSummary.stablecoinDominancePct || 8) - 8) / 3, -3, 3),
    stablecoin_concentration: clamp(((onChainLiteSummary.stablecoinConcentrationPct || 55) - 55) / 8, -3, 3),
    global_btc_dominance: clamp(((globalMarketContextSummary.btcDominance || 52) - 52) / 6, -3, 3),
    global_stablecoin_dominance: clamp(((globalMarketContextSummary.stablecoinDominance || 8) - 8) / 3, -3, 3),
    global_market_momentum: clamp((globalMarketContextSummary.marketCapChangePercent24h || 0) / 2, -4, 4),
    onchain_breadth: clamp((onChainLiteSummary.marketBreadthScore || 0.5) * 4 - 2, -2, 2),
    onchain_majors_momentum: clamp((onChainLiteSummary.majorsMomentumScore || 0.5) * 4 - 2, -2, 2),
    onchain_alt_liquidity: clamp((onChainLiteSummary.altLiquidityScore || 0.5) * 4 - 2, -2, 2),
    onchain_trending_hype: clamp((onChainLiteSummary.trendingScore || 0) * 3, 0, 3),
    session_asia: sessionSummary.session === "asia" ? 1 : 0,
    session_europe: sessionSummary.session === "europe" ? 1 : 0,
    session_us: sessionSummary.session === "us" ? 1 : 0,
    session_rollover: sessionSummary.session === "rollover" || sessionSummary.session === "late_us" ? 1 : 0,
    is_weekend: sessionSummary.isWeekend ? 1 : 0,
    low_liquidity_session: sessionSummary.lowLiquidity ? 1 : 0,
    funding_window: sessionSummary.inFundingCaution ? 1 : 0,
    session_risk: clamp((sessionSummary.riskScore || 0) * 3, 0, 3),
    ...regimeFlags(regimeSummary.regime),
    ...strategyFlags(strategySummary),
    hour_sin: Math.sin(cycle),
    hour_cos: Math.cos(cycle)
  };
}

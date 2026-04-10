import { clamp, sigmoid } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

const PRIOR_BIAS = -0.12;
const FEATURE_GROUP_DAMPING = [
  {
    composite: "trend_quality_composite",
    strength: 0.34,
    members: [
      "momentum_20",
      "ema_gap",
      "ema_trend_score",
      "ema_trend_slope",
      "trend_strength",
      "trend_quality",
      "trend_persistence",
      "adx_strength",
      "dmi_spread",
      "supertrend_bias"
    ]
  },
  {
    composite: "breakout_quality_composite",
    strength: 0.3,
    members: [
      "breakout_pct",
      "donchian_breakout",
      "donchian_position",
      "structure_break",
      "breakout_follow_through",
      "squeeze_release",
      "keltner_squeeze",
      "bollinger_squeeze",
      "volume_z"
    ]
  },
  {
    composite: "execution_quality_composite",
    strength: 0.26,
    members: [
      "book_pressure",
      "orderbook_signal",
      "weighted_depth_imbalance",
      "microprice_edge",
      "queue_imbalance",
      "queue_refresh",
      "replenishment_quality",
      "book_resilience",
      "depth_confidence"
    ]
  }
];
const PRIOR_WEIGHTS = {
  momentum_5: 0.38,
  momentum_20: 0.32,
  ema_gap: 0.24,
  ema_trend_score: 0.18,
  ema_trend_slope: 0.16,
  rsi_centered: 0.14,
  adx_strength: 0.15,
  dmi_spread: 0.12,
  trend_quality: 0.14,
  trend_quality_composite: 0.22,
  supertrend_bias: 0.13,
  supertrend_flip: 0.05,
  stoch_rsi: 0.05,
  stoch_cross: 0.08,
  mfi_centered: 0.08,
  cmf: 0.1,
  macd_hist: 0.26,
  atr_pct: -0.18,
  atr_expansion: 0.08,
  realized_vol: -0.22,
  downside_vol_dominance: -0.16,
  volume_z: 0.12,
  breakout_pct: 0.18,
  breakout_quality_composite: 0.2,
  donchian_breakout: 0.16,
  donchian_position: 0.1,
  donchian_width: -0.06,
  trend_strength: 0.14,
  vwap_gap: 0.17,
  vwap_slope: 0.14,
  obv_slope: 0.15,
  range_compression: 0.12,
  bollinger_squeeze: 0.11,
  bollinger_position: 0.08,
  price_zscore: -0.06,
  keltner_width: -0.04,
  keltner_squeeze: 0.09,
  squeeze_release: 0.12,
  candle_body: 0.08,
  wick_skew: 0.1,
  close_location: 0.12,
  trend_persistence: 0.16,
  liquidity_sweep: 0.09,
  structure_break: 0.12,
  bullish_pattern: 0.16,
  bearish_pattern: -0.18,
  inside_bar: 0.05,
  spread_bps: -0.28,
  venue_divergence: -0.16,
  depth_imbalance: 0.17,
  weighted_depth_imbalance: 0.16,
  microprice_edge: 0.14,
  book_pressure: 0.18,
  wall_imbalance: 0.09,
  orderbook_signal: 0.16,
  queue_imbalance: 0.12,
  queue_refresh: 0.1,
  replenishment_quality: 0.09,
  book_resilience: 0.08,
  depth_confidence: 0.06,
  execution_quality_composite: 0.18,
  bid_concentration_delta: 0.08,
  data_confidence: 0.08,
  feature_completeness: 0.1,
  news_sentiment: 0.3,
  news_confidence: 0.08,
  news_risk: -0.35,
  news_freshness: 0.12,
  news_diversity: 0.09,
  social_sentiment: 0.1,
  social_risk: -0.12,
  social_coverage: 0.06,
  source_operational_reliability: 0.08,
  announcement_sentiment: 0.18,
  announcement_risk: -0.26,
  announcement_freshness: 0.06,
  official_notice_severity: -0.18,
  symbol_edge: 0.16,
  symbol_win_rate: 0.1,
  relative_strength_composite: 0.18,
  acceptance_quality: 0.16,
  anchored_vwap_acceptance: 0.1,
  anchored_vwap_rejection: -0.12,
  close_location_quality: 0.1,
  volume_acceptance: 0.1,
  trend_failure: -0.14,
  event_bullish: 0.18,
  event_bearish: -0.24,
  event_risk: -0.28,
  funding_rate: -0.12,
  funding_extreme: -0.08,
  funding_reversion_edge: 0.12,
  basis_bps: -0.08,
  open_interest_change: -0.05,
  open_interest_breakout: 0.14,
  taker_bias: 0.1,
  crowding_bias: -0.14,
  market_structure_risk: -0.22,
  market_structure_signal: 0.14,
  liquidation_imbalance: 0.11,
  liquidation_intensity: -0.08,
  calendar_risk: -0.24,
  calendar_bullish: 0.08,
  calendar_bearish: -0.12,
  calendar_proximity: -0.08,
  trade_flow: 0.16,
  micro_trend: 0.12,
  portfolio_heat: -0.16,
  correlation_pressure: -0.18,
  portfolio_family_budget: 0.08,
  portfolio_regime_budget: 0.06,
  pair_health_score: 0.1,
  pair_health_infra: -0.12,
  pair_quarantined: -0.18,
  tf_lower_bias: 0.08,
  tf_higher_bias: 0.12,
  tf_alignment: 0.12,
  tf_vol_gap: -0.06,
  tf_conflict: -0.14,
  stablecoin_liquidity: 0.08,
  stablecoin_risk_off: -0.06,
  stablecoin_stress: -0.1,
  stablecoin_dominance: -0.04,
  regime_trend: 0.08,
  regime_range: -0.03,
  regime_breakout: 0.06,
  regime_high_vol: -0.12,
  regime_event_risk: -0.18,
  strategy_family_breakout: 0.08,
  strategy_family_mean_reversion: 0.04,
  strategy_family_trend_following: 0.07,
  strategy_family_market_structure: 0.06,
  strategy_family_derivatives: 0.05,
  strategy_family_orderflow: 0.06,
  strategy_ema_trend: 0.08,
  strategy_donchian_breakout: 0.09,
  strategy_vwap_trend: 0.08,
  strategy_bollinger_squeeze: 0.08,
  strategy_atr_breakout: 0.07,
  strategy_vwap_reversion: 0.05,
  strategy_zscore_reversion: 0.05,
  strategy_liquidity_sweep: 0.07,
  strategy_market_structure_break: 0.08,
  strategy_funding_rate_extreme: 0.05,
  strategy_open_interest_breakout: 0.08,
  strategy_orderbook_imbalance: 0.08,
  strategy_fit: 0.11,
  strategy_confidence: 0.08,
  strategy_agreement: 0.05,
  strategy_optimizer_bias: 0.07,
  session_asia: -0.01,
  session_europe: 0.03,
  session_us: 0.04,
  session_rollover: -0.05,
  is_weekend: -0.08,
  low_liquidity_session: -0.12,
  funding_window: -0.06,
  session_risk: -0.12,
  hour_sin: 0.04,
  hour_cos: 0.04
};

const MONOTONIC_WEIGHT_BOUNDS = {
  trend_strength: { min: PRIOR_WEIGHTS.trend_strength * 0.25 },
  data_confidence: { min: PRIOR_WEIGHTS.data_confidence * 0.25 },
  feature_completeness: { min: PRIOR_WEIGHTS.feature_completeness * 0.25 },
  acceptance_quality: { min: PRIOR_WEIGHTS.acceptance_quality * 0.25 },
  anchored_vwap_acceptance: { min: PRIOR_WEIGHTS.anchored_vwap_acceptance * 0.25 },
  close_location_quality: { min: PRIOR_WEIGHTS.close_location_quality * 0.25 },
  volume_acceptance: { min: PRIOR_WEIGHTS.volume_acceptance * 0.25 },
  execution_quality_composite: { min: PRIOR_WEIGHTS.execution_quality_composite * 0.25 },
  pair_health_score: { min: PRIOR_WEIGHTS.pair_health_score * 0.25 },
  spread_bps: { max: PRIOR_WEIGHTS.spread_bps * 0.25 },
  venue_divergence: { max: PRIOR_WEIGHTS.venue_divergence * 0.25 }
};

function defaultSymbolStats() {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    avgPnlPct: 0,
    avgLabelScore: 0.5,
    winRate: 0.5,
    lastExitAt: null,
    lastPnlPct: 0
  };
}

function copyState(state) {
  return {
    bias: state?.bias ?? 0,
    weights: { ...(state?.weights || {}) },
    featureStats: { ...(state?.featureStats || {}) },
    symbolStats: { ...(state?.symbolStats || {}) }
  };
}

function enforceMonotonicWeights(weights = {}) {
  for (const [name, bounds] of Object.entries(MONOTONIC_WEIGHT_BOUNDS)) {
    const fallback = Number.isFinite(PRIOR_WEIGHTS[name]) ? PRIOR_WEIGHTS[name] : 0;
    let value = Number.isFinite(weights[name]) ? weights[name] : fallback;
    if (Number.isFinite(bounds.min)) {
      value = Math.max(value, bounds.min);
    }
    if (Number.isFinite(bounds.max)) {
      value = Math.min(value, bounds.max);
    }
    weights[name] = value;
  }
  return weights;
}

function prepareFeatureSet(rawFeatures = {}) {
  const prepared = { ...(rawFeatures || {}) };
  for (const group of FEATURE_GROUP_DAMPING) {
    const compositeValue = Number.isFinite(prepared[group.composite]) ? prepared[group.composite] : 0;
    if (!compositeValue) {
      continue;
    }
    const damping = clamp((Math.abs(compositeValue) / 3) * group.strength, 0, group.strength);
    for (const member of group.members) {
      if (!Number.isFinite(prepared[member])) {
        continue;
      }
      prepared[member] *= (1 - damping);
    }
  }
  return prepared;
}

export class OnlineTradingModel {
  constructor(state, config) {
    this.state = copyState(state);
    this.config = config;
    this.seedPriors();
    enforceMonotonicWeights(this.state.weights);
  }

  static bootstrapState(state) {
    return copyState(state);
  }

  seedPriors() {
    if (Object.keys(this.state.weights).length > 0) {
      return;
    }
    this.state.bias = PRIOR_BIAS;
    this.state.weights = { ...PRIOR_WEIGHTS };
    enforceMonotonicWeights(this.state.weights);
  }

  getState() {
    return this.state;
  }

  getSymbolStats(symbol) {
    if (!this.state.symbolStats[symbol]) {
      this.state.symbolStats[symbol] = defaultSymbolStats();
    }
    return this.state.symbolStats[symbol];
  }

  getFeatureStat(name) {
    if (!this.state.featureStats[name]) {
      this.state.featureStats[name] = { count: 0, mean: 0, m2: 0 };
    }
    return this.state.featureStats[name];
  }

  normalizeFeature(name, value) {
    const safeValue = Number.isFinite(value) ? value : 0;
    const stat = this.getFeatureStat(name);
    if (stat.count < 8) {
      return clamp(safeValue, -4, 4);
    }
    const variance = stat.count > 1 ? stat.m2 / (stat.count - 1) : 0;
    const std = Math.sqrt(variance) || 1;
    return clamp((safeValue - stat.mean) / std, -4, 4);
  }

  updateFeatureStat(name, value) {
    const stat = this.getFeatureStat(name);
    stat.count += 1;
    const delta = value - stat.mean;
    stat.mean += delta / stat.count;
    const delta2 = value - stat.mean;
    stat.m2 += delta * delta2;
  }

  assessFeatureDrift(rawFeatures, minCount = this.config.driftMinFeatureStatCount || 20) {
    const effectiveFeatures = prepareFeatureSet(rawFeatures);
    const driftedFeatures = [];
    let totalAbsZ = 0;
    let comparableFeatures = 0;

    for (const [name, rawValue] of Object.entries(effectiveFeatures || {})) {
      const stat = this.state.featureStats[name];
      if (!stat || stat.count < minCount) {
        continue;
      }
      const variance = stat.count > 1 ? stat.m2 / (stat.count - 1) : 0;
      const std = Math.sqrt(variance) || 1;
      const zScore = std ? (rawValue - stat.mean) / std : 0;
      const absZ = Math.abs(zScore);
      comparableFeatures += 1;
      totalAbsZ += Math.min(absZ, 6);
      driftedFeatures.push({
        name,
        rawValue,
        mean: stat.mean,
        std,
        zScore,
        absZ,
        count: stat.count
      });
    }

    driftedFeatures.sort((left, right) => right.absZ - left.absZ);
    return {
      comparableFeatures,
      averageAbsZ: comparableFeatures ? totalAbsZ / comparableFeatures : 0,
      maxAbsZ: driftedFeatures[0]?.absZ || 0,
      driftedFeatures: driftedFeatures.slice(0, 6).map((item) => ({
        name: item.name,
        rawValue: item.rawValue,
        mean: item.mean,
        std: item.std,
        zScore: item.zScore,
        count: item.count
      }))
    };
  }

  score(rawFeatures) {
    const effectiveFeatures = prepareFeatureSet(rawFeatures);
    const preparedFeatures = {};
    const contributions = [];
    let linear = this.state.bias || 0;
    for (const [name, rawValue] of Object.entries(effectiveFeatures)) {
      const normalized = this.normalizeFeature(name, rawValue);
      const weight = this.state.weights[name] || 0;
      const contribution = weight * normalized;
      preparedFeatures[name] = normalized;
      linear += contribution;
      contributions.push({ name, weight, rawValue, normalized, contribution });
    }
    contributions.sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));
    const probability = sigmoid(linear);
    const confidence = clamp(Math.abs(probability - 0.5) * 2, 0, 1);
    return {
      probability,
      confidence,
      preparedFeatures,
      rawFeatures: { ...rawFeatures },
      effectiveRawFeatures: effectiveFeatures,
      contributions
    };
  }

  updateFromTrade(trade, overrides = {}) {
    const { symbol, rawFeatures, netPnlPct, exitAt } = trade;
    const prediction = this.score(rawFeatures);
    const target = clamp(trade.labelScore ?? overrides.target ?? (netPnlPct > 0 ? 1 : 0), 0, 1);
    const executionQuality = clamp(trade.executionQualityScore ?? 0.5, 0.1, 1);
    const brokerModeWeight = clamp(trade.brokerModeWeight ?? ((trade.brokerMode || "paper") === "live" ? 1.08 : 0.94), 0.75, 1.2);
    const executionRegretPenalty = clamp(1 - (trade.executionRegretScore ?? 0) * 0.22, 0.72, 1);
    const sampleWeight = clamp(
      (Math.abs(netPnlPct || 0) * 22 + Math.abs(target - 0.5) * 2.2) * executionQuality * brokerModeWeight * executionRegretPenalty,
      0.3,
      safeNumber(this.config.adaptiveLearningMaxSampleWeight, 1.85)
    );
    const learningRate = overrides.learningRate || this.config.modelLearningRate;
    const l2 = overrides.l2 || this.config.modelL2;
    const error = (target - prediction.probability) * sampleWeight;

    this.state.bias += learningRate * error;

    for (const [name, rawValue] of Object.entries(prediction.effectiveRawFeatures || {})) {
      const normalized = prediction.preparedFeatures[name];
      const previousWeight = this.state.weights[name] || 0;
      this.state.weights[name] = previousWeight * (1 - learningRate * l2) + learningRate * error * normalized;
      this.updateFeatureStat(name, rawValue);
    }
    enforceMonotonicWeights(this.state.weights);

    const stats = this.getSymbolStats(symbol);
    stats.trades += 1;
    if (netPnlPct > 0) {
      stats.wins += 1;
    } else {
      stats.losses += 1;
    }
    stats.avgPnlPct += ((netPnlPct || 0) - stats.avgPnlPct) / stats.trades;
    stats.avgLabelScore += (target - stats.avgLabelScore) / stats.trades;
    stats.winRate = stats.trades ? stats.wins / stats.trades : 0.5;
    stats.lastExitAt = exitAt;
    stats.lastPnlPct = netPnlPct || 0;

    return {
      target,
      predictionBeforeUpdate: prediction.probability,
      sampleWeight,
      error
    };
  }
}



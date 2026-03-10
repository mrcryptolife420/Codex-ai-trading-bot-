import { clamp, sigmoid } from "../utils/math.js";

const PRIOR_BIAS = -0.12;
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
  volume_z: 0.12,
  breakout_pct: 0.18,
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
  depth_imbalance: 0.17,
  weighted_depth_imbalance: 0.16,
  microprice_edge: 0.14,
  book_pressure: 0.18,
  wall_imbalance: 0.09,
  orderbook_signal: 0.16,
  queue_imbalance: 0.12,
  queue_refresh: 0.1,
  book_resilience: 0.08,
  depth_confidence: 0.06,
  bid_concentration_delta: 0.08,
  news_sentiment: 0.3,
  news_confidence: 0.08,
  news_risk: -0.35,
  news_freshness: 0.12,
  news_diversity: 0.09,
  social_sentiment: 0.1,
  social_risk: -0.12,
  social_coverage: 0.06,
  announcement_sentiment: 0.18,
  announcement_risk: -0.26,
  announcement_freshness: 0.06,
  official_notice_severity: -0.18,
  symbol_edge: 0.16,
  symbol_win_rate: 0.1,
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

export class OnlineTradingModel {
  constructor(state, config) {
    this.state = copyState(state);
    this.config = config;
    this.seedPriors();
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
    const driftedFeatures = [];
    let totalAbsZ = 0;
    let comparableFeatures = 0;

    for (const [name, rawValue] of Object.entries(rawFeatures || {})) {
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
    const preparedFeatures = {};
    const contributions = [];
    let linear = this.state.bias || 0;
    for (const [name, rawValue] of Object.entries(rawFeatures)) {
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
      contributions
    };
  }

  updateFromTrade(trade, overrides = {}) {
    const { symbol, rawFeatures, netPnlPct, exitAt } = trade;
    const prediction = this.score(rawFeatures);
    const target = clamp(trade.labelScore ?? overrides.target ?? (netPnlPct > 0 ? 1 : 0), 0, 1);
    const executionQuality = clamp(trade.executionQualityScore ?? 0.5, 0.1, 1);
    const sampleWeight = clamp((Math.abs(netPnlPct || 0) * 22 + Math.abs(target - 0.5) * 2.2) * executionQuality, 0.3, 2.75);
    const learningRate = overrides.learningRate || this.config.modelLearningRate;
    const l2 = overrides.l2 || this.config.modelL2;
    const error = (target - prediction.probability) * sampleWeight;

    this.state.bias += learningRate * error;

    for (const [name, rawValue] of Object.entries(rawFeatures)) {
      const normalized = prediction.preparedFeatures[name];
      const previousWeight = this.state.weights[name] || 0;
      this.state.weights[name] = previousWeight * (1 - learningRate * l2) + learningRate * error * normalized;
      this.updateFeatureStat(name, rawValue);
    }

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

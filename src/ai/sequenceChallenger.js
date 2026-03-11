import { clamp } from "../utils/math.js";
import { TinyNeuralNetwork } from "./tinyNeuralNetwork.js";

const FEATURE_NAMES = [
  "seq_return_short",
  "seq_return_medium",
  "seq_return_full",
  "seq_acceleration",
  "seq_realized_vol",
  "seq_range_expansion",
  "seq_volume_trend",
  "seq_close_location_mean",
  "seq_wick_skew_mean",
  "seq_trend_persistence",
  "seq_breakout_pressure",
  "seq_book_pressure",
  "seq_tf_alignment"
];

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function safeRatio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function average(values = []) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function buildCandleFeatures(candles = [], bookPressure = 0, breakoutPct = 0, tfAlignment = 0.5) {
  const recent = [...(candles || [])].slice(-24);
  if (!recent.length) {
    return {
      seq_return_short: 0,
      seq_return_medium: 0,
      seq_return_full: 0,
      seq_acceleration: 0,
      seq_realized_vol: 0,
      seq_range_expansion: 0,
      seq_volume_trend: 0,
      seq_close_location_mean: 0.5,
      seq_wick_skew_mean: 0,
      seq_trend_persistence: 0,
      seq_breakout_pressure: safeNumber(breakoutPct) * 10,
      seq_book_pressure: safeNumber(bookPressure),
      seq_tf_alignment: safeNumber(tfAlignment, 0.5)
    };
  }
  const closes = recent.map((candle) => safeNumber(candle.close));
  const opens = recent.map((candle) => safeNumber(candle.open, closes[0] || 0));
  const highs = recent.map((candle) => safeNumber(candle.high, closes[0] || 0));
  const lows = recent.map((candle) => safeNumber(candle.low, closes[0] || 0));
  const volumes = recent.map((candle) => safeNumber(candle.volume));
  const returns = closes.slice(1).map((close, index) => safeRatio(close - closes[index], closes[index] || close || 1));
  const bodyDirections = closes.map((close, index) => Math.sign(close - opens[index]));
  const closeLocations = closes.map((close, index) => safeRatio(close - lows[index], Math.max(highs[index] - lows[index], 1e-9)));
  const wickSkews = closes.map((close, index) => {
    const upper = highs[index] - Math.max(opens[index], close);
    const lower = Math.min(opens[index], close) - lows[index];
    return safeRatio(lower - upper, Math.max(highs[index] - lows[index], 1e-9));
  });
  const shortBase = closes[Math.max(0, closes.length - 4)] || closes[0] || 1;
  const mediumBase = closes[Math.max(0, closes.length - 9)] || closes[0] || 1;
  const fullBase = closes[0] || 1;
  const realizedVol = Math.sqrt(average(returns.map((value) => value * value)));
  const rangeValues = highs.map((high, index) => safeRatio(high - lows[index], closes[index] || high || 1));
  const halfPoint = Math.max(1, Math.floor(rangeValues.length / 2));
  const earlyRange = average(rangeValues.slice(0, halfPoint));
  const lateRange = average(rangeValues.slice(-halfPoint));
  return {
    seq_return_short: safeRatio(closes[closes.length - 1] - shortBase, shortBase),
    seq_return_medium: safeRatio(closes[closes.length - 1] - mediumBase, mediumBase),
    seq_return_full: safeRatio(closes[closes.length - 1] - fullBase, fullBase),
    seq_acceleration: average(returns.slice(-4)) - average(returns.slice(0, Math.max(returns.length - 4, 1))),
    seq_realized_vol: realizedVol,
    seq_range_expansion: lateRange - earlyRange,
    seq_volume_trend: average(volumes.slice(-6)) - average(volumes.slice(0, Math.max(volumes.length - 6, 1))),
    seq_close_location_mean: average(closeLocations),
    seq_wick_skew_mean: average(wickSkews),
    seq_trend_persistence: safeRatio(bodyDirections.filter((direction) => direction === Math.sign(bodyDirections.reduce((total, value) => total + value, 0))).length, Math.max(bodyDirections.length, 1)),
    seq_breakout_pressure: safeNumber(breakoutPct) * 12,
    seq_book_pressure: safeNumber(bookPressure),
    seq_tf_alignment: safeNumber(tfAlignment, 0.5)
  };
}

export class SequenceChallenger {
  static bootstrapState() {
    return TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 8);
  }

  constructor(state, config) {
    this.config = config;
    this.network = new TinyNeuralNetwork(state, {
      featureNames: FEATURE_NAMES,
      hiddenSize: 8,
      learningRate: config.sequenceChallengerLearningRate || 0.024,
      l2: config.sequenceChallengerL2 || 0.00045,
      name: "sequence_challenger"
    });
  }

  getState() {
    return this.network.getState();
  }

  buildInputs({ marketSnapshot = {}, timeframeEncoding = {} } = {}) {
    return buildCandleFeatures(
      marketSnapshot.candles || [],
      marketSnapshot.book?.bookPressure || 0,
      marketSnapshot.market?.breakoutPct || 0,
      timeframeEncoding.alignmentScore || 0.5
    );
  }

  score(context = {}) {
    const inputs = this.buildInputs(context);
    const prediction = this.network.predict(inputs);
    return {
      probability: num(prediction.probability),
      confidence: num(prediction.confidence),
      inputs,
      drivers: prediction.contributions.map((item) => ({
        name: item.name,
        contribution: num(item.contribution),
        rawValue: num(item.rawValue)
      })),
      sampleCount: prediction.sampleCount
    };
  }

  updateFromTrade(trade, label) {
    const inputs = trade.entryRationale?.sequence?.inputs || buildCandleFeatures(
      trade.entryRationale?.candleContext || [],
      trade.entryRationale?.orderBook?.bookPressure || 0,
      trade.rawFeatures?.breakout_pct || 0,
      trade.entryRationale?.timeframe?.alignmentScore || 0.5
    );
    const target = clamp(
      safeNumber(label?.labelScore, trade.labelScore ?? 0.5) * 0.72 +
        Math.max(0, safeNumber(trade.mfePct)) * 5.5 * 0.18 +
        Math.max(0, safeNumber(trade.netPnlPct)) * 6 * 0.1,
      0,
      1
    );
    const learning = this.network.update(inputs, target, {
      sampleWeight: clamp(0.82 + safeNumber(trade.captureEfficiency, 0.5), 0.35, 1.7)
    });
    return {
      ...learning,
      target: num(target),
      inputs
    };
  }
}

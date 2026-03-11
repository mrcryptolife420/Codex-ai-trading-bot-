import { clamp, sigmoid } from "../utils/math.js";

const REGIMES = ["trend", "range", "breakout", "high_vol", "event_risk"];
const HEADS = ["trend", "breakout", "orderflow", "event"];
const HORIZONS = [1, 3, 6];

function sum(values = []) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values = [], fallback = 0) {
  return values.length ? sum(values) / values.length : fallback;
}

function safeValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function softmax(values = []) {
  if (!values.length) {
    return [];
  }
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const total = sum(exps) || 1;
  return exps.map((value) => value / total);
}

function buildDefaultState() {
  return {
    version: 1,
    regimeBiases: Object.fromEntries(REGIMES.map((regime) => [regime, 0])),
    headWeights: Object.fromEntries(
      REGIMES.map((regime) => [regime, {
        trend: regime === "trend" ? 1.08 : 0.9,
        breakout: regime === "breakout" ? 1.1 : 0.84,
        orderflow: regime === "high_vol" ? 1.03 : 0.88,
        event: regime === "event_risk" ? 1.12 : 0.8
      }])
    ),
    horizonWeights: {
      h1: 0.34,
      h3: 0.41,
      h6: 0.25
    },
    metrics: {
      observations: 0,
      shadowMetrics: [],
      lastUpdatedAt: null
    }
  };
}

function normalizeState(state) {
  const base = buildDefaultState();
  return {
    version: 1,
    regimeBiases: Object.fromEntries(
      REGIMES.map((regime) => [regime, safeValue(state?.regimeBiases?.[regime])])
    ),
    headWeights: Object.fromEntries(
      REGIMES.map((regime) => [regime, {
        trend: safeValue(state?.headWeights?.[regime]?.trend) || base.headWeights[regime].trend,
        breakout: safeValue(state?.headWeights?.[regime]?.breakout) || base.headWeights[regime].breakout,
        orderflow: safeValue(state?.headWeights?.[regime]?.orderflow) || base.headWeights[regime].orderflow,
        event: safeValue(state?.headWeights?.[regime]?.event) || base.headWeights[regime].event
      }])
    ),
    horizonWeights: {
      h1: safeValue(state?.horizonWeights?.h1) || base.horizonWeights.h1,
      h3: safeValue(state?.horizonWeights?.h3) || base.horizonWeights.h3,
      h6: safeValue(state?.horizonWeights?.h6) || base.horizonWeights.h6
    },
    metrics: {
      observations: safeValue(state?.metrics?.observations),
      shadowMetrics: Array.isArray(state?.metrics?.shadowMetrics)
        ? [...state.metrics.shadowMetrics].slice(-120)
        : [],
      lastUpdatedAt: state?.metrics?.lastUpdatedAt || null
    }
  };
}

function buildCandleTokens(candles = [], maxTokens = 24) {
  const relevant = Array.isArray(candles) ? candles.slice(-(maxTokens + 1)) : [];
  if (relevant.length < 2) {
    return [];
  }
  const tokens = [];
  for (let index = 1; index < relevant.length; index += 1) {
    const candle = relevant[index];
    const previous = relevant[index - 1];
    const previousClose = safeValue(previous.close) || safeValue(candle.open) || 1;
    const candleRange = Math.max(safeValue(candle.high) - safeValue(candle.low), previousClose * 0.0001);
    const body = safeValue(candle.close) - safeValue(candle.open);
    const upperWick = safeValue(candle.high) - Math.max(safeValue(candle.open), safeValue(candle.close));
    const lowerWick = Math.min(safeValue(candle.open), safeValue(candle.close)) - safeValue(candle.low);
    tokens.push({
      offset: relevant.length - 1 - index,
      close: safeValue(candle.close),
      returnPct: (safeValue(candle.close) - previousClose) / previousClose,
      bodyRatio: clamp(body / candleRange, -2, 2),
      rangePct: candleRange / previousClose,
      wickBias: clamp((lowerWick - upperWick) / candleRange, -2, 2),
      volumeZ: clamp((safeValue(candle.volume) - average(relevant.map((item) => safeValue(item.volume)), safeValue(candle.volume))) / Math.max(average(relevant.map((item) => safeValue(item.volume)), 1), 1), -3, 3),
      closeLocation: clamp((safeValue(candle.close) - safeValue(candle.low)) / candleRange, 0, 1)
    });
  }
  return tokens;
}

function tokenScore(head, token, query) {
  if (head === "trend") {
    return query.trend * token.returnPct * 34 + token.bodyRatio * 0.42 + token.closeLocation * 0.16 - token.rangePct * 5.4;
  }
  if (head === "breakout") {
    return query.breakout * (token.rangePct * 28 + token.volumeZ * 0.34 + token.closeLocation * 0.18) + token.returnPct * 7.5;
  }
  if (head === "orderflow") {
    return query.orderflow * token.closeLocation * 1.6 + token.returnPct * 11 + token.wickBias * 0.28 - token.rangePct * 2.3;
  }
  return query.event * (token.returnPct * 14 + token.bodyRatio * 0.2) + token.volumeZ * 0.18;
}

function normalizeHeadScores(headScores = {}) {
  const entries = HEADS.map((head) => [head, clamp(safeValue(headScores[head]), -1.5, 1.5)]);
  return Object.fromEntries(entries);
}

function buildHeadDrivers(headScores = {}) {
  return HEADS
    .map((head) => ({
      head,
      score: clamp(safeValue(headScores[head]), -1.5, 1.5),
      direction: safeValue(headScores[head]) >= 0 ? "bullish" : "bearish"
    }))
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score));
}

function buildAttentionSummary(tokens = [], weights = [], limit = 3) {
  return tokens
    .map((token, index) => ({
      offset: token.offset,
      weight: clamp(safeValue(weights[index]), 0, 1),
      close: token.close,
      returnPct: token.returnPct,
      closeLocation: token.closeLocation
    }))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, limit);
}

export class TransformerChallenger {
  constructor(state, config) {
    this.state = normalizeState(state);
    this.config = config;
  }

  static bootstrapState(state) {
    return normalizeState(state);
  }

  getState() {
    return this.state;
  }

  buildQuery(rawFeatures = {}, context = {}) {
    const market = context.marketFeatures || context.marketSnapshot?.market || {};
    const book = context.bookFeatures || context.marketSnapshot?.book || {};
    const news = context.newsSummary || {};
    const structure = context.marketStructureSummary || {};
    const calendar = context.calendarSummary || {};
    const stream = context.streamFeatures || context.marketSnapshot?.stream || {};
    return {
      trend:
        safeValue(rawFeatures.momentum_20) * 0.28 +
        safeValue(rawFeatures.ema_gap) * 0.24 +
        safeValue(rawFeatures.trend_persistence) * 0.18 +
        safeValue(market.momentum20) * 9 +
        safeValue(market.emaGap) * 18,
      breakout:
        safeValue(rawFeatures.breakout_pct) * 0.25 +
        safeValue(rawFeatures.range_compression) * 0.18 +
        safeValue(rawFeatures.volume_z) * 0.08 +
        safeValue(rawFeatures.trade_flow) * 0.09 +
        safeValue(market.breakoutPct) * 16,
      orderflow:
        safeValue(rawFeatures.book_pressure) * 0.26 +
        safeValue(rawFeatures.weighted_depth_imbalance) * 0.18 +
        safeValue(rawFeatures.microprice_edge) * 0.14 +
        safeValue(book.bookPressure) * 0.9 +
        safeValue(stream.tradeFlowImbalance) * 0.65,
      event:
        safeValue(rawFeatures.news_sentiment) * 0.16 +
        safeValue(rawFeatures.social_sentiment) * 0.12 +
        safeValue(rawFeatures.market_structure_signal) * 0.08 +
        safeValue(rawFeatures.calendar_bullish) * 0.07 -
        safeValue(rawFeatures.news_risk) * 0.14 -
        safeValue(rawFeatures.event_risk) * 0.12 -
        safeValue(rawFeatures.calendar_risk) * 0.08 +
        safeValue(news.sentimentScore) * 1.1 -
        safeValue(news.riskScore) * 0.8 +
        safeValue(structure.signalScore) * 0.6 -
        safeValue(structure.riskScore) * 0.45 -
        safeValue(calendar.riskScore) * 0.4
    };
  }

  score({ rawFeatures = {}, context = {} } = {}) {
    const regime = context.regimeSummary?.regime || "range";
    const tokens = buildCandleTokens(context.marketSnapshot?.candles || [], this.config.transformerLookbackCandles || 24);
    const query = this.buildQuery(rawFeatures, context);
    const regimeBias = safeValue(this.state.regimeBiases[regime]);
    const regimeWeights = this.state.headWeights[regime] || this.state.headWeights.range;

    const attentionByHead = {};
    const headScores = {};
    for (const head of HEADS) {
      if (!tokens.length) {
        attentionByHead[head] = [];
        headScores[head] = clamp(query[head] * 0.18, -1.5, 1.5);
        continue;
      }
      const compatScores = tokens.map((token) => tokenScore(head, token, query));
      const weights = softmax(compatScores.map((value) => value * (head === "event" ? 0.9 : 1.15)));
      attentionByHead[head] = buildAttentionSummary(tokens, weights);
      const weightedSignal = tokens.reduce((total, token, index) => total + compatScores[index] * weights[index], 0);
      headScores[head] = clamp(weightedSignal * 0.33 + query[head] * 0.14, -1.5, 1.5);
    }

    const normalizedHeadScores = normalizeHeadScores(headScores);
    const horizonWeights = this.state.horizonWeights;
    const horizonSignals = {
      h1:
        normalizedHeadScores.orderflow * regimeWeights.orderflow * 0.48 +
        normalizedHeadScores.breakout * regimeWeights.breakout * 0.16 +
        normalizedHeadScores.event * regimeWeights.event * 0.14 +
        safeValue(rawFeatures.micro_trend) * 0.05 +
        safeValue(rawFeatures.book_pressure) * 0.08 +
        regimeBias,
      h3:
        normalizedHeadScores.trend * regimeWeights.trend * 0.34 +
        normalizedHeadScores.orderflow * regimeWeights.orderflow * 0.18 +
        normalizedHeadScores.breakout * regimeWeights.breakout * 0.2 +
        normalizedHeadScores.event * regimeWeights.event * 0.12 +
        safeValue(rawFeatures.momentum_20) * 0.07 +
        regimeBias,
      h6:
        normalizedHeadScores.trend * regimeWeights.trend * 0.3 +
        normalizedHeadScores.event * regimeWeights.event * 0.22 +
        normalizedHeadScores.breakout * regimeWeights.breakout * 0.15 +
        normalizedHeadScores.orderflow * regimeWeights.orderflow * 0.08 +
        safeValue(rawFeatures.symbol_edge) * 0.06 +
        regimeBias
    };

    const horizonProbabilities = {
      h1: sigmoid(horizonSignals.h1),
      h3: sigmoid(horizonSignals.h3),
      h6: sigmoid(horizonSignals.h6)
    };
    const rawProbability =
      horizonProbabilities.h1 * horizonWeights.h1 +
      horizonProbabilities.h3 * horizonWeights.h3 +
      horizonProbabilities.h6 * horizonWeights.h6;
    const consensusSpread = Math.max(...Object.values(horizonProbabilities)) - Math.min(...Object.values(horizonProbabilities));
    const attentionStrength = average(
      Object.values(attentionByHead)
        .flat()
        .slice(0, 6)
        .map((item) => item.weight),
      0.33
    );
    const confidence = clamp((Math.abs(rawProbability - 0.5) * 2) * (0.55 + attentionStrength * 0.6) * (1 - consensusSpread * 0.35), 0, 1);
    const dominantHead = buildHeadDrivers(normalizedHeadScores)[0]?.head || "trend";
    const drivers = buildHeadDrivers(normalizedHeadScores).map((item) => ({
      name: item.head,
      score: item.score,
      direction: item.direction
    }));

    return {
      regime,
      probability: clamp(rawProbability, 0, 1),
      confidence,
      dominantHead,
      headScores: normalizedHeadScores,
      attention: attentionByHead[dominantHead] || [],
      horizons: HORIZONS.map((horizon) => ({
        horizon,
        probability: horizonProbabilities[`h${horizon}`],
        signal: horizonSignals[`h${horizon}`]
      })),
      drivers,
      query
    };
  }

  updateFromTrade(trade, labelScore) {
    const transformerDecision = trade.transformerDecision || trade.entryRationale?.transformer;
    if (!transformerDecision) {
      return null;
    }

    const regime = trade.regimeAtEntry || transformerDecision.regime || "range";
    const target = clamp(safeValue(labelScore), 0, 1);
    const probability = clamp(safeValue(transformerDecision.probability), 0, 1);
    const error = target - probability;
    const learningRate = this.config.transformerLearningRate || 0.03;
    this.state.regimeBiases[regime] = clamp(this.state.regimeBiases[regime] + error * learningRate * 0.45, -1.25, 1.25);

    const regimeWeights = this.state.headWeights[regime] || this.state.headWeights.range;
    const headScores = transformerDecision.headScores || {};
    for (const head of HEADS) {
      const current = regimeWeights[head] || 0.85;
      regimeWeights[head] = clamp(current + error * clamp(safeValue(headScores[head]), -1, 1) * learningRate * 0.28, 0.35, 1.55);
    }

    const horizons = transformerDecision.horizons || [];
    if (horizons.length) {
      const adjustments = {
        h1: 0,
        h3: 0,
        h6: 0
      };
      for (const horizon of horizons) {
        const key = `h${horizon.horizon}`;
        adjustments[key] = Math.abs(target - clamp(safeValue(horizon.probability), 0, 1));
      }
      const score1 = 1 - adjustments.h1;
      const score3 = 1 - adjustments.h3;
      const score6 = 1 - adjustments.h6;
      const total = Math.max(score1 + score3 + score6, 1e-9);
      this.state.horizonWeights = {
        h1: clamp(this.state.horizonWeights.h1 * (1 - learningRate) + (score1 / total) * learningRate, 0.15, 0.5),
        h3: clamp(this.state.horizonWeights.h3 * (1 - learningRate) + (score3 / total) * learningRate, 0.2, 0.55),
        h6: clamp(this.state.horizonWeights.h6 * (1 - learningRate) + (score6 / total) * learningRate, 0.1, 0.4)
      };
    }

    this.state.metrics.observations += 1;
    this.state.metrics.lastUpdatedAt = trade.exitAt || new Date().toISOString();
    this.state.metrics.shadowMetrics.push({
      at: this.state.metrics.lastUpdatedAt,
      regime,
      error: Math.abs(error),
      target,
      probability
    });
    if (this.state.metrics.shadowMetrics.length > 120) {
      this.state.metrics.shadowMetrics = this.state.metrics.shadowMetrics.slice(-120);
    }

    return {
      target,
      probability,
      absoluteError: Math.abs(error)
    };
  }

  getSummary() {
    const recent = this.state.metrics.shadowMetrics.slice(-40);
    const avgError = recent.length ? average(recent.map((item) => safeValue(item.error))) : null;
    return {
      observations: this.state.metrics.observations,
      lastUpdatedAt: this.state.metrics.lastUpdatedAt,
      averageError: avgError,
      horizonWeights: { ...this.state.horizonWeights },
      regimeBiases: { ...this.state.regimeBiases },
      recentErrorCount: recent.length
    };
  }

  getWeightView() {
    return REGIMES.flatMap((regime) =>
      HEADS.map((head) => ({
        name: `transformer:${regime}:${head}`,
        weight: clamp(safeValue(this.state.headWeights[regime]?.[head]), -2, 2)
      }))
    );
  }
}

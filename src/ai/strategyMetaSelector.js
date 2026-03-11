import { clamp } from "../utils/math.js";
import { TinyNeuralNetwork } from "./tinyNeuralNetwork.js";

const FAMILY_IDS = ["trend_following", "breakout", "mean_reversion", "market_structure", "orderflow", "derivatives"];
const EXECUTION_IDS = ["market", "limit_maker", "pegged_limit_maker"];
const FEATURE_NAMES = [
  "probability",
  "confidence",
  "strategy_fit",
  "alignment",
  "agreement_gap",
  "book_pressure",
  "spread_bps",
  "depth_confidence",
  "queue_imbalance",
  "realized_vol",
  "trend_strength",
  "breakout_pct",
  "mean_reversion_bias",
  "news_risk",
  "market_structure_risk",
  "pair_health",
  "regime_confidence"
];

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function buildInputs(context = {}) {
  const marketSnapshot = context.marketSnapshot || {};
  const market = marketSnapshot.market || {};
  const book = marketSnapshot.book || {};
  const strategySummary = context.strategySummary || {};
  const timeframeSummary = context.timeframeSummary || {};
  const regimeSummary = context.regimeSummary || {};
  const newsSummary = context.newsSummary || {};
  const marketStructureSummary = context.marketStructureSummary || {};
  const pairHealthSummary = context.pairHealthSummary || {};
  return {
    probability: safeNumber(context.score?.probability, 0.5) * 2 - 1,
    confidence: safeNumber(context.score?.confidence, 0),
    strategy_fit: safeNumber(strategySummary.fitScore, 0),
    alignment: safeNumber(timeframeSummary.alignmentScore, 0),
    agreement_gap: safeNumber(strategySummary.agreementGap, 0),
    book_pressure: safeNumber(book.bookPressure, 0),
    spread_bps: clamp(safeNumber(book.spreadBps, 0) / 25, 0, 2),
    depth_confidence: safeNumber(book.depthConfidence || book.localBook?.depthConfidence, 0),
    queue_imbalance: safeNumber(book.queueImbalance || book.localBook?.queueImbalance, 0),
    realized_vol: clamp(safeNumber(market.realizedVolPct, 0) * 20, 0, 3),
    trend_strength: safeNumber(market.trendStrength || market.emaTrendScore, 0),
    breakout_pct: clamp(safeNumber(market.breakoutPct || market.donchianBreakoutPct, 0) * 40, -2, 2),
    mean_reversion_bias: clamp((50 - safeNumber(market.rsi14, 50)) / 20 + safeNumber(market.priceZScore, 0) * -0.35, -2, 2),
    news_risk: safeNumber(newsSummary.riskScore, 0),
    market_structure_risk: safeNumber(marketStructureSummary.riskScore, 0),
    pair_health: safeNumber(pairHealthSummary.score, 0.5),
    regime_confidence: safeNumber(regimeSummary.confidence, 0)
  };
}

function bootstrapHeads(ids = []) {
  return Object.fromEntries(ids.map((id) => [id, TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6)]));
}

function normalizeState(state = {}) {
  return {
    version: 1,
    familyHeads: Object.fromEntries(FAMILY_IDS.map((id) => [id, state.familyHeads?.[id] || TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6)])),
    executionHeads: Object.fromEntries(EXECUTION_IDS.map((id) => [id, state.executionHeads?.[id] || TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6)])),
    history: Array.isArray(state.history) ? state.history.slice(-20) : []
  };
}

function buildRanked(scores = {}, preferredId = null) {
  return Object.entries(scores)
    .map(([id, value]) => ({ id, probability: num(value.probability || 0), confidence: num(value.confidence || 0) }))
    .sort((left, right) => right.probability - left.probability)
    .map((item) => ({ ...item, preferred: item.id === preferredId }));
}

export class StrategyMetaSelector {
  static bootstrapState() {
    return {
      version: 1,
      familyHeads: bootstrapHeads(FAMILY_IDS),
      executionHeads: bootstrapHeads(EXECUTION_IDS),
      history: []
    };
  }

  constructor(state, config) {
    this.config = config;
    this.state = normalizeState(state);
    this.familyHeads = Object.fromEntries(
      FAMILY_IDS.map((id) => [id, new TinyNeuralNetwork(this.state.familyHeads[id], {
        featureNames: FEATURE_NAMES,
        hiddenSize: 6,
        learningRate: config.strategyMetaLearningRate || 0.022,
        l2: config.strategyMetaL2 || 0.00055,
        name: `strategy_meta_family_${id}`
      })])
    );
    this.executionHeads = Object.fromEntries(
      EXECUTION_IDS.map((id) => [id, new TinyNeuralNetwork(this.state.executionHeads[id], {
        featureNames: FEATURE_NAMES,
        hiddenSize: 6,
        learningRate: config.strategyMetaLearningRate || 0.022,
        l2: config.strategyMetaL2 || 0.00055,
        name: `strategy_meta_execution_${id}`
      })])
    );
  }

  getState() {
    return {
      version: 1,
      familyHeads: Object.fromEntries(FAMILY_IDS.map((id) => [id, this.familyHeads[id].getState()])),
      executionHeads: Object.fromEntries(EXECUTION_IDS.map((id) => [id, this.executionHeads[id].getState()])),
      history: [...this.state.history].slice(-20)
    };
  }

  score(context = {}) {
    const inputs = buildInputs(context);
    const familyScores = Object.fromEntries(FAMILY_IDS.map((id) => [id, this.familyHeads[id].predict(inputs)]));
    const executionScores = Object.fromEntries(EXECUTION_IDS.map((id) => [id, this.executionHeads[id].predict(inputs)]));
    const rankedFamilies = buildRanked(familyScores, context.strategySummary?.family || null);
    const rankedExecution = buildRanked(executionScores, null);
    const preferredFamily = rankedFamilies[0] || { id: context.strategySummary?.family || "trend_following", probability: 0.5, confidence: 0 };
    const activeFamily = context.strategySummary?.family || preferredFamily.id;
    const activeFamilyScore = familyScores[activeFamily] || preferredFamily;
    const preferredExecutionStyle = rankedExecution[0] || { id: "market", probability: 0.5, confidence: 0 };
    const makerProbability = average([
      executionScores.limit_maker?.probability || 0.5,
      executionScores.pegged_limit_maker?.probability || 0.5
    ], 0.5);
    const marketProbability = executionScores.market?.probability || 0.5;
    return {
      preferredFamily: preferredFamily.id,
      preferredExecutionStyle: preferredExecutionStyle.id,
      familyAlignment: num((activeFamilyScore.probability || 0.5) - 0.5),
      fitBoost: num(clamp(((activeFamilyScore.probability || 0.5) - 0.5) * 0.16, -0.08, 0.08)),
      thresholdShift: num(clamp(((activeFamilyScore.probability || 0.5) - 0.5) * -0.03, -0.03, 0.03)),
      makerBias: num(clamp((makerProbability - marketProbability) * 0.24, -0.18, 0.18)),
      sizeMultiplier: num(clamp(0.9 + (activeFamilyScore.probability || 0.5) * 0.16 + (preferredExecutionStyle.confidence || 0) * 0.08, 0.75, 1.15)),
      stopLossMultiplier: num(clamp(1 + (preferredExecutionStyle.id === "market" ? 0.04 : -0.03), 0.88, 1.12)),
      holdMultiplier: num(clamp(1 + ((preferredFamily.id === "trend_following" || preferredFamily.id === "breakout") ? 0.06 : -0.04), 0.84, 1.14)),
      confidence: num(clamp((preferredFamily.confidence || 0) * 0.6 + (preferredExecutionStyle.confidence || 0) * 0.4, 0, 1)),
      families: rankedFamilies.slice(0, 4),
      executionStyles: rankedExecution.slice(0, 3),
      drivers: [...(familyScores[activeFamily]?.contributions || preferredFamily.contributions || [])].slice(0, 4)
    };
  }

  updateFromTrade(trade = {}, label = {}) {
    const context = {
      score: {
        probability: trade.entryRationale?.probability || 0.5,
        confidence: trade.entryRationale?.confidence || 0
      },
      marketSnapshot: {
        market: {
          realizedVolPct: trade.entryRationale?.realizedVolPct || 0,
          trendStrength: trade.entryRationale?.indicators?.trendStrength || 0,
          breakoutPct: trade.rawFeatures?.breakout_pct || 0,
          rsi14: trade.entryRationale?.indicators?.rsi14 || 50,
          priceZScore: trade.rawFeatures?.price_zscore || 0
        },
        book: {
          bookPressure: trade.entryRationale?.orderBook?.bookPressure || 0,
          spreadBps: trade.entryRationale?.orderBook?.spreadBps || 0,
          depthConfidence: trade.entryRationale?.orderBook?.depthConfidence || 0,
          queueImbalance: trade.entryRationale?.orderBook?.queueImbalance || 0
        }
      },
      strategySummary: trade.entryRationale?.strategy || trade.strategyDecision || {},
      timeframeSummary: trade.entryRationale?.timeframe || {},
      regimeSummary: trade.entryRationale?.regimeSummary || { confidence: 0, regime: trade.regimeAtEntry || "range" },
      newsSummary: { riskScore: trade.entryRationale?.newsRisk || 0 },
      marketStructureSummary: trade.entryRationale?.marketStructure || {},
      pairHealthSummary: trade.entryRationale?.pairHealth || {}
    };
    const inputs = buildInputs(context);
    const labelScore = clamp(label.labelScore ?? 0.5, 0, 1);
    const familyId = trade.strategyDecision?.family || trade.entryRationale?.strategy?.family || "trend_following";
    const entryStyle = trade.entryExecutionAttribution?.entryStyle || trade.entryRationale?.executionPlan?.entryStyle || "market";

    for (const id of FAMILY_IDS) {
      this.familyHeads[id].update(inputs, id === familyId ? labelScore : 0.5);
    }
    for (const id of EXECUTION_IDS) {
      const executionTarget = id === entryStyle
        ? clamp(0.4 + labelScore * 0.35 + safeNumber(trade.executionQualityScore, 0) * 0.25, 0, 1)
        : 0.5;
      this.executionHeads[id].update(inputs, executionTarget);
    }

    this.state.history.unshift({
      at: trade.exitAt || new Date().toISOString(),
      familyId,
      entryStyle,
      labelScore: num(labelScore),
      executionQualityScore: num(trade.executionQualityScore || 0)
    });
    this.state.history = this.state.history.slice(0, 20);

    return this.score(context);
  }
}

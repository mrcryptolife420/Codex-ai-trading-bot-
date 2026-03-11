import { clamp } from "../utils/math.js";
import { TinyNeuralNetwork } from "./tinyNeuralNetwork.js";

const FEATURE_NAMES = [
  "model_probability",
  "model_confidence",
  "depth_confidence",
  "queue_imbalance",
  "queue_refresh",
  "resilience",
  "expected_impact_bps",
  "spread_bps",
  "trade_flow",
  "committee_net",
  "strategy_fit",
  "pair_health",
  "timeframe_alignment"
];

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function buildInputs({ score = {}, marketSnapshot = {}, committeeSummary = {}, strategySummary = {}, pairHealthSummary = {}, timeframeSummary = {} } = {}) {
  return {
    model_probability: safeNumber(score.probability),
    model_confidence: safeNumber(score.confidence),
    depth_confidence: safeNumber(marketSnapshot.book?.localBook?.depthConfidence || marketSnapshot.book?.depthConfidence),
    queue_imbalance: safeNumber(marketSnapshot.book?.localBook?.queueImbalance || marketSnapshot.book?.queueImbalance),
    queue_refresh: safeNumber(marketSnapshot.book?.localBook?.queueRefreshScore || marketSnapshot.book?.queueRefreshScore),
    resilience: safeNumber(marketSnapshot.book?.localBook?.resilienceScore || marketSnapshot.book?.resilienceScore),
    expected_impact_bps: safeNumber(marketSnapshot.book?.entryEstimate?.touchSlippageBps || marketSnapshot.book?.entryEstimate?.midSlippageBps),
    spread_bps: safeNumber(marketSnapshot.book?.spreadBps),
    trade_flow: safeNumber(marketSnapshot.book?.tradeFlowImbalance || marketSnapshot.book?.tradeFlow),
    committee_net: safeNumber(committeeSummary.netScore),
    strategy_fit: safeNumber(strategySummary.fitScore),
    pair_health: safeNumber(pairHealthSummary.score, 0.5),
    timeframe_alignment: safeNumber(timeframeSummary.alignmentScore, 0.5)
  };
}

export class ExecutionNeuralAdvisor {
  static bootstrapState() {
    return {
      version: 1,
      maker: TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6),
      patience: TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6),
      sizing: TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6)
    };
  }

  constructor(state, config) {
    this.config = config;
    const normalized = state?.version === 1 ? state : ExecutionNeuralAdvisor.bootstrapState();
    const opts = {
      featureNames: FEATURE_NAMES,
      hiddenSize: 6,
      learningRate: config.executionNeuralLearningRate || 0.02,
      l2: config.executionNeuralL2 || 0.0005
    };
    this.networks = {
      maker: new TinyNeuralNetwork(normalized.maker, { ...opts, name: "execution_maker" }),
      patience: new TinyNeuralNetwork(normalized.patience, { ...opts, name: "execution_patience" }),
      sizing: new TinyNeuralNetwork(normalized.sizing, { ...opts, name: "execution_sizing" })
    };
  }

  getState() {
    return {
      version: 1,
      maker: this.networks.maker.getState(),
      patience: this.networks.patience.getState(),
      sizing: this.networks.sizing.getState()
    };
  }

  score(context = {}) {
    const inputs = buildInputs(context);
    const maker = this.networks.maker.predict(inputs);
    const patience = this.networks.patience.predict(inputs);
    const sizing = this.networks.sizing.predict(inputs);
    const confidence = clamp((maker.confidence + patience.confidence + sizing.confidence) / 3, 0, 1);
    return {
      inputs,
      preferMakerBoost: num((maker.probability - 0.5) * 0.3),
      patienceMultiplier: num(clamp(0.82 + patience.probability * 0.78, 0.72, 1.58)),
      sizeMultiplier: num(clamp(0.84 + sizing.probability * 0.34, 0.72, 1.16)),
      aggressiveness: num(clamp(1.08 - maker.probability * 0.26 + (1 - patience.probability) * 0.18, 0.74, 1.24)),
      confidence: num(confidence),
      drivers: maker.contributions.slice(0, 3).map((item) => ({
        name: item.name,
        contribution: num(item.contribution),
        rawValue: num(item.rawValue)
      }))
    };
  }

  updateFromTrade(trade, label) {
    const attribution = trade.entryExecutionAttribution || {};
    const stored = trade.entryRationale?.executionNeural?.inputs || {};
    const inputs = Object.keys(stored).length
      ? stored
      : buildInputs({
          score: {
            probability: trade.entryRationale?.probability,
            confidence: trade.entryRationale?.confidence
          },
          marketSnapshot: {
            book: {
              localBook: {
                depthConfidence: attribution.depthConfidence,
                queueImbalance: attribution.queueImbalance,
                queueRefreshScore: attribution.queueRefreshScore,
                resilienceScore: attribution.resilienceScore
              },
              entryEstimate: {
                touchSlippageBps: attribution.expectedImpactBps,
                midSlippageBps: attribution.expectedSlippageBps
              },
              spreadBps: trade.entrySpreadBps,
              tradeFlowImbalance: attribution.tradeFlow
            }
          },
          committeeSummary: trade.entryRationale?.committee || {},
          strategySummary: trade.entryRationale?.strategy || {},
          pairHealthSummary: trade.entryRationale?.pairHealth || {},
          timeframeSummary: trade.entryRationale?.timeframe || {}
        });
    const slipPenalty = Math.max(0, safeNumber(attribution.slippageDeltaBps) / 10);
    const quality = safeNumber(trade.executionQualityScore, 0.5);
    const makerTarget = clamp(
      0.36 + quality * 0.34 + safeNumber(attribution.makerFillRatio) * 0.24 - slipPenalty * 0.28 + (String(attribution.entryStyle || "").includes("maker") ? 0.08 : -0.02),
      0,
      1
    );
    const patienceTarget = clamp(0.3 + quality * 0.26 + safeNumber(attribution.workingTimeMs) / 20000 - slipPenalty * 0.18, 0, 1);
    const sizeTarget = clamp(0.34 + safeNumber(label?.labelScore, trade.labelScore ?? 0.5) * 0.32 + quality * 0.2 - slipPenalty * 0.18, 0, 1);
    return {
      maker: this.networks.maker.update(inputs, makerTarget),
      patience: this.networks.patience.update(inputs, patienceTarget),
      sizing: this.networks.sizing.update(inputs, sizeTarget),
      inputs,
      targets: {
        maker: num(makerTarget),
        patience: num(patienceTarget),
        sizing: num(sizeTarget)
      }
    };
  }
}

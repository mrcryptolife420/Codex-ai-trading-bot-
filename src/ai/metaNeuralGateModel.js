import { clamp } from "../utils/math.js";
import { TinyNeuralNetwork } from "./tinyNeuralNetwork.js";

const FEATURE_NAMES = [
  "model_probability",
  "model_confidence",
  "calibration_confidence",
  "transformer_probability",
  "transformer_confidence",
  "sequence_probability",
  "sequence_confidence",
  "committee_net",
  "committee_agreement",
  "strategy_fit",
  "pair_health",
  "timeframe_alignment",
  "source_reliability",
  "depth_confidence",
  "edge_to_threshold",
  "market_signal",
  "market_risk",
  "divergence_risk"
];

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

export function buildMetaNeuralInputs({
  score = {},
  committeeSummary = {},
  strategySummary = {},
  marketSnapshot = {},
  newsSummary = {},
  marketStructureSummary = {},
  pairHealthSummary = {},
  timeframeSummary = {},
  divergenceSummary = {},
  threshold = 0.5
} = {}) {
  return {
    model_probability: safeNumber(score.probability),
    model_confidence: safeNumber(score.confidence),
    calibration_confidence: safeNumber(score.calibrationConfidence),
    transformer_probability: safeNumber(score.transformerProbability || score.transformer?.probability),
    transformer_confidence: safeNumber(score.transformer?.confidence),
    sequence_probability: safeNumber(score.sequence?.probability),
    sequence_confidence: safeNumber(score.sequence?.confidence),
    committee_net: safeNumber(committeeSummary.netScore),
    committee_agreement: safeNumber(committeeSummary.agreement),
    strategy_fit: safeNumber(strategySummary.fitScore),
    pair_health: safeNumber(pairHealthSummary.score, 0.5),
    timeframe_alignment: safeNumber(timeframeSummary.alignmentScore, 0.5),
    source_reliability: safeNumber(newsSummary.reliabilityScore, 0.5),
    depth_confidence: safeNumber(marketSnapshot.book?.depthConfidence || marketSnapshot.book?.localBook?.depthConfidence),
    edge_to_threshold: safeNumber(score.probability) - safeNumber(threshold, 0.5),
    market_signal: safeNumber(marketStructureSummary.signalScore),
    market_risk: safeNumber(marketStructureSummary.riskScore) + safeNumber(newsSummary.riskScore) * 0.4,
    divergence_risk: safeNumber(divergenceSummary.averageScore)
  };
}

export class MetaNeuralGateModel {
  static bootstrapState() {
    return TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 8);
  }

  constructor(state, config) {
    this.config = config;
    this.network = new TinyNeuralNetwork(state, {
      featureNames: FEATURE_NAMES,
      hiddenSize: 8,
      learningRate: config.metaNeuralLearningRate || 0.025,
      l2: config.metaNeuralL2 || 0.00045,
      name: "meta_neural_gate"
    });
  }

  getState() {
    return this.network.getState();
  }

  score(input) {
    const inputs = buildMetaNeuralInputs(input);
    const prediction = this.network.predict(inputs);
    const action = prediction.probability >= 0.58
      ? "pass"
      : prediction.probability >= 0.48
        ? "caution"
        : "block";
    return {
      action,
      probability: num(prediction.probability),
      confidence: num(prediction.confidence),
      inputs,
      contributions: prediction.contributions.map((item) => ({
        ...item,
        contribution: num(item.contribution),
        rawValue: num(item.rawValue)
      })),
      sampleCount: prediction.sampleCount
    };
  }

  updateFromTrade(trade, label) {
    const rationale = trade.entryRationale || {};
    const stored = rationale.metaNeural?.inputs || {};
    const inputs = Object.keys(stored).length
      ? stored
      : buildMetaNeuralInputs({
          score: {
            probability: rationale.probability,
            confidence: rationale.confidence,
            calibrationConfidence: rationale.calibrationConfidence,
            transformerProbability: rationale.transformer?.probability,
            transformer: rationale.transformer || {},
            sequence: rationale.sequence || {}
          },
          committeeSummary: rationale.committee || {},
          strategySummary: rationale.strategy || {},
          marketSnapshot: { book: rationale.orderBook || {} },
          newsSummary: { reliabilityScore: rationale.reliabilityScore, riskScore: rationale.newsRisk },
          marketStructureSummary: rationale.marketStructure || {},
          pairHealthSummary: rationale.pairHealth || {},
          timeframeSummary: rationale.timeframe || {},
          divergenceSummary: rationale.divergence || {},
          threshold: rationale.threshold
        });
    const target = clamp(
      safeNumber(label?.labelScore, trade.labelScore ?? 0.5) * 0.72 +
        safeNumber(trade.executionQualityScore, 0.5) * 0.12 +
        safeNumber(trade.captureEfficiency, 0.5) * 0.12 +
        (safeNumber(trade.netPnlPct) > 0 ? 0.04 : -0.04),
      0,
      1
    );
    const learning = this.network.update(inputs, target, {
      sampleWeight: clamp(0.8 + safeNumber(trade.executionQualityScore, 0.5), 0.35, 1.65)
    });
    return {
      ...learning,
      target: num(target),
      inputs
    };
  }
}

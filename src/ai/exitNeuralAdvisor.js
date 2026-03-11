import { clamp } from "../utils/math.js";
import { TinyNeuralNetwork } from "./tinyNeuralNetwork.js";

const FEATURE_NAMES = [
  "pnl_pct",
  "drawdown_pct",
  "held_minutes_norm",
  "book_pressure",
  "signal_score",
  "risk_score",
  "higher_bias",
  "alignment_score",
  "onchain_liquidity",
  "onchain_stress",
  "spread_pressure",
  "time_pressure",
  "execution_regret",
  "progress_scale_out"
];

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function buildInputs(context = {}) {
  return {
    pnl_pct: safeNumber(context.pnlPct),
    drawdown_pct: safeNumber(context.drawdownFromHighPct),
    held_minutes_norm: safeNumber(context.heldMinutes) / Math.max(context.maxHoldMinutes || 360, 1),
    book_pressure: safeNumber(context.bookPressure),
    signal_score: safeNumber(context.signalScore),
    risk_score: safeNumber(context.riskScore),
    higher_bias: safeNumber(context.higherBias),
    alignment_score: safeNumber(context.alignmentScore, 0.5),
    onchain_liquidity: safeNumber(context.onChainLiquidity),
    onchain_stress: safeNumber(context.onChainStress),
    spread_pressure: safeNumber(context.spreadPressure),
    time_pressure: safeNumber(context.timePressure),
    execution_regret: safeNumber(context.executionRegretScore),
    progress_scale_out: safeNumber(context.progressToScaleOut)
  };
}

function normalizeHeads(hold, trim, trail, exit) {
  const total = Math.max(hold + trim + trail + exit, 1e-9);
  return {
    hold: hold / total,
    trim: trim / total,
    trail: trail / total,
    exit: exit / total
  };
}

export class ExitNeuralAdvisor {
  static bootstrapState() {
    return {
      version: 1,
      hold: TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6),
      trim: TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6),
      trail: TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6),
      exit: TinyNeuralNetwork.bootstrapState(FEATURE_NAMES, 6)
    };
  }

  constructor(state, config) {
    this.config = config;
    const normalized = state?.version === 1 ? state : ExitNeuralAdvisor.bootstrapState();
    const networkOptions = {
      featureNames: FEATURE_NAMES,
      hiddenSize: 6,
      learningRate: config.exitNeuralLearningRate || 0.022,
      l2: config.exitNeuralL2 || 0.00055
    };
    this.networks = {
      hold: new TinyNeuralNetwork(normalized.hold, { ...networkOptions, name: "exit_hold" }),
      trim: new TinyNeuralNetwork(normalized.trim, { ...networkOptions, name: "exit_trim" }),
      trail: new TinyNeuralNetwork(normalized.trail, { ...networkOptions, name: "exit_trail" }),
      exit: new TinyNeuralNetwork(normalized.exit, { ...networkOptions, name: "exit_exit" })
    };
  }

  getState() {
    return {
      version: 1,
      hold: this.networks.hold.getState(),
      trim: this.networks.trim.getState(),
      trail: this.networks.trail.getState(),
      exit: this.networks.exit.getState()
    };
  }

  score(context) {
    const inputs = buildInputs(context);
    const hold = this.networks.hold.predict(inputs);
    const trim = this.networks.trim.predict(inputs);
    const trail = this.networks.trail.predict(inputs);
    const exit = this.networks.exit.predict(inputs);
    const heads = normalizeHeads(hold.probability, trim.probability, trail.probability, exit.probability);
    const confidence = clamp((hold.confidence + trim.confidence + trail.confidence + exit.confidence) / 4, 0, 1);
    return {
      inputs,
      holdScore: num(heads.hold),
      trimScore: num(heads.trim),
      trailScore: num(heads.trail),
      exitScore: num(heads.exit),
      confidence: num(confidence),
      dominantAction: Object.entries(heads).sort((left, right) => right[1] - left[1])[0]?.[0] || "hold",
      drivers: hold.contributions.slice(0, 2).concat(exit.contributions.slice(0, 2)).map((item) => ({
        name: item.name,
        contribution: num(item.contribution),
        rawValue: num(item.rawValue)
      }))
    };
  }

  updateFromTrade(trade, label) {
    const summary = trade.exitIntelligenceSummary || {};
    const inputs = summary.neural?.inputs || buildInputs({
      pnlPct: trade.netPnlPct,
      drawdownFromHighPct: (trade.netPnlPct || 0) - (trade.mfePct || 0),
      heldMinutes: summary.heldMinutes || 0,
      maxHoldMinutes: this.config.maxHoldMinutes,
      bookPressure: 0,
      signalScore: 0,
      riskScore: 0,
      higherBias: summary.timeframeAlignment || 0,
      alignmentScore: summary.timeframeAlignment || 0.5,
      onChainLiquidity: 0,
      onChainStress: summary.onChainStress || 0,
      spreadPressure: 0,
      timePressure: 0,
      executionRegretScore: summary.executionRegretScore || 0,
      progressToScaleOut: summary.progressToScaleOut || 0
    });
    const labelScore = safeNumber(label?.labelScore, trade.labelScore ?? 0.5);
    const pnlPct = safeNumber(trade.netPnlPct);
    const mfePct = safeNumber(trade.mfePct);
    const giveback = Math.max(0, mfePct - pnlPct);
    const baseHold = clamp(labelScore * 0.75 + Math.max(0, pnlPct) * 6 + safeNumber(trade.captureEfficiency, 0.5) * 0.12, 0, 1);
    const baseTrim = clamp((pnlPct > 0 ? 0.3 : 0.08) + giveback * 8 + (summary.action === "trim" ? 0.18 : 0), 0, 1);
    const baseTrail = clamp((pnlPct > 0 ? 0.22 : 0.05) + giveback * 10 + (summary.action === "trail" ? 0.18 : 0), 0, 1);
    const baseExit = clamp((pnlPct < 0 ? 0.46 : 0.08) + (1 - labelScore) * 0.42 + (summary.action === "exit" ? 0.18 : 0), 0, 1);
    return {
      hold: this.networks.hold.update(inputs, baseHold),
      trim: this.networks.trim.update(inputs, baseTrim),
      trail: this.networks.trail.update(inputs, baseTrail),
      exit: this.networks.exit.update(inputs, baseExit),
      inputs,
      targets: {
        hold: num(baseHold),
        trim: num(baseTrim),
        trail: num(baseTrail),
        exit: num(baseExit)
      }
    };
  }
}

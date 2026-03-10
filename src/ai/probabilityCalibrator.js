import { clamp } from "../utils/math.js";

function buildBin() {
  return {
    count: 0,
    targetTotal: 0,
    squaredErrorTotal: 0
  };
}

export class ProbabilityCalibrator {
  constructor(state = {}, config = {}) {
    this.binCount = config.calibrationBins || 10;
    this.minObservations = config.calibrationMinObservations || 12;
    this.priorStrength = config.calibrationPriorStrength || 4;
    this.state = {
      bins: Array.from({ length: this.binCount }, (_, index) => state.bins?.[index] || buildBin()),
      observations: state.observations || 0,
      lastUpdatedAt: state.lastUpdatedAt || null
    };
  }

  getState() {
    return this.state;
  }

  getBinIndex(probability) {
    return clamp(Math.floor(clamp(probability, 0, 0.999999) * this.binCount), 0, this.binCount - 1);
  }

  calibrate(probability) {
    const index = this.getBinIndex(probability);
    const bin = this.state.bins[index];
    const count = bin.count || 0;
    const priorCenter = (index + 0.5) / this.binCount;
    const calibratedProbability =
      (bin.targetTotal + priorCenter * this.priorStrength) / (count + this.priorStrength || 1);
    const confidence = clamp(count / this.minObservations, 0, 1);
    const globalConfidence = clamp(this.state.observations / this.minObservations, 0, 1);
    const warmupProgress = clamp(Math.max(confidence, globalConfidence), 0, 1);
    const uncertainty = 1 - warmupProgress;

    return {
      binIndex: index,
      calibratedProbability: clamp(calibratedProbability, 0, 1),
      confidence,
      globalConfidence,
      warmupProgress,
      uncertainty,
      observations: count,
      totalObservations: this.state.observations
    };
  }

  update(probability, target, at = new Date().toISOString()) {
    const index = this.getBinIndex(probability);
    const bin = this.state.bins[index];
    bin.count += 1;
    bin.targetTotal += target;
    bin.squaredErrorTotal += (probability - target) ** 2;
    this.state.observations += 1;
    this.state.lastUpdatedAt = at;
  }

  getSummary() {
    const nonEmptyBins = this.state.bins.filter((bin) => bin.count > 0);
    const ece = nonEmptyBins.reduce((total, bin, index) => {
      const avgTarget = bin.targetTotal / bin.count;
      const avgPrediction = (index + 0.5) / this.binCount;
      return total + Math.abs(avgPrediction - avgTarget) * (bin.count / Math.max(this.state.observations, 1));
    }, 0);
    const brier = nonEmptyBins.reduce((total, bin) => total + bin.squaredErrorTotal, 0) / Math.max(this.state.observations, 1);
    return {
      observations: this.state.observations,
      expectedCalibrationError: clamp(ece, 0, 1),
      brierScore: clamp(brier, 0, 1),
      lastUpdatedAt: this.state.lastUpdatedAt
    };
  }
}


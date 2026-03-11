import { clamp } from "../utils/math.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function sigmoid(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function tanh(value) {
  if (typeof Math.tanh === "function") {
    return Math.tanh(value);
  }
  const positive = Math.exp(value);
  const negative = Math.exp(-value);
  return (positive - negative) / (positive + negative);
}

function createMatrix(rows, cols, scale = 0.08) {
  return Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) => {
      const seed = ((rowIndex + 3) * 37 + (colIndex + 11) * 17) % 23;
      return ((seed - 11) / 11) * scale;
    })
  );
}

function normalizeFeatureNames(featureNames = []) {
  return [...new Set(featureNames.filter(Boolean))];
}

function bootstrapState(featureNames = [], hiddenSize = 6) {
  const normalized = normalizeFeatureNames(featureNames);
  return {
    version: 1,
    featureNames: normalized,
    hiddenSize,
    samples: 0,
    bias: 0,
    hiddenBiases: Array.from({ length: hiddenSize }, () => 0),
    hiddenWeights: createMatrix(hiddenSize, normalized.length, 0.06),
    outputWeights: Array.from({ length: hiddenSize }, (_, index) => ((index % 2 === 0 ? 1 : -1) * 0.04))
  };
}

function ensureState(state, featureNames, hiddenSize) {
  const normalized = normalizeFeatureNames(featureNames);
  const base = state?.version === 1 ? { ...state } : bootstrapState(normalized, hiddenSize);
  const resolvedHiddenSize = Math.max(2, base.hiddenSize || hiddenSize || 6);
  const currentFeatureNames = normalizeFeatureNames(base.featureNames || []);
  const mergedFeatureNames = normalizeFeatureNames([...currentFeatureNames, ...normalized]);
  return {
    version: 1,
    featureNames: mergedFeatureNames,
    hiddenSize: resolvedHiddenSize,
    samples: safeNumber(base.samples, 0),
    bias: safeNumber(base.bias, 0),
    hiddenBiases: Array.from({ length: resolvedHiddenSize }, (_, index) => safeNumber(base.hiddenBiases?.[index], 0)),
    hiddenWeights: Array.from({ length: resolvedHiddenSize }, (_, rowIndex) =>
      Array.from({ length: mergedFeatureNames.length }, (_, colIndex) => {
        const featureName = mergedFeatureNames[colIndex];
        const previousIndex = currentFeatureNames.indexOf(featureName);
        if (previousIndex >= 0 && Number.isFinite(base.hiddenWeights?.[rowIndex]?.[previousIndex])) {
          return base.hiddenWeights[rowIndex][previousIndex];
        }
        const seed = ((rowIndex + 5) * 29 + (colIndex + 13) * 19) % 29;
        return ((seed - 14) / 14) * 0.05;
      })
    ),
    outputWeights: Array.from({ length: resolvedHiddenSize }, (_, index) => safeNumber(base.outputWeights?.[index], (index % 2 === 0 ? 1 : -1) * 0.04))
  };
}

export class TinyNeuralNetwork {
  static bootstrapState(featureNames = [], hiddenSize = 6) {
    return bootstrapState(featureNames, hiddenSize);
  }

  constructor(state, { featureNames = [], hiddenSize = 6, learningRate = 0.03, l2 = 0.0005, name = "tiny_nn" } = {}) {
    this.featureNames = normalizeFeatureNames(featureNames);
    this.hiddenSize = Math.max(2, hiddenSize || 6);
    this.learningRate = learningRate;
    this.l2 = l2;
    this.name = name;
    this.state = ensureState(state, this.featureNames, this.hiddenSize);
    this.featureNames = [...this.state.featureNames];
  }

  getState() {
    return {
      version: 1,
      featureNames: [...this.state.featureNames],
      hiddenSize: this.state.hiddenSize,
      samples: this.state.samples,
      bias: this.state.bias,
      hiddenBiases: [...this.state.hiddenBiases],
      hiddenWeights: this.state.hiddenWeights.map((row) => [...row]),
      outputWeights: [...this.state.outputWeights]
    };
  }

  buildVector(features = {}) {
    return this.featureNames.map((name) => clamp(safeNumber(features[name], 0), -3, 3));
  }

  predict(features = {}) {
    const input = this.buildVector(features);
    const hidden = this.state.hiddenWeights.map((row, rowIndex) => {
      const activation = row.reduce((total, weight, colIndex) => total + weight * input[colIndex], this.state.hiddenBiases[rowIndex] || 0);
      return tanh(activation);
    });
    const logit = hidden.reduce((total, value, index) => total + value * this.state.outputWeights[index], this.state.bias || 0);
    const probability = sigmoid(logit);
    const effectiveWeights = this.featureNames.map((_, featureIndex) =>
      this.state.hiddenWeights.reduce((total, row, rowIndex) => total + row[featureIndex] * this.state.outputWeights[rowIndex], 0)
    );
    const contributions = this.featureNames
      .map((name, index) => ({
        name,
        contribution: input[index] * effectiveWeights[index],
        rawValue: input[index]
      }))
      .filter((item) => Number.isFinite(item.contribution))
      .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
      .slice(0, 6);
    const sampleConfidence = clamp(Math.log1p(this.state.samples) / Math.log(40), 0, 1);
    const confidence = clamp(0.18 + sampleConfidence * 0.5 + Math.abs(probability - 0.5) * 0.8, 0.18, 0.98);
    return {
      probability,
      confidence,
      logit,
      inputs: Object.fromEntries(this.featureNames.map((name, index) => [name, input[index]])),
      contributions,
      sampleCount: this.state.samples
    };
  }

  update(features = {}, target = 0.5, { sampleWeight = 1, learningRate = this.learningRate, l2 = this.l2 } = {}) {
    const input = this.buildVector(features);
    const hiddenActivations = this.state.hiddenWeights.map((row, rowIndex) => {
      const activation = row.reduce((total, weight, colIndex) => total + weight * input[colIndex], this.state.hiddenBiases[rowIndex] || 0);
      return tanh(activation);
    });
    const logit = hiddenActivations.reduce((total, value, index) => total + value * this.state.outputWeights[index], this.state.bias || 0);
    const prediction = sigmoid(logit);
    const error = prediction - clamp(target, 0, 1);
    const scaledRate = Math.max(0.0005, learningRate) * clamp(sampleWeight, 0.1, 3);

    this.state.bias -= scaledRate * error;
    for (let rowIndex = 0; rowIndex < this.state.hiddenWeights.length; rowIndex += 1) {
      const hidden = hiddenActivations[rowIndex];
      const outputWeight = this.state.outputWeights[rowIndex];
      const outputGradient = error * hidden + l2 * outputWeight;
      this.state.outputWeights[rowIndex] -= scaledRate * outputGradient;

      const hiddenGradient = error * outputWeight * (1 - hidden * hidden);
      this.state.hiddenBiases[rowIndex] -= scaledRate * hiddenGradient;
      for (let colIndex = 0; colIndex < this.state.hiddenWeights[rowIndex].length; colIndex += 1) {
        const gradient = hiddenGradient * input[colIndex] + l2 * this.state.hiddenWeights[rowIndex][colIndex];
        this.state.hiddenWeights[rowIndex][colIndex] -= scaledRate * gradient;
      }
    }
    this.state.samples += 1;
    return {
      predictionBeforeUpdate: prediction,
      error,
      sampleWeight: clamp(sampleWeight, 0.1, 3),
      sampleCount: this.state.samples
    };
  }
}

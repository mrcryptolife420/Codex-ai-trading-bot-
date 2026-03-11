export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function average(values, fallback = 0) {
  if (!values.length) {
    return fallback;
  }
  return sum(values) / values.length;
}

export function standardDeviation(values, fallback = 0) {
  if (values.length < 2) {
    return fallback;
  }
  const mean = average(values);
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

export function sigmoid(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

export function roundToStep(value, step, mode = "floor") {
  if (!step || step <= 0) {
    return value;
  }
  const steps = value / step;
  if (mode === "ceil") {
    return Math.ceil(steps) * step;
  }
  if (mode === "round") {
    return Math.round(steps) * step;
  }
  return Math.floor(steps) * step;
}

export function decimalsFromStep(step) {
  if (!step || step <= 0) {
    return 8;
  }
  const normalized = `${step}`;
  if (!normalized.includes(".")) {
    return 0;
  }
  return normalized.replace(/0+$/, "").split(".")[1].length;
}

export function formatDecimal(value, stepOrDecimals = 8) {
  const decimals = Number.isInteger(stepOrDecimals)
    ? stepOrDecimals
    : decimalsFromStep(stepOrDecimals);
  return Number(value)
    .toFixed(decimals)
    .replace(/\.?0+$/, "");
}

export function basisPoints(delta) {
  return delta * 10_000;
}

export function pctChange(from, to) {
  if (!from) {
    return 0;
  }
  return (to - from) / from;
}

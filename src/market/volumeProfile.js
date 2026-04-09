const DEFAULT_BINS = 24;
const DEFAULT_VWAP_LOOKBACK = 96;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultBins() {
  return Math.max(8, toNumber(process.env.VOLUME_PROFILE_BINS, DEFAULT_BINS));
}

function getDefaultVwapLookback() {
  return Math.max(10, toNumber(process.env.VWAP_LOOKBACK_CANDLES, DEFAULT_VWAP_LOOKBACK));
}

function sanitizeCandles(candles) {
  return (Array.isArray(candles) ? candles : [])
    .map((candle) => ({
      openTime: toNumber(candle?.openTime, 0),
      high: toNumber(candle?.high, 0),
      low: toNumber(candle?.low, 0),
      close: toNumber(candle?.close, 0),
      volume: toNumber(candle?.volume, 0)
    }))
    .filter((candle) => candle.openTime > 0 && candle.high > 0 && candle.low > 0 && candle.volume >= 0);
}

export function calculateVolumeProfile(candles, bins) {
  const clean = sanitizeCandles(candles);
  if (!clean.length) {
    return {
      bins: [],
      binCount: 0,
      poc: null,
      valueArea: null,
      minPrice: null,
      maxPrice: null,
      totalVolume: 0,
      dataQuality: "empty"
    };
  }
  const binCount = Math.max(8, toNumber(bins, getDefaultBins()));
  const lows = clean.map((c) => c.low);
  const highs = clean.map((c) => c.high);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const range = Math.max(1e-12, maxPrice - minPrice);
  const step = range / binCount;
  const volumeBins = new Array(binCount).fill(0);

  for (const candle of clean) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const rawIndex = Math.floor((typicalPrice - minPrice) / step);
    const index = Math.max(0, Math.min(binCount - 1, rawIndex));
    volumeBins[index] += candle.volume;
  }

  const totalVolume = volumeBins.reduce((sum, value) => sum + value, 0);
  const pocIndex = volumeBins.reduce((bestIndex, value, idx, arr) => (value > arr[bestIndex] ? idx : bestIndex), 0);
  const pocPrice = minPrice + (pocIndex + 0.5) * step;

  const targetValueAreaVolume = totalVolume * 0.7;
  let cumulative = volumeBins[pocIndex] || 0;
  let left = pocIndex;
  let right = pocIndex;
  while (cumulative < targetValueAreaVolume && (left > 0 || right < binCount - 1)) {
    const leftVol = left > 0 ? volumeBins[left - 1] : -1;
    const rightVol = right < binCount - 1 ? volumeBins[right + 1] : -1;
    if (leftVol >= rightVol) {
      left -= 1;
      cumulative += Math.max(0, leftVol);
    } else {
      right += 1;
      cumulative += Math.max(0, rightVol);
    }
  }

  const profileBins = volumeBins.map((volume, idx) => ({
    index: idx,
    from: minPrice + idx * step,
    to: minPrice + (idx + 1) * step,
    mid: minPrice + (idx + 0.5) * step,
    volume,
    volumeShare: totalVolume > 0 ? volume / totalVolume : 0
  }));

  return {
    bins: profileBins,
    binCount,
    poc: {
      index: pocIndex,
      price: pocPrice,
      volume: volumeBins[pocIndex] || 0
    },
    valueArea: {
      low: minPrice + left * step,
      high: minPrice + (right + 1) * step,
      lowIndex: left,
      highIndex: right,
      volumeCovered: cumulative,
      coverageRatio: totalVolume > 0 ? cumulative / totalVolume : 0
    },
    minPrice,
    maxPrice,
    totalVolume,
    dataQuality: clean.length < 20 ? "low" : "high"
  };
}

export function calculateVWAP(candles, lookback) {
  const clean = sanitizeCandles(candles);
  const effectiveLookback = Math.max(10, toNumber(lookback, getDefaultVwapLookback()));
  const scoped = clean.slice(-effectiveLookback);
  if (!scoped.length) {
    return {
      vwap: null,
      lastPrice: null,
      deviation: null,
      deviationPct: null,
      lookbackUsed: 0,
      dataQuality: "empty"
    };
  }
  let weightedPriceVolume = 0;
  let totalVolume = 0;
  for (const candle of scoped) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    weightedPriceVolume += typicalPrice * candle.volume;
    totalVolume += candle.volume;
  }
  const vwap = totalVolume > 0 ? weightedPriceVolume / totalVolume : scoped.at(-1).close;
  const lastPrice = scoped.at(-1).close;
  const deviation = lastPrice - vwap;
  const deviationPct = vwap > 0 ? deviation / vwap : 0;
  return {
    vwap,
    lastPrice,
    deviation,
    deviationPct,
    lookbackUsed: scoped.length,
    dataQuality: scoped.length < 20 ? "low" : "high"
  };
}

export function analyzeVolumeContext(candles, profileBins, vwapLookback) {
  const clean = sanitizeCandles(candles);
  const profile = calculateVolumeProfile(clean, profileBins);
  const vwap = calculateVWAP(clean, vwapLookback);
  const lastClose = clean.at(-1)?.close ?? null;
  const inValueArea = lastClose != null && profile.valueArea
    ? lastClose >= profile.valueArea.low && lastClose <= profile.valueArea.high
    : null;
  const distanceToPocPct = profile.poc?.price && lastClose
    ? (lastClose - profile.poc.price) / profile.poc.price
    : null;
  const vwapContext = vwap.deviationPct == null
    ? "neutral"
    : vwap.deviationPct > 0.01
      ? "above_vwap"
      : vwap.deviationPct < -0.01
        ? "below_vwap"
        : "near_vwap";
  return {
    profile,
    vwap,
    context: {
      lastClose,
      inValueArea,
      distanceToPocPct,
      vwapContext
    },
    dataQuality: clean.length < 20 ? "low" : "high"
  };
}

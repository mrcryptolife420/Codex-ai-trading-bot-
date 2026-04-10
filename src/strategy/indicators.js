import { average, clamp, pctChange, standardDeviation } from "../utils/math.js";

function selectRecent(values, length) {
  return values.slice(Math.max(0, values.length - length));
}

export function sma(values, length) {
  const recent = selectRecent(values, length);
  return average(recent, values[values.length - 1] || 0);
}

export function ema(values, length) {
  if (!values.length) {
    return 0;
  }
  const multiplier = 2 / (length + 1);
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) {
    current = values[index] * multiplier + current * (1 - multiplier);
  }
  return current;
}

function trueRange(current, previousClose) {
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previousClose),
    Math.abs(current.low - previousClose)
  );
}

export function rsi(values, length = 14) {
  if (values.length < length + 1) {
    return 50;
  }
  let gains = 0;
  let losses = 0;
  for (let index = values.length - length; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses -= delta;
    }
  }
  if (losses === 0) {
    return 100;
  }
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

export function atr(candles, length = 14) {
  if (candles.length < length + 1) {
    return 0;
  }
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    trueRanges.push(trueRange(current, previous.close));
  }
  return average(selectRecent(trueRanges, length));
}

export function macd(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = fast - slow;
  const macdSeries = [];
  for (let index = 0; index < values.length; index += 1) {
    const slice = values.slice(0, index + 1);
    macdSeries.push(ema(slice, 12) - ema(slice, 26));
  }
  const signal = ema(macdSeries, 9);
  return {
    line,
    signal,
    histogram: line - signal
  };
}

function volumeWeightedAveragePrice(candles, length = 30, offset = 0) {
  const end = offset > 0 ? Math.max(0, candles.length - offset) : candles.length;
  const start = Math.max(0, end - length);
  const recent = candles.slice(start, end);
  const cumulative = recent.reduce(
    (state, candle) => {
      const typical = (candle.high + candle.low + candle.close) / 3;
      return {
        pv: state.pv + typical * candle.volume,
        volume: state.volume + candle.volume
      };
    },
    { pv: 0, volume: 0 }
  );
  return cumulative.volume ? cumulative.pv / cumulative.volume : recent.at(-1)?.close || 0;
}

function buildObvSeries(candles) {
  const series = [0];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const delta = current.close > previous.close ? current.volume : current.close < previous.close ? -current.volume : 0;
    series.push((series.at(-1) || 0) + delta);
  }
  return series;
}

function buildRsiSeries(values, length = 14) {
  return values.map((_, index) => rsi(values.slice(0, index + 1), length));
}

function candleShape(candle) {
  const open = Number(candle?.open || 0);
  const close = Number(candle?.close || 0);
  const high = Number(candle?.high || Math.max(open, close));
  const low = Number(candle?.low || Math.min(open, close));
  const range = Math.max(high - low, 1e-9);
  const body = Math.abs(close - open);
  const upperWick = Math.max(0, high - Math.max(open, close));
  const lowerWick = Math.max(0, Math.min(open, close) - low);
  return {
    open,
    close,
    high,
    low,
    range,
    body,
    upperWick,
    lowerWick,
    bullish: close > open,
    bearish: close < open
  };
}

function detectPatternFeatures(candles) {
  const previous = candleShape(candles[candles.length - 2]);
  const current = candleShape(candles[candles.length - 1]);
  const bullishEngulfing = previous.bearish && current.bullish && current.open <= previous.close && current.close >= previous.open ? 1 : 0;
  const bearishEngulfing = previous.bullish && current.bearish && current.open >= previous.close && current.close <= previous.open ? 1 : 0;
  const hammer = current.lowerWick > current.body * 2.2 && current.upperWick <= current.body * 0.8 && current.close >= current.low + current.range * 0.58 ? 1 : 0;
  const shootingStar = current.upperWick > current.body * 2.2 && current.lowerWick <= current.body * 0.8 && current.close <= current.low + current.range * 0.45 ? 1 : 0;
  const insideBar = current.high <= previous.high && current.low >= previous.low ? 1 : 0;
  const bullishScore = clamp(bullishEngulfing * 0.95 + hammer * 0.78 + insideBar * (current.bullish ? 0.24 : 0), 0, 1);
  const bearishScore = clamp(bearishEngulfing * 0.95 + shootingStar * 0.78 + insideBar * (current.bearish ? 0.24 : 0), 0, 1);
  const dominantPattern = bullishScore > bearishScore
    ? bullishEngulfing
      ? "bullish_engulfing"
      : hammer
        ? "hammer"
        : insideBar
          ? "inside_bar_bullish"
          : "none"
    : bearishScore > bullishScore
      ? bearishEngulfing
        ? "bearish_engulfing"
        : shootingStar
          ? "shooting_star"
          : insideBar
            ? "inside_bar_bearish"
            : "none"
      : insideBar
        ? "inside_bar"
        : "none";

  return {
    bullishPatternScore: bullishScore,
    bearishPatternScore: bearishScore,
    insideBar,
    dominantPattern
  };
}

function bollingerBands(values, length = 20, deviations = 2) {
  const recent = selectRecent(values, length);
  const basis = average(recent, values.at(-1) || 0);
  const deviation = standardDeviation(recent, 0);
  return {
    basis,
    upper: basis + deviation * deviations,
    lower: basis - deviation * deviations,
    deviation
  };
}

function keltnerChannels(candles, emaLength = 20, atrLength = 20, multiplier = 1.5) {
  const closes = candles.map((candle) => candle.close);
  const basis = ema(closes, emaLength);
  const range = atr(candles, atrLength);
  return {
    basis,
    upper: basis + range * multiplier,
    lower: basis - range * multiplier,
    range
  };
}

function directionalMovement(candles, length = 14) {
  if (candles.length < length + 1) {
    return {
      adx: 18,
      plusDi: 20,
      minusDi: 20,
      dmiSpread: 0,
      trendBias: 0
    };
  }

  const trueRanges = [];
  const plusMoves = [];
  const minusMoves = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    trueRanges.push(trueRange(current, previous.close));
    plusMoves.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusMoves.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const recentTr = selectRecent(trueRanges, length);
  const recentPlus = selectRecent(plusMoves, length);
  const recentMinus = selectRecent(minusMoves, length);
  const trSum = recentTr.reduce((total, value) => total + value, 0);
  const plusDi = trSum ? (recentPlus.reduce((total, value) => total + value, 0) / trSum) * 100 : 0;
  const minusDi = trSum ? (recentMinus.reduce((total, value) => total + value, 0) / trSum) * 100 : 0;

  const dxSeries = [];
  for (let end = length; end <= trueRanges.length; end += 1) {
    const trWindow = trueRanges.slice(end - length, end);
    const plusWindow = plusMoves.slice(end - length, end);
    const minusWindow = minusMoves.slice(end - length, end);
    const windowTr = trWindow.reduce((total, value) => total + value, 0);
    const windowPlusDi = windowTr ? (plusWindow.reduce((total, value) => total + value, 0) / windowTr) * 100 : 0;
    const windowMinusDi = windowTr ? (minusWindow.reduce((total, value) => total + value, 0) / windowTr) * 100 : 0;
    dxSeries.push(windowPlusDi + windowMinusDi ? (Math.abs(windowPlusDi - windowMinusDi) / (windowPlusDi + windowMinusDi)) * 100 : 0);
  }

  const adx = average(selectRecent(dxSeries, length), dxSeries.at(-1) || Math.abs(plusDi - minusDi));
  const dmiSpread = (plusDi - minusDi) / 100;
  const trendBias = clamp(dmiSpread * Math.min(adx / 24, 1.5), -1, 1);
  return {
    adx,
    plusDi,
    minusDi,
    dmiSpread,
    trendBias
  };
}

function stochRsi(values, rsiLength = 14, stochLength = 14, smoothK = 3, smoothD = 3) {
  const rsiSeries = buildRsiSeries(values, rsiLength);
  if (rsiSeries.length < stochLength) {
    return { k: 50, d: 50 };
  }

  const rawSeries = rsiSeries.map((value, index) => {
    const recent = rsiSeries.slice(Math.max(0, index - stochLength + 1), index + 1);
    if (recent.length < stochLength) {
      return 0.5;
    }
    const low = Math.min(...recent);
    const high = Math.max(...recent);
    if (high === low) {
      return 0.5;
    }
    return (value - low) / (high - low);
  });
  const kSeries = rawSeries.map((_, index) => average(rawSeries.slice(Math.max(0, index - smoothK + 1), index + 1), rawSeries[index] || 0.5) * 100);
  const dSeries = kSeries.map((_, index) => average(kSeries.slice(Math.max(0, index - smoothD + 1), index + 1), kSeries[index] || 50));
  return {
    k: kSeries.at(-1) || 50,
    d: dSeries.at(-1) || 50
  };
}

function moneyFlowIndex(candles, length = 14) {
  if (candles.length < length + 1) {
    return 50;
  }
  let positiveFlow = 0;
  let negativeFlow = 0;
  for (let index = candles.length - length; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const previousTypical = (previous.high + previous.low + previous.close) / 3;
    const currentTypical = (current.high + current.low + current.close) / 3;
    const rawMoneyFlow = currentTypical * current.volume;
    if (currentTypical > previousTypical) {
      positiveFlow += rawMoneyFlow;
    } else if (currentTypical < previousTypical) {
      negativeFlow += rawMoneyFlow;
    }
  }
  if (negativeFlow === 0) {
    return 100;
  }
  if (positiveFlow === 0) {
    return 0;
  }
  const moneyRatio = positiveFlow / negativeFlow;
  return 100 - 100 / (1 + moneyRatio);
}

function chaikinMoneyFlow(candles, length = 20) {
  const recent = selectRecent(candles, length);
  const volumeTotal = recent.reduce((total, candle) => total + candle.volume, 0);
  if (!volumeTotal) {
    return 0;
  }
  const flowTotal = recent.reduce((total, candle) => {
    const range = candle.high - candle.low;
    const moneyFlowMultiplier = range > 0 ? ((candle.close - candle.low) - (candle.high - candle.close)) / range : 0;
    return total + moneyFlowMultiplier * candle.volume;
  }, 0);
  return flowTotal / volumeTotal;
}

function supertrend(candles, atrLength = 10, multiplier = 3) {
  if (candles.length < atrLength + 2) {
    return {
      line: candles.at(-1)?.close || 0,
      direction: 0,
      distancePct: 0,
      flipScore: 0
    };
  }

  const trueRanges = [];
  let finalUpper = 0;
  let finalLower = 0;
  let trendLine = 0;
  let direction = 1;
  let previousDirection = 1;

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    trueRanges.push(trueRange(current, previous.close));
    const atrValue = average(selectRecent(trueRanges, atrLength), trueRanges.at(-1) || 0);
    const hl2 = (current.high + current.low) / 2;
    const basicUpper = hl2 + atrValue * multiplier;
    const basicLower = hl2 - atrValue * multiplier;

    if (index === 1) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      trendLine = current.close >= basicLower ? basicLower : basicUpper;
      direction = current.close >= basicLower ? 1 : -1;
      previousDirection = direction;
      continue;
    }

    finalUpper = basicUpper < finalUpper || previous.close > finalUpper ? basicUpper : finalUpper;
    finalLower = basicLower > finalLower || previous.close < finalLower ? basicLower : finalLower;
    previousDirection = direction;

    if (trendLine === finalUpper) {
      trendLine = current.close <= finalUpper ? finalUpper : finalLower;
    } else {
      trendLine = current.close >= finalLower ? finalLower : finalUpper;
    }
    direction = trendLine === finalLower ? 1 : -1;
  }

  const lastClose = candles.at(-1)?.close || 0;
  return {
    line: trendLine,
    direction,
    distancePct: lastClose ? (lastClose - trendLine) / lastClose : 0,
    flipScore: direction !== previousDirection ? direction : 0
  };
}

function donchianChannel(highs, lows, length = 20, includeCurrent = true) {
  const highsSource = includeCurrent ? highs : highs.slice(0, -1);
  const lowsSource = includeCurrent ? lows : lows.slice(0, -1);
  const recentHighs = selectRecent(highsSource, length);
  const recentLows = selectRecent(lowsSource, length);
  return {
    upper: recentHighs.length ? Math.max(...recentHighs) : highs.at(-1) || 0,
    lower: recentLows.length ? Math.min(...recentLows) : lows.at(-1) || 0
  };
}

function detectLiquiditySweep(lastCandle, priorHigh, priorLow) {
  const range = Math.max(lastCandle.high - lastCandle.low, 1e-9);
  const bullish = priorLow > 0 && lastCandle.low < priorLow && lastCandle.close > priorLow && ((lastCandle.close - lastCandle.low) / range) > 0.58 ? 1 : 0;
  const bearish = priorHigh > 0 && lastCandle.high > priorHigh && lastCandle.close < priorHigh && ((lastCandle.high - lastCandle.close) / range) > 0.58 ? 1 : 0;
  return {
    bullish,
    bearish,
    score: clamp(bullish - bearish, -1, 1),
    label: bullish ? "bullish_sweep" : bearish ? "bearish_sweep" : "none"
  };
}

function detectStructureBreak(lastClose, priorHigh, priorLow, momentum5, closeLocation) {
  const bullish = priorHigh > 0 && lastClose > priorHigh && momentum5 > 0 && closeLocation > 0.58 ? 1 : 0;
  const bearish = priorLow > 0 && lastClose < priorLow && momentum5 < 0 && closeLocation < 0.42 ? 1 : 0;
  return {
    bullish,
    bearish,
    score: clamp(bullish - bearish, -1, 1),
    label: bullish ? "bullish_msb" : bearish ? "bearish_msb" : "none"
  };
}

function computeSwingStructure(highs = [], lows = [], length = 8) {
  const recentHighs = selectRecent(highs, length + 1);
  const recentLows = selectRecent(lows, length + 1);
  const sampleCount = Math.max(0, Math.min(recentHighs.length, recentLows.length) - 1);
  if (!sampleCount) {
    return {
      swingStructureScore: 0,
      higherHighRate: 0.5,
      higherLowRate: 0.5,
      lowerHighRate: 0.5,
      lowerLowRate: 0.5
    };
  }

  let higherHighs = 0;
  let higherLows = 0;
  let lowerHighs = 0;
  let lowerLows = 0;
  for (let index = 1; index < recentHighs.length; index += 1) {
    higherHighs += recentHighs[index] > recentHighs[index - 1] ? 1 : 0;
    lowerHighs += recentHighs[index] < recentHighs[index - 1] ? 1 : 0;
    higherLows += recentLows[index] > recentLows[index - 1] ? 1 : 0;
    lowerLows += recentLows[index] < recentLows[index - 1] ? 1 : 0;
  }

  const higherHighRate = higherHighs / sampleCount;
  const higherLowRate = higherLows / sampleCount;
  const lowerHighRate = lowerHighs / sampleCount;
  const lowerLowRate = lowerLows / sampleCount;
  return {
    swingStructureScore: clamp(((higherHighRate + higherLowRate) - (lowerHighRate + lowerLowRate)) / 2, -1, 1),
    higherHighRate,
    higherLowRate,
    lowerHighRate,
    lowerLowRate
  };
}

function computeDirectionalAcceleration(returns = []) {
  const recent = selectRecent(returns, 4);
  const baseline = selectRecent(returns.slice(0, -4), 8);
  const mean = (values, selector) => {
    const filtered = values.filter(selector);
    return filtered.length ? average(filtered, 0) : 0;
  };
  const upsideRecent = mean(recent, (value) => value > 0);
  const upsideBaseline = mean(baseline, (value) => value > 0);
  const downsideRecent = Math.abs(mean(recent, (value) => value < 0));
  const downsideBaseline = Math.abs(mean(baseline, (value) => value < 0));
  return {
    upsideAccelerationScore: clamp((upsideRecent - upsideBaseline) * 160, 0, 1),
    downsideAccelerationScore: clamp((downsideRecent - downsideBaseline) * 160, 0, 1)
  };
}

function detectFairValueGap(candles = []) {
  if (candles.length < 3) {
    return {
      bullishFvgActive: 0,
      bearishFvgActive: 0,
      nearestBullishFvgDistancePct: 0,
      nearestBearishFvgDistancePct: 0,
      fvgFillProgress: 1,
      fvgWidthPct: 0,
      fvgRespectScore: 0
    };
  }
  const lastClose = Number(candles.at(-1)?.close || 0);
  const gaps = [];
  for (let index = 2; index < candles.length; index += 1) {
    const left = candles[index - 2];
    const current = candles[index];
    if (!left || !current) {
      continue;
    }
    if (Number(current.low || 0) > Number(left.high || 0)) {
      gaps.push({ direction: "bullish", lower: Number(left.high || 0), upper: Number(current.low || 0), createdAt: index });
    }
    if (Number(current.high || 0) < Number(left.low || 0)) {
      gaps.push({ direction: "bearish", lower: Number(current.high || 0), upper: Number(left.low || 0), createdAt: index });
    }
  }
  const active = gaps
    .map((gap) => {
      const width = Math.max(gap.upper - gap.lower, 1e-9);
      const futureCandles = candles.slice(gap.createdAt + 1);
      const fillProgress = gap.direction === "bullish"
        ? clamp((gap.upper - futureCandles.reduce((min, candle) => Math.min(min, Number(candle.low || gap.upper)), gap.upper)) / width, 0, 1)
        : clamp((futureCandles.reduce((max, candle) => Math.max(max, Number(candle.high || gap.lower)), gap.lower) - gap.lower) / width, 0, 1);
      return { ...gap, width, fillProgress, active: fillProgress < 0.97 };
    })
    .filter((gap) => gap.active)
    .sort((left, right) => right.createdAt - left.createdAt);
  const bullish = active.find((gap) => gap.direction === "bullish") || null;
  const bearish = active.find((gap) => gap.direction === "bearish") || null;
  const dominant = bullish || bearish;
  return {
    bullishFvgActive: bullish ? 1 : 0,
    bearishFvgActive: bearish ? 1 : 0,
    nearestBullishFvgDistancePct: bullish && lastClose ? (lastClose - bullish.lower) / lastClose : 0,
    nearestBearishFvgDistancePct: bearish && lastClose ? (bearish.upper - lastClose) / lastClose : 0,
    fvgFillProgress: dominant ? dominant.fillProgress : 1,
    fvgWidthPct: dominant && lastClose ? dominant.width / lastClose : 0,
    fvgRespectScore: dominant
      ? clamp((1 - dominant.fillProgress) * 0.6 + clamp(dominant.width / Math.max(lastClose, 1e-9) * 200, 0, 1) * 0.22 + 0.18, 0, 1)
      : 0
  };
}

function detectBreakOfStructure(candles = []) {
  if (candles.length < 8) {
    return {
      bullishBosActive: 0,
      bearishBosActive: 0,
      bosStrengthScore: 0,
      structureShiftScore: 0,
      swingHighBreakScore: 0,
      swingLowBreakScore: 0
    };
  }
  const last = candles.at(-1) || {};
  const lastClose = Number(last.close || 0);
  const recent = candles.slice(-7, -1);
  const priorHigh = Math.max(...recent.map((candle) => Number(candle.high || 0)));
  const priorLow = Math.min(...recent.map((candle) => Number(candle.low || 0)));
  const breakAbove = priorHigh > 0 ? clamp(((lastClose - priorHigh) / priorHigh) * 80, 0, 1) : 0;
  const breakBelow = priorLow > 0 ? clamp(((priorLow - lastClose) / priorLow) * 80, 0, 1) : 0;
  const candleRange = Math.max(Number(last.high || 0) - Number(last.low || 0), 1e-9);
  const closeDrive = clamp((Number(last.close || 0) - Number(last.open || 0)) / candleRange, -1, 1);
  return {
    bullishBosActive: breakAbove > 0.05 && closeDrive > 0.08 ? 1 : 0,
    bearishBosActive: breakBelow > 0.05 && closeDrive < -0.08 ? 1 : 0,
    bosStrengthScore: clamp(Math.max(breakAbove, breakBelow) * 0.68 + Math.abs(closeDrive) * 0.32, 0, 1),
    structureShiftScore: clamp((breakAbove - breakBelow) * 0.78 + closeDrive * 0.22, -1, 1),
    swingHighBreakScore: breakAbove,
    swingLowBreakScore: breakBelow
  };
}

function computeCvdContext(candles = [], lastClose = 0) {
  if (candles.length < 6) {
    return {
      cvdValue: 0,
      cvdSlope: 0,
      cvdMomentum: 0,
      cvdDivergenceScore: 0,
      cvdConfirmationScore: 0,
      cvdTrendAlignment: 0,
      cvdConfidence: 0.28
    };
  }
  const cumulative = [];
  let cvd = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const delta = Number(current.close || 0) - Number(previous.close || 0);
    const signedVolume = Number(current.volume || 0) * (delta > 0 ? 1 : delta < 0 ? -1 : Math.sign(Number(current.close || 0) - Number(current.open || 0)));
    cvd += signedVolume;
    cumulative.push(cvd);
  }
  const baseline = Math.max(average(candles.slice(-24).map((candle) => Number(candle.volume || 0)), 1), 1);
  const recent = cumulative.slice(-5);
  const prior = cumulative.slice(-10, -5);
  const recentSlope = recent.length > 1 ? (recent.at(-1) - recent[0]) / recent.length : 0;
  const priorSlope = prior.length > 1 ? (prior.at(-1) - prior[0]) / prior.length : 0;
  const priceDelta = candles.length > 6 ? (lastClose - Number(candles.at(-6)?.close || lastClose)) / Math.max(Number(candles.at(-6)?.close || 1), 1e-9) : 0;
  const cvdSlope = recentSlope / baseline;
  const cvdMomentum = (recentSlope - priorSlope) / baseline;
  const divergence = Math.sign(priceDelta || 0) !== Math.sign(cvdSlope || 0)
    ? clamp(Math.abs(priceDelta) * 26 + Math.abs(cvdSlope) * 2.6, 0, 1)
    : 0;
  const alignment = clamp(
    Math.sign(priceDelta || 0) === Math.sign(cvdSlope || 0)
      ? Math.min(1, Math.abs(priceDelta) * 24 + Math.abs(cvdSlope) * 2.4)
      : -Math.min(1, Math.abs(priceDelta) * 22 + Math.abs(cvdSlope) * 2.2),
    -1,
    1
  );
  return {
    cvdValue: cvd / baseline,
    cvdSlope,
    cvdMomentum,
    cvdDivergenceScore: divergence,
    cvdConfirmationScore: clamp(Math.max(0, alignment) * 0.72 + Math.max(0, cvdMomentum) * 0.28, 0, 1),
    cvdTrendAlignment: alignment,
    cvdConfidence: clamp(0.32 + Math.min(candles.length, 48) / 48 * 0.5, 0, 0.9)
  };
}

export function computeMarketFeatures(candles) {
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume);
  const lastCandle = candles[candles.length - 1] || { open: 0, high: 0, low: 0, close: 0 };
  const lastClose = closes[closes.length - 1] || 0;
  const emaFast = ema(closes, 12);
  const emaSlow = ema(closes, 26);
  const priorFast = ema(closes.slice(0, -5), 12);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const atr30 = atr(candles, 30);
  const macdValues = macd(closes);
  const dmi = directionalMovement(candles, 14);
  const stochRsiValues = stochRsi(closes, 14, 14, 3, 3);
  const mfi14 = moneyFlowIndex(candles, 14);
  const cmf20 = chaikinMoneyFlow(candles, 20);
  const keltner = keltnerChannels(candles, 20, 20, 1.5);
  const supertrendValue = supertrend(candles, 10, 3);
  const volumeLookback = selectRecent(volumes, 30);
  const priorVolumes = volumeLookback.slice(0, -1);
  const volumeMean = average(priorVolumes, volumes[volumes.length - 1] || 0);
  const volumeStd = standardDeviation(priorVolumes, 1);
  const volumeZ = volumeStd > 0 ? ((volumes[volumes.length - 1] || 0) - volumeMean) / volumeStd : 0;

  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    returns.push(pctChange(closes[index - 1], closes[index]));
  }
  const recentReturns = selectRecent(returns, 8);
  const realizedVolPct = standardDeviation(selectRecent(returns, 30));
  const upsideReturns = selectRecent(returns.filter((value) => value > 0), 20);
  const downsideReturns = selectRecent(returns.filter((value) => value < 0).map((value) => Math.abs(value)), 20);
  const upsideRealizedVolPct = standardDeviation(upsideReturns);
  const downsideRealizedVolPct = standardDeviation(downsideReturns);
  const priorChannel = donchianChannel(highs, lows, 20, false);
  const currentChannel = donchianChannel(highs, lows, 20, true);
  const vwap = volumeWeightedAveragePrice(candles, 30);
  const priorVwap = volumeWeightedAveragePrice(candles, 30, 10);
  const anchoredVwap = volumeWeightedAveragePrice(candles, Math.min(90, Math.max(30, candles.length)));
  const priorAnchoredVwap = volumeWeightedAveragePrice(candles, Math.min(90, Math.max(30, Math.max(0, candles.length - 8))), 8);
  const obvSeries = buildObvSeries(candles);
  const obvBase = Math.max(Math.abs(obvSeries.at(-21) || 0), average(volumes, 1), 1);
  const lastRange = Math.max(lastCandle.high - lastCandle.low, 1e-9);
  const upperWick = Math.max(0, lastCandle.high - Math.max(lastCandle.open, lastCandle.close));
  const lowerWick = Math.max(0, Math.min(lastCandle.open, lastCandle.close) - lastCandle.low);
  const dominantSign = Math.sign(average(recentReturns, 0));
  const trendPersistence = recentReturns.length
    ? recentReturns.filter((value) => Math.sign(value) === dominantSign && Math.sign(value) !== 0).length / recentReturns.length
    : 0;
  const patterns = detectPatternFeatures(candles);
  const bollinger = bollingerBands(closes, 20, 2);
  const bollingerWidthPct = bollinger.basis ? (bollinger.upper - bollinger.lower) / bollinger.basis : 0;
  const bollingerPosition = Math.max(bollinger.upper - bollinger.lower, 1e-9)
    ? clamp((lastClose - bollinger.lower) / Math.max(bollinger.upper - bollinger.lower, 1e-9), 0, 1)
    : 0.5;
  const priceZScore = bollinger.deviation > 0 ? (lastClose - bollinger.basis) / bollinger.deviation : 0;
  const bollingerSqueezeScore = clamp(1 - clamp((bollingerWidthPct - 0.012) / 0.085, 0, 1), 0, 1);
  const donchianWidthPct = lastClose ? (currentChannel.upper - currentChannel.lower) / lastClose : 0;
  const donchianPosition = clamp((lastClose - currentChannel.lower) / Math.max(currentChannel.upper - currentChannel.lower, 1e-9), 0, 1);
  const donchianBreakoutPct = priorChannel.upper ? pctChange(priorChannel.upper, lastClose) : 0;
  const vwapSlopePct = priorVwap ? pctChange(priorVwap, vwap) : 0;
  const momentum5 = pctChange(closes[closes.length - 6], lastClose);
  const momentum20 = pctChange(closes[closes.length - 21], lastClose);
  const closeLocation = lastRange ? (lastCandle.close - lastCandle.low) / lastRange : 0.5;
  const liquiditySweep = detectLiquiditySweep(lastCandle, priorChannel.upper, priorChannel.lower);
  const structureBreak = detectStructureBreak(lastClose, priorChannel.upper, priorChannel.lower, momentum5, closeLocation);
  const swingStructure = computeSwingStructure(highs, lows, 8);
  const directionalAcceleration = computeDirectionalAcceleration(returns);
  const fvg = detectFairValueGap(candles);
  const bos = detectBreakOfStructure(candles);
  const cvd = computeCvdContext(candles, lastClose);
  const keltnerWidthPct = keltner.basis ? (keltner.upper - keltner.lower) / keltner.basis : 0;
  const insideKeltner = bollinger.upper <= keltner.upper && bollinger.lower >= keltner.lower ? 1 : 0;
  const squeezeCompression = keltnerWidthPct > 0 ? 1 - clamp(bollingerWidthPct / Math.max(keltnerWidthPct, 1e-9), 0, 1.6) : 0;
  const keltnerSqueezeScore = clamp(insideKeltner ? 0.72 + Math.max(squeezeCompression, 0) * 0.28 : Math.max(0, squeezeCompression + 0.35), 0, 1);
  const squeezeReleaseScore = clamp(keltnerSqueezeScore * 0.45 + bollingerSqueezeScore * 0.35 + clamp(closeLocation - 0.45, 0, 0.55) * 0.35 + Math.max(dmi.dmiSpread, 0) * 0.2, 0, 1);
  const trendQualityScore = clamp(((dmi.adx - 18) / 24) * 0.4 + dmi.dmiSpread * 1.6 * 0.35 + supertrendValue.direction * 0.18 + Math.max(supertrendValue.distancePct * 90, -1) * 0.07, -1, 1);
  const trendMaturityScore = clamp(
    Math.max(0, trendPersistence - 0.52) * 0.32 +
    Math.max(0, swingStructure.swingStructureScore) * 0.28 +
    Math.max(0, trendQualityScore) * 0.22 +
    Math.max(0, donchianPosition - 0.55) * 0.18,
    0,
    1
  );
  const trendExhaustionScore = clamp(
    Math.max(0, Math.abs(priceZScore) - 1.15) / 1.8 * 0.34 +
    Math.max(0, volumeZ - 1.4) / 2.4 * 0.2 +
    Math.max(directionalAcceleration.upsideAccelerationScore, directionalAcceleration.downsideAccelerationScore) * 0.24 +
    Math.max(0, Math.abs(donchianPosition - 0.5) - 0.36) / 0.14 * 0.22,
    0,
    1
  );
  const anchoredVwapAcceptanceScore = clamp(
    Math.max(0, 1 - Math.min(1, Math.abs(pctChange(anchoredVwap || lastClose || 1, lastClose)) * 75)) * 0.48 +
      Math.max(0, trendPersistence - 0.45) * 0.22 +
      Math.max(0, 1 - Math.abs(closeLocation - 0.5) * 1.6) * 0.15 +
      Math.max(0, 1 - Math.abs(dmi.dmiSpread) * 1.8) * 0.15,
    0,
    1
  );
  const anchoredVwapRejectionScore = clamp(
    Math.max(0, Math.abs(pctChange(anchoredVwap || lastClose || 1, lastClose)) * 55) * 0.42 +
      Math.max(0, Math.abs(closeLocation - 0.5) - 0.2) * 1.4 * 0.2 +
      Math.max(0, Math.abs(dmi.dmiSpread)) * 1.8 * 0.18 +
      Math.max(directionalAcceleration.upsideAccelerationScore, directionalAcceleration.downsideAccelerationScore) * 0.2,
    0,
    1
  );
  const trendFailureScore = clamp(
    Math.max(0, swingStructure.swingStructureScore) * 0.18 +
      Math.max(0, momentum20 * 28) * 0.18 +
      Math.max(0, trendQualityScore) * 0.16 +
      Math.max(0, 0.54 - closeLocation) * 0.2 +
      Math.max(0, directionalAcceleration.downsideAccelerationScore - directionalAcceleration.upsideAccelerationScore) * 0.16 +
      Math.max(0, -patterns.bearishPatternScore + 0.2) * 0 +
      Math.max(0, patterns.bearishPatternScore) * 0.12,
    0,
    1
  );
  const closeLocationQuality = clamp(
    momentum20 >= 0
      ? closeLocation * 0.7 + Math.max(0, 1 - upperWick / Math.max(lastRange, 1e-9)) * 0.3
      : (1 - closeLocation) * 0.7 + Math.max(0, 1 - lowerWick / Math.max(lastRange, 1e-9)) * 0.3,
    0,
    1
  );
  const breakoutFollowThroughScore = clamp(
    Math.max(0, Math.max(donchianBreakoutPct, 0) * 28) * 0.28 +
      Math.max(0, structureBreak.score) * 0.18 +
      Math.max(0, closeLocation - 0.52) * 0.24 +
      Math.max(0, volumeZ - 0.3) / 2.2 * 0.14 +
      Math.max(0, donchianPosition - 0.6) * 0.16,
    0,
    1
  );
  const volumeAcceptanceScore = clamp(
    Math.max(0, 1 - Math.abs(priceZScore) / 2.8) * 0.18 +
      Math.max(0, anchoredVwapAcceptanceScore) * 0.24 +
      Math.max(0, 1 - anchoredVwapRejectionScore) * 0.12 +
      Math.max(0, closeLocationQuality) * 0.16 +
      Math.max(0, cmf20 + 0.2) / 1.2 * 0.12 +
      Math.max(0, obvBase ? ((obvSeries.at(-1) || 0) - (obvSeries.at(-8) || 0)) / obvBase : 0) * 0.18,
    0,
    1
  );
  const rangeWidthPct = donchianWidthPct;
  const rangeTopDistancePct = lastClose ? Math.max(0, currentChannel.upper - lastClose) / lastClose : 0;
  const rangeBottomDistancePct = lastClose ? Math.max(0, lastClose - currentChannel.lower) / lastClose : 0;
  const rangeBoundaryRespectScore = clamp(
    average([
      clamp(1 - Math.abs(donchianPosition - 0.5) * 2.1, 0, 1),
      clamp(1 - Math.abs(swingStructure.swingStructureScore), 0, 1),
      clamp(1 - Math.abs(bos.structureShiftScore), 0, 1),
      clamp(1 - cvd.cvdDivergenceScore, 0, 1)
    ], 0.5),
    0,
    1
  );
  const rangeMeanRevertScore = clamp(
    average([
      clamp(1 - Math.abs(priceZScore) / 2.3, 0, 1),
      clamp(1 - Math.abs(dmi.dmiSpread) * 1.8, 0, 1),
      rangeBoundaryRespectScore,
      clamp(1 - Math.max(0, trendQualityScore), 0, 1)
    ], 0.45),
    0,
    1
  );
  const gridEntrySide = donchianPosition <= 0.32
    ? "buy_lower_band"
    : donchianPosition >= 0.68
      ? "sell_upper_band"
      : "none";

  return {
    lastClose,
    momentum5,
    momentum20,
    emaGap: lastClose ? (emaFast - emaSlow) / lastClose : 0,
    emaTrendSlopePct: priorFast ? pctChange(priorFast, emaFast) : 0,
    emaTrendScore: lastClose ? (((emaFast - emaSlow) / lastClose) * 0.65 + (priorFast ? pctChange(priorFast, emaFast) * 0.35 : 0)) : 0,
    rsi14,
    adx14: dmi.adx,
    plusDi14: dmi.plusDi,
    minusDi14: dmi.minusDi,
    dmiSpread: dmi.dmiSpread,
    trendQualityScore,
    stochRsiK: stochRsiValues.k,
    stochRsiD: stochRsiValues.d,
    mfi14,
    cmf20,
    atrPct: lastClose ? atr14 / lastClose : 0,
    atrExpansion: atr30 ? atr14 / atr30 - 1 : 0,
    macdHistogramPct: lastClose ? macdValues.histogram / lastClose : 0,
    realizedVolPct,
    upsideRealizedVolPct,
    downsideRealizedVolPct,
    volumeZ,
    breakoutPct: priorChannel.upper ? pctChange(priorChannel.upper, lastClose) : 0,
    trendStrength: lastClose ? pctChange(sma(closes, 50), lastClose) : 0,
    vwapGapPct: vwap ? pctChange(vwap, lastClose) : 0,
    vwapSlopePct,
    anchoredVwapGapPct: anchoredVwap ? pctChange(anchoredVwap, lastClose) : 0,
    anchoredVwapSlopePct: priorAnchoredVwap ? pctChange(priorAnchoredVwap, anchoredVwap) : 0,
    anchoredVwapAcceptanceScore,
    anchoredVwapRejectionScore,
    obvSlope: obvBase ? ((obvSeries.at(-1) || 0) - (obvSeries.at(-21) || 0)) / obvBase : 0,
    rangeCompression: atr30 ? atr14 / atr30 : 1,
    candleBodyRatio: lastRange ? Math.abs(lastCandle.close - lastCandle.open) / lastRange : 0,
    wickSkew: lastRange ? (upperWick - lowerWick) / lastRange : 0,
    closeLocation,
    trendPersistence,
    swingStructureScore: swingStructure.swingStructureScore,
    higherHighRate: swingStructure.higherHighRate,
    higherLowRate: swingStructure.higherLowRate,
    lowerHighRate: swingStructure.lowerHighRate,
    lowerLowRate: swingStructure.lowerLowRate,
    upsideAccelerationScore: directionalAcceleration.upsideAccelerationScore,
    downsideAccelerationScore: directionalAcceleration.downsideAccelerationScore,
    trendMaturityScore,
    trendExhaustionScore,
    trendFailureScore,
    closeLocationQuality,
    breakoutFollowThroughScore,
    volumeAcceptanceScore,
    bullishPatternScore: patterns.bullishPatternScore,
    bearishPatternScore: patterns.bearishPatternScore,
    insideBar: patterns.insideBar,
    dominantPattern: patterns.dominantPattern,
    donchianUpper: currentChannel.upper,
    donchianLower: currentChannel.lower,
    donchianWidthPct,
    donchianPosition,
    donchianBreakoutPct,
    bollingerWidthPct,
    bollingerPosition,
    bollingerSqueezeScore,
    priceZScore,
    keltnerUpper: keltner.upper,
    keltnerLower: keltner.lower,
    keltnerWidthPct,
    keltnerSqueezeScore,
    squeezeReleaseScore,
    supertrendLine: supertrendValue.line,
    supertrendDirection: supertrendValue.direction,
    supertrendDistancePct: supertrendValue.distancePct,
    supertrendFlipScore: supertrendValue.flipScore,
    liquiditySweepScore: liquiditySweep.score,
    liquiditySweepLabel: liquiditySweep.label,
    structureBreakScore: structureBreak.score,
    structureBreakLabel: structureBreak.label,
    bullishFvgActive: fvg.bullishFvgActive,
    bearishFvgActive: fvg.bearishFvgActive,
    nearestBullishFvgDistancePct: fvg.nearestBullishFvgDistancePct,
    nearestBearishFvgDistancePct: fvg.nearestBearishFvgDistancePct,
    fvgFillProgress: fvg.fvgFillProgress,
    fvgWidthPct: fvg.fvgWidthPct,
    fvgRespectScore: fvg.fvgRespectScore,
    bullishBosActive: bos.bullishBosActive,
    bearishBosActive: bos.bearishBosActive,
    bosStrengthScore: bos.bosStrengthScore,
    structureShiftScore: bos.structureShiftScore,
    swingHighBreakScore: bos.swingHighBreakScore,
    swingLowBreakScore: bos.swingLowBreakScore,
    cvdValue: cvd.cvdValue,
    cvdSlope: cvd.cvdSlope,
    cvdMomentum: cvd.cvdMomentum,
    cvdDivergenceScore: cvd.cvdDivergenceScore,
    cvdConfirmationScore: cvd.cvdConfirmationScore,
    cvdTrendAlignment: cvd.cvdTrendAlignment,
    cvdConfidence: cvd.cvdConfidence,
    rangeWidthPct,
    rangeTopDistancePct,
    rangeBottomDistancePct,
    rangeMeanRevertScore,
    rangeBoundaryRespectScore,
    gridEntrySide
  };
}

export function computeOrderBookFeatures(bookTicker, orderBook) {
  const bid = Number(bookTicker.bidPrice || 0);
  const ask = Number(bookTicker.askPrice || 0);
  const mid = bid && ask ? (bid + ask) / 2 : bid || ask || 0;
  const spreadBps = mid ? ((ask - bid) / mid) * 10_000 : 0;

  const topBids = (orderBook.bids || []).slice(0, 10).map(([price, quantity]) => [Number(price), Number(quantity)]);
  const topAsks = (orderBook.asks || []).slice(0, 10).map(([price, quantity]) => [Number(price), Number(quantity)]);
  const bidNotional = topBids.reduce((total, [price, quantity]) => total + price * quantity, 0);
  const askNotional = topAsks.reduce((total, [price, quantity]) => total + price * quantity, 0);
  const totalDepth = bidNotional + askNotional;
  const weightedBidNotional = topBids.reduce((total, [price, quantity], index) => total + price * quantity / (index + 1), 0);
  const weightedAskNotional = topAsks.reduce((total, [price, quantity], index) => total + price * quantity / (index + 1), 0);
  const weightedTotal = weightedBidNotional + weightedAskNotional;
  const bestBidQty = topBids[0]?.[1] || 0;
  const bestAskQty = topAsks[0]?.[1] || 0;
  const microPrice = bestBidQty + bestAskQty ? ((ask * bestBidQty) + (bid * bestAskQty)) / (bestBidQty + bestAskQty) : mid;
  const microPriceEdgeBps = mid ? ((microPrice - mid) / mid) * 10_000 : 0;
  const bidConcentration = bidNotional ? ((topBids[0]?.[0] || 0) * (topBids[0]?.[1] || 0)) / bidNotional : 0;
  const askConcentration = askNotional ? ((topAsks[0]?.[0] || 0) * (topAsks[0]?.[1] || 0)) / askNotional : 0;
  const averageBidLevel = topBids.length ? bidNotional / topBids.length : 0;
  const averageAskLevel = topAsks.length ? askNotional / topAsks.length : 0;
  const maxBidLevel = topBids.reduce((max, [price, quantity]) => Math.max(max, price * quantity), 0);
  const maxAskLevel = topAsks.reduce((max, [price, quantity]) => Math.max(max, price * quantity), 0);
  const bidWallScore = averageBidLevel ? clamp((maxBidLevel / averageBidLevel - 1) / 2.4, 0, 1) : 0;
  const askWallScore = averageAskLevel ? clamp((maxAskLevel / averageAskLevel - 1) / 2.4, 0, 1) : 0;
  const wallImbalance = clamp(bidWallScore - askWallScore, -1, 1);
  const weightedDepthImbalance = weightedTotal ? (weightedBidNotional - weightedAskNotional) / weightedTotal : 0;
  const bookPressure = clamp(weightedDepthImbalance * 0.58 + clamp(microPriceEdgeBps / 5, -1, 1) * 0.27 + wallImbalance * 0.15, -1, 1);
  const orderbookImbalanceSignal = clamp(bookPressure * 0.55 + weightedDepthImbalance * 0.25 + wallImbalance * 0.2, -1, 1);

  return {
    bid,
    ask,
    mid,
    spreadBps,
    depthImbalance: totalDepth ? (bidNotional - askNotional) / totalDepth : 0,
    weightedDepthImbalance,
    microPrice,
    microPriceEdgeBps,
    bidConcentration,
    askConcentration,
    wallImbalance,
    bookPressure,
    orderbookImbalanceSignal
  };
}

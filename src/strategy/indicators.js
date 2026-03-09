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
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
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
  const end = offset > 0 ? candles.length - offset : candles.length;
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
  const breakoutBase = Math.max(...selectRecent(highs, 20));
  const priorChannel = donchianChannel(highs, lows, 20, false);
  const currentChannel = donchianChannel(highs, lows, 20, true);
  const vwap = volumeWeightedAveragePrice(candles, 30);
  const priorVwap = volumeWeightedAveragePrice(candles, 30, 10);
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

  return {
    lastClose,
    momentum5,
    momentum20,
    emaGap: lastClose ? (emaFast - emaSlow) / lastClose : 0,
    emaTrendSlopePct: priorFast ? pctChange(priorFast, emaFast) : 0,
    emaTrendScore: lastClose ? (((emaFast - emaSlow) / lastClose) * 0.65 + (priorFast ? pctChange(priorFast, emaFast) * 0.35 : 0)) : 0,
    rsi14,
    atrPct: lastClose ? atr14 / lastClose : 0,
    atrExpansion: atr30 ? atr14 / atr30 - 1 : 0,
    macdHistogramPct: lastClose ? macdValues.histogram / lastClose : 0,
    realizedVolPct,
    volumeZ,
    breakoutPct: breakoutBase ? pctChange(breakoutBase, lastClose) : 0,
    trendStrength: lastClose ? pctChange(sma(closes, 50), lastClose) : 0,
    vwapGapPct: vwap ? pctChange(vwap, lastClose) : 0,
    vwapSlopePct,
    obvSlope: obvBase ? ((obvSeries.at(-1) || 0) - (obvSeries.at(-21) || 0)) / obvBase : 0,
    rangeCompression: atr30 ? atr14 / atr30 : 1,
    candleBodyRatio: lastRange ? Math.abs(lastCandle.close - lastCandle.open) / lastRange : 0,
    wickSkew: lastRange ? (upperWick - lowerWick) / lastRange : 0,
    closeLocation,
    trendPersistence,
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
    liquiditySweepScore: liquiditySweep.score,
    liquiditySweepLabel: liquiditySweep.label,
    structureBreakScore: structureBreak.score,
    structureBreakLabel: structureBreak.label
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

import { AdaptiveTradingModel } from "../ai/adaptiveModel.js";
import { BinanceClient, normalizeKlines } from "../binance/client.js";
import { buildFeatureVector } from "../strategy/features.js";
import { computeMarketFeatures } from "../strategy/indicators.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { buildPerformanceReport } from "./reportBuilder.js";
import { nowIso } from "../utils/time.js";

function num(value, decimals = 4, fallback = 0) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : fallback;
}

function average(values = []) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function buildSyntheticBook(candle, config) {
  const slippageRate = config.paperSlippageBps / 10_000;
  return {
    bid: candle.close * (1 - slippageRate),
    ask: candle.close * (1 + slippageRate),
    mid: candle.close,
    spreadBps: config.paperSlippageBps * 2,
    depthImbalance: 0,
    weightedDepthImbalance: 0,
    tradeFlowImbalance: 0,
    microTrend: 0,
    recentTradeCount: 0,
    bookPressure: 0,
    microPriceEdgeBps: 0,
    depthConfidence: 0.4,
    queueImbalance: 0,
    queueRefreshScore: 0,
    resilienceScore: 0
  };
}

function buildNewsSummary() {
  return {
    coverage: 0,
    sentimentScore: 0,
    riskScore: 0,
    confidence: 0,
    headlines: [],
    dominantEventType: "general",
    eventBullishScore: 0,
    eventBearishScore: 0,
    eventRiskScore: 0,
    maxSeverity: 0,
    sourceQualityScore: 0,
    providerDiversity: 0,
    sourceDiversity: 0,
    reliabilityScore: 0,
    whitelistCoverage: 0
  };
}

function buildContext({ candles, index, symbol, model, config }) {
  const candle = candles[index];
  const slice = candles.slice(0, index + 1);
  const market = computeMarketFeatures(slice);
  const book = buildSyntheticBook(candle, config);
  const newsSummary = buildNewsSummary();
  const regimeSummary = model.inferRegime({
    marketFeatures: market,
    newsSummary,
    streamFeatures: { tradeFlowImbalance: 0, microTrend: 0 },
    bookFeatures: book
  });
  const strategySummary = evaluateStrategySet({
    symbol,
    marketSnapshot: { market, book },
    newsSummary,
    regimeSummary,
    streamFeatures: { tradeFlowImbalance: 0, microTrend: 0 }
  });
  const rawFeatures = buildFeatureVector({
    symbolStats: model.getSymbolStats(symbol),
    marketFeatures: market,
    bookFeatures: book,
    newsSummary,
    portfolioFeatures: { heat: 0, maxCorrelation: 0 },
    streamFeatures: { tradeFlowImbalance: 0, microTrend: 0 },
    regimeSummary,
    strategySummary,
    now: new Date(candle.closeTime)
  });
  return {
    candle,
    market,
    book,
    newsSummary,
    regimeSummary,
    strategySummary,
    rawFeatures
  };
}

function buildLabelTrade({ symbol, rawFeatures, regimeSummary, strategySummary, candle, futureCandles }) {
  const exitCandle = futureCandles.at(-1);
  const futureHigh = Math.max(...futureCandles.map((item) => item.high));
  const futureLow = Math.min(...futureCandles.map((item) => item.low));
  const entryPrice = candle.close;
  const exitPrice = exitCandle?.close || entryPrice;
  return {
    symbol,
    rawFeatures,
    netPnlPct: entryPrice ? (exitPrice - entryPrice) / entryPrice : 0,
    pnlQuote: entryPrice ? (exitPrice - entryPrice) / entryPrice * 100 : 0,
    mfePct: entryPrice ? Math.max(0, (futureHigh - entryPrice) / entryPrice) : 0,
    maePct: entryPrice ? Math.min(0, (futureLow - entryPrice) / entryPrice) : 0,
    executionQualityScore: 0.7,
    regimeAtEntry: regimeSummary.regime,
    strategyAtEntry: strategySummary.activeStrategy || null,
    exitAt: new Date(exitCandle?.closeTime || candle.closeTime).toISOString()
  };
}

function computeSharpe(trades = []) {
  if (trades.length < 2) {
    return 0;
  }
  const returns = trades.map((trade) => trade.netPnlPct || 0);
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  const stdev = Math.sqrt(variance);
  if (!stdev) {
    return mean > 0 ? 2 : 0;
  }
  return mean / stdev * Math.sqrt(Math.min(returns.length, 24));
}

function computeExpectancy(trades = []) {
  if (!trades.length) {
    return 0;
  }
  const wins = trades.filter((trade) => (trade.pnlQuote || 0) > 0);
  const losses = trades.filter((trade) => (trade.pnlQuote || 0) <= 0);
  const winRate = wins.length / trades.length;
  const avgWin = average(wins.map((trade) => trade.pnlQuote || 0));
  const avgLoss = Math.abs(average(losses.map((trade) => trade.pnlQuote || 0)));
  return winRate * avgWin - (1 - winRate) * avgLoss;
}

export function buildWalkForwardWindows(totalCandles, config) {
  const warmup = Math.max(60, Math.floor(config.transformerLookbackCandles || 24));
  const trainCandles = Math.max(config.researchTrainCandles, warmup + 24);
  const testCandles = Math.max(24, config.researchTestCandles);
  const stepCandles = Math.max(12, config.researchStepCandles);
  const windows = [];

  for (
    let start = warmup;
    start + trainCandles + testCandles <= totalCandles && windows.length < config.researchMaxWindows;
    start += stepCandles
  ) {
    windows.push({
      warmupStart: Math.max(0, start - warmup),
      trainStart: start,
      trainEnd: start + trainCandles,
      testStart: start + trainCandles,
      testEnd: start + trainCandles + testCandles
    });
  }

  return windows;
}

export function runWalkForwardExperiment({ candles, config, symbol }) {
  const windows = buildWalkForwardWindows(candles.length, config);
  const horizon = 3;
  const feeRate = config.paperFeeBps / 10_000;
  const slippageRate = config.paperSlippageBps / 10_000;
  const experiments = [];

  for (const window of windows) {
    const model = new AdaptiveTradingModel(undefined, config);
    for (let index = window.trainStart; index < window.trainEnd - horizon; index += 1) {
      const context = buildContext({ candles, index, symbol, model, config });
      const labelTrade = buildLabelTrade({
        symbol,
        rawFeatures: context.rawFeatures,
        regimeSummary: context.regimeSummary,
        strategySummary: context.strategySummary,
        candle: context.candle,
        futureCandles: candles.slice(index + 1, index + 1 + horizon)
      });
      model.updateFromTrade(labelTrade);
    }

    let quoteFree = config.startingCash;
    let position = null;
    const trades = [];
    const equitySnapshots = [];

    for (let index = window.testStart; index < window.testEnd; index += 1) {
      const context = buildContext({ candles, index, symbol, model, config });
      const score = model.score(context.rawFeatures, {
        regimeSummary: context.regimeSummary,
        marketFeatures: context.market,
        marketSnapshot: { candles: candles.slice(0, index + 1), market: context.market, book: context.book },
        newsSummary: context.newsSummary,
        streamFeatures: { tradeFlowImbalance: 0, microTrend: 0 },
        bookFeatures: context.book
      });

      if (position) {
        position.highestPrice = Math.max(position.highestPrice, context.candle.high);
        position.lowestPrice = Math.min(position.lowestPrice, context.candle.low);
        const ageCandles = index - position.entryIndex;
        const trailingStopPrice = position.highestPrice * (1 - config.trailingStopPct);
        let exitReason = null;
        let exitPrice = null;

        if (context.candle.low <= position.stopLossPrice) {
          exitReason = "stop_loss";
          exitPrice = position.stopLossPrice;
        } else if (context.candle.high >= position.takeProfitPrice) {
          exitReason = "take_profit";
          exitPrice = position.takeProfitPrice;
        } else if (position.highestPrice > position.entryPrice * 1.004 && context.candle.low <= trailingStopPrice) {
          exitReason = "trailing_stop";
          exitPrice = trailingStopPrice;
        } else if (ageCandles >= horizon) {
          exitReason = "time_stop";
          exitPrice = context.candle.close;
        }

        if (exitReason) {
          const grossProceeds = position.quantity * exitPrice * (1 - slippageRate);
          const fee = grossProceeds * feeRate;
          const proceeds = grossProceeds - fee;
          const pnlQuote = proceeds - position.totalCost;
          const netPnlPct = position.totalCost ? pnlQuote / position.totalCost : 0;
          quoteFree += proceeds;
          const trade = {
            id: `${symbol}-${window.testStart}-${index}`,
            symbol,
            entryAt: new Date(position.entryTime).toISOString(),
            exitAt: new Date(context.candle.closeTime).toISOString(),
            entryPrice: position.entryPrice,
            exitPrice,
            quantity: position.quantity,
            totalCost: position.totalCost,
            proceeds,
            pnlQuote,
            netPnlPct,
            mfePct: position.entryPrice ? Math.max(0, (position.highestPrice - position.entryPrice) / position.entryPrice) : 0,
            maePct: position.entryPrice ? Math.min(0, (position.lowestPrice - position.entryPrice) / position.entryPrice) : 0,
            regimeAtEntry: position.regimeAtEntry,
            strategyAtEntry: position.strategyAtEntry,
            reason: exitReason,
            brokerMode: "research"
          };
          trades.push(trade);
          model.updateFromTrade({
            ...trade,
            rawFeatures: position.rawFeatures,
            executionQualityScore: 0.72
          });
          position = null;
        }
      }

      if (!position && !score.shouldAbstain && score.probability >= config.modelThreshold) {
        const quoteAmount = Math.min(
          quoteFree * config.maxPositionFraction,
          (quoteFree * config.riskPerTrade) / Math.max(context.market.atrPct * 1.2, config.stopLossPct, 0.01)
        );
        if (quoteAmount >= config.minTradeUsdt) {
          const entryPrice = context.candle.close * (1 + slippageRate);
          const fee = quoteAmount * feeRate;
          const totalCost = quoteAmount + fee;
          const quantity = quoteAmount / entryPrice;
          quoteFree -= totalCost;
          position = {
            entryIndex: index,
            entryTime: context.candle.closeTime,
            entryPrice,
            quantity,
            totalCost,
            stopLossPrice: entryPrice * (1 - Math.max(config.stopLossPct, context.market.atrPct * 1.2)),
            takeProfitPrice: entryPrice * (1 + Math.max(config.takeProfitPct, context.market.atrPct * 1.8)),
            highestPrice: entryPrice,
            lowestPrice: entryPrice,
            rawFeatures: context.rawFeatures,
            strategyAtEntry: context.strategySummary.activeStrategy || null,
            regimeAtEntry: context.regimeSummary.regime
          };
        }
      }

      equitySnapshots.push({
        at: new Date(context.candle.closeTime).toISOString(),
        equity: quoteFree + (position ? position.quantity * context.candle.close : 0),
        quoteFree,
        openPositions: position ? 1 : 0
      });
    }

    const report = buildPerformanceReport({
      journal: { trades, equitySnapshots, scaleOuts: [], blockedSetups: [], researchRuns: [] },
      runtime: { openPositions: position ? [position] : [] },
      config
    });
    experiments.push({
      symbol,
      generatedAt: nowIso(),
      trainStartAt: candles[window.trainStart]?.closeTime ? new Date(candles[window.trainStart].closeTime).toISOString() : null,
      testStartAt: candles[window.testStart]?.closeTime ? new Date(candles[window.testStart].closeTime).toISOString() : null,
      testEndAt: candles[Math.max(window.testEnd - 1, 0)]?.closeTime ? new Date(candles[Math.max(window.testEnd - 1, 0)].closeTime).toISOString() : null,
      tradeCount: report.tradeCount || 0,
      winRate: num(report.winRate || 0, 4),
      realizedPnl: num(report.realizedPnl || 0, 2),
      averagePnlPct: num(report.averagePnlPct || 0, 4),
      maxDrawdownPct: num(report.maxDrawdownPct || 0, 4),
      profitFactor: Number.isFinite(report.profitFactor) ? num(report.profitFactor, 3) : null,
      sharpe: num(computeSharpe(trades), 3),
      expectancy: num(computeExpectancy(trades), 2),
      bestTrade: report.bestTrade || null,
      worstTrade: report.worstTrade || null,
      strategyLeaders: [...new Set(trades.map((trade) => trade.strategyAtEntry).filter(Boolean))].slice(0, 4)
    });
  }

  return {
    symbol,
    generatedAt: nowIso(),
    experimentCount: experiments.length,
    totalTrades: experiments.reduce((total, item) => total + (item.tradeCount || 0), 0),
    realizedPnl: num(experiments.reduce((total, item) => total + (item.realizedPnl || 0), 0), 2),
    averageWinRate: num(average(experiments.map((item) => item.winRate || 0)), 4),
    averageSharpe: num(average(experiments.map((item) => item.sharpe || 0)), 3),
    averageExpectancy: num(average(experiments.map((item) => item.expectancy || 0)), 2),
    maxDrawdownPct: num(Math.max(0, ...experiments.map((item) => item.maxDrawdownPct || 0)), 4),
    experiments
  };
}

export async function runResearchLab({ config, logger, symbols = [] }) {
  const client = new BinanceClient({
    apiKey: "",
    apiSecret: "",
    baseUrl: config.binanceApiBaseUrl,
    recvWindow: config.binanceRecvWindow,
    logger
  });
  const selectedSymbols = (symbols.length ? symbols : config.watchlist).slice(0, config.researchMaxSymbols);
  const reports = [];

  for (const symbol of selectedSymbols) {
    const rawKlines = await client.getKlines(symbol, config.klineInterval, config.researchCandleLimit);
    const candles = normalizeKlines(rawKlines);
    reports.push(runWalkForwardExperiment({ candles, config, symbol }));
  }

  const bestSymbol = [...reports].sort((left, right) => (right.realizedPnl || 0) - (left.realizedPnl || 0))[0] || null;
  return {
    generatedAt: nowIso(),
    symbolCount: reports.length,
    bestSymbol: bestSymbol?.symbol || null,
    totalTrades: reports.reduce((total, item) => total + (item.totalTrades || 0), 0),
    realizedPnl: num(reports.reduce((total, item) => total + (item.realizedPnl || 0), 0), 2),
    averageSharpe: num(average(reports.map((item) => item.averageSharpe || 0)), 3),
    averageWinRate: num(average(reports.map((item) => item.averageWinRate || 0)), 4),
    reports
  };
}

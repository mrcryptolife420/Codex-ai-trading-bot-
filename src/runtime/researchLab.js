import { AdaptiveTradingModel } from "../ai/adaptiveModel.js";
import { BinanceClient, normalizeKlines } from "../binance/client.js";
import { ExecutionEngine } from "../execution/executionEngine.js";
import { buildFeatureVector } from "../strategy/features.js";
import { computeMarketFeatures } from "../strategy/indicators.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { buildPerformanceReport, buildTradeQualityReview } from "./reportBuilder.js";
import { nowIso } from "../utils/time.js";

function num(value, decimals = 4, fallback = 0) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : fallback;
}

function average(values = []) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function bucketStats(trades = [], key) {
  const map = new Map();
  for (const trade of trades) {
    const id = key(trade) || "unknown";
    if (!map.has(id)) {
      map.set(id, { id, tradeCount: 0, realizedPnl: 0, winCount: 0 });
    }
    const bucket = map.get(id);
    bucket.tradeCount += 1;
    bucket.realizedPnl += trade.pnlQuote || 0;
    bucket.winCount += (trade.pnlQuote || 0) > 0 ? 1 : 0;
  }
  return [...map.values()]
    .map((item) => ({
      id: item.id,
      tradeCount: item.tradeCount,
      realizedPnl: num(item.realizedPnl, 2),
      winRate: num(item.tradeCount ? item.winCount / item.tradeCount : 0, 4)
    }))
    .sort((left, right) => right.realizedPnl - left.realizedPnl);
}

function buildScorecards(trades = [], keyFn) {
  const map = new Map();
  for (const trade of trades) {
    const id = keyFn(trade) || "unknown";
    if (!map.has(id)) {
      map.set(id, { id, tradeCount: 0, realizedPnl: 0, review: 0, sharpe: [], winCount: 0 });
    }
    const bucket = map.get(id);
    const review = buildTradeQualityReview(trade);
    bucket.tradeCount += 1;
    bucket.realizedPnl += trade.pnlQuote || 0;
    bucket.review += review.compositeScore || 0;
    bucket.sharpe.push(trade.netPnlPct || 0);
    bucket.winCount += (trade.pnlQuote || 0) > 0 ? 1 : 0;
  }
  return [...map.values()]
    .map((bucket) => ({
      id: bucket.id,
      tradeCount: bucket.tradeCount,
      realizedPnl: num(bucket.realizedPnl, 2),
      averageReviewScore: num(bucket.tradeCount ? bucket.review / bucket.tradeCount : 0, 4),
      winRate: num(bucket.tradeCount ? bucket.winCount / bucket.tradeCount : 0, 4),
      governanceScore: num(Math.max(0, Math.min(1, 0.42 + (bucket.tradeCount ? bucket.review / bucket.tradeCount : 0) * 0.42 + (bucket.tradeCount ? bucket.winCount / bucket.tradeCount - 0.5 : 0) * 0.18 + Math.max(-0.12, Math.min(0.12, bucket.realizedPnl / Math.max(bucket.tradeCount * 70, 70))))), 4)
    }))
    .sort((left, right) => right.governanceScore - left.governanceScore)
    .slice(0, 8);
}

function buildSyntheticBook(candle, market, config) {
  const spreadBps = Math.max(config.paperSlippageBps * 1.6, 4 + Math.abs(market.momentum5 || 0) * 10_000 * 0.04);
  const mid = candle.close;
  const halfSpread = spreadBps / 20_000;
  const depthNotional = config.backtestSyntheticDepthUsd * Math.max(0.35, 1 - (market.realizedVolPct || 0));
  return {
    bid: mid * (1 - halfSpread),
    ask: mid * (1 + halfSpread),
    mid,
    spreadBps,
    depthImbalance: Math.max(-1, Math.min(1, (market.momentum5 || 0) * 90)),
    weightedDepthImbalance: Math.max(-1, Math.min(1, (market.momentum20 || 0) * 70)),
    tradeFlowImbalance: Math.max(-1, Math.min(1, (market.momentum5 || 0) * 120)),
    microTrend: market.momentum5 || 0,
    recentTradeCount: 8,
    bookPressure: Math.max(-1, Math.min(1, (market.momentum20 || 0) * 85)),
    microPriceEdgeBps: 0.4,
    depthConfidence: Math.max(0.34, 1 - (market.realizedVolPct || 0) * 8),
    totalDepthNotional: depthNotional,
    queueImbalance: Math.max(-1, Math.min(1, (market.momentum5 || 0) * 100)),
    queueRefreshScore: Math.max(0, 0.4 + (market.volumeZ || 0) * 0.08),
    resilienceScore: Math.max(0, 0.45 - (market.realizedVolPct || 0) * 2),
    localBook: {
      synced: true,
      depthConfidence: Math.max(0.34, 1 - (market.realizedVolPct || 0) * 8),
      totalDepthNotional: depthNotional,
      queueImbalance: Math.max(-1, Math.min(1, (market.momentum5 || 0) * 100)),
      queueRefreshScore: Math.max(0, 0.4 + (market.volumeZ || 0) * 0.08),
      resilienceScore: Math.max(0, 0.45 - (market.realizedVolPct || 0) * 2)
    }
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
  const book = buildSyntheticBook(candle, market, config);
  const newsSummary = buildNewsSummary();
  const regimeSummary = model.inferRegime({
    marketFeatures: market,
    newsSummary,
    streamFeatures: { tradeFlowImbalance: book.tradeFlowImbalance, microTrend: book.microTrend },
    bookFeatures: book
  });
  const strategySummary = evaluateStrategySet({
    symbol,
    marketSnapshot: { market, book },
    newsSummary,
    regimeSummary,
    streamFeatures: { tradeFlowImbalance: book.tradeFlowImbalance, microTrend: book.microTrend }
  });
  const rawFeatures = buildFeatureVector({
    symbolStats: model.getSymbolStats(symbol),
    marketFeatures: market,
    bookFeatures: book,
    newsSummary,
    portfolioFeatures: { heat: 0, maxCorrelation: 0 },
    streamFeatures: { tradeFlowImbalance: book.tradeFlowImbalance, microTrend: book.microTrend },
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
  const execution = new ExecutionEngine(config);
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
        streamFeatures: { tradeFlowImbalance: context.book.tradeFlowImbalance, microTrend: context.book.microTrend },
        bookFeatures: context.book
      });

      if (position) {
        position.highestPrice = Math.max(position.highestPrice, context.candle.high);
        position.lowestPrice = Math.min(position.lowestPrice, context.candle.low);
        const ageCandles = index - position.entryIndex;
        const trailingStopPrice = position.highestPrice * (1 - config.trailingStopPct);
        let exitReason = null;

        if (context.candle.low <= position.stopLossPrice) {
          exitReason = "stop_loss";
        } else if (context.candle.high >= position.takeProfitPrice) {
          exitReason = "take_profit";
        } else if (position.highestPrice > position.entryPrice * 1.004 && context.candle.low <= trailingStopPrice) {
          exitReason = "trailing_stop";
        } else if (ageCandles >= horizon) {
          exitReason = "time_stop";
        }

        if (exitReason) {
          const fillEstimate = execution.simulatePaperFill({
            marketSnapshot: { market: context.market, book: context.book },
            side: "SELL",
            requestedQuantity: position.quantity,
            plan: { ...(position.executionPlan || {}), entryStyle: "market", fallbackStyle: "none", preferMaker: false },
            latencyMs: config.backtestLatencyMs
          });
          const grossProceeds = fillEstimate.executedQuantity * fillEstimate.fillPrice;
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
            exitPrice: fillEstimate.fillPrice,
            quantity: fillEstimate.executedQuantity,
            totalCost: position.totalCost,
            proceeds,
            pnlQuote,
            netPnlPct,
            mfePct: position.entryPrice ? Math.max(0, (position.highestPrice - position.entryPrice) / position.entryPrice) : 0,
            maePct: position.entryPrice ? Math.min(0, (position.lowestPrice - position.entryPrice) / position.entryPrice) : 0,
            regimeAtEntry: position.regimeAtEntry,
            strategyAtEntry: position.strategyAtEntry,
            reason: exitReason,
            brokerMode: "research",
            entryExecutionAttribution: execution.buildExecutionAttribution({
              plan: position.executionPlan,
              marketSnapshot: { market: context.market, book: context.book },
              side: "BUY",
              fillPrice: position.entryPrice,
              requestedQuoteAmount: position.requestedQuoteAmount,
              executedQuote: position.notional,
              executedQuantity: position.quantity,
              fillEstimate: position.entryFillEstimate,
              orderTelemetry: { makerFillRatio: position.entryFillEstimate?.makerFillRatio, takerFillRatio: position.entryFillEstimate?.takerFillRatio },
              brokerMode: "research"
            }),
            exitExecutionAttribution: execution.buildExecutionAttribution({
              plan: { ...(position.executionPlan || {}), entryStyle: "market", fallbackStyle: "none", preferMaker: false },
              marketSnapshot: { market: context.market, book: context.book },
              side: "SELL",
              fillPrice: fillEstimate.fillPrice,
              requestedQuoteAmount: position.totalCost,
              executedQuote: grossProceeds,
              executedQuantity: fillEstimate.executedQuantity,
              fillEstimate,
              orderTelemetry: { makerFillRatio: fillEstimate.makerFillRatio, takerFillRatio: fillEstimate.takerFillRatio, workingTimeMs: fillEstimate.workingTimeMs, notes: fillEstimate.notes },
              brokerMode: "research"
            })
          };
          trades.push(trade);
          model.updateFromTrade({
            ...trade,
            rawFeatures: position.rawFeatures,
            executionQualityScore: 0.72,
            captureEfficiency: position.probabilityAtEntry ? netPnlPct / Math.max(position.probabilityAtEntry, 0.05) : 0
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
          const stopLossPct = Math.max(config.stopLossPct, context.market.atrPct * 1.2, 0.01);
          const takeProfitPct = Math.max(config.takeProfitPct, context.market.atrPct * 1.8);
          const decision = { stopLossPct, takeProfitPct, regime: context.regimeSummary.regime, portfolioSummary: { sizeMultiplier: 1 } };
          const plan = execution.buildEntryPlan({
            symbol,
            marketSnapshot: { market: context.market, book: context.book },
            score,
            decision,
            regimeSummary: context.regimeSummary,
            strategySummary: context.strategySummary,
            portfolioSummary: { sizeMultiplier: 1 },
            committeeSummary: score.committee,
            rlAdvice: { action: "balanced" }
          });
          const fillEstimate = execution.simulatePaperFill({
            marketSnapshot: { market: context.market, book: context.book },
            side: "BUY",
            requestedQuoteAmount: quoteAmount,
            plan,
            latencyMs: config.backtestLatencyMs
          });
          const fee = fillEstimate.executedQuote * feeRate;
          const totalCost = fillEstimate.executedQuote + fee;
          if (fillEstimate.executedQuote >= config.minTradeUsdt && totalCost <= quoteFree) {
            quoteFree -= totalCost;
            position = {
              entryIndex: index,
              entryTime: context.candle.closeTime,
              entryPrice: fillEstimate.fillPrice,
              quantity: fillEstimate.executedQuantity,
              notional: fillEstimate.executedQuote,
              requestedQuoteAmount: quoteAmount,
              totalCost,
              stopLossPrice: fillEstimate.fillPrice * (1 - stopLossPct),
              takeProfitPrice: fillEstimate.fillPrice * (1 + takeProfitPct),
              highestPrice: fillEstimate.fillPrice,
              lowestPrice: fillEstimate.fillPrice,
              rawFeatures: context.rawFeatures,
              strategyAtEntry: context.strategySummary.activeStrategy || null,
              regimeAtEntry: context.regimeSummary.regime,
              executionPlan: plan,
              entryFillEstimate: fillEstimate,
              probabilityAtEntry: score.probability
            };
          }
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
      journal: { trades, equitySnapshots, scaleOuts: [], blockedSetups: [], researchRuns: [], counterfactuals: [] },
      runtime: { openPositions: position ? [position] : [] },
      config
    });
    const strategyScorecards = buildScorecards(trades, (trade) => trade.strategyAtEntry || "unknown");
    const familyScorecards = buildScorecards(trades, (trade) => (trade.strategyAtEntry || "").split("_")[0] || trade.strategyAtEntry || "unknown");
    const regimeScorecards = buildScorecards(trades, (trade) => trade.regimeAtEntry || "unknown");
    experiments.push({
      symbol,
      generatedAt: nowIso(),
      trainStartAt: candles[window.trainStart]?.closeTime ? new Date(candles[window.trainStart].closeTime).toISOString() : null,
      testStartAt: candles[window.testStart]?.closeTime ? new Date(candles[window.testStart].closeTime).toISOString() : null,
      testEndAt: candles[Math.max(window.testEnd - 1, 0)]?.closeTime ? new Date(candles[Math.max(window.testEnd - 1, 0)].closeTime).toISOString() : null,
      tradeCount: report.tradeCount || 0,
      realizedPnl: num(report.realizedPnl || 0, 2),
      winRate: num(report.winRate || 0, 4),
      sharpe: num(computeSharpe(trades), 3),
      expectancy: num(computeExpectancy(trades), 2),
      maxDrawdownPct: num(report.maxDrawdownPct || 0, 4),
      strategyLeaders: bucketStats(trades, (trade) => trade.strategyAtEntry).slice(0, 4).map((item) => item.id),
      familyLeaders: bucketStats(trades, (trade) => (trade.strategyAtEntry || "").split("_")[0] || trade.strategyAtEntry).slice(0, 4),
      regimeLeaders: bucketStats(trades, (trade) => trade.regimeAtEntry).slice(0, 4),
      strategyScorecards,
      familyScorecards,
      regimeScorecards,
      bestTrade: report.bestTrade || null,
      worstTrade: report.worstTrade || null
    });
  }

  const flatExperiments = experiments.flatMap((item) => item.strategyScorecards || []);
  const strategyBuckets = bucketStats(experiments.flatMap((item) => (item.strategyLeaders || []).map((id) => ({ strategyAtEntry: id, pnlQuote: 1 }))), (trade) => trade.strategyAtEntry);
  const familyBuckets = experiments.flatMap((item) => item.familyLeaders || []);
  const regimeBuckets = experiments.flatMap((item) => item.regimeLeaders || []);

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
    strategyLeaders: strategyBuckets.slice(0, 5).map((item) => item.id),
    familyLeaders: familyBuckets.slice(0, 5),
    regimeLeaders: regimeBuckets.slice(0, 5),
    strategyScorecards: buildScorecards(flatExperiments.map((item) => ({ strategyAtEntry: item.id, pnlQuote: item.realizedPnl, netPnlPct: item.realizedPnl / 100, executionQualityScore: item.averageReviewScore, labelScore: item.averageReviewScore })), (trade) => trade.strategyAtEntry),
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
  const topFamilies = bucketStats(
    reports.flatMap((report) => (report.familyLeaders || []).map((item) => ({ family: item.id, pnlQuote: item.realizedPnl || 0 }))),
    (item) => item.family
  );
  const topRegimes = bucketStats(
    reports.flatMap((report) => (report.regimeLeaders || []).map((item) => ({ regime: item.id, pnlQuote: item.realizedPnl || 0 }))),
    (item) => item.regime
  );
  const strategyScorecards = buildScorecards(
    reports.flatMap((report) => (report.strategyScorecards || []).map((item) => ({
      strategyAtEntry: item.id,
      pnlQuote: item.realizedPnl || 0,
      netPnlPct: (item.realizedPnl || 0) / 100,
      executionQualityScore: item.averageReviewScore || 0,
      labelScore: item.averageReviewScore || 0
    }))),
    (trade) => trade.strategyAtEntry
  );
  return {
    generatedAt: nowIso(),
    symbolCount: reports.length,
    bestSymbol: bestSymbol?.symbol || null,
    totalTrades: reports.reduce((total, item) => total + (item.totalTrades || 0), 0),
    realizedPnl: num(reports.reduce((total, item) => total + (item.realizedPnl || 0), 0), 2),
    averageSharpe: num(average(reports.map((item) => item.averageSharpe || 0)), 3),
    averageWinRate: num(average(reports.map((item) => item.averageWinRate || 0)), 4),
    topFamilies: topFamilies.slice(0, 6),
    topRegimes: topRegimes.slice(0, 6),
    strategyScorecards,
    reports
  };
}

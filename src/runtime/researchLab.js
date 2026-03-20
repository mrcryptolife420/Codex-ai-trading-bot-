import { AdaptiveTradingModel } from "../ai/adaptiveModel.js";
import { BinanceClient } from "../binance/client.js";
import { buildSymbolRules } from "../binance/symbolFilters.js";
import { ExecutionEngine } from "../execution/executionEngine.js";
import { buildFeatureVector } from "../strategy/features.js";
import { computeMarketFeatures } from "../strategy/indicators.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { buildTrendStateSummary } from "../strategy/trendState.js";
import { buildMarketStateSummary } from "../strategy/marketState.js";
import { buildPerformanceReport, buildTradeQualityReview } from "./reportBuilder.js";
import { loadHistoricalCandles } from "./marketHistory.js";
import { nowIso } from "../utils/time.js";
import { buildSyntheticBook, buildExitExecutionBook, resolveEntryExecution, resolveCandleIntervalMinutes, buildSimulationEntryDecision, buildSimulationExitDecision, resolveSimulationBuyFill, resolveSimulationSellQuantity } from "./backtestExecution.js";

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
  const book = buildSyntheticBook(candle, market, config, { latencyBps: 0.4 });
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
  const trendStateSummary = buildTrendStateSummary({
    marketFeatures: market,
    bookFeatures: book,
    newsSummary,
    timeframeSummary: {}
  });
  const marketStateSummary = buildMarketStateSummary({ trendStateSummary, marketFeatures: market, bookFeatures: book, newsSummary });
  const rawFeatures = buildFeatureVector({
    symbolStats: model.getSymbolStats(symbol),
    marketFeatures: market,
    bookFeatures: book,
    trendStateSummary,
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
    trendStateSummary,
    marketStateSummary,
    rawFeatures
  };
}

function buildLabelTrade({ symbol, rawFeatures, regimeSummary, strategySummary, candle, futureCandles }) {
  const exitCandle = futureCandles.at(-1);
  const futureHigh = Math.max(...futureCandles.map((item) => item.high));
  const futureLow = Math.min(...futureCandles.map((item) => item.low));
  const entryCandle = futureCandles[0] || candle;
  const entryPrice = entryCandle?.open || candle.close;
  const exitPrice = exitCandle?.close || entryPrice;
  return {
    symbol,
    rawFeatures,
    netPnlPct: entryPrice ? (exitPrice - entryPrice) / entryPrice : 0,
    pnlQuote: entryPrice ? (exitPrice - entryPrice) / entryPrice * 100 : 0,
    mfePct: entryPrice ? Math.max(0, (futureHigh - entryPrice) / entryPrice) : 0,
    maePct: entryPrice ? Math.min(0, (futureLow - entryPrice) / entryPrice) : 0,
    // Research labels do not observe real execution, so keep this neutral.
    executionQualityScore: 0.5,
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

export function runWalkForwardExperiment({ candles, config, symbol, rules = null }) {
  const windows = buildWalkForwardWindows(candles.length, config);
  const horizon = 3;
  const feeRate = config.paperFeeBps / 10_000;
  const execution = new ExecutionEngine(config);
  const experiments = [];
  const candleIntervalMinutes = resolveCandleIntervalMinutes(candles, 1, 15);

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
    let pendingEntry = null;
    const trades = [];
    const scaleOuts = [];
    const equitySnapshots = [];

    for (let index = window.testStart; index < window.testEnd; index += 1) {
      const context = buildContext({ candles, index, symbol, model, config });
      const balance = { quoteFree };
      if (!position && pendingEntry && pendingEntry.entryIndex === index) {
        const entryBook = buildSyntheticBook(context.candle, context.market, config, {
          anchorPrice: context.candle.open,
          latencyBps: 0.4
        });
        const fillEstimate = execution.simulatePaperFill({
          marketSnapshot: { market: context.market, book: entryBook },
          side: "BUY",
          requestedQuoteAmount: pendingEntry.quoteAmount,
          plan: pendingEntry.plan,
          latencyMs: config.backtestLatencyMs
        });
        const executionPrice = fillEstimate.fillPrice || entryBook.ask || entryBook.mid;
        const sizedFill = resolveSimulationBuyFill({
          quoteAmount: pendingEntry.quoteAmount,
          executionPrice,
          fillEstimate,
          rules
        });
        const fee = sizedFill.notional * feeRate;
        const totalCost = sizedFill.notional + fee;
        const entryExecutionAttribution = execution.buildExecutionAttribution({
          plan: pendingEntry.plan,
          marketSnapshot: { market: context.market, book: entryBook },
          side: "BUY",
          fillPrice: executionPrice,
          requestedQuoteAmount: pendingEntry.quoteAmount,
          executedQuote: sizedFill.notional,
          executedQuantity: sizedFill.quantity,
          fillEstimate,
          brokerMode: "research"
        });
        if (sizedFill.valid && sizedFill.notional >= config.minTradeUsdt && totalCost <= quoteFree) {
          quoteFree -= totalCost;
          position = {
            entryIndex: index,
            entryTime: pendingEntry.entryTimeMs || context.candle.openTime || context.candle.closeTime,
            entryPrice: executionPrice,
            quantity: sizedFill.quantity,
            notional: sizedFill.notional,
            requestedQuoteAmount: pendingEntry.quoteAmount,
            totalCost,
            entryFee: fee,
            stopLossPrice: executionPrice * (1 - pendingEntry.stopLossPct),
            takeProfitPrice: executionPrice * (1 + pendingEntry.takeProfitPct),
            maxHoldMinutes: pendingEntry.maxHoldMinutes || config.maxHoldMinutes,
            scaleOutTriggerPrice: executionPrice * (1 + (pendingEntry.scaleOutTriggerPct || config.scaleOutTriggerPct)),
            scaleOutFraction: pendingEntry.scaleOutFraction || config.scaleOutFraction,
            scaleOutTrailOffsetPct: pendingEntry.scaleOutTrailOffsetPct || config.scaleOutTrailOffsetPct,
            scaleOutCompletedAt: null,
            highestPrice: executionPrice,
            lowestPrice: executionPrice,
            rawFeatures: pendingEntry.rawFeatures,
            strategyAtEntry: pendingEntry.strategyAtEntry,
            regimeAtEntry: pendingEntry.regimeAtEntry,
            executionPlan: pendingEntry.plan,
            entryFillEstimate: fillEstimate,
            probabilityAtEntry: pendingEntry.probabilityAtEntry,
            lastMarkedPrice: context.book.mid,
            entryExecutionAttribution
          };
        }
        pendingEntry = null;
      }
      const score = model.score(context.rawFeatures, {
        regimeSummary: context.regimeSummary,
        marketFeatures: context.market,
        marketSnapshot: { candles: candles.slice(0, index + 1), market: context.market, book: context.book },
        newsSummary: context.newsSummary,
        streamFeatures: { tradeFlowImbalance: context.book.tradeFlowImbalance, microTrend: context.book.microTrend },
        bookFeatures: context.book
      });

      if (position) {
        const exitDecision = buildSimulationExitDecision({
          config,
          position,
          currentPrice: context.book.mid,
          marketSnapshot: { market: context.market, book: context.book },
          nowIso: new Date(context.candle.closeTime).toISOString()
        });
        position.highestPrice = exitDecision.updatedHigh;
        position.lowestPrice = exitDecision.updatedLow;
        const trailingStopPrice = position.highestPrice * (1 - (position.trailingStopPct || config.trailingStopPct));

        if (exitDecision.shouldScaleOut) {
          const exitBook = buildSyntheticBook(context.candle, context.market, config, { anchorPrice: context.candle.close, latencyBps: 0.4 });
          const normalizedSell = resolveSimulationSellQuantity({
            requestedQuantity: position.quantity * exitDecision.scaleOutFraction,
            availableQuantity: position.quantity,
            rules
          });
          const requestedQuantity = normalizedSell.quantity;
          const fillEstimate = execution.simulatePaperFill({
            marketSnapshot: { market: context.market, book: exitBook },
            side: "SELL",
            requestedQuantity,
            plan: { ...(position.executionPlan || {}), entryStyle: "market", fallbackStyle: "none", preferMaker: false },
            latencyMs: config.backtestLatencyMs
          });
          const executedQuantity = Math.max(0, Math.min(Number(fillEstimate.executedQuantity || 0), requestedQuantity, position.quantity));
          if (executedQuantity > 0 && executedQuantity < position.quantity) {
            const grossProceeds = executedQuantity * fillEstimate.fillPrice;
            const fee = grossProceeds * feeRate;
            const netProceeds = grossProceeds - fee;
            const proportion = executedQuantity / position.quantity;
            const allocatedCost = position.totalCost * proportion;
            quoteFree += netProceeds;
            position.quantity -= executedQuantity;
            position.totalCost -= allocatedCost;
            position.notional = position.entryPrice * position.quantity;
            position.entryFee = Math.max(0, (position.entryFee || 0) - (position.entryFee || 0) * proportion);
            position.scaleOutCompletedAt = new Date(context.candle.closeTime).toISOString();
            position.scaleOutCount = (position.scaleOutCount || 0) + 1;
            position.stopLossPrice = Math.max(position.stopLossPrice, position.entryPrice * (1 + (position.scaleOutTrailOffsetPct || config.scaleOutTrailOffsetPct)));
            scaleOuts.push({
              id: `${symbol}-${window.testStart}-${index}:scaleout`,
              symbol,
              at: new Date(context.candle.closeTime).toISOString(),
              fraction: executedQuantity / (executedQuantity + position.quantity),
              quantity: executedQuantity,
              price: fillEstimate.fillPrice,
              grossProceeds,
              netProceeds,
              fee,
              allocatedCost,
              realizedPnl: netProceeds - allocatedCost,
              reason: exitDecision.scaleOutReason,
              brokerMode: "research"
            });
          }
        }

        if (exitDecision.shouldExit) {
          const exitBook = buildExitExecutionBook({
            candle: context.candle,
            market: context.market,
            config,
            position,
            exitReason: exitDecision.reason,
            trailingStopPrice,
            options: { latencyBps: 0.4 }
          });
          const normalizedSell = resolveSimulationSellQuantity({
            requestedQuantity: position.quantity,
            availableQuantity: position.quantity,
            rules,
            allowFullClose: true
          });
          if (!normalizedSell.valid) {
            continue;
          }
          const fillEstimate = execution.simulatePaperFill({
            marketSnapshot: { market: context.market, book: exitBook },
            side: "SELL",
            requestedQuantity: normalizedSell.quantity,
            plan: { ...(position.executionPlan || {}), entryStyle: "market", fallbackStyle: "none", preferMaker: false },
            latencyMs: config.backtestLatencyMs
          });
          const originalQuantity = position.quantity;
          const executedQuantity = Math.max(0, Math.min(Number(fillEstimate.executedQuantity || 0), normalizedSell.quantity, originalQuantity));
          if (!executedQuantity) {
            continue;
          }
          const grossProceeds = executedQuantity * fillEstimate.fillPrice;
          const fee = grossProceeds * feeRate;
          const proceeds = grossProceeds - fee;
          const proportion = executedQuantity / Math.max(originalQuantity, 1e-9);
          const allocatedCost = position.totalCost * proportion;
          const pnlQuote = proceeds - allocatedCost;
          const netPnlPct = allocatedCost ? pnlQuote / allocatedCost : 0;
          quoteFree += proceeds;
          if (executedQuantity < originalQuantity) {
            position.quantity -= executedQuantity;
            position.totalCost = Math.max(0, position.totalCost - allocatedCost);
            position.notional = position.entryPrice * position.quantity;
            position.entryFee = Math.max(0, (position.entryFee || 0) - (position.entryFee || 0) * proportion);
            continue;
          }
          const trade = {
            id: `${symbol}-${window.testStart}-${index}`,
            symbol,
            entryAt: new Date(position.entryTime).toISOString(),
            exitAt: new Date(context.candle.closeTime).toISOString(),
            entryPrice: position.entryPrice,
            exitPrice: fillEstimate.fillPrice,
            quantity: executedQuantity,
            totalCost: allocatedCost,
            proceeds,
            pnlQuote,
            netPnlPct,
            mfePct: position.entryPrice ? Math.max(0, (position.highestPrice - position.entryPrice) / position.entryPrice) : 0,
            maePct: position.entryPrice ? Math.min(0, (position.lowestPrice - position.entryPrice) / position.entryPrice) : 0,
            executionQualityScore: execution.buildExecutionQuality({
              marketSnapshot: { book: exitBook },
              fillPrice: fillEstimate.fillPrice,
              side: "SELL"
            }),
            regimeAtEntry: position.regimeAtEntry,
            strategyAtEntry: position.strategyAtEntry,
            reason: exitDecision.reason,
            brokerMode: "research",
            entryExecutionAttribution: position.entryExecutionAttribution || execution.buildExecutionAttribution({
              plan: position.executionPlan,
              marketSnapshot: { market: context.market, book: context.book },
              side: "BUY",
              fillPrice: position.entryPrice,
              requestedQuoteAmount: position.requestedQuoteAmount,
              executedQuote: position.notional,
              executedQuantity: originalQuantity,
              fillEstimate: position.entryFillEstimate,
              orderTelemetry: { makerFillRatio: position.entryFillEstimate?.makerFillRatio, takerFillRatio: position.entryFillEstimate?.takerFillRatio },
              brokerMode: "research"
            }),
            exitExecutionAttribution: execution.buildExecutionAttribution({
              plan: { ...(position.executionPlan || {}), entryStyle: "market", fallbackStyle: "none", preferMaker: false },
              marketSnapshot: { market: context.market, book: exitBook },
              side: "SELL",
              fillPrice: fillEstimate.fillPrice,
              requestedQuoteAmount: allocatedCost,
              executedQuote: grossProceeds,
              executedQuantity,
              fillEstimate,
              orderTelemetry: { makerFillRatio: fillEstimate.makerFillRatio, takerFillRatio: fillEstimate.takerFillRatio, workingTimeMs: fillEstimate.workingTimeMs, notes: fillEstimate.notes },
              brokerMode: "research"
            })
          };
          trades.push(trade);
          model.updateFromTrade({
            ...trade,
            rawFeatures: position.rawFeatures,
            captureEfficiency: position.probabilityAtEntry ? netPnlPct / Math.max(position.probabilityAtEntry, 0.05) : 0
          });
          position = null;
        }
      }

      if (!position && !pendingEntry && !score.shouldAbstain && score.probability >= config.modelThreshold) {
        const entryExecution = resolveEntryExecution(candles, index, context.market, config, { latencyBps: 0.4 });
        if (!entryExecution) {
          continue;
        }
        const decision = buildSimulationEntryDecision({
          config,
          symbol,
          now: new Date(context.candle.closeTime),
          score,
          marketSnapshot: { candles: candles.slice(0, index + 1), market: context.market, book: context.book },
          newsSummary: context.newsSummary,
          strategySummary: context.strategySummary,
          regimeSummary: context.regimeSummary,
          trendStateSummary: context.trendStateSummary,
          marketStateSummary: context.marketStateSummary,
          journal: { trades, scaleOuts: [], blockedSetups: [], counterfactuals: [] },
          runtime: { openPositions: position ? [position] : [] },
          balance,
          symbolStats: model.getSymbolStats(symbol),
          execution
        });
        if (decision.allow && decision.quoteAmount >= config.minTradeUsdt) {
          pendingEntry = {
            entryIndex: index + 1,
            entryTimeMs: entryExecution.entryTimeMs || entryExecution.candle.openTime || entryExecution.candle.closeTime,
            quoteAmount: decision.quoteAmount,
            stopLossPct: decision.stopLossPct,
            takeProfitPct: decision.takeProfitPct,
            rawFeatures: context.rawFeatures,
            strategyAtEntry: context.strategySummary.activeStrategy || null,
            regimeAtEntry: context.regimeSummary.regime,
            plan: decision.executionPlan,
            probabilityAtEntry: score.probability,
            maxHoldMinutes: decision.maxHoldMinutes,
            scaleOutTriggerPct: decision.scaleOutPlan?.triggerPct,
            scaleOutFraction: decision.scaleOutPlan?.fraction,
            scaleOutTrailOffsetPct: decision.scaleOutPlan?.trailOffsetPct
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
      journal: { trades, equitySnapshots, scaleOuts, blockedSetups: [], researchRuns: [], counterfactuals: [] },
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

export async function runResearchLab({ config, logger, symbols = [], client = null, historyStore = null, candlesBySymbol = null }) {
  const effectiveClient = client || new BinanceClient({
    apiKey: "",
    apiSecret: "",
    baseUrl: config.binanceApiBaseUrl,
    recvWindow: config.binanceRecvWindow,
    logger
  });
  const selectedSymbols = (symbols.length ? symbols : config.watchlist).slice(0, config.researchMaxSymbols);
  const exchangeInfo = await effectiveClient.getExchangeInfo();
  const symbolRules = buildSymbolRules(exchangeInfo, config.baseQuoteAsset || null);
  const reports = [];

  for (const symbol of selectedSymbols) {
    const candles = candlesBySymbol?.[symbol] || await loadHistoricalCandles({
      config,
      logger,
      symbol,
      interval: config.klineInterval,
      targetCount: config.researchCandleLimit,
      client: effectiveClient,
      store: historyStore,
      refreshLatest: true
    });
    reports.push(runWalkForwardExperiment({ candles, config, symbol, rules: symbolRules[symbol] || null }));
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


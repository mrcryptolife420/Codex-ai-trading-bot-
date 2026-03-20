import { AdaptiveTradingModel } from "../ai/adaptiveModel.js";
import { BinanceClient } from "../binance/client.js";
import { buildSymbolRules } from "../binance/symbolFilters.js";
import { ExecutionEngine } from "../execution/executionEngine.js";
import { buildPerformanceReport } from "./reportBuilder.js";
import { buildFeatureVector } from "../strategy/features.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { computeMarketFeatures } from "../strategy/indicators.js";
import { buildTrendStateSummary } from "../strategy/trendState.js";
import { buildMarketStateSummary } from "../strategy/marketState.js";
import { loadHistoricalCandles } from "./marketHistory.js";
import {
  buildSyntheticBook,
  buildExitExecutionBook,
  resolveCandleIntervalMinutes,
  resolveEntryExecution,
  buildSimulationEntryDecision,
  buildSimulationExitDecision,
  resolveSimulationBuyFill,
  resolveSimulationSellQuantity
} from "./backtestExecution.js";

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
    sourceQualityScore: 0
  };
}

function buildBacktestContext({ window, candle, symbol, model, config }) {
  const market = computeMarketFeatures(window);
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
  return { market, book, newsSummary, regimeSummary, strategySummary, trendStateSummary, marketStateSummary, rawFeatures };
}

export async function runBacktest({ config, logger, symbol, client = null, historyStore = null, candles = null }) {
  const effectiveClient = client || new BinanceClient({
    apiKey: "",
    apiSecret: "",
    baseUrl: config.binanceApiBaseUrl,
    recvWindow: config.binanceRecvWindow,
    logger
  });
  const candleSeries = candles || await loadHistoricalCandles({
    config,
    logger,
    symbol,
    interval: config.klineInterval,
    targetCount: config.backtestCandleLimit || 500,
    client: effectiveClient,
    store: historyStore,
    refreshLatest: true
  });
  const exchangeInfo = await effectiveClient.getExchangeInfo();
  const symbolRules = buildSymbolRules(exchangeInfo, config.baseQuoteAsset || null)[symbol] || null;
  const model = new AdaptiveTradingModel({ version: 2 }, config);
  const execution = new ExecutionEngine(config);

  let quoteFree = config.startingCash;
  let position = null;
  let pendingEntry = null;
  const trades = [];
  const scaleOuts = [];
  const equitySnapshots = [];
  const feeRate = config.paperFeeBps / 10000;
  const candleIntervalMinutes = resolveCandleIntervalMinutes(candleSeries, 1, 15);

  for (let index = 60; index < candleSeries.length; index += 1) {
    const window = candleSeries.slice(0, index + 1);
    const candle = candleSeries[index];
    const context = buildBacktestContext({ window, candle, symbol, model, config });
    const balance = { quoteFree };

    if (!position && pendingEntry && pendingEntry.entryIndex === index) {
      const entryBook = buildSyntheticBook(candle, context.market, config, { anchorPrice: candle.open });
      const fillEstimate = execution.simulatePaperFill({
        marketSnapshot: { market: context.market, book: entryBook },
        side: "BUY",
        requestedQuoteAmount: pendingEntry.quoteAmount,
        plan: pendingEntry.plan,
        latencyMs: config.backtestLatencyMs
      });
      const grossCost = fillEstimate.executedQuote;
      const fee = grossCost * feeRate;
      const executionPrice = fillEstimate.fillPrice || entryBook.ask || entryBook.mid;
      const sizedFill = resolveSimulationBuyFill({
        quoteAmount: pendingEntry.quoteAmount,
        executionPrice,
        fillEstimate,
        rules: symbolRules
      });
      const totalCost = sizedFill.notional + sizedFill.notional * feeRate;
      const quantity = sizedFill.quantity;
      const entryExecutionAttribution = execution.buildExecutionAttribution({
        plan: pendingEntry.plan,
        marketSnapshot: { market: context.market, book: entryBook },
        side: "BUY",
        fillPrice: executionPrice,
        requestedQuoteAmount: pendingEntry.quoteAmount,
        executedQuote: sizedFill.notional,
        executedQuantity: quantity,
        fillEstimate,
        brokerMode: "backtest"
      });
      if (sizedFill.valid && sizedFill.notional >= config.minTradeUsdt && totalCost <= quoteFree) {
        quoteFree -= totalCost;
        position = {
          entryTime: pendingEntry.entryTimeMs || candle.openTime || candle.closeTime,
          entryIndex: index,
          entryPrice: executionPrice,
          quantity,
          notional: sizedFill.notional,
          totalCost,
          entryFee: fee,
          stopLossPrice: executionPrice * (1 - pendingEntry.stopLossPct),
          takeProfitPrice: executionPrice * (1 + pendingEntry.takeProfitPct),
          maxHoldMinutes: pendingEntry.maxHoldMinutes || config.maxHoldMinutes,
          scaleOutTriggerPrice: fillEstimate.fillPrice * (1 + (pendingEntry.scaleOutTriggerPct || config.scaleOutTriggerPct)),
          scaleOutFraction: pendingEntry.scaleOutFraction || config.scaleOutFraction,
          scaleOutTrailOffsetPct: pendingEntry.scaleOutTrailOffsetPct || config.scaleOutTrailOffsetPct,
          scaleOutCompletedAt: null,
          highestPrice: fillEstimate.fillPrice,
          lowestPrice: fillEstimate.fillPrice,
          rawFeatures: pendingEntry.rawFeatures,
          transformerDecision: pendingEntry.transformerDecision,
          strategyAtEntry: pendingEntry.strategyAtEntry,
          regimeAtEntry: pendingEntry.regimeAtEntry,
          entrySpreadBps: entryBook.spreadBps,
          executionPlan: pendingEntry.plan,
          entryFillEstimate: fillEstimate,
          probabilityAtEntry: pendingEntry.probabilityAtEntry,
          requestedQuoteAmount: pendingEntry.quoteAmount,
          entryExecutionAttribution
        };
      }
      pendingEntry = null;
    }

    if (position) {
      const exitDecision = buildSimulationExitDecision({
        config,
        position,
        currentPrice: context.book.mid,
        marketSnapshot: { market: context.market, book: context.book },
        nowIso: new Date(candle.closeTime).toISOString()
      });
      position.highestPrice = exitDecision.updatedHigh;
      position.lowestPrice = exitDecision.updatedLow;
      const trailingStopPrice = position.highestPrice * (1 - (position.trailingStopPct || config.trailingStopPct));

      if (exitDecision.shouldScaleOut) {
        const exitBook = buildSyntheticBook(candle, context.market, config, { anchorPrice: candle.close });
        const normalizedSell = resolveSimulationSellQuantity({
          requestedQuantity: position.quantity * exitDecision.scaleOutFraction,
          availableQuantity: position.quantity,
          rules: symbolRules
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
          position.scaleOutCompletedAt = new Date(candle.closeTime).toISOString();
          position.scaleOutCount = (position.scaleOutCount || 0) + 1;
          position.stopLossPrice = Math.max(position.stopLossPrice, position.entryPrice * (1 + (position.scaleOutTrailOffsetPct || config.scaleOutTrailOffsetPct)));
          scaleOuts.push({
            id: `${symbol}:scaleout:${index}`,
            symbol,
            at: new Date(candle.closeTime).toISOString(),
            fraction: executedQuantity / (executedQuantity + position.quantity),
            quantity: executedQuantity,
            price: fillEstimate.fillPrice,
            grossProceeds,
            netProceeds,
            fee,
            allocatedCost,
            realizedPnl: netProceeds - allocatedCost,
            reason: exitDecision.scaleOutReason,
            brokerMode: "backtest"
          });
        }
      }

      if (exitDecision.shouldExit) {
        const exitBook = buildExitExecutionBook({
          candle,
          market: context.market,
          config,
          position,
          exitReason: exitDecision.reason,
          trailingStopPrice
        });
        const exitPlan = { ...(position.executionPlan || {}), entryStyle: "market", fallbackStyle: "none", preferMaker: false };
        const normalizedSell = resolveSimulationSellQuantity({
          requestedQuantity: position.quantity,
          availableQuantity: position.quantity,
          rules: symbolRules,
          allowFullClose: true
        });
        if (!normalizedSell.valid) {
          continue;
        }
        const fillEstimate = execution.simulatePaperFill({
          marketSnapshot: { market: context.market, book: exitBook },
          side: "SELL",
          requestedQuantity: normalizedSell.quantity,
          plan: exitPlan,
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
          position.lastMarkedPrice = context.book.mid;
          continue;
        }
        const trade = {
          symbol,
          entryAt: new Date(position.entryTime).toISOString(),
          exitAt: new Date(candle.closeTime).toISOString(),
          entryPrice: position.entryPrice,
          exitPrice: fillEstimate.fillPrice,
          quantity: executedQuantity,
          totalCost: allocatedCost,
          proceeds,
          pnlQuote,
          netPnlPct,
          mfePct: position.entryPrice ? Math.max(0, (position.highestPrice - position.entryPrice) / position.entryPrice) : 0,
          maePct: position.entryPrice ? Math.min(0, (position.lowestPrice - position.entryPrice) / position.entryPrice) : 0,
          executionQualityScore: execution.buildExecutionQuality({ marketSnapshot: { book: exitBook }, fillPrice: fillEstimate.fillPrice, side: "SELL" }),
          captureEfficiency: position.probabilityAtEntry ? netPnlPct / Math.max(position.probabilityAtEntry, 0.05) : 0,
          regimeAtEntry: position.regimeAtEntry,
          entrySpreadBps: position.entrySpreadBps,
          exitSpreadBps: exitBook.spreadBps,
          reason: exitDecision.reason,
          rawFeatures: position.rawFeatures,
          strategyAtEntry: position.strategyAtEntry || null,
          transformerDecision: position.transformerDecision || null,
          entryExecutionAttribution: position.entryExecutionAttribution || execution.buildExecutionAttribution({
            plan: position.executionPlan,
            marketSnapshot: { market: context.market, book: context.book },
            side: "BUY",
            fillPrice: position.entryPrice,
            requestedQuoteAmount: position.requestedQuoteAmount,
            executedQuote: position.notional,
            executedQuantity: originalQuantity,
            fillEstimate: position.entryFillEstimate,
            brokerMode: "backtest"
          }),
          exitExecutionAttribution: execution.buildExecutionAttribution({
            plan: exitPlan,
            marketSnapshot: { market: context.market, book: exitBook },
            side: "SELL",
            fillPrice: fillEstimate.fillPrice,
            requestedQuoteAmount: allocatedCost,
            executedQuote: grossProceeds,
            executedQuantity,
            fillEstimate,
            orderTelemetry: { makerFillRatio: fillEstimate.makerFillRatio, takerFillRatio: fillEstimate.takerFillRatio, workingTimeMs: fillEstimate.workingTimeMs, notes: fillEstimate.notes },
            brokerMode: "backtest"
          })
        };
        trades.push(trade);
        model.updateFromTrade(trade);
        position = null;
      }
    }

    if (!position) {
      const score = model.score(context.rawFeatures, {
        regimeSummary: context.regimeSummary,
        marketFeatures: context.market,
        marketSnapshot: { candles: window, market: context.market, book: context.book },
        newsSummary: context.newsSummary,
        streamFeatures: { tradeFlowImbalance: context.book.tradeFlowImbalance, microTrend: context.book.microTrend },
        bookFeatures: context.book
      });
      if (!pendingEntry && !score.shouldAbstain && score.probability >= config.modelThreshold && context.market.realizedVolPct <= config.maxRealizedVolPct) {
        const entryExecution = resolveEntryExecution(candleSeries, index, context.market, config);
        if (!entryExecution) {
          continue;
        }
        const decision = buildSimulationEntryDecision({
          config,
          symbol,
          now: new Date(candle.closeTime),
          score,
          marketSnapshot: { candles: window, market: context.market, book: context.book },
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
            transformerDecision: score.transformer,
            strategyAtEntry: context.strategySummary.activeStrategy,
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
    }

    const equity = quoteFree + (position ? position.quantity * candle.close : 0);
    equitySnapshots.push({
      at: new Date(candle.closeTime).toISOString(),
      equity,
      quoteFree,
      openPositions: position ? 1 : 0
    });
  }

  const report = buildPerformanceReport({
    journal: { trades, equitySnapshots, scaleOuts },
    runtime: { openPositions: position ? [position] : [] },
    config
  });

  return {
    symbol,
    calibration: model.getCalibrationSummary(),
    deployment: model.getDeploymentSummary(),
    ...report
  };
}


import { AdaptiveTradingModel } from "../ai/adaptiveModel.js";
import { BinanceClient, normalizeKlines } from "../binance/client.js";
import { ExecutionEngine } from "../execution/executionEngine.js";
import { buildPerformanceReport } from "./reportBuilder.js";
import { buildFeatureVector } from "../strategy/features.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { computeMarketFeatures } from "../strategy/indicators.js";
import { buildTrendStateSummary } from "../strategy/trendState.js";
import { buildMarketStateSummary } from "../strategy/marketState.js";
import {
  buildSyntheticBook,
  buildExitExecutionBook,
  resolveCandleIntervalMinutes,
  resolveEntryExecution
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

export async function runBacktest({ config, logger, symbol }) {
  const client = new BinanceClient({
    apiKey: "",
    apiSecret: "",
    baseUrl: config.binanceApiBaseUrl,
    recvWindow: config.binanceRecvWindow,
    logger
  });
  const rawKlines = await client.getKlines(symbol, config.klineInterval, 500);
  const candles = normalizeKlines(rawKlines);
  const model = new AdaptiveTradingModel({ version: 2 }, config);
  const execution = new ExecutionEngine(config);

  let quoteFree = config.startingCash;
  let position = null;
  let pendingEntry = null;
  const trades = [];
  const equitySnapshots = [];
  const feeRate = config.paperFeeBps / 10000;
  const candleIntervalMinutes = resolveCandleIntervalMinutes(candles, 1, 15);

  for (let index = 60; index < candles.length; index += 1) {
    const window = candles.slice(0, index + 1);
    const candle = candles[index];
    const context = buildBacktestContext({ window, candle, symbol, model, config });

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
      const totalCost = grossCost + fee;
      const quantity = fillEstimate.executedQuantity;
      if (grossCost >= config.minTradeUsdt && totalCost <= quoteFree) {
        quoteFree -= totalCost;
        position = {
          entryTime: pendingEntry.entryTimeMs || candle.openTime || candle.closeTime,
          entryIndex: index,
          entryPrice: fillEstimate.fillPrice,
          quantity,
          notional: grossCost,
          totalCost,
          stopLossPrice: fillEstimate.fillPrice * (1 - pendingEntry.stopLossPct),
          takeProfitPrice: fillEstimate.fillPrice * (1 + pendingEntry.takeProfitPct),
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
          requestedQuoteAmount: pendingEntry.quoteAmount
        };
      }
      pendingEntry = null;
    }

    if (position) {
      position.highestPrice = Math.max(position.highestPrice, candle.high);
      position.lowestPrice = Math.min(position.lowestPrice, candle.low);
      const trailingStopPrice = position.highestPrice * (1 - config.trailingStopPct);
      let exitReason = null;
      if (candle.low <= position.stopLossPrice) {
        exitReason = "stop_loss";
      } else if (candle.high >= position.takeProfitPrice) {
        exitReason = "take_profit";
      } else if (position.highestPrice > position.entryPrice * 1.004 && candle.low <= trailingStopPrice) {
        exitReason = "trailing_stop";
      } else if ((index - position.entryIndex) * candleIntervalMinutes >= config.maxHoldMinutes) {
        exitReason = "time_stop";
      }

      if (exitReason) {
        const exitBook = buildExitExecutionBook({
          candle,
          market: context.market,
          config,
          position,
          exitReason,
          trailingStopPrice
        });
        const exitPlan = { ...(position.executionPlan || {}), entryStyle: "market", fallbackStyle: "none", preferMaker: false };
        const fillEstimate = execution.simulatePaperFill({
          marketSnapshot: { market: context.market, book: exitBook },
          side: "SELL",
          requestedQuantity: position.quantity,
          plan: exitPlan,
          latencyMs: config.backtestLatencyMs
        });
        const grossProceeds = fillEstimate.executedQuantity * fillEstimate.fillPrice;
        const fee = grossProceeds * feeRate;
        const proceeds = grossProceeds - fee;
        const pnlQuote = proceeds - position.totalCost;
        const netPnlPct = position.totalCost ? pnlQuote / position.totalCost : 0;
        quoteFree += proceeds;
        const trade = {
          symbol,
          entryAt: new Date(position.entryTime).toISOString(),
          exitAt: new Date(candle.closeTime).toISOString(),
          entryPrice: position.entryPrice,
          exitPrice: fillEstimate.fillPrice,
          quantity: fillEstimate.executedQuantity,
          totalCost: position.totalCost,
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
          reason: exitReason,
          rawFeatures: position.rawFeatures,
          strategyAtEntry: position.strategyAtEntry || null,
          transformerDecision: position.transformerDecision || null,
          entryExecutionAttribution: execution.buildExecutionAttribution({
            plan: position.executionPlan,
            marketSnapshot: { market: context.market, book: context.book },
            side: "BUY",
            fillPrice: position.entryPrice,
            requestedQuoteAmount: position.requestedQuoteAmount,
            executedQuote: position.notional,
            executedQuantity: position.quantity,
            fillEstimate: position.entryFillEstimate,
            brokerMode: "backtest"
          }),
          exitExecutionAttribution: execution.buildExecutionAttribution({
            plan: exitPlan,
            marketSnapshot: { market: context.market, book: exitBook },
            side: "SELL",
            fillPrice: fillEstimate.fillPrice,
            requestedQuoteAmount: position.totalCost,
            executedQuote: grossProceeds,
            executedQuantity: fillEstimate.executedQuantity,
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
        const entryExecution = resolveEntryExecution(candles, index, context.market, config);
        if (!entryExecution) {
          continue;
        }
        const stopLossPct = Math.max(config.stopLossPct, context.market.atrPct * 1.2, 0.01);
        const takeProfitPct = Math.max(config.takeProfitPct, stopLossPct * (context.regimeSummary.regime === "trend" ? 1.9 : 1.5));
        const quoteAmount = Math.min(
          quoteFree * config.maxPositionFraction,
          (quoteFree * config.riskPerTrade) / stopLossPct
        );
        if (quoteAmount >= config.minTradeUsdt) {
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
          pendingEntry = {
            entryIndex: index + 1,
            entryTimeMs: entryExecution.entryTimeMs || entryExecution.candle.openTime || entryExecution.candle.closeTime,
            quoteAmount,
            stopLossPct,
            takeProfitPct,
            rawFeatures: context.rawFeatures,
            transformerDecision: score.transformer,
            strategyAtEntry: context.strategySummary.activeStrategy,
            regimeAtEntry: context.regimeSummary.regime,
            plan,
            probabilityAtEntry: score.probability
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
    journal: { trades, equitySnapshots },
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

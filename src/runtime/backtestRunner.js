import { AdaptiveTradingModel } from "../ai/adaptiveModel.js";
import { BinanceClient, normalizeKlines } from "../binance/client.js";
import { ExecutionEngine } from "../execution/executionEngine.js";
import { buildPerformanceReport } from "./reportBuilder.js";
import { buildFeatureVector } from "../strategy/features.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { computeMarketFeatures } from "../strategy/indicators.js";
import { buildTrendStateSummary } from "../strategy/trendState.js";

function buildSyntheticBook(candle, market, config) {
  const latencyBps = Math.max(0.4, (config.backtestLatencyMs || 0) / 1000 * 1.6);
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
    microPriceEdgeBps: latencyBps,
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
  return { market, book, newsSummary, regimeSummary, strategySummary, trendStateSummary, rawFeatures };
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
  const trades = [];
  const equitySnapshots = [];
  const feeRate = config.paperFeeBps / 10000;

  for (let index = 60; index < candles.length; index += 1) {
    const window = candles.slice(0, index + 1);
    const candle = candles[index];
    const context = buildBacktestContext({ window, candle, symbol, model, config });

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
      } else if ((index - position.entryIndex) * 15 >= config.maxHoldMinutes) {
        exitReason = "time_stop";
      }

      if (exitReason) {
        const exitPlan = { ...(position.executionPlan || {}), entryStyle: "market", fallbackStyle: "none", preferMaker: false };
        const fillEstimate = execution.simulatePaperFill({
          marketSnapshot: { market: context.market, book: context.book },
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
          executionQualityScore: execution.buildExecutionQuality({ marketSnapshot: { book: context.book }, fillPrice: fillEstimate.fillPrice, side: "SELL" }),
          captureEfficiency: position.probabilityAtEntry ? netPnlPct / Math.max(position.probabilityAtEntry, 0.05) : 0,
          regimeAtEntry: position.regimeAtEntry,
          entrySpreadBps: position.entrySpreadBps,
          exitSpreadBps: context.book.spreadBps,
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
            marketSnapshot: { market: context.market, book: context.book },
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
      if (!score.shouldAbstain && score.probability >= config.modelThreshold && context.market.realizedVolPct <= config.maxRealizedVolPct) {
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
          const fillEstimate = execution.simulatePaperFill({
            marketSnapshot: { market: context.market, book: context.book },
            side: "BUY",
            requestedQuoteAmount: quoteAmount,
            plan,
            latencyMs: config.backtestLatencyMs
          });
          const grossCost = fillEstimate.executedQuote;
          const fee = grossCost * feeRate;
          const totalCost = grossCost + fee;
          const quantity = fillEstimate.executedQuantity;
          if (grossCost >= config.minTradeUsdt && totalCost <= quoteFree) {
            quoteFree -= totalCost;
            position = {
              entryTime: candle.closeTime,
              entryIndex: index,
              entryPrice: fillEstimate.fillPrice,
              quantity,
              notional: grossCost,
              totalCost,
              stopLossPrice: fillEstimate.fillPrice * (1 - stopLossPct),
              takeProfitPrice: fillEstimate.fillPrice * (1 + takeProfitPct),
              highestPrice: fillEstimate.fillPrice,
              lowestPrice: fillEstimate.fillPrice,
              rawFeatures: context.rawFeatures,
              transformerDecision: score.transformer,
              strategyAtEntry: context.strategySummary.activeStrategy,
              regimeAtEntry: context.regimeSummary.regime,
              entrySpreadBps: context.book.spreadBps,
              executionPlan: plan,
              entryFillEstimate: fillEstimate,
              probabilityAtEntry: score.probability,
              requestedQuoteAmount: quoteAmount
            };
          }
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

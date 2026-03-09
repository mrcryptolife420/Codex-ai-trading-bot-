import { AdaptiveTradingModel } from "../ai/adaptiveModel.js";
import { BinanceClient, normalizeKlines } from "../binance/client.js";
import { ExecutionEngine } from "../execution/executionEngine.js";
import { buildPerformanceReport } from "./reportBuilder.js";
import { buildFeatureVector } from "../strategy/features.js";
import { evaluateStrategySet } from "../strategy/strategyRouter.js";
import { computeMarketFeatures } from "../strategy/indicators.js";

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
  const slippageRate = config.paperSlippageBps / 10000;

  for (let index = 60; index < candles.length; index += 1) {
    const window = candles.slice(0, index + 1);
    const candle = candles[index];
    const market = computeMarketFeatures(window);
    const book = {
      bid: candle.close * (1 - slippageRate),
      ask: candle.close * (1 + slippageRate),
      mid: candle.close,
      spreadBps: config.paperSlippageBps * 2,
      depthImbalance: 0,
      tradeFlowImbalance: 0,
      microTrend: 0,
      recentTradeCount: 0
    };
    const newsSummary = {
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
    const regimeSummary = model.inferRegime({
      marketFeatures: market,
      newsSummary,
      streamFeatures: { tradeFlowImbalance: 0, microTrend: 0 }
    });
    const strategySummary = evaluateStrategySet({
      symbol,
      marketSnapshot: { market, book },
      newsSummary,
      regimeSummary,
      streamFeatures: { tradeFlowImbalance: 0, microTrend: 0 }
    });
    const symbolStats = model.getSymbolStats(symbol);
    const rawFeatures = buildFeatureVector({
      symbolStats,
      marketFeatures: market,
      bookFeatures: book,
      newsSummary,
      portfolioFeatures: { heat: position ? 0.35 : 0, maxCorrelation: 0 },
      streamFeatures: { tradeFlowImbalance: 0, microTrend: 0 },
      regimeSummary,
      strategySummary,
      now: new Date(candle.closeTime)
    });

    if (position) {
      position.highestPrice = Math.max(position.highestPrice, candle.high);
      position.lowestPrice = Math.min(position.lowestPrice, candle.low);
      const trailingStopPrice = position.highestPrice * (1 - config.trailingStopPct);
      let exitReason = null;
      let exitPrice = null;
      if (candle.low <= position.stopLossPrice) {
        exitReason = "stop_loss";
        exitPrice = position.stopLossPrice;
      } else if (candle.high >= position.takeProfitPrice) {
        exitReason = "take_profit";
        exitPrice = position.takeProfitPrice;
      } else if (position.highestPrice > position.entryPrice * 1.004 && candle.low <= trailingStopPrice) {
        exitReason = "trailing_stop";
        exitPrice = trailingStopPrice;
      } else if ((index - position.entryIndex) * 15 >= config.maxHoldMinutes) {
        exitReason = "time_stop";
        exitPrice = candle.close;
      }

      if (exitReason) {
        const grossProceeds = position.quantity * exitPrice * (1 - slippageRate);
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
          exitPrice,
          quantity: position.quantity,
          totalCost: position.totalCost,
          proceeds,
          pnlQuote,
          netPnlPct,
          mfePct: position.entryPrice ? Math.max(0, (position.highestPrice - position.entryPrice) / position.entryPrice) : 0,
          maePct: position.entryPrice ? Math.min(0, (position.lowestPrice - position.entryPrice) / position.entryPrice) : 0,
          executionQualityScore: execution.buildExecutionQuality({ marketSnapshot: { book }, fillPrice: exitPrice, side: "SELL" }),
          regimeAtEntry: position.regimeAtEntry,
          entrySpreadBps: position.entrySpreadBps,
          exitSpreadBps: book.spreadBps,
          reason: exitReason,
          rawFeatures: position.rawFeatures,
          strategyAtEntry: position.strategyAtEntry || null,
          transformerDecision: position.transformerDecision || null
        };
        trades.push(trade);
        model.updateFromTrade(trade);
        position = null;
      }
    }

    if (!position) {
      const score = model.score(rawFeatures, {
        regimeSummary,
        marketFeatures: market,
        marketSnapshot: { candles: window, market, book },
        newsSummary,
        streamFeatures: { tradeFlowImbalance: 0, microTrend: 0 }
      });
      if (!score.shouldAbstain && score.probability >= config.modelThreshold && market.realizedVolPct <= config.maxRealizedVolPct) {
        const stopLossPct = Math.max(config.stopLossPct, market.atrPct * 1.2, 0.01);
        const takeProfitPct = Math.max(config.takeProfitPct, stopLossPct * (regimeSummary.regime === "trend" ? 1.9 : 1.5));
        const quoteAmount = Math.min(
          quoteFree * config.maxPositionFraction,
          (quoteFree * config.riskPerTrade) / stopLossPct
        );
        if (quoteAmount >= config.minTradeUsdt) {
          const entryPrice = candle.close * (1 + slippageRate);
          const grossCost = quoteAmount;
          const fee = grossCost * feeRate;
          const totalCost = grossCost + fee;
          const quantity = grossCost / entryPrice;
          quoteFree -= totalCost;
          position = {
            entryTime: candle.closeTime,
            entryIndex: index,
            entryPrice,
            quantity,
            totalCost,
            stopLossPrice: entryPrice * (1 - stopLossPct),
            takeProfitPrice: entryPrice * (1 + takeProfitPct),
            highestPrice: entryPrice,
            lowestPrice: entryPrice,
            rawFeatures,
            transformerDecision: score.transformer,
            strategyAtEntry: strategySummary.activeStrategy,
            regimeAtEntry: regimeSummary.regime,
            entrySpreadBps: book.spreadBps
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


import crypto from "node:crypto";
import { resolveMarketBuyQuantity } from "../binance/symbolFilters.js";
import { ExecutionEngine } from "./executionEngine.js";
import { nowIso } from "../utils/time.js";

function ensurePaperState(runtime, startingCash) {
  if (!runtime.paperPortfolio) {
    runtime.paperPortfolio = {
      quoteFree: startingCash,
      feesPaid: 0,
      realizedPnl: 0
    };
  }
}

export class PaperBroker {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.feeRate = config.paperFeeBps / 10_000;
    this.slippageRate = config.paperSlippageBps / 10_000;
    this.execution = new ExecutionEngine(config);
  }

  async doctor(runtime) {
    ensurePaperState(runtime, this.config.startingCash);
    return {
      mode: "paper",
      quoteFree: runtime.paperPortfolio.quoteFree,
      feesPaid: runtime.paperPortfolio.feesPaid,
      realizedPnl: runtime.paperPortfolio.realizedPnl
    };
  }

  async getBalance(runtime) {
    ensurePaperState(runtime, this.config.startingCash);
    return {
      quoteFree: runtime.paperPortfolio.quoteFree
    };
  }

  async getEquity(runtime, midPrices = {}) {
    ensurePaperState(runtime, this.config.startingCash);
    const positionsValue = (runtime.openPositions || []).reduce((total, position) => {
      const mid = midPrices[position.symbol] || position.lastMarkedPrice || position.entryPrice;
      return total + position.quantity * mid;
    }, 0);
    return runtime.paperPortfolio.quoteFree + positionsValue;
  }

  async reconcileRuntime() {
    return {
      closedTrades: [],
      recoveredPositions: [],
      warnings: []
    };
  }

  async enterPosition({
    symbol,
    quoteAmount,
    rules,
    marketSnapshot,
    decision,
    score,
    rawFeatures,
    strategySummary,
    newsSummary,
    entryRationale,
    runtime
  }) {
    ensurePaperState(runtime, this.config.startingCash);
    const executionPlan = decision.executionPlan || this.execution.buildEntryPlan({
      symbol,
      marketSnapshot,
      score,
      decision,
      regimeSummary: { regime: decision.regime || "range" },
      strategySummary: strategySummary || decision.strategySummary || entryRationale?.strategy || {},
      portfolioSummary: decision.portfolioSummary || {}
    });
    const fillEstimate = marketSnapshot.book.entryEstimate || null;
    const styleImpact = executionPlan.entryStyle === "market" ? 1 : executionPlan.entryStyle === "pegged_limit_maker" ? 0.16 : 0.35;
    const estimatePrice = fillEstimate?.averagePrice || marketSnapshot.book.ask;
    const executionPrice = estimatePrice * (1 + this.slippageRate * styleImpact);
    const size = resolveMarketBuyQuantity(quoteAmount, executionPrice, rules);
    if (!size.valid) {
      throw new Error(`Paper buy rejected: ${size.reason}`);
    }

    const fee = size.notional * this.feeRate;
    const totalCost = size.notional + fee;
    if (totalCost > runtime.paperPortfolio.quoteFree) {
      throw new Error("Paper buy rejected: insufficient quote balance.");
    }

    runtime.paperPortfolio.quoteFree -= totalCost;
    runtime.paperPortfolio.feesPaid += fee;

    const entryExecutionAttribution = this.execution.buildExecutionAttribution({
      plan: executionPlan,
      marketSnapshot,
      side: "BUY",
      fillPrice: executionPrice,
      requestedQuoteAmount: quoteAmount,
      executedQuote: size.notional,
      executedQuantity: size.quantity,
      fillEstimate,
      brokerMode: "paper"
    });

    const position = {
      id: crypto.randomUUID(),
      symbol,
      entryAt: nowIso(),
      entryPrice: executionPrice,
      quantity: size.quantity,
      notional: size.notional,
      totalCost,
      entryFee: fee,
      highestPrice: executionPrice,
      lowestPrice: executionPrice,
      lastMarkedPrice: marketSnapshot.book.mid,
      stopLossPrice: executionPrice * (1 - decision.stopLossPct),
      takeProfitPrice: executionPrice * (1 + decision.takeProfitPct),
      trailingStopPct: this.config.trailingStopPct,
      probabilityAtEntry: score.probability,
      regimeAtEntry: decision.regime || score.regime || "range",
      strategyAtEntry: strategySummary?.activeStrategy || decision.strategySummary?.activeStrategy || entryRationale?.strategy?.activeStrategy || null,
      entrySpreadBps: marketSnapshot.book.spreadBps,
      rawFeatures,
      newsSummary,
      entryRationale: entryRationale || null,
      executionPlan,
      entryExecutionAttribution,
      strategyDecision: strategySummary || decision.strategySummary || entryRationale?.strategy || null,
      transformerDecision: score.transformer || entryRationale?.transformer || null,
      committeeDecision: decision.committeeSummary || entryRationale?.committee || null,
      executionPolicyDecision: decision.rlAdvice || entryRationale?.rlPolicy || null,
      scaleOutTriggerPrice: executionPrice * (1 + (decision.scaleOutPlan?.triggerPct || this.config.scaleOutTriggerPct)),
      scaleOutFraction: decision.scaleOutPlan?.fraction || this.config.scaleOutFraction,
      scaleOutMinNotionalUsd: decision.scaleOutPlan?.minNotionalUsd || this.config.scaleOutMinNotionalUsd,
      scaleOutTrailOffsetPct: decision.scaleOutPlan?.trailOffsetPct || this.config.scaleOutTrailOffsetPct,
      scaleOutCompletedAt: null,
      scaleOutCount: 0,
      brokerMode: "paper"
    };

    runtime.openPositions.push(position);
    return position;
  }

  async scaleOutPosition({ position, marketSnapshot, fraction, reason, runtime }) {
    ensurePaperState(runtime, this.config.startingCash);
    const effectiveFraction = Math.min(Math.max(fraction || this.config.scaleOutFraction, 0.05), 0.95);
    const quantity = position.quantity * effectiveFraction;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= position.quantity) {
      throw new Error(`Invalid paper scale-out fraction for ${position.symbol}.`);
    }

    const executionPrice = (marketSnapshot.book.exitEstimate?.averagePrice || marketSnapshot.book.bid) * (1 - this.slippageRate * 0.6);
    const grossProceeds = quantity * executionPrice;
    const fee = grossProceeds * this.feeRate;
    const netProceeds = grossProceeds - fee;
    const proportion = quantity / position.quantity;
    const allocatedCost = position.totalCost * proportion;
    const realizedPnl = netProceeds - allocatedCost;
    const exitExecutionAttribution = this.execution.buildExecutionAttribution({
      plan: position.executionPlan || { entryStyle: "market", fallbackStyle: "none", preferMaker: false },
      marketSnapshot,
      side: "SELL",
      fillPrice: executionPrice,
      requestedQuoteAmount: allocatedCost,
      executedQuote: grossProceeds,
      executedQuantity: quantity,
      fillEstimate: marketSnapshot.book.exitEstimate || null,
      brokerMode: "paper"
    });

    runtime.paperPortfolio.quoteFree += netProceeds;
    runtime.paperPortfolio.feesPaid += fee;
    runtime.paperPortfolio.realizedPnl += realizedPnl;

    position.quantity -= quantity;
    position.totalCost -= allocatedCost;
    position.notional = position.entryPrice * position.quantity;
    position.entryFee = Math.max(0, position.entryFee - position.entryFee * proportion);
    position.scaleOutCompletedAt = nowIso();
    position.scaleOutCount = (position.scaleOutCount || 0) + 1;
    position.stopLossPrice = Math.max(position.stopLossPrice, position.entryPrice * (1 + (position.scaleOutTrailOffsetPct || this.config.scaleOutTrailOffsetPct)));
    position.lastMarkedPrice = marketSnapshot.book.mid;

    return {
      id: `${position.id}:scaleout:${Date.now()}`,
      positionId: position.id,
      symbol: position.symbol,
      at: nowIso(),
      fraction: effectiveFraction,
      quantity,
      price: executionPrice,
      grossProceeds,
      netProceeds,
      fee,
      allocatedCost,
      realizedPnl,
      reason,
      brokerMode: "paper",
      executionAttribution: exitExecutionAttribution
    };
  }

  async exitPosition({ position, marketSnapshot, reason, runtime }) {
    ensurePaperState(runtime, this.config.startingCash);
    const fillEstimate = marketSnapshot.book.exitEstimate || null;
    const executionPrice = (fillEstimate?.averagePrice || marketSnapshot.book.bid) * (1 - this.slippageRate);
    const grossProceeds = position.quantity * executionPrice;
    const fee = grossProceeds * this.feeRate;
    const netProceeds = grossProceeds - fee;
    const pnlQuote = netProceeds - position.totalCost;
    const netPnlPct = position.totalCost ? pnlQuote / position.totalCost : 0;
    const mfePct = position.entryPrice
      ? Math.max(0, (position.highestPrice - position.entryPrice) / position.entryPrice)
      : 0;
    const maePct = position.entryPrice
      ? Math.min(0, (position.lowestPrice - position.entryPrice) / position.entryPrice)
      : 0;
    const executionQualityScore = this.execution.buildExecutionQuality({
      marketSnapshot,
      fillPrice: executionPrice,
      side: "SELL"
    });
    const exitExecutionAttribution = this.execution.buildExecutionAttribution({
      plan: position.executionPlan || { entryStyle: "market", fallbackStyle: "none", preferMaker: false },
      marketSnapshot,
      side: "SELL",
      fillPrice: executionPrice,
      requestedQuoteAmount: position.notional || position.totalCost || 0,
      executedQuote: grossProceeds,
      executedQuantity: position.quantity,
      fillEstimate,
      brokerMode: "paper"
    });

    runtime.paperPortfolio.quoteFree += netProceeds;
    runtime.paperPortfolio.feesPaid += fee;
    runtime.paperPortfolio.realizedPnl += pnlQuote;
    runtime.openPositions = runtime.openPositions.filter((item) => item.id !== position.id);

    return {
      id: position.id,
      symbol: position.symbol,
      entryAt: position.entryAt,
      exitAt: nowIso(),
      entryPrice: position.entryPrice,
      exitPrice: executionPrice,
      quantity: position.quantity,
      totalCost: position.totalCost,
      proceeds: netProceeds,
      pnlQuote,
      netPnlPct,
      mfePct,
      maePct,
      executionQualityScore,
      entryExecutionAttribution: position.entryExecutionAttribution || null,
      exitExecutionAttribution,
      regimeAtEntry: position.regimeAtEntry || "range",
      strategyAtEntry: position.strategyAtEntry || position.entryRationale?.strategy?.activeStrategy || null,
      entrySpreadBps: position.entrySpreadBps || 0,
      exitSpreadBps: marketSnapshot.book.spreadBps || 0,
      reason,
      rawFeatures: position.rawFeatures,
      newsSummary: position.newsSummary,
      entryRationale: position.entryRationale || null,
      strategyDecision: position.strategyDecision || position.entryRationale?.strategy || null,
      transformerDecision: position.transformerDecision || position.entryRationale?.transformer || null,
      committeeDecision: position.committeeDecision || position.entryRationale?.committee || null,
      executionPolicyDecision: position.executionPolicyDecision || position.entryRationale?.rlPolicy || null,
      exitSource: "paper_market_exit",
      brokerMode: "paper"
    };
  }
}

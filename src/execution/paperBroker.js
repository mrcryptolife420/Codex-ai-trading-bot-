import crypto from "node:crypto";
import { normalizeQuantity, resolveMarketBuyQuantity } from "../binance/symbolFilters.js";
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

function buildExitPlan(position) {
  return {
    ...(position.executionPlan || {}),
    entryStyle: "market",
    fallbackStyle: "none",
    preferMaker: false,
    usePeggedOrder: false
  };
}

function resolveExecutionCalibration(runtime = {}, plan = {}) {
  const summary = runtime.executionCalibration || {};
  const style = summary.styles?.[plan.entryStyle || "market"] || summary.styles?.market || null;
  return style
    ? {
        slippageBiasBps: Number(style.slippageBiasBps || 0),
        makerFillBias: Number(style.makerFillBias || 0),
        latencyMultiplier: Number(style.latencyMultiplier || 1),
        queueDecayBiasBps: Number(style.queueDecayBiasBps || 0),
        spreadShockBiasBps: Number(style.spreadShockBiasBps || 0)
      }
    : null;
}

function resolvePaperBuySize({ quoteAmount, executionPrice, fillEstimate, rules }) {
  const requestedSize = resolveMarketBuyQuantity(quoteAmount, executionPrice, rules);
  if (!requestedSize.valid) {
    return {
      ...requestedSize,
      requestedQuantity: 0,
      requestedNotional: 0
    };
  }

  const rawExecutedQuantity = Number.isFinite(fillEstimate?.executedQuantity)
    ? fillEstimate.executedQuantity
    : executionPrice > 0
      ? (fillEstimate?.executedQuote || 0) / executionPrice
      : 0;
  let quantity = normalizeQuantity(rawExecutedQuantity, rules, "floor", true);
  if (!quantity && rawExecutedQuantity > 0) {
    quantity = Math.min(
      requestedSize.quantity,
      normalizeQuantity(rawExecutedQuantity, rules, "ceil", true)
    );
  }
  if (!quantity && (fillEstimate?.completionRatio || 0) > 0) {
    quantity = Math.min(
      requestedSize.quantity,
      normalizeQuantity(rules.marketMinQty || rules.minQty || requestedSize.quantity, rules, "ceil", true)
    );
  }
  if (!quantity) {
    return {
      quantity: 0,
      notional: 0,
      valid: false,
      reason: "quantity_below_minimum",
      requestedQuantity: requestedSize.quantity,
      requestedNotional: requestedSize.notional
    };
  }

  return {
    quantity,
    notional: quantity * executionPrice,
    valid: true,
    requestedQuantity: requestedSize.quantity,
    requestedNotional: requestedSize.notional
  };
}

export class PaperBroker {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.feeRate = config.paperFeeBps / 10_000;
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
    const fillEstimate = this.execution.simulatePaperFill({
      marketSnapshot,
      side: "BUY",
      requestedQuoteAmount: quoteAmount,
      plan: executionPlan,
      latencyMs: this.config.paperLatencyMs,
      calibration: resolveExecutionCalibration(runtime, executionPlan)
    });
    const executionPrice = fillEstimate.fillPrice || marketSnapshot.book.ask || marketSnapshot.book.mid;
    const size = resolvePaperBuySize({
      quoteAmount,
      executionPrice,
      fillEstimate,
      rules
    });
    if (!size.valid) {
      throw new Error(`Paper buy rejected: ${size.reason} (symbol=${symbol}, quote=${quoteAmount}, executionPrice=${executionPrice}, requestedQty=${size.requestedQuantity || 0}, requestedNotional=${size.requestedNotional || 0}, rawExecutedQty=${fillEstimate.executedQuantity || 0}, completion=${fillEstimate.completionRatio || 0})`);
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
      orderTelemetry: {
        makerFillRatio: fillEstimate.makerFillRatio,
        takerFillRatio: fillEstimate.takerFillRatio,
        workingTimeMs: fillEstimate.workingTimeMs,
        notes: fillEstimate.notes
      },
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
      strategyFamily: strategySummary?.family || decision.strategySummary?.family || entryRationale?.strategy?.family || null,
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
      brokerMode: "paper",
      learningLane: decision.learningLane || null,
      learningValueScore: Number.isFinite(decision.learningValueScore) ? decision.learningValueScore : null,
      paperLearningBudget: decision.paperLearningBudget || null
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

    const exitPlan = buildExitPlan(position);
    const fillEstimate = this.execution.simulatePaperFill({
      marketSnapshot,
      side: "SELL",
      requestedQuantity: quantity,
      plan: exitPlan,
      latencyMs: this.config.paperLatencyMs,
      calibration: resolveExecutionCalibration(runtime, exitPlan)
    });
    const executedQuantity = fillEstimate.executedQuantity || quantity;
    const executionPrice = fillEstimate.fillPrice || marketSnapshot.book.bid;
    const grossProceeds = executedQuantity * executionPrice;
    const fee = grossProceeds * this.feeRate;
    const netProceeds = grossProceeds - fee;
    const proportion = executedQuantity / position.quantity;
    const allocatedCost = position.totalCost * proportion;
    const realizedPnl = netProceeds - allocatedCost;
    const exitExecutionAttribution = this.execution.buildExecutionAttribution({
      plan: exitPlan,
      marketSnapshot,
      side: "SELL",
      fillPrice: executionPrice,
      requestedQuoteAmount: allocatedCost,
      executedQuote: grossProceeds,
      executedQuantity,
      fillEstimate,
      orderTelemetry: {
        makerFillRatio: fillEstimate.makerFillRatio,
        takerFillRatio: fillEstimate.takerFillRatio,
        workingTimeMs: fillEstimate.workingTimeMs,
        notes: fillEstimate.notes
      },
      brokerMode: "paper"
    });

    runtime.paperPortfolio.quoteFree += netProceeds;
    runtime.paperPortfolio.feesPaid += fee;
    runtime.paperPortfolio.realizedPnl += realizedPnl;

    position.quantity -= executedQuantity;
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
      fraction: executedQuantity / (executedQuantity + position.quantity),
      quantity: executedQuantity,
      price: executionPrice,
      grossProceeds,
      netProceeds,
      fee,
      allocatedCost,
      realizedPnl,
      reason,
      brokerMode: "paper",
      learningLane: position.learningLane || null,
      learningValueScore: Number.isFinite(position.learningValueScore) ? position.learningValueScore : null,
      executionAttribution: exitExecutionAttribution
    };
  }

  async exitPosition({ position, marketSnapshot, reason, runtime }) {
    ensurePaperState(runtime, this.config.startingCash);
    const exitPlan = buildExitPlan(position);
    const fillEstimate = this.execution.simulatePaperFill({
      marketSnapshot,
      side: "SELL",
      requestedQuantity: position.quantity,
      plan: exitPlan,
      latencyMs: this.config.paperLatencyMs,
      calibration: resolveExecutionCalibration(runtime, exitPlan)
    });
    const executedQuantity = fillEstimate.executedQuantity || position.quantity;
    const executionPrice = fillEstimate.fillPrice || marketSnapshot.book.bid;
    const grossProceeds = executedQuantity * executionPrice;
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
      plan: exitPlan,
      marketSnapshot,
      side: "SELL",
      fillPrice: executionPrice,
      requestedQuoteAmount: position.notional || position.totalCost || 0,
      executedQuote: grossProceeds,
      executedQuantity,
      fillEstimate,
      orderTelemetry: {
        makerFillRatio: fillEstimate.makerFillRatio,
        takerFillRatio: fillEstimate.takerFillRatio,
        workingTimeMs: fillEstimate.workingTimeMs,
        notes: fillEstimate.notes
      },
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
      quantity: executedQuantity,
      totalCost: position.totalCost,
      proceeds: netProceeds,
      pnlQuote,
      netPnlPct,
      mfePct,
      maePct,
      executionQualityScore,
      captureEfficiency: position.probabilityAtEntry ? netPnlPct / Math.max(position.probabilityAtEntry, 0.05) : 0,
      entryExecutionAttribution: position.entryExecutionAttribution || null,
      exitExecutionAttribution,
      regimeAtEntry: position.regimeAtEntry || "range",
      strategyAtEntry: position.strategyAtEntry || position.entryRationale?.strategy?.activeStrategy || null,
      strategyFamily: position.strategyFamily || position.entryRationale?.strategy?.family || null,
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
      brokerMode: "paper",
      learningLane: position.learningLane || null,
      learningValueScore: Number.isFinite(position.learningValueScore) ? position.learningValueScore : null
    };
  }
}

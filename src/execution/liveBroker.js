import crypto from "node:crypto";
import {
  formatPrice,
  formatQuantity,
  normalizePrice,
  normalizeQuantity,
  resolveMarketBuyQuantity,
  resolveStpMode
} from "../binance/symbolFilters.js";
import { ExecutionEngine } from "./executionEngine.js";
import { nowIso } from "../utils/time.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sumTradeCommissionsToQuote(trades, baseAsset, quoteAsset) {
  return (trades || []).reduce((total, trade) => {
    const commission = Number(trade.commission || 0);
    const price = Number(trade.price || 0);
    if (!commission) {
      return total;
    }
    if (trade.commissionAsset === quoteAsset) {
      return total + commission;
    }
    if (trade.commissionAsset === baseAsset) {
      return total + commission * price;
    }
    return total;
  }, 0);
}

function toAssetMap(account) {
  return Object.fromEntries(
    (account.balances || []).map((asset) => [
      asset.asset,
      {
        free: Number(asset.free || 0),
        locked: Number(asset.locked || 0),
        total: Number(asset.free || 0) + Number(asset.locked || 0)
      }
    ])
  );
}

function buildRecoveredRationale(symbol) {
  return {
    summary: `${symbol} werd teruggevonden op de exchange en opnieuw onder beheer geplaatst.`,
    probability: null,
    strategy: null,
    confidence: null,
    threshold: null,
    rankScore: null,
    quoteAmount: null,
    spreadBps: null,
    newsSentiment: 0,
    newsRisk: 0,
    regimeSummary: { regime: "range", confidence: 0, bias: 0, reasons: [] },
    portfolioSummary: { sameClusterCount: 0, sameSectorCount: 0, maxCorrelation: 0, sizeMultiplier: 1, reasons: [], correlations: [] },
    streamSnapshot: { tradeFlowImbalance: 0, microTrend: 0, recentTradeCount: 0, latestBookTicker: null, lastUserEvent: null },
    executionPlan: null,
    transformer: null,
    committee: null,
    rlPolicy: null,
    topSignals: [],
    challengerSignals: [],
    checks: [],
    headlines: []
  };
}

function normalizeExecution(execution) {
  return {
    order: execution.order,
    trades: execution.trades || execution.order.fills || []
  };
}

function flattenReplaceResponse(response) {
  if (!response) {
    return [];
  }
  return [response.cancelResponse, response.newOrderResponse, response.amendedOrder, response].filter(Boolean);
}

const EMPTY_NEWS = {
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

export class LiveBroker {
  constructor({ client, config, logger, symbolRules, stream = null }) {
    this.client = client;
    this.config = config;
    this.logger = logger;
    this.symbolRules = symbolRules;
    this.stream = stream;
    this.execution = new ExecutionEngine(config);
  }

  async doctor(runtime) {
    const account = await this.client.getAccountInfo(true);
    const openOrderLists = await this.client.getOpenOrderLists();
    const quoteAsset = this.config.baseQuoteAsset;
    const quoteBalance = account.balances.find((asset) => asset.asset === quoteAsset);
    return {
      mode: "live",
      canTrade: account.canTrade,
      accountType: account.accountType,
      permissions: account.permissions,
      quoteFree: Number(quoteBalance?.free || 0),
      openOrderLists: openOrderLists.length,
      runtimeOpenPositions: runtime.openPositions.length,
      requireSelfTradePrevention: account.requireSelfTradePrevention,
      preventSor: account.preventSor
    };
  }

  async getBalance() {
    const account = await this.client.getAccountInfo(true);
    const quoteBalance = account.balances.find((asset) => asset.asset === this.config.baseQuoteAsset);
    return { quoteFree: Number(quoteBalance?.free || 0) };
  }

  async getEquity(runtime, midPrices = {}) {
    const balance = await this.getBalance();
    const positionsValue = (runtime.openPositions || []).reduce((total, position) => {
      const mid = midPrices[position.symbol] || position.lastMarkedPrice || position.entryPrice;
      return total + position.quantity * mid;
    }, 0);
    return balance.quoteFree + positionsValue;
  }

  async buildProtectiveOrderParams(position, rules) {
    const quantity = normalizeQuantity(position.quantity, rules, "floor", false);
    if (!quantity) {
      throw new Error(`Unable to normalize protective quantity for ${position.symbol}.`);
    }
    const stopTriggerPrice = normalizePrice(position.stopLossPrice, rules, "round");
    const stopLimitPrice = normalizePrice(stopTriggerPrice * (1 - this.config.liveStopLimitBufferPct), rules, "floor");
    const takeProfitPrice = normalizePrice(position.takeProfitPrice, rules, "round");
    const stpMode = resolveStpMode(this.config.stpMode, rules);
    return {
      symbol: position.symbol,
      side: "SELL",
      quantity: formatQuantity(quantity, rules, false),
      aboveType: "LIMIT_MAKER",
      abovePrice: formatPrice(takeProfitPrice, rules),
      belowType: "STOP_LOSS_LIMIT",
      belowStopPrice: formatPrice(stopTriggerPrice, rules),
      belowPrice: formatPrice(stopLimitPrice, rules),
      belowTimeInForce: "GTC",
      newOrderRespType: "RESULT",
      ...(stpMode && stpMode !== "NONE" ? { selfTradePreventionMode: stpMode } : {})
    };
  }

  async placeProtectiveOrder(position, rules) {
    const orderList = await this.client.placeOrderListOco(await this.buildProtectiveOrderParams(position, rules));
    position.protectiveOrderListId = orderList.orderListId;
    position.protectiveListClientOrderId = orderList.listClientOrderId || null;
    position.protectiveOrders = orderList.orders || [];
    position.protectiveOrderStatus = orderList.listStatusType || orderList.listOrderStatus || "NEW";
    position.protectiveOrderPlacedAt = nowIso();
    return orderList;
  }

  async ensureProtectiveOrder(position, rules) {
    if (!this.config.enableExchangeProtection || position.protectiveOrderListId) {
      return null;
    }
    return this.placeProtectiveOrder(position, rules);
  }

  buildOrderRequestMeta(plan, rules, responseType = "RESULT") {
    const stpMode = resolveStpMode(this.config.stpMode, rules);
    return {
      newOrderRespType: responseType,
      strategyId: plan?.strategyId || undefined,
      strategyType: plan?.strategyType || undefined,
      ...(stpMode && stpMode !== "NONE" ? { selfTradePreventionMode: stpMode } : {})
    };
  }

  async placeMarketBuy({ symbol, quoteAmount, rules, plan }) {
    const order = await this.client.placeOrder({
      symbol,
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: Number(quoteAmount).toFixed(2),
      ...this.buildOrderRequestMeta(plan, rules, "FULL")
    });
    return {
      executions: [normalizeExecution({ order, trades: order.fills || [] })],
      remainingQuote: 0,
      orderResponses: [order],
      amendmentCount: 0,
      cancelReplaceCount: 0,
      keepPriorityCount: 0
    };
  }

  async settleMakerOrder({ symbol, orderId, quoteAmount, rules }) {
    const order = await this.client.getOrder(symbol, { orderId });
    const trades = await this.client.getMyTrades(symbol, { orderId, limit: 50 }).catch(() => []);
    const executedQuote = Number(order.cummulativeQuoteQty || 0);
    return {
      executions: executedQuote > 0 ? [normalizeExecution({ order, trades })] : [],
      remainingQuote: Math.max(0, quoteAmount - executedQuote),
      order
    };
  }

  async placePeggedLimitMakerBuy({ symbol, quoteAmount, rules, marketSnapshot, plan }) {
    const referencePrice = marketSnapshot.book.bid || marketSnapshot.book.mid;
    const size = resolveMarketBuyQuantity(quoteAmount, referencePrice, rules);
    if (!size.valid || !referencePrice) {
      return this.placeMarketBuy({ symbol, quoteAmount, rules, plan });
    }

    const order = await this.client.placeOrder({
      symbol,
      side: "BUY",
      type: "LIMIT_MAKER",
      quantity: formatQuantity(size.quantity, rules, false),
      pegPriceType: plan.pegPriceType,
      ...(plan.pegOffsetType && plan.pegOffsetValue != null ? { pegOffsetType: plan.pegOffsetType, pegOffsetValue: plan.pegOffsetValue } : {}),
      ...this.buildOrderRequestMeta(plan, rules)
    });

    let workingOrderId = order.orderId;
    const orderResponses = [order];
    let keepPriorityCount = 0;
    let amendmentCount = 0;

    await sleep(Math.max(1200, plan?.makerPatienceMs || 3500));
    let settled = await this.settleMakerOrder({ symbol, orderId: workingOrderId, quoteAmount, rules });
    const liveOrder = settled.order;
    const remainingQty = normalizeQuantity(Number(liveOrder.origQty || 0) - Number(liveOrder.executedQty || 0), rules, "floor", false);

    if ((liveOrder.status === "NEW" || liveOrder.status === "PARTIALLY_FILLED") && remainingQty && plan?.allowKeepPriority) {
      try {
        const shrinkQty = normalizeQuantity(Number(liveOrder.executedQty || 0) + Math.max(remainingQty * 0.5, rules.minQty || 0), rules, "floor", false);
        if (shrinkQty && shrinkQty < Number(liveOrder.origQty || 0)) {
          const amend = await this.client.amendOrderKeepPriority({
            symbol,
            orderId: workingOrderId,
            newQty: formatQuantity(shrinkQty, rules, false)
          });
          keepPriorityCount += 1;
          amendmentCount += 1;
          orderResponses.push(...flattenReplaceResponse(amend));
          await sleep(650);
          settled = await this.settleMakerOrder({ symbol, orderId: workingOrderId, quoteAmount, rules });
        }
      } catch (error) {
        this.logger?.warn?.("Pegged keep-priority amend skipped", { symbol, error: error.message });
      }
    }

    try {
      if (settled.order?.status === "NEW" || settled.order?.status === "PARTIALLY_FILLED") {
        const cancel = await this.client.cancelOrder(symbol, { orderId: workingOrderId });
        orderResponses.push(cancel);
        settled = await this.settleMakerOrder({ symbol, orderId: workingOrderId, quoteAmount, rules });
      }
    } catch (error) {
      this.logger?.warn?.("Pegged maker cancel failed", { symbol, error: error.message });
    }

    return {
      ...settled,
      orderResponses,
      amendmentCount,
      cancelReplaceCount: 0,
      keepPriorityCount
    };
  }

  async placeLimitMakerBuy({ symbol, quoteAmount, rules, marketSnapshot, plan }) {
    const limitPrice = normalizePrice(marketSnapshot.book.bid || marketSnapshot.book.mid, rules, "floor");
    const size = resolveMarketBuyQuantity(quoteAmount, limitPrice || marketSnapshot.book.mid, rules);
    if (!size.valid || !limitPrice) {
      return this.placeMarketBuy({ symbol, quoteAmount, rules, plan });
    }

    const order = await this.client.placeOrder({
      symbol,
      side: "BUY",
      type: "LIMIT_MAKER",
      quantity: formatQuantity(size.quantity, rules, false),
      price: formatPrice(limitPrice, rules),
      ...this.buildOrderRequestMeta(plan, rules)
    });

    let workingOrderId = order.orderId;
    const orderResponses = [order];
    let amendmentCount = 0;
    let cancelReplaceCount = 0;
    let keepPriorityCount = 0;
    const halfPatience = Math.max(1200, Math.round((plan?.makerPatienceMs || 3500) / 2));

    await sleep(halfPatience);
    let settled = await this.settleMakerOrder({ symbol, orderId: workingOrderId, quoteAmount, rules });
    const firstOrder = settled.order;
    const remainingQty = normalizeQuantity(Number(firstOrder.origQty || 0) - Number(firstOrder.executedQty || 0), rules, "floor", false);

    if ((firstOrder.status === "NEW" || firstOrder.status === "PARTIALLY_FILLED") && remainingQty) {
      const freshBook = await this.client.getBookTicker(symbol).catch(() => null);
      const freshBid = freshBook ? normalizePrice(Number(freshBook.bidPrice || 0), rules, "floor") : null;
      const currentPrice = Number(firstOrder.price || 0);
      if (freshBid && freshBid !== currentPrice) {
        try {
          const replace = await this.client.cancelReplaceOrder({
            symbol,
            cancelOrderId: workingOrderId,
            cancelReplaceMode: "STOP_ON_FAILURE",
            side: "BUY",
            type: "LIMIT_MAKER",
            quantity: formatQuantity(remainingQty, rules, false),
            price: formatPrice(freshBid, rules),
            ...this.buildOrderRequestMeta(plan, rules)
          });
          cancelReplaceCount += 1;
          amendmentCount += 1;
          orderResponses.push(...flattenReplaceResponse(replace));
          workingOrderId = replace.newOrderResponse?.orderId || replace.orderId || workingOrderId;
          await sleep(Math.max(800, (plan?.makerPatienceMs || 3500) - halfPatience));
          settled = await this.settleMakerOrder({ symbol, orderId: workingOrderId, quoteAmount, rules });
        } catch (error) {
          this.logger?.warn?.("Limit maker refresh failed", { symbol, error: error.message });
        }
      } else if (firstOrder.status === "PARTIALLY_FILLED" && plan?.allowKeepPriority) {
        try {
          const shrinkQty = normalizeQuantity(Number(firstOrder.executedQty || 0) + Math.max(remainingQty * 0.5, rules.minQty || 0), rules, "floor", false);
          if (shrinkQty && shrinkQty < Number(firstOrder.origQty || 0)) {
            const amend = await this.client.amendOrderKeepPriority({
              symbol,
              orderId: workingOrderId,
              newQty: formatQuantity(shrinkQty, rules, false)
            });
            keepPriorityCount += 1;
            amendmentCount += 1;
            orderResponses.push(...flattenReplaceResponse(amend));
          }
        } catch (error) {
          this.logger?.warn?.("Keep-priority amend skipped", { symbol, error: error.message });
        }
      }
    }

    try {
      if (settled.order?.status === "NEW" || settled.order?.status === "PARTIALLY_FILLED") {
        const cancel = await this.client.cancelOrder(symbol, { orderId: workingOrderId });
        orderResponses.push(cancel);
        settled = await this.settleMakerOrder({ symbol, orderId: workingOrderId, quoteAmount, rules });
      }
    } catch (error) {
      this.logger?.warn?.("Limit maker cancel failed", { symbol, error: error.message });
    }

    return {
      ...settled,
      orderResponses,
      amendmentCount,
      cancelReplaceCount,
      keepPriorityCount
    };
  }

  async collectPreventedMatches(symbol, orderIds = []) {
    if (!this.config.enableStpTelemetryQuery || !orderIds.length) {
      return { preventedQuantity: 0, preventedMatchIds: [], matches: [] };
    }
    const responses = await Promise.allSettled(
      orderIds.slice(0, this.config.stpTelemetryLimit).map((orderId) => this.client.getMyPreventedMatches(symbol, { orderId, limit: this.config.stpTelemetryLimit }))
    );
    const matches = responses.flatMap((result) => result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []);
    const preventedQuantity = matches.reduce((total, item) => total + Number(item.makerPreventedQuantity || item.preventedQuantity || 0), 0);
    const preventedMatchIds = [...new Set(matches.map((item) => item.preventedMatchId).filter((value) => value != null))];
    return { preventedQuantity, preventedMatchIds, matches };
  }

  async collectOrderTelemetry(symbol, orderIds = []) {
    if (this.stream?.getOrderExecutionTelemetry) {
      await sleep(120);
    }
    const streamTelemetry = this.stream?.getOrderExecutionTelemetry?.(symbol, orderIds) || {};
    const prevented = await this.collectPreventedMatches(symbol, orderIds).catch(() => ({ preventedQuantity: 0, preventedMatchIds: [], matches: [] }));
    return {
      ...streamTelemetry,
      preventedQuantity: Number(streamTelemetry.preventedQuantity || 0) + Number(prevented.preventedQuantity || 0),
      preventedMatchIds: [...new Set([...(streamTelemetry.preventedMatchIds || []), ...(prevented.preventedMatchIds || [])])],
      preventedMatches: prevented.matches || []
    };
  }

  buildEntryFromExecutions({ symbol, executions, rules, marketSnapshot, decision, score, rawFeatures, newsSummary, entryRationale, plan, orderResponses = [], orderTelemetry = {}, amendmentCount = 0, cancelReplaceCount = 0, keepPriorityCount = 0, requestedQuoteAmount = 0 }) {
    const normalized = executions.map(normalizeExecution);
    const quantity = normalized.reduce((total, item) => total + Number(item.order.executedQty || 0), 0);
    const quoteSpent = normalized.reduce((total, item) => total + Number(item.order.cummulativeQuoteQty || 0), 0);
    if (!quantity || !quoteSpent) {
      throw new Error("Live buy returned empty fills.");
    }
    const fee = normalized.reduce((total, item) => total + sumTradeCommissionsToQuote(item.trades, rules.baseAsset, rules.quoteAsset), 0);
    const averagePrice = quoteSpent / quantity;
    const executionQualityScore = normalized.reduce((total, item) => {
      const fillPrice = Number(item.order.cummulativeQuoteQty || 0) / Math.max(Number(item.order.executedQty || 0), 1e-9);
      return total + this.execution.buildExecutionQuality({ marketSnapshot, fillPrice, side: "BUY" });
    }, 0) / normalized.length;
    const entryExecutionAttribution = this.execution.buildExecutionAttribution({
      plan,
      marketSnapshot,
      side: "BUY",
      fillPrice: averagePrice,
      requestedQuoteAmount,
      executedQuote: quoteSpent,
      executedQuantity: quantity,
      orderResponses,
      orderTelemetry,
      fillEstimate: marketSnapshot.book.entryEstimate || null,
      amendmentCount,
      cancelReplaceCount,
      keepPriorityCount,
      brokerMode: "live"
    });

    return {
      id: crypto.randomUUID(),
      symbol,
      entryAt: nowIso(),
      entryPrice: averagePrice,
      quantity,
      notional: quoteSpent,
      totalCost: quoteSpent + fee,
      entryFee: fee,
      highestPrice: averagePrice,
      lowestPrice: averagePrice,
      lastMarkedPrice: marketSnapshot.book.mid,
      stopLossPrice: averagePrice * (1 - decision.stopLossPct),
      takeProfitPrice: averagePrice * (1 + decision.takeProfitPct),
      trailingStopPct: this.config.trailingStopPct,
      probabilityAtEntry: score.probability,
      regimeAtEntry: decision.regime || score.regime || "range",
      entrySpreadBps: marketSnapshot.book.spreadBps || 0,
      latestSpreadBps: marketSnapshot.book.spreadBps || 0,
      exchangeOrderIds: normalized.map((item) => item.order.orderId),
      rawFeatures,
      newsSummary,
      entryRationale: entryRationale || null,
      executionPlan: plan,
      entryExecutionAttribution,
      strategyAtEntry: decision.strategySummary?.activeStrategy || entryRationale?.strategy?.activeStrategy || null,
      strategyDecision: decision.strategySummary || entryRationale?.strategy || null,
      transformerDecision: score.transformer || entryRationale?.transformer || null,
      committeeDecision: decision.committeeSummary || entryRationale?.committee || null,
      executionPolicyDecision: decision.rlAdvice || entryRationale?.rlPolicy || null,
      executionQualityScore,
      scaleOutTriggerPrice: averagePrice * (1 + (decision.scaleOutPlan?.triggerPct || this.config.scaleOutTriggerPct)),
      scaleOutFraction: decision.scaleOutPlan?.fraction || this.config.scaleOutFraction,
      scaleOutMinNotionalUsd: decision.scaleOutPlan?.minNotionalUsd || this.config.scaleOutMinNotionalUsd,
      scaleOutTrailOffsetPct: decision.scaleOutPlan?.trailOffsetPct || this.config.scaleOutTrailOffsetPct,
      scaleOutCompletedAt: null,
      scaleOutCount: 0,
      brokerMode: "live"
    };
  }

  async enterPosition({ symbol, rules, quoteAmount, marketSnapshot, decision, score, rawFeatures, strategySummary, newsSummary, entryRationale, runtime }) {
    const plan = decision.executionPlan || this.execution.buildEntryPlan({
      symbol,
      marketSnapshot,
      score,
      decision,
      regimeSummary: { regime: decision.regime || score.regime || "range" },
      strategySummary: strategySummary || decision.strategySummary || entryRationale?.strategy || {},
      portfolioSummary: decision.portfolioSummary || {}
    });

    let executions = [];
    let remainingQuote = quoteAmount;
    let orderResponses = [];
    let amendmentCount = 0;
    let cancelReplaceCount = 0;
    let keepPriorityCount = 0;

    if (plan.entryStyle === "pegged_limit_maker") {
      const makerResult = await this.placePeggedLimitMakerBuy({ symbol, quoteAmount, rules, marketSnapshot, plan });
      executions.push(...makerResult.executions);
      remainingQuote = makerResult.remainingQuote;
      orderResponses.push(...(makerResult.orderResponses || []));
      amendmentCount += makerResult.amendmentCount || 0;
      cancelReplaceCount += makerResult.cancelReplaceCount || 0;
      keepPriorityCount += makerResult.keepPriorityCount || 0;
    } else if (plan.entryStyle === "limit_maker") {
      const makerResult = await this.placeLimitMakerBuy({ symbol, quoteAmount, rules, marketSnapshot, plan });
      executions.push(...makerResult.executions);
      remainingQuote = makerResult.remainingQuote;
      orderResponses.push(...(makerResult.orderResponses || []));
      amendmentCount += makerResult.amendmentCount || 0;
      cancelReplaceCount += makerResult.cancelReplaceCount || 0;
      keepPriorityCount += makerResult.keepPriorityCount || 0;
    }

    if (!executions.length || (remainingQuote >= Math.max(this.config.minTradeUsdt, rules.minNotional || 0) && plan.fallbackStyle !== "none")) {
      const marketResult = await this.placeMarketBuy({ symbol, quoteAmount: executions.length ? remainingQuote : quoteAmount, rules, plan });
      executions.push(...marketResult.executions);
      remainingQuote = marketResult.remainingQuote;
      orderResponses.push(...(marketResult.orderResponses || []));
    }
    if (remainingQuote >= Math.max(this.config.minTradeUsdt, rules.minNotional || 0)) {
      this.logger?.warn?.("Entry left residual quote after fallback", { symbol, remainingQuote });
    }

    const orderIds = executions.map((item) => item.order.orderId).filter(Boolean);
    const orderTelemetry = await this.collectOrderTelemetry(symbol, orderIds);
    const position = this.buildEntryFromExecutions({
      symbol,
      executions,
      rules,
      marketSnapshot,
      decision: { ...decision, strategySummary: strategySummary || decision.strategySummary || entryRationale?.strategy || null },
      score,
      rawFeatures,
      newsSummary,
      entryRationale,
      plan,
      orderResponses,
      orderTelemetry,
      amendmentCount,
      cancelReplaceCount,
      keepPriorityCount,
      requestedQuoteAmount: quoteAmount
    });
    runtime.openPositions.push(position);
    await this.ensureProtectiveOrder(position, rules);
    return position;
  }

  async cancelProtectiveOrders(position) {
    if (!position.protectiveOrderListId) {
      return null;
    }
    try {
      return await this.client.cancelOrderList({ symbol: position.symbol, orderListId: position.protectiveOrderListId });
    } catch (error) {
      this.logger?.warn?.("Protective order-list cancel failed", { symbol: position.symbol, error: error.message });
      return null;
    }
  }

  buildExitPlan(position, exitSource = "bot_market_exit") {
    return {
      entryStyle: exitSource === "exchange_protective_order" ? "protective_order" : "market_exit",
      fallbackStyle: "none",
      preferMaker: false,
      usePeggedOrder: false,
      strategyId: position.executionPlan?.strategyId || null,
      strategyType: position.executionPlan?.strategyType || null,
      depthConfidence: position.entryExecutionAttribution?.depthConfidence || 0,
      queueImbalance: position.entryExecutionAttribution?.queueImbalance || 0,
      queueRefreshScore: position.entryExecutionAttribution?.queueRefreshScore || 0,
      resilienceScore: position.entryExecutionAttribution?.resilienceScore || 0,
      tradeFlow: 0,
      expectedImpactBps: 0,
      expectedSlippageBps: 0
    };
  }

  buildTradeFromOrder(position, order, trades, reason, exitSource, marketSnapshot = null, orderTelemetry = {}) {
    const rules = this.symbolRules[position.symbol];
    const executedQty = Number(order.executedQty || position.quantity);
    const quoteReceived = Number(order.cummulativeQuoteQty || 0);
    const averagePrice = executedQty ? quoteReceived / executedQty : position.lastMarkedPrice;
    const fee = sumTradeCommissionsToQuote(trades, rules.baseAsset, rules.quoteAsset);
    const proceeds = quoteReceived - fee;
    const pnlQuote = proceeds - position.totalCost;
    const netPnlPct = position.totalCost ? pnlQuote / position.totalCost : 0;
    const syntheticSnapshot = marketSnapshot || {
      book: {
        bid: averagePrice,
        ask: averagePrice,
        mid: averagePrice,
        spreadBps: position.latestSpreadBps || 0
      }
    };
    const exitExecutionAttribution = this.execution.buildExecutionAttribution({
      plan: this.buildExitPlan(position, exitSource),
      marketSnapshot: syntheticSnapshot,
      side: "SELL",
      fillPrice: averagePrice,
      requestedQuoteAmount: position.notional || position.totalCost || 0,
      executedQuote: quoteReceived,
      executedQuantity: executedQty,
      orderResponses: [order],
      orderTelemetry,
      fillEstimate: syntheticSnapshot.book.exitEstimate || null,
      brokerMode: "live"
    });
    return {
      id: position.id,
      symbol: position.symbol,
      entryAt: position.entryAt,
      exitAt: nowIso(),
      entryPrice: position.entryPrice,
      exitPrice: averagePrice,
      quantity: executedQty,
      totalCost: position.totalCost,
      proceeds,
      pnlQuote,
      netPnlPct,
      mfePct: position.entryPrice ? Math.max(0, ((position.highestPrice || position.entryPrice) - position.entryPrice) / position.entryPrice) : 0,
      maePct: position.entryPrice ? Math.min(0, ((position.lowestPrice || position.entryPrice) - position.entryPrice) / position.entryPrice) : 0,
      executionQualityScore: this.execution.buildExecutionQuality({ marketSnapshot: syntheticSnapshot, fillPrice: averagePrice, side: "SELL" }),
      entryExecutionAttribution: position.entryExecutionAttribution || null,
      exitExecutionAttribution,
      regimeAtEntry: position.regimeAtEntry || "range",
      strategyAtEntry: position.strategyAtEntry || position.entryRationale?.strategy?.activeStrategy || null,
      entrySpreadBps: position.entrySpreadBps || 0,
      exitSpreadBps: syntheticSnapshot.book.spreadBps || 0,
      reason,
      exchangeOrderId: order.orderId,
      rawFeatures: position.rawFeatures,
      newsSummary: position.newsSummary,
      entryRationale: position.entryRationale || null,
      strategyDecision: position.strategyDecision || position.entryRationale?.strategy || null,
      transformerDecision: position.transformerDecision || position.entryRationale?.transformer || null,
      committeeDecision: position.committeeDecision || position.entryRationale?.committee || null,
      executionPolicyDecision: position.executionPolicyDecision || position.entryRationale?.rlPolicy || null,
      exitSource,
      brokerMode: "live"
    };
  }

  async syncPosition(position, runtime) {
    if (!position.protectiveOrderListId) {
      return null;
    }
    const orderList = await this.client.getOrderList({ orderListId: position.protectiveOrderListId });
    position.protectiveOrderStatus = orderList.listStatusType || orderList.listOrderStatus || position.protectiveOrderStatus;
    if (orderList.listStatusType !== "ALL_DONE" && orderList.listOrderStatus !== "ALL_DONE") {
      return null;
    }
    for (const listOrder of orderList.orders || []) {
      const order = await this.client.getOrder(position.symbol, { orderId: listOrder.orderId });
      if (order.status === "FILLED") {
        const trades = await this.client.getMyTrades(position.symbol, { orderId: order.orderId, limit: 50 });
        const orderTelemetry = await this.collectOrderTelemetry(position.symbol, [order.orderId]);
        runtime.openPositions = runtime.openPositions.filter((item) => item.id !== position.id);
        return this.buildTradeFromOrder(
          position,
          order,
          trades,
          order.type.includes("STOP") ? "protective_stop_loss" : "protective_take_profit",
          "exchange_protective_order",
          null,
          orderTelemetry
        );
      }
    }
    return null;
  }

  async reconcileRuntime({ runtime, getMarketSnapshot }) {
    const account = await this.client.getAccountInfo(true);
    const assetMap = toAssetMap(account);
    const closedTrades = [];
    const recoveredPositions = [];
    const warnings = [];

    for (const position of [...runtime.openPositions]) {
      const trade = await this.syncPosition(position, runtime);
      if (trade) {
        closedTrades.push(trade);
        continue;
      }
      const rules = this.symbolRules[position.symbol];
      const balance = assetMap[rules.baseAsset]?.total || 0;
      if (balance < Math.min(position.quantity * 0.5, rules.minQty || position.quantity)) {
        runtime.openPositions = runtime.openPositions.filter((item) => item.id !== position.id);
        warnings.push({ symbol: position.symbol, issue: "runtime_position_missing_on_exchange" });
        continue;
      }
      if (!position.protectiveOrderListId && this.config.enableExchangeProtection) {
        try {
          await this.ensureProtectiveOrder(position, rules);
        } catch (error) {
          warnings.push({ symbol: position.symbol, issue: "protective_order_rebuild_failed", error: error.message });
        }
      }
    }

    for (const [symbol, rules] of Object.entries(this.symbolRules)) {
      if (runtime.openPositions.some((position) => position.symbol === symbol)) {
        continue;
      }
      const assetBalance = assetMap[rules.baseAsset]?.total || 0;
      if (assetBalance < Math.max(rules.minQty || 0, 0)) {
        continue;
      }
      if (!this.config.allowRecoverUnsyncedPositions) {
        warnings.push({ symbol, issue: "unmanaged_balance_detected", quantity: assetBalance });
        continue;
      }
      const marketSnapshot = await getMarketSnapshot(symbol);
      const recoveredPosition = {
        id: crypto.randomUUID(),
        symbol,
        entryAt: nowIso(),
        entryPrice: marketSnapshot.book.mid,
        quantity: normalizeQuantity(assetBalance, rules, "floor", false),
        notional: assetBalance * marketSnapshot.book.mid,
        totalCost: assetBalance * marketSnapshot.book.mid,
        entryFee: 0,
        highestPrice: marketSnapshot.book.mid,
        lowestPrice: marketSnapshot.book.mid,
        lastMarkedPrice: marketSnapshot.book.mid,
        stopLossPrice: marketSnapshot.book.mid * (1 - this.config.stopLossPct),
        takeProfitPrice: marketSnapshot.book.mid * (1 + this.config.takeProfitPct),
        trailingStopPct: this.config.trailingStopPct,
        probabilityAtEntry: null,
        regimeAtEntry: "range",
        rawFeatures: {},
        newsSummary: EMPTY_NEWS,
        entryRationale: buildRecoveredRationale(symbol),
        executionPlan: null,
        entryExecutionAttribution: null,
        strategyAtEntry: null,
        strategyDecision: null,
        transformerDecision: null,
        committeeDecision: null,
        executionPolicyDecision: null,
        brokerMode: "live",
        recovered: true
      };
      runtime.openPositions.push(recoveredPosition);
      recoveredPositions.push(recoveredPosition);
      try {
        await this.ensureProtectiveOrder(recoveredPosition, rules);
      } catch (error) {
        warnings.push({ symbol, issue: "protective_order_for_recovered_position_failed", error: error.message });
      }
    }

    return {
      closedTrades,
      recoveredPositions,
      warnings,
      account: {
        canTrade: account.canTrade,
        accountType: account.accountType,
        permissions: account.permissions
      }
    };
  }

  async scaleOutPosition({ position, rules, marketSnapshot, fraction, reason }) {
    await this.cancelProtectiveOrders(position);
    const originalQuantity = Number(position.quantity || 0);
    const requestedFraction = Math.min(Math.max(fraction || this.config.scaleOutFraction, 0.05), 0.95);
    const requestedQuantity = normalizeQuantity(originalQuantity * requestedFraction, rules, "floor", true);
    if (!requestedQuantity || requestedQuantity >= originalQuantity) {
      throw new Error(`Unable to normalize scale-out quantity for ${position.symbol}.`);
    }
    const remainingQuantity = originalQuantity - requestedQuantity;
    const remainingNotional = remainingQuantity * (marketSnapshot.book.mid || position.entryPrice);
    if (remainingQuantity < (rules.minQty || 0) || remainingNotional < Math.max(rules.minNotional || 0, this.config.scaleOutMinNotionalUsd)) {
      throw new Error(`Scale-out would leave an invalid remainder for ${position.symbol}.`);
    }

    const order = await this.client.placeOrder({
      symbol: position.symbol,
      side: "SELL",
      type: "MARKET",
      quantity: formatQuantity(requestedQuantity, rules, true),
      ...this.buildOrderRequestMeta(position.executionPlan || {}, rules, "FULL")
    });
    const orderTelemetry = await this.collectOrderTelemetry(position.symbol, [order.orderId]);
    const executedQty = Number(order.executedQty || requestedQuantity);
    const quoteReceived = Number(order.cummulativeQuoteQty || 0);
    const averagePrice = executedQty ? quoteReceived / executedQty : marketSnapshot.book.bid;
    const fee = sumTradeCommissionsToQuote(order.fills || [], rules.baseAsset, rules.quoteAsset);
    const netProceeds = quoteReceived - fee;
    const proportion = executedQty / Math.max(originalQuantity, 1e-9);
    const allocatedCost = position.totalCost * proportion;
    const realizedPnl = netProceeds - allocatedCost;
    position.quantity = Math.max(0, originalQuantity - executedQty);
    position.totalCost = Math.max(0, position.totalCost - allocatedCost);
    position.notional = position.entryPrice * position.quantity;
    position.entryFee = Math.max(0, (position.entryFee || 0) - (position.entryFee || 0) * proportion);
    position.scaleOutCompletedAt = nowIso();
    position.scaleOutCount = (position.scaleOutCount || 0) + 1;
    position.lastMarkedPrice = marketSnapshot.book.mid;
    position.stopLossPrice = Math.max(position.stopLossPrice, position.entryPrice * (1 + (position.scaleOutTrailOffsetPct || this.config.scaleOutTrailOffsetPct)));
    position.protectiveOrderListId = null;
    position.protectiveOrders = [];
    position.protectiveOrderStatus = null;
    await this.ensureProtectiveOrder(position, rules);

    return {
      id: `${position.id}:scaleout:${Date.now()}`,
      positionId: position.id,
      symbol: position.symbol,
      at: nowIso(),
      fraction: proportion,
      quantity: executedQty,
      price: averagePrice,
      grossProceeds: quoteReceived,
      netProceeds,
      fee,
      allocatedCost,
      realizedPnl,
      reason,
      brokerMode: "live",
      executionAttribution: this.execution.buildExecutionAttribution({
        plan: this.buildExitPlan(position, "bot_partial_exit"),
        marketSnapshot,
        side: "SELL",
        fillPrice: averagePrice,
        requestedQuoteAmount: allocatedCost,
        executedQuote: quoteReceived,
        executedQuantity: executedQty,
        orderResponses: [order],
        orderTelemetry,
        fillEstimate: marketSnapshot.book.exitEstimate || null,
        brokerMode: "live"
      })
    };
  }

  async exitPosition({ position, rules, marketSnapshot, reason, runtime }) {
    await this.cancelProtectiveOrders(position);
    const quantity = normalizeQuantity(position.quantity, rules, "floor", true);
    if (!quantity) {
      throw new Error(`Unable to normalize sell quantity for ${position.symbol}.`);
    }
    const order = await this.client.placeOrder({
      symbol: position.symbol,
      side: "SELL",
      type: "MARKET",
      quantity: formatQuantity(quantity, rules, true),
      ...this.buildOrderRequestMeta(position.executionPlan || {}, rules, "FULL")
    });
    const orderTelemetry = await this.collectOrderTelemetry(position.symbol, [order.orderId]);
    runtime.openPositions = runtime.openPositions.filter((item) => item.id !== position.id);
    return this.buildTradeFromOrder(position, order, order.fills || [], reason, "bot_market_exit", marketSnapshot, orderTelemetry);
  }
}

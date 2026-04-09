import { LiveBroker } from "./liveBroker.js";

function remapExecutionAttribution(attribution = null) {
  if (!attribution || typeof attribution !== "object") {
    return attribution;
  }
  return {
    ...attribution,
    brokerMode: "paper",
    executionVenue: "binance_demo_spot"
  };
}

function remapPosition(position = null) {
  if (!position || typeof position !== "object") {
    return position;
  }
  return {
    ...position,
    brokerMode: "paper",
    executionVenue: "binance_demo_spot",
    entryExecutionAttribution: remapExecutionAttribution(position.entryExecutionAttribution || null)
  };
}

function remapTrade(trade = null) {
  if (!trade || typeof trade !== "object") {
    return trade;
  }
  return {
    ...trade,
    brokerMode: "paper",
    executionVenue: "binance_demo_spot",
    entryExecutionAttribution: remapExecutionAttribution(trade.entryExecutionAttribution || null),
    exitExecutionAttribution: remapExecutionAttribution(trade.exitExecutionAttribution || null)
  };
}

function remapScaleOut(event = null) {
  if (!event || typeof event !== "object") {
    return event;
  }
  if (event.closedTrade) {
    return {
      ...event,
      closedTrade: remapTrade(event.closedTrade)
    };
  }
  return {
    ...event,
    brokerMode: "paper",
    executionVenue: "binance_demo_spot",
    executionAttribution: remapExecutionAttribution(event.executionAttribution || null)
  };
}

export class DemoPaperBroker extends LiveBroker {
  async doctor(runtime) {
    const doctor = await super.doctor(runtime);
    return {
      ...doctor,
      mode: "paper",
      executionVenue: "binance_demo_spot"
    };
  }

  buildEntryFromExecutions(args = {}) {
    return remapPosition(super.buildEntryFromExecutions(args));
  }

  buildTradeFromOrder(...args) {
    return remapTrade(super.buildTradeFromOrder(...args));
  }

  async reconcileRuntime(args = {}) {
    const result = await super.reconcileRuntime(args);
    return {
      ...result,
      closedTrades: (result.closedTrades || []).map((trade) => remapTrade(trade)),
      recoveredPositions: (result.recoveredPositions || []).map((position) => remapPosition(position)),
      account: result.account
        ? {
            ...result.account,
            mode: "paper",
            executionVenue: "binance_demo_spot"
          }
        : result.account
    };
  }

  async scaleOutPosition(args = {}) {
    return remapScaleOut(await super.scaleOutPosition(args));
  }
}

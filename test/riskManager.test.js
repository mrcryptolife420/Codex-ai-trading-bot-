import test from "node:test";
import assert from "node:assert/strict";
import { RiskManager } from "../src/risk/riskManager.js";

const config = {
  startingCash: 10000,
  maxOpenPositions: 2,
  modelThreshold: 0.62,
  minModelConfidence: 0.58,
  maxSpreadBps: 25,
  maxRealizedVolPct: 0.07,
  maxDailyDrawdown: 0.04,
  entryCooldownMinutes: 30,
  stopLossPct: 0.018,
  takeProfitPct: 0.03,
  maxPositionFraction: 0.15,
  riskPerTrade: 0.01,
  minTradeUsdt: 25,
  maxHoldMinutes: 360
};

test("risk manager blocks entry on drawdown and wide spread", () => {
  const manager = new RiskManager(config);
  const decision = manager.evaluateEntry({
    symbol: "BTCUSDT",
    score: { probability: 0.7 },
    marketSnapshot: {
      book: { spreadBps: 30 },
      market: { realizedVolPct: 0.03, atrPct: 0.01 }
    },
    newsSummary: { riskScore: 0.1, sentimentScore: 0, confidence: 0.3 },
    runtime: { openPositions: [] },
    journal: {
      trades: [
        {
          symbol: "ETHUSDT",
          exitAt: "2026-03-08T09:00:00.000Z",
          pnlQuote: -500
        }
      ]
    },
    balance: { quoteFree: 8000 },
    symbolStats: { avgPnlPct: 0 },
    nowIso: "2026-03-08T10:00:00.000Z"
  });

  assert.equal(decision.allow, false);
  assert.ok(decision.reasons.includes("spread_too_wide"));
  assert.ok(decision.reasons.includes("daily_drawdown_limit_hit"));
});

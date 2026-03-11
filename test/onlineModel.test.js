import test from "node:test";
import assert from "node:assert/strict";
import { OnlineTradingModel } from "../src/ai/onlineModel.js";

test("online model updates weights after a losing and winning trade", () => {
  const model = new OnlineTradingModel(
    {
      bias: 0,
      weights: {},
      featureStats: {},
      symbolStats: {}
    },
    {
      modelLearningRate: 0.1,
      modelL2: 0.001
    }
  );

  const features = { momentum_5: 1.2, news_sentiment: 0.6 };
  const before = model.score(features).probability;
  model.updateFromTrade({
    symbol: "BTCUSDT",
    rawFeatures: features,
    netPnlPct: 0.03,
    exitAt: new Date().toISOString()
  });
  const afterWin = model.score(features).probability;
  assert.ok(afterWin > before);

  model.updateFromTrade({
    symbol: "BTCUSDT",
    rawFeatures: features,
    netPnlPct: -0.02,
    exitAt: new Date().toISOString()
  });
  const stats = model.getSymbolStats("BTCUSDT");
  assert.equal(stats.trades, 2);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 1);
});

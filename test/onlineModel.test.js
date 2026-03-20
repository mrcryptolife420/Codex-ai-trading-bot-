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

test("online model uses composites to damp redundant trend proxies", () => {
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

  const withoutComposite = model.score({
    momentum_20: 2,
    ema_gap: 2,
    ema_trend_score: 2,
    trend_quality: 2
  });
  const withComposite = model.score({
    momentum_20: 2,
    ema_gap: 2,
    ema_trend_score: 2,
    trend_quality: 2,
    trend_quality_composite: 2
  });

  const withoutMomentum = withoutComposite.contributions.find((item) => item.name === "momentum_20");
  const withMomentum = withComposite.contributions.find((item) => item.name === "momentum_20");
  const compositeContribution = withComposite.contributions.find((item) => item.name === "trend_quality_composite");

  assert.ok(Math.abs(withMomentum.contribution) < Math.abs(withoutMomentum.contribution));
  assert.ok(compositeContribution.contribution > 0);
});

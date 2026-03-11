import test from "node:test";
import assert from "node:assert/strict";
import { buildSymbolRules, resolveMarketBuyQuantity } from "../src/binance/symbolFilters.js";

const exchangeInfo = {
  symbols: [
    {
      symbol: "BTCUSDT",
      status: "TRADING",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      filters: [
        { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "1000000", tickSize: "0.01" },
        { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
        { filterType: "MARKET_LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
        { filterType: "MIN_NOTIONAL", minNotional: "10" }
      ]
    }
  ]
};

test("market buy sizing respects min notional and step size", () => {
  const rules = buildSymbolRules(exchangeInfo, "USDT").BTCUSDT;
  const valid = resolveMarketBuyQuantity(100, 50000, rules);
  assert.equal(valid.valid, true);
  assert.ok(valid.quantity > 0);

  const invalid = resolveMarketBuyQuantity(5, 50000, rules);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, "notional_below_minimum");
});

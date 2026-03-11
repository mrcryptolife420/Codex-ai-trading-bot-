import { formatDecimal, roundToStep } from "../utils/math.js";

function parseFilter(symbolInfo, filterType) {
  return symbolInfo.filters.find((filter) => filter.filterType === filterType) || null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildSymbolRules(exchangeInfo, expectedQuoteAsset) {
  const symbols = exchangeInfo.symbols || [];
  return Object.fromEntries(
    symbols
      .filter(
        (symbolInfo) =>
          symbolInfo.status === "TRADING" &&
          (!expectedQuoteAsset || symbolInfo.quoteAsset === expectedQuoteAsset)
      )
      .map((symbolInfo) => {
        const priceFilter = parseFilter(symbolInfo, "PRICE_FILTER");
        const lotSize = parseFilter(symbolInfo, "LOT_SIZE");
        const marketLotSize = parseFilter(symbolInfo, "MARKET_LOT_SIZE") || lotSize;
        const minNotional =
          parseFilter(symbolInfo, "NOTIONAL") || parseFilter(symbolInfo, "MIN_NOTIONAL");

        return [
          symbolInfo.symbol,
          {
            symbol: symbolInfo.symbol,
            baseAsset: symbolInfo.baseAsset,
            quoteAsset: symbolInfo.quoteAsset,
            minPrice: toNumber(priceFilter?.minPrice),
            maxPrice: toNumber(priceFilter?.maxPrice, Number.MAX_SAFE_INTEGER),
            tickSize: toNumber(priceFilter?.tickSize),
            minQty: toNumber(lotSize?.minQty),
            maxQty: toNumber(lotSize?.maxQty, Number.MAX_SAFE_INTEGER),
            stepSize: toNumber(lotSize?.stepSize),
            marketMinQty: toNumber(marketLotSize?.minQty, toNumber(lotSize?.minQty)),
            marketMaxQty: toNumber(
              marketLotSize?.maxQty,
              toNumber(lotSize?.maxQty, Number.MAX_SAFE_INTEGER)
            ),
            marketStepSize: toNumber(
              marketLotSize?.stepSize,
              toNumber(lotSize?.stepSize)
            ),
            minNotional: toNumber(minNotional?.minNotional),
            maxNotional: toNumber(minNotional?.maxNotional, Number.MAX_SAFE_INTEGER),
            defaultSelfTradePreventionMode:
              symbolInfo.defaultSelfTradePreventionMode || "NONE",
            allowedSelfTradePreventionModes:
              symbolInfo.allowedSelfTradePreventionModes || ["NONE"]
          }
        ];
      })
  );
}

export function normalizePrice(price, rules, mode = "round") {
  const stepped = roundToStep(price, rules.tickSize, mode);
  return Math.min(rules.maxPrice, Math.max(rules.minPrice, stepped));
}

export function normalizeQuantity(quantity, rules, mode = "floor", market = true) {
  const step = market ? rules.marketStepSize || rules.stepSize : rules.stepSize;
  const minQty = market ? rules.marketMinQty || rules.minQty : rules.minQty;
  const maxQty = market ? rules.marketMaxQty || rules.maxQty : rules.maxQty;
  const stepped = roundToStep(quantity, step, mode);
  if (stepped < minQty) {
    return 0;
  }
  return Math.min(maxQty, stepped);
}

export function resolveMarketBuyQuantity(quoteAmount, price, rules) {
  const rawQuantity = quoteAmount / price;
  const quantity = normalizeQuantity(rawQuantity, rules, "floor", true);
  if (!quantity) {
    return {
      quantity: 0,
      notional: 0,
      valid: false,
      reason: "quantity_below_minimum"
    };
  }

  const notional = quantity * price;
  if (notional < rules.minNotional) {
    return {
      quantity,
      notional,
      valid: false,
      reason: "notional_below_minimum"
    };
  }

  return {
    quantity,
    notional,
    valid: true
  };
}

export function formatPrice(price, rules) {
  return formatDecimal(price, rules.tickSize || 8);
}

export function formatQuantity(quantity, rules, market = true) {
  const step = market ? rules.marketStepSize || rules.stepSize : rules.stepSize;
  return formatDecimal(quantity, step || 8);
}

export function resolveStpMode(preferredMode, rules) {
  const allowed = rules.allowedSelfTradePreventionModes || ["NONE"];
  if (preferredMode && allowed.includes(preferredMode)) {
    return preferredMode;
  }
  return rules.defaultSelfTradePreventionMode || allowed[0] || "NONE";
}

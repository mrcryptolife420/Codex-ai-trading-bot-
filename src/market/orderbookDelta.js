const DEFAULT_BUFFER_SIZE = 500;
const DEFAULT_WINDOW_SECONDS = 60;

const symbolBuffers = new Map();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBufferSize() {
  return Math.max(10, toNumber(process.env.AGGTRADE_BUFFER_SIZE, DEFAULT_BUFFER_SIZE));
}

function getDefaultWindowSeconds() {
  return Math.max(5, toNumber(process.env.AGGTRADE_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS));
}

function normalizeSymbol(symbol) {
  return `${symbol || ""}`.trim().toUpperCase();
}

function parseTrade(symbol, trade) {
  const quantity = toNumber(trade?.q ?? trade?.quantity, 0);
  const price = toNumber(trade?.p ?? trade?.price, 0);
  const volume = quantity > 0 ? quantity : 0;
  const quoteVolume = quantity > 0 && price > 0 ? quantity * price : 0;
  const buyerMakerRaw = trade?.m ?? trade?.buyerMaker;
  const buyerMaker = Boolean(buyerMakerRaw);
  const timestamp = toNumber(trade?.T ?? trade?.E ?? trade?.timestamp, Date.now());
  return {
    symbol,
    timestamp,
    volume,
    quoteVolume,
    buyerMaker
  };
}

function getOrCreateBuffer(symbol) {
  if (!symbolBuffers.has(symbol)) {
    symbolBuffers.set(symbol, []);
  }
  return symbolBuffers.get(symbol);
}

function pruneBuffer(buffer, windowMs, hardLimit) {
  const minTimestamp = Date.now() - windowMs;
  while (buffer.length > 0 && buffer[0].timestamp < minTimestamp) {
    buffer.shift();
  }
  while (buffer.length > hardLimit) {
    buffer.shift();
  }
}

function calculateDelta(symbol, trades, windowSeconds) {
  const buyTrades = [];
  const sellTrades = [];
  for (const trade of trades) {
    if (trade.buyerMaker) {
      sellTrades.push(trade);
    } else {
      buyTrades.push(trade);
    }
  }
  const buyVolume = buyTrades.reduce((sum, trade) => sum + trade.volume, 0);
  const sellVolume = sellTrades.reduce((sum, trade) => sum + trade.volume, 0);
  const totalVolume = buyVolume + sellVolume;
  const delta = buyVolume - sellVolume;
  const deltaRatio = totalVolume > 0 ? delta / totalVolume : 0;
  const absRatio = Math.abs(deltaRatio);
  const pressure = delta > 0 ? "buy" : delta < 0 ? "sell" : "neutral";
  const dataQuality = totalVolume <= 0
    ? "empty"
    : trades.length < Math.max(5, Math.floor(windowSeconds / 8))
      ? "low"
      : absRatio > 0.65 && trades.length < 12
        ? "medium"
        : "high";
  return {
    symbol,
    delta,
    buyVolume,
    sellVolume,
    totalVolume,
    deltaRatio,
    pressure,
    tradeCount: trades.length,
    dataQuality
  };
}

export function recordAggTrade(symbol, trade) {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol || !trade) {
    return null;
  }
  const parsed = parseTrade(normalizedSymbol, trade);
  const buffer = getOrCreateBuffer(normalizedSymbol);
  buffer.push(parsed);
  pruneBuffer(buffer, getDefaultWindowSeconds() * 1000, getBufferSize());
  return {
    symbol: normalizedSymbol,
    accepted: parsed.volume > 0,
    bufferSize: buffer.length
  };
}

export function getOrderflowDelta(symbol, windowSeconds) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const buffer = symbolBuffers.get(normalizedSymbol) || [];
  const effectiveWindow = Math.max(5, toNumber(windowSeconds, getDefaultWindowSeconds()));
  const minTimestamp = Date.now() - effectiveWindow * 1000;
  const scopedTrades = buffer.filter((trade) => trade.timestamp >= minTimestamp);
  return calculateDelta(normalizedSymbol, scopedTrades, effectiveWindow);
}

export function getAllDeltas(windowSeconds) {
  const effectiveWindow = Math.max(5, toNumber(windowSeconds, getDefaultWindowSeconds()));
  const deltas = [];
  for (const symbol of symbolBuffers.keys()) {
    deltas.push(getOrderflowDelta(symbol, effectiveWindow));
  }
  return deltas;
}

export function resetBuffer(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) {
    return { symbol: normalizedSymbol, cleared: false };
  }
  const existed = symbolBuffers.delete(normalizedSymbol);
  return { symbol: normalizedSymbol, cleared: existed };
}

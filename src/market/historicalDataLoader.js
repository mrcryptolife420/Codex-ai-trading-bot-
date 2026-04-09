import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const DATA_BINANCE_VISION_BASE_URL = "https://data.binance.vision/data/spot/monthly/klines";
const HISTORICAL_CACHE_DIR = path.join(process.cwd(), "data", "historical");

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSymbol(symbol) {
  return `${symbol || "BTCUSDT"}`.trim().toUpperCase();
}

function normalizeInterval(interval) {
  return `${interval || "15m"}`.trim();
}

function parseCsvLine(line) {
  const parts = line.split(",");
  if (parts.length < 9) {
    return null;
  }
  return {
    openTime: toNumber(parts[0], 0),
    open: toNumber(parts[1], 0),
    high: toNumber(parts[2], 0),
    low: toNumber(parts[3], 0),
    close: toNumber(parts[4], 0),
    volume: toNumber(parts[5], 0),
    closeTime: toNumber(parts[6], 0),
    quoteVolume: toNumber(parts[7], 0),
    trades: toNumber(parts[8], 0)
  };
}

function parseKlineCsv(csvText) {
  const candles = [];
  for (const rawLine of `${csvText || ""}`.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const candle = parseCsvLine(line);
    if (candle && candle.openTime > 0) {
      candles.push(candle);
    }
  }
  return candles;
}

function monthKeyUtc(date) {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${y}-${m}`;
}

function monthRangeForDays(daysBack = 90) {
  const clampedDays = Math.max(1, toNumber(daysBack, 90));
  const now = new Date();
  const start = new Date(now.getTime() - clampedDays * 24 * 60 * 60 * 1000);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const months = [];
  while (cursor.getTime() <= end.getTime()) {
    months.push(monthKeyUtc(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

async function ensureCacheDir() {
  await fs.mkdir(HISTORICAL_CACHE_DIR, { recursive: true });
}

function extractFirstCsvFromZip(buffer) {
  const signature = 0x04034b50;
  const localHeaderLength = 30;
  let offset = 0;
  while (offset + localHeaderLength <= buffer.length) {
    const header = buffer.readUInt32LE(offset);
    if (header !== signature) {
      break;
    }
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + localHeaderLength;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = buffer.slice(fileNameStart, fileNameEnd).toString("utf8");
    const dataStart = fileNameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      break;
    }
    const payload = buffer.slice(dataStart, dataEnd);
    if (fileName.toLowerCase().endsWith(".csv")) {
      if (compressionMethod === 0) {
        return payload.toString("utf8");
      }
      if (compressionMethod === 8) {
        return zlib.inflateRawSync(payload).toString("utf8");
      }
    }
    offset = dataEnd;
  }
  throw new Error("Geen CSV gevonden in ZIP-bestand");
}

async function downloadMonthlyCsv({ symbol, interval, month }) {
  const zipName = `${symbol}-${interval}-${month}.zip`;
  const url = `${DATA_BINANCE_VISION_BASE_URL}/${symbol}/${interval}/${zipName}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download mislukt (${response.status}) voor ${url}`);
  }
  const zipBuffer = Buffer.from(await response.arrayBuffer());
  return extractFirstCsvFromZip(zipBuffer);
}

function cachePathFor({ symbol, interval, month }) {
  return path.join(HISTORICAL_CACHE_DIR, `${symbol}-${interval}-${month}.csv`);
}

async function getMonthlyCsv({ symbol, interval, month }) {
  await ensureCacheDir();
  const cachePath = cachePathFor({ symbol, interval, month });
  try {
    return await fs.readFile(cachePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const csv = await downloadMonthlyCsv({ symbol, interval, month });
  await fs.writeFile(cachePath, csv, "utf8");
  return csv;
}

function dedupeSortAndFilter(candles, daysBack = 90) {
  const byOpenTime = new Map();
  for (const candle of candles) {
    if (!candle || !Number.isFinite(candle.openTime)) {
      continue;
    }
    byOpenTime.set(candle.openTime, candle);
  }
  const sorted = Array.from(byOpenTime.values()).sort((a, b) => a.openTime - b.openTime);
  const since = Date.now() - Math.max(1, toNumber(daysBack, 90)) * 24 * 60 * 60 * 1000;
  return sorted.filter((candle) => candle.openTime >= since);
}

export async function loadHistoricalKlines(symbol, interval, daysBack = 90) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedInterval = normalizeInterval(interval);
  const months = monthRangeForDays(daysBack);
  const merged = [];
  const sources = [];
  for (const month of months) {
    try {
      const csv = await getMonthlyCsv({
        symbol: normalizedSymbol,
        interval: normalizedInterval,
        month
      });
      const candles = parseKlineCsv(csv);
      merged.push(...candles);
      sources.push({ month, count: candles.length, ok: true });
    } catch (error) {
      sources.push({ month, count: 0, ok: false, error: error.message });
    }
  }
  const candles = dedupeSortAndFilter(merged, daysBack);
  return {
    symbol: normalizedSymbol,
    interval: normalizedInterval,
    daysBack: Math.max(1, toNumber(daysBack, 90)),
    candleCount: candles.length,
    candles,
    sources
  };
}

export async function loadHistoricalKlinesMulti(symbols, interval, daysBack = 90) {
  const items = Array.isArray(symbols) && symbols.length ? symbols : ["BTCUSDT"];
  const entries = await Promise.all(
    items.map(async (symbol) => {
      const data = await loadHistoricalKlines(symbol, interval, daysBack);
      return [normalizeSymbol(symbol), data];
    })
  );
  return Object.fromEntries(entries);
}

export function summarizeHistoricalData(candlesMap) {
  const symbols = [];
  let totalCandles = 0;
  for (const [symbol, payload] of Object.entries(candlesMap || {})) {
    const candles = payload?.candles || [];
    totalCandles += candles.length;
    symbols.push({
      symbol,
      interval: payload?.interval || null,
      daysBack: payload?.daysBack || null,
      candleCount: candles.length,
      firstOpenTime: candles[0]?.openTime || null,
      lastOpenTime: candles.at(-1)?.openTime || null,
      sourceMonths: (payload?.sources || []).length,
      sourceFailures: (payload?.sources || []).filter((source) => !source.ok).length
    });
  }
  return {
    symbolCount: symbols.length,
    totalCandles,
    generatedAt: new Date().toISOString(),
    symbols
  };
}

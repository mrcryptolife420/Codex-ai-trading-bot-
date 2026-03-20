import path from "node:path";
import { ensureDir, loadJson, saveJson } from "../utils/fs.js";

const STORE_VERSION = 1;

export function intervalToMs(interval = "15m") {
  const match = /^([0-9]+)([mhdwM])$/i.exec(`${interval}`.trim());
  if (!match) {
    throw new Error(`Unsupported interval: ${interval}`);
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 7 * 86_400_000,
    M: 30 * 86_400_000
  };
  return amount * (multipliers[match[2]] || multipliers[unit]);
}

function normalizeCandle(candle = {}) {
  return {
    openTime: Number(candle.openTime || 0),
    closeTime: Number(candle.closeTime || 0),
    open: Number(candle.open || 0),
    high: Number(candle.high || 0),
    low: Number(candle.low || 0),
    close: Number(candle.close || 0),
    volume: Number(candle.volume || 0)
  };
}

function dedupeCandles(candles = []) {
  const map = new Map();
  for (const candle of candles || []) {
    const normalized = normalizeCandle(candle);
    if (!normalized.openTime) {
      continue;
    }
    map.set(normalized.openTime, normalized);
  }
  return [...map.values()].sort((left, right) => left.openTime - right.openTime);
}

export function analyzeCandles(candles = [], interval = "15m") {
  const intervalMs = typeof interval === "number" ? interval : intervalToMs(interval);
  const sorted = [...(candles || [])]
    .map(normalizeCandle)
    .filter((item) => item.openTime > 0)
    .sort((left, right) => left.openTime - right.openTime);
  let duplicateCount = 0;
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const delta = current.openTime - previous.openTime;
    if (delta === 0) {
      duplicateCount += 1;
      continue;
    }
    if (delta > intervalMs) {
      const missingCandles = Math.max(1, Math.round(delta / intervalMs) - 1);
      gaps.push({
        startTime: previous.openTime + intervalMs,
        endTime: current.openTime - intervalMs,
        missingCandles
      });
    }
  }
  const expectedCount = sorted.length && intervalMs > 0
    ? Math.round((sorted.at(-1).openTime - sorted[0].openTime) / intervalMs) + 1
    : sorted.length;
  return {
    intervalMs,
    count: sorted.length,
    duplicateCount,
    gapCount: gaps.length,
    gaps,
    expectedCount,
    firstOpenTime: sorted[0]?.openTime || null,
    lastOpenTime: sorted.at(-1)?.openTime || null,
    candles: sorted
  };
}

function buildEmptySeries(symbol, interval) {
  return {
    version: STORE_VERSION,
    source: "binance_spot",
    symbol,
    interval,
    intervalMs: intervalToMs(interval),
    updatedAt: null,
    candles: []
  };
}

export class MarketHistoryStore {
  constructor({ rootDir, logger = null } = {}) {
    this.rootDir = rootDir;
    this.logger = logger;
  }

  async init() {
    await ensureDir(this.rootDir);
  }

  seriesPath(symbol, interval) {
    return path.join(this.rootDir, "binance", "spot", "klines", interval, `${symbol}.json`);
  }

  async loadSeries({ symbol, interval }) {
    const loaded = await loadJson(this.seriesPath(symbol, interval), buildEmptySeries(symbol, interval));
    const merged = {
      ...buildEmptySeries(symbol, interval),
      ...(loaded || {}),
      symbol,
      interval,
      intervalMs: intervalToMs(interval)
    };
    merged.candles = dedupeCandles(merged.candles || []);
    return merged;
  }

  async saveSeries(series = {}) {
    const next = {
      ...buildEmptySeries(series.symbol, series.interval),
      ...series,
      intervalMs: intervalToMs(series.interval),
      candles: dedupeCandles(series.candles || [])
    };
    next.updatedAt = next.updatedAt || new Date().toISOString();
    await saveJson(this.seriesPath(next.symbol, next.interval), next);
    return next;
  }

  async upsertCandles({ symbol, interval, candles = [] }) {
    const existing = await this.loadSeries({ symbol, interval });
    const mergedCandles = dedupeCandles([...(existing.candles || []), ...(candles || [])]);
    const saved = await this.saveSeries({
      ...existing,
      updatedAt: new Date().toISOString(),
      candles: mergedCandles
    });
    return this.verifySeries({ symbol, interval, series: saved });
  }

  async getCandles({ symbol, interval, startTime = null, endTime = null, limit = null }) {
    const series = await this.loadSeries({ symbol, interval });
    let candles = series.candles || [];
    if (startTime != null) {
      candles = candles.filter((item) => item.openTime >= Number(startTime));
    }
    if (endTime != null) {
      candles = candles.filter((item) => item.openTime <= Number(endTime));
    }
    if (Number.isFinite(limit) && limit > 0 && candles.length > limit) {
      candles = candles.slice(-limit);
    }
    return candles;
  }

  async verifySeries({ symbol, interval, series = null }) {
    const loaded = series || await this.loadSeries({ symbol, interval });
    const analysis = analyzeCandles(loaded.candles || [], interval);
    return {
      symbol,
      interval,
      count: analysis.count,
      duplicateCount: analysis.duplicateCount,
      gapCount: analysis.gapCount,
      gaps: analysis.gaps,
      firstOpenTime: analysis.firstOpenTime,
      lastOpenTime: analysis.lastOpenTime,
      updatedAt: loaded.updatedAt || null,
      path: this.seriesPath(symbol, interval)
    };
  }
}

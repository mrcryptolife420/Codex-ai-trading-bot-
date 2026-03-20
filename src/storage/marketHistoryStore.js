import path from "node:path";
import { ensureDir, listFiles, loadJson, removeFile, saveJson } from "../utils/fs.js";

const STORE_VERSION = 2;

function arr(value) {
  return Array.isArray(value) ? value : [];
}

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
  const segments = [];
  let segmentStart = sorted[0]?.openTime || null;
  let segmentCount = sorted.length ? 1 : 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const delta = current.openTime - previous.openTime;
    if (delta === 0) {
      duplicateCount += 1;
      continue;
    }
    if (delta > intervalMs) {
      segments.push({
        startTime: segmentStart,
        endTime: previous.openTime,
        count: segmentCount
      });
      segmentStart = current.openTime;
      segmentCount = 1;
      const missingCandles = Math.max(1, Math.round(delta / intervalMs) - 1);
      gaps.push({
        startTime: previous.openTime + intervalMs,
        endTime: current.openTime - intervalMs,
        missingCandles
      });
      continue;
    }
    segmentCount += 1;
  }
  if (segmentStart != null) {
    segments.push({
      startTime: segmentStart,
      endTime: sorted.at(-1)?.openTime || segmentStart,
      count: segmentCount
    });
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
    segments,
    expectedCount,
    coverageRatio: expectedCount > 0 ? sorted.length / expectedCount : 1,
    firstOpenTime: sorted[0]?.openTime || null,
    lastOpenTime: sorted.at(-1)?.openTime || null,
    candles: sorted
  };
}

function buildEmptySeries(symbol, interval, partitionGranularity = "month") {
  return {
    version: STORE_VERSION,
    source: "binance_spot",
    symbol,
    interval,
    intervalMs: intervalToMs(interval),
    updatedAt: null,
    partitionGranularity,
    partitions: [],
    candles: []
  };
}

function partitionKeyForOpenTime(openTime, partitionGranularity = "month") {
  const date = new Date(Number(openTime));
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return partitionGranularity === "day" ? `${year}-${month}-${day}` : `${year}-${month}`;
}

function partitionStartsAt(partitionId, partitionGranularity = "month") {
  if (partitionGranularity === "day") {
    return new Date(`${partitionId}T00:00:00.000Z`).getTime();
  }
  return new Date(`${partitionId}-01T00:00:00.000Z`).getTime();
}

function partitionEndsAt(partitionId, partitionGranularity = "month", intervalMs = 60_000) {
  const start = partitionStartsAt(partitionId, partitionGranularity);
  const next = new Date(start);
  if (partitionGranularity === "day") {
    next.setUTCDate(next.getUTCDate() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next.getTime() - intervalMs;
}

function buildPartitionMetadata(partitionId, candles = [], partitionGranularity = "month", intervalMs = 60_000) {
  const normalized = dedupeCandles(candles);
  return {
    id: partitionId,
    startTime: normalized[0]?.openTime || partitionStartsAt(partitionId, partitionGranularity),
    endTime: normalized.at(-1)?.openTime || partitionEndsAt(partitionId, partitionGranularity, intervalMs),
    count: normalized.length,
    updatedAt: new Date().toISOString()
  };
}

function filterPartitionMetas(partitions = [], { startTime = null, endTime = null } = {}) {
  const lower = startTime == null ? Number.NEGATIVE_INFINITY : Number(startTime);
  const upper = endTime == null ? Number.POSITIVE_INFINITY : Number(endTime);
  return arr(partitions).filter((item) => (item.endTime || Number.NEGATIVE_INFINITY) >= lower && (item.startTime || Number.POSITIVE_INFINITY) <= upper);
}

function buildFreshnessSummary(lastOpenTime, intervalMs, referenceNow, freshnessThresholdMultiplier = 4) {
  const referenceTime = new Date(referenceNow).getTime();
  const lastOpen = Number(lastOpenTime);
  if (!Number.isFinite(referenceTime) || !Number.isFinite(lastOpen) || !intervalMs) {
    return {
      latestClosedOpenTime: null,
      freshnessLagCandles: null,
      freshnessLagMs: null,
      stale: false
    };
  }
  const latestClosedOpenTime = Math.floor((referenceTime - intervalMs) / intervalMs) * intervalMs;
  const freshnessLagMs = Math.max(0, latestClosedOpenTime - lastOpen);
  const freshnessLagCandles = Math.max(0, Math.round(freshnessLagMs / intervalMs));
  return {
    latestClosedOpenTime,
    freshnessLagCandles,
    freshnessLagMs,
    stale: freshnessLagCandles > Math.max(0, Number(freshnessThresholdMultiplier || 4))
  };
}

export class MarketHistoryStore {
  constructor({ rootDir, logger = null, partitionGranularity = "month" } = {}) {
    this.rootDir = rootDir;
    this.logger = logger;
    this.partitionGranularity = ["day", "month"].includes(partitionGranularity) ? partitionGranularity : "month";
  }

  async init() {
    await ensureDir(this.rootDir);
  }

  legacySeriesPath(symbol, interval) {
    return path.join(this.rootDir, "binance", "spot", "klines", interval, `${symbol}.json`);
  }

  seriesDir(symbol, interval) {
    return path.join(this.rootDir, "binance", "spot", "klines", interval, symbol);
  }

  seriesPath(symbol, interval) {
    return path.join(this.seriesDir(symbol, interval), "manifest.json");
  }

  partitionDir(symbol, interval) {
    return path.join(this.seriesDir(symbol, interval), "parts");
  }

  partitionPath(symbol, interval, partitionId) {
    return path.join(this.partitionDir(symbol, interval), `${partitionId}.json`);
  }

  async loadPartition({ symbol, interval, partitionId }) {
    const payload = await loadJson(this.partitionPath(symbol, interval, partitionId), null);
    return dedupeCandles(payload?.candles || []);
  }

  async maybeMigrateLegacySeries(symbol, interval) {
    const manifest = await loadJson(this.seriesPath(symbol, interval), null);
    if (manifest) {
      return;
    }
    const legacy = await loadJson(this.legacySeriesPath(symbol, interval), null);
    if (!legacy?.candles?.length) {
      return;
    }
    await this.saveSeries({
      ...buildEmptySeries(symbol, interval, this.partitionGranularity),
      ...legacy,
      symbol,
      interval,
      partitionGranularity: this.partitionGranularity,
      candles: dedupeCandles(legacy.candles || [])
    });
    await removeFile(this.legacySeriesPath(symbol, interval));
  }

  async loadManifest({ symbol, interval }) {
    await this.maybeMigrateLegacySeries(symbol, interval);
    const loaded = await loadJson(this.seriesPath(symbol, interval), buildEmptySeries(symbol, interval, this.partitionGranularity));
    return {
      ...buildEmptySeries(symbol, interval, loaded?.partitionGranularity || this.partitionGranularity),
      ...(loaded || {}),
      symbol,
      interval,
      intervalMs: intervalToMs(interval),
      partitionGranularity: loaded?.partitionGranularity || this.partitionGranularity,
      partitions: arr(loaded?.partitions).sort((left, right) => (left.startTime || 0) - (right.startTime || 0))
    };
  }

  async loadSeries({ symbol, interval, startTime = null, endTime = null }) {
    const manifest = await this.loadManifest({ symbol, interval });
    const selectedPartitions = filterPartitionMetas(manifest.partitions || [], { startTime, endTime });
    const candles = [];
    for (const partition of selectedPartitions) {
      candles.push(...await this.loadPartition({ symbol, interval, partitionId: partition.id }));
    }
    return {
      ...manifest,
      candles: dedupeCandles(candles)
    };
  }

  async saveSeries(series = {}) {
    const next = {
      ...buildEmptySeries(series.symbol, series.interval, series.partitionGranularity || this.partitionGranularity),
      ...series,
      intervalMs: intervalToMs(series.interval),
      partitionGranularity: series.partitionGranularity || this.partitionGranularity,
      candles: dedupeCandles(series.candles || [])
    };
    const partitionMap = new Map();
    for (const candle of next.candles || []) {
      const partitionId = partitionKeyForOpenTime(candle.openTime, next.partitionGranularity);
      if (!partitionMap.has(partitionId)) {
        partitionMap.set(partitionId, []);
      }
      partitionMap.get(partitionId).push(candle);
    }
    const partitionIds = [...partitionMap.keys()].sort();
    const existingFiles = await listFiles(this.partitionDir(next.symbol, next.interval));
    const activeFiles = new Set();
    const partitions = [];
    for (const partitionId of partitionIds) {
      const candles = dedupeCandles(partitionMap.get(partitionId) || []);
      const partitionPayload = {
        version: STORE_VERSION,
        symbol: next.symbol,
        interval: next.interval,
        partitionId,
        partitionGranularity: next.partitionGranularity,
        updatedAt: new Date().toISOString(),
        candles
      };
      const partitionFile = this.partitionPath(next.symbol, next.interval, partitionId);
      activeFiles.add(partitionFile);
      await saveJson(partitionFile, partitionPayload);
      partitions.push(buildPartitionMetadata(partitionId, candles, next.partitionGranularity, next.intervalMs));
    }
    for (const filePath of existingFiles) {
      if (!activeFiles.has(filePath)) {
        await removeFile(filePath);
      }
    }
    const manifest = {
      ...next,
      version: STORE_VERSION,
      updatedAt: new Date().toISOString(),
      partitions,
      candles: undefined
    };
    await saveJson(this.seriesPath(next.symbol, next.interval), manifest);
    return {
      ...manifest,
      candles: next.candles
    };
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
    const series = await this.loadSeries({ symbol, interval, startTime, endTime });
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

  async verifySeries({ symbol, interval, series = null, referenceNow = new Date().toISOString(), freshnessThresholdMultiplier = 4 } = {}) {
    const loaded = series || await this.loadSeries({ symbol, interval });
    const analysis = analyzeCandles(loaded.candles || [], interval);
    const freshness = buildFreshnessSummary(analysis.lastOpenTime, analysis.intervalMs, referenceNow, freshnessThresholdMultiplier);
    return {
      symbol,
      interval,
      count: analysis.count,
      expectedCount: analysis.expectedCount,
      coverageRatio: analysis.coverageRatio,
      duplicateCount: analysis.duplicateCount,
      gapCount: analysis.gapCount,
      gaps: analysis.gaps,
      segments: analysis.segments,
      firstOpenTime: analysis.firstOpenTime,
      lastOpenTime: analysis.lastOpenTime,
      latestClosedOpenTime: freshness.latestClosedOpenTime,
      freshnessLagCandles: freshness.freshnessLagCandles,
      freshnessLagMs: freshness.freshnessLagMs,
      stale: freshness.stale,
      updatedAt: loaded.updatedAt || null,
      partitionGranularity: loaded.partitionGranularity || this.partitionGranularity,
      partitionCount: arr(loaded.partitions).length,
      partitions: arr(loaded.partitions).map((item) => ({
        id: item.id,
        startTime: item.startTime || null,
        endTime: item.endTime || null,
        count: item.count || 0,
        updatedAt: item.updatedAt || null
      })),
      path: this.seriesPath(symbol, interval)
    };
  }
}

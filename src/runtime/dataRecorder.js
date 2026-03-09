import path from "node:path";
import { appendJsonLine, ensureDir, listFiles, removeFile } from "../utils/fs.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function dayKey(at) {
  return `${at || new Date().toISOString()}`.slice(0, 10);
}

function makeDecisionFrame(candidate = {}) {
  return {
    symbol: candidate.symbol,
    allow: Boolean(candidate.decision?.allow),
    probability: num(candidate.score?.probability || 0, 4),
    confidence: num(candidate.score?.confidence || 0, 4),
    threshold: num(candidate.decision?.threshold || 0, 4),
    rankScore: num(candidate.decision?.rankScore || 0, 4),
    regime: candidate.regimeSummary?.regime || null,
    strategy: candidate.strategySummary?.activeStrategy || null,
    family: candidate.strategySummary?.family || null,
    reasons: [...(candidate.decision?.reasons || [])].slice(0, 8),
    blockers: [...(candidate.blockerReasons || candidate.decision?.reasons || [])].slice(0, 8),
    providerDiversity: candidate.newsSummary?.providerDiversity || 0,
    reliabilityScore: num(candidate.newsSummary?.reliabilityScore || 0, 4),
    fundingRate: num(candidate.marketStructureSummary?.fundingRate || 0, 6),
    openInterestChangePct: num(candidate.marketStructureSummary?.openInterestChangePct || 0, 4),
    bookPressure: num(candidate.marketSnapshot?.book?.bookPressure || 0, 4),
    spreadBps: num(candidate.marketSnapshot?.book?.spreadBps || 0, 2)
  };
}

function pruneOldFiles(files = [], keepCount = 30) {
  return [...files].sort().reverse().slice(keepCount);
}

export class DataRecorder {
  constructor({ runtimeDir, config, logger }) {
    this.runtimeDir = runtimeDir;
    this.config = config;
    this.logger = logger;
    this.rootDir = path.join(runtimeDir, "feature-store");
    this.state = {
      enabled: Boolean(config.dataRecorderEnabled),
      lastRecordAt: null,
      filesWritten: 0,
      cycleFrames: 0,
      decisionFrames: 0,
      tradeFrames: 0,
      researchFrames: 0,
      lastPruneAt: null
    };
  }

  async init() {
    if (!this.config.dataRecorderEnabled) {
      return;
    }
    await Promise.all([
      ensureDir(path.join(this.rootDir, "cycles")),
      ensureDir(path.join(this.rootDir, "decisions")),
      ensureDir(path.join(this.rootDir, "trades")),
      ensureDir(path.join(this.rootDir, "research"))
    ]);
  }

  async recordCycle({ at, mode, candidates = [], openedPosition = null, overview = {}, safety = {}, marketSentiment = {}, volatility = {} }) {
    if (!this.config.dataRecorderEnabled) {
      return null;
    }
    const payload = {
      at,
      mode,
      openPositions: overview.openPositions || 0,
      equity: num(overview.equity || 0, 2),
      quoteFree: num(overview.quoteFree || 0, 2),
      openedSymbol: openedPosition?.symbol || null,
      topDecision: candidates[0] ? makeDecisionFrame(candidates[0]) : null,
      selectedSymbols: candidates.slice(0, 5).map((candidate) => candidate.symbol),
      safety: {
        selfHealMode: safety.selfHeal?.mode || null,
        driftStatus: safety.drift?.status || null,
        session: safety.session?.session || null
      },
      market: {
        fearGreedValue: marketSentiment.fearGreedValue ?? null,
        btcDominancePct: num(marketSentiment.btcDominancePct || 0, 2),
        optionIv: num(volatility.marketOptionIv || 0, 2),
        ivPremium: num(volatility.ivPremium || 0, 2)
      }
    };
    await this.write("cycles", at, payload);
    this.state.cycleFrames += 1;
    return payload;
  }

  async recordDecisions({ at, candidates = [] }) {
    if (!this.config.dataRecorderEnabled || !candidates.length) {
      return 0;
    }
    const frames = candidates.slice(0, 12).map((candidate) => ({ at, ...makeDecisionFrame(candidate) }));
    const filePath = path.join(this.rootDir, "decisions", `${dayKey(at)}.jsonl`);
    for (const frame of frames) {
      await appendJsonLine(filePath, frame);
    }
    this.touch(at, frames.length);
    this.state.decisionFrames += frames.length;
    return frames.length;
  }

  async recordTrade(trade) {
    if (!this.config.dataRecorderEnabled || !trade) {
      return null;
    }
    const at = trade.exitAt || trade.entryAt || new Date().toISOString();
    const payload = {
      at,
      symbol: trade.symbol,
      pnlQuote: num(trade.pnlQuote || 0, 2),
      netPnlPct: num(trade.netPnlPct || 0, 4),
      strategy: trade.strategyAtEntry || null,
      regime: trade.regimeAtEntry || null,
      reason: trade.reason || null,
      entryStyle: trade.entryExecutionAttribution?.entryStyle || null,
      provider: trade.entryRationale?.providerBreakdown?.[0]?.name || null,
      executionQualityScore: num(trade.executionQualityScore || 0, 4),
      captureEfficiency: num(trade.captureEfficiency || 0, 4),
      headlines: (trade.entryRationale?.headlines || []).slice(0, 3).map((item) => item.title || item),
      blockers: [...(trade.entryRationale?.blockerReasons || [])].slice(0, 6)
    };
    await this.write("trades", at, payload);
    this.state.tradeFrames += 1;
    return payload;
  }

  async recordResearch(summary) {
    if (!this.config.dataRecorderEnabled || !summary?.generatedAt) {
      return null;
    }
    const payload = {
      at: summary.generatedAt,
      symbolCount: summary.symbolCount || 0,
      bestSymbol: summary.bestSymbol || null,
      totalTrades: summary.totalTrades || 0,
      realizedPnl: num(summary.realizedPnl || 0, 2),
      averageSharpe: num(summary.averageSharpe || 0, 3),
      averageWinRate: num(summary.averageWinRate || 0, 4),
      topFamilies: [...(summary.topFamilies || [])].slice(0, 4),
      topRegimes: [...(summary.topRegimes || [])].slice(0, 4)
    };
    await this.write("research", summary.generatedAt, payload);
    this.state.researchFrames += 1;
    return payload;
  }

  async prune() {
    if (!this.config.dataRecorderEnabled) {
      return;
    }
    const keepCount = Math.max(3, this.config.dataRecorderRetentionDays || 21);
    for (const bucket of ["cycles", "decisions", "trades", "research"]) {
      const files = await listFiles(path.join(this.rootDir, bucket));
      for (const file of pruneOldFiles(files, keepCount)) {
        await removeFile(file);
      }
    }
    this.state.lastPruneAt = new Date().toISOString();
  }

  getSummary() {
    return {
      ...this.state,
      rootDir: this.rootDir
    };
  }

  touch(at, increment = 1) {
    this.state.lastRecordAt = at;
    this.state.filesWritten += increment;
  }

  async write(bucket, at, payload) {
    const filePath = path.join(this.rootDir, bucket, `${dayKey(at)}.jsonl`);
    await appendJsonLine(filePath, payload);
    this.touch(at);
  }
}

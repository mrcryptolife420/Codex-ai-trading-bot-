import fs from "node:fs/promises";
import path from "node:path";
import { appendJsonLine, ensureDir, listFiles, removeFile } from "../utils/fs.js";

const FEATURE_STORE_SCHEMA_VERSION = 3;

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function dayKey(at) {
  return `${at || new Date().toISOString()}`.slice(0, 10);
}

function normalizeNumericMap(values = {}, digits = 4) {
  return Object.fromEntries(
    Object.entries(values || {})
      .filter(([, value]) => Number.isFinite(value))
      .map(([name, value]) => [name, num(value, digits)])
  );
}

function pickTopNumericMap(values = {}, limit = 18, digits = 4) {
  return Object.fromEntries(
    Object.entries(normalizeNumericMap(values, digits))
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, limit)
  );
}

function makeIndicatorFrame(source = {}) {
  return {
    adx14: num(source.adx14 || 0, 2),
    dmiSpread: num(source.dmiSpread || 0, 3),
    trendQualityScore: num(source.trendQualityScore || 0, 3),
    supertrendDirection: source.supertrendDirection || 0,
    supertrendDistancePct: num(source.supertrendDistancePct || 0, 4),
    stochRsiK: num(source.stochRsiK || 0, 2),
    stochRsiD: num(source.stochRsiD || 0, 2),
    mfi14: num(source.mfi14 || 0, 2),
    cmf20: num(source.cmf20 || 0, 3),
    keltnerSqueezeScore: num(source.keltnerSqueezeScore || 0, 3),
    squeezeReleaseScore: num(source.squeezeReleaseScore || 0, 3)
  };
}

function summarizeCandidateSnapshot(candidate = {}) {
  return {
    symbol: candidate.symbol || null,
    allow: Boolean(candidate.decision?.allow),
    probability: num(candidate.score?.probability || 0, 4),
    threshold: num(candidate.decision?.threshold || 0, 4),
    rankScore: num(candidate.decision?.rankScore || 0, 4),
    regime: candidate.regimeSummary?.regime || null,
    strategy: candidate.strategySummary?.activeStrategy || null,
    entryStyle: candidate.decision?.executionPlan?.entryStyle || null,
    quoteAmount: num(candidate.decision?.quoteAmount || 0, 2),
    market: {
      mid: num(candidate.marketSnapshot?.book?.mid || 0, 6),
      spreadBps: num(candidate.marketSnapshot?.book?.spreadBps || 0, 2),
      bookPressure: num(candidate.marketSnapshot?.book?.bookPressure || 0, 4),
      depthConfidence: num(candidate.marketSnapshot?.book?.depthConfidence || 0, 4),
      realizedVolPct: num(candidate.marketSnapshot?.market?.realizedVolPct || 0, 4)
    },
    venue: {
      status: candidate.venueConfirmationSummary?.status || null,
      divergenceBps: num(candidate.venueConfirmationSummary?.divergenceBps || 0, 2)
    },
    governance: {
      metaScore: num(candidate.metaSummary?.score || 0, 4),
      quorumStatus: candidate.qualityQuorumSummary?.status || null,
      capitalGovernor: candidate.decision?.capitalGovernorApplied?.status || null
    },
    topRawFeatures: pickTopNumericMap(candidate.rawFeatures || {}, 8, 4)
  };
}

function makeDecisionFrame(candidate = {}) {
  return {
    symbol: candidate.symbol,
    allow: Boolean(candidate.decision?.allow),
    probability: num(candidate.score?.probability || 0, 4),
    confidence: num(candidate.score?.confidence || 0, 4),
    calibrationConfidence: num(candidate.score?.calibrationConfidence || 0, 4),
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
    spreadBps: num(candidate.marketSnapshot?.book?.spreadBps || 0, 2),
    topSignals: (candidate.score?.contributions || []).slice(0, 5).map((item) => ({
      name: item.name,
      contribution: num(item.contribution || 0, 4),
      rawValue: num(item.rawValue || 0, 4)
    })),
    sequenceProbability: num(candidate.score?.sequence?.probability || 0, 4),
    sequenceConfidence: num(candidate.score?.sequence?.confidence || 0, 4),
    metaNeuralProbability: num(candidate.score?.metaNeural?.probability || 0, 4),
    metaNeuralConfidence: num(candidate.score?.metaNeural?.confidence || 0, 4),
    expertDominantRegime: candidate.score?.expertMix?.dominantRegime || null,
    indicators: makeIndicatorFrame(candidate.marketSnapshot?.market || {})
  };
}

function pruneOldFiles(files = [], keepCount = 30) {
  return [...files].sort().reverse().slice(keepCount);
}

function safeStateNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

async function resolveLatestTimestamp(files = []) {
  const timestamps = [];
  for (const filePath of files) {
    try {
      const stats = await fs.stat(filePath);
      timestamps.push(stats.mtime.toISOString());
    } catch {
      // Ignore files that disappeared between listing and stat calls.
    }
  }
  return timestamps.sort().reverse()[0] || null;
}

export class DataRecorder {
  constructor({ runtimeDir, config, logger }) {
    this.runtimeDir = runtimeDir;
    this.config = config;
    this.logger = logger;
    this.rootDir = path.join(runtimeDir, "feature-store");
    this.state = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      enabled: Boolean(config.dataRecorderEnabled),
      lastRecordAt: null,
      filesWritten: 0,
      cycleFrames: 0,
      decisionFrames: 0,
      tradeFrames: 0,
      learningFrames: 0,
      researchFrames: 0,
      snapshotFrames: 0,
      lastPruneAt: null
    };
  }

  async init(previousState = null) {
    if (!this.config.dataRecorderEnabled) {
      return;
    }
    const buckets = ["cycles", "decisions", "trades", "learning", "research", "snapshots"];
    await Promise.all(buckets.map((bucket) => ensureDir(path.join(this.rootDir, bucket))));

    const restored = previousState && typeof previousState === "object" ? previousState : {};
    const fileGroups = await Promise.all(
      buckets.map((bucket) => listFiles(path.join(this.rootDir, bucket)))
    );
    const existingFiles = fileGroups.flat();

    this.state = {
      ...this.state,
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      enabled: true,
      lastRecordAt: restored.lastRecordAt || this.state.lastRecordAt,
      filesWritten: safeStateNumber(restored.filesWritten, this.state.filesWritten),
      cycleFrames: safeStateNumber(restored.cycleFrames, this.state.cycleFrames),
      decisionFrames: safeStateNumber(restored.decisionFrames, this.state.decisionFrames),
      tradeFrames: safeStateNumber(restored.tradeFrames, this.state.tradeFrames),
      learningFrames: safeStateNumber(restored.learningFrames, this.state.learningFrames),
      researchFrames: safeStateNumber(restored.researchFrames, this.state.researchFrames),
      snapshotFrames: safeStateNumber(restored.snapshotFrames, this.state.snapshotFrames),
      lastPruneAt: restored.lastPruneAt || this.state.lastPruneAt
    };

    this.state.filesWritten = Math.max(this.state.filesWritten, existingFiles.length);
    if (!this.state.lastRecordAt) {
      this.state.lastRecordAt = await resolveLatestTimestamp(existingFiles);
    }
  }

  async recordCycle({ at, mode, candidates = [], openedPosition = null, overview = {}, safety = {}, marketSentiment = {}, volatility = {} }) {
    if (!this.config.dataRecorderEnabled) {
      return null;
    }
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "cycle",
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
    const frames = candidates.slice(0, 12).map((candidate) => ({
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "decision",
      at,
      ...makeDecisionFrame(candidate),
      rawFeatureCount: Object.keys(candidate.rawFeatures || {}).length,
      topRawFeatures: pickTopNumericMap(candidate.rawFeatures || {}, 12, 4)
    }));
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
    const entryRationale = trade.entryRationale || {};
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "trade",
      at,
      symbol: trade.symbol,
      pnlQuote: num(trade.pnlQuote || 0, 2),
      netPnlPct: num(trade.netPnlPct || 0, 4),
      labelScore: num(trade.labelScore || 0, 4),
      strategy: trade.strategyAtEntry || null,
      regime: trade.regimeAtEntry || null,
      reason: trade.reason || null,
      brokerMode: trade.brokerMode || null,
      entryStyle: trade.entryExecutionAttribution?.entryStyle || null,
      provider: trade.entryRationale?.providerBreakdown?.[0]?.name || null,
      executionQualityScore: num(trade.executionQualityScore || 0, 4),
      captureEfficiency: num(trade.captureEfficiency || 0, 4),
      rawFeatureCount: Object.keys(trade.rawFeatures || {}).length,
      topRawFeatures: pickTopNumericMap(trade.rawFeatures || {}, 12, 4),
      indicators: makeIndicatorFrame(entryRationale.indicators || {}),
      headlines: (trade.entryRationale?.headlines || []).slice(0, 3).map((item) => item.title || item),
      blockers: [...(trade.entryRationale?.blockerReasons || [])].slice(0, 6)
    };
    await this.write("trades", at, payload);
    this.state.tradeFrames += 1;
    return payload;
  }

  async recordLearningEvent({ trade, learning }) {
    if (!this.config.dataRecorderEnabled || !trade || !learning) {
      return null;
    }
    const at = trade.exitAt || trade.entryAt || new Date().toISOString();
    const rationale = trade.entryRationale || {};
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "learning",
      at,
      symbol: trade.symbol,
      brokerMode: trade.brokerMode || null,
      strategy: trade.strategyAtEntry || rationale.strategy?.activeStrategy || null,
      family: rationale.strategy?.family || null,
      regime: trade.regimeAtEntry || learning.regime || null,
      pnlQuote: num(trade.pnlQuote || 0, 2),
      netPnlPct: num(trade.netPnlPct || 0, 4),
      mfePct: num(trade.mfePct || 0, 4),
      maePct: num(trade.maePct || 0, 4),
      labelScore: num(learning.label?.labelScore ?? trade.labelScore ?? 0, 4),
      executionQualityScore: num(trade.executionQualityScore || 0, 4),
      captureEfficiency: num(trade.captureEfficiency || 0, 4),
      gate: {
        probability: num(rationale.probability || 0, 4),
        confidence: num(rationale.confidence || 0, 4),
        calibrationConfidence: num(rationale.calibrationConfidence || 0, 4),
        threshold: num(rationale.threshold || 0, 4),
        rankScore: num(rationale.rankScore || 0, 4)
      },
      model: {
        championBefore: num(learning.championLearning?.predictionBeforeUpdate || 0, 4),
        challengerBefore: num(learning.challengerLearning?.predictionBeforeUpdate || 0, 4),
        championError: num(learning.championLearning?.error || 0, 4),
        challengerError: num(learning.challengerLearning?.error || 0, 4),
        championSampleWeight: num(learning.championLearning?.sampleWeight || 0, 4),
        challengerSampleWeight: num(learning.challengerLearning?.sampleWeight || 0, 4),
        transformerAbsoluteError: num(learning.transformerLearning?.absoluteError || 0, 4),
        transformerProbability: num(learning.transformerLearning?.probability || 0, 4),
        sequenceTarget: num(learning.sequenceLearning?.target || 0, 4),
        metaTarget: num(learning.metaNeuralLearning?.target || 0, 4),
        executionSizingTarget: num(learning.executionNeuralLearning?.targets?.sizing || 0, 4),
        exitTarget: num(learning.exitNeuralLearning?.targets?.exit || 0, 4),
        calibrationObservations: learning.calibration?.observations || 0,
        calibrationEce: num(learning.calibration?.expectedCalibrationError || 0, 4),
        promotion: Boolean(learning.promotion)
      },
      news: {
        providerBreakdown: [...(rationale.providerBreakdown || [])].slice(0, 4),
        headlineTitles: (rationale.headlines || []).slice(0, 4).map((item) => item.title || item),
        officialNoticeCount: (rationale.officialNotices || []).length,
        dominantEventType: rationale.dominantEventType || rationale.exchange?.dominantEventType || null
      },
      rationale: {
        summary: rationale.summary || null,
        topSignals: (rationale.topSignals || []).slice(0, 8),
        sequenceDrivers: (rationale.sequence?.drivers || []).slice(0, 6),
        metaNeuralDrivers: (rationale.metaNeural?.drivers || []).slice(0, 6),
        expertMix: rationale.expertMix || null,
        strategyReasons: [...(rationale.strategy?.reasons || [])].slice(0, 6),
        blockerReasons: [...(rationale.blockerReasons || [])].slice(0, 8),
        executionReasons: [...(rationale.executionReasons || [])].slice(0, 6),
        checks: (rationale.checks || []).slice(0, 8)
      },
      indicators: makeIndicatorFrame(rationale.indicators || {}),
      rawFeatures: normalizeNumericMap(trade.rawFeatures || {}, 4),
      topRawFeatures: pickTopNumericMap(trade.rawFeatures || {}, 20, 4)
    };
    await this.write("learning", at, payload);
    this.state.learningFrames += 1;
    return payload;
  }

  async recordResearch(summary) {
    if (!this.config.dataRecorderEnabled || !summary?.generatedAt) {
      return null;
    }
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "research",
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

  async recordSnapshotManifest({ at, mode, candidates = [], openedPosition = null, overview = {}, ops = {}, report = {} }) {
    if (!this.config.dataRecorderEnabled) {
      return null;
    }
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "snapshot_manifest",
      at,
      mode,
      equity: num(overview.equity || 0, 2),
      quoteFree: num(overview.quoteFree || 0, 2),
      openPositions: overview.openPositions || 0,
      openedSymbol: openedPosition?.symbol || null,
      readiness: ops.readiness?.status || null,
      alertStatus: ops.alerts?.status || null,
      exchangeSafety: ops.exchangeSafety?.status || null,
      capitalGovernor: ops.capitalGovernor?.status || null,
      executionCost: report.executionCostSummary?.status || null,
      topCandidates: candidates.slice(0, 5).map(summarizeCandidateSnapshot)
    };
    await this.write("snapshots", at, payload);
    this.state.snapshotFrames += 1;
    return payload;
  }

  async recordTradeReplaySnapshot(trade) {
    if (!this.config.dataRecorderEnabled || !trade) {
      return null;
    }
    const at = trade.exitAt || trade.entryAt || new Date().toISOString();
    const rationale = trade.entryRationale || {};
    const payload = {
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
      frameType: "trade_replay",
      at,
      symbol: trade.symbol,
      brokerMode: trade.brokerMode || null,
      strategy: trade.strategyAtEntry || rationale.strategy?.activeStrategy || null,
      regime: trade.regimeAtEntry || rationale.regimeSummary?.regime || null,
      pnlQuote: num(trade.pnlQuote || 0, 2),
      netPnlPct: num(trade.netPnlPct || 0, 4),
      entryPrice: num(trade.entryPrice || 0, 6),
      exitPrice: num(trade.exitPrice || 0, 6),
      reason: trade.reason || null,
      execution: {
        entryStyle: trade.entryExecutionAttribution?.entryStyle || null,
        exitStyle: trade.exitExecutionAttribution?.entryStyle || null,
        executionQualityScore: num(trade.executionQualityScore || 0, 4),
        captureEfficiency: num(trade.captureEfficiency || 0, 4)
      },
      gate: {
        probability: num(rationale.probability || trade.probabilityAtEntry || 0, 4),
        threshold: num(rationale.threshold || 0, 4),
        confidence: num(rationale.confidence || 0, 4)
      },
      replayCheckpoints: (trade.replayCheckpoints || []).slice(-12),
      topRawFeatures: pickTopNumericMap(trade.rawFeatures || {}, 10, 4)
    };
    await this.write("snapshots", at, payload);
    this.state.snapshotFrames += 1;
    return payload;
  }

  async prune() {
    if (!this.config.dataRecorderEnabled) {
      return;
    }
    const keepCount = Math.max(3, this.config.dataRecorderRetentionDays || 21);
    for (const bucket of ["cycles", "decisions", "trades", "learning", "research", "snapshots"]) {
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
      schemaVersion: FEATURE_STORE_SCHEMA_VERSION,
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




import path from "node:path";
import { ensureDir, listFiles, loadJson, removeFile, saveJson } from "../utils/fs.js";

const RUNTIME_SCHEMA_VERSION = 6;
const JOURNAL_SCHEMA_VERSION = 2;

const DEFAULT_MODEL = {
  bias: 0,
  weights: {},
  featureStats: {},
  symbolStats: {}
};

const DEFAULT_RUNTIME = {
  schemaVersion: RUNTIME_SCHEMA_VERSION,
  lastCycleAt: null,
  lastAnalysisAt: null,
  lastAnalysisError: null,
  lastPortfolioUpdateAt: null,
  lastKnownBalance: null,
  lastKnownEquity: null,
  openPositions: [],
  latestDecisions: [],
  newsCache: {},
  marketSentimentCache: null,
  volatilityContextCache: null,
  onChainLiteCache: null,
  newsSourceHealth: {},
  executionPolicyState: null,
  aiTelemetry: {},
  paperPortfolio: null,
  latestBlockedSetups: [],
  researchLab: {
    lastRunAt: null,
    latestSummary: null
  },
  marketSentiment: {},
  volatilityContext: {},
  onChainLite: {},
  sourceReliability: {},
  pairHealth: {},
  divergence: {},
  offlineTrainer: {},
  counterfactualQueue: [],
  session: {},
  drift: {},
  selfHeal: {},
  universe: {},
  strategyAttribution: {},
  researchRegistry: {},
  modelRegistry: {},
  dataRecorder: {},
  shadowTrading: {},
  strategyResearch: {},
  thresholdTuning: {},
  parameterGovernor: {},
  executionCalibration: {},
  venueConfirmation: {},
  capitalLadder: {},
  capitalGovernor: {},
  exchangeTruth: {
    status: "unknown",
    freezeEntries: false,
    mismatchCount: 0,
    runtimePositionCount: 0,
    exchangePositionCount: 0,
    openOrderCount: 0,
    openOrderListCount: 0,
    lastReconciledAt: null,
    lastHealthyAt: null,
    orphanedSymbols: [],
    missingRuntimeSymbols: [],
    unmatchedOrderSymbols: [],
    staleProtectiveSymbols: [],
    recentFillSymbols: [],
    warnings: [],
    notes: []
  },
  orderLifecycle: {
    lastUpdatedAt: null,
    positions: {},
    recentTransitions: [],
    pendingActions: [],
    activeActions: {},
    actionJournal: []
  },
  ops: {
    lastUpdatedAt: null,
    incidentTimeline: [],
    runbooks: [],
    performanceChange: null,
    readiness: null,
    alerts: {
      count: 0,
      criticalCount: 0,
      activeCount: 0,
      mutedCount: 0,
      acknowledgedCount: 0,
      status: "clear",
      alerts: []
    },
    alertState: {
      acknowledgedAtById: {},
      silencedUntilById: {},
      delivery: {
        lastDeliveryAt: null,
        lastError: null,
        lastDeliveredAtById: {}
      }
    },
    alertDelivery: {
      status: "disabled",
      endpointCount: 0,
      eligibleCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      lastDeliveryAt: null,
      lastError: null,
      notes: []
    },
    replayChaos: null
  },
  service: {
    lastHeartbeatAt: null,
    watchdogStatus: "idle",
    restartBackoffSeconds: null,
    lastExitCode: null,
    statusFile: null
  },
  qualityQuorum: {},
  stateBackups: {},
  recovery: {
    uncleanShutdownDetected: false,
    restoredFromBackupAt: null,
    latestBackupAt: null
  },
  lifecycle: {
    activeRun: false,
    lastBootAt: null,
    lastShutdownAt: null
  },
  health: {
    consecutiveFailures: 0,
    circuitOpen: false,
    reason: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    warnings: []
  }
};

const DEFAULT_JOURNAL = {
  schemaVersion: JOURNAL_SCHEMA_VERSION,
  trades: [],
  scaleOuts: [],
  blockedSetups: [],
  counterfactuals: [],
  universeRuns: [],
  researchRuns: [],
  equitySnapshots: [],
  cycles: [],
  events: []
};

function clone(value) {
  return structuredClone(value);
}

function mergeDefaultShape(base, loaded) {
  if (Array.isArray(base)) {
    return Array.isArray(loaded) ? [...loaded] : [...base];
  }
  if (!base || typeof base !== "object") {
    return loaded == null ? base : loaded;
  }
  const source = loaded && typeof loaded === "object" ? loaded : {};
  const merged = { ...base };
  for (const [key, value] of Object.entries(base)) {
    merged[key] = mergeDefaultShape(value, source[key]);
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in merged)) {
      merged[key] = value;
    }
  }
  return merged;
}

function migrateRuntime(runtime) {
  const merged = mergeDefaultShape(clone(DEFAULT_RUNTIME), runtime);
  merged.schemaVersion = RUNTIME_SCHEMA_VERSION;
  merged.openPositions = Array.isArray(merged.openPositions) ? merged.openPositions : [];
  merged.latestDecisions = Array.isArray(merged.latestDecisions) ? merged.latestDecisions : [];
  merged.latestBlockedSetups = Array.isArray(merged.latestBlockedSetups) ? merged.latestBlockedSetups : [];
  merged.counterfactualQueue = Array.isArray(merged.counterfactualQueue) ? merged.counterfactualQueue : [];
  merged.qualityQuorum = merged.qualityQuorum && typeof merged.qualityQuorum === "object" ? merged.qualityQuorum : {};
  merged.shadowTrading = mergeDefaultShape(clone(DEFAULT_RUNTIME.shadowTrading), merged.shadowTrading);
  merged.strategyResearch = mergeDefaultShape(clone(DEFAULT_RUNTIME.strategyResearch), merged.strategyResearch);
  merged.thresholdTuning = mergeDefaultShape(clone(DEFAULT_RUNTIME.thresholdTuning), merged.thresholdTuning);
  merged.parameterGovernor = mergeDefaultShape(clone(DEFAULT_RUNTIME.parameterGovernor), merged.parameterGovernor);
  merged.executionCalibration = mergeDefaultShape(clone(DEFAULT_RUNTIME.executionCalibration), merged.executionCalibration);
  merged.venueConfirmation = mergeDefaultShape(clone(DEFAULT_RUNTIME.venueConfirmation), merged.venueConfirmation);
  merged.capitalLadder = mergeDefaultShape(clone(DEFAULT_RUNTIME.capitalLadder), merged.capitalLadder);
  merged.exchangeTruth = mergeDefaultShape(clone(DEFAULT_RUNTIME.exchangeTruth), merged.exchangeTruth);
  merged.orderLifecycle = mergeDefaultShape(clone(DEFAULT_RUNTIME.orderLifecycle), merged.orderLifecycle);
  merged.ops = mergeDefaultShape(clone(DEFAULT_RUNTIME.ops), merged.ops);
  merged.service = mergeDefaultShape(clone(DEFAULT_RUNTIME.service), merged.service);
  merged.health = mergeDefaultShape(clone(DEFAULT_RUNTIME.health), merged.health);
  merged.recovery = mergeDefaultShape(clone(DEFAULT_RUNTIME.recovery), merged.recovery);
  merged.lifecycle = mergeDefaultShape(clone(DEFAULT_RUNTIME.lifecycle), merged.lifecycle);
  merged.researchLab = mergeDefaultShape(clone(DEFAULT_RUNTIME.researchLab), merged.researchLab);
  return merged;
}

function migrateJournal(journal) {
  const merged = mergeDefaultShape(clone(DEFAULT_JOURNAL), journal);
  merged.schemaVersion = JOURNAL_SCHEMA_VERSION;
  for (const key of ["trades", "scaleOuts", "blockedSetups", "counterfactuals", "universeRuns", "researchRuns", "equitySnapshots", "cycles", "events"]) {
    merged[key] = Array.isArray(merged[key]) ? merged[key] : [];
  }
  return merged;
}

export class StateStore {
  constructor(runtimeDir) {
    this.runtimeDir = runtimeDir;
    this.modelPath = path.join(runtimeDir, "model.json");
    this.runtimePath = path.join(runtimeDir, "runtime.json");
    this.journalPath = path.join(runtimeDir, "journal.json");
    this.modelBackupsPath = path.join(runtimeDir, "model-backups.json");
  }

  async init() {
    await ensureDir(this.runtimeDir);
    const staleTempFiles = (await listFiles(this.runtimeDir)).filter((filePath) => filePath.endsWith(".tmp"));
    for (const filePath of staleTempFiles) {
      await removeFile(filePath);
    }
  }

  async loadModel() {
    return loadJson(this.modelPath, structuredClone(DEFAULT_MODEL));
  }

  async saveModel(model) {
    await saveJson(this.modelPath, model);
  }

  async loadRuntime() {
    return migrateRuntime(await loadJson(this.runtimePath, clone(DEFAULT_RUNTIME)));
  }

  async saveRuntime(runtime) {
    await saveJson(this.runtimePath, migrateRuntime(runtime));
  }

  async loadJournal() {
    return migrateJournal(await loadJson(this.journalPath, clone(DEFAULT_JOURNAL)));
  }

  async saveJournal(journal) {
    await saveJson(this.journalPath, migrateJournal(journal));
  }

  async loadModelBackups() {
    return loadJson(this.modelBackupsPath, []);
  }

  async saveModelBackups(backups) {
    await saveJson(this.modelBackupsPath, backups);
  }
}




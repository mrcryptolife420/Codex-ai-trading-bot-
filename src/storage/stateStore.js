import path from "node:path";
import { ensureDir, listFiles, loadJson, removeFile, saveJson } from "../utils/fs.js";

const DEFAULT_MODEL = {
  bias: 0,
  weights: {},
  featureStats: {},
  symbolStats: {}
};

const DEFAULT_RUNTIME = {
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
    return loadJson(this.runtimePath, structuredClone(DEFAULT_RUNTIME));
  }

  async saveRuntime(runtime) {
    await saveJson(this.runtimePath, runtime);
  }

  async loadJournal() {
    return loadJson(this.journalPath, structuredClone(DEFAULT_JOURNAL));
  }

  async saveJournal(journal) {
    await saveJson(this.journalPath, journal);
  }

  async loadModelBackups() {
    return loadJson(this.modelBackupsPath, []);
  }

  async saveModelBackups(backups) {
    await saveJson(this.modelBackupsPath, backups);
  }
}




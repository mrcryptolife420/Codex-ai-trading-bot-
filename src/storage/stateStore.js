import path from "node:path";
import { ensureDir, loadJson, saveJson } from "../utils/fs.js";

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
  session: {},
  drift: {},
  selfHeal: {},
  universe: {},
  strategyAttribution: {},
  researchRegistry: {},
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



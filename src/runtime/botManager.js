import { loadConfig } from "../config/index.js";
import { ensureEnvFile, updateEnvFile } from "../config/envFile.js";
import { nowIso } from "../utils/time.js";
import { TradingBot } from "./tradingBot.js";
import { buildApiEnvelope, computeOperationalReadiness } from "./operationalTruth.js";

function summarizeError(error) {
  return {
    at: nowIso(),
    message: error.message,
    stack: error.stack
  };
}

function publicError(error) {
  if (!error?.message) {
    return null;
  }
  return {
    at: error.at || nowIso(),
    message: `${error.message}`.slice(0, 400)
  };
}

function isDemoSpotEnvironment(config = {}) {
  return `${config?.binanceApiBaseUrl || ""}`.toLowerCase().includes("demo-api.binance.com");
}

function assertLiveModeGuardrails(config = {}) {
  if ((config?.botMode || "paper") !== "live") {
    return;
  }
  if (config?.liveTradingAcknowledged !== "I_UNDERSTAND_LIVE_TRADING_RISK") {
    throw new Error("Live mode vereist LIVE_TRADING_ACKNOWLEDGED=I_UNDERSTAND_LIVE_TRADING_RISK.");
  }
  if ((config?.paperExecutionVenue || "internal") === "binance_demo_spot") {
    throw new Error("Live mode mag niet gecombineerd worden met PAPER_EXECUTION_VENUE=binance_demo_spot.");
  }
  if (isDemoSpotEnvironment(config)) {
    throw new Error("Live mode vereist een echte Binance API endpoint, niet demo-api.binance.com.");
  }
}

function buildConfigRuntimeSignature(config = {}) {
  return JSON.stringify({
    botMode: config?.botMode || "paper",
    binanceApiBaseUrl: config?.binanceApiBaseUrl || "",
    binanceFuturesApiBaseUrl: config?.binanceFuturesApiBaseUrl || "",
    binanceApiKey: config?.binanceApiKey || "",
    binanceApiSecret: config?.binanceApiSecret || "",
    paperExecutionVenue: config?.paperExecutionVenue || "internal",
    liveTradingAcknowledged: config?.liveTradingAcknowledged || "",
    enableExchangeProtection: Boolean(config?.enableExchangeProtection)
  });
}

export class BotManager {
  constructor({ projectRoot = process.cwd(), logger }) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.runState = "stopped";
    this.loopPromise = null;
    this.stopRequested = false;
    this.waitResolver = null;
    this.waitTimer = null;
    this.lastError = null;
    this.lastStartAt = null;
    this.lastStopAt = null;
    this.lastModeSwitchAt = null;
    this.externalConfigMode = null;
    this.externalConfigSignature = null;
    this.externalConfigCheckedAt = null;
    this.externalModeDrift = null;
    this.externalConfigDrift = null;
    this.stopReason = null;
    this.consecutiveCycleFailures = 0;
    this.botNeedsReinitialize = false;
    this.serial = Promise.resolve();
  }

  async withLock(action) {
    const next = this.serial.then(action, action);
    this.serial = next.catch(() => {});
    return next;
  }

  async init() {
    return this.withLock(async () => {
      await ensureEnvFile(this.projectRoot);
      await this.reinitializeBot();
      await this.bot.refreshAnalysis();
      return this.getSnapshot();
    });
  }

  async reinitializeBot() {
    if (this.bot?.close) {
      await this.bot.close();
    }
    const config = await loadConfig(this.projectRoot);
    assertLiveModeGuardrails(config);
    const bot = new TradingBot({ config, logger: this.logger });
    await bot.init();
    this.config = config;
    this.configRuntimeSignature = buildConfigRuntimeSignature(config);
    this.bot = bot;
    this.botNeedsReinitialize = false;
    return bot;
  }

  async ensureBotReady({ allowClosed = false } = {}) {
    if (!this.bot || (!allowClosed && this.botNeedsReinitialize)) {
      await this.reinitializeBot();
    }
    if (allowClosed && this.botNeedsReinitialize) {
      return;
    }
    await this.syncStoppedModeFromEnv();
  }

  async inspectExternalMode() {
    const latestConfig = await loadConfig(this.projectRoot);
    this.externalConfigMode = latestConfig.botMode;
    this.externalConfigSignature = buildConfigRuntimeSignature(latestConfig);
    this.externalConfigCheckedAt = nowIso();
    this.externalModeDrift = latestConfig.botMode !== (this.config?.botMode || null)
      ? {
          currentMode: this.config?.botMode || null,
          externalMode: latestConfig.botMode
        }
      : null;
    this.externalConfigDrift = this.externalConfigSignature !== (this.configRuntimeSignature || null)
      ? {
          currentMode: this.config?.botMode || null,
          externalMode: latestConfig.botMode
        }
      : null;
    return latestConfig.botMode;
  }

  async syncStoppedModeFromEnv() {
    if (typeof this.bot?.refreshAnalysis !== "function") {
      return false;
    }
    const externalMode = await this.inspectExternalMode();
    const signatureDrift = this.externalConfigSignature !== (this.configRuntimeSignature || null);
    if (!this.config || !externalMode || this.runState === "running") {
      return false;
    }
    if (externalMode === this.config.botMode && !signatureDrift) {
      return false;
    }
    await this.reinitializeBot();
    await this.bot.refreshAnalysis?.();
    this.lastModeSwitchAt = nowIso();
    await this.inspectExternalMode();
    return true;
  }

  buildSnapshotFromDashboard(dashboard) {
    const sourceTruthMode = dashboard?.sourceOfTruth?.mode || "paper";
    const manager = {
      runState: this.runState,
      currentMode: sourceTruthMode,
      externalConfigMode: this.externalConfigMode,
      externalConfigDrift: this.externalConfigDrift,
      externalConfigCheckedAt: this.externalConfigCheckedAt,
      externalModeDrift: this.externalModeDrift,
      lastStartAt: this.lastStartAt,
      lastStopAt: this.lastStopAt,
      lastModeSwitchAt: this.lastModeSwitchAt,
      stopReason: this.stopReason || null,
      lastError: publicError(this.lastError),
      dashboardPort: this.config.dashboardPort
    };
    const snapshot = buildApiEnvelope({
      kind: "snapshot",
      manager,
      snapshot: {
        manager,
        dashboard
      }
    });
    snapshot.dashboard = dashboard;
    snapshot.manager.readiness = this.buildOperationalReadiness(snapshot);
    return snapshot;
  }

  buildApiEnvelope(kind, body = {}) {
    return buildApiEnvelope({
      kind,
      manager: body.manager || {
        runState: this.runState,
        currentMode: this.config?.botMode || "paper",
        lastError: publicError(this.lastError)
      },
      status: kind === "status" ? (body.status || null) : null,
      doctor: kind === "doctor" ? (body.doctor || null) : null,
      report: kind === "report" ? (body.report || null) : null
    });
  }

  async closeBotForStop() {
    if (!this.bot?.close || this.botNeedsReinitialize) {
      return;
    }
    await this.bot.close();
    this.botNeedsReinitialize = true;
  }

  async interruptibleDelay(ms) {
    await new Promise((resolve) => {
      this.waitResolver = resolve;
      this.waitTimer = setTimeout(resolve, ms);
    });
    this.waitResolver = null;
    this.waitTimer = null;
  }

  cancelDelay() {
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    if (this.waitResolver) {
      const resolver = this.waitResolver;
      this.waitResolver = null;
      resolver();
    }
  }

  async applySelfHealManagerAction(selfHeal) {
    const action = selfHeal?.managerAction || null;
    if (!action) {
      return null;
    }
    if (action === "switch_to_paper" && this.config?.botMode === "live") {
      if (isDemoSpotEnvironment(this.config)) {
        this.logger?.warn?.("Self-heal retained Binance Demo Spot mode instead of switching to paper", {
          reason: selfHeal.reason
        });
        return "retained_demo_live_mode";
      }
      const openPositions = this.bot?.runtime?.openPositions || [];
      if (openPositions.length) {
        const message = `Self-heal requested paper fallback while ${openPositions.length} live position(s) remain open; stopping manager instead.`;
        this.logger?.error?.("Self-heal paper fallback blocked by live positions", {
          reason: selfHeal.reason,
          openPositions: openPositions.map((position) => position.symbol)
        });
        this.lastError = {
          at: nowIso(),
          message,
          stack: null
        };
        this.stopRequested = true;
        this.stopReason = "self_heal_live_positions_open";
        if (this.runState !== "stopped") {
          this.runState = "stopping";
        }
        this.cancelDelay();
        return "paper_switch_blocked_open_positions";
      }
      this.logger.warn("Self-heal switching bot to paper mode", { reason: selfHeal.reason });
      await updateEnvFile(this.config.envPath, { BOT_MODE: "paper" });
      await this.reinitializeBot();
      await this.bot.refreshAnalysis();
      this.lastModeSwitchAt = nowIso();
      return "switched_to_paper";
    }
    return null;
  }

  async runLoop() {
    const escalationThreshold = Math.max(3, Number(this.config?.managerCycleFailureEscalationThreshold || 6));
    while (!this.stopRequested) {
      try {
        const result = await this.bot.runCycle();
        await this.applySelfHealManagerAction(result.selfHeal);
        this.consecutiveCycleFailures = 0;
        if (this.stopReason !== "self_heal_live_positions_open") {
          this.lastError = null;
        }
      } catch (error) {
        this.consecutiveCycleFailures += 1;
        this.lastError = summarizeError(error);
        this.logger.error("Managed cycle failed", {
          error: error.message,
          consecutiveFailures: this.consecutiveCycleFailures
        });
        if (this.consecutiveCycleFailures >= escalationThreshold) {
          this.stopRequested = true;
          this.stopReason = "manager_cycle_failure_escalated";
          this.logger.error("Manager loop escalated after repeated cycle failures", {
            threshold: escalationThreshold,
            consecutiveFailures: this.consecutiveCycleFailures,
            lastError: error.message
          });
        }
      }
      if (this.stopRequested) {
        break;
      }
      await this.interruptibleDelay(this.config.tradingIntervalSeconds * 1000);
    }
    this.runState = "stopped";
    this.lastStopAt = nowIso();
  }

  async stopUnlocked(reason = "manual_stop") {
    this.stopRequested = true;
    this.stopReason = reason;
    this.cancelDelay();

    if (this.runState === "stopped") {
      try {
        await this.closeBotForStop();
      } catch (error) {
        this.lastError = summarizeError(error);
        this.logger?.error?.("Managed shutdown failed", { error: error.message });
      }
      this.lastStopAt = nowIso();
      return this.getSnapshot({ allowClosedBot: true });
    }

    this.runState = "stopping";
    if (this.loopPromise) {
      await this.loopPromise;
    }
    this.runState = "stopped";
    try {
      await this.closeBotForStop();
    } catch (error) {
      this.lastError = summarizeError(error);
      this.logger?.error?.("Managed shutdown failed", { error: error.message });
    }
    this.lastStopAt = nowIso();
    return this.getSnapshot({ allowClosedBot: true });
  }

  async start() {
    return this.withLock(async () => {
      await this.ensureBotReady();
      if (this.runState === "running") {
        return this.getSnapshot();
      }
      this.stopRequested = false;
      this.stopReason = null;
      this.consecutiveCycleFailures = 0;
      this.runState = "running";
      this.lastStartAt = nowIso();
      this.loopPromise = this.runLoop();
      return this.getSnapshot();
    });
  }

  async stop(reason = "manual_stop") {
    return this.withLock(async () => this.stopUnlocked(reason));
  }

  async runCycleOnce() {
    return this.withLock(async () => {
      await this.ensureBotReady();
      if (this.runState === "running") {
        throw new Error("Stop eerst de doorlopende bot voordat je een losse cyclus draait.");
      }
      const result = await this.bot.runCycle();
      const selfHealAction = await this.applySelfHealManagerAction(result.selfHeal);
      this.consecutiveCycleFailures = 0;
      if (!["paper_switch_blocked_open_positions"].includes(selfHealAction || "") && !this.lastError?.message) {
        this.lastError = null;
      }
      return {
        result,
        snapshot: await this.getSnapshot()
      };
    });
  }

  async refreshAnalysis() {
    return this.withLock(async () => {
      await this.ensureBotReady();
      if (this.runState === "running") {
        throw new Error("Stop eerst de bot voordat je handmatig analyse ververst.");
      }
      await this.bot.refreshAnalysis();
      this.lastError = null;
      return this.getSnapshot();
    });
  }

  async runResearch(symbols = []) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      if (this.runState === "running") {
        throw new Error("Stop eerst de bot voordat je research draait.");
      }
      const result = await this.bot.runResearch({ symbols });
      this.lastError = null;
      return {
        result,
        snapshot: await this.getSnapshot()
      };
    });
  }

  async setMode(mode) {
    const normalized = `${mode || "paper"}`.trim().toLowerCase() === "live" ? "live" : "paper";

    return this.withLock(async () => {
      if (!this.config) {
        await this.reinitializeBot();
      }
      if (this.config.botMode === normalized) {
        return this.getSnapshot();
      }

      const previousMode = this.config.botMode;
      const wasRunning = this.runState === "running";
      const envPath = this.config.envPath;

      if (normalized === "live") {
        assertLiveModeGuardrails({
          ...this.config,
          botMode: "live"
        });
      }

      await this.stopUnlocked("mode_switch");
      await updateEnvFile(envPath, { BOT_MODE: normalized });

      try {
        await this.reinitializeBot();
        await this.bot.refreshAnalysis();
        this.lastModeSwitchAt = nowIso();
      } catch (error) {
        await updateEnvFile(envPath, { BOT_MODE: previousMode });
        await this.reinitializeBot();
        this.lastError = summarizeError(error);
        throw error;
      }

      if (wasRunning) {
        this.stopRequested = false;
        this.stopReason = null;
        this.runState = "running";
        this.lastStartAt = nowIso();
        this.loopPromise = this.runLoop();
      }

      return this.getSnapshot();
    });
  }

  buildOperationalReadiness(snapshot) {
    const mode = snapshot?.manager?.currentMode || this.config?.botMode || "paper";
    return computeOperationalReadiness({
      snapshotReadiness: snapshot?.dashboard?.ops?.readiness || {},
      checkedAt: nowIso(),
      lastAnalysisAt: snapshot?.dashboard?.overview?.lastAnalysisAt || null,
      runState: snapshot?.manager?.runState || this.runState,
      mode,
      managerHasError: Boolean(snapshot?.manager?.lastError?.message || this.lastError?.message),
      healthCircuitOpen: Boolean(snapshot?.dashboard?.health?.circuitOpen),
      exchangeTruthFreeze: Boolean(snapshot?.dashboard?.safety?.exchangeTruth?.freezeEntries),
      exchangeSafetyBlocked: (snapshot?.dashboard?.safety?.exchangeSafety?.status || "") === "blocked",
      capitalGovernorBlocked: (snapshot?.dashboard?.ops?.capitalGovernor?.status || "") === "blocked",
      selfHealMode: snapshot?.dashboard?.safety?.selfHeal?.mode || "",
      serviceWatchdogStatus: snapshot?.dashboard?.ops?.service?.watchdogStatus || "",
      serviceHeartbeatStale: Boolean(snapshot?.dashboard?.ops?.service?.heartbeatStale),
      serviceRecoveryActive: Boolean(snapshot?.dashboard?.ops?.service?.recoveryActive),
      externalModeMismatch: Boolean(snapshot?.manager?.externalModeDrift?.externalMode && this.runState === "running"),
      alerts: snapshot?.dashboard?.ops?.alerts?.alerts || [],
      pendingActions: snapshot?.dashboard?.safety?.orderLifecycle?.pendingActions || [],
      analysisMissingStatus: "warming"
    });
  }

  async getOperationalReadiness() {
    return this.buildOperationalReadiness(await this.getSnapshot());
  }

  async getStatus() {
    await this.ensureBotReady();
    const status = await this.bot.getStatus();
    return this.buildApiEnvelope("status", {
      manager: {
        runState: this.runState,
        currentMode: status?.sourceOfTruth?.mode || "paper",
        lastStartAt: this.lastStartAt,
        lastStopAt: this.lastStopAt,
        lastModeSwitchAt: this.lastModeSwitchAt,
        stopReason: this.stopReason || null,
        lastError: publicError(this.lastError)
      },
      status
    });
  }

  async getDoctor() {
    await this.ensureBotReady();
    const doctor = await this.bot.runDoctor();
    return this.buildApiEnvelope("doctor", {
      manager: {
        runState: this.runState,
        currentMode: doctor?.sourceOfTruth?.mode || "paper",
        lastError: publicError(this.lastError)
      },
      doctor
    });
  }

  async getReport() {
    await this.ensureBotReady();
    const report = await this.bot.getReport();
    return this.buildApiEnvelope("report", {
      manager: {
        runState: this.runState,
        currentMode: report?.sourceOfTruth?.mode || "paper",
        lastError: publicError(this.lastError)
      },
      report
    });
  }

  async getLearning() {
    await this.ensureBotReady();
    const learning = await this.bot.getAdaptiveLearningStatus();
    return buildApiEnvelope({
      kind: "learning",
      manager: {
        runState: this.runState,
        currentMode: learning?.mode || this.config?.botMode || "paper",
        lastError: publicError(this.lastError)
      },
      learning
    });
  }

  async acknowledgeAlert(id, acknowledged = true, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.acknowledgeAlert(id, { acknowledged, note });
      return this.getSnapshot();
    });
  }

  async silenceAlert(id, minutes = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.silenceAlert(id, { minutes: minutes ?? this.config?.operatorAlertSilenceMinutes });
      return this.getSnapshot();
    });
  }

  async resolveAlert(id, resolved = true, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.resolveAlert(id, { resolved, note });
      return this.getSnapshot();
    });
  }

  async forceReconcile(note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.forceReconcile({ note });
      return this.getSnapshot();
    });
  }

  async markPositionReviewed(positionId, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.markPositionReviewed(positionId, { note });
      return this.getSnapshot();
    });
  }

  async setProbeOnly(enabled = true, minutes = null, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.setProbeOnly({ enabled, minutes: minutes ?? 90, note });
      return this.getSnapshot();
    });
  }

  async runDiagnosticsAction(action, target = null, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      const normalizedAction = `${action || ""}`.trim().toLowerCase();
      if (!normalizedAction) {
        throw new Error("Ongeldige diagnostics action.");
      }
      if (normalizedAction === "refresh_analysis") {
        if (this.runState === "running") {
          throw new Error("Stop eerst de bot voordat je handmatig analyse ververst.");
        }
        await this.bot.refreshAnalysis();
        this.bot.recordDiagnosticsAction({
          action: normalizedAction,
          target,
          note,
          detail: "Analyse handmatig ververst via diagnostics."
        });
        await this.bot.store.saveRuntime(this.bot.runtime);
        return this.getSnapshot();
      }
      if (normalizedAction === "research_focus_symbol") {
        const symbol = `${target || ""}`.trim().toUpperCase();
        if (!symbol) {
          throw new Error("Symbool ontbreekt voor diagnostics research action.");
        }
        if (this.runState === "running") {
          throw new Error("Stop eerst de bot voordat je research draait.");
        }
        await this.bot.runResearch({ symbols: [symbol] });
        this.bot.recordDiagnosticsAction({
          action: normalizedAction,
          target: symbol,
          note,
          detail: `Research handmatig gestart voor ${symbol}.`
        });
        await this.bot.store.saveRuntime(this.bot.runtime);
        return this.getSnapshot();
      }
      await this.bot.performDiagnosticsAction({ action: normalizedAction, target, note });
      return this.getSnapshot();
    });
  }

  async approvePolicyTransition(id, action, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.approvePolicyTransition({ id, action, note });
      return this.getSnapshot();
    });
  }

  async rejectPolicyTransition(id, action, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.rejectPolicyTransition({ id, action, note });
      return this.getSnapshot();
    });
  }

  async revertPolicyTransition(id, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.revertPolicyTransition({ id, note });
      return this.getSnapshot();
    });
  }

  async approvePromotionCandidate(symbol, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.approvePromotionCandidate({ symbol, note });
      return this.getSnapshot();
    });
  }

  async rollbackPromotionCandidate(symbol, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.rollbackPromotionCandidate({ symbol, note });
      return this.getSnapshot();
    });
  }

  async approvePromotionScope(scopeId, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.approvePromotionScope({ scopeId, note });
      return this.getSnapshot();
    });
  }

  async rollbackPromotionScope(scopeId, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.rollbackPromotionScope({ scopeId, note });
      return this.getSnapshot();
    });
  }

  async decidePromotionProbation(key, decision, note = null) {
    return this.withLock(async () => {
      await this.ensureBotReady();
      await this.bot.decidePromotionProbation({ key, decision, note });
      return this.getSnapshot();
    });
  }

  async getSnapshot({ allowClosedBot = false } = {}) {
    await this.ensureBotReady({ allowClosed: allowClosedBot });
    const dashboard = await this.bot.getDashboardSnapshot();
    return this.buildSnapshotFromDashboard(dashboard);
  }
}

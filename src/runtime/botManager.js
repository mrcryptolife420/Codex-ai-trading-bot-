import { loadConfig } from "../config/index.js";
import { ensureEnvFile, updateEnvFile } from "../config/envFile.js";
import { nowIso } from "../utils/time.js";
import { TradingBot } from "./tradingBot.js";

function summarizeError(error) {
  return {
    at: nowIso(),
    message: error.message,
    stack: error.stack
  };
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
    this.stopReason = null;
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
    const bot = new TradingBot({ config, logger: this.logger });
    await bot.init();
    this.config = config;
    this.bot = bot;
    return bot;
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
    while (!this.stopRequested) {
      try {
        const result = await this.bot.runCycle();
        await this.applySelfHealManagerAction(result.selfHeal);
        if (this.stopReason !== "self_heal_live_positions_open") {
          this.lastError = null;
        }
      } catch (error) {
        this.lastError = summarizeError(error);
        this.logger.error("Managed cycle failed", {
          error: error.message
        });
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
      this.lastStopAt = nowIso();
      return this.getSnapshot();
    }

    this.runState = "stopping";
    if (this.loopPromise) {
      await this.loopPromise;
    }
    this.runState = "stopped";
    this.lastStopAt = nowIso();
    return this.getSnapshot();
  }

  async start() {
    return this.withLock(async () => {
      if (!this.bot) {
        await this.reinitializeBot();
      }
      if (this.runState === "running") {
        return this.getSnapshot();
      }
      this.stopRequested = false;
      this.stopReason = null;
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
      if (!this.bot) {
        await this.reinitializeBot();
      }
      if (this.runState === "running") {
        throw new Error("Stop eerst de doorlopende bot voordat je een losse cyclus draait.");
      }
      const result = await this.bot.runCycle();
      await this.applySelfHealManagerAction(result.selfHeal);
      this.lastError = null;
      return {
        result,
        snapshot: await this.getSnapshot()
      };
    });
  }

  async refreshAnalysis() {
    return this.withLock(async () => {
      if (!this.bot) {
        await this.reinitializeBot();
      }
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
      if (!this.bot) {
        await this.reinitializeBot();
      }
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
    const readiness = {
      ok: true,
      status: "ready",
      reasons: [],
      checkedAt: nowIso(),
      lastAnalysisAt: snapshot?.dashboard?.overview?.lastAnalysisAt || null,
      runState: snapshot?.manager?.runState || this.runState,
      mode: snapshot?.manager?.currentMode || this.config?.botMode || "paper"
    };
    if (!snapshot?.dashboard?.overview?.lastAnalysisAt) {
      readiness.ok = false;
      readiness.status = readiness.status === "blocked" ? "blocked" : "warming";
      readiness.reasons.push("analysis_not_ready");
    }
    if (snapshot?.manager?.lastError?.message || this.lastError?.message) {
      readiness.ok = false;
      readiness.status = readiness.status === "blocked" ? "blocked" : "degraded";
      readiness.reasons.push("manager_error");
    }
    if (snapshot?.dashboard?.health?.circuitOpen) {
      readiness.ok = false;
      readiness.status = "blocked";
      readiness.reasons.push("health_circuit_open");
    }
    if (snapshot?.dashboard?.safety?.exchangeTruth?.freezeEntries) {
      readiness.ok = false;
      readiness.status = "blocked";
      readiness.reasons.push("exchange_truth_freeze");
    }
    if ((snapshot?.dashboard?.safety?.exchangeSafety?.status || "") === "blocked") {
      readiness.ok = false;
      readiness.status = "blocked";
      readiness.reasons.push("exchange_safety_blocked");
    }
    if ((snapshot?.dashboard?.safety?.orderLifecycle?.pendingActions || []).some((item) => ["manual_review", "reconcile_required"].includes(item.state))) {
      readiness.ok = false;
      readiness.status = readiness.status === "blocked" ? "blocked" : "degraded";
      readiness.reasons.push("lifecycle_attention_required");
    }
    return readiness;
  }

  async getOperationalReadiness() {
    return this.buildOperationalReadiness(await this.getSnapshot());
  }

  async getSnapshot() {
    if (!this.bot) {
      await this.reinitializeBot();
    }
    const dashboard = await this.bot.getDashboardSnapshot();
    return {
      manager: {
        runState: this.runState,
        currentMode: this.config.botMode,
        lastStartAt: this.lastStartAt,
        lastStopAt: this.lastStopAt,
        lastModeSwitchAt: this.lastModeSwitchAt,
        stopReason: this.stopReason || null,
        lastError: this.lastError,
        dashboardPort: this.config.dashboardPort
      },
      dashboard
    };
  }
}


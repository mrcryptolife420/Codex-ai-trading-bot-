import { nowIso } from "../utils/time.js";

function recentLossStreak(trades = [], { now = new Date(), lookbackMinutes = 0 } = {}) {
  let streak = 0;
  const nowMs = now.getTime();
  const lookbackMs = Number.isFinite(lookbackMinutes) && lookbackMinutes > 0 ? lookbackMinutes * 60_000 : null;
  for (const trade of trades) {
    const exitAt = trade.exitAt || trade.at || null;
    if (!exitAt) {
      if ((trade.pnlQuote || 0) < 0) {
        streak += 1;
        continue;
      }
      if ((trade.pnlQuote || 0) > 0) {
        break;
      }
      continue;
    }
    const exitMs = new Date(exitAt).getTime();
    if (!Number.isFinite(exitMs)) {
      continue;
    }
    if (lookbackMs != null && nowMs - exitMs > lookbackMs) {
      break;
    }
    if ((trade.pnlQuote || 0) < 0) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}


function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function canUsePaperCalibrationProbe({ botMode, criticalIssues = [], health = {} }) {
  return botMode === "paper" && !health.circuitOpen && criticalIssues.length === 1 && criticalIssues[0] === "calibration_break";
}

function canUsePaperLossStreakFallback({ botMode, criticalIssues = [], health = {} }) {
  return botMode === "paper" && !health.circuitOpen && criticalIssues.length === 1 && criticalIssues[0] === "loss_streak_limit";
}

function canUsePaperRecoverableCriticalFallback({ botMode, criticalIssues = [], health = {} }) {
  if (botMode !== "paper" || health.circuitOpen || !criticalIssues.length) {
    return false;
  }
  const recoverableIssues = new Set(["loss_streak_limit", "calibration_break"]);
  return criticalIssues.every((issue) => recoverableIssues.has(issue));
}

function canSwitchLiveModeToPaperFallback({ botMode, config = {} }) {
  if (botMode !== "live" || !config.selfHealSwitchToPaper) {
    return false;
  }
  const baseUrl = `${config.binanceApiBaseUrl || ""}`.toLowerCase();
  return !baseUrl.includes("demo-api.binance.com");
}

function toIso(now = new Date()) {
  return now instanceof Date && Number.isFinite(now.getTime())
    ? now.toISOString()
    : nowIso();
}

function buildTriggerWindow(
  previous = {},
  now = new Date(),
  { mode = null, reason = null, issues = [], cooldownMinutes = 0 } = {}
) {
  const nextTriggeredAt =
    now instanceof Date && Number.isFinite(now.getTime())
      ? now.toISOString()
      : nowIso();
  const cooldownUntil = new Date(now.getTime() + Math.max(0, cooldownMinutes) * 60_000).toISOString();
  const previousIssues = new Set((previous.issues || []).filter(Boolean));
  const preservePreviousTrigger =
    Boolean(previous.active) &&
    previous.mode === mode &&
    (previous.reason || null) === reason &&
    previousIssues.size === issues.length &&
    issues.every((issue) => previousIssues.has(issue));

  return {
    cooldownUntil: preservePreviousTrigger && previous.cooldownUntil
      ? previous.cooldownUntil
      : cooldownUntil,
    lastTriggeredAt: preservePreviousTrigger && previous.lastTriggeredAt
      ? previous.lastTriggeredAt
      : nextTriggeredAt
  };
}

export class SelfHealManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  buildDefaultState() {
    return {
      mode: "normal",
      active: false,
      reason: null,
      issues: [],
      criticalIssues: [],
      warningIssues: [],
      actions: [],
      managerAction: null,
      sizeMultiplier: 1,
      thresholdPenalty: 0,
      lowRiskOnly: false,
      learningAllowed: false,
      cooldownActive: false,
      cooldownRemainingMinutes: 0,
      recoverableIssues: [],
      recoveryBlockedBy: [],
      cooldownUntil: null,
      lastTriggeredAt: null,
      lastRecoveryAt: null,
      restoreSnapshotAt: null
    };
  }

  evaluate({
    previousState,
    report,
    driftSummary,
    health,
    calibration,
    botMode,
    hasStableModel,
    now = new Date()
  }) {
    const previous = previousState || this.buildDefaultState();
    const state = this.buildDefaultState();
    const recentTrades = [...(report.recentTrades || [])];
    const losses = recentLossStreak(recentTrades, {
      now,
      lookbackMinutes: this.config.lossStreakLookbackMinutes
    });
    const dailyLossFraction = (report.windows?.today?.realizedPnl || 0) < 0
      ? Math.abs(report.windows.today.realizedPnl || 0) / Math.max(this.config.startingCash, 1)
      : 0;
    const criticalIssues = [];
    const warningIssues = [];
    const finalizeState = (nextState) => {
      const cooldownUntilMs = nextState.cooldownUntil ? new Date(nextState.cooldownUntil).getTime() : Number.NaN;
      const nextCooldownActive = Number.isFinite(cooldownUntilMs) && cooldownUntilMs > now.getTime();
      const recoveryBlockedBy = [...new Set([
        ...criticalIssues,
        ...warningIssues,
        ...(nextState.issues || [])
      ])];
      const recoverableIssues = recoveryBlockedBy.filter((issue) => [
        "loss_streak_limit",
        "loss_streak_warning",
        "calibration_break",
        "calibration_warning",
        "cooldown_active"
      ].includes(issue));
      return {
        ...nextState,
        criticalIssues: [...criticalIssues],
        warningIssues: [...warningIssues],
        cooldownActive: Boolean(nextCooldownActive),
        cooldownRemainingMinutes: nextCooldownActive
          ? Math.max(0, Math.ceil((cooldownUntilMs - now.getTime()) / 60_000))
          : 0,
        recoverableIssues,
        recoveryBlockedBy
      };
    };

    if (health.circuitOpen) {
      criticalIssues.push("health_circuit_open");
    }
    if (losses >= this.config.selfHealMaxRecentLossStreak) {
      criticalIssues.push("loss_streak_limit");
    } else if (losses >= this.config.selfHealWarningLossStreak) {
      warningIssues.push("loss_streak_warning");
    }
    if (dailyLossFraction >= this.config.selfHealMaxRecentDrawdownPct) {
      criticalIssues.push("drawdown_limit");
    } else if (dailyLossFraction >= this.config.selfHealWarningDrawdownPct) {
      warningIssues.push("drawdown_warning");
    }
    if ((driftSummary.severity || 0) >= 0.82) {
      criticalIssues.push("drift_critical");
    } else if ((driftSummary.severity || 0) >= 0.45) {
      warningIssues.push("drift_warning");
    }
    const calibrationObservations = calibration.observations || 0;
    const hasCalibrationSample = calibrationObservations >= Math.max(this.config.calibrationMinObservations || 0, 1);
    if (hasCalibrationSample && (calibration.expectedCalibrationError || 0) >= this.config.driftCalibrationEceBlock) {
      criticalIssues.push("calibration_break");
    } else if (hasCalibrationSample && (calibration.expectedCalibrationError || 0) >= this.config.driftCalibrationEceAlert) {
      warningIssues.push("calibration_warning");
    }

    const cooldownActive = previous.cooldownUntil && new Date(previous.cooldownUntil).getTime() > now.getTime();
    const recoveredPaperCooldown = botMode === "paper" && cooldownActive && !health.circuitOpen && !criticalIssues.length && !warningIssues.length;
    const allowPaperFallbackSwitch = canSwitchLiveModeToPaperFallback({ botMode, config: this.config });
    if (criticalIssues.length) {
      if (canUsePaperLossStreakFallback({ botMode, criticalIssues, health })) {
        const triggerWindow = buildTriggerWindow(previous, now, {
          mode: "low_risk_only",
          reason: "loss_streak_limit",
          issues: criticalIssues,
          cooldownMinutes: this.config.selfHealCooldownMinutes
        });
        state.mode = "low_risk_only";
        state.active = true;
        state.reason = "loss_streak_limit";
        state.issues = criticalIssues;
        state.actions = ["limit_entries"];
        state.managerAction = null;
        state.sizeMultiplier = 0.32;
        state.thresholdPenalty = 0.08;
        state.lowRiskOnly = true;
        state.learningAllowed = true;
        state.cooldownUntil = triggerWindow.cooldownUntil;
        state.lastTriggeredAt = triggerWindow.lastTriggeredAt;
        return finalizeState(state);
      }
      if (canUsePaperCalibrationProbe({ botMode, criticalIssues, health })) {
        const triggerWindow = buildTriggerWindow(previous, now, {
          mode: "paper_calibration_probe",
          reason: "calibration_break",
          issues: criticalIssues,
          cooldownMinutes: this.config.selfHealCooldownMinutes
        });
        state.mode = "paper_calibration_probe";
        state.active = true;
        state.reason = "calibration_break";
        state.issues = criticalIssues;
        state.actions = ["paper_probe_entries"];
        if (this.config.selfHealResetRlOnTrigger) {
          state.actions.push("reset_rl_policy");
        }
        if (this.config.selfHealRestoreStableModel && hasStableModel) {
          state.actions.push("restore_stable_model");
        }
        state.managerAction = null;
        state.sizeMultiplier = this.config.selfHealPaperCalibrationProbeSizeMultiplier;
        state.thresholdPenalty = this.config.selfHealPaperCalibrationProbeThresholdPenalty;
        state.lowRiskOnly = true;
        state.learningAllowed = true;
        state.cooldownUntil = triggerWindow.cooldownUntil;
        state.lastTriggeredAt = triggerWindow.lastTriggeredAt;
        return finalizeState(state);
      }
      if (canUsePaperRecoverableCriticalFallback({ botMode, criticalIssues, health })) {
        const includesCalibrationBreak = criticalIssues.includes("calibration_break");
        const triggerWindow = buildTriggerWindow(previous, now, {
          mode: "low_risk_only",
          reason: criticalIssues.includes("loss_streak_limit") ? "loss_streak_limit" : criticalIssues[0],
          issues: criticalIssues,
          cooldownMinutes: this.config.selfHealCooldownMinutes
        });
        state.mode = "low_risk_only";
        state.active = true;
        state.reason = criticalIssues.includes("loss_streak_limit") ? "loss_streak_limit" : criticalIssues[0];
        state.issues = criticalIssues;
        state.actions = ["limit_entries"];
        if (includesCalibrationBreak) {
          state.actions.push("paper_probe_entries");
          if (this.config.selfHealResetRlOnTrigger) {
            state.actions.push("reset_rl_policy");
          }
          if (this.config.selfHealRestoreStableModel && hasStableModel) {
            state.actions.push("restore_stable_model");
          }
        }
        state.managerAction = null;
        state.sizeMultiplier = includesCalibrationBreak
          ? Math.min(0.32, this.config.selfHealPaperCalibrationProbeSizeMultiplier || 0.32)
          : 0.32;
        state.thresholdPenalty = includesCalibrationBreak
          ? Math.max(0.08, this.config.selfHealPaperCalibrationProbeThresholdPenalty || 0)
          : 0.08;
        state.lowRiskOnly = true;
        state.learningAllowed = true;
        state.cooldownUntil = triggerWindow.cooldownUntil;
        state.lastTriggeredAt = triggerWindow.lastTriggeredAt;
        return finalizeState(state);
      }
      const triggerWindow = buildTriggerWindow(previous, now, {
        mode: allowPaperFallbackSwitch ? "paper_fallback" : "paused",
        reason: criticalIssues[0],
        issues: criticalIssues,
        cooldownMinutes: this.config.selfHealCooldownMinutes
      });
      state.mode = allowPaperFallbackSwitch ? "paper_fallback" : "paused";
      state.active = true;
      state.reason = criticalIssues[0];
      state.issues = criticalIssues;
      state.actions = [
        allowPaperFallbackSwitch ? "switch_to_paper" : "pause_entries"
      ];
      if (this.config.selfHealResetRlOnTrigger) {
        state.actions.push("reset_rl_policy");
      }
      if (this.config.selfHealRestoreStableModel && hasStableModel) {
        state.actions.push("restore_stable_model");
      }
      state.managerAction = allowPaperFallbackSwitch ? "switch_to_paper" : null;
      state.sizeMultiplier = 0;
      state.thresholdPenalty = 0.12;
      state.lowRiskOnly = true;
      state.learningAllowed = false;
      state.cooldownUntil = triggerWindow.cooldownUntil;
      state.lastTriggeredAt = triggerWindow.lastTriggeredAt;
      return finalizeState(state);
    }

    if (recoveredPaperCooldown) {
      state.lastRecoveryAt = toIso(now);
      return finalizeState(state);
    }

    if (warningIssues.length || cooldownActive) {
      state.mode = "low_risk_only";
      state.active = true;
      state.reason = warningIssues[0] || "cooldown_active";
      state.issues = warningIssues.length ? warningIssues : ["cooldown_active"];
      state.actions = [];
      state.sizeMultiplier = cooldownActive ? 0.42 : 0.58;
      state.thresholdPenalty = cooldownActive ? 0.06 : 0.04;
      state.lowRiskOnly = true;
      state.learningAllowed = botMode === "paper" && state.reason === "calibration_warning";
      state.cooldownUntil = previous.cooldownUntil && cooldownActive
        ? previous.cooldownUntil
        : new Date(now.getTime() + this.config.selfHealCooldownMinutes * 60_000).toISOString();
      state.lastTriggeredAt = previous.lastTriggeredAt || toIso(now);
      return finalizeState(state);
    }

    state.lastRecoveryAt = previous.active ? toIso(now) : previous.lastRecoveryAt || null;
    return finalizeState(state);
  }

  summarize(state) {
    const safe = state || this.buildDefaultState();
    return {
      mode: safe.mode,
      active: Boolean(safe.active),
      reason: safe.reason || null,
      issues: [...(safe.issues || [])],
      criticalIssues: [...(safe.criticalIssues || [])],
      warningIssues: [...(safe.warningIssues || [])],
      actions: [...(safe.actions || [])],
      managerAction: safe.managerAction || null,
      sizeMultiplier: num(safe.sizeMultiplier ?? 1),
      thresholdPenalty: num(safe.thresholdPenalty || 0),
      lowRiskOnly: Boolean(safe.lowRiskOnly),
      learningAllowed: Boolean(safe.learningAllowed),
      cooldownActive: Boolean(safe.cooldownActive),
      cooldownRemainingMinutes: Math.max(0, Math.round(safe.cooldownRemainingMinutes || 0)),
      recoverableIssues: [...(safe.recoverableIssues || [])],
      recoveryBlockedBy: [...(safe.recoveryBlockedBy || [])],
      cooldownUntil: safe.cooldownUntil || null,
      lastTriggeredAt: safe.lastTriggeredAt || null,
      lastRecoveryAt: safe.lastRecoveryAt || null,
      restoreSnapshotAt: safe.restoreSnapshotAt || null
    };
  }

  isLowRiskCandidate(candidate = {}) {
    const family = candidate.strategySummary?.family || "";
    const spreadBps = candidate.marketSnapshot?.book?.spreadBps || 0;
    const realizedVolPct = candidate.marketSnapshot?.market?.realizedVolPct || 0;
    const newsRisk = candidate.newsSummary?.riskScore || 0;
    const calendarRisk = candidate.calendarSummary?.riskScore || 0;
    return (
      ["trend_following", "mean_reversion", "orderflow"].includes(family) &&
      spreadBps <= Math.max(this.config.maxSpreadBps * 0.4, 3) &&
      realizedVolPct <= this.config.maxRealizedVolPct * 0.75 &&
      newsRisk <= 0.42 &&
      calendarRisk <= 0.42
    );
  }
}


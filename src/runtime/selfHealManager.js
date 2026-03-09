import { nowIso } from "../utils/time.js";

function recentLossStreak(trades = [], { now = new Date(), lookbackMinutes = 0 } = {}) {
  let streak = 0;
  const nowMs = now.getTime();
  const lookbackMs = Number.isFinite(lookbackMinutes) && lookbackMinutes > 0 ? lookbackMinutes * 60_000 : null;
  for (const trade of trades) {
    const exitAt = trade.exitAt || trade.at || null;
    if (!exitAt) {
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
      actions: [],
      managerAction: null,
      sizeMultiplier: 1,
      thresholdPenalty: 0,
      lowRiskOnly: false,
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
    if (criticalIssues.length) {
      state.mode = botMode === "live" && this.config.selfHealSwitchToPaper ? "paper_fallback" : "paused";
      state.active = true;
      state.reason = criticalIssues[0];
      state.issues = criticalIssues;
      state.actions = [
        botMode === "live" && this.config.selfHealSwitchToPaper ? "switch_to_paper" : "pause_entries"
      ];
      if (this.config.selfHealResetRlOnTrigger) {
        state.actions.push("reset_rl_policy");
      }
      if (this.config.selfHealRestoreStableModel && hasStableModel) {
        state.actions.push("restore_stable_model");
      }
      state.managerAction = botMode === "live" && this.config.selfHealSwitchToPaper ? "switch_to_paper" : null;
      state.sizeMultiplier = 0;
      state.thresholdPenalty = 0.12;
      state.lowRiskOnly = true;
      state.cooldownUntil = new Date(now.getTime() + this.config.selfHealCooldownMinutes * 60_000).toISOString();
      state.lastTriggeredAt = nowIso();
      return state;
    }

    if (warningIssues.length || cooldownActive) {
      state.mode = "low_risk_only";
      state.active = true;
      state.reason = warningIssues[0] || previous.reason || "cooldown_active";
      state.issues = warningIssues.length ? warningIssues : ["cooldown_active"];
      state.actions = [];
      state.sizeMultiplier = cooldownActive ? 0.42 : 0.58;
      state.thresholdPenalty = cooldownActive ? 0.06 : 0.04;
      state.lowRiskOnly = true;
      state.cooldownUntil = previous.cooldownUntil && cooldownActive
        ? previous.cooldownUntil
        : new Date(now.getTime() + this.config.selfHealCooldownMinutes * 60_000).toISOString();
      state.lastTriggeredAt = previous.lastTriggeredAt || nowIso();
      return state;
    }

    state.lastRecoveryAt = previous.active ? nowIso() : previous.lastRecoveryAt || null;
    return state;
  }

  summarize(state) {
    const safe = state || this.buildDefaultState();
    return {
      mode: safe.mode,
      active: Boolean(safe.active),
      reason: safe.reason || null,
      issues: [...(safe.issues || [])],
      actions: [...(safe.actions || [])],
      managerAction: safe.managerAction || null,
      sizeMultiplier: num(safe.sizeMultiplier ?? 1),
      thresholdPenalty: num(safe.thresholdPenalty || 0),
      lowRiskOnly: Boolean(safe.lowRiskOnly),
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


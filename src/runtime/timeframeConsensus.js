import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function resolveTimeframeStrategyProfile(strategySummary = {}, lower = {}) {
  const family = strategySummary.family || "";
  const strategyId = strategySummary.activeStrategy || strategySummary.setupStyle || family;
  const breakoutImpulse = Math.max(Math.abs(lower.breakoutPct || 0), Math.abs(lower.donchianBreakoutPct || 0));
  const squeezeRelease = clamp(lower.squeezeReleaseScore || 0, 0, 1);
  const structureBreak = clamp(lower.structureBreakScore || 0, 0, 1);
  const liquiditySweep = clamp(lower.liquiditySweepScore || 0, 0, 1);
  const closeLocation = clamp(lower.closeLocation || 0, 0, 1);

  const profiles = {
    ema_trend: {
      id: "trend_continuation",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.08,
      triggerConfirmed: true
    },
    vwap_trend: {
      id: "trend_continuation",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.08,
      triggerConfirmed: true
    },
    trend_following: {
      id: "trend_continuation",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.08,
      triggerConfirmed: true
    },
    breakout: {
      id: "breakout_continuation",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.1,
      triggerConfirmed: breakoutImpulse >= 0.0025 || squeezeRelease >= 0.58
    },
    breakout_continuation: {
      id: "breakout_continuation",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.1,
      triggerConfirmed: breakoutImpulse >= 0.0025 || squeezeRelease >= 0.58
    },
    donchian_breakout: {
      id: "breakout_continuation",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.1,
      triggerConfirmed: breakoutImpulse >= 0.0025 || structureBreak >= 0.4
    },
    atr_breakout: {
      id: "breakout_continuation",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.1,
      triggerConfirmed: breakoutImpulse >= 0.0025 || squeezeRelease >= 0.55
    },
    market_structure_break: {
      id: "structure_break",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.1,
      triggerConfirmed: structureBreak >= 0.45 || breakoutImpulse >= 0.0025
    },
    open_interest_breakout: {
      id: "structure_break",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.1,
      triggerConfirmed: structureBreak >= 0.45 || breakoutImpulse >= 0.0025
    },
    bollinger_squeeze: {
      id: "pre_breakout_probe",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.18,
      triggerConfirmed: squeezeRelease >= 0.58 || breakoutImpulse >= 0.0035,
      pendingReason: "breakout_release_pending_against_higher_tf"
    },
    liquidity_sweep: {
      id: "reclaim_probe",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.18,
      triggerConfirmed: liquiditySweep >= 0.58 && closeLocation >= 0.62,
      pendingReason: "reclaim_pending_against_higher_tf"
    },
    orderbook_imbalance: {
      id: "microstructure_probe",
      hardConflict: false,
      hardMisalignment: false,
      lowerDirectionalThreshold: 0.1,
      triggerConfirmed: false
    },
    vwap_reversion: {
      id: "mean_reversion",
      hardConflict: false,
      hardMisalignment: false,
      lowerDirectionalThreshold: 0.12,
      triggerConfirmed: false
    },
    zscore_reversion: {
      id: "mean_reversion",
      hardConflict: false,
      hardMisalignment: false,
      lowerDirectionalThreshold: 0.12,
      triggerConfirmed: false
    },
    bear_rally_reclaim: {
      id: "mean_reversion",
      hardConflict: false,
      hardMisalignment: false,
      lowerDirectionalThreshold: 0.12,
      triggerConfirmed: false
    },
    funding_rate_extreme: {
      id: "funding_reversion",
      hardConflict: false,
      hardMisalignment: false,
      lowerDirectionalThreshold: 0.12,
      triggerConfirmed: false
    }
  };

  if (profiles[strategyId]) {
    return profiles[strategyId];
  }
  if (family === "trend_following") {
    return {
      id: "trend_continuation",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.08,
      triggerConfirmed: true
    };
  }
  if (family === "breakout" || family === "market_structure") {
    return {
      id: family === "breakout" ? "breakout_continuation" : "structure_break",
      hardConflict: true,
      hardMisalignment: true,
      lowerDirectionalThreshold: 0.12,
      triggerConfirmed: breakoutImpulse >= 0.0028 || squeezeRelease >= 0.58 || structureBreak >= 0.45
    };
  }
  if (family === "mean_reversion" || family === "orderflow" || family === "derivatives") {
    return {
      id: family,
      hardConflict: false,
      hardMisalignment: false,
      lowerDirectionalThreshold: 0.12,
      triggerConfirmed: false
    };
  }
  return {
    id: family || "generic",
    hardConflict: true,
    hardMisalignment: true,
    lowerDirectionalThreshold: 0.1,
    triggerConfirmed: breakoutImpulse >= 0.0028 || structureBreak >= 0.45
  };
}

export function buildTimeframeConsensus({ marketSnapshot = {}, regimeSummary = {}, strategySummary = {}, config = {} } = {}) {
  const lower = marketSnapshot.timeframes?.lower?.market || {};
  const higher = marketSnapshot.timeframes?.higher?.market || {};
  const lowerInterval = marketSnapshot.timeframes?.lower?.interval || config.lowerTimeframeInterval || "5m";
  const higherInterval = marketSnapshot.timeframes?.higher?.interval || config.higherTimeframeInterval || "1h";
  const lowerBias = clamp(
    (lower.emaTrendScore || 0) * 0.45 +
      (lower.momentum20 || 0) * 12 +
      (lower.breakoutPct || 0) * 18 +
      ((lower.supertrendDirection || 0) * 0.18),
    -1,
    1
  );
  const higherBias = clamp(
    (higher.emaTrendScore || 0) * 0.5 +
      (higher.momentum20 || 0) * 14 +
      (higher.breakoutPct || 0) * 20 +
      ((higher.supertrendDirection || 0) * 0.2),
    -1,
    1
  );
  const volatilityGap = Math.abs((lower.realizedVolPct || 0) - (higher.realizedVolPct || 0));
  const directionAgreement = lowerBias === 0 || higherBias === 0
    ? 0.5
    : Math.sign(lowerBias) === Math.sign(higherBias)
      ? 1
      : 0;
  const alignmentScore = clamp(
    directionAgreement * 0.52 +
      (1 - clamp(Math.abs(lowerBias - higherBias), 0, 1)) * 0.28 +
      (1 - clamp(volatilityGap / Math.max(config.crossTimeframeMaxVolGapPct || 0.03, 0.005), 0, 1)) * 0.2,
    0,
    1
  );
  const reasons = [];
  const blockers = [];
  const strategyProfile = resolveTimeframeStrategyProfile(strategySummary, lower);
  const lowerDirectional = Math.abs(lowerBias) >= (strategyProfile.lowerDirectionalThreshold || 0.08);
  const higherDirectional = Math.abs(higherBias) >= 0.16;
  const lowerTriggerConfirmed = lowerDirectional && Boolean(strategyProfile.triggerConfirmed);
  const hardHigherTfConflict = lowerTriggerConfirmed && higherDirectional && Math.sign(lowerBias || 0) !== Math.sign(higherBias || 0) && strategyProfile.hardConflict;
  if (directionAgreement >= 1 && Math.abs(higherBias) >= 0.18) {
    reasons.push("higher_tf_confirms_direction");
  }
  if (Math.abs(lowerBias) >= 0.18) {
    reasons.push("lower_tf_trigger_active");
  }
  if (volatilityGap <= Math.max(config.crossTimeframeMaxVolGapPct || 0.03, 0.005) * 0.6) {
    reasons.push("volatility_regimes_aligned");
  }
  if (hardHigherTfConflict) {
    blockers.push("higher_tf_conflict");
  } else if (lowerDirectional && higherDirectional && Math.sign(lowerBias || 0) !== Math.sign(higherBias || 0)) {
    const softConflictReason = strategyProfile.pendingReason && !lowerTriggerConfirmed
      ? strategyProfile.pendingReason
      : (lowerTriggerConfirmed || !strategyProfile.hardConflict)
        ? "higher_tf_bias_against_entry"
        : "higher_tf_bias_without_confirmed_trigger";
    reasons.push(softConflictReason);
  } else if (!lowerDirectional && higherDirectional) {
    reasons.push("higher_tf_bias_without_lower_trigger");
  }
  if (alignmentScore < (config.crossTimeframeMinAlignmentScore || 0.42) && strategyProfile.hardMisalignment) {
    if (lowerTriggerConfirmed) {
      blockers.push("cross_timeframe_misalignment");
    } else {
      reasons.push(strategyProfile.pendingReason || (higherDirectional ? "higher_tf_bias_without_confirmed_trigger" : "timeframe_alignment_inconclusive"));
    }
  }
  if (regimeSummary.regime === "event_risk" && directionAgreement === 0 && volatilityGap > (config.crossTimeframeMaxVolGapPct || 0.03)) {
    blockers.push("event_regime_tf_noise");
  }
  return {
    enabled: Boolean(config.enableCrossTimeframeConsensus),
    lowerInterval,
    higherInterval,
    lowerBias: num(lowerBias),
    higherBias: num(higherBias),
    alignmentScore: num(alignmentScore),
    directionAgreement,
    volatilityGapPct: num(volatilityGap),
    strategyProfile: strategyProfile.id,
    triggerConfirmed: lowerTriggerConfirmed,
    lowerDirectionalThreshold: num(strategyProfile.lowerDirectionalThreshold || 0.08),
    reasons: [...new Set(reasons)],
    blockerReasons: [...new Set(blockers)],
    summary: blockers.length
      ? `${higherInterval} en ${lowerInterval} liggen niet netjes in lijn.`
      : reasons.includes("higher_tf_bias_against_entry") || reasons.includes("higher_tf_bias_without_lower_trigger") || reasons.includes("higher_tf_bias_without_confirmed_trigger") || reasons.includes("breakout_release_pending_against_higher_tf") || reasons.includes("reclaim_pending_against_higher_tf")
        ? `${higherInterval} geeft tegendruk, maar ${lowerInterval} heeft nog geen bevestigde trigger voor een hard veto.`
        : `${higherInterval} bevestigt ${lowerInterval} voldoende.`
  };
}

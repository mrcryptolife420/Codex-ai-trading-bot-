import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function safe(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function scoreSnapshot(snapshot = {}, config) {
  const drawdownPenalty = clamp(safe(snapshot.maxDrawdownPct) / Math.max(config.modelRegistryRollbackDrawdownPct || 0.08, 0.01), 0, 1.4);
  const pnlEdge = clamp(safe(snapshot.realizedPnl) / 1200, -0.25, 0.35);
  const sharpeEdge = clamp(safe(snapshot.averageSharpe) * 0.2, -0.15, 0.32);
  const winRateEdge = clamp((safe(snapshot.winRate) - 0.5) * 0.4, -0.18, 0.22);
  const calibrationEdge = clamp(0.18 - safe(snapshot.calibrationEce), -0.2, 0.18);
  return clamp(0.48 + pnlEdge + sharpeEdge + winRateEdge + calibrationEdge - drawdownPenalty * 0.22, 0, 1);
}

function mapSnapshot(snapshot = {}, config) {
  const qualityScore = scoreSnapshot(snapshot, config);
  const rollbackReady = qualityScore >= config.modelRegistryMinScore;
  return {
    at: snapshot.at || null,
    reason: snapshot.reason || "snapshot",
    tradeCount: snapshot.tradeCount || 0,
    winRate: num(snapshot.winRate || 0, 4),
    realizedPnl: num(snapshot.realizedPnl || 0, 2),
    averageSharpe: num(snapshot.averageSharpe || 0, 3),
    maxDrawdownPct: num(snapshot.maxDrawdownPct || 0, 4),
    calibrationEce: num(snapshot.calibrationEce || 0, 4),
    deploymentActive: snapshot.deploymentActive || null,
    source: snapshot.source || "runtime",
    qualityScore: num(qualityScore, 4),
    rollbackReady
  };
}

export class ModelRegistry {
  constructor(config) {
    this.config = config;
  }

  createSnapshot({ reason, report, calibration, deployment, modelState, source = "runtime", nowIso = new Date().toISOString() } = {}) {
    const allTime = report?.windows?.allTime || report || {};
    return {
      at: nowIso,
      reason: reason || "snapshot",
      tradeCount: allTime.tradeCount || 0,
      winRate: num(allTime.winRate || 0, 4),
      realizedPnl: num(allTime.realizedPnl || 0, 2),
      averageSharpe: num(report?.researchSharpe || allTime.sharpe || 0, 3),
      maxDrawdownPct: num(allTime.maxDrawdownPct || report?.maxDrawdownPct || 0, 4),
      calibrationEce: num(calibration?.expectedCalibrationError || 0, 4),
      deploymentActive: deployment?.active || null,
      source,
      modelState
    };
  }

  chooseRollback(snapshots = []) {
    const ranked = snapshots
      .map((snapshot) => mapSnapshot(snapshot, this.config))
      .filter((snapshot) => snapshot.rollbackReady)
      .sort((left, right) => right.qualityScore - left.qualityScore);
    return ranked[0] || null;
  }

  buildPromotionPolicy({ report = null, researchRegistry = null, calibration = null, deployment = null, divergenceSummary = null, offlineTrainer = null } = {}) {
    const paperStats = report?.modes?.paper || report?.windows?.allTime || {};
    const liveStats = report?.modes?.live || {};
    const paperQualityScore = scoreSnapshot(
      {
        realizedPnl: paperStats.realizedPnl || 0,
        winRate: paperStats.winRate || 0,
        maxDrawdownPct: report?.maxDrawdownPct || 0,
        calibrationEce: calibration?.expectedCalibrationError || 0,
        averageSharpe: researchRegistry?.leaderboard?.[0]?.averageSharpe || 0
      },
      this.config
    );
    const liveQualityScore = (liveStats.tradeCount || 0)
      ? scoreSnapshot(
          {
            realizedPnl: liveStats.realizedPnl || 0,
            winRate: liveStats.winRate || 0,
            maxDrawdownPct: report?.maxDrawdownPct || 0,
            calibrationEce: calibration?.expectedCalibrationError || 0,
            averageSharpe: researchRegistry?.leaderboard?.[0]?.averageSharpe || 0
          },
          this.config
        )
      : null;
    const challengerEdge = deployment?.championError != null && deployment?.challengerError != null
      ? deployment.championError - deployment.challengerError
      : 0;
    const strategyScorecards = [...(offlineTrainer?.strategyScorecards || [])];
    const matureStrategyScorecards = strategyScorecards.filter((item) => (item.tradeCount || 0) >= Math.max(3, (this.config.strategyAttributionMinTrades || 6) - 2));
    const strongStrategyScorecards = matureStrategyScorecards.filter((item) => (item.governanceScore || 0) >= 0.52);
    const regimeScorecards = [...(offlineTrainer?.regimeScorecards || [])];
    const matureRegimeScorecards = regimeScorecards.filter((item) => (item.tradeCount || 0) >= Math.max(2, (this.config.strategyAttributionMinTrades || 6) - 3));
    const strongRegimeScorecards = matureRegimeScorecards.filter((item) => (item.governanceScore || 0) >= 0.52);
    const calibrationGovernance = offlineTrainer?.calibrationGovernance || {};
    const exitLearning = offlineTrainer?.exitLearning || {};
    const featureDecay = offlineTrainer?.featureDecay || {};
    const thresholdPolicy = offlineTrainer?.thresholdPolicy || {};
    const regimePolicies = matureRegimeScorecards
      .map((item) => ({
        id: item.id,
        governanceScore: num(item.governanceScore || 0, 4),
        tradeCount: item.tradeCount || 0,
        status: (item.governanceScore || 0) >= 0.56
          ? "ready"
          : (item.governanceScore || 0) >= 0.42
            ? "observe"
            : "cooldown"
      }))
      .slice(0, 6);
    const readyRegimes = strongRegimeScorecards.map((item) => item.id).slice(0, 4);
    const observeRegimes = matureRegimeScorecards
      .filter((item) => !readyRegimes.includes(item.id))
      .map((item) => item.id)
      .slice(0, 4);
    const blockerReasons = [];

    if ((deployment?.shadowTradeCount || 0) < this.config.modelPromotionMinShadowTrades) {
      blockerReasons.push("shadow_sample_too_small");
    }
    if ((paperStats.tradeCount || 0) < this.config.modelPromotionMinPaperTrades) {
      blockerReasons.push("paper_scorecard_too_small");
    }
    if ((paperStats.winRate || 0) < this.config.modelPromotionMinPaperWinRate) {
      blockerReasons.push("paper_winrate_below_floor");
    }
    if ((report?.maxDrawdownPct || 0) > this.config.modelPromotionMaxPaperDrawdownPct) {
      blockerReasons.push("paper_drawdown_too_high");
    }
    if (paperQualityScore < this.config.modelPromotionMinPaperQuality) {
      blockerReasons.push("paper_quality_too_low");
    }
    if ((liveStats.tradeCount || 0) >= this.config.modelPromotionMinLiveTrades && (liveQualityScore || 0) < this.config.modelPromotionMinLiveQuality) {
      blockerReasons.push("live_quality_too_low");
    }
    if (challengerEdge <= Math.max(this.config.challengerPromotionMargin || 0, 0.0025)) {
      blockerReasons.push("challenger_edge_too_small");
    }
    if ((calibration?.expectedCalibrationError || 1) > Math.max(this.config.stableModelMaxCalibrationEce || 0.14, 0.08) + 0.04) {
      blockerReasons.push("calibration_not_stable_enough");
    }
    if (!(researchRegistry?.governance?.promotionCandidates || []).length) {
      blockerReasons.push("research_registry_not_ready");
    }
    if ((divergenceSummary?.leadBlocker?.status || "") === "blocked" || (divergenceSummary?.averageScore || 0) >= this.config.divergenceBlockScore) {
      blockerReasons.push("live_paper_divergence_too_high");
    }
    if ((offlineTrainer?.readinessScore || 0) < this.config.offlineTrainerMinReadiness) {
      blockerReasons.push("offline_trainer_not_ready");
    }
    if ((calibrationGovernance?.status || "") === "blocked") {
      blockerReasons.push("calibration_governance_not_ready");
    }
    if ((exitLearning?.status || "") === "blocked") {
      blockerReasons.push("exit_learning_not_ready");
    }
    if ((featureDecay?.status || "") === "blocked") {
      blockerReasons.push("feature_decay_too_high");
    }
    if (!matureStrategyScorecards.length) {
      blockerReasons.push("strategy_scorecards_not_ready");
    } else if (strongStrategyScorecards.length / Math.max(matureStrategyScorecards.length, 1) < 0.34) {
      blockerReasons.push("strategy_scorecards_too_weak");
    }
    if (matureRegimeScorecards.length && !strongRegimeScorecards.length) {
      blockerReasons.push("regime_scorecards_too_weak");
    }

    const probationRequired = (liveStats.tradeCount || 0) < this.config.modelPromotionProbationLiveTrades;
    const allowPromotion = blockerReasons.length === 0;
    return {
      allowPromotion,
      probationRequired,
      probationTradesRemaining: probationRequired ? Math.max(0, this.config.modelPromotionProbationLiveTrades - (liveStats.tradeCount || 0)) : 0,
      readyLevel: allowPromotion
        ? probationRequired
          ? "probation"
          : "ready"
        : (deployment?.shadowTradeCount || 0) < this.config.modelPromotionMinShadowTrades
          ? "warmup"
          : blockerReasons.length >= 4
            ? "blocked"
            : "observe",
      shadowTradeCount: deployment?.shadowTradeCount || 0,
      challengerEdge: num(challengerEdge, 4),
      paperTradeCount: paperStats.tradeCount || 0,
      paperWinRate: num(paperStats.winRate || 0, 4),
      paperQualityScore: num(paperQualityScore, 4),
      liveTradeCount: liveStats.tradeCount || 0,
      liveQualityScore: liveQualityScore == null ? null : num(liveQualityScore, 4),
      divergenceScore: num(divergenceSummary?.averageScore || 0, 4),
      offlineTrainerReadiness: num(offlineTrainer?.readinessScore || 0, 4),
      strategyScorecardCount: matureStrategyScorecards.length,
      strongStrategyScorecardCount: strongStrategyScorecards.length,
      regimeScorecardCount: matureRegimeScorecards.length,
      strongRegimeScorecardCount: strongRegimeScorecards.length,
      calibrationGovernanceStatus: calibrationGovernance.status || "warmup",
      exitLearningStatus: exitLearning.status || "warmup",
      featureDecayStatus: featureDecay.status || "warmup",
      thresholdPolicyStatus: thresholdPolicy.status || "stable",
      thresholdRecommendationCount: (thresholdPolicy.recommendations || []).length,
      readyRegimes,
      observeRegimes,
      regimePolicies,
      blockerReasons
    };
  }

  buildRegistry({ snapshots = [], report = null, researchRegistry = null, calibration = null, deployment = null, divergenceSummary = null, offlineTrainer = null, nowIso = new Date().toISOString() } = {}) {
    const entries = snapshots
      .map((snapshot) => mapSnapshot(snapshot, this.config))
      .sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime())
      .slice(0, this.config.modelRegistryMaxEntries || 12);
    const bestRollback = this.chooseRollback(snapshots);
    const latest = entries[0] || null;
    const promotionHint = researchRegistry?.governance?.promotionCandidates?.[0] || null;
    const promotionPolicy = this.buildPromotionPolicy({ report, researchRegistry, calibration, deployment, divergenceSummary, offlineTrainer });
    const currentQuality = latest ? latest.qualityScore : scoreSnapshot(
      {
        realizedPnl: report?.windows?.allTime?.realizedPnl || report?.realizedPnl || 0,
        winRate: report?.windows?.allTime?.winRate || report?.winRate || 0,
        maxDrawdownPct: report?.maxDrawdownPct || 0,
        calibrationEce: calibration?.expectedCalibrationError || 0,
        averageSharpe: researchRegistry?.leaderboard?.[0]?.averageSharpe || 0
      },
      this.config
    );

    return {
      generatedAt: nowIso,
      currentQualityScore: num(currentQuality, 4),
      latestSnapshotAt: latest?.at || null,
      latestReason: latest?.reason || null,
      latestDeployment: latest?.deploymentActive || deployment?.active || null,
      rollbackCandidate: bestRollback,
      registrySize: entries.length,
      promotionPolicy,
      promotionHint: promotionHint
        ? {
            symbol: promotionHint.symbol,
            governanceScore: num(promotionHint.governanceScore || 0, 4),
            status: promotionHint.status || "observe"
          }
        : null,
      entries,
      notes: [
        bestRollback
          ? `Rollback kan terugvallen op snapshot ${bestRollback.at} met quality ${bestRollback.qualityScore}.`
          : "Nog geen rollback-klare modelsnapshot beschikbaar.",
        promotionPolicy.allowPromotion
          ? promotionPolicy.probationRequired
            ? `Promotie kan, maar eerst ${promotionPolicy.probationTradesRemaining} live probation trades afronden.`
            : "Promotiebeleid staat op groen voor een challenger-promotie."
          : `Promotie wacht op: ${promotionPolicy.blockerReasons[0] || "meer data"}.`,
        promotionPolicy.strategyScorecardCount
          ? `${promotionPolicy.strongStrategyScorecardCount}/${promotionPolicy.strategyScorecardCount} strategy scorecards staan op groen.`
          : "Nog geen volwassen strategy scorecards beschikbaar.",
        promotionPolicy.regimeScorecardCount
          ? `${promotionPolicy.strongRegimeScorecardCount}/${promotionPolicy.regimeScorecardCount} regimes staan op groen (${(promotionPolicy.readyRegimes || []).join(", ") || "geen"}).`
          : "Nog geen volwassen regime scorecards beschikbaar.",
        `Calibration ${promotionPolicy.calibrationGovernanceStatus || "warmup"} | exits ${promotionPolicy.exitLearningStatus || "warmup"} | feature decay ${promotionPolicy.featureDecayStatus || "warmup"}.`,
        (promotionPolicy.thresholdRecommendationCount || 0)
          ? `${promotionPolicy.thresholdRecommendationCount} threshold-aanbevelingen wachten op review.`
          : "Geen open threshold-aanbevelingen in governance.",
        promotionHint
          ? `${promotionHint.symbol} scoort als research-promotiekandidaat.`
          : "Nog geen research-promotiekandidaat in de registry."
      ]
    };
  }
}

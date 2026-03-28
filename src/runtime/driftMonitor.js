import { clamp } from "../utils/math.js";

function average(values = []) {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((total, value) => total + value, 0) / filtered.length : 0;
}

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

export class DriftMonitor {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  evaluateCandidate({
    symbol,
    rawFeatures,
    score,
    regimeSummary,
    newsSummary,
    marketSnapshot,
    model
  }) {
    const featureDrift = model.assessFeatureDrift(rawFeatures, regimeSummary?.regime);
    const localBookFallbackReady = Boolean(marketSnapshot.book?.bookFallbackReady);
    const localBookDepthConfidence = marketSnapshot.book?.depthConfidence || 0;
    const featureDriftScore = clamp(
      (featureDrift.averageAbsZ - this.config.driftFeatureScoreAlert) /
        Math.max(this.config.driftFeatureScoreBlock - this.config.driftFeatureScoreAlert, 0.001),
      0,
      1
    );
    const sourceDriftScore = clamp(
      Math.max(0, this.config.driftLowReliabilityAlert - (newsSummary.reliabilityScore || 0)) /
        Math.max(this.config.driftLowReliabilityAlert, 0.001),
      0,
      1
    );
    const localBookScore = this.config.enableLocalOrderBook
      ? clamp(localBookFallbackReady ? 0 : 1 - localBookDepthConfidence, 0, 1)
      : 0;
    const severity = clamp(featureDriftScore * 0.56 + sourceDriftScore * 0.22 + localBookScore * 0.22, 0, 1);
    const blockerReasons = [];
    const reasons = [];

    if (featureDrift.comparableFeatures >= 5 && featureDrift.averageAbsZ >= this.config.driftFeatureScoreAlert) {
      reasons.push("feature_drift_warning");
    }
    if (featureDrift.comparableFeatures >= 5 && featureDrift.averageAbsZ >= this.config.driftFeatureScoreBlock) {
      blockerReasons.push("feature_drift_too_high");
    }
    if ((newsSummary.reliabilityScore || 0) < this.config.driftLowReliabilityAlert && (newsSummary.coverage || 0) > 0) {
      reasons.push("news_source_drift");
    }
    if (this.config.enableLocalOrderBook && !localBookFallbackReady && localBookDepthConfidence < 0.22) {
      blockerReasons.push("local_book_quality_too_low");
    }

    return {
      symbol,
      featureDriftScore: num(featureDriftScore),
      sourceDriftScore: num(sourceDriftScore),
      localBookScore: num(localBookScore),
      severity: num(severity),
      comparableFeatures: featureDrift.comparableFeatures || 0,
      averageAbsZ: num(featureDrift.averageAbsZ),
      maxAbsZ: num(featureDrift.maxAbsZ),
      driftedFeatures: (featureDrift.driftedFeatures || []).slice(0, 5),
      blockerReasons,
      reasons
    };
  }

  summarizeRuntime({
    runtime,
    report,
    stream,
    health,
    calibration,
    candidateSummaries = [],
    botMode
  }) {
    const candidates = candidateSummaries.slice(0, Math.max(this.config.driftMinCandidateCount, 1));
    const featureDriftScore = average(candidates.map((item) => item.drift?.featureDriftScore));
    const sourceDriftScore = average(candidates.map((item) => item.drift?.sourceDriftScore));
    const confidenceDriftScore = clamp(
      Math.max(0, this.config.driftPredictionConfidenceAlert - average(candidates.map((item) => item.confidence || 0))) /
        Math.max(this.config.driftPredictionConfidenceAlert, 0.001),
      0,
      1
    );
    const calibrationScore = (calibration.observations || 0) >= Math.max(this.config.calibrationMinObservations || 0, 1)
      ? clamp(
          ((calibration.expectedCalibrationError || 0) - this.config.driftCalibrationEceAlert) /
            Math.max(this.config.driftCalibrationEceBlock - this.config.driftCalibrationEceAlert, 0.001),
          0,
          1
        )
      : 0;
    const executionScore = clamp(
      ((report.executionSummary?.avgEntryTouchSlippageBps || 0) - this.config.driftExecutionSlipAlertBps) /
        Math.max(this.config.driftExecutionSlipBlockBps - this.config.driftExecutionSlipAlertBps, 0.001),
      0,
      1
    );
    const healthyRatio = stream.localBook?.trackedSymbols
      ? (stream.localBook.healthySymbols || 0) / stream.localBook.trackedSymbols
      : 1;
    const dataScore = clamp(1 - healthyRatio, 0, 1);
    const dailyLossFraction = (report.windows?.today?.realizedPnl || 0) < 0
      ? Math.abs(report.windows.today.realizedPnl || 0) / Math.max(this.config.startingCash, 1)
      : 0;
    const performanceScore = clamp(
      Math.max(
        dailyLossFraction / Math.max(this.config.selfHealMaxRecentDrawdownPct, 0.001),
        report.maxDrawdownPct / Math.max(this.config.selfHealMaxRecentDrawdownPct, 0.001)
      ),
      0,
      1
    );
    const severity = clamp(
      featureDriftScore * 0.22 +
        sourceDriftScore * 0.12 +
        confidenceDriftScore * 0.12 +
        calibrationScore * 0.18 +
        executionScore * 0.12 +
        dataScore * 0.1 +
        performanceScore * 0.14 +
        (health.circuitOpen ? 0.3 : 0),
      0,
      1
    );
    const blockerReasons = [];
    const reasons = [];

    if (featureDriftScore >= 0.55) {
      reasons.push("feature_drift_elevated");
    }
    if (featureDriftScore >= 0.9) {
      blockerReasons.push("feature_drift_critical");
    }
    if (sourceDriftScore >= 0.45) {
      reasons.push("source_reliability_drift");
    }
    if (calibrationScore >= 0.4) {
      reasons.push("calibration_drift");
    }
    if (executionScore >= 0.45) {
      reasons.push("execution_slippage_drift");
    }
    if (dataScore >= 0.35) {
      reasons.push("market_data_quality_drift");
    }
    if (performanceScore >= 0.55) {
      reasons.push("performance_drift");
    }
    if (health.circuitOpen) {
      blockerReasons.push("health_circuit_open");
    }
    if (botMode === "live" && severity >= 0.82) {
      blockerReasons.push("live_drift_guard");
    }

    return {
      status: severity >= 0.82 ? "critical" : severity >= 0.45 ? "warning" : "normal",
      severity: num(severity),
      featureDriftScore: num(featureDriftScore),
      sourceDriftScore: num(sourceDriftScore),
      confidenceDriftScore: num(confidenceDriftScore),
      calibrationScore: num(calibrationScore),
      executionScore: num(executionScore),
      dataScore: num(dataScore),
      performanceScore: num(performanceScore),
      averageCandidateConfidence: num(average(candidates.map((item) => item.confidence || 0))),
      reasons,
      blockerReasons
    };
  }
}


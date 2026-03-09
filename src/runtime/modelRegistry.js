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

  buildRegistry({ snapshots = [], report = null, researchRegistry = null, calibration = null, deployment = null, nowIso = new Date().toISOString() } = {}) {
    const entries = snapshots
      .map((snapshot) => mapSnapshot(snapshot, this.config))
      .sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime())
      .slice(0, this.config.modelRegistryMaxEntries || 12);
    const bestRollback = this.chooseRollback(snapshots);
    const latest = entries[0] || null;
    const promotionHint = researchRegistry?.governance?.promotionCandidates?.[0] || null;
    const currentQuality = latest ? latest.qualityScore : scoreSnapshot({
      realizedPnl: report?.windows?.allTime?.realizedPnl || report?.realizedPnl || 0,
      winRate: report?.windows?.allTime?.winRate || report?.winRate || 0,
      maxDrawdownPct: report?.maxDrawdownPct || 0,
      calibrationEce: calibration?.expectedCalibrationError || 0,
      averageSharpe: researchRegistry?.leaderboard?.[0]?.averageSharpe || 0
    }, this.config);

    return {
      generatedAt: nowIso,
      currentQualityScore: num(currentQuality, 4),
      latestSnapshotAt: latest?.at || null,
      latestReason: latest?.reason || null,
      latestDeployment: latest?.deploymentActive || deployment?.active || null,
      rollbackCandidate: bestRollback,
      registrySize: entries.length,
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
        promotionHint
          ? `${promotionHint.symbol} scoort als research-promotiekandidaat.`
          : "Nog geen research-promotiekandidaat in de registry."
      ]
    };
  }
}

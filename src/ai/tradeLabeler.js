import { clamp } from "../utils/math.js";

export function buildTradeOutcomeLabel(trade) {
  const mfePct = Math.max(trade.mfePct || 0, 0);
  const maePct = Math.max(Math.abs(trade.maePct || 0), 0);
  const pnlPct = trade.netPnlPct || 0;
  const executionQualityScore = clamp(trade.executionQualityScore ?? 0.5, 0, 1);
  const captureEfficiency = mfePct > 0 ? clamp(pnlPct / mfePct, -1, 1) : clamp(pnlPct * 8, -1, 1);
  const downsidePenalty = clamp(maePct * 8, 0, 1.2);
  const executionRegretScore = clamp(Math.max(0, trade.entryExecutionAttribution?.slippageDeltaBps || 0) / 8 + Math.max(0, -(trade.captureEfficiency || captureEfficiency)) * 0.15, 0, 1);
  const brokerModeWeight = (trade.brokerMode || "paper") === "live" ? 1.08 : 0.94;
  const reward = clamp(
    0.5 + pnlPct * 8 + captureEfficiency * 0.12 + executionQualityScore * 0.1 - downsidePenalty * 0.18 - executionRegretScore * 0.08,
    0,
    1
  );

  return {
    labelScore: reward,
    mfePct,
    maePct,
    captureEfficiency: clamp(captureEfficiency, -1, 1),
    executionQualityScore,
    adverseHeatScore: clamp(maePct * 10, 0, 1),
    executionRegretScore,
    brokerModeWeight
  };
}

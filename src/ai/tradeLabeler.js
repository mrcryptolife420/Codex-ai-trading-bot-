import { clamp } from "../utils/math.js";

export function buildTradeOutcomeLabel(trade) {
  const mfePct = Math.max(trade.mfePct || 0, 0);
  const maePct = Math.max(Math.abs(trade.maePct || 0), 0);
  const pnlPct = trade.netPnlPct || 0;
  const executionQualityScore = clamp(trade.executionQualityScore ?? 0.5, 0, 1);
  const captureEfficiency = mfePct > 0 ? clamp(pnlPct / mfePct, -1, 1) : clamp(pnlPct * 8, -1, 1);
  const downsidePenalty = clamp(maePct * 8, 0, 1.2);
  const reward = clamp(
    0.5 + pnlPct * 8 + captureEfficiency * 0.12 + executionQualityScore * 0.1 - downsidePenalty * 0.18,
    0,
    1
  );

  return {
    labelScore: reward,
    mfePct,
    maePct,
    captureEfficiency: clamp(captureEfficiency, -1, 1),
    executionQualityScore,
    adverseHeatScore: clamp(maePct * 10, 0, 1)
  };
}

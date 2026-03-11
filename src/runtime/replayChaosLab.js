import { evaluateStrategyStress } from "./stressLab.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function buildCandidateFromTrade(trade = {}) {
  const rationale = trade.entryRationale || {};
  return {
    riskProfile: {
      stopLossPct: rationale.stopLossPct || 0.018,
      trailingStopPct: trade.exitIntelligenceSummary?.suggestedTrailingStopPct || rationale.trailingStopPct || 0.012,
      maxHoldMinutes: rationale.maxHoldMinutes || 360
    },
    executionHints: {
      preferMaker: Boolean(trade.entryExecutionAttribution?.preferMaker),
      entryStyle: trade.entryExecutionAttribution?.entryStyle || "market"
    },
    complexityScore: Math.min(1, 0.24 + arr(rationale.checks || []).length * 0.04 + arr(rationale.blockerReasons || []).length * 0.03)
  };
}

export function buildReplayChaosSummary({
  journal = {},
  nowIso = new Date().toISOString()
} = {}) {
  const trades = arr(journal.trades || []).slice(-18);
  const blockedSetups = arr(journal.blockedSetups || []).slice(-24);
  const byStrategy = new Map();

  for (const trade of trades) {
    const id = trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown";
    if (!byStrategy.has(id)) {
      byStrategy.set(id, []);
    }
    byStrategy.get(id).push(trade);
  }

  const scenarioLeaders = [...byStrategy.entries()]
    .map(([id, relatedTrades]) => {
      const stress = evaluateStrategyStress({
        candidate: buildCandidateFromTrade(relatedTrades.at(-1) || {}),
        relatedTrades,
        nowIso
      });
      return {
        id,
        tradeCount: relatedTrades.length,
        status: stress.status || "observe",
        survivalScore: num(stress.survivalScore || 0),
        tailLossPct: num(stress.tailLossPct || 0),
        worstScenario: stress.worstScenario || null,
        monteCarlo: stress.monteCarlo || {},
        notes: [...(stress.notes || [])]
      };
    })
    .sort((left, right) => (left.survivalScore || 0) - (right.survivalScore || 0))
    .slice(0, 8);

  const replayCoverage = trades.length
    ? trades.filter((trade) => arr(trade.replayCheckpoints || []).length > 0).length / trades.length
    : 0;
  const missedWinners = blockedSetups.filter((item) => (item.counterfactualOutcome || item.outcome) === "missed_winner").length;
  const worstScenario = scenarioLeaders[0] || null;
  const status = worstScenario?.status === "blocked"
    ? "blocked"
    : worstScenario?.status === "observe"
      ? "watch"
      : trades.length
        ? "ready"
        : "warmup";

  return {
    generatedAt: nowIso,
    status,
    tradeCount: trades.length,
    blockedSetupCount: blockedSetups.length,
    replayCoverage: num(replayCoverage),
    missedWinnerCount: missedWinners,
    worstStrategy: worstScenario?.id || null,
    worstScenario: worstScenario?.worstScenario || null,
    scenarioLeaders,
    notes: [
      trades.length
        ? `${trades.length} recente trades voeden replay/chaos scoring.`
        : "Nog geen recente trades beschikbaar voor replay chaos lab.",
      blockedSetups.length
        ? `${blockedSetups.length} blocked setups blijven beschikbaar voor counterfactual replay.`
        : "Nog geen blocked setups voor extra replay-context.",
      worstScenario
        ? `${worstScenario.id} heeft nu de zwakste chaos-score via ${worstScenario.worstScenario}.`
        : "Nog geen strategy-specifieke chaos-scenario's beschikbaar."
    ]
  };
}

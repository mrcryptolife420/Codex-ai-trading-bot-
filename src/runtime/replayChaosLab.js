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

function collectScenarioTags(item = {}) {
  const tags = new Set();
  const reasons = [
    ...(item.reasons || []),
    ...(item.blockerReasons || []),
    ...(item.executionBlockers || []),
    item.reason || null,
    item.worstScenario || null
  ].filter(Boolean).join(" ").toLowerCase();

  if (/stale_book|local_book_quality|warmup_gap/.test(reasons)) {
    tags.add("stale_book");
  }
  if (/reference_venue_divergence|venue divergence|cross-venue/.test(reasons)) {
    tags.add("venue_divergence");
  }
  if (/missing_news|news/.test(reasons) && (item.newsCoverage || item.dataQuality?.missingCount || 0) > 0) {
    tags.add("missing_news");
  }
  if (/protection|protective_order|rebuild/.test(reasons) || item.protectionWarning || item.reconcileRequired) {
    tags.add("protection_rebuild_failure");
  }
  if (
    safeNumber(item.partialFillProbability) > 0 ||
    safeNumber(item.entryExecutionAttribution?.partialFillRatio) > 0 ||
    safeNumber(item.exitExecutionAttribution?.partialFillRatio) > 0 ||
    safeNumber(item.remainingQuantity) > 0
  ) {
    tags.add("partial_fill");
  }
  return [...tags];
}

export function buildReplayChaosSummary({
  journal = {},
  nowIso = new Date().toISOString()
} = {}) {
  const trades = arr(journal.trades || []).slice(-18);
  const blockedSetups = arr(journal.blockedSetups || []).slice(-24);
  const byStrategy = new Map();
  const scenarioCounts = {};

  for (const trade of trades) {
    const id = trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown";
    if (!byStrategy.has(id)) {
      byStrategy.set(id, []);
    }
    byStrategy.get(id).push(trade);
    for (const tag of collectScenarioTags(trade)) {
      scenarioCounts[tag] = (scenarioCounts[tag] || 0) + 1;
    }
  }

  for (const setup of blockedSetups) {
    for (const tag of collectScenarioTags(setup)) {
      scenarioCounts[tag] = (scenarioCounts[tag] || 0) + 1;
    }
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
  const activeScenarios = Object.entries(scenarioCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([id, count]) => ({ id, count }));
  const recommendedActions = activeScenarios.map((item) => ({
    id: item.id,
    count: item.count,
    action: item.id === "stale_book"
      ? "Controleer local-book warmup, freshness en stream gaps voordat agressieve entries terug aan mogen."
      : item.id === "venue_divergence"
        ? "Gebruik reference venues en execution budget als harde gate tot de divergente feed weer samenvalt."
        : item.id === "missing_news"
          ? "Markeer news coverage als degraded-but-allowed of observe-only afhankelijk van setup type."
          : item.id === "protection_rebuild_failure"
            ? "Forceer reconcile/protect-only tot protective rebuilds weer schoon doorlopen."
            : item.id === "partial_fill"
              ? "Replay partial-fill recovery en exit-protectie voordat size of maker-bias omhoog mag."
              : "Review dit chaos-scenario expliciet in replay voordat promotie doorgaat."
  }));
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
    activeScenarios,
    recommendedActions,
    scenarioCounts,
    scenarioLeaders,
    notes: [
      trades.length
        ? `${trades.length} recente trades voeden replay/chaos scoring.`
        : "Nog geen recente trades beschikbaar voor replay chaos lab.",
      blockedSetups.length
        ? `${blockedSetups.length} blocked setups blijven beschikbaar voor counterfactual replay.`
        : "Nog geen blocked setups voor extra replay-context.",
      activeScenarios.length
        ? `Meest zichtbare chaos-risico's: ${activeScenarios.map((item) => `${item.id} (${item.count})`).join(", ")}.`
        : "Nog geen expliciete chaos-scenario's uit recente runtime-data herkend.",
      worstScenario
        ? `${worstScenario.id} heeft nu de zwakste chaos-score via ${worstScenario.worstScenario}.`
        : "Nog geen strategy-specifieke chaos-scenario's beschikbaar."
    ]
  };
}

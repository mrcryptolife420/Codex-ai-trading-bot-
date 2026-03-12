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

function mapReplayPackTrade(trade = {}) {
  return {
    symbol: trade.symbol || null,
    strategy: trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || null,
    outcome: trade.paperLearningOutcome?.outcome || null,
    pnlQuote: num(trade.pnlQuote || 0, 2),
    netPnlPct: num(trade.netPnlPct || 0),
    reason: trade.reason || null,
    exitAt: trade.exitAt || null
  };
}

function mapReplayPackSetup(item = {}) {
  return {
    symbol: item.symbol || null,
    strategy: item.strategy || item.strategyAtEntry || item.entryRationale?.strategy?.activeStrategy || null,
    outcome: item.counterfactualOutcome || item.outcome || null,
    realizedMovePct: num(item.realizedMovePct || 0),
    blockerReasons: arr(item.blockerReasons || []).slice(0, 3)
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
  if (["bad_trade", "early_exit", "late_exit", "execution_drag"].includes(item.paperLearningOutcome?.outcome)) {
    tags.add("paper_miss");
  }
  return [...tags];
}

function buildDeterministicReplayPlan({
  status = "warmup",
  activeScenarios = [],
  replayPacks = {},
  worstScenario = null
} = {}) {
  const selectedCases = [
    ...arr(replayPacks.paperMisses || []).map((item) => ({ kind: "paper_miss", ...item })),
    ...arr(replayPacks.nearMissSetups || []).map((item) => ({ kind: "near_miss", ...item })),
    ...arr(replayPacks.probeWinners || []).map((item) => ({ kind: "probe_winner", ...item }))
  ].slice(0, 6);
  const nextPackType = arr(replayPacks.paperMisses || []).length
    ? "paper_miss_pack"
    : arr(replayPacks.nearMissSetups || []).length
      ? "near_miss_pack"
      : arr(replayPacks.probeWinners || []).length
        ? "probe_winner_pack"
        : "warmup";
  const coverageNeeds = activeScenarios
    .filter((item) => ["stale_book", "venue_divergence", "protection_rebuild_failure", "partial_fill"].includes(item.id))
    .slice(0, 4)
    .map((item) => item.id);
  return {
    status: status === "blocked" ? "priority" : selectedCases.length ? "ready" : "warmup",
    nextPackType,
    packCount: selectedCases.length,
    worstScenario,
    selectedCases,
    coverageNeeds,
    operatorGoal: nextPackType === "paper_miss_pack"
      ? "Replay eerst de zwakste paper missers en kijk of entry, exit of execution tuning moet worden aangepast."
      : nextPackType === "near_miss_pack"
        ? "Review near-miss geblokkeerde setups om te zien of governance te streng staat."
        : nextPackType === "probe_winner_pack"
          ? "Gebruik sterke probe winners als benchmark voor promotie- of threshold-probation."
          : "Nog geen replay-pack met duidelijke prioriteit beschikbaar.",
    notes: [
      selectedCases.length
        ? `${selectedCases.length} cases vormen nu een deterministische replay-pack.`
        : "Nog geen replay-pack beschikbaar voor deterministische review.",
      coverageNeeds.length
        ? `Replay moet extra letten op ${coverageNeeds.join(", ")}.`
        : "Geen extra chaos-coverage focus geselecteerd.",
      worstScenario
        ? `${worstScenario} blijft de zwakste strategy-stresscase voor replay-prioriteit.`
        : "Nog geen strategy-stressleider voor replay."
    ]
  };
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
  const paperTrades = trades.filter((trade) => (trade.brokerMode || "paper") === "paper");
  const paperMisses = paperTrades.filter((trade) => ["bad_trade", "early_exit", "late_exit", "execution_drag"].includes(trade.paperLearningOutcome?.outcome));
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
              : item.id === "paper_miss"
                ? "Gebruik deze paper-missers als replay-cases en check of entry, exit of execution tuning moet bijsturen."
              : "Review dit chaos-scenario expliciet in replay voordat promotie doorgaat."
  }));
  const replayPacks = {
    probeWinners: paperTrades
      .filter((trade) => trade.learningLane === "probe" && ["good_trade", "acceptable_trade"].includes(trade.paperLearningOutcome?.outcome))
      .sort((left, right) => (right.pnlQuote || 0) - (left.pnlQuote || 0))
      .slice(0, 4)
      .map(mapReplayPackTrade),
    paperMisses: paperMisses
      .sort((left, right) => Math.abs(right.pnlQuote || 0) - Math.abs(left.pnlQuote || 0))
      .slice(0, 4)
      .map(mapReplayPackTrade),
    nearMissSetups: blockedSetups
      .filter((item) => ["missed_winner", "bad_veto", "right_direction_wrong_timing"].includes(item.counterfactualOutcome || item.outcome))
      .sort((left, right) => (right.realizedMovePct || 0) - (left.realizedMovePct || 0))
      .slice(0, 4)
      .map(mapReplayPackSetup)
  };
  const status = worstScenario?.status === "blocked"
    ? "blocked"
    : worstScenario?.status === "observe"
      ? "watch"
      : trades.length
        ? "ready"
        : "warmup";
  const deterministicReplayPlan = buildDeterministicReplayPlan({
    status,
    activeScenarios,
    replayPacks,
    worstScenario: worstScenario?.worstScenario || null
  });

  return {
    generatedAt: nowIso,
    status,
    tradeCount: trades.length,
    blockedSetupCount: blockedSetups.length,
    replayCoverage: num(replayCoverage),
    missedWinnerCount: missedWinners,
    paperMissCount: paperMisses.length,
    worstStrategy: worstScenario?.id || null,
    worstScenario: worstScenario?.worstScenario || null,
    activeScenarios,
    recommendedActions,
    replayPacks,
    deterministicReplayPlan,
    scenarioCounts,
    scenarioLeaders,
    notes: [
      trades.length
        ? `${trades.length} recente trades voeden replay/chaos scoring.`
        : "Nog geen recente trades beschikbaar voor replay chaos lab.",
      blockedSetups.length
        ? `${blockedSetups.length} blocked setups blijven beschikbaar voor counterfactual replay.`
        : "Nog geen blocked setups voor extra replay-context.",
      paperMisses.length
        ? `${paperMisses.length} recente paper-missers zijn bruikbaar voor replay en chaos-review.`
        : "Nog geen expliciete paper-missers voor extra replay-context.",
      activeScenarios.length
        ? `Meest zichtbare chaos-risico's: ${activeScenarios.map((item) => `${item.id} (${item.count})`).join(", ")}.`
        : "Nog geen expliciete chaos-scenario's uit recente runtime-data herkend.",
      worstScenario
        ? `${worstScenario.id} heeft nu de zwakste chaos-score via ${worstScenario.worstScenario}.`
        : "Nog geen strategy-specifieke chaos-scenario's beschikbaar."
    ]
  };
}

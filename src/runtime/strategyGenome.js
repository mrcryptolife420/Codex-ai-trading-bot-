import { normalizeStrategyDsl } from "../research/strategyDsl.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function combineRules(left = [], right = []) {
  return [...left, ...right]
    .slice(0, 8)
    .map((rule, index) => ({ ...rule, id: rule.id || `rule_${index}` }));
}

function overlapRatio(left = [], right = []) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (!union.size) {
    return 0;
  }
  let shared = 0;
  for (const value of a) {
    if (b.has(value)) {
      shared += 1;
    }
  }
  return shared / union.size;
}

function buildChild(left, right, index) {
  const indicators = unique([...(left.indicators || []), ...(right.indicators || [])]).slice(0, 8);
  const child = normalizeStrategyDsl({
    id: `genome_${left.id}_${right.id}_${index}`,
    label: `${left.label || left.id} x ${right.label || right.id}`,
    family: left.family === right.family ? left.family : "hybrid",
    indicators,
    entryRules: combineRules(left.entryRules || [], right.entryRules || []).slice(0, 6),
    exitRules: combineRules(right.exitRules || [], left.exitRules || []).slice(0, 4),
    riskProfile: {
      stopLossPct: average([left.riskProfile?.stopLossPct || 0.018, right.riskProfile?.stopLossPct || 0.018], 0.018),
      takeProfitPct: average([left.riskProfile?.takeProfitPct || 0.03, right.riskProfile?.takeProfitPct || 0.03], 0.03),
      trailingStopPct: average([left.riskProfile?.trailingStopPct || 0.012, right.riskProfile?.trailingStopPct || 0.012], 0.012),
      maxHoldMinutes: Math.round(average([left.riskProfile?.maxHoldMinutes || 360, right.riskProfile?.maxHoldMinutes || 360], 360)),
      maxPyramids: Math.round(Math.min(left.riskProfile?.maxPyramids || 1, right.riskProfile?.maxPyramids || 1))
    },
    executionHints: {
      entryStyle: left.executionHints?.entryStyle || right.executionHints?.entryStyle || "market",
      preferMaker: Boolean(left.executionHints?.preferMaker || right.executionHints?.preferMaker),
      holdBias: average([left.executionHints?.holdBias || 1, right.executionHints?.holdBias || 1], 1),
      aggressiveness: average([left.executionHints?.aggressiveness || 1, right.executionHints?.aggressiveness || 1], 1)
    },
    tags: unique([...(left.metadata?.tags || []), ...(right.metadata?.tags || []), "genome"]).slice(0, 8),
    referenceStrategies: unique([left.id, right.id, ...(left.metadata?.referenceStrategies || []), ...(right.metadata?.referenceStrategies || [])]).slice(0, 6),
    source: "strategy_genome",
    sourceType: "genome"
  });
  return {
    ...child,
    genomeParentIds: [left.id, right.id],
    genomeNoveltyScore: num(1 - overlapRatio(left.indicators || [], right.indicators || [])),
    inheritedGovernanceScore: num(average([
      left.score?.overall || left.governanceScore || 0,
      right.score?.overall || right.governanceScore || 0
    ])),
    notes: [
      `${left.id} en ${right.id} delen ${Math.round(overlapRatio(left.indicators || [], right.indicators || []) * 100)}% indicator-overlap.`,
      `Kind-strategie erft ${indicators.length} indicatoren en ${Math.min((child.entryRules || []).length, 6)} entry-rules.`
    ]
  };
}

export function buildStrategyGenome({ candidates = [], nowIso = new Date().toISOString(), maxChildren = 4 } = {}) {
  const parents = candidates
    .filter((candidate) => candidate?.safety?.safe)
    .sort((left, right) => (right.score?.overall || right.governanceScore || 0) - (left.score?.overall || left.governanceScore || 0))
    .slice(0, 6);
  const children = [];
  for (let leftIndex = 0; leftIndex < parents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < parents.length && children.length < maxChildren; rightIndex += 1) {
      const left = parents[leftIndex];
      const right = parents[rightIndex];
      children.push(buildChild(left, right, children.length + 1));
    }
    if (children.length >= maxChildren) {
      break;
    }
  }
  return {
    generatedAt: nowIso,
    parentCount: parents.length,
    candidateCount: children.length,
    candidates: children,
    notes: [
      children.length
        ? `${children.length} genome-kandidaten werden afgeleid uit veilige parent-strategieen.`
        : "Nog te weinig veilige parent-strategieen voor genome-mutation."
    ]
  };
}

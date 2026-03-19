import { normalizeStrategyDsl, summarizeStrategyDsl } from "../research/strategyDsl.js";
import { evaluateStrategyStress } from "./stressLab.js";
import { buildStrategyGenome } from "./strategyGenome.js";
import { RequestBudget, maskUrl } from "../utils/requestBudget.js";
import { ExternalFeedRegistry } from "./externalFeedRegistry.js";

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, safeNumber(value)));
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function buildSeedCandidates() {
  return [
    {
      id: "seed_trend_breakout_stack",
      label: "Trend breakout stack",
      family: "trend_following",
      indicators: ["ema_gap", "trend_strength", "breakout_pct", "adx14", "book_pressure"],
      entryRules: [
        { indicator: "ema_gap", operator: "gt", threshold: 0.0012 },
        { indicator: "breakout_pct", operator: "gt", threshold: 0.0018 },
        { indicator: "adx14", operator: "gt", threshold: 23 }
      ],
      exitRules: [
        { indicator: "book_pressure", operator: "lt", threshold: -0.42 },
        { indicator: "realized_vol_pct", operator: "gt", threshold: 0.055 }
      ],
      riskProfile: { stopLossPct: 0.017, takeProfitPct: 0.032, trailingStopPct: 0.011, maxHoldMinutes: 320 },
      executionHints: { entryStyle: "pegged_limit_maker", preferMaker: true, aggressiveness: 0.92 },
      source: "native_seed",
      sourceType: "seed",
      tags: ["seed", "trend", "breakout"],
      referenceStrategies: ["ema_trend", "donchian_breakout"]
    },
    {
      id: "seed_mean_reversion_reset",
      label: "Mean reversion reset",
      family: "mean_reversion",
      indicators: ["rsi14", "stoch_rsi_k", "vwap_gap_pct", "price_zscore", "queue_imbalance"],
      entryRules: [
        { indicator: "rsi14", operator: "lt", threshold: 33 },
        { indicator: "price_zscore", operator: "lt", threshold: -1.2 },
        { indicator: "queue_imbalance", operator: "gt", threshold: -0.08 }
      ],
      exitRules: [
        { indicator: "vwap_gap_pct", operator: "gt", threshold: 0.003 },
        { indicator: "book_pressure", operator: "lt", threshold: -0.35 }
      ],
      riskProfile: { stopLossPct: 0.014, takeProfitPct: 0.024, trailingStopPct: 0.009, maxHoldMinutes: 240 },
      executionHints: { entryStyle: "limit_maker", preferMaker: true, aggressiveness: 0.88 },
      source: "native_seed",
      sourceType: "seed",
      tags: ["seed", "mean_reversion"],
      referenceStrategies: ["vwap_reversion", "zscore_reversion"]
    },
    {
      id: "seed_orderflow_dislocation",
      label: "Orderflow dislocation",
      family: "orderflow",
      indicators: ["book_pressure", "queue_imbalance", "volume_z", "funding_rate", "open_interest_change_pct"],
      entryRules: [
        { indicator: "book_pressure", operator: "gt", threshold: 0.18 },
        { indicator: "queue_imbalance", operator: "gt", threshold: 0.12 },
        { indicator: "volume_z", operator: "gt", threshold: 0.4 }
      ],
      exitRules: [
        { indicator: "queue_imbalance", operator: "lt", threshold: -0.18 },
        { indicator: "funding_rate", operator: "gt", threshold: 0.0009 }
      ],
      riskProfile: { stopLossPct: 0.016, takeProfitPct: 0.028, trailingStopPct: 0.01, maxHoldMinutes: 180 },
      executionHints: { entryStyle: "market", preferMaker: false, aggressiveness: 1.08 },
      source: "native_seed",
      sourceType: "seed",
      tags: ["seed", "orderflow"],
      referenceStrategies: ["orderbook_imbalance", "liquidity_sweep"]
    }
  ].map((item) => normalizeStrategyDsl(item));
}

function buildScorecardMap(items = []) {
  return Object.fromEntries((items || []).map((item) => [item.id || item.symbol, item]));
}

function collectRelatedTrades(journal = {}, candidate = {}) {
  const references = new Set([...(candidate.metadata?.referenceStrategies || []), candidate.family].filter(Boolean));
  return (journal.trades || []).filter((trade) => {
    const strategyId = trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy;
    const familyId = trade.strategyDecision?.family || trade.entryRationale?.strategy?.family;
    return references.has(strategyId) || references.has(familyId);
  });
}

function buildParameterDiffs(candidate = {}, config = {}) {
  return {
    stopLossPct: num((candidate.riskProfile?.stopLossPct || 0) - (config.stopLossPct || 0)),
    takeProfitPct: num((candidate.riskProfile?.takeProfitPct || 0) - (config.takeProfitPct || 0)),
    trailingStopPct: num((candidate.riskProfile?.trailingStopPct || 0) - (config.trailingStopPct || 0)),
    maxHoldMinutes: Math.round((candidate.riskProfile?.maxHoldMinutes || 0) - (config.maxHoldMinutes || 0)),
    entryStyle: candidate.executionHints?.entryStyle || "market"
  };
}

function buildPromotionStage(status = "observe", overallScore = 0) {
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "paper_candidate" && overallScore >= 0.76) {
    return "paper_probation";
  }
  if (status === "paper_candidate") {
    return "paper_candidate";
  }
  return overallScore >= 0.52 ? "observe" : "backlog";
}

export class StrategyResearchMiner {
  constructor(config, logger = console, runtime = null) {
    this.config = config;
    this.logger = logger;
    this.runtime = runtime || null;
    this.requestBudget = new RequestBudget({
      timeoutMs: 8_000,
      baseCooldownMs: 30_000,
      maxCooldownMs: 5 * 60_000,
      registry: new ExternalFeedRegistry(config),
      runtime: this.runtime,
      group: "strategy_research"
    });
  }

  setRuntime(runtime = null) {
    this.runtime = runtime || null;
    this.requestBudget.runtime = this.runtime;
  }

  async fetchWhitelistedCandidates() {
    if (!this.config.strategyResearchFetchEnabled || !(this.config.strategyResearchFeedUrls || []).length) {
      return [];
    }
    const candidates = [];
    for (const url of this.config.strategyResearchFeedUrls || []) {
      try {
        const response = await this.requestBudget.fetchJson(url, {
          key: `strategy_research:${url}`,
          runtime: this.runtime,
          headers: {
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 trading-bot"
          }
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        this.requestBudget.noteSuccess(`strategy_research:${url}`, this.runtime);
        const items = Array.isArray(payload) ? payload : Array.isArray(payload?.strategies) ? payload.strategies : [];
        candidates.push(...items.map((item) => normalizeStrategyDsl({ ...item, source: url, sourceType: "whitelisted_feed" })));
      } catch (error) {
        const failure = error.code === "REQUEST_BUDGET_COOLDOWN"
          ? { cooldownUntil: error.cooldownUntil }
          : this.requestBudget.noteFailure(`strategy_research:${url}`, Date.now(), this.runtime, error.message);
        this.logger.warn?.("Strategy research feed failed", {
          url: maskUrl(url),
          error: error.message,
          cooldownUntil: failure.cooldownUntil || null
        });
      }
    }
    return candidates;
  }

  scoreCandidate(candidate = {}, { journal = {}, researchRegistry = {}, offlineTrainer = {}, nowIso = new Date().toISOString() } = {}) {
    const normalized = candidate.dslVersion === 1 && candidate.safety ? candidate : normalizeStrategyDsl(candidate);
    const strategyScorecards = buildScorecardMap([
      ...(researchRegistry.strategyScorecards || []),
      ...(offlineTrainer.strategyScorecards || [])
    ]);
    const relatedScorecards = (normalized.metadata?.referenceStrategies || [])
      .map((id) => strategyScorecards[id])
      .filter(Boolean);
    const governanceSupport = average(relatedScorecards.map((item) => safeNumber(item.governanceScore, 0.5)), 0.5);
    const noveltyScore = normalized.metadata?.sourceType === "genome"
      ? clamp(safeNumber(normalized.genomeNoveltyScore, 0.5), 0, 1)
      : clamp(0.68 - (normalized.complexityScore || 0.2) * 0.22, 0.22, 0.88);
    const simplicityScore = clamp(1 - safeNumber(normalized.complexityScore, 0.4) * 0.55, 0.18, 1);
    const safetyScore = normalized.safety?.safe ? 1 : 0.08;
    const stress = evaluateStrategyStress({ candidate: normalized, relatedTrades: collectRelatedTrades(journal, normalized), nowIso });
    const robustnessScore = clamp(
      (stress.survivalScore || 0) * 0.68 +
        clamp(1 - Math.abs(safeNumber(stress.tailLossPct, 0)) / 0.18, 0, 1) * 0.32,
      0,
      1
    );
    const uniquenessScore = clamp(
      noveltyScore * 0.72 +
        clamp(1 - governanceSupport, 0, 1) * 0.18 +
        clamp(1 - safeNumber(normalized.complexityScore, 0.4), 0, 1) * 0.1,
      0,
      1
    );
    const overall = clamp(
      safetyScore * 0.34 +
        governanceSupport * 0.24 +
        simplicityScore * 0.14 +
        robustnessScore * 0.16 +
        uniquenessScore * 0.12,
      0,
      1
    );
    const status = !normalized.safety?.safe
      ? "blocked"
      : stress.status === "blocked"
        ? "blocked"
        : overall >= (this.config.strategyResearchPaperScoreFloor || 0.64)
          ? "paper_candidate"
          : overall >= 0.46
            ? "observe"
            : "blocked";
    const promotionStage = buildPromotionStage(status, overall);
    return {
      ...normalized,
      score: {
        overall: num(overall),
        safetyScore: num(safetyScore),
        governanceSupport: num(governanceSupport),
        simplicityScore: num(simplicityScore),
        noveltyScore: num(noveltyScore),
        stressScore: num(stress.survivalScore || 0),
        robustnessScore: num(robustnessScore),
        uniquenessScore: num(uniquenessScore)
      },
      stress,
      parameterDiffs: buildParameterDiffs(normalized, this.config),
      status,
      promotionStage,
      paperReady: status === "paper_candidate",
      notes: [
        ...(normalized.safety?.warnings || []),
        stress.notes?.[0] || "Nog geen stressnotitie beschikbaar.",
        relatedScorecards[0]
          ? `${relatedScorecards[0].id} ondersteunt deze kandidaat als dichtste referentie.`
          : "Geen directe referentiescore beschikbaar; kandidaat draait op heuristische scoring."
      ]
    };
  }

  buildSummary({ journal = {}, researchRegistry = {}, offlineTrainer = {}, importedCandidates = [], nowIso = new Date().toISOString() } = {}) {
    const seeds = buildSeedCandidates();
    const normalizedImports = importedCandidates.map((item) => item.dslVersion === 1 && item.safety ? item : normalizeStrategyDsl(item));
    const genome = buildStrategyGenome({ candidates: [...seeds, ...normalizedImports], nowIso, maxChildren: this.config.strategyGenomeMaxChildren || 4 });
    const rawCandidates = [...seeds, ...normalizedImports, ...(genome.candidates || [])];
    const uniqueCandidates = [];
    const seen = new Set();
    for (const candidate of rawCandidates) {
      const key = candidate.fingerprint || candidate.id;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      uniqueCandidates.push(candidate);
    }
    const candidates = uniqueCandidates
      .map((candidate) => this.scoreCandidate(candidate, { journal, researchRegistry, offlineTrainer, nowIso }))
      .sort((left, right) => (right.score?.overall || 0) - (left.score?.overall || 0))
      .slice(0, 16);
    const approvedCandidates = candidates.filter((item) => item.paperReady).slice(0, 6);
    const blockedCount = candidates.filter((item) => item.status === "blocked").length;
    const leader = approvedCandidates[0] || candidates[0] || null;
    return {
      generatedAt: nowIso,
      candidateCount: candidates.length,
      importedCandidateCount: normalizedImports.length,
      importedCandidates: normalizedImports.slice(0, 12).map((item) => structuredClone(item)),
      approvedCandidateCount: approvedCandidates.length,
      blockedCount,
      leader: leader ? summarizeStrategyDsl(leader) : null,
      candidates,
      approvedCandidates,
      genome: {
        parentCount: genome.parentCount || 0,
        candidateCount: genome.candidateCount || 0,
        notes: [...(genome.notes || [])]
      },
      notes: [
        approvedCandidates[0]
          ? `${approvedCandidates[0].label} is momenteel de sterkste paper-kandidaat.`
          : "Nog geen imported/genome kandidaat is sterk genoeg voor paper probation.",
        blockedCount
          ? `${blockedCount} kandidaten werden door safety of stress geblokkeerd.`
          : "Geen kandidaten werden hard geblokkeerd."
      ]
    };
  }
}

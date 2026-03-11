const SAFE_FAMILIES = new Set([
  "trend_following",
  "breakout",
  "mean_reversion",
  "market_structure",
  "orderflow",
  "derivatives",
  "hybrid"
]);

const SAFE_INDICATORS = new Set([
  "ema_gap",
  "ema_trend_score",
  "momentum_5",
  "momentum_20",
  "momentum_50",
  "rsi14",
  "stoch_rsi_k",
  "mfi14",
  "cmf20",
  "vwap_gap_pct",
  "price_zscore",
  "bollinger_squeeze_score",
  "keltner_squeeze_score",
  "squeeze_release_score",
  "donchian_breakout_pct",
  "breakout_pct",
  "atr_pct",
  "trend_strength",
  "adx14",
  "dmi_spread",
  "book_pressure",
  "queue_imbalance",
  "funding_rate",
  "open_interest_change_pct",
  "structure_break_score",
  "volume_z",
  "realized_vol_pct",
  "supertrend_distance_pct",
  "fear_greed",
  "btc_dominance",
  "stablecoin_stress"
]);

const SAFE_OPERATORS = new Set([
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "cross_up",
  "cross_down",
  "trend",
  "bias"
]);

const SAFE_ENTRY_STYLES = new Set(["market", "limit_maker", "pegged_limit_maker"]);
const BLOCKED_PATTERNS = new Set([
  "martingale",
  "average_down",
  "unlimited_pyramiding",
  "grid_without_stop",
  "external_code",
  "remote_code",
  "unbounded_leverage"
]);

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, safeNumber(value)));
}

function slugify(value, fallback = "strategy") {
  return `${value || fallback}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => `${value}`.trim()).filter(Boolean))];
}

function normalizeRule(rule = {}, index = 0, type = "entry") {
  const indicator = slugify(rule.indicator || rule.feature || `indicator_${index}`, `indicator_${index}`);
  const operator = SAFE_OPERATORS.has(rule.operator) ? rule.operator : "gt";
  const threshold = num(rule.threshold ?? rule.value ?? 0, 4);
  const lower = rule.lower == null ? null : num(rule.lower, 4);
  const upper = rule.upper == null ? null : num(rule.upper, 4);
  return {
    id: slugify(rule.id || `${type}_${indicator}_${index}`),
    indicator,
    operator,
    threshold,
    lower,
    upper,
    lookbackCandles: Math.max(1, Math.round(safeNumber(rule.lookbackCandles, 1))),
    rationale: rule.rationale || null
  };
}

function normalizeRiskProfile(profile = {}) {
  const stopLossPct = clamp(profile.stopLossPct ?? 0.018, 0.002, 0.12);
  const takeProfitPct = clamp(profile.takeProfitPct ?? Math.max(stopLossPct * 1.7, 0.024), 0.004, 0.4);
  const trailingStopPct = clamp(profile.trailingStopPct ?? Math.max(stopLossPct * 0.72, 0.008), 0.002, 0.08);
  const maxHoldMinutes = Math.max(5, Math.round(safeNumber(profile.maxHoldMinutes, 360)));
  const maxPyramids = Math.max(0, Math.round(safeNumber(profile.maxPyramids, 1)));
  return {
    stopLossPct: num(stopLossPct),
    takeProfitPct: num(takeProfitPct),
    trailingStopPct: num(trailingStopPct),
    maxHoldMinutes,
    maxPyramids,
    allowAverageDown: Boolean(profile.allowAverageDown),
    allowMartingale: Boolean(profile.allowMartingale),
    leverage: num(Math.max(1, safeNumber(profile.leverage, 1)), 3)
  };
}

function normalizeExecutionHints(hints = {}) {
  const entryStyle = SAFE_ENTRY_STYLES.has(hints.entryStyle) ? hints.entryStyle : "market";
  return {
    entryStyle,
    preferMaker: Boolean(hints.preferMaker || entryStyle !== "market"),
    fallbackStyle: hints.fallbackStyle || (entryStyle === "market" ? "none" : "cancel_replace_market"),
    holdBias: num(clamp(hints.holdBias ?? 1, 0.75, 1.35)),
    aggressiveness: num(clamp(hints.aggressiveness ?? 1, 0.75, 1.35)),
    maxSpreadBps: num(Math.max(1, safeNumber(hints.maxSpreadBps, 24)), 2)
  };
}

function buildComplexityScore({ indicators = [], entryRules = [], exitRules = [] } = {}) {
  return num(clamp(
    indicators.length * 0.08 +
      entryRules.length * 0.1 +
      exitRules.length * 0.07,
    0.1,
    1
  ));
}

export function buildStrategyDslFingerprint(strategy = {}) {
  const segments = [
    strategy.family || "hybrid",
    ...(strategy.indicators || []),
    ...(strategy.entryRules || []).map((rule) => `${rule.indicator}:${rule.operator}`),
    ...(strategy.exitRules || []).map((rule) => `${rule.indicator}:${rule.operator}`)
  ];
  return uniqueStrings(segments).join("|");
}

export function normalizeStrategyDsl(candidate = {}) {
  const family = SAFE_FAMILIES.has(candidate.family) ? candidate.family : "hybrid";
  const indicators = uniqueStrings(candidate.indicators || []).map((value) => slugify(value));
  const entryRules = (Array.isArray(candidate.entryRules) ? candidate.entryRules : [])
    .slice(0, 8)
    .map((rule, index) => normalizeRule(rule, index, "entry"));
  const exitRules = (Array.isArray(candidate.exitRules) ? candidate.exitRules : [])
    .slice(0, 6)
    .map((rule, index) => normalizeRule(rule, index, "exit"));
  const riskProfile = normalizeRiskProfile(candidate.riskProfile || {});
  const executionHints = normalizeExecutionHints(candidate.executionHints || {});
  const metadata = {
    source: candidate.source || "manual",
    sourceType: candidate.sourceType || "manual_import",
    importedAt: candidate.importedAt || null,
    author: candidate.author || null,
    url: candidate.url || null,
    tags: uniqueStrings(candidate.tags || []).slice(0, 8),
    referenceStrategies: uniqueStrings(candidate.referenceStrategies || []).slice(0, 6)
  };
  const normalized = {
    dslVersion: 1,
    id: slugify(candidate.id || candidate.label || candidate.name || "strategy_import"),
    label: candidate.label || candidate.name || "Imported strategy",
    family,
    indicators,
    entryRules,
    exitRules,
    riskProfile,
    executionHints,
    metadata
  };
  const safety = validateStrategyDsl(normalized);
  return {
    ...normalized,
    complexityScore: buildComplexityScore(normalized),
    fingerprint: buildStrategyDslFingerprint(normalized),
    safety
  };
}

export function validateStrategyDsl(candidate = {}) {
  const blockedReasons = [];
  const warnings = [];
  const indicators = uniqueStrings(candidate.indicators || []).map((value) => slugify(value));
  const entryRules = Array.isArray(candidate.entryRules) ? candidate.entryRules : [];
  const exitRules = Array.isArray(candidate.exitRules) ? candidate.exitRules : [];
  const profile = normalizeRiskProfile(candidate.riskProfile || {});
  const executionHints = normalizeExecutionHints(candidate.executionHints || {});

  if (!SAFE_FAMILIES.has(candidate.family || "")) {
    blockedReasons.push("unsupported_family");
  }
  if (!indicators.length) {
    blockedReasons.push("missing_indicators");
  }
  if (!entryRules.length) {
    blockedReasons.push("missing_entry_rules");
  }
  if (profile.stopLossPct <= 0 || profile.stopLossPct >= profile.takeProfitPct) {
    blockedReasons.push("invalid_risk_profile");
  }
  if (profile.maxPyramids > 2) {
    blockedReasons.push("unlimited_pyramiding");
  }
  if (profile.allowAverageDown) {
    blockedReasons.push("average_down");
  }
  if (profile.allowMartingale) {
    blockedReasons.push("martingale");
  }
  if (profile.leverage > 1.2) {
    blockedReasons.push("unbounded_leverage");
  }
  for (const indicator of indicators) {
    if (!SAFE_INDICATORS.has(indicator)) {
      warnings.push(`Indicator ${indicator} is onbekend voor de veilige DSL en krijgt geen automatische scoreboost.`);
    }
  }
  for (const rule of [...entryRules, ...exitRules]) {
    if (!SAFE_OPERATORS.has(rule.operator || "")) {
      blockedReasons.push("unsupported_operator");
      break;
    }
  }
  if (!SAFE_ENTRY_STYLES.has(executionHints.entryStyle)) {
    blockedReasons.push("unsupported_execution_style");
  }
  for (const tag of uniqueStrings(candidate.metadata?.tags || [])) {
    if (BLOCKED_PATTERNS.has(slugify(tag))) {
      blockedReasons.push(slugify(tag));
    }
  }
  if (!exitRules.length) {
    warnings.push("Geen expliciete exit-rules opgegeven; runtime gebruikt dan alleen generieke stops.");
  }

  return {
    safe: blockedReasons.length === 0,
    blockedReasons: uniqueStrings(blockedReasons),
    warnings,
    indicatorCount: indicators.length,
    entryRuleCount: entryRules.length,
    exitRuleCount: exitRules.length,
    complexityScore: buildComplexityScore({ indicators, entryRules, exitRules })
  };
}

export function summarizeStrategyDsl(candidate = {}) {
  const normalized = candidate.dslVersion === 1 && candidate.safety
    ? candidate
    : normalizeStrategyDsl(candidate);
  return {
    id: normalized.id,
    label: normalized.label,
    family: normalized.family,
    source: normalized.metadata?.source || "manual",
    sourceType: normalized.metadata?.sourceType || "manual_import",
    indicatorCount: normalized.safety?.indicatorCount || normalized.indicators?.length || 0,
    entryRuleCount: normalized.safety?.entryRuleCount || normalized.entryRules?.length || 0,
    exitRuleCount: normalized.safety?.exitRuleCount || normalized.exitRules?.length || 0,
    complexityScore: normalized.complexityScore || normalized.safety?.complexityScore || 0,
    safe: Boolean(normalized.safety?.safe),
    blockedReasons: [...(normalized.safety?.blockedReasons || [])],
    warnings: [...(normalized.safety?.warnings || [])],
    executionStyle: normalized.executionHints?.entryStyle || "market",
    stopLossPct: normalized.riskProfile?.stopLossPct || null,
    takeProfitPct: normalized.riskProfile?.takeProfitPct || null,
    maxHoldMinutes: normalized.riskProfile?.maxHoldMinutes || null,
    fingerprint: normalized.fingerprint || buildStrategyDslFingerprint(normalized),
    tags: [...(normalized.metadata?.tags || [])].slice(0, 6)
  };
}

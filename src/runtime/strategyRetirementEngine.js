import { clamp } from "../utils/math.js";

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

function buildStatusTriggers({
  provisionalStatus = "active",
  governanceScore = 0,
  cooldownFloor = 0.47,
  retireFloor = 0.33,
  negativePnl = false,
  falseNegativeHeavy = false,
  falsePositiveHeavy = false,
  lowReview = false,
  hasCooldownHint = false
} = {}) {
  const triggers = [];
  if (provisionalStatus === "retire") {
    if (governanceScore <= retireFloor) {
      triggers.push("governance_score_below_retire_floor");
    }
    if (negativePnl && falsePositiveHeavy && lowReview) {
      triggers.push("negative_pnl_false_positive_bias_low_review");
    }
    return triggers;
  }
  if (provisionalStatus === "cooldown") {
    if (governanceScore <= cooldownFloor) {
      triggers.push("governance_score_below_cooldown_floor");
    }
    if (hasCooldownHint) {
      triggers.push("offline_trainer_cooldown_hint");
    }
    if (negativePnl) {
      triggers.push("negative_realized_pnl");
    }
    if (falseNegativeHeavy) {
      triggers.push("false_negative_rate_high");
    }
  }
  return triggers;
}

function buildPolicyNote({
  stale = false,
  status = "active",
  triggers = [],
  policy = {},
  cooldownFloor = 0.47,
  retireFloor = 0.33
} = {}) {
  if (stale) {
    return "Historische strategy-governance is stale; cooldown telt nu alleen nog als observatie.";
  }
  if (status === "retire") {
    if (triggers.includes("negative_pnl_false_positive_bias_low_review")) {
      return `Retire actief: realized PnL ${num(policy.realizedPnl, 2)} met false-positive rate ${num(policy.falsePositiveRate)} en reviewscore ${num(policy.avgReviewScore)}.`;
    }
    if (triggers.includes("governance_score_below_retire_floor")) {
      return `Retire actief: governance ${num(average(policy.governanceScores, 0), 4)} ligt onder retire-floor ${num(retireFloor, 2)}.`;
    }
    return "Governance score zakte te ver weg voor nieuwe allocatie.";
  }
  if (status === "cooldown") {
    const details = [];
    if (triggers.includes("governance_score_below_cooldown_floor")) {
      details.push(`governance ${num(average(policy.governanceScores, 0), 4)} < ${num(cooldownFloor, 2)}`);
    }
    if (triggers.includes("negative_realized_pnl")) {
      details.push(`realized PnL ${num(policy.realizedPnl, 2)}`);
    }
    if (triggers.includes("false_negative_rate_high")) {
      details.push(`false-negative rate ${num(policy.falseNegativeRate)}`);
    }
    if (triggers.includes("offline_trainer_cooldown_hint")) {
      details.push("offline trainer hint cooldown");
    }
    return details.length
      ? `Cooldown actief: ${details.join(" | ")}.`
      : "Strategie blijft actief maar met lagere prioriteit.";
  }
  return policy.noteSeeds?.[0] || "Geen retirement-actie nodig.";
}

function buildLatestTradeMap(journal = {}) {
  const latest = new Map();
  for (const trade of arr(journal.trades || [])) {
    const strategyId = trade.strategyAtEntry || trade.strategyDecision?.activeStrategy || trade.entryRationale?.strategy?.activeStrategy || "unknown";
    const tradeAt = trade.exitAt || trade.entryAt || null;
    const tradeMs = new Date(tradeAt || 0).getTime();
    if (!Number.isFinite(tradeMs)) {
      continue;
    }
    const previousMs = latest.get(strategyId)?.tradeMs || 0;
    if (tradeMs > previousMs) {
      latest.set(strategyId, { tradeAt, tradeMs });
    }
  }
  return latest;
}

export function buildStrategyRetirementSnapshot({
  report = {},
  offlineTrainer = {},
  journal = {},
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const policies = new Map();
  const minTrades = safeNumber(config.strategyRetirementMinTrades, 4);
  const cooldownFloor = safeNumber(config.strategyRetirementGovernanceCooldown, 0.47);
  const retireFloor = safeNumber(config.strategyRetirementGovernanceRetire, 0.33);
  const retirementMaxIdleHours = safeNumber(config.strategyRetirementMaxIdleHours, 120);
  const nowMs = new Date(nowIso).getTime();
  const latestTradeMap = buildLatestTradeMap(journal);

  const getPolicy = (id) => {
    const key = id || "unknown";
    if (!policies.has(key)) {
      policies.set(key, {
        id: key,
        tradeCount: 0,
        realizedPnl: 0,
        winRate: 0,
        avgReviewScore: 0,
        avgPnlPct: 0,
        governanceScores: [],
        falsePositiveRate: 0,
        falseNegativeRate: 0,
        statusHints: [],
        noteSeeds: []
      });
    }
    return policies.get(key);
  };

  for (const item of arr(report.tradeQualityReview?.strategyScorecards || [])) {
    const policy = getPolicy(item.id);
    policy.tradeCount = Math.max(policy.tradeCount, item.tradeCount || 0);
    policy.realizedPnl = item.realizedPnl || policy.realizedPnl;
    policy.winRate = item.winRate || policy.winRate;
    policy.avgReviewScore = item.avgReviewScore || policy.avgReviewScore;
    policy.governanceScores.push(item.governanceScore || 0);
    if ((item.falseNegativeCount || 0) > 0) {
      policy.noteSeeds.push(`${item.falseNegativeCount} missed winner(s) in recent quality review.`);
    }
  }

  for (const item of arr(offlineTrainer.strategyScorecards || [])) {
    const policy = getPolicy(item.id);
    policy.tradeCount = Math.max(policy.tradeCount, item.tradeCount || 0);
    policy.realizedPnl = safeNumber(policy.realizedPnl, item.realizedPnl || 0) || (item.realizedPnl || 0);
    policy.winRate = Math.max(policy.winRate, item.winRate || 0);
    policy.avgPnlPct = item.avgMovePct || policy.avgPnlPct;
    policy.falsePositiveRate = Math.max(policy.falsePositiveRate, item.falsePositiveRate || 0);
    policy.falseNegativeRate = Math.max(policy.falseNegativeRate, item.falseNegativeRate || 0);
    policy.governanceScores.push(item.governanceScore || 0);
    policy.statusHints.push(item.status || "observe");
    if ((item.falsePositiveCount || 0) > 0) {
      policy.noteSeeds.push(`${item.falsePositiveCount} false positive(s) drukken de governance score.`);
    }
  }

  for (const item of arr(report.attribution?.strategies || [])) {
    const policy = getPolicy(item.id);
    policy.tradeCount = Math.max(policy.tradeCount, item.tradeCount || 0);
    policy.realizedPnl = safeNumber(item.realizedPnl, policy.realizedPnl);
    policy.winRate = Math.max(policy.winRate, item.winRate || 0);
    policy.avgPnlPct = item.averagePnlPct || policy.avgPnlPct;
  }

  for (const trade of arr(journal.trades || []).slice(-24)) {
    const policy = getPolicy(trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown");
    if ((trade.pnlQuote || 0) < 0) {
      policy.noteSeeds.push(`${trade.symbol} sloot recent negatief.`);
    }
  }

  const entries = [...policies.values()]
    .map((policy) => {
      const latestTrade = latestTradeMap.get(policy.id) || null;
      const lastTradeAgeHours = latestTrade && Number.isFinite(nowMs)
        ? (nowMs - latestTrade.tradeMs) / 3_600_000
        : null;
      const stale = Number.isFinite(lastTradeAgeHours) && lastTradeAgeHours > retirementMaxIdleHours;
      const governanceScore = average(policy.governanceScores, policy.tradeCount >= minTrades ? 0.5 : 0.42);
      const negativePnl = (policy.realizedPnl || 0) < 0;
      const lowReview = (policy.avgReviewScore || 0) > 0 ? (policy.avgReviewScore || 0) < 0.45 : false;
      const falsePositiveHeavy = (policy.falsePositiveRate || 0) >= 0.34;
      const falseNegativeHeavy = (policy.falseNegativeRate || 0) >= 0.28;
      const hasCooldownHint = policy.statusHints.includes("cooldown");
      const hasWarmupOnly = policy.tradeCount < minTrades;
      const provisionalStatus = hasWarmupOnly
        ? "observe"
        : governanceScore <= retireFloor || (negativePnl && falsePositiveHeavy && lowReview)
          ? "retire"
          : governanceScore <= cooldownFloor || hasCooldownHint || falseNegativeHeavy
            ? "cooldown"
            : "active";
      const statusTriggers = buildStatusTriggers({
        provisionalStatus,
        governanceScore,
        cooldownFloor,
        retireFloor,
        negativePnl,
        falseNegativeHeavy,
        falsePositiveHeavy,
        lowReview,
        hasCooldownHint
      });
      const status = stale && ["cooldown", "retire"].includes(provisionalStatus)
        ? "observe"
        : provisionalStatus;
      const sizeMultiplier = status === "retire" ? 0 : status === "cooldown" ? 0.72 : 1;
      const confidence = clamp(0.34 + Math.min(policy.tradeCount, 10) * 0.05, 0.34, 0.94);
      return {
        id: policy.id,
        tradeCount: policy.tradeCount,
        realizedPnl: num(policy.realizedPnl, 2),
        winRate: num(policy.winRate),
        avgReviewScore: num(policy.avgReviewScore),
        avgPnlPct: num(policy.avgPnlPct),
        governanceScore: num(governanceScore),
        falsePositiveRate: num(policy.falsePositiveRate),
        falseNegativeRate: num(policy.falseNegativeRate),
        confidence: num(confidence),
        stale,
        latestTradeAt: latestTrade?.tradeAt || null,
        lastTradeAgeHours: Number.isFinite(lastTradeAgeHours) ? num(lastTradeAgeHours, 1) : null,
        status,
        statusTriggers,
        sizeMultiplier: num(sizeMultiplier, 3),
        note: buildPolicyNote({
          stale,
          status,
          triggers: statusTriggers,
          policy,
          cooldownFloor,
          retireFloor
        })
      };
    })
    .sort((left, right) => {
      const severity = { retire: 0, cooldown: 1, observe: 2, active: 3 };
      const severityDelta = (severity[left.status] || 9) - (severity[right.status] || 9);
      return severityDelta !== 0 ? severityDelta : (left.governanceScore || 0) - (right.governanceScore || 0);
    });

  const retireCount = entries.filter((item) => item.status === "retire").length;
  const cooldownCount = entries.filter((item) => item.status === "cooldown").length;
  const activeCount = entries.filter((item) => item.status === "active").length;

  return {
    generatedAt: nowIso,
    status: retireCount
      ? "blocked"
      : cooldownCount
        ? "watch"
        : entries.length
          ? "ready"
          : "warmup",
    retireCount,
    cooldownCount,
    activeCount,
    policies: entries.slice(0, 12),
    blockedStrategies: entries.filter((item) => item.status === "retire").map((item) => item.id),
    cooldownStrategies: entries.filter((item) => item.status === "cooldown").map((item) => item.id),
    notes: [
      retireCount
        ? `${retireCount} strategie(en) zijn tijdelijk uit roulatie gehaald.`
        : "Geen strategie staat momenteel op retire.",
      cooldownCount
        ? `${cooldownCount} strategie(en) draaien in cooldown met lagere allocatie.`
        : "Geen actieve strategy cooldowns gedetecteerd.",
      activeCount
        ? `${activeCount} strategie(en) blijven inzetbaar volgens governance.`
        : "Nog geen duidelijke active strategy pool zichtbaar."
    ]
  };
}

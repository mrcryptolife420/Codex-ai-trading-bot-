import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function average(values = [], fallback = 0) {
  const filtered = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((total, value) => total + value, 0) / filtered.length : fallback;
}

function correlation(values = [], outcomes = []) {
  if (!values.length || values.length !== outcomes.length) {
    return 0;
  }
  const meanX = average(values);
  const meanY = average(outcomes);
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;
  for (let index = 0; index < values.length; index += 1) {
    const x = values[index] - meanX;
    const y = outcomes[index] - meanY;
    numerator += x * y;
    denominatorX += x * x;
    denominatorY += y * y;
  }
  const denominator = Math.sqrt(denominatorX * denominatorY);
  return denominator > 0 ? numerator / denominator : 0;
}

export function featureGroup(name = "") {
  if (name.includes("cvd")) {
    return "orderflow";
  }
  if (name.includes("liquidation") || name.includes("open_interest") || name.includes("funding")) {
    return "derivatives";
  }
  if (name.includes("fvg") || name.includes("bos") || name.includes("swing_")) {
    return "market_structure";
  }
  if (name.includes("range") || name.includes("grid")) {
    return "range_execution";
  }
  if (name.includes("execution") || name.includes("book_") || name.includes("queue_") || name.includes("spread") || name.includes("depth_") || name.includes("microprice")) {
    return "execution";
  }
  if (name.includes("vol") || name.includes("atr") || name.includes("squeeze")) {
    return "volatility";
  }
  if (name.includes("volume") || name === "cmf" || name === "mfi_centered" || name === "obv_slope") {
    return "volume";
  }
  if (name.includes("regime_")) {
    return "regime";
  }
  if (name.includes("structure") || name.includes("vwap") || name.includes("liquidity_sweep") || name.includes("trend_failure")) {
    return "market_structure";
  }
  if (name.includes("momentum") || name.includes("rsi") || name.includes("stoch") || name.includes("macd")) {
    return "momentum";
  }
  if (name.includes("trend") || name.includes("ema") || name.includes("adx") || name.includes("dmi") || name.includes("supertrend")) {
    return "trend";
  }
  if (name.includes("risk") || name.includes("calendar") || name.includes("pair_") || name.includes("portfolio_")) {
    return "risk";
  }
  return "context";
}

function featureTier(name = "") {
  return name.includes("_composite") ? "composite" : "atomic";
}

export function buildSampleConfidence(count = 0, baseline = 8) {
  return clamp(count / Math.max(baseline * 2, 1), 0, 1);
}

export function isSupportFeature(name = "", group = "") {
  if (["context", "regime", "risk"].includes(group)) {
    return true;
  }
  return (
    name.includes("calendar_") ||
    name.includes("social_") ||
    name.includes("source_") ||
    name.includes("portfolio_") ||
    name.includes("stablecoin_") ||
    name.includes("btc_dominance") ||
    name.includes("feature_completeness") ||
    name.includes("tf_alignment") ||
    name.includes("onchain_") ||
    name.includes("atr_") ||
    name.includes("compression")
  );
}

function classifyRegistryStatus({ predictiveScore = 0, parityStatus = "aligned", activationRate = 0, redundancyScore = 0, tier = "atomic" } = {}) {
  if (tier === "composite" && predictiveScore >= 0.14 && parityStatus !== "misaligned") {
    return "active";
  }
  if (predictiveScore <= 0.07 && activationRate >= 0.6) {
    return "drop_candidate";
  }
  if (parityStatus === "misaligned") {
    return "guard_only";
  }
  if (redundancyScore >= 0.78 && predictiveScore <= 0.14) {
    return "shadow";
  }
  return predictiveScore >= 0.14 ? "active" : predictiveScore >= 0.09 ? "observe" : "shadow";
}

function normalizeOutcome(trade = {}) {
  if (Number.isFinite(trade.labelScore)) {
    return clamp(trade.labelScore, 0, 1);
  }
  return clamp(0.5 + (trade.netPnlPct || 0) * 12, 0, 1);
}

function buildFeatureBuckets(trades = []) {
  const buckets = new Map();
  for (const trade of trades) {
    const outcome = normalizeOutcome(trade);
    for (const [name, value] of Object.entries(trade.rawFeatures || {})) {
      if (!Number.isFinite(value)) {
        continue;
      }
      if (!buckets.has(name)) {
        buckets.set(name, {
          id: name,
          values: [],
          outcomes: [],
          absValues: [],
          positiveOutcomes: [],
          negativeOutcomes: []
        });
      }
      const bucket = buckets.get(name);
      bucket.values.push(value);
      bucket.outcomes.push(outcome);
      bucket.absValues.push(Math.abs(value));
      if (value >= 0) {
        bucket.positiveOutcomes.push(outcome);
      } else {
        bucket.negativeOutcomes.push(outcome);
      }
    }
  }
  return buckets;
}

export function buildFeatureAttribution(trades = [], { minTrades = 6 } = {}) {
  const scorecards = [...buildFeatureBuckets(trades).values()]
    .filter((bucket) => bucket.values.length >= minTrades)
    .map((bucket) => {
      const signedEdge = correlation(bucket.values, bucket.outcomes);
      const predictiveScore = Math.abs(signedEdge);
      const avgAbsValue = average(bucket.absValues);
      const activationRate = average(bucket.absValues.map((value) => (value >= 0.35 ? 1 : 0)));
      const group = featureGroup(bucket.id);
      const supportFeature = isSupportFeature(bucket.id, group);
      const sampleConfidence = buildSampleConfidence(bucket.values.length, minTrades);
      const positiveCount = bucket.positiveOutcomes.length;
      const negativeCount = bucket.negativeOutcomes.length;
      const signBalance = clamp(
        Math.min(positiveCount, negativeCount) / Math.max(Math.max(positiveCount, negativeCount), 1),
        0,
        1
      );
      const positiveOutcomeScore = average(bucket.positiveOutcomes, 0.5);
      const negativeOutcomeScore = average(bucket.negativeOutcomes, 0.5);
      const polaritySeparation = Math.abs(positiveOutcomeScore - negativeOutcomeScore);
      const evidenceConfidence = clamp(
        sampleConfidence * 0.62 +
          Math.min(1, predictiveScore / 0.18) * 0.38,
        0,
        1
      );
      const inverseActionability = signedEdge < 0
        ? clamp(
          evidenceConfidence * 0.46 +
            Math.min(1, polaritySeparation / 0.2) * 0.28 +
            signBalance * 0.18 +
            Math.min(1, activationRate / 0.55) * 0.08,
          0,
          1
        )
        : 0;
      return {
        id: bucket.id,
        group,
        tier: featureTier(bucket.id),
        tradeCount: bucket.values.length,
        supportFeature,
        sampleConfidence: num(sampleConfidence),
        evidenceConfidence: num(evidenceConfidence),
        signedEdge: num(signedEdge),
        predictiveScore: num(predictiveScore),
        activationRate: num(activationRate),
        avgAbsValue: num(avgAbsValue),
        signBalance: num(signBalance),
        positiveOutcomeScore: num(positiveOutcomeScore),
        negativeOutcomeScore: num(negativeOutcomeScore),
        polaritySeparation: num(polaritySeparation),
        inverseActionability: num(inverseActionability),
        influenceScore: num(Math.abs(signedEdge) * Math.max(avgAbsValue, 0.1)),
        edgeType: signedEdge >= 0 ? "pro" : "inverse"
      };
    })
    .sort((left, right) => (right.influenceScore || 0) - (left.influenceScore || 0));

  const topNegative = scorecards
    .filter((item) => item.signedEdge < 0)
    .sort((left, right) => (right.inverseActionability || 0) - (left.inverseActionability || 0) || (right.influenceScore || 0) - (left.influenceScore || 0))
    .slice(0, 8);

  return {
    trackedFeatureCount: scorecards.length,
    scorecards,
    topPositive: scorecards.filter((item) => item.signedEdge > 0).slice(0, 8),
    topNegative,
    notes: [
      scorecards[0]
        ? `${scorecards[0].id} draagt momenteel het sterkst bij aan gerealiseerde uitkomsten.`
        : "Nog niet genoeg trades voor betrouwbare feature-attribution.",
      topNegative[0]
        ? `${topNegative[0].id} werkt momenteel vooral als risicosignaal of veto-feature.`
        : "Nog geen duidelijke inverse feature-leider zichtbaar."
    ]
  };
}

export function buildFeatureParityAudit({
  paperTrades = [],
  liveTrades = [],
  featureScorecards = [],
  minPaperTrades = 8,
  minLiveTrades = 6
} = {}) {
  const paperTradeCount = Array.isArray(paperTrades) ? paperTrades.length : 0;
  const liveTradeCount = Array.isArray(liveTrades) ? liveTrades.length : 0;
  const paperSampleReady = paperTradeCount >= minPaperTrades;
  const liveSampleReady = liveTradeCount >= minLiveTrades;
  const sampleReady = paperSampleReady && liveSampleReady;
  const sampleConfidence = clamp(
    Math.min(1, paperTradeCount / Math.max(minPaperTrades, 1)) * 0.45 +
      Math.min(1, liveTradeCount / Math.max(minLiveTrades, 1)) * 0.55,
    0,
    1
  );
  const union = new Set();
  for (const trade of [...paperTrades, ...liveTrades]) {
    for (const name of Object.keys(trade.rawFeatures || {})) {
      union.add(name);
    }
  }
  const predictiveMap = new Map((featureScorecards || []).map((item) => [item.id, item]));
  const details = [...union]
    .map((name) => {
      const paperValues = paperTrades.map((trade) => trade.rawFeatures?.[name]).filter(Number.isFinite);
      const liveValues = liveTrades.map((trade) => trade.rawFeatures?.[name]).filter(Number.isFinite);
      const paperCoverage = paperTrades.length ? paperValues.length / paperTrades.length : 0;
      const liveCoverage = liveTrades.length ? liveValues.length / liveTrades.length : 0;
      const coverageGap = Math.abs(paperCoverage - liveCoverage);
      const avgPaperAbs = average(paperValues.map((value) => Math.abs(value)));
      const avgLiveAbs = average(liveValues.map((value) => Math.abs(value)));
      const magnitudeGap = Math.abs(avgPaperAbs - avgLiveAbs);
      const status = !sampleReady
        ? "warmup"
        : coverageGap >= 0.35 || (liveTradeCount && !liveValues.length && paperValues.length)
          ? "misaligned"
          : coverageGap >= 0.18 || magnitudeGap >= 0.45
            ? "watch"
            : "aligned";
      return {
        id: name,
        group: featureGroup(name),
        tier: featureTier(name),
        status,
        paperCoverage: num(paperCoverage),
        liveCoverage: num(liveCoverage),
        coverageGap: num(coverageGap),
        avgPaperAbs: num(avgPaperAbs),
        avgLiveAbs: num(avgLiveAbs),
        magnitudeGap: num(magnitudeGap),
        predictiveScore: predictiveMap.get(name)?.predictiveScore || 0
      };
    })
    .sort((left, right) => {
      const leftSeverity = (left.status === "misaligned" ? 2 : left.status === "watch" ? 1 : 0);
      const rightSeverity = (right.status === "misaligned" ? 2 : right.status === "watch" ? 1 : 0);
      return rightSeverity - leftSeverity || (right.coverageGap || 0) - (left.coverageGap || 0);
    });

  const misaligned = details.filter((item) => item.status === "misaligned");
  const watch = details.filter((item) => item.status === "watch");
  return {
    status: !sampleReady
      ? "warmup"
      : misaligned.length
        ? "misaligned"
        : watch.length
          ? "watch"
          : "aligned",
    sampleReady,
    sampleConfidence: num(sampleConfidence),
    paperTradeCount,
    liveTradeCount,
    minPaperTrades,
    minLiveTrades,
    trackedFeatureCount: details.length,
    alignedCount: details.filter((item) => item.status === "aligned").length,
    watchCount: watch.length,
    misalignedCount: misaligned.length,
    missingInLive: sampleReady
      ? misaligned.filter((item) => item.paperCoverage > 0 && item.liveCoverage === 0).slice(0, 8).map((item) => item.id)
      : [],
    details: details.slice(0, 20),
    notes: [
      !sampleReady
        ? `Feature parity warmt nog op (${paperTradeCount} paper / ${liveTradeCount} live trades).`
        : misaligned[0]
          ? `${misaligned[0].id} wijkt momenteel het sterkst af tussen paper en live feature-beschikbaarheid.`
          : "Paper/live feature parity oogt momenteel gezond.",
      watch[0]
        ? `${watch[0].id} verdient extra parity-monitoring.`
        : !sampleReady
          ? "Nog te weinig live sample voor harde parity-conclusies."
          : "Geen duidelijke parity-watchers in de huidige feature set."
    ]
  };
}

export function buildFeaturePruningPlan({
  attribution = {},
  parityAudit = {},
  featureScorecards = []
} = {}) {
  const parityMap = new Map((parityAudit.details || []).map((item) => [item.id, item]));
  const scorecardMap = new Map((featureScorecards || []).map((item) => [item.id, item]));
  const groupLeaders = new Map();
  for (const item of attribution.scorecards || []) {
    const key = `${item.group}:${item.tier}`;
    const current = groupLeaders.get(key);
    if (!current || (item.influenceScore || 0) > (current.influenceScore || 0)) {
      groupLeaders.set(key, item);
    }
  }

  const recommendations = (attribution.scorecards || []).map((item) => {
    const parity = parityMap.get(item.id) || {};
    const decay = scorecardMap.get(item.id) || {};
    const groupLeader = groupLeaders.get(`${item.group}:${item.tier}`) || null;
    const redundancyScore = groupLeader && groupLeader.id !== item.id && item.group === groupLeader.group
      ? clamp((groupLeader.influenceScore || 0) > 0 ? (item.influenceScore || 0) / (groupLeader.influenceScore || 1) : 0, 0, 1)
      : 0;
    const inverseActionability = item.inverseActionability || 0;
    const predictiveScore = item.predictiveScore || decay.predictiveScore || 0;
    const inverseDropCandidate = item.edgeType === "inverse" &&
      inverseActionability >= 0.44 &&
      (item.activationRate || 0) >= 0.55;
    const registryStatus = inverseDropCandidate
      ? "drop_candidate"
      : classifyRegistryStatus({
      predictiveScore,
      parityStatus: parity.status || "aligned",
      activationRate: item.activationRate || 0,
      redundancyScore,
      tier: item.tier
    });
    const action = registryStatus === "drop_candidate"
      ? "drop_candidate"
      : registryStatus === "guard_only"
        ? "fix_live_parity"
        : registryStatus === "shadow"
          ? "shadow_only"
          : registryStatus === "observe"
            ? "observe_only"
            : "keep_active";
    const sampleConfidence = clamp(
      Math.max(
        item.sampleConfidence || 0,
        buildSampleConfidence(decay.count || item.tradeCount || 0, 8)
      ),
      0,
      1
    );
    const evidenceConfidence = clamp(
      Math.max(
        item.evidenceConfidence || 0,
        sampleConfidence * 0.58 +
          Math.min(1, predictiveScore / 0.16) * 0.28 +
          ((decay.status || "") === "decayed" ? 0.14 : (decay.status || "") === "watch" ? 0.07 : 0)
      ),
      0,
      1
    );
    const inverseDropConfidence = clamp(
      inverseActionability * 0.74 +
        sampleConfidence * 0.16 +
        ((decay.status || "") === "decayed" ? 0.08 : (decay.status || "") === "watch" ? 0.04 : 0),
      0,
      1
    );
    const actionConfidence = clamp(
      action === "fix_live_parity"
        ? evidenceConfidence * 0.7 + ((parity.status || "") === "misaligned" ? 0.22 : 0.1)
        : action === "drop_candidate"
          ? inverseDropCandidate
            ? inverseDropConfidence
            : evidenceConfidence * 0.82 + ((decay.status || "") === "decayed" ? 0.12 : 0)
          : evidenceConfidence,
      0,
      1
    );
    const supportFeature = Boolean(item.supportFeature) || isSupportFeature(item.id, item.group);
    const downgradedDropCandidate =
      action === "drop_candidate" && (
        actionConfidence < 0.62 ||
        (supportFeature && actionConfidence < 0.86)
      );
    const effectiveAction = downgradedDropCandidate ? "observe_only" : action;
    const effectiveStatus = downgradedDropCandidate ? "observe" : registryStatus;
    return {
      id: item.id,
      group: item.group,
      tier: item.tier,
      supportFeature,
      action: effectiveAction,
      originalAction: action,
      status: effectiveStatus,
      predictiveScore: item.predictiveScore || 0,
      influenceScore: item.influenceScore || 0,
      tradeCount: item.tradeCount || decay.count || 0,
      sampleConfidence: num(sampleConfidence),
      evidenceConfidence: num(evidenceConfidence),
      actionConfidence: num(actionConfidence),
      decayStatus: decay.status || "warmup",
      meanShift: num(decay.meanShift || 0),
      parityStatus: parity.status || "aligned",
      redundancyScore: num(redundancyScore),
      rationale:
        downgradedDropCandidate
          ? supportFeature
            ? "lage voorspellende waarde, maar dit is vooral een context/support-feature en nog geen harde drop-candidate"
            : "lage voorspellende waarde, maar nog onvoldoende sample-evidence voor een harde drop-candidate"
          : action === "drop_candidate"
            ? inverseDropCandidate
              ? "feature werkt vooral als inverse risico- of anti-signal, maar pruning-evidence is nog niet volwassen"
              : "lage voorspellende waarde met hoge activatie"
          : action === "fix_live_parity"
            ? "paper/live parity is onvoldoende"
            : action === "shadow_only"
              ? "signaal is redundant naast sterkere groepsgenoten"
              : action === "observe_only"
                ? "bruikbaar, maar nog niet sterk genoeg voor kernset"
                : "behouden in actieve modelset"
    };
  }).sort((left, right) => {
    const actionRank = {
      fix_live_parity: 5,
      drop_candidate: 4,
      shadow_only: 3,
      observe_only: 2,
      keep_active: 1
    };
    return (actionRank[right.action] || 0) - (actionRank[left.action] || 0) || (left.predictiveScore || 0) - (right.predictiveScore || 0);
  });

  return {
    status: recommendations.some((item) => ["fix_live_parity", "drop_candidate"].includes(item.action))
      ? "action_required"
      : recommendations.some((item) => item.action === "observe_only")
        ? "watch"
        : "healthy",
    recommendations: recommendations.slice(0, 16),
    activeFeatures: recommendations.filter((item) => item.status === "active").slice(0, 12).map((item) => item.id),
    shadowFeatures: recommendations.filter((item) => item.status === "shadow").slice(0, 12).map((item) => item.id),
    guardOnlyFeatures: recommendations.filter((item) => item.status === "guard_only").slice(0, 12).map((item) => item.id),
    dropCandidates: recommendations.filter((item) => item.action === "drop_candidate").slice(0, 12).map((item) => item.id),
    notes: [
      recommendations[0]
        ? `${recommendations[0].id} vraagt momenteel de hoogste governance-aandacht (${recommendations[0].action}).`
        : "Nog geen pruning-aanbevelingen beschikbaar.",
      recommendations.find((item) => item.status === "active" && item.tier === "composite")
        ? `${recommendations.find((item) => item.status === "active" && item.tier === "composite").id} blijft de voorkeurs-composite binnen zijn featuregroep.`
        : "Nog geen duidelijke composite-leider voor feature-pruning."
    ]
  };
}

export function buildGuardEffectiveness(counterfactuals = []) {
  const map = new Map();
  for (const item of counterfactuals || []) {
    const reasons = Array.isArray(item.blockerReasons) && item.blockerReasons.length
      ? item.blockerReasons
      : [item.reason || "no_explicit_blocker"];
    for (const reason of reasons) {
      if (!map.has(reason)) {
        map.set(reason, { id: reason, total: 0, good: 0, bad: 0, late: 0, timing: 0, move: 0 });
      }
      const bucket = map.get(reason);
      bucket.total += 1;
      bucket.move += item.realizedMovePct || 0;
      if (["blocked_correctly", "good_veto"].includes(item.outcome)) {
        bucket.good += 1;
      } else if (["missed_winner", "bad_veto"].includes(item.outcome)) {
        bucket.bad += 1;
      } else if (item.outcome === "late_veto") {
        bucket.late += 1;
      } else if (item.outcome === "right_direction_wrong_timing") {
        bucket.timing += 1;
      }
    }
  }
  const scorecards = [...map.values()].map((bucket) => {
    const precision = bucket.total ? bucket.good / bucket.total : 0;
    const missRate = bucket.total ? bucket.bad / bucket.total : 0;
    const timingPenalty = bucket.total ? (bucket.late + bucket.timing) / bucket.total : 0;
    const governanceScore = clamp(0.52 + precision * 0.28 - missRate * 0.34 - timingPenalty * 0.16, 0, 1);
    return {
      id: bucket.id,
      total: bucket.total,
      goodVetoCount: bucket.good,
      badVetoCount: bucket.bad,
      lateVetoCount: bucket.late,
      timingIssueCount: bucket.timing,
      averageMovePct: num(bucket.total ? bucket.move / bucket.total : 0),
      precision: num(precision),
      missRate: num(missRate),
      timingPenalty: num(timingPenalty),
      governanceScore: num(governanceScore),
      status: governanceScore >= 0.62 ? "reliable" : governanceScore >= 0.44 ? "watch" : "retune"
    };
  }).sort((left, right) => (right.total || 0) - (left.total || 0));

  return {
    status: scorecards.some((item) => item.status === "retune")
      ? "retune"
      : scorecards.some((item) => item.status === "watch")
        ? "watch"
        : scorecards.length
          ? "healthy"
          : "warmup",
    scorecards: scorecards.slice(0, 12),
    topReliableGuard: scorecards.filter((item) => item.status === "reliable")[0]?.id || null,
    topRetuneGuard: scorecards.filter((item) => item.status === "retune")[0]?.id || null,
    notes: [
      scorecards.find((item) => item.status === "retune")
        ? `${scorecards.find((item) => item.status === "retune").id} blokkeert relatief vaak winnaars en verdient retuning.`
        : "Guard-effectiveness oogt voorlopig stabiel.",
      scorecards.find((item) => item.status === "reliable")
        ? `${scorecards.find((item) => item.status === "reliable").id} is momenteel de betrouwbaarste veto-guard.`
        : "Nog geen guard met duidelijke reliability-voorsprong."
    ]
  };
}

function buildPruningAudit({ pruning = {}, attribution = {}, featureScorecards = [] } = {}) {
  const decayMap = new Map((featureScorecards || []).map((item) => [item.id, item]));
  const topNegativeMap = new Map((attribution.topNegative || []).map((item) => [item.id, item]));
  const candidates = (pruning.recommendations || [])
    .filter((item) => item.originalAction === "drop_candidate" || item.action === "drop_candidate")
    .map((item) => {
      const topNegative = topNegativeMap.get(item.id) || {};
      const decay = decayMap.get(item.id) || {};
      const supportFeature = Boolean(item.supportFeature);
      const likelyOverclassified = item.originalAction === "drop_candidate" && item.action !== "drop_candidate";
      const evidenceConfidence = Math.max(item.evidenceConfidence || 0, topNegative.evidenceConfidence || 0, decay.decayEvidenceConfidence || 0);
      return {
        id: item.id,
        group: item.group || decay.group || "context",
        supportFeature,
        action: item.action || "observe_only",
        originalAction: item.originalAction || item.action || "observe_only",
        decayStatus: item.decayStatus || decay.status || "warmup",
        predictiveScore: num(item.predictiveScore ?? topNegative.predictiveScore ?? decay.predictiveScore ?? 0),
        influenceScore: num(item.influenceScore ?? topNegative.influenceScore ?? 0),
        tradeCount: item.tradeCount || topNegative.tradeCount || decay.count || 0,
        sampleConfidence: num(Math.max(item.sampleConfidence || 0, topNegative.sampleConfidence || 0, decay.sampleConfidence || 0)),
        evidenceConfidence: num(evidenceConfidence),
        actionConfidence: num(item.actionConfidence || evidenceConfidence),
        likelyOverclassified,
        rationale: item.rationale || null
      };
    })
    .sort((left, right) => {
      const leftRank = left.action === "drop_candidate" ? 2 : left.likelyOverclassified ? 1 : 0;
      const rightRank = right.action === "drop_candidate" ? 2 : right.likelyOverclassified ? 1 : 0;
      return rightRank - leftRank ||
        (right.actionConfidence || 0) - (left.actionConfidence || 0) ||
        (left.predictiveScore || 0) - (right.predictiveScore || 0);
    });

  const hardDropCount = candidates.filter((item) => item.action === "drop_candidate").length;
  const downgradedDropCount = candidates.filter((item) => item.likelyOverclassified).length;
  const supportFeatureCount = candidates.filter((item) => item.supportFeature).length;
  const lowEvidenceCount = candidates.filter((item) => (item.evidenceConfidence || 0) < 0.58).length;
  const dominantFeature = candidates[0]?.id || null;

  return {
    status: hardDropCount
      ? "action_required"
      : downgradedDropCount || lowEvidenceCount
        ? "watch"
        : candidates.length
          ? "healthy"
          : "warmup",
    dominantFeature,
    candidateCount: candidates.length,
    hardDropCount,
    downgradedDropCount,
    supportFeatureCount,
    lowEvidenceCount,
    topFeatures: candidates.slice(0, 8),
    notes: [
      dominantFeature
        ? `${dominantFeature} blijft de sterkste pruning-driver in de huidige offline audit.`
        : "Nog geen duidelijke pruning-driver zichtbaar.",
      downgradedDropCount
        ? `${downgradedDropCount} drop-candidates zijn teruggezet omdat de evidence nog te dun is.`
        : hardDropCount
          ? `${hardDropCount} features blijven echte hard drop-candidates met voldoende evidence.`
          : "Geen hard drop-candidates met sterke evidence in de huidige set."
    ]
  };
}

export function buildFeatureGovernanceSummary({
  trades = [],
  paperTrades = [],
  liveTrades = [],
  counterfactuals = [],
  featureScorecards = []
} = {}) {
  const attribution = buildFeatureAttribution(trades);
  const parityAudit = buildFeatureParityAudit({ paperTrades, liveTrades, featureScorecards });
  const pruning = buildFeaturePruningPlan({ attribution, parityAudit, featureScorecards });
  const pruningAudit = buildPruningAudit({ pruning, attribution, featureScorecards });
  const guardEffectiveness = buildGuardEffectiveness(counterfactuals);
  return {
    status: [pruning.status, pruningAudit.status, parityAudit.status, guardEffectiveness.status].includes("action_required") || [pruning.status, guardEffectiveness.status].includes("retune")
      ? "action_required"
      : [pruning.status, pruningAudit.status, parityAudit.status, guardEffectiveness.status].includes("watch") || parityAudit.status === "misaligned"
        ? "watch"
        : attribution.trackedFeatureCount
          ? "healthy"
          : "warmup",
    attribution,
    parityAudit,
    pruning,
    pruningAudit,
    guardEffectiveness,
    notes: [
      ...(attribution.notes || []).slice(0, 2),
      ...(parityAudit.notes || []).slice(0, 2),
      ...(pruning.notes || []).slice(0, 2),
      ...(pruningAudit.notes || []).slice(0, 2),
      ...(guardEffectiveness.notes || []).slice(0, 2)
    ].slice(0, 6)
  };
}

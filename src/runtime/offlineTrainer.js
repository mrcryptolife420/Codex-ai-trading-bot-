import { clamp } from "../utils/math.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function buildBucketMap(items = [], keyFn, projector = null) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    if (!map.has(key)) {
      map.set(key, { id: key, count: 0, paperCount: 0, liveCount: 0, pnl: 0, wins: 0, quality: 0, label: 0, move: 0 });
    }
    const bucket = map.get(key);
    const view = projector ? projector(item) : {
      pnl: item.pnlQuote || 0,
      win: (item.pnlQuote || 0) > 0 ? 1 : 0,
      quality: item.executionQualityScore || 0,
      label: item.labelScore || 0,
      move: item.realizedMovePct || 0,
      mode: item.brokerMode || "paper"
    };
    bucket.count += 1;
    bucket.paperCount += view.mode === "paper" ? 1 : 0;
    bucket.liveCount += view.mode === "live" ? 1 : 0;
    bucket.pnl += view.pnl;
    bucket.wins += view.win;
    bucket.quality += view.quality;
    bucket.label += view.label;
    bucket.move += view.move;
  }
  return [...map.values()].map((bucket) => ({
    id: bucket.id,
    tradeCount: bucket.count,
    paperTradeCount: bucket.paperCount,
    liveTradeCount: bucket.liveCount,
    realizedPnl: num(bucket.pnl, 2),
    winRate: num(bucket.count ? bucket.wins / bucket.count : 0),
    avgExecutionQuality: num(bucket.count ? bucket.quality / bucket.count : 0),
    avgLabelScore: num(bucket.count ? bucket.label / bucket.count : 0),
    avgMovePct: num(bucket.count ? bucket.move / bucket.count : 0),
    governanceScore: num(clamp(0.46 + (bucket.count ? bucket.pnl / Math.max(bucket.count * 80, 1) : 0) + (bucket.count ? bucket.wins / bucket.count - 0.5 : 0), 0, 1))
  })).sort((left, right) => right.governanceScore - left.governanceScore);
}

function buildDecisionScorecards({
  trades = [],
  falsePositives = [],
  falseNegatives = [],
  keyFn = null,
  falseNegativeKeyFn = null,
  fallbackId = "unknown"
} = {}) {
  const map = new Map();
  const getBucket = (id) => {
    const key = id || fallbackId;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        tradeCount: 0,
        paperTradeCount: 0,
        liveTradeCount: 0,
        winCount: 0,
        pnl: 0,
        executionQuality: 0,
        labelScore: 0,
        falsePositiveCount: 0,
        falseNegativeCount: 0,
        moveSum: 0
      });
    }
    return map.get(key);
  };

  for (const trade of trades) {
    const id = keyFn ? keyFn(trade) : fallbackId;
    const bucket = getBucket(id);
    bucket.tradeCount += 1;
    bucket.paperTradeCount += (trade.brokerMode || "paper") === "paper" ? 1 : 0;
    bucket.liveTradeCount += (trade.brokerMode || "paper") === "live" ? 1 : 0;
    bucket.winCount += (trade.pnlQuote || 0) > 0 ? 1 : 0;
    bucket.pnl += trade.pnlQuote || 0;
    bucket.executionQuality += trade.executionQualityScore || 0;
    bucket.labelScore += trade.labelScore || 0;
    bucket.moveSum += trade.netPnlPct || 0;
  }

  for (const trade of falsePositives) {
    const id = keyFn ? keyFn(trade) : fallbackId;
    const bucket = getBucket(id);
    bucket.falsePositiveCount += 1;
  }

  for (const item of falseNegatives) {
    const id = falseNegativeKeyFn ? falseNegativeKeyFn(item) : fallbackId;
    const bucket = getBucket(id);
    bucket.falseNegativeCount += 1;
    bucket.moveSum += item.realizedMovePct || 0;
  }

  return [...map.values()]
    .map((bucket) => {
      const tradeCount = bucket.tradeCount || 0;
      const winRate = tradeCount ? bucket.winCount / tradeCount : 0;
      const avgExecutionQuality = tradeCount ? bucket.executionQuality / tradeCount : 0;
      const avgLabelScore = tradeCount ? bucket.labelScore / tradeCount : 0;
      const avgMovePct = tradeCount ? bucket.moveSum / tradeCount : 0;
      const falsePositiveRate = tradeCount ? bucket.falsePositiveCount / tradeCount : 0;
      const falseNegativeRate = (tradeCount + bucket.falseNegativeCount) ? bucket.falseNegativeCount / (tradeCount + bucket.falseNegativeCount) : 0;
      const pnlScore = clamp(0.5 + bucket.pnl / Math.max(tradeCount * 60, 60), 0, 1);
      const governanceScore = clamp(
        0.34 +
          (winRate - 0.5) * 0.26 +
          avgExecutionQuality * 0.14 +
          avgLabelScore * 0.16 +
          pnlScore * 0.18 -
          falsePositiveRate * 0.18 -
          falseNegativeRate * 0.1,
        0,
        1
      );
      const status = governanceScore >= 0.62 && tradeCount >= 4
        ? "prime"
        : governanceScore <= 0.42 && tradeCount >= 4
          ? "cooldown"
          : tradeCount >= 2 || bucket.falseNegativeCount > 0
            ? "observe"
            : "warmup";
      return {
        id: bucket.id,
        tradeCount,
        paperTradeCount: bucket.paperTradeCount,
        liveTradeCount: bucket.liveTradeCount,
        winRate: num(winRate),
        realizedPnl: num(bucket.pnl, 2),
        avgExecutionQuality: num(avgExecutionQuality),
        avgLabelScore: num(avgLabelScore),
        avgMovePct: num(avgMovePct),
        falsePositiveCount: bucket.falsePositiveCount,
        falseNegativeCount: bucket.falseNegativeCount,
        falsePositiveRate: num(falsePositiveRate),
        falseNegativeRate: num(falseNegativeRate),
        governanceScore: num(governanceScore),
        dominantError: bucket.falsePositiveCount > bucket.falseNegativeCount
          ? "false_positive_bias"
          : bucket.falseNegativeCount > bucket.falsePositiveCount
            ? "false_negative_bias"
            : "balanced",
        status
      };
    })
    .sort((left, right) => right.governanceScore - left.governanceScore)
    .slice(0, 10);
}

function buildStrategyScorecards(trades = [], falsePositives = [], falseNegatives = []) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown",
    falseNegativeKeyFn: (item) => item.strategy || item.strategyAtEntry || "blocked_setup",
    fallbackId: "unknown"
  });
}

function buildRegimeScorecards(trades = [], falsePositives = [], falseNegatives = []) {
  return buildDecisionScorecards({
    trades,
    falsePositives,
    falseNegatives,
    keyFn: (trade) => trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown",
    falseNegativeKeyFn: (item) => item.regime || item.regimeAtEntry || "blocked_setup",
    fallbackId: "unknown"
  });
}

function buildBlockerScorecards(counterfactuals = []) {
  const map = new Map();
  const getBucket = (id) => {
    const key = id || "no_explicit_blocker";
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        total: 0,
        goodVetoCount: 0,
        badVetoCount: 0,
        lateVetoCount: 0,
        timingIssueCount: 0,
        moveSum: 0,
        strategyIds: new Set(),
        regimeIds: new Set(),
        phaseIds: new Set()
      });
    }
    return map.get(key);
  };

  for (const item of counterfactuals || []) {
    const reasons = Array.isArray(item.blockerReasons) && item.blockerReasons.length
      ? item.blockerReasons.slice(0, 4)
      : [item.reason || "no_explicit_blocker"];
    for (const reason of reasons) {
      const bucket = getBucket(reason);
      bucket.total += 1;
      bucket.moveSum += item.realizedMovePct || 0;
      if (["blocked_correctly", "good_veto"].includes(item.outcome)) {
        bucket.goodVetoCount += 1;
      } else if (["missed_winner", "bad_veto"].includes(item.outcome)) {
        bucket.badVetoCount += 1;
      } else if (item.outcome === "late_veto") {
        bucket.lateVetoCount += 1;
      } else if (item.outcome === "right_direction_wrong_timing") {
        bucket.timingIssueCount += 1;
      }
      if (item.strategy || item.strategyAtEntry) {
        bucket.strategyIds.add(item.strategy || item.strategyAtEntry);
      }
      if (item.regime || item.regimeAtEntry) {
        bucket.regimeIds.add(item.regime || item.regimeAtEntry);
      }
      if (item.marketPhase) {
        bucket.phaseIds.add(item.marketPhase);
      }
    }
  }

  return [...map.values()]
    .map((bucket) => {
      const goodVetoRate = bucket.total ? bucket.goodVetoCount / bucket.total : 0;
      const badVetoRate = bucket.total ? bucket.badVetoCount / bucket.total : 0;
      const lateVetoRate = bucket.total ? bucket.lateVetoCount / bucket.total : 0;
      const timingIssueRate = bucket.total ? bucket.timingIssueCount / bucket.total : 0;
      const averageMovePct = bucket.total ? bucket.moveSum / bucket.total : 0;
      const governanceScore = clamp(
        0.5 +
          goodVetoRate * 0.24 -
          badVetoRate * 0.28 -
          lateVetoRate * 0.12 -
          timingIssueRate * 0.08 -
          Math.max(0, averageMovePct) * 4.5,
        0,
        1
      );
      return {
        id: bucket.id,
        total: bucket.total,
        goodVetoCount: bucket.goodVetoCount,
        badVetoCount: bucket.badVetoCount,
        lateVetoCount: bucket.lateVetoCount,
        timingIssueCount: bucket.timingIssueCount,
        goodVetoRate: num(goodVetoRate),
        badVetoRate: num(badVetoRate),
        lateVetoRate: num(lateVetoRate),
        timingIssueRate: num(timingIssueRate),
        averageMovePct: num(averageMovePct),
        governanceScore: num(governanceScore),
        affectedStrategies: [...bucket.strategyIds].slice(0, 4),
        affectedRegimes: [...bucket.regimeIds].slice(0, 4),
        affectedPhases: [...bucket.phaseIds].slice(0, 4),
        status: badVetoRate >= 0.45 && bucket.badVetoCount >= 2
          ? "relax"
          : goodVetoRate >= 0.55 && bucket.goodVetoCount >= 2
            ? "keep"
            : "observe"
      };
    })
    .sort((left, right) => {
      const badEdge = right.badVetoRate - left.badVetoRate;
      return Math.abs(badEdge) > 0.001 ? badEdge : right.total - left.total;
    })
    .slice(0, 10);
}

function correlation(values = [], outcomes = []) {
  const length = Math.min(values.length, outcomes.length);
  if (length < 3) {
    return 0;
  }
  const x = values.slice(-length);
  const y = outcomes.slice(-length);
  const meanX = average(x);
  const meanY = average(y);
  let numerator = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < length; index += 1) {
    const dx = x[index] - meanX;
    const dy = y[index] - meanY;
    numerator += dx * dy;
    varianceX += dx ** 2;
    varianceY += dy ** 2;
  }
  if (!varianceX || !varianceY) {
    return 0;
  }
  return clamp(numerator / Math.sqrt(varianceX * varianceY), -1, 1);
}

function buildThresholdPolicy(blockerScorecards = [], config = {}) {
  const recommendations = blockerScorecards
    .filter((item) => (item.total || 0) >= 2)
    .map((item) => {
      const action = item.status === "relax"
        ? "relax"
        : item.status === "keep" && (item.goodVetoRate || 0) >= 0.58
          ? "tighten"
          : "observe";
      const baseStep = action === "relax"
        ? config.thresholdRelaxStep || 0.012
        : config.thresholdTightenStep || 0.01;
      const signalStrength = Math.max(item.badVetoRate || 0, item.goodVetoRate || 0);
      const adjustment = action === "observe"
        ? 0
        : (action === "relax" ? -1 : 1) * Math.min(baseStep, Math.max(baseStep * 0.4, signalStrength * baseStep));
      const confidence = clamp(
        Math.min(1, (item.total || 0) / 8) * 0.44 +
          Math.abs((item.badVetoRate || 0) - (item.goodVetoRate || 0)) * 0.56,
        0,
        1
      );
      return {
        id: item.id,
        action,
        adjustment: num(adjustment),
        confidence: num(confidence),
        total: item.total || 0,
        affectedStrategies: [...(item.affectedStrategies || [])].slice(0, 4),
        affectedRegimes: [...(item.affectedRegimes || [])].slice(0, 4),
        rationale: action === "relax"
          ? `${item.id} blokkeert te vaak gemiste winnaars.`
          : action === "tighten"
            ? `${item.id} veto is meestal correct en mag iets zwaarder wegen.`
            : `${item.id} heeft nog te weinig overtuigende feedback voor een threshold-wijziging.`
      };
    })
    .filter((item) => item.action !== "observe")
    .sort((left, right) => {
      const confidenceDelta = (right.confidence || 0) - (left.confidence || 0);
      return Math.abs(confidenceDelta) > 0.001
        ? confidenceDelta
        : Math.abs(right.adjustment || 0) - Math.abs(left.adjustment || 0);
    })
    .slice(0, config.thresholdTuningMaxRecommendations || 5);

  const relaxCount = recommendations.filter((item) => item.action === "relax").length;
  const tightenCount = recommendations.filter((item) => item.action === "tighten").length;
  const netThresholdShift = clamp(
    recommendations.reduce((total, item) => total + (item.adjustment || 0), 0),
    -0.06,
    0.06
  );
  const adjustThreshold = Math.max(
    0.004,
    Math.min(config.thresholdRelaxStep || 0.012, config.thresholdTightenStep || 0.01) * 0.55
  );
  const status = recommendations.length === 0
    ? "stable"
    : Math.abs(netThresholdShift) >= adjustThreshold
      ? "adjust"
      : "observe";

  return {
    status,
    relaxCount,
    tightenCount,
    netThresholdShift: num(netThresholdShift),
    topRecommendation: recommendations[0] || null,
    recommendations,
    notes: [
      recommendations[0]
        ? `${recommendations[0].id} is de sterkste threshold-kandidaat (${recommendations[0].action}).`
        : "Thresholds blijven stabiel; er is nog geen duidelijke veto-aanpassing nodig.",
      relaxCount
        ? `${relaxCount} veto-blokkers vragen een lossere gate.`
        : "Geen veto-blokkers vragen nu om een lossere gate.",
      tightenCount
        ? `${tightenCount} veto-blokkers mogen juist strakker worden bewaakt.`
        : "Geen veto-blokkers vragen nu om een strakkere gate."
    ]
  };
}

function buildExitLearning(trades = []) {
  const map = new Map();
  let prematureExitCount = 0;
  let lateExitCount = 0;
  const exitScores = [];

  for (const trade of trades) {
    const reason = trade.reason || "unknown";
    if (!map.has(reason)) {
      map.set(reason, {
        id: reason,
        tradeCount: 0,
        avgExitScore: 0,
        prematureExitCount: 0,
        lateExitCount: 0,
        realizedPnl: 0,
        averageCapture: 0
      });
    }
    const bucket = map.get(reason);
    const mfePct = Math.max(0, trade.mfePct || 0);
    const captureRatio = mfePct > 0 ? clamp((trade.netPnlPct || 0) / mfePct, -1, 1.4) : (trade.netPnlPct || 0) > 0 ? 0.65 : 0.45;
    const prematureExit = (trade.netPnlPct || 0) > 0 && mfePct >= 0.012 && captureRatio < 0.42;
    const lateExit = (trade.netPnlPct || 0) <= 0 && mfePct >= 0.012 && captureRatio < 0.08;
    const exitScore = clamp(
      0.4 +
        Math.max(0, Math.min(captureRatio, 1)) * 0.28 +
        (trade.captureEfficiency || 0) * 0.16 +
        (trade.executionQualityScore || 0) * 0.14 +
        ((trade.exitIntelligenceSummary?.confidence || 0) * 0.08) -
        (prematureExit ? 0.12 : 0) -
        (lateExit ? 0.18 : 0),
      0,
      1
    );

    bucket.tradeCount += 1;
    bucket.avgExitScore += exitScore;
    bucket.realizedPnl += trade.pnlQuote || 0;
    bucket.averageCapture += trade.captureEfficiency || Math.max(0, captureRatio);
    if (prematureExit) {
      bucket.prematureExitCount += 1;
      prematureExitCount += 1;
    }
    if (lateExit) {
      bucket.lateExitCount += 1;
      lateExitCount += 1;
    }
    exitScores.push(exitScore);
  }

  const exitScorecards = [...map.values()]
    .map((bucket) => {
      const avgExitScore = bucket.tradeCount ? bucket.avgExitScore / bucket.tradeCount : 0;
      const averageCapture = bucket.tradeCount ? bucket.averageCapture / bucket.tradeCount : 0;
      const governanceScore = clamp(
        avgExitScore * 0.6 +
          clamp(0.5 + bucket.realizedPnl / Math.max(bucket.tradeCount * 60, 60), 0, 1) * 0.18 +
          averageCapture * 0.12 -
          Math.min(0.18, bucket.prematureExitCount / Math.max(bucket.tradeCount, 1) * 0.18) -
          Math.min(0.22, bucket.lateExitCount / Math.max(bucket.tradeCount, 1) * 0.22),
        0,
        1
      );
      return {
        id: bucket.id,
        tradeCount: bucket.tradeCount,
        averageExitScore: num(avgExitScore),
        averageCapture: num(averageCapture),
        realizedPnl: num(bucket.realizedPnl, 2),
        prematureExitCount: bucket.prematureExitCount,
        lateExitCount: bucket.lateExitCount,
        governanceScore: num(governanceScore),
        status: governanceScore >= 0.62
          ? "ready"
          : governanceScore <= 0.42
            ? "blocked"
            : "observe"
      };
    })
    .sort((left, right) => right.governanceScore - left.governanceScore)
    .slice(0, 8);

  const averageExitScore = average(exitScores);
  const status = averageExitScore >= 0.58 && lateExitCount <= Math.max(1, Math.round(trades.length * 0.28))
    ? "ready"
    : averageExitScore >= 0.46
      ? "observe"
      : "blocked";

  return {
    status,
    averageExitScore: num(averageExitScore),
    prematureExitCount,
    lateExitCount,
    topReason: exitScorecards[0]?.id || null,
    scorecards: exitScorecards,
    strategyPolicies: buildScopedExitPolicies(trades, (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy || "unknown"),
    regimePolicies: buildScopedExitPolicies(trades, (trade) => trade.regimeAtEntry || trade.entryRationale?.regimeSummary?.regime || "unknown"),
    notes: [
      exitScorecards[0]
        ? `${exitScorecards[0].id} is momenteel de sterkste exit-route.`
        : "Nog geen exit-scorecards beschikbaar.",
      lateExitCount
        ? `${lateExitCount} exits gaven winst terug en verdienen strakkere follow-through.`
        : "Geen duidelijke late-exit patronen in de huidige set.",
      prematureExitCount
        ? `${prematureExitCount} exits waren waarschijnlijk te vroeg.`
        : "Geen duidelijke premature exits in de huidige set."
    ]
  };
}

function buildScopedExitPolicies(trades = [], keyFn = null) {
  const map = new Map();
  for (const trade of trades) {
    const id = (keyFn ? keyFn(trade) : "unknown") || "unknown";
    if (!map.has(id)) {
      map.set(id, {
        id,
        tradeCount: 0,
        prematureExitCount: 0,
        lateExitCount: 0,
        captureSum: 0
      });
    }
    const bucket = map.get(id);
    const mfePct = Math.max(0, trade.mfePct || 0);
    const captureRatio = mfePct > 0 ? clamp((trade.netPnlPct || 0) / mfePct, -1, 1.4) : (trade.netPnlPct || 0) > 0 ? 0.65 : 0.45;
    const prematureExit = (trade.netPnlPct || 0) > 0 && mfePct >= 0.012 && captureRatio < 0.42;
    const lateExit = (trade.netPnlPct || 0) <= 0 && mfePct >= 0.012 && captureRatio < 0.08;
    bucket.tradeCount += 1;
    bucket.captureSum += Math.max(0, captureRatio);
    if (prematureExit) {
      bucket.prematureExitCount += 1;
    }
    if (lateExit) {
      bucket.lateExitCount += 1;
    }
  }

  return [...map.values()]
    .filter((bucket) => bucket.tradeCount >= 2)
    .map((bucket) => {
      const prematureRate = bucket.tradeCount ? bucket.prematureExitCount / bucket.tradeCount : 0;
      const lateRate = bucket.tradeCount ? bucket.lateExitCount / bucket.tradeCount : 0;
      const lateBiased = lateRate > prematureRate + 0.05;
      const prematureBiased = prematureRate > lateRate + 0.05;
      return {
        id: bucket.id,
        tradeCount: bucket.tradeCount,
        prematureExitCount: bucket.prematureExitCount,
        lateExitCount: bucket.lateExitCount,
        averageCapture: num(bucket.captureSum / Math.max(bucket.tradeCount, 1)),
        scaleOutFractionMultiplier: num(lateBiased ? 1.08 : prematureBiased ? 0.92 : 1),
        scaleOutTriggerMultiplier: num(lateBiased ? 0.94 : prematureBiased ? 1.08 : 1),
        trailingStopMultiplier: num(lateBiased ? 0.9 : prematureBiased ? 1.08 : 1),
        maxHoldMinutesMultiplier: num(lateBiased ? 0.84 : prematureBiased ? 1.08 : 1),
        status: lateBiased
          ? "tighten"
          : prematureBiased
            ? "widen"
            : "balanced"
      };
    })
    .sort((left, right) => (right.tradeCount || 0) - (left.tradeCount || 0))
    .slice(0, 8);
}

function buildFeatureDecay(trades = [], config = {}) {
  const buckets = new Map();
  for (const trade of trades) {
    const rawFeatures = trade.rawFeatures || {};
    const outcome = Number.isFinite(trade.labelScore)
      ? trade.labelScore
      : clamp(0.5 + (trade.netPnlPct || 0) * 12, 0, 1);
    for (const [key, value] of Object.entries(rawFeatures)) {
      if (!Number.isFinite(value)) {
        continue;
      }
      if (!buckets.has(key)) {
        buckets.set(key, { id: key, values: [], outcomes: [] });
      }
      const bucket = buckets.get(key);
      bucket.values.push(Number(value));
      bucket.outcomes.push(outcome);
    }
  }

  const minTrades = config.featureDecayMinTrades || 8;
  const weakScore = config.featureDecayWeakScore || 0.18;
  const blockedScore = config.featureDecayBlockedScore || 0.1;
  const scorecards = [...buckets.values()]
    .filter((bucket) => bucket.values.length >= minTrades)
    .map((bucket) => {
      const predictiveScore = Math.abs(correlation(bucket.values, bucket.outcomes));
      const half = Math.max(1, Math.floor(bucket.values.length / 2));
      const earlierMean = average(bucket.values.slice(0, half));
      const recentMean = average(bucket.values.slice(-half));
      const meanShift = Math.abs(recentMean - earlierMean);
      return {
        id: bucket.id,
        count: bucket.values.length,
        predictiveScore: num(predictiveScore),
        meanShift: num(meanShift),
        direction: correlation(bucket.values, bucket.outcomes) >= 0 ? "pro" : "inverse",
        status: predictiveScore <= blockedScore
          ? "decayed"
          : predictiveScore <= weakScore
            ? "watch"
            : "healthy"
      };
    })
    .sort((left, right) => {
      const scoreDelta = (left.predictiveScore || 0) - (right.predictiveScore || 0);
      return Math.abs(scoreDelta) > 0.001 ? scoreDelta : (right.meanShift || 0) - (left.meanShift || 0);
    })
    .slice(0, 12);

  const degradedFeatureCount = scorecards.filter((item) => item.status === "decayed").length;
  const weakFeatureCount = scorecards.filter((item) => item.status !== "healthy").length;
  const strongestFeature = [...scorecards].sort((left, right) => (right.predictiveScore || 0) - (left.predictiveScore || 0))[0] || null;
  const weakestFeature = scorecards[0] || null;
  const averagePredictiveScore = average(scorecards.map((item) => item.predictiveScore || 0));
  const status = degradedFeatureCount >= 2
    ? "blocked"
    : weakFeatureCount >= 3
      ? "watch"
      : scorecards.length
        ? "healthy"
        : "warmup";

  return {
    status,
    trackedFeatureCount: scorecards.length,
    weakFeatureCount,
    degradedFeatureCount,
    strongestFeature: strongestFeature?.id || null,
    weakestFeature: weakestFeature?.id || null,
    averagePredictiveScore: num(averagePredictiveScore),
    scorecards,
    notes: [
      weakestFeature
        ? `${weakestFeature.id} toont momenteel de meeste feature decay.`
        : "Nog niet genoeg feature-data voor decay scoring.",
      strongestFeature
        ? `${strongestFeature.id} blijft de stabielste feature in de huidige set.`
        : "Nog geen stabiele feature-leider zichtbaar."
    ]
  };
}

function buildCalibrationGovernance({ tradeCount = 0, falsePositiveCount = 0, falseNegativeCount = 0, readinessScore = 0 } = {}) {
  const falsePositiveRate = tradeCount ? falsePositiveCount / tradeCount : 0;
  const denominator = tradeCount + falseNegativeCount;
  const falseNegativeRate = denominator ? falseNegativeCount / denominator : 0;
  const governanceScore = clamp(
    0.62 -
      falsePositiveRate * 0.34 -
      falseNegativeRate * 0.24 +
      readinessScore * 0.12,
    0,
    1
  );
  return {
    falsePositiveRate: num(falsePositiveRate),
    falseNegativeRate: num(falseNegativeRate),
    governanceScore: num(governanceScore),
    status: governanceScore >= 0.58
      ? "ready"
      : governanceScore >= 0.42
        ? "observe"
        : "blocked",
    note: governanceScore >= 0.58
      ? "Calibration governance oogt stabiel genoeg voor promotiebesluiten."
      : governanceScore >= 0.42
        ? "Calibration governance is bruikbaar, maar vraagt nog toezicht."
        : "Calibration governance is te zwak voor agressieve promotie."
  };
}

function buildRegimeDeployment(regimeScorecards = []) {
  const mature = regimeScorecards.filter((item) => (item.tradeCount || 0) >= 2);
  const readyRegimes = mature.filter((item) => (item.governanceScore || 0) >= 0.56).map((item) => item.id).slice(0, 4);
  const observeRegimes = mature.filter((item) => (item.governanceScore || 0) < 0.56 && (item.governanceScore || 0) >= 0.42).map((item) => item.id).slice(0, 4);
  const cooldownRegimes = mature.filter((item) => (item.governanceScore || 0) < 0.42).map((item) => item.id).slice(0, 4);
  return {
    status: readyRegimes.length ? "segmented" : mature.length ? "observe" : "warmup",
    readyRegimes,
    observeRegimes,
    cooldownRegimes,
    note: readyRegimes.length
      ? `${readyRegimes.length} regimes kunnen apart worden behandeld in deployment-governance.`
      : "Nog geen duidelijke regime-specifieke champions beschikbaar."
  };
}

function countCoverage(entries = []) {
  return (Array.isArray(entries) ? entries : []).reduce((total, item) => total + (item.count || 0), 0);
}

function buildRetrainTrack({
  label = "paper",
  trades = [],
  bootstrap = {},
  learningFrames = 0,
  averageRecordQuality = 0,
  lineageCoverage = 0
} = {}) {
  const strategyCount = new Set(trades.map((trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy).filter(Boolean)).size;
  const regimeCount = new Set(trades.map((trade) => trade.regimeAtEntry).filter(Boolean)).size;
  const winRate = trades.length ? trades.filter((trade) => (trade.pnlQuote || 0) > 0).length / trades.length : 0;
  const avgExecutionQuality = average(trades.map((trade) => trade.executionQualityScore || 0), 0);
  const countScore = Math.min(0.38, trades.length / (label === "live" ? 30 : 45) * 0.38);
  const diversityScore = Math.min(0.18, strategyCount / 6 * 0.1 + regimeCount / 5 * 0.08);
  const qualityScore = Math.min(0.18, averageRecordQuality * 0.1 + lineageCoverage * 0.08);
  const executionScore = Math.min(0.14, avgExecutionQuality * 0.14);
  const bootstrapBias = bootstrap?.paperLearningReady ? 0.08 : 0.03;
  const score = clamp(0.12 + countScore + diversityScore + qualityScore + executionScore + bootstrapBias, 0, 1);
  return {
    label,
    tradeCount: trades.length,
    strategyCount,
    regimeCount,
    winRate: num(winRate),
    avgExecutionQuality: num(avgExecutionQuality),
    learningFrames,
    averageRecordQuality: num(averageRecordQuality),
    lineageCoverage: num(lineageCoverage),
    score: num(score),
    status: score >= 0.72
      ? "ready"
      : score >= 0.52
        ? "building"
        : "warmup",
    recommendation: score >= 0.72
      ? `${label} retrain kan frequenter en breder over scopes worden gebruikt.`
      : score >= 0.52
        ? `${label} retrain is bruikbaar, maar vraagt nog meer scope-diversiteit of trade-count.`
        : `${label} retrain is nog dun; verzamel eerst meer representatieve closed trades.`
  };
}

function buildRetrainReadiness({
  paperTrades = [],
  liveTrades = [],
  dataRecorder = {},
  bootstrap = {}
} = {}) {
  const paper = buildRetrainTrack({
    label: "paper",
    trades: paperTrades,
    bootstrap: bootstrap.warmStart || {},
    learningFrames: dataRecorder.learningFrames || 0,
    averageRecordQuality: dataRecorder.averageRecordQuality || 0,
    lineageCoverage: dataRecorder.lineageCoverage || 0
  });
  const live = buildRetrainTrack({
    label: "live",
    trades: liveTrades,
    bootstrap: bootstrap.warmStart || {},
    learningFrames: dataRecorder.learningFrames || 0,
    averageRecordQuality: dataRecorder.averageRecordQuality || 0,
    lineageCoverage: dataRecorder.lineageCoverage || 0
  });
  const providerCoverage = countCoverage(dataRecorder.sourceCoverage || []);
  const contextCoverage = countCoverage(dataRecorder.contextCoverage || []);
  const datasetHealth = clamp(
    0.18 +
      (dataRecorder.averageRecordQuality || 0) * 0.28 +
      (dataRecorder.lineageCoverage || 0) * 0.22 +
      Math.min(0.16, providerCoverage / 12 * 0.16) +
      Math.min(0.16, contextCoverage / 8 * 0.16),
    0,
    1
  );
  const overallScore = clamp(
    0.32 * paper.score +
      0.28 * live.score +
      0.4 * datasetHealth,
    0,
    1
  );
  const priority = live.score < 0.52
    ? "grow_live_dataset"
    : paper.score < 0.52
      ? "grow_paper_dataset"
      : datasetHealth < 0.56
        ? "improve_dataset_quality"
        : "schedule_full_retrain";
  return {
    status: overallScore >= 0.72 ? "ready" : overallScore >= 0.52 ? "building" : "warmup",
    score: num(overallScore),
    datasetHealth: num(datasetHealth),
    providerCoverage,
    contextCoverage,
    bootstrapStatus: bootstrap.status || "empty",
    priority,
    paper,
    live,
    note: priority === "schedule_full_retrain"
      ? "Paper, live en datasetkwaliteit zijn sterk genoeg voor een bredere retrain-run."
      : priority === "improve_dataset_quality"
        ? "Retrain-data is al bruikbaar, maar bron/contextdekking of recordkwaliteit moet nog omhoog."
        : priority === "grow_live_dataset"
          ? "Live retrain blijft het dunste pad; hou live streng en gebruik paper voorlopig als hoofdbron."
          : "Paper retrain heeft nog extra closed-trade dekking nodig voor stabielere brede hertraining."
  };
}

export class OfflineTrainer {
  constructor(config) {
    this.config = config;
  }

  buildSummary({ journal = {}, dataRecorder = {}, counterfactuals = [], nowIso = new Date().toISOString() } = {}) {
    const trades = (journal.trades || []).filter((trade) => trade.exitAt);
    const learningReadyTrades = trades.filter((trade) => Number.isFinite(trade.labelScore) && trade.rawFeatures && Object.keys(trade.rawFeatures).length > 0);
    const paperTrades = learningReadyTrades.filter((trade) => (trade.brokerMode || "paper") === "paper");
    const liveTrades = learningReadyTrades.filter((trade) => (trade.brokerMode || "paper") === "live");
    const missedWinners = (counterfactuals || []).filter((item) => ["missed_winner", "bad_veto"].includes(item.outcome));
    const blockedCorrectly = (counterfactuals || []).filter((item) => ["blocked_correctly", "good_veto"].includes(item.outcome));
    const lateVetoes = (counterfactuals || []).filter((item) => item.outcome === "late_veto");
    const timingIssues = (counterfactuals || []).filter((item) => item.outcome === "right_direction_wrong_timing");
    const falsePositives = learningReadyTrades.filter((trade) => (trade.labelScore || 0.5) < 0.45 && (trade.pnlQuote || 0) < 0);
    const falseNegatives = missedWinners.filter((item) => (item.realizedMovePct || 0) > 0.01);
    const strategies = buildBucketMap(learningReadyTrades, (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy);
    const regimes = buildBucketMap(learningReadyTrades, (trade) => trade.regimeAtEntry || "unknown");
    const falsePositiveByStrategy = buildBucketMap(falsePositives, (trade) => trade.strategyAtEntry || trade.entryRationale?.strategy?.activeStrategy);
    const falseNegativeByStrategy = buildBucketMap(falseNegatives, (item) => item.strategy || "blocked_setup", (item) => ({ pnl: 0, win: 1, quality: 0.5, label: 0.8, move: item.realizedMovePct || 0, mode: "paper" }));
    const strategyScorecards = buildStrategyScorecards(learningReadyTrades, falsePositives, falseNegatives);
    const regimeScorecards = buildRegimeScorecards(learningReadyTrades, falsePositives, falseNegatives);
    const blockerScorecards = buildBlockerScorecards(counterfactuals);
    const readinessScore = clamp(
      0.24 +
        Math.min(0.3, learningReadyTrades.length / 80) +
        Math.min(0.16, (dataRecorder.learningFrames || 0) / 60) +
        Math.min(0.1, missedWinners.length / 20) +
        Math.min(0.1, blockedCorrectly.length / 20) +
        Math.min(0.05, lateVetoes.length / 16) +
        Math.min(0.1, falsePositives.length / 24),
      0,
      1
    );
    const thresholdPolicy = buildThresholdPolicy(blockerScorecards, this.config);
    const exitLearning = buildExitLearning(learningReadyTrades);
    const featureDecay = buildFeatureDecay(learningReadyTrades, this.config);
    const retrainReadiness = buildRetrainReadiness({
      paperTrades,
      liveTrades,
      dataRecorder,
      bootstrap: dataRecorder.latestBootstrap || {}
    });
    const calibrationGovernance = buildCalibrationGovernance({
      tradeCount: learningReadyTrades.length,
      falsePositiveCount: falsePositives.length,
      falseNegativeCount: falseNegatives.length,
      readinessScore
    });
    const regimeDeployment = buildRegimeDeployment(regimeScorecards);

    return {
      generatedAt: nowIso,
      learningReadyTrades: learningReadyTrades.length,
      paperTrades: paperTrades.length,
      liveTrades: liveTrades.length,
      learningFrames: dataRecorder.learningFrames || 0,
      decisionFrames: dataRecorder.decisionFrames || 0,
      counterfactuals: {
        total: (counterfactuals || []).length,
        missedWinners: missedWinners.length,
        blockedCorrectly: blockedCorrectly.length,
        lateVetoes: lateVetoes.length,
        timingIssues: timingIssues.length,
        falseNegatives: falseNegatives.length,
        averageMissedMovePct: num(average(missedWinners.map((item) => item.realizedMovePct || 0), 0))
      },
      vetoFeedback: {
        total: (counterfactuals || []).length,
        blockerCount: blockerScorecards.length,
        goodVetoCount: blockedCorrectly.length,
        badVetoCount: missedWinners.length,
        lateVetoCount: lateVetoes.length,
        timingIssueCount: timingIssues.length,
        topBlocker: blockerScorecards[0]?.id || null
      },
      falsePositiveTrades: falsePositives.length,
      falseNegativeTrades: falseNegatives.length,
      strategies: strategies.slice(0, 8),
      regimes: regimes.slice(0, 6),
      strategyScorecards,
      regimeScorecards,
      blockerScorecards,
      thresholdPolicy,
      exitLearning,
      exitScorecards: exitLearning.scorecards || [],
      featureDecay,
      featureDecayScorecards: featureDecay.scorecards || [],
      retrainReadiness,
      calibrationGovernance,
      regimeDeployment,
      falsePositiveByStrategy: falsePositiveByStrategy.slice(0, 6),
      falseNegativeByStrategy: falseNegativeByStrategy.slice(0, 6),
      readinessScore: num(readinessScore),
      status: readinessScore >= 0.72 ? "ready" : readinessScore >= 0.52 ? "building" : "warmup",
      notes: [
        learningReadyTrades.length >= 20
          ? "Er is genoeg gesloten trade-data voor regelmatige offline evaluatie."
          : "Nog extra gesloten trades verzamelen voor sterkere offline training.",
        falseNegatives.length
          ? `${falseNegatives.length} gemiste winnaars zijn bruikbaar voor counterfactual training.`
          : "Nog geen duidelijke false negatives in de counterfactual set.",
        falsePositives.length
          ? `${falsePositives.length} false positives tonen waar de meta-gate strenger mag worden.`
          : "False positive set is nog klein; dat is positief voor de huidige gating.",
        blockerScorecards[0]
          ? `${blockerScorecards[0].id} vraagt momenteel veto-aandacht (${blockerScorecards[0].status}).`
          : "Nog geen veto-feedback met duidelijke blocker-patronen.",
        thresholdPolicy.topRecommendation
          ? `${thresholdPolicy.topRecommendation.id} geeft threshold-advies: ${thresholdPolicy.topRecommendation.action}.`
          : "Threshold-tuning ziet momenteel geen harde aanpassing nodig.",
        exitLearning.topReason
          ? `${exitLearning.topReason} leidt momenteel in exit learning (${exitLearning.status}).`
          : "Nog geen volwassen exit-learning patroon zichtbaar.",
        featureDecay.weakestFeature
          ? `${featureDecay.weakestFeature} toont momenteel de meeste feature decay.`
          : "Feature-decay tracking warmt nog op.",
        retrainReadiness.note,
        calibrationGovernance.note,
        regimeScorecards[0]
          ? `${regimeScorecards[0].id} is het sterkste regime in offline trainer governance.`
          : "Nog geen duidelijke regime-leider in offline trainer.",
        strategyScorecards[0]
          ? `${strategyScorecards[0].id} leidt momenteel in offline trainer governance.`
          : "Nog geen duidelijke strategy-leider in offline trainer."
      ]
    };
  }
}

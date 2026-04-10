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
  const filtered = arr(values).filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((total, value) => total + value, 0) / filtered.length : fallback;
}

function sortTradesChronologically(trades = []) {
  return [...arr(trades)]
    .filter((trade) => trade.exitAt || trade.entryAt)
    .sort((left, right) => new Date(left.exitAt || left.entryAt || 0).getTime() - new Date(right.exitAt || right.entryAt || 0).getTime());
}

function buildCandidateSet(config = {}) {
  const limit = Math.max(6, Math.round(safeNumber(config.adaptiveLearningParameterOptimizationMaxCandidates, 12)));
  const candidates = [
    {
      id: "baseline_safe",
      thresholdShift: 0,
      sizeMultiplier: 1,
      stopLossMultiplier: 1,
      takeProfitMultiplier: 1,
      maxHoldMultiplier: 1,
      exitAggressiveness: 1
    },
    {
      id: "tight_threshold",
      thresholdShift: 0.006,
      sizeMultiplier: 0.97,
      stopLossMultiplier: 0.96,
      takeProfitMultiplier: 1.02,
      maxHoldMultiplier: 0.96,
      exitAggressiveness: 1.06
    },
    {
      id: "loose_threshold_small",
      thresholdShift: -0.004,
      sizeMultiplier: 0.94,
      stopLossMultiplier: 0.98,
      takeProfitMultiplier: 1.04,
      maxHoldMultiplier: 1.02,
      exitAggressiveness: 0.98
    },
    {
      id: "trend_extend",
      thresholdShift: -0.003,
      sizeMultiplier: 1.02,
      stopLossMultiplier: 1.02,
      takeProfitMultiplier: 1.08,
      maxHoldMultiplier: 1.08,
      exitAggressiveness: 0.94
    },
    {
      id: "risk_tight",
      thresholdShift: 0.004,
      sizeMultiplier: 0.93,
      stopLossMultiplier: 0.92,
      takeProfitMultiplier: 0.98,
      maxHoldMultiplier: 0.92,
      exitAggressiveness: 1.08
    },
    {
      id: "hold_longer",
      thresholdShift: -0.002,
      sizeMultiplier: 0.98,
      stopLossMultiplier: 1,
      takeProfitMultiplier: 1.06,
      maxHoldMultiplier: 1.14,
      exitAggressiveness: 0.94
    },
    {
      id: "take_profit_faster",
      thresholdShift: 0.001,
      sizeMultiplier: 0.99,
      stopLossMultiplier: 0.98,
      takeProfitMultiplier: 0.94,
      maxHoldMultiplier: 0.9,
      exitAggressiveness: 1.12
    },
    {
      id: "probe_lighter",
      thresholdShift: -0.001,
      sizeMultiplier: 0.9,
      stopLossMultiplier: 0.96,
      takeProfitMultiplier: 1.03,
      maxHoldMultiplier: 1,
      exitAggressiveness: 1
    },
    {
      id: "sizing_conviction",
      thresholdShift: 0,
      sizeMultiplier: 1.05,
      stopLossMultiplier: 0.99,
      takeProfitMultiplier: 1.04,
      maxHoldMultiplier: 1.02,
      exitAggressiveness: 1
    },
    {
      id: "execution_conservative",
      thresholdShift: 0.003,
      sizeMultiplier: 0.92,
      stopLossMultiplier: 0.97,
      takeProfitMultiplier: 1,
      maxHoldMultiplier: 0.98,
      exitAggressiveness: 1.14
    },
    {
      id: "continuation_bias",
      thresholdShift: -0.002,
      sizeMultiplier: 1,
      stopLossMultiplier: 1.02,
      takeProfitMultiplier: 1.1,
      maxHoldMultiplier: 1.1,
      exitAggressiveness: 0.92
    },
    {
      id: "mean_revert_defensive",
      thresholdShift: 0.004,
      sizeMultiplier: 0.95,
      stopLossMultiplier: 0.94,
      takeProfitMultiplier: 0.98,
      maxHoldMultiplier: 0.92,
      exitAggressiveness: 1.1
    }
  ];
  return candidates.slice(0, limit);
}

function resolveOutcomeTag(trade = {}) {
  return trade.paperLearningOutcome?.outcome || null;
}

function evaluateTradeUnderCandidate(trade = {}, candidate = {}) {
  const rationale = trade.entryRationale || {};
  const probability = safeNumber(rationale.probability, trade.probabilityAtEntry || 0.5);
  const threshold = safeNumber(rationale.threshold, 0.5) + safeNumber(candidate.thresholdShift, 0);
  const taken = probability >= threshold;
  if (!taken) {
    return { taken: false, utility: 0, pnl: 0, win: false, labelScore: 0.5 };
  }

  let pnl = safeNumber(trade.pnlQuote, 0) * safeNumber(candidate.sizeMultiplier, 1);
  const labelScore = clamp(safeNumber(trade.labelScore, 0.5), 0, 1);
  const captureEfficiency = safeNumber(trade.captureEfficiency, 0);
  const outcome = resolveOutcomeTag(trade);
  const exitAggressiveness = safeNumber(candidate.exitAggressiveness, 1);
  const takeProfitMultiplier = safeNumber(candidate.takeProfitMultiplier, 1);
  const stopLossMultiplier = safeNumber(candidate.stopLossMultiplier, 1);
  const maxHoldMultiplier = safeNumber(candidate.maxHoldMultiplier, 1);

  if (outcome === "early_exit" && takeProfitMultiplier > 1) {
    pnl *= 1 + Math.min(0.12, (takeProfitMultiplier - 1) * 0.8);
  }
  if ((outcome === "late_exit" || outcome === "bad_trade") && pnl < 0) {
    pnl *= 1 - Math.min(0.18, Math.max(0, 1 - stopLossMultiplier) * 1.4 + Math.max(0, exitAggressiveness - 1) * 0.08);
  }
  if (outcome === "execution_drag" && pnl < 0) {
    pnl *= 1 - Math.min(0.1, Math.max(0, 1 - safeNumber(candidate.sizeMultiplier, 1)) * 0.8);
  }
  if (captureEfficiency > 0.55 && maxHoldMultiplier > 1) {
    pnl *= 1 + Math.min(0.1, (maxHoldMultiplier - 1) * 0.45);
  }

  const utility = pnl + (labelScore - 0.5) * 42;
  return {
    taken: true,
    utility,
    pnl,
    win: utility > 0,
    labelScore
  };
}

function summarizeEvaluation(results = [], priorAlpha = 2, priorBeta = 2) {
  const taken = results.filter((item) => item.taken);
  const wins = taken.filter((item) => item.win);
  const posteriorAlpha = priorAlpha + wins.length;
  const posteriorBeta = priorBeta + Math.max(0, taken.length - wins.length);
  const posteriorWinRate = posteriorAlpha / Math.max(posteriorAlpha + posteriorBeta, 1);
  const pnlValues = taken.map((item) => item.pnl);
  const utilityValues = taken.map((item) => item.utility);
  const mean = average(utilityValues, 0);
  const variance = average(utilityValues.map((value) => (value - mean) ** 2), 0);
  const stdev = Math.sqrt(Math.max(variance, 0));
  const sharpeLike = stdev > 0 ? mean / stdev : mean > 0 ? 1.5 : 0;
  return {
    tradeCount: taken.length,
    skipCount: results.length - taken.length,
    posteriorWinRate: num(posteriorWinRate),
    avgPnl: num(average(pnlValues, 0), 2),
    avgUtility: num(mean),
    sharpeLike: num(sharpeLike),
    expectancy: num(average(pnlValues, 0), 2),
    score: num(clamp(
      posteriorWinRate * 0.34 +
      clamp(0.5 + average(pnlValues, 0) / 80, 0, 1) * 0.28 +
      clamp(0.5 + mean / 55, 0, 1) * 0.22 +
      clamp(0.5 + sharpeLike / 4, 0, 1) * 0.16,
      0,
      1
    ))
  };
}

function buildWalkForwardSlices(trades = [], windowCount = 4) {
  const ordered = sortTradesChronologically(trades);
  if (ordered.length < 12) {
    return [];
  }
  const usableWindowCount = Math.max(2, Math.min(windowCount, Math.floor(ordered.length / 6)));
  const sliceSize = Math.max(6, Math.floor(ordered.length / usableWindowCount));
  const slices = [];
  for (let start = 0; start + sliceSize <= ordered.length; start += Math.max(3, Math.floor(sliceSize * 0.5))) {
    const windowTrades = ordered.slice(start, start + sliceSize);
    if (windowTrades.length < 6) {
      continue;
    }
    const trainSize = Math.max(4, Math.floor(windowTrades.length * 0.7));
    slices.push({
      train: windowTrades.slice(0, trainSize),
      test: windowTrades.slice(trainSize)
    });
  }
  return slices.slice(0, usableWindowCount);
}

export function buildAdaptiveParameterOptimization({
  journal = {},
  config = {},
  nowIso = new Date().toISOString()
} = {}) {
  const trades = sortTradesChronologically(arr(journal.trades || []).filter((trade) => (trade.rawFeatures || trade.entryRationale) && (trade.exitAt || trade.entryAt)));
  const minTrades = Math.max(12, Math.round(safeNumber(config.adaptiveLearningParameterOptimizationMinTrades, 24)));
  if (trades.length < minTrades) {
    return {
      generatedAt: nowIso,
      status: trades.length ? "warmup" : "empty",
      tradeCount: trades.length,
      autoApply: false,
      livePromotionAllowed: false,
      candidates: [],
      topCandidate: null,
      walkForward: {
        status: "warmup",
        windowCount: 0
      },
      notes: [
        trades.length
          ? `Nog ${Math.max(0, minTrades - trades.length)} closed trades nodig voor parameter-optimalisatie.`
          : "Nog geen closed trades beschikbaar voor parameter-optimalisatie."
      ]
    };
  }

  const priorAlpha = safeNumber(config.optimizerBayesPriorAlpha, 2);
  const priorBeta = safeNumber(config.optimizerBayesPriorBeta, 2);
  const candidates = buildCandidateSet(config).map((candidate) => {
    const allResults = trades.map((trade) => evaluateTradeUnderCandidate(trade, candidate));
    const overall = summarizeEvaluation(allResults, priorAlpha, priorBeta);
    const walkForwardSlices = buildWalkForwardSlices(trades, 4);
    const walkForward = walkForwardSlices.map((slice) => {
      const train = summarizeEvaluation(slice.train.map((trade) => evaluateTradeUnderCandidate(trade, candidate)), priorAlpha, priorBeta);
      const test = summarizeEvaluation(slice.test.map((trade) => evaluateTradeUnderCandidate(trade, candidate)), priorAlpha, priorBeta);
      return {
        trainScore: train.score,
        testScore: test.score,
        scoreGap: num(train.score - test.score),
        trainTrades: train.tradeCount,
        testTrades: test.tradeCount
      };
    });
    const averageTestScore = average(walkForward.map((item) => item.testScore), overall.score);
    const averageGap = average(walkForward.map((item) => item.scoreGap), 0);
    const stability = clamp(1 - Math.abs(averageGap) * 3.5, 0, 1);
    const challengerStatus = averageTestScore >= 0.56 && stability >= 0.52
      ? "challenger_ready"
      : averageTestScore >= 0.5
        ? "observe"
        : "caution";
    return {
      ...candidate,
      ...overall,
      walkForwardAverageTestScore: num(averageTestScore),
      walkForwardAverageGap: num(averageGap),
      stability: num(stability),
      challengerStatus,
      recommendation: challengerStatus === "challenger_ready" ? "promote_to_challenger_only" : "observe_only",
      walkForward
    };
  })
    .sort((left, right) => right.walkForwardAverageTestScore - left.walkForwardAverageTestScore || right.score - left.score);

  const topCandidate = candidates[0] || null;
  return {
    generatedAt: nowIso,
    status: topCandidate ? "active" : "warmup",
    tradeCount: trades.length,
    autoApply: false,
    livePromotionAllowed: false,
    topCandidate: topCandidate ? {
      id: topCandidate.id,
      thresholdShift: num(topCandidate.thresholdShift),
      sizeMultiplier: num(topCandidate.sizeMultiplier),
      stopLossMultiplier: num(topCandidate.stopLossMultiplier),
      takeProfitMultiplier: num(topCandidate.takeProfitMultiplier),
      maxHoldMultiplier: num(topCandidate.maxHoldMultiplier),
      exitAggressiveness: num(topCandidate.exitAggressiveness),
      score: num(topCandidate.score),
      walkForwardAverageTestScore: num(topCandidate.walkForwardAverageTestScore),
      stability: num(topCandidate.stability),
      challengerStatus: topCandidate.challengerStatus,
      recommendation: topCandidate.recommendation
    } : null,
    candidates: candidates.slice(0, Math.max(6, safeNumber(config.adaptiveLearningParameterOptimizationMaxCandidates, 12))).map((item) => ({
      id: item.id,
      thresholdShift: num(item.thresholdShift),
      sizeMultiplier: num(item.sizeMultiplier),
      stopLossMultiplier: num(item.stopLossMultiplier),
      takeProfitMultiplier: num(item.takeProfitMultiplier),
      maxHoldMultiplier: num(item.maxHoldMultiplier),
      exitAggressiveness: num(item.exitAggressiveness),
      tradeCount: item.tradeCount,
      skipCount: item.skipCount,
      posteriorWinRate: num(item.posteriorWinRate),
      avgPnl: num(item.avgPnl, 2),
      avgUtility: num(item.avgUtility),
      sharpeLike: num(item.sharpeLike),
      score: num(item.score),
      walkForwardAverageTestScore: num(item.walkForwardAverageTestScore),
      walkForwardAverageGap: num(item.walkForwardAverageGap),
      stability: num(item.stability),
      challengerStatus: item.challengerStatus,
      recommendation: item.recommendation
    })),
    walkForward: {
      status: "active",
      windowCount: buildWalkForwardSlices(trades, 4).length,
      topCandidateId: topCandidate?.id || null
    },
    notes: [
      topCandidate
        ? `${topCandidate.id} is de beste offline parameter-kandidaat met testscore ${topCandidate.walkForwardAverageTestScore.toFixed(3)}.`
        : "Nog geen parameter-kandidaat beschikbaar.",
      "Parameter-optimalisatie blijft challenger- en walk-forward-only; live auto-promotie blijft uitgeschakeld."
    ]
  };
}

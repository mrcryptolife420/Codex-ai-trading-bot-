import { ProbabilityCalibrator } from "./probabilityCalibrator.js";
import { classifyRegime } from "./regimeModel.js";
import { OnlineTradingModel } from "./onlineModel.js";
import { TransformerChallenger } from "./transformerChallenger.js";
import { buildTradeOutcomeLabel } from "./tradeLabeler.js";
import { clamp } from "../utils/math.js";
import { SequenceChallenger } from "./sequenceChallenger.js";
import { MetaNeuralGateModel } from "./metaNeuralGateModel.js";
import { ExecutionNeuralAdvisor } from "./executionNeuralAdvisor.js";
import { ExitNeuralAdvisor } from "./exitNeuralAdvisor.js";
import { buildCrossTimeframeEncoding } from "./crossTimeframeEncoder.js";

const REGIMES = ["trend", "range", "breakout", "high_vol", "event_risk"];

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

function bootstrapSpecialists(baseState) {
  return Object.fromEntries(
    REGIMES.map((regime) => [regime, OnlineTradingModel.bootstrapState(baseState)])
  );
}

function cloneShadowMetric(metric) {
  return {
    at: metric.at,
    regime: metric.regime,
    championError: metric.championError,
    challengerError: metric.challengerError,
    transformerError: metric.transformerError ?? null,
    sequenceError: metric.sequenceError ?? null,
    target: metric.target
  };
}

function buildDefaultAdaptiveState(legacyState) {
  const championBase = OnlineTradingModel.bootstrapState(legacyState);
  return {
    version: 4,
    champion: {
      specialists: bootstrapSpecialists(championBase)
    },
    challenger: {
      specialists: bootstrapSpecialists(championBase)
    },
    transformer: TransformerChallenger.bootstrapState(),
    sequence: SequenceChallenger.bootstrapState(),
    metaNeural: MetaNeuralGateModel.bootstrapState(),
    executionNeural: ExecutionNeuralAdvisor.bootstrapState(),
    exitNeural: ExitNeuralAdvisor.bootstrapState(),
    calibration: {},
    deployment: {
      active: "champion",
      promotions: [],
      shadowMetrics: [],
      lastPromotionAt: null
    }
  };
}

function normalizeState(state) {
  if (state?.version === 4) {
    return {
      version: 4,
      champion: {
        specialists: Object.fromEntries(
          REGIMES.map((regime) => [
            regime,
            OnlineTradingModel.bootstrapState(state.champion?.specialists?.[regime])
          ])
        )
      },
      challenger: {
        specialists: Object.fromEntries(
          REGIMES.map((regime) => [
            regime,
            OnlineTradingModel.bootstrapState(state.challenger?.specialists?.[regime])
          ])
        )
      },
      transformer: TransformerChallenger.bootstrapState(state.transformer),
      sequence: state.sequence?.version === 1 ? state.sequence : SequenceChallenger.bootstrapState(),
      metaNeural: state.metaNeural?.version === 1 ? state.metaNeural : MetaNeuralGateModel.bootstrapState(),
      executionNeural: state.executionNeural?.version === 1 ? state.executionNeural : ExecutionNeuralAdvisor.bootstrapState(),
      exitNeural: state.exitNeural?.version === 1 ? state.exitNeural : ExitNeuralAdvisor.bootstrapState(),
      calibration: { ...(state.calibration || {}) },
      deployment: {
        active: state.deployment?.active || "champion",
        promotions: [...(state.deployment?.promotions || [])],
        shadowMetrics: [...(state.deployment?.shadowMetrics || [])].map(cloneShadowMetric),
        lastPromotionAt: state.deployment?.lastPromotionAt || null
      }
    };
  }

  if (state?.version === 3 || state?.version === 2) {
    return {
      ...buildDefaultAdaptiveState(),
      champion: {
        specialists: Object.fromEntries(
          REGIMES.map((regime) => [
            regime,
            OnlineTradingModel.bootstrapState(state.champion?.specialists?.[regime])
          ])
        )
      },
      challenger: {
        specialists: Object.fromEntries(
          REGIMES.map((regime) => [
            regime,
            OnlineTradingModel.bootstrapState(state.challenger?.specialists?.[regime])
          ])
        )
      },
      transformer: TransformerChallenger.bootstrapState(state.transformer),
      calibration: { ...(state.calibration || {}) },
      deployment: {
        active: state.deployment?.active || "champion",
        promotions: [...(state.deployment?.promotions || [])],
        shadowMetrics: [...(state.deployment?.shadowMetrics || [])].map(cloneShadowMetric),
        lastPromotionAt: state.deployment?.lastPromotionAt || null
      }
    };
  }

  return buildDefaultAdaptiveState(state);
}

function sumMap(target, source = [], weight = 1) {
  for (const item of Array.isArray(source) ? source : []) {
    const name = item?.name;
    if (!name) {
      continue;
    }
    const current = target.get(name) || { name, contribution: 0, rawValue: 0, weight: 0 };
    current.contribution += safeNumber(item.contribution) * weight;
    current.rawValue += safeNumber(item.rawValue) * weight;
    current.weight += weight;
    target.set(name, current);
  }
}

function buildExpertMix({ context = {}, regimeSummary = {}, timeframeEncoding = {} } = {}) {
  const market = context.marketFeatures || context.marketSnapshot?.market || {};
  const news = context.newsSummary || {};
  const announcement = context.announcementSummary || {};
  const calendar = context.calendarSummary || {};
  const marketStructure = context.marketStructureSummary || {};
  const volatility = context.volatilitySummary || {};
  const book = context.bookFeatures || context.marketSnapshot?.book || {};

  const rawScores = {
    trend: 0.18 + Math.abs(safeNumber(market.emaTrendScore)) * 0.62 + Math.abs(safeNumber(market.momentum20)) * 11 + Math.max(0, safeNumber(timeframeEncoding.encodedTrend)) * 0.28,
    range: 0.18 + Math.max(0, 0.55 - Math.abs(safeNumber(market.emaTrendScore)) * 0.7) * 0.5 + Math.max(0, 0.035 - safeNumber(market.realizedVolPct)) * 10 + Math.max(0, 0.6 - safeNumber(timeframeEncoding.alignmentScore)) * 0.2,
    breakout: 0.18 + Math.abs(safeNumber(market.breakoutPct)) * 26 + Math.abs(safeNumber(book.bookPressure)) * 0.34 + Math.abs(safeNumber(marketStructure.signalScore)) * 0.28 + safeNumber(timeframeEncoding.breakoutAlignment) * 0.2,
    high_vol: 0.18 + safeNumber(market.realizedVolPct) * 14 + safeNumber(volatility.riskScore) * 0.26 + Math.abs(safeNumber(market.bullishPatternScore) - safeNumber(market.bearishPatternScore)) * 0.14,
    event_risk: 0.18 + safeNumber(news.eventRiskScore) * 0.32 + safeNumber(announcement.riskScore) * 0.22 + safeNumber(calendar.riskScore) * 0.2 + safeNumber(volatility.riskScore) * 0.12
  };
  rawScores[regimeSummary.regime || "range"] += 0.28 + safeNumber(regimeSummary.confidence) * 0.14;
  const total = Object.values(rawScores).reduce((sum, value) => sum + Math.max(value, 0.001), 0);
  const weights = Object.fromEntries(
    REGIMES.map((regime) => [regime, clamp(rawScores[regime] / Math.max(total, 1e-9), 0.02, 0.72)])
  );
  const normalizedTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const normalizedWeights = Object.fromEntries(
    REGIMES.map((regime) => [regime, weights[regime] / Math.max(normalizedTotal, 1e-9)])
  );
  const ranked = Object.entries(normalizedWeights).sort((left, right) => right[1] - left[1]);
  return {
    dominantRegime: ranked[0]?.[0] || regimeSummary.regime || "range",
    secondaryRegime: ranked[1]?.[0] || null,
    confidence: num((ranked[0]?.[1] || 0) - (ranked[1]?.[1] || 0) + safeNumber(regimeSummary.confidence) * 0.35, 4),
    weights: Object.fromEntries(ranked.map(([regime, weight]) => [regime, num(weight, 4)])),
    notes: ranked.slice(0, 3).map(([regime, weight]) => `${regime}:${num(weight, 3)}`)
  };
}

function blendModelScores(modelMap, rawFeatures, expertWeights) {
  const byRegime = {};
  const aggregateSignals = new Map();
  let probability = 0;
  let confidence = 0;
  let dominantRegime = "range";
  let dominantWeight = 0;
  let preparedFeatures = {};

  for (const regime of REGIMES) {
    const weight = safeNumber(expertWeights?.[regime], regime === "range" ? 1 : 0);
    if (weight <= 0) {
      continue;
    }
    const result = modelMap[regime].score(rawFeatures);
    byRegime[regime] = {
      weight: num(weight, 4),
      probability: num(result.probability, 4),
      confidence: num(result.confidence, 4)
    };
    probability += result.probability * weight;
    confidence += result.confidence * weight;
    sumMap(aggregateSignals, result.contributions || [], weight);
    if (weight > dominantWeight) {
      dominantWeight = weight;
      dominantRegime = regime;
      preparedFeatures = result.preparedFeatures;
    }
  }

  const contributions = [...aggregateSignals.values()]
    .map((item) => ({
      name: item.name,
      contribution: item.contribution,
      rawValue: item.weight ? item.rawValue / item.weight : 0,
      weight: item.weight ? item.contribution / item.weight : 0
    }))
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .slice(0, 10);

  return {
    probability: clamp(probability, 0, 1),
    confidence: clamp(confidence, 0, 1),
    dominantRegime,
    byRegime,
    preparedFeatures,
    contributions
  };
}

export class AdaptiveTradingModel {
  constructor(state, config) {
    this.config = config;
    this.state = normalizeState(state);
    this.calibrator = new ProbabilityCalibrator(this.state.calibration, config);
    this.models = {
      champion: Object.fromEntries(
        REGIMES.map((regime) => [regime, new OnlineTradingModel(this.state.champion.specialists[regime], config)])
      ),
      challenger: Object.fromEntries(
        REGIMES.map((regime) => [
          regime,
          new OnlineTradingModel(this.state.challenger.specialists[regime], {
            ...config,
            modelLearningRate: config.challengerLearningRate || config.modelLearningRate * 1.35,
            modelL2: config.challengerL2 || config.modelL2 * 0.8
          })
        ])
      )
    };
    this.transformer = new TransformerChallenger(this.state.transformer, config);
    this.sequence = new SequenceChallenger(this.state.sequence, config);
    this.metaNeural = new MetaNeuralGateModel(this.state.metaNeural, config);
    this.executionNeural = new ExecutionNeuralAdvisor(this.state.executionNeural, config);
    this.exitNeural = new ExitNeuralAdvisor(this.state.exitNeural, config);
  }

  getState() {
    this.state.version = 4;
    this.state.calibration = this.calibrator.getState();
    this.state.champion.specialists = Object.fromEntries(
      REGIMES.map((regime) => [regime, this.models.champion[regime].getState()])
    );
    this.state.challenger.specialists = Object.fromEntries(
      REGIMES.map((regime) => [regime, this.models.challenger[regime].getState()])
    );
    this.state.transformer = this.transformer.getState();
    this.state.sequence = this.sequence.getState();
    this.state.metaNeural = this.metaNeural.getState();
    this.state.executionNeural = this.executionNeural.getState();
    this.state.exitNeural = this.exitNeural.getState();
    return this.state;
  }

  getSpecialistStats(regime, symbol) {
    return this.models[this.state.deployment.active][regime].getSymbolStats(symbol);
  }

  getSymbolStats(symbol) {
    const aggregate = {
      trades: 0,
      wins: 0,
      losses: 0,
      avgPnlPct: 0,
      avgLabelScore: 0.5,
      winRate: 0.5,
      lastExitAt: null,
      lastPnlPct: 0
    };
    const stats = REGIMES.map((regime) => this.models[this.state.deployment.active][regime].getSymbolStats(symbol));
    const populated = stats.filter((item) => item.trades > 0);
    if (!populated.length) {
      return aggregate;
    }
    aggregate.trades = populated.reduce((total, item) => total + item.trades, 0);
    aggregate.wins = populated.reduce((total, item) => total + item.wins, 0);
    aggregate.losses = populated.reduce((total, item) => total + item.losses, 0);
    aggregate.avgPnlPct = populated.reduce((total, item) => total + item.avgPnlPct * item.trades, 0) / aggregate.trades;
    aggregate.avgLabelScore = populated.reduce((total, item) => total + item.avgLabelScore * item.trades, 0) / aggregate.trades;
    aggregate.winRate = aggregate.trades ? aggregate.wins / aggregate.trades : 0.5;
    const latest = populated
      .filter((item) => item.lastExitAt)
      .sort((left, right) => new Date(right.lastExitAt).getTime() - new Date(left.lastExitAt).getTime())[0];
    aggregate.lastExitAt = latest?.lastExitAt || null;
    aggregate.lastPnlPct = latest?.lastPnlPct || 0;
    return aggregate;
  }

  inferRegime(context) {
    return classifyRegime(context);
  }

  assessFeatureDrift(rawFeatures, regime = "range") {
    const active = this.state.deployment.active || "champion";
    const normalizedRegime = REGIMES.includes(regime) ? regime : "range";
    return this.models[active][normalizedRegime].assessFeatureDrift(rawFeatures, this.config.driftMinFeatureStatCount || 20);
  }

  scoreExit(context = {}) {
    return this.exitNeural.score(context);
  }

  score(rawFeatures, context = {}) {
    const regimeSummary = context.regimeSummary || this.inferRegime(context);
    const timeframeEncoding = buildCrossTimeframeEncoding({
      marketSnapshot: context.marketSnapshot || {},
      timeframeSummary: context.timeframeSummary || {},
      regimeSummary,
      strategySummary: context.strategySummary || {}
    });
    const expertMix = buildExpertMix({ context, regimeSummary, timeframeEncoding });
    const championScore = blendModelScores(this.models.champion, rawFeatures, expertMix.weights);
    const challengerScore = blendModelScores(this.models.challenger, rawFeatures, expertMix.weights);
    const transformerScore = this.config.enableTransformerChallenger === false
      ? {
          regime: regimeSummary.regime,
          probability: championScore.probability,
          confidence: 0,
          dominantHead: "disabled",
          headScores: {},
          attention: [],
          horizons: [],
          drivers: [],
          query: {}
        }
      : this.transformer.score({
          rawFeatures,
          context: {
            ...context,
            regimeSummary
          }
        });
    const sequenceScore = this.config.enableSequenceChallenger === false
      ? {
          probability: championScore.probability,
          confidence: 0,
          inputs: {},
          drivers: [],
          sampleCount: 0
        }
      : this.sequence.score({
          marketSnapshot: context.marketSnapshot,
          timeframeEncoding
        });
    const calibration = this.calibrator.calibrate(championScore.probability);
    const disagreement = Math.max(
      Math.abs(championScore.probability - challengerScore.probability),
      Math.abs(championScore.probability - transformerScore.probability),
      Math.abs(championScore.probability - sequenceScore.probability),
      Math.abs(challengerScore.probability - transformerScore.probability),
      Math.abs(challengerScore.probability - sequenceScore.probability)
    );
    const rawProbability = championScore.probability;
    const calibrationWarmup = clamp(
      calibration.warmupProgress ?? calibration.globalConfidence ?? calibration.confidence ?? 0,
      0,
      1
    );
    const hasCalibrationGate = calibrationWarmup >= 1;
    const calibrationWeight = 0.08 + calibrationWarmup * 0.2;
    const challengerWeight = 0.14;
    const transformerBlend = clamp(transformerScore.confidence * (0.04 + calibrationWarmup * 0.06), 0, 0.1);
    const sequenceBlend = clamp(sequenceScore.confidence * (0.03 + calibrationWarmup * 0.05), 0, 0.09);
    const championWeight = clamp(1 - calibrationWeight - challengerWeight - transformerBlend - sequenceBlend, 0.45, 0.76);
    const totalWeight = championWeight + calibrationWeight + challengerWeight + transformerBlend + sequenceBlend;
    const blendedProbability = clamp(
      (
        championScore.probability * championWeight +
        calibration.calibratedProbability * calibrationWeight +
        challengerScore.probability * challengerWeight +
        transformerScore.probability * transformerBlend +
        sequenceScore.probability * sequenceBlend
      ) / Math.max(totalWeight, 1e-9),
      0,
      1
    );
    const coldStartConfidence = clamp(
      0.22 + championScore.confidence * 0.44 + regimeSummary.confidence * 0.18 + challengerScore.confidence * 0.06 + sequenceScore.confidence * 0.1,
      0.22,
      0.82
    );
    const calibrationConfidenceRaw = hasCalibrationGate
      ? calibration.confidence * 0.52 + (calibration.globalConfidence || 0) * 0.22 + regimeSummary.confidence * 0.16 + sequenceScore.confidence * 0.1
      : coldStartConfidence;
    const postWarmupFloor = 0.44 + calibrationWarmup * 0.18 + regimeSummary.confidence * 0.08 + sequenceScore.confidence * 0.06;
    const calibrationConfidence = clamp(
      hasCalibrationGate
        ? Math.max(coldStartConfidence, calibrationConfidenceRaw, postWarmupFloor)
        : calibrationConfidenceRaw,
      0,
      1
    );
    const confidenceBase = hasCalibrationGate
      ? calibrationConfidence * 0.48 + transformerScore.confidence * 0.1 + sequenceScore.confidence * 0.12 + 0.24
      : calibrationConfidence * 0.44 + transformerScore.confidence * 0.08 + sequenceScore.confidence * 0.1 + 0.28;
    const confidence = clamp(
      Math.abs(blendedProbability - 0.5) * 2 * confidenceBase,
      0,
      1
    );
    const disagreementLimit = hasCalibrationGate
      ? this.config.maxModelDisagreement
      : this.config.maxModelDisagreement + 0.08;
    const abstainBand = hasCalibrationGate
      ? this.config.abstainBand
      : Math.max(0.01, this.config.abstainBand * 0.55);
    const shouldAbstain =
      (hasCalibrationGate && calibrationConfidence < this.config.minCalibrationConfidence) ||
      regimeSummary.confidence < this.config.minRegimeConfidence ||
      disagreement > disagreementLimit ||
      Math.abs(blendedProbability - 0.5) < abstainBand;

    const metaNeural = this.metaNeural.score({
      score: {
        probability: blendedProbability,
        confidence,
        calibrationConfidence,
        transformerProbability: transformerScore.probability,
        transformer: transformerScore,
        sequence: sequenceScore
      },
      committeeSummary: context.committeeSummary || {},
      strategySummary: context.strategySummary || {},
      marketSnapshot: context.marketSnapshot || {},
      newsSummary: context.newsSummary || {},
      marketStructureSummary: context.marketStructureSummary || {},
      pairHealthSummary: context.pairHealthSummary || {},
      timeframeSummary: context.timeframeSummary || {},
      divergenceSummary: context.divergenceSummary || {},
      threshold: context.threshold || this.config.modelThreshold
    });
    const executionNeural = this.executionNeural.score({
      score: { probability: blendedProbability, confidence },
      marketSnapshot: context.marketSnapshot || {},
      committeeSummary: context.committeeSummary || {},
      strategySummary: context.strategySummary || {},
      pairHealthSummary: context.pairHealthSummary || {},
      timeframeSummary: context.timeframeSummary || {}
    });

    return {
      probability: blendedProbability,
      rawProbability,
      confidence,
      calibrationConfidence,
      disagreement,
      regime: regimeSummary.regime,
      regimeSummary,
      timeframeEncoding,
      expertMix,
      calibrator: calibration,
      championProbability: championScore.probability,
      challengerProbability: challengerScore.probability,
      transformerProbability: transformerScore.probability,
      sequenceProbability: sequenceScore.probability,
      transformer: transformerScore,
      sequence: sequenceScore,
      metaNeural,
      executionNeural,
      shouldAbstain,
      preparedFeatures: championScore.preparedFeatures,
      rawFeatures: { ...rawFeatures },
      contributions: championScore.contributions,
      challengerContributions: challengerScore.contributions,
      expertScores: {
        champion: championScore.byRegime,
        challenger: challengerScore.byRegime
      }
    };
  }

  maybePromote(atIso, promotionPolicy = null) {
    const metrics = this.state.deployment.shadowMetrics.slice(-this.config.challengerWindowTrades);
    const requiredShadowTrades = Math.max(this.config.challengerMinTrades, this.config.modelPromotionMinShadowTrades || 0);
    if (metrics.length < requiredShadowTrades) {
      return null;
    }
    const championError = metrics.reduce((total, item) => total + item.championError, 0) / metrics.length;
    const challengerError = metrics.reduce((total, item) => total + item.challengerError, 0) / metrics.length;
    if (promotionPolicy && !promotionPolicy.allowPromotion) {
      return null;
    }
    if (challengerError + this.config.challengerPromotionMargin >= championError) {
      return null;
    }

    const championSpecialists = Object.fromEntries(
      REGIMES.map((regime) => [regime, this.models.champion[regime].getState()])
    );
    this.models.champion = Object.fromEntries(
      REGIMES.map((regime) => [regime, this.models.challenger[regime]])
    );
    this.models.challenger = Object.fromEntries(
      REGIMES.map((regime) => [
        regime,
        new OnlineTradingModel(championSpecialists[regime], {
          ...this.config,
          modelLearningRate: this.config.challengerLearningRate || this.config.modelLearningRate * 1.35,
          modelL2: this.config.challengerL2 || this.config.modelL2 * 0.8
        })
      ])
    );
    this.state.deployment.promotions.push({
      at: atIso,
      championError,
      challengerError,
      promotedTo: "champion"
    });
    this.state.deployment.lastPromotionAt = atIso;
    this.state.deployment.shadowMetrics = [];
    return {
      championError,
      challengerError
    };
  }

  updateFromTrade(trade) {
    const label = buildTradeOutcomeLabel(trade);
    const atIso = trade.exitAt || new Date().toISOString();
    const regime = trade.regimeAtEntry || "range";
    const rawFeatures = trade.rawFeatures || {};
    const expertWeights = trade.entryRationale?.expertMix?.weights || { [regime]: 1 };
    const championPrediction = blendModelScores(this.models.champion, rawFeatures, expertWeights).probability;
    const challengerPrediction = blendModelScores(this.models.challenger, rawFeatures, expertWeights).probability;
    const transformerLearning = this.transformer.updateFromTrade(trade, label.labelScore);
    const sequenceLearning = this.sequence.updateFromTrade(trade, label);
    const metaNeuralLearning = this.metaNeural.updateFromTrade(trade, label);
    const executionNeuralLearning = this.executionNeural.updateFromTrade(trade, label);
    const exitNeuralLearning = this.exitNeural.updateFromTrade(trade, label);

    const championLearning = this.models.champion[regime].updateFromTrade(
      { ...trade, ...label, labelScore: label.labelScore },
      {
        learningRate: this.config.modelLearningRate,
        l2: this.config.modelL2
      }
    );
    const challengerLearning = this.models.challenger[regime].updateFromTrade(
      { ...trade, ...label, labelScore: label.labelScore },
      {
        learningRate: this.config.challengerLearningRate || this.config.modelLearningRate * 1.35,
        l2: this.config.challengerL2 || this.config.modelL2 * 0.8
      }
    );

    const expertLearning = [];
    for (const [expertRegime, weight] of Object.entries(expertWeights)) {
      if (expertRegime === regime || !REGIMES.includes(expertRegime) || safeNumber(weight) < 0.12) {
        continue;
      }
      const weightFactor = clamp(weight * 0.75, 0.08, 0.42);
      const expertTrade = { ...trade, ...label, labelScore: label.labelScore };
      const championExpert = this.models.champion[expertRegime].updateFromTrade(expertTrade, {
        learningRate: (this.config.modelLearningRate || 0.06) * weightFactor,
        l2: this.config.modelL2
      });
      const challengerExpert = this.models.challenger[expertRegime].updateFromTrade(expertTrade, {
        learningRate: (this.config.challengerLearningRate || this.config.modelLearningRate * 1.35) * weightFactor,
        l2: this.config.challengerL2 || this.config.modelL2 * 0.8
      });
      expertLearning.push({ regime: expertRegime, weight: num(weight, 4), champion: championExpert, challenger: challengerExpert });
    }

    this.calibrator.update(championPrediction, label.labelScore, atIso);
    this.state.deployment.shadowMetrics.push({
      at: atIso,
      regime,
      championError: (championPrediction - label.labelScore) ** 2,
      challengerError: (challengerPrediction - label.labelScore) ** 2,
      transformerError: transformerLearning ? transformerLearning.absoluteError : null,
      sequenceError: sequenceLearning ? Math.abs((trade.entryRationale?.sequence?.probability || 0.5) - label.labelScore) : null,
      target: label.labelScore
    });
    if (this.state.deployment.shadowMetrics.length > this.config.challengerWindowTrades * 2) {
      this.state.deployment.shadowMetrics = this.state.deployment.shadowMetrics.slice(-this.config.challengerWindowTrades * 2);
    }
    const promotion = this.maybePromote(atIso, trade.promotionPolicy || null);

    return {
      label,
      regime,
      championLearning,
      challengerLearning,
      transformerLearning,
      sequenceLearning,
      metaNeuralLearning,
      executionNeuralLearning,
      exitNeuralLearning,
      expertLearning,
      promotion,
      calibration: this.calibrator.getSummary()
    };
  }

  getCalibrationSummary() {
    return this.calibrator.getSummary();
  }

  getTransformerSummary() {
    return this.transformer.getSummary();
  }

  getWeightView() {
    const state = this.getState();
    const active = state[this.getDeploymentSummary().active] || state.champion;
    const linearWeights = Object.entries(active.specialists || {})
      .flatMap(([regime, specialist]) => Object.entries(specialist.weights || {}).map(([name, weight]) => ({ name: `${regime}:${name}`, weight })));
    return [...linearWeights, ...this.transformer.getWeightView()]
      .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight));
  }

  getDeploymentSummary() {
    const metrics = this.state.deployment.shadowMetrics.slice(-this.config.challengerWindowTrades);
    const championError = metrics.length
      ? metrics.reduce((total, item) => total + item.championError, 0) / metrics.length
      : null;
    const challengerError = metrics.length
      ? metrics.reduce((total, item) => total + item.challengerError, 0) / metrics.length
      : null;
    const transformerErrors = metrics.filter((item) => Number.isFinite(item.transformerError)).map((item) => item.transformerError);
    const transformerError = transformerErrors.length
      ? transformerErrors.reduce((total, item) => total + item, 0) / transformerErrors.length
      : null;
    const sequenceErrors = metrics.filter((item) => Number.isFinite(item.sequenceError)).map((item) => item.sequenceError);
    const sequenceError = sequenceErrors.length
      ? sequenceErrors.reduce((total, item) => total + item, 0) / sequenceErrors.length
      : null;
    return {
      active: this.state.deployment.active,
      lastPromotionAt: this.state.deployment.lastPromotionAt,
      promotions: [...this.state.deployment.promotions].slice(-10),
      shadowTradeCount: metrics.length,
      championError,
      challengerError,
      transformerError,
      sequenceError
    };
  }
}

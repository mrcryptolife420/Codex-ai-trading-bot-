import { ProbabilityCalibrator } from "./probabilityCalibrator.js";
import { classifyRegime } from "./regimeModel.js";
import { OnlineTradingModel } from "./onlineModel.js";
import { TransformerChallenger } from "./transformerChallenger.js";
import { buildTradeOutcomeLabel } from "./tradeLabeler.js";
import { clamp } from "../utils/math.js";

const REGIMES = ["trend", "range", "breakout", "high_vol", "event_risk"];

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
    target: metric.target
  };
}

function buildDefaultAdaptiveState(legacyState) {
  const championBase = OnlineTradingModel.bootstrapState(legacyState);
  return {
    version: 3,
    champion: {
      specialists: bootstrapSpecialists(championBase)
    },
    challenger: {
      specialists: bootstrapSpecialists(championBase)
    },
    transformer: TransformerChallenger.bootstrapState(),
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
  if (state?.version === 3) {
    return {
      version: 3,
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

  if (state?.version === 2) {
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
  }

  getState() {
    this.state.version = 3;
    this.state.calibration = this.calibrator.getState();
    this.state.champion.specialists = Object.fromEntries(
      REGIMES.map((regime) => [regime, this.models.champion[regime].getState()])
    );
    this.state.challenger.specialists = Object.fromEntries(
      REGIMES.map((regime) => [regime, this.models.challenger[regime].getState()])
    );
    this.state.transformer = this.transformer.getState();
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

  score(rawFeatures, context = {}) {
    const regimeSummary = context.regimeSummary || this.inferRegime(context);
    const championModel = this.models.champion[regimeSummary.regime];
    const challengerModel = this.models.challenger[regimeSummary.regime];
    const championScore = championModel.score(rawFeatures);
    const challengerScore = challengerModel.score(rawFeatures);
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
    const calibration = this.calibrator.calibrate(championScore.probability);
    const disagreement = Math.max(
      Math.abs(championScore.probability - challengerScore.probability),
      Math.abs(championScore.probability - transformerScore.probability),
      Math.abs(challengerScore.probability - transformerScore.probability)
    );
    const rawProbability = championScore.probability;
    const calibrationWarmup = clamp(
      calibration.warmupProgress ?? calibration.globalConfidence ?? calibration.confidence ?? 0,
      0,
      1
    );
    const hasCalibrationGate = calibrationWarmup >= 1;
    const calibrationWeight = 0.08 + calibrationWarmup * 0.22;
    const challengerWeight = 0.14;
    const transformerBlend = clamp(transformerScore.confidence * (0.04 + calibrationWarmup * 0.06), 0, 0.1);
    const championWeight = clamp(1 - calibrationWeight - challengerWeight - transformerBlend, 0.54, 0.78);
    const totalWeight = championWeight + calibrationWeight + challengerWeight + transformerBlend;
    const blendedProbability = clamp(
      (
        championScore.probability * championWeight +
        calibration.calibratedProbability * calibrationWeight +
        challengerScore.probability * challengerWeight +
        transformerScore.probability * transformerBlend
      ) / Math.max(totalWeight, 1e-9),
      0,
      1
    );
    const coldStartConfidence = clamp(
      0.24 + championScore.confidence * 0.52 + regimeSummary.confidence * 0.24 + challengerScore.confidence * 0.08,
      0.22,
      0.78
    );
    const calibrationConfidence = clamp(
      hasCalibrationGate
        ? calibration.confidence * 0.55 + (calibration.globalConfidence || 0) * 0.25 + regimeSummary.confidence * 0.2
        : coldStartConfidence,
      0,
      1
    );
    const confidenceBase = hasCalibrationGate
      ? calibrationConfidence * 0.58 + transformerScore.confidence * 0.14 + 0.22
      : calibrationConfidence * 0.5 + transformerScore.confidence * 0.12 + 0.28;
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

    return {
      probability: blendedProbability,
      rawProbability,
      confidence,
      calibrationConfidence,
      disagreement,
      regime: regimeSummary.regime,
      regimeSummary,
      calibrator: calibration,
      challengerProbability: challengerScore.probability,
      transformerProbability: transformerScore.probability,
      transformer: transformerScore,
      shouldAbstain,
      preparedFeatures: championScore.preparedFeatures,
      rawFeatures: { ...rawFeatures },
      contributions: championScore.contributions,
      challengerContributions: challengerScore.contributions
    };
  }

  maybePromote(atIso) {
    const metrics = this.state.deployment.shadowMetrics.slice(-this.config.challengerWindowTrades);
    if (metrics.length < this.config.challengerMinTrades) {
      return null;
    }
    const championError = metrics.reduce((total, item) => total + item.championError, 0) / metrics.length;
    const challengerError = metrics.reduce((total, item) => total + item.challengerError, 0) / metrics.length;
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
    const championPrediction = this.models.champion[regime].score(rawFeatures).probability;
    const challengerPrediction = this.models.challenger[regime].score(rawFeatures).probability;
    const transformerLearning = this.transformer.updateFromTrade(trade, label.labelScore);

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

    this.calibrator.update(championPrediction, label.labelScore, atIso);
    this.state.deployment.shadowMetrics.push({
      at: atIso,
      regime,
      championError: (championPrediction - label.labelScore) ** 2,
      challengerError: (challengerPrediction - label.labelScore) ** 2,
      transformerError: transformerLearning ? transformerLearning.absoluteError : null,
      target: label.labelScore
    });
    if (this.state.deployment.shadowMetrics.length > this.config.challengerWindowTrades * 2) {
      this.state.deployment.shadowMetrics = this.state.deployment.shadowMetrics.slice(-this.config.challengerWindowTrades * 2);
    }
    const promotion = this.maybePromote(atIso);

    return {
      label,
      regime,
      championLearning,
      challengerLearning,
      transformerLearning,
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
    return {
      active: this.state.deployment.active,
      lastPromotionAt: this.state.deployment.lastPromotionAt,
      promotions: [...this.state.deployment.promotions].slice(-10),
      shadowTradeCount: metrics.length,
      championError,
      challengerError,
      transformerError
    };
  }
}



import { clamp } from "../utils/math.js";

function safeValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function directionLabel(value) {
  if (value > 0.12) {
    return "bullish";
  }
  if (value < -0.12) {
    return "bearish";
  }
  return "neutral";
}

function buildAgent(id, label, rawStance, rawConfidence, reasons = [], weight = 1, veto = null, meta = {}) {
  return {
    id,
    label,
    stance: clamp(safeValue(rawStance), -1, 1),
    confidence: clamp(safeValue(rawConfidence), 0, 1),
    weight,
    direction: directionLabel(rawStance),
    reasons: reasons.filter(Boolean).slice(0, 4),
    veto,
    meta
  };
}

function average(values = [], fallback = 0) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function isHardPortfolioReason(reason = "") {
  return [
    "cluster_exposure_limit_hit",
    "sector_exposure_limit_hit",
    "pair_correlation_too_high",
    "family_exposure_limit_hit",
    "regime_exposure_limit_hit",
    "strategy_exposure_limit_hit",
    "portfolio_cvar_budget_hit",
    "portfolio_drawdown_budget_hit",
    "regime_kill_switch_active"
  ].includes(reason);
}

function buildPortfolioReasons(portfolioSummary = {}, hardReasons = []) {
  const primaryHardReason = hardReasons[0] || null;
  const reasons = [
    primaryHardReason,
    `corr ${safeValue(portfolioSummary.maxCorrelation).toFixed(2)}`,
    `cluster ${portfolioSummary.sameClusterCount || 0}`,
    `sector ${portfolioSummary.sameSectorCount || 0}`
  ];
  if (primaryHardReason === "family_exposure_limit_hit") {
    reasons.splice(2, 0, `family ${portfolioSummary.sameFamilyCount || 0}`);
  } else if (primaryHardReason === "regime_exposure_limit_hit") {
    reasons.splice(2, 0, `regime ${portfolioSummary.sameRegimeCount || 0}`);
  } else if (primaryHardReason === "strategy_exposure_limit_hit") {
    reasons.splice(2, 0, `strategy ${portfolioSummary.sameStrategyCount || 0}`);
  }
  return reasons.filter(Boolean).slice(0, 4);
}

function buildPortfolioAgentEdge(portfolioSummary = {}, hardReasons = [], botMode = "paper") {
  if (hardReasons.length) {
    return -safeValue(portfolioSummary.maxCorrelation) * 0.8 -
      (portfolioSummary.sameClusterCount || 0) * 0.16 -
      (portfolioSummary.sameSectorCount || 0) * 0.08 +
      (safeValue(portfolioSummary.sizeMultiplier) - 1) * 0.8;
  }
  return clamp(
    (safeValue(portfolioSummary.allocatorScore, 0.5) - 0.5) * 0.7 +
      (safeValue(portfolioSummary.sizeMultiplier, 1) - 1) * 0.35 -
      safeValue(portfolioSummary.maxCorrelation) * (botMode === "paper" ? 0.28 : 0.4) -
      (portfolioSummary.sameClusterCount || 0) * 0.08 -
      (portfolioSummary.sameSectorCount || 0) * 0.04,
    botMode === "paper" ? -0.38 : -0.52,
    0.18
  );
}

function buildPortfolioAgentConfidence(portfolioSummary = {}, hardReasons = [], botMode = "paper") {
  if (hardReasons.length) {
    return 0.72;
  }
  return clamp(
    0.32 +
      safeValue(portfolioSummary.maxCorrelation) * (botMode === "paper" ? 0.22 : 0.3) +
      Math.max(0, 1 - safeValue(portfolioSummary.sizeMultiplier, 1)) * 0.16 +
      Math.max(0, 0.5 - safeValue(portfolioSummary.allocatorScore, 0.5)) * 0.24,
    0.28,
    botMode === "paper" ? 0.56 : 0.64
  );
}

export class MultiAgentCommittee {
  constructor(config) {
    this.config = config;
  }

  evaluate({ symbol, score, transformerScore, marketSnapshot, newsSummary, announcementSummary = {}, marketStructureSummary = {}, marketSentimentSummary = {}, volatilitySummary = {}, calendarSummary = {}, portfolioSummary = {}, regimeSummary = {}, strategySummary = {}, executionPlan = null, rlAdvice = null }) {
    if (this.config.enableMultiAgentCommittee === false) {
      return {
        symbol,
        probability: score.probability,
        confidence: score.confidence,
        agreement: 1 - (score.disagreement || 0),
        netScore: (score.probability - 0.5) * 2,
        sizeMultiplier: 1,
        vetoes: [],
        allow: true,
        bullishAgents: [],
        bearishAgents: [],
        agents: []
      };
    }
    const book = marketSnapshot.book || {};
    const market = marketSnapshot.market || {};
    const agents = [];

    agents.push(
      buildAgent(
        "champion_model",
        "Champion model",
        (safeValue(score.probability) - 0.5) * 2,
        Math.max(safeValue(score.confidence), safeValue(score.calibrationConfidence) * 0.9),
        [
          `prob ${safeValue(score.probability).toFixed(3)}`,
          `cal ${safeValue(score.calibrationConfidence).toFixed(3)}`,
          `spread ${safeValue(book.spreadBps).toFixed(2)}bps`
        ],
        1.3,
        safeValue(score.disagreement) > this.config.maxModelDisagreement ? "model_disagreement" : null,
        {
          disagreement: safeValue(score.disagreement)
        }
      )
    );

    agents.push(
      buildAgent(
        "transformer",
        "Transformer challenger",
        (safeValue(transformerScore?.probability) - 0.5) * 2,
        safeValue(transformerScore?.confidence),
        [
          `h1 ${safeValue(transformerScore?.horizons?.[0]?.probability).toFixed(3)}`,
          `h3 ${safeValue(transformerScore?.horizons?.[1]?.probability).toFixed(3)}`,
          `head ${transformerScore?.dominantHead || "trend"}`
        ],
        1.1,
        safeValue(transformerScore?.confidence) >= this.config.transformerMinConfidence && Math.abs(safeValue(transformerScore?.probability) - safeValue(score.probability)) > this.config.maxModelDisagreement
          ? "transformer_disagreement"
          : null,
        {
          dominantHead: transformerScore?.dominantHead || "trend"
        }
      )
    );

    const newsEdge = safeValue(newsSummary.sentimentScore) + safeValue(newsSummary.socialSentiment) * 0.35 - safeValue(newsSummary.riskScore) * 0.8 - safeValue(newsSummary.socialRisk) * 0.25;
    agents.push(
      buildAgent(
        "news_social",
        "News + social",
        newsEdge,
        clamp(safeValue(newsSummary.confidence) * 0.8 + Math.min(0.25, safeValue(newsSummary.coverage) * 0.04), 0, 1),
        [
          `${newsSummary.coverage || 0} nieuws`,
          `${newsSummary.socialCoverage || 0} social`,
          `event ${newsSummary.dominantEventType || "general"}`
        ],
        0.95,
        safeValue(newsSummary.riskScore) > 0.82 ? "news_risk" : null
      )
    );

    const orderflowEdge = safeValue(book.bookPressure) * 0.9 + safeValue(book.microPriceEdgeBps) / 18 + safeValue(book.weightedDepthImbalance) * 0.25 + safeValue(book.tradeFlowImbalance) * 0.35;
    agents.push(
      buildAgent(
        "orderflow",
        "Orderflow",
        orderflowEdge,
        clamp(0.35 + Math.min(0.55, Math.abs(orderflowEdge) * 0.4), 0, 1),
        [
          `pressure ${safeValue(book.bookPressure).toFixed(2)}`,
          `micro ${safeValue(book.microPriceEdgeBps).toFixed(2)}bps`,
          `flow ${safeValue(book.tradeFlowImbalance).toFixed(2)}`
        ],
        1,
        safeValue(book.bookPressure) < -0.6 ? "orderflow_sell_pressure" : null
      )
    );

    const patternEdge = safeValue(market.bullishPatternScore) * 0.9 - safeValue(market.bearishPatternScore) * 1.1 + (safeValue(market.momentum5) > 0 ? 0.06 : -0.04);
    agents.push(
      buildAgent(
        "patterns",
        "Pattern detector",
        patternEdge,
        clamp(0.3 + Math.max(safeValue(market.bullishPatternScore), safeValue(market.bearishPatternScore)) * 0.45, 0, 1),
        [
          market.dominantPattern || "none",
          `bull ${safeValue(market.bullishPatternScore).toFixed(2)}`,
          `bear ${safeValue(market.bearishPatternScore).toFixed(2)}`
        ],
        0.8,
        safeValue(market.bearishPatternScore) > 0.82 ? "pattern_breakdown" : null
      )
    );

    const regimeEdge = safeValue(regimeSummary.bias) * 0.9 + (regimeSummary.regime === "trend" || regimeSummary.regime === "breakout" ? 0.08 : 0);
    agents.push(
      buildAgent(
        "regime",
        "Regime agent",
        regimeEdge,
        safeValue(regimeSummary.confidence),
        [...(regimeSummary.reasons || []).slice(0, 3)],
        0.85,
        safeValue(regimeSummary.confidence) < this.config.minRegimeConfidence ? "regime_low_confidence" : null
      )
    );

    const activeStrategy = strategySummary.strategyMap?.[strategySummary.activeStrategy] || (strategySummary.strategies || [])[0] || {};
    const strategyEdge = (safeValue(strategySummary.fitScore) - 0.5) * 1.8 + safeValue(strategySummary.optimizerBoost) * 0.85 - (strategySummary.blockers || []).length * 0.12;
    agents.push(
      buildAgent(
        "strategy_router",
        "Strategy router",
        strategyEdge,
        safeValue(strategySummary.confidence),
        [
          strategySummary.strategyLabel || activeStrategy.label || "strategy",
          strategySummary.familyLabel || activeStrategy.familyLabel || "family",
          ...((strategySummary.reasons || activeStrategy.reasons || []).slice(0, 3))
        ],
        0.94,
        safeValue(strategySummary.confidence) >= this.config.strategyMinConfidence && (strategySummary.blockers || []).length
          ? "strategy_context_mismatch"
          : null,
        {
          activeStrategy: strategySummary.activeStrategy || activeStrategy.id || null,
          fitScore: safeValue(strategySummary.fitScore)
        }
      )
    );

    const macroEdge = safeValue(marketSentimentSummary.contrarianScore) * 0.55 - safeValue(marketSentimentSummary.riskScore) * 0.42 - safeValue(volatilitySummary.riskScore) * 0.38;
    agents.push(
      buildAgent(
        "macro_volatility",
        "Macro + volatility",
        macroEdge,
        clamp(0.32 + safeValue(marketSentimentSummary.confidence) * 0.3 + safeValue(volatilitySummary.confidence) * 0.3, 0, 1),
        [
          marketSentimentSummary.fearGreedValue == null ? "fear/greed n/a" : `fg ${safeValue(marketSentimentSummary.fearGreedValue).toFixed(0)}`,
          volatilitySummary.marketOptionIv == null ? "iv n/a" : `iv ${safeValue(volatilitySummary.marketOptionIv).toFixed(1)}`,
          volatilitySummary.regime || "unknown"
        ],
        0.78,
        safeValue(volatilitySummary.riskScore) > 0.88 ? "volatility_stress" : null
      )
    );

    const structureEdge = safeValue(marketStructureSummary.signalScore) * 0.82 - safeValue(marketStructureSummary.riskScore) * 0.88 - safeValue(calendarSummary.riskScore) * 0.5 - safeValue(announcementSummary.riskScore) * 0.42 - safeValue(volatilitySummary.riskScore) * 0.18 + safeValue(marketSentimentSummary.contrarianScore) * 0.08;
    agents.push(
      buildAgent(
        "market_structure",
        "Structure + calendar",
        structureEdge,
        clamp(0.4 + (safeValue(marketStructureSummary.confidence) || 0) * 0.34 + (safeValue(calendarSummary.confidence) || 0) * 0.16 + (safeValue(volatilitySummary.confidence) || 0) * 0.1, 0, 1),
        [
          `funding ${safeValue(marketStructureSummary.fundingRate).toFixed(5)}`,
          `oi ${safeValue(marketStructureSummary.openInterestChangePct * 100).toFixed(2)}%`,
          calendarSummary.nextEventType ? `${calendarSummary.nextEventType} ${safeValue(calendarSummary.proximityHours).toFixed(1)}u` : "geen event"
        ],
        0.92,
        safeValue(calendarSummary.riskScore) > 0.82 || safeValue(announcementSummary.riskScore) > 0.82 || safeValue(volatilitySummary.riskScore) > 0.88 ? "event_hazard" : null
      )
    );

    const portfolioHardReasons = (portfolioSummary.hardReasons || portfolioSummary.reasons || []).filter((reason) => isHardPortfolioReason(reason));
    const portfolioEdge = buildPortfolioAgentEdge(portfolioSummary, portfolioHardReasons, this.config.botMode);
    const portfolioConfidence = buildPortfolioAgentConfidence(portfolioSummary, portfolioHardReasons, this.config.botMode);
    agents.push(
      buildAgent(
        "portfolio",
        "Portfolio agent",
        portfolioEdge,
        portfolioConfidence,
        buildPortfolioReasons(portfolioSummary, portfolioHardReasons),
        0.7,
        portfolioHardReasons.length ? "portfolio_overlap" : null
      )
    );

    const executionEdge = executionPlan
      ? (executionPlan.preferMaker ? 0.08 : 0.02) + safeValue(executionPlan.queueScore) * 0.25 + safeValue(executionPlan.tradeFlow) * 0.16
      : 0;
    agents.push(
      buildAgent(
        "execution",
        "Execution agent",
        executionEdge,
        executionPlan ? 0.62 : 0.2,
        executionPlan
          ? [executionPlan.entryStyle, `queue ${safeValue(executionPlan.queueScore).toFixed(2)}`, `patience ${executionPlan.makerPatienceMs}ms`]
          : ["no-plan"],
        0.55,
        null
      )
    );

    const rlEdge = rlAdvice ? safeValue(rlAdvice.expectedReward) * 0.8 + (safeValue(rlAdvice.sizeMultiplier) - 1) * 0.4 : 0;
    agents.push(
      buildAgent(
        "rl_execution",
        "RL execution policy",
        rlEdge,
        rlAdvice ? safeValue(rlAdvice.confidence) : 0,
        rlAdvice
          ? [rlAdvice.action, rlAdvice.bucket, `size ${safeValue(rlAdvice.sizeMultiplier).toFixed(2)}`]
          : ["inactive"],
        0.5,
        null
      )
    );

    const vetoes = agents.filter((agent) => agent.veto).map((agent) => ({ id: agent.veto, agent: agent.id, label: agent.label }));
    const totalWeight = Math.max(agents.reduce((total, agent) => total + agent.weight * agent.confidence, 0), 1e-9);
    const netScore = agents.reduce((total, agent) => total + agent.stance * agent.confidence * agent.weight, 0) / totalWeight;
    const stances = agents.map((agent) => agent.stance);
    const stanceMean = average(stances, 0);
    const variance = average(stances.map((value) => (value - stanceMean) ** 2), 0);
    const agreement = clamp(1 - variance * 0.95 - Math.min(0.35, Math.abs(safeValue(score.disagreement)) * 0.5), 0, 1);
    const probability = clamp(safeValue(score.probability) * 0.58 + (0.5 + netScore * 0.5) * 0.42, 0, 1);
    const confidence = clamp(average(agents.map((agent) => agent.confidence), 0) * 0.55 + agreement * 0.45, 0, 1);
    const sizeMultiplier = clamp(0.72 + Math.max(0, netScore) * 0.25 + agreement * 0.12 - vetoes.length * 0.12, 0.32, 1.18);

    return {
      symbol,
      probability,
      confidence,
      agreement,
      netScore,
      sizeMultiplier,
      vetoes,
      allow: vetoes.length === 0 && probability >= Math.max(this.config.modelThreshold - 0.03, 0.55),
      bullishAgents: agents.filter((agent) => agent.stance > 0.06).slice(0, 5),
      bearishAgents: agents.filter((agent) => agent.stance < -0.06).slice(0, 5),
      agents
    };
  }
}


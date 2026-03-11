function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function num(value, digits = 4) {
  return Number(safeNumber(value).toFixed(digits));
}

export class CapitalLadder {
  constructor(config) {
    this.config = config;
  }

  buildSnapshot({
    botMode = "paper",
    modelRegistry = {},
    strategyResearch = {},
    deployment = {},
    report = {},
    nowIso = new Date().toISOString()
  } = {}) {
    const promotionPolicy = modelRegistry.promotionPolicy || {};
    const liveTrades = report?.modes?.live?.tradeCount || report?.windows?.today?.tradeCount || 0;
    const approvedResearchCount = strategyResearch.approvedCandidateCount || 0;
    let stage = "paper";
    let sizeMultiplier = 1;
    const blockerReasons = [];

    if (botMode !== "live") {
      stage = "paper";
      sizeMultiplier = 1;
    } else if (!promotionPolicy.allowPromotion) {
      stage = "shadow";
      sizeMultiplier = 0;
      blockerReasons.push(...(promotionPolicy.blockerReasons || []));
    } else if (promotionPolicy.probationRequired || promotionPolicy.readyLevel === "probation") {
      stage = "seed";
      sizeMultiplier = this.config.capitalLadderSeedMultiplier || 0.18;
    } else if (liveTrades < (this.config.canaryLiveTradeCount || 6)) {
      stage = "canary";
      sizeMultiplier = this.config.canaryLiveSizeMultiplier || 0.25;
    } else if ((promotionPolicy.liveQualityScore || 0) < 0.62 || approvedResearchCount < (this.config.capitalLadderMinApprovedCandidates || 1)) {
      stage = "scaled";
      sizeMultiplier = this.config.capitalLadderScaledMultiplier || 0.55;
    } else {
      stage = "full";
      sizeMultiplier = this.config.capitalLadderFullMultiplier || 1;
    }

    return {
      generatedAt: nowIso,
      stage,
      allowEntries: botMode !== "live" || stage !== "shadow",
      sizeMultiplier: num(sizeMultiplier),
      approvedResearchCount,
      liveTradeCount: liveTrades,
      promotionReadyLevel: promotionPolicy.readyLevel || null,
      blockerReasons,
      notes: [
        stage === "shadow"
          ? "Live bot blijft in shadow-stage tot promotiebeleid en governance groen zijn."
          : `Capital ladder staat in ${stage}-stage met ${Math.round(sizeMultiplier * 100)}% sizing.`,
        approvedResearchCount
          ? `${approvedResearchCount} research-kandidaten zijn paper-waardig.`
          : "Nog geen research-kandidaten zijn paper-waardig."
      ]
    };
  }
}

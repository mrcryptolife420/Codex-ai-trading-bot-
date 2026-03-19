import { ExternalFeedRegistry } from "../runtime/externalFeedRegistry.js";

export class SourceReliabilityEngine {
  constructor(config) {
    this.config = config;
    this.registry = new ExternalFeedRegistry(config);
  }

  getProviderState(runtime, providerId) {
    return this.registry.getFeedState(runtime, providerId, {
      group: "news",
      legacyBucket: "newsSourceHealth"
    });
  }

  shouldUseProvider(runtime, providerId, nowIso = new Date().toISOString()) {
    return this.registry.shouldUse(runtime, providerId, nowIso, {
      group: "news",
      legacyBucket: "newsSourceHealth",
      minOperationalScore: this.config.sourceReliabilityMinOperationalScore
    });
  }

  noteSuccess(runtime, providerId, nowIso = new Date().toISOString()) {
    return this.registry.noteSuccess(runtime, providerId, nowIso, {
      group: "news",
      legacyBucket: "newsSourceHealth"
    });
  }

  noteFailure(runtime, providerId, errorMessage = "", nowIso = new Date().toISOString()) {
    return this.registry.noteFailure(runtime, providerId, errorMessage, nowIso, {
      group: "news",
      legacyBucket: "newsSourceHealth"
    });
  }

  buildSummary(runtime = {}, nowIso = new Date().toISOString()) {
    const newsSummary = this.registry.buildSummary(runtime, {
      group: "news",
      nowIso,
      minOperationalScore: this.config.sourceReliabilityMinOperationalScore
    });
    const externalFeeds = this.registry.buildSummary(runtime, {
      nowIso,
      excludeGroups: ["news"],
      minOperationalScore: this.config.sourceReliabilityMinOperationalScore
    });
    return {
      ...newsSummary,
      notes: newsSummary.notes,
      externalFeeds
    };
  }
}

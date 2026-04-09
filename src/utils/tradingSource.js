function normalizeRawSource(source = "") {
  return `${source || ""}`.trim().toLowerCase();
}

export function canonicalizeTradingSource(source = null, botMode = "paper") {
  const normalizedSource = normalizeRawSource(source);
  if (botMode === "live" || normalizedSource === "live") {
    return "live";
  }
  if (
    !normalizedSource ||
    normalizedSource === "paper" ||
    normalizedSource === "internal" ||
    normalizedSource === "paper_internal"
  ) {
    return "paper:internal";
  }
  if (normalizedSource.startsWith("paper:")) {
    return normalizedSource;
  }
  return `paper:${normalizedSource}`;
}

export function getConfiguredTradingSource(config = {}, botMode = config?.botMode || "paper") {
  if (botMode === "live") {
    return "live";
  }
  return canonicalizeTradingSource(config?.paperExecutionVenue || "internal", "paper");
}

export function getRuntimeTradingSource(runtime = {}, config = {}, botMode = config?.botMode || "paper") {
  if (botMode === "live") {
    return "live";
  }
  if (typeof runtime?.portfolioSnapshotMode === "string" && runtime.portfolioSnapshotMode.trim()) {
    return canonicalizeTradingSource(runtime.portfolioSnapshotMode, "paper");
  }
  return getConfiguredTradingSource(config, "paper");
}

export function resolveItemTradingSource(item = {}, botMode = "paper") {
  if ((item?.brokerMode || botMode) === "live") {
    return "live";
  }
  if (typeof item?.portfolioSnapshotMode === "string" && item.portfolioSnapshotMode.trim()) {
    return canonicalizeTradingSource(item.portfolioSnapshotMode, "paper");
  }
  if (typeof item?.executionVenue === "string" && item.executionVenue.trim()) {
    return canonicalizeTradingSource(item.executionVenue, "paper");
  }
  if (typeof item?.paperExecutionVenue === "string" && item.paperExecutionVenue.trim()) {
    return canonicalizeTradingSource(item.paperExecutionVenue, "paper");
  }
  if ((item?.brokerMode || botMode) === "paper") {
    return "paper:internal";
  }
  return canonicalizeTradingSource(botMode, botMode);
}

export function matchesBrokerMode(item, botMode = "paper") {
  return !item?.brokerMode || item.brokerMode === botMode;
}

export function matchesTradingSource(item, tradingSource = null, botMode = "paper") {
  if (!matchesBrokerMode(item, botMode)) {
    return false;
  }
  if (botMode !== "paper") {
    return true;
  }
  const normalizedSource = canonicalizeTradingSource(tradingSource, "paper");
  const itemSource = resolveItemTradingSource(item, botMode);
  return itemSource === normalizedSource;
}

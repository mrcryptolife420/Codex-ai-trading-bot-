function toNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function round(value, digits = 4) {
  return Number(toNumber(value, 0).toFixed(digits));
}

export function buildCoreMetricsView({ report = {}, overview = {} } = {}) {
  return {
    tradeCount: toNumber(report.tradeCount, 0),
    realizedPnl: round(report.realizedPnl, 2),
    winRate: round(report.winRate, 4),
    averagePnlPct: round(report.averagePnlPct, 4),
    maxDrawdownPct: round(report.maxDrawdownPct, 4),
    openExposure: round(report.openExposure ?? overview.openExposure, 2),
    quoteFree: round(overview.quoteFree, 2),
    equity: round(overview.equity, 2)
  };
}

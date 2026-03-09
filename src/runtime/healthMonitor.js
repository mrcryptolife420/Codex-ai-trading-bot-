import { intervalToMs, nowIso } from "../utils/time.js";

function appendWarning(runtime, warning) {
  runtime.health = runtime.health || {
    consecutiveFailures: 0,
    circuitOpen: false,
    reason: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    warnings: []
  };
  runtime.health.warnings = [warning, ...(runtime.health.warnings || [])].slice(0, 20);
}

export class HealthMonitor {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  validateSnapshot(symbol, marketSnapshot, runtime, atIso = nowIso()) {
    const issues = [];
    const lastCandle = marketSnapshot.candles[marketSnapshot.candles.length - 1];
    const intervalMs = intervalToMs(this.config.klineInterval) || 0;
    if (!lastCandle) {
      issues.push("missing_candles");
    } else {
      const stalenessMs = new Date(atIso).getTime() - lastCandle.closeTime;
      if (
        intervalMs &&
        stalenessMs > intervalMs * this.config.maxKlineStalenessMultiplier
      ) {
        issues.push("stale_candles");
      }
    }

    if (!marketSnapshot.book.bid || !marketSnapshot.book.ask) {
      issues.push("missing_order_book_prices");
    }
    if (marketSnapshot.book.ask < marketSnapshot.book.bid) {
      issues.push("crossed_order_book");
    }

    if (issues.length) {
      appendWarning(runtime, {
        at: atIso,
        symbol,
        issues
      });
    }
    return issues;
  }

  enforceClockDrift(client, runtime) {
    const driftMs = Math.abs(client.getClockOffsetMs());
    if (driftMs <= this.config.maxServerTimeDriftMs) {
      return [];
    }
    const issues = ["clock_drift_too_large"];
    appendWarning(runtime, {
      at: nowIso(),
      issues,
      driftMs
    });
    return issues;
  }

  recordSuccess(runtime) {
    runtime.health = runtime.health || {};
    runtime.health.consecutiveFailures = 0;
    runtime.health.circuitOpen = false;
    runtime.health.reason = null;
    runtime.health.lastSuccessAt = nowIso();
  }

  recordFailure(runtime, error) {
    runtime.health = runtime.health || {};
    runtime.health.consecutiveFailures = (runtime.health.consecutiveFailures || 0) + 1;
    runtime.health.lastFailureAt = nowIso();
    appendWarning(runtime, {
      at: runtime.health.lastFailureAt,
      issues: ["cycle_failure"],
      error: error.message
    });
    if (runtime.health.consecutiveFailures >= this.config.healthMaxConsecutiveFailures) {
      runtime.health.circuitOpen = true;
      runtime.health.reason = "too_many_consecutive_failures";
      this.logger?.warn?.("Trading circuit opened", {
        failures: runtime.health.consecutiveFailures
      });
    }
  }

  canEnterNewPositions(runtime) {
    return !(runtime.health?.circuitOpen);
  }

  getStatus(runtime) {
    return runtime.health || {
      consecutiveFailures: 0,
      circuitOpen: false,
      reason: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      warnings: []
    };
  }
}

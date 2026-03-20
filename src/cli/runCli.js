import { runBacktest } from "../runtime/backtestRunner.js";
import { TradingBot } from "../runtime/tradingBot.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runContinuousBot({ bot, config, logger, sleepFn = sleep, signalSource = process }) {
  let stopRequested = false;
  let stopWaiter = null;
  const signalHandlers = [];
  const requestStop = (reason = "signal") => {
    if (stopRequested) {
      return;
    }
    stopRequested = true;
    logger?.warn?.("Stopping run loop", { reason });
    if (stopWaiter) {
      const resolve = stopWaiter;
      stopWaiter = null;
      resolve();
    }
  };
  const installSignalHandlers = () => {
    if (!signalSource?.on || !signalSource?.off) {
      return;
    }
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => requestStop(signal);
      signalSource.on(signal, handler);
      signalHandlers.push([signal, handler]);
    }
  };
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      signalSource.off(signal, handler);
    }
  };
  installSignalHandlers();
  try {
    while (!stopRequested) {
      try {
        const result = await bot.runCycle();
        logger.info("Cycle complete", {
          equity: result.equity.toFixed(2),
          quoteFree: result.quoteFree.toFixed(2),
          openPositions: result.openPositions,
          circuitOpen: result.health.circuitOpen
        });
      } catch (error) {
        logger.error("Cycle failed", {
          error: error.message
        });
      }
      if (stopRequested) {
        break;
      }
      await Promise.race([
        sleepFn(config.tradingIntervalSeconds * 1000),
        new Promise((resolve) => {
          stopWaiter = resolve;
        })
      ]);
      stopWaiter = null;
    }
  } finally {
    removeSignalHandlers();
  }
}

export default async function runCli({ command, args, config, logger, botFactory = ({ config: cfg, logger: log }) => new TradingBot({ config: cfg, logger: log }), sleepFn = sleep, signalSource = process }) {
  if (command === "dashboard") {
    const { startDashboardServer } = await import("../dashboard/server.js");
    const dashboard = await startDashboardServer({
      projectRoot: config.projectRoot,
      logger,
      port: config.dashboardPort
    });
    console.log(
      JSON.stringify(
        {
          command: "dashboard",
          url: dashboard.url,
          port: dashboard.port
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "backtest") {
    const symbol = (args[0] || config.watchlist[0] || "BTCUSDT").toUpperCase();
    const result = await runBacktest({ config, logger, symbol });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const bot = botFactory({ config, logger });
  await bot.init();

  try {
    if (command === "run") {
      await runContinuousBot({ bot, config, logger, sleepFn, signalSource });
      return;
    }

    if (command === "once") {
      const result = await bot.runCycle();
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "status") {
      const status = await bot.getStatus();
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    if (command === "doctor") {
      const doctor = await bot.runDoctor();
      console.log(JSON.stringify(doctor, null, 2));
      return;
    }

    if (command === "report") {
      const report = await bot.getReport();
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (command === "research") {
      const symbols = args.map((arg) => `${arg}`.trim().toUpperCase()).filter(Boolean);
      const research = await bot.runResearch({ symbols });
      console.log(JSON.stringify(research, null, 2));
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    await bot.close().catch(() => {});
  }
}

import { runBacktest } from "../runtime/backtestRunner.js";
import { TradingBot } from "../runtime/tradingBot.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function runCli({ command, args, config, logger }) {
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

  const bot = new TradingBot({ config, logger });
  await bot.init();

  if (command === "run") {
    while (true) {
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
      await sleep(config.tradingIntervalSeconds * 1000);
    }
  }

  try {
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
      const status = await bot.getStatus();
      console.log(JSON.stringify(status.report, null, 2));
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

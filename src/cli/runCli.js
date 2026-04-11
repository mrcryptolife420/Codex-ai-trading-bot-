import { runBacktest } from "../runtime/backtestRunner.js";
import { runHistoryCommand } from "../runtime/marketHistory.js";
import { TradingBot } from "../runtime/tradingBot.js";
import { BotManager } from "../runtime/botManager.js";

function shouldUseReadOnlyInit(command) {
  return ["status", "doctor", "report", "learning"].includes(command);
}

const BOT_COMMANDS = new Set(["run", "once", "status", "doctor", "report", "learning", "research", "scan"]);

async function runContinuousManagedBot({ config, logger, signalSource = process }) {
  const manager = new BotManager({ projectRoot: config.projectRoot, logger });
  let stopRequested = false;
  let stopWaiter = null;
  const signalHandlers = [];
  const requestStop = (reason = "signal") => {
    if (stopRequested) {
      return;
    }
    stopRequested = true;
    logger?.warn?.("Stopping managed run loop", { reason });
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
    await manager.init();
    await manager.start();
    while (!stopRequested) {
      await new Promise((resolve) => {
        stopWaiter = resolve;
      });
    }
  } finally {
    removeSignalHandlers();
    await manager.stop("cli_signal").catch(() => {});
  }
}

export default async function runCli({
  command,
  args,
  config,
  logger,
  botFactory = ({ config: cfg, logger: log }) => new TradingBot({ config: cfg, logger: log }),
  dashboardFactory = async ({ projectRoot, logger: log, port }) => {
    const { startDashboardServer } = await import("../dashboard/server.js");
    return startDashboardServer({ projectRoot, logger: log, port });
  },
  signalSource = process
}) {
  if (command === "dashboard") {
    const dashboard = await dashboardFactory({
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
    await (dashboard.waitUntilClosed || new Promise(() => {}));
    return;
  }

  if (command === "backtest") {
    const symbol = (args[0] || config.watchlist[0] || "BTCUSDT").toUpperCase();
    const result = await runBacktest({ config, logger, symbol });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "history") {
    const result = await runHistoryCommand({ config, logger, args });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "download-history") {
    const symbol = (args[0] || "BTCUSDT").toUpperCase();
    const interval = args[1] || "15m";
    const days = Number(args[2]) || 90;
    const {
      loadHistoricalKlines,
      summarizeHistoricalData
    } = await import("../market/historicalDataLoader.js");
    const historical = await loadHistoricalKlines(symbol, interval, days);
    const summary = summarizeHistoricalData({ [symbol]: historical });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (!BOT_COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  if (command === "run") {
    await runContinuousManagedBot({ config, logger, signalSource });
    return;
  }

  const bot = botFactory({ config, logger });
  await bot.init({
    command,
    readOnly: shouldUseReadOnlyInit(command),
    enableStreams: !shouldUseReadOnlyInit(command) && command !== "scan"
  });

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
      const report = await bot.getReport();
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (command === "learning") {
      const learning = await bot.getAdaptiveLearningStatus();
      console.log(JSON.stringify(learning, null, 2));
      return;
    }

    if (command === "research") {
      const symbols = args.map((arg) => `${arg}`.trim().toUpperCase()).filter(Boolean);
      const research = await bot.runResearch({ symbols });
      console.log(JSON.stringify(research, null, 2));
      return;
    }

    if (command === "scan") {
      const symbols = args.map((arg) => `${arg}`.trim().toUpperCase()).filter(Boolean);
      const scan = await bot.runMarketScanner({ symbols });
      console.log(JSON.stringify(scan, null, 2));
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    await bot.close().catch(() => {});
  }
}

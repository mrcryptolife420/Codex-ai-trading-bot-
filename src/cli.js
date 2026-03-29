import { loadConfig } from "./config/index.js";
import { createLogger } from "./utils/logger.js";

async function main() {
  const command = process.argv[2] || "run";
  const config = await loadConfig();
  const logger = createLogger(process.env.LOG_LEVEL || "info", {
    writer: command === "run"
      ? undefined
      : (line) => {
          process.stderr.write(`${line}\n`);
        }
  });
  const { default: runCli } = await import("./cli/runCli.js");
  await runCli({
    command,
    args: process.argv.slice(3),
    config,
    logger
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

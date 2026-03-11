import { loadConfig } from "./config/index.js";
import { createLogger } from "./utils/logger.js";

async function main() {
  const config = await loadConfig();
  const logger = createLogger(process.env.LOG_LEVEL || "info");
  const { default: runCli } = await import("./cli/runCli.js");
  await runCli({
    command: process.argv[2] || "run",
    args: process.argv.slice(3),
    config,
    logger
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

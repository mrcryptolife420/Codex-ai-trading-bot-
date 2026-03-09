function formatContext(context = {}) {
  const entries = Object.entries(context).filter(
    ([, value]) => value !== undefined && value !== null
  );
  if (entries.length === 0) {
    return "";
  }
  return ` ${entries
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join(" ")}`;
}

export class Logger {
  constructor(level = "info") {
    this.level = level;
    this.order = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40
    };
  }

  shouldLog(level) {
    return this.order[level] >= this.order[this.level];
  }

  log(level, message, context) {
    if (!this.shouldLog(level)) {
      return;
    }
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${level.toUpperCase()} ${message}${formatContext(context)}`;
    console.log(line);
  }

  debug(message, context) {
    this.log("debug", message, context);
  }

  info(message, context) {
    this.log("info", message, context);
  }

  warn(message, context) {
    this.log("warn", message, context);
  }

  error(message, context) {
    this.log("error", message, context);
  }
}

export function createLogger(level) {
  return new Logger(level);
}

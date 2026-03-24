// Structured logger — outputs JSON to stderr
// Requirements: 21.1, 21.2

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  timestamp: string; // ISO 8601
  message: string;
  context?: Record<string, unknown>;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLevel(raw: string | undefined): LogLevel {
  if (raw && raw in LEVELS) return raw as LogLevel;
  return "info";
}

const configuredLevel: LogLevel = parseLevel(process.env.LOG_LEVEL?.toLowerCase());

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[configuredLevel]) return;

  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...(context !== undefined ? { context } : {}),
  };

  process.stderr.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    log("debug", message, context);
  },
  info(message: string, context?: Record<string, unknown>): void {
    log("info", message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    log("warn", message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    log("error", message, context);
  },
};

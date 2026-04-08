type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

type LogMethodLevel = LogLevel | "warn";

type LogSinkPayload = {
  level: LogLevel;
  logger?: string;
  data: Record<string, unknown>;
};

type LogSink = (payload: LogSinkPayload) => void;

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
};

const LEVEL_ALIASES: Record<string, LogLevel> = {
  warn: "warning",
};

let currentLevel: LogLevel = parseLevel(process.env.LOG_LEVEL?.toLowerCase());
const sinks = new Set<LogSink>();

function parseLevel(raw: string | undefined): LogLevel {
  if (!raw) return "info";
  const normalized = LEVEL_ALIASES[raw] || raw;
  if (normalized in LEVELS) return normalized as LogLevel;
  return "info";
}

function normalizeMethodLevel(level: LogMethodLevel): LogLevel {
  return level === "warn" ? "warning" : level;
}

function formatContextForStderr(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return "";
  return ` ${JSON.stringify(context)}`;
}

function getMcpIcon(message: string): string {
  if (message.includes("search")) return "🔍";
  if (message.includes("store") || message.includes("write")) return "💾";
  if (message.includes("read") || message.includes("resource")) return "📖";
  if (message.includes("delete")) return "🗑️";
  if (message.includes("update")) return "🔄";
  if (message.includes("acknowledge")) return "✅";
  if (message.includes("recap")) return "📋";
  if (message.includes("task")) return "⚡";
  return "🤖";
}

function deriveLoggerName(message: string): string | undefined {
  if (message.startsWith("[Server]")) return "server";
  if (message.startsWith("[Vectors]")) return "vectors";
  if (message.startsWith("[MCP]")) return "mcp";
  if (message.startsWith("[Dashboard]")) return "dashboard";
  return "app";
}

function emitToStderr(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();

  if (message.startsWith("[MCP]")) {
    const icon = getMcpIcon(message);
    const action = message.replace("[MCP] ", "").trim();
    process.stderr.write(`${timestamp} ${icon} [MCP] ${action.padEnd(7)}${formatContextForStderr(context)}\n`);
    return;
  }

  const levelStr = level.toUpperCase().padEnd(9);
  process.stderr.write(`${timestamp} [${levelStr}] ${message}${formatContextForStderr(context)}\n`);
}

function sanitizeLogData(message: string, context?: Record<string, unknown>) {
  return {
    message,
    ...(context ?? {}),
  };
}

function emitToSinks(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const payload: LogSinkPayload = {
    level,
    logger: deriveLoggerName(message),
    data: sanitizeLogData(message, context),
  };

  for (const sink of sinks) {
    try {
      sink(payload);
    } catch {
      // Sinks must never break the main logger path.
    }
  }
}

function log(level: LogMethodLevel, message: string, context?: Record<string, unknown>): void {
  const normalizedLevel = normalizeMethodLevel(level);
  if (LEVELS[normalizedLevel] < LEVELS[currentLevel]) return;

  emitToStderr(normalizedLevel, message, context);
  emitToSinks(normalizedLevel, message, context);
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    log("debug", message, context);
  },
  info(message: string, context?: Record<string, unknown>): void {
    log("info", message, context);
  },
  notice(message: string, context?: Record<string, unknown>): void {
    log("notice", message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    log("warn", message, context);
  },
  warning(message: string, context?: Record<string, unknown>): void {
    log("warning", message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    log("error", message, context);
  },
  critical(message: string, context?: Record<string, unknown>): void {
    log("critical", message, context);
  },
  alert(message: string, context?: Record<string, unknown>): void {
    log("alert", message, context);
  },
  emergency(message: string, context?: Record<string, unknown>): void {
    log("emergency", message, context);
  },
};

export function setLogLevel(level: string): LogLevel {
  const raw = level.toLowerCase();
  const normalized = LEVEL_ALIASES[raw] || raw;
  if (!(normalized in LEVELS)) {
    const error = new Error(`Invalid log level: ${level}`) as Error & { code?: number };
    error.code = -32602;
    throw error;
  }
  currentLevel = normalized;
  return currentLevel;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function addLogSink(sink: LogSink) {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function clearLogSinks() {
  sinks.clear();
}

export const LOG_LEVEL_VALUES = Object.keys(LEVELS) as LogLevel[];

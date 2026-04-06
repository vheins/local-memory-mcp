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

let currentLevel: LogLevel = parseLevel(process.env.LOG_LEVEL?.toLowerCase());

function formatContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return "";
  return Object.entries(context)
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${key}=null`;
      const valStr = typeof value === "string" && (value.includes(" ") || value.includes("\"")) 
        ? JSON.stringify(value) 
        : String(value);
      return `${key}=${valStr}`;
    })
    .join(" ");
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

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const timestamp = new Date().toISOString();
  
  if (message.startsWith("[MCP]")) {
    const icon = getMcpIcon(message);
    const action = message.replace("[MCP] ", "").trim();
    const ctxStr = formatContext(context);
    
    // Example: 2026-03-31T07:14:38.745Z 🔍 [MCP] search repo=agentic-dashboard hits=1
    process.stderr.write(`${timestamp} ${icon} [MCP] ${action.padEnd(7)} ${ctxStr}\n`);
  } else {
    const levelStr = level.toUpperCase().padEnd(5);
    const ctxStr = context ? ` ${JSON.stringify(context)}` : "";
    
    // Example: 2026-03-31T07:14:38.745Z [INFO ] Model loaded successfully.
    process.stderr.write(`${timestamp} [${levelStr}] ${message}${ctxStr}\n`);
  }
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

export function setLogLevel(level: string): LogLevel {
  currentLevel = parseLevel(level.toLowerCase());
  return currentLevel;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export const LOG_LEVEL_VALUES = Object.keys(LEVELS) as LogLevel[];

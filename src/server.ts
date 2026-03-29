#!/usr/bin/env node
import readline from "node:readline";
import { createRouter } from "./router.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { RealVectorStore } from "./storage/vectors.js";
import { CAPABILITIES } from "./capabilities.js";
import { logger } from "./utils/logger.js";

// Create storage instances
const db = new SQLiteStore();
const vectors = new RealVectorStore(db);

// Optional: Automatic cleanup of expired/low-utility memories (default: disabled)
const expiredArchived = db.archiveExpiredMemories();
const lowScoreArchived = db.archiveLowScoreMemories();
const totalArchived = (expiredArchived || 0) + (lowScoreArchived || 0);

if (totalArchived > 0) {
  logger.info(`[Server] Archived ${totalArchived} memories (expired: ${expiredArchived}, low-score: ${lowScoreArchived}) on startup.`);
}

// Ignore EPIPE errors on stdout/stderr (e.g. if the client disconnects prematurely)
process.stdout.on('error', (err: any) => {
  if (err.code === 'EPIPE') return;
  logger.error("stdout error", { error: String(err) });
});

process.stderr.on('error', (err: any) => {
  if (err.code === 'EPIPE') return;
  logger.error("stderr error", { error: String(err) });
});

// Wire router with injected storage
const handleMethod = createRouter(db, vectors);

// Cleanup on exit
process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  db.close();
  process.exit(0);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function reply(payload: unknown) {
  try {
    process.stdout.write(JSON.stringify(payload) + "\n");
  } catch (err: any) {
    // Other errors still logged
    logger.error("Reply error", { error: String(err) });
  }
}

rl.on("line", async (line) => {
  if (!line.trim()) return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = msg;

  // --- initialize ---
  if (method === "initialize") {
    reply({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: CAPABILITIES.serverInfo,
        capabilities: CAPABILITIES.capabilities
      }
    });

    reply({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    });
    return;
  }

  // --- ignore notification ---
  if (method === "notifications/initialized") return;

  // --- route method ---
  try {
    const result = await handleMethod(method, params);

    reply({
      jsonrpc: "2.0",
      id,
      result
    });
  } catch (err: any) {
    logger.error("Method handler error", { method, id, message: err.message });
    reply({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err.message || "Internal error"
      }
    });
  }
});

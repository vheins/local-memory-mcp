#!/usr/bin/env node
import readline from "node:readline";
import { createRouter } from "./router.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { RealVectorStore } from "./storage/vectors.js";
import { CAPABILITIES } from "./capabilities.js";
import { logger } from "./utils/logger.js";
import fs from "fs";
import path from "path";

// --- CLI Doctor Mode ---
if (process.argv.includes("doctor")) {
  console.log("\n🏥 MCP Local Memory - System Diagnosis\n");
  
  const db = new SQLiteStore();
  const dbPath = db.getDbPath();
  
  console.log(`📂 Database Path: ${dbPath}`);
  console.log(`📄 Database Status: ${fs.existsSync(dbPath) ? "✅ Exists" : "❌ Not Found"}`);
  
  try {
    const stats = db.getStats();
    console.log(`📊 Memory Count: ${stats.total} entries`);
    console.log(`✅ SQLite Connection: Functional`);
  } catch (err) {
    console.log(`❌ SQLite Connection: Failed (${String(err)})`);
  }

  console.log(`🤖 AI Model: Xenova/all-MiniLM-L6-v2`);
  console.log(`⚙️  Mode: Local-First (ONNX Runtime)`);
  
  const isAutoArchive = process.env.ENABLE_AUTO_ARCHIVE === "true";
  console.log(`📉 Auto-Archive: ${isAutoArchive ? "Enabled" : "Disabled (Default)"}`);
  
  console.log("\n✨ Diagnosis complete.\n");
  process.exit(0);
}

// Create storage instances
const db = new SQLiteStore();
const vectors = new RealVectorStore(db);

// Pre-load vector model in background to avoid initial request timeout
vectors.initialize().catch(err => {
  logger.warn("[Server] Initial vector model loading failed. Will retry on first use.", { error: String(err) });
});

// Optional: Automatic cleanup of expired/low-utility memories (default: disabled)
// ... (rest of cleanup code) ...
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
  const isNotification = id === undefined || id === null;

  // --- initialize (Request) ---
  if (method === "initialize" && !isNotification) {
    reply({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: CAPABILITIES.serverInfo,
        capabilities: CAPABILITIES.capabilities
      }
    });
    return;
  }

  // --- notifications ---
  if (isNotification) {
    // We ignore all notifications by default, especially standard ones
    if (method === "notifications/initialized") {
        logger.debug("[Server] Client initialized");
    } else if (method === "notifications/cancelled") {
        logger.debug("[Server] Request cancelled by client", { params });
    }
    return;
  }

  // --- route request ---
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

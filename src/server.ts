#!/usr/bin/env node
import readline from "node:readline";
import { createRouter } from "./router.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { RealVectorStore } from "./storage/vectors.js";
import { CAPABILITIES, MCP_PROTOCOL_VERSION } from "./capabilities.js";
import {
  createSessionContext,
  extractRootsFromResult,
  updateSessionFromInitialize,
  updateSessionRoots,
} from "./mcp/session.js";
import { addLogSink, logger } from "./utils/logger.js";
import fs from "fs";
import path from "path";

// --- CLI Doctor Mode ---
if (process.argv.includes("doctor")) {
  process.stderr.write("\n🏥 MCP Local Memory - System Diagnosis\n\n");
  
  const db = new SQLiteStore();
  const dbPath = db.getDbPath();
  
  process.stderr.write(`📂 Database Path: ${dbPath}\n`);
  process.stderr.write(`📄 Database Status: ${fs.existsSync(dbPath) ? "✅ Exists" : "❌ Not Found"}\n`);
  
  try {
    const stats = db.getStats();
    process.stderr.write(`📊 Memory Count: ${stats.total} entries\n`);
    process.stderr.write(`✅ SQLite Connection: Functional\n`);
  } catch (err) {
    process.stderr.write(`❌ SQLite Connection: Failed (${String(err)})\n`);
  }

  process.stderr.write(`🤖 AI Model: Xenova/all-MiniLM-L6-v2\n`);
  process.stderr.write(`⚙️  Mode: Local-First (ONNX Runtime)\n`);
  
  const isAutoArchive = process.env.ENABLE_AUTO_ARCHIVE === "true";
  process.stderr.write(`📉 Auto-Archive: ${isAutoArchive ? "Enabled" : "Disabled (Default)"}\n`);
  
  process.stderr.write("\n✨ Diagnosis complete.\n\n");
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
const session = createSessionContext();
const resourceSubscriptions = new Set<string>();
let logNotificationsEnabled = false;
const handleMethod = createRouter(db, vectors, {
  getSessionContext: () => session,
  sampleMessage: (params) => requestClient("sampling/createMessage", params) as Promise<any>,
  elicit: (params) => requestClient("elicitation/create", params) as Promise<any>,
  onResourcesMutated: (uris) => notifyUpdatedResources(uris),
});

addLogSink((payload) => {
  if (!logNotificationsEnabled) {
    return;
  }

  reply({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: payload,
  });
});

// Cleanup on exit
process.on("SIGINT", () => {
  for (const pending of pendingClientRequests.values()) {
    pending.reject(new Error("Server stopped"));
  }
  pendingClientRequests.clear();
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  for (const pending of pendingClientRequests.values()) {
    pending.reject(new Error("Server stopped"));
  }
  pendingClientRequests.clear();
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

let isInitialized = false;
const activeRequests = new Map<string | number, AbortController>();
const pendingClientRequests = new Map<string | number, {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}>();
let outgoingRequestId = 0;

function requestClient(method: string, params: unknown = {}) {
  const id = `server:${++outgoingRequestId}`;

  reply({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });

  return new Promise((resolve, reject) => {
    pendingClientRequests.set(id, { method, resolve, reject });
  });
}

async function refreshRoots(trigger: string) {
  if (!session.supportsRoots) return;

  try {
    const result = await requestClient("roots/list");
    const changed = updateSessionRoots(session, extractRootsFromResult(result));
    logger.info("[Server] Refreshed client roots", {
      trigger,
      count: session.roots.length,
      changed,
    });

    if (changed) {
      reply({
        jsonrpc: "2.0",
        method: "notifications/resources/list_changed",
      });
      reply({
        jsonrpc: "2.0",
        method: "notifications/prompts/list_changed",
      });
    }
  } catch (error) {
    logger.warn("[Server] Failed to refresh client roots", {
      trigger,
      error: String(error),
    });
  }
}

function notifyUpdatedResources(uris: string[]) {
  const seen = new Set<string>();
  for (const uri of uris) {
    if (seen.has(uri)) continue;
    seen.add(uri);

    if (!resourceSubscriptions.has(uri)) {
      continue;
    }

    reply({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri },
    });
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

  if ((method === undefined || method === null) && id !== undefined && pendingClientRequests.has(id)) {
    const pending = pendingClientRequests.get(id)!;
    pendingClientRequests.delete(id);

    if (msg.error) {
      pending.reject(new Error(msg.error.message || `Client request failed: ${pending.method}`));
    } else {
      pending.resolve(msg.result);
    }
    return;
  }

  // --- initialize (Request) ---
  if (method === "initialize" && !isNotification) {
    updateSessionFromInitialize(session, params);
    reply({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
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
        isInitialized = true;
        logNotificationsEnabled = true;
        logger.debug("[Server] Client initialized");
        void refreshRoots("initialized");
    } else if (method === "notifications/roots/list_changed") {
        logger.debug("[Server] Client roots changed");
        void refreshRoots("roots/list_changed");
    } else if (method === "notifications/cancelled") {
        const requestId = params?.requestId;
        if (requestId !== undefined && activeRequests.has(requestId)) {
            activeRequests.get(requestId)!.abort();
            activeRequests.delete(requestId);
            logger.debug(`[Server] Request ${requestId} cancelled`);
        } else {
            logger.debug(`[Server] Cancelled notification for unknown or completed request ${requestId}`);
        }
    }
    return;
  }

  // --- ping (Request) ---
  if (method === "ping") {
    reply({
      jsonrpc: "2.0",
      id,
      result: {}
    });
    return;
  }

  if (method === "resources/subscribe") {
    const uri = typeof params?.uri === "string" ? params.uri : "";
    if (!uri) {
      reply({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: "resources/subscribe requires a uri",
        }
      });
      return;
    }

    resourceSubscriptions.add(uri);
    reply({
      jsonrpc: "2.0",
      id,
      result: {},
    });
    return;
  }

  if (method === "resources/unsubscribe") {
    const uri = typeof params?.uri === "string" ? params.uri : "";
    if (!uri) {
      reply({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: "resources/unsubscribe requires a uri",
        }
      });
      return;
    }

    resourceSubscriptions.delete(uri);
    reply({
      jsonrpc: "2.0",
      id,
      result: {},
    });
    return;
  }

  // --- Ensure initialized before processing other requests ---
  if (!isInitialized) {
    reply({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32002,
        message: "Server is not fully initialized yet. Please send notifications/initialized."
      }
    });
    return;
  }

  const abortController = new AbortController();
  activeRequests.set(id, abortController);

  const progressToken = params?._meta?.progressToken;
  const onProgress = progressToken !== undefined ? (progress: number, total?: number) => {
    reply({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: {
        progressToken,
        progress,
        total
      }
    });
  } : undefined;

  // --- route request ---
  try {
    const result = await handleMethod(method, params, abortController.signal, onProgress);

    if (!abortController.signal.aborted) {
      reply({
        jsonrpc: "2.0",
        id,
        result
      });
    }
  } catch (err: any) {
    if (!abortController.signal.aborted) {
      logger.error("Method handler error", { method, id, message: err.message });
      reply({
        jsonrpc: "2.0",
        id,
        error: {
          code: typeof err?.code === "number" ? err.code : -32603,
          message: err.message || "Internal error"
        }
      });
    }
  } finally {
    activeRequests.delete(id);
  }
});

#!/usr/bin/env node
// Mark this process as an MCP server to disable stderr logging (stdin/stdout used for JSON-RPC)
process.env.MCP_SERVER = "true";

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./mcp-server";
import { updateSessionFromInitialize } from "./session";
import { SQLiteStore } from "./storage/sqlite";
import { RealVectorStore } from "./storage/vectors";
import { CapabilityAwareVectorStore } from "./storage/lazy-vectors";
import { EmbeddingWorker } from "./embedding-queue";
import { RuntimeCapabilityRegistry, setRuntimeCapabilities } from "./runtime-capabilities";
import { CAPABILITIES } from "./capabilities";
import { addLogSink, createFileSink, logger } from "./utils/logger";
import { runStartupMaintenance } from "./services/maintenance-job";
import { runCliIndex } from "./codebase-index/cli";
import { autoIndexIfStale } from "./codebase-index/services/indexing-service";
import { getCodebaseParserPool } from "./codebase-index/parser/singleton";
import { FileWatcher, registerRepo } from "./codebase-index/services/file-watcher";
import fs from "fs";
import path from "path";

// --- CLI Doctor Mode ---
if (process.argv.includes("doctor")) {
	process.stderr.write("\n🏥 MCP Local Memory - System Diagnosis\n\n");

	const db = await SQLiteStore.create();
	const dbPath = db.getDbPath();

	process.stderr.write(`📂 Database Path: ${dbPath}\n`);
	process.stderr.write(`📄 Database Status: ${fs.existsSync(dbPath) ? "✅ Exists" : "❌ Not Found"}\n`);

	try {
		const stats = db.system.getGlobalStats();
		process.stderr.write(`📊 Memory Count: ${stats.totalMemories} entries\n`);
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

// --- CLI Index Mode ---
if (process.argv.includes("--index")) {
	await runCliIndex();
	// runCliIndex always calls process.exit(0|1) — unreachable
}

// --- Process-level crash containment (Fix #2) ---
// Node >= 15 terminates the process on ANY escaping rejection or uncaught
// exception. The codebase-index pipeline (sync WASM parses, DB writes) can
// throw from paths outside our try/catch reach — register handlers so a
// single escaping error logs and continues instead of killing the MCP server.
//
// Startup guard (TASK-051): these handlers are installed BEFORE the top-level
// `await SQLiteStore.create()` and vector-model init. In ESM, a rejection in a
// top-level await aborts module evaluation — with a handler installed Node no
// longer exits, and the process would hang with no server and no stdio
// listener. `serverStarted` flips only when serveStdio is about to run, so any
// pre-start failure always terminates with a clean non-zero exit.
let serverStarted = false;

process.on("unhandledRejection", (reason: unknown) => {
	if (!serverStarted) {
		logger.error("[Server] Unhandled promise rejection during startup — exiting", {
			pid: process.pid,
			error: reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason)
		});
		process.exit(1);
	}
	logger.error("[Server] Unhandled promise rejection", {
		pid: process.pid,
		error: reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason)
	});
});

process.on("uncaughtException", (err: Error) => {
	if (!serverStarted) {
		logger.error("[Server] Uncaught exception during startup — exiting", {
			pid: process.pid,
			error: err.message,
			stack: err.stack ?? ""
		});
		process.exit(1);
	}
	logger.error("[Server] Uncaught exception", {
		pid: process.pid,
		error: err.message,
		stack: err.stack ?? ""
	});
});

// Create the core store first. Optional engines are registered below and
// initialized through one single-flight capability registry.
const db = await SQLiteStore.create();
const realVectors = new RealVectorStore(db);
const runtimeCapabilities = new RuntimeCapabilityRegistry();
setRuntimeCapabilities(runtimeCapabilities);
const vectors = new CapabilityAwareVectorStore(realVectors, runtimeCapabilities);

// Register file log sink (same dir as DB, retain last 5 files) BEFORE the
// embedding worker starts (TASK-457 fix8): embeddingWorker.start() runs the
// startup reconcile/backfill immediately, which is exactly the window where
// a multi-process "database is locked" burst is logged — a sink registered
// after start() would lose those first failure logs.
addLogSink(createFileSink(path.dirname(db.getDbPath())));

// Start the embedding/KG outbox worker (TASK-013): drains queue_jobs with
// batched ONNX inference + KG extraction OUTSIDE the write lock. Startup
// reconcile/backfill/purge run inside the worker.
const embeddingWorker = new EmbeddingWorker(db, realVectors);
runtimeCapabilities.register("semantic", async () => {
	// Preserve the worker's independent retry/maintenance loop even if the
	// first ONNX initialization fails.
	embeddingWorker.start();
	await realVectors.initialize();
});

// Parser and watcher objects are not constructed until their capabilities are
// demanded. All paths still share the process-wide parser singleton.
let fileWatcher: FileWatcher | null = null;
runtimeCapabilities.register("indexing", () => getCodebaseParserPool().initialize());
runtimeCapabilities.register("watcher", () => {
	fileWatcher ??= new FileWatcher(db, getCodebaseParserPool());
	fileWatcher.start();
});
if (process.env.ENABLE_FILE_WATCHER === "false") {
	runtimeCapabilities.disable("watcher", "Disabled via ENABLE_FILE_WATCHER=false");
}
runtimeCapabilities.register("maintenance", async () => {
	const result = await runStartupMaintenance(db);
	if (!result.skipped) {
		logger.info("[Server] Startup maintenance complete", {
			decayed: result.decay.decayed,
			archived: result.expiredArchived + result.lowScoreArchived + result.decay.archived
		});
	}
});

logger.info("[Server] startup", {
	pid: process.pid,
	version: CAPABILITIES.serverInfo.version,
	db: db.getDbPath(),
	profile: runtimeCapabilities.profile
});

if (runtimeCapabilities.profile === "full") {
	try {
		await Promise.race([
			runtimeCapabilities.ensure("semantic"),
			new Promise((_, reject) => setTimeout(() => reject(new Error("Semantic warm-up timed out after 30s")), 30000))
		]);
	} catch (error) {
		logger.warn("[Server] Semantic warm-up failed. Will retry on first use.", { error: String(error) });
	}
	void runtimeCapabilities.ensure("maintenance");
}

// Run startup auto-index: triggers codebase indexing for the current working
// directory if the index has never been built or is older than TTL (default
// 24h). Respects CODEBASE_AUTO_INDEX env var. The parser pool (hoisted above,
// shared with the file watcher) is initialized asynchronously and indexing
// runs in the background; the dashboard polls /api/codebase/index-status.
// The repo is registered with the file watcher so the polling sweep keeps it
// fresh after the first build (watch set = startup repo + tool-indexed repos).
if (runtimeCapabilities.profile === "full" && process.env.CODEBASE_AUTO_INDEX !== "false") {
	const repoName = path.basename(process.cwd());
	const repoPath = process.cwd();
	registerRepo(repoName, repoPath);
	void runtimeCapabilities.ensure("indexing").then((ready) => {
		if (!ready) return;
		void autoIndexIfStale(repoName, repoPath, db, getCodebaseParserPool())
			.then((result) => {
				logger.info("[Server] Auto-index check complete", {
					repo: repoName,
					status: result.status,
					reason: result.reason
				});
				void runtimeCapabilities.ensure("watcher");
			})
			.catch((err) => {
				runtimeCapabilities.markDegraded("indexing", String(err));
				logger.warn("[Server] Auto-index check failed", { error: String(err) });
			});
	});
}

// Ignore EPIPE errors on stdout/stderr (e.g. if the client disconnects prematurely)
process.stdout.on("error", (err: unknown) => {
	if ((err as Record<string, unknown>).code === "EPIPE") return;
	logger.error("stdout error", { error: String(err) });
});

process.stderr.on("error", (err: unknown) => {
	if ((err as Record<string, unknown>).code === "EPIPE") return;
	logger.error("stderr error", { error: String(err) });
});

// Cleanup on exit
const shutdown = async (signal: string) => {
	logger.info("[Server] shutdown", { signal, pid: process.pid });
	embeddingWorker.stop();
	fileWatcher?.stop();
	await handle?.close();
	db.close();
	process.exit(0);
};

process.on(
	"SIGINT",
	() =>
		void shutdown("SIGINT").catch((err) => {
			logger.error("[Server] shutdown error", { error: String(err) });
		})
);
process.on(
	"SIGTERM",
	() =>
		void shutdown("SIGTERM").catch((err) => {
			logger.error("[Server] shutdown error", { error: String(err) });
		})
);

// Start the MCP stdio server using the SDK — startup is now complete, so a
// runtime failure may log+continue instead of exiting (TASK-051).
serverStarted = true;
const handle = serveStdio(() => {
	const { server, ctx } = createMcpServer(db, vectors);

	// Wire oninitialized to capture client info from the initialize handshake
	server.server.oninitialized = () => {
		try {
			const clientVer = server.server.getClientVersion();
			if (clientVer) {
				ctx.clientName = clientVer.name;
				ctx.clientVersion = clientVer.version;
				ctx.lastSeenAgent = clientVer.name;
			}
			ctx.lastSeenModel ??= process.env.MCP_MODEL;
			ctx.lastSeenAgent ??= process.env.MCP_CLIENT_NAME;

			updateSessionFromInitialize(ctx, {
				clientInfo: clientVer,
				capabilities: server.server.getClientCapabilities()
			} as Record<string, unknown>);
		} catch (error) {
			// Non-fatal — just logging
			logger.warn("[session] Failed to capture client info", { error: String(error) });
		}
	};

	return server;
});

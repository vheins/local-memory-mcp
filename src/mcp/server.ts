#!/usr/bin/env node
// Mark this process as an MCP server to disable stderr logging (stdin/stdout used for JSON-RPC)
process.env.MCP_SERVER = "true";

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./mcp-server";
import { SQLiteStore } from "./storage/sqlite";
import { RealVectorStore } from "./storage/vectors";
import { CAPABILITIES } from "./capabilities";
import { addLogSink, createFileSink, logger } from "./utils/logger";
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

// Create storage instances
const db = await SQLiteStore.create();
const vectors = new RealVectorStore(db);

// Register file log sink (same dir as DB, retain last 5 files)
addLogSink(createFileSink(path.dirname(db.getDbPath())));
logger.info("[Server] startup", { pid: process.pid, version: CAPABILITIES.serverInfo.version, db: db.getDbPath() });

// Pre-load vector model in background to avoid initial request timeout
vectors.initialize().catch((err) => {
	logger.warn("[Server] Initial vector model loading failed. Will retry on first use.", { error: String(err) });
});

// Optional: Automatic cleanup of expired/low-utility memories (default: disabled)
const expiredArchived = db.memoryArchives.archiveExpiredMemories();
const lowScoreArchived = db.memoryArchives.archiveLowScoreMemories();
const totalArchived = (expiredArchived || 0) + (lowScoreArchived || 0);

if (totalArchived > 0) {
	logger.info(
		`[Server] Archived ${totalArchived} memories (expired: ${expiredArchived}, low-score: ${lowScoreArchived}) on startup.`
	);
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
	await handle?.close();
	db.close();
	process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Start the MCP stdio server using the SDK
const handle = serveStdio(() => createMcpServer(db, vectors));

#!/usr/bin/env node
/**
 * Standalone dashboard entry point.
 *
 * Boots the dashboard DI singletons (`./lib/context`), builds the Express app
 * via the shared {@link createExpressApp} factory, binds it on `PORT`/`HOST`,
 * and starts the embedding worker. The combined daemon worker
 * (`src/mcp/cli/combined-server.ts`) reuses the same factory to mount the
 * dashboard routes next to the MCP `/mcp` handler on one port
 * (FEAT-DAEMON-001) — this file only owns the standalone socket lifecycle.
 *
 * FIX-008 (runtime topology): this entry point refuses to start when the
 * combined daemon already owns the same `memory.db`. Both processes would
 * build their own `SQLiteStore` + `WriteLock` over one file and fight for
 * `memory.db.lock`, which surfaces as a ~50s stall followed by
 * "Failed to acquire exclusive write lock". The guard runs BEFORE the store is
 * imported, so the refusal is immediate and costs no lock wait, migration pass
 * or embedding worker. The daemon itself is unaffected: it loads
 * `./lib/context` directly, never this file.
 */
import { assertStandaloneDashboardAllowed, DashboardDaemonConflictError } from "./lib/daemon-guard";

// FIX-008: fail fast, before ANY module that opens the database is evaluated.
// `./app` (and the service layer behind it) imports `./lib/context`, so both
// the context and the app must be loaded dynamically AFTER this check.
try {
	assertStandaloneDashboardAllowed();
} catch (error) {
	if (error instanceof DashboardDaemonConflictError) {
		process.stderr.write(`\n${error.message}\n`);
		process.exit(1);
	}
	throw error;
}

const { db, vectors, mcpClient, logger, embeddingWorker } = await import("./lib/context");
const { reuseTelemetry } = await import("../mcp/utils/reuse-telemetry");
const { createExpressApp } = await import("./app");

const { app, pkg } = createExpressApp({ db, vectors });

const PORT = Number(process.env.PORT) || 3456;
const HOST = process.env.DASHBOARD_HOST || "127.0.0.1";

// --- Start Server ---
if (process.env.DASHBOARD_ENABLE_MCP === "true") {
	mcpClient.start().catch((e) => logger.error("MCP Client failed", { error: e.message }));
}

function startServer() {
	const server = app.listen(PORT, HOST, () => {
		const addr = server.address();
		const bindAddr = typeof addr === "string" ? addr : (addr?.address ?? HOST);
		if (bindAddr !== "127.0.0.1" && bindAddr !== "::1") {
			logger.warn("Dashboard bound to non-loopback address — access is exposed on the network", {
				address: bindAddr,
				port: PORT,
				suggestion: "Set DASHBOARD_HOST=127.0.0.1 to restrict to localhost"
			});
		}
		console.log(`${new Date().toISOString()} DASHBOARD_STARTING v${pkg.version} on ${bindAddr}:${PORT}`);
	});

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			console.log(
				`${new Date().toISOString()} DASHBOARD_ALREADY_RUNNING Dashboard already running on port ${PORT}. Exiting.`
			);
			process.exit(0);
		}
		throw err;
	});
}

startServer();

process.on("SIGINT", () => {
	embeddingWorker.stop();
	mcpClient.stop();
	reuseTelemetry.flush(db);
	db.close();
	process.exit(0);
});
process.on("SIGTERM", () => {
	embeddingWorker.stop();
	mcpClient.stop();
	reuseTelemetry.flush(db);
	db.close();
	process.exit(0);
});

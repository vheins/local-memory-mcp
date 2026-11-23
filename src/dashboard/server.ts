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
 *
 * FIX-012: the same guard module warns once when `DASHBOARD_ENABLE_MCP=true`
 * would spawn an MCP server child that opens a second store over the same file
 * — the writer the daemon PID check cannot see.
 *
 * FIX-009: this process claims the `<configDir>/dashboard.pid` marker before the
 * store opens and releases it on every shutdown path. `local-memory-mcp daemon
 * start` uses it to identify (command line verified) and stop a manual dashboard
 * instead of forking a second writer over the same database.
 */
import {
	assertStandaloneDashboardAllowed,
	DashboardDaemonConflictError,
	detectEmbeddedWriterWarning
} from "./lib/daemon-guard";
import {
	claimDashboardPidMarker,
	releaseDashboardPidMarker,
	type DashboardPidClaim
} from "../mcp/cli/dashboard-takeover";

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

// FIX-009: record this process as the database owner BEFORE the store opens, so
// a concurrent `local-memory-mcp daemon start` can identify and stop it instead
// of forking a second writer. Removed on every shutdown path below.
let pidMarker: DashboardPidClaim | null = null;
try {
	pidMarker = claimDashboardPidMarker();
} catch (error) {
	console.warn(`Could not write the dashboard PID marker: ${error instanceof Error ? error.message : String(error)}`);
}
function releasePidMarker(): void {
	if (pidMarker === null) return;
	const claim = pidMarker;
	pidMarker = null;
	releaseDashboardPidMarker(claim);
}
process.on("exit", releasePidMarker);

const { db, vectors, mcpClient, logger, embeddingWorker } = await import("./lib/context");
const { reuseTelemetry } = await import("../mcp/utils/reuse-telemetry");
const { createExpressApp } = await import("./app");

const { app, pkg } = createExpressApp({ db, vectors });

const PORT = Number(process.env.PORT) || 3456;
const HOST = process.env.DASHBOARD_HOST || "127.0.0.1";

// --- Start Server ---
// FIX-012: warn once about the embedded MCP child writer. The flag keeps its
// existing effect (eager start) — the warning only makes the second writer
// explicit instead of leaving the operator with a silent ~50s lock stall.
if (process.env.DASHBOARD_ENABLE_MCP === "true") {
	const warning = detectEmbeddedWriterWarning();
	if (warning !== null) logger.warn(warning.message);
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
			releasePidMarker();
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
	releasePidMarker();
	db.close();
	process.exit(0);
});
process.on("SIGTERM", () => {
	embeddingWorker.stop();
	mcpClient.stop();
	reuseTelemetry.flush(db);
	releasePidMarker();
	db.close();
	process.exit(0);
});

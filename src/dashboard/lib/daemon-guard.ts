/**
 * Standalone-dashboard startup guard (FIX-008).
 *
 * The combined daemon (`local-memory-mcp daemon` → `--daemon-worker`) and the
 * standalone dashboard entry point (`npm run dashboard`, `bin/mcp-memory-dashboard.js`)
 * both construct their OWN `SQLiteStore` over the SAME `memory.db`, and each
 * store owns its own `WriteLock` keyed on that file
 * (`src/mcp/storage/write-lock.ts`). Two processes therefore contend for one
 * `memory.db.lock`: a compound write in either process waits up to ~50s
 * (`LOCK_RETRY_COUNT` × `LOCK_RETRY_DELAY_MS`) and then fails with
 * "Failed to acquire exclusive write lock".
 *
 * The supported topology is ONE writer process per database, and the daemon
 * already serves the dashboard UI itself on its own port. A standalone
 * dashboard started next to a live daemon adds contention and nothing else, so
 * this guard detects that conflict BEFORE the store is opened — no lock wait,
 * no migration pass, no embedding worker — and fails fast with an actionable
 * message.
 *
 * FIX-012 extends the same module with the writer the daemon check cannot see:
 * `DASHBOARD_ENABLE_MCP=true` spawns an MCP server child that opens its own
 * store over the same file.
 *
 * FIX-013 removed the LAZY second-writer path: MCP-dependent dashboard routes
 * now dispatch the tool in-process through the dashboard's own store
 * (`src/dashboard/lib/local-tools.ts`) and never start the embedded client, so
 * only the explicit eager opt-in above can still create a child writer.
 * N2 also hardened {@link detectDaemonHolder} against PID reuse.
 *
 * Deliberately free of storage imports: `src/dashboard/server.ts` must be able
 * to run these checks before `./lib/context` (and therefore `./app`, which
 * pulls the same context through the service layer) is evaluated.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { isProcessAlive, readDaemonPid, resolveDaemonPaths } from "../../mcp/cli/daemon";
import { readProcessCommandLine } from "../../mcp/cli/dashboard-takeover";

/** A live daemon process that owns the memory database this process resolves. */
export interface DaemonHolder {
	/** PID recorded in `<configDir>/daemon.pid` and verified to be alive. */
	pid: number;
	/** Directory the daemon and this process both resolve their database from. */
	dir: string;
	/** Daemon log path — source of the last `DAEMON_READY <url>` line. */
	logFile: string;
}

/** Options for {@link detectDaemonHolder} / {@link assertStandaloneDashboardAllowed}. */
export interface DetectDaemonOptions {
	/** Environment to resolve the daemon paths from. Defaults to `process.env`. */
	env?: NodeJS.ProcessEnv;
	/** PID liveness probe. Defaults to the daemon CLI's `process.kill(pid, 0)` check. */
	isAlive?: (pid: number) => boolean;
	/**
	 * Process command-line reader used to reject a reused PID (N2). Defaults to
	 * the same `/proc/<pid>/cmdline` reader the dashboard-takeover uses, so both
	 * guards apply the same identity rule.
	 */
	readCommandLine?: (pid: number) => string | null;
	/** Log sink for the PID-reuse advisory. Defaults to `console.warn`. */
	log?: (message: string) => void;
}

/**
 * Thrown when the standalone dashboard must not start because a live daemon
 * owns the same database. Carries the conflicting PID so a caller can log it
 * structurally instead of parsing the message.
 */
export class DashboardDaemonConflictError extends Error {
	/** PID of the daemon that already owns the database. */
	readonly pid: number;

	constructor(message: string, pid: number) {
		super(message);
		this.name = "DashboardDaemonConflictError";
		this.pid = pid;
	}
}

/**
 * Detect a live daemon that shares this process's database.
 *
 * Reads the SAME `<configDir>/daemon.pid` the daemon writes
 * (`resolveDaemonPaths`, which honours `LOCAL_MEMORY_DAEMON_DIR` and a
 * file-based `MEMORY_DB_PATH`), so the check follows the database path rather
 * than assuming the platform default. A stale PID file (recorded process gone)
 * is NOT a conflict: the daemon is not running, so the dashboard may own the DB.
 *
 * N2 (PID reuse): a recorded PID that is alive but whose command line is not a
 * daemon worker belongs to an unrelated process that inherited the number after
 * a reboot/crash. Treating it as the database owner would refuse a dashboard
 * whose real daemon is gone, so the holder is rejected, and a ONE-LINE advisory
 * names the reused PID instead of failing silently. When the command line cannot
 * be read at all the check stays permissive (identity must be CONFIRMED, the
 * same rule `dashboard-takeover.ts` applies before signalling a PID), so a
 * non-Linux host without `ps` still gets the conservative liveness check.
 *
 * @returns The live daemon, or `null` when no daemon holds the database.
 */
export function detectDaemonHolder(options: DetectDaemonOptions = {}): DaemonHolder | null {
	const env = options.env ?? process.env;
	const isAlive = options.isAlive ?? isProcessAlive;
	const paths = resolveDaemonPaths(env);
	const pid = readDaemonPid(paths.pidFile);
	if (pid === null || !isAlive(pid)) return null;

	const readCommandLine = options.readCommandLine ?? readProcessCommandLine;
	const cmdline = readCommandLine(pid);
	if (cmdline !== null && !isDaemonCommandLine(cmdline)) {
		const log = options.log ?? ((message: string) => console.warn(message));
		log(
			`[daemon-guard] Ignoring ${paths.pidFile}: it records pid ${pid}, but that process is not a ` +
				`local-memory-mcp daemon worker (stale PID file, PID reused after a restart). ` +
				`The standalone dashboard proceeds; run "local-memory-mcp daemon status" to confirm.`
		);
		return null;
	}

	return { pid, dir: paths.dir, logFile: paths.logFile };
}

/**
 * Whether a process command line is the combined daemon worker.
 *
 * `daemon start` forks `<execPath> <workerArg> --daemon-worker` and the
 * OS-service registrations launch `<entry> daemon --daemon-worker`, so the
 * `--daemon-worker` flag is the invariant that identifies OUR worker on every
 * platform. Mirrors {@link isDashboardCommandLine}'s negative rule.
 */
function isDaemonCommandLine(cmdline: string): boolean {
	return /(^|\s)--daemon-worker(\s|$)/.test(cmdline);
}

/** Bytes of the daemon log tail scanned for the last `DAEMON_READY` line. */
const LOG_TAIL_BYTES = 64 * 1024;

/**
 * Resolve the URL the daemon is actually serving.
 *
 * The daemon writes `DAEMON_READY <url>` on every boot
 * (`src/mcp/cli/combined-server.ts`), so the tail of its log is the only
 * authoritative answer to "which port is it on?" — the operator may have
 * changed `PORT` after starting it. Falls back to `PORT`/3456 when the log is
 * missing, unreadable, or has no ready line yet (a daemon still starting).
 */
export function resolveDaemonDashboardUrl(holder: DaemonHolder, env: NodeJS.ProcessEnv = process.env): string {
	const fallbackPort = (env.PORT ?? "").trim() || "3456";
	const fallback = `http://127.0.0.1:${fallbackPort}`;
	let tail: string;
	try {
		const { size } = statSync(holder.logFile);
		const length = Math.min(size, LOG_TAIL_BYTES);
		if (length === 0) return fallback;
		const fd = openSync(holder.logFile, "r");
		try {
			const buffer = Buffer.alloc(length);
			readSync(fd, buffer, 0, length, size - length);
			tail = buffer.toString("utf8");
		} finally {
			closeSync(fd);
		}
	} catch {
		return fallback;
	}

	const matches = [...tail.matchAll(/DAEMON_READY\s+(https?:\/\/\S+)/g)];
	const last = matches.at(-1)?.[1];
	return last ?? fallback;
}

/**
 * Build the operator-facing refusal message: what conflicts, why it fails, and
 * the supported ways forward.
 *
 * The dashboard URL comes from {@link resolveDaemonDashboardUrl}, so it names
 * the port the daemon is really serving rather than assuming the default.
 */
export function formatDaemonConflict(holder: DaemonHolder, env: NodeJS.ProcessEnv = process.env): string {
	return [
		`Refusing to start the standalone dashboard: the local-memory-mcp daemon (pid ${holder.pid}) already owns the memory database in ${holder.dir}.`,
		"",
		"Both processes would open the same SQLite files and contend for one write lock, so one of them stalls",
		"for up to ~50s and then fails. The daemon serves this dashboard itself — pick ONE of:",
		"",
		`  - open the daemon's dashboard:  ${resolveDaemonDashboardUrl(holder, env)}`,
		"  - stop the daemon, then retry:  local-memory-mcp daemon stop",
		"  - isolate this dashboard:       MEMORY_DB_PATH=/path/to/other.db",
		""
	].join("\n");
}

/**
 * Throw when a live daemon already owns the database.
 *
 * Call this as the FIRST statement of the standalone dashboard entry point,
 * before any module that constructs `SQLiteStore` is imported. The combined
 * daemon never calls it (it IS the daemon), so its behaviour is unchanged.
 *
 * @throws {DashboardDaemonConflictError} When a live daemon holds the database.
 */
export function assertStandaloneDashboardAllowed(options: DetectDaemonOptions = {}): void {
	const holder = detectDaemonHolder(options);
	if (holder === null) return;
	throw new DashboardDaemonConflictError(formatDaemonConflict(holder, options.env), holder.pid);
}

/** Operator-facing warning about the embedded MCP child writer (FIX-012). */
export interface EmbeddedWriterWarning {
	/** Ready-to-log text: names the child writer, the contention, and the supported setups. */
	message: string;
}

/**
 * Detect the second writer the daemon guard cannot see (FIX-012).
 *
 * `DASHBOARD_ENABLE_MCP=true` makes the standalone dashboard eagerly call
 * `mcpClient.start()`, which spawns `node <mcp server>` over stdio
 * (`src/mcp/client.ts`). That child is a separate process that builds its OWN
 * `SQLiteStore` + `WriteLock` over the SAME `memory.db`, so the
 * one-writer-per-database rule FIX-008 enforces is broken from inside the
 * dashboard itself — no `daemon.pid` involved, so {@link detectDaemonHolder}
 * never fires.
 *
 * This returns a warning rather than a refusal because the standalone dashboard
 * is a supported entry point: failing boot on the eager flag would break a
 * working configuration. FIX-013 closed the lazy twin of this path — dashboard
 * routes dispatch tools in-process now — so this explicit opt-in is the only
 * remaining route to a child writer.
 *
 * @param env Environment to read `DASHBOARD_ENABLE_MCP` from. Defaults to `process.env`.
 * @returns The warning to log once at boot, or `null` when the flag is off.
 */
export function detectEmbeddedWriterWarning(env: NodeJS.ProcessEnv = process.env): EmbeddedWriterWarning | null {
	if (env.DASHBOARD_ENABLE_MCP !== "true") return null;
	return { message: formatEmbeddedWriterWarning() };
}

/**
 * Build the warning text for {@link detectEmbeddedWriterWarning}.
 *
 * Names the concrete child process, the files it opens, the symptom the
 * operator would otherwise have to diagnose, and the two supported setups.
 */
export function formatEmbeddedWriterWarning(): string {
	return [
		"DASHBOARD_ENABLE_MCP=true makes the standalone dashboard spawn its own MCP server child process",
		"(node <mcp server>), which builds a second SQLiteStore + WriteLock over the same memory.db.",
		"Dashboard and child then contend for memory.db.lock: a compound write in either process stalls for",
		'up to ~50s and fails with "Failed to acquire exclusive write lock".',
		"One writer per database: unset DASHBOARD_ENABLE_MCP for a standalone dashboard, or run",
		"`local-memory-mcp daemon`, which serves this dashboard and the MCP endpoint (/mcp) from one process."
	].join(" ");
}

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
 * Deliberately free of storage imports: `src/dashboard/server.ts` must be able
 * to run this check before `./lib/context` (and therefore `./app`, which pulls
 * the same context through the service layer) is evaluated.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { isProcessAlive, readDaemonPid, resolveDaemonPaths } from "../../mcp/cli/daemon";

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
 * @returns The live daemon, or `null` when no daemon holds the database.
 */
export function detectDaemonHolder(options: DetectDaemonOptions = {}): DaemonHolder | null {
	const env = options.env ?? process.env;
	const isAlive = options.isAlive ?? isProcessAlive;
	const paths = resolveDaemonPaths(env);
	const pid = readDaemonPid(paths.pidFile);
	if (pid === null || !isAlive(pid)) return null;
	return { pid, dir: paths.dir, logFile: paths.logFile };
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

/**
 * Standalone-dashboard PID marker + `daemon start` database takeover (FIX-009).
 *
 * FIX-008 refuses to START a standalone dashboard while the combined daemon owns
 * the database. The reverse order was still open: with a standalone dashboard
 * already holding `memory.db`, `local-memory-mcp daemon` forked a worker that
 * opened a SECOND store over the same files and both processes then fought over
 * `memory.db.lock` (~50s wait, then "Failed to acquire exclusive write lock").
 *
 * The chosen contract (TASK-004, user decision): the daemon TAKES OVER the
 * database from a manual dashboard instead of refusing. Safety rules, none of
 * which may be relaxed:
 *
 *   - A PID is only signalled when it comes from OUR marker file AND
 *     `/proc/<pid>/cmdline` still names a dashboard entry point. A reused PID is
 *     rejected, never trusted.
 *   - PID 1, this process, its parent, and the daemon worker are never signalled.
 *   - SIGTERM first; SIGKILL only after the identity was confirmed AND SIGTERM
 *     failed inside the grace window, and the escalation is logged.
 *   - After the process is gone the write lock must be free before the caller
 *     forks; an unidentified holder fails fast with its PID and the way out.
 *
 * The marker is written by `src/dashboard/server.ts` at startup and removed on
 * shutdown. When no marker exists the daemon never guesses a PID.
 *
 * Deliberately free of storage imports: the dashboard entry point imports this
 * module before `./lib/context` (and therefore before any `SQLiteStore`) is
 * evaluated.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import lockfile from "proper-lockfile";
import { resolveConfigDir } from "../utils/config-file";
import { resolveDbPath } from "../utils/db-path";
import { LOCK_STALE_MS } from "../utils/lock-timing";
import { isProcessAlive, readPidFile, removePidFileIfOwner, writePidFile } from "../utils/pid-file";

/** Marker file name, placed next to `memory.db` / `daemon.pid`. */
export const DASHBOARD_PID_FILENAME = "dashboard.pid";

/** Default SIGTERM grace before escalating to SIGKILL. */
const DEFAULT_TERM_TIMEOUT_MS = 5_000;
/** Default post-SIGKILL wait for the process to disappear. */
const DEFAULT_KILL_TIMEOUT_MS = 1_000;
/** Default wait for the write lock to clear once the process is gone. */
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
/** Poll interval for the bounded waits above. */
const DEFAULT_POLL_INTERVAL_MS = 100;

/** Path of the standalone-dashboard PID marker for the resolved config dir. */
export function resolveDashboardPidFile(env: NodeJS.ProcessEnv = process.env): string {
	return path.join(resolveConfigDir(env), DASHBOARD_PID_FILENAME);
}

/** Result of {@link claimDashboardPidMarker}. */
export interface DashboardPidClaim {
	/** Marker path (always resolved, even when the claim is not ours). */
	pidFile: string;
	/**
	 * Whether this process wrote the marker and is therefore responsible for
	 * removing it on shutdown. `false` means another live dashboard already owns
	 * the marker (e.g. a second instance about to exit on `EADDRINUSE`).
	 */
	owner: boolean;
}

/** Options for {@link claimDashboardPidMarker} / {@link releaseDashboardPidMarker}. */
export interface DashboardPidMarkerOptions {
	env?: NodeJS.ProcessEnv;
	/** PID to record. Defaults to `process.pid`. */
	pid?: number;
	/** Liveness probe (tests). Defaults to {@link isProcessAlive}. */
	isAlive?: (pid: number) => boolean;
	/** Command-line reader (tests). Defaults to {@link readProcessCommandLine}. */
	readCommandLine?: (pid: number) => string | null;
}

/**
 * Claim the dashboard PID marker.
 *
 * Writes `<pid>\n` unless the file already names a DIFFERENT LIVE dashboard
 * process: in that case the existing owner keeps the marker (a duplicate
 * dashboard that exits on `EADDRINUSE` must not clobber it). A stale entry, or a
 * live PID whose command line is not a dashboard, is overwritten because a
 * reused PID must never be trusted.
 */
export function claimDashboardPidMarker(options: DashboardPidMarkerOptions = {}): DashboardPidClaim {
	const pidFile = resolveDashboardPidFile(options.env);
	const pid = options.pid ?? process.pid;
	const isAlive = options.isAlive ?? isProcessAlive;
	const readCommandLine = options.readCommandLine ?? readProcessCommandLine;

	const existing = readPidFile(pidFile);
	if (existing !== null && existing !== pid && isAlive(existing)) {
		const cmdline = readCommandLine(existing);
		if (cmdline !== null && isDashboardCommandLine(cmdline)) return { pidFile, owner: false };
	}

	writePidFile(pidFile, pid);
	return { pidFile, owner: true };
}

/**
 * Release the marker on shutdown, but only when this process still owns it —
 * a marker another live dashboard wrote must survive this process exiting.
 */
export function releaseDashboardPidMarker(claim: DashboardPidClaim, pid: number = process.pid): void {
	if (!claim.owner) return;
	removePidFileIfOwner(claim.pidFile, pid);
}

/**
 * Read a process command line, or `null` when it cannot be read.
 *
 * Linux reads `/proc/<pid>/cmdline` (NUL-separated argv). Other POSIX hosts fall
 * back to `ps -o args=`, which yields the joined command line. An unreadable
 * command line is never treated as a match: identity must be confirmed.
 */
export function readProcessCommandLine(pid: number): string | null {
	if (!Number.isInteger(pid) || pid <= 0) return null;

	if (process.platform === "linux") {
		try {
			const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
			const argv = raw.split("\0").filter((part) => part.length > 0);
			if (argv.length > 0) return argv.join(" ");
		} catch {
			/* fall through to ps */
		}
	}

	try {
		const result = spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" });
		const text = (result.stdout ?? "").trim();
		return text.length > 0 ? text : null;
	} catch {
		return null;
	}
}

/** Whether a command line is one of OUR standalone dashboard entry points. */
export function isDashboardCommandLine(cmdline: string): boolean {
	// The combined daemon worker opens the same store but is never a dashboard.
	if (cmdline.includes("--daemon-worker")) return false;
	// `bin/mcp-memory-dashboard.js`, `dist/dashboard/server.js`, dev `src/dashboard/server.ts`.
	if (/(^|\s)\S*mcp-memory-dashboard\.js(\s|$)/.test(cmdline)) return true;
	if (/(^|\s)\S*dashboard\/server\.(?:js|ts)(\s|$)/.test(cmdline)) return true;
	// `bin/mcp-memory-server.js dashboard` re-imports the dashboard server in-process.
	if (/(^|\s)\S*mcp-memory-server\.js(\s|$)/.test(cmdline) && /(^|\s)dashboard(\s|$)/.test(cmdline)) return true;
	return false;
}

/**
 * Whether a `memory.db.lock` is currently held.
 *
 * The staleness threshold MUST match the one the holder acquires with
 * ({@link LOCK_STALE_MS}, shared with `WriteLock.acquire`): proper-lockfile
 * refreshes the lock mtime every `stale / 2`, so a probe with a smaller
 * threshold reports a live lock as free for most of that window.
 */
export function isDbWriteLockHeld(dbPath: string): boolean {
	try {
		return lockfile.checkSync(dbPath, { realpath: false, stale: LOCK_STALE_MS });
	} catch {
		// An unreadable lock path is not evidence of a live holder; the fork's own
		// lock acquisition will surface a real problem.
		return false;
	}
}

/** Injectable seams for {@link takeOverDatabaseFromStandaloneDashboard}. */
export interface DashboardTakeoverIo {
	env?: NodeJS.ProcessEnv;
	/** Liveness probe. Defaults to {@link isProcessAlive}. */
	isAlive?: (pid: number) => boolean;
	/** Signal sender. Defaults to `process.kill`. */
	kill?: (pid: number, signal: NodeJS.Signals) => void;
	/** Command-line reader. Defaults to {@link readProcessCommandLine}. */
	readCommandLine?: (pid: number) => string | null;
	/** Log sink for the takeover trail (escalation reason). Defaults to stdout. */
	log?: (message: string) => void;
	/** Sleep seam for the bounded waits (tests). Defaults to a real timer. */
	sleep?: (ms: number) => Promise<void>;
	/** Lock probe. Defaults to {@link isDbWriteLockHeld}. */
	isLockHeld?: (dbPath: string) => boolean;
	/** PID recorded in `daemon.pid`; never signalled. Resolved from the marker dir when omitted. */
	daemonPid?: number | null;
	/** Database path to probe. Defaults to {@link resolveDbPath}. */
	dbPath?: string;
	termTimeoutMs?: number;
	killTimeoutMs?: number;
	lockTimeoutMs?: number;
	pollIntervalMs?: number;
}

/** What {@link takeOverDatabaseFromStandaloneDashboard} did. */
export type DashboardTakeoverOutcome =
	| { kind: "none"; reason: "no-marker" | "daemon-running" }
	| { kind: "stale-marker"; pid: number }
	| { kind: "refused"; pid: number; reason: "identity-mismatch" | "protected-pid" }
	| { kind: "taken-over"; pid: number; signal: "SIGTERM" | "SIGKILL"; elapsedMs: number };

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded wait: runs `predicate` up to `attempts` times, sleeping between checks. */
async function waitFor(
	predicate: () => boolean,
	timeoutMs: number,
	intervalMs: number,
	sleep: (ms: number) => Promise<void>
): Promise<boolean> {
	if (predicate()) return true;
	const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
	for (let attempt = 0; attempt < attempts; attempt++) {
		await sleep(intervalMs);
		if (predicate()) return true;
	}
	return predicate();
}

/** Fail-fast message: a live marker PID that is NOT our dashboard still holds the DB. */
export function formatUnidentifiedHolder(pid: number, markerFile: string, dbPath: string): string {
	return [
		`Cannot start the daemon: the memory database at ${dbPath} is write-locked by an unidentified process.`,
		`The PID marker ${markerFile} names ${pid}, but that process is not this project's standalone dashboard,`,
		"so it was NOT signalled (a reused PID must never be killed).",
		"",
		"Inspect it and free the database, then retry `local-memory-mcp daemon start`:",
		`  ps -o pid,args -p ${pid}`,
		`  lsof ${dbPath}`,
		`If ${pid} is unrelated, remove the stale marker: rm -f ${markerFile}`,
		""
	].join("\n");
}

/**
 * Fail-fast message: the marker names a PID this start must never signal
 * (PID 1, itself, its parent, or the running daemon worker).
 *
 * Deliberately does NOT claim the process is not a dashboard: identity was never
 * checked for a protected PID, and asserting it would state a fact the code did
 * not establish.
 */
export function formatProtectedPid(pid: number, markerFile: string, dbPath: string): string {
	return [
		`Cannot start the daemon: the memory database at ${dbPath} is write-locked, and the PID marker ${markerFile}`,
		`names ${pid}, a protected process this start never signals (PID 1, the starting process, its parent, or the daemon worker).`,
		`Its identity was not checked and nothing was signalled.`,
		"",
		"Find the actual holder, stop it, then retry `local-memory-mcp daemon start`:",
		`  lsof ${dbPath}`,
		`  ps -o pid,args -p ${pid}`,
		`If ${pid} is unrelated to the dashboard, remove the stale marker: rm -f ${markerFile}`,
		""
	].join("\n");
}

/** Fail-fast message: the confirmed dashboard survived SIGTERM and SIGKILL. */
export function formatSurvivedSignals(pid: number): string {
	return [
		`Cannot start the daemon: the standalone dashboard (pid ${pid}) is still alive after SIGTERM and SIGKILL.`,
		"",
		"Stop it manually, then retry `local-memory-mcp daemon start`:",
		`  kill -9 ${pid}`,
		""
	].join("\n");
}

/** Fail-fast message: the process is gone but the write lock is still held. */
export function formatLockStillHeld(dbPath: string, pid: number): string {
	return [
		`Cannot start the daemon: ${dbPath} is still write-locked after stopping the standalone dashboard (pid ${pid}).`,
		`Lock file: ${dbPath}.lock`,
		"",
		"Find and stop the remaining holder, then retry `local-memory-mcp daemon start`:",
		`  lsof ${dbPath}`,
		""
	].join("\n");
}

/** Fail-fast message: the write lock is held and no marker identifies the holder. */
export function formatUnknownLockHolder(dbPath: string, waitedMs: number): string {
	return [
		`Cannot start the daemon: ${dbPath} is write-locked by a process this start cannot identify.`,
		`No dashboard PID marker (${DASHBOARD_PID_FILENAME}) exists, so no PID is guessed and nothing is signalled.`,
		`Waited ${waitedMs}ms for the lock to clear.`,
		"",
		"Find the holder, stop it, then retry `local-memory-mcp daemon start`:",
		`  lsof ${dbPath}`,
		`  ps -o pid,args -p <pid>`,
		""
	].join("\n");
}

/**
 * Take the database over from a manually started standalone dashboard.
 *
 * Call this from `daemon start` BEFORE the worker is forked. Returns a
 * {@link DashboardTakeoverOutcome} when the start may proceed, and throws an
 * actionable error when it must not (the process cannot be stopped, an
 * unidentified process still holds the lock, or the lock is held with no marker
 * to identify the holder).
 *
 * @throws {Error} When the dashboard survives SIGTERM+SIGKILL, when the write
 *   lock is still held after the process is gone, or when the lock is held with
 *   no marker naming a holder.
 */
export async function takeOverDatabaseFromStandaloneDashboard(
	io: DashboardTakeoverIo = {}
): Promise<DashboardTakeoverOutcome> {
	const env = io.env ?? process.env;
	const pidFile = resolveDashboardPidFile(env);
	const dbPath = io.dbPath ?? resolveDbPath(env);
	const isAlive = io.isAlive ?? isProcessAlive;
	const kill = io.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
	const readCommandLine = io.readCommandLine ?? readProcessCommandLine;
	const log = io.log ?? ((message: string) => process.stdout.write(`${message}\n`));
	const sleep = io.sleep ?? defaultSleep;
	const isLockHeld = io.isLockHeld ?? isDbWriteLockHeld;
	const termTimeoutMs = io.termTimeoutMs ?? DEFAULT_TERM_TIMEOUT_MS;
	const killTimeoutMs = io.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
	const lockTimeoutMs = io.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
	const pollIntervalMs = io.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

	// A live daemon already owns the database — `startDaemon` reports it; do not
	// touch anything (the worker is never a takeover target).
	const daemonPid = io.daemonPid ?? readPidFile(path.join(path.dirname(pidFile), "daemon.pid"));
	if (daemonPid !== null && daemonPid !== process.pid && isAlive(daemonPid)) {
		return { kind: "none", reason: "daemon-running" };
	}

	const markerPid = readPidFile(pidFile);
	if (markerPid === null) {
		// No marker → never guess a PID (FIX-009 rule 5). But a held write lock
		// still means another writer owns this database: fork would only repeat the
		// ~50s stall. Wait briefly (a just-stopped daemon may still be closing),
		// then fail fast with the lock path and the way to find the holder.
		if (isLockHeld(dbPath)) {
			const cleared = await waitFor(() => !isLockHeld(dbPath), lockTimeoutMs, pollIntervalMs, sleep);
			if (!cleared) throw new Error(formatUnknownLockHolder(dbPath, lockTimeoutMs));
		}
		return { kind: "none", reason: "no-marker" };
	}

	// Dead owner: the marker is stale, clean it and let the start proceed. Remove
	// it only while it still records that PID — a dashboard that claimed the
	// marker between the read and the unlink must keep it.
	if (!isAlive(markerPid)) {
		removePidFileIfOwner(pidFile, markerPid);
		return { kind: "stale-marker", pid: markerPid };
	}

	// Protected PIDs are never signalled, whatever the marker says.
	const protectedPid =
		markerPid === 1 || markerPid === process.pid || markerPid === process.ppid || markerPid === daemonPid;

	if (protectedPid) {
		if (isLockHeld(dbPath)) throw new Error(formatProtectedPid(markerPid, pidFile, dbPath));
		return { kind: "refused", pid: markerPid, reason: "protected-pid" };
	}

	const cmdline = readCommandLine(markerPid);
	if (cmdline === null || !isDashboardCommandLine(cmdline)) {
		// Identity not confirmed → never signal. If the database is genuinely held,
		// fail fast naming the untrusted PID; otherwise let the start proceed.
		if (isLockHeld(dbPath)) throw new Error(formatUnidentifiedHolder(markerPid, pidFile, dbPath));
		return { kind: "refused", pid: markerPid, reason: "identity-mismatch" };
	}

	// Identity confirmed: SIGTERM, then bounded wait for the process to exit.
	const startedAt = Date.now();
	try {
		kill(markerPid, "SIGTERM");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}

	const exitedAfterTerm = await waitFor(() => !isAlive(markerPid), termTimeoutMs, pollIntervalMs, sleep);
	let signal: "SIGTERM" | "SIGKILL" = "SIGTERM";

	if (!exitedAfterTerm) {
		log(
			`[takeover] dashboard pid ${markerPid} did not exit within ${termTimeoutMs}ms of SIGTERM ` +
				`(identity verified: ${cmdline}); escalating to SIGKILL`
		);
		try {
			kill(markerPid, "SIGKILL");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
		const exitedAfterKill = await waitFor(() => !isAlive(markerPid), killTimeoutMs, pollIntervalMs, sleep);
		if (!exitedAfterKill) throw new Error(formatSurvivedSignals(markerPid));
		signal = "SIGKILL";
	}

	// The process is gone; its marker is stale whichever signal ended it.
	removePidFileIfOwner(pidFile, markerPid);

	// The database must be free before the caller forks a second writer.
	const lockCleared = await waitFor(() => !isLockHeld(dbPath), lockTimeoutMs, pollIntervalMs, sleep);
	if (!lockCleared) throw new Error(formatLockStillHeld(dbPath, markerPid));

	const elapsedMs = Date.now() - startedAt;
	log(`[takeover] stopped the standalone dashboard (pid ${markerPid}, ${signal}) after ${elapsedMs}ms`);
	return { kind: "taken-over", pid: markerPid, signal, elapsedMs };
}

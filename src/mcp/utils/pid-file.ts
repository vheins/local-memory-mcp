/**
 * PID-file primitives shared by the daemon CLI (`cli/daemon.ts`) and the
 * standalone-dashboard PID marker (`cli/dashboard-takeover.ts`, FIX-009).
 *
 * Both files use the same `<pid>\n` body format, so the read/write/remove
 * helpers live here once instead of being duplicated per owner. A PID file is
 * only a HINT: a recorded PID may have been reused by an unrelated process, so
 * callers that signal a PID must still verify the process identity.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Whether a process with `pid` is alive. `process.kill(pid, 0)` performs the
 * existence check without delivering a signal; `EPERM` means the process
 * exists but is owned by another user, so it counts as alive.
 */
export function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Read the PID recorded in `file`, or `null` when the file is absent, empty,
 * or does not contain a positive integer.
 */
export function readPidFile(file: string): number | null {
	try {
		const raw = fs.readFileSync(file, "utf8").trim();
		const pid = Number.parseInt(raw, 10);
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

/** Persist `pid` to `file` (creates the parent directory when missing). */
export function writePidFile(file: string, pid: number): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${pid}\n`, "utf8");
}

/** Best-effort removal of a PID file. */
export function removePidFile(file: string): void {
	try {
		fs.unlinkSync(file);
	} catch {
		/* already gone — best effort */
	}
}

/**
 * Remove `file` ONLY when it still records `pid`.
 *
 * Two owners may share one marker path (a second dashboard that exits on
 * `EADDRINUSE`, a stale daemon file): the one shutting down must never delete a
 * marker another live process now owns. A missing file is a no-op.
 */
export function removePidFileIfOwner(file: string, pid: number): void {
	if (readPidFile(file) !== pid) return;
	removePidFile(file);
}

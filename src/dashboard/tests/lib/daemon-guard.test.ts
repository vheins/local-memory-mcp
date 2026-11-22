/**
 * Unit tests for `src/dashboard/lib/daemon-guard.ts` (FIX-008).
 *
 * The guard is the fast-fail boundary between the standalone dashboard and the
 * combined daemon: it must refuse to boot when a LIVE daemon owns the database
 * (one writer per DB), and must stay permissive when no daemon runs or only a
 * stale PID file is left behind. All filesystem fixtures live in a temp dir —
 * never in the repo tree and never in the real config dir.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertStandaloneDashboardAllowed,
	DashboardDaemonConflictError,
	detectDaemonHolder,
	formatDaemonConflict,
	resolveDaemonDashboardUrl
} from "../../lib/daemon-guard";

let tempDirs: string[] = [];

/** Create an isolated config directory (the dir daemon.pid lives in). */
function tempConfigDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "lmc-daemon-guard-"));
	tempDirs.push(dir);
	return dir;
}

/** Write a daemon PID file in the same `<pid>\n` format the daemon CLI uses. */
function writeDaemonPid(dir: string, pid: number): void {
	writeFileSync(path.join(dir, "daemon.pid"), `${pid}\n`, "utf8");
}

afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("daemon guard (FIX-008)", () => {
	it("allows the standalone dashboard when no daemon PID file exists", () => {
		const dir = tempConfigDir();
		const env = { LOCAL_MEMORY_DAEMON_DIR: dir };

		expect(detectDaemonHolder({ env })).toBeNull();
		expect(() => assertStandaloneDashboardAllowed({ env })).not.toThrow();
	});

	it("refuses to boot when a LIVE daemon owns the database", () => {
		const dir = tempConfigDir();
		writeDaemonPid(dir, 4242);
		const env = { LOCAL_MEMORY_DAEMON_DIR: dir };

		expect(detectDaemonHolder({ env, isAlive: () => true })).toEqual({
			pid: 4242,
			dir,
			logFile: path.join(dir, "daemon.log")
		});

		let caught: unknown;
		try {
			assertStandaloneDashboardAllowed({ env, isAlive: () => true });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(DashboardDaemonConflictError);
		const conflict = caught as DashboardDaemonConflictError;
		expect(conflict.pid).toBe(4242);
		// Actionable: names the owner, the reason, and both supported ways out.
		expect(conflict.message).toContain("daemon (pid 4242)");
		expect(conflict.message).toContain(dir);
		expect(conflict.message).toContain("http://127.0.0.1:3456");
		expect(conflict.message).toContain("local-memory-mcp daemon stop");
		expect(conflict.message).toContain("MEMORY_DB_PATH=");
		// The raw lock error must not be what the operator sees.
		expect(conflict.message).not.toContain("Failed to acquire exclusive write lock");
	});

	it("allows the standalone dashboard when the recorded daemon PID is stale", () => {
		const dir = tempConfigDir();
		writeDaemonPid(dir, 31337);
		const env = { LOCAL_MEMORY_DAEMON_DIR: dir };

		expect(detectDaemonHolder({ env, isAlive: () => false })).toBeNull();
		expect(() => assertStandaloneDashboardAllowed({ env, isAlive: () => false })).not.toThrow();
	});

	it("uses the daemon CLI's liveness check by default (own PID is alive)", () => {
		const dir = tempConfigDir();
		writeDaemonPid(dir, process.pid);

		expect(detectDaemonHolder({ env: { LOCAL_MEMORY_DAEMON_DIR: dir } })).toEqual({
			pid: process.pid,
			dir,
			logFile: path.join(dir, "daemon.log")
		});
	});

	it("falls back to PORT (default 3456) when the daemon log has no ready line", () => {
		const dir = tempConfigDir();
		const holder = { pid: 7, dir, logFile: path.join(dir, "daemon.log") };

		expect(resolveDaemonDashboardUrl(holder, { PORT: "4000" })).toBe("http://127.0.0.1:4000");
		expect(resolveDaemonDashboardUrl(holder, {})).toBe("http://127.0.0.1:3456");
		expect(formatDaemonConflict(holder, { PORT: "4000" })).toContain("http://127.0.0.1:4000");
	});

	it("names the port the daemon actually logged, not the assumed default", () => {
		const dir = tempConfigDir();
		const logFile = path.join(dir, "daemon.log");
		writeFileSync(
			logFile,
			[
				"2026-11-22T10:00:00.000Z DAEMON_READY http://127.0.0.1:3456 (pid 11, build old)",
				"some noise after",
				"2026-11-22T11:00:00.000Z DAEMON_READY http://127.0.0.1:7777 (pid 12, build new)"
			].join("\n"),
			"utf8"
		);

		const holder = { pid: 12, dir, logFile };
		expect(resolveDaemonDashboardUrl(holder, { PORT: "4000" })).toBe("http://127.0.0.1:7777");
	});
});

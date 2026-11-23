/**
 * Unit tests for `src/mcp/cli/dashboard-takeover.ts` (FIX-009).
 *
 * The takeover is the only place that signals a PID it did not create, so every
 * safety rule is pinned here: identity verification (PID reuse is rejected),
 * protected PIDs, SIGTERM-before-SIGKILL escalation, and the fail-fast when the
 * database is still locked. All process/filesystem effects are injected or
 * confined to a temp dir — no real process is ever signalled.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	claimDashboardPidMarker,
	isDashboardCommandLine,
	isDbWriteLockHeld,
	readProcessCommandLine,
	releaseDashboardPidMarker,
	resolveDashboardPidFile,
	takeOverDatabaseFromStandaloneDashboard,
	type DashboardTakeoverIo
} from "../cli/dashboard-takeover";
import { writePidFile } from "../utils/pid-file";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "lmc-takeover-"));
	tempDirs.push(dir);
	return dir;
}

function setup(): { dir: string; marker: string; dbPath: string; env: NodeJS.ProcessEnv } {
	const dir = tempDir();
	const dbPath = path.join(dir, "memory.db");
	return { dir, marker: path.join(dir, "dashboard.pid"), dbPath, env: { MEMORY_DB_PATH: dbPath } };
}

/** Build takeover io with permissive defaults so each test overrides only its concern. */
function takeoverIo(overrides: DashboardTakeoverIo & { dbPath: string; env: NodeJS.ProcessEnv }): DashboardTakeoverIo {
	return {
		isAlive: () => false,
		kill: () => undefined,
		readCommandLine: () => "node /repo/bin/mcp-memory-dashboard.js",
		log: () => undefined,
		sleep: async () => undefined,
		isLockHeld: () => false,
		...overrides
	};
}

afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("dashboard PID marker (FIX-009)", () => {
	it("resolves next to the database derived from MEMORY_DB_PATH", () => {
		expect(resolveDashboardPidFile({ MEMORY_DB_PATH: "/tmp/some/dir/memory.db" })).toBe(
			path.join("/tmp/some/dir", "dashboard.pid")
		);
	});

	it("claims the marker when none exists", () => {
		const { marker, env } = setup();
		const claim = claimDashboardPidMarker({ env, pid: 4242 });

		expect(claim).toEqual({ pidFile: marker, owner: true });
		expect(readFileSync(marker, "utf8")).toBe("4242\n");
	});

	it("does not clobber a marker owned by another LIVE dashboard", () => {
		const { marker, env } = setup();
		writePidFile(marker, 1111);

		const claim = claimDashboardPidMarker({
			env,
			pid: 2222,
			isAlive: (pid) => pid === 1111,
			readCommandLine: () => "node /repo/bin/mcp-memory-dashboard.js"
		});

		expect(claim.owner).toBe(false);
		expect(readFileSync(marker, "utf8")).toBe("1111\n");
	});

	it("overwrites a live PID that is NOT a dashboard (reused PID is not trusted)", () => {
		const { marker, env } = setup();
		writePidFile(marker, 1111);

		const claim = claimDashboardPidMarker({
			env,
			pid: 2222,
			isAlive: (pid) => pid === 1111,
			readCommandLine: () => "node /usr/bin/sleep 300"
		});

		expect(claim.owner).toBe(true);
		expect(readFileSync(marker, "utf8")).toBe("2222\n");
	});

	it("removes only its own marker on release", () => {
		const { marker, env } = setup();
		const owned = claimDashboardPidMarker({ env, pid: 4242 });
		releaseDashboardPidMarker(owned, 4242);
		expect(existsSync(marker)).toBe(false);

		writePidFile(marker, 9999);
		releaseDashboardPidMarker({ pidFile: marker, owner: false }, 4242);
		expect(existsSync(marker)).toBe(true);

		// A non-owner claim must never delete someone else's marker.
		releaseDashboardPidMarker({ pidFile: marker, owner: true }, 4242);
		expect(existsSync(marker)).toBe(true);
	});
});

describe("dashboard command-line identity", () => {
	it.each([
		["node /repo/bin/mcp-memory-dashboard.js"],
		["node /repo/dist/dashboard/server.js"],
		["node /repo/src/dashboard/server.ts"],
		["node /repo/bin/mcp-memory-server.js dashboard"]
	])("accepts %s", (cmdline) => {
		expect(isDashboardCommandLine(cmdline)).toBe(true);
	});

	it.each([
		["node /repo/bin/mcp-memory-server.js --daemon-worker"],
		["node /repo/bin/mcp-memory-server.js daemon --daemon-worker"],
		["node /repo/dist/mcp/server.js"],
		["node /usr/bin/sleep 300"],
		["/usr/sbin/sshd -D"]
	])("rejects %s", (cmdline) => {
		expect(isDashboardCommandLine(cmdline)).toBe(false);
	});

	it("reads a live process command line and returns null for a dead PID", () => {
		const own = readProcessCommandLine(process.pid);
		expect(typeof own).toBe("string");
		expect(own!.length).toBeGreaterThan(0);
		expect(readProcessCommandLine(999_999)).toBeNull();
	});
});

describe("daemon start takeover (FIX-009)", () => {
	it("does nothing when no marker exists", async () => {
		const { dbPath, env } = setup();
		const kill = vi.fn();

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({ env, dbPath, kill, isAlive: () => true })
		);

		expect(outcome).toEqual({ kind: "none", reason: "no-marker" });
		expect(kill).not.toHaveBeenCalled();
	});

	it("fails fast when the lock is held and no marker names the holder", async () => {
		const { dbPath, env } = setup();
		const kill = vi.fn();

		await expect(
			takeOverDatabaseFromStandaloneDashboard(
				takeoverIo({ env, dbPath, kill, isAlive: () => true, isLockHeld: () => true })
			)
		).rejects.toThrow(/write-locked by a process this start cannot identify[\s\S]*lsof/);
		expect(kill).not.toHaveBeenCalled();
	});

	it("proceeds when a held lock clears inside the wait window", async () => {
		const { dbPath, env } = setup();
		let held = true;
		const sleep = async (): Promise<void> => {
			held = false;
		};

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({ env, dbPath, isLockHeld: () => held, sleep })
		);

		expect(outcome).toEqual({ kind: "none", reason: "no-marker" });
	});

	it("does nothing when a live daemon already owns the database", async () => {
		const { dir, marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		writePidFile(path.join(dir, "daemon.pid"), 777);
		const kill = vi.fn();

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({ env, dbPath, kill, isAlive: (pid) => pid === 777 || pid === 4242 })
		);

		expect(outcome).toEqual({ kind: "none", reason: "daemon-running" });
		expect(kill).not.toHaveBeenCalled();
	});

	it("cleans a stale marker (recorded process is gone) without signalling", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		const kill = vi.fn();

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({ env, dbPath, kill, isAlive: () => false })
		);

		expect(outcome).toEqual({ kind: "stale-marker", pid: 4242 });
		expect(kill).not.toHaveBeenCalled();
		expect(existsSync(marker)).toBe(false);
	});

	it("keeps a marker a new dashboard claimed between the read and the cleanup", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({
				env,
				dbPath,
				// The liveness probe runs after the marker was read and before the
				// cleanup, so it stands in for a fresh dashboard claiming the marker
				// in that window.
				isAlive: () => {
					writePidFile(marker, 9999);
					return false;
				}
			})
		);

		expect(outcome).toEqual({ kind: "stale-marker", pid: 4242 });
		expect(readFileSync(marker, "utf8")).toBe("9999\n");
	});

	it("never signals a live PID whose command line is not a dashboard (PID reuse)", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		const kill = vi.fn();

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({
				env,
				dbPath,
				kill,
				isAlive: () => true,
				readCommandLine: () => "node /usr/bin/sleep 300",
				isLockHeld: () => false
			})
		);

		expect(outcome).toEqual({ kind: "refused", pid: 4242, reason: "identity-mismatch" });
		expect(kill).not.toHaveBeenCalled();
	});

	it("fails fast naming the PID when the untrusted holder still locks the database", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		const kill = vi.fn();

		await expect(
			takeOverDatabaseFromStandaloneDashboard(
				takeoverIo({
					env,
					dbPath,
					kill,
					isAlive: () => true,
					readCommandLine: () => "node /usr/bin/sleep 300",
					isLockHeld: () => true
				})
			)
		).rejects.toThrow(/unidentified process[\s\S]*4242/);
		expect(kill).not.toHaveBeenCalled();
	});

	const protectedCases: Array<[string, number]> = [
		["PID 1", 1],
		["its own PID", process.pid],
		["its parent PID", process.ppid]
	];
	it.each(protectedCases)("never signals %s", async (_label, protectedPid) => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, protectedPid);
		const kill = vi.fn();

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({
				env,
				dbPath,
				kill,
				isAlive: () => true,
				readCommandLine: () => "node /repo/bin/mcp-memory-dashboard.js",
				isLockHeld: () => false
			})
		);

		expect(outcome).toEqual({ kind: "refused", pid: protectedPid, reason: "protected-pid" });
		expect(kill).not.toHaveBeenCalled();
	});

	it("names a protected PID as protected without claiming an identity check", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 1);

		const error = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({ env, dbPath, isAlive: () => true, isLockHeld: () => true })
		).catch((caught: Error) => caught);

		expect(error).toBeInstanceOf(Error);
		const message = (error as Error).message;
		// Identity was never checked for a protected PID, so the message must not
		// assert that the process is not this project's dashboard.
		expect(message).toContain("names 1");
		expect(message).toMatch(/a protected process this start never signals/);
		expect(message).not.toMatch(/unidentified process|is not this project's standalone dashboard/);
	});

	it("stops a verified dashboard with SIGTERM and removes the marker", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		let alive = true;
		const signals: NodeJS.Signals[] = [];
		const kill = vi.fn((_pid: number, signal: NodeJS.Signals) => {
			signals.push(signal);
			if (signal === "SIGTERM") alive = false;
		});

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({ env, dbPath, kill, isAlive: () => alive })
		);

		expect(outcome).toMatchObject({ kind: "taken-over", pid: 4242, signal: "SIGTERM" });
		expect(signals).toEqual(["SIGTERM"]);
		expect(existsSync(marker)).toBe(false);
	});

	it("escalates to SIGKILL when SIGTERM is ignored, and logs the reason", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		let alive = true;
		const signals: NodeJS.Signals[] = [];
		const logs: string[] = [];
		const kill = vi.fn((_pid: number, signal: NodeJS.Signals) => {
			signals.push(signal);
			if (signal === "SIGKILL") alive = false;
		});

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({ env, dbPath, kill, isAlive: () => alive, log: (line) => logs.push(line) })
		);

		expect(outcome).toMatchObject({ kind: "taken-over", pid: 4242, signal: "SIGKILL" });
		expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
		expect(logs.join("\n")).toMatch(/did not exit within 5000ms of SIGTERM.*escalating to SIGKILL/);
	});

	it("fails fast when the dashboard survives both signals", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		const kill = vi.fn();

		await expect(
			takeOverDatabaseFromStandaloneDashboard(takeoverIo({ env, dbPath, kill, isAlive: () => true }))
		).rejects.toThrow(/still alive after SIGTERM and SIGKILL[\s\S]*4242/);
		expect(kill).toHaveBeenCalledWith(4242, "SIGKILL");
	});

	it("fails fast when the write lock is still held after the process is gone", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		let alive = true;
		const kill = vi.fn(() => {
			alive = false;
		});

		await expect(
			takeOverDatabaseFromStandaloneDashboard(
				takeoverIo({ env, dbPath, kill, isAlive: () => alive, isLockHeld: () => true })
			)
		).rejects.toThrow(/still write-locked[\s\S]*pid 4242[\s\S]*confirmed dead/);
	});

	it("removes the orphaned lock the stopped dashboard left behind", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		// The killed holder refreshed the lock a second before it died.
		const lockDir = `${dbPath}.lock`;
		mkdirSync(lockDir);
		const refreshed = new Date(Date.now() - 1_000);
		utimesSync(lockDir, refreshed, refreshed);
		let alive = true;
		const kill = vi.fn(() => {
			alive = false;
		});
		const logs: string[] = [];

		const outcome = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({
				env,
				dbPath,
				kill,
				isAlive: () => alive,
				isLockHeld: isDbWriteLockHeld,
				log: (line) => logs.push(line)
			})
		);

		expect(outcome).toMatchObject({ kind: "taken-over", pid: 4242, signal: "SIGTERM" });
		expect(existsSync(lockDir)).toBe(false);
		expect(logs.join("\n")).toMatch(/removed the orphaned write lock left by pid 4242/);
	});

	it("never removes a lock that appeared after the kill", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		const lockDir = `${dbPath}.lock`;
		let alive = true;
		const kill = vi.fn((_pid: number, signal: NodeJS.Signals) => {
			if (signal !== "SIGTERM") return;
			alive = false;
			// A third writer takes the database while the dashboard dies.
			mkdirSync(lockDir);
		});

		const error = await takeOverDatabaseFromStandaloneDashboard(
			takeoverIo({ env, dbPath, kill, isAlive: () => alive, isLockHeld: isDbWriteLockHeld })
		).catch((caught: Error) => caught);

		expect(error).toBeInstanceOf(Error);
		// The stopped PID is dead, so the message must not name it as the holder.
		expect((error as Error).message).toMatch(/confirmed dead, so it is not the holder/);
		expect(existsSync(lockDir)).toBe(true);
	});

	it("never removes a lock refreshed after the kill", async () => {
		const { marker, dbPath, env } = setup();
		writePidFile(marker, 4242);
		const lockDir = `${dbPath}.lock`;
		mkdirSync(lockDir);
		let alive = true;
		const kill = vi.fn((_pid: number, signal: NodeJS.Signals) => {
			if (signal !== "SIGTERM") return;
			alive = false;
			// Another process refreshed the same path after the dashboard died.
			const later = new Date(Date.now() + 5_000);
			utimesSync(lockDir, later, later);
		});

		await expect(
			takeOverDatabaseFromStandaloneDashboard(
				takeoverIo({ env, dbPath, kill, isAlive: () => alive, isLockHeld: isDbWriteLockHeld })
			)
		).rejects.toThrow(/confirmed dead, so it is not the holder/);
		expect(existsSync(lockDir)).toBe(true);
	});

	it("treats an absent lock file as free", () => {
		const { dbPath } = setup();
		writeFileSync(dbPath, "");
		// No `<dbPath>.lock` directory exists → not held.
		expect(isDbWriteLockHeld(dbPath)).toBe(false);
	});

	/**
	 * Regression for the probe threshold. `WriteLock.acquire` creates the lock
	 * with `stale: 30_000`, so proper-lockfile refreshes its mtime every 15s and
	 * only treats an older mtime as abandoned. A probe with a shorter window
	 * (the original 2s) reports a live lock as free for 13 of every 15 seconds.
	 */
	describe("lock staleness follows the writer's contract", () => {
		/** Create `<dbPath>.lock` the way proper-lockfile does, aged by `ageMs`. */
		function writeLockDir(dbPath: string, ageMs: number): void {
			const lockDir = `${dbPath}.lock`;
			mkdirSync(lockDir, { recursive: true });
			const aged = new Date(Date.now() - ageMs);
			utimesSync(lockDir, aged, aged);
		}

		it("reports a lock refreshed 5s ago as held", () => {
			const { dbPath } = setup();
			writeLockDir(dbPath, 5_000);
			expect(isDbWriteLockHeld(dbPath)).toBe(true);
		});

		it("reports a lock older than the writer's 30s staleness as free", () => {
			const { dbPath } = setup();
			writeLockDir(dbPath, 31_000);
			expect(isDbWriteLockHeld(dbPath)).toBe(false);
		});
	});
});

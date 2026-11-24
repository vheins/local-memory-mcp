/**
 * Unit tests for the daemon.log size-cap rotation (FIX-038).
 *
 * `rotateOversizedLogFile` bounds the raw-fd daemon log (copytruncate-style:
 * tail copy → truncate → prune) so a long-lived daemon can never grow the file
 * without limit. All filesystem work happens in per-test temp dirs; no real
 * daemon is started and no config dir is touched.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rotateOversizedLogFile } from "../utils/logger";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fix038-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()!;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("rotateOversizedLogFile (FIX-038)", () => {
	it("keeps the live file untouched when it is under the cap", () => {
		const dir = makeTempDir();
		const logFile = path.join(dir, "daemon.log");
		fs.writeFileSync(logFile, "small\n");

		const result = rotateOversizedLogFile(logFile, 1024);

		expect(result.action).toBe("noop");
		expect(fs.readFileSync(logFile, "utf8")).toBe("small\n");
		expect(fs.readdirSync(dir).filter((f) => f.startsWith("daemon.log."))).toEqual([]);
	});

	it("reports noop (not throws) when the file does not exist", () => {
		const dir = makeTempDir();
		const result = rotateOversizedLogFile(path.join(dir, "daemon.log"), 1024);
		expect(result.action).toBe("noop");
	});

	it("rotates once the size cap is exceeded and truncates the live file", () => {
		const dir = makeTempDir();
		const logFile = path.join(dir, "daemon.log");
		const body = `${"x".repeat(64)}\n`;
		fs.writeFileSync(logFile, body.repeat(8)); // 520 bytes > 512 cap

		const result = rotateOversizedLogFile(logFile, 512);

		expect(result.action).toBe("rotated");
		// Live file truncated: the daemon's O_APPEND fd keeps writing from 0.
		expect(fs.statSync(logFile).size).toBe(0);
		// Cap-sized tail preserved in the rotated file.
		expect(fs.statSync(result.to!).size).toBe(512);
	});

	it("keeps only maxFiles rotated siblings, dropping the oldest", () => {
		const dir = makeTempDir();
		const logFile = path.join(dir, "daemon.log");
		// Pre-existing rotated siblings with epoch-style suffixes, oldest first.
		fs.writeFileSync(`${logFile}.1000000000000`, "oldest\n");
		fs.writeFileSync(`${logFile}.2000000000000`, "middle\n");
		fs.writeFileSync(logFile, `${"y".repeat(1024)}`);

		const result = rotateOversizedLogFile(logFile, 512, 2);

		expect(result.action).toBe("rotated");
		const siblings = fs
			.readdirSync(dir)
			.filter((f) => f.startsWith("daemon.log."))
			.sort();
		// maxFiles=2 keeps the two NEWEST siblings; the pre-rotation live file
		// content lands in a fresh (highest-suffix) sibling.
		expect(siblings).toHaveLength(2);
		// "oldest" was dropped, "middle" kept.
		expect(fs.existsSync(`${logFile}.1000000000000`)).toBe(false);
		expect(fs.existsSync(`${logFile}.2000000000000`)).toBe(true);
		// The rotated target returned by the function (512-byte cap) carries the
		// retained tail — read THAT file, not a sibling picked by suffix order.
		expect(fs.readFileSync(result.to!, "utf8")).toBe("y".repeat(512));
	});

	it("skips invalid arguments without touching the filesystem", () => {
		const dir = makeTempDir();
		const logFile = path.join(dir, "daemon.log");
		fs.writeFileSync(logFile, "data");

		expect(rotateOversizedLogFile(logFile, 0).action).toBe("skipped");
		expect(rotateOversizedLogFile(logFile, -5).action).toBe("skipped");
		expect(rotateOversizedLogFile(logFile, 1024, 0).action).toBe("skipped");
		// File untouched by all three invalid calls.
		expect(fs.readFileSync(logFile, "utf8")).toBe("data");
	});

	it("never throws on a directory instead of a file", () => {
		const dir = makeTempDir();
		const fake = path.join(dir, "daemon.log");
		fs.mkdirSync(fake);
		const result = rotateOversizedLogFile(fake, 10);
		expect(["skipped", "noop"]).toContain(result.action);
	});

	it("handles a pre-rotation file larger than cap by retaining only the newest maxBytes", () => {
		const dir = makeTempDir();
		const logFile = path.join(dir, "daemon.log");
		fs.writeFileSync(logFile, "HEAD".repeat(1024) + "TAIL"); // 4100 bytes, cap 256

		const result = rotateOversizedLogFile(logFile, 256);

		expect(result.action).toBe("rotated");
		expect(fs.statSync(result.to!).size).toBe(256);
		// Retained content is the LAST 256 bytes (the newest output).
		const retained = fs.readFileSync(result.to!, "utf8");
		expect(retained.endsWith("TAIL")).toBe(true);
	});

	it("keeps the DAEMON_READY discovery line in the live file after a rotation", () => {
		const dir = makeTempDir();
		const logFile = path.join(dir, "daemon.log");
		// A boot line that a rotation would otherwise truncate away, plus
		// enough noise to cross the cap.
		fs.writeFileSync(logFile, `${"z".repeat(1024)}2026-01-01T00:00:00.000Z DAEMON_READY http://127.0.0.1:3456\n`);

		const ready = "2026-01-01T01:00:00.000Z DAEMON_READY http://127.0.0.1:3999 (pid 42, build test)\n";
		const result = rotateOversizedLogFile(logFile, 256, 5, ready);

		expect(result.action).toBe("rotated");
		// The discovery line is present in the LIVE file (what daemon-guard.ts
		// tails), not only in the rotated sibling.
		const live = fs.readFileSync(logFile, "utf8");
		expect(live).toContain("DAEMON_READY http://127.0.0.1:3999");
		// Exactly one DAEMON_READY line — the re-append must not duplicate.
		expect(live.match(/DAEMON_READY/g)).toHaveLength(1);
		// The discovery regex used by dashboard/lib/daemon-guard.ts still
		// resolves the non-default port from the live file.
		const matches = [...live.matchAll(/DAEMON_READY\s+(https?:\/\/\S+)/g)];
		expect(matches.at(-1)?.[1]).toBe("http://127.0.0.1:3999");
	});

	it("does not append the sentinel line when the file is under the cap", () => {
		const dir = makeTempDir();
		const logFile = path.join(dir, "daemon.log");
		fs.writeFileSync(logFile, "small\n");

		const result = rotateOversizedLogFile(logFile, 1024, 5, "DAEMON_READY http://127.0.0.1:3999\n");

		expect(result.action).toBe("noop");
		// No rotation -> no append -> the file is untouched (no duplicate line).
		expect(fs.readFileSync(logFile, "utf8")).toBe("small\n");
	});
});

/**
 * Unit tests for `src/dashboard/lib/daemon-guard.ts` (FIX-008).
 *
 * The guard is the fast-fail boundary between the standalone dashboard and the
 * combined daemon: it must refuse to boot when a LIVE daemon owns the database
 * (one writer per DB), and must stay permissive when no daemon runs or only a
 * stale PID file is left behind. All filesystem fixtures live in a temp dir —
 * never in the repo tree and never in the real config dir.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertStandaloneDashboardAllowed,
	DashboardDaemonConflictError,
	detectDaemonHolder,
	detectEmbeddedWriterWarning,
	formatDaemonConflict,
	formatEmbeddedWriterWarning,
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
		const readCommandLine = () => "node bin/mcp-memory-server.js daemon --daemon-worker";

		expect(detectDaemonHolder({ env, isAlive: () => true, readCommandLine })).toEqual({
			pid: 4242,
			dir,
			logFile: path.join(dir, "daemon.log")
		});

		let caught: unknown;
		try {
			assertStandaloneDashboardAllowed({ env, isAlive: () => true, readCommandLine });
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

		expect(
			detectDaemonHolder({
				env: { LOCAL_MEMORY_DAEMON_DIR: dir },
				readCommandLine: () => "node bin/mcp-memory-server.js daemon --daemon-worker"
			})
		).toEqual({
			pid: process.pid,
			dir,
			logFile: path.join(dir, "daemon.log")
		});
	});

	it("rejects a reused PID instead of refusing the dashboard (N2)", () => {
		const dir = tempConfigDir();
		writeDaemonPid(dir, 5150);
		const env = { LOCAL_MEMORY_DAEMON_DIR: dir };
		const advisories: string[] = [];

		// Alive, but its command line is an unrelated process that inherited the PID.
		expect(
			detectDaemonHolder({
				env,
				isAlive: () => true,
				readCommandLine: () => "python3 /opt/unrelated/worker.py",
				log: (message) => advisories.push(message)
			})
		).toBeNull();
		expect(() =>
			assertStandaloneDashboardAllowed({
				env,
				isAlive: () => true,
				readCommandLine: () => "python3 /opt/unrelated/worker.py",
				log: () => {}
			})
		).not.toThrow();

		// Not silent: one advisory names the PID file, the PID, and the way to confirm.
		expect(advisories).toHaveLength(1);
		expect(advisories[0]).toContain("daemon.pid");
		expect(advisories[0]).toContain("5150");
		expect(advisories[0]).toContain("local-memory-mcp daemon status");
	});

	it("stays permissive when the command line cannot be read (identity unconfirmed)", () => {
		const dir = tempConfigDir();
		writeDaemonPid(dir, 6161);
		const env = { LOCAL_MEMORY_DAEMON_DIR: dir };

		// A non-Linux host without `ps` yields null: never treat that as a match.
		expect(detectDaemonHolder({ env, isAlive: () => true, readCommandLine: () => null })).toEqual({
			pid: 6161,
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

describe("embedded MCP child writer (FIX-012)", () => {
	it('stays quiet when DASHBOARD_ENABLE_MCP is unset or not exactly "true"', () => {
		expect(detectEmbeddedWriterWarning({})).toBeNull();
		expect(detectEmbeddedWriterWarning({ DASHBOARD_ENABLE_MCP: "false" })).toBeNull();
		// server.ts gates on the exact string, so the guard must agree with it.
		expect(detectEmbeddedWriterWarning({ DASHBOARD_ENABLE_MCP: "TRUE" })).toBeNull();
		expect(detectEmbeddedWriterWarning({ DASHBOARD_ENABLE_MCP: "1" })).toBeNull();
	});

	it("warns about the child writer and the contention it creates when the flag is on", () => {
		const warning = detectEmbeddedWriterWarning({ DASHBOARD_ENABLE_MCP: "true" });

		expect(warning).not.toBeNull();
		const message = warning?.message ?? "";
		// Names the cause ...
		expect(message).toContain("DASHBOARD_ENABLE_MCP=true");
		expect(message).toContain("child process");
		expect(message).toContain("second SQLiteStore + WriteLock");
		expect(message).toContain("memory.db.lock");
		// ... the symptom ...
		expect(message).toContain("~50s");
		expect(message).toContain("Failed to acquire exclusive write lock");
		// ... and both supported setups.
		expect(message).toContain("unset DASHBOARD_ENABLE_MCP");
		expect(message).toContain("local-memory-mcp daemon");
		expect(message).toContain("/mcp");
	});

	it("formats the same warning text the detector returns", () => {
		expect(detectEmbeddedWriterWarning({ DASHBOARD_ENABLE_MCP: "true" })?.message).toBe(formatEmbeddedWriterWarning());
	});
});

describe("guard-before-store invariant (FIX-013 / N4)", () => {
	/**
	 * Static import specifiers of a module, read from source.
	 *
	 * The guard must be evaluated BEFORE any module that constructs
	 * `SQLiteStore`. `server.ts` enforces that by dynamically importing
	 * `./lib/context` and `./app` after the guard call, so this test pins the
	 * invariant at the source level: a re-introduced static import of the store
	 * would be evaluated before the guard and silently reopen the second-writer
	 * path this whole module defends.
	 */
	const staticImportSources = (source: string): string[] => {
		const specifiers: string[] = [];
		const pattern = /^\s*import\s+(?:type\s+)?[^;]*?\bfrom\s+["']([^"']+)["']/gm;
		for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
		return specifiers;
	};

	/**
	 * Import specifiers that are EVALUATED at runtime.
	 *
	 * Same shape as {@link staticImportSources} minus the `import type` form:
	 * a type-only import is erased by the compiler, so it can never pull a
	 * module (and therefore a store) into the runtime graph.
	 *
	 * Three runtime forms are covered:
	 *   - `import … from "x"` / `export … from "x"` (a re-export evaluates the
	 *     target module too),
	 *   - `import "x"` (side-effect import — no `from` clause at all).
	 *
	 * Dynamic `import("x")` is NOT followed: it is evaluated at CALL time
	 * (after the guard has already run), not at module-evaluation time, which
	 * is the ordering this invariant protects.
	 */
	const runtimeImportSources = (source: string): string[] => {
		const specifiers: string[] = [];
		const fromForm = /^[ \t]*(?:import|export)\s+(?!type\s)[^;]*?\bfrom\s+["']([^"']+)["']/gm;
		for (const match of source.matchAll(fromForm)) specifiers.push(match[1]);
		const sideEffectForm = /^[ \t]*import\s+["']([^"']+)["']/gm;
		for (const match of source.matchAll(sideEffectForm)) specifiers.push(match[1]);
		return specifiers;
	};

	it("keeps ./lib/context and ./app out of server.ts's static imports", () => {
		const file = path.resolve(import.meta.dirname, "../../server.ts");
		const sources = staticImportSources(readFileSync(file, "utf8"));

		// Sanity: the guard itself is a static import (it must run first).
		expect(sources).toContain("./lib/daemon-guard");
		// The store + app graph are loaded dynamically, AFTER the guard.
		expect(sources.some((source) => source.includes("lib/context"))).toBe(false);
		expect(sources.some((source) => source.includes("/app"))).toBe(false);
	});

	/**
	 * Matches any form that names a module which constructs or reaches the
	 * store (`lib/context`, `storage/sqlite`, `write-lock`).
	 *
	 * Two shapes reach this test: relative import SPECIFIERS read from source
	 * (extension-less: `./lib/context`) and REPO-RELATIVE FILE PATHS resolved
	 * by the transitive walk (`src/dashboard/lib/context.ts`), so the pattern
	 * must accept both — a `context` path segment with an optional extension
	 * (`.[cm]?[jt]s`), and the storage filenames with or without theirs.
	 *
	 * The direct-import pin below only sees the guard's own specifiers, so an
	 * intermediary could pull the store in transitively (`daemon-guard.ts` →
	 * `mcp/cli/daemon.ts` → `…/storage/sqlite.ts`) and the guard would be
	 * evaluated AFTER the store — reopening exactly the second-writer path this
	 * module defends. The transitive walk below closes that hole; both checks
	 * share this one constant.
	 */
	const STORAGE_MODULE_PATTERN = /(^|\/)context(\.[cm]?[jt]s)?$|storage\/(sqlite|write-lock)/;

	it("keeps the guard module free of storage imports", () => {
		const file = path.resolve(import.meta.dirname, "../../lib/daemon-guard.ts");
		const sources = staticImportSources(readFileSync(file, "utf8"));

		for (const source of sources) {
			expect(source).not.toMatch(STORAGE_MODULE_PATTERN);
		}
	});

	/** Resolve a relative import specifier to the file it points at, if any. */
	const resolveImport = (fromFile: string, specifier: string): string | null => {
		if (!specifier.startsWith(".")) return null;
		const base = path.resolve(path.dirname(fromFile), specifier);
		const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
		for (const candidate of candidates) {
			if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
		}
		return null;
	};

	/**
	 * Every module reachable from `entryFile` through relative RUNTIME imports.
	 *
	 * Bare/aliased package specifiers are skipped: they resolve outside the
	 * repository, so they cannot pull in a repo-local storage module. Type-only
	 * imports are skipped too — `import type` is erased at compile time, so it
	 * never evaluates (and never constructs) the store.
	 */
	const transitiveImports = (entryFile: string): string[] => {
		const seen = new Set<string>();
		const queue = [entryFile];
		while (queue.length > 0) {
			const current = queue.pop() as string;
			for (const specifier of runtimeImportSources(readFileSync(current, "utf8"))) {
				const resolved = resolveImport(current, specifier);
				if (resolved === null || seen.has(resolved)) continue;
				seen.add(resolved);
				queue.push(resolved);
			}
		}
		return [...seen];
	};

	it("keeps the guard's transitive import graph free of storage modules", () => {
		const file = path.resolve(import.meta.dirname, "../../lib/daemon-guard.ts");
		const repoRoot = path.resolve(import.meta.dirname, "../../../..");
		const graph = transitiveImports(file);

		// Sanity: the walk really followed the chain (otherwise the assertion
		// below would pass vacuously).
		expect(graph.map((module) => path.relative(repoRoot, module))).toEqual(
			expect.arrayContaining([
				path.join("src", "mcp", "cli", "daemon.ts"),
				path.join("src", "mcp", "cli", "dashboard-takeover.ts")
			])
		);

		for (const module of graph) {
			expect(path.relative(repoRoot, module).split(path.sep).join("/")).not.toMatch(STORAGE_MODULE_PATTERN);
		}
	});
});

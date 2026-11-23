/**
 * The README's CLI examples are executed here, not eyeballed (FIX-028).
 *
 * A documented command that cannot run is a broken contract, so the examples are
 * asserted against the REAL dispatcher: the dashboard context is mocked with an
 * in-memory store (no user database is touched) while the transport, the flag
 * parser and the executors are the shipped ones.
 *
 * The content-grep example needs an indexed repo root, so the test indexes a
 * throwaway fixture with the CLI itself and then runs the documented command.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../storage/sqlite");
	const db = new SQLiteStore(":memory:");
	return {
		db,
		vectors: {
			upsert: vi.fn(),
			remove: vi.fn(),
			search: vi.fn(async () => [])
		}
	};
});

import { runRootCli } from "../../cli/root";

/** Run one argv with the real transport, capturing both channels. */
async function run(argv: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const result = await runRootCli(argv, {
		stdout: (text: string) => out.push(text),
		stderr: (text: string) => err.push(text),
		env: {},
		readStdin: () => "",
		daemonStatus: () => ({ running: false, pid: null })
	});
	return { result, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("README — command line examples", () => {
	it("runs the documented content-grep example exactly as written", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "readme-cli-"));
		fs.writeFileSync(path.join(root, "a.ts"), "export const callLocalTool = 1;\n");

		const indexed = await run(["codebase-index", "--repo", "demo/repo", "--repoPath", root]);
		expect(indexed.result).toEqual({ handled: true, exitCode: 0 });

		const { result, stdout } = await run([
			"codebase-read",
			"--content",
			"callLocalTool",
			"--repo",
			"demo/repo",
			"--repoPath",
			root
		]);

		expect(result).toEqual({ handled: true, exitCode: 0 });
		expect(stdout).toContain("a.ts");
	}, 120_000);

	it("confirms --repoPath is load-bearing, not cosmetic", async () => {
		const { result, stderr } = await run([
			"codebase-read",
			"--content",
			"callLocalTool",
			"--repo",
			"vheins/local-memory-mcp"
		]);

		expect(result).toEqual({ handled: true, exitCode: 1 });
		expect(stderr).toContain("repoPath");
	}, 120_000);
});

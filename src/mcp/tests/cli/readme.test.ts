/**
 * The README's command-line examples are EXECUTED here, not eyeballed (TASK-013).
 *
 * A documented command that cannot run is a broken contract, so every example in
 * the README's "Command line" section is fed to the REAL dispatcher: the dashboard
 * context is mocked with an in-memory store (no user database is touched) while the
 * transport, the flag parser and the executors are the shipped ones.
 *
 * Selection rule (deliberate, so a new example cannot slip past): every fenced
 * `bash` line in that section that starts with `local-memory-mcp` or `cat ` is
 * either run or listed in `NOT_RUNNABLE` with the reason it cannot run against a
 * throwaway fixture. An unlisted line is executed, so an example that stops
 * working fails this test; a listed line that disappears from the README fails
 * too, so the skip list cannot rot.
 *
 * Substitution rule: the codebase-read example writes its root as `.` (run from
 * the repo root). The test replaces that one token with its fixture directory and
 * indexes the fixture under the same `--repo` name the README uses, so the flags,
 * the tool name and the schema stay exactly as documented.
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

/** The repository README, resolved from this file rather than the process cwd. */
const README_URL = new URL("../../../../README.md", import.meta.url);

/** Documented examples a temp fixture cannot serve, with the reason. */
const NOT_RUNNABLE: Record<string, string> = {
	"local-memory-mcp memory-read --code MEM-024":
		"needs a seeded memory row; the detail path is covered by root.test.ts",
	"cat args.json | local-memory-mcp task-read --input -":
		"a shell pipeline over a local file; --input - is covered by root.test.ts"
};

/** Root placeholders the README may use for the checkout being indexed. */
const ROOT_PLACEHOLDERS = new Set([".", "<repo-root>", "$REPO_ROOT"]);

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

/** Drop a trailing `   # …` comment; no documented argument contains one. */
function stripComment(line: string): string {
	return line.replace(/\s+#.*$/, "").trim();
}

/** Split a documented command into argv, honouring single and double quotes. */
function tokenize(command: string): string[] {
	const tokens: string[] = [];
	const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(command)) !== null) {
		tokens.push(match[1] ?? match[2] ?? match[3]);
	}
	return tokens;
}

/** Every executable example line from the README's "Command line" section. */
function documentedCommands(markdown: string): string[] {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.startsWith("### ") && line.includes("Command line"));
	expect(start, "README is missing its '### ⌨️ Command line' section").toBeGreaterThanOrEqual(0);

	const commands: string[] = [];
	let inBashFence = false;
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("### ")) break;
		if (line.trimStart().startsWith("```")) {
			inBashFence = inBashFence ? false : line.trimStart() === "```bash";
			continue;
		}
		if (!inBashFence) continue;
		const command = stripComment(line);
		if (command.startsWith("local-memory-mcp ") || command.startsWith("cat ")) commands.push(command);
	}
	return commands;
}

/** Value of `--flag` in an argv slice, or null when the flag is absent. */
function flagValue(tokens: string[], flag: string): string | null {
	const index = tokens.indexOf(flag);
	return index >= 0 ? (tokens[index + 1] ?? null) : null;
}

describe("README — command line examples", () => {
	it("executes every documented example a temp fixture can serve", async () => {
		const commands = documentedCommands(fs.readFileSync(README_URL, "utf8"));
		expect(commands.length).toBeGreaterThan(0);

		// A skip whose line no longer exists would hide a documented command.
		for (const skipped of Object.keys(NOT_RUNNABLE)) expect(commands).toContain(skipped);

		const root = fs.mkdtempSync(path.join(os.tmpdir(), "readme-cli-"));
		fs.writeFileSync(path.join(root, "a.ts"), "export const callLocalTool = 1;\n");

		const executed = commands.filter((command) => !(command in NOT_RUNNABLE));

		// Index the fixture under whatever repo name the README documents.
		for (const command of executed) {
			const argv = tokenize(command).slice(1);
			if (argv[0] !== "codebase-read") continue;
			const repo = flagValue(argv, "--repo");
			expect(repo, `the documented codebase-read example must name a --repo: ${command}`).toBeTruthy();
			const indexed = await run(["codebase-index", "--repo", repo as string, "--repoPath", root]);
			expect(indexed.result, `indexing the fixture for: ${command}`).toEqual({ handled: true, exitCode: 0 });
		}

		for (const command of executed) {
			const argv = tokenize(command).slice(1);
			const rootIndex = argv.indexOf("--repoPath");
			if (rootIndex >= 0) {
				const documented = argv[rootIndex + 1];
				expect(
					ROOT_PLACEHOLDERS.has(documented ?? ""),
					`the documented --repoPath must be one of ${[...ROOT_PLACEHOLDERS].join(", ")}: ${command}`
				).toBe(true);
				argv[rootIndex + 1] = root;
			}

			const { result, stderr } = await run(argv);
			expect(result, `documented example failed: ${command}\n${stderr}`).toEqual({ handled: true, exitCode: 0 });
		}

		expect(
			executed.some((command) => tokenize(command)[1] === "codebase-read"),
			"the README must keep a codebase-read example for this test to guard"
		).toBe(true);
	}, 120_000);

	it("confirms --repoPath is load-bearing, not cosmetic", async () => {
		const commands = documentedCommands(fs.readFileSync(README_URL, "utf8"));
		const command = commands.find((line) => tokenize(line)[1] === "codebase-read");
		expect(command, "the README must keep a codebase-read example").toBeTruthy();

		// Same documented command, minus the root flag: the tool must refuse.
		const argv = tokenize(command as string).slice(1);
		const rootIndex = argv.indexOf("--repoPath");
		expect(rootIndex).toBeGreaterThanOrEqual(0);
		const withoutRoot = [...argv.slice(0, rootIndex), ...argv.slice(rootIndex + 2)];

		const { result, stderr } = await run(withoutRoot);
		expect(result).toEqual({ handled: true, exitCode: 1 });
		expect(stderr).toContain("repoPath");
	}, 120_000);
});

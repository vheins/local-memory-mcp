/**
 * The README's command-line examples are EXECUTED here, not eyeballed (TASK-013).
 *
 * A documented command that cannot run is a broken contract, so every example in
 * the README's "Command line" section is fed to the REAL dispatcher: the dashboard
 * context is mocked with an in-memory store (no user database is touched) while the
 * transport, the flag parser and the executors are the shipped ones.
 *
 * Selection rule (deliberate, so a new example cannot slip past): every fenced
 * `bash` line in that section that mentions the CLI binary is either run or listed
 * in `NOT_RUNNABLE` with the reason it cannot run against a throwaway fixture. A
 * line that mentions the binary but holds no runnable CLI command must be listed
 * too, so an example that stops working fails this test; a listed line that
 * disappears from the README fails too, so the skip list cannot rot.
 *
 * Normalization rule (TASK-016): a documented line may carry a shell prompt (`$ `),
 * leading environment assignments (`FOO=bar `), a package-runner prefix (`npx `,
 * `pnpm exec `) or a pipeline (`cat file | …`). The normalizer strips those and
 * keeps the LAST pipeline segment that invokes the CLI binary, so the command the
 * dispatcher runs is the documented one however it is spelled.
 *
 * Fence rule (TASK-017): a fenced block is scanned when its info string starts with
 * `bash`, `sh` or `console` (case-insensitive, trailing attributes allowed). A CLI
 * line inside any other fence language FAILS the test — naming that line — unless
 * the language is listed in `SKIPPED_FENCE_LANGUAGES` with a reason, so a runnable
 * example cannot hide behind an unusual fence either.
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

/** The CLI binary names a documented example may invoke. */
const CLI_BINARIES = ["local-memory-mcp", "mcp-memory-server"];

/** Fence info strings whose bodies hold executable commands (lowercased first token). */
const SHELL_FENCE_LANGUAGES = new Set(["bash", "sh", "console"]);

/**
 * Fence languages that may hold CLI-looking text without being executed, with the
 * reason. Empty on purpose: every entry re-opens the silent-skip hole this test
 * closes, so add one only when the language's body can never be a command.
 */
const SKIPPED_FENCE_LANGUAGES: Record<string, string> = {};

/** One documented example: the fence line as written and the command it holds. */
interface DocumentedExample {
	/** The fence line as written, with any trailing comment removed. */
	raw: string;
	/** The CLI command the line contains, or null when it holds none. */
	command: string | null;
}

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

/** Split a line into pipeline segments, leaving pipes inside quotes alone. */
function splitPipeline(line: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (const char of line) {
		if (quote) {
			current += char;
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === "|") {
			segments.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	segments.push(current);
	return segments;
}

/** Strip the shell decorations in front of a command: prompt, env, runner. */
function stripDecorators(segment: string): string {
	let text = segment.trim();
	if (text === "$") return "";
	if (text.startsWith("$ ")) text = text.slice(2).trim();
	text = text.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)+/, "");
	text = text.replace(/^(?:npx|pnpm[ \t]+exec|npm[ \t]+exec)[ \t]+/, "");
	return text;
}

/** The CLI command a documented line holds: the last segment that invokes it. */
function normalizeCommand(line: string): string | null {
	for (const segment of splitPipeline(line).reverse()) {
		const text = stripDecorators(segment);
		if (CLI_BINARIES.some((binary) => text === binary || text.startsWith(`${binary} `))) return text;
	}
	return null;
}

/** Whether a line mentions a CLI binary at all. */
function mentionsBinary(line: string): boolean {
	return CLI_BINARIES.some((binary) => new RegExp(`\\b${binary}\\b`).test(line));
}

/** Lowercased first token of a fence's info string (` ```bash title=x ` → `bash`). */
function fenceInfoLanguage(openingLine: string): string {
	const info = openingLine.replace(/^`+/, "").trim();
	return (info.split(/\s+/)[0] ?? "").toLowerCase();
}

/** Every example line from the README's "Command line" section, plus loud failures. */
function documentedExamples(markdown: string): DocumentedExample[] {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.startsWith("### ") && line.includes("Command line"));
	expect(start, "README is missing its '### ⌨️ Command line' section").toBeGreaterThanOrEqual(0);

	const examples: DocumentedExample[] = [];
	const offenders: string[] = [];
	let open: string | null = null; // fence language while a block is open
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("### ")) break;
		const trimmed = line.trimStart();
		if (trimmed.startsWith("```")) {
			open = open === null ? fenceInfoLanguage(trimmed) : null;
			continue;
		}
		if (open === null) continue;
		const raw = stripComment(line);
		if (raw.length === 0 || raw.startsWith("#")) continue;
		if (!mentionsBinary(raw)) continue;
		const language = open.toLowerCase();
		if (SHELL_FENCE_LANGUAGES.has(language)) {
			examples.push({ raw, command: normalizeCommand(raw) });
		} else if (!(language in SKIPPED_FENCE_LANGUAGES)) {
			offenders.push(raw);
		}
	}
	expect(
		offenders,
		`CLI lines in unrecognized fences — classify them: execute via a bash/sh/console fence, or list the language in SKIPPED_FENCE_LANGUAGES with a reason:\n${offenders.join("\n")}`
	).toEqual([]);
	return examples;
}

/** Value of `--flag` in an argv slice, or null when the flag is absent. */
function flagValue(tokens: string[], flag: string): string | null {
	const index = tokens.indexOf(flag);
	return index >= 0 ? (tokens[index + 1] ?? null) : null;
}

/** The prefix spellings a documented example may use, each with its command. */
const PREFIX_FORMS: ReadonlyArray<{ note: string; line: string; command: string }> = [
	{ note: "plain", line: "local-memory-mcp about --json", command: "local-memory-mcp about --json" },
	{ note: "shell prompt", line: "$ local-memory-mcp about --json", command: "local-memory-mcp about --json" },
	{ note: "npx runner", line: "npx local-memory-mcp about --json", command: "local-memory-mcp about --json" },
	{ note: "pnpm runner", line: "pnpm exec local-memory-mcp about --json", command: "local-memory-mcp about --json" },
	{
		note: "environment assignment",
		line: "VACUUM_ON_STARTUP=true local-memory-mcp about --json",
		command: "local-memory-mcp about --json"
	},
	{ note: "pipeline", line: "cat args.json | local-memory-mcp about --json", command: "local-memory-mcp about --json" },
	{ note: "other binary name", line: "mcp-memory-server about --json", command: "mcp-memory-server about --json" }
];

/** The fence languages a documented example may live in, with the opening line. */
const FENCE_FORMS: ReadonlyArray<{ note: string; opening: string; line: string }> = [
	{ note: "bash fence", opening: "```bash", line: "local-memory-mcp about --json" },
	{ note: "sh fence", opening: "```sh", line: "local-memory-mcp about --json" },
	{ note: "console fence", opening: "```console", line: "local-memory-mcp about --json" },
	{ note: "uppercase fence", opening: "```SH", line: "local-memory-mcp about --json" },
	{ note: "fence with attributes", opening: '```bash title="cli"', line: "local-memory-mcp about --json" }
];

/** A README-shaped markdown document holding one fenced block. */
function fenced(opening: string, body: string[]): string {
	return ["### ⌨️ Command line", "", opening, ...body, "```", ""].join("\n");
}

describe("README — command line examples", () => {
	it("executes every documented example a temp fixture can serve", async () => {
		const examples = documentedExamples(fs.readFileSync(README_URL, "utf8"));
		expect(examples.length).toBeGreaterThan(0);

		// A skip whose line no longer exists would hide a documented command.
		for (const skipped of Object.keys(NOT_RUNNABLE)) {
			expect(examples.map((example) => example.raw)).toContain(skipped);
		}

		const root = fs.mkdtempSync(path.join(os.tmpdir(), "readme-cli-"));
		fs.writeFileSync(path.join(root, "a.ts"), "export const callLocalTool = 1;\n");

		const executed = examples.filter((example) => !(example.raw in NOT_RUNNABLE));

		// Index the fixture under whatever repo name the README documents.
		for (const example of executed) {
			expect(example.command, `documented example holds no runnable CLI command: ${example.raw}`).toBeTruthy();
			const argv = tokenize(example.command as string).slice(1);
			if (argv[0] !== "codebase-read") continue;
			const repo = flagValue(argv, "--repo");
			expect(repo, `the documented codebase-read example must name a --repo: ${example.raw}`).toBeTruthy();
			const indexed = await run(["codebase-index", "--repo", repo as string, "--repoPath", root]);
			expect(indexed.result, `indexing the fixture for: ${example.raw}`).toEqual({ handled: true, exitCode: 0 });
		}

		for (const example of executed) {
			const argv = tokenize(example.command as string).slice(1);
			const rootIndex = argv.indexOf("--repoPath");
			if (rootIndex >= 0) {
				const documented = argv[rootIndex + 1];
				expect(
					ROOT_PLACEHOLDERS.has(documented ?? ""),
					`the documented --repoPath must be one of ${[...ROOT_PLACEHOLDERS].join(", ")}: ${example.raw}`
				).toBe(true);
				argv[rootIndex + 1] = root;
			}

			const { result, stderr } = await run(argv);
			expect(result, `documented example failed: ${example.raw}\n${stderr}`).toEqual({ handled: true, exitCode: 0 });
		}

		expect(
			executed.some((example) => tokenize(example.command as string)[1] === "codebase-read"),
			"the README must keep a codebase-read example for this test to guard"
		).toBe(true);
	}, 120_000);

	it("confirms --repoPath is load-bearing, not cosmetic", async () => {
		const examples = documentedExamples(fs.readFileSync(README_URL, "utf8"));
		const example = examples.find((entry) => tokenize(entry.command ?? "")[1] === "codebase-read");
		expect(example, "the README must keep a codebase-read example").toBeTruthy();

		// Same documented command, minus the root flag: the tool must refuse.
		const argv = tokenize((example as DocumentedExample).command as string).slice(1);
		const rootIndex = argv.indexOf("--repoPath");
		expect(rootIndex).toBeGreaterThanOrEqual(0);
		const withoutRoot = [...argv.slice(0, rootIndex), ...argv.slice(rootIndex + 2)];

		const { result, stderr } = await run(withoutRoot);
		expect(result).toEqual({ handled: true, exitCode: 1 });
		expect(stderr).toContain("repoPath");
	}, 120_000);

	it("extracts and runs a documented command under every supported prefix", async () => {
		for (const form of PREFIX_FORMS) {
			const markdown = fenced("```bash", [form.line]);
			const examples = documentedExamples(markdown);

			expect(
				examples.map((entry) => entry.raw),
				`the ${form.note} form must be extracted`
			).toEqual([form.line]);
			expect(examples[0]?.command, `the ${form.note} form must yield the CLI command`).toBe(form.command);

			const argv = tokenize(form.command).slice(1);
			const { result, stderr } = await run(argv);
			expect(result, `the ${form.note} form failed to run\n${stderr}`).toEqual({ handled: true, exitCode: 0 });
		}
	}, 120_000);

	it("extracts and runs a documented command from every recognized fence language", async () => {
		for (const form of FENCE_FORMS) {
			const markdown = fenced(form.opening, [form.line]);
			const examples = documentedExamples(markdown);

			expect(
				examples.map((entry) => entry.raw),
				`the ${form.note} must be extracted`
			).toEqual([form.line]);
			expect(examples[0]?.command, `the ${form.note} must yield the CLI command`).toBe(form.line);

			const argv = tokenize(form.line).slice(1);
			const { result, stderr } = await run(argv);
			expect(result, `the ${form.note} failed to run\n${stderr}`).toEqual({ handled: true, exitCode: 0 });
		}
	}, 120_000);

	it("fails loudly when a CLI line hides in an unrecognized fence language", () => {
		const markdown = fenced("```text", ["local-memory-mcp about --json"]);
		expect(() => documentedExamples(markdown)).toThrow(/unrecognized fences[\s\S]*local-memory-mcp about --json/);
	});

	it("skips a listed fence language only while its reason stands", () => {
		const markdown = fenced("```text", ["local-memory-mcp about --json"]);
		SKIPPED_FENCE_LANGUAGES.text = "synthetic fixture: this language is never a shell";
		try {
			expect(documentedExamples(markdown)).toEqual([]);
		} finally {
			delete SKIPPED_FENCE_LANGUAGES.text;
		}
		// The allowlist entry is gone again: the same line must be loud once more.
		expect(() => documentedExamples(markdown)).toThrow(/unrecognized fences/);
	});
});

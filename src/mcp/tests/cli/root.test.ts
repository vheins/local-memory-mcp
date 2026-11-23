/**
 * Root CLI dispatch tests (TASK-011).
 *
 * Every assertion here runs against the real dispatcher with the transport, the
 * daemon probe and the IO channels injected — so a change to the command surface
 * (help, exit codes, flag parsing, routing) fails here rather than in a shell.
 *
 * The transport is a spy: these tests prove WHICH call the CLI makes and with
 * what arguments. The real in-process round trip lives in `tool-transport.test.ts`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { builtinTokens } from "../../cli/help";
import { runRootCli, type RootCliOverrides } from "../../cli/root";
import { loadToolInventory } from "../../cli/tool-registry";
import { ToolTransportError, type ToolOutcome, type ToolTransport } from "../../cli/tool-transport";

/** One recorded transport call. */
interface Call {
	name: string;
	args: Record<string, unknown>;
	timeoutMs: number | null;
}

/** Test harness: captured output plus a spied transport. */
function harness(overrides: Partial<RootCliOverrides> = {}) {
	const out: string[] = [];
	const err: string[] = [];
	const calls: Call[] = [];
	const outcome: ToolOutcome = {
		transport: "in-process",
		isError: false,
		structuredContent: { ok: true },
		text: "ok"
	};
	const transport: ToolTransport = {
		select: () => "in-process",
		call: vi.fn(async (name: string, args: Record<string, unknown>, timeoutMs: number | null) => {
			calls.push({ name, args, timeoutMs });
			return outcome;
		})
	};
	const io: RootCliOverrides = {
		stdout: (text: string) => out.push(text),
		stderr: (text: string) => err.push(text),
		env: { MEMORY_DB_PATH: "/tmp/task011-memory.db" },
		readStdin: () => '{"query":"from-stdin"}',
		daemonStatus: () => ({ running: false, pid: null }),
		transport,
		...overrides
	};
	return { io, out, err, calls, transport, outcome };
}

/** Run the CLI and join the captured channels. */
async function run(argv: string[], overrides: Partial<RootCliOverrides> = {}) {
	const h = harness(overrides);
	const result = await runRootCli(argv, h.io);
	return { ...h, result, stdout: h.out.join("\n"), stderr: h.err.join("\n") };
}

describe("runRootCli — fall-through to the existing argv branches", () => {
	it("hands a zero-argument launch back to the stdio server", async () => {
		const { result, stdout } = await run([]);
		expect(result).toEqual({ handled: false });
		expect(stdout).toBe("");
	});

	it("leaves daemon, dashboard and --index to their own branches", async () => {
		for (const argv of [["daemon", "start"], ["dashboard"], ["--index", "--repo", "a/b", "--path", "."], ["doctor"]]) {
			const { result } = await run(argv);
			expect(result, argv.join(" ")).toEqual({ handled: false });
		}
	});

	it("still answers --help for a passthrough command", async () => {
		const { result, stdout } = await run(["daemon", "--help"]);
		expect(result).toEqual({ handled: true, exitCode: 0 });
		expect(stdout).toContain("daemon start");
	});
});

describe("runRootCli — help and version", () => {
	it("prints grouped root help for --help, -h and help", async () => {
		for (const argv of [["--help"], ["-h"], ["help"]]) {
			const { result, stdout } = await run(argv);
			expect(result, argv.join(" ")).toEqual({ handled: true, exitCode: 0 });
			expect(stdout).toContain("TOOL COMMANDS");
			expect(stdout).toContain("memory-read");
		}
	});

	it("prints the tool's generated flag table for 'help <tool>' and '<tool> --help'", async () => {
		for (const argv of [
			["help", "memory-read"],
			["memory-read", "--help"]
		]) {
			const { result, stdout } = await run(argv);
			expect(result, argv.join(" ")).toEqual({ handled: true, exitCode: 0 });
			expect(stdout).toContain("--query");
			expect(stdout).toContain("JSON SCHEMA");
		}
	});

	it("answers the short globals after a tool name, without issuing a call", async () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
			name: string;
			version: string;
		};

		const helped = await run(["memory-read", "-h"]);
		expect(helped.result).toEqual({ handled: true, exitCode: 0 });
		expect(helped.stdout).toContain("--query");
		expect(helped.calls).toEqual([]);

		const versioned = await run(["memory-read", "--query", "auth", "-V"]);
		expect(versioned.result).toEqual({ handled: true, exitCode: 0 });
		expect(versioned.stdout).toBe(`${pkg.name} ${pkg.version}`);
		expect(versioned.calls).toEqual([]);

		const generic = await run(["tools", "call", "memory-read", "-h"]);
		expect(generic.result).toEqual({ handled: true, exitCode: 0 });
		expect(generic.stdout).toContain("JSON SCHEMA");
		expect(generic.calls).toEqual([]);
	});

	it("honours an explicit false on the output global instead of printing JSON", async () => {
		const off = await run(["memory-read", "--query", "auth", "--json-out=false"]);
		expect(off.result).toEqual({ handled: true, exitCode: 0 });
		expect(off.stdout).toBe("ok");

		const on = await run(["memory-read", "--query", "auth", "--json-out"]);
		expect(on.stdout).toBe(JSON.stringify({ ok: true }, null, 2));

		const leading = await run(["--json-out=false", "tools", "list"]);
		expect(leading.stdout).toContain("memory-read");
		expect(leading.stdout).not.toContain('"count"');
	});

	it("prints '<name> <semver>' for --version/-V/version, without the build stamp", async () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
			name: string;
			version: string;
		};
		for (const argv of [["--version"], ["-V"], ["version"]]) {
			const { result, stdout } = await run(argv);
			expect(result, argv.join(" ")).toEqual({ handled: true, exitCode: 0 });
			expect(stdout).toBe(`${pkg.name} ${pkg.version}`);
			expect(stdout).not.toContain("[");
		}
	});
});

describe("runRootCli — about", () => {
	it("reports build, paths and daemon status as JSON", async () => {
		const { result, stdout } = await run(["about", "--json"]);
		const parsed = JSON.parse(stdout) as Record<string, unknown>;

		expect(result).toEqual({ handled: true, exitCode: 0 });
		expect(parsed.dbPath).toBe("/tmp/task011-memory.db");
		expect(parsed.daemonRunning).toBe(false);
		expect(String(parsed.transport)).toContain("in-process");
		expect(typeof parsed.version).toBe("string");
		expect(String(parsed.node)).toMatch(/^v\d+/);
	});

	it("reports a running daemon and its endpoint", async () => {
		const { stdout } = await run(["about"], {
			daemonStatus: () => ({ running: true, pid: 999 }),
			env: { MEMORY_DB_PATH: "/tmp/task011-memory.db", PORT: "4567" }
		});

		expect(stdout).toContain("running (pid 999)");
		expect(stdout).toContain("http://127.0.0.1:4567/mcp");
	});

	it("honours a leading --json", async () => {
		const { stdout } = await run(["--json", "about"]);
		expect(() => JSON.parse(stdout)).not.toThrow();
	});
});

describe("runRootCli — tools group", () => {
	it("lists the canonical tools", async () => {
		const { result, stdout } = await run(["tools", "list"]);
		expect(result).toEqual({ handled: true, exitCode: 0 });
		for (const name of ["memory-read", "task-write", "codebase-read"]) expect(stdout).toContain(name);
	});

	it("describes a tool's schema as JSON", async () => {
		const { stdout } = await run(["tools", "describe", "memory-read", "--json"]);
		const parsed = JSON.parse(stdout) as { inputSchema: { properties: Record<string, unknown> } };
		expect(parsed.inputSchema.properties.code).toBeDefined();
	});

	it("routes 'tools call' through the same handler as the direct form", async () => {
		const direct = await run(["memory-read", "--query", "auth", "--limit", "5"]);
		const generic = await run(["tools", "call", "memory-read", "--query", "auth", "--limit", "5"]);

		expect(direct.calls).toEqual([{ name: "memory-read", args: { query: "auth", limit: 5 }, timeoutMs: null }]);
		expect(generic.calls).toEqual(direct.calls);
	});
});

describe("runRootCli — direct tool commands", () => {
	it("routes a named-flag invocation to the transport", async () => {
		const { result, calls, stdout } = await run(["memory-read", "--code=abc", "--status=active"]);

		// `--status` is not a memory-read parameter: the CLI must reject it rather
		// than forward it, which the next assertion pins down.
		expect(result).toEqual({ handled: true, exitCode: 2 });
		expect(calls).toEqual([]);
		expect(stdout).toBe("");

		const accepted = await run(["memory-read", "--code=abc", "--limit=5", "--timeout", "2500"]);
		expect(accepted.result).toEqual({ handled: true, exitCode: 0 });
		expect(accepted.calls).toEqual([{ name: "memory-read", args: { code: "abc", limit: 5 }, timeoutMs: 2500 }]);
		expect(accepted.stdout).toBe("ok");
	});

	it("reads the whole payload from stdin", async () => {
		const { calls } = await run(["memory-read", "--input", "-"]);
		expect(calls[0]?.args).toEqual({ query: "from-stdin" });
	});

	it("lets the tool's own json field win over the output global", async () => {
		const toolField = await run(["handoff-write", "--json=true", "--summary", "s"]);
		expect(toolField.calls[0]?.args).toEqual({ json: true, summary: "s" });
		// The tool field and the global mean the same thing for this tool, so the
		// output is machine-readable under either spelling.
		expect(toolField.stdout).toContain('"ok": true');

		const outputGlobal = await run(["handoff-write", "--json-out", "--summary", "s"]);
		// The global output switch also turns the tool's own `json` field on, which
		// is what makes `structuredContent` exist to print.
		expect(outputGlobal.calls[0]?.args).toEqual({ summary: "s", json: true });
		expect(outputGlobal.stdout).toContain('"ok": true');
	});

	it("emits the override note unless --quiet", async () => {
		const loud = await run(["memory-read", "--args", '{"query":"a"}', "--query", "b"]);
		expect(loud.stderr).toContain("overrides the value from --args");

		const quiet = await run(["memory-read", "--args", '{"query":"a"}', "--query", "b", "--quiet"]);
		expect(quiet.stderr).toBe("");
	});

	it("reports an unavailable tool as a runtime failure, without calling it", async () => {
		const { result, calls, stderr } = await run(["synthesize", "--objective", "x"]);
		expect(result).toEqual({ handled: true, exitCode: 1 });
		expect(calls).toEqual([]);
		expect(stderr).toContain("not callable from the CLI");
	});

	it("maps a tool error envelope to exit 1", async () => {
		const outcome: ToolOutcome = {
			transport: "in-process",
			isError: true,
			structuredContent: { code: "NOT_FOUND", message: "No memory" },
			text: "No memory"
		};
		const { result, stderr } = await run(["memory-read", "--code", "x"], {
			transport: { select: () => "in-process", call: async () => outcome }
		});

		expect(result).toEqual({ handled: true, exitCode: 1 });
		expect(stderr).toContain("error: No memory");
	});

	it("maps a daemon-path transport failure to exit 1 with the one-writer hint", async () => {
		const failure = new ToolTransportError(
			"Could not reach the daemon's MCP endpoint at http://127.0.0.1:3456/mcp: ECONNREFUSED",
			"the CLI will not open a second database while the daemon owns one."
		);
		const local = vi.fn();
		const { result, stderr } = await run(["memory-read", "--query", "x"], {
			daemonStatus: () => ({ running: true, pid: 42 }),
			transport: {
				select: () => "http",
				call: async () => {
					throw failure;
				}
			}
		});

		expect(result).toEqual({ handled: true, exitCode: 1 });
		expect(stderr).toContain("Could not reach the daemon");
		expect(stderr).toContain("will not open a second database");
		expect(local).not.toHaveBeenCalled();
	});
});

describe("runRootCli — usage errors", () => {
	it("suggests the closest tool name for an unknown command", async () => {
		const { result, stderr } = await run(["memroy-read"]);
		expect(result).toEqual({ handled: true, exitCode: 2 });
		expect(stderr).toContain("unknown command 'memroy-read'");
		expect(stderr).toContain("did you mean 'memory-read'?");
	});

	it("suggests the closest flag for an unknown flag", async () => {
		const { result, stderr } = await run(["memory-read", "--qurey", "x"]);
		expect(result).toEqual({ handled: true, exitCode: 2 });
		expect(stderr).toContain("did you mean '--query'?");
	});

	it("names the missing required parameters", async () => {
		const { result, stderr } = await run(["repo-summarize", "--owner", "vheins"]);
		expect(result).toEqual({ handled: true, exitCode: 2 });
		expect(stderr).toContain("missing required parameter(s) for repo-summarize: --signals");
	});

	it("rejects two whole-payload sources", async () => {
		const { result, stderr } = await run(["memory-read", "--args", "{}", "--input", "-"]);
		expect(result).toEqual({ handled: true, exitCode: 2 });
		expect(stderr).toContain("exactly one of --args / --input");
	});

	it("suggests a tools subcommand", async () => {
		const { result, stderr } = await run(["tools", "lis"]);
		expect(result).toEqual({ handled: true, exitCode: 2 });
		expect(stderr).toContain("did you mean 'tools list'?");
	});
});

describe("runRootCli — dispatch precedence", () => {
	it("never lets a built-in token shadow a registry tool name", () => {
		const names = new Set(loadToolInventory().map((tool) => tool.name));
		for (const token of builtinTokens()) {
			expect(names.has(token), `built-in '${token}' collides with a tool name`).toBe(false);
		}
	});

	it("reads a payload file through --input <path>", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task011-"));
		const file = path.join(dir, "args.json");
		fs.writeFileSync(file, '{"query":"from-file"}');

		const { calls } = await run(["memory-read", "--input", file]);
		expect(calls[0]?.args).toEqual({ query: "from-file" });
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

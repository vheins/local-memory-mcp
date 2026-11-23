/**
 * Unit tests for the root CLI's named-flag layer (TASK-011).
 *
 * The flags are DERIVED from the registry's `inputSchema`, so these tests assert
 * the derivation against the real tool definitions — a tool whose schema changes
 * shape must fail here rather than silently change the CLI contract.
 *
 * Pure unit: no store, no transport, no process exit.
 */

import { describe, expect, it } from "vitest";
import {
	AUTO_FILLABLE_PARAMS,
	RESERVED_GLOBAL_NAMES,
	UsageError,
	deriveToolFlagModel,
	emptyGlobalFlags,
	parseToolInvocation,
	scanLeadingGlobals,
	type ToolFlagModel
} from "../../cli/flags";
import { loadToolInventory, type CliTool } from "../../cli/tool-registry";

const tools = loadToolInventory();

/** Look one registry tool up by canonical name. */
function tool(name: string): CliTool {
	const found = tools.find((candidate) => candidate.name === name);
	if (!found) throw new Error(`missing tool ${name}`);
	return found;
}

/** Parse with a flag model derived from the same tool. */
function parse(name: string, tokens: string[], stdin = "{}") {
	const target = tool(name);
	const model = deriveToolFlagModel(target);
	return parseToolInvocation(target, model, tokens, { readStdin: () => stdin });
}

/** A synthetic tool, for schema shapes the real registry does not currently have. */
function synthetic(inputSchema: Record<string, unknown>): CliTool {
	return {
		name: "demo-tool",
		title: "Demo",
		description: "Synthetic tool",
		category: "other",
		available: true,
		unavailableReason: null,
		inputSchema
	};
}

describe("deriveToolFlagModel", () => {
	it("derives a named flag per schema property, with its coercion kind", () => {
		const model = deriveToolFlagModel(tool("memory-read"));
		const byName = new Map(model.flags.map((flag) => [flag.param, flag]));

		expect(byName.get("query")?.kind).toBe("string");
		expect(byName.get("limit")?.kind).toBe("number");
		expect(byName.get("ids")?.kind).toBe("array");
		expect(byName.get("ids")?.itemKind).toBe("string");
		expect(byName.get("scope")?.kind).toBe("object");
		expect(byName.get("include_archived")?.negation).toBe("--no-include_archived");
	});

	it("accepts a kebab-case alias for a snake_case parameter", () => {
		const model = deriveToolFlagModel(tool("memory-read"));
		expect(model.lookup.has("include-archived")).toBe(true);
		expect(model.lookup.get("include-archived")?.flag?.param).toBe("include_archived");
	});

	it("lets a tool property own a reserved global spelling (handoff-write --json)", () => {
		const model = deriveToolFlagModel(tool("handoff-write"));

		// The tool's own `json` field — whose absence caused the TASK-010 500 —
		// keeps the spelling; the output-format global moves to its alias.
		expect(model.lookup.get("json")?.kind).toBe("param");
		expect(model.lookup.get("json")?.flag?.param).toBe("json");
		expect(model.lookup.get("json-out")?.kind).toBe("global");
		expect(model.lookup.get("json-out")?.global?.name).toBe("json");
		expect(model.collisions).toEqual([{ param: "json", global: "--json", relocated: "--json-out" }]);
	});

	it("enumerates every reserved-name collision in the registry", () => {
		// A guard, not a snapshot for its own sake: a new collision changes the
		// CLI surface of a tool, so it must be reviewed and added here.
		const collisions = tools.flatMap((candidate) =>
			deriveToolFlagModel(candidate).collisions.map((entry) => `${candidate.name}:${entry.global}->${entry.relocated}`)
		);
		const expected = [
			...[
				"memory-delete",
				"memory-read",
				"memory-write",
				"task-delete",
				"task-read",
				"task-write",
				"standard-delete",
				"standard-read",
				"standard-write",
				"handoff-read",
				"handoff-write",
				"claim-manage",
				"observation-read",
				"observation-write",
				"codebase-read",
				"agent-context",
				"prompt-read",
				"repo-summarize",
				"synthesize"
			].map((name) => `${name}:--json->--json-out`),
			"standard-read:--version->--ver",
			"standard-write:--version->--ver",
			"prompt-read:--args->--args-json"
		].sort();

		expect(collisions.sort()).toEqual(expected);
	});

	it("never lets a built-in global shadow a tool property", () => {
		for (const candidate of tools) {
			const model = deriveToolFlagModel(candidate);
			for (const name of RESERVED_GLOBAL_NAMES) {
				const claimed = model.flags.some((flag) => flag.param === name);
				if (!claimed) continue;
				// A claimed spelling must resolve to the param, never the global.
				expect(model.lookup.get(name)?.kind).toBe("param");
			}
		}
	});
});

describe("parseToolInvocation — named flags", () => {
	it("coerces string, number, array and object values per the schema", () => {
		const { args } = parse("memory-read", [
			"--query",
			"auth flow",
			"--limit",
			"5",
			"--ids",
			"a",
			"--ids",
			"b,c",
			"--scope",
			'{"owner":"acme"}'
		]);

		expect(args).toEqual({
			query: "auth flow",
			limit: 5,
			ids: ["a", "b", "c"],
			scope: { owner: "acme" }
		});
	});

	it("supports --flag=value and a comma-split array", () => {
		const { args } = parse("memory-read", ["--query=auth", "--ids=a,b"]);
		expect(args).toEqual({ query: "auth", ids: ["a", "b"] });
	});

	it("treats a boolean as a switch and --no-<param> as its negation", () => {
		expect(parse("memory-read", ["--include_archived"]).args.include_archived).toBe(true);
		expect(parse("memory-read", ["--no-include_archived"]).args.include_archived).toBe(false);
		expect(parse("memory-read", ["--include_archived=false"]).args.include_archived).toBe(false);
	});

	it("rejects a non-numeric value for a numeric flag", () => {
		expect(() => parse("memory-read", ["--limit", "abc"])).toThrow(UsageError);
		// `limit` is a number, so a fraction is legitimate; an integer flag is not.
		expect(parse("memory-read", ["--limit", "1.5"]).args.limit).toBe(1.5);
		const demo = synthetic({ type: "object", properties: { n: { type: "integer" } } });
		expect(() =>
			parseToolInvocation(demo, deriveToolFlagModel(demo), ["--n", "1.5"], { readStdin: () => "{}" })
		).toThrow(/--n expects an integer/);
	});

	it("validates required parameters, naming the missing flag", () => {
		expect(() => parse("repo-summarize", ["--owner", "vheins"])).toThrow(
			/missing required parameter\(s\) for repo-summarize: --signals/
		);
		// `owner`/`repo` arrive from session context, so a schema that marks them
		// required never makes the CLI demand them.
		expect(() => parse("codebase-index", ["--repoPath", "."])).not.toThrow();
		expect(parse("codebase-index", ["--repo", "acme/app"]).args.repo).toBe("acme/app");
	});

	it("never demands a parameter the dispatcher fills from session context", () => {
		expect(AUTO_FILLABLE_PARAMS.has("owner")).toBe(true);
		// repo-summarize declares owner+repo required; both are auto-filled.
		expect(() => parse("repo-summarize", ["--signals", "x"])).not.toThrow(/missing required/);
	});

	it("rejects an unknown flag with a closest-match suggestion", () => {
		expect(() => parse("memory-read", ["--qurey", "x"])).toThrow(/unknown flag '--qurey' — did you mean '--query'\?/);
	});

	it("rejects a stray positional argument", () => {
		expect(() => parse("memory-read", ["auth"])).toThrow(/unexpected argument 'auth'/);
	});

	it("validates enum membership from the schema", () => {
		const demo = synthetic({
			type: "object",
			properties: { status: { type: "string", enum: ["active", "done"] } },
			required: ["status"]
		});
		const model = deriveToolFlagModel(demo);
		expect(() => parseToolInvocation(demo, model, ["--status", "bogus"], { readStdin: () => "{}" })).toThrow(
			/--status must be one of: active, done \(got 'bogus'\)/
		);
		expect(parseToolInvocation(demo, model, ["--status", "done"], { readStdin: () => "{}" }).args.status).toBe("done");
	});
});

describe("parseToolInvocation — payload sources", () => {
	it("reads a whole payload from --args", () => {
		const { args } = parse("memory-read", ["--args", '{"query":"a","limit":2}']);
		expect(args).toEqual({ query: "a", limit: 2 });
	});

	it("reads a whole payload from stdin via --input -", () => {
		const { args } = parse("memory-read", ["--input", "-"], '{"query":"stdin"}');
		expect(args).toEqual({ query: "stdin" });
	});

	it("refuses two whole-payload sources", () => {
		expect(() => parse("memory-read", ["--args", "{}", "--input", "-"])).toThrow(/exactly one of --args \/ --input/);
	});

	it("lets a named flag override the payload key by key and reports it", () => {
		const result = parse("memory-read", ["--args", '{"query":"a","limit":2}', "--query", "b"]);

		expect(result.args).toEqual({ query: "b", limit: 2 });
		expect(result.notes).toEqual(["note: --query overrides the value from --args"]);
	});

	it("keeps --arg as the escape hatch for a key outside the schema", () => {
		const { args } = parse("memory-read", ["--arg", "not_in_schema=1", "--arg", "flag=true"]);
		expect(args).toEqual({ not_in_schema: 1, flag: true });
	});

	it("keeps the tool's json field addressable when the global moved aside", () => {
		const toolJson = parse("handoff-write", ["--json=true", "--summary", "s"]);
		expect(toolJson.args).toEqual({ json: true, summary: "s" });
		expect(toolJson.flags.json).toBe(false);

		const globalJson = parse("handoff-write", ["--json-out", "--summary", "s"]);
		expect(globalJson.args).toEqual({ summary: "s" });
		expect(globalJson.flags.json).toBe(true);
	});
});

describe("parseToolInvocation — global flags", () => {
	it("captures --json-out, --silent, --timeout and --help", () => {
		const result = parse("handoff-write", ["--json-out", "--silent", "--timeout", "1500", "--help"]);
		expect(result.flags).toMatchObject({ json: true, quiet: true, timeoutMs: 1500 });
		expect(result.help).toBe(true);
	});

	it("rejects a non-numeric timeout", () => {
		expect(() => parse("memory-read", ["--timeout", "soon"])).toThrow(/positive number of milliseconds/);
	});
});

describe("global flags — short spellings and explicit falses (FIX-028)", () => {
	it("registers -h and -V as real globals after a tool name", () => {
		const help = parse("memory-read", ["-h"]);
		expect(help.help).toBe(true);
		expect(help.args).toEqual({});

		const version = parse("memory-read", ["-V"]);
		expect(version.flags.version).toBe(true);

		// Mixed with a real parameter: the short global still resolves.
		const mixed = parse("memory-read", ["--query", "auth", "-h"]);
		expect(mixed.help).toBe(true);
		expect(mixed.args).toEqual({ query: "auth" });
	});

	it("keeps -h/-V available on a tool whose own field shadows --json", () => {
		const model = deriveToolFlagModel(tool("handoff-write"));
		expect([...model.lookup.keys()]).toContain("h");
		expect([...model.lookup.keys()]).toContain("V");
		expect(parse("handoff-write", ["-h"]).help).toBe(true);
	});

	it("honours an explicit false on a boolean global", () => {
		expect(parse("memory-read", ["--json-out"]).flags.json).toBe(true);
		expect(parse("memory-read", ["--json-out=false"]).flags.json).toBe(false);
		expect(parse("memory-read", ["--json-out=0"]).flags.json).toBe(false);
		expect(parse("memory-read", ["--json-out=true"]).flags.json).toBe(true);
	});

	it("honours --silent=false so diagnostics stay on", () => {
		expect(parse("memory-read", ["--quiet"]).flags.quiet).toBe(true);
		expect(parse("memory-read", ["--silent=false"]).flags.quiet).toBe(false);
		expect(parse("memory-read", ["--no-color=0"]).flags.noColor).toBe(false);
	});

	it("accepts the boolean vocabulary and rejects anything else, naming the typed spelling", () => {
		expect(parse("memory-read", ["--json-out=yes"]).flags.json).toBe(true);
		expect(parse("memory-read", ["--json-out=no"]).flags.json).toBe(false);
		expect(() => parse("memory-read", ["--json-out=maybe"])).toThrow(/--json-out expects true or false, got 'maybe'/);
	});

	it("consumes short and inline-valued globals before a built-in command word", () => {
		const flags = emptyGlobalFlags();
		const consumed = scanLeadingGlobals(["-h", "about"], flags, { readStdin: () => "" });
		expect(consumed).toBe(1);
		expect(flags.help).toBe(true);

		const valued = emptyGlobalFlags();
		scanLeadingGlobals(["--json=false", "-V"], valued, { readStdin: () => "" });
		expect(valued.json).toBe(false);
		expect(valued.version).toBe(true);
	});
});

/** Compile-time guard: the exported model type is what `help.ts` consumes. */
const modelShape: ToolFlagModel["globals"] = deriveToolFlagModel(tool("memory-read")).globals;
void modelShape;

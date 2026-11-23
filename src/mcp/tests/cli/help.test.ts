/**
 * Rendering tests for the root CLI's help and reports (TASK-011).
 *
 * Help text is part of the CLI contract: it must be generated from the registry
 * (so it cannot drift from the flags the parser accepts) and it must name the
 * real parameters of the tool it documents.
 */

import { describe, expect, it } from "vitest";
import {
	builtinHelp,
	builtinTokens,
	renderAbout,
	renderToolDescribe,
	renderToolsList,
	rootHelp,
	toolHelp
} from "../../cli/help";
import { loadToolInventory } from "../../cli/tool-registry";

const tools = loadToolInventory();

describe("rootHelp", () => {
	const text = rootHelp(tools);

	it("documents the built-in commands and the exit-code contract", () => {
		for (const command of ["help", "about", "tools", "daemon", "dashboard", "--index", "doctor"]) {
			expect(text).toContain(command);
		}
		expect(text).toContain("EXIT CODES");
		expect(text).toContain("0 success   1 runtime error   2 usage error");
	});

	it("lists every canonical tool name under its category heading", () => {
		for (const tool of tools) expect(text).toContain(tool.name);
		for (const category of ["memory", "task", "standard", "handoff", "claim", "observation", "codebase", "other"]) {
			expect(text).toContain(`[${category}]`);
		}
	});

	it("teaches the named-flag form, not just the payload form", () => {
		expect(text).toContain("--<param>=<value>");
		expect(text).toContain("--no-<param>");
		expect(text).toContain("--args '<json>'");
	});

	it("marks the sampling-gated tool unavailable instead of hiding it", () => {
		expect(text).toContain("synthesize");
		expect(text).toContain("unavailable: requires an MCP client that advertises sampling");
	});
});

describe("toolHelp", () => {
	it("renders the generated flag table from the tool's schema", () => {
		const text = toolHelp(tools.find((tool) => tool.name === "memory-read")!);

		expect(text).toContain("memory-read");
		expect(text).toContain("--query");
		expect(text).toContain("--limit");
		expect(text).toContain("--ids");
		expect(text).toContain("--no-include_archived");
		expect(text).toContain("JSON SCHEMA");
		// The description comes from the registry, not a per-tool literal.
		expect(text).toContain('"code"');
	});

	it("explains a reserved-name collision and the relocated global", () => {
		const text = toolHelp(tools.find((tool) => tool.name === "handoff-write")!);

		expect(text).toContain("NAME COLLISIONS");
		expect(text).toContain("--json-out");
		expect(text).toContain("handoff-write.json");
	});

	it("marks required parameters", () => {
		const text = toolHelp(tools.find((tool) => tool.name === "codebase-index")!);
		expect(text).toMatch(/\*--repo\b/);
		// The session context normally supplies owner/repo, so the row says so.
		expect(text).toContain("(auto-filled from the session when omitted)");
		expect(text).toContain("(* = required by the schema; an auto-filled param never has to be typed)");
	});
});

describe("tools list / describe / about", () => {
	it("lists all 20 canonical tools as JSON", () => {
		const parsed = JSON.parse(renderToolsList(tools, true)) as { count: number; tools: Array<{ name: string }> };

		expect(parsed.count).toBe(20);
		expect(parsed.tools.map((tool) => tool.name)).toContain("memory-read");
		expect(parsed.tools.map((tool) => tool.name)).toContain("codebase-read");
	});

	it("describes a tool with its real input schema", () => {
		const parsed = JSON.parse(
			renderToolDescribe(
				tools.find((tool) => tool.name === "memory-read")!,
				true
			)
		) as { name: string; available: boolean; inputSchema: { properties: Record<string, { type?: string }> } };

		expect(parsed.name).toBe("memory-read");
		expect(parsed.available).toBe(true);
		expect(parsed.inputSchema.properties.code?.type).toBe("string");
		expect(parsed.inputSchema.properties.limit?.type).toBe("number");
	});

	it("reports about details in both shapes", () => {
		const details = {
			name: "@vheins/local-memory-mcp",
			version: "0.0.0-test",
			build: "0.0.0-test+abc1234 [stamp]",
			license: "MIT",
			repository: "https://github.com/vheins/local-memory-mcp",
			homepage: null,
			node: "v22.0.0",
			platform: "linux",
			arch: "x64",
			dbPath: "/tmp/memory.db",
			daemonRunning: true,
			daemonPid: 4242,
			daemonUrl: "http://127.0.0.1:3456/mcp",
			transport: "http (daemon owns the database)"
		};

		const json = JSON.parse(renderAbout(details, true)) as Record<string, unknown>;
		expect(json.dbPath).toBe("/tmp/memory.db");
		expect(json.daemonRunning).toBe(true);

		const human = renderAbout(details, false);
		expect(human).toContain("/tmp/memory.db");
		expect(human).toContain("running (pid 4242)");
		expect(human).toContain("0.0.0-test+abc1234 [stamp]");
	});
});

describe("built-ins", () => {
	it("documents each built-in command", () => {
		for (const token of builtinTokens()) {
			expect(builtinHelp(token)).toBeTruthy();
		}
	});

	it("returns null for a token that is not built-in", () => {
		expect(builtinHelp("memory-read")).toBeNull();
	});
});

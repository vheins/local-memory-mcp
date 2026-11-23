/**
 * CLI help and report rendering (TASK-011).
 *
 * Pure renderers: every function takes already-resolved data and returns the
 * exact string the CLI writes to stdout. No IO, no process state, no colour
 * codes — colour is deliberately absent, so `--no-color`/`NO_COLOR` is satisfied
 * by construction and piped output stays clean for machines.
 *
 * The tool text comes from the registry (see `tool-registry.ts`), so help can
 * never drift from what the dispatcher actually accepts.
 */
import type { CliTool } from "./tool-registry";
import { TOOL_CATEGORY_ORDER } from "./tool-registry";
import { AUTO_FILLABLE_PARAMS, deriveToolFlagModel } from "./flags";

/** Human-readable one-line package blurb, kept in sync with package.json. */
const PACKAGE_SUMMARY = "Long-term local memory, tasks, standards and codebase index for AI agents.";

/** The bin name users type; both published names are documented in USAGE. */
export const CLI_NAME = "local-memory-mcp";

/** Root help: built-in commands, then every tool grouped by category. */
export function rootHelp(tools: readonly CliTool[]): string {
	const lines: string[] = [];
	lines.push(`${CLI_NAME} — ${PACKAGE_SUMMARY}`, "");
	lines.push("USAGE");
	lines.push(`  ${CLI_NAME}                          start the stdio MCP server (default)`);
	lines.push(`  ${CLI_NAME} <command> [options]`);
	lines.push(`  mcp-memory-server <command> [options]   same binary, published alias`);
	lines.push("");
	lines.push("BUILT-IN COMMANDS");
	for (const command of BUILTINS) {
		lines.push(`  ${pad(command.signature, 26)}${command.summary}`);
	}
	lines.push("");
	lines.push("TOOL COMMANDS");
	lines.push("  Every MCP tool is also a top-level command. Arguments are the tool's own");
	lines.push("  schema; 'help <tool>' prints it.");
	for (const category of TOOL_CATEGORY_ORDER) {
		const group = tools.filter((tool) => tool.category === category);
		if (!group.length) continue;
		lines.push("");
		lines.push(`  [${category}]`);
		for (const tool of group) {
			const flag = tool.available ? "" : "  (unavailable: " + tool.unavailableReason + ")";
			lines.push(`    ${pad(tool.name, 22)}${collapse(tool.description)}${flag}`);
		}
	}
	lines.push("");
	lines.push("TOOL ARGUMENTS");
	lines.push("  Every parameter is a named flag taken from the tool's own input schema:");
	lines.push("    memory-read --code=abc --limit=5      --<param>=<value> or --<param> <value>");
	lines.push("    --<param> --no-<param>                boolean switch and its negation");
	lines.push("    --id a --id b, --tags a,b             arrays accumulate or comma-split");
	lines.push("");
	lines.push("  Whole-payload alternatives (exactly one, named flags still override key by key):");
	lines.push("    --args '<json>'      one JSON object of tool arguments");
	lines.push("    --input <path|->     JSON arguments from a file, or '-' for stdin");
	lines.push("    --arg key=value      escape hatch for a key outside the schema");
	lines.push("");
	lines.push("  'help <tool>' prints the generated flag table for that tool.");
	lines.push("  Generic form (scripting): tools list | tools describe <name> | tools call <name>");
	lines.push("");
	lines.push("GLOBAL OPTIONS");
	lines.push(`  ${pad("-h, --help", 26)}Print help for the command; 'help <command>' is the same`);
	lines.push(`  ${pad("-V, --version", 26)}Print '<name> <semver>' (build identity: 'about')`);
	lines.push(`  ${pad("--json", 26)}Machine-readable output on stdout (sets the tool's own json field)`);
	lines.push(`  ${pad("--quiet", 26)}Suppress diagnostics on stderr`);
	lines.push(`  ${pad("--verbose", 26)}Extra diagnostics on stderr (transport, timings)`);
	lines.push(`  ${pad("--no-color", 26)}No colour (also honoured via the NO_COLOR env var)`);
	lines.push(`  ${pad("--timeout <ms>", 26)}Per-call timeout for a tool call`);
	lines.push("");
	lines.push("EXIT CODES");
	lines.push("  0 success   1 runtime error   2 usage error");
	lines.push("  Data goes to stdout, diagnostics to stderr, so pipes stay machine-readable.");
	lines.push("");
	lines.push("ENVIRONMENT");
	lines.push("  MEMORY_DB_PATH    SQLite database path (default: platform config dir)");
	lines.push("  PORT              daemon/dashboard port the CLI talks to (default 3456)");
	lines.push("  DASHBOARD_TOKEN   bearer token when the daemon gates access");
	lines.push("  LOG_LEVEL         trace | debug | info | warn | error");
	lines.push("");
	lines.push(`Run '${CLI_NAME} about' to see which build and database this process resolves.`);
	return lines.join("\n");
}

/** Help for one tool command: description, availability, and its real schema. */
export function toolHelp(tool: CliTool): string {
	const model = deriveToolFlagModel(tool);
	const lines: string[] = [];
	lines.push(`${tool.name} — ${collapse(tool.description) || tool.title}`, "");
	lines.push("USAGE");
	lines.push(`  ${CLI_NAME} ${tool.name} [options] [--args '<json>' | --input <path|->]`);
	lines.push(`  ${CLI_NAME} tools call ${tool.name} [options]   same command, generic form`);
	lines.push("");
	if (!tool.available) {
		lines.push(`UNAVAILABLE: ${tool.unavailableReason ?? "not available in this session"}`, "");
	}
	lines.push(`CATEGORY: ${tool.category}`);
	lines.push("");

	if (model.flags.length) {
		lines.push("PARAMETERS (flags are generated from the tool's input schema)");
		for (const flag of model.flags) {
			const required = flag.required ? "*" : " ";
			const autofill = AUTO_FILLABLE_PARAMS.has(flag.param) ? "  (auto-filled from the session when omitted)" : "";
			const kind = flag.kind === "array" ? `${flag.itemKind ?? "any"}[]` : flag.kind;
			const negated = flag.negation ? ` (negate: ${flag.negation})` : "";
			const choices = flag.enumValues.length ? `  [${flag.enumValues.join(" | ")}]` : "";
			lines.push(
				`  ${required}${pad(flag.flag, 26)}${pad(kind, 12)}${collapse(flag.description)}${choices}${negated}${autofill}`
			);
		}
		lines.push("");
		lines.push("  (* = required by the schema; an auto-filled param never has to be typed)");
	} else {
		lines.push("PARAMETERS: none");
	}

	if (model.collisions.length) {
		lines.push("");
		lines.push("NAME COLLISIONS (the tool's own field wins; the global moves to its alias)");
		for (const collision of model.collisions) {
			lines.push(
				`  ${pad(collision.global, 14)}sets ${tool.name}.${collision.param}; use ${collision.relocated} for the global`
			);
		}
	}

	lines.push("");
	lines.push("WHOLE-PAYLOAD SOURCES (exactly one; named flags override key by key)");
	lines.push(`  ${pad("--args '<json>'", 26)}One JSON object of arguments`);
	lines.push(`  ${pad("--input <path|->", 26)}JSON arguments from a file, or '-' for stdin`);
	lines.push(`  ${pad("--arg key=value", 26)}Escape hatch for a key outside the schema (repeatable)`);
	lines.push("");
	lines.push("GLOBAL OPTIONS");
	for (const global of model.globals) {
		const parts = global.alias === global.flag ? [global.flag] : [global.flag, global.alias];
		if (global.short !== null) parts.push(global.short);
		const shadow = global.shadowed ? "  (tool field owns the default spelling)" : "";
		lines.push(`  ${pad(parts.join(", "), 26)}${collapse(global.description)}${shadow}`);
	}
	if (model.flags.some((flag) => flag.param === "json" && flag.kind === "boolean")) {
		lines.push(`  ${pad("", 26)}--json also sets ${tool.name}.json, which is what emits structuredContent`);
	}
	lines.push("");
	lines.push("EXAMPLES");
	for (const example of exampleLines(tool, model)) lines.push(`  ${example}`);
	lines.push("");
	lines.push("JSON SCHEMA");
	lines.push(JSON.stringify(tool.inputSchema, null, 2));
	return lines.join("\n");
}

/** Two or three copy-pasteable invocations derived from the real flags. */
function exampleLines(tool: CliTool, model: ReturnType<typeof deriveToolFlagModel>): string[] {
	const lines: string[] = [];
	const usable = model.flags.filter((flag) => flag.required && !AUTO_FILLABLE_PARAMS.has(flag.param)).slice(0, 2);
	if (usable.length) {
		const sample = usable.map(
			(flag) => `${flag.flag} <${flag.kind === "array" ? (flag.itemKind ?? "value") : flag.kind}>`
		);
		lines.push(`${CLI_NAME} ${tool.name} ${sample.join(" ")}`);
	} else {
		lines.push(`${CLI_NAME} ${tool.name}`);
	}
	lines.push(`cat args.json | ${CLI_NAME} ${tool.name} --input -`);
	return lines;
}

/** `tools list` — canonical names, one per line, plus availability. */
export function renderToolsList(tools: readonly CliTool[], json: boolean): string {
	if (json) {
		return JSON.stringify(
			{
				count: tools.length,
				tools: tools.map((tool) => ({
					name: tool.name,
					title: tool.title,
					description: tool.description,
					category: tool.category,
					available: tool.available,
					...(tool.unavailableReason ? { unavailableReason: tool.unavailableReason } : {})
				}))
			},
			null,
			2
		);
	}
	return tools
		.map((tool) => `${pad(tool.name, 22)}${pad(tool.category, 12)}${tool.available ? "callable" : "unavailable"}`)
		.join("\n");
}

/** `tools describe <name>` — the authoritative input contract for one tool. */
export function renderToolDescribe(tool: CliTool, json: boolean): string {
	if (json) {
		return JSON.stringify(
			{
				name: tool.name,
				title: tool.title,
				description: tool.description,
				category: tool.category,
				available: tool.available,
				unavailableReason: tool.unavailableReason,
				inputSchema: tool.inputSchema
			},
			null,
			2
		);
	}
	return toolHelp(tool);
}

/** Everything `about` reports, resolved by the caller. */
export interface AboutDetails {
	name: string;
	version: string;
	build: string;
	license: string | null;
	repository: string | null;
	homepage: string | null;
	node: string;
	platform: string;
	arch: string;
	dbPath: string;
	daemonRunning: boolean;
	daemonPid: number | null;
	daemonUrl: string;
	transport: string;
}

/** `about` — which build, which database, which transport. */
export function renderAbout(info: AboutDetails, json: boolean): string {
	if (json) return JSON.stringify(info, null, 2);
	return [
		`${info.name} ${info.version}`,
		"",
		`build      ${info.build}`,
		`license    ${info.license ?? "unknown"}`,
		`repo       ${info.repository ?? "unknown"}`,
		`docs       ${info.homepage ?? "unknown"}`,
		`node       ${info.node}`,
		`platform   ${info.platform}/${info.arch}`,
		`database   ${info.dbPath}`,
		`daemon     ${info.daemonRunning ? `running (pid ${info.daemonPid ?? "?"})` : "not running"}`,
		`endpoint   ${info.daemonUrl}`,
		`transport  ${info.transport}`,
		"",
		"A running daemon owns the database: tool calls go over its MCP endpoint and never",
		"open a second store. Without a daemon, tools run in-process against the path above."
	].join("\n");
}

/** One built-in command as documented in root help and `help <command>`. */
interface BuiltinCommand {
	/** The token typed at the root, used for collision checks against tool names. */
	token: string;
	signature: string;
	summary: string;
	body: string[];
}

/**
 * The built-in command set.
 *
 * `token` is the exact first word the root dispatcher matches on, so
 * `root.ts` can assert no built-in ever shadows a registry tool name (and vice
 * versa) instead of relying on a comment.
 */
export const BUILTINS: readonly BuiltinCommand[] = [
	{
		token: "help",
		signature: "help [command]",
		summary: "Show root help, or help for one command or tool",
		body: ["Usage: help [<command|tool>]", "", "'help' alone is the same as '--help'."]
	},
	{
		token: "about",
		signature: "about [--json]",
		summary: "Show build identity, resolved database path and daemon status",
		body: ["Options:", "  --json    machine-readable report"]
	},
	{
		token: "tools",
		signature: "tools list|describe|call",
		summary: "Generic tool surface: list, describe a schema, call by name",
		body: [
			"Usage:",
			"  tools list [--json]",
			"  tools describe <name> [--json]",
			"  tools call <name> [options] [--args '<json>' | --input <path|->]",
			"",
			"Every tool is ALSO a top-level command with the same named flags:",
			"  memory-read --code=abc      ==      tools call memory-read --code=abc"
		]
	},
	{
		token: "daemon",
		signature: "daemon start|stop|status|install|uninstall",
		summary: "Manage the combined dashboard + MCP HTTP daemon",
		body: [
			"Usage:",
			"  daemon start [--working-dir <path>]   start the detached daemon",
			"  daemon stop                            stop it",
			"  daemon status                          report pid and liveness",
			"  daemon install                         run it at login/boot",
			"  daemon uninstall                       remove that service",
			"",
			"The daemon is the single writer over memory.db; the CLI talks to it instead",
			"of opening a second store."
		]
	},
	{
		token: "dashboard",
		signature: "dashboard",
		summary: "Serve the dashboard (foreground) on http://127.0.0.1:PORT",
		body: [
			"Environment:",
			"  PORT             default 3456",
			"  DASHBOARD_HOST     default 127.0.0.1",
			"  DASHBOARD_TOKEN    bearer gate (unset = open)"
		]
	},
	{
		token: "--index",
		signature: "--index --repo <owner/name> --path <dir> [--include g] [--exclude g]",
		summary: "Index a repository into the codebase index and exit",
		body: [
			"Usage:",
			"  --index --repo vheins/app --path . --exclude '**/*.test.ts'",
			"",
			"Exit 0 on success, 1 on failure."
		]
	},
	{
		token: "doctor",
		signature: "doctor",
		summary: "Print a startup diagnosis (build, DB, engines) and exit",
		body: ["Read-only: reports what the process would resolve, then exits 0."]
	},
	{
		token: "--version",
		signature: "-V, --version",
		summary: "Print '<name> <semver>'",
		body: ["Build identity (git SHA, build timestamp, source) is in 'about'."]
	}
];

/** Help for one built-in command, or `null` when the token is not built-in. */
export function builtinHelp(token: string): string | null {
	const match = BUILTINS.find((command) => command.token === token || command.signature.includes(token));
	if (!match) return null;
	return [`${match.signature} — ${match.summary}`, "", ...match.body].join("\n");
}

/** The built-in first-word tokens, for the collision guard in root.ts. */
export function builtinTokens(): string[] {
	return BUILTINS.map((command) => command.token);
}

/** Collapse a multi-line registry description into one readable line. */
function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Pad to a column width. */
function pad(text: string, width: number): string {
	return text.length >= width ? text + " " : text + " ".repeat(width - text.length);
}

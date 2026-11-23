/**
 * Root CLI dispatcher (TASK-011).
 *
 * `runRootCli` is the single entry point the stdio server's process checks
 * BEFORE it opens anything. It answers one question: "is this invocation a CLI
 * command I own?" — and when it does not, it returns `{ handled: false }` so the
 * existing argv branches (daemon, doctor, --index, no-arg stdio server) run
 * exactly as they did before this module existed.
 *
 * Contract (clig.dev):
 *   - stdout carries data, stderr carries diagnostics.
 *   - exit 0 success, 1 runtime error, 2 usage error.
 *   - a built-in token always wins over a tool name; otherwise the first
 *     positional is resolved against the SAME registry the transports use.
 *   - a live daemon owns the database, so a tool call goes over its MCP endpoint
 *     and a failure there is exit 1 — never a fallback to a second store
 *     (see `tool-transport.ts`).
 *
 * Tool parameters are named flags derived from the tool's own `inputSchema`
 * (see `flags.ts`); the direct command and `tools call` share one handler.
 */
import fs from "node:fs";
import { formatBuildInfo, resolvePackageMeta } from "../utils/build-info";
import { resolveDbPath } from "../utils/db-path";
import { statusDaemon } from "./daemon";
import { deriveToolFlagModel, emptyGlobalFlags, parseToolInvocation, scanLeadingGlobals, UsageError } from "./flags";
import type { GlobalFlags, ToolFlagModel } from "./flags";
import {
	BUILTINS,
	CLI_NAME,
	builtinHelp,
	builtinTokens,
	renderAbout,
	renderToolDescribe,
	renderToolsList,
	rootHelp,
	toolHelp,
	type AboutDetails
} from "./help";
import { loadToolInventory, resolveToolName, suggestCommand, type CliTool } from "./tool-registry";
import {
	createToolTransport,
	resolveDaemonMcpUrl,
	ToolTransportError,
	type DaemonStatus,
	type ToolTransport
} from "./tool-transport";

/** What the CLI decided about this invocation. */
export type RootCliResult = { handled: false } | { handled: true; exitCode: number };

/** Everything the CLI can write to or read from, replaceable in tests. */
export interface RootCliIo {
	/** Data channel. */
	stdout: (text: string) => void;
	/** Diagnostic channel (errors always reach it). */
	stderr: (text: string) => void;
	env: NodeJS.ProcessEnv;
	/** Read the whole of stdin, for `--input -`. */
	readStdin: () => string;
	/** Storage-free daemon liveness probe. */
	daemonStatus: () => DaemonStatus;
	/** The transport a tool call will use. */
	transport: ToolTransport;
}

/** Partial overrides; anything omitted gets the real process implementation. */
export type RootCliOverrides = Partial<RootCliIo>;

/** Built-in tokens the root CLI hands back to the existing server.ts branches. */
const PASSTHROUGH = new Set(["daemon", "dashboard", "mcp-memory-dashboard", "--index", "doctor", "--daemon-worker"]);

/**
 * Run one CLI invocation.
 *
 * @param argv - The arguments after the script path (`process.argv.slice(2)`).
 * @param overrides - Test seams for the IO channels, the daemon probe and transport.
 * @returns `{ handled: false }` when an existing argv branch owns this invocation,
 *          otherwise `{ handled: true, exitCode }` after writing its output.
 */
export async function runRootCli(argv: readonly string[], overrides: RootCliOverrides = {}): Promise<RootCliResult> {
	if (argv.length === 0) return { handled: false };
	const io = buildIo(overrides);
	const flags = emptyGlobalFlags();
	const index = scanLeadingGlobals(argv, flags, { readStdin: io.readStdin });
	const command = argv[index];
	if (command === undefined) {
		// A leading global with no command word: `--help`/`--version` answer here,
		// anything else falls through to the stdio server (e.g. `--verbose`).
		if (flags.version) {
			io.stdout(versionLine());
			return { handled: true, exitCode: 0 };
		}
		if (flags.help) {
			io.stdout(rootHelp(loadToolInventory()));
			return { handled: true, exitCode: 0 };
		}
		return { handled: false };
	}
	const rest = argv.slice(index + 1);

	try {
		switch (command) {
			case "-h":
			case "--help":
				io.stdout(rootHelp(loadToolInventory()));
				return { handled: true, exitCode: 0 };
			case "-V":
			case "--version":
			case "version":
				io.stdout(versionLine());
				return { handled: true, exitCode: 0 };
			case "help":
				return { handled: true, exitCode: helpCommand(rest, io, flags) };
			case "about":
				return { handled: true, exitCode: aboutCommand(rest, io, flags) };
			case "tools":
				return { handled: true, exitCode: await toolsCommand(rest, io, flags) };
		}

		if (PASSTHROUGH.has(command)) {
			if (rest.includes("-h") || rest.includes("--help")) {
				io.stdout(builtinHelp(command) ?? rootHelp(loadToolInventory()));
				return { handled: true, exitCode: 0 };
			}
			return { handled: false };
		}

		const tool = resolveToolName(command);
		if (tool) {
			return { handled: true, exitCode: await runToolCall(tool, rest, io, flags) };
		}
		return { handled: true, exitCode: unknownCommand(command, io) };
	} catch (error) {
		if (error instanceof UsageError) {
			reportUsage(error.message, io);
			return { handled: true, exitCode: 2 };
		}
		throw error;
	}
}

/** `help [command]` — root help, built-in help, or one tool's generated help. */
function helpCommand(rest: readonly string[], io: RootCliIo, flags: GlobalFlags): number {
	const index = scanLeadingGlobals(rest, flags, { readStdin: io.readStdin });
	const target = rest[index];
	if (target === undefined || target === "-h" || target === "--help") {
		io.stdout(rootHelp(loadToolInventory()));
		return 0;
	}
	const builtin = BUILTINS.find((command) => command.token === target);
	if (builtin) {
		io.stdout(builtinHelp(builtin.token) ?? rootHelp(loadToolInventory()));
		return 0;
	}
	const tool = resolveToolName(target);
	if (tool) {
		io.stdout(toolHelp(requireTool(tool)));
		return 0;
	}
	return unknownCommand(target, io);
}

/** `about [--json]` — build identity, resolved paths, daemon status. */
function aboutCommand(rest: readonly string[], io: RootCliIo, flags: GlobalFlags): number {
	scanLeadingGlobals(rest, flags, { readStdin: io.readStdin });
	const status = io.daemonStatus();
	const meta = resolvePackageMeta();
	const details: AboutDetails = {
		name: meta.name,
		version: meta.version,
		build: formatBuildInfo(),
		license: meta.license,
		repository: meta.repository,
		homepage: meta.homepage,
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		dbPath: resolveDbPath(io.env, process.platform),
		daemonRunning: status.running,
		daemonPid: status.pid,
		daemonUrl: resolveDaemonMcpUrl(io.env),
		transport: status.running ? "http (daemon owns the database)" : "in-process (no daemon)"
	};
	io.stdout(renderAbout(details, flags.json));
	return 0;
}

/** `tools list | describe <name> | call <name> …` — the generic scripting form. */
async function toolsCommand(rest: readonly string[], io: RootCliIo, flags: GlobalFlags): Promise<number> {
	const index = scanLeadingGlobals(rest, flags, { readStdin: io.readStdin });
	const sub = rest[index];
	if (sub === undefined) {
		io.stdout(builtinHelp("tools") ?? rootHelp(loadToolInventory()));
		return 0;
	}
	const tail = rest.slice(index + 1);
	if (sub === "list") {
		scanLeadingGlobals(tail, flags, { readStdin: io.readStdin });
		io.stdout(renderToolsList(loadToolInventory(), flags.json));
		return 0;
	}
	if (sub === "describe") {
		const targetIndex = scanLeadingGlobals(tail, flags, { readStdin: io.readStdin });
		const target = tail[targetIndex];
		if (target === undefined) throw new UsageError("tools describe requires a tool name");
		const name = resolveToolName(target);
		if (!name) return unknownCommand(target, io);
		// Globals may also trail the tool name (`tools describe memory-read --json`).
		scanLeadingGlobals(tail.slice(targetIndex + 1), flags, { readStdin: io.readStdin });
		io.stdout(renderToolDescribe(requireTool(name), flags.json));
		return 0;
	}
	if (sub === "call") {
		const targetIndex = scanLeadingGlobals(tail, flags, { readStdin: io.readStdin });
		const target = tail[targetIndex];
		if (target === undefined) throw new UsageError("tools call requires a tool name");
		const name = resolveToolName(target);
		if (!name) return unknownCommand(target, io);
		return runToolCall(name, tail.slice(targetIndex + 1), io, flags);
	}
	const suggestion = suggestCommand(sub, ["list", "describe", "call"]);
	throw new UsageError(
		`unknown subcommand 'tools ${sub}'` + (suggestion ? ` — did you mean 'tools ${suggestion}'?` : "")
	);
}

/**
 * Parse one tool command's tokens and issue the call.
 *
 * The direct form (`memory-read --code=abc`) and the generic form
 * (`tools call memory-read --code=abc`) land here identically, so the two can
 * never drift apart.
 */
async function runToolCall(
	name: string,
	rest: readonly string[],
	io: RootCliIo,
	baseFlags: GlobalFlags
): Promise<number> {
	const tool = requireTool(name);
	const model = deriveToolFlagModel(tool);
	const parsed = parseToolInvocation(tool, model, rest, { readStdin: io.readStdin });
	// Symmetry with `withStructuredOutput`: where a tool declares its own boolean
	// `json` field, that field and the global output switch mean the same thing, so
	// either spelling selects machine-readable stdout.
	const merged = mergeFlags(baseFlags, parsed.flags);
	const declaresJson = model.flags.some((flag) => flag.param === "json" && flag.kind === "boolean");
	const flags: GlobalFlags = { ...merged, json: merged.json || (declaresJson && parsed.args.json === true) };

	if (parsed.help) {
		io.stdout(toolHelp(tool));
		return 0;
	}
	if (flags.version) {
		// `-V` / `--version` are globals: they answer before any call is made.
		io.stdout(versionLine());
		return 0;
	}
	if (!parsed.flags.quiet) for (const note of parsed.notes) io.stderr(note);
	if (!tool.available) {
		io.stderr(`${name} is not callable from the CLI: ${tool.unavailableReason ?? "unavailable"}`);
		return 1;
	}
	note(`# ${name} → ${io.transport.select()} (timeout ${flags.timeoutMs ?? "none"})`, flags, io);

	let outcome;
	try {
		outcome = await io.transport.call(name, withStructuredOutput(parsed.args, flags, model), flags.timeoutMs);
	} catch (error) {
		if (error instanceof ToolTransportError) {
			io.stderr(`error: ${error.message}`);
			io.stderr(error.hint);
			return 1;
		}
		io.stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}

	if (outcome.isError) {
		const payload = outcome.structuredContent ?? (outcome.text ? { error: outcome.text } : { error: name + " failed" });
		if (flags.json) io.stdout(JSON.stringify(payload, null, flags.quiet ? 0 : 2));
		io.stderr(`error: ${outcome.text || JSON.stringify(payload)}`);
		return 1;
	}

	if (flags.json) {
		const payload = outcome.structuredContent ?? (outcome.text ? { text: outcome.text } : {});
		io.stdout(JSON.stringify(payload, null, flags.quiet ? 0 : 2));
	} else if (outcome.text) {
		io.stdout(outcome.text);
	} else if (outcome.structuredContent !== undefined) {
		io.stdout(JSON.stringify(outcome.structuredContent, null, flags.quiet ? 0 : 2));
	}
	note(`# ${name} ok via ${outcome.transport}`, flags, io);
	return 0;
}

/**
 * Bridge the global output switch onto the tool's own `json` field.
 *
 * Most tools materialize `structuredContent` only when their `json` parameter is
 * true, so `--json` on such a tool would otherwise print prose and a script
 * would get nothing to parse. An explicit `--json=<value>` — the tool field,
 * which owns that spelling (see the collision table) — is never overridden.
 */
function withStructuredOutput(
	args: Record<string, unknown>,
	flags: GlobalFlags,
	model: ToolFlagModel
): Record<string, unknown> {
	if (!flags.json || "json" in args) return args;
	const jsonParam = model.flags.find((flag) => flag.param === "json");
	return jsonParam?.kind === "boolean" ? { ...args, json: true } : args;
}

/** Combine flags supplied before the command word with those after it. */
function mergeFlags(before: GlobalFlags, after: GlobalFlags): GlobalFlags {
	return {
		json: before.json || after.json,
		quiet: before.quiet || after.quiet,
		verbose: before.verbose || after.verbose,
		noColor: before.noColor || after.noColor,
		version: before.version || after.version,
		help: before.help || after.help,
		timeoutMs: after.timeoutMs ?? before.timeoutMs
	};
}

/** The unknown-command path: closest match, then exit 2. */
function unknownCommand(token: string, io: RootCliIo): number {
	const candidates = [...builtinTokens(), ...loadToolInventory().map((tool) => tool.name)];
	const suggestion = suggestCommand(token, candidates);
	io.stderr(`error: unknown command '${token}'`);
	if (suggestion) io.stderr(`did you mean '${suggestion}'?`);
	io.stderr(`run '${CLI_NAME} --help' for the command list`);
	return 2;
}

/** Look one canonical name up in the inventory. */
function requireTool(name: string): CliTool {
	const tool = loadToolInventory().find((candidate) => candidate.name === name);
	if (!tool) throw new UsageError(`unknown tool '${name}'`);
	return tool;
}

/** One line of version output: `<name> <semver>` (build identity lives in `about`). */
function versionLine(): string {
	const meta = resolvePackageMeta();
	return `${meta.name} ${meta.version}`;
}

/** Emit a diagnostic unless `--quiet` silenced it. */
function note(line: string, flags: GlobalFlags, io: RootCliIo): void {
	if (flags.verbose && !flags.quiet) io.stderr(line);
}

/** Emit a usage error with the standard two-line shape. */
function reportUsage(message: string, io: RootCliIo): void {
	io.stderr(`error: ${message}`);
	io.stderr(`run '${CLI_NAME} --help' for usage`);
}

/** Wire the real process implementation, then apply the test overrides. */
function buildIo(overrides: RootCliOverrides): RootCliIo {
	const env = overrides.env ?? process.env;
	const daemonStatus = overrides.daemonStatus ?? (() => statusDaemon({ io: { log: () => undefined } }));
	return {
		stdout: overrides.stdout ?? ((text) => process.stdout.write(`${text}\n`)),
		stderr: overrides.stderr ?? ((text) => process.stderr.write(`${text}\n`)),
		env,
		readStdin: overrides.readStdin ?? (() => fs.readFileSync(0, "utf8")),
		daemonStatus,
		transport: overrides.transport ?? createToolTransport({ env, daemonStatus })
	};
}

/**
 * Named-flag layer for the root CLI (TASK-011, user steering 2).
 *
 * A tool's parameters are first-class flags: `memory-read --code=abc --limit=5`
 * means the same call as `memory-read --args '{"code":"abc","limit":5}'`. The
 * flag table is DERIVED from the registry's `inputSchema` on every command, so
 * help text, accepted spellings, coercion and required-field validation all come
 * from the one contract the MCP transports already enforce — never from a
 * per-tool list maintained by hand.
 *
 * Three layers of input, in precedence order:
 *
 *   1. whole-payload source — exactly ONE of `--args '<json>'` / `--input <path|->`;
 *   2. per-key overrides — named flags (`--code=x`) and the `--arg k=v` escape
 *      hatch for keys the schema does not declare;
 *   3. schema validation — required parameters (excluding the ones the dispatcher
 *      fills from session context) and enum membership.
 *
 * A named flag that shadows a reserved global (`handoff-write --json`, whose
 * absence caused the TASK-010 500) wins: the TOOL PROPERTY takes the spelling and
 * the global relocates to its alias (`--json-out`). The tool's own contract is
 * authoritative over CLI cosmetics, always.
 */
import type { CliTool } from "./tool-registry";
import {
	toEffective,
	unknownFlagMessage,
	takeFlagValue,
	isFlagLike,
	bare,
	aliasFor,
	parseJsonObject,
	readInputFile,
	kindOf,
	coerceBoolean,
	coerceScalar,
	coerceAuto,
	splitArrayValue,
	validateArgs,
	RESERVED_GLOBALS,
	RESERVED_GLOBAL_NAMES,
	UsageError
} from "./flag-values";
export * from "./flag-values";

/** Coercion class of one flag, derived from the schema property. */
export type FlagKind = "string" | "number" | "integer" | "boolean" | "object" | "array" | "auto";

/** Global flags accepted by any command (clig.dev: uniform across the surface). */
export interface GlobalFlags {
	json: boolean;
	quiet: boolean;
	verbose: boolean;
	noColor: boolean;
	version: boolean;
	/** `--help` — the command asked for help instead of doing work. */
	help: boolean;
	timeoutMs: number | null;
}

/** Fresh global-flag state. */
export function emptyGlobalFlags(): GlobalFlags {
	return { json: false, quiet: false, verbose: false, noColor: false, version: false, help: false, timeoutMs: null };
}

/** One reserved global flag and where it relocates when a tool shadows it. */
export interface ReservedGlobal {
	/** Spelling without dashes, as typed after `--`. */
	name: string;
	/** Spelling used when a tool property claims `name`. */
	alias: string;
	/** Whether the flag consumes the next token (or an `=value`). */
	takesValue: boolean;
	/** Help text for the flag table. */
	description: string;
}

/** One tool parameter as a CLI flag. */
export interface ToolFlag {
	/** Schema property name — the authoritative argument key. */
	param: string;
	/** Primary spelling, `--code`. */
	flag: string;
	/** Extra accepted spellings (kebab form of a snake_case name). */
	aliases: string[];
	/** `--no-<param>` for a boolean switch, else `null`. */
	negation: string | null;
	kind: FlagKind;
	/** Element kind for an array flag, else `null`. */
	itemKind: FlagKind | null;
	required: boolean;
	description: string;
	enumValues: string[];
	/** Set when this parameter claims a reserved global spelling: that global's name. */
	claimsGlobal: string | null;
	/** The relocated spelling of that global, e.g. `--json-out`. */
	relocatedGlobalFlag: string | null;
}

/** One global as accepted by a specific tool command. */
export interface EffectiveGlobal {
	name: string;
	/** The spelling that actually works here (the alias when shadowed). */
	flag: string;
	/** The secondary spelling, equal to `flag` when the canonical one is owned by a param. */
	alias: string;
	takesValue: boolean;
	description: string;
	/** Whether a tool parameter claimed the default spelling. */
	shadowed: boolean;
}

/** A lookup entry: what one accepted spelling means. */
interface FlagLookupEntry {
	kind: "param" | "global";
	flag?: ToolFlag;
	global?: EffectiveGlobal;
	/** True when the spelling is a boolean's `--no-` negation. */
	negated?: boolean;
}

/** The derived flag model for one tool command. */
export interface ToolFlagModel {
	flags: ToolFlag[];
	globals: EffectiveGlobal[];
	/** Every accepted spelling (no leading dashes) → its meaning. */
	lookup: Map<string, FlagLookupEntry>;
	/** Parameters that shadow a reserved global spelling. */
	collisions: Array<{ param: string; global: string; relocated: string }>;
}

/**
 * Derive the flag model for one tool from its registered `inputSchema`.
 *
 * @param tool - The registry entry (its `inputSchema` is the contract).
 * @returns Flags, effective globals, spelling lookup and the collision list.
 */
export function deriveToolFlagModel(tool: CliTool): ToolFlagModel {
	const properties = (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
	const required = new Set(
		Array.isArray(tool.inputSchema.required) ? (tool.inputSchema.required as unknown[]).map(String) : []
	);
	const exactNames = new Set(Object.keys(properties));

	const flags: ToolFlag[] = Object.entries(properties).map(([param, prop]) => {
		const { kind, itemKind } = kindOf(prop);
		const kebab = param.includes("_") ? param.replace(/_/g, "-") : null;
		const alias = kebab && !exactNames.has(kebab) ? kebab : null;
		const claimsGlobal = RESERVED_GLOBAL_NAMES.includes(param) ? param : null;
		return {
			param,
			flag: `--${param}`,
			aliases: alias ? [`--${alias}`] : [],
			negation: kind === "boolean" ? `--no-${param}` : null,
			kind,
			itemKind,
			required: required.has(param),
			description: typeof prop.description === "string" ? prop.description : "",
			enumValues: Array.isArray(prop.enum) ? prop.enum.map(String) : [],
			claimsGlobal,
			relocatedGlobalFlag: claimsGlobal ? `--${aliasFor(claimsGlobal)}` : null
		};
	});

	const taken = new Set<string>();
	for (const flag of flags) {
		taken.add(bare(flag.flag));
		for (const alias of flag.aliases) taken.add(bare(alias));
		if (flag.negation) taken.add(bare(flag.negation));
	}

	const globals: EffectiveGlobal[] = RESERVED_GLOBALS.map((global) => {
		const shadowed = taken.has(global.name);
		return {
			name: global.name,
			flag: shadowed ? `--${global.alias}` : `--${global.name}`,
			alias: `--${global.alias}`,
			takesValue: global.takesValue,
			description: global.description,
			shadowed
		};
	});

	const collisions = flags.flatMap((flag) =>
		flag.claimsGlobal
			? [{ param: flag.param, global: `--${flag.claimsGlobal}`, relocated: flag.relocatedGlobalFlag ?? "" }]
			: []
	);

	// Parameters are registered first, so a tool property always owns its spelling
	// and a shadowed global can only be reached through its alias.
	const lookup = new Map<string, FlagLookupEntry>();
	for (const flag of flags) {
		lookup.set(bare(flag.flag), { kind: "param", flag });
		for (const alias of flag.aliases) lookup.set(bare(alias), { kind: "param", flag });
		if (flag.negation) lookup.set(bare(flag.negation), { kind: "param", flag, negated: true });
	}
	for (const global of globals) {
		// A global is reachable under BOTH spellings unless a parameter owns one
		// of them: `--json-out` works everywhere, `--json` only where no tool
		// property claims it.
		if (!lookup.has(bare(global.flag))) lookup.set(bare(global.flag), { kind: "global", global });
		const alias = `--${aliasFor(global.name)}`;
		if (!lookup.has(bare(alias))) lookup.set(bare(alias), { kind: "global", global });
	}

	return { flags, globals, lookup, collisions };
}

/** Result of parsing one tool command's tokens. */
export interface ParsedToolInvocation {
	/** The final tool arguments: whole payload with per-key overrides applied. */
	args: Record<string, unknown>;
	/** Diagnostics about overrides; the caller emits them unless `--quiet`. */
	notes: string[];
	flags: GlobalFlags;
	/** The command asked for help (`--help`) instead of a call. */
	help: boolean;
}

/** What the parser needs from the outside world. */
export interface FlagParseContext {
	/** Read the whole of stdin, for `--input -`. */
	readStdin: () => string;
}

/** Mutable parse state for one invocation. */
interface ParseState {
	flags: GlobalFlags;
	notes: string[];
	payload: Record<string, unknown> | null;
	payloadSource: string | null;
	overrides: Record<string, unknown>;
	arrays: Map<string, unknown[]>;
}

/**
 * Parse one tool command's tokens into tool arguments.
 *
 * Named flags and `--arg` pairs override the whole-payload source key by key;
 * array flags accumulate across repetitions. Unknown flags, malformed values and
 * missing required parameters are {@link UsageError}s.
 *
 * @param tool   - Registry entry (drives validation).
 * @param model  - Prederived flag model (help and parse share one derivation).
 * @param tokens - The tokens after the command word.
 * @param ctx    - Injected IO (stdin).
 * @throws {UsageError} On any contract violation.
 */
export function parseToolInvocation(
	tool: CliTool,
	model: ToolFlagModel,
	tokens: readonly string[],
	ctx: FlagParseContext
): ParsedToolInvocation {
	const state: ParseState = {
		flags: emptyGlobalFlags(),
		notes: [],
		payload: null,
		payloadSource: null,
		overrides: {},
		arrays: new Map()
	};

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token.startsWith("-") || token === "-") {
			throw new UsageError(
				`unexpected argument '${token}' — every parameter is a named flag (see 'help ${tool.name}')`
			);
		}
		const eq = token.indexOf("=");
		const spelling = bare(eq === -1 ? token : token.slice(0, eq));
		const inline = eq === -1 ? null : token.slice(eq + 1);
		const entry = model.lookup.get(spelling);
		if (!entry) throw new UsageError(unknownFlagMessage(spelling, model));

		if (entry.kind === "global") {
			index += applyGlobal(entry.global as EffectiveGlobal, inline, tokens, index, state, ctx);
			continue;
		}

		const flag = entry.flag as ToolFlag;
		if (flag.kind === "boolean") {
			state.overrides[flag.param] =
				entry.negated === true ? false : inline === null ? true : coerceBoolean(inline, flag.flag);
			continue;
		}

		const raw = inline ?? takeFlagValue(spelling, tokens, index + 1);
		if (inline === null && flag.kind !== "number" && flag.kind !== "integer" && isFlagLike(raw)) {
			throw new UsageError(`--${spelling} expects a value`);
		}
		if (flag.kind === "array") {
			const bucket = state.arrays.get(flag.param) ?? [];
			bucket.push(...splitArrayValue(raw, flag));
			state.arrays.set(flag.param, bucket);
			state.overrides[flag.param] = bucket;
		} else {
			state.overrides[flag.param] = coerceScalar(raw, flag);
		}
		if (inline === null) index++;
	}

	for (const [key, value] of state.arrays) state.overrides[key] = value;

	const base = state.payload ?? {};
	if (state.payloadSource !== null) {
		for (const key of Object.keys(state.overrides)) {
			if (key in base) state.notes.push(`note: --${key} overrides the value from ${state.payloadSource}`);
		}
	}

	const args = { ...base, ...state.overrides };
	validateArgs(model, args, tool);
	return { args, notes: state.notes, flags: state.flags, help: state.flags.help };
}

/**
 * Consume leading global flags before a built-in command word.
 *
 * Built-ins have no schema, so no relocation applies: the reserved spellings are
 * used verbatim and the first non-global token ends the scan.
 *
 * @returns The index of the first token that is not a leading global flag.
 */
export function scanLeadingGlobals(tokens: readonly string[], flags: GlobalFlags, ctx: FlagParseContext): number {
	const state: ParseState = {
		flags,
		notes: [],
		payload: null,
		payloadSource: null,
		overrides: {},
		arrays: new Map()
	};
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		if (!token.startsWith("--")) break;
		const eq = token.indexOf("=");
		const spelling = bare(eq === -1 ? token : token.slice(0, eq));
		const reserved = RESERVED_GLOBALS.find((candidate) => candidate.name === spelling);
		if (!reserved) break;
		const inline = eq === -1 ? null : token.slice(eq + 1);
		// The flag token itself is consumed here; `applyGlobal` reports only the
		// EXTRA tokens a space-separated value takes. Without the +1 a bare switch
		// would leave `index` unchanged and spin forever.
		index += 1 + applyGlobal(toEffective(reserved), inline, tokens, index, state, ctx);
	}
	return index;
}

/**
 * Apply one global flag token to the parse state.
 *
 * @returns How many EXTRA tokens the flag consumed (0 for switches, 1 for a
 *          space-separated value).
 */
function applyGlobal(
	global: EffectiveGlobal,
	inline: string | null,
	tokens: readonly string[],
	index: number,
	state: ParseState,
	ctx: FlagParseContext
): number {
	switch (global.name) {
		case "json":
			state.flags.json = true;
			return 0;
		case "quiet":
			state.flags.quiet = true;
			return 0;
		case "verbose":
			state.flags.verbose = true;
			return 0;
		case "no-color":
			state.flags.noColor = true;
			return 0;
		case "help":
			state.flags.help = true;
			return 0;
		case "version":
			state.flags.version = true;
			return 0;
		case "timeout": {
			const raw = inline ?? takeFlagValue(global.name, tokens, index + 1);
			const value = Number(raw);
			if (!Number.isInteger(value) || value <= 0) {
				throw new UsageError(`--${global.name} expects a positive number of milliseconds, got '${raw}'`);
			}
			state.flags.timeoutMs = value;
			return inline === null ? 1 : 0;
		}
		case "args": {
			const raw = inline ?? takeFlagValue(global.name, tokens, index + 1);
			setPayload(state, "--args", parseJsonObject(raw, "--args"));
			return inline === null ? 1 : 0;
		}
		case "input": {
			const target = inline ?? takeFlagValue(global.name, tokens, index + 1);
			const raw = target === "-" ? ctx.readStdin() : readInputFile(target);
			setPayload(state, `--input ${target}`, parseJsonObject(raw, `--input ${target}`));
			return inline === null ? 1 : 0;
		}
		case "arg": {
			const pair = inline ?? takeFlagValue(global.name, tokens, index + 1);
			const separator = pair.indexOf("=");
			if (separator <= 0) throw new UsageError(`--arg expects key=value, got '${pair}'`);
			state.overrides[pair.slice(0, separator).trim()] = coerceAuto(pair.slice(separator + 1));
			return inline === null ? 1 : 0;
		}
		default:
			return 0;
	}
}

/** Install the whole-payload base, refusing a second source. */
function setPayload(state: ParseState, source: string, payload: Record<string, unknown>): void {
	if (state.payload !== null) {
		throw new UsageError(
			`arguments may come from exactly one of --args / --input (already read ${state.payloadSource}, then ${source})`
		);
	}
	state.payload = payload;
	state.payloadSource = source;
}

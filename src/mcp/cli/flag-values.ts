/**
 * Value-level helpers for the root CLI flag layer (TASK-011): schema-kind
 * detection, scalar/array/object coercion, whole-payload reading and the
 * schema-derived validation every tool command shares.
 *
 * Split out of `flags.ts` so both modules stay inside the 500-line file limit.
 * `flags.ts` re-exports this module, so consumers keep importing one place.
 */
import fs from "node:fs";
import type { CliTool } from "./tool-registry";
import { suggestCommand } from "./tool-registry";
import type { EffectiveGlobal, FlagKind, ReservedGlobal, ToolFlag, ToolFlagModel } from "./flags";

/** The reserved global spellings, in the order the CLI documents them. */
export const RESERVED_GLOBALS: readonly ReservedGlobal[] = [
	{ name: "json", alias: "json-out", takesValue: false, description: "Machine-readable output on stdout" },
	{ name: "quiet", alias: "silent", takesValue: false, description: "Suppress diagnostics on stderr" },
	{ name: "verbose", alias: "debug", takesValue: false, description: "Extra diagnostics on stderr" },
	{ name: "no-color", alias: "plain", takesValue: false, description: "No colour (also honoured via NO_COLOR)" },
	{ name: "timeout", alias: "timeout-ms", takesValue: true, description: "Per-call timeout in milliseconds" },
	{ name: "help", alias: "usage", takesValue: false, description: "Print help for this command" },
	{ name: "version", alias: "ver", takesValue: false, description: "Print '<name> <semver>'" },
	{ name: "args", alias: "args-json", takesValue: true, description: "Whole argument payload as one JSON object" },
	{
		name: "input",
		alias: "input-file",
		takesValue: true,
		description: "Whole argument payload from a file, or - for stdin"
	},
	{ name: "arg", alias: "kv", takesValue: true, description: "Escape hatch: key=value for a key outside the schema" }
];

/** The reserved spellings alone, for collision enumeration in help and tests. */
export const RESERVED_GLOBAL_NAMES: readonly string[] = RESERVED_GLOBALS.map((global) => global.name);

/** A usage error — bad flag, malformed value, missing required parameter. Exit 2. */
export class UsageError extends Error {}

/**
 * Parameters the dispatcher supplies from session context, so the CLI must not
 * demand them even when the derived schema marks them required — refusing a call
 * the server would accept is a regression, not a validation win.
 * (See `normalizeToolArguments`, src/mcp/utils/normalize-args.ts.)
 */
export const AUTO_FILLABLE_PARAMS: ReadonlySet<string> = new Set(["owner", "repo", "scope", "agent", "model"]);

/** Convert one reserved global into its effective (unshadowed) form. */
export function toEffective(global: ReservedGlobal): EffectiveGlobal {
	return {
		name: global.name,
		flag: `--${global.name}`,
		alias: `--${global.alias}`,
		takesValue: global.takesValue,
		description: global.description,
		shadowed: false
	};
}

/** Build the unknown-flag error, with a closest-match suggestion. */
export function unknownFlagMessage(spelling: string, model: ToolFlagModel): string {
	const suggestion = suggestCommand(spelling, [...model.lookup.keys()]);
	const hint = suggestion ? ` — did you mean '--${suggestion}'?` : "";
	return `unknown flag '--${spelling}'${hint}`;
}

/** Read the value token that follows a space-separated flag. */
export function takeFlagValue(spelling: string, tokens: readonly string[], index: number): string {
	const raw = tokens[index];
	if (raw === undefined) throw new UsageError(`--${spelling} expects a value`);
	return raw;
}

/** Whether a token looks like a flag rather than a value. */
export function isFlagLike(token: string): boolean {
	return token.startsWith("--") || (token.length > 1 && token.startsWith("-") && !/^-\d/.test(token));
}

/** Strip leading dashes from a flag spelling. */
export function bare(spelling: string): string {
	return spelling.replace(/^-+/, "");
}

/** Resolve the relocation alias for a reserved global name. */
export function aliasFor(name: string): string {
	return RESERVED_GLOBALS.find((global) => global.name === name)?.alias ?? `${name}-out`;
}

/** Parse a JSON object string; anything else is a usage error. */
export function parseJsonObject(raw: string, flag: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new UsageError(`${flag} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new UsageError(`${flag} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

/** Read a `--input <path>` file. */
export function readInputFile(target: string): string {
	try {
		return fs.readFileSync(target, "utf8");
	} catch {
		throw new UsageError(`cannot read --input '${target}'`);
	}
}

/** Derive the coercion kind (and element kind) of one schema property. */
export function kindOf(prop: Record<string, unknown>): { kind: FlagKind; itemKind: FlagKind | null } {
	const direct = normalizeType(prop.type);
	if (direct) {
		if (direct === "array") {
			const items = prop.items as Record<string, unknown> | undefined;
			return { kind: "array", itemKind: items ? (normalizeType(items.type) ?? "auto") : null };
		}
		return { kind: direct, itemKind: null };
	}
	const branches = [...asBranches(prop.anyOf), ...asBranches(prop.oneOf)];
	if (!branches.length) {
		if (Array.isArray(prop.enum)) {
			const values = prop.enum as unknown[];
			const allBoolean = values.every((value) => typeof value === "boolean");
			const allNumber = values.every((value) => typeof value === "number");
			return { kind: allBoolean ? "boolean" : allNumber ? "number" : "string", itemKind: null };
		}
		return { kind: "auto", itemKind: null };
	}
	const types = branches.map((branch) => normalizeType(branch.type)).filter((type): type is FlagKind => !!type);
	if (types.includes("array")) {
		const arrayBranch = branches.find((branch) => normalizeType(branch.type) === "array");
		const items = arrayBranch?.items as Record<string, unknown> | undefined;
		return { kind: "array", itemKind: items ? (normalizeType(items.type) ?? "auto") : null };
	}
	const unique = new Set(types.filter((type) => type !== "auto"));
	if (unique.size === 1) return { kind: [...unique][0], itemKind: null };
	return { kind: "auto", itemKind: null };
}

/** Split an anyOf/oneOf list into object branches. */
export function asBranches(value: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object");
}

/** Map a JSON Schema type label onto a coercion kind. */
export function normalizeType(type: unknown): FlagKind | null {
	switch (type) {
		case "string":
			return "string";
		case "number":
			return "number";
		case "integer":
			return "integer";
		case "boolean":
			return "boolean";
		case "object":
			return "object";
		case "array":
			return "array";
		default:
			return null;
	}
}

/** Coerce one explicit boolean value (`--flag=true`). */
export function coerceBoolean(raw: string, flag: string): boolean {
	const lowered = raw.trim().toLowerCase();
	if (["true", "1", "yes"].includes(lowered)) return true;
	if (["false", "0", "no"].includes(lowered)) return false;
	throw new UsageError(`${flag} expects true or false, got '${raw}'`);
}

/** Coerce one scalar value per the flag's kind. */
export function coerceScalar(raw: string, flag: ToolFlag): unknown {
	switch (flag.kind) {
		case "string":
			return raw;
		case "number":
		case "integer":
			return coerceNumber(raw, flag);
		case "object":
			return coerceObject(raw, flag);
		default:
			return coerceAuto(raw);
	}
}

/** Coerce a numeric flag, naming the flag on failure. */
export function coerceNumber(raw: string, flag: ToolFlag): number {
	const trimmed = raw.trim();
	const value = Number(trimmed);
	const label = flag.kind === "integer" ? "an integer" : "a number";
	if (trimmed === "" || !Number.isFinite(value) || (flag.kind === "integer" && !Number.isInteger(value))) {
		throw new UsageError(`${flag.flag} expects ${label}, got '${raw}'`);
	}
	return value;
}

/** Coerce an object flag from its JSON string value. */
export function coerceObject(raw: string, flag: ToolFlag): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new UsageError(`${flag.flag} expects a JSON object, got '${raw}'`);
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new UsageError(`${flag.flag} expects a JSON object, got '${raw}'`);
	}
	return value as Record<string, unknown>;
}

/** JSON-parse when valid, otherwise keep the raw string (union-typed flags). */
export function coerceAuto(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

/** Split one array flag occurrence into elements. */
export function splitArrayValue(raw: string, flag: ToolFlag): unknown[] {
	const itemKind = flag.itemKind;
	if (itemKind === "object") {
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			throw new UsageError(`${flag.flag} expects JSON object elements, got '${raw}'`);
		}
		return Array.isArray(value) ? value : [value];
	}
	if (raw.trim().startsWith("[")) {
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			throw new UsageError(`${flag.flag} is not a valid JSON array: '${raw}'`);
		}
		if (!Array.isArray(value)) throw new UsageError(`${flag.flag} expects an array, got '${raw}'`);
		return value.map((item) => (itemKind ? coerceItem(item, itemKind, flag) : item));
	}
	const parts = raw.split(",").map((part) => part.trim());
	return parts.map((part) =>
		itemKind && itemKind !== "auto" ? coerceScalar(part, { ...flag, kind: itemKind }) : coerceAuto(part)
	);
}

/** Coerce one already-parsed JSON element against the item kind. */
export function coerceItem(value: unknown, kind: FlagKind, flag: ToolFlag): unknown {
	if ((kind === "number" || kind === "integer") && typeof value !== "number") {
		throw new UsageError(`${flag.flag} expects ${kind} elements, got '${String(value)}'`);
	}
	if (kind === "integer" && !Number.isInteger(value)) {
		throw new UsageError(`${flag.flag} expects integer elements, got '${String(value)}'`);
	}
	if (kind === "string" && typeof value !== "string") {
		throw new UsageError(`${flag.flag} expects string elements, got '${String(value)}'`);
	}
	if (kind === "boolean" && typeof value !== "boolean") {
		throw new UsageError(`${flag.flag} expects boolean elements, got '${String(value)}'`);
	}
	return value;
}

/** Validate required parameters and enum membership against the merged arguments. */
export function validateArgs(model: ToolFlagModel, args: Record<string, unknown>, tool: CliTool): void {
	const missing = model.flags
		.filter((flag) => flag.required && !AUTO_FILLABLE_PARAMS.has(flag.param) && !isProvided(args[flag.param]))
		.map((flag) => flag.flag);
	if (missing.length) {
		throw new UsageError(`missing required parameter(s) for ${tool.name}: ${missing.join(", ")}`);
	}
	for (const flag of model.flags) {
		if (!flag.enumValues.length || !(flag.param in args)) continue;
		checkEnum(args[flag.param], flag);
	}
}

/** Whether a value counts as supplied (an exact empty string does not). */
export function isProvided(value: unknown): boolean {
	if (value === undefined || value === null || value === "") return false;
	if (Array.isArray(value) && value.length === 0) return false;
	return true;
}

/** Validate one value (or each array element) against the property's enum. */
export function checkEnum(value: unknown, flag: ToolFlag): void {
	const allowed = flag.enumValues;
	const check = (candidate: unknown): void => {
		if (!allowed.includes(String(candidate))) {
			throw new UsageError(`${flag.flag} must be one of: ${allowed.join(", ")} (got '${String(candidate)}')`);
		}
	};
	if (Array.isArray(value)) {
		for (const item of value) check(item);
		return;
	}
	check(value);
}

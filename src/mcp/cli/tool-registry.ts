/**
 * CLI view of the MCP tool registry (TASK-011).
 *
 * The CLI must never carry a second, hand-maintained tool list: every command
 * name, description and input schema it prints comes from the SAME sources the
 * MCP transports use — `TOOL_DEFINITIONS` (the canonical definitions, whose
 * `inputSchema` is already materialized JSON Schema derived from the Zod
 * schemas) and `getAvailableToolDefinitions` (tools/tool-availability.ts), which
 * decides what a session may actually call.
 *
 * A tool that exists in `TOOL_DEFINITIONS` but is filtered out of the available
 * set (today: `synthesize`, which needs MCP sampling) is reported as
 * UNAVAILABLE with a reason rather than silently hidden — a user who types a
 * real tool name and gets "Unknown command" is being lied to about the surface.
 */
import { getAvailableToolDefinitions } from "../tools/tool-availability";
import { TOOL_DEFINITIONS } from "../tools/tool-definitions";
import { TOOL_ALIASES } from "../utils/tool-plumbing";

/** Grouping used by root help and `tools list` (derived from the name prefix). */
export type ToolCategory = "memory" | "task" | "standard" | "handoff" | "claim" | "observation" | "codebase" | "other";

/** Stable display order for the categories. */
export const TOOL_CATEGORY_ORDER: readonly ToolCategory[] = [
	"memory",
	"task",
	"standard",
	"handoff",
	"claim",
	"observation",
	"codebase",
	"other"
];

/** One tool as the CLI presents it. */
export interface CliTool {
	/** Canonical registry name — the command name users type. */
	name: string;
	/** Short human title from the registry, or the name when absent. */
	title: string;
	/** One-line description from the registry. */
	description: string;
	/** Prefix-derived category (never a hand-maintained mapping). */
	category: ToolCategory;
	/** Whether a session without MCP roots/sampling may call it. */
	available: boolean;
	/** Why it is unavailable; `null` when available. */
	unavailableReason: string | null;
	/** JSON Schema (draft-07) as registered — the authoritative input contract. */
	inputSchema: Record<string, unknown>;
}

/** Map of a tool-name prefix to its help category; anything else is `other`. */
const CATEGORY_PREFIXES: ReadonlyArray<[string, ToolCategory]> = [
	["memory-", "memory"],
	["task-", "task"],
	["standard-", "standard"],
	["handoff-", "handoff"],
	["claim-", "claim"],
	["observation-", "observation"],
	["codebase-", "codebase"]
];

/** Derive the display category from a canonical tool name. */
export function categoryOf(name: string): ToolCategory {
	for (const [prefix, category] of CATEGORY_PREFIXES) {
		if (name.startsWith(prefix)) return category;
	}
	return "other";
}

/**
 * Build the CLI tool inventory.
 *
 * Reads the registry on every call (cheap, and it keeps the CLI honest after a
 * hot-reload in tests); availability comes from the router's session filter with
 * NO session, which is exactly the CLI's capability profile: no MCP roots, no
 * sampling.
 *
 * @returns Every canonical tool, ordered by category then name.
 */
export function loadToolInventory(): CliTool[] {
	const availableNames = new Set(getAvailableToolDefinitions().map((tool) => tool.name));
	const tools: CliTool[] = TOOL_DEFINITIONS.map((definition) => {
		const name = definition.name;
		const available = availableNames.has(name);
		return {
			name,
			title: typeof definition.title === "string" && definition.title.trim() ? definition.title : name,
			description: definition.description ?? "",
			category: categoryOf(name),
			available,
			unavailableReason: available ? null : unavailableReasonFor(name),
			inputSchema: (definition.inputSchema ?? {}) as Record<string, unknown>
		};
	});

	return tools.sort((a, b) => {
		const byCategory = TOOL_CATEGORY_ORDER.indexOf(a.category) - TOOL_CATEGORY_ORDER.indexOf(b.category);
		return byCategory !== 0 ? byCategory : a.name.localeCompare(b.name);
	});
}

/** The router filter drops `synthesize` when the session has no sampling. */
function unavailableReasonFor(name: string): string {
	return name === "synthesize"
		? "requires an MCP client that advertises sampling; not callable from the CLI"
		: "not available in this session";
}

/**
 * Resolve a typed command token to its canonical tool name.
 *
 * Mirrors every dispatcher: dots become hyphens (`memory.read` → `memory-read`)
 * and the backward-compat alias map is applied (`task-update` → `task-write`).
 *
 * @param token - The command word the user typed.
 * @returns The canonical registry name, or `null` when the token is not a tool.
 */
export function resolveToolName(token: string): string | null {
	const raw = token.replace(/\./g, "-");
	const canonical = TOOL_ALIASES[raw] ?? raw;
	return TOOL_DEFINITIONS.some((definition) => definition.name === canonical) ? canonical : null;
}

/**
 * Closest-match hint for an unknown command (clig.dev: suggest, never just fail).
 *
 * @param token - The unrecognized word the user typed.
 * @param candidates - Known command/tool names.
 * @returns The nearest candidate within an edit-distance bound, or `null`.
 */
export function suggestCommand(token: string, candidates: readonly string[]): string | null {
	const needle = token.replace(/^--?/, "").toLowerCase();
	let best: { name: string; distance: number } | null = null;
	const maxDistance = Math.max(2, Math.floor(needle.length / 3) + 1);

	for (const candidate of candidates) {
		const distance = levenshtein(needle, candidate.toLowerCase(), maxDistance);
		if (distance <= maxDistance && (!best || distance < best.distance)) {
			best = { name: candidate, distance };
		}
	}
	return best?.name ?? null;
}

/** Bounded Levenshtein distance; returns `limit + 1` as soon as a row exceeds `limit`. */
function levenshtein(a: string, b: string, limit: number): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;

	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
			rowMin = Math.min(rowMin, current[j]);
		}
		if (rowMin > limit) return limit + 1;
		previous = current;
	}
	return previous[b.length];
}

/**
 * Parameter-list handling and merge-hint shaping for the DUPLICATES mode
 * (FEAT-001). Split from `duplicates-normalize.ts` (file-size limit):
 *
 * - `findParameterGroup` locates the declaration's parameter list in a token
 *   stream (see that function's doc for the heuristics).
 * - `splitParameterList` / `parameterName` reduce raw parameter declarations
 *   to comparable display names.
 * - `describeParamDiff` / `buildMergeHint` shape the DRY merge hint the mode
 *   exists for: same body, differing parameters → mergeable.
 */

import type { NormalizedToken } from "./duplicates-normalize";

/** A balanced `( … )` group located in a token stream. */
export interface ParameterGroup {
	openIndex: number;
	closeIndex: number;
}

/**
 * Index of the token where the declaration body starts: the first `{` (or `:`)
 * at parenthesis depth 0. Everything before it is the declaration header.
 */
function bodyMarkerIndex(tokens: NormalizedToken[]): number {
	let depth = 0;
	for (let i = 0; i < tokens.length; i++) {
		const value = tokens[i].value;
		if (value === "(") {
			depth++;
		} else if (value === ")") {
			depth = Math.max(0, depth - 1);
		} else if (depth === 0 && (value === "{" || value === ":")) {
			return i;
		}
	}
	return tokens.length;
}

/**
 * Locate the declaration's parameter list: the last top-level balanced `( … )`
 * group that ends before the body marker, preferring groups whose opening
 * paren follows an identifier (the declared name). That preference skips
 * decorator arguments (`@dec(x)`) and Go's trailing result tuple
 * (`func f(a int) (int, error)`).
 */
export function findParameterGroup(tokens: NormalizedToken[]): ParameterGroup | null {
	const marker = bodyMarkerIndex(tokens);
	const groups: ParameterGroup[] = [];
	let depth = 0;
	let openIndex = -1;
	for (let i = 0; i < marker; i++) {
		const value = tokens[i].value;
		if (value === "(") {
			if (depth === 0) openIndex = i;
			depth++;
		} else if (value === ")") {
			depth = Math.max(0, depth - 1);
			if (depth === 0 && openIndex !== -1) {
				groups.push({ openIndex, closeIndex: i });
				openIndex = -1;
			}
		}
	}
	if (groups.length === 0) return null;
	const named = groups.filter((group) => group.openIndex > 0 && tokens[group.openIndex - 1].kind === "id");
	return named.length > 0 ? named[named.length - 1] : groups[groups.length - 1];
}

/**
 * Split a raw parameter list on top-level commas, respecting quotes and
 * bracket nesting (`Map<string, number>`, `{ a, b }`, default values).
 */
export function splitParameterList(raw: string): string[] {
	const parts: string[] = [];
	let current = "";
	let round = 0;
	let square = 0;
	let curly = 0;
	let angle = 0;
	let quote: string | null = null;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (quote) {
			current += ch;
			if (ch === "\\") {
				current += raw[i + 1] ?? "";
				i++;
			} else if (ch === quote) {
				quote = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			current += ch;
			continue;
		}
		// Only treat `<` as generic nesting when it directly follows an identifier
		// (`Map<`), so comparison operators in default values are not mistaken.
		if (ch === "<" && /[A-Za-z0-9_$]$/.test(current)) angle++;
		else if (ch === ">" && angle > 0 && raw[i - 1] !== "=") angle--;
		else if (ch === "(") round++;
		else if (ch === ")") round = Math.max(0, round - 1);
		else if (ch === "[") square++;
		else if (ch === "]") square = Math.max(0, square - 1);
		else if (ch === "{") curly++;
		else if (ch === "}") curly = Math.max(0, curly - 1);
		if (ch === "," && round === 0 && square === 0 && curly === 0 && angle === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current);
	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Leading modifiers that decorate a parameter but are not its name. */
const PARAM_MODIFIER =
	/^(?:public|private|protected|internal|readonly|final|static|const|var|let|mut|ref|out|in|params|this)\s+/i;

/** Index of the first top-level `needle` character, or -1. */
function topLevelIndex(text: string, needle: string): number {
	let round = 0;
	let square = 0;
	let curly = 0;
	let angle = 0;
	let quote: string | null = null;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === "\\") i++;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			continue;
		}
		if (ch === needle && round === 0 && square === 0 && curly === 0 && angle === 0) return i;
		if (ch === "<" && /[A-Za-z0-9_$]$/.test(text.slice(0, i))) angle++;
		else if (ch === ">" && angle > 0 && text[i - 1] !== "=") angle--;
		else if (ch === "(") round++;
		else if (ch === ")") round = Math.max(0, round - 1);
		else if (ch === "[") square++;
		else if (ch === "]") square = Math.max(0, square - 1);
		else if (ch === "{") curly++;
		else if (ch === "}") curly = Math.max(0, curly - 1);
	}
	return -1;
}

/**
 * Reduce one raw parameter declaration to its display name
 * (`public readonly x?: string` → `x`, `...rest` → `rest`,
 * `{ label, onClick }` → `{label,onClick}`).
 */
export function parameterName(part: string): string {
	let text = part.trim();
	for (;;) {
		const stripped = text.replace(PARAM_MODIFIER, "");
		if (stripped === text) break;
		text = stripped;
	}
	const defaultAt = topLevelIndex(text, "=");
	if (defaultAt !== -1) text = text.slice(0, defaultAt);
	const typeAt = topLevelIndex(text, ":");
	if (typeAt !== -1) text = text.slice(0, typeAt);
	text = text.trim().replace(/^(?:\.{3}|&|\?|\*)+/, "");
	if (text.startsWith("{") || text.startsWith("[")) return text.replace(/\s+/g, "");
	const matches = text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
	if (!matches || matches.length === 0) return text;
	return matches[matches.length - 1];
}

/** Parameter names from a raw list of declarations. */
export function parameterNames(parts: string[]): string[] {
	return parts.map(parameterName).filter((name) => name.length > 0);
}

/** Result of diffing the parameter lists of one duplicate group. */
export interface ParamDiff {
	/** Parameter names of each group member, aligned with the group's `symbols[]` order. */
	param_sets: string[][];
	/** Names present in every member's list. */
	common: string[];
	/** Names present in at least one list but not all (sorted). */
	unique: string[];
}

/**
 * Diff the parameter lists of a duplicate group.
 *
 * @param paramSets Parameter names per group member, aligned with `symbols[]`.
 */
export function describeParamDiff(paramSets: string[][]): ParamDiff {
	const [first = [], ...rest] = paramSets;
	const common = first.filter((name) => rest.every((set) => set.includes(name)));
	const all = new Set<string>();
	for (const set of paramSets) for (const name of set) all.add(name);
	const unique = [...all].filter((name) => !common.includes(name)).sort((a, b) => a.localeCompare(b));
	return { param_sets: paramSets, common, unique };
}

/** Human-readable parameter list, e.g. `a, b` or `(none)`. */
function formatParams(names: string[]): string {
	return names.length === 0 ? "(none)" : names.join(", ");
}

/** Noun used in merge hints for a symbol kind. */
function kindNoun(kind: string): string {
	if (kind === "class") return "class";
	if (kind === "interface") return "interface";
	return "function";
}

/**
 * Build the merge hint for one duplicate group.
 *
 * The DRY case the feature exists for — identical body, differing parameters —
 * names the parameter lists and proposes a single function with optional
 * parameters when one list is a superset of the others.
 *
 * @param kind Symbol kind (`function`, `method`, `class`, …).
 * @param groupClass `exact` (similarity 1) or `near`.
 * @param similarity Similarity score in [0, 1].
 * @param paramDiff Output of {@link describeParamDiff}.
 */
export function buildMergeHint(
	kind: string,
	groupClass: "exact" | "near",
	similarity: number,
	paramDiff: ParamDiff
): string {
	const noun = kindNoun(kind);
	const body = groupClass === "exact" ? "same body" : `near-identical body (${similarity.toFixed(2)})`;
	const sets = paramDiff.param_sets;

	if (sets.length === 0 || paramDiff.unique.length === 0) {
		if (sets.length > 0) {
			return `${body}, params ${formatParams(sets[0])}: consolidate into one shared ${noun}`;
		}
		return `${body}: consolidate into one shared ${noun}`;
	}

	const lists = sets.map(formatParams).join(" vs ");
	const longest = sets.reduce((best, set) => (set.length > best.length ? set : best), sets[0]);
	const superset = sets.every((set) => set.every((name) => longest.includes(name)));
	if (superset) {
		const extras = longest.filter((name) => !sets.every((set) => set.includes(name)));
		return `${body}, params ${lists}: merge into one function with optional params (${extras.join(", ")} optional)`;
	}
	return `${body}, params ${lists}: merge into one function with a superset parameter list`;
}

/**
 * Parameter-list handling and merge-hint shaping for the DUPLICATES mode
 * (FEAT-001). Split from `duplicates-normalize.ts` (file-size limit):
 *
 * - `findDeclarationHeader` locates the declaration header boundary, the
 *   declaration's own name token, and its parameter group in a token stream.
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

/** What `findDeclarationHeader` recovers from a declaration's token stream. */
export interface DeclarationHeader {
	/** Token index where the header ends (the body starts here, or `tokens.length`). */
	endIndex: number;
	/** Token index of the declaration's own name, when one can be identified. */
	nameIndex: number | null;
	/** The declaration's parameter group, when the shape has one. */
	group: ParameterGroup | null;
}

/**
 * Identifier-shaped token test. Keyword tokens keep their verbatim value and
 * punctuation/literals are single characters or `LIT`, so a leading letter or
 * `_`/`$` distinguishes identifiers from everything else without a token-kind
 * flag — `function`, `double` and `items` are all identifier-shaped.
 */
function isIdentifierToken(token: NormalizedToken | undefined): boolean {
	return token !== undefined && /^[A-Za-z_$\u0080-\uffff]/.test(token.value) && token.value !== "LIT";
}

/**
 * Keywords that introduce a declaration and are therefore NOT its name
 * (`function foo`, `export default async function foo`, `const f = …`,
 * `def f`, `fn f`). A name that happens to collide with one of these (e.g. a
 * function literally named `const`) is not recoverable, which costs only the
 * name canonicalization — the parameter group is unaffected.
 */
const DECLARATION_INTRODUCERS = new Set([
	"abstract",
	"async",
	"await",
	"const",
	"declare",
	"default",
	"def",
	"export",
	"extern",
	"final",
	"fn",
	"func",
	"fun",
	"function",
	"inline",
	"internal",
	"lambda",
	"let",
	"mut",
	"override",
	"private",
	"protected",
	"pub",
	"public",
	"readonly",
	"static",
	"sub",
	"unsafe",
	"var",
	"virtual"
]);

/** Keywords that may introduce an anonymous declaration (`function (a) {}`). */
const ANONYMOUS_FUNCTION_KEYWORDS = new Set(["def", "fn", "func", "fun", "function", "lambda", "sub"]);

/** Skip leading decorators (`@dec`, `@a.b(1, 2)`) and return the next index. */
function skipDecorators(tokens: NormalizedToken[], end: number): number {
	let i = 0;
	while (i < end && tokens[i].value === "@") {
		i++;
		while (i < end && (isIdentifierToken(tokens[i]) || tokens[i].value === ".")) i++;
		if (i < end && tokens[i].value === "(") {
			let depth = 0;
			for (; i < end; i++) {
				if (tokens[i].value === "(") depth++;
				else if (tokens[i].value === ")") {
					depth--;
					if (depth === 0) {
						i++;
						break;
					}
				}
			}
		}
	}
	return i;
}

/**
 * Index where the declaration header ends: the first `{` at paren/brace/angle
 * depth 0 (a block body), or the `=>` of an arrow declaration (expression OR
 * block body). A `:` never ends the header — it may belong to a type
 * annotation, a return type, a Python body start, or an object type literal —
 * and the parameter group is located positionally, so no colon heuristic is
 * needed. `{`/`<` inside a generic constraint (`<T extends { a: number }>`) are
 * tracked by brace/angle depth instead of ending the header.
 */
function headerEndIndex(tokens: NormalizedToken[]): number {
	let paren = 0;
	let brace = 0;
	let angle = 0;
	for (let i = 0; i < tokens.length; i++) {
		const value = tokens[i].value;
		if (value === "(") {
			paren++;
		} else if (value === ")") {
			paren = Math.max(0, paren - 1);
		} else if (value === "{") {
			if (paren === 0 && brace === 0 && angle === 0) return i;
			brace++;
		} else if (value === "}") {
			brace = Math.max(0, brace - 1);
		} else if (value === "<") {
			// Generic opener only when it follows an identifier (`Map<`, `method<`).
			if (/[A-Za-z0-9_$]$/.test(tokens[i - 1]?.value ?? "")) angle++;
		} else if (value === ">") {
			if (angle > 0) angle--;
		} else if (value === "=" && paren === 0 && brace === 0 && angle === 0 && tokens[i + 1]?.value === ">") {
			return i;
		}
	}
	return tokens.length;
}

/** Every top-level balanced `( … )` group inside `[start, end)`. */
function topLevelGroups(tokens: NormalizedToken[], start: number, end: number): ParameterGroup[] {
	const groups: ParameterGroup[] = [];
	let depth = 0;
	let openIndex = -1;
	for (let i = start; i < end; i++) {
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
	return groups;
}

/**
 * Locate a declaration's header boundary, own name and parameter group.
 *
 * The parameter group is chosen positionally, in this precedence order, which
 * is unambiguous for every shape the indexer records as `function`/`method`:
 *
 * 1. a group preceded by `=` — arrow declarators (`mapAll = (items) => …`,
 *    `h1: Handler = (a) => …`), where the type annotation is irrelevant;
 * 2. a group preceded by `>` — generic declaration (`method<T>(x: T)`);
 * 3. a group preceded by an anonymous-function keyword (`function (a) {}`);
 * 4. a group preceded by an identifier — plain declarations (`function foo(a)`,
 *    class methods `reset(): void`, Python `def f(a)`);
 * 5. the first top-level group — anonymous arrows (`(a) => …`).
 *
 * Because the search is bounded by {@link headerEndIndex}, a call in the body is
 * never a candidate: `function f(a) { return items.map(x => x * 2); }` ends at
 * the body `{`, so only `(a)` is in scope.
 */
export function findDeclarationHeader(tokens: NormalizedToken[]): DeclarationHeader {
	const endIndex = headerEndIndex(tokens);
	const start = skipDecorators(tokens, endIndex);

	let nameIndex: number | null = null;
	for (let i = start; i < endIndex; i++) {
		if (!isIdentifierToken(tokens[i])) continue;
		if (DECLARATION_INTRODUCERS.has(tokens[i].value)) continue;
		nameIndex = i;
		break;
	}

	const groups = topLevelGroups(tokens, start, endIndex);
	const pick = (predicate: (group: ParameterGroup) => boolean): ParameterGroup | null => groups.find(predicate) ?? null;

	const group =
		pick((g) => g.openIndex > 0 && tokens[g.openIndex - 1].value === "=") ??
		pick((g) => g.openIndex > 0 && tokens[g.openIndex - 1].value === ">") ??
		pick((g) => g.openIndex > 0 && ANONYMOUS_FUNCTION_KEYWORDS.has(tokens[g.openIndex - 1].value)) ??
		pick((g) => g.openIndex > 0 && isIdentifierToken(tokens[g.openIndex - 1])) ??
		(groups.length > 0 ? groups[0] : null);

	return { endIndex, nameIndex, group };
}

/** Locate only the declaration's parameter group. */
export function findParameterGroup(tokens: NormalizedToken[]): ParameterGroup | null {
	return findDeclarationHeader(tokens).group;
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

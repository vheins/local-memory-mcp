/**
 * Token normalization for the codebase-read DUPLICATES mode (FEAT-001).
 *
 * Reduces a symbol's indexed source range to a canonical comparison form:
 * comments and whitespace are dropped, identifiers become `ID`, numeric and
 * string literals become `LIT`, while keywords and punctuation are preserved.
 * That is the standard "Type-2 clone" normalization: formatting, naming and
 * literal spelling differences do not hide a duplicated body, but a changed
 * keyword (`return` vs `throw`) or control structure keeps them distinct.
 *
 * The declaration's parameter list is located separately and blanked from the
 * comparison key, so two functions with the same body but different parameters
 * compare equal — the DRY case where they can be merged into one function with
 * optional parameters. The raw parameter declarations are kept for the diff
 * and merge hint.
 *
 * The declaration's OWN NAME token is always canonicalized to `ID`, even when
 * it collides with another language's keyword (`double`, `type`, `match`, …):
 * a name is never a reason two identical bodies fail to group. Keywords in BODY
 * position stay verbatim, so a control-flow change (`if` vs `while`) still
 * separates symbols.
 *
 * Everything here is pure and deterministic: same source + language ⇒ same
 * token stream, same key, same parameter names.
 */

import { DUPLICATES_SHINGLE_SIZE } from "../../utils/constants";
import { findDeclarationHeader, findParameterGroup, parameterNames, splitParameterList } from "./duplicates-params";

// Re-exported for consumers that operate on parameter groups without touching
// the tokenizer (single source of truth stays in duplicates-params.ts).
export type { ParameterGroup } from "./duplicates-params";

/** Canonical token classes kept by the comparator. */
export type NormalizedTokenKind = "id" | "literal" | "punct";

export interface NormalizedToken {
	kind: NormalizedTokenKind;
	/** Canonical value: keywords verbatim, identifiers `ID`, literals `LIT`, punctuation as-is. */
	value: string;
	/** Character offset of the token start in the scanned source. */
	start: number;
	/** Character offset one past the token end. */
	end: number;
}

/** Language-aware result of {@link normalizeSymbolBody}. */
export interface NormalizedSymbolBody {
	/** Canonical token values; the parameter-list interior is replaced by a single `PARAMS` marker. */
	canonicalTokens: string[];
	/** Cleaned parameter names from the declaration's parameter list (empty for non-callables). */
	paramNames: string[];
	/** Unique, sorted 32-bit hashes of every consecutive 3-token shingle (near-pass candidate keys). */
	shingles: number[];
}

/**
 * Keywords kept verbatim during canonicalization. The union is intentionally
 * broad (multi-language) because a symbol's language is not needed to decide
 * whether an identifier is a keyword — preserving an unknown word only costs a
 * missed exact match, while canonicalizing a real keyword risks a false group
 * (`if` vs `while`).
 */
const KEYWORDS = new Set<string>([
	"abstract",
	"and",
	"as",
	"async",
	"await",
	"break",
	"case",
	"catch",
	"char",
	"class",
	"const",
	"constructor",
	"continue",
	"def",
	"default",
	"delete",
	"do",
	"double",
	"else",
	"elif",
	"enum",
	"export",
	"extends",
	"false",
	"final",
	"finally",
	"float",
	"fn",
	"for",
	"from",
	"func",
	"function",
	"goto",
	"if",
	"impl",
	"implements",
	"import",
	"in",
	"instanceof",
	"int",
	"interface",
	"internal",
	"is",
	"lambda",
	"let",
	"long",
	"match",
	"module",
	"namespace",
	"new",
	"nil",
	"none",
	"not",
	"null",
	"of",
	"or",
	"out",
	"override",
	"package",
	"params",
	"private",
	"protected",
	"public",
	"raise",
	"readonly",
	"ref",
	"return",
	"self",
	"short",
	"static",
	"struct",
	"super",
	"switch",
	"this",
	"throw",
	"trait",
	"true",
	"try",
	"type",
	"typeof",
	"undefined",
	"union",
	"use",
	"val",
	"var",
	"virtual",
	"void",
	"when",
	"while",
	"with",
	"yield"
]);

/** Languages whose line comments start with `#` instead of `//`. */
const HASH_COMMENT_LANGUAGES = new Set<string>([
	"bash",
	"coffee",
	"crystal",
	"dockerfile",
	"elixir",
	"fish",
	"makefile",
	"nim",
	"perl",
	"python",
	"r",
	"ruby",
	"sh",
	"shell",
	"toml",
	"yaml",
	"zsh"
]);

interface CommentStyle {
	/** `//` line comments and `/* … *\/` block comments. */
	slash: boolean;
	/** `#` line comments. */
	hash: boolean;
}

/** Resolve a file language's comment syntax (unknown languages default to slash). */
function commentStyle(language: string | null): CommentStyle {
	const lang = (language ?? "").toLowerCase();
	const hash = HASH_COMMENT_LANGUAGES.has(lang);
	// PHP accepts both `//` (inherited from C) and `#`.
	return { slash: !hash || lang === "php", hash };
}

/** Fast identifier-character test (ASCII plus a permissive non-ASCII range). */
function isIdentifierStart(ch: string): boolean {
	return /[A-Za-z_$\u0080-\uffff]/.test(ch);
}

function isIdentifierPart(ch: string): boolean {
	return /[A-Za-z0-9_$\u0080-\uffff]/.test(ch);
}

/**
 * Scan a quoted literal starting at `start` (the opening quote).
 *
 * @returns The index one past the closing quote, or -1 when the quote cannot be
 * a literal opener (an apostrophe / Rust lifetime) so the caller emits it as
 * punctuation. Newlines are allowed inside the scan because several languages
 * permit multi-line strings; the scan is bounded to keep a stray quote from
 * swallowing the whole range.
 */
function scanQuoted(source: string, start: number, quote: string): number {
	if (quote === "'") {
		const next = source[start + 1] ?? "";
		const afterNext = source[start + 2] ?? "";
		// `'a` without a closing quote is a lifetime/apostrophe, not a char literal.
		if (isIdentifierPart(next) && afterNext !== "'") return -1;
	}
	const limit = Math.min(source.length, start + 2000);
	let i = start + 1;
	while (i < limit) {
		const ch = source[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === quote) return i + 1;
		i++;
	}
	return quote === "'" ? -1 : limit;
}

/**
 * Tokenize source into canonical comparison tokens.
 *
 * Comments are dropped per language, whitespace is dropped, identifiers are
 * canonicalized to `ID` unless they are keywords, and literals to `LIT`.
 */
export function tokenizeNormalized(source: string, language: string | null): NormalizedToken[] {
	const style = commentStyle(language);
	const tokens: NormalizedToken[] = [];
	let i = 0;

	while (i < source.length) {
		const ch = source[i];
		const next = source[i + 1];

		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		if (style.slash && ch === "/" && next === "/") {
			const nl = source.indexOf("\n", i);
			i = nl === -1 ? source.length : nl + 1;
			continue;
		}
		if (style.slash && ch === "/" && next === "*") {
			const close = source.indexOf("*/", i + 2);
			i = close === -1 ? source.length : close + 2;
			continue;
		}
		// PHP 8 attributes (`#[...]`) share the `#` prefix with hash comments.
		if (style.hash && ch === "#" && next !== "[") {
			const nl = source.indexOf("\n", i);
			i = nl === -1 ? source.length : nl + 1;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			const end = scanQuoted(source, i, ch);
			if (end !== -1) {
				tokens.push({ kind: "literal", value: "LIT", start: i, end });
				i = end;
				continue;
			}
		}
		if (/[0-9]/.test(ch)) {
			let j = i + 1;
			while (j < source.length && /[0-9A-Za-z_.]/.test(source[j])) j++;
			tokens.push({ kind: "literal", value: "LIT", start: i, end: j });
			i = j;
			continue;
		}
		if (isIdentifierStart(ch)) {
			let j = i + 1;
			while (j < source.length && isIdentifierPart(source[j])) j++;
			const word = source.slice(i, j);
			tokens.push({
				kind: KEYWORDS.has(word) ? "punct" : "id",
				value: KEYWORDS.has(word) ? word : "ID",
				start: i,
				end: j
			});
			i = j;
			continue;
		}
		tokens.push({ kind: "punct", value: ch, start: i, end: i + 1 });
		i++;
	}

	return tokens;
}

/** FNV-1a 32-bit hash — deterministic, cheap shingle key (collision-tolerant via exact Jaccard). */
function hashShingle(values: string[]): number {
	let hash = 0x811c9dc5;
	for (const value of values) {
		for (let i = 0; i < value.length; i++) {
			hash ^= value.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		hash ^= 0x1f;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

/** Unique, sorted 3-token shingle hashes. */
function buildShingles(canonicalTokens: string[]): number[] {
	const size = DUPLICATES_SHINGLE_SIZE;
	if (canonicalTokens.length < size) return [];
	const seen = new Set<number>();
	for (let i = 0; i + size <= canonicalTokens.length; i++) {
		seen.add(hashShingle(canonicalTokens.slice(i, i + size)));
	}
	return [...seen].sort((a, b) => a - b);
}

/**
 * Normalize one symbol's source range.
 *
 * @param source Raw source text of the symbol's `[start_line, end_line]` range.
 * @param language File language (`codebase_files.language`) — selects comment syntax.
 * @param signature Stored one-line signature, used as a parameter-list fallback
 * when the range's first balanced paren group is not a declaration list.
 */
export function normalizeSymbolBody(
	source: string,
	language: string | null,
	signature?: string | null
): NormalizedSymbolBody {
	const tokens = tokenizeNormalized(source, language);
	const header = findDeclarationHeader(tokens);
	const group = header.group;

	// The declaration's own name never decides whether two bodies match: a name
	// that collides with ANOTHER language's keyword (`double`, `type`, `from`,
	// `match`, …) would otherwise stay verbatim while its peer canonicalizes to
	// ID, hiding an exact duplicate (FIX-023). Body keywords keep their verbatim
	// treatment, so `if` vs `while` still separates.
	const values = tokens.map((token) => token.value);
	if (header.nameIndex !== null) values[header.nameIndex] = "ID";

	let paramNames: string[] = [];
	if (group) {
		const raw = source.slice(tokens[group.openIndex].end, tokens[group.closeIndex].start);
		paramNames = parameterNames(splitParameterList(raw));
	} else if (signature) {
		const sigTokens = tokenizeNormalized(signature, language);
		const sigGroup = findParameterGroup(sigTokens);
		if (sigGroup) {
			const raw = signature.slice(sigTokens[sigGroup.openIndex].end, sigTokens[sigGroup.closeIndex].start);
			paramNames = parameterNames(splitParameterList(raw));
		}
	}

	const canonicalTokens: string[] = [];
	if (group) {
		for (let i = 0; i < group.openIndex; i++) canonicalTokens.push(values[i]);
		canonicalTokens.push("(", "PARAMS", ")");
		for (let i = group.closeIndex + 1; i < values.length; i++) canonicalTokens.push(values[i]);
	} else {
		canonicalTokens.push(...values);
	}

	return { canonicalTokens, paramNames, shingles: buildShingles(canonicalTokens) };
}


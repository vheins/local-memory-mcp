/**
 * code-search — CODE mode content grep for codebase-read (TASK-316).
 *
 * Satisfies US-11 ("search file contents, results enriched with surrounding
 * symbol definitions") and C3 ("grep over indexed files — symbol context
 * around matches") with a DISK GREP, not a DB content scan:
 *
 *  1. Scope is strictly the codebase_files index — only files that were
 *     discovered+indexed are read (node_modules/.git/untracked files never
 *     appear in codebase_files, so they are excluded by construction).
 *  2. File content is read from disk at `repoPath` (caller-supplied, exactly
 *     as index_repository takes it — the index stores no repo→path registry).
 *  3. A process-shared LRU cache keyed by repo+file_path, validity keyed to
 *     the codebase_files ROW checksum: re-index updates the row ⇒ checksum
 *     mismatch ⇒ content reloaded on next access (the "re-stale check on
 *     access" from TASK-316). Shared across ALL agent connections (module
 *     singleton, same pattern as parserPool / indexingRepos), bounded by
 *     file-count + byte-budget, single-flight against async reentrancy.
 *  4. Matched lines are enriched with their innermost ENCLOSING symbol span
 *     (preloaded per file from codebase_symbols — the spec's "range preload
 *     per file" option).
 *
 * No DB growth, no migration, no schema change, no new MCP tool.
 */

import fs from "node:fs";
import path from "node:path";
import type { SQLiteStore } from "../../storage/sqlite";
import type { CodebaseFile, CodebaseSymbol } from "../../types";
import { logger } from "../../utils/logger";
import {
	CODE_SEARCH_CACHE_MAX_BYTES,
	CODE_SEARCH_CACHE_MAX_FILES,
	CODE_SEARCH_MAX_REGEX_LENGTH,
	CODE_SEARCH_READ_CONCURRENCY,
	CODE_SEARCH_SNIPPET_CHARS
} from "../../utils/constants";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** A matched line, located within a file, enriched with its enclosing symbol. */
export interface CodeSearchMatch {
	/** Relative file path (codebase_files.file_path). */
	filePath: string;
	/** codebase_files.language of the file. */
	language: string | null;
	/** 1-based line number of the match. */
	line: number;
	/** ~CODE_SEARCH_SNIPPET_CHARS chars around the match (ellipsis-padded). */
	snippet: string;
	/** Character index of the matched substring within the line. */
	matchIndex: number;
	/** Innermost symbol whose [start_line, end_line] encloses the line, if any. */
	enclosingSymbol: EnclosingSymbol | null;
}

export interface EnclosingSymbol {
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
}

export interface CodeSearchOptions {
	/** The substring / regex to grep for (trimmed by the handler). */
	needle: string;
	/** Treat `needle` as a regular expression (case-insensitive). */
	regex?: boolean;
	/** Only grep files whose codebase_files.language matches (case-insensitive). */
	language?: string;
	/** Max matches to return. */
	limit: number;
	/** Skip this many matches (across the whole file set) before returning. */
	offset: number;
}

export interface CodeSearchResult {
	matches: CodeSearchMatch[];
	/**
	 * Matches found within the scanned file set. When the search stopped early
	 * (cap reached), this is the count up to the stop point — `hasMore` is
	 * then true to signal more may exist in unscanned files.
	 */
	total: number;
	/** True when matches remain beyond this page (early-exit cap or pagination). */
	hasMore: boolean;
	/** Indexed files actually scanned (after language filter + readability). */
	filesScanned: number;
	/** Indexed files in scope (after language filter). */
	fileCount: number;
	/** Total indexed files for the repo (language-filter-independent; 0 ⇒ not indexed). */
	indexedFiles: number;
}

/** Thrown when `regex: true` but the needle is not a valid regular expression. */
export class InvalidCodeSearchRegexError extends Error {
	constructor(source: string) {
		super(`Invalid regex for code search: ${source}`);
		this.name = "InvalidCodeSearchRegexError";
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESS-SHARED LRU CONTENT CACHE
// ═══════════════════════════════════════════════════════════════════════════

interface CachedFileContent {
	/** codebase_files.checksum the content was loaded under (validity key). */
	checksum: string | null;
	content: string;
	sizeBytes: number;
}

const cacheKey = (repo: string, filePath: string): string => `${repo}\u0000${filePath}`;

/**
 * Bounded, process-shared LRU cache for indexed file contents (TASK-316).
 *
 * - Shared across ALL agent connections (module singleton) — never per-agent
 *   state, so multi-agent MCP sessions reuse each other's reads.
 * - Keyed by repo+file_path; the codebase_files ROW checksum is the validity
 *   key. A re-index updates the row (new checksum) ⇒ next access reloads from
 *   disk. A file edited on disk WITHOUT a re-index keeps serving the cached
 *   indexed content — the index is deliberately the source of truth, so
 *   content always matches what the symbol index describes.
 * - Bounded by CODE_SEARCH_CACHE_MAX_FILES + CODE_SEARCH_CACHE_MAX_BYTES,
 *   evicting least-recently-used until both caps hold.
 * - Thread-safety: Node is single-threaded, so Map mutations are atomic. The
 *   only reentrancy risk is interleaved async disk reads for the same key
 *   across concurrent sessions — guarded by a single-flight map (one read per
 *   key in flight; duplicates await the same promise).
 */
export class CodeSearchCache {
	private entries = new Map<string, CachedFileContent>();
	private inFlight = new Map<string, Promise<{ content: string; sizeBytes: number }>>();
	private totalBytes = 0;

	/**
	 * Resolve a file's content, loading from disk on miss / checksum change.
	 * A read failure propagates to the caller (the grep loop skips the file).
	 *
	 * Accounting is idempotent per key under concurrent access: after the
	 * single-flight read resolves, the insert path reconciles against the
	 * CURRENT map state (not the pre-await snapshot), so N simultaneous
	 * callers for one key subtract/add totalBytes exactly once.
	 */
	async getContent(repo: string, filePath: string, rowChecksum: string | null, absolutePath: string): Promise<string> {
		const key = cacheKey(repo, filePath);
		const cached = this.entries.get(key);

		// Validity keyed to the codebase_files row checksum (see class docs).
		if (cached && cached.checksum === rowChecksum) {
			// LRU refresh: delete + re-insert moves the entry to the newest end.
			this.entries.delete(key);
			this.entries.set(key, cached);
			return cached.content;
		}

		// Miss or stale — (re)load from disk, single-flight for concurrent
		// sessions. The derived cleanup chain consumes the rejection so a
		// failed read does not leave an unhandled rejection behind.
		let read = this.inFlight.get(key);
		if (!read) {
			read = fs.promises
				.readFile(absolutePath, "utf-8")
				.then((content) => ({ content, sizeBytes: Buffer.byteLength(content, "utf-8") }));
			this.inFlight.set(key, read);
			read.then(
				() => this.inFlight.delete(key),
				() => this.inFlight.delete(key)
			);
		}

		const loaded = await read;

		// Re-read the CURRENT map state: while we awaited the shared read,
		// another concurrent caller may already have inserted a fresh entry
		// for this key (single-flight). Reusing the pre-await `cached`
		// snapshot here would double-account totalBytes (N× inflate on
		// concurrent miss, N× subtract on concurrent stale reload) — the
		// subtract/add below must reconcile against whatever is in the map NOW.
		const current = this.entries.get(key);
		if (current && current.checksum === rowChecksum) {
			// Another caller already inserted a fresh entry (identical
			// checksum) — serve it; no accounting mutation.
			return current.content;
		}

		if (current) {
			this.totalBytes -= current.sizeBytes;
			this.entries.delete(key);
		}
		const entry: CachedFileContent = { checksum: rowChecksum, content: loaded.content, sizeBytes: loaded.sizeBytes };
		this.entries.set(key, entry);
		this.totalBytes += entry.sizeBytes;
		this.evictIfOverBudget();

		return entry.content;
	}

	/** Number of cached files (test/diagnostic helper). */
	get size(): number {
		return this.entries.size;
	}

	/** Total cached bytes (test/diagnostic helper). */
	get bytes(): number {
		return this.totalBytes;
	}

	/** Evict least-recently-used entries until BOTH caps are satisfied. */
	private evictIfOverBudget(): void {
		while (
			(this.entries.size > CODE_SEARCH_CACHE_MAX_FILES || this.totalBytes > CODE_SEARCH_CACHE_MAX_BYTES) &&
			this.entries.size > 0
		) {
			const oldestKey = this.entries.keys().next().value;
			if (oldestKey === undefined) break;
			const evicted = this.entries.get(oldestKey);
			if (!evicted) break;
			this.totalBytes -= evicted.sizeBytes;
			this.entries.delete(oldestKey);
		}
	}

	/** Clear the whole cache, or a single repo's entries (test/ops helper). */
	clear(repo?: string): void {
		if (repo === undefined) {
			this.entries.clear();
			this.totalBytes = 0;
			return;
		}
		const prefix = `${repo}\u0000`;
		for (const key of [...this.entries.keys()]) {
			if (key.startsWith(prefix)) {
				const entry = this.entries.get(key);
				if (entry) this.totalBytes -= entry.sizeBytes;
				this.entries.delete(key);
			}
		}
	}
}

/** Process-shared singleton — the ONE instance the tool handler uses. */
export const codeSearchCache = new CodeSearchCache();

/** Clear the shared cache (tests; also callable from ops/maintenance). */
export function clearCodeSearchCache(repo?: string): void {
	codeSearchCache.clear(repo);
}

// ═══════════════════════════════════════════════════════════════════════════
// GREP PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

export interface LineMatch {
	/** 1-based line number. */
	line: number;
	/** Character index of the match within the line. */
	matchIndex: number;
	snippet: string;
}

/**
 * Bounded repeats of a group whose body already carries a quantifier or
 * alternation explode the same way unbounded ones do — `(a|aa){25}` has up to
 * 2^25 backtracking states (OWASP's `(.*a){x}` class). Any `{n}` / `{n,m}`
 * whose min or max reaches this many repetitions is treated as "effectively
 * unbounded" by the guard. Purely a large-count heuristic; ordinary bounded
 * counts like `\d{2,4}` are unaffected (they only matter inside a suspect
 * group anyway).
 */
const REDOS_LARGE_REPEAT_MIN = 16;

/**
 * True when `pattern` contains a nested-unbounded-quantifier shape — the
 * classic ReDoS signature: a GROUP whose body carries an inner quantifier or
 * alternation, and that group is itself quantified without a small bound
 * (`*`, `+`, `{n,}`, or a large `{n}`/`{n,m}` — see REDOS_LARGE_REPEAT_MIN).
 * Repetition of a repetition (or repetition of a choice between overlapping
 * lengths) gives an attacker exponential backtracking against a long line
 * with no match — e.g. `^(a+)+$`, `(a|aa)+`, `(a+)*b`, `((ab)+)+`.
 *
 * The scan is a lightweight tokenizer, deliberately CONSERVATIVE: it can
 * never prove a pattern safe, only that it is NOT obviously catastrophic.
 * - Benign shapes scan clean: `foo.*bar` (single `.*` at top level),
 *   `\b\d{2,4}\b` (bounded count on a top-level atom), `(ab)+` (deterministic
 *   body, no inner quantifier), `(foo|bar)` (alternation but NOT quantified).
 *   These still compile.
 * - Conservative over-rejection is FINE per spec: a program that matches
 *   `(ab|cd)+` (linear in practice, non-overlapping alternatives) is also
 *   rejected — substring mode remains the default, safe path.
 *
 * @returns true when the pattern should be rejected before `new RegExp`.
 */
function hasNestedUnboundedQuantifiers(pattern: string): boolean {
	interface GroupFrame {
		/** An atom inside this group is followed by any quantifier. */
		innerQuantified: boolean;
		/** An alternation `|` appears at this group's body level. */
		hasAlternation: boolean;
	}

	const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

	/**
	 * If `pattern[start]` begins a quantifier (`*`, `+`, `?`, `{n}`, `{n,}`,
	 * `{n,m}`) return it with the index AFTER it and whether it is
	 * "effectively unbounded" (`*`, `+`, `{n,}`, or a repeat count reaching
	 * REDOS_LARGE_REPEAT_MIN — large bounded repeats of an ambiguous group are
	 * equally catastrophic). Returns null when `start` is not a quantifier —
	 * notably a `{` that does not form a valid count, which is a literal in JS
	 * regex syntax.
	 */
	function readQuantifier(start: number): { unbounded: boolean; end: number } | null {
		const ch = pattern[start];
		if (ch === "*" || ch === "+") {
			// Lazy variant `x*?` / `x+?` — consume the trailing `?` too.
			const end = pattern[start + 1] === "?" ? start + 2 : start + 1;
			return { unbounded: true, end };
		}
		if (ch === "?") return { unbounded: false, end: start + 1 };
		if (ch === "{") {
			let j = start + 1;
			while (isDigit(pattern[j])) j++;
			const min = Number.parseInt(pattern.slice(start + 1, j), 10) || 0;
			if (pattern[j] === ",") {
				// `{n,}` unbounded; `{n,m}` bounded — unless either count is
				// large enough to be catastrophic on its own.
				let k = j + 1;
				while (isDigit(pattern[k])) k++;
				const max = k > j + 1 ? Number.parseInt(pattern.slice(j + 1, k), 10) || 0 : Infinity;
				return { unbounded: max >= REDOS_LARGE_REPEAT_MIN || min >= REDOS_LARGE_REPEAT_MIN, end: k + 1 };
			}
			if (pattern[j] === "}") return { unbounded: min >= REDOS_LARGE_REPEAT_MIN, end: j + 1 };
			return null; // `{` not forming a valid count — a literal char.
		}
		return null;
	}

	const stack: GroupFrame[] = [];

	let i = 0;
	while (i < pattern.length) {
		const ch = pattern[i];

		// Zero-width anchors are not atoms: a quantifier after them binds to
		// nothing and must not pollute the enclosing group's accounting.
		if (ch === "^" || ch === "$") {
			i++;
			continue;
		}

		if (ch === "\\") {
			i += 2; // escaped atom (`\d`, `\.`, `\b`, …)
			const q = readQuantifier(i);
			if (q !== null) {
				if (stack.length > 0) stack[stack.length - 1].innerQuantified = true;
				i = q.end;
			}
			continue;
		}

		if (ch === "[") {
			i++;
			while (i < pattern.length && pattern[i] !== "]") {
				if (pattern[i] === "\\") i++;
				i++;
			}
			i++; // past the closing `]` — the class is one atom
			const q = readQuantifier(i);
			if (q !== null) {
				if (stack.length > 0) stack[stack.length - 1].innerQuantified = true;
				i = q.end;
			}
			continue;
		}

		if (ch === "(") {
			const frame: GroupFrame = { innerQuantified: false, hasAlternation: false };
			// Skip the opener, advancing to the body start: plain `(`, `(?:`,
			// `(?=`, `(?!`, `(?<=`, `(?<!`, and named groups `(?<name>…`.
			if (pattern[i + 1] === "?") {
				if (pattern[i + 2] === "<" && pattern[i + 3] !== "=" && pattern[i + 3] !== "!") {
					const gt = pattern.indexOf(">", i + 3);
					i = gt === -1 ? pattern.length - 1 : gt;
				} else {
					i += 2;
					if (pattern[i] === "<") i++; // lookbehind opener `(?<=` / `(?<!`
				}
			}
			stack.push(frame);
			i++;
			continue;
		}

		if (ch === ")") {
			const closed = stack.pop();
			if (closed) {
				const suspect = closed.innerQuantified || closed.hasAlternation;
				const q = readQuantifier(i + 1);
				if (q !== null) {
					if (suspect && q.unbounded) return true; // the ReDoS signature
					// The quantified group is itself a repeated atom for the
					// enclosing level — nested repetition that must be flagged
					// when the outer group is later quantified (e.g. `((ab)+)+`).
					if (stack.length > 0) stack[stack.length - 1].innerQuantified = true;
					i = q.end;
					continue;
				}
			}
			i++;
			continue;
		}

		if (ch === "|") {
			if (stack.length > 0) stack[stack.length - 1].hasAlternation = true;
			i++;
			continue;
		}

		// Plain atom (literal char, `.`, or a bare quantifier char) — bind any
		// following quantifier to it.
		const q = readQuantifier(i + 1);
		if (q !== null && stack.length > 0) stack[stack.length - 1].innerQuantified = true;
		i = q !== null ? q.end : i + 1;
	}

	return false;
}

/**
 * Compile the regex form of a code search. Throws InvalidCodeSearchRegexError
 * so the handler can surface a clean INVALID_REGEX envelope.
 *
 * ReDoS guard (TASK-344): the caller-supplied needle is compiled with
 * `new RegExp(needle, "i")` and run per line against indexed files WITHOUT a
 * timeout (V8 has no RegExp timeout) on the PROCESS-SHARED server. Two cheap
 * provenance checks run BEFORE `new RegExp`:
 *   1. Length cap — needles over CODE_SEARCH_MAX_REGEX_LENGTH chars are
 *      rejected outright.
 *   2. Nested unbounded quantifiers — `^(a+)+$` / `(a|aa)+` / `(a+)*b` are
 *      the canonical exponential-backtracking signatures.
 * Both rejections propagate as InvalidCodeSearchRegexError so the handler
 * surfaces the existing INVALID_REGEX envelope instead of hanging.
 */
export function compileCodeSearchRegex(needle: string): RegExp {
	if (needle.length > CODE_SEARCH_MAX_REGEX_LENGTH) {
		throw new InvalidCodeSearchRegexError(
			`pattern exceeds the ${CODE_SEARCH_MAX_REGEX_LENGTH}-character limit for code-search regexes`
		);
	}
	if (hasNestedUnboundedQuantifiers(needle)) {
		throw new InvalidCodeSearchRegexError(
			"pattern contains nested unbounded quantifiers (potential ReDoS) — use substring mode instead"
		);
	}
	try {
		// Case-insensitive by default — mirrors the substring matcher.
		return new RegExp(needle, "i");
	} catch (err) {
		throw new InvalidCodeSearchRegexError(err instanceof Error ? err.message : String(err));
	}
}

/**
 * Match a needle against file content line by line.
 *
 * `regex === null` ⇒ case-insensitive substring; otherwise a compiled regex
 * (case-insensitive). Lines are 1-based; CRLF is normalized.
 */
export function grepContent(content: string, needle: string, regex: RegExp | null): LineMatch[] {
	const lines = content.split(/\r?\n/);
	const matches: LineMatch[] = [];

	if (regex) {
		for (let i = 0; i < lines.length; i++) {
			const m = regex.exec(lines[i]); // no /g flag ⇒ stateless, no lastIndex drift
			if (m && m.index !== undefined) {
				matches.push({
					line: i + 1,
					matchIndex: m.index,
					snippet: buildSnippet(lines[i], m.index, m[0].length)
				});
			}
		}
		return matches;
	}

	const lowerNeedle = needle.toLowerCase();
	for (let i = 0; i < lines.length; i++) {
		const idx = lines[i].toLowerCase().indexOf(lowerNeedle);
		if (idx >= 0) {
			matches.push({
				line: i + 1,
				matchIndex: idx,
				snippet: buildSnippet(lines[i], idx, needle.length)
			});
		}
	}
	return matches;
}

/**
 * Build a ~CODE_SEARCH_SNIPPET_CHARS snippet centered on the match, with
 * ellipsis markers at clipped line boundaries.
 */
function buildSnippet(line: string, matchIndex: number, matchLength: number): string {
	const radius = Math.floor(CODE_SEARCH_SNIPPET_CHARS / 2);
	const start = Math.max(0, matchIndex - radius);
	const end = Math.min(line.length, matchIndex + matchLength + radius);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < line.length ? "…" : "";
	return prefix + line.slice(start, end) + suffix;
}
/**
 * Resolve the innermost enclosing symbol for a line: the symbol with the
 * smallest span whose [start_line, end_line] contains the line (ties break to
 * the earlier start). Pure function over a per-file preloaded span array.
 */
export function findEnclosingSymbol(symbols: CodebaseSymbol[], line: number): EnclosingSymbol | null {
	// Narrowed span is stored alongside the symbol — TS cannot retain the
	// start_line/end_line null-narrowing of an earlier loop iteration on a
	// re-assigned `best`, so we capture the narrowed numbers explicitly.
	let best: { symbol: CodebaseSymbol; startLine: number; endLine: number } | null = null;
	for (const s of symbols) {
		if (s.start_line === null || s.end_line === null) continue;
		if (s.start_line > line || line > s.end_line) continue;
		if (best === null) {
			best = { symbol: s, startLine: s.start_line, endLine: s.end_line };
			continue;
		}
		const span = s.end_line - s.start_line;
		const bestSpan = best.endLine - best.startLine;
		if (span < bestSpan || (span === bestSpan && s.start_line < best.startLine)) {
			best = { symbol: s, startLine: s.start_line, endLine: s.end_line };
		}
	}
	return best
		? { name: best.symbol.name, kind: best.symbol.kind, startLine: best.startLine, endLine: best.endLine }
		: null;
}
/**
 * Defense-in-depth: never read a file whose resolved path escapes repoPath
 * (index rows are trusted, but a corrupt/malicious row must not read outside
 * the repo root). Returns null when the path is not contained.
 */
function safeJoin(repoPath: string, filePath: string): string | null {
	const absolutePath = path.resolve(repoPath, filePath);
	const rel = path.relative(repoPath, absolutePath);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
	return absolutePath;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Grep the INDEXED files of a repo on disk (TASK-316 CODE mode).
 *
 * - Files are taken from codebase_files only (index scope; non-indexed and
 *   node_modules/.git files are excluded by construction).
 * - Content flows through the shared LRU cache; a language filter prunes the
 *   file set BEFORE any disk read.
 * - Matched lines are enriched with their innermost enclosing symbol span.
 * - Bounded concurrency (CODE_SEARCH_READ_CONCURRENCY), early exit once
 *   offset+limit matches are collected (big repos stop scanning once the page
 *   is filled; `hasMore` stays truthful).
 *
 * `repoPath` must be a validated directory (the handler checks existence).
 */
export async function searchCodeInRepo(
	db: SQLiteStore,
	repo: string,
	repoPath: string,
	options: CodeSearchOptions
): Promise<CodeSearchResult> {
	const { needle, regex = false, language, limit, offset } = options;

	// Empty query → no-op: empty result, never a full-file dump.
	if (needle.length === 0) {
		return { matches: [], total: 0, hasMore: false, filesScanned: 0, fileCount: 0, indexedFiles: 0 };
	}

	const compiledRegex = regex ? compileCodeSearchRegex(needle) : null;

	// Language filter prunes the set before any disk read, so fileCount
	// reflects the actual scan scope; indexedFiles stays filter-independent so
	// the handler can tell "repo not indexed" from "filter matched no files".
	const allFiles = db.codebaseFiles.getFilesByRepo(repo);
	const indexedFiles = allFiles.length;
	let files = allFiles;
	if (language) {
		const lang = language.toLowerCase();
		files = files.filter((f) => f.language !== null && f.language.toLowerCase() === lang);
	}
	const fileCount = files.length;

	const matches: CodeSearchMatch[] = [];
	let filesScanned = 0;
	const wanted = offset + limit;

	for (let i = 0; i < files.length; i += CODE_SEARCH_READ_CONCURRENCY) {
		const chunk = files.slice(i, i + CODE_SEARCH_READ_CONCURRENCY);
		const chunkResults = await Promise.all(
			chunk.map((f) => grepIndexedFile(db, repo, repoPath, f, needle, compiledRegex))
		);
		for (const fileMatches of chunkResults) {
			if (fileMatches === null) continue; // unreadable / traversal-guarded
			filesScanned++;
			if (fileMatches.length > 0) matches.push(...fileMatches);
		}
		// Early exit: the page (offset+limit) is filled — stop scanning. total
		// then counts matches up to the stop point; hasMore flags the rest.
		if (matches.length >= wanted) break;
	}

	const capped = matches.length >= wanted;
	return {
		matches: matches.slice(offset, offset + limit),
		total: matches.length,
		hasMore: capped || offset + limit < matches.length,
		filesScanned,
		fileCount,
		indexedFiles
	};
}

/**
 * Grep one indexed file: cache-read content, match lines, enrich with the
 * file's enclosing symbol spans. Returns null when the file could not be read
 * or its path escapes the repo root (skipped, not an error). Symbols are only
 * loaded for files that actually have matches (the "preload per file once"
 * option from TASK-316 — one cheap query per matched file).
 */
async function grepIndexedFile(
	db: SQLiteStore,
	repo: string,
	repoPath: string,
	file: CodebaseFile,
	needle: string,
	regex: RegExp | null
): Promise<CodeSearchMatch[] | null> {
	const absolutePath = safeJoin(repoPath, file.file_path);
	if (absolutePath === null) {
		logger.warn("[CodeSearch] Skipping indexed file outside repo root", { repo, filePath: file.file_path });
		return null;
	}

	let content: string;
	try {
		content = await codeSearchCache.getContent(repo, file.file_path, file.checksum ?? null, absolutePath);
	} catch (err) {
		logger.warn("[CodeSearch] Skipping unreadable indexed file", {
			repo,
			filePath: file.file_path,
			error: err instanceof Error ? err.message : String(err)
		});
		return null;
	}

	const lineMatches = grepContent(content, needle, regex);
	if (lineMatches.length === 0) return [];

	const symbols = db.codebaseSymbols.getSymbolsByFile(repo, file.file_path);
	return lineMatches.map((m) => ({
		filePath: file.file_path,
		language: file.language,
		line: m.line,
		snippet: m.snippet,
		matchIndex: m.matchIndex,
		enclosingSymbol: findEnclosingSymbol(symbols, m.line)
	}));
}

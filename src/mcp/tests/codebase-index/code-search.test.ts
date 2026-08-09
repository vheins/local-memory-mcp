/**
 * Code-search unit tests — CODE mode grep service (TASK-316).
 *
 * Covers: checksum-keyed cache invalidation (reload on row change, snapshot
 * serving while the row is unchanged), substring case-insensitive + regex +
 * invalid-regex, ReDoS guard (length cap + nested-unbounded-quantifier
 * rejection, TASK-344), language filter, result cap / pagination,
 * empty-query no-op, non-indexed-file exclusion (node_modules / untracked),
 * missing repo, innermost enclosing-symbol resolution, and the
 * path-traversal guard.
 *
 * Each test uses its own repo + unique relative paths so the shared in-memory
 * store never leaks rows across tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	searchCodeInRepo,
	grepContent,
	compileCodeSearchRegex,
	InvalidCodeSearchRegexError,
	findEnclosingSymbol,
	codeSearchCache,
	clearCodeSearchCache
} from "../../codebase-index/services/code-search";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import type { CodebaseSymbol } from "../../types";
import { computeChecksum } from "../../codebase-index/services/indexing-cache";
import { CODE_SEARCH_MAX_REGEX_LENGTH } from "../../utils/constants";

const REPO_ROOT = "code-search-test";

let repoRoot: string;
let store: SQLiteStore;
let seq = 0;

beforeAll(async () => {
	store = await createTestStore();
	repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${REPO_ROOT}-`));
});

afterAll(() => {
	store.close();
	fs.rmSync(repoRoot, { recursive: true, force: true });
});

beforeEach(() => {
	// Cache is process-shared; keys are repo-scoped and each test uses its own
	// repo, so clearing is belt-and-braces isolation.
	clearCodeSearchCache();
});

/** Fresh repo name per test — rows never leak across tests. */
function freshRepo(): string {
	seq += 1;
	return `${REPO_ROOT}-${seq}`;
}

/** Write a file under the shared repo root AND index it (codebase_files row). */
function writeIndexedFile(
	repo: string,
	filePath: string,
	content: string,
	language = "typescript",
	checksum?: string
): void {
	const abs = path.join(repoRoot, filePath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf-8");
	store.codebaseFiles.upsertFile({
		repo,
		file_path: filePath,
		language,
		checksum: checksum ?? computeChecksum(content),
		lines: content.split("\n").length,
		size_bytes: Buffer.byteLength(content, "utf-8")
	});
}

/** Seed a symbol row for enrichment assertions. */
function seedSymbol(
	repo: string,
	filePath: string,
	name: string,
	kind: string,
	startLine: number,
	endLine: number
): void {
	store.codebaseSymbols.bulkUpsertSymbols([
		{ repo, file_path: filePath, name, kind, start_line: startLine, end_line: endLine, exported: true }
	]);
}

function mkSymbol(name: string, kind: string, startLine: number | null, endLine: number | null): CodebaseSymbol {
	return {
		id: `id-${name}`,
		repo: "unit",
		file_path: "f.ts",
		name,
		kind,
		exported: true,
		default_export: false,
		start_line: startLine,
		start_col: null,
		end_line: endLine,
		end_col: null,
		signature: null,
		doc_comment: null,
		parent_symbol_id: null,
		created_at: "",
		updated_at: ""
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// GREP PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

describe("grepContent", () => {
	it("substring match is case-insensitive, reports line + match index + snippet", () => {
		const content = "Hello World\nfoo BAR baz\n";
		const matches = grepContent(content, "bar", null);
		expect(matches).toEqual([{ line: 2, matchIndex: 4, snippet: "foo BAR baz" }]);
	});

	it("reports only the FIRST substring match per line", () => {
		const matches = grepContent("bar bar bar\n", "bar", null);
		expect(matches).toEqual([{ line: 1, matchIndex: 0, snippet: "bar bar bar" }]);
	});

	it("matches regex case-insensitively", () => {
		const content = "const x = 42;\nconst y = 7;\n";
		const re = compileCodeSearchRegex("\\d+");
		expect(grepContent(content, "\\d+", re)).toEqual([
			{ line: 1, matchIndex: 10, snippet: "const x = 42;" },
			{ line: 2, matchIndex: 10, snippet: "const y = 7;" }
		]);
	});

	it("normalizes CRLF line endings", () => {
		const matches = grepContent("one\r\ntwo\r\n", "two", null);
		expect(matches).toEqual([{ line: 2, matchIndex: 0, snippet: "two" }]);
	});

	it("ellipsizes snippets on long lines", () => {
		const long = `aaaa${"x".repeat(60)}NEEDLE${"y".repeat(60)}zzzz`;
		const matches = grepContent(long, "NEEDLE", null);
		expect(matches).toHaveLength(1);
		const snippet = matches[0].snippet;
		// radius 40 each side + 6-char match + 2 ellipses
		expect(snippet.length).toBeLessThanOrEqual(80 + 6 + 2);
		expect(snippet.startsWith("…")).toBe(true);
		expect(snippet.endsWith("…")).toBe(true);
		expect(snippet).toContain("NEEDLE");
	});

	it("no matches → empty array", () => {
		expect(grepContent("abc\n", "zzz", null)).toEqual([]);
	});
});

describe("compileCodeSearchRegex", () => {
	it("throws InvalidCodeSearchRegexError for a bad pattern", () => {
		expect(() => compileCodeSearchRegex("[")).toThrow(InvalidCodeSearchRegexError);
		expect(() => compileCodeSearchRegex("(unclosed")).toThrow(InvalidCodeSearchRegexError);
	});

	// ── ReDoS guard (TASK-344) ───────────────────────────────────────────────
	// V8 has no RegExp timeout and the compiled regex runs per line against
	// indexed files (10-100KB minified lines) on the PROCESS-SHARED server, so
	// catastrophic patterns must be rejected BEFORE `new RegExp` — surfacing the
	// INVALID_REGEX envelope instead of stalling every agent session.

	it("rejects catastrophic (ReDoS) patterns with nested unbounded quantifiers", () => {
		const catastrophic = ["^(a+)+$", "(a|aa)+$", "(a+)*b", "(a*)*", "(a|a?)+", "((ab)+)+", "(.*a){100}"];
		for (const needle of catastrophic) {
			expect(() => compileCodeSearchRegex(needle), `should reject: ${needle}`).toThrow(InvalidCodeSearchRegexError);
		}
	});

	it("rejects over-length patterns beyond CODE_SEARCH_MAX_REGEX_LENGTH", () => {
		const overLength = "a".repeat(CODE_SEARCH_MAX_REGEX_LENGTH + 1);
		expect(() => compileCodeSearchRegex(overLength)).toThrow(InvalidCodeSearchRegexError);
	});

	it("compiles a pattern exactly at the CODE_SEARCH_MAX_REGEX_LENGTH boundary", () => {
		// Exactly at the cap: a long but simple pattern must still compile.
		const atLimit = `${"a".repeat(CODE_SEARCH_MAX_REGEX_LENGTH - 1)}b`;
		expect(compileCodeSearchRegex(atLimit)).toBeInstanceOf(RegExp);
	});

	it("still compiles benign patterns (substring mode unaffected)", () => {
		for (const needle of ["foo.*bar", "\\b\\d{2,4}\\b", "\\d+", "(ab)+", "(foo|bar)", "(?<=const )\\w+"]) {
			expect(() => compileCodeSearchRegex(needle), `should compile: ${needle}`).not.toThrow();
		}
		// Compiled output remains a working, case-insensitive regex.
		const re = compileCodeSearchRegex("foo.*bar");
		expect(re.test("FOO x BAR")).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("findEnclosingSymbol", () => {
	it("picks the innermost enclosing symbol (smallest span)", () => {
		const symbols = [
			mkSymbol("outer", "class", 1, 30),
			mkSymbol("middle", "function", 5, 25),
			mkSymbol("inner", "method", 10, 15)
		];
		expect(findEnclosingSymbol(symbols, 12)).toEqual({
			name: "inner",
			kind: "method",
			startLine: 10,
			endLine: 15
		});
		expect(findEnclosingSymbol(symbols, 3)).toEqual({
			name: "outer",
			kind: "class",
			startLine: 1,
			endLine: 30
		});
		expect(findEnclosingSymbol(symbols, 50)).toBeNull();
	});

	it("breaks a true tie by earlier start line", () => {
		// Real tie: identical span SIZE (10) and both enclose line 15, but
		// DIFFERENT start lines. 'a' comes first in iteration order; 'b' must
		// still win on the earlier start — proving the tie-break, not just
		// first-in-order precedence.
		const symbols = [mkSymbol("a", "function", 12, 22), mkSymbol("b", "function", 10, 20)];
		const result = findEnclosingSymbol(symbols, 15);
		expect(result).toEqual({ name: "b", kind: "function", startLine: 10, endLine: 20 });
	});

	it("identical span and start lines keep the first symbol in order", () => {
		// Full tie (identical span AND identical start) cannot be broken by
		// the documented rule, so the implementation keeps the first symbol in
		// iteration order deterministically.
		const symbols = [mkSymbol("b", "function", 10, 20), mkSymbol("a", "function", 10, 20)];
		const result = findEnclosingSymbol(symbols, 15);
		expect(result?.name).toBe("b");
	});

	it("ignores symbols without spans", () => {
		const symbols = [mkSymbol("noSpan", "function", null, null), mkSymbol("real", "function", 1, 5)];
		expect(findEnclosingSymbol(symbols, 2)).toEqual({ name: "real", kind: "function", startLine: 1, endLine: 5 });
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — searchCodeInRepo
// ═══════════════════════════════════════════════════════════════════════════

describe("searchCodeInRepo", () => {
	it("greps indexed files and enriches matches with the enclosing symbol", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/greet.ts`;
		writeIndexedFile(
			repo,
			filePath,
			[
				"export function greet(name: string): string {",
				"\treturn `Hi ${name}`;",
				"}",
				"",
				"export class Greeter {",
				"\tgreet(): string {",
				"\t\treturn greet('x');",
				"\t}",
				"}"
			].join("\n") + "\n"
		);
		seedSymbol(repo, filePath, "greet", "function", 1, 3);
		seedSymbol(repo, filePath, "Greeter", "class", 5, 9);

		const result = await searchCodeInRepo(store, repo, repoRoot, { needle: "greet", limit: 10, offset: 0 });

		expect(result.indexedFiles).toBe(1);
		expect(result.fileCount).toBe(1);
		expect(result.filesScanned).toBe(1);
		expect(result.matches.map((m) => m.line)).toEqual([1, 5, 6, 7]);
		expect(result.matches[0].enclosingSymbol).toEqual({
			name: "greet",
			kind: "function",
			startLine: 1,
			endLine: 3
		});
		// Lines 5 (class name) / 6 (method) / 7 (call) are inside the class.
		for (const m of result.matches.slice(1)) {
			expect(m.enclosingSymbol).toEqual({ name: "Greeter", kind: "class", startLine: 5, endLine: 9 });
		}
		for (const m of result.matches) {
			expect(m.filePath).toBe(filePath);
			expect(m.language).toBe("typescript");
			// Substring mode is case-insensitive: line 5 'export class Greeter {'
			// matches "greet" via 'Greeter', so the containment check must be too.
			expect(m.snippet.toLowerCase()).toContain("greet");
			expect(m.matchIndex).toBeGreaterThanOrEqual(0);
		}
		expect(result.total).toBe(4);
		expect(result.hasMore).toBe(false);
	});

	it("language filter restricts the scan before any disk read", async () => {
		const repo = freshRepo();
		writeIndexedFile(repo, `${repo}/lang.ts`, "const marker = 1;\n", "typescript");
		writeIndexedFile(repo, `${repo}/lang.md`, "# marker\n", "markdown");

		const ts = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "marker",
			language: "typescript",
			limit: 10,
			offset: 0
		});
		expect(ts.fileCount).toBe(1);
		expect(ts.matches.map((m) => m.filePath)).toEqual([`${repo}/lang.ts`]);

		const md = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "marker",
			language: "markdown",
			limit: 10,
			offset: 0
		});
		expect(md.matches.map((m) => m.filePath)).toEqual([`${repo}/lang.md`]);

		// Language matching is case-insensitive.
		const upper = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "marker",
			language: "TypeScript",
			limit: 10,
			offset: 0
		});
		expect(upper.fileCount).toBe(1);

		// No indexed files of that language → fileCount 0, empty result.
		const none = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "marker",
			language: "rust",
			limit: 10,
			offset: 0
		});
		expect(none.fileCount).toBe(0);
		expect(none.matches).toEqual([]);
	});

	it("caps results at limit and honors offset pagination without overlap", async () => {
		const repo = freshRepo();
		writeIndexedFile(
			repo,
			`${repo}/cap.ts`,
			Array.from({ length: 10 }, (_, i) => `line ${i + 1} has needle here`).join("\n") + "\n"
		);

		const page1 = await searchCodeInRepo(store, repo, repoRoot, { needle: "needle", limit: 4, offset: 0 });
		expect(page1.matches).toHaveLength(4);
		expect(page1.total).toBeGreaterThanOrEqual(4);
		expect(page1.hasMore).toBe(true);

		const page2 = await searchCodeInRepo(store, repo, repoRoot, { needle: "needle", limit: 4, offset: 4 });
		expect(page2.matches).toHaveLength(4);

		const page1Lines = new Set(page1.matches.map((m) => m.line));
		for (const m of page2.matches) {
			expect(page1Lines.has(m.line)).toBe(false);
		}
	});

	it("empty needle is a no-op — never a full-file dump", async () => {
		const repo = freshRepo();
		writeIndexedFile(repo, `${repo}/empty.ts`, "any content at all\n");

		const result = await searchCodeInRepo(store, repo, repoRoot, { needle: "", limit: 10, offset: 0 });
		expect(result.matches).toEqual([]);
		expect(result.total).toBe(0);
		expect(result.filesScanned).toBe(0);
	});

	it("only greps indexed files — node_modules / untracked files on disk are excluded", async () => {
		const repo = freshRepo();
		// On disk but NOT in codebase_files:
		fs.mkdirSync(path.join(repoRoot, "node_modules", "pkg"), { recursive: true });
		fs.writeFileSync(path.join(repoRoot, "node_modules", "pkg", "lib.js"), "SECRET_TOKEN_LEAK\n", "utf-8");
		fs.writeFileSync(path.join(repoRoot, "untracked.ts"), "SECRET_TOKEN_LEAK\n", "utf-8");

		writeIndexedFile(repo, `${repo}/tracked.ts`, "SECRET_TOKEN_LEAK\n");

		const result = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "SECRET_TOKEN_LEAK",
			limit: 10,
			offset: 0
		});
		expect(result.indexedFiles).toBe(1);
		expect(result.matches.map((m) => m.filePath)).toEqual([`${repo}/tracked.ts`]);
	});

	it("returns an empty result for a repo with no indexed files", async () => {
		const result = await searchCodeInRepo(store, freshRepo(), repoRoot, { needle: "x", limit: 10, offset: 0 });
		expect(result.indexedFiles).toBe(0);
		expect(result.fileCount).toBe(0);
		expect(result.matches).toEqual([]);
	});

	it("skips indexed rows whose file_path escapes the repo root (traversal guard)", async () => {
		const repo = freshRepo();
		// The row points OUTSIDE the repo root; the escape target contains the
		// needle — if the guard failed, the search would surface a match.
		const escapeName = `escape-${repo}.ts`;
		const sibling = path.join(repoRoot, "..", escapeName);
		fs.writeFileSync(sibling, "escape needle\n", "utf-8");
		store.codebaseFiles.upsertFile({
			repo,
			file_path: `../${escapeName}`,
			language: "typescript",
			checksum: "x"
		});
		try {
			const result = await searchCodeInRepo(store, repo, repoRoot, { needle: "escape", limit: 10, offset: 0 });
			expect(result.matches).toEqual([]);
			expect(result.filesScanned).toBe(0);
		} finally {
			fs.rmSync(sibling, { force: true });
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// CACHE — checksum-keyed validity
// ═══════════════════════════════════════════════════════════════════════════

describe("codeSearchCache", () => {
	it("serves cached content while the row checksum is unchanged (index = source of truth)", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/cache-a.ts`;
		writeIndexedFile(repo, filePath, "alpha one\nalpha two\n", "typescript", "sum-v1");

		const first = await searchCodeInRepo(store, repo, repoRoot, { needle: "alpha", limit: 10, offset: 0 });
		expect(first.total).toBe(2);
		expect(codeSearchCache.size).toBe(1);

		// Disk edited WITHOUT a re-index → row checksum unchanged → the cached
		// indexed snapshot is served (content always matches the symbol index).
		fs.writeFileSync(path.join(repoRoot, filePath), "beta one\n", "utf-8");
		const snapshot = await searchCodeInRepo(store, repo, repoRoot, { needle: "alpha", limit: 10, offset: 0 });
		expect(snapshot.total).toBe(2);
	});

	it("invalidates and reloads when the row checksum changes (re-index)", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/cache-b.ts`;
		writeIndexedFile(repo, filePath, "alpha one\n", "typescript", "sum-v1");

		let result = await searchCodeInRepo(store, repo, repoRoot, { needle: "alpha", limit: 10, offset: 0 });
		expect(result.total).toBe(1);

		// Simulate re-index of the changed file: new disk content + row upsert
		// with a new checksum (the real writeParseBatch path).
		fs.writeFileSync(path.join(repoRoot, filePath), "beta one\n", "utf-8");
		store.codebaseFiles.upsertFile({
			repo,
			file_path: filePath,
			language: "typescript",
			checksum: "sum-v2",
			lines: 1,
			size_bytes: Buffer.byteLength("beta one\n", "utf-8")
		});

		result = await searchCodeInRepo(store, repo, repoRoot, { needle: "beta", limit: 10, offset: 0 });
		expect(result.total).toBe(1);
		expect(result.matches[0].line).toBe(1);

		result = await searchCodeInRepo(store, repo, repoRoot, { needle: "alpha", limit: 10, offset: 0 });
		expect(result.total).toBe(0);
	});

	it("keeps distinct cache entries per repo (shared cache, no cross-talk)", async () => {
		const repoA = freshRepo();
		const repoB = freshRepo();
		writeIndexedFile(repoA, `${repoA}/same.ts`, "AAA_CONTENT\n", "typescript", "a1");
		writeIndexedFile(repoB, `${repoB}/same.ts`, "BBB_CONTENT\n", "typescript", "b1");

		const a = await searchCodeInRepo(store, repoA, repoRoot, { needle: "AAA_CONTENT", limit: 10, offset: 0 });
		expect(a.total).toBe(1);

		const b = await searchCodeInRepo(store, repoB, repoRoot, { needle: "BBB_CONTENT", limit: 10, offset: 0 });
		expect(b.total).toBe(1);
		expect(codeSearchCache.size).toBe(2);
	});

	// ── Concurrent access (TASK-343 regression) ─────────────────────────────
	// All prior cache tests run sequentially, so totalBytes accounting could
	// only ever be exercised by one caller per key at a time. These tests fire
	// N simultaneous getContent calls for the SAME key: every caller shares the
	// single-flight read and must NOT re-account the entry on the way back.

	it("concurrent miss: N simultaneous getContent calls account the entry exactly once", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/concurrent-miss.ts`;
		const content = "alpha one\nalpha two\n";
		const absolutePath = path.join(repoRoot, filePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, content, "utf-8");

		const results = await Promise.all(
			Array.from({ length: 8 }, () => codeSearchCache.getContent(repo, filePath, "sum-v1", absolutePath))
		);

		expect(results).toEqual(Array(8).fill(content));
		expect(codeSearchCache.size).toBe(1);
		// Pre-fix: every caller ran the insert path → totalBytes inflated 8×.
		expect(codeSearchCache.bytes).toBe(Buffer.byteLength(content, "utf-8"));
	});

	it("concurrent stale reload: checksum change while reads are in flight re-accounts exactly once", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/concurrent-stale.ts`;
		const oldContent = "old content, short\n";
		const newContent = "new content, significantly longer so the byte delta is nonzero\n";
		const absolutePath = path.join(repoRoot, filePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, oldContent, "utf-8");

		// Populate the cache under checksum v1 (stale entry).
		await codeSearchCache.getContent(repo, filePath, "sum-v1", absolutePath);
		expect(codeSearchCache.bytes).toBe(Buffer.byteLength(oldContent, "utf-8"));

		// Simulate re-index: disk content grows AND the row checksum changes.
		fs.writeFileSync(absolutePath, newContent, "utf-8");

		const results = await Promise.all(
			Array.from({ length: 8 }, () => codeSearchCache.getContent(repo, filePath, "sum-v2", absolutePath))
		);

		expect(results).toEqual(Array(8).fill(newContent));
		expect(codeSearchCache.size).toBe(1);
		// Pre-fix: every caller subtracted the stale snapshot → totalBytes
		// under-counted (8×new − 7×old). Must reflect exactly the one entry.
		expect(codeSearchCache.bytes).toBe(Buffer.byteLength(newContent, "utf-8"));
	});
});

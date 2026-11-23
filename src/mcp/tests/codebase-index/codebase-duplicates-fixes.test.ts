import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import { setupIntegrationFixture } from "./mcp-tools.integration.shared.js";
import { analyzeDuplicates, clearDuplicatesCaches } from "../../codebase-index/services/duplicates.js";
import { renderDuplicatesText } from "../../tools/codebase-read/duplicates.js";
import { BODY, FixtureFile, makeIndexer, makeRunDuplicates } from "./codebase-duplicates.helpers.js";
import type { DuplicateCandidateRow } from "../../types.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";

let store: SQLiteStore;
let vectors: VectorStore;
let tempDir: string;
let indexFixture: ReturnType<typeof makeIndexer>;
let runDuplicates: ReturnType<typeof makeRunDuplicates>;

beforeAll(async () => {
	const fixture = await setupIntegrationFixture();
	store = fixture.store;
	vectors = fixture.vectors;
	tempDir = fixture.tempDir;
	indexFixture = makeIndexer(store, tempDir);
	runDuplicates = makeRunDuplicates(store, vectors, tempDir);
});

afterAll(() => {
	store.close();
	fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
	clearDuplicatesCaches();
});

// ── FIX-020: declaration shapes the indexer records as function/method ──

describe("handleCodebaseRead (duplicates mode) parameter-list shapes", () => {
	/** One-line arrows and short methods: min_lines 1 keeps them in scope. */
	const SINGLE_LINE = { min_lines: 1 };

	it("groups expression-bodied arrows whose body holds a top-level call", async () => {
		const repo = "dups-arrow-expr";
		const file = new FixtureFile();
		const one = file.add(["const mapAll = (items) => items.map(x => x * 2);"]);
		file.gap();
		const two = file.add(["const mapAll2 = (items, factor) => items.map(x => x * 2);"]);
		indexFixture(repo, "src/arrows.ts", file, [
			{ file: "src/arrows.ts", name: "mapAll", kind: "function", span: one },
			{ file: "src/arrows.ts", name: "mapAll2", kind: "function", span: two }
		]);

		const { d } = await runDuplicates(repo, SINGLE_LINE);
		const groups = d.groups as Array<Record<string, unknown>>;
		expect(groups).toHaveLength(1);
		expect(groups[0].class).toBe("exact");

		const diff = groups[0].params_diff as { param_sets: string[][] };
		// The declared parameters, never the `.map(x => …)` call argument.
		expect(diff.param_sets).toEqual([["items"], ["items", "factor"]]);
		const hint = groups[0].merge_hint as string;
		expect(hint).toContain("items");
		expect(hint).toContain("factor");
		expect(hint).not.toContain("params x");
		expect(hint).toContain("optional params (factor optional)");
	});

	it("groups type-annotated arrow declarators", async () => {
		const repo = "dups-arrow-typed";
		const file = new FixtureFile();
		const one = file.add(["const h1: Handler = (a) => a + 1;"]);
		file.gap();
		const two = file.add(["const h2: Handler = (a, b) => a + 1;"]);
		indexFixture(repo, "src/typed.ts", file, [
			{ file: "src/typed.ts", name: "h1", kind: "function", span: one },
			{ file: "src/typed.ts", name: "h2", kind: "function", span: two }
		]);

		const { d } = await runDuplicates(repo, SINGLE_LINE);
		const groups = d.groups as Array<Record<string, unknown>>;
		expect(groups).toHaveLength(1);
		expect(groups[0].class).toBe("exact");
		expect((groups[0].params_diff as { param_sets: string[][] }).param_sets).toEqual([["a"], ["a", "b"]]);
	});

	it("groups generic methods constrained to an object type", async () => {
		const repo = "dups-generic-object";
		const file = new FixtureFile();
		const one = file.add(["method<T extends { a: number }>(x: T): T {", "\tconst copy = x;", "\treturn copy;", "}"]);
		file.gap();
		const two = file.add([
			"method2<T extends { a: number }>(x: T, y: T): T {",
			"\tconst copy = x;",
			"\treturn copy;",
			"}"
		]);
		indexFixture(repo, "src/generic.ts", file, [
			{ file: "src/generic.ts", name: "method", kind: "method", span: one },
			{ file: "src/generic.ts", name: "method2", kind: "method", span: two }
		]);

		const { d } = await runDuplicates(repo, SINGLE_LINE);
		const groups = d.groups as Array<Record<string, unknown>>;
		expect(groups).toHaveLength(1);
		expect(groups[0].class).toBe("exact");
		expect((groups[0].params_diff as { param_sets: string[][] }).param_sets).toEqual([["x"], ["x", "y"]]);
	});

	it("keeps brace-bodied declarations on their declared parameters", async () => {
		const repo = "dups-brace-body";
		const file = new FixtureFile();
		const one = file.add([
			"export function scan(items: number[]) {",
			"\treturn items.map(x => x * 2);",
			"}",
			"",
			"// trailing comment keeps the span above min_lines"
		]);
		file.gap();
		const two = file.add([
			"export function scanAll(items: number[], factor: number) {",
			"\treturn items.map(x => x * 2);",
			"}",
			"",
			"// trailing comment keeps the span above min_lines"
		]);
		indexFixture(repo, "src/brace.ts", file, [
			{ file: "src/brace.ts", name: "scan", kind: "function", span: one },
			{ file: "src/brace.ts", name: "scanAll", kind: "function", span: two }
		]);

		const { d } = await runDuplicates(repo);
		const groups = d.groups as Array<Record<string, unknown>>;
		expect(groups).toHaveLength(1);
		// The `.map(x => …)` call inside the body is not the parameter list.
		expect((groups[0].params_diff as { param_sets: string[][] }).param_sets).toEqual([["items"], ["items", "factor"]]);
	});

	it("still separates bodies that differ structurally", async () => {
		const repo = "dups-different-body";
		const file = new FixtureFile();
		const one = file.add(BODY("accumulate", "items: number[]", "+="));
		file.gap();
		const two = file.add(BODY("accumulateAll", "items: number[]", "-="));
		indexFixture(repo, "src/diff.ts", file, [
			{ file: "src/diff.ts", name: "accumulate", kind: "function", span: one },
			{ file: "src/diff.ts", name: "accumulateAll", kind: "function", span: two }
		]);

		const { d } = await runDuplicates(repo);
		expect(d.groups).toEqual([]);
	});
});

// ── FIX-021: near-pass coverage honesty ─────────────────────────────────

describe("duplicates near-pass coverage reporting", () => {
	/**
	 * One bucket of `count` symbols (same kind, language and line count) whose
	 * bodies share a long prefix, so every prefix shingle's document frequency
	 * equals `count` and exceeds DUPLICATES_POSTING_CAP (200).
	 */
	async function analyzeCrowdedBucket(count: number) {
		const lines: string[] = [];
		const symbols: DuplicateCandidateRow[] = [];
		for (let i = 0; i < count; i++) {
			const start = lines.length + 1;
			lines.push(
				`function f${i}(a) {`,
				"\tlet total = 0;",
				"\tfor (const item of items) {",
				`\t\ttotal += item${" + 1".repeat(i)};`,
				"\t}",
				"\treturn total;",
				"}"
			);
			symbols.push({
				id: `crowd-${i}`,
				name: `f${i}`,
				kind: "function",
				file_path: "src/crowd.ts",
				signature: null,
				start_line: start,
				end_line: lines.length,
				source_fingerprint: `fp-crowd-${i}`
			});
		}
		const content = lines.join("\n");
		return analyzeDuplicates({
			repo: "dups-crowd",
			repoRoot: "/fixture/crowd",
			symbols,
			languageByFile: () => "typescript",
			readFile: async () => content,
			minSimilarity: 0.9,
			minLines: 1,
			limit: 20
		});
	}

	it("reports skipped postings and partial near coverage when the posting cap drops candidates", async () => {
		const result = await analyzeCrowdedBucket(205);

		expect(result.summary.postings_skipped).toBeGreaterThan(0);
		expect(result.summary.near_coverage).toBe("partial");
		// The pair cap was never hit — the gap is purely the posting cap.
		expect(result.summary.pairs_truncated).toBe(false);

		const text = renderDuplicatesText(result, {
			repo: "dups-crowd",
			kinds: ["function"],
			minSimilarity: 0.9,
			minLines: 1,
			limit: 20
		});
		expect(text).toContain("Near coverage is partial");
		expect(text).toContain("selectivity cap");
	});

	it("reports full coverage when every posting is selective", async () => {
		const lines = [
			"function first(items: number[]) {",
			"\tlet total = 0;",
			"\tfor (const item of items) {",
			"\t\ttotal += item;",
			"\t}",
			"\treturn total;",
			"}",
			"function second(items: number[]) {",
			"\tlet total = 0;",
			"\tfor (const item of items) {",
			"\t\ttotal += item;",
			"\t}",
			"\treturn total;",
			"}"
		];
		const symbols: DuplicateCandidateRow[] = [
			{
				id: "sel-1",
				name: "first",
				kind: "function",
				file_path: "src/sel.ts",
				signature: null,
				start_line: 1,
				end_line: 7,
				source_fingerprint: "fp-sel-1"
			},
			{
				id: "sel-2",
				name: "second",
				kind: "function",
				file_path: "src/sel.ts",
				signature: null,
				start_line: 8,
				end_line: 14,
				source_fingerprint: "fp-sel-2"
			}
		];

		const result = await analyzeDuplicates({
			repo: "dups-selective",
			repoRoot: "/fixture/selective",
			symbols,
			languageByFile: () => "typescript",
			readFile: async () => lines.join("\n"),
			minSimilarity: 0.9,
			minLines: 1,
			limit: 20
		});

		expect(result.summary.postings_skipped).toBe(0);
		expect(result.summary.near_coverage).toBe("full");
		const text = renderDuplicatesText(result, {
			repo: "dups-selective",
			kinds: ["function"],
			minSimilarity: 0.9,
			minLines: 1,
			limit: 20
		});
		expect(text).not.toContain("Near coverage is partial");
	});
});

// ── FIX-022: analysis cache identity ────────────────────────────────────

describe("duplicates analysis cache identity", () => {
	/** Build one file from two symbol bodies and the matching candidate rows. */
	function fixture(bodies: string[][]) {
		const lines: string[] = [];
		const rows: DuplicateCandidateRow[] = bodies.map((body, index) => {
			const start = lines.length + 1;
			lines.push(...body);
			return {
				id: `root-${index + 1}`,
				name: index === 0 ? "first" : "second",
				kind: "function",
				file_path: "src/x.ts",
				signature: null,
				start_line: start,
				end_line: lines.length,
				source_fingerprint: `fp-root-${index + 1}`
			};
		});
		return { content: lines.join("\n"), rows };
	}

	const ACCUMULATE = [
		"function first(items: number[]) {",
		"\tlet total = 0;",
		"\tfor (const item of items) {",
		"\t\ttotal += item;",
		"\t}",
		"\treturn total;",
		"}"
	];
	const UNRELATED = [
		"function second(words: string[]) {",
		"\tconst parts: string[] = [];",
		"\twhile (words.length > 0) {",
		"\t\tparts.push(words.pop() as string);",
		"\t}",
		'\treturn parts.join(",");',
		"}"
	];

	it("does not serve one repo root's cached result for another root", async () => {
		// Root A: both symbols share a body → one exact group.
		const same = fixture([ACCUMULATE, ACCUMULATE]);
		// Root B: same repo name, same indexed rows, different file content.
		const different = fixture([ACCUMULATE, UNRELATED]);
		const base = {
			repo: "dups-roots",
			symbols: same.rows,
			languageByFile: () => "typescript",
			minSimilarity: 0.9,
			minLines: 1,
			limit: 20
		};

		const rootA = await analyzeDuplicates({ ...base, repoRoot: "/roots/a", readFile: async () => same.content });
		expect(rootA.summary.cache_hit).toBe(false);
		expect(rootA.groups).toHaveLength(1);
		expect(rootA.groups[0].class).toBe("exact");

		const rootB = await analyzeDuplicates({
			...base,
			repoRoot: "/roots/b",
			readFile: async () => different.content
		});
		expect(rootB.summary.cache_hit).toBe(false);
		expect(rootB.groups).toHaveLength(0);

		// The first root's entry is still reusable.
		const rootAAgain = await analyzeDuplicates({
			...base,
			repoRoot: "/roots/a",
			readFile: async () => same.content
		});
		expect(rootAAgain.summary.cache_hit).toBe(true);
		expect(rootAAgain.groups).toHaveLength(1);
	});

	it("never reuses a cached analysis when a candidate has no source_fingerprint", async () => {
		const same = fixture([ACCUMULATE, ACCUMULATE]);
		const rows: DuplicateCandidateRow[] = [{ ...same.rows[0], source_fingerprint: null }, same.rows[1]];
		const options = {
			repo: "dups-null-fingerprint",
			repoRoot: "/roots/null",
			symbols: rows,
			languageByFile: () => "typescript",
			readFile: async () => same.content,
			minSimilarity: 0.9,
			minLines: 1,
			limit: 20
		};

		const first = await analyzeDuplicates(options);
		const second = await analyzeDuplicates(options);
		expect(first.summary.cache_hit).toBe(false);
		expect(second.summary.cache_hit).toBe(false);
		expect(second.groups).toEqual(first.groups);
	});
});

// ── FIX-023: declaration names that collide with keywords ───────────────

describe("handleCodebaseRead (duplicates mode) keyword-named declarations", () => {
	it("groups keyword-named functions whose bodies match, reporting real names", async () => {
		const repo = "dups-keyword-name";
		const file = new FixtureFile();
		const one = file.add(["function double(a) {", "\treturn a + 1;", "}"]);
		file.gap();
		const two = file.add(["function doubleAll(a) {", "\treturn a + 1;", "}"]);
		indexFixture(repo, "src/names.ts", file, [
			{ file: "src/names.ts", name: "double", kind: "function", span: one },
			{ file: "src/names.ts", name: "doubleAll", kind: "function", span: two }
		]);

		const { resp, d } = await runDuplicates(repo, { min_lines: 1 });
		expect(resp.isError).toBeFalsy();
		const groups = d.groups as Array<Record<string, unknown>>;
		expect(groups).toHaveLength(1);
		expect(groups[0].class).toBe("exact");
		// Only the comparison key is canonicalized; the report keeps the names.
		expect((groups[0].symbols as Array<{ name: string }>).map((symbol) => symbol.name)).toEqual([
			"double",
			"doubleAll"
		]);
	});
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { CodebaseReadSchema } from "../../tools/schemas/codebase-read.js";
import { data, setupIntegrationFixture } from "./mcp-tools.integration.shared.js";
import { clearDuplicatesCaches, analyzeDuplicates } from "../../codebase-index/services/duplicates.js";
import { renderDuplicatesText } from "../../tools/codebase-read/duplicates.js";
import type { DuplicateCandidateRow } from "../../types.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";

let store: SQLiteStore;
let vectors: VectorStore;
let tempDir: string;

beforeAll(async () => {
	const fixture = await setupIntegrationFixture();
	store = fixture.store;
	vectors = fixture.vectors;
	tempDir = fixture.tempDir;
});

afterAll(() => {
	store.close();
	fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
	clearDuplicatesCaches();
});

// ── Fixture helpers ─────────────────────────────────────────────────────

interface Span {
	start: number;
	end: number;
}

/** Accumulate a file's lines while recording each symbol's exact line span. */
class FixtureFile {
	readonly lines: string[] = [];

	/** Append a symbol body and return its 1-based inclusive span. */
	add(body: string[]): Span {
		const start = this.lines.length + 1;
		this.lines.push(...body);
		return { start, end: this.lines.length };
	}

	/** Append a blank separator line. */
	gap(): void {
		this.lines.push("");
	}

	toString(): string {
		return this.lines.join("\n") + "\n";
	}
}

interface FixtureSymbolSpec {
	file: string;
	name: string;
	kind: string;
	span: Span;
	signature?: string;
}

/** Write a fixture file under tempDir and index it plus its symbols. */
function indexFixture(repo: string, filePath: string, file: FixtureFile, symbols: FixtureSymbolSpec[]): void {
	const absolute = path.join(tempDir, filePath);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	const content = file.toString();
	fs.writeFileSync(absolute, content, "utf-8");
	store.codebaseFiles.upsertFile({
		repo,
		file_path: filePath,
		language: "typescript",
		checksum: `${repo}:${filePath}:sum`,
		lines: content.split("\n").length,
		size_bytes: Buffer.byteLength(content, "utf-8")
	});
	store.codebaseSymbols.bulkUpsertSymbols(
		symbols.map((symbol) => ({
			repo,
			file_path: symbol.file,
			name: symbol.name,
			kind: symbol.kind,
			exported: true,
			start_line: symbol.span.start,
			end_line: symbol.span.end,
			signature: symbol.signature ?? null,
			source_fingerprint: `${repo}:${symbol.file}:${symbol.name}:${symbol.span.start}`
		}))
	);
}

const BODY = (name: string, params: string, multiply: string): string[] => [
	`export function ${name}(${params}): number {`,
	"\tlet total = 0;",
	"\tfor (const item of items) {",
	`\t\ttotal ${multiply} item * 2;`,
	"\t}",
	"\treturn total;",
	"}"
];

/** Run DUPLICATES through the real dispatcher (mode inference included). */
async function runDuplicates(repo: string, extra: Record<string, unknown> = {}) {
	const resp = await handleCodebaseRead(
		{ owner: "vheins", json: true, repo, repoPath: tempDir, action: "duplicates", ...extra },
		store,
		vectors
	);
	return { resp, d: data(resp) };
}

// ── Handler integration tests ───────────────────────────────────────────

describe("handleCodebaseRead (duplicates mode)", () => {
	it("reports exact duplicates across files, params blanked, merge hint names the diff", async () => {
		const repo = "dups-exact";
		const file = new FixtureFile();
		const alpha = file.add(BODY("alpha", "items: number[]", "+="));
		file.gap();
		const beta = file.add(BODY("beta", "items: number[]", "+="));
		file.gap();
		const gamma = file.add(BODY("gamma", "items: number[], extra = 0", "+="));
		indexFixture(repo, "src/math.ts", file, [
			{
				file: "src/math.ts",
				name: "alpha",
				kind: "function",
				span: alpha,
				signature: "function alpha(items: number[]): number"
			},
			{
				file: "src/math.ts",
				name: "beta",
				kind: "function",
				span: beta,
				signature: "function beta(items: number[]): number"
			},
			{
				file: "src/math.ts",
				name: "gamma",
				kind: "function",
				span: gamma,
				signature: "function gamma(items: number[], extra = 0): number"
			}
		]);

		const { resp, d } = await runDuplicates(repo);
		expect(resp.isError).toBeFalsy();
		expect(d.mode).toBe("duplicates");
		expect(d.repo).toBe(repo);

		const groups = d.groups as Array<Record<string, unknown>>;
		expect(groups).toHaveLength(1);
		expect(groups[0].class).toBe("exact");
		expect(groups[0].similarity).toBe(1);
		expect((groups[0].symbols as unknown[]).length).toBe(3);

		const diff = groups[0].params_diff as { param_sets: string[][]; common: string[]; unique: string[] };
		// param_sets aligns with symbols[] (sorted by file, start line).
		expect(diff.param_sets).toEqual([["items"], ["items"], ["items", "extra"]]);
		expect(diff.common).toEqual(["items"]);
		expect(diff.unique).toEqual(["extra"]);
		expect(groups[0].merge_hint).toContain("optional params (extra optional)");

		const summary = d.summary as Record<string, unknown>;
		expect(summary.exact_groups).toBe(1);
		expect(summary.near_groups).toBe(0);
		expect(summary.symbols_compared).toBe(3);
	});

	it("reports near duplicates only when min_similarity allows, with a near merge hint", async () => {
		const repo = "dups-near";
		const file = new FixtureFile();
		const left = file.add(BODY("accumulate", "items: number[]", "+="));
		file.gap();
		const right = file.add(BODY("subtractAll", "items: number[]", "-="));
		file.gap();
		const other = file.add([
			"export function tally(words: string[]): number {",
			"\tlet count = 0;",
			"\tfor (const word of words) {",
			"\t\tif (word.length > 3) {",
			"\t\t\tcount += word.length;",
			"\t\t}",
			"\t}",
			"\treturn count;",
			"}"
		]);
		indexFixture(repo, "src/near.ts", file, [
			{ file: "src/near.ts", name: "accumulate", kind: "function", span: left },
			{ file: "src/near.ts", name: "subtractAll", kind: "function", span: right },
			{ file: "src/near.ts", name: "tally", kind: "function", span: other }
		]);

		// Default 0.9: a single operator change is below the threshold.
		const strict = await runDuplicates(repo);
		expect((strict.d.groups as unknown[]).length).toBe(0);

		const loose = await runDuplicates(repo, { min_similarity: 0.8 });
		const groups = loose.d.groups as Array<Record<string, unknown>>;
		expect(groups).toHaveLength(1);
		expect(groups[0].class).toBe("near");
		expect(groups[0].similarity as number).toBeGreaterThanOrEqual(0.8);
		expect(groups[0].similarity as number).toBeLessThan(1);
		expect(groups[0].merge_hint as string).toContain("near-identical body");
	});

	it("compares only the default callable kinds unless kind is requested", async () => {
		const repo = "dups-kinds";
		const file = new FixtureFile();
		const widget = file.add([
			"export class Widget {",
			"\tvalue = 1;",
			"\treset(): void {",
			"\t\tthis.value = 0;",
			"\t}",
			"}"
		]);
		file.gap();
		const gadget = file.add([
			"export class Gadget {",
			"\tvalue = 1;",
			"\treset(): void {",
			"\t\tthis.value = 0;",
			"\t}",
			"}"
		]);
		indexFixture(repo, "src/classes.ts", file, [
			{ file: "src/classes.ts", name: "Widget", kind: "class", span: widget },
			{ file: "src/classes.ts", name: "Gadget", kind: "class", span: gadget }
		]);

		const byDefault = await runDuplicates(repo);
		expect((byDefault.d.groups as unknown[]).length).toBe(0);
		expect((byDefault.d.summary as Record<string, unknown>).symbols_scanned).toBe(0);

		const classes = await runDuplicates(repo, { kind: "class" });
		const groups = classes.d.groups as Array<Record<string, unknown>>;
		expect(groups).toHaveLength(1);
		expect(groups[0].kind).toBe("class");
	});

	it("filters symbols below min_lines by default", async () => {
		const repo = "dups-minlines";
		const file = new FixtureFile();
		const first = file.add(["export function one(x: number) {", "\treturn x + 1;", "}"]);
		file.gap();
		const second = file.add(["export function two(x: number) {", "\treturn x + 1;", "}"]);
		indexFixture(repo, "src/tiny.ts", file, [
			{ file: "src/tiny.ts", name: "one", kind: "function", span: first },
			{ file: "src/tiny.ts", name: "two", kind: "function", span: second }
		]);

		const byDefault = await runDuplicates(repo);
		expect((byDefault.d.groups as unknown[]).length).toBe(0);
		expect((byDefault.d.summary as Record<string, unknown>).symbols_compared).toBe(0);

		const lowered = await runDuplicates(repo, { min_lines: 1 });
		expect((lowered.d.groups as unknown[]).length).toBe(1);
	});

	it("cuts the group list at limit and flags the truncation", async () => {
		const repo = "dups-limit";
		const file = new FixtureFile();
		const a1 = file.add(BODY("a1", "items: number[]", "+="));
		file.gap();
		const a2 = file.add(BODY("a2", "items: number[]", "+="));
		file.gap();
		// A structurally different body, so this pair forms a second group.
		const collect = (name: string): string[] => [
			`export function ${name}(words: string[]): string {`,
			"\tconst parts: string[] = [];",
			"\tfor (const word of words) {",
			"\t\tparts.push(word.trim());",
			"\t}",
			'\treturn parts.join(",");',
			"}"
		];
		const b1 = file.add(collect("b1"));
		file.gap();
		const b2 = file.add(collect("b2"));
		indexFixture(repo, "src/pairs.ts", file, [
			{ file: "src/pairs.ts", name: "a1", kind: "function", span: a1 },
			{ file: "src/pairs.ts", name: "a2", kind: "function", span: a2 },
			{ file: "src/pairs.ts", name: "b1", kind: "function", span: b1 },
			{ file: "src/pairs.ts", name: "b2", kind: "function", span: b2 }
		]);

		const { d } = await runDuplicates(repo, { limit: 1 });
		expect((d.groups as unknown[]).length).toBe(1);
		const summary = d.summary as Record<string, unknown>;
		expect(summary.groups_total).toBe(2);
		expect(summary.groups_truncated).toBe(true);
	});

	it("returns an empty result for a repo with no indexed symbols", async () => {
		// Indexed but no callable symbols (only a class): a valid empty answer.
		const repo = "dups-empty";
		const file = new FixtureFile();
		const widget = file.add([
			"export class Widget {",
			"\tvalue = 1;",
			"\treset(): void {",
			"\t\tthis.value = 0;",
			"\t}",
			"}"
		]);
		indexFixture(repo, "src/only-class.ts", file, [
			{ file: "src/only-class.ts", name: "Widget", kind: "class", span: widget }
		]);

		const { resp, d } = await runDuplicates(repo);
		expect(resp.isError).toBeFalsy();
		expect(d.groups).toEqual([]);
		const summary = d.summary as Record<string, unknown>;
		expect(summary.symbols_scanned).toBe(0);
		expect(summary.groups_total).toBe(0);
	});

	it("returns REPO_NOT_INDEXED for a repo with no indexed files", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: "dups-never-indexed", repoPath: tempDir, action: "duplicates" },
			store,
			vectors
		);
		expect(resp.isError).toBe(true);
		expect(data(resp)).toMatchObject({ schema: "tool-error", code: "REPO_NOT_INDEXED", retryable: false });
	});

	it("skips files missing from disk and reports them", async () => {
		const repo = "dups-unreadable";
		store.codebaseFiles.upsertFile({
			repo,
			file_path: "src/gone.ts",
			language: "typescript",
			checksum: "gone-sum",
			lines: 20,
			size_bytes: 100
		});
		store.codebaseSymbols.bulkUpsertSymbols([
			{
				repo,
				file_path: "src/gone.ts",
				name: "left",
				kind: "function",
				start_line: 1,
				end_line: 7,
				source_fingerprint: "f1"
			},
			{
				repo,
				file_path: "src/gone.ts",
				name: "right",
				kind: "function",
				start_line: 9,
				end_line: 15,
				source_fingerprint: "f2"
			}
		]);

		const { resp, d } = await runDuplicates(repo);
		expect(resp.isError).toBeFalsy();
		expect(d.groups).toEqual([]);
		expect((d.summary as Record<string, unknown>).files_unreadable).toBe(1);
		expect(d.unreadable_files).toEqual(["src/gone.ts"]);

		// The coverage gap belongs to the cached analysis, not to the call: a
		// cache hit must not report 0 unreadable files (FIX-021 review nit).
		const cached = await runDuplicates(repo);
		const cachedSummary = cached.d.summary as Record<string, unknown>;
		expect(cachedSummary.cache_hit).toBe(true);
		expect(cachedSummary.files_unreadable).toBe(1);
		expect(cached.d.unreadable_files).toEqual(["src/gone.ts"]);
	});

	it("is deterministic and serves the repeat call from the fingerprint cache", async () => {
		const repo = "dups-deterministic";
		const file = new FixtureFile();
		const left = file.add(BODY("first", "items: number[]", "+="));
		file.gap();
		const right = file.add(BODY("second", "items: number[]", "+="));
		indexFixture(repo, "src/det.ts", file, [
			{ file: "src/det.ts", name: "first", kind: "function", span: left },
			{ file: "src/det.ts", name: "second", kind: "function", span: right }
		]);

		const firstRun = await runDuplicates(repo);
		const secondRun = await runDuplicates(repo);
		expect(secondRun.d.groups).toEqual(firstRun.d.groups);
		expect((firstRun.d.summary as Record<string, unknown>).cache_hit).toBe(false);
		expect((firstRun.d.summary as Record<string, unknown>).files_read).toBe(1);
		const cachedSummary = secondRun.d.summary as Record<string, unknown>;
		expect(cachedSummary.cache_hit).toBe(true);
		expect(cachedSummary.files_read).toBe(0);
	});

	it("requires repo and repoPath", async () => {
		const noPath = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: "dups-exact", action: "duplicates" },
			store,
			vectors
		);
		expect(noPath.isError).toBe(true);
		expect(data(noPath)).toMatchObject({ schema: "tool-error", code: "REPO_PATH_REQUIRED", retryable: false });

		const noRepo = await handleCodebaseRead(
			{ owner: "vheins", json: true, repoPath: tempDir, action: "duplicates" },
			store,
			vectors
		);
		expect(noRepo.isError).toBe(true);
		expect(data(noRepo)).toMatchObject({ schema: "tool-error", code: "REPO_REQUIRED", retryable: false });
	});

	it("rejects an out-of-range min_similarity at the schema boundary", () => {
		const tooHigh = CodebaseReadSchema.safeParse({ action: "duplicates", min_similarity: 1.5 });
		expect(tooHigh.success).toBe(false);
		if (!tooHigh.success) {
			expect(tooHigh.error.issues.some((issue) => issue.path.includes("min_similarity"))).toBe(true);
		}
		const zero = CodebaseReadSchema.safeParse({ action: "duplicates", min_similarity: 0 });
		expect(zero.success).toBe(false);
		expect(CodebaseReadSchema.safeParse({ action: "duplicates", min_similarity: 0.95 }).success).toBe(true);
	});
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

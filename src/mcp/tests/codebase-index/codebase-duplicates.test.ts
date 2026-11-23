import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { CodebaseReadSchema } from "../../tools/schemas/codebase-read.js";
import { data, setupIntegrationFixture } from "./mcp-tools.integration.shared.js";
import { clearDuplicatesCaches } from "../../codebase-index/services/duplicates.js";
import { clearCodeSearchCache } from "../../codebase-index/services/code-search.js";
import { BODY, FixtureFile, makeIndexer, makeRunDuplicates } from "./codebase-duplicates.helpers.js";
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

	// The content cache is shared process-wide and used to be keyed by
	// repo+file_path only, so a second root registered under the same repo name
	// (the watcher root guard is skipped for unregistered repos) would be served
	// the FIRST root's file content (TASK-007, FIX-022 pattern).
	it("two roots under one repo name read their own file content, never the other root's", async () => {
		const repo = "dups-two-roots";
		const filePath = "src/twin.ts";

		// Root A: two identical bodies → one duplicate group.
		const rootA = fs.mkdtempSync(path.join(tempDir, "rootA-"));
		// Root B: same file_path, second body differs → no duplicate group.
		const rootB = fs.mkdtempSync(path.join(tempDir, "rootB-"));

		try {
			const fileA = new FixtureFile();
			const leftA = fileA.add(BODY("first", "items: number[]", "+="));
			fileA.gap();
			const rightA = fileA.add(BODY("second", "items: number[]", "+="));
			fs.mkdirSync(path.dirname(path.join(rootA, filePath)), { recursive: true });
			fs.writeFileSync(path.join(rootA, filePath), fileA.toString(), "utf-8");

			const fileB = new FixtureFile();
			const leftB = fileB.add(BODY("first", "items: number[]", "+="));
			fileB.gap();
			// A structurally different body (product instead of sum) so the pair
			// falls below the 0.9 near-duplicate threshold at root B.
			const rightB = fileB.add([
				"export function second(items: number[]): number {",
				"\tlet acc = 1;",
				"\tfor (const item of items) {",
				"\t\tacc = acc * item;",
				"\t}",
				"\treturn acc;",
				"}"
			]);
			fs.mkdirSync(path.dirname(path.join(rootB, filePath)), { recursive: true });
			fs.writeFileSync(path.join(rootB, filePath), fileB.toString(), "utf-8");

			// One indexed row shared by both roots: identical checksum, which is
			// exactly the validity key that could not tell the roots apart.
			store.codebaseFiles.upsertFile({
				repo,
				file_path: filePath,
				language: "typescript",
				checksum: `${repo}:${filePath}:sum`,
				lines: fileA.lines.length,
				size_bytes: Buffer.byteLength(fileA.toString(), "utf-8")
			});
			store.codebaseSymbols.bulkUpsertSymbols(
				[
					{ name: "first", kind: "function", span: leftA },
					{ name: "second", kind: "function", span: rightA }
				].map((symbol) => ({
					repo,
					file_path: filePath,
					name: symbol.name,
					kind: symbol.kind,
					exported: true,
					start_line: symbol.span.start,
					end_line: symbol.span.end,
					signature: null,
					source_fingerprint: `${repo}:${symbol.name}:${symbol.span.start}`
				}))
			);
			// Spans are line-identical in both roots (same body shapes).
			expect(leftB).toEqual(leftA);
			expect(rightB).toEqual(rightA);

			clearCodeSearchCache();
			const runAt = async (repoPath: string) => {
				const resp = await handleCodebaseRead(
					{ owner: "vheins", json: true, repo, repoPath, action: "duplicates" },
					store,
					vectors
				);
				return data(resp);
			};

			// Root A first: populates the shared content cache for this repo+path.
			const a = await runAt(rootA);
			expect(a.groups).toHaveLength(1);

			// Root B must read ROOT B's file: the second body is not a duplicate.
			// Pre-fix the cached root-A body was served, producing a false group.
			const b = await runAt(rootB);
			expect(b.groups).toHaveLength(0);
		} finally {
			fs.rmSync(rootA, { recursive: true, force: true });
			fs.rmSync(rootB, { recursive: true, force: true });
		}
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

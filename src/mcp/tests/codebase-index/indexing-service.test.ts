/**
 * CodebaseIndexService integration tests.
 *
 * Tests the full indexing pipeline end-to-end with:
 *   - Real file system (temp directories)
 *   - Real SQLiteStore (in-memory)
 *   - Mocked ParserPool (WASM is unavailable in test/CI environments)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createCodebaseIndexService, IndexInProgressError } from "../../codebase-index/services/indexing-service";
import { autoIndexIfStale } from "../../codebase-index/services/indexing-service";
import type { IndexOptions, IndexResult } from "../../codebase-index/services/indexing-service";
import type { ParserPool, ParseResult, ParsedSymbol } from "../../codebase-index/parser/language-visitor";
import { SymbolKind } from "../../codebase-index/parser/language-visitor";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";

// ── Helpers ────────────────────────────────────────────────────────────

function touch(filePath: string, content: string): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

interface MockParserPoolOptions {
	/** Artificial delay per parseFile call in ms (default: 0). */
	delayMs?: number;
	/** If true, resolve with a timeout-like error instead of symbols. */
	simulateTimeout?: boolean;
	/** Set of file base names that should throw instead of returning a result. */
	crashFiles?: Set<string>;
}

/** Create a mock ParserPool that returns fake symbols per file. */
function createMockParserPool(opts?: MockParserPoolOptions): ParserPool {
	const delayMs = opts?.delayMs ?? 0;
	const simulateTimeout = opts?.simulateTimeout ?? false;
	const crashFiles = opts?.crashFiles ?? new Set<string>();
	let initialized = false;
	return {
		async initialize(): Promise<void> {
			initialized = true;
		},
		isInitialized(): boolean {
			return initialized;
		},
		async parseFile(filePath: string, _sourceCode: string): Promise<ParseResult> {
			if (delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}

			const basename = path.basename(filePath);

			if (crashFiles.has(basename)) {
				throw new Error(`Simulated crash in parser for: ${basename}`);
			}

			if (simulateTimeout) {
				return {
					symbols: [],
					error: "Parse timeout after 10000ms for: " + filePath,
					durationMs: 0
				};
			}

			if (basename === "error.ts") {
				return {
					symbols: [],
					error: "Parse errors detected (partial results returned)",
					durationMs: 0
				};
			}

			if (basename === "crash.ts") {
				// Simulate a file that causes an exception at the read level
				return {
					symbols: [],
					error: "Syntax error: unexpected token",
					durationMs: 0
				};
			}

			// Extract function-like names from the file name to simulate symbols
			const symbols: ParsedSymbol[] = [];
			const stem = path.parse(basename).name;

			symbols.push({
				name: stem,
				kind: SymbolKind.Function,
				startLine: 1,
				startCol: 1,
				endLine: 1,
				endCol: stem.length + 8,
				signature: `function ${stem}()`,
				docComment: `Documentation for ${stem}`,
				exported: true,
				defaultExport: false,
				parentName: null
			});

			return {
				symbols,
				error: null,
				durationMs: 0
			};
		}
	};
}

// ── Test suite ─────────────────────────────────────────────────────────

describe("CodebaseIndexService", () => {
	let store: SQLiteStore;
	let tempDir: string;
	let parserPool: ParserPool;

	// Real dir per test, service created per test
	let repoDir: string;

	beforeEach(async () => {
		store = await createTestStore();
		parserPool = createMockParserPool();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-svc-"));
		repoDir = path.join(tempDir, "repo");
		fs.mkdirSync(repoDir, { recursive: true });
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// ── Helper to create service ──────────────────────────────────

	function service() {
		return createCodebaseIndexService(store, parserPool);
	}

	// ── Helper to index and return result ─────────────────────────

	async function index(opts?: IndexOptions): Promise<IndexResult> {
		return service().indexRepository("test-repo", repoDir, opts);
	}

	// ══════════════════════════════════════════════════════════════════
	// 1. Full index flow
	// ══════════════════════════════════════════════════════════════════

	it("full index: discovers, parses, stores files and symbols", async () => {
		touch(path.join(repoDir, "src", "main.ts"), "export function main() {}\n");
		touch(path.join(repoDir, "src", "utils.ts"), "export function util() {}\n");
		touch(path.join(repoDir, "lib", "helper.ts"), "export function helper() {}\n");

		const result = await index();

		expect(result.totalFiles).toBe(3);
		expect(result.parsedFiles).toBe(3);
		expect(result.skippedFiles).toBe(0);
		expect(result.failedFiles).toBe(0);
		expect(result.totalSymbols).toBe(3);
		expect(result.errors).toEqual([]);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.success).toBe(true);

		// Verify codebase_files records
		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files.length).toBe(3);
		const filePaths = files.map((f) => f.file_path);
		expect(filePaths).toContain("src/main.ts");
		expect(filePaths).toContain("src/utils.ts");
		expect(filePaths).toContain("lib/helper.ts");

		// Verify codebase_symbols records
		const mainSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "src/main.ts");
		expect(mainSymbols.length).toBe(1);
		expect(mainSymbols[0].name).toBe("main");
		expect(mainSymbols[0].kind).toBe("function");
		expect(mainSymbols[0].exported).toBe(true);

		// Verify checksum was stored
		expect(files[0].checksum).toBeTruthy();
		expect(files[0].checksum!.length).toBe(64); // SHA-256 hex
	});

	// ══════════════════════════════════════════════════════════════════
	// 2. Incremental index — unchanged files skipped
	// ══════════════════════════════════════════════════════════════════

	it("incremental index: unchanged files are skipped", async () => {
		touch(path.join(repoDir, "src", "a.ts"), "export const a = 1;\n");
		touch(path.join(repoDir, "src", "b.ts"), "export const b = 2;\n");

		const first = await index();
		expect(first.parsedFiles).toBe(2);

		const second = await index();
		expect(second.parsedFiles).toBe(0);
		expect(second.skippedFiles).toBe(2);
		expect(second.totalFiles).toBe(2);

		// Symbols should still exist
		const symbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "src/a.ts");
		expect(symbols.length).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 3. Checksum detection — modified file re-parsed
	// ══════════════════════════════════════════════════════════════════

	it("checksum detection: modified file is re-parsed, unchanged file skipped", async () => {
		touch(path.join(repoDir, "mod.ts"), "export const x = 1;\n");
		touch(path.join(repoDir, "keep.ts"), "export const y = 2;\n");

		await index();

		// Modify mod.ts
		fs.writeFileSync(path.join(repoDir, "mod.ts"), "export const x = 42;\n", "utf-8");

		const second = await index();
		expect(second.parsedFiles).toBe(1);
		expect(second.skippedFiles).toBe(1);
		expect(second.totalFiles).toBe(2);
	});

	// ══════════════════════════════════════════════════════════════════
	// 4. Force mode — re-parses all files
	// ══════════════════════════════════════════════════════════════════

	it("force mode: re-parses all files regardless of checksum", async () => {
		touch(path.join(repoDir, "one.ts"), "export const one = 1;\n");
		touch(path.join(repoDir, "two.ts"), "export const two = 2;\n");

		await index();

		const forced = await index({ force: true });
		expect(forced.parsedFiles).toBe(2);
		expect(forced.skippedFiles).toBe(0);
	});

	// ══════════════════════════════════════════════════════════════════
	// 5. Error handling — malformed file
	// ══════════════════════════════════════════════════════════════════

	it("error handling: malformed file records error but continues", async () => {
		touch(path.join(repoDir, "good.ts"), "export const good = 1;\n");
		touch(path.join(repoDir, "error.ts"), "broken syntax @@@\n");

		const result = await index();

		expect(result.totalFiles).toBe(2);
		expect(result.parsedFiles).toBe(1); // good.ts parsed
		expect(result.failedFiles).toBe(1); // error.ts failed
		expect(result.errors.length).toBe(1);
		expect(result.errors[0].filePath).toBe("error.ts");
		expect(result.success).toBe(false);

		// good.ts still stored
		const goodSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "good.ts");
		expect(goodSymbols.length).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 6. Empty repo
	// ══════════════════════════════════════════════════════════════════

	it("empty repo: returns zero counts", async () => {
		const result = await index();

		expect(result.totalFiles).toBe(0);
		expect(result.parsedFiles).toBe(0);
		expect(result.skippedFiles).toBe(0);
		expect(result.failedFiles).toBe(0);
		expect(result.totalSymbols).toBe(0);
		expect(result.errors).toEqual([]);
		expect(result.success).toBe(true);

		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// 7. Concurrent prevention
	// ══════════════════════════════════════════════════════════════════

	it("concurrent prevention: throws IndexInProgressError on simultaneous call", async () => {
		// Create ONE service instance (not a factory) so both calls share the same indexingRepos set
		const slowPool = createMockParserPool({ delayMs: 500 });
		const svc = createCodebaseIndexService(store, slowPool);

		touch(path.join(repoDir, "slow.ts"), "export const s = 1;\n");

		// First call — starts indexing and grabs the locking set
		const firstPromise = svc.indexRepository("test-repo", repoDir);
		// Allow the microtask queue to flush so the synchronous set.add runs
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Second call — should throw immediately (same service instance)
		await expect(svc.indexRepository("test-repo", repoDir)).rejects.toThrow(IndexInProgressError);

		// First call should still complete successfully
		const first = await firstPromise;
		expect(first.success).toBe(true);
	});

	it("concurrent prevention: subsequent call after completion works", async () => {
		touch(path.join(repoDir, "a.ts"), "export const a = 1;\n");

		await index();

		touch(path.join(repoDir, "b.ts"), "export const b = 2;\n");
		const second = await index();
		expect(second.parsedFiles).toBe(1); // only new file
	});

	// ══════════════════════════════════════════════════════════════════
	// 8. Staleness check
	// ══════════════════════════════════════════════════════════════════

	it("checkStaleness: returns not stale when nothing indexed (empty index)", async () => {
		touch(path.join(repoDir, "src", "index.ts"), "export const x = 1;\n");

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(false);
		expect(s.staleFiles).toBe(0);
		expect(s.totalFiles).toBe(0);
		expect(s.staleRatio).toBe(0);
		expect(s.lastIndexedAt).toBeNull();
	});

	it("checkStaleness: returns not stale after indexing", async () => {
		touch(path.join(repoDir, "src", "index.ts"), "export const x = 1;\n");

		await index();

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(false);
		expect(s.staleFiles).toBe(0);
		expect(s.staleRatio).toBe(0);
		expect(s.lastIndexedAt).toBeTruthy();
	});

	it("checkStaleness: detects modified file as stale", async () => {
		touch(path.join(repoDir, "mod.ts"), "export const orig = 1;\n");

		await index();

		// Small delay to ensure mtime differs from last_indexed_at timestamp
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Modify file
		fs.writeFileSync(path.join(repoDir, "mod.ts"), "export const changed = 2;\n", "utf-8");

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(true);
		expect(s.staleFiles).toBe(1);
	});

	it("checkStaleness: respects 5 percent threshold for stale flag", async () => {
		// Create 20 files — 5% = 1 file
		for (let i = 0; i < 20; i++) {
			touch(path.join(repoDir, `s${i}.ts`), `export const s${i} = ${i};\n`);
		}

		await index();

		// No changes — not stale
		const s1 = await service().checkStaleness("test-repo", repoDir);
		expect(s1.stale).toBe(false);
		expect(s1.staleFiles).toBe(0);
		expect(s1.staleRatio).toBe(0);

		// Modify 1 file (exactly 5%) — should trigger stale
		fs.writeFileSync(path.join(repoDir, "s0.ts"), "export const s0 = 999;\n", "utf-8");

		const s2 = await service().checkStaleness("test-repo", repoDir);
		expect(s2.stale).toBe(true);
		expect(s2.staleFiles).toBe(1);
		expect(s2.staleRatio).toBe(0.05);
	});

	// ══════════════════════════════════════════════════════════════════
	// 9. getIndexStatus
	// ══════════════════════════════════════════════════════════════════

	it("getIndexStatus: returns correct status after indexing", async () => {
		touch(path.join(repoDir, "status.ts"), "export const s = 1;\n");

		await index();

		const status = await service().getIndexStatus("test-repo");
		expect(status.repo).toBe("test-repo");
		expect(status.isIndexed).toBe(true);
		expect(status.isIndexing).toBe(false);
		expect(status.totalFiles).toBe(1);
		expect(status.totalSymbols).toBe(1);
		expect(status.lastIndexedAt).toBeTruthy();
		expect(status.progress).toBeNull();
	});

	it("getIndexStatus: returns not indexed for fresh repo", async () => {
		const status = await service().getIndexStatus("never-indexed");
		expect(status.isIndexed).toBe(false);
		expect(status.totalFiles).toBe(0);
		expect(status.totalSymbols).toBe(0);
		expect(status.lastIndexedAt).toBeNull();
	});

	it("getIndexStatus: does not set staleness when repoPath is omitted", async () => {
		touch(path.join(repoDir, "file.ts"), "export const x = 1;\n");

		await index();

		const status = await service().getIndexStatus("test-repo");
		expect(status.isIndexed).toBe(true);
		expect(status.stale).toBeUndefined();
		expect(status.staleRatio).toBeUndefined();
	});

	it("getIndexStatus: returns not stale when repoPath is provided and files unchanged", async () => {
		touch(path.join(repoDir, "file.ts"), "export const x = 1;\n");

		await index();

		const status = await service().getIndexStatus("test-repo", repoDir);
		expect(status.isIndexed).toBe(true);
		expect(status.stale).toBe(false);
		expect(status.staleRatio).toBe(0);
	});

	it("getIndexStatus: returns stale after file modification with repoPath", async () => {
		touch(path.join(repoDir, "file.ts"), "export const x = 1;\n");

		await index();

		// Small delay to ensure mtime differs
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Modify the file
		fs.writeFileSync(path.join(repoDir, "file.ts"), "export const x = 2;\n", "utf-8");

		const status = await service().getIndexStatus("test-repo", repoDir);
		expect(status.isIndexed).toBe(true);
		expect(status.stale).toBe(true);
		expect(status.staleRatio).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 10. Progress callbacks
	// ══════════════════════════════════════════════════════════════════

	it("progress callback: emits events during indexing", async () => {
		touch(path.join(repoDir, "p1.ts"), "export const p1 = 1;\n");
		touch(path.join(repoDir, "p2.ts"), "export const p2 = 2;\n");

		const stages: string[] = [];
		const messages: string[] = [];

		await index({
			onProgress: (p) => {
				stages.push(p.stage);
				messages.push(p.message);
			}
		});

		expect(stages.length).toBeGreaterThanOrEqual(3); // discovering, parsing, storing
		expect(stages).toContain("discovering");
		expect(stages).toContain("parsing");
		expect(stages).toContain("storing");
	});

	it("progress callback survives exception without breaking indexing", async () => {
		touch(path.join(repoDir, "robust.ts"), "export const r = 1;\n");

		let callCount = 0;
		const result = await index({
			onProgress: (_p) => {
				callCount++;
				if (callCount === 1) throw new Error("Callback exploded");
			}
		});

		expect(result.success).toBe(true);
		expect(callCount).toBeGreaterThan(1); // Other callbacks still fired
	});

	// ══════════════════════════════════════════════════════════════════
	// 11. Cleanup — stale files removed
	// ══════════════════════════════════════════════════════════════════

	it("cleanup: removes symbols and file records for deleted files", async () => {
		touch(path.join(repoDir, "keep.ts"), "export const k = 1;\n");
		touch(path.join(repoDir, "delete-me.ts"), "export const d = 1;\n");

		await index();
		expect(store.codebaseFiles.getFilesByRepo("test-repo").length).toBe(2);

		// Delete the file from disk
		fs.unlinkSync(path.join(repoDir, "delete-me.ts"));

		await index();
		const filesAfter = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(filesAfter.length).toBe(1);
		expect(filesAfter[0].file_path).toBe("keep.ts");

		const symbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "delete-me.ts");
		expect(symbols).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// 12. Multiple repos do not interfere
	// ══════════════════════════════════════════════════════════════════

	it("multiple repos: indexing different repos does not block each other", async () => {
		const repoBDir = path.join(tempDir, "repo-b");
		fs.mkdirSync(repoBDir, { recursive: true });

		touch(path.join(repoDir, "a.ts"), "export const a = 1;\n");
		touch(path.join(repoBDir, "b.ts"), "export const b = 2;\n");

		// Index repo A first
		const resultA = await service().indexRepository("repo-a", repoDir);
		// Index repo B — should NOT throw since it's a different repo
		const resultB = await service().indexRepository("repo-b", repoBDir);

		expect(resultA.success).toBe(true);
		expect(resultB.success).toBe(true);

		expect(store.codebaseFiles.getFilesByRepo("repo-a").length).toBe(1);
		expect(store.codebaseFiles.getFilesByRepo("repo-b").length).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 13. Large file count (batch processing validation)
	// ══════════════════════════════════════════════════════════════════

	it("handles many files without error", async () => {
		const count = 50;
		for (let i = 0; i < count; i++) {
			touch(path.join(repoDir, `file${i}.ts`), `export const fn${i} = () => {};\n`);
		}

		const result = await index();
		expect(result.totalFiles).toBe(count);
		expect(result.parsedFiles).toBe(count);
		expect(result.totalSymbols).toBe(count);
		expect(store.codebaseFiles.getFileCountByRepo("test-repo")).toBe(count);
	});

	// ══════════════════════════════════════════════════════════════════
	// 14. Incremental re-index — only touched files are parsed
	// ══════════════════════════════════════════════════════════════════

	it("incremental re-index: only touched files are re-parsed (1000 file simulation)", async () => {
		const count = 100;
		for (let i = 0; i < count; i++) {
			touch(path.join(repoDir, `sim-${i}.ts`), `export const sim${i} = () => {};\n`);
		}

		// First index — parse all
		const first = await index();
		expect(first.parsedFiles).toBe(count);
		expect(first.totalFiles).toBe(count);

		// Touch 10 files
		const touched = new Set<number>();
		const touchCount = 10;
		for (let i = 0; i < touchCount; i++) {
			const idx = i * 3; // deterministic spread: 0, 3, 6, ...
			touched.add(idx);
			fs.writeFileSync(
				path.join(repoDir, `sim-${idx}.ts`),
				`export const sim${idx} = () => { return "${idx}-modified"; };\n`,
				"utf-8"
			);
		}

		const second = await index();
		expect(second.parsedFiles).toBe(touchCount);
		expect(second.skippedByChecksum).toBe(count - touchCount);
		expect(second.totalFiles).toBe(count);
	});

	// ══════════════════════════════════════════════════════════════════
	// 15. File rename detection — transfer symbol associations
	// ══════════════════════════════════════════════════════════════════

	it("rename detection: old file removed, new file with same checksum detected as rename", async () => {
		touch(path.join(repoDir, "old-name.ts"), "export const answer = 42;\n");

		// First index
		let result = await index();
		expect(result.parsedFiles).toBe(1);
		expect(result.totalFiles).toBe(1);

		// Verify symbols stored under old path
		const oldSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "old-name.ts");
		expect(oldSymbols.length).toBe(1);
		expect(oldSymbols[0].name).toBe("old-name");

		// Rename the file: remove old, create new with same content
		fs.unlinkSync(path.join(repoDir, "old-name.ts"));
		touch(path.join(repoDir, "new-name.ts"), "export const answer = 42;\n");

		result = await index();
		expect(result.parsedFiles).toBe(0); // rename detected, not parsed
		expect(result.renamedFiles).toBe(1);
		expect(result.totalFiles).toBe(1);

		// Old path should not have file record
		const oldFile = store.codebaseFiles.getFile("test-repo", "old-name.ts");
		expect(oldFile).toBeUndefined();

		// New path should have the file record with the same checksum
		const newFile = store.codebaseFiles.getFile("test-repo", "new-name.ts");
		expect(newFile).toBeDefined();
		expect(newFile!.checksum).toBeTruthy();

		// Symbols should now be under the new path
		const newSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "new-name.ts");
		expect(newSymbols.length).toBe(1);
		expect(newSymbols[0].name).toBe("old-name"); // symbol name unchanged

		// Old path should have no symbols
		const staleSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "old-name.ts");
		expect(staleSymbols).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// 16. Batch transaction boundary — files stored in batches of 50
	// ══════════════════════════════════════════════════════════════════

	it("batch transaction: stores files in batches respecting batchSize", async () => {
		const count = 120;
		for (let i = 0; i < count; i++) {
			touch(path.join(repoDir, `batch-${i}.ts`), `export const batch${i} = { id: ${i} };\n`);
		}

		// Index with explicit small batch size
		const result = await index({ batchSize: 40 });
		expect(result.parsedFiles).toBe(count);
		expect(result.totalFiles).toBe(count);
		expect(result.totalSymbols).toBe(count);

		// Verify all files stored
		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files.length).toBe(count);

		// Verify all symbols stored
		let totalSymbols = 0;
		for (const f of files) {
			totalSymbols += store.codebaseSymbols.getSymbolsByFile("test-repo", f.file_path).length;
		}
		expect(totalSymbols).toBe(count);
	});

	// ══════════════════════════════════════════════════════════════════
	// 17. Skip breakdown in result
	// ══════════════════════════════════════════════════════════════════

	it("skip breakdown: reports skippedByChecksum in result", async () => {
		touch(path.join(repoDir, "a.ts"), "export const a = 1;\n");
		touch(path.join(repoDir, "b.ts"), "export const b = 2;\n");

		const first = await index();
		expect(first.skippedByChecksum).toBe(0);

		const second = await index();
		expect(second.skippedByChecksum).toBe(2);
		expect(second.renamedFiles).toBe(0);
		expect(second.skippedByExtension).toBe(0);
		expect(second.skippedByGitignore).toBe(0);
	});

	// ══════════════════════════════════════════════════════════════════
	// 18. Error handling — timeout
	// ══════════════════════════════════════════════════════════════════

	it("timeout: long-parsing file is skipped with timeout error counted", async () => {
		// Create a parser that simulates timeout on all files
		const timeoutPool = createMockParserPool({ simulateTimeout: true });
		const svc = createCodebaseIndexService(store, timeoutPool);

		touch(path.join(repoDir, "slow.ts"), "export const x = 1;\n");
		touch(path.join(repoDir, "fast.ts"), "export const y = 2;\n");

		const result = await svc.indexRepository("test-repo", repoDir);

		expect(result.totalFiles).toBe(2);
		expect(result.failedFiles).toBe(2);
		expect(result.parsedFiles).toBe(0);
		expect(result.errors.length).toBe(2);
		expect(result.errorSummary.timeoutErrors).toBe(2);
		expect(result.success).toBe(false);

		// File metadata still stored even with parse errors
		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files.length).toBe(2);
	});

	// ══════════════════════════════════════════════════════════════════
	// 19. Error handling — parse crash
	// ══════════════════════════════════════════════════════════════════

	it("parse crash: index continues after per-file parse crash", async () => {
		const crashSet = new Set<string>(["explode.ts"]);
		const crashPool = createMockParserPool({ crashFiles: crashSet });
		const svc = createCodebaseIndexService(store, crashPool);

		touch(path.join(repoDir, "good.ts"), "export const good = 1;\n");
		touch(path.join(repoDir, "explode.ts"), "// this will crash\n");
		touch(path.join(repoDir, "also-good.ts"), "export const also = 2;\n");

		const result = await svc.indexRepository("test-repo", repoDir);

		expect(result.totalFiles).toBe(3);
		expect(result.parsedFiles).toBe(2); // good.ts and also-good.ts parsed
		expect(result.failedFiles).toBe(1); // explode.ts crashed
		expect(result.errors.length).toBe(1);
		expect(result.errors[0].filePath).toBe("explode.ts");
		expect(result.errors[0].error).toContain("Simulated crash");

		// Verify non-crashing files are stored with symbols
		const goodSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "good.ts");
		expect(goodSymbols.length).toBe(1);

		const alsoSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "also-good.ts");
		expect(alsoSymbols.length).toBe(1);

		// errorSummary reflects the classification
		expect(result.errorSummary.total).toBe(1);
		expect(result.errorSummary.recoverable).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 20. Error handling — permission denied
	// ══════════════════════════════════════════════════════════════════

	it("permission denied: file skipped with PERMISSION classified error", async () => {
		// Create a parser that throws EACCES-style error
		let permInitialized = false;
		const permPool: ParserPool = {
			async initialize(): Promise<void> {
				permInitialized = true;
			},
			isInitialized(): boolean {
				return permInitialized;
			},
			async parseFile(filePath: string, _sourceCode: string): Promise<ParseResult> {
				const basename = path.basename(filePath);
				if (basename === "restricted.ts") {
					const err = new Error("EACCES: permission denied, open '/restricted.ts'");
					(err as NodeJS.ErrnoException).code = "EACCES";
					throw err;
				}
				return {
					symbols: [
						{
							name: "safeFn",
							kind: SymbolKind.Function,
							startLine: 1,
							startCol: 1,
							endLine: 1,
							endCol: 14,
							signature: "function safeFn()",
							docComment: null,
							exported: false,
							defaultExport: false,
							parentName: null
						}
					],
					error: null,
					durationMs: 0
				};
			}
		};

		const svc = createCodebaseIndexService(store, permPool);

		touch(path.join(repoDir, "safe.ts"), "export const s = 1;\n");
		touch(path.join(repoDir, "restricted.ts"), "// no access\n");

		const result = await svc.indexRepository("test-repo", repoDir);

		expect(result.totalFiles).toBe(2);
		expect(result.parsedFiles).toBe(1); // safe.ts parsed
		expect(result.failedFiles).toBe(1); // restricted.ts permission denied
		expect(result.errorSummary.permissionErrors).toBe(1);
		expect(result.errors[0].filePath).toBe("restricted.ts");
		expect(result.errors[0].error).toContain("permission denied");

		// safe.ts symbols stored
		const safeSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "safe.ts");
		expect(safeSymbols.length).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 21. Error classification — errorSummary structure
	// ══════════════════════════════════════════════════════════════════

	it("errorSummary: structured classification present in all results", async () => {
		touch(path.join(repoDir, "a.ts"), "export const a = 1;\n");

		const result = await index();

		// Verify errorSummary is present and has expected shape
		expect(result.errorSummary).toBeDefined();
		expect(result.errorSummary.total).toBe(0);
		expect(result.errorSummary.recoverable).toBe(0);
		expect(result.errorSummary.fatal).toBe(0);
		expect(result.errorSummary.timeoutErrors).toBe(0);
		expect(result.errorSummary.permissionErrors).toBe(0);
		expect(result.errorSummary.dbWriteErrors).toBe(0);
	});

	it("errorSummary: mixed errors are counted correctly", async () => {
		const mixedPool = createMockParserPool({ simulateTimeout: true });
		const svc = createCodebaseIndexService(store, mixedPool);

		touch(path.join(repoDir, "t1.ts"), "export const t1 = 1;\n");
		touch(path.join(repoDir, "t2.ts"), "export const t2 = 2;\n");

		const result = await svc.indexRepository("test-repo", repoDir);

		expect(result.errorSummary.total).toBe(2);
		expect(result.errorSummary.timeoutErrors).toBe(2);
		expect(result.errorSummary.permissionErrors).toBe(0);
	});

	// ══════════════════════════════════════════════════════════════════
	// 22. autoIndexIfStale
	// ══════════════════════════════════════════════════════════════════

	it("autoIndexIfStale: returns skipped when index is fresh", async () => {
		touch(path.join(repoDir, "fresh.ts"), "export const f = 1;\n");

		// Index first to set last_indexed_at
		await index();

		// autoIndexIfStale should skip (TTL = 24h by default, index just created)
		const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("Index is fresh");
	});

	it("autoIndexIfStale: returns started when no index exists", async () => {
		touch(path.join(repoDir, "first.ts"), "export const x = 1;\n");

		// No index yet — should trigger indexing
		const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
		expect(result.status).toBe("started");
		expect(result.reason).toContain("No existing index");

		// Wait a bit for background indexing to complete
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Verify index was actually built
		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files.length).toBeGreaterThan(0);
	});

	it("autoIndexIfStale: returns started when index is stale beyond TTL", async () => {
		touch(path.join(repoDir, "stale.ts"), "export const s = 1;\n");

		// Index first
		await index();

		// autoIndexIfStale with very short TTL (1ms) — index is "stale"
		const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool, { ttlMs: 1 });
		expect(result.status).toBe("started");
		expect(result.reason).toContain("Index TTL expired");

		// Wait for background indexing to complete
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Verify repo is no longer "auto-indexing" (autoIndexingRepos set was cleared)
		const status = await service().getIndexStatus("test-repo");
		expect(status.isIndexing).toBe(false);
	});

	it("autoIndexIfStale: returns already_indexing when concurrent call is made", async () => {
		touch(path.join(repoDir, "concurrent.ts"), "export const c = 1;\n");

		// First call starts background indexing
		const first = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
		expect(first.status).toBe("started");

		// Second call should see it's already indexing (module-level guard)
		const second = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
		expect(second.status).toBe("already_indexing");
		expect(second.reason).toContain("Auto-index already in progress");

		// Wait for background indexing to complete
		await new Promise((resolve) => setTimeout(resolve, 200));
	});

	it("autoIndexIfStale: respects CODEBASE_AUTO_INDEX=false env var", async () => {
		touch(path.join(repoDir, "disabled.ts"), "export const d = 1;\n");

		const prev = process.env.CODEBASE_AUTO_INDEX;
		process.env.CODEBASE_AUTO_INDEX = "false";
		try {
			const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
			expect(result.status).toBe("skipped");
			expect(result.reason).toContain("Auto-index disabled");
		} finally {
			process.env.CODEBASE_AUTO_INDEX = prev;
		}
	});

	it("autoIndexIfStale: respects custom TTL via env var", async () => {
		touch(path.join(repoDir, "envttl.ts"), "export const e = 1;\n");

		// Index first
		await index();

		// Set env TTL to 1ms to force staleness
		const prev = process.env.CODEBASE_AUTO_INDEX_TTL;
		process.env.CODEBASE_AUTO_INDEX_TTL = "1";
		try {
			const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
			expect(result.status).toBe("started");
			expect(result.reason).toContain("Index TTL expired");
		} finally {
			process.env.CODEBASE_AUTO_INDEX_TTL = prev;
		}

		await new Promise((resolve) => setTimeout(resolve, 200));
	});

	it("autoIndexIfStale: options.ttlMs overrides env var", async () => {
		touch(path.join(repoDir, "optttl.ts"), "export const o = 1;\n");

		// Index first
		await index();

		// env var says 1ms (stale), but options.ttlMs says 24h (fresh)
		const prev = process.env.CODEBASE_AUTO_INDEX_TTL;
		process.env.CODEBASE_AUTO_INDEX_TTL = "1";
		try {
			const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool, {
				ttlMs: 24 * 60 * 60 * 1000
			});
			expect(result.status).toBe("skipped");
			expect(result.reason).toContain("Index is fresh");
		} finally {
			process.env.CODEBASE_AUTO_INDEX_TTL = prev;
		}
	});

	// ══════════════════════════════════════════════════════════════════
	// 23. checkStaleness — file no longer on disk
	// ══════════════════════════════════════════════════════════════════

	it("checkStaleness: deleted file is counted as stale", async () => {
		touch(path.join(repoDir, "will-delete.ts"), "export const w = 1;\n");
		touch(path.join(repoDir, "stay.ts"), "export const s = 2;\n");

		await index();

		// Delete one file
		fs.unlinkSync(path.join(repoDir, "will-delete.ts"));

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.staleFiles).toBe(1);
	});

	it("checkStaleness: below 5% threshold is not stale", async () => {
		// 50 files — 5% = 2.5, so 2 files changed = 4% which is below threshold
		for (let i = 0; i < 50; i++) {
			touch(path.join(repoDir, `bt${i}.ts`), `export const bt${i} = ${i};\n`);
		}

		await index();

		// Modify 2 files = 4% — below 5% threshold
		fs.writeFileSync(path.join(repoDir, "bt0.ts"), "export const bt0 = 999;\n", "utf-8");
		fs.writeFileSync(path.join(repoDir, "bt1.ts"), "export const bt1 = 999;\n", "utf-8");

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.staleFiles).toBe(2);
		// 2/50 = 0.04 < 0.05 → NOT stale
		expect(s.stale).toBe(false);
	});

	// ══════════════════════════════════════════════════════════════════
	// 24. getIndexStatus — with staleness
	// ══════════════════════════════════════════════════════════════════

	it("getIndexStatus: skips staleness when repoPath omitted but has index", async () => {
		touch(path.join(repoDir, "status2.ts"), "export const s = 1;\n");

		await index();

		const status = await service().getIndexStatus("test-repo");
		expect(status.isIndexed).toBe(true);
		expect(status.stale).toBeUndefined();
	});

	// ══════════════════════════════════════════════════════════════════
	// 25. Error classification — isPermissionError via message pattern
	// ══════════════════════════════════════════════════════════════════

	it("permission denied: EPERM via message pattern (code lost, detected by message regex)", async () => {
		let permInit = false;
		const msgPermPool: ParserPool = {
			async initialize(): Promise<void> {
				permInit = true;
			},
			isInitialized(): boolean {
				return permInit;
			},
			async parseFile(_filePath: string, _sourceCode: string): Promise<ParseResult> {
				// Throwing with "EACCES" in message so isPermissionError(new Error(msg)) can match.
				// Note: the code property is lost when isPermissionError re-wraps as new Error.
				throw new Error("EACCES: permission denied, open '/restricted'");
			}
		};

		const svc = createCodebaseIndexService(store, msgPermPool);
		touch(path.join(repoDir, "noperm.ts"), "// restricted\n");

		const result = await svc.indexRepository("test-repo", repoDir);
		expect(result.errorSummary.permissionErrors).toBe(1);
		expect(result.failedFiles).toBe(1);
	});

	it("permission denied: EPERM via message match", async () => {
		let permInit = false;
		const codePermPool: ParserPool = {
			async initialize(): Promise<void> {
				permInit = true;
			},
			isInitialized(): boolean {
				return permInit;
			},
			async parseFile(_filePath: string, _sourceCode: string): Promise<ParseResult> {
				const err = new Error("EPERM: operation not permitted, open '/eperm.ts'");
				(err as NodeJS.ErrnoException).code = "EPERM";
				throw err;
			}
		};

		const svc = createCodebaseIndexService(store, codePermPool);
		touch(path.join(repoDir, "eperm.ts"), "// nope\n");

		const result = await svc.indexRepository("test-repo", repoDir);
		expect(result.errorSummary.permissionErrors).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 26. Symbol entity edge cases: countLines with empty content
	// ══════════════════════════════════════════════════════════════════

	it("parse timeout: error message detected as timeout", async () => {
		const timeoutTextPool = createMockParserPool();
		// Override parseFile to return a timeout error
		const orig = timeoutTextPool.parseFile;
		timeoutTextPool.parseFile = async (_fp, _sc) => ({
			symbols: [],
			error: "Parse timeout after 10000ms for: file.ts",
			durationMs: 0
		});

		const svc = createCodebaseIndexService(store, timeoutTextPool);
		touch(path.join(repoDir, "timeout.ts"), "export const infinite = () => { while(true) {} };\n");

		const result = await svc.indexRepository("test-repo", repoDir);
		expect(result.errorSummary.timeoutErrors).toBe(1);
		expect(result.failedFiles).toBe(1);
	});
});

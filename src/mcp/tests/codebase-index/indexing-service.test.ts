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
}

/** Create a mock ParserPool that returns fake symbols per file. */
function createMockParserPool(opts?: MockParserPoolOptions): ParserPool {
	const delayMs = opts?.delayMs ?? 0;
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

	it("checkStaleness: returns all stale when nothing indexed", async () => {
		touch(path.join(repoDir, "src", "index.ts"), "export const x = 1;\n");

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(true);
		expect(s.staleFiles).toBe(1);
		expect(s.staleRatio).toBe(1);
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

		// Modify file
		fs.writeFileSync(path.join(repoDir, "mod.ts"), "export const changed = 2;\n", "utf-8");

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(true);
		expect(s.staleFiles).toBe(1);
	});

	it("checkStaleness: detects new file as stale after previous index", async () => {
		touch(path.join(repoDir, "existing.ts"), "export const e = 1;\n");

		await index();

		// Add new file
		touch(path.join(repoDir, "new.ts"), "export const n = 2;\n");

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(true);
		expect(s.staleFiles).toBe(1);
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
});

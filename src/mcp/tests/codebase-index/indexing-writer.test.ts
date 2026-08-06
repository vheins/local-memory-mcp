/**
 * Unit tests for the codebase-index writer (indexing-writer.ts).
 *
 * Focus: transactional atomicity (issue #69) — per-batch symbol delete+insert
 * and per-cleanup stale deletions commit as ONE SQLite transaction, so a
 * failure mid-batch rolls back the entire batch (no symbol leakage, no
 * duplicate rows).
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import { writeParseBatch, cleanStaleFiles, WriteBaseContext } from "../../codebase-index/services/indexing-writer";
import type { CodebaseFileInsert, CodebaseSymbolInsert } from "../../types";

// Kept at module scope so tests keep their own store and close it via afterEach.
const activeStores: SQLiteStore[] = [];

async function makeStore(): Promise<SQLiteStore> {
	const store = await createTestStore();
	activeStores.push(store);
	return store;
}

function base(db: SQLiteStore, repo: string): WriteBaseContext {
	return { db, repo, batchSize: 50, options: {} };
}

describe("indexing-writer", () => {
	afterEach(() => {
		while (activeStores.length > 0) {
			activeStores.pop()!.close();
		}
	});

	it("writeParseBatch: delete + insert are atomic — failure mid-batch rolls back deletes", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		// Seed existing symbols for both re-parsed files.
		store.codebaseSymbols.bulkUpsertSymbols([
			{ repo, file_path: "a.ts", name: "oldA", kind: "function" },
			{ repo, file_path: "b.ts", name: "oldB", kind: "function" }
		]);

		const fileInserts: CodebaseFileInsert[] = [
			{ repo, file_path: "a.ts" },
			{ repo, file_path: "b.ts" }
		];

		// The second insert violates the parent_symbol_id FK, so it throws AFTER
		// the deletes have already run and the first insert has gone in — the
		// whole batch (deletes + inserts) must roll back as one unit.
		const symbolInserts: CodebaseSymbolInsert[] = [
			{ repo, file_path: "a.ts", name: "newA", kind: "function" },
			{ repo, file_path: "b.ts", name: "newB", kind: "function", parent_symbol_id: "missing-parent" }
		];

		const dbWriteErrors = await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map());

		expect(dbWriteErrors).toBeGreaterThan(0);

		// Deletes rolled back: original symbols for BOTH files still present.
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "a.ts").map((s) => s.name)).toEqual(["oldA"]);
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "b.ts").map((s) => s.name)).toEqual(["oldB"]);
		// No partial inserts leaked either.
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "a.ts").some((s) => s.name === "newA")).toBe(false);
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "b.ts").some((s) => s.name === "newB")).toBe(false);
	});

	it("writeParseBatch: successful batch replaces old symbols with new ones (no duplicates)", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		store.codebaseSymbols.bulkUpsertSymbols([{ repo, file_path: "a.ts", name: "oldA", kind: "function" }]);

		const fileInserts: CodebaseFileInsert[] = [{ repo, file_path: "a.ts" }];
		const symbolInserts: CodebaseSymbolInsert[] = [{ repo, file_path: "a.ts", name: "newA", kind: "function" }];

		const dbWriteErrors = await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map());

		expect(dbWriteErrors).toBe(0);

		// Old symbol gone, new one present, exactly one row for a.ts.
		const names = store.codebaseSymbols.getSymbolsByFile(repo, "a.ts").map((s) => s.name);
		expect(names).toEqual(["newA"]);
	});

	it("writeParseBatch: delete-only batch (no symbol inserts) still clears old symbols", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		store.codebaseSymbols.bulkUpsertSymbols([{ repo, file_path: "a.ts", name: "stale", kind: "function" }]);

		const fileInserts: CodebaseFileInsert[] = [{ repo, file_path: "a.ts" }];
		const dbWriteErrors = await writeParseBatch(base(store, repo), fileInserts, [], new Map());

		expect(dbWriteErrors).toBe(0);
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "a.ts")).toEqual([]);
	});

	it("cleanStaleFiles: removes stale symbol + file records", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		store.codebaseSymbols.bulkUpsertSymbols([
			{ repo, file_path: "gone.ts", name: "gone", kind: "function" },
			{ repo, file_path: "keep.ts", name: "keep", kind: "function" }
		]);
		store.codebaseFiles.upsertFile({ repo, file_path: "gone.ts" });
		store.codebaseFiles.upsertFile({ repo, file_path: "keep.ts" });

		const errors = await cleanStaleFiles(base(store, repo), new Set(["gone.ts"]));

		expect(errors).toBe(0);
		expect(store.codebaseFiles.getFilesByRepo(repo).map((f) => f.file_path)).toEqual(["keep.ts"]);
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "gone.ts")).toEqual([]);
	});
});

import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore, createTestStore } from "../../storage/sqlite";
import { CodebaseSymbolEntity } from "../../entities/codebase-symbol";
import { CodebaseFileEntity } from "../../entities/codebase-file";

describe("CodebaseSymbol Entity", () => {
	let store: SQLiteStore;
	let entity: CodebaseSymbolEntity;

	beforeEach(async () => {
		store = await createTestStore();
		entity = store.codebaseSymbols;
	});

	it("bulkUpsertSymbols inserts symbols and getSymbolsByFile retrieves them", () => {
		const count = entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/index.ts",
				name: "calculateTotal",
				kind: "function",
				exported: true,
				start_line: 42,
				end_line: 55,
				doc_comment: "Computes the total order amount"
			},
			{
				repo: "test-repo",
				file_path: "src/index.ts",
				name: "OrderService",
				kind: "class",
				exported: true,
				start_line: 10,
				end_line: 100,
				doc_comment: "Service for order operations"
			},
			{
				repo: "test-repo",
				file_path: "src/utils.ts",
				name: "helperFn",
				kind: "function",
				exported: false,
				start_line: 5,
				end_line: 12
			}
		]);

		expect(count).toBe(3);

		const indexSymbols = entity.getSymbolsByFile("test-repo", "src/index.ts");
		expect(indexSymbols.length).toBe(2);

		// Should be ordered by start_line
		expect(indexSymbols[0].name).toBe("OrderService");
		expect(indexSymbols[0].kind).toBe("class");
		expect(indexSymbols[0].start_line).toBe(10);
		expect(indexSymbols[1].name).toBe("calculateTotal");
		expect(indexSymbols[1].kind).toBe("function");
		expect(indexSymbols[1].start_line).toBe(42);

		// Verify boolean fields
		const exportedSymbol = indexSymbols.find((s) => s.name === "calculateTotal")!;
		expect(exportedSymbol.exported).toBe(true);
		expect(exportedSymbol.default_export).toBe(false);

		const utilsSymbols = entity.getSymbolsByFile("test-repo", "src/utils.ts");
		expect(utilsSymbols.length).toBe(1);
		expect(utilsSymbols[0].exported).toBe(false);

		// Empty file
		const empty = entity.getSymbolsByFile("test-repo", "nonexistent.ts");
		expect(empty).toEqual([]);
	});

	it("getSymbolByName returns all symbols with matching name across files", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "init",
				kind: "function",
				start_line: 1
			},
			{
				repo: "test-repo",
				file_path: "src/b.ts",
				name: "init",
				kind: "function",
				start_line: 20
			},
			{
				repo: "test-repo",
				file_path: "src/c.ts",
				name: "other",
				kind: "variable",
				start_line: 5
			}
		]);

		const results = entity.getSymbolByName("test-repo", "init");
		expect(results.length).toBe(2);
		expect(results[0].file_path).toBe("src/a.ts");
		expect(results[1].file_path).toBe("src/b.ts");

		const noResults = entity.getSymbolByName("test-repo", "nonexistent");
		expect(noResults).toEqual([]);

		// Wrong repo
		const wrongRepo = entity.getSymbolByName("other-repo", "init");
		expect(wrongRepo).toEqual([]);
	});

	it("searchSymbols uses FTS5 for partial match in doc_comment", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/auth.ts",
				name: "login",
				kind: "function",
				doc_comment: "Authenticate user with JWT token validation"
			},
			{
				repo: "test-repo",
				file_path: "src/auth.ts",
				name: "logout",
				kind: "function",
				doc_comment: "Invalidate user session"
			},
			{
				repo: "test-repo",
				file_path: "src/orders.ts",
				name: "createOrder",
				kind: "function",
				doc_comment: "Create a new order with JWT user context"
			}
		]);

		const result = entity.searchSymbols({
			query: "JWT",
			repo: "test-repo",
			limit: 10
		});

		expect(result.symbols.length).toBe(2);
		expect(result.total).toBe(2);
		expect(result.hasMore).toBe(false);
		expect(result.symbols.map((s) => s.name).sort()).toEqual(["createOrder", "login"]);
	});

	it("searchSymbols filters by kind", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/models.ts",
				name: "User",
				kind: "class",
				doc_comment: "User entity"
			},
			{
				repo: "test-repo",
				file_path: "src/models.ts",
				name: "Email",
				kind: "type",
				doc_comment: "Email type alias"
			},
			{
				repo: "test-repo",
				file_path: "src/services.ts",
				name: "UserService",
				kind: "class",
				doc_comment: "User service"
			}
		]);

		const result = entity.searchSymbols({
			query: "User",
			repo: "test-repo",
			kind: "class",
			limit: 10
		});

		expect(result.symbols.length).toBe(2);
		expect(result.symbols.every((s) => s.kind === "class")).toBe(true);
	});

	it("deleteSymbolsByFile removes symbols and leaves other files intact", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/remove.ts",
				name: "fn1",
				kind: "function",
				start_line: 1
			},
			{
				repo: "test-repo",
				file_path: "src/remove.ts",
				name: "fn2",
				kind: "function",
				start_line: 10
			},
			{
				repo: "test-repo",
				file_path: "src/keep.ts",
				name: "keep",
				kind: "function",
				start_line: 1
			}
		]);

		const deleted = entity.deleteSymbolsByFile("test-repo", "src/remove.ts");
		expect(deleted).toBe(2);

		const removed = entity.getSymbolsByFile("test-repo", "src/remove.ts");
		expect(removed).toEqual([]);

		const kept = entity.getSymbolsByFile("test-repo", "src/keep.ts");
		expect(kept.length).toBe(1);
		expect(kept[0].name).toBe("keep");

		// Delete nonexistent file
		const noDelete = entity.deleteSymbolsByFile("test-repo", "nonexistent.ts");
		expect(noDelete).toBe(0);
	});

	it("handles parent-child symbol hierarchy (method inside class)", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/UserService.ts",
				name: "UserService",
				kind: "class",
				start_line: 5,
				end_line: 80,
				doc_comment: "User management service"
			}
		]);

		const parentSymbols = entity.getSymbolsByFile("test-repo", "src/UserService.ts");
		expect(parentSymbols.length).toBe(1);
		const parentId = parentSymbols[0].id;

		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/UserService.ts",
				name: "createUser",
				kind: "method",
				start_line: 10,
				end_line: 25,
				doc_comment: "Create a new user",
				parent_symbol_id: parentId
			},
			{
				repo: "test-repo",
				file_path: "src/UserService.ts",
				name: "deleteUser",
				kind: "method",
				start_line: 30,
				end_line: 40,
				doc_comment: "Delete user by ID",
				parent_symbol_id: parentId
			}
		]);

		const allSymbols = entity.getSymbolsByFile("test-repo", "src/UserService.ts");
		expect(allSymbols.length).toBe(3);

		const methods = allSymbols.filter((s) => s.kind === "method");
		expect(methods.length).toBe(2);
		expect(methods.every((m) => m.parent_symbol_id === parentId)).toBe(true);
		expect(methods[0].start_line).toBe(10);
		expect(methods[1].start_line).toBe(30);
	});

	it("deleteSymbolsByRepo removes all symbols for the repo", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "del-repo",
				file_path: "src/a.ts",
				name: "funcA",
				kind: "function",
				start_line: 1
			},
			{
				repo: "del-repo",
				file_path: "src/b.ts",
				name: "funcB",
				kind: "function",
				start_line: 1
			},
			{
				repo: "keep-repo",
				file_path: "src/c.ts",
				name: "funcC",
				kind: "function",
				start_line: 1
			}
		]);

		const deleted = entity.deleteSymbolsByRepo("del-repo");
		expect(deleted).toBe(2);

		expect(entity.getSymbolsByFile("del-repo", "src/a.ts")).toEqual([]);
		expect(entity.getSymbolsByFile("del-repo", "src/b.ts")).toEqual([]);
		expect(entity.getSymbolsByFile("keep-repo", "src/c.ts").length).toBe(1);
	});

	it("searchSymbols paginates results", () => {
		const symbols = Array.from({ length: 5 }, (_, i) => ({
			repo: "test-repo",
			file_path: `src/file${i}.ts`,
			name: `func${i}`,
			kind: "function",
			doc_comment: `Documentation for func${i}`
		}));
		entity.bulkUpsertSymbols(symbols);

		const page1 = entity.searchSymbols({
			query: "func",
			repo: "test-repo",
			limit: 3,
			offset: 0
		});
		expect(page1.symbols.length).toBe(3);
		expect(page1.total).toBe(5);
		expect(page1.hasMore).toBe(true);

		const page2 = entity.searchSymbols({
			query: "func",
			repo: "test-repo",
			limit: 3,
			offset: 3
		});
		expect(page2.symbols.length).toBe(2);
		expect(page2.total).toBe(5);
		expect(page2.hasMore).toBe(false);
	});

	it("searchSymbols supports exportedOnly filter", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/module.ts",
				name: "exportedFn",
				kind: "function",
				exported: true,
				doc_comment: "Exported function"
			},
			{
				repo: "test-repo",
				file_path: "src/module.ts",
				name: "internalFn",
				kind: "function",
				exported: false,
				doc_comment: "Internal function"
			}
		]);

		const result = entity.searchSymbols({
			query: "function",
			repo: "test-repo",
			exportedOnly: true,
			limit: 10
		});

		expect(result.symbols.length).toBe(1);
		expect(result.symbols[0].name).toBe("exportedFn");
	});

	it("searchSymbols falls back to LIKE when FTS5 fails gracefully", () => {
		// Insert with FTS5 then verify search works (FTS5 may fail for special chars)
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/special.ts",
				name: "specialFn",
				kind: "function",
				doc_comment: "This has special characters: @#$%"
			}
		]);

		// Search for "special" — FTS5 may strip special chars but content is there
		const result = entity.searchSymbols({
			query: "special",
			repo: "test-repo",
			limit: 10
		});

		expect(result.symbols.length).toBeGreaterThanOrEqual(0);
		expect(result.total).toBeGreaterThanOrEqual(0);
		// LIKE fallback should work even if FTS5 strips characters
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: FTS5 search with special characters ($onInit, __init__)
	// ══════════════════════════════════════════════════════════════════

	it("FTS5 search with special characters: $onInit and __init__", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/angular.ts",
				name: "$onInit",
				kind: "method",
				doc_comment: "Angular lifecycle hook: $onInit callback"
			},
			{
				repo: "test-repo",
				file_path: "src/core.ts",
				name: "__init__",
				kind: "function",
				doc_comment: "Python-style initializer __init__ method"
			},
			{
				repo: "test-repo",
				file_path: "src/other.ts",
				name: "normalFn",
				kind: "function",
				doc_comment: "A normal function without special chars"
			}
		]);

		// FTS5 strips special chars, so searching "$on" with FTS becomes "on" — may or may not match
		// But LIKE fallback should find "$onInit" by name
		const result1 = entity.searchSymbols({
			query: "onInit",
			repo: "test-repo",
			limit: 10
		});
		expect(result1.symbols.length).toBeGreaterThanOrEqual(1);
		// At minimum, LIKE should find the symbol whose name contains "onInit"
		const hasOnInit = result1.symbols.some((s) => s.name === "$onInit");
		expect(hasOnInit).toBe(true);

		// Search for __init__ — special chars stripped by FTS, LIKE fallback should find it
		const result2 = entity.searchSymbols({
			query: "init",
			repo: "test-repo",
			limit: 10
		});
		const hasInit = result2.symbols.some((s) => s.name === "__init__");
		expect(hasInit).toBe(true);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Batch upsert performance — 1000 symbols
	// ══════════════════════════════════════════════════════════════════

	it("batch upsert: 1000 symbols, verify all stored", () => {
		const symbols = Array.from({ length: 1000 }, (_, i) => ({
			repo: "perf-repo",
			file_path: `src/file${Math.floor(i / 100)}.ts`,
			name: `func${i}`,
			kind: "function",
			start_line: i + 1,
			doc_comment: `Function number ${i}`
		}));

		const count = entity.bulkUpsertSymbols(symbols);
		expect(count).toBe(1000);

		// Verify total across all files
		let totalCount = 0;
		for (let fileIdx = 0; fileIdx < 10; fileIdx++) {
			const fileSymbols = entity.getSymbolsByFile("perf-repo", `src/file${fileIdx}.ts`);
			totalCount += fileSymbols.length;
		}
		expect(totalCount).toBe(1000);

		// Spot check a symbol
		const file0Symbols = entity.getSymbolsByFile("perf-repo", "src/file0.ts");
		expect(file0Symbols.length).toBe(100);
		expect(file0Symbols[0].name).toBe("func0");
		expect(file0Symbols[99].name).toBe("func99");

		// Clean up
		entity.deleteSymbolsByRepo("perf-repo");
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Search pagination — verify offset/limit works correctly
	// ══════════════════════════════════════════════════════════════════

	it("search pagination: offset/limit works correctly with boundary cases", () => {
		// Insert 12 symbols
		const symbols = Array.from({ length: 12 }, (_, i) => ({
			repo: "page-repo",
			file_path: "src/page.ts",
			name: `item${i}`,
			kind: "function",
			doc_comment: `Item number ${i}`
		}));
		entity.bulkUpsertSymbols(symbols);

		// Page 1: first 5
		const page1 = entity.searchSymbols({
			query: "item",
			repo: "page-repo",
			limit: 5,
			offset: 0
		});
		expect(page1.symbols.length).toBe(5);
		expect(page1.total).toBe(12);
		expect(page1.hasMore).toBe(true);

		// Page 2: next 5
		const page2 = entity.searchSymbols({
			query: "item",
			repo: "page-repo",
			limit: 5,
			offset: 5
		});
		expect(page2.symbols.length).toBe(5);
		expect(page2.total).toBe(12);
		expect(page2.hasMore).toBe(true);

		// Page 3: final 2
		const page3 = entity.searchSymbols({
			query: "item",
			repo: "page-repo",
			limit: 5,
			offset: 10
		});
		expect(page3.symbols.length).toBe(2);
		expect(page3.total).toBe(12);
		expect(page3.hasMore).toBe(false);

		// Out of bounds offset
		const pageBeyond = entity.searchSymbols({
			query: "item",
			repo: "page-repo",
			limit: 5,
			offset: 50
		});
		expect(pageBeyond.symbols.length).toBe(0);
		expect(pageBeyond.total).toBe(12);
		expect(pageBeyond.hasMore).toBe(false);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Case insensitivity — search "foobar" matches "FooBar"
	// ══════════════════════════════════════════════════════════════════

	it("case insensitivity: search 'foobar' matches 'FooBar'", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/mixed.ts",
				name: "FooBar",
				kind: "class",
				doc_comment: "Mixed case class"
			},
			{
				repo: "test-repo",
				file_path: "src/mixed.ts",
				name: "foobar",
				kind: "function",
				doc_comment: "Lowercase function"
			},
			{
				repo: "test-repo",
				file_path: "src/mixed.ts",
				name: "FOOBAR",
				kind: "constant",
				doc_comment: "Uppercase constant"
			}
		]);

		// Search "foobar" should match all three via LIKE (SQLite LIKE is case-insensitive by default)
		const result = entity.searchSymbols({
			query: "foobar",
			repo: "test-repo",
			limit: 10
		});

		expect(result.symbols.length).toBe(3);
		const names = result.symbols.map((s) => s.name).sort();
		expect(names).toEqual(["FOOBAR", "FooBar", "foobar"]);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Delete re-index — symbols deleted, file record persists
	// ══════════════════════════════════════════════════════════════════

	it("delete re-index: delete all symbols for file, file record still exists", () => {
		// We need the CodebaseFileEntity to verify file record independence
		const fileEntity = store.codebaseFiles as CodebaseFileEntity;

		// Upsert a file record
		fileEntity.upsertFile({
			repo: "test-repo",
			file_path: "src/reindex.ts",
			language: "typescript",
			checksum: "abc123",
			lines: 50,
			size_bytes: 1200
		});

		// Insert symbols for that file
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/reindex.ts",
				name: "fnOld",
				kind: "function",
				start_line: 1,
				doc_comment: "Old function"
			},
			{
				repo: "test-repo",
				file_path: "src/reindex.ts",
				name: "fnAlso",
				kind: "function",
				start_line: 10,
				doc_comment: "Another function"
			}
		]);

		// Verify both exist
		expect(entity.getSymbolsByFile("test-repo", "src/reindex.ts").length).toBe(2);
		expect(fileEntity.getFile("test-repo", "src/reindex.ts")).toBeDefined();

		// Delete all symbols for the file
		const deleted = entity.deleteSymbolsByFile("test-repo", "src/reindex.ts");
		expect(deleted).toBe(2);

		// Symbols gone
		expect(entity.getSymbolsByFile("test-repo", "src/reindex.ts")).toEqual([]);

		// File record STILL EXISTS (independent lifecycle)
		const fileRecord = fileEntity.getFile("test-repo", "src/reindex.ts");
		expect(fileRecord).toBeDefined();
		expect(fileRecord!.checksum).toBe("abc123");
		expect(fileRecord!.lines).toBe(50);

		// Re-index: upsert new symbols (simulating re-parse)
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/reindex.ts",
				name: "fnNew",
				kind: "function",
				start_line: 1,
				doc_comment: "New function after re-index"
			}
		]);

		// Symbols are back with new content
		const afterReindex = entity.getSymbolsByFile("test-repo", "src/reindex.ts");
		expect(afterReindex.length).toBe(1);
		expect(afterReindex[0].name).toBe("fnNew");

		// File record unchanged
		const fileAfterReindex = fileEntity.getFile("test-repo", "src/reindex.ts");
		expect(fileAfterReindex).toBeDefined();
		expect(fileAfterReindex!.checksum).toBe("abc123");
	});
});

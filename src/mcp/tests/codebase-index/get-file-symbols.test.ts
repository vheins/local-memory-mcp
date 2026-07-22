/**
 * get_file_symbols Tool Handler Tests.
 *
 * Tests the MCP tool handler for get_file_symbols,
 * covering positive paths, error cases, and ordering.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { handleGetFileSymbols } from "../../tools/codebase-index";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";

// ── No-op vector store ──────────────────────────────────────────────────

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

// ── Helpers ─────────────────────────────────────────────────────────────

function seedFile(store: SQLiteStore, repo: string, filePath: string): void {
	store.codebaseFiles.upsertFile({
		repo,
		file_path: filePath,
		language: "typescript",
		checksum: "abc123",
		lines: 200,
		size_bytes: 4096
	});
}

function seedSymbols(
	store: SQLiteStore,
	symbols: Array<{
		repo: string;
		file_path: string;
		name: string;
		kind: string;
		exported?: boolean;
		start_line?: number;
		end_line?: number;
		doc_comment?: string;
		signature?: string;
		parent_symbol_id?: string;
	}>
): void {
	store.codebaseSymbols.bulkUpsertSymbols(symbols);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("handleGetFileSymbols", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	it("returns symbols for a known file in declaration order", async () => {
		const repo = "test/repo";
		const filePath = "src/services/order.ts";

		seedFile(store, repo, filePath);
		seedSymbols(store, [
			{
				repo,
				file_path: filePath,
				name: "OrderService",
				kind: "class",
				exported: true,
				start_line: 10,
				end_line: 120,
				doc_comment: "Handles order lifecycle",
				signature: "class OrderService"
			},
			{
				repo,
				file_path: filePath,
				name: "calculateTotal",
				kind: "function",
				exported: false,
				start_line: 45,
				end_line: 78,
				doc_comment: "Calculates total amount",
				signature: "function calculateTotal(items: Item[]): number"
			},
			{
				repo,
				file_path: filePath,
				name: "TAX_RATE",
				kind: "constant",
				exported: true,
				start_line: 5,
				end_line: 5,
				signature: "TAX_RATE = 0.15"
			}
		]);

		const response = await handleGetFileSymbols({ repo, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.file).toBeDefined();
		expect((data.file as Record<string, unknown>).path).toBe(filePath);
		expect((data.file as Record<string, unknown>).language).toBe("typescript");
		expect((data.file as Record<string, unknown>).checksum).toBe("abc123");
		expect((data.file as Record<string, unknown>).lines).toBe(200);
		expect((data.file as Record<string, unknown>).sizeBytes).toBe(4096);
		expect((data.file as Record<string, unknown>).lastIndexedAt).toBeTruthy();

		expect(data.total).toBe(3);

		const symbols = data.symbols as Array<Record<string, unknown>>;
		expect(symbols.length).toBe(3);

		// Symbols must be in declaration order (by start_line)
		expect(symbols[0].name).toBe("TAX_RATE");
		expect(symbols[0].start_line).toBe(5);
		expect(symbols[1].name).toBe("OrderService");
		expect(symbols[1].start_line).toBe(10);
		expect(symbols[2].name).toBe("calculateTotal");
		expect(symbols[2].start_line).toBe(45);

		// Verify all symbol fields present
		const firstSym = symbols[0];
		expect(firstSym.id).toBeTruthy();
		expect(firstSym.repo).toBe(repo);
		expect(firstSym.file_path).toBe(filePath);
		expect(firstSym.name).toBe("TAX_RATE");
		expect(firstSym.kind).toBe("constant");
		expect(firstSym.exported).toBe(true);
		expect(firstSym.default_export).toBe(false);
		expect(firstSym.signature).toBe("TAX_RATE = 0.15");
	});

	it("returns error for a non-indexed file", async () => {
		const repo = "test/repo";
		const filePath = "src/ghost.ts";

		const response = await handleGetFileSymbols({ repo, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBe("File not indexed. Run index_repository first.");
		expect(data.code).toBe("FILE_NOT_INDEXED");
	});

	it("returns error for a file in a different repo", async () => {
		const repoA = "repo/a";
		const repoB = "repo/b";
		const filePath = "src/shared.ts";

		seedFile(store, repoA, filePath);
		seedSymbols(store, [
			{ repo: repoA, file_path: filePath, name: "sharedFn", kind: "function", start_line: 1, end_line: 5 }
		]);

		const response = await handleGetFileSymbols({ repo: repoB, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBe("File not indexed. Run index_repository first.");
		expect(data.code).toBe("FILE_NOT_INDEXED");
	});

	it("returns symbols with parent_symbol_id for nested declarations", async () => {
		const repo = "test/repo";
		const filePath = "src/container.ts";

		seedFile(store, repo, filePath);
		seedSymbols(store, [
			{
				repo,
				file_path: filePath,
				name: "Container",
				kind: "class",
				exported: true,
				start_line: 1,
				end_line: 50
			}
		]);

		// Fetch the parent symbol ID to reference it
		const parentSymbols = store.codebaseSymbols.getSymbolsByFile(repo, filePath);
		const parentId = parentSymbols[0].id;

		seedSymbols(store, [
			{
				repo,
				file_path: filePath,
				name: "resolve",
				kind: "method",
				start_line: 10,
				end_line: 20,
				parent_symbol_id: parentId,
				signature: "resolve<T>(token: string): T"
			}
		]);

		const response = await handleGetFileSymbols({ repo, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.total).toBe(2);

		const symbols = data.symbols as Array<Record<string, unknown>>;
		expect(symbols[0].name).toBe("Container");
		expect(symbols[0].parent_symbol_id).toBeNull();

		expect(symbols[1].name).toBe("resolve");
		expect(symbols[1].kind).toBe("method");
		expect(symbols[1].parent_symbol_id).toBe(parentId);
		expect(symbols[1].signature).toBe("resolve<T>(token: string): T");
	});

	it("returns empty symbols array for file with no symbols", async () => {
		const repo = "test/repo";
		const filePath = "src/empty.ts";

		seedFile(store, repo, filePath);

		const response = await handleGetFileSymbols({ repo, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.file).toBeDefined();
		expect(data.total).toBe(0);
		expect(data.symbols).toEqual([]);
	});

	it("throws on missing repo param", async () => {
		await expect(handleGetFileSymbols({ filePath: "src/test.ts" }, store, vectors)).rejects.toThrow();
	});

	it("throws on missing filePath param", async () => {
		await expect(handleGetFileSymbols({ repo: "test/repo" }, store, vectors)).rejects.toThrow();
	});

	it("throws on empty repo", async () => {
		await expect(handleGetFileSymbols({ repo: "", filePath: "src/test.ts" }, store, vectors)).rejects.toThrow();
	});

	it("throws on empty filePath", async () => {
		await expect(handleGetFileSymbols({ repo: "test/repo", filePath: "" }, store, vectors)).rejects.toThrow();
	});
});

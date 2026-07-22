/**
 * trace_symbol Tool Handler Tests.
 *
 * Tests the MCP tool handler for trace_symbol,
 * covering definition lookup, disambiguation, error cases,
 * and references inclusion/exclusion.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { handleTraceSymbol } from "../../tools/codebase-index";
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

function seedSymbols(
	store: SQLiteStore,
	symbols: Array<{
		repo: string;
		file_path: string;
		name: string;
		kind: string;
		exported?: boolean;
		default_export?: boolean;
		start_line?: number;
		start_col?: number;
		end_line?: number;
		end_col?: number;
		doc_comment?: string;
		signature?: string;
		parent_symbol_id?: string;
	}>
): void {
	store.codebaseSymbols.bulkUpsertSymbols(symbols);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("handleTraceSymbol", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;
	const repo = "test-owner/test-repo";

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	it("returns definition for a known symbol", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 42,
				start_col: 0,
				end_line: 55,
				end_col: 1,
				signature: "function authenticate(token: string): User"
			}
		]);

		const response = await handleTraceSymbol({ name: "authenticate", repo }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbol).toBeDefined();
		expect((data.symbol as Record<string, unknown>).name).toBe("authenticate");
		expect(data.definition).toEqual({
			file: "src/services/auth.ts",
			line: 42,
			column: 0
		});
		expect(data.exportChain).toEqual({
			exported: true,
			defaultExport: false
		});
	});

	it("returns disambiguation for ambiguous names", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				doc_comment: "Authenticate a user token"
			},
			{
				repo,
				file_path: "src/legacy/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: false,
				start_line: 10,
				start_col: 0,
				doc_comment: "Legacy authentication"
			}
		]);

		const response = await handleTraceSymbol({ name: "authenticate", repo }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeDefined();
		expect(data.code).toBe("AMBIGUOUS_SYMBOL");

		const disamb = data.disambiguation as Array<Record<string, unknown>>;
		expect(disamb.length).toBe(2);
		expect(disamb.map((s) => s.file)).toContain("src/services/auth.ts");
		expect(disamb.map((s) => s.file)).toContain("src/legacy/auth.ts");
	});

	it("returns error for non-existent symbol", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				start_line: 42,
				start_col: 0
			}
		]);

		const response = await handleTraceSymbol({ name: "nonexistent", repo }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toContain("nonexistent");
		expect(data.code).toBe("SYMBOL_NOT_FOUND");
	});

	it("references included when flag is true", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				doc_comment: "Main authentication function"
			},
			{
				repo,
				file_path: "src/middleware/auth-middleware.ts",
				name: "authMiddleware",
				kind: "function",
				start_line: 15,
				start_col: 0,
				doc_comment: "Middleware that uses authenticate for request validation"
			},
			{
				repo,
				file_path: "src/services/session.ts",
				name: "refreshSession",
				kind: "function",
				start_line: 80,
				start_col: 0,
				signature: "function refreshSession(auth: typeof authenticate)"
			}
		]);

		const response = await handleTraceSymbol({ name: "authenticate", repo, includeReferences: true }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbol).toBeDefined();

		const refs = data.references as Array<Record<string, unknown>>;
		expect(refs.length).toBeGreaterThanOrEqual(1);

		// At least one reference from auth-middleware.ts doc comment
		const middlewareRef = refs.find((r) => r.filePath === "src/middleware/auth-middleware.ts");
		expect(middlewareRef).toBeDefined();
		expect(middlewareRef!.context).toContain("authenticate");
	});

	it("references excluded when flag is false", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				doc_comment: "Main authentication function"
			},
			{
				repo,
				file_path: "src/middleware/auth-middleware.ts",
				name: "authMiddleware",
				kind: "function",
				start_line: 15,
				start_col: 0,
				doc_comment: "Middleware that uses authenticate for request validation"
			}
		]);

		const response = await handleTraceSymbol({ name: "authenticate", repo, includeReferences: false }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbol).toBeDefined();

		const refs = data.references as Array<unknown>;
		expect(refs).toEqual([]);
	});
});

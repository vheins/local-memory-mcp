/**
 * search_symbols MCP Tool Tests.
 *
 * Tests the handleSearchSymbols handler with mock data covering
 * exact match, prefix search, kind filter, repo scope, pagination,
 * min-length requirement, non-existent symbols, and exported-only filter.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleSearchSymbols } from "../../tools/codebase-index";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";

// ── Helpers ──────────────────────────────────────────────────────────────

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

/** Insert test symbols that exercise all ranking tiers and filter combinations. */
function seedSymbols(store: SQLiteStore): void {
	store.codebaseSymbols.bulkUpsertSymbols([
		// Tier 1: exact match candidate
		{
			repo: "test-owner/test-repo",
			file_path: "src/core.ts",
			name: "createUser",
			kind: "function",
			exported: true,
			start_line: 10,
			doc_comment: "Creates a new user"
		},
		// Tier 3: prefix match
		{
			repo: "test-owner/test-repo",
			file_path: "src/core.ts",
			name: "createAccount",
			kind: "function",
			exported: true,
			start_line: 30,
			doc_comment: "Creates an account"
		},
		// Tier 4: substring (contains "User" somewhere)
		{
			repo: "test-owner/test-repo",
			file_path: "src/utils.ts",
			name: "deleteUser",
			kind: "function",
			exported: true,
			start_line: 5,
			doc_comment: "Deletes a user"
		},
		// Tier 5: FTS5/doc_comment match
		{
			repo: "test-owner/test-repo",
			file_path: "src/helpers.ts",
			name: "processRequest",
			kind: "function",
			exported: false,
			start_line: 1,
			doc_comment: "Processes user input safely"
		},
		// Non-exported
		{
			repo: "test-owner/test-repo",
			file_path: "src/internal.ts",
			name: "internalHelper",
			kind: "function",
			exported: false,
			start_line: 1
		},
		// class kind
		{
			repo: "test-owner/test-repo",
			file_path: "src/models.ts",
			name: "UserModel",
			kind: "class",
			exported: true,
			start_line: 1,
			doc_comment: "User database model"
		},
		// interface kind
		{
			repo: "test-owner/test-repo",
			file_path: "src/types.ts",
			name: "UserConfig",
			kind: "interface",
			exported: true,
			start_line: 1,
			doc_comment: "Configuration for user"
		},
		// Different repo
		{
			repo: "other-org/other-repo",
			file_path: "src/main.ts",
			name: "createUser",
			kind: "function",
			exported: true,
			start_line: 1,
			doc_comment: "Create user in other repo"
		}
	]);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("handleSearchSymbols", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
		seedSymbols(store);
	});

	afterEach(() => {
		store.close();
	});

	it("returns exact match when searching by exact name", async () => {
		const response = await handleSearchSymbols({ query: "createUser", repo: "test-owner/test-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(data.total as number).toBeGreaterThanOrEqual(1);
		// Exact matches should appear first
		expect(symbols[0].name).toBe("createUser");
		expect(symbols[0].rankTier).toBe(1); // Tier.Exact
		expect(typeof symbols[0].score).toBe("number");
	});

	it("returns prefix-ranked results for partial name search", async () => {
		const response = await handleSearchSymbols({ query: "create", repo: "test-owner/test-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(data.total as number).toBeGreaterThanOrEqual(2);
		// createUser should rank above createAccount (both prefix, but exported tiebreaker resolves alphabetically)
		// Actually they're both exported and both in src/core.ts, so alphabetical: createAccount < createUser
		// The ranker scores them equally and breaks ties alphabetically ascending
		expect(symbols[0].name).toBe("createAccount");
		expect(symbols[1].name).toBe("createUser");
	});

	it("filters by kind", async () => {
		const response = await handleSearchSymbols(
			{ query: "User", repo: "test-owner/test-repo", kind: "class" },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(symbols.length).toBe(1);
		expect(symbols[0].name).toBe("UserModel");
		expect(symbols[0].kind).toBe("class");
	});

	it("scopes results to the specified repo", async () => {
		const response = await handleSearchSymbols({ query: "createUser", repo: "other-org/other-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(data.total as number).toBe(1);
		expect(symbols[0].repo).toBe("other-org/other-repo");
	});

	it("returns empty for queries under 2 characters", async () => {
		const response = await handleSearchSymbols({ query: "c", repo: "test-owner/test-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(data.total as number).toBe(0);
		expect(symbols.length).toBe(0);
	});

	it("returns empty for empty query string", async () => {
		const response = await handleSearchSymbols({ query: "", repo: "test-owner/test-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.total as number).toBe(0);
	});

	it("supports pagination with offset and limit", async () => {
		// Without filters, search for "User" — should match many
		const response = await handleSearchSymbols(
			{ query: "User", repo: "test-owner/test-repo", limit: 2, offset: 1 },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(symbols.length).toBeLessThanOrEqual(2);
		expect(data.hasMore as boolean).toBe(true);
		expect(data.offset as number).toBe(1);
		expect(data.limit as number).toBe(2);

		// Second page should start at offset 3 (4 total, page 1 = indices 1-2, page 2 = index 3)
		const response2 = await handleSearchSymbols(
			{ query: "User", repo: "test-owner/test-repo", limit: 2, offset: 3 },
			store,
			vectors
		);
		const data2 = response2.structuredContent as Record<string, unknown>;
		const symbols2 = data2.symbols as Array<Record<string, unknown>>;

		// Ensure no overlap between pages
		const page1Names = symbols.map((s: Record<string, unknown>) => s.name);
		const page2Names = symbols2.map((s: Record<string, unknown>) => s.name);
		for (const name of page2Names) {
			expect(page1Names).not.toContain(name);
		}
		// Page 2 should tell us there are no more results
		expect(data2.hasMore as boolean).toBe(false);
	});

	it("returns empty result for non-existent symbol", async () => {
		const response = await handleSearchSymbols(
			{ query: "NonExistentSymbol", repo: "test-owner/test-repo" },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.total as number).toBe(0);
		expect((data.symbols as Array<unknown>).length).toBe(0);
		expect(data.hasMore as boolean).toBe(false);
	});

	it("filters by exportedOnly", async () => {
		const response = await handleSearchSymbols(
			{ query: "Process", repo: "test-owner/test-repo", exportedOnly: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		// processRequest is NOT exported, so it should be filtered out
		for (const sym of symbols) {
			expect(sym.exported).toBe(true);
		}
	});
});

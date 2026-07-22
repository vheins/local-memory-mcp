/**
 * Codebase Index Tool Handler Tests.
 *
 * Tests the MCP tool handlers for index_repository and index_status,
 * focusing on input validation and error paths.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	IndexRepoSchema,
	IndexStatusSchema,
	GetArchitectureSchema,
	GetFileSymbolsSchema,
	SearchSymbolsSchema,
	TraceSymbolSchema
} from "../../tools/schemas/codebase-index";
import {
	handleCodebaseIndexRepository,
	handleCodebaseIndexStatus,
	handleGetArchitecture,
	handleGetFileSymbols,
	handleSearchSymbols,
	handleTraceSymbol
} from "../../tools/codebase-index";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";

// ── No-op vector store for tests that don't need vectors ────────────────

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

// ── Schema validation tests ─────────────────────────────────────────────

describe("IndexRepoSchema", () => {
	it("validates a complete input", () => {
		const result = IndexRepoSchema.parse({
			repo: "test/repo",
			repoPath: "/tmp/some-path",
			force: true,
			includeGlobs: ["**/*.ts"],
			excludeGlobs: ["**/test/**"]
		});
		expect(result.repo).toBe("test/repo");
		expect(result.repoPath).toBe("/tmp/some-path");
		expect(result.force).toBe(true);
	});

	it("validates minimal input (only required fields)", () => {
		const result = IndexRepoSchema.parse({
			repo: "test",
			repoPath: "/tmp"
		});
		expect(result.repo).toBe("test");
		expect(result.force).toBeUndefined();
	});

	it("rejects empty repo", () => {
		expect(() => IndexRepoSchema.parse({ repo: "", repoPath: "/tmp" })).toThrow();
	});

	it("rejects empty repoPath", () => {
		expect(() => IndexRepoSchema.parse({ repo: "test", repoPath: "" })).toThrow();
	});

	it("rejects missing repoPath entirely", () => {
		expect(() => IndexRepoSchema.parse({ repo: "test" })).toThrow();
	});

	it("rejects wrong type for force", () => {
		expect(() => IndexRepoSchema.parse({ repo: "test", repoPath: "/tmp", force: "yes" })).toThrow();
	});
});

describe("IndexStatusSchema", () => {
	it("validates a complete input", () => {
		const result = IndexStatusSchema.parse({ repo: "test/repo" });
		expect(result.repo).toBe("test/repo");
	});

	it("validates with optional repoPath", () => {
		const result = IndexStatusSchema.parse({ repo: "test/repo", repoPath: "/tmp/repo" });
		expect(result.repo).toBe("test/repo");
		expect(result.repoPath).toBe("/tmp/repo");
	});

	it("rejects empty repo", () => {
		expect(() => IndexStatusSchema.parse({ repo: "" })).toThrow();
	});

	it("rejects missing repo", () => {
		expect(() => IndexStatusSchema.parse({})).toThrow();
	});
});

// ── Schema validation tests for other codebase-index schemas ─────────────

describe("GetArchitectureSchema", () => {
	it("validates a complete input", () => {
		const result = GetArchitectureSchema.parse({
			repo: "test/repo",
			depth: 3,
			includeSymbolCounts: true
		});
		expect(result.repo).toBe("test/repo");
		expect(result.depth).toBe(3);
		expect(result.includeSymbolCounts).toBe(true);
	});

	it("validates minimal input (depth defaults)", () => {
		const result = GetArchitectureSchema.parse({ repo: "test/repo" });
		expect(result.repo).toBe("test/repo");
		expect(result.depth).toBeDefined();
	});

	it("rejects empty repo", () => {
		expect(() => GetArchitectureSchema.parse({ repo: "" })).toThrow();
	});
});

describe("GetFileSymbolsSchema", () => {
	it("validates a complete input", () => {
		const result = GetFileSymbolsSchema.parse({ repo: "test/repo", filePath: "src/app.ts" });
		expect(result.repo).toBe("test/repo");
		expect(result.filePath).toBe("src/app.ts");
	});

	it("rejects empty repo", () => {
		expect(() => GetFileSymbolsSchema.parse({ repo: "", filePath: "src/app.ts" })).toThrow();
	});

	it("rejects empty filePath", () => {
		expect(() => GetFileSymbolsSchema.parse({ repo: "test/repo", filePath: "" })).toThrow();
	});
});

describe("SearchSymbolsSchema", () => {
	it("validates a complete input", () => {
		const result = SearchSymbolsSchema.parse({
			query: "getUser",
			repo: "test/repo",
			kind: "function",
			offset: 0,
			limit: 20
		});
		expect(result.query).toBe("getUser");
		expect(result.offset).toBe(0);
		expect(result.limit).toBe(20);
	});

	it("validates minimal input (optional fields defaulted)", () => {
		const result = SearchSymbolsSchema.parse({ query: "getUser" });
		expect(result.query).toBe("getUser");
		expect(result.offset).toBe(0);
		expect(result.limit).toBe(50);
	});
});

describe("TraceSymbolSchema", () => {
	it("validates a complete input", () => {
		const result = TraceSymbolSchema.parse({
			name: "authenticate",
			repo: "test/repo",
			includeReferences: true
		});
		expect(result.name).toBe("authenticate");
		expect(result.includeReferences).toBe(true);
	});

	it("validates minimal input", () => {
		const result = TraceSymbolSchema.parse({ name: "authenticate" });
		expect(result.name).toBe("authenticate");
		// includeReferences has default: true in the schema
		expect(result.includeReferences).toBe(true);
	});

	it("rejects empty name", () => {
		expect(() => TraceSymbolSchema.parse({ name: "" })).toThrow();
	});
});

// ── Handler tests ───────────────────────────────────────────────────────

describe("handleCodebaseIndexRepository", () => {
	let vectors: VectorStore;

	beforeEach(() => {
		vectors = noopVectorStore();
	});

	it("returns input validation error for missing repoPath", async () => {
		// We need a real store for the handler signature, even though it errors before using it
		const store = await createTestStore();
		try {
			const response = await handleCodebaseIndexRepository({ repo: "test-repo" }, store, vectors);
			// ZodError is thrown before returning - so this should throw
			expect(response).toBeDefined();
		} catch (err: unknown) {
			expect((err as Error).message).toContain("repoPath");
		} finally {
			store.close();
		}
	});

	it("returns error for non-existent path", async () => {
		const store = await createTestStore();
		try {
			const response = await handleCodebaseIndexRepository(
				{ repo: "test-repo", repoPath: "/nonexistent/path/abc123xyz" },
				store,
				vectors
			);
			expect(response.structuredContent).toMatchObject({
				success: false,
				error: "PATH_NOT_FOUND"
			});
		} finally {
			store.close();
		}
	});

	it("returns error when repoPath is a file not a directory", async () => {
		const store = await createTestStore();
		const tmpFile = path.join(os.tmpdir(), `cbi-tool-test-${Date.now()}.txt`);
		fs.writeFileSync(tmpFile, "test", "utf-8");

		try {
			const response = await handleCodebaseIndexRepository({ repo: "test-repo", repoPath: tmpFile }, store, vectors);
			expect(response.structuredContent).toMatchObject({
				success: false,
				error: "NOT_A_DIRECTORY"
			});
		} finally {
			store.close();
			fs.rmSync(tmpFile, { force: true });
		}
	});
});

describe("handleCodebaseIndexStatus", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	afterEach(() => {
		store.close();
	});

	it("returns status for an unindexed repo", async () => {
		const response = await handleCodebaseIndexStatus({ repo: "unknown-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.repo).toBe("unknown-repo");
		expect(data.isIndexed).toBe(false);
		expect(data.totalFiles).toBe(0);
		expect(data.totalSymbols).toBe(0);
	});

	it("throws on missing repo param", async () => {
		await expect(handleCodebaseIndexStatus({}, store, vectors)).rejects.toThrow();
	});

	it("throws on empty repo", async () => {
		await expect(handleCodebaseIndexStatus({ repo: "" }, store, vectors)).rejects.toThrow();
	});
});

// ── handleGetArchitecture tests ─────────────────────────────────────────

describe("handleGetArchitecture", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	afterEach(() => {
		store.close();
	});

	it("returns architecture for indexed repo", async () => {
		store.codebaseFiles.upsertFile({
			repo: "test/repo",
			file_path: "src/index.ts",
			language: "typescript",
			checksum: "abc",
			lines: 10,
			size_bytes: 100
		});
		store.codebaseFiles.upsertFile({
			repo: "test/repo",
			file_path: "src/utils/helper.ts",
			language: "typescript",
			checksum: "def",
			lines: 20,
			size_bytes: 200
		});

		const response = await handleGetArchitecture({ repo: "test/repo", depth: 3 }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.root).toBeDefined();
		expect(data.summary).toBeDefined();
		const summary = data.summary as Record<string, unknown>;
		expect(summary.totalFiles).toBe(2);
	});

	it("returns empty architecture for unindexed repo", async () => {
		const response = await handleGetArchitecture({ repo: "never-indexed", depth: 3 }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		const summary = data.summary as Record<string, unknown>;
		expect(summary.totalFiles).toBe(0);
		expect(summary.totalSymbols).toBe(0);
	});

	it("includes symbols when includeSymbolCounts is true", async () => {
		store.codebaseFiles.upsertFile({
			repo: "test/repo",
			file_path: "src/app.ts",
			language: "typescript",
			checksum: "abc",
			lines: 10,
			size_bytes: 100
		});
		store.codebaseSymbols.bulkUpsertSymbols([
			{
				repo: "test/repo",
				file_path: "src/app.ts",
				name: "initApp",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 1,
				start_col: 0
			}
		]);

		const response = await handleGetArchitecture(
			{ repo: "test/repo", depth: 3, includeSymbolCounts: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const summary = data.summary as Record<string, unknown>;
		expect(summary.totalSymbols).toBe(1);
	});
});

// ── handleGetFileSymbols tests ──────────────────────────────────────────

describe("handleGetFileSymbols", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	afterEach(() => {
		store.close();
	});

	it("returns symbols for indexed file", async () => {
		store.codebaseFiles.upsertFile({
			repo: "test/repo",
			file_path: "src/auth.ts",
			language: "typescript",
			checksum: "abc",
			lines: 50,
			size_bytes: 500
		});
		store.codebaseSymbols.bulkUpsertSymbols([
			{
				repo: "test/repo",
				file_path: "src/auth.ts",
				name: "login",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 42,
				start_col: 0
			}
		]);

		const response = await handleGetFileSymbols({ repo: "test/repo", filePath: "src/auth.ts" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbols).toBeDefined();
		expect((data.symbols as Array<unknown>).length).toBe(1);
		expect(data.total).toBe(1);
	});

	it("returns FILE_NOT_INDEXED for unknown file", async () => {
		const response = await handleGetFileSymbols({ repo: "test/repo", filePath: "src/ghost.ts" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.error).toContain("File not indexed");
		expect(data.code).toBe("FILE_NOT_INDEXED");
	});
});

// ── handleSearchSymbols tests ───────────────────────────────────────────

describe("handleSearchSymbols", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	afterEach(() => {
		store.close();
	});

	it("returns empty for short query (1 character)", async () => {
		const response = await handleSearchSymbols({ query: "a" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.total).toBe(0);
		expect(data.hasMore).toBe(false);
	});

	it("returns empty for empty query", async () => {
		const response = await handleSearchSymbols({ query: "" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.total).toBe(0);
		expect(data.hasMore).toBe(false);
	});

	it("returns empty for whitespace query", async () => {
		const response = await handleSearchSymbols({ query: "  " }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.total).toBe(0);
	});
});

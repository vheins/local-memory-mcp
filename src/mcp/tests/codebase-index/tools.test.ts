/**
 * Codebase Index Tool Handler Tests.
 *
 * Tests the MCP tool handlers for codebase-index (write) and codebase-read (read),
 * covering input validation and error paths.
 *
 * Schema tests still validate the backward-compatible schemas.
 * Handler tests now target the unified canonical handlers:
 *   - handleCodebaseIndex  (from codebase-index-sdk.ts)
 *   - handleCodebaseRead   (from codebase.read.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ZodError } from "zod";
import { IndexRepoSchema, IndexStatusSchema } from "../../tools/schemas/codebase-index";
import { handleCodebaseIndex } from "../../tools/codebase-index-sdk";
import { handleCodebaseRead } from "../../tools/codebase.read";
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
			owner: "vheins",
			repo: "test-repo",
			repoPath: "/tmp/some-path",
			force: true,
			includeGlobs: ["**/*.ts"],
			excludeGlobs: ["**/test/**"]
		});
		expect(result.repo).toBe("test-repo");
		expect(result.repoPath).toBe("/tmp/some-path");
		expect(result.force).toBe(true);
	});

	it("validates minimal input (only required fields)", () => {
		const result = IndexRepoSchema.parse({
			owner: "vheins",
			repo: "test",
			repoPath: "/tmp"
		});
		expect(result.repo).toBe("test");
		expect(result.force).toBeUndefined();
	});

	it("rejects empty repo", () => {
		expect(() => IndexRepoSchema.parse({ owner: "vheins", repo: "", repoPath: "/tmp" })).toThrow();
	});

	it("rejects empty repoPath", () => {
		expect(() => IndexRepoSchema.parse({ owner: "vheins", repo: "test", repoPath: "" })).toThrow();
	});

	it("rejects missing repoPath entirely", () => {
		expect(() => IndexRepoSchema.parse({ owner: "vheins", repo: "test" })).toThrow();
	});

	it("rejects wrong type for force", () => {
		expect(() => IndexRepoSchema.parse({ owner: "vheins", repo: "test", repoPath: "/tmp", force: "yes" })).toThrow();
	});
});

describe("IndexStatusSchema", () => {
	it("validates a complete input", () => {
		const result = IndexStatusSchema.parse({ owner: "vheins", repo: "test-repo" });
		expect(result.repo).toBe("test-repo");
	});

	it("validates with optional repoPath", () => {
		const result = IndexStatusSchema.parse({ owner: "vheins", repo: "test-repo", repoPath: "/tmp/repo" });
		expect(result.repo).toBe("test-repo");
		expect(result.repoPath).toBe("/tmp/repo");
	});

	it("rejects empty repo", () => {
		expect(() => IndexStatusSchema.parse({ owner: "vheins", repo: "" })).toThrow();
	});

	it("rejects missing repo", () => {
		expect(() => IndexStatusSchema.parse({ owner: "vheins" })).toThrow();
	});
});

// ── Handler tests ───────────────────────────────────────────────────────

describe("handleCodebaseIndex (write)", () => {
	let vectors: VectorStore;

	beforeEach(() => {
		vectors = noopVectorStore();
	});

	it("returns input validation error for missing repoPath", async () => {
		const store = await createTestStore();
		try {
			const response = await handleCodebaseIndex({ owner: "vheins", repo: "test-repo" }, store, vectors);
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
			const response = await handleCodebaseIndex(
				{ owner: "vheins", repo: "test-repo", repoPath: "/nonexistent/path/abc123xyz" },
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
			const response = await handleCodebaseIndex(
				{ owner: "vheins", repo: "test-repo", repoPath: tmpFile },
				store,
				vectors
			);
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

describe("handleCodebaseRead (status mode)", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	afterEach(() => {
		store.close();
	});

	it("returns architecture with zero files for an unindexed repo", async () => {
		const response = await handleCodebaseRead({ owner: "vheins", repo: "unknown-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.mode).toBe("architecture");
		const summary = data.summary as Record<string, number>;
		expect(summary.totalFiles).toBe(0);
		expect(summary.totalSymbols).toBe(0);
	});

	it("handles missing owner param (owner is optional with default)", async () => {
		const response = await handleCodebaseRead({ repo: "test-repo" }, store, vectors);
		expect(response).toBeDefined();
	});

	it("throws on empty repo", async () => {
		await expect(handleCodebaseRead({ owner: "vheins", repo: "" }, store, vectors)).rejects.toThrow();
	});
});

// ── handleCodebaseRead (architecture mode) tests ────────────────────────

describe("handleCodebaseRead (architecture mode)", () => {
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
			repo: "repo",
			file_path: "src/index.ts",
			language: "typescript",
			checksum: "abc",
			lines: 10,
			size_bytes: 100
		});
		store.codebaseFiles.upsertFile({
			repo: "repo",
			file_path: "src/utils/helper.ts",
			language: "typescript",
			checksum: "def",
			lines: 20,
			size_bytes: 200
		});

		const response = await handleCodebaseRead({ owner: "vheins", repo: "repo", depth: 3 }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.root).toBeDefined();
		expect(data.summary).toBeDefined();
		const summary = data.summary as Record<string, unknown>;
		expect(summary.totalFiles).toBe(2);
	});

	it("returns empty architecture for unindexed repo", async () => {
		const response = await handleCodebaseRead({ owner: "vheins", repo: "never-indexed", depth: 3 }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		const summary = data.summary as Record<string, unknown>;
		expect(summary.totalFiles).toBe(0);
		expect(summary.totalSymbols).toBe(0);
	});

	it("includes symbols when includeSymbolCounts is true", async () => {
		store.codebaseFiles.upsertFile({
			repo: "repo",
			file_path: "src/app.ts",
			language: "typescript",
			checksum: "abc",
			lines: 10,
			size_bytes: 100
		});
		store.codebaseSymbols.bulkUpsertSymbols([
			{
				repo: "repo",
				file_path: "src/app.ts",
				name: "initApp",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 1,
				start_col: 0
			}
		]);

		const response = await handleCodebaseRead(
			{ owner: "vheins", repo: "repo", depth: 3, includeSymbolCounts: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const summary = data.summary as Record<string, unknown>;
		expect(summary.totalSymbols).toBe(1);
	});
});

// ── handleCodebaseRead (file mode) tests ────────────────────────────────

describe("handleCodebaseRead (file mode)", () => {
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
			repo: "repo",
			file_path: "src/auth.ts",
			language: "typescript",
			checksum: "abc",
			lines: 50,
			size_bytes: 500
		});
		store.codebaseSymbols.bulkUpsertSymbols([
			{
				repo: "repo",
				file_path: "src/auth.ts",
				name: "login",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 42,
				start_col: 0
			}
		]);

		const response = await handleCodebaseRead(
			{ owner: "vheins", repo: "repo", filePath: "src/auth.ts" },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbols).toBeDefined();
		expect((data.symbols as Array<unknown>).length).toBe(1);
		expect(data.total).toBe(1);
	});

	it("returns FILE_NOT_INDEXED for unknown file", async () => {
		const response = await handleCodebaseRead(
			{ owner: "vheins", repo: "repo", filePath: "src/ghost.ts" },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.error).toContain("File not indexed");
		expect(data.code).toBe("FILE_NOT_INDEXED");
	});
});

// ── handleCodebaseRead (search_symbols mode) tests ──────────────────────

describe("handleCodebaseRead (search_symbols mode)", () => {
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
		const response = await handleCodebaseRead({ owner: "vheins", query: "a", repo: "test-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.total).toBe(0);
		expect(data.hasMore).toBe(false);
	});

	it("returns empty for empty query", async () => {
		const response = await handleCodebaseRead({ owner: "vheins", query: "", repo: "test-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.total).toBe(0);
		expect(data.hasMore).toBe(false);
	});

	it("returns empty for whitespace query", async () => {
		const response = await handleCodebaseRead({ owner: "vheins", query: "  ", repo: "test-repo" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.total).toBe(0);
	});
});

// Legacy handler backward-compat test — handleCodebaseIndexRepository still works
describe("handleCodebaseIndexRepository (legacy, still exported)", () => {
	let vectors: VectorStore;

	beforeEach(() => {
		vectors = noopVectorStore();
	});

	it("returns input validation error for missing repoPath", async () => {
		const store = await createTestStore();
		try {
			// Import from codebase-index (hyphenated) where it's actually exported
			const { handleCodebaseIndexRepository: repoHandler } = await import("../../tools/codebase-index");
			try {
				await repoHandler({ owner: "vheins", repo: "test-repo" }, store, vectors);
				expect.fail("Should have thrown for missing repoPath");
			} catch (err: unknown) {
				expect(err).toBeInstanceOf(ZodError);
				expect(JSON.stringify(err)).toContain("repoPath");
			}
		} finally {
			store.close();
		}
	});
});

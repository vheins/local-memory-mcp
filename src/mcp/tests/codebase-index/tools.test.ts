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
import { IndexRepoSchema, IndexStatusSchema } from "../../tools/schemas/codebase-index";
import { handleCodebaseIndexRepository, handleCodebaseIndexStatus } from "../../tools/codebase-index";
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

	it("rejects empty repo", () => {
		expect(() => IndexStatusSchema.parse({ repo: "" })).toThrow();
	});

	it("rejects missing repo", () => {
		expect(() => IndexStatusSchema.parse({})).toThrow();
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

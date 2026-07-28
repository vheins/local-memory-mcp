import { describe, it, expect, beforeEach, vi } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleStandardWrite } from "../tools/standard.write";
import { handleStandardRead } from "../tools/standard.read";
import { handleStandardDelete } from "../tools/standard.delete";
import { McpResponse } from "../utils/mcp-response";
import type { VectorStore } from "../types";

describe("CSL (Coding Standards Library) — Unified Domain", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(() => {
		db = new SQLiteStore(":memory:");
		vectors = new StubVectorStore(db);
	});

	// =========================================================================
	// standard-write — CREATE mode
	// =========================================================================

	describe("standard-write — create", () => {
		it("persists a coding standard and requires tags plus metadata", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					name: "Error Handling Best Practices",
					content: "Always use try-catch blocks for async operations. Handle errors gracefully and log them.",
					language: "typescript",
					stack: ["node", "express"],
					version: "1.0.0",
					context: "error-handling",
					tags: ["backend", "errors"],
					metadata: { source: "internal-docs", owner: "platform" },
					agent: "test-agent",
					model: "gpt-4",
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standard.title).toBe("Error Handling Best Practices");

			// Verify full entry persisted in DB
			const entry = db.standards.getByCode(data.standard.code, "test");
			expect(entry).not.toBeNull();
			expect(entry!.language).toBe("typescript");
			expect(entry!.stack).toContain("node");
			expect(entry!.tags).toContain("backend");
			expect(entry!.metadata.source).toBe("internal-docs");
		});

		it("rejects missing required tags and metadata", async () => {
			await expect(
				handleStandardWrite(
					{
						owner: "test",
						name: "React Hooks Rule",
						content: "Use hooks consistently and never call them conditionally."
					},
					db,
					vectors
				)
			).rejects.toThrow();
		});

		it("stores standards with global scope by default", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					name: "React Hooks Standard",
					content: "Use hooks for state management. Never call hooks conditionally.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "hooks"],
					metadata: { source: "styleguide" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			const entry = db.standards.getByCode(data.standard.code, "test");
			expect(entry?.is_global).toBe(true);
		});

		it("stores child standards linked to a parent", async () => {
			const parent = (await handleStandardWrite(
				{
					owner: "test",
					name: "React Hooks",
					content: "Follow hook rules consistently.",
					tags: ["react", "hooks"],
					metadata: { source: "react-docs" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const parentId = (parent.structuredContent as any).standard.id;
			const child = (await handleStandardWrite(
				{
					owner: "test",
					name: "React Hooks Cleanup",
					content: "Always clean up subscriptions in effects.",
					parent_id: parentId,
					tags: ["react", "hooks", "effects"],
					metadata: { source: "react-docs" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const childCode = (child.structuredContent as any).standard.code;
			const childEntry = db.standards.getByCode(childCode, "test");
			expect(childEntry?.parent_id).toBe(parentId);
		});
	});

	// =========================================================================
	// standard-write — UPDATE mode
	// =========================================================================

	describe("standard-write — update", () => {
		it("updates standard fields and keeps vectors in sync", async () => {
			const stored = (await handleStandardWrite(
				{
					owner: "test",
					name: "Node Error Handling",
					content: "Use try-catch with logging.",
					language: "typescript",
					stack: ["node"],
					tags: ["node", "errors"],
					metadata: { source: "guide-v1" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const standardId = (stored.structuredContent as any).standard.id;
			const result = (await handleStandardWrite(
				{
					id: standardId,
					owner: "test",
					repo: "test-repo",
					content: "Use typed errors, try-catch, and structured logging.",
					tags: ["node", "errors", "logging"],
					metadata: { source: "guide-v2", changed_by: "qa" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.updatedFields).toContain("content");
			expect(db.standards.getById(standardId)?.metadata.source).toBe("guide-v2");
			expect(db.standards.getById(standardId)?.tags).toContain("logging");
		});

		it("updates parent linkage", async () => {
			const parent = (await handleStandardWrite(
				{
					owner: "test",
					name: "Parent Standard",
					content: "Parent guidance.",
					tags: ["architecture"],
					metadata: { source: "guide" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;
			const child = (await handleStandardWrite(
				{
					owner: "test",
					name: "Child Standard",
					content: "Child guidance.",
					tags: ["architecture", "child"],
					metadata: { source: "guide" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const parentId = (parent.structuredContent as any).standard.id;
			const childId = (child.structuredContent as any).standard.id;
			await handleStandardWrite(
				{ id: childId, parent_id: parentId, owner: "test", repo: "test-repo", json: true },
				db,
				vectors
			);

			expect(db.standards.getById(childId)?.parent_id).toBe(parentId);
		});
	});

	// =========================================================================
	// standard-write — BULK mode
	// =========================================================================

	describe("standard-write — bulk", () => {
		it("creates multiple standards in a single bulk call", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					repo: "bulk-repo",
					standards: [
						{
							name: "Bulk Standard A",
							content: "Content for standard A.",
							tags: ["bulk"],
							metadata: { source: "bulk-test" }
						},
						{
							name: "Bulk Standard B",
							content: "Content for standard B.",
							tags: ["bulk"],
							metadata: { source: "bulk-test" }
						}
					],
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.total).toBe(2);
			expect(data.processed).toBe(2);

			// Verify persisted
			const all = db.standards.search({ repo: "bulk-repo", limit: 10, offset: 0 });
			expect(all).toHaveLength(2);
		});
	});

	// =========================================================================
	// standard-read — SEARCH mode
	// =========================================================================

	describe("standard-read — search", () => {
		beforeEach(async () => {
			await handleStandardWrite(
				{
					owner: "test",
					name: "React State Management",
					content: "Use Redux or Context API for state.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "state"],
					metadata: { source: "frontend-guide" },
					json: true
				},
				db,
				vectors
			);

			await handleStandardWrite(
				{
					owner: "test",
					name: "Node Error Handling",
					content: "Use try-catch with proper logging.",
					language: "typescript",
					stack: ["node", "express"],
					tags: ["node", "errors"],
					metadata: { source: "backend-guide" },
					json: true
				},
				db,
				vectors
			);

			await handleStandardWrite(
				{
					owner: "test",
					name: "Python Testing",
					content: "Use pytest for all test cases.",
					language: "python",
					stack: ["pytest"],
					tags: ["python", "testing"],
					metadata: { source: "qa-guide" },
					json: true
				},
				db,
				vectors
			);
		});

		it("returns relevant results for specific stacks", async () => {
			const result = (await handleStandardRead(
				{
					stack: ["react"]
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("list");
			expect(data.count).toBeGreaterThan(0);
			expect(data.standards.rows.find((row: any[]) => String(row[2]).includes("React"))).toBeDefined();
		});

		it("returns relevant results for specific languages", async () => {
			const result = (await handleStandardRead(
				{
					language: "python"
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.standards.rows.find((row: any[]) => row[4] === "python")).toBeDefined();
		});

		it("returns empty array for invalid language", async () => {
			const result = (await handleStandardRead(
				{
					language: "nonexistent-language-xyz"
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.standards.rows).toEqual([]);
			expect(data.count).toBe(0);
		});

		it("supports text search by query", async () => {
			const result = (await handleStandardRead(
				{
					query: "error"
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.count).toBeGreaterThan(0);
			expect(result.content?.[0]?.type).toBe("text");
			const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
			expect(text).toContain("| code | confidence | matched_terms | title | context | language | scope |");
			expect(text).toContain("Use standard-read with code for full content.");
		});

		it("supports tag filtering", async () => {
			const result = (await handleStandardRead(
				{
					tags: ["testing"]
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.count).toBe(1);
			expect(data.standards.rows[0][2]).toBe("Python Testing");
		});

		it("can return vector-only matches when lexical overlap is weak", async () => {
			const vectorOnlyDb = new SQLiteStore(":memory:");
			const mockVectors: VectorStore = {
				upsert: vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
				search: vi.fn().mockResolvedValue([])
			};

			const stored = (await handleStandardWrite(
				{
					owner: "test",
					name: "React Effects",
					content: "Prefer effect cleanup and isolate subscriptions.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "effects"],
					metadata: { source: "react-docs" },
					json: true
				},
				vectorOnlyDb,
				mockVectors
			)) as McpResponse;

			const standardId = (stored.structuredContent as any).standard.id;
			mockVectors.search = vi.fn().mockResolvedValue([{ id: standardId, score: 0.97 }]);

			const result = (await handleStandardRead(
				{
					query: "subscription teardown guidance"
				},
				vectorOnlyDb,
				mockVectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.count).toBe(1);
			expect(data.results.rows[0][1]).toBe(standardId);
		});

		it("ranks exact keyword matches above generic matches and exposes confidence", async () => {
			const rankingDb = new SQLiteStore(":memory:");
			const mockVectors: VectorStore = {
				upsert: vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
				search: vi.fn().mockResolvedValue([])
			};

			await handleStandardWrite(
				{
					owner: "test",
					name: "Laravel Service Provider Register Method Responsibility",
					content: "Use register() only for binding services into the container.",
					language: "php",
					stack: ["laravel"],
					tags: ["laravel", "providers"],
					metadata: { source: "laravel-docs" },
					json: true
				},
				rankingDb,
				mockVectors
			);

			await handleStandardWrite(
				{
					owner: "test",
					name: "Laravel Service Container Singleton vs Scoped Binding",
					content: "Use singleton() for app-wide reuse and scoped() for per-lifecycle bindings.",
					language: "php",
					stack: ["laravel"],
					tags: ["laravel", "container", "singleton", "scoped"],
					metadata: { source: "laravel-docs" },
					json: true
				},
				rankingDb,
				mockVectors
			);

			const result = (await handleStandardRead(
				{
					query: "Laravel Service Container Singleton vs Scoped Binding"
				},
				rankingDb,
				mockVectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("search");
			expect(data.results.columns).toContain("confidence");
			expect(data.results.columns).toContain("matched_terms");
			expect(data.results.rows[0][2]).toBe("Laravel Service Container Singleton vs Scoped Binding");
			expect(["high", "medium"]).toContain(data.results.rows[0][7]);
			expect(String(data.results.rows[0][9])).toContain("singleton");
			expect(String(data.results.rows[0][9])).toContain("scoped");
			const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
			expect(text).toContain("| code | confidence | matched_terms | title | context | language | scope |");
		});
	});

	// =========================================================================
	// standard-read — DETAIL mode
	// =========================================================================

	describe("standard-read — detail", () => {
		beforeEach(async () => {
			await handleStandardWrite(
				{
					owner: "test",
					name: "Test Detail Standard",
					content: "Detail mode test content.",
					language: "typescript",
					tags: ["detail", "test"],
					metadata: { source: "detail-test" },
					json: true
				},
				db,
				vectors
			);
		});

		it("retrieves a single standard by id", async () => {
			const all = db.standards.search({ limit: 10, offset: 0 });
			const standardId = all[0].id;

			const result = (await handleStandardRead(
				{
					id: standardId,
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("detail");
			expect(data.standard.id).toBe(standardId);
			expect(data.standard.title).toBe("Test Detail Standard");
		});

		it("retrieves a single standard by code", async () => {
			const all = db.standards.search({ limit: 10, offset: 0 });
			const standardCode = all[0].code;

			const result = (await handleStandardRead(
				{
					code: standardCode,
					owner: "test",
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("detail");
			expect(data.standard.code).toBe(standardCode);
		});

		it("retrieves multiple standards by ids", async () => {
			// Create a second standard
			await handleStandardWrite(
				{
					owner: "test",
					name: "Second Detail Standard",
					content: "Second detail content.",
					tags: ["detail"],
					metadata: { source: "detail-test" },
					json: true
				},
				db,
				vectors
			);

			const all = db.standards.search({ limit: 10, offset: 0 });
			const ids = all.map((s) => s.id);

			const result = (await handleStandardRead(
				{
					ids,
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("detail");
			expect(data.standards).toHaveLength(2);
			expect(data.count).toBe(2);
		});
	});

	// =========================================================================
	// standard-read — LIST mode
	// =========================================================================

	describe("standard-read — list", () => {
		it("lists all standards when no query or id is provided", async () => {
			// Insert 3 standards
			for (let i = 0; i < 3; i++) {
				await handleStandardWrite(
					{
						owner: "test",
						name: `List Standard ${i}`,
						content: `Content for list standard ${i}.`,
						tags: ["list-test"],
						metadata: { source: "list-test" },
						json: true
					},
					db,
					vectors
				);
			}

			const result = (await handleStandardRead(
				{
					limit: 10,
					offset: 0,
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("list");
			expect(data.count).toBe(3);
			expect(data.standards.columns).toContain("code");
			expect(data.standards.columns).toContain("title");
			expect(data.standards.rows).toHaveLength(3);
		});
	});

	// =========================================================================
	// standard-read — Auto-infer mode detection
	// =========================================================================

	describe("standard-read — auto-infer", () => {
		beforeEach(async () => {
			await handleStandardWrite(
				{
					owner: "test",
					repo: "auto-infer-repo",
					name: "Auto Infer Standard",
					content: "Content for auto-infer testing.",
					language: "typescript",
					stack: ["node"],
					tags: ["auto-infer"],
					metadata: { source: "auto-infer-test" },
					json: true
				},
				db,
				vectors
			);
		});

		it("standard-read auto-infers DETAIL when id is present", async () => {
			const entry = db.standards.search({ repo: "auto-infer-repo", limit: 1, offset: 0 })[0];
			expect(entry).toBeDefined();

			const result = (await handleStandardRead(
				{ id: entry.id, owner: "test", repo: "auto-infer-repo", json: true },
				db,
				vectors
			)) as any;
			expect(result.structuredContent.schema).toBe("standard-read");
			expect(result.structuredContent.mode).toBe("detail");
			expect(result.structuredContent.standard.id).toBe(entry.id);
		});

		it("standard-read auto-infers DETAIL when code is present", async () => {
			const entry = db.standards.search({ repo: "auto-infer-repo", limit: 1, offset: 0 })[0];
			expect(entry).toBeDefined();
			expect(entry.code).toBeDefined();

			const result = (await handleStandardRead(
				{ code: entry.code, owner: "test", repo: "auto-infer-repo", json: true },
				db,
				vectors
			)) as any;
			expect(result.structuredContent.schema).toBe("standard-read");
			expect(result.structuredContent.mode).toBe("detail");
			expect(result.structuredContent.standard.code).toBe(entry.code);
		});

		it("standard-read auto-infers SEARCH when query is present", async () => {
			const result = (await handleStandardRead(
				{ query: "auto-infer", owner: "test", repo: "auto-infer-repo", json: true },
				db,
				vectors
			)) as any;
			expect(result.structuredContent.schema).toBe("standard-read");
			expect(result.structuredContent.count).toBeGreaterThanOrEqual(1);
		});

		it("standard-read auto-infers LIST when no id/code/query present", async () => {
			const result = (await handleStandardRead(
				{ owner: "test", repo: "auto-infer-repo", json: true },
				db,
				vectors
			)) as any;
			expect(result.structuredContent.schema).toBe("standard-read");
			expect(result.structuredContent.mode).toBe("list");
			expect(result.structuredContent.count).toBeGreaterThanOrEqual(1);
		});

		it("standard-read auto-infers DETAIL BULK when ids array is present", async () => {
			const entries = db.standards.search({ repo: "auto-infer-repo", limit: 3, offset: 0 });
			const ids = entries.map((e: any) => e.id);

			const result = (await handleStandardRead(
				{ ids, owner: "test", repo: "auto-infer-repo", json: true },
				db,
				vectors
			)) as any;
			expect(result.structuredContent.schema).toBe("standard-read");
			expect(result.structuredContent.count).toBe(ids.length);
		});
	});

	// =========================================================================
	// standard-delete — Single & Bulk
	// =========================================================================

	describe("standard-delete", () => {
		it("deletes a single standard by id", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					name: "To Delete",
					content: "Will be deleted.",
					tags: ["delete"],
					metadata: { source: "delete-test" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const standardId = (result.structuredContent as any).standard.id;
			expect(db.standards.getById(standardId)).not.toBeNull();

			const delResult = (await handleStandardDelete(
				{
					id: standardId,
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = delResult.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.deletedCount).toBe(1);
			expect(db.standards.getById(standardId)).toBeNull();
		});

		it("deletes a single standard by code", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					name: "To Delete By Code",
					content: "Will be deleted by code.",
					tags: ["delete"],
					metadata: { source: "delete-test" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const code = (result.structuredContent as any).standard.code;
			expect(db.standards.getByCode(code, "test")).not.toBeNull();

			const delResult = (await handleStandardDelete(
				{
					code,
					owner: "test",
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = delResult.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.deletedCount).toBe(1);
			expect(db.standards.getByCode(code, "test")).toBeNull();
		});

		it("bulk deletes multiple standards by ids", async () => {
			const ids: string[] = [];
			for (let i = 0; i < 3; i++) {
				const res = (await handleStandardWrite(
					{
						owner: "test",
						repo: "bulk-delete-repo",
						name: `Bulk Delete ${i}`,
						content: `Bulk delete content ${i}.`,
						tags: ["bulk-delete"],
						metadata: { source: "bulk-delete-test" },
						json: true
					},
					db,
					vectors
				)) as McpResponse;
				ids.push((res.structuredContent as any).standard.id);
			}

			expect(db.standards.search({ repo: "bulk-delete-repo", limit: 10, offset: 0 })).toHaveLength(3);

			const delResult = (await handleStandardDelete(
				{
					ids,
					owner: "test",
					repo: "bulk-delete-repo",
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = delResult.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.deletedCount).toBe(3);
			expect(db.standards.search({ repo: "bulk-delete-repo", limit: 10, offset: 0 })).toHaveLength(0);
		});
	});
});

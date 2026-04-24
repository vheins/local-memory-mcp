import { describe, it, expect, beforeEach, vi } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleStandardStore } from "../tools/standard.store";
import { handleStandardSearch } from "../tools/standard.search";
import { handleStandardUpdate } from "../tools/standard.update";
import { McpResponse } from "../utils/mcp-response";
import type { VectorStore } from "../types";

describe("CSL (Coding Standards Library)", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(() => {
		db = new SQLiteStore(":memory:");
		vectors = new StubVectorStore(db);
	});

	describe("standard-store", () => {
		it("persists a coding standard and requires tags plus metadata", async () => {
			const result = (await handleStandardStore(
				{
					name: "Error Handling Best Practices",
					content:
						"Always use try-catch blocks for async operations. Handle errors gracefully and log them.",
					language: "typescript",
					stack: ["node", "express"],
					version: "1.0.0",
					context: "error-handling",
					tags: ["backend", "errors"],
					metadata: { source: "internal-docs", owner: "platform" },
					agent: "test-agent",
					model: "gpt-4"
				},
				db,
				vectors
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standard.title).toBe("Error Handling Best Practices");
			expect(data.standard.language).toBe("typescript");
			expect(data.standard.stack).toContain("node");
			expect(data.standard.tags).toContain("backend");
			expect(data.standard.metadata.source).toBe("internal-docs");
		});

		it("rejects missing required tags and metadata", async () => {
			await expect(
				handleStandardStore(
					{
						name: "React Hooks Rule",
						content: "Use hooks consistently and never call them conditionally."
					},
					db,
					vectors
				)
			).rejects.toThrow();
		});

		it("stores standards with global scope by default", async () => {
			const result = (await handleStandardStore(
				{
					name: "React Hooks Standard",
					content: "Use hooks for state management. Never call hooks conditionally.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "hooks"],
					metadata: { source: "styleguide" }
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.standard.is_global).toBe(true);
		});

		it("stores child standards linked to a parent", async () => {
			const parent = (await handleStandardStore(
				{
					name: "React Hooks",
					content: "Follow hook rules consistently.",
					tags: ["react", "hooks"],
					metadata: { source: "react-docs" }
				},
				db,
				vectors
			)) as McpResponse;

			const parentId = (parent.structuredContent as any).standard.id;
			const child = (await handleStandardStore(
				{
					name: "React Hooks Cleanup",
					content: "Always clean up subscriptions in effects.",
					parent_id: parentId,
					tags: ["react", "hooks", "effects"],
					metadata: { source: "react-docs" }
				},
				db,
				vectors
			)) as McpResponse;

			expect((child.structuredContent as any).standard.parent_id).toBe(parentId);
		});
	});

	describe("standard-update", () => {
		it("updates standard fields and keeps vectors in sync", async () => {
			const stored = (await handleStandardStore(
				{
					name: "Node Error Handling",
					content: "Use try-catch with logging.",
					language: "typescript",
					stack: ["node"],
					tags: ["node", "errors"],
					metadata: { source: "guide-v1" }
				},
				db,
				vectors
			)) as McpResponse;

			const standardId = (stored.structuredContent as any).standard.id;
			const result = (await handleStandardUpdate(
				{
					id: standardId,
					content: "Use typed errors, try-catch, and structured logging.",
					tags: ["node", "errors", "logging"],
					metadata: { source: "guide-v2", changed_by: "qa" }
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
			const parent = (await handleStandardStore(
				{
					name: "Parent Standard",
					content: "Parent guidance.",
					tags: ["architecture"],
					metadata: { source: "guide" }
				},
				db,
				vectors
			)) as McpResponse;
			const child = (await handleStandardStore(
				{
					name: "Child Standard",
					content: "Child guidance.",
					tags: ["architecture", "child"],
					metadata: { source: "guide" }
				},
				db,
				vectors
			)) as McpResponse;

			const parentId = (parent.structuredContent as any).standard.id;
			const childId = (child.structuredContent as any).standard.id;
			await handleStandardUpdate({ id: childId, parent_id: parentId }, db, vectors);

			expect(db.standards.getById(childId)?.parent_id).toBe(parentId);
		});
	});

	describe("standard-search", () => {
		beforeEach(async () => {
			await handleStandardStore(
				{
					name: "React State Management",
					content: "Use Redux or Context API for state.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "state"],
					metadata: { source: "frontend-guide" }
				},
				db,
				vectors
			);

			await handleStandardStore(
				{
					name: "Node Error Handling",
					content: "Use try-catch with proper logging.",
					language: "typescript",
					stack: ["node", "express"],
					tags: ["node", "errors"],
					metadata: { source: "backend-guide" }
				},
				db,
				vectors
			);

			await handleStandardStore(
				{
					name: "Python Testing",
					content: "Use pytest for all test cases.",
					language: "python",
					stack: ["pytest"],
					tags: ["python", "testing"],
					metadata: { source: "qa-guide" }
				},
				db,
				vectors
			);
		});

		it("returns relevant results for specific stacks", async () => {
			const result = (await handleStandardSearch(
				{
					stack: ["react"]
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-search");
			expect(data.count).toBeGreaterThan(0);
			expect(data.results.rows.find((row: any[]) => String(row[1]).includes("React"))).toBeDefined();
		});

		it("returns relevant results for specific languages", async () => {
			const result = (await handleStandardSearch(
				{
					language: "python"
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.results.rows.find((row: any[]) => row[3] === "python")).toBeDefined();
		});

		it("returns empty array for invalid language", async () => {
			const result = (await handleStandardSearch(
				{
					language: "nonexistent-language-xyz"
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.results.rows).toEqual([]);
			expect(data.count).toBe(0);
		});

		it("supports text search by query", async () => {
			const result = (await handleStandardSearch(
				{
					query: "error"
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.count).toBeGreaterThan(0);
			expect(result.content?.[0]?.type).toBe("text");
		});

		it("supports tag filtering", async () => {
			const result = (await handleStandardSearch(
				{
					tags: ["testing"]
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.count).toBe(1);
			expect(data.results.rows[0][1]).toBe("Python Testing");
		});

		it("can return vector-only matches when lexical overlap is weak", async () => {
			const vectorOnlyDb = new SQLiteStore(":memory:");
			const mockVectors: VectorStore = {
				upsert: vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
				search: vi.fn().mockResolvedValue([])
			};

			const stored = (await handleStandardStore(
				{
					name: "React Effects",
					content: "Prefer effect cleanup and isolate subscriptions.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "effects"],
					metadata: { source: "react-docs" }
				},
				vectorOnlyDb,
				mockVectors
			)) as McpResponse;

			const standardId = (stored.structuredContent as any).standard.id;
			mockVectors.search = vi.fn().mockResolvedValue([{ id: standardId, score: 0.97 }]);

			const result = (await handleStandardSearch(
				{
					query: "subscription teardown guidance"
				},
				vectorOnlyDb,
				mockVectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.count).toBe(1);
			expect(data.results.rows[0][0]).toBe(standardId);
		});
	});
});

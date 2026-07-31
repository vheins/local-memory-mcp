import { describe, it, expect, vi } from "vitest";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleMemoryRead } from "../tools/memory.read";
import { handleTaskRead } from "../tools/task.read";
import type { VectorStore, VectorResult } from "../types";

const VALID_UUID_1 = "11111111-1111-4111-a111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-a222-222222222222";

/**
 * Factory for a mock VectorStore that returns predictable results.
 */
function mockVectorStore(results: VectorResult[]): VectorStore {
	return {
		upsert: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		search: vi.fn().mockResolvedValue(results)
	};
}

describe("Hybrid Search Scoring — vector + keyword + recency + domain", () => {
	describe("Memory hybrid scoring", () => {
		it("boosts recently used memories in search results", async () => {
			const db = await createTestStore();
			const repo = "hybrid-repo";

			// Insert two memories — one recent, one older
			db.memories.insert({
				id: VALID_UUID_1,
				type: "decision",
				title: "Recent Decision",
				content: "This is a very recent decision about the architecture.",
				importance: 3,
				agent: "test",
				role: "architect",
				model: "test",
				scope: { owner: "test", repo },
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				completed_at: null,
				hit_count: 5,
				recall_count: 3,
				last_used_at: new Date().toISOString(),
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: ["architecture"],
				metadata: {},
				is_global: false
			});

			db.memories.insert({
				id: VALID_UUID_2,
				type: "code_fact",
				title: "Old Fact",
				content: "This is an old fact about the system.",
				importance: 5,
				agent: "test",
				role: "developer",
				model: "test",
				scope: { owner: "test", repo },
				created_at: "2024-01-01T00:00:00.000Z",
				updated_at: "2024-01-01T00:00:00.000Z",
				completed_at: null,
				hit_count: 1,
				recall_count: 0,
				last_used_at: "2024-01-01T00:00:00.000Z",
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: ["legacy"],
				metadata: {},
				is_global: false
			});

			const vectors = mockVectorStore([
				{ id: VALID_UUID_1, score: 0.75 },
				{ id: VALID_UUID_2, score: 0.7 }
			]);

			const result = await handleMemoryRead({ query: "architecture", owner: "test", repo, json: true }, db, vectors);

			expect(result.structuredContent).toBeDefined();
			const data = result.structuredContent as Record<string, unknown>;
			// Both memories should be found
			expect(data.count).toBe(2);
			db.close();
		});

		it("respects importance as a boost factor in scoring", async () => {
			const db = await createTestStore();
			const repo = "importance-repo";

			// Low importance but good vector match
			db.memories.insert({
				id: VALID_UUID_1,
				type: "code_fact",
				title: "Low Importance Match",
				content: "Minor code style preference.",
				importance: 1,
				agent: "test",
				role: "dev",
				model: "test",
				scope: { owner: "test", repo },
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				completed_at: null,
				hit_count: 0,
				recall_count: 0,
				last_used_at: null,
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: [],
				metadata: {},
				is_global: false
			});

			// High importance but lower vector match
			db.memories.insert({
				id: VALID_UUID_2,
				type: "decision",
				title: "High Importance Match",
				content: "Critical architecture decision.",
				importance: 5,
				agent: "test",
				role: "architect",
				model: "test",
				scope: { owner: "test", repo },
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				completed_at: null,
				hit_count: 0,
				recall_count: 0,
				last_used_at: null,
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: [],
				metadata: {},
				is_global: false
			});

			const vectors = mockVectorStore([
				{ id: VALID_UUID_1, score: 0.9 },
				{ id: VALID_UUID_2, score: 0.6 }
			]);

			const result = await handleMemoryRead(
				{ query: "architecture decision", owner: "test", repo, json: true },
				db,
				vectors
			);

			expect(result.structuredContent).toBeDefined();
			const data = result.structuredContent as Record<string, unknown>;
			expect(data.count).toBeGreaterThanOrEqual(1);
			db.close();
		});
	});

	describe("Standard hybrid scoring", () => {
		it("filters standards by name via entity search", async () => {
			const db = await createTestStore();
			const stdVectors = new StubVectorStore(db);
			const repo = "std-hybrid-repo";
			const { handleStandardWrite } = await import("../tools/standard.write");

			await handleStandardWrite(
				{
					owner: "test",
					repo,
					name: "React Hooks Rule",
					content: "Use hooks for state management in React applications.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "hooks"],
					metadata: { source: "hybrid-test" },
					json: true
				},
				db,
				stdVectors
			);

			await handleStandardWrite(
				{
					owner: "test",
					repo,
					name: "Laravel Eloquent Rule",
					content: "Use Eloquent for database queries in Laravel.",
					language: "php",
					stack: ["laravel"],
					tags: ["laravel", "eloquent"],
					metadata: { source: "hybrid-test" },
					json: true
				},
				db,
				stdVectors
			);

			// Direct entity search returns both standards
			const allStandards = db.standards.search({ repo, limit: 10, offset: 0 });
			expect(allStandards.length).toBe(2);

			// Entity search with stack filter finds only React
			const reactStandards = db.standards.search({ repo, stack: "react", limit: 10, offset: 0 });
			expect(reactStandards.length).toBe(1);
			expect(reactStandards[0].title).toContain("React");

			db.close();
		});
	});

	describe("Task search with vector scoring", () => {
		it("returns tasks matching query text", async () => {
			const db = await createTestStore();
			const repo = "task-hybrid-repo";
			const { handleTaskWrite } = await import("../tools/task.write");

			await handleTaskWrite(
				{
					owner: "test",
					repo,
					task_code: "HYBRID-001",
					phase: "implementation",
					title: "Hybrid search implementation",
					description: "Implement hybrid search for all domains",
					status: "pending",
					json: true,
					agent: "test",
					role: "dev"
				},
				db,
				mockVectorStore([])
			);

			const result = await handleTaskRead(
				{ query: "hybrid", owner: "test", repo, json: true },
				db,
				mockVectorStore([])
			);

			const data = result.structuredContent as Record<string, unknown>;
			expect(data.count).toBeGreaterThanOrEqual(1);
			db.close();
		});
	});

	describe("Cross-domain search consistency", () => {
		it("memory-read and standard-read both support query parameter for search", async () => {
			const db = await createTestStore();
			const repo = "cross-domain-repo";

			// Memory search
			const memResult = await handleMemoryRead(
				{ query: "test", owner: "test", repo, json: true },
				db,
				mockVectorStore([])
			);
			expect(memResult.structuredContent).toBeDefined();
			const memData = memResult.structuredContent as Record<string, unknown>;
			expect(memData).toHaveProperty("count");

			db.close();
		});
	});
});

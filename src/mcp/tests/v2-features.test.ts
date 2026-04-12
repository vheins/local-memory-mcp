import { describe, it, expect, vi } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { handleMemoryStore } from "../tools/memory.store";
import { handleMemorySearch } from "../tools/memory.search";
import { handleMemoryAcknowledge } from "../tools/memory.acknowledge";
import { handleMemoryUpdate } from "../tools/memory.update";
import { getPrimaryTextContent } from "../utils/mcp-response";
import type { MemoryEntry, VectorStore } from "../types";

const VALID_UUID_1 = "11111111-1111-4111-a111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-a222-222222222222";

const mockVectors: VectorStore = {
	upsert: vi.fn().mockResolvedValue(undefined),
	remove: vi.fn().mockResolvedValue(undefined),
	search: vi.fn().mockResolvedValue([])
};

function makeEntry(overrides: Partial<MemoryEntry> & { repo?: string }): MemoryEntry {
	return {
		id: overrides.id || VALID_UUID_1,
		type: overrides.type || "decision",
		title: overrides.title || "Test Title",
		content: overrides.content || "Test content for memory",
		importance: overrides.importance || 3,
		agent: overrides.agent || "test-agent",
		role: "unknown",
		model: overrides.model || "test-model",
		scope: { repo: overrides.repo || "test-repo" },
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: overrides.supersedes || null,
		status: overrides.status || "active",
		tags: overrides.tags || [],
		metadata: overrides.metadata || {},
		is_global: overrides.is_global || false
	};
}

describe("V2 Enhanced Memory Features", () => {
	describe("1. Conflict Detection & Supersedes", () => {
		it("should store memories with the file_claim type", async () => {
			const db = new SQLiteStore(":memory:");
			const repo = "file-claim-repo";

			const response = await handleMemoryStore(
				{
					type: "file_claim",
					title: "Claim ownership of migration file",
					content: "Agent A is working on src/storage/sqlite.ts migration changes.",
					importance: 4,
					scope: { repo },
					agent: "test-agent",
					model: "test-model"
				},
				db,
				mockVectors
			);

			const stored = db.memories.getById((response.structuredContent as Record<string, unknown>).id as string);
			expect(stored?.type).toBe("file_claim");
			db.close();
		});

		it("should store structured metadata on memories", async () => {
			const db = new SQLiteStore(":memory:");
			const repo = "metadata-repo";

			const response = await handleMemoryStore(
				{
					type: "decision",
					title: "JSON:API response standard restored",
					content: "Responses must use the JSON:API envelope for consistency.",
					importance: 4,
					scope: { repo },
					agent: "codex",
					role: "rules-optimizer",
					model: "gpt-5.4",
					metadata: {
						source_agent: "codex",
						source_role: "rules-optimizer",
						source_timestamp: "2026-04-03T00:00:00.000Z"
					}
				},
				db,
				mockVectors
			);

			const stored = db.memories.getById((response.structuredContent as Record<string, unknown>).id as string);
			expect(stored?.metadata).toEqual({
				source_agent: "codex",
				source_role: "rules-optimizer",
				source_timestamp: "2026-04-03T00:00:00.000Z"
			});
			db.close();
		});

		it("should reject titles that look like embedded metadata", async () => {
			const db = new SQLiteStore(":memory:");

			await expect(
				handleMemoryStore(
					{
						type: "decision",
						title: "[agent: codex | role: rules-optimizer | 2026-04-03] JSON:API response standard restored",
						content: "Responses must use the JSON:API envelope for consistency.",
						importance: 4,
						scope: { repo: "metadata-guard-repo" },
						agent: "codex",
						role: "rules-optimizer",
						model: "gpt-5.4"
					},
					db,
					mockVectors
				)
			).rejects.toThrow("Title appears to contain metadata");

			db.close();
		});

		it("should reject a new memory if a similar one exists (>0.85) and no supersedes is provided", async () => {
			const db = new SQLiteStore(":memory:");
			const repo = "conflict-repo";
			db.memories.insert(makeEntry({ id: VALID_UUID_1, repo, content: "React frontend" }));

			mockVectors.search = vi.fn().mockResolvedValue([{ id: VALID_UUID_1, score: 0.9 }]);

			const params = {
				type: "decision",
				title: "Conflict Test",
				content: "React frontend again",
				importance: 5,
				scope: { repo },
				agent: "test-agent",
				model: "test-model"
			};

			const response = await handleMemoryStore(params, db, mockVectors);
			expect(getPrimaryTextContent(response)).toContain("conflict");
			db.close();
		});

		it("should archive old memory when superseded", async () => {
			const db = new SQLiteStore(":memory:");
			const repo = "supersede-repo";
			db.memories.insert(makeEntry({ id: VALID_UUID_1, repo }));

			const params = {
				type: "decision",
				title: "New One",
				content: "Better content",
				importance: 5,
				scope: { repo },
				agent: "test-agent",
				model: "test-model",
				supersedes: VALID_UUID_1
			};

			await handleMemoryStore(params, db, mockVectors);

			const old = db.memories.getById(VALID_UUID_1);
			expect(old?.status).toBe("archived");
			db.close();
		});
	});

	describe("2. Strict Search Threshold (0.72)", () => {
		it("should filter out results using dynamic threshold", async () => {
			const db = new SQLiteStore(":memory:");
			const repo = "threshold-repo";
			db.memories.insert(makeEntry({ id: VALID_UUID_1, repo, content: "Target" }));
			db.memories.insert(makeEntry({ id: VALID_UUID_2, repo, content: "Noisy" }));

			// Adding more memories to force a stricter threshold (> 5 memories)
			for (let i = 0; i < 5; i++) {
				db.memories.insert(makeEntry({ id: `00000000-0000-4000-a000-00000000000${i + 3}`, repo, content: "Irrelevant" }));
			}

			mockVectors.search = vi.fn().mockResolvedValue([
				{ id: VALID_UUID_1, score: 0.8 },
				{ id: VALID_UUID_2, score: 0.2 }, // Should be filtered out if threshold is high
				{ id: "00000000-0000-4000-a000-000000000003", score: 0.1 }
			]);

			const params = { query: "Target", repo };
			const response = await handleMemorySearch(params, db, mockVectors);

			// New format: "Found N memories for "query" (showing N at offset 0)..."
			expect(getPrimaryTextContent(response)).toContain("Found 1 memories for");
			db.close();
		});
	});

	describe("3. Feedback Loop", () => {
		it("should allow updating memory type to file_claim", async () => {
			const db = new SQLiteStore(":memory:");
			db.memories.insert(makeEntry({ id: VALID_UUID_1, type: "decision" }));

			await handleMemoryUpdate(
				{
					id: VALID_UUID_1,
					type: "file_claim"
				},
				db,
				mockVectors
			);

			const updated = db.memories.getById(VALID_UUID_1);
			expect(updated?.type).toBe("file_claim");
			db.close();
		});

		it("should allow updating memory metadata", async () => {
			const db = new SQLiteStore(":memory:");
			db.memories.insert(makeEntry({ id: VALID_UUID_1, metadata: { source_agent: "old-agent" } }));

			await handleMemoryUpdate(
				{
					id: VALID_UUID_1,
					metadata: {
						source_agent: "codex",
						source_role: "rules-optimizer"
					}
				},
				db,
				mockVectors
			);

			const updated = db.memories.getById(VALID_UUID_1);
			expect(updated?.metadata).toEqual({
				source_agent: "codex",
				source_role: "rules-optimizer"
			});
			db.close();
		});

		it("should reject metadata-like titles on update", async () => {
			const db = new SQLiteStore(":memory:");
			db.memories.insert(makeEntry({ id: VALID_UUID_1, title: "Clean title" }));

			await expect(
				handleMemoryUpdate(
					{
						id: VALID_UUID_1,
						title: "[agent: codex | role: rules-optimizer | 2026-04-03] Noisy title"
					},
					db,
					mockVectors
				)
			).rejects.toThrow("Title appears to contain metadata");

			db.close();
		});

		it("should increment recall_count on 'used'", async () => {
			const db = new SQLiteStore(":memory:");
			db.memories.insert(makeEntry({ id: VALID_UUID_1 }));

			await handleMemoryAcknowledge(
				{
					memory_id: VALID_UUID_1,
					status: "used"
				},
				db
			);

			const updated = db.memories.getById(VALID_UUID_1);
			expect(updated?.recall_count).toBe(1);
			db.close();
		});
	});
});

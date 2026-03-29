import { describe, it, expect, vi } from "vitest";
import { SQLiteStore } from "./storage/sqlite.js";
import { handleMemoryStore } from "./tools/memory.store.js";
import { handleMemorySearch } from "./tools/memory.search.js";
import { handleMemoryAcknowledge } from "./tools/memory.acknowledge.js";
import type { MemoryEntry, VectorStore } from "./types.js";

const VALID_UUID_1 = "11111111-1111-4111-a111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-a222-222222222222";

const mockVectors: VectorStore = {
  upsert: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  search: vi.fn().mockResolvedValue([]),
};

function makeEntry(overrides: any): MemoryEntry {
  return {
    id: overrides.id || VALID_UUID_1,
    type: overrides.type || "decision",
    title: overrides.title || "Test Title",
    content: overrides.content || "Test content for memory",
    importance: overrides.importance || 3,
    scope: { repo: overrides.repo || "test-repo" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    hit_count: 0,
    recall_count: 0,
    last_used_at: null,
    expires_at: null,
    supersedes: overrides.supersedes || null,
    status: overrides.status || "active",
  };
}

describe("V2 Enhanced Memory Features", () => {
  describe("1. Conflict Detection & Supersedes", () => {
    it("should reject a new memory if a similar one exists (>0.85) and no supersedes is provided", async () => {
      const db = new SQLiteStore(":memory:");
      const repo = "conflict-repo";
      db.insert(makeEntry({ id: VALID_UUID_1, repo, content: "React frontend" }));

      mockVectors.search = vi.fn().mockResolvedValue([{ id: VALID_UUID_1, score: 0.9 }]);

      const params = {
        type: "decision",
        title: "Conflict Test",
        content: "React frontend again",
        importance: 5,
        scope: { repo }
      };

      const response = await handleMemoryStore(params, db, mockVectors);
      expect(response.content[0].text).toContain("conflict");
      db.close();
    });

    it("should archive old memory when superseded", async () => {
      const db = new SQLiteStore(":memory:");
      const repo = "supersede-repo";
      db.insert(makeEntry({ id: VALID_UUID_1, repo }));

      const params = {
        type: "decision",
        title: "New One",
        content: "Better content",
        importance: 5,
        scope: { repo },
        supersedes: VALID_UUID_1
      };

      await handleMemoryStore(params, db, mockVectors);
      
      const old = db.getById(VALID_UUID_1);
      expect(old?.status).toBe("archived");
      db.close();
    });
  });

  describe("2. Strict Search Threshold (0.72)", () => {
    it("should filter out results below 0.72", async () => {
      const db = new SQLiteStore(":memory:");
      const repo = "threshold-repo";
      db.insert(makeEntry({ id: VALID_UUID_1, repo, content: "Target" }));
      db.insert(makeEntry({ id: VALID_UUID_2, repo, content: "Noisy" }));

      mockVectors.search = vi.fn().mockResolvedValue([
        { id: VALID_UUID_1, score: 0.8 },
        { id: VALID_UUID_2, score: 0.5 }
      ]);

      const params = { query: "Target", repo };
      const response = await handleMemorySearch(params, db, mockVectors);
      
      const text = response.content[0].text;
      expect(text).toContain("Found 1 memories");
      db.close();
    });
  });

  describe("3. Feedback Loop", () => {
    it("should increment recall_count on 'used'", async () => {
      const db = new SQLiteStore(":memory:");
      db.insert(makeEntry({ id: VALID_UUID_1 }));
      
      await handleMemoryAcknowledge({
        memory_id: VALID_UUID_1,
        status: "used"
      }, db);

      const updated = db.getById(VALID_UUID_1);
      expect(updated?.recall_count).toBe(1);
      db.close();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouter } from "./router.js";
import { SQLiteStore } from "./storage/sqlite.js";
import type { VectorStore } from "./types.js";

// --- Mock Vector Store for fast E2E testing ---
class MockVectorStore implements VectorStore {
  private memory: Map<string, string> = new Map();
  async upsert(id: string, text: string) { this.memory.set(id, text); }
  async remove(id: string) { this.memory.delete(id); }
  async search(query: string, limit: number, repo?: string) {
    // Return maximum score (1.0) if query is contained in text to pass hybrid threshold
    const results = Array.from(this.memory.entries()).map(([id, text]) => ({
      id,
      score: text.toLowerCase().includes(query.toLowerCase()) ? 1.0 : 0.5
    }));
    return results.filter(r => r.score > 0.7).slice(0, limit);
  }
}

describe("MCP Local Memory E2E - System Integration Test", () => {
  let db: SQLiteStore;
  let vectors: VectorStore;
  let router: (method: string, params: any) => Promise<any>;

  const REPO = "e2e-test-repo";
  const MEM_ID = "00000000-0000-4000-a000-000000000001";

  beforeEach(() => {
    db = new SQLiteStore(":memory:");
    vectors = new MockVectorStore();
    router = createRouter(db, vectors);
  });

  describe("Capabilities (Resources, Prompts, Tools)", () => {
    it("should list available tools correctly", async () => {
      const result = await router("tools/list", {});
      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("memory-store");
      expect(toolNames).toContain("memory-search");
      expect(toolNames).toContain("memory-acknowledge");
    });

    it("should list available prompts", async () => {
      const result = await router("prompts/list", {});
      expect(result.prompts.length).toBeGreaterThan(0);
    });

    it("should list available resources", async () => {
      const result = await router("resources/list", {});
      expect(result.resources.length).toBeGreaterThan(0);
    });
  });

  describe("Tool: memory-store & memory-search", () => {
    it("should store a memory and find it via semantic search", async () => {
      const content = "Vitest Vitest Vitest Vitest Vitest Vitest Vitest Vitest"; // Force high keyword density
      await router("tools/call", {
        name: "memory-store",
        arguments: {
          type: "decision",
          title: "Architecture Choice",
          content: content,
          importance: 5,
          scope: { repo: REPO }
        }
      });

      const searchResult = await router("tools/call", {
        name: "memory-search",
        arguments: { query: "Vitest", repo: REPO }
      });

      expect(searchResult.content[0].text).toContain("Found 1 memories");
    });

    it("should enforce conflict detection (V2)", async () => {
      const content = "Conflict test content";
      await router("tools/call", {
        name: "memory-store",
        arguments: { type: "decision", title: "First", content, importance: 3, scope: { repo: REPO } }
      });

      const response = await router("tools/call", {
        name: "memory-store",
        arguments: { type: "decision", title: "Second", content, importance: 3, scope: { repo: REPO } }
      });

      expect(response.content[0].text).toContain("conflict");
    });
  });

  describe("Resources", () => {
    it("should read repo-specific resources", async () => {
      db.insert({
        id: MEM_ID,
        type: "decision",
        title: "Res Test",
        content: "Resource content",
        importance: 5,
        scope: { repo: REPO },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        hit_count: 0,
        recall_count: 0,
        last_used_at: null,
        expires_at: null,
        status: "active",
        supersedes: null
      });

      const result = await router("resources/read", {
        uri: `memory://index?repo=${REPO}`
      });

      expect(result.contents[0].text).toContain("Res Test");
    });
  });

  describe("Prompts", () => {
    it("should retrieve 'memory-agent-core' prompt", async () => {
      const result = await router("prompts/get", {
        name: "memory-agent-core"
      });
      expect(result.messages[0].content.text).toContain("coding copilot");
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { StubVectorStore } from "../storage/vectors.stub.js";
import type { VectorStore } from "../types.js";
import { getPrimaryTextContent } from "../utils/mcp-response.js";

describe("MCP Local Memory - Bulk Memory Management", () => {
  let db: SQLiteStore;
  let vectors: VectorStore;
  let router: (method: string, params: any) => Promise<any>;

  const REPO = "bulk-mem-repo";

  beforeEach(() => {
    db = new SQLiteStore(":memory:");
    vectors = new StubVectorStore(db);
    router = createRouter(db, vectors);
  });

  it("should bulk delete memories", async () => {
    // Create 2 memories
    const m1 = {
      type: "code_fact",
      title: "Memory 1 Title",
      content: "This is a valid long content for memory 1",
      importance: 3,
      agent: "Agent-A",
      model: "Model-X",
      scope: { repo: REPO }
    };
    const m2 = {
      type: "code_fact",
      title: "Memory 2 Title",
      content: "This is a valid long content for memory 2",
      importance: 3,
      agent: "Agent-A",
      model: "Model-X",
      scope: { repo: REPO }
    };

    await router("tools/call", { name: "memory-store", arguments: m1 });
    await router("tools/call", { name: "memory-store", arguments: m2 });

    const memories = db.getRecentMemories(REPO, 10);
    expect(memories.length).toBe(2);
    const ids = memories.map(m => m.id);

    const delRes = await router("tools/call", {
      name: "memory-bulk-delete",
      arguments: {
        repo: REPO,
        ids
      }
    });

    expect(getPrimaryTextContent(delRes)).toContain("Deleted 2 memories from repo");
    const remaining = db.getRecentMemories(REPO, 10);
    expect(remaining.length).toBe(0);
  });
});

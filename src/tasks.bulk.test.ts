import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "./router.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { StubVectorStore } from "./storage/vectors.stub.js";
import type { VectorStore } from "./types.js";

describe("MCP Local Memory - Bulk Task Management", () => {
  let db: SQLiteStore;
  let vectors: VectorStore;
  let router: (method: string, params: any) => Promise<any>;

  const REPO = "bulk-test-repo";

  beforeEach(() => {
    db = new SQLiteStore(":memory:");
    vectors = new StubVectorStore(db);
    router = createRouter(db, vectors);
  });

  it("should create multiple tasks in one call", async () => {
    const res = await router("tools/call", {
      name: "task-bulk-manage",
      arguments: {
        action: "bulk_create",
        repo: REPO,
        tasks: [
          {
            task_code: "BULK-001",
            title: "First Bulk Task",
            description: "Description 1",
            phase: "research",
            status: "pending",
            priority: 1
          },
          {
            task_code: "BULK-002",
            title: "Second Bulk Task",
            description: "Description 2",
            phase: "implementation",
            status: "pending",
            priority: 2
          }
        ]
      }
    });

    expect(res.isError).toBe(false);
    expect(res.content[0].text).toContain("Successfully created 2 tasks");

    const tasks = db.getTasksByRepo(REPO);
    expect(tasks.length).toBe(2);
    expect(tasks.find(t => t.task_code === "BULK-001")).toBeDefined();
    expect(tasks.find(t => t.task_code === "BULK-002")).toBeDefined();
  });

  it("should enforce default limit of 15 and support pagination", async () => {
    // Create 20 tasks
    const manyTasks = Array.from({ length: 20 }, (_, i) => ({
      task_code: `LIMIT-${i.toString().padStart(3, '0')}`,
      title: `Task ${i}`,
      description: `Description ${i}`,
      phase: "research",
      status: "pending"
    }));

    await router("tools/call", {
      name: "task-bulk-manage",
      arguments: {
        action: "bulk_create",
        repo: REPO,
        tasks: manyTasks
      }
    });

    // Test default limit (15)
    const defaultRes = await router("tools/call", {
      name: "task-list",
      arguments: { repo: REPO }
    });
    const defaultTasks = JSON.parse(defaultRes.content[0].text);
    expect(defaultTasks.length).toBe(15);

    // Test explicit limit
    const limitRes = await router("tools/call", {
      name: "task-list",
      arguments: { repo: REPO, limit: 5 }
    });
    const limitedTasks = JSON.parse(limitRes.content[0].text);
    expect(limitedTasks.length).toBe(5);

    // Test offset (last page)
    const offsetRes = await router("tools/call", {
      name: "task-list",
      arguments: { repo: REPO, limit: 15, offset: 15 }
    });
    const offsetTasks = JSON.parse(offsetRes.content[0].text);
    expect(offsetTasks.length).toBe(5); // 20 total - 15 offset = 5 remaining
  });
});

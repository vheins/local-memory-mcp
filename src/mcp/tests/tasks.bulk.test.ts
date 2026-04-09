import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { StubVectorStore } from "../storage/vectors.stub.js";
import type { VectorStore } from "../types.js";

function getTextContent(result: any) {
  const entry = result.content[0];
  return entry?.type === "text" ? entry.text : "";
}

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
            priority: 1,
            est_tokens: 50
          },
          {
            task_code: "BULK-002",
            title: "Second Bulk Task",
            description: "Description 2",
            phase: "implementation",
            status: "pending",
            priority: 2,
            est_tokens: 75
          }
        ]
      }
    });

    expect(res.isError).toBe(false);
    expect(getTextContent(res)).toContain("Successfully created 2 tasks");

    const tasks = db.getTasksByRepo(REPO);
    expect(tasks.length).toBe(2);
    expect(tasks.find(t => t.task_code === "BULK-001")).toBeDefined();
    expect(tasks.find(t => t.task_code === "BULK-002")).toBeDefined();
  });

  it("should allow bulk create without est_tokens", async () => {
    const res = await router("tools/call", {
      name: "task-bulk-manage",
      arguments: {
        action: "bulk_create",
        repo: REPO,
        tasks: [
          {
            task_code: "BULK-NO-TOKENS",
            title: "Bulk task without estimate",
            description: "Accepted during planning",
            phase: "research",
            status: "pending"
          }
        ]
      }
    });

    expect(res.isError).toBe(false);
    const task = db.getTasksByRepo(REPO).find(t => t.task_code === "BULK-NO-TOKENS");
    expect(task?.est_tokens).toBe(0);
  });

  it("should enforce default limit of 15 and support pagination", async () => {
    // Create 20 tasks
    const manyTasks = Array.from({ length: 20 }, (_, i) => ({
      task_code: `LIMIT-${i.toString().padStart(3, '0')}`,
      title: `Task ${i}`,
      description: `Description ${i}`,
      phase: "research",
      status: "backlog",
      est_tokens: 20 + i
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
    const defaultTasks = (defaultRes.structuredContent as any).tasks;
    expect(defaultTasks.length).toBe(15);

    // Test explicit limit
    const limitRes = await router("tools/call", {
      name: "task-list",
      arguments: { repo: REPO, limit: 5 }
    });
    const limitedTasks = (limitRes.structuredContent as any).tasks;
    expect(limitedTasks.length).toBe(5);

    // Test offset (last page)
    const offsetRes = await router("tools/call", {
      name: "task-list",
      arguments: { repo: REPO, limit: 15, offset: 15 }
    });
    const offsetTasks = (offsetRes.structuredContent as any).tasks;
    expect(offsetTasks.length).toBe(5); // 20 total - 15 offset = 5 remaining
  });

  it("should prevent duplicate task_codes in the same request", async () => {
    const promise = router("tools/call", {
      name: "task-bulk-manage",
      arguments: {
        action: "bulk_create",
        repo: REPO,
        tasks: [
          { task_code: "DUP-001", title: "Task 1", description: "D", phase: "p", status: "pending", est_tokens: 10 },
          { task_code: "DUP-001", title: "Task 2", description: "D", phase: "p", status: "pending", est_tokens: 12 }
        ]
      }
    });

    await expect(promise).rejects.toThrow("Duplicate task_code in request");
  });

  it("should prevent duplicate task_codes against existing tasks", async () => {
    // Create first task
    await router("tools/call", {
      name: "task-create",
      arguments: {
        repo: REPO,
        task_code: "EXISTING-001",
        title: "Initial",
        description: "D",
        phase: "p",
        status: "pending",
        est_tokens: 25
      }
    });

    // Try to create another one with same code (via bulk)
    const bulkPromise = router("tools/call", {
      name: "task-bulk-manage",
      arguments: {
        action: "bulk_create",
        repo: REPO,
        tasks: [
          { task_code: "EXISTING-001", title: "Duplicate", description: "D", phase: "p", status: "pending", est_tokens: 30 }
        ]
      }
    });
    await expect(bulkPromise).rejects.toThrow("already exists");

    // Try via single create
    const singlePromise = router("tools/call", {
      name: "task-create",
      arguments: {
        repo: REPO,
        task_code: "EXISTING-001",
        title: "Duplicate",
        description: "D",
        phase: "p",
        status: "pending",
        est_tokens: 30
      }
    });
    await expect(singlePromise).rejects.toThrow("already exists");
  });

  it("should bulk delete tasks", async () => {
    // Create 3 tasks
    await router("tools/call", {
      name: "task-bulk-manage",
      arguments: {
        action: "bulk_create",
        repo: REPO,
        tasks: [
          { task_code: "DEL-1", title: "Task 1", description: "Desc 1", phase: "p", status: "pending", est_tokens: 15 },
          { task_code: "DEL-2", title: "Task 2", description: "Desc 2", phase: "p", status: "pending", est_tokens: 16 },
          { task_code: "DEL-3", title: "Task 3", description: "Desc 3", phase: "p", status: "pending", est_tokens: 17 }
        ]
      }
    });

    const tasks = db.getTasksByRepo(REPO);
    const idsToDelete = [tasks[0].id, tasks[1].id];

    const delRes = await router("tools/call", {
      name: "task-bulk-manage",
      arguments: {
        action: "bulk_delete",
        repo: REPO,
        ids: idsToDelete
      }
    });

    expect(getTextContent(delRes)).toContain("Successfully deleted 2 tasks");
    const remainingTasks = db.getTasksByRepo(REPO);
    expect(remainingTasks.length).toBe(1);
  });

  it("auto-populates timestamps from status so agents do not need to send them manually", async () => {
    await router("tools/call", {
      name: "task-bulk-manage",
      arguments: {
        action: "bulk_create",
        repo: REPO,
        tasks: [
          { task_code: "TS-1", title: "To Start", description: "Desc", phase: "p", status: "backlog", est_tokens: 40 },
          { task_code: "TS-2", title: "To Finish", description: "Desc", phase: "p", status: "backlog", est_tokens: 60 }
        ]
      }
    });

    const tasks = db.getTasksByRepo(REPO);
    const ts1 = tasks.find(t => t.task_code === "TS-1");
    const ts2 = tasks.find(t => t.task_code === "TS-2");

    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: ts1.id,
        status: "in_progress",
        comment: "Starting TS-1",
        agent: "Agent-1",
        role: "tester"
      }
    });

    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: ts2.id,
        status: "in_progress",
        comment: "Starting TS-2",
        agent: "Agent-1",
        role: "tester"
      }
    });

    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: ts2.id,
        status: "completed",
        comment: "Finishing TS-2",
        agent: "Agent-1",
        role: "tester",
        est_tokens: 100
      }
    });

    const started = db.getTaskById(ts1.id);
    const done = db.getTaskById(ts2.id);

    expect(started?.in_progress_at).toBeTruthy();
    expect(started?.finished_at).toBeNull();
    expect(done?.finished_at).toBeTruthy();
  });
});

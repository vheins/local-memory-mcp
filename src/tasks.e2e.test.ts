import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouter } from "./router.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { StubVectorStore } from "./storage/vectors.stub.js";
import type { VectorStore } from "./types.js";

describe("MCP Local Memory - Task Management Workflow E2E", () => {
  let db: SQLiteStore;
  let vectors: VectorStore;
  let router: (method: string, params: any) => Promise<any>;

  const REPO = "workflow-test-repo";

  beforeEach(() => {
    db = new SQLiteStore(":memory:");
    vectors = new StubVectorStore(db);
    router = createRouter(db, vectors);
  });

  it("should follow the complete task management lifecycle: Plan -> Execute -> Verify", async () => {
    // ---- 1. INITIAL CHECK ----
    // Agent starts and checks for existing tasks
    const initialRes = await router("resources/read", {
      uri: `tasks://current?repo=${REPO}`
    });
    const initialTasks = JSON.parse(initialRes.contents[0].text);
    expect(initialTasks.length).toBe(0);

    // ---- 2. PLANNING PHASE ----
    // Agent creates a plan with two tasks: A and B (B depends on A)
    const taskARes = await router("tools/call", {
      name: "task-manage",
      arguments: {
        action: "create",
        repo: REPO,
        task_code: "TASK-001",
        phase: "research",
        title: "Research Architecture",
        description: "Analyze the current system architecture and propose changes",
        status: "pending",
        priority: 5
      }
    });
    const taskACode = taskARes.content[0].text.match(/\[(.*?)\]/)[1];
    const taskAId = db.getTasksByRepo(REPO)[0].id;

    const taskBRes = await router("tools/call", {
      name: "task-manage",
      arguments: {
        action: "create",
        repo: REPO,
        task_code: "TASK-002",
        phase: "implementation",
        title: "Implement Core Logic",
        description: "Write the core implementation based on research",
        status: "pending",
        depends_on: taskAId,
        priority: 4
      }
    });
    const taskBCode = taskBRes.content[0].text.match(/\[(.*?)\]/)[1];
    const taskBId = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-002").id;

    // Verify both are pending in current tasks
    const plannedRes = await router("resources/read", { uri: `tasks://current?repo=${REPO}` });
    const plannedTasks = JSON.parse(plannedRes.contents[0].text);
    expect(plannedTasks.length).toBe(2);
    expect(plannedTasks.every((t: any) => t.status === "pending")).toBe(true);

    // Verify task-list tool works
    const listToolRes = await router("tools/call", {
      name: "task-list",
      arguments: { repo: REPO }
    });
    const listToolTasks = JSON.parse(listToolRes.content[0].text);
    expect(listToolTasks.length).toBe(2);

    // ---- 3. EXECUTION PHASE ----
    // Agent starts Task A
    await router("tools/call", {
      name: "task-manage",
      arguments: {
        action: "update",
        repo: REPO,
        id: taskAId,
        status: "in_progress",
        task_code: taskACode // Required field
      }
    });

    // Verify Task A is in_progress
    const inProgressRes = await router("resources/read", { uri: `tasks://current?repo=${REPO}` });
    const inProgressTasks = JSON.parse(inProgressRes.contents[0].text);
    expect(inProgressTasks.find((t: any) => t.id === taskAId).status).toBe("in_progress");

    // ---- 4. VALIDATION PHASE (Task A) ----
    // Agent completes Task A
    await router("tools/call", {
      name: "task-manage",
      arguments: {
        action: "update",
        repo: REPO,
        id: taskAId,
        status: "completed",
        task_code: taskACode
      }
    });

    // Verify Task A is no longer in "current" tasks (since it's completed)
    const afterARes = await router("resources/read", { uri: `tasks://current?repo=${REPO}` });
    const afterATasks = JSON.parse(afterARes.contents[0].text);
    expect(afterATasks.length).toBe(1);
    expect(afterATasks[0].id).toBe(taskBId);

    // ---- 5. RESUME WORKFLOW (Task B) ----
    // Agent starts Task B (now that A is done)
    await router("tools/call", {
      name: "task-manage",
      arguments: {
        action: "update",
        repo: REPO,
        id: taskBId,
        status: "in_progress",
        task_code: taskBCode
      }
    });

    const finalCheckRes = await router("resources/read", { uri: `tasks://current?repo=${REPO}` });
    const finalCheckTasks = JSON.parse(finalCheckRes.contents[0].text);
    expect(finalCheckTasks[0].status).toBe("in_progress");
    expect(finalCheckTasks[0].depends_on).toBe(taskAId);
  });
});

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
    const initialRes = await router("resources/read", {
      uri: `tasks://current?repo=${REPO}`
    });
    const initialTasks = JSON.parse(initialRes.contents[0].text);
    expect(initialTasks.length).toBe(0);

    // ---- 2. PLANNING PHASE ----
    const taskARes = await router("tools/call", {
      name: "task-create",
      arguments: {
        repo: REPO,
        task_code: "TASK-001",
        phase: "research",
        title: "Research Architecture",
        description: "Analyze the current system architecture and propose changes",
        status: "pending",
        priority: 5
      }
    });
    const taskAId = db.getTasksByRepo(REPO)[0].id;

    const taskBRes = await router("tools/call", {
      name: "task-create",
      arguments: {
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
    const taskBId = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-002").id;

    // Verify both are pending
    const plannedRes = await router("resources/read", { uri: `tasks://current?repo=${REPO}` });
    const plannedTasks = JSON.parse(plannedRes.contents[0].text);
    expect(plannedTasks.length).toBe(2);

    // Verify task-list tool works
    const listToolRes = await router("tools/call", {
      name: "task-list",
      arguments: { repo: REPO }
    });
    const listToolTasks = JSON.parse(listToolRes.content[0].text);
    expect(listToolTasks.length).toBe(2);

    // ---- 3. EXECUTION PHASE ----
    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: taskAId,
        status: "in_progress",
        comment: "Started architecture review",
        agent: "Agent A",
        model: "gpt-5.4"
      }
    });

    const inProgressRes = await router("resources/read", { uri: `tasks://current?repo=${REPO}` });
    const inProgressTasks = JSON.parse(inProgressRes.contents[0].text);
    expect(inProgressTasks.find((t: any) => t.id === taskAId).status).toBe("in_progress");

    // ---- 4. VALIDATION PHASE (Task A) ----
    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: taskAId,
        status: "completed",
        comment: "Architecture review finished and documented",
        agent: "Agent A",
        model: "gpt-5.4"
      }
    });

    const afterARes = await router("resources/read", { uri: `tasks://current?repo=${REPO}` });
    const afterATasks = JSON.parse(afterARes.contents[0].text);
    expect(afterATasks.length).toBe(1);
    expect(afterATasks[0].id).toBe(taskBId);

    // ---- 5. RESUME WORKFLOW (Task B) ----
    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: taskBId,
        status: "in_progress",
        comment: "Implementation started after dependency was cleared",
        agent: "Agent B",
        model: "gpt-5.4-mini"
      }
    });

    const finalCheckRes = await router("resources/read", { uri: `tasks://current?repo=${REPO}` });
    const finalCheckTasks = JSON.parse(finalCheckRes.contents[0].text);
    expect(finalCheckTasks[0].status).toBe("in_progress");

    const updatedTask = db.getTaskById(taskBId);
    expect(updatedTask.comments).toHaveLength(1);
    expect(updatedTask.comments[0].comment).toContain("Implementation started");
    expect(updatedTask.comments[0].agent).toBe("Agent B");
    expect(updatedTask.comments[0].model).toBe("gpt-5.4-mini");
    expect(updatedTask.comments[0].previous_status).toBe("pending");
    expect(updatedTask.comments[0].next_status).toBe("in_progress");
  });

  it("requires comment when status changes", async () => {
    await router("tools/call", {
      name: "task-create",
      arguments: {
        repo: REPO,
        task_code: "TASK-003",
        phase: "implementation",
        title: "Comment enforcement",
        description: "Task used to verify status change comment enforcement",
        status: "pending",
        priority: 3
      }
    });

    const taskId = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-003")?.id;
    expect(taskId).toBeDefined();

    await expect(router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: taskId,
        status: "in_progress"
      }
    })).rejects.toThrow("comment is required when updating task status");
  });

  it("stores standalone comments without mutating description", async () => {
    await router("tools/call", {
      name: "task-create",
      arguments: {
        repo: REPO,
        task_code: "TASK-004",
        phase: "implementation",
        title: "Standalone comments",
        description: "Original description",
        status: "pending",
        priority: 3,
        agent: "Seeder",
        role: "user"
      }
    });

    const taskId = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-004")?.id;
    expect(taskId).toBeDefined();

    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: taskId,
        comment: "Investigated root cause and prepared next steps",
        agent: "Agent C",
        model: "gpt-5.4"
      }
    });

    const task = db.getTaskById(taskId);
    expect(task.description).toBe("Original description");
    expect(task.comments).toHaveLength(1);
    expect(task.comments[0].previous_status).toBeNull();
    expect(task.comments[0].next_status).toBeNull();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouter } from "../router.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { StubVectorStore } from "../storage/vectors.stub.js";
import type { VectorStore } from "../types.js";

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
      uri: `tasks://tasks?repo=${REPO}`
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
        priority: 5,
        est_tokens: 120
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
        status: "backlog",
        depends_on: taskAId,
        priority: 4,
        est_tokens: 240
      }
    });
    const taskBId = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-002").id;

    // Verify both are pending
    const plannedRes = await router("resources/read", { uri: `tasks://tasks?repo=${REPO}` });
    const plannedTasks = JSON.parse(plannedRes.contents[0].text);
    expect(plannedTasks.length).toBe(2);

    // Verify task-list tool works
    const listToolRes = await router("tools/call", {
      name: "task-list",
      arguments: { repo: REPO }
    });
    const listToolTasks = (listToolRes.structuredContent as any).tasks;
    expect(listToolTasks.rows.length).toBe(2);

    // ---- 3. EXECUTION PHASE ----
    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: taskAId,
        status: "in_progress",
        comment: "Started architecture review",
        agent: "Agent A",
        role: "backend",
        model: "gpt-5.4",
        est_tokens: 180
      }
    });

    const inProgressRes = await router("resources/read", { uri: `tasks://tasks?repo=${REPO}` });
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
        role: "backend",
        model: "gpt-5.4",
        est_tokens: 180
      }
    });

    const afterARes = await router("resources/read", { uri: `tasks://tasks?repo=${REPO}` });
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
        role: "frontend",
        model: "gpt-5.4-mini",
        est_tokens: 320
      }
    });

    const finalCheckRes = await router("resources/read", { uri: `tasks://tasks?repo=${REPO}` });
    const finalCheckTasks = JSON.parse(finalCheckRes.contents[0].text);
    expect(finalCheckTasks[0].status).toBe("in_progress");

    const updatedTask = db.getTaskById(taskBId);
    expect(updatedTask.comments).toHaveLength(1);
    expect(updatedTask.comments[0].comment).toContain("Implementation started");
    expect(updatedTask.comments[0].agent).toBe("Agent B");
    expect(updatedTask.comments[0].model).toBe("gpt-5.4-mini");
    expect(updatedTask.comments[0].previous_status).toBe("backlog");
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
        priority: 3,
        est_tokens: 90
      }
    });

    const taskId = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-003")?.id;
    expect(taskId).toBeDefined();

    await expect(router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: taskId,
        status: "in_progress",
        agent: "TestAgent",
        role: "testing",
        est_tokens: 50
      }
    })).rejects.toThrow("comment is required when changing task status");
  });

  it("allows task-create without est_tokens", async () => {
    await router("tools/call", {
      name: "task-create",
      arguments: {
        repo: REPO,
        task_code: "TASK-003A",
        phase: "implementation",
        title: "Create without token estimate",
        description: "Should still be accepted during planning",
        status: "pending",
        priority: 3
      }
    });

    const task = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-003A");
    expect(task).toBeDefined();
    expect(task?.est_tokens).toBe(0);
  });

  it("requires est_tokens when changing task status to completed", async () => {
    await router("tools/call", {
      name: "task-create",
      arguments: {
        repo: REPO,
        task_code: "TASK-003B",
        phase: "implementation",
        title: "Completion requires token estimate",
        description: "Used to verify completed status analytics requirement",
        status: "backlog",
        priority: 3
      }
    });

    const taskId = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-003B")?.id;
    expect(taskId).toBeDefined();

    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: taskId,
        status: "in_progress",
        comment: "Starting work",
        agent: "Agent E",
        role: "backend"
      }
    });

    await expect(router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: taskId,
        status: "completed",
        comment: "Finished work but forgot token estimate",
        agent: "Agent E",
        role: "backend"
      }
    })).rejects.toThrow("est_tokens is required when changing task status to completed");
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
        est_tokens: 90,
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
        role: "security",
        model: "gpt-5.4",
        est_tokens: 75,
      }
    });

    const task = db.getTaskById(taskId);
    expect(task.description).toBe("Original description");
    expect(task.comments).toHaveLength(1);
    expect(task.comments[0].previous_status).toBeNull();
    expect(task.comments[0].next_status).toBeNull();
  });

  it("auto-populates timestamps from status so agents do not need to send them manually", async () => {
    await router("tools/call", {
      name: "task-create",
      arguments: {
        repo: REPO,
        task_code: "TASK-005",
        phase: "implementation",
        title: "Auto timestamp on create",
        description: "Created as backlog then moved to in progress",
        status: "backlog",
        priority: 3,
        est_tokens: 110
      }
    });

    const createdTask = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-005");
    expect(createdTask?.in_progress_at).toBeNull();
    expect(createdTask?.finished_at).toBeNull();

    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: createdTask.id,
        status: "in_progress",
        comment: "Starting work",
        agent: "Agent D",
        role: "backend"
      }
    });

    const inProgressTask = db.getTaskById(createdTask.id);
    expect(inProgressTask.in_progress_at).toBeTruthy();

    await router("tools/call", {
      name: "task-update",
      arguments: {
        repo: REPO,
        id: createdTask.id,
        status: "completed",
        comment: "Done without providing timestamps manually",
        agent: "Agent D",
        role: "backend",
        est_tokens: 210
      }
    });

    const completedTask = db.getTaskById(createdTask.id);
    expect(completedTask.in_progress_at).toBeTruthy();
    expect(completedTask.finished_at).toBeTruthy();
  });
});

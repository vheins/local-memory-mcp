import { describe, it, expect, beforeEach } from "vitest";
import { handleTaskList, handleTaskCreate, handleTaskUpdate } from "../tools/task.manage.js";
import { SQLiteStore } from "../storage/sqlite.js";

function getTextContent(result: Awaited<ReturnType<typeof handleTaskList>>) {
  return (result.structuredContent as any)?._summary || "[]";
}

describe("Task Search and Filtering", () => {
  let db: SQLiteStore;
  const REPO = "test-search-repo";

  beforeEach(async () => {
    // Use in-memory database for testing
    db = new SQLiteStore(":memory:");
    const mockVectors = {
      upsert: async () => {},
      remove: async () => {},
      search: async () => []
    } as any;
    
    // Seed some test data
    // handleTaskCreate only allows 'backlog' or 'pending'
    // To get other statuses, we create as pending and then update
    
    // TASK-001: in_progress
    await handleTaskCreate({
      repo: REPO,
      task_code: "TASK-001",
      phase: "Development",
      title: "Implement authentication",
      description: "Setup JWT and OAuth2",
      status: "pending",
      agent: "test-agent",
      role: "test-role"
    }, db);
    const task1 = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-001");
    await handleTaskUpdate({
      repo: REPO,
      id: task1.id,
      status: "in_progress",
      comment: "Starting work",
      agent: "test-agent",
      role: "test-role"
    }, db, mockVectors);

    // TASK-002: pending
    await handleTaskCreate({
      repo: REPO,
      task_code: "TASK-002",
      phase: "Testing",
      title: "Write unit tests",
      description: "Cover all auth edge cases",
      status: "pending",
      agent: "test-agent",
      role: "test-role"
    }, db);

    // DB-FIX-003: blocked
    await handleTaskCreate({
      repo: REPO,
      task_code: "DB-FIX-003",
      phase: "Maintenance",
      title: "Fix database leak",
      description: "Connections not closing properly",
      status: "pending",
      agent: "test-agent",
      role: "test-role"
    }, db);
    const task3 = db.getTasksByRepo(REPO).find(t => t.task_code === "DB-FIX-003");
    await handleTaskUpdate({
      repo: REPO,
      id: task3.id,
      status: "blocked",
      comment: "Missing DB access",
      agent: "test-agent",
      role: "test-role"
    }, db, mockVectors);
  });

  it("should search tasks by title", async () => {
    const result = await handleTaskList({
      repo: REPO,
      search: "authentication"
    }, db);
    
    const tasks = (result.structuredContent as any).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task_code).toBe("TASK-001");
  });

  it("should search tasks by description", async () => {
    const result = await handleTaskList({
      repo: REPO,
      search: "edge cases"
    }, db);
    
    const tasks = (result.structuredContent as any).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task_code).toBe("TASK-002");
  });

  it("should search tasks by task code", async () => {
    const result = await handleTaskList({
      repo: REPO,
      search: "DB-FIX"
    }, db);
    
    const tasks = (result.structuredContent as any).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task_code).toBe("DB-FIX-003");
  });

  it("should filter by multiple statuses", async () => {
    const result = await handleTaskList({
      repo: REPO,
      status: "in_progress,blocked"
    }, db);
    
    const tasks = (result.structuredContent as any).tasks;
    expect(tasks).toHaveLength(2);
    const codes = tasks.map((t: any) => t.task_code);
    expect(codes).toContain("TASK-001");
    expect(codes).toContain("DB-FIX-003");
  });

  it("should support 'all' status to include everything", async () => {
    const result = await handleTaskList({
      repo: REPO,
      status: "all"
    }, db);
    
    const tasks = (result.structuredContent as any).tasks;
    expect(tasks).toHaveLength(3);
  });

  it("should combine search and status filtering", async () => {
    const result = await handleTaskList({
      repo: REPO,
      search: "auth",
      status: "pending"
    }, db);
    
    const tasks = (result.structuredContent as any).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task_code).toBe("TASK-002");
  });

  it("should return empty list if no matches found", async () => {
    const result = await handleTaskList({
      repo: REPO,
      search: "non-existent-task"
    }, db);
    
    const tasks = (result.structuredContent as any).tasks;
    expect(tasks).toHaveLength(0);
  });

  describe("Router Integration (task-search)", () => {
    // Testing the mapping logic that will be used in router.ts
    it("should map task-search query to handleTaskList search param", async () => {
      // Logic from router.ts:
      const args = { repo: REPO, query: "authentication" };
      const searchArgs = { ...args, search: args.query };
      // @ts-ignore
      if (!searchArgs.status) searchArgs.status = "all";
      
      const result = await handleTaskList(searchArgs, db);
      const tasks = (result.structuredContent as any).tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].task_code).toBe("TASK-001");
    });
  });
});

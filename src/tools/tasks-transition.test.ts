import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTaskUpdate, handleTaskCreate } from "./task.manage.js";
import { SQLiteStore } from "../storage/sqlite.js";

describe("Task Status Transitions", () => {
  let db: SQLiteStore;
  const REPO = "test-repo";

  beforeEach(() => {
    db = new SQLiteStore(":memory:");
  });

  async function createTask(taskCode: string, status: string) {
    return await handleTaskCreate({
      repo: REPO,
      task_code: taskCode,
      phase: "test",
      title: "Test Task",
      description: "Test Description",
      status: status,
      agent: "test-agent",
      role: "test-role"
    }, db);
  }

  it("should block transition from pending to completed", async () => {
    await createTask("TASK-001", "pending");
    const task = db.getTasksByRepo(REPO)[0];

    await expect(handleTaskUpdate({
      repo: REPO,
      id: task.id,
      status: "completed",
      comment: "finishing",
      est_tokens: 100,
      agent: "test-agent",
      role: "test-role"
    }, db)).rejects.toThrow("Cannot transition directly from 'pending' to 'completed'. Task must be 'in_progress' first.");
  });

  it("should allow transition from pending to in_progress", async () => {
    await createTask("TASK-001", "pending");
    const task = db.getTasksByRepo(REPO)[0];

    await handleTaskUpdate({
      repo: REPO,
      id: task.id,
      status: "in_progress",
      comment: "starting",
      agent: "test-agent",
      role: "test-role"
    }, db);

    const updatedTask = db.getTaskById(task.id);
    expect(updatedTask.status).toBe("in_progress");
  });

  it("should allow transition from in_progress to completed", async () => {
    await createTask("TASK-001", "in_progress");
    const task = db.getTasksByRepo(REPO)[0];

    await handleTaskUpdate({
      repo: REPO,
      id: task.id,
      status: "completed",
      comment: "done",
      est_tokens: 100,
      agent: "test-agent",
      role: "test-role"
    }, db);

    const updatedTask = db.getTaskById(task.id);
    expect(updatedTask.status).toBe("completed");
  });

  it("should allow transition to blocked and back", async () => {
    await createTask("TASK-001", "in_progress");
    const task = db.getTasksByRepo(REPO)[0];

    // to blocked
    await handleTaskUpdate({
      repo: REPO,
      id: task.id,
      status: "blocked",
      comment: "waiting for feedback",
      agent: "test-agent",
      role: "test-role"
    }, db);
    expect(db.getTaskById(task.id).status).toBe("blocked");

    // back to in_progress
    await handleTaskUpdate({
      repo: REPO,
      id: task.id,
      status: "in_progress",
      comment: "feedback received",
      agent: "test-agent",
      role: "test-role"
    }, db);
    expect(db.getTaskById(task.id).status).toBe("in_progress");

    // to blocked from pending
    await createTask("TASK-002", "pending");
    const task2 = db.getTasksByRepo(REPO).find(t => t.task_code === "TASK-002");
    await handleTaskUpdate({
      repo: REPO,
      id: task2.id,
      status: "blocked",
      comment: "blocked early",
      agent: "test-agent",
      role: "test-role"
    }, db);
    expect(db.getTaskById(task2.id).status).toBe("blocked");
  });

  it("should block transition from blocked to completed", async () => {
    await createTask("TASK-001", "blocked");
    const task = db.getTasksByRepo(REPO)[0];

    await expect(handleTaskUpdate({
      repo: REPO,
      id: task.id,
      status: "completed",
      comment: "finishing anyway",
      est_tokens: 100,
      agent: "test-agent",
      role: "test-role"
    }, db)).rejects.toThrow("Cannot transition directly from 'blocked' to 'completed'. Task must be 'in_progress' first.");
  });
});

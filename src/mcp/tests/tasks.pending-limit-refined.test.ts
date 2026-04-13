import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTaskCreate, handleTaskUpdate } from "../tools/task.manage";
import { createTestStore } from "../storage/sqlite";
import { Task, VectorStore } from "../types";

describe("Task Pending Limit Refined Validation", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let mockVectors: VectorStore;
	const REPO = "test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		mockVectors = {
			upsert: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			search: vi.fn().mockResolvedValue([])
		} as unknown as VectorStore;
	});

	async function createManyPending(count: number) {
		for (let i = 0; i < count; i++) {
			await handleTaskCreate(
				{
					repo: REPO,
					task_code: `TASK-${i}`,
					phase: "test",
					title: "Test Task",
					description: "Test Description",
					status: "pending",
					agent: "test-agent",
					role: "test-role"
				},
				db
			);
		}
	}

	it("should block creating the 11th pending task", async () => {
		await createManyPending(10);

		await expect(
			handleTaskCreate(
				{
					repo: REPO,
					task_code: "TASK-11",
					phase: "test",
					title: "11th Task",
					description: "Should fail",
					status: "pending",
					agent: "test-agent",
					role: "test-role"
				},
				db
			)
		).rejects.toThrow(/Maximum of 10 pending tasks reached/);
	});

	it("should ALLOW moving from backlog to pending even if limit reached", async () => {
		await createManyPending(10);

		// Create one backlog task (allowed)
		await handleTaskCreate(
			{
				repo: REPO,
				task_code: "TASK-BACKLOG",
				phase: "test",
				title: "Backlog Task",
				description: "In backlog",
				status: "backlog",
				agent: "test-agent",
				role: "test-role"
			},
			db
		);

		const task = db.tasks.getTasksByRepo(REPO).find((t) => (t as Task).task_code === "TASK-BACKLOG");
		if (!task) throw new Error("Seed task not found");

		// Move to pending (should be ALLOWED now)
		await handleTaskUpdate(
			{
				repo: REPO,
				id: task.id,
				status: "pending",
				comment: "ready to start",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		const updatedTask = db.tasks.getTaskById(task.id);
		if (!updatedTask) throw new Error("Updated task not found");
		expect(updatedTask.status).toBe("pending");

		const stats = db.tasks.getTaskStats(REPO);
		expect(stats.todo).toBe(11);
	});
});

import { describe, it, expect, beforeEach } from "vitest";
import { handleTaskList, handleTaskCreate, handleTaskUpdate } from "../tools/task.manage";
import { createTestStore } from "../storage/sqlite";
import { Task, VectorStore } from "../types";

describe("Task Search and Filtering", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	const REPO = "test-search-repo";

	beforeEach(async () => {
		// Use in-memory database for testing
		db = await createTestStore();
		const mockVectors = {
			upsert: async () => {},
			remove: async () => {},
			search: async () => []
		} as unknown as VectorStore;

		// Seed some test data
		// handleTaskCreate only allows 'backlog' or 'pending'
		// To get other statuses, we create as pending and then update

		// TASK-001: in_progress
		await handleTaskCreate(
			{
				repo: REPO,
				task_code: "TASK-001",
				phase: "Development",
				title: "Implement authentication",
				description: "Setup JWT and OAuth2",
				status: "pending", structured: true,
				agent: "test-agent",
				role: "test-role"
			},
			db
		);
		const task1 = db.tasks.getTasksByRepo(REPO).find((t: Task) => t.task_code === "TASK-001");
		if (!task1) throw new Error("Task 1 seed failed");
		await handleTaskUpdate(
			{
				repo: REPO,
				id: task1.id,
				status: "in_progress",
				comment: "Starting work",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		// TASK-002: pending
		await handleTaskCreate(
			{
				repo: REPO,
				task_code: "TASK-002",
				phase: "Testing",
				title: "Write unit tests",
				description: "Cover all auth edge cases",
				status: "pending", structured: true,
				agent: "test-agent",
				role: "test-role"
			},
			db
		);

		// DB-FIX-003: blocked
		await handleTaskCreate(
			{
				repo: REPO,
				task_code: "DB-FIX-003",
				phase: "Maintenance",
				title: "Fix database leak",
				description: "Connections not closing properly",
				status: "pending", structured: true,
				agent: "test-agent",
				role: "test-role"
			},
			db
		);
		const task3 = db.tasks.getTasksByRepo(REPO).find((t: Task) => t.task_code === "DB-FIX-003");
		if (!task3) throw new Error("Task 3 seed failed");
		await handleTaskUpdate(
			{
				repo: REPO,
				id: task3.id,
				status: "blocked",
				comment: "Missing DB access",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
	});

	it("should search tasks by title", async () => {
		const result = await handleTaskList(
			{
				repo: REPO,
				query: "authentication", structured: true
			},
			db
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("TASK-001");
	});

	it("should search tasks by description", async () => {
		const result = await handleTaskList(
			{
				repo: REPO,
				query: "edge cases", structured: true
			},
			db
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("TASK-002");
	});

	it("should search tasks by task code", async () => {
		const result = await handleTaskList(
			{
				repo: REPO,
				query: "DB-FIX", structured: true
			},
			db
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("DB-FIX-003");
	});

	it("should filter by multiple statuses", async () => {
		const result = await handleTaskList(
			{
				repo: REPO,
				status: "in_progress,blocked", structured: true
			},
			db
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(2);
		const codes = tasks.rows.map((r: unknown[]) => r[1]);
		expect(codes).toContain("TASK-001");
		expect(codes).toContain("DB-FIX-003");
	});

	it("should support 'all' status to include everything", async () => {
		const result = await handleTaskList(
			{
				repo: REPO,
				status: "all", structured: true
			},
			db
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(3);
	});

	it("should combine search and status filtering", async () => {
		const result = await handleTaskList(
			{
				repo: REPO,
				query: "auth",
				status: "pending", structured: true
			},
			db
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("TASK-002");
	});

	it("should return empty list if no matches found", async () => {
		const result = await handleTaskList(
			{
				repo: REPO,
				query: "non-existent-task", structured: true
			},
			db
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(0);
	});

	describe("Unified task-list", () => {
		it("should provide same discovery as old task-search", async () => {
			const args = { repo: REPO, query: "authentication", status: "all", structured: true };
			const result = await handleTaskList(args, db);
			const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
			expect(tasks.rows).toHaveLength(1);
			expect(tasks.rows[0][1]).toBe("TASK-001");
			// TASK-001 has one comment added in handleTaskUpdate
			// Index 5 is updated_at, index 6 is comments_count
			expect(tasks.rows[0][6]).toBe(1);
		});
	});
});

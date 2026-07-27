import { describe, it, expect, beforeEach } from "vitest";
import { handleTaskWrite } from "../tools/task.write";
import { handleTaskRead } from "../tools/task.read";
import { createTestStore } from "../storage/sqlite";
import { VectorStore } from "../types";

describe("Consolidated Task Read — Search and Filtering", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let mockVectors: VectorStore;
	const REPO = "test-search-repo";

	beforeEach(async () => {
		// Use in-memory database for testing
		db = await createTestStore();
		mockVectors = {
			upsert: async () => {},
			remove: async () => {},
			search: async () => []
		} as unknown as VectorStore;

		// Seed some test data
		// handleTaskCreate only allows 'backlog' or 'pending'
		// To get other statuses, we create as pending and then update

		// TASK-001: in_progress
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "TASK-001",
				phase: "Development",
				title: "Implement authentication",
				description: "Setup JWT and OAuth2",
				status: "pending",
				json: true,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
		const task1 = db.tasks.getTaskByCode("test", REPO, "TASK-001");
		if (!task1) throw new Error("Task 1 seed failed");
		await handleTaskWrite(
			{
				owner: "test",
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
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "TASK-002",
				phase: "Testing",
				title: "Write unit tests",
				description: "Cover all auth edge cases",
				status: "pending",
				json: true,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		// DB-FIX-003: blocked
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "DB-FIX-003",
				phase: "Maintenance",
				title: "Fix database leak",
				description: "Connections not closing properly",
				status: "pending",
				json: true,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
		const task3 = db.tasks.getTaskByCode("test", REPO, "DB-FIX-003");
		if (!task3) throw new Error("Task 3 seed failed");
		await handleTaskWrite(
			{
				owner: "test",
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
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "authentication",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("TASK-001");
	});

	it("should search tasks by description", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "edge cases",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("TASK-002");
	});

	it("should search tasks by task code", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "DB-FIX",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("DB-FIX-003");
	});

	it("should filter by multiple statuses", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				status: "in_progress,blocked",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(2);
		const codes = tasks.rows.map((r: unknown[]) => r[1]);
		expect(codes).toContain("TASK-001");
		expect(codes).toContain("DB-FIX-003");
	});

	it("should support 'all' status to include everything", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				status: "all",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(3);
	});

	it("should combine search and status filtering", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "auth",
				status: "pending",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("TASK-002");
	});

	it("should return empty list if no matches found", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "non-existent-task",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(0);
	});

	describe("Unified task-read discovery", () => {
		it("should provide same discovery as old task-search", async () => {
			const args = { repo: REPO, owner: "test", query: "authentication", status: "all", json: true };
			const result = await handleTaskRead(args, db, mockVectors);
			const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
			expect(tasks.rows).toHaveLength(1);
			expect(tasks.rows[0][1]).toBe("TASK-001");
			// TASK-001 has one comment added in handleTaskUpdate
			// Search mode columns: id, task_code, title, status, priority, updated_at, phase
		});
	});
});

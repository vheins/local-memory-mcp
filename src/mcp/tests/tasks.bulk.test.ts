import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent, McpResponse } from "../utils/mcp-response";

function getTextContent(result: McpResponse) {
	return getPrimaryTextContent(result) || (result.structuredContent as { text?: string })?.text || "";
}

describe("MCP Local Memory - Bulk Task Management", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;
	let router: (method: string, params: unknown) => Promise<McpResponse>;

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
		expect(getTextContent(res)).toContain(`Created 2 tasks in repo "${REPO}".`);

		const tasks = db.tasks.getTasksByRepo(REPO);
		expect(tasks.length).toBe(2);
		expect(tasks.find((t) => t.task_code === "BULK-001")).toBeDefined();
		expect(tasks.find((t) => t.task_code === "BULK-002")).toBeDefined();
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
		const task = db.tasks.getTasksByRepo(REPO).find((t) => t.task_code === "BULK-NO-TOKENS");
		expect(task?.est_tokens).toBe(0);
	});

	it("should enforce default limit of 15 and support pagination", async () => {
		// Create 20 tasks
		const manyTasks = Array.from({ length: 20 }, (_, i) => ({
			task_code: `LIMIT-${i.toString().padStart(3, "0")}`,
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
		const defaultTasks = (defaultRes.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(defaultTasks.rows.length).toBe(15);

		// Test explicit limit
		const limitRes = await router("tools/call", {
			name: "task-list",
			arguments: { repo: REPO, limit: 5 }
		});
		const limitedTasks = (limitRes.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(limitedTasks.rows.length).toBe(5);

		// Test offset (last page)
		const offsetRes = await router("tools/call", {
			name: "task-list",
			arguments: { repo: REPO, limit: 15, offset: 15 }
		});
		const offsetTasks = (offsetRes.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(offsetTasks.rows.length).toBe(5); // 20 total - 15 offset = 5 remaining
	});

	it("should summarize filtered task counts with pending and in-progress context", async () => {
		await router("tools/call", {
			name: "task-bulk-manage",
			arguments: {
				action: "bulk_create",
				repo: REPO,
				tasks: [
					{
						task_code: "SUM-001",
						title: "Completed task",
						description: "Already finished",
						phase: "implementation",
						status: "backlog",
						est_tokens: 20
					},
					{
						task_code: "SUM-002",
						title: "Pending task",
						description: "Waiting to start",
						phase: "implementation",
						status: "pending",
						est_tokens: 20
					},
					{
						task_code: "SUM-003",
						title: "In progress task",
						description: "Currently active",
						phase: "implementation",
						status: "pending",
						est_tokens: 20
					}
				]
			}
		});

		const completedId = db.tasks.getTasksByRepo(REPO).find((task) => task.task_code === "SUM-001")?.id;
		const inProgressId = db.tasks.getTasksByRepo(REPO).find((task) => task.task_code === "SUM-003")?.id;

		await router("tools/call", {
			name: "task-update",
			arguments: {
				repo: REPO,
				id: completedId,
				status: "in_progress",
				comment: "Starting completion path",
				agent: "Test Agent",
				role: "tester",
				est_tokens: 25
			}
		});

		await router("tools/call", {
			name: "task-update",
			arguments: {
				repo: REPO,
				id: completedId,
				status: "completed",
				comment: "Finished work",
				agent: "Test Agent",
				role: "tester",
				est_tokens: 30
			}
		});

		await router("tools/call", {
			name: "task-update",
			arguments: {
				repo: REPO,
				id: inProgressId,
				status: "in_progress",
				comment: "Work started",
				agent: "Test Agent",
				role: "tester",
				est_tokens: 25
			}
		});

		const result = await router("tools/call", {
			name: "task-list",
			arguments: { repo: REPO, status: "completed" }
		});

		expect(getTextContent(result)).toContain(`Found 1 completed task in repo "${REPO}".`);
		expect(getTextContent(result)).toContain("Pending: 1.");
		expect(getTextContent(result)).toContain("In progress: 1.");
		expect(getTextContent(result)).toContain("Use task-detail with Task ID or task_code to read full details.");
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
					{
						task_code: "EXISTING-001",
						title: "Duplicate",
						description: "D",
						phase: "p",
						status: "pending",
						est_tokens: 30
					}
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

		const tasks = db.tasks.getTasksByRepo(REPO);
		const idsToDelete = [tasks[0].id, tasks[1].id];

		const delRes = await router("tools/call", {
			name: "task-bulk-manage",
			arguments: {
				action: "bulk_delete",
				repo: REPO,
				ids: idsToDelete
			}
		});

		expect(getTextContent(delRes)).toContain(`Deleted 2 tasks from repo "${REPO}".`);
		const remainingTasks = db.tasks.getTasksByRepo(REPO);
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

		const tasks = db.tasks.getTasksByRepo(REPO);
		const ts1 = tasks.find((t) => t.task_code === "TS-1");
		const ts2 = tasks.find((t) => t.task_code === "TS-2");

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

		const started = db.tasks.getTaskById(ts1.id);
		const done = db.tasks.getTaskById(ts2.id);

		expect(started?.in_progress_at).toBeTruthy();
		expect(started?.finished_at).toBeNull();
		expect(done?.finished_at).toBeTruthy();
	});

	it("should bulk update tasks from pending to completed", async () => {
		// Create 3 pending tasks
		await router("tools/call", {
			name: "task-bulk-manage",
			arguments: {
				action: "bulk_create",
				repo: REPO,
				tasks: [
					{ task_code: "UP-1", title: "Task 1", description: "D", phase: "p", status: "pending", est_tokens: 10 },
					{ task_code: "UP-2", title: "Task 2", description: "D", phase: "p", status: "pending", est_tokens: 10 },
					{ task_code: "UP-3", title: "Task 3", description: "D", phase: "p", status: "pending", est_tokens: 10 }
				]
			}
		});

		const tasks = db.tasks.getTasksByRepo(REPO);
		const ids = tasks.map((t) => t.id);

		// Bulk update to completed
		const upRes = await router("tools/call", {
			name: "task-bulk-manage",
			arguments: {
				action: "bulk_update",
				repo: REPO,
				ids: ids,
				updates: {
					status: "completed",
					comment: "Bulk completion test",
					est_tokens: 500
				}
			}
		});

		expect(upRes.isError).toBe(false);
		expect(getTextContent(upRes)).toContain(`Updated 3 tasks in repo "${REPO}" to status "completed".`);

		const updatedTasks = db.tasks.getTasksByRepo(REPO);
		updatedTasks.forEach((t) => {
			expect(t.status).toBe("completed");
			expect(t.finished_at).toBeTruthy();
			expect(t.est_tokens).toBe(500);
		});

		// Verify task archive memory created
		const memories = db.memories.searchByRepo(REPO);
		const archMemories = memories.filter((m) => m.type === "task_archive");
		expect(archMemories.length).toBe(3);

		// Verify comments created
		const comments = db.tasks.getTaskCommentsByTaskId(ids[0]);
		expect(comments.length).toBe(1);
		expect(comments[0].comment).toBe("Bulk completion test");
		expect(comments[0].next_status).toBe("completed");
	});

	it("should bulk update statuses and record in-progress timestamps", async () => {
		await router("tools/call", {
			name: "task-bulk-manage",
			arguments: {
				action: "bulk_create",
				repo: REPO,
				tasks: [{ task_code: "IP-1", title: "Task 1", description: "D", phase: "p", status: "pending" }]
			}
		});

		const taskId = db.tasks.getTasksByRepo(REPO)[0].id;

		await router("tools/call", {
			name: "task-bulk-manage",
			arguments: {
				action: "bulk_update",
				repo: REPO,
				ids: [taskId],
				updates: {
					status: "in_progress"
				}
			}
		});

		const task = db.tasks.getTaskById(taskId);
		expect(task?.status).toBe("in_progress");
		expect(task?.in_progress_at).toBeTruthy();
	});
});

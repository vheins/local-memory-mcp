import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent, McpResponse } from "../utils/mcp-response";

function getTextContent(result: McpResponse) {
	return getPrimaryTextContent(result) || (result.structuredContent as { text?: string })?.text || "";
}

describe("MCP Local Memory - Consolidated Task Tools Bulk Operations", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (
		method: string,
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (progress: number, total?: number) => void
	) => Promise<McpResponse>;

	const REPO = "bulk-test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const originalRouter = createRouter(db, vectors);
		router = async (method, params) => {
			try {
				return (await originalRouter(method, params)) as any;
			} catch (err: any) {
				return {
					isError: true,
					content: [{ type: "text", text: err?.message || String(err) }]
				} as McpResponse;
			}
		};
	});

	it("should create multiple tasks in one call", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
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
		expect(getTextContent(res)).toContain(`Created 2 tasks in "${REPO}`);

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		expect(tasks.length).toBe(2);
		expect(tasks.find((t) => t.task_code === "BULK-001")).toBeDefined();
		expect(tasks.find((t) => t.task_code === "BULK-002")).toBeDefined();
	});

	it("should auto-generate task_codes for bulk tasks without task_code", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{
						title: "Auto Bulk 1",
						description: "First auto-generated bulk task",
						phase: "research",
						status: "pending",
						priority: 3
					},
					{
						title: "Auto Bulk 2",
						description: "Second auto-generated bulk task",
						phase: "implementation",
						status: "backlog",
						priority: 2
					}
				]
			}
		});

		expect(res.isError).toBe(false);

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		expect(tasks.length).toBe(2);

		const task1 = tasks.find((t) => t.task_code === "TASK-001");
		const task2 = tasks.find((t) => t.task_code === "TASK-002");
		expect(task1).toBeDefined();
		expect(task2).toBeDefined();
		expect(task1?.title).toBe("Auto Bulk 1");
		expect(task2?.title).toBe("Auto Bulk 2");
	});

	it("should allow bulk create without est_tokens", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
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
		const task = db.tasks.getTaskByCode("test", REPO, "BULK-NO-TOKENS");
		expect(task?.est_tokens).toBe(0);
	});

	it("should enforce default limit of 5 and support pagination", async () => {
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
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: manyTasks
			}
		});

		// Test default limit (15)
		const defaultRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", json: true }
		});
		const defaultTasks = (defaultRes.structuredContent as any).tasks;
		expect(defaultTasks.rows.length).toBe(5); // Default limit is 5

		// Test explicit limit
		const limitRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", limit: 10, json: true }
		});
		const limitedTasks = (limitRes.structuredContent as any).tasks;
		expect(limitedTasks.rows.length).toBe(10);

		// Test offset (last page)
		const offsetRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", limit: 15, offset: 15, json: true }
		});
		const offsetTasks = (offsetRes.structuredContent as any).tasks;
		expect(offsetTasks.rows.length).toBe(5); // 20 total - 15 offset = 5 remaining
	});

	it("should summarize filtered task counts with pending and in-progress context", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
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

		const completedId = db.tasks.getTaskByCode("test", REPO, "SUM-001")?.id;
		const inProgressId = db.tasks.getTaskByCode("test", REPO, "SUM-003")?.id;

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
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
			name: "task-write",
			arguments: {
				owner: "test",
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
			name: "task-write",
			arguments: {
				owner: "test",
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
			name: "task-read",
			arguments: { repo: REPO, owner: "test", status: "completed" }
		});

		expect(getTextContent(result)).toContain(`### Results: 1 tasks in repo "${REPO}"`);
		expect(getTextContent(result)).toContain("**Completed (1)**");
		expect(getTextContent(result)).toContain("- SUM-001 [P3] [implementation] Completed task");
		expect(getTextContent(result)).toContain("See task-detail with task_code for details.");
	});

	it("should reject duplicate task_codes in the same request", async () => {
		const result = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{ task_code: "DUP-001", title: "Task 1", description: "D", phase: "p", status: "pending", est_tokens: 10 },
					{ task_code: "DUP-001", title: "Task 2", description: "D", phase: "p", status: "pending", est_tokens: 12 }
				]
			}
		});

		expect(result.isError).toBe(true);
		expect(getTextContent(result)).toContain("Duplicate task_code in request: 'DUP-001'");
	});

	it("should reject duplicate task_codes against existing tasks", async () => {
		// Create first task with code EXISTING-001
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "EXISTING-001",
				title: "Initial",
				description: "D",
				phase: "p",
				status: "pending",
				est_tokens: 25
			}
		});

		// Bulk write with same code — should reject
		const bulkResult = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
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
		expect(bulkResult.isError).toBe(true);
		expect(getTextContent(bulkResult)).toContain("Task code 'EXISTING-001' already exists");

		// Single write with same code — should also reject
		const singleResult = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "EXISTING-001",
				title: "Duplicate",
				description: "D",
				phase: "p",
				status: "pending",
				est_tokens: 30
			}
		});
		expect(singleResult.isError).toBe(true);
		expect(getTextContent(singleResult)).toContain("Task code 'EXISTING-001' already exists");
	});

	it("should bulk soft-delete tasks", async () => {
		// Create 3 tasks
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{ task_code: "DEL-1", title: "Task 1", description: "Desc 1", phase: "p", status: "pending", est_tokens: 15 },
					{ task_code: "DEL-2", title: "Task 2", description: "Desc 2", phase: "p", status: "pending", est_tokens: 16 },
					{ task_code: "DEL-3", title: "Task 3", description: "Desc 3", phase: "p", status: "pending", est_tokens: 17 }
				]
			}
		});

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		const idsToDelete = [tasks[0].id, tasks[1].id];

		const delRes = await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: idsToDelete
			}
		});

		expect(getTextContent(delRes)).toContain(`Deleted 2 tasks from "${REPO}`);
		const remainingTasks = db.tasks.getTasksByRepo("test", REPO);
		expect(remainingTasks.length).toBe(3); // soft-delete keeps records
		expect(remainingTasks.filter((t) => t.status !== "canceled").length).toBe(1);
	});

	it("auto-populates timestamps from status so agents do not need to send them manually", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{ task_code: "TS-1", title: "To Start", description: "Desc", phase: "p", status: "backlog", est_tokens: 40 },
					{ task_code: "TS-2", title: "To Finish", description: "Desc", phase: "p", status: "backlog", est_tokens: 60 }
				]
			}
		});

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		const ts1 = tasks.find((t) => t.task_code === "TS-1");
		const ts2 = tasks.find((t) => t.task_code === "TS-2");

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: ts1!.id,
				status: "in_progress",
				comment: "Starting TS-1",
				agent: "Agent-1",
				role: "tester"
			}
		});

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: ts2!.id,
				status: "in_progress",
				comment: "Starting TS-2",
				agent: "Agent-1",
				role: "tester"
			}
		});

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: ts2!.id,
				status: "completed",
				comment: "Finishing TS-2",
				agent: "Agent-1",
				role: "tester",
				est_tokens: 100
			}
		});

		const started = db.tasks.getTaskById(ts1!.id);
		const done = db.tasks.getTaskById(ts2!.id);

		expect(started?.in_progress_at).toBeTruthy();
		expect(started?.finished_at).toBeNull();
		expect(done?.finished_at).toBeTruthy();
	});

	it("should bulk update tasks from pending to completed", async () => {
		// Create 3 pending tasks
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{ task_code: "UP-1", title: "Task 1", description: "D", phase: "p", status: "pending", est_tokens: 10 },
					{ task_code: "UP-2", title: "Task 2", description: "D", phase: "p", status: "pending", est_tokens: 10 },
					{ task_code: "UP-3", title: "Task 3", description: "D", phase: "p", status: "pending", est_tokens: 10 }
				]
			}
		});

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		const ids = tasks.map((t) => t.id);

		// Bulk update to completed
		const upRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: ids,
				status: "completed",
				comment: "Bulk completion test",
				est_tokens: 500,
				force: true
			}
		});

		expect(upRes.isError).toBe(false);
		expect(getTextContent(upRes)).toContain(`Updated 3 tasks in repo "${REPO}`);

		const updatedTasks = db.tasks.getTasksByRepo("test", REPO);
		updatedTasks.forEach((t) => {
			expect(t.status).toBe("completed");
			expect(t.finished_at).toBeTruthy();
			expect(t.est_tokens).toBe(500);
		});

		// Verify task archive memory created
		const memories = db.memories.searchByRepo("test", REPO);
		const archMemories = memories.filter((m) => m.type === "task_archive");
		expect(archMemories.length).toBe(3);

		// Verify comments created
		const comments = db.taskComments.getTaskCommentsByTaskId(ids[0]);
		expect(comments.length).toBe(1);
		expect(comments[0].comment).toBe("Bulk completion test");
		expect(comments[0].next_status).toBe("completed");
	});

	it("should bulk update statuses and record in-progress timestamps", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [{ task_code: "IP-1", title: "Task 1", description: "D", phase: "p", status: "pending" }]
			}
		});

		const taskId = db.tasks.getTasksByRepo("test", REPO)[0].id;

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: [taskId],
				status: "in_progress",
				comment: "Moving to in progress"
			}
		});

		const task = db.tasks.getTaskById(taskId);
		expect(task?.status).toBe("in_progress");
		expect(task?.in_progress_at).toBeTruthy();
	});

	it("should soft-delete a single task via task-delete (by task_code)", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "SDEL-001",
				phase: "testing",
				title: "Soft Delete Single",
				description: "Testing single task soft delete by task_code",
				status: "pending",
				priority: 2,
				est_tokens: 30
			}
		});

		const beforeDelete = db.tasks.getTaskByCode("test", REPO, "SDEL-001");
		expect(beforeDelete).toBeDefined();
		expect(beforeDelete!.status).toBe("pending");

		const res = await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				task_code: "SDEL-001"
			}
		});

		expect(getTextContent(res)).toContain(`Deleted 1 task from "${REPO}"`);

		// Verify soft-delete: task still exists but is canceled
		const afterDelete = db.tasks.getTaskByCode("test", REPO, "SDEL-001");
		expect(afterDelete).toBeDefined();
		expect(afterDelete!.status).toBe("canceled");
		expect(afterDelete!.canceled_at).toBeTruthy();
	});

	// ─── Partial execution: skip failures, continue with remaining items ───

	it("task-write bulk handles partial failure — continues on individual item errors", async () => {
		const res: any = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: [
					{ phase: "dev", title: "Partial 1", description: "First partial task.", status: "pending", priority: 2 },
					{ phase: "dev", title: "Partial 2", description: "Second partial task.", status: "pending", priority: 2 },
					// Invalid item (missing required fields): should be skipped
					{ phase: "dev", status: "pending" }
				]
			}
		});
		// Partial failure returns isError with structuredContent containing results
		expect(res.isError).toBe(true);
		expect(res.structuredContent.createdCount).toBe(2);
		expect(res.structuredContent.total).toBe(3);
		expect(res.structuredContent.errors).toBeDefined();
		expect(res.structuredContent.errors.length).toBeGreaterThanOrEqual(1);
	});

	it("task-write bulk all succeed — no errors", async () => {
		const res: any = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				json: true,
				tasks: [
					{ phase: "dev", title: "Surviving Task", description: "Should be created.", status: "pending", priority: 2 },
					{
						phase: "dev",
						title: "Also Surviving",
						description: "Should also be created.",
						status: "pending",
						priority: 2
					}
				]
			}
		});
		// Content text confirms success
		expect(getTextContent(res)).toContain("Created 2 tasks");
		// Verify tasks exist in the database
		const allTasks = db.tasks.getTasksByRepo("test", REPO);
		expect(allTasks.length).toBe(2);
	});

	// ─────────────────────────────────────────────────────────────────────

	it("should soft-delete multiple tasks by task_codes array via task-delete", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{
						task_code: "BDEL-001",
						title: "Bulk Delete 1",
						description: "Desc",
						phase: "p",
						status: "pending",
						est_tokens: 10
					},
					{
						task_code: "BDEL-002",
						title: "Bulk Delete 2",
						description: "Desc",
						phase: "p",
						status: "pending",
						est_tokens: 10
					},
					{
						task_code: "BDEL-003",
						title: "Bulk Delete 3",
						description: "Desc",
						phase: "p",
						status: "pending",
						est_tokens: 10
					}
				]
			}
		});

		const res = await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				task_codes: ["BDEL-001", "BDEL-003"]
			}
		});

		expect(getTextContent(res)).toContain(`Deleted 2 tasks from "${REPO}"`);

		// Verify soft-delete: tasks exist but are canceled
		const task1 = db.tasks.getTaskByCode("test", REPO, "BDEL-001");
		expect(task1).toBeDefined();
		expect(task1!.status).toBe("canceled");

		const task2 = db.tasks.getTaskByCode("test", REPO, "BDEL-002");
		expect(task2).toBeDefined();
		expect(task2!.status).toBe("pending"); // not deleted

		const task3 = db.tasks.getTaskByCode("test", REPO, "BDEL-003");
		expect(task3).toBeDefined();
		expect(task3!.status).toBe("canceled");
	});

	// Unified not-found policy (OPT-CODE-04): single target → throw (fail
	// loud); bulk → skip + report partial execution.
	it("should fail loudly when deleting a non-existent single task (raw UUID)", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		// The bulk-test router converts a thrown handler error into an isError
		// result — the fail-loud contract surfaces as isError:true here.
		const res = (await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				id: fakeId
			}
		})) as McpResponse;

		expect(res.isError).toBe(true);
		expect(getTextContent(res)).toContain("Task not found");
	});

	it("should skip + report a missing task in a bulk delete (partial execution)", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "PARTIAL-DEL-001",
				phase: "p",
				title: "Partial Delete Surviving",
				description: "This task survives the partial bulk delete.",
				status: "pending",
				priority: 2,
				est_tokens: 10
			}
		});

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		const realId = tasks.find((t) => t.task_code === "PARTIAL-DEL-001")!.id;
		const fakeId = "00000000-0000-0000-0000-000000000000";

		const delRes = (await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: [realId, fakeId],
				json: true
			}
		})) as McpResponse;

		const data = delRes.structuredContent as any;
		expect(data.success).toBe(true);
		expect(data.canceledCount).toBe(1);
		expect(data.skippedCount).toBe(1);
		expect(data.totalAttempted).toBe(2);
		expect(data.errors[0].error).toContain("Task not found");

		// The real task was canceled; the phantom id changed nothing.
		const stored = db.tasks.getTaskById(realId);
		expect(stored!.status).toBe("canceled");
	});

	it("should report success:false when every target of a bulk delete is missing (all-negative)", async () => {
		// Seed a real task so a phantom "canceled" would be observable.
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "ALL-NEG-DEL-001",
				phase: "p",
				title: "All-Negative Guard",
				description: "This task must survive an all-phantom bulk delete.",
				status: "pending",
				priority: 2,
				est_tokens: 10
			}
		});

		const before = db.tasks.getTasksByRepo("test", REPO);
		expect(before.length).toBe(1);

		const fakeId1 = "00000000-0000-0000-0000-000000000001";
		const fakeId2 = "00000000-0000-0000-0000-000000000002";

		const delRes = (await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: [fakeId1, fakeId2],
				json: true
			}
		})) as McpResponse;

		// The shared success formula `deletedCount > 0 || skippedCount === 0`
		// flips to false here — nothing was deleted and everything was skipped.
		const data = delRes.structuredContent as any;
		expect(data.success).toBe(false);
		expect(data.canceledCount).toBe(0);
		expect(data.skippedCount).toBe(2);
		expect(data.totalAttempted).toBe(2);
		expect(data.errors.length).toBe(2);
		expect(data.errors[0].error).toContain("Task not found");
		expect(data.errors[1].error).toContain("Task not found");

		// Task count/status unchanged — no phantom cancellation.
		const after = db.tasks.getTasksByRepo("test", REPO);
		expect(after).toHaveLength(before.length);
		expect(after.every((task) => task.status !== "canceled")).toBe(true);
	});
});

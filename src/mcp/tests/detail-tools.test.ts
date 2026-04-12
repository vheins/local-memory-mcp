import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { StubVectorStore } from "../storage/vectors.stub.js";
import type { VectorStore } from "../types.js";

describe("MCP Local Memory - Detail Tools (memory-detail, task-detail)", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;
	let router: (method: string, params: any) => Promise<any>;

	const REPO = "detail-test-repo";

	beforeEach(() => {
		db = new SQLiteStore(":memory:");
		vectors = new StubVectorStore(db);
		router = createRouter(db, vectors);
	});

	it("should fetch memory details by ID via memory-detail", async () => {
		// 1. Create a memory
		const storeRes = await router("tools/call", {
			name: "memory-store",
			arguments: {
				type: "code_fact",
				title: "Test Memory",
				content: "This is a test memory content for detail check.",
				importance: 3,
				agent: "TestAgent",
				model: "test-model",
				scope: { repo: REPO }
			}
		});
		const memoryId = storeRes.structuredContent.id;

		// 2. Fetch it via memory-detail
		const detailRes = await router("tools/call", {
			name: "memory-detail",
			arguments: { id: memoryId }
		});

		expect(detailRes.structuredContent.id).toBe(memoryId);
		expect(detailRes.structuredContent.title).toBe("Test Memory");
		expect(detailRes.structuredContent.content).toBe("This is a test memory content for detail check.");

		// Verify hit count incremented
		const memory = db.memories.getById(memoryId);
		expect(memory?.hit_count).toBe(1);
	});

	it("should fetch task details by ID via task-detail", async () => {
		// 1. Create a task
		const createRes = await router("tools/call", {
			name: "task-create",
			arguments: {
				repo: REPO,
				task_code: "TASK-101",
				phase: "test",
				title: "Test Task",
				description: "Task description for detail check.",
				status: "pending",
				priority: 3
			}
		});
		const taskId = createRes.structuredContent.id;

		// 2. Fetch it via task-detail by ID
		const detailRes = await router("tools/call", {
			name: "task-detail",
			arguments: { repo: REPO, id: taskId }
		});

		expect(detailRes.structuredContent.id).toBe(taskId);
		expect(detailRes.structuredContent.task_code).toBe("TASK-101");
		expect(detailRes.structuredContent.title).toBe("Test Task");
	});

	it("should fetch task details by task_code via task-detail", async () => {
		// 1. Create a task
		const createRes = await router("tools/call", {
			name: "task-create",
			arguments: {
				repo: REPO,
				task_code: "TASK-102",
				phase: "test",
				title: "Test Task 102",
				description: "Task description for code check.",
				status: "pending",
				priority: 3
			}
		});
		const taskId = createRes.structuredContent.id;

		// 2. Fetch it via task-detail by task_code
		const detailRes = await router("tools/call", {
			name: "task-detail",
			arguments: { repo: REPO, task_code: "TASK-102" }
		});

		expect(detailRes.structuredContent.id).toBe(taskId);
		expect(detailRes.structuredContent.task_code).toBe("TASK-102");
		expect(detailRes.structuredContent.title).toBe("Test Task 102");
	});

	it("should throw error if memory not found", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		await expect(
			router("tools/call", {
				name: "memory-detail",
				arguments: { id: fakeId }
			})
		).rejects.toThrow(`Memory not found: ${fakeId}`);
	});

	it("should throw error if task not found", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		await expect(
			router("tools/call", {
				name: "task-detail",
				arguments: { repo: REPO, id: fakeId }
			})
		).rejects.toThrow(`Task not found: ${fakeId}`);

		await expect(
			router("tools/call", {
				name: "task-detail",
				arguments: { repo: REPO, task_code: "NON-EXISTENT" }
			})
		).rejects.toThrow(`Task not found: NON-EXISTENT in repo ${REPO}`);
	});
});

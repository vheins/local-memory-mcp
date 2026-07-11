import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";

describe("MCP Local Memory - Detail Tools (memory-detail, standard-detail, task-detail)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "detail-test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.structured = true;
			}
			return rawRouter(method, params);
		};
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
				scope: { owner: "test", repo: REPO }
			}
		});
		const memoryId = storeRes.structuredContent.id;

		// 2. Fetch it via memory-detail
		const detailRes = await router("tools/call", {
			name: "memory-detail",
			arguments: { id: memoryId, owner: "test", repo: REPO }
		});

		expect(detailRes.structuredContent.id).toBe(memoryId);
		expect(detailRes.structuredContent.title).toBe("Test Memory");
		expect(detailRes.structuredContent.content).toBe("This is a test memory content for detail check.");

		// Verify hit count incremented
		const memory = db.memories.getById(memoryId as string);
		expect(memory?.hit_count).toBe(1);
	});

	it("should fetch task details by ID via task-detail", async () => {
		// 1. Create a task
		const createRes = await router("tools/call", {
			name: "task-create",
			arguments: {
				repo: REPO,
				owner: "test",
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
			arguments: { repo: REPO, owner: "test", id: taskId }
		});

		expect(detailRes.structuredContent.id).toBe(taskId);
		expect(detailRes.structuredContent.task_code).toBe("TASK-101");
		expect(detailRes.structuredContent.title).toBe("Test Task");
	});

	it("should fetch coding standard details by ID via standard-detail", async () => {
		const storeRes = await router("tools/call", {
			name: "standard-store",
			arguments: {
				owner: "test",
				name: "TS Error Standard",
				content: "Use typed errors and structured logging for server boundaries.",
				language: "typescript",
				stack: ["node", "typescript"],
				tags: ["backend", "errors"],
				metadata: { source: "detail-test" },
				repo: REPO,
				is_global: false
			}
		});
		const standardId = storeRes.structuredContent.standard.id;

		const detailRes = await router("tools/call", {
			name: "standard-detail",
			arguments: { id: standardId, owner: "test", repo: REPO }
		});

		expect(detailRes.structuredContent.id).toBe(standardId);
		expect(detailRes.structuredContent.title).toBe("TS Error Standard");
		expect(detailRes.structuredContent.content).toContain("typed errors");

		const standard = db.standards.getById(standardId as string);
		expect(standard?.hit_count).toBe(1);
	});

	it("should fetch task details by task_code via task-detail", async () => {
		// 1. Create a task
		const createRes = await router("tools/call", {
			name: "task-create",
			arguments: {
				repo: REPO,
				owner: "test",
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
			arguments: { repo: REPO, owner: "test", task_code: "TASK-102" }
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
				arguments: { id: fakeId, owner: "test", repo: REPO }
			})
		).rejects.toThrow(`Memory not found: ${fakeId}`);
	});

	it("should throw error if task not found", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		await expect(
			router("tools/call", {
				name: "task-detail",
				arguments: { repo: REPO, owner: "test", id: fakeId }
			})
		).rejects.toThrow(`Task not found: ${fakeId}`);

		await expect(
			router("tools/call", {
				name: "task-detail",
				arguments: { repo: REPO, owner: "test", task_code: "NON-EXISTENT" }
			})
		).rejects.toThrow(`Task not found: NON-EXISTENT in repo ${REPO}`);
	});

	it("should throw error if coding standard not found", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		await expect(
			router("tools/call", {
				name: "standard-detail",
				arguments: { id: fakeId, owner: "test", repo: REPO }
			})
		).rejects.toThrow(`Coding standard not found: ${fakeId}`);
	});

	it("should fetch memory details by code passed as id", async () => {
		const storeRes = await router("tools/call", {
			name: "memory-store",
			arguments: {
				code: "MEM-601",
				type: "code_fact",
				title: "Test Memory By Code",
				content: "Memory accessible via code as id param.",
				importance: 3,
				agent: "TestAgent",
				model: "test-model",
				scope: { owner: "test", repo: REPO }
			}
		});
		const memoryId = storeRes.structuredContent.id;

		const detailRes = await router("tools/call", {
			name: "memory-detail",
			arguments: { id: "MEM-601", owner: "test", repo: REPO }
		});

		expect(detailRes.structuredContent.id).toBe(memoryId);
		expect(detailRes.structuredContent.code).toBe("MEM-601");
		expect(detailRes.structuredContent.title).toBe("Test Memory By Code");
	});

	it("should fetch standard details by code passed as id", async () => {
		const storeRes = await router("tools/call", {
			name: "standard-store",
			arguments: {
				owner: "test",
				name: "Code As Id Standard",
				content: "Standard accessible via code as id param.",
				language: "typescript",
				stack: ["node"],
				tags: ["test"],
				metadata: { source: "detail-test-code-as-id" },
				repo: REPO,
				is_global: false
			}
		});
		const standardCode = storeRes.structuredContent.standard.code;
		const standardId = storeRes.structuredContent.standard.id;

		const detailRes = await router("tools/call", {
			name: "standard-detail",
			arguments: { id: standardCode, owner: "test", repo: REPO }
		});

		expect(detailRes.structuredContent.id).toBe(standardId);
		expect(detailRes.structuredContent.code).toBe(standardCode);
		expect(detailRes.structuredContent.title).toBe("Code As Id Standard");
	});

	it("should fetch task details by task_code passed as id", async () => {
		const createRes = await router("tools/call", {
			name: "task-create",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-CODE-AS-ID",
				phase: "test",
				title: "Task By Code As Id",
				description: "Task accessible via task_code as id param.",
				status: "pending",
				priority: 3
			}
		});
		const taskId = createRes.structuredContent.id;

		const detailRes = await router("tools/call", {
			name: "task-detail",
			arguments: { repo: REPO, owner: "test", id: "TASK-CODE-AS-ID" }
		});

		expect(detailRes.structuredContent.id).toBe(taskId);
		expect(detailRes.structuredContent.task_code).toBe("TASK-CODE-AS-ID");
		expect(detailRes.structuredContent.title).toBe("Task By Code As Id");
	});
});

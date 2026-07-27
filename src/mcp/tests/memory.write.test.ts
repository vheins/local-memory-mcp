import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Local Memory - memory-write (Create, Update, Acknowledge, Bulk)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-write-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params);
		};
	});

	// ─── CREATE single ───────────────────────────────────────────────────

	it("should CREATE a single memory via memory-write with type/title/content/importance", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Create Test",
				content: "This memory was created via memory-write CREATE mode.",
				importance: 4,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		expect(res.structuredContent.success).toBe(true);
		expect(res.structuredContent.id).toBeTruthy();
		expect(res.structuredContent.code).toBeTruthy();
		expect(res.structuredContent.type).toBe("code_fact");
		expect(res.structuredContent.title).toBe("Create Test");
		expect(getPrimaryTextContent(res)).toContain("Stored");

		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored).not.toBeNull();
		expect(stored!.title).toBe("Create Test");
		expect(stored!.content).toBe("This memory was created via memory-write CREATE mode.");
	});

	it("should CREATE a memory with explicit scope", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "decision",
				title: "Scoped Memory",
				content: "This memory has an explicit folder and language scope.",
				importance: 3,
				scope: { owner: "test", repo: REPO, folder: "src/auth", language: "typescript" },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored!.scope.folder).toBe("src/auth");
		expect(stored!.scope.language).toBe("typescript");
	});

	// ─── UPDATE single ───────────────────────────────────────────────────

	it("should UPDATE a single memory via memory-write with id + fields", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Original Title",
				content: "Original content that will be updated.",
				importance: 2,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const updateRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryId,
				title: "Updated Title",
				content: "Updated content after modification.",
				importance: 5,
				owner: "test",
				repo: REPO
			}
		});

		expect(updateRes.structuredContent.success).toBe(true);
		expect(updateRes.structuredContent.updatedFields).toContain("title");
		expect(updateRes.structuredContent.updatedFields).toContain("content");
		expect(updateRes.structuredContent.updatedFields).toContain("importance");
		expect(getPrimaryTextContent(updateRes)).toContain("Updated");

		const stored = db.memories.getById(memoryId);
		expect(stored!.title).toBe("Updated Title");
		expect(stored!.content).toBe("Updated content after modification.");
		expect(stored!.importance).toBe(5);
	});

	it("should UPDATE a memory by code (non-UUID passed as id)", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "pattern",
				title: "Code Update Target",
				content: "Memory to be updated by its code.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryCode = createRes.structuredContent.code;

		const updateRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryCode,
				title: "Updated By Code",
				owner: "test",
				repo: REPO
			}
		});

		expect(updateRes.structuredContent.success).toBe(true);

		const stored = db.memories.getById(createRes.structuredContent.id);
		expect(stored!.title).toBe("Updated By Code");
	});

	// ─── ACKNOWLEDGE ─────────────────────────────────────────────────────

	it("should ACKNOWLEDGE a memory as 'used' and increment recall_count", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Ack Used Test",
				content: "Memory that will be acknowledged as used.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const ackRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryId,
				acknowledge: "used",
				owner: "test",
				repo: REPO
			}
		});

		expect(ackRes.structuredContent.success).toBe(true);
		expect(ackRes.structuredContent.status).toBe("used");
		expect(getPrimaryTextContent(ackRes)).toContain("Acknowledged");

		const stored = db.memories.getById(memoryId);
		expect(stored!.recall_count).toBe(1);
	});

	it("should ACKNOWLEDGE a memory as 'irrelevant' without incrementing recall_count", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "decision",
				title: "Ack Irrelevant Test",
				content: "Memory acknowledged as irrelevant.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const ackRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryId,
				acknowledge: "irrelevant",
				owner: "test",
				repo: REPO
			}
		});

		expect(ackRes.structuredContent.status).toBe("irrelevant");

		const stored = db.memories.getById(memoryId);
		expect(stored!.recall_count).toBe(0);
	});

	it("should ACKNOWLEDGE a memory as 'contradictory'", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "mistake",
				title: "Ack Contradictory Test",
				content: "Memory acknowledged as contradictory.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const ackRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryId,
				acknowledge: "contradictory",
				owner: "test",
				repo: REPO
			}
		});

		expect(ackRes.structuredContent.status).toBe("contradictory");
	});

	it("should reject ACKNOWLEDGE with invalid status value", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Invalid Ack",
				content: "Testing invalid acknowledge value.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		await expect(
			router("tools/call", {
				name: "memory-write",
				arguments: {
					id: memoryId,
					acknowledge: "invalid_status",
					owner: "test",
					repo: REPO
				}
			})
		).rejects.toThrow();
	});

	// ─── BULK mixed operations ───────────────────────────────────────────

	it("should BULK create multiple memories via memories[]", async () => {
		const bulkRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [
					{
						type: "code_fact",
						title: "Bulk Memory A",
						content: "First memory in a bulk create operation.",
						importance: 3,
						agent: "test-agent",
						model: "test-model"
					},
					{
						type: "decision",
						title: "Bulk Memory B",
						content: "Second memory in a bulk create operation.",
						importance: 4,
						agent: "test-agent",
						model: "test-model"
					}
				]
			}
		});

		expect(bulkRes.structuredContent.success).toBe(true);
		expect(bulkRes.structuredContent.total).toBe(2);
		expect(bulkRes.structuredContent.processed).toBe(2);
		expect(getPrimaryTextContent(bulkRes)).toContain("Processed 2/2");

		const all = db.memories.getRecentMemories("test", REPO, 10);
		expect(all.length).toBe(2);
	});

	it("should BULK handle mixed create, update, and acknowledge operations", async () => {
		// First, create a memory to update and acknowledge
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Target",
				content: "Target memory for bulk update and acknowledge.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const targetId = createRes.structuredContent.id;

		const bulkRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [
					// CREATE
					{
						type: "code_fact",
						title: "New Bulk Item C",
						content: "A fresh memory created in the bulk operation.",
						importance: 2,
						agent: "test-agent",
						model: "test-model"
					},
					// UPDATE
					{
						id: targetId,
						title: "Updated By Bulk",
						importance: 5
					},
					// ACKNOWLEDGE
					{
						id: targetId,
						acknowledge: "used"
					}
				]
			}
		});

		expect(bulkRes.structuredContent.success).toBe(true);
		expect(bulkRes.structuredContent.total).toBe(3);
		expect(bulkRes.structuredContent.processed).toBe(3);

		const updated = db.memories.getById(targetId);
		expect(updated!.title).toBe("Updated By Bulk");
		expect(updated!.importance).toBe(5);
		expect(updated!.recall_count).toBe(1);
	});

	it("should BULK handle partial failure — continue on individual item errors", async () => {
		const bulkRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [
					// Valid create
					{
						type: "code_fact",
						title: "Valid Memory",
						content: "This memory should be created successfully.",
						importance: 3,
						agent: "test-agent",
						model: "test-model"
					},
					// Invalid — missing required fields
					{
						type: "code_fact"
					}
				]
			}
		});

		expect(bulkRes.structuredContent.success).toBe(false);
		expect(bulkRes.structuredContent.total).toBe(2);
		expect(bulkRes.structuredContent.processed).toBe(1);
		expect(bulkRes.structuredContent.errors).toHaveLength(1);
		expect(bulkRes.structuredContent.errors[0].index).toBe(1);
		expect(getPrimaryTextContent(bulkRes)).toContain("1/2");
	});

	// ─── Error cases ─────────────────────────────────────────────────────

	it("should reject CREATE with metadata-like title", async () => {
		await expect(
			router("tools/call", {
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: "[agent: test | 2026-01-01] Metadata in Title",
					content: "Title contains metadata patterns which should be rejected.",
					importance: 3,
					scope: { owner: "test", repo: REPO },
					agent: "test-agent",
					model: "test-model"
				}
			})
		).rejects.toThrow("Title appears to contain metadata");
	});

	it("should reject UPDATE for non-existent memory", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		await expect(
			router("tools/call", {
				name: "memory-write",
				arguments: {
					id: fakeId,
					title: "No Op",
					owner: "test",
					repo: REPO
				}
			})
		).rejects.toThrow("Memory not found");
	});

	it("should infer operation correctly: content→CREATE, id+fields→UPDATE, id+acknowledge→ACKNOWLEDGE", async () => {
		// CREATE (content present, no id)
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Inference Test",
				content: "Testing auto-inference for CREATE operation.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		expect(createRes.structuredContent.success).toBe(true);
		const memId = createRes.structuredContent.id;

		// UPDATE (id present without acknowledge)
		const updateRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memId,
				title: "Inference Updated",
				owner: "test",
				repo: REPO
			}
		});
		expect(updateRes.structuredContent.updatedFields).toContain("title");

		// ACKNOWLEDGE (id + acknowledge)
		const ackRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memId,
				acknowledge: "used",
				owner: "test",
				repo: REPO
			}
		});
		expect(ackRes.structuredContent.status).toBe("used");
	});
});

// ─── Decision fields (context/rationale/alternatives) — flat, replaces old decision_log ──

describe("decision flat fields in memory-write", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-write-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params);
		};
	});

	it("should auto-format content and set importance=4 when context/rationale provided with type=decision", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "decision",
				title: "Choose Database",
				context: "We needed to pick a primary database for the new service.",
				rationale: "Postgres offers better JSON support and is more battle-tested for this workload.",
				tags: ["backend"],
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		expect(res.structuredContent.success).toBe(true);
		expect(res.structuredContent.type).toBe("decision");
		expect(res.structuredContent.importance).toBe(4);
		expect(res.structuredContent.title).toBe("Choose Database");

		// Content should have been auto-generated from context/rationale fields
		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored?.content).toContain("## Context");
		expect(stored?.content).toContain("We needed to pick");
		expect(stored?.content).toContain("## Rationale");
		expect(stored?.content).toContain("Postgres offers better");
		expect(stored?.tags).toContain("decision");
	});

	it("should throw error if context/rationale provided without type=decision", async () => {
		await expect(
			router("tools/call", {
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: "Wrong Type",
					context: "This should not work.",
					rationale: "Because type is code_fact, not decision.",
					scope: { owner: "test", repo: REPO }
				}
			})
		).rejects.toThrow(/type.*decision/i);
	});

	it("should include alternatives in auto-generated content", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "decision",
				title: "Framework Choice",
				context: "Evaluating frontend frameworks for the dashboard.",
				rationale: "React has the largest ecosystem and best tooling.",
				alternatives: ["Vue", "Svelte", "Solid"],
				tags: ["frontend", "architecture"],
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		expect(res.structuredContent.success).toBe(true);
		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored?.content).toContain("## Alternatives");
		expect(stored?.content).toContain("- Vue");
		expect(stored?.content).toContain("- Svelte");
		expect(stored?.content).toContain("- Solid");
		expect(stored?.tags).toEqual(expect.arrayContaining(["decision", "frontend", "architecture"]));
	});
});

// ─── Session fields (key_decisions/next_steps) — flat, replaces old session_summary ──

describe("session flat fields in memory-write", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-write-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params);
		};
	});

	it("should auto-format content when key_decisions/next_steps provided with type=task_archive", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "task_archive",
				title: "Auth Refactor Session",
				key_decisions: ["Use JWT for tokens", "Extract auth to a service class"],
				next_steps: ["Add refresh token rotation", "Write integration tests"],
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		expect(res.structuredContent.success).toBe(true);
		expect(res.structuredContent.type).toBe("task_archive");

		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored?.content).toContain("## Key Decisions");
		expect(stored?.content).toContain("Use JWT for tokens");
		expect(stored?.content).toContain("## Next Steps");
		expect(stored?.content).toContain("Add refresh token rotation");
		expect(stored?.tags).toContain("session-summary");
	});

	it("should throw error if key_decisions/next_steps provided without type=task_archive", async () => {
		await expect(
			router("tools/call", {
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: "Wrong Type",
					key_decisions: ["This should not work."],
					scope: { owner: "test", repo: REPO }
				}
			})
		).rejects.toThrow(/type.*task_archive/i);
	});
});

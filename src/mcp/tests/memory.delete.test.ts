import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Local Memory - memory-delete (Single & Bulk)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-delete-test";

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

	// ─── Single delete by id ─────────────────────────────────────────────

	it("should soft-delete a single memory by id via memory-delete", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Delete By Id",
				content: "This memory will be deleted by its ID.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				id: memoryId,
				owner: "test",
				repo: REPO
			}
		});

		expect(delRes.structuredContent.success).toBe(true);
		expect(delRes.structuredContent.deletedCount).toBe(1);
		expect(getPrimaryTextContent(delRes)).toContain("Deleted 1 memory");

		// Should be soft-deleted (archived)
		const stored = db.memories.getById(memoryId);
		expect(stored!.status).toBe("archived");
	});

	// ─── Single delete by code ───────────────────────────────────────────

	it("should soft-delete a single memory by code via memory-delete", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Delete By Code",
				content: "This memory will be deleted by its code.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryCode = createRes.structuredContent.code;

		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				code: memoryCode,
				owner: "test",
				repo: REPO
			}
		});

		expect(delRes.structuredContent.deletedCount).toBe(1);

		const stored = db.memories.getByCode(memoryCode, "test", REPO);
		expect(stored!.status).toBe("archived");
	});

	// ─── Bulk delete by ids[] ────────────────────────────────────────────

	it("should soft-delete multiple memories by ids[] via memory-delete", async () => {
		const m1 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Delete A",
				content: "First memory to be bulk deleted.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const m2 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Delete B",
				content: "Second memory to be bulk deleted.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const ids = [m1.structuredContent.id, m2.structuredContent.id];
		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				ids,
				owner: "test",
				repo: REPO
			}
		});

		expect(delRes.structuredContent.success).toBe(true);
		expect(delRes.structuredContent.deletedCount).toBe(2);
		expect(getPrimaryTextContent(delRes)).toContain("Deleted 2 memories");

		const m1Stored = db.memories.getById(m1.structuredContent.id);
		const m2Stored = db.memories.getById(m2.structuredContent.id);
		expect(m1Stored!.status).toBe("archived");
		expect(m2Stored!.status).toBe("archived");
	});

	// ─── Bulk delete by codes[] ──────────────────────────────────────────

	it("should soft-delete multiple memories by codes[] via memory-delete", async () => {
		const m1 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Code Delete A",
				content: "First memory to be deleted by code.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const m2 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Code Delete B",
				content: "Second memory to be deleted by code.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				codes: [m1.structuredContent.code, m2.structuredContent.code],
				owner: "test",
				repo: REPO
			}
		});

		expect(delRes.structuredContent.deletedCount).toBe(2);
	});

	// ─── Error cases ─────────────────────────────────────────────────────

	it("should throw error when deleting non-existent memory", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		await expect(
			router("tools/call", {
				name: "memory-delete",
				arguments: {
					id: fakeId,
					owner: "test",
					repo: REPO
				}
			})
		).rejects.toThrow("Memory not found");
	});

	it("should throw error when no identifier provided", async () => {
		await expect(
			router("tools/call", {
				name: "memory-delete",
				arguments: {
					owner: "test",
					repo: REPO
				}
			})
		).rejects.toThrow();
	});
});

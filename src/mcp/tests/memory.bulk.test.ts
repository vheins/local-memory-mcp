import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Local Memory - Bulk Memory Management", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "bulk-mem-repo";

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

	it("should bulk create memories via memory-write", async () => {
		const m1 = {
			type: "code_fact",
			title: "Memory 1 Title",
			content: "Alpha: This is a unique fact about the first component of the system.",
			importance: 3,
			agent: "Agent-A",
			model: "Model-X"
		};
		const m2 = {
			type: "code_fact",
			title: "Memory 2 Title",
			content: "Beta: Completely different technical detail regarding the secondary subsystem architecture.",
			importance: 3,
			agent: "Agent-A",
			model: "Model-X"
		};

		const bulkRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [m1, m2]
			}
		});

		expect(bulkRes.structuredContent.success).toBe(true);
		expect(bulkRes.structuredContent.processed).toBe(2);
		expect(getPrimaryTextContent(bulkRes)).toContain("Processed 2/2");

		const memories = db.memories.getRecentMemories("test", REPO, 10);
		expect(memories.length).toBe(2);
	});

	it("should bulk delete memories via memory-delete", async () => {
		const bulkCreate = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [
					{
						type: "code_fact",
						title: "Memory 1 Title",
						content: "Alpha: This is a unique fact about the first component of the system.",
						importance: 3,
						agent: "Agent-A",
						model: "Model-X"
					},
					{
						type: "code_fact",
						title: "Memory 2 Title",
						content: "Beta: Completely different technical detail regarding the secondary subsystem architecture.",
						importance: 3,
						agent: "Agent-A",
						model: "Model-X"
					}
				]
			}
		});

		// Extract IDs from bulk results
		const ids = bulkCreate.structuredContent.results.map((r: { id: string }) => r.id);

		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				ids
			}
		});

		expect(getPrimaryTextContent(delRes)).toContain("Deleted 2 memories from");
		const remaining = db.memories.getRecentMemories("test", REPO, 10);
		expect(remaining.length).toBe(0);
	});
});

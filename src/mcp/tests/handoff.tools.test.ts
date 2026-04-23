import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";

describe("MCP handoff and claim tools", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "handoff-tools-repo";

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

	it("creates and lists handoffs via MCP tools", async () => {
		const task = await router("tools/call", {
			name: "task-create",
			arguments: {
				repo: REPO,
				task_code: "HANDOFF-101",
				phase: "implementation",
				title: "Handoff target task",
				description: "Task used to validate handoff-create.",
				status: "pending",
				priority: 3
			}
		});

		const createRes = await router("tools/call", {
			name: "handoff-create",
			arguments: {
				repo: REPO,
				from_agent: "agent-a",
				to_agent: "agent-b",
				task_code: "HANDOFF-101",
				summary: "Continue implementing the MCP surface",
				context: { file: "src/mcp/router.ts" }
			}
		});

		expect(createRes.structuredContent.from_agent).toBe("agent-a");
		expect(createRes.structuredContent.to_agent).toBe("agent-b");
		expect(createRes.structuredContent.task_id).toBe(task.structuredContent.id);

		const listRes = await router("tools/call", {
			name: "handoff-list",
			arguments: {
				repo: REPO,
				to_agent: "agent-b"
			}
		});

		expect(listRes.structuredContent.schema).toBe("handoff-list");
		expect(listRes.structuredContent.count).toBe(1);
		expect(listRes.structuredContent.handoffs.rows[0][1]).toBe("agent-a");
	});

	it("claims a task by task_code via MCP tool", async () => {
		await router("tools/call", {
			name: "task-create",
			arguments: {
				repo: REPO,
				task_code: "CLAIM-101",
				phase: "implementation",
				title: "Claimable task",
				description: "Task used to validate task-claim.",
				status: "pending",
				priority: 3
			}
		});

		const claimRes = await router("tools/call", {
			name: "task-claim",
			arguments: {
				repo: REPO,
				task_code: "CLAIM-101",
				agent: "agent-claim",
				role: "worker",
				metadata: { lane: "handoff" }
			}
		});

		expect(claimRes.structuredContent.task_code).toBe("CLAIM-101");
		expect(claimRes.structuredContent.agent).toBe("agent-claim");
		expect(claimRes.structuredContent.role).toBe("worker");
		expect(claimRes.structuredContent.metadata).toEqual({ lane: "handoff" });
	});
});

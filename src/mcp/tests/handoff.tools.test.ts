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

	it("rejects completion-summary handoffs without transfer context", async () => {
		await expect(
			router("tools/call", {
				name: "handoff-create",
				arguments: {
					repo: REPO,
					from_agent: "agent-a",
					summary: "Completed implementation and tests"
				}
			})
		).rejects.toThrow(/completed-work summaries/);
	});

	it("updates handoff status so stale queue items can be closed", async () => {
		const createRes = await router("tools/call", {
			name: "handoff-create",
			arguments: {
				repo: REPO,
				from_agent: "agent-a",
				summary: "Blocked waiting for API contract",
				context: { blockers: ["API contract missing"] }
			}
		});

		const updateRes = await router("tools/call", {
			name: "handoff-update",
			arguments: {
				id: createRes.structuredContent.id,
				status: "expired"
			}
		});

		expect(updateRes.structuredContent.success).toBe(true);
		expect(updateRes.structuredContent.status).toBe("expired");
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

	it("auto-releases active claims and expires linked pending handoffs when a task completes", async () => {
		await router("tools/call", {
			name: "task-create",
			arguments: {
				repo: REPO,
				task_code: "CLEANUP-101",
				phase: "implementation",
				title: "Cleanup coordination task",
				description: "Task used to validate automatic coordination cleanup.",
				status: "pending",
				priority: 3
			}
		});

		await router("tools/call", {
			name: "task-update",
			arguments: {
				repo: REPO,
				task_code: "CLEANUP-101",
				status: "in_progress",
				comment: "Starting cleanup validation.",
				agent: "agent-claim"
			}
		});

		const claimRes = await router("tools/call", {
			name: "task-claim",
			arguments: {
				repo: REPO,
				task_code: "CLEANUP-101",
				agent: "agent-claim",
				role: "worker"
			}
		});

		const handoffRes = await router("tools/call", {
			name: "handoff-create",
			arguments: {
				repo: REPO,
				from_agent: "agent-claim",
				task_code: "CLEANUP-101",
				summary: "Continue cleanup validation if blocked",
				context: { remaining_work: "Validate automatic cleanup behavior" }
			}
		});

		const completeRes = await router("tools/call", {
			name: "task-update",
			arguments: {
				repo: REPO,
				task_code: "CLEANUP-101",
				status: "completed",
				comment: "Validated cleanup behavior.",
				agent: "agent-claim",
				est_tokens: 25
			}
		});

		expect(completeRes.structuredContent.coordinationCleanup).toEqual({
			releasedClaims: 1,
			expiredHandoffs: 1
		});
		expect(db.handoffs.getClaim(claimRes.structuredContent.task_id)).toBeNull();
		expect(db.handoffs.getHandoffById(handoffRes.structuredContent.id)?.status).toBe("expired");
	});
});

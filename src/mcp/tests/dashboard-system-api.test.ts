import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { randomUUID } from "crypto";
import type { AddressInfo } from "node:net";

vi.mock("../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../mcp/storage/sqlite");
	const { StubVectorStore } = await import("../../mcp/storage/vectors.stub");
	const db = new SQLiteStore(":memory:");
	const vectors = new StubVectorStore(db);

	return {
		db,
		vectors,
		mcpClient: { start: vi.fn(), stop: vi.fn(), isConnected: vi.fn(() => false), getPendingCount: vi.fn(() => 0) },
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		},
		startTime: Date.now()
	};
});

describe("Dashboard System API", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const systemRoutes = (await import("../../dashboard/routes/system.routes")).default;
		const taskRoutes = (await import("../../dashboard/routes/task.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api", systemRoutes);
		app.use("/api/tasks", taskRoutes);
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	it("returns global orchestration stats and aggregate throughput without repo filter", async () => {
		const { db } = await import("../../dashboard/lib/context");
		const now = new Date().toISOString();

		const activeTaskId = randomUUID();
		db.tasks.insertTask({
			id: activeTaskId,
			repo: "orchestrator-a",
			task_code: "ORCH-A-1",
			phase: "implementation",
			title: "Repo A active task",
			description: "active",
			status: "in_progress",
			priority: 4,
			agent: "agent-a",
			role: "worker",
			doc_path: null,
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: null,
			canceled_at: null,
			est_tokens: 50,
			tags: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});

		const completedTaskId = randomUUID();
		db.tasks.insertTask({
			id: completedTaskId,
			repo: "orchestrator-b",
			task_code: "ORCH-B-1",
			phase: "testing",
			title: "Repo B completed task",
			description: "done",
			status: "completed",
			priority: 3,
			agent: "agent-b",
			role: "worker",
			doc_path: null,
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: now,
			canceled_at: null,
			est_tokens: 120,
			tags: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});

		db.handoffs.claimTask({
			repo: "orchestrator-a",
			task_id: activeTaskId,
			agent: "agent-orchestrator",
			role: "worker"
		});

		db.handoffs.createHandoff({
			repo: "orchestrator-a",
			from_agent: "agent-a",
			summary: "Need follow-up on review findings",
			context: { next_steps: ["continue"] }
		});

		const statsRes = await fetch(`${baseUrl}/api/stats`);
		expect(statsRes.ok).toBe(true);
		const statsBody = (await statsRes.json()) as any;
		expect(statsBody.data.attributes.scope).toBe("global");
		expect(statsBody.data.attributes.repoCount).toBeGreaterThanOrEqual(2);
		expect(statsBody.data.attributes.coordination.activeClaims).toBeGreaterThanOrEqual(1);
		expect(statsBody.data.attributes.coordination.pendingHandoffs).toBeGreaterThanOrEqual(1);
		expect(statsBody.data.attributes.repos.length).toBeGreaterThanOrEqual(2);

		const timeRes = await fetch(`${baseUrl}/api/tasks/stats/time`);
		expect(timeRes.ok).toBe(true);
		const timeBody = (await timeRes.json()) as any;
		expect(timeBody.data.attributes.daily.added).toBeGreaterThanOrEqual(2);
		expect(timeBody.data.attributes.overall.completed).toBeGreaterThanOrEqual(1);
		expect(timeBody.data.attributes.overall.tokens).toBeGreaterThanOrEqual(120);
	});
});

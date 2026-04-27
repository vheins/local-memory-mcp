import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore, createTestStore } from "../storage/sqlite";
import { HandoffEntity } from "../entities/handoff";

describe("Handoff and Claim Storage", () => {
	let store: SQLiteStore;
	let handoffs: HandoffEntity;

	beforeEach(async () => {
		store = await createTestStore();
		handoffs = store.handoffs;
	});

	describe("Handoffs", () => {
		it("should create and retrieve a handoff", () => {
			const handoff = handoffs.createHandoff({
				repo: "test-repo",
				from_agent: "agent-a",
				to_agent: "agent-b",
				summary: "Need help with X",
				context: { key: "value" }
			});

			expect(handoff.id).toBeDefined();
			expect(handoff.repo).toBe("test-repo");
			expect(handoff.from_agent).toBe("agent-a");
			expect(handoff.to_agent).toBe("agent-b");
			expect(handoff.status).toBe("pending");
			expect(handoff.context).toEqual({ key: "value" });

			const retrieved = handoffs.getHandoffById(handoff.id);
			expect(retrieved).toBeDefined();
			expect(retrieved?.id).toBe(handoff.id);
		});

		it("should list handoffs with filters", () => {
			handoffs.createHandoff({ repo: "repo-1", from_agent: "a", summary: "1" });
			handoffs.createHandoff({ repo: "repo-1", from_agent: "a", to_agent: "b", summary: "2" });
			handoffs.createHandoff({ repo: "repo-2", from_agent: "a", summary: "3" });

			const allRepo1 = handoffs.listHandoffs({ repo: "repo-1" });
			expect(allRepo1.length).toBe(2);

			const toB = handoffs.listHandoffs({ repo: "repo-1", to_agent: "b" });
			expect(toB.length).toBe(1);
			expect(toB[0].summary).toBe("2");
		});

		it("should update handoff status", () => {
			const handoff = handoffs.createHandoff({ repo: "test-repo", from_agent: "a", summary: "1" });
			expect(handoff.status).toBe("pending");

			const success = handoffs.updateHandoffStatus(handoff.id, "accepted");
			expect(success).toBe(true);

			const updated = handoffs.getHandoffById(handoff.id);
			expect(updated?.status).toBe("accepted");
		});
	});

	describe("Claims", () => {
		it("should create and retrieve a claim", () => {
			// First, ensure the task exists since there's a foreign key constraint
			store.db.exec(`INSERT INTO tasks (id, repo, task_code, title, status, created_at, updated_at) 
                VALUES ('task-1', 'test-repo', 'T-1', 'Test', 'pending', '2023-01-01', '2023-01-01')`);

			const claim = handoffs.claimTask({
				repo: "test-repo",
				task_id: "task-1",
				agent: "agent-a",
				role: "developer"
			});

			expect(claim.id).toBeDefined();
			expect(claim.task_id).toBe("task-1");
			expect(claim.agent).toBe("agent-a");
			expect(claim.role).toBe("developer");
			expect(claim.released_at).toBeNull();

			const retrieved = handoffs.getClaim("task-1");
			expect(retrieved).toBeDefined();
			expect(retrieved?.agent).toBe("agent-a");
		});

		it("should release a claim", () => {
			store.db.exec(`INSERT INTO tasks (id, repo, task_code, title, status, created_at, updated_at) 
                VALUES ('task-2', 'test-repo', 'T-2', 'Test', 'pending', '2023-01-01', '2023-01-01')`);

			handoffs.claimTask({ repo: "test-repo", task_id: "task-2", agent: "agent-a" });

			let activeClaim = handoffs.getClaim("task-2");
			expect(activeClaim).not.toBeNull();

			const success = handoffs.releaseClaim("task-2", "agent-a");
			expect(success).toBe(true);

			activeClaim = handoffs.getClaim("task-2");
			expect(activeClaim).toBeNull();
		});

		it("should auto-release previous claim when new one is made", () => {
			store.db.exec(`INSERT INTO tasks (id, repo, task_code, title, status, created_at, updated_at) 
                VALUES ('task-3', 'test-repo', 'T-3', 'Test', 'pending', '2023-01-01', '2023-01-01')`);

			const claim1 = handoffs.claimTask({ repo: "test-repo", task_id: "task-3", agent: "agent-a" });
			const claim2 = handoffs.claimTask({ repo: "test-repo", task_id: "task-3", agent: "agent-b" });

			const activeClaim = handoffs.getClaim("task-3");
			expect(activeClaim?.id).toBe(claim2.id);
			expect(activeClaim?.agent).toBe("agent-b");

			const allClaims = handoffs.listClaims({ repo: "test-repo" });
			expect(allClaims.length).toBe(2);

			const c1 = allClaims.find((c) => c.id === claim1.id);
			expect(c1?.released_at).not.toBeNull();
		});
	});
});

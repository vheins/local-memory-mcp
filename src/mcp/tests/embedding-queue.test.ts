import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { Outbox, enqueueTask } from "../embedding-queue/outbox";
import { EmbeddingWorker } from "../embedding-queue/worker";
import { RealVectorStore } from "../storage/vectors";
import { observationText, saveExtractions } from "../tools/kg-archivist";
import { handleTaskDelete } from "../tools/task.delete";
import { handleMemoryDelete } from "../tools/memory.delete";
import type { Task } from "../types";

// ---------------------------------------------------------------------------
// Embedding-queue lifecycle regression tests (TASK-042/043/044/045, MEM-427):
//   - canceled tasks are excluded from backfill + treated as non-existent by
//     the worker (no vector re-embed, no KG extraction)
//   - delete tools purge queue_jobs rows inside their DB transaction
//   - Outbox complete/fail are bound to the claim batch token (locked_by)
//   - delete-triggered orphan sweep is repo-scoped (no cross-repo deletion)
//   - observation text is generated + deleted from one shared contract
// ---------------------------------------------------------------------------

const REPO = "embedding-queue-test";

function makeTask(overrides: Partial<Task> = {}): Task {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		owner: "test",
		repo: REPO,
		task_code: `TQ-${randomUUID().slice(0, 6)}`,
		phase: "testing",
		title: "Embedding queue test task",
		description: "Alice worked on the deployment for Acme Corp",
		status: "backlog",
		priority: 3,
		agent: "test",
		role: "tester",
		doc_path: null,
		created_at: now,
		updated_at: now,
		in_progress_at: null,
		finished_at: null,
		canceled_at: null,
		est_tokens: 0,
		commit_id: null,
		changed_files: [],
		tags: [],
		suggested_skills: [],
		metadata: {},
		parent_id: null,
		depends_on: null,
		...overrides
	};
}

/** Minimal vectors stand-in: runOnce() only needs `embed`. */
function makeStubVectors(): RealVectorStore {
	return { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) } as unknown as RealVectorStore;
}

function makeWorker(db: SQLiteStore): EmbeddingWorker {
	return new EmbeddingWorker(db, makeStubVectors(), {
		batchSize: 32,
		leaseMs: 60_000,
		poisonThreshold: 3,
		backoffBaseMs: 1_000,
		backoffMaxMs: 60_000,
		pollIntervalMs: 3_600_000, // never fires in tests
		purgeIntervalMs: 3_600_000,
		backfillCap: 0
	});
}

function getJob(db: SQLiteStore, kind: string, entityId: string): Record<string, unknown> | undefined {
	return db.db.prepare("SELECT * FROM queue_jobs WHERE entity_kind = ? AND entity_id = ?").get(kind, entityId) as
		Record<string, unknown> | undefined;
}

function countRows(db: SQLiteStore, sql: string, params: unknown[] = []): number {
	return (db.db.prepare(sql).get(...params) as { cnt: number }).cnt;
}

describe("Outbox — claim/complete/fail bound to the claim batch token (TASK-044)", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("complete with a stale (expired-lease) token cannot finish a job re-claimed by another worker", () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		const [claimA] = outbox.claim(10, 60_000);
		expect(claimA).toBeDefined();
		const tokenA = claimA!.locked_by as string;

		// Simulate lease expiry + re-claim by worker B (new batch token).
		const tokenB = "worker-B-token";
		db.db
			.prepare("UPDATE queue_jobs SET status = 'claimed', locked_by = ?, lease_until = ? WHERE id = ?")
			.run(tokenB, new Date(Date.now() + 60_000).toISOString(), claimA!.id);

		// Worker A's stale complete must no-op...
		expect(outbox.complete(claimA!.id, tokenA)).toBe(false);
		const row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("claimed");
		expect(row.locked_by).toBe(tokenB);

		// ...while worker B's complete (owning token) succeeds.
		expect(outbox.complete(claimA!.id, tokenB)).toBe(true);
		expect(getJob(db, "task", task.id)!.status).toBe("done");
	});

	it("fail with a stale token is a no-op — attempts never double-increment across workers", () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		const [claimA] = outbox.claim(10, 60_000);
		const tokenA = claimA!.locked_by as string;
		const tokenB = "worker-B-token";
		db.db
			.prepare("UPDATE queue_jobs SET status = 'claimed', locked_by = ?, lease_until = ? WHERE id = ?")
			.run(tokenB, new Date(Date.now() + 60_000).toISOString(), claimA!.id);

		// Worker A fails with its expired token → no-op (no attempt increment).
		outbox.fail(claimA!.id, tokenA, "boom", 3, 1_000, 60_000);
		let row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("claimed");
		expect(row.attempts).toBe(0);
		expect(row.locked_by).toBe(tokenB);

		// Worker B (owner) fails → single atomic increment to 1 + backoff.
		outbox.fail(claimA!.id, tokenB, "boom", 3, 1_000, 60_000);
		row = getJob(db, "task", task.id)!;
		expect(row.attempts).toBe(1);
		expect(row.status).toBe("pending");
		expect(row.locked_by).toBeNull();
		expect(row.backoff_until).not.toBeNull();
	});

	it("fail poisons at the threshold via atomic increments, clearing backoff", () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		// Attempt 1 → backoff.
		const [claim1] = outbox.claim(10, 60_000);
		outbox.fail(claim1!.id, claim1!.locked_by as string, "e1", 2, 1_000, 60_000);
		let row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("pending");
		expect(row.attempts).toBe(1);

		// Attempt 2 → poison at threshold (backoff_until cleared). Simulate the
		// 1s backoff window elapsing before the next claim.
		db.db.prepare("UPDATE queue_jobs SET backoff_until = NULL WHERE id = ?").run(claim1!.id);
		const [claim2] = outbox.claim(10, 60_000);
		outbox.fail(claim2!.id, claim2!.locked_by as string, "e2", 2, 1_000, 60_000);
		row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("poison");
		expect(row.attempts).toBe(2);
		expect(row.backoff_until).toBeNull();
	});
});

describe("Outbox — backfill excludes canceled tasks (TASK-042)", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("backfill enqueues active tasks but never canceled tasks", () => {
		const now = new Date().toISOString();
		const canceled = makeTask({ status: "canceled", canceled_at: now });
		const active = makeTask({ title: "Active backfill task" });
		db.tasks.insertTask(canceled);
		db.tasks.insertTask(active);

		const enqueued = outbox.backfillMissingVectors(100);
		expect(enqueued).toBe(1);

		expect(getJob(db, "task", active.id)).toBeDefined();
		expect(getJob(db, "task", canceled.id)).toBeUndefined();
	});
});

describe("EmbeddingWorker — canceled task jobs complete as no-ops (TASK-042)", () => {
	let db: SQLiteStore;
	let worker: EmbeddingWorker;

	beforeEach(async () => {
		db = await createTestStore();
		worker = makeWorker(db);
	});

	afterEach(() => {
		db.close();
	});

	it("a stale pending job for a canceled task is completed without embedding or KG extraction", async () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		// Soft-delete the task WITHOUT purging the queue row (the race the
		// purge + worker guard exist for — a job enqueued before the cancel).
		const now = new Date().toISOString();
		db.tasks.updateTask(task.id, { status: "canceled", canceled_at: now });
		expect(getJob(db, "task", task.id)).toBeDefined();

		const claimed = await worker.runOnce();
		expect(claimed).toBe(1);

		// Job completed as a no-op: no vector, no KG entities/observations.
		expect(getJob(db, "task", task.id)!.status).toBe("done");
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors WHERE task_id = ?", [task.id])).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations")).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities")).toBe(0);
	});

	it("worker processes an active task; deleting it purges queue + vector + observations (TASK-042/045)", async () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		const claimed = await worker.runOnce();
		expect(claimed).toBe(1);

		// Worker wrote the vector + task-domain observations.
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors WHERE task_id = ?", [task.id])).toBe(1);
		const obsText = observationText("task", task.title);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThan(
			0
		);

		// Deleting the task purges the queue row, the vector and the
		// observations its extracted entities created.
		await handleTaskDelete({ id: task.id, owner: "test", repo: REPO, json: true }, db);

		expect(getJob(db, "task", task.id)).toBeUndefined();
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors WHERE task_id = ?", [task.id])).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations")).toBe(0);
	});
});

describe("KnowledgeGraphEntity — repo-scoped orphan sweep (TASK-043)", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
	});

	it("deleteObservationsAndOrphans scoped to repo A never touches repo B entities or observations", () => {
		const now = new Date().toISOString();
		const text = observationText("memory", "Shared Title");

		// Repo A: entity + observation to be removed.
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("Alice", "person", null, "repoA", "test", now, now);
		db.db
			.prepare(
				"INSERT INTO observations (id, entity_name, observation, repo, owner, created_at) VALUES (?, ?, ?, ?, ?, ?)"
			)
			.run(randomUUID(), "Alice", text, "repoA", "test", now);

		// Repo B: standalone dashboard-created entity (no observations at all).
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("DashboardOnly", "concept", null, "repoB", "test", now, now);

		// Repo B: entity whose observation has the IDENTICAL text (title clash).
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("Bob", "person", null, "repoB", "test", now, now);
		db.db
			.prepare(
				"INSERT INTO observations (id, entity_name, observation, repo, owner, created_at) VALUES (?, ?, ?, ?, ?, ?)"
			)
			.run(randomUUID(), "Bob", text, "repoB", "test", now);

		// Repo-A-scoped delete of the shared observation text.
		const orphans = db.knowledgeGraph.deleteObservationsAndOrphans([{ text, repo: "repoA" }]);

		// Repo A observation gone + Alice became an orphan (deleted).
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ? AND repo = ?", [text, "repoA"])
		).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["Alice"])).toBe(0);
		expect(orphans).toBe(1);

		// Repo B fully untouched — no FK cascade, no cross-repo deletion.
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["DashboardOnly"])).toBe(1);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["Bob"])).toBe(1);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ? AND repo = ?", [text, "repoB"])
		).toBe(1);
	});

	it("a memory delete in repo A leaves repo-B entities and same-title observations intact", async () => {
		const now = new Date().toISOString();
		const repoA = "repoA";
		const repoB = "repoB";

		const memoryId = randomUUID();

		// Memory in repo A + extraction → entity + observation in repo A.
		db.memories.insert({
			id: memoryId,
			type: "code_fact",
			title: "Cross Repo Title",
			content: "Alice worked on the deployment for Acme Corp",
			importance: 3,
			agent: "test",
			role: "tester",
			model: "test",
			scope: { owner: "test", repo: repoA },
			created_at: now,
			updated_at: now,
			completed_at: null,
			hit_count: 0,
			recall_count: 0,
			last_used_at: null,
			expires_at: null,
			supersedes: null,
			status: "active",
			tags: [],
			metadata: {},
			is_global: false
		});
		await saveExtractions(
			"Alice worked on the deployment for Acme Corp",
			"Cross Repo Title",
			"test",
			repoA,
			db,
			"memory"
		);
		const repoAObs = observationText("memory", "Cross Repo Title");
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE repo = ?", [repoA])).toBeGreaterThan(0);

		// Repo B: standalone entity + identical-title observation.
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("RepoBStandalone", "concept", null, repoB, "test", now, now);
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("RepoBEntity", "concept", null, repoB, "test", now, now);
		db.db
			.prepare(
				"INSERT INTO observations (id, entity_name, observation, repo, owner, created_at) VALUES (?, ?, ?, ?, ?, ?)"
			)
			.run(randomUUID(), "RepoBEntity", repoAObs, repoB, "test", now);

		// Delete the repo-A memory.
		await handleMemoryDelete({ id: memoryId, owner: "test", repo: repoA, json: true }, db, new StubVectorStore(db));

		// Repo A observations gone; repo B entity + observation intact.
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE repo = ?", [repoA])).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["RepoBStandalone"])).toBe(1);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["RepoBEntity"])).toBe(1);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ? AND repo = ?", [repoAObs, repoB])
		).toBe(1);
	});
});

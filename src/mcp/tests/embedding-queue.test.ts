import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { Outbox, enqueueTask, enqueueMemory, enqueueStandard, enqueueCodebaseSymbols } from "../embedding-queue/outbox";
import { taskJobPayload, memoryJobPayload, standardJobPayload, codebaseEntityId } from "../embedding-queue/enqueue";
import { embedPayloadContentHash } from "../embedding-queue/content-hash";
import { EmbeddingWorker } from "../embedding-queue/worker";
import { RealVectorStore } from "../storage/vectors";
import { observationText, saveExtractions } from "../tools/kg-archivist";
import { handleTaskDelete } from "../tools/task.delete";
import { handleMemoryDelete } from "../tools/memory.delete";
import { _queueJobKindInvariant, type QueueJobKind } from "../embedding-queue/types";
import type { Task, MemoryEntry, CodingStandardEntry, CodebaseSymbolInsert, CodebaseReferenceInsert } from "../types";

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

function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		type: "code_fact",
		title: "Dedup memory title",
		content: "Alice worked on the deployment for Acme Corp",
		importance: 3,
		agent: "test",
		role: "tester",
		model: "test",
		scope: { owner: "test", repo: REPO },
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
		is_global: false,
		...overrides
	};
}

function makeStandard(overrides: Partial<CodingStandardEntry> = {}): CodingStandardEntry {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		code: `CS-${randomUUID().slice(0, 6)}`,
		title: "Dedup standard title",
		content: "Always use UUID primary keys and decimal for money",
		parent_id: null,
		context: "dedup-test",
		version: "1",
		language: "typescript",
		stack: [],
		is_global: false,
		owner: "test",
		repo: REPO,
		tags: [],
		metadata: {},
		created_at: now,
		updated_at: now,
		hit_count: 0,
		last_used_at: null,
		agent: "test",
		model: "test",
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

describe("Outbox — backfill backpressure: gate + preserve backoff (TASK-069)", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("backfill is gated when pending + claimed already exceed the threshold — no double-refill on a deep queue", () => {
		// A deep queue: 3 pending jobs (all still vector-less so backfill would
		// otherwise select them).
		const tasks = [makeTask(), makeTask(), makeTask()];
		for (const t of tasks) {
			db.tasks.insertTask(t);
			enqueueTask(db, t);
		}
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs")).toBe(3);

		// Gate at 2: pending+claimed (3) >= 2 → backfill must not enqueue.
		const enqueued = outbox.backfillMissingVectors(100, 2);
		expect(enqueued).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs")).toBe(3);
	});

	it("backfill inserts ONLY rows absent from queue_jobs — live attempts/backoff are never reset", () => {
		// Task A is already queued and in exponential backoff (attempts=3,
		// backoff_until in the future). Task B is vector-less and NOT queued.
		const taskA = makeTask();
		const taskB = makeTask({ title: "Absent task B" });
		db.tasks.insertTask(taskA);
		db.tasks.insertTask(taskB);
		enqueueTask(db, taskA);

		const futureBackoff = new Date(Date.now() + 60_000).toISOString();
		db.db
			.prepare("UPDATE queue_jobs SET attempts = 3, backoff_until = ?, last_error = 'FK failure' WHERE entity_id = ?")
			.run(futureBackoff, taskA.id);

		// Shallow queue (1 pending < default gate 500) → backfill runs.
		const enqueued = outbox.backfillMissingVectors(100);
		expect(enqueued).toBe(1); // only the absent task B

		// Live row A: attempts/backoff/last_error/status fully preserved.
		const rowA = getJob(db, "task", taskA.id)!;
		expect(rowA.status).toBe("pending");
		expect(rowA.attempts).toBe(3);
		expect(rowA.backoff_until).toBe(futureBackoff);
		expect(rowA.last_error).toBe("FK failure");

		// Absent task B inserted fresh: attempts=0, no backoff.
		const rowB = getJob(db, "task", taskB.id)!;
		expect(rowB).toBeDefined();
		expect(rowB.attempts).toBe(0);
		expect(rowB.backoff_until).toBeNull();
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

describe("EmbeddingWorker — non-empty drain cadence (TASK-069/TASK-074)", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
	});

	it("backs off to pollIntervalMs after nonEmptyBackoffStreak consecutive non-empty batches", () => {
		const worker = new EmbeddingWorker(db, makeStubVectors(), {
			batchSize: 32,
			leaseMs: 60_000,
			poisonThreshold: 3,
			backoffBaseMs: 1_000,
			backoffMaxMs: 60_000,
			pollIntervalMs: 1_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0,
			nonEmptyBackoffStreak: 3
		});

		// First two non-empty cycles poll at the fast half interval.
		expect(worker.nextDelay(1)).toBe(500);
		expect(worker.nextDelay(1)).toBe(500);

		// Third consecutive non-empty cycle reaches the streak → full interval.
		expect(worker.nextDelay(1)).toBe(1000);

		// An empty batch resets the streak — fast drain resumes.
		expect(worker.nextDelay(0)).toBeGreaterThanOrEqual(500);
		expect(worker.nextDelay(1)).toBe(500);
	});

	it("defaults nonEmptyBackoffStreak to the env constant (5) when the option is omitted", () => {
		const worker = new EmbeddingWorker(db, makeStubVectors(), {
			pollIntervalMs: 1_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0
		});

		// Four consecutive non-empty cycles stay on the fast half interval...
		for (let i = 0; i < 4; i++) {
			expect(worker.nextDelay(1)).toBe(500);
		}
		// ...and the fifth (streak >= default 5) backs off to the full interval.
		expect(worker.nextDelay(1)).toBe(1000);
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

// ---------------------------------------------------------------------------
// Content-hash dedup regression tests (OPT-FLOW-03).
// `Outbox.enqueue` (→ `enqueueEmbeddingJob`) is the SINGLE choke point for
// every enqueue site. It computes `embedPayloadContentHash` over exactly the
// embed/KG-relevant payload fields (text/content/title/parentId/decisionRefs/
// context/stack) and, when an existing non-NULL hash matches AND the row is
// not poisoned, leaves the row untouched and returns `false` — no redundant
// ONNX inference / KG extraction. These tests lock in that contract and its
// edge cases (poison recovery, NULL pre-v16 rows, insert-only backfill).
// ---------------------------------------------------------------------------

describe("OPT-FLOW-03 — content-hash dedup", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	describe("1. identical-content re-enqueue → dedup", () => {
		it("positive: identical content returns false and leaves the row untouched", () => {
			const task = makeTask();
			db.tasks.insertTask(task);

			// First enqueue inserts the row and stamps the computed hash.
			const payload = taskJobPayload(task);
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			const before = getJob(db, "task", task.id)!;
			expect(before.content_hash).toBe(embedPayloadContentHash(payload));

			// Identical content re-enqueue → deduped (false), row byte-identical.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe(before.status);
			expect(after.attempts).toBe(before.attempts);
			expect(after.payload).toBe(before.payload);
			expect(after.content_hash).toBe(before.content_hash);
			expect(after.updated_at).toBe(before.updated_at);
		});

		it("negative: a completed ('done') row is NOT LWW-reset to pending on identical re-enqueue", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			// Row already processed (status 'done'). A broken dedup would LWW-reset
			// it to pending (attempts=0); correct dedup keeps it exactly as-is.
			db.db
				.prepare("UPDATE queue_jobs SET status = 'done', attempts = 4, last_error = NULL WHERE entity_id = ?")
				.run(task.id);
			const before = getJob(db, "task", task.id)!;

			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe("done");
			expect(after.attempts).toBe(4);
			expect(after.payload).toBe(before.payload);
		});

		it("boundary: a metadata-only touch (tags/priority/updated_at) is deduped, a content change is not", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload: taskJobPayload(task) });

			// Touch update: only metadata + updated_at bump, no embed/KG field
			// (title/description/decisionRefs/parentId) changed → same hash → dedup.
			const touched = {
				...task,
				tags: ["urgent"],
				priority: 1 as Task["priority"],
				updated_at: new Date().toISOString()
			};
			expect(
				outbox.enqueue({
					kind: "task",
					id: task.id,
					repo: task.repo,
					owner: task.owner,
					payload: taskJobPayload(touched)
				})
			).toBe(false);

			// A real content change (description) produces a different hash → LWW.
			const changed = { ...touched, description: "A completely different description" };
			expect(
				outbox.enqueue({
					kind: "task",
					id: task.id,
					repo: task.repo,
					owner: task.owner,
					payload: taskJobPayload(changed)
				})
			).toBe(true);
		});
	});

	describe("2. changed-content re-enqueue → LWW reset", () => {
		it("positive: a content change returns true, resets the row to pending with a new payload + new content_hash", () => {
			const task = makeTask();
			db.tasks.insertTask(task);

			const original = taskJobPayload(task);
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload: original })).toBe(
				true
			);
			const before = getJob(db, "task", task.id)!;
			expect(before.content_hash).toBe(embedPayloadContentHash(original));

			// Simulate a completed row so the reset to pending is observable.
			db.db.prepare("UPDATE queue_jobs SET status = 'done', attempts = 3 WHERE entity_id = ?").run(task.id);

			// Title change → text = title + "\n" + description changes → LWW reset.
			const updated = { ...task, title: "Changed title", updated_at: new Date().toISOString() };
			const changed = taskJobPayload(updated);
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload: changed })).toBe(
				true
			);

			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe("pending");
			expect(after.attempts).toBe(0);
			expect(after.content_hash).toBe(embedPayloadContentHash(changed));
			expect(after.content_hash).not.toBe(before.content_hash);
			// Payload carries the new title/description (LWW merges newest write).
			expect(JSON.parse(after.payload as string)).toMatchObject({
				text: "Changed title\nAlice worked on the deployment for Acme Corp"
			});
		});

		it("negative: identical content is NOT LWW-reset to pending — the processed row is left alone", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			// Row already processed. A broken LWW (missing dedup guard) would reset
			// it to pending attempts=0 on ANY re-enqueue; correct dedup keeps it as-is.
			db.db.prepare("UPDATE queue_jobs SET status = 'done', attempts = 5 WHERE entity_id = ?").run(task.id);

			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe("done");
			expect(after.attempts).toBe(5);
			expect(after.content_hash).toBe(embedPayloadContentHash(payload));
		});
	});

	describe("3. poisoned rows bypass dedup (never stranded)", () => {
		it("positive: identical content on a poison row returns true and resets poison → pending", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			// The exact same content previously poisoned this row.
			db.db.prepare("UPDATE queue_jobs SET status = 'poison' WHERE entity_id = ?").run(task.id);

			// Unlike a healthy row, a poison row with unchanged hash MUST be
			// re-enqueued (LWW reset to pending) so it gets another chance.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe("pending");
			expect(after.attempts).toBe(0);
			expect(after.content_hash).toBe(embedPayloadContentHash(payload));
		});

		it("negative: once recovered to pending, identical content dedups normally again", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			db.db.prepare("UPDATE queue_jobs SET status = 'poison' WHERE entity_id = ?").run(task.id);
			// Recovery: the touch update resets poison → pending.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			expect(getJob(db, "task", task.id)!.status).toBe("pending");

			// Now that the row is pending with a matching (non-poison) hash, the
			// dedup engages again — a duplicate is no longer queued.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
		});
	});

	describe("4. NULL content_hash (pre-v16 row) is never deduped", () => {
		it("positive: identical content on a NULL-hash row returns true and stamps the hash", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			// Simulate a row enqueued before migration v16 (no hash stored).
			db.db.prepare("UPDATE queue_jobs SET content_hash = NULL WHERE entity_id = ?").run(task.id);
			expect(getJob(db, "task", task.id)!.content_hash).toBeNull();

			// Identical content but an unknown stored hash → must re-enqueue (so the
			// first v16 write computes and stores the hash) instead of assuming dedup.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			const after = getJob(db, "task", task.id)!;
			expect(after.content_hash).toBe(embedPayloadContentHash(payload));
			expect(after.content_hash).not.toBeNull();
		});

		it("negative: after the hash is stamped, an identical re-enqueue dedups", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			db.db.prepare("UPDATE queue_jobs SET content_hash = NULL WHERE entity_id = ?").run(task.id);
			// Stamps the hash.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);

			// Now the guard is armed — identical content is a no-op.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
		});
	});

	describe("5. backfill (enqueueIfAbsent) is insert-only and stores the hash", () => {
		it("positive: an absent task is backfilled with a non-null content_hash", () => {
			const absent = makeTask({ title: "Absent dedup task" });
			db.tasks.insertTask(absent);

			const enqueued = outbox.backfillMissingVectors(100);
			expect(enqueued).toBe(1);

			const row = getJob(db, "task", absent.id)!;
			expect(row).toBeDefined();
			expect(row.status).toBe("pending");
			expect(row.attempts).toBe(0);
			expect(row.content_hash).toBe(embedPayloadContentHash(taskJobPayload(absent)));
			expect(row.content_hash).not.toBeNull();
		});

		it("negative: an existing row with identical content is never touched (attempts/status preserved, not deduped away)", () => {
			const absent = makeTask({ title: "Absent dedup task" });
			const existing = makeTask({ title: "Existing dedup task" });
			db.tasks.insertTask(absent);
			db.tasks.insertTask(existing);

			// The existing task is already queued and in a processed state.
			outbox.enqueue({
				kind: "task",
				id: existing.id,
				repo: existing.repo,
				owner: existing.owner,
				payload: taskJobPayload(existing)
			});
			db.db
				.prepare("UPDATE queue_jobs SET status = 'done', attempts = 4, last_error = 'FK failure' WHERE entity_id = ?")
				.run(existing.id);

			const enqueued = outbox.backfillMissingVectors(100);
			// Only the absent task is inserted — the existing row is untouched.
			expect(enqueued).toBe(1);

			const existingRow = getJob(db, "task", existing.id)!;
			expect(existingRow.status).toBe("done");
			expect(existingRow.attempts).toBe(4);
			expect(existingRow.last_error).toBe("FK failure");
			expect(existingRow.content_hash).toBe(embedPayloadContentHash(taskJobPayload(existing)));

			// The absent task was inserted fresh.
			const absentRow = getJob(db, "task", absent.id)!;
			expect(absentRow.attempts).toBe(0);
			expect(absentRow.status).toBe("pending");
		});
	});

	describe("6. Outbox.enqueue contract + all enqueue sites store the hash", () => {
		it("Outbox.enqueue returns boolean: false on identical re-enqueue, true on changed content", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const first = {
				kind: "task" as const,
				id: task.id,
				repo: task.repo,
				owner: task.owner,
				payload: taskJobPayload(task)
			};

			expect(outbox.enqueue(first)).toBe(true);
			// Same entity, identical payload → deduped (boolean false).
			expect(outbox.enqueue(first)).toBe(false);

			// Different entity, fresh insert → boolean true.
			const other = makeTask();
			db.tasks.insertTask(other);
			expect(outbox.enqueue({ ...first, id: other.id, payload: taskJobPayload(other) })).toBe(true);
		});

		it("enqueueMemory / enqueueStandard / enqueueTask still insert a fresh job with a non-null content_hash", () => {
			const memory = makeMemory();
			db.memories.insert(memory);
			const standard = makeStandard();
			db.standards.insert(standard);
			const task = makeTask();
			db.tasks.insertTask(task);

			enqueueMemory(db, memory);
			enqueueStandard(db, standard);
			enqueueTask(db, task);

			const memoryRow = getJob(db, "memory", memory.id)!;
			expect(memoryRow).toBeDefined();
			expect(memoryRow.content_hash).toBe(
				embedPayloadContentHash(
					memoryJobPayload({
						title: memory.title,
						content: memory.content,
						owner: "test",
						repo: REPO,
						updatedAt: memory.updated_at
					})
				)
			);
			expect(memoryRow.content_hash).not.toBeNull();

			const standardRow = getJob(db, "standard", standard.id)!;
			expect(standardRow).toBeDefined();
			expect(standardRow.content_hash).toBe(embedPayloadContentHash(standardJobPayload(standard)));
			expect(standardRow.content_hash).not.toBeNull();

			const taskRow = getJob(db, "task", task.id)!;
			expect(taskRow).toBeDefined();
			expect(taskRow.content_hash).toBe(embedPayloadContentHash(taskJobPayload(task)));
			expect(taskRow.content_hash).not.toBeNull();
		});

		it("a memory title change IS a content change (title is hashed)", () => {
			const memory = makeMemory();
			db.memories.insert(memory);
			const original = memoryJobPayload({
				title: memory.title,
				content: memory.content,
				owner: "test",
				repo: REPO,
				updatedAt: memory.updated_at
			});
			outbox.enqueue({ kind: "memory", id: memory.id, repo: REPO, owner: "test", payload: original });

			// text = content (unchanged) but title changed → different hash → LWW.
			const retitled = { ...memory, title: "A brand new memory title" };
			const changed = memoryJobPayload({
				title: retitled.title,
				content: retitled.content,
				owner: "test",
				repo: REPO,
				updatedAt: retitled.updated_at
			});
			expect(embedPayloadContentHash(changed)).not.toBe(embedPayloadContentHash(original));
			expect(outbox.enqueue({ kind: "memory", id: memory.id, repo: REPO, owner: "test", payload: changed })).toBe(true);
			expect(getJob(db, "memory", memory.id)!.content_hash).toBe(embedPayloadContentHash(changed));
		});
	});

	describe("7. array-hash order-sensitivity (TASK-177 review NIT)", () => {
		it("positive: re-enqueue with reordered decisionRefs returns true + new content_hash", () => {
			const original = makeTask({
				metadata: { decision_refs: ["A", "B"] as string[] }
			});
			db.tasks.insertTask(original);
			const firstPayload = taskJobPayload(original);

			// First enqueue inserts the row.
			expect(
				outbox.enqueue({
					kind: "task",
					id: original.id,
					repo: original.repo,
					owner: original.owner,
					payload: firstPayload
				})
			).toBe(true);
			const firstHash = getJob(db, "task", original.id)!.content_hash;
			expect(firstHash).toBe(embedPayloadContentHash(firstPayload));

			// Same entity, reordered decisionRefs → different hash → LWW reset.
			const reordered = { ...original, metadata: { decision_refs: ["B", "A"] as string[] } };
			const secondPayload = taskJobPayload(reordered);
			expect(embedPayloadContentHash(secondPayload)).not.toBe(embedPayloadContentHash(firstPayload));

			expect(
				outbox.enqueue({
					kind: "task",
					id: original.id,
					repo: original.repo,
					owner: original.owner,
					payload: secondPayload
				})
			).toBe(true);
			const secondHash = getJob(db, "task", original.id)!.content_hash;
			expect(secondHash).toBe(embedPayloadContentHash(secondPayload));
			expect(secondHash).not.toBe(firstHash);
		});

		it("negative: identical order preserves dedup (false, row untouched)", () => {
			const task = makeTask({
				metadata: { decision_refs: ["X", "Y", "Z"] as string[] }
			});
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);

			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			const firstHash = getJob(db, "task", task.id)!.content_hash;

			// Re-enqueue with IDENTICAL decisionRefs order → deduped.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
			const row = getJob(db, "task", task.id)!;
			expect(row.content_hash).toBe(firstHash);
			expect(row.status).toBe("pending");
			expect(row.attempts).toBe(0);
		});
	});
});

// ---------------------------------------------------------------------------
// Codebase → KG auto-population (TASK-293)
// ---------------------------------------------------------------------------

function makeCodebaseSymbols(filePath: string): CodebaseSymbolInsert[] {
	return [
		{
			repo: REPO,
			file_path: filePath,
			name: "OrderService",
			kind: "class",
			signature: "class OrderService",
			doc_comment: "Handles order processing for Acme Corp"
		},
		{
			repo: REPO,
			file_path: filePath,
			name: "computeTotal",
			kind: "function",
			signature: "computeTotal(items)",
			doc_comment: "Computes the order total"
		}
	];
}

function makeCodebaseRefs(filePath: string): CodebaseReferenceInsert[] {
	return [
		{
			repo: REPO,
			symbol_name: "computeTotal",
			caller_file: filePath,
			caller_line: 5,
			caller_name: "OrderService",
			kind: "call"
		},
		{
			repo: REPO,
			symbol_name: "ExternalDep",
			caller_file: filePath,
			caller_line: 9,
			caller_name: "OrderService",
			kind: "import"
		}
	];
}

describe("EmbeddingWorker — codebase_symbol → KG auto-population (TASK-293)", () => {
	let db: SQLiteStore;
	let worker: EmbeddingWorker;

	beforeEach(async () => {
		db = await createTestStore();
		worker = makeWorker(db);
	});

	afterEach(() => {
		db.close();
	});

	it("positive: a codebase job KG-extracts entities + relations and writes NO vector (no double-vector)", async () => {
		const FILE = "src/order.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		db.codebaseReferences.bulkUpsertReferences(REPO, makeCodebaseRefs(FILE));

		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE))).toBe(true);
		expect(getJob(db, "codebase_symbol", entityId)).toBeDefined();

		const claimed = await worker.runOnce();
		expect(claimed).toBe(1);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");

		// KG: the file-scoped "codebase" observation exists (shared by
		// saveExtractions + the relation writer) …
		const obsText = observationText("codebase", FILE);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThan(
			0
		);
		// … symbol entities exist (name-keyed; compromise extraction may have
		// created them first with a generic type, so the TYPE is pinned only
		// deterministically in the direct saveCodebaseRelations tests) …
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = 'OrderService'")).toBe(1);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = 'computeTotal'")).toBe(1);
		// … and reference edges (caller → referenced symbol, type = ref kind).
		const callRel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = 'OrderService' AND to_entity = 'computeTotal'")
			.get() as { relation_type: string } | undefined;
		expect(callRel).toBeDefined();
		expect(callRel!.relation_type).toBe("call");

		// No vector writes: codebase symbols keep their own (currently
		// unpopulated) vector tables, and the worker must NOT fall into the
		// task-vector branch either — the double-vector guard (TASK-293).
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM codebase_symbol_vectors")).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors")).toBe(0);
	});

	it("negative: a codebase-only batch never invokes the ONNX embed path — KG extraction still runs (TASK-338)", async () => {
		const FILE = "src/embed-skip.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		db.codebaseReferences.bulkUpsertReferences(REPO, makeCodebaseRefs(FILE));
		enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE));

		// The embed spy FAILS the test if ONNX inference is attempted — the
		// pre-fix batch embed (worker.ts:290) would reject here, poisoning the
		// job instead of completing it.
		const embedMock = vi.fn().mockRejectedValue(new Error("embed must not run for codebase_symbol jobs"));
		const noEmbedWorker = new EmbeddingWorker(db, { embed: embedMock } as unknown as RealVectorStore, {
			batchSize: 32,
			leaseMs: 60_000,
			poisonThreshold: 3,
			backoffBaseMs: 1_000,
			backoffMaxMs: 60_000,
			pollIntervalMs: 3_600_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0
		});

		const claimed = await noEmbedWorker.runOnce();
		expect(claimed).toBe(1);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");

		// Embed path untouched — zero ONNX inference for the codebase job.
		expect(embedMock).not.toHaveBeenCalled();

		// The KG side still ran: file-scoped observation + symbol entities.
		const obsText = observationText("codebase", FILE);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThan(
			0
		);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = 'OrderService'")).toBe(1);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = 'computeTotal'")).toBe(1);
	});

	it("mixed batch: only memory/standard/task texts reach ONNX; codebase jobs embed-skip with a placeholder vector (TASK-338)", async () => {
		const FILE = "src/mixed.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE));

		const memory = makeMemory();
		db.memories.insert(memory);
		enqueueMemory(db, memory);

		// Single 1-D vector is enough: exactly ONE text may reach the embed
		// call — the codebase symbol payload must be filtered out.
		const embedMock = vi.fn().mockResolvedValue([[0.1, 0.2]]);
		const mixedWorker = new EmbeddingWorker(db, { embed: embedMock } as unknown as RealVectorStore, {
			batchSize: 32,
			leaseMs: 60_000,
			poisonThreshold: 3,
			backoffBaseMs: 1_000,
			backoffMaxMs: 60_000,
			pollIntervalMs: 3_600_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0
		});

		const claimed = await mixedWorker.runOnce();
		expect(claimed).toBe(2);
		expect(getJob(db, "memory", memory.id)!.status).toBe("done");
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");

		// Exactly one embed call, carrying ONLY the embed-needed (memory) text.
		expect(embedMock).toHaveBeenCalledTimes(1);
		expect(embedMock.mock.calls[0][0]).toEqual([memory.content]);

		// Memory vector persisted; codebase KG observation written with the
		// placeholder vector (never persisted — zero symbol/task vectors).
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM memory_vectors WHERE memory_id = ?", [memory.id])).toBe(1);
		const obsText = observationText("codebase", FILE);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThan(
			0
		);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM codebase_symbol_vectors")).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors")).toBe(0);
	});

	it("LWW + content-hash dedup: identical re-enqueue dedups, changed content LWW-resets the single row", () => {
		const FILE = "src/lww.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });

		// Identical re-parse → dedup (OPT-FLOW-03) — still exactly one row.
		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE))).toBe(true);
		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE))).toBe(false);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?", [
				entityId
			])
		).toBe(1);

		// Changed symbol content → LWW reset of the SAME row (no duplicate).
		const changed = [
			{ ...makeCodebaseSymbols(FILE)[0], doc_comment: "Handles orders v2" },
			makeCodebaseSymbols(FILE)[1]
		];
		expect(enqueueCodebaseSymbols(db, REPO, FILE, changed, makeCodebaseRefs(FILE))).toBe(true);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?", [
				entityId
			])
		).toBe(1);
		expect(getJob(db, "codebase_symbol", entityId)!.payload).toContain("orders v2");
	});

	it("reference-only change (identical symbols) invalidates dedup via the ref digest", () => {
		const FILE = "src/calls.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });

		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE))).toBe(true);

		// Same symbols, changed call graph → ref digest differs → re-enqueue.
		const changedRefs = [
			...makeCodebaseRefs(FILE),
			{
				repo: REPO,
				symbol_name: "NewDep",
				caller_file: FILE,
				caller_line: 90,
				caller_name: "OrderService",
				kind: "call"
			}
		];
		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), changedRefs)).toBe(true);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("pending");
	});

	it("ref digest is stable across per-parse target_symbol_id churn (TASK-342)", () => {
		const FILE = "src/stable-target.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });

		// Wave 1 resolution result: same edge, same resolved target FILE, but
		// re-parse re-created the target symbol row with a fresh UUID
		// (delete-by-file + bulkUpsertSymbols) — target_symbol_id must NOT
		// churn the digest, or every force re-index of an unchanged file would
		// re-enqueue and re-run ONNX/KG. target_file is the stable identity.
		const refsWithUuidA = makeCodebaseRefs(FILE).map((r) => ({
			...r,
			target_file: "src/dep.ts",
			target_symbol_id: "3f9c4c2e-0000-4000-8000-00000000000a"
		}));
		const refsWithUuidB = makeCodebaseRefs(FILE).map((r) => ({
			...r,
			target_file: "src/dep.ts",
			target_symbol_id: "b7d1e8f4-1111-4111-8111-111111111111"
		}));

		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), refsWithUuidA)).toBe(true);
		// Identical edge identity (same name/kind/caller/target_file), only the
		// per-parse symbol UUID differs → same ref digest → same content hash →
		// deduped, single row. Pre-fix (hashing target_symbol_id) this returned
		// true and LWW-reset the row on every re-parse.
		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), refsWithUuidB)).toBe(false);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?", [
				entityId
			])
		).toBe(1);
	});

	it("negative: a job whose indexed file no longer exists completes as a no-op (no KG rows)", async () => {
		const FILE = "src/ghost.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE));

		// The file is deleted after enqueue (stale cleanup race) — the worker
		// precheck must skip KG extraction for the stale job.
		db.codebaseFiles.deleteFile(REPO, FILE);

		const claimed = await worker.runOnce();
		expect(claimed).toBe(1);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities")).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations")).toBe(0);
	});

	it("queue-kind contract: QueueJobKind re-admits codebase_symbol (compile-time invariant)", () => {
		// _queueJobKindInvariant is 'true' at compile time — tsc fails if the
		// QueueJobKind derivation drifts. This runtime test pins the union.
		expect(_queueJobKindInvariant).toBe(true);
		const kinds: QueueJobKind[] = ["memory", "standard", "task", "codebase_symbol"];
		expect(kinds).toHaveLength(4);
	});
});

/**
 * SQLite-backed outbox for embedding/KG jobs (TASK-013 / MEM-368).
 *
 * All methods are synchronous (better-sqlite3) and cheap — enqueue is a
 * single upsert statement that runs inside the caller's write transaction,
 * keeping write-lock hold time at ~µs instead of the 150-500ms ONNX +
 * compromise work it replaces.
 *
 * Concurrency model (two processes — MCP server + dashboard — share the DB):
 * - Claim is one atomic UPDATE ... WHERE id IN (SELECT ... LIMIT K): SQLite's
 *   single-writer serialization guarantees no two workers claim the same row.
 * - A claimed row carries a unique batch token (`locked_by`); the worker
 *   selects its own batch by that token.
 * - Complete/fail are conditional on `status = 'claimed'` AND the batch token
 *   (`locked_by`): if the row was re-enqueued (LWW upsert reset it to
 *   `pending`) or re-claimed by another worker after lease expiry (different
 *   token), the transition no-ops and the newer snapshot / owning worker
 *   survives. fail() increments attempts in a single atomic UPDATE, so a
 *   stale-lease worker can never double-increment or prematurely poison a
 *   job it no longer owns.
 * - Lease expiry + startup reconcile + backfill cover crashes; purge sweeps
 *   finished rows.
 *
 * Write-lock policy (TASK-064 / MEM-475): worker writes stay OUTSIDE the
 * proper-lockfile write lock by design. claim/complete/fail are single
 * conditional UPDATE statements (SNAPSHOT-immune) and wait at most
 * busy_timeout=5000 for a transient SQLite writer; the read-then-write
 * backfill runs inside a BEGIN IMMEDIATE transaction so it grabs the SQLite
 * write lock upfront instead of failing with SQLITE_BUSY_SNAPSHOT.
 */
import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { SQLiteStore } from "../storage/sqlite";
import { buildStandardVectorText } from "../tools/standard.shared";
import { MemoryEntry, Task } from "../types";
import { CodingStandardEntry } from "../types/memory";
import { EmbeddingJobInput, EmbeddingJobPayload, QueueCounts, QueueJobRow, QueueJobStatus } from "./types";

// ---------------------------------------------------------------------------
// Snapshot payload builders
// ---------------------------------------------------------------------------

/** Memory job payload — embed the full content, KG-extract the full content. */
export function memoryJobPayload(input: {
	title?: string | null;
	content: string;
	owner: string;
	repo: string;
	updatedAt: string;
}): EmbeddingJobPayload {
	return {
		v: 1,
		text: input.content,
		content: input.content,
		title: input.title ?? "",
		owner: input.owner,
		repo: input.repo,
		updatedAt: input.updatedAt
	};
}

/** Standard job payload — vector text per standard.shared, KG on content + relations fields. */
export function standardJobPayload(standard: CodingStandardEntry): EmbeddingJobPayload {
	return {
		v: 1,
		text: buildStandardVectorText(standard),
		content: standard.content,
		title: standard.title,
		owner: standard.owner,
		repo: standard.repo ?? "",
		updatedAt: standard.updated_at,
		parentId: standard.parent_id,
		context: standard.context,
		stack: standard.stack
	};
}

/** Task job payload — vector + KG on `title\n<description>`. */
export function taskJobPayload(task: Task): EmbeddingJobPayload {
	const text = `${task.title}\n${task.description ?? ""}`;
	const decisionRefs = (task.metadata?.decision_refs as string[] | undefined) ?? undefined;
	return {
		v: 1,
		text,
		content: text,
		title: task.title,
		owner: task.owner,
		repo: task.repo,
		updatedAt: task.updated_at,
		parentId: task.parent_id,
		decisionRefs
	};
}

// ---------------------------------------------------------------------------
// Enqueue (single sync upsert — used by tool handlers inside withWrite)
// ---------------------------------------------------------------------------

const ENQUEUE_SQL = `
  INSERT INTO queue_jobs (id, entity_kind, entity_id, entity_repo, payload, status, attempts, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
    payload = excluded.payload,
    status = 'pending',
    attempts = 0,
    lease_until = NULL,
    locked_by = NULL,
    backoff_until = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at
`;

/** Synchronous LWW enqueue. Cheap (~µs) — safe inside the write lock. */
export function enqueueEmbeddingJob(store: SQLiteStore, input: EmbeddingJobInput): void {
	const now = new Date().toISOString();
	store.db
		.prepare(ENQUEUE_SQL)
		.run(randomUUID(), input.kind, input.id, input.repo ?? "", JSON.stringify(input.payload), now, now);
}

/** Convenience wrappers used by the write handlers. */
export function enqueueMemory(store: SQLiteStore, memory: MemoryEntry): void {
	enqueueEmbeddingJob(store, {
		kind: "memory",
		id: memory.id,
		repo: memory.scope.repo,
		owner: memory.scope.owner,
		payload: memoryJobPayload({
			title: memory.title,
			content: memory.content,
			owner: memory.scope.owner,
			repo: memory.scope.repo,
			updatedAt: memory.updated_at
		})
	});
}

export function enqueueStandard(store: SQLiteStore, standard: CodingStandardEntry): void {
	enqueueEmbeddingJob(store, {
		kind: "standard",
		id: standard.id,
		repo: standard.repo ?? "",
		owner: standard.owner,
		payload: standardJobPayload(standard)
	});
}

export function enqueueTask(store: SQLiteStore, task: Task): void {
	enqueueEmbeddingJob(store, {
		kind: "task",
		id: task.id,
		repo: task.repo,
		owner: task.owner,
		payload: taskJobPayload(task)
	});
}

// ---------------------------------------------------------------------------
// Outbox — claim/complete/fail/reconcile/purge/backfill (worker-facing)
// ---------------------------------------------------------------------------

export class Outbox {
	private batchCounter = 0;

	constructor(private readonly store: SQLiteStore) {}

	get db(): Database.Database {
		return this.store.db;
	}

	enqueue(input: EmbeddingJobInput): void {
		enqueueEmbeddingJob(this.store, input);
	}

	/**
	 * Atomically claim up to `max` eligible jobs (pending, or claimed with an
	 * expired lease) and return them. The claim is a single UPDATE statement —
	 * SQLite serializes writers, so concurrent workers (MCP server + dashboard)
	 * never claim the same row. Rows are tagged with a unique batch token and
	 * read back by that token.
	 */
	claim(max: number, leaseMs: number): QueueJobRow[] {
		if (max <= 0) return [];
		const now = new Date().toISOString();
		const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
		const batchId = `${process.pid}-${this.batchCounter++}-${Date.now().toString(36)}`;

		const result = this.store.db
			.prepare(
				`UPDATE queue_jobs
           SET status = 'claimed', lease_until = ?, locked_by = ?, updated_at = ?
           WHERE id IN (
             SELECT id FROM queue_jobs
             WHERE (status = 'pending' AND (backoff_until IS NULL OR backoff_until <= ?))
                OR (status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?)
             ORDER BY created_at ASC
             LIMIT ?
           )`
			)
			.run(leaseUntil, batchId, now, now, now, max);

		if (result.changes === 0) return [];
		return this.store.db
			.prepare("SELECT * FROM queue_jobs WHERE locked_by = ? ORDER BY created_at ASC")
			.all(batchId) as QueueJobRow[];
	}

	/**
	 * Conditional completion: only succeeds while the row is still `claimed`
	 * by THIS worker's batch token (`locked_by`). If a newer enqueue reset the
	 * row to `pending` (LWW), or the lease expired and another worker
	 * re-claimed it (different token), this no-ops and the newer snapshot is
	 * processed next.
	 */
	complete(id: string, lockedBy: string): boolean {
		const result = this.store.db
			.prepare(
				"UPDATE queue_jobs SET status = 'done', updated_at = ?, last_error = NULL WHERE id = ? AND status = 'claimed' AND locked_by = ?"
			)
			.run(new Date().toISOString(), id, lockedBy);
		return result.changes > 0;
	}

	/**
	 * Conditional failure: increments attempts; poisons at `poisonThreshold`,
	 * otherwise re-queues with exponential backoff (base * 2^(attempt-1),
	 * capped at `backoffMaxMs`). No-ops if the row was re-enqueued or
	 * re-claimed meanwhile (guarded by `status = 'claimed' AND locked_by = ?`),
	 * so an expired-lease worker can neither poison nor double-increment a job
	 * that another worker re-claimed.
	 *
	 * The attempts increment is a single atomic UPDATE (`attempts = attempts + 1`
	 * — SQLite serializes writers, so no two workers can increment the same
	 * row). The guarded read before it exists ONLY to compute the exponential
	 * backoff window: SQLite's SET clause sees pre-update values and has no
	 * pow(), so the offset cannot be computed inside the UPDATE itself. The
	 * poison/backoff branch is applied inside that same conditional statement
	 * (status + backoff_until bound per branch); if the row is no longer ours
	 * by the time the UPDATE runs, it matches zero rows and nothing changes.
	 */
	fail(
		id: string,
		lockedBy: string,
		error: string,
		poisonThreshold: number,
		backoffBaseMs: number,
		backoffMaxMs: number
	): void {
		const now = new Date().toISOString();
		const message = String(error).slice(0, 500);

		const row = this.store.db
			.prepare("SELECT attempts FROM queue_jobs WHERE id = ? AND status = 'claimed' AND locked_by = ?")
			.get(id, lockedBy) as { attempts: number } | undefined;
		if (!row) return; // not our claim — no-op

		const nextAttempts = (row.attempts ?? 0) + 1;
		const poison = nextAttempts >= poisonThreshold;
		const backoffUntil = poison
			? null
			: new Date(Date.now() + Math.min(backoffBaseMs * 2 ** (nextAttempts - 1), backoffMaxMs)).toISOString();

		this.store.db
			.prepare(
				`UPDATE queue_jobs
           SET attempts = attempts + 1,
               status = ?,
               last_error = ?,
               lease_until = NULL,
               locked_by = NULL,
               backoff_until = ?,
               updated_at = ?
           WHERE id = ? AND status = 'claimed' AND locked_by = ?`
			)
			.run(poison ? "poison" : "pending", message, backoffUntil, now, id, lockedBy);
	}

	/** Reset expired-lease claims back to pending (crash recovery). */
	reconcileExpiredLeases(): number {
		const result = this.store.db
			.prepare(
				`UPDATE queue_jobs
           SET status = 'pending', lease_until = NULL, locked_by = NULL, updated_at = ?
           WHERE status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?`
			)
			.run(new Date().toISOString(), new Date().toISOString());
		return result.changes;
	}

	countByStatus(): QueueCounts {
		const rows = this.store.db.prepare("SELECT status, COUNT(*) AS c FROM queue_jobs GROUP BY status").all() as {
			status: QueueJobStatus;
			c: number;
		}[];
		const counts: QueueCounts = { pending: 0, claimed: 0, done: 0, poison: 0, total: 0 };
		for (const row of rows) {
			if (row.status in counts) counts[row.status] = row.c;
			counts.total += row.c;
		}
		return counts;
	}

	/** Sweep finished rows: done after `doneTtlMs`, poison after `poisonTtlMs`. */
	purge(doneTtlMs: number, poisonTtlMs: number): { purgedDone: number; purgedPoison: number } {
		const doneBefore = new Date(Date.now() - doneTtlMs).toISOString();
		const poisonBefore = new Date(Date.now() - poisonTtlMs).toISOString();
		const purgedDone = this.store.db
			.prepare("DELETE FROM queue_jobs WHERE status = 'done' AND updated_at < ?")
			.run(doneBefore).changes;
		const purgedPoison = this.store.db
			.prepare("DELETE FROM queue_jobs WHERE status = 'poison' AND updated_at < ?")
			.run(poisonBefore).changes;
		return { purgedDone, purgedPoison };
	}

	/**
	 * Startup backfill: enqueue rows whose vector is missing or stale (entity
	 * updated_at newer than the vector row). Runs once per process start,
	 * bounded by `cap`. Existing pending/claimed rows are refreshed via the
	 * LWW upsert; rows another worker just embedded are skipped by the
	 * freshness comparison.
	 */
	backfillMissingVectors(cap: number): number {
		if (cap <= 0) return 0;
		let enqueued = 0;

		this.store.db
			.transaction(() => {
				const memories = this.store.db
					.prepare(
						`SELECT m.id, m.repo, m.owner, m.title, m.content, m.updated_at
             FROM memories m LEFT JOIN memory_vectors mv ON mv.memory_id = m.id
             WHERE m.status = 'active' AND (mv.memory_id IS NULL OR mv.updated_at < m.updated_at)
             LIMIT ?`
					)
					.all(cap) as Array<{
					id: string;
					repo: string;
					owner: string;
					title: string | null;
					content: string;
					updated_at: string;
				}>;

				for (const m of memories) {
					this.enqueue({
						kind: "memory",
						id: m.id,
						repo: m.repo,
						owner: m.owner,
						payload: memoryJobPayload({
							title: m.title,
							content: m.content,
							owner: m.owner,
							repo: m.repo,
							updatedAt: m.updated_at
						})
					});
					enqueued++;
				}

				if (enqueued < cap) {
					const standards = this.store.db
						.prepare(
							`SELECT s.id, s.repo, s.owner, s.title, s.content, s.context, s.stack, s.parent_id, s.updated_at
               FROM coding_standards s LEFT JOIN standard_vectors sv ON sv.standard_id = s.id
               WHERE sv.standard_id IS NULL OR sv.updated_at < s.updated_at
               LIMIT ?`
						)
						.all(cap - enqueued) as Array<{
						id: string;
						repo: string | null;
						owner: string;
						title: string;
						content: string;
						context: string;
						stack: string | null;
						parent_id: string | null;
						updated_at: string;
					}>;

					for (const s of standards) {
						const standard: CodingStandardEntry = {
							id: s.id,
							code: undefined,
							title: s.title,
							content: s.content,
							parent_id: s.parent_id,
							context: s.context,
							version: "",
							language: null,
							stack: this.parseStringArray(s.stack),
							is_global: false,
							owner: s.owner,
							repo: s.repo,
							tags: [],
							metadata: {},
							created_at: s.updated_at,
							updated_at: s.updated_at,
							hit_count: 0,
							last_used_at: null,
							agent: "backfill",
							model: "backfill"
						};
						this.enqueue({
							kind: "standard",
							id: s.id,
							repo: s.repo ?? "",
							owner: s.owner,
							payload: standardJobPayload(standard)
						});
						enqueued++;
					}
				}

				if (enqueued < cap) {
					const tasks = this.store.db
						.prepare(
							`SELECT t.id, t.repo, t.owner, t.phase, t.title, t.description, t.parent_id, t.metadata, t.updated_at
               FROM tasks t LEFT JOIN task_vectors tv ON tv.task_id = t.id
               WHERE t.status != 'canceled' AND (tv.task_id IS NULL OR tv.updated_at < t.updated_at)
               LIMIT ?`
						)
						.all(cap - enqueued) as Array<{
						id: string;
						repo: string;
						owner: string;
						phase: string;
						title: string;
						description: string | null;
						parent_id: string | null;
						metadata: string | null;
						updated_at: string;
					}>;

					for (const t of tasks) {
						const task: Task = {
							id: t.id,
							owner: t.owner,
							repo: t.repo,
							task_code: "",
							phase: t.phase,
							title: t.title,
							description: t.description,
							status: "backlog",
							priority: 3,
							agent: "backfill",
							role: "backfill",
							doc_path: null,
							created_at: t.updated_at,
							updated_at: t.updated_at,
							in_progress_at: null,
							finished_at: null,
							canceled_at: null,
							est_tokens: 0,
							tags: [],
							suggested_skills: [],
							commit_id: null,
							changed_files: [],
							metadata: this.safeJson(t.metadata),
							parent_id: t.parent_id,
							depends_on: null
						};
						this.enqueue({
							kind: "task",
							id: t.id,
							repo: t.repo,
							owner: t.owner,
							payload: taskJobPayload(task)
						});
						enqueued++;
					}
				}
			})
			.immediate();

		return enqueued;
	}

	private parseStringArray(value: string | null): string[] {
		try {
			const parsed = value ? (JSON.parse(value) as unknown) : [];
			return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
		} catch {
			return [];
		}
	}

	private safeJson(value: string | null): Record<string, unknown> {
		try {
			const parsed = value ? (JSON.parse(value) as unknown) : {};
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
		} catch {
			return {};
		}
	}
}

/** Convenience: build an Outbox for a store (used by observability endpoints). */
export function outboxFor(store: SQLiteStore): Outbox {
	return new Outbox(store);
}

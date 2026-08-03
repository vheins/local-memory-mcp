/**
 * Enqueue + startup-backfill logic for the embedding/KG outbox (TASK-074).
 *
 * Split out of `outbox.ts` so the outbox stays under the 500-line rule and
 * each file owns one concern:
 *   - `enqueue.ts` — snapshot payload builders, synchronous LWW enqueue
 *     (single upsert used by tool handlers inside `withWrite`), and the
 *     read-then-write startup backfill.
 *   - `outbox.ts` — the `Outbox` worker-facing lifecycle (claim/complete/fail/
 *     reconcile/purge/count), delegating enqueue + backfill back here.
 *
 * All methods are synchronous (better-sqlite3) and cheap — enqueue is a single
 * upsert statement that runs inside the caller's write transaction, keeping
 * write-lock hold time at ~µs instead of the 150-500ms ONNX + compromise work
 * it replaces.
 *
 * Write-lock policy (TASK-064 / MEM-475): worker/backfill writes stay OUTSIDE
 * the proper-lockfile write lock by design. The read-then-write backfill runs
 * inside a BEGIN IMMEDIATE transaction so it grabs the SQLite write lock
 * upfront instead of failing with SQLITE_BUSY_SNAPSHOT.
 */
import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { buildStandardVectorText } from "../tools/standard.shared";
import { logger } from "../utils/logger";
import { EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE, TABLE_MEMORIES, TABLE_TASKS } from "../utils/constants";
import { MemoryEntry, Task, CodingStandardEntry, MEMORY_STATUS_ACTIVE, TASK_STATUS_CANCELED } from "../types";
import { embedPayloadContentHash } from "./content-hash";
import { EmbeddingJobInput, EmbeddingJobPayload, QueueCounts, QueueJobStatus, QueueJobRow } from "./types";

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
  INSERT INTO queue_jobs (id, entity_kind, entity_id, entity_repo, payload, content_hash, status, attempts, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
    payload = excluded.payload,
    content_hash = excluded.content_hash,
    status = 'pending',
    attempts = 0,
    lease_until = NULL,
    locked_by = NULL,
    backoff_until = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at
`;

/**
 * Synchronous LWW enqueue. Cheap (~µs) — safe inside the write lock.
 *
 * Content-hash dedup (OPT-FLOW-03): when a `queue_jobs` row already exists for
 * (entity_kind, entity_id) AND its stored `content_hash` matches the incoming
 * payload's embed/KG-relevant hash, the row is left untouched and the enqueue
 * returns `false` — no ONNX inference, no KG extraction, no attempt/backoff
 * reset. This turns tag-only / metadata-only / touch updates (which the worker
 * would otherwise re-embed on byte-identical content) into no-ops. LWW
 * semantics for genuinely-changed content are preserved: any change to a field
 * the worker consumes (text/content/title/parentId/decisionRefs/context/stack)
 * produces a different hash and falls through to the normal LWW upsert.
 *
 * Pre-migration rows (`content_hash` NULL) are never deduped — the first
 * enqueue after v16 computes and stores the hash.
 *
 * Poisoned rows are NEVER deduped: `Outbox.claim()` skips `poison` rows (they
 * are swept by purge TTL, not retried), so a re-enqueue after any update is
 * the only recovery path for a job that failed on this exact content — a touch
 * update must reset it to `pending` even when the hash matches, otherwise the
 * entity stays without a vector until purge + restart.
 *
 * @returns `true` when the job was enqueued/upserted, `false` when deduped.
 */
export function enqueueEmbeddingJob(store: SQLiteStore, input: EmbeddingJobInput): boolean {
	const contentHash = embedPayloadContentHash(input.payload);

	const existing = store.db
		.prepare("SELECT content_hash, status FROM queue_jobs WHERE entity_kind = ? AND entity_id = ?")
		.get(input.kind, input.id) as Pick<QueueJobRow, "content_hash" | "status"> | undefined;

	if (
		existing &&
		existing.content_hash !== null &&
		existing.content_hash === contentHash &&
		existing.status !== "poison"
	) {
		logger.debug("[EmbeddingQueue] dedup: embed/KG content unchanged — skip re-enqueue (OPT-FLOW-03)", {
			kind: input.kind,
			id: input.id,
			status: existing.status
		});
		return false;
	}

	const now = new Date().toISOString();
	store.db
		.prepare(ENQUEUE_SQL)
		.run(randomUUID(), input.kind, input.id, input.repo ?? "", JSON.stringify(input.payload), contentHash, now, now);
	return true;
}

/**
 * Insert ONLY IF the (entity_kind, entity_id) row does not exist yet — never
 * touches an existing row. Backfill uses this so a live queued row keeps its
 * attempts/backoff_until/last_error instead of being LWW-reset to
 * attempts=0/backoff=NULL (TASK-068 S1 / TASK-069): FK-poisoned jobs must
 * keep their exponential retry backoff, and a restart must not defeat it.
 */
export function enqueueIfAbsent(store: SQLiteStore, input: EmbeddingJobInput): boolean {
	const now = new Date().toISOString();
	const result = store.db
		.prepare(
			`INSERT INTO queue_jobs (id, entity_kind, entity_id, entity_repo, payload, content_hash, status, attempts, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
			ON CONFLICT(entity_kind, entity_id) DO NOTHING`
		)
		.run(
			randomUUID(),
			input.kind,
			input.id,
			input.repo ?? "",
			JSON.stringify(input.payload),
			embedPayloadContentHash(input.payload),
			now,
			now
		);
	return result.changes > 0;
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

/** Queue depth by status (shared by the worker observability + backfill gate). */
export function countByStatus(store: SQLiteStore): QueueCounts {
	const rows = store.db.prepare("SELECT status, COUNT(*) AS c FROM queue_jobs GROUP BY status").all() as {
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

/**
 * Startup backfill: enqueue rows whose vector is missing or stale (entity
 * updated_at newer than the vector row). Runs once per process start,
 * bounded by `cap`.
 *
 * Backpressure (TASK-068 S1 / TASK-069):
 * - Gated: when pending + claimed already reach `minPendingClaimed`
 *   (default EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE = 500), backfill returns 0
 *   immediately — a deep backlog is NOT double-refilled at restart; the
 *   worker drains the jobs it already has.
 * - Insert-only: rows ABSENT from queue_jobs are inserted fresh; rows that
 *   already exist (pending/claimed/backoff) are NEVER touched, so their
 *   attempts/backoff_until survive. This preserves exponential retry backoff
 *   for FK-poisoned jobs instead of resetting them to retry immediately (the
 *   pre-fix CPU multiplier).
 * - Rows another worker just embedded are skipped by the freshness
 *   comparison (vector updated_at >= entity updated_at).
 *
 * Runs inside a BEGIN IMMEDIATE transaction (TASK-064 / MEM-475): the read-
 * then-write sequence grabs the SQLite write lock upfront instead of failing
 * with SQLITE_BUSY_SNAPSHOT under concurrent writers.
 */
export function backfillMissingVectors(
	store: SQLiteStore,
	cap: number,
	minPendingClaimed = EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE
): number {
	if (cap <= 0) return 0;

	const counts = countByStatus(store);
	if (counts.pending + counts.claimed >= minPendingClaimed) {
		logger.info("[EmbeddingQueue] backfill gated by queue depth", {
			pending: counts.pending,
			claimed: counts.claimed,
			gate: minPendingClaimed
		});
		return 0;
	}

	let enqueued = 0;

	store.db
		.transaction(() => {
			const memories = store.db
				.prepare(
					`SELECT m.id, m.repo, m.owner, m.title, m.content, m.updated_at
             FROM ${TABLE_MEMORIES} m LEFT JOIN memory_vectors mv ON mv.memory_id = m.id
             WHERE m.status = '${MEMORY_STATUS_ACTIVE}' AND (mv.memory_id IS NULL OR mv.updated_at < m.updated_at)
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
				if (
					enqueueIfAbsent(store, {
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
					})
				) {
					enqueued++;
				}
			}

			if (enqueued < cap) {
				const standards = store.db
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
						stack: parseStringArray(s.stack),
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
					if (
						enqueueIfAbsent(store, {
							kind: "standard",
							id: s.id,
							repo: s.repo ?? "",
							owner: s.owner,
							payload: standardJobPayload(standard)
						})
					) {
						enqueued++;
					}
				}
			}

			if (enqueued < cap) {
				const tasks = store.db
					.prepare(
						`SELECT t.id, t.repo, t.owner, t.phase, t.title, t.description, t.parent_id, t.metadata, t.updated_at
             FROM ${TABLE_TASKS} t LEFT JOIN task_vectors tv ON tv.task_id = t.id
              WHERE t.status != '${TASK_STATUS_CANCELED}' AND (tv.task_id IS NULL OR tv.updated_at < t.updated_at)
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
						metadata: safeJson(t.metadata),
						parent_id: t.parent_id,
						depends_on: null
					};
					if (
						enqueueIfAbsent(store, {
							kind: "task",
							id: t.id,
							repo: t.repo,
							owner: t.owner,
							payload: taskJobPayload(task)
						})
					) {
						enqueued++;
					}
				}
			}
		})
		.immediate();

	return enqueued;
}

function parseStringArray(value: string | null): string[] {
	try {
		const parsed = value ? (JSON.parse(value) as unknown) : [];
		return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

function safeJson(value: string | null): Record<string, unknown> {
	try {
		const parsed = value ? (JSON.parse(value) as unknown) : {};
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * Idempotent startup reconciliation for half-archived tasks (FIX-002 / ADR-012).
 *
 * WHY THIS EXISTS
 * ---------------
 * Completing a task writes two things in two DIFFERENT SQLite files:
 *   - the task row (`tasks.db`: status='completed', finished_at), and
 *   - a `task_archive` memory (`memory.db`, core).
 * SQLite cannot commit that pair atomically, and `withExclusiveWrite` only
 * serializes the attempt — it does not make it atomic. Before this pass, a
 * failed archive was logged and dropped, so a completed task could exist with
 * no archive and no trace anywhere.
 *
 * MECHANISM (recorded in ADR-012 §Risks and Mitigations)
 * ------------------------------------------------------
 * 1. The archive failure is no longer swallowed: `archiveCompletedTasks`
 *    returns a detectable outcome that the task-write response surfaces
 *    (`archiveStatus: { status: "pending" }`), and `archiveTaskToMemory`
 *    persists a durable `metadata.archive_pending` marker on the task row —
 *    the SAME file as the completed status, so the marker is exactly as
 *    durable as the completion it describes. No schema change, no migration.
 * 2. This pass drains the marker at startup, idempotently: it re-archives only
 *    tasks with the marker AND no existing archive memory, then clears the
 *    marker. A task that already has an archive is never archived twice — the
 *    existing linkage (`metadata.task_id` for a single archive,
 *    `metadata.task_ids` for an aggregated one) is the idempotency key.
 *
 * BOUNDING
 * --------
 * The scan is bounded on both axes so a startup never walks the whole store:
 *   - the candidate query is filtered by the marker (`json_extract`) and capped
 *     by `TASK_ARCHIVE_RECONCILE_MAX_TASKS` (default 50) per run,
 *   - the per-candidate archive lookup is a single indexed `LIMIT 1` probe.
 * A backlog larger than the cap converges across startups (each run clears the
 * ones it repaired, so the next run sees the remainder).
 *
 * The whole pass runs under ONE `withExclusiveWrite`: it reads task rows and
 * writes memory rows, the same compound class the completion path serializes.
 * It NEVER throws — a reconciliation failure must not take down startup.
 */
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { logger } from "../utils/logger";
import {
	Q_TABLE_TASKS,
	TABLE_MEMORIES,
	TASK_ARCHIVE_RECONCILE_MAX_TASKS,
	TASK_ARCHIVE_RECONCILE_WINDOW_DAYS,
	TTL_MS_PER_DAY
} from "../utils/constants";
import { archiveTasksToMemory } from "../tools/task.helpers";
import {
	clearTaskArchivePending,
	markTaskArchivePending,
	TASK_ARCHIVE_PENDING_KEY
} from "../utils/task-archive-marker";

/** Outcome of one reconciliation run. */
export interface TaskArchiveReconcileResult {
	/** Tasks carrying the durable archive-pending marker that were examined. */
	scanned: number;
	/** Tasks whose missing archive was written by this run. */
	repaired: number;
	/** Tasks whose archive already existed; marker cleared without a write. */
	alreadyArchived: number;
	/** Tasks still failing to archive (marker kept for the next startup). */
	failed: number;
	/** `true` when the pass was skipped (disabled or unexpected error). */
	skipped: boolean;
	/** Machine-readable skip reason (`error`); absent on a normal run. */
	reason?: string;
}

/** Options for {@link reconcileTaskArchives}. */
export interface TaskArchiveReconcileOptions {
	/** Hard cap on candidates examined per run. Defaults to the env-tuned constant. */
	maxTasks?: number;
	/**
	 * Only consider tasks finished within this many days. Bounds the scan for a
	 * store that accumulated markers long ago; `0` disables the window.
	 */
	windowDays?: number;
	/** Injectable clock for deterministic tests. */
	now?: Date;
}

interface CandidateTask {
	id: string;
	repo: string;
	task_code: string;
}

/**
 * Reads up to `limit` completed tasks carrying the durable archive-pending
 * marker, newest first, optionally restricted to a recency window.
 */
function findPendingArchiveTasks(storage: SQLiteStore, limit: number, cutoff: string | null): CandidateTask[] {
	const params: (string | number)[] = [];
	let sql = `SELECT id, repo, task_code FROM ${Q_TABLE_TASKS}
		WHERE status = 'completed'
		  AND metadata IS NOT NULL
		  AND json_valid(metadata) = 1
		  AND json_extract(metadata, '$.${TASK_ARCHIVE_PENDING_KEY}') IS NOT NULL`;
	if (cutoff) {
		sql += ` AND (finished_at IS NULL OR finished_at >= ?)`;
		params.push(cutoff);
	}
	sql += ` ORDER BY COALESCE(finished_at, updated_at) DESC LIMIT ?`;
	params.push(limit);
	return storage.db.prepare(sql).all(...params) as CandidateTask[];
}

/**
 * Whether any `task_archive` memory already covers `taskId`.
 *
 * Idempotency key: the archive metadata carries `task_id` for a single-task
 * archive and `task_ids` (array) for the TASK-039 aggregated archive. Either
 * match means "already archived" — never write a second one.
 */
function hasTaskArchiveMemory(storage: SQLiteStore, taskId: string): boolean {
	const row = storage.db
		.prepare(
			`SELECT 1 AS found FROM ${TABLE_MEMORIES}
			 WHERE type = 'task_archive'
			   AND json_valid(metadata) = 1
			   AND (
				 json_extract(metadata, '$.task_id') = ?
				 OR EXISTS (
					SELECT 1 FROM json_each(json_extract(metadata, '$.task_ids')) AS t WHERE t.value = ?
				 )
			   )
			 LIMIT 1`
		)
		.get(taskId, taskId) as { found: number } | undefined;
	return row !== undefined;
}

/**
 * Re-archives completed tasks whose durable `archive_pending` marker is set and
 * whose `task_archive` memory is missing. Idempotent, bounded, never throws.
 */
export async function reconcileTaskArchives(
	storage: SQLiteStore,
	vectors: VectorStore,
	options: TaskArchiveReconcileOptions = {}
): Promise<TaskArchiveReconcileResult> {
	const empty: TaskArchiveReconcileResult = {
		scanned: 0,
		repaired: 0,
		alreadyArchived: 0,
		failed: 0,
		skipped: false
	};

	const maxTasks = options.maxTasks ?? TASK_ARCHIVE_RECONCILE_MAX_TASKS;
	if (maxTasks <= 0) return { ...empty, skipped: true };

	const windowDays = options.windowDays ?? TASK_ARCHIVE_RECONCILE_WINDOW_DAYS;
	const now = options.now ?? new Date();
	const cutoff = windowDays > 0 ? new Date(now.getTime() - windowDays * TTL_MS_PER_DAY).toISOString() : null;

	try {
		return await storage.withExclusiveWrite(async () => {
			const candidates = findPendingArchiveTasks(storage, maxTasks, cutoff);
			if (candidates.length === 0) return empty;

			const result: TaskArchiveReconcileResult = { ...empty, scanned: candidates.length };
			// Group by repo so a multi-task repair still coalesces into ONE
			// aggregated archive memory per repo (same shape as the write path).
			const toArchive = new Map<string, CandidateTask[]>();

			for (const candidate of candidates) {
				if (hasTaskArchiveMemory(storage, candidate.id)) {
					// Crash between INSERT and marker clear: the archive exists, so
					// clearing the marker is the whole repair. No second archive.
					clearTaskArchivePending(storage, [candidate.id]);
					result.alreadyArchived++;
					continue;
				}
				const bucket = toArchive.get(candidate.repo) ?? [];
				bucket.push(candidate);
				toArchive.set(candidate.repo, bucket);
			}

			for (const [repo, tasks] of toArchive) {
				const ids = tasks.map((t) => t.id);
				try {
					await archiveTasksToMemory(ids, repo, storage, vectors);
					clearTaskArchivePending(storage, ids);
					result.repaired += ids.length;
				} catch (err) {
					// Keep the marker (already present); the next startup retries.
					markTaskArchivePending(storage, ids, err);
					result.failed += ids.length;
					logger.warn("[TaskArchiveReconcile] Re-archive failed — will retry next startup", {
						repo,
						taskIds: ids,
						error: String(err)
					});
				}
			}

			if (result.repaired > 0 || result.alreadyArchived > 0 || result.failed > 0) {
				logger.info("[TaskArchiveReconcile] Half-archived task reconciliation", {
					scanned: result.scanned,
					repaired: result.repaired,
					alreadyArchived: result.alreadyArchived,
					failed: result.failed
				});
			}

			return result;
		});
	} catch (err) {
		logger.warn("[TaskArchiveReconcile] Reconciliation pass failed — continuing startup", { error: String(err) });
		return { ...empty, skipped: true, reason: "error" };
	}
}

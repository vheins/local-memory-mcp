/**
 * Durable "archive pending" marker for the task→memory archive boundary
 * (FIX-002 / ADR-012).
 *
 * The archive of a completed task is a CROSS-FILE mutation: the task row lives
 * in `tasks.db` while the `task_archive` memory lives in `memory.db` (core).
 * SQLite cannot make that pair atomic, so a failed memory write used to be
 * swallowed (`logger.error`) and the completed task silently ended up with no
 * archive at all — an undetectable, unrecoverable half-state.
 *
 * The marker lives in the task row's existing `metadata` JSON column, i.e. in
 * the SAME file as the completion it belongs to. That makes it as durable as
 * the status change itself and needs no schema change or migration:
 *
 *   - set when an archive attempt fails (`markTaskArchivePending`),
 *   - cleared only after a confirmed archive (`clearTaskArchivePending`),
 *   - read by the startup reconciliation pass
 *     (`services/task-archive-reconcile.ts`), which re-archives idempotently.
 *
 * All helpers are best-effort and never throw: a marker write failure must not
 * mask or replace the archive failure the caller is already reporting.
 */
import { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";
import { BULK_UPDATE_CHUNK_SIZE, Q_TABLE_TASKS } from "./constants";

/** Key under `tasks.metadata` holding the pending-archive marker. */
export const TASK_ARCHIVE_PENDING_KEY = "archive_pending";

/** Shape of the marker stored under {@link TASK_ARCHIVE_PENDING_KEY}. */
export interface TaskArchivePendingMarker {
	/** ISO-8601 timestamp of the failed archive attempt. */
	at: string;
	/** Truncated failure message, for operator diagnosis. */
	error: string;
}

/** Max characters of the failure message persisted in the marker. */
const MARKER_ERROR_MAX_CHARS = 500;

/**
 * Returns a copy of `metadata` without the pending-archive marker.
 *
 * The archive body embeds `original_metadata`; stripping the marker keeps the
 * bookkeeping key out of the durable archive and out of a retry's input.
 */
export function stripTaskArchivePending(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
	if (!metadata || typeof metadata !== "object") return {};
	if (!(TASK_ARCHIVE_PENDING_KEY in metadata)) return metadata;
	const { [TASK_ARCHIVE_PENDING_KEY]: _dropped, ...rest } = metadata;
	return rest;
}

/**
 * Marks every completed task in `taskIds` as archive-pending in ONE statement
 * per chunk (no read-modify-write race: `json_set` is applied inside SQLite).
 *
 * Non-completed or missing ids are left untouched by the `status` guard.
 */
export function markTaskArchivePending(storage: SQLiteStore, taskIds: readonly string[], error: unknown): void {
	if (taskIds.length === 0) return;
	const marker: TaskArchivePendingMarker = {
		at: new Date().toISOString(),
		error: String(error).slice(0, MARKER_ERROR_MAX_CHARS)
	};
	const payload = JSON.stringify(marker);
	const now = new Date().toISOString();

	try {
		for (let i = 0; i < taskIds.length; i += BULK_UPDATE_CHUNK_SIZE) {
			const chunk = taskIds.slice(i, i + BULK_UPDATE_CHUNK_SIZE);
			const placeholders = chunk.map(() => "?").join(",");
			storage.db
				.prepare(
					`UPDATE ${Q_TABLE_TASKS}
					 SET metadata = json_set(
						CASE WHEN metadata IS NULL OR json_valid(metadata) = 0 THEN '{}' ELSE metadata END,
						'$.${TASK_ARCHIVE_PENDING_KEY}', json(?)
					 ), updated_at = ?
					 WHERE id IN (${placeholders}) AND status = 'completed'`
				)
				.run(payload, now, ...chunk);
		}
	} catch (err) {
		logger.warn("[TaskArchiveMarker] Failed to persist archive-pending marker", {
			taskIds,
			error: String(err)
		});
	}
}

/**
 * Clears the pending marker for `taskIds` (ONE statement per chunk). Rows
 * without a marker are not rewritten, so a successful archive costs no write
 * when there was nothing to clear.
 */
export function clearTaskArchivePending(storage: SQLiteStore, taskIds: readonly string[]): void {
	if (taskIds.length === 0) return;
	const now = new Date().toISOString();

	try {
		for (let i = 0; i < taskIds.length; i += BULK_UPDATE_CHUNK_SIZE) {
			const chunk = taskIds.slice(i, i + BULK_UPDATE_CHUNK_SIZE);
			const placeholders = chunk.map(() => "?").join(",");
			storage.db
				.prepare(
					`UPDATE ${Q_TABLE_TASKS}
					 SET metadata = json_remove(metadata, '$.${TASK_ARCHIVE_PENDING_KEY}'), updated_at = ?
					 WHERE id IN (${placeholders})
					   AND metadata IS NOT NULL AND json_valid(metadata) = 1
					   AND json_extract(metadata, '$.${TASK_ARCHIVE_PENDING_KEY}') IS NOT NULL`
				)
				.run(now, ...chunk);
		}
	} catch (err) {
		logger.warn("[TaskArchiveMarker] Failed to clear archive-pending marker", { taskIds, error: String(err) });
	}
}

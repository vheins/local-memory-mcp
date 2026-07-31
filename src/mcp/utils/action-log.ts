/**
 * ActionLogService — unified action-log policy for the whole server.
 *
 * POLICY: action_log INSERTs NEVER acquire the file lock (WriteLock).
 *
 * Rationale:
 * - SQLite is opened with journal_mode=WAL + busy_timeout=30000 (see
 *   storage/sqlite.ts), which already serializes single-row INSERTs safely
 *   across processes. action_log is append-only audit data — a concurrent
 *   INSERT only ever contends for the duration of a WAL commit (µs–ms).
 * - The file lock exists to serialize multi-statement mutations of business
 *   entities (memories, tasks, standards, ...). Taking it just to log a read
 *   would make every READ tool acquire the write lock, violating the
 *   "reads are never locked" contract documented in storage/write-lock.ts.
 *
 * All call sites (native SDK tools/index.ts, upstream router.ts, dashboard
 * controllers) must log through this module so the policy lives in ONE place.
 */

import type { SQLiteStore } from "../storage/sqlite";
import { logger } from "./logger";

export interface ActionLogOptions {
	query?: string;
	response?: string | object;
	memoryId?: string;
	taskId?: string;
	resultCount?: number;
}

export interface ActionLogEntry {
	action: string;
	owner: string;
	repo: string;
	options?: ActionLogOptions;
}

/**
 * Log a single action WITHOUT acquiring the file lock.
 * Never throws: logging must never break the request it audits.
 */
export function logAction(
	db: SQLiteStore,
	action: string,
	owner: string,
	repo: string,
	options?: ActionLogOptions
): void {
	try {
		db.actions.logAction(action, owner, repo, options);
	} catch (err) {
		logger.error("Failed to log action", { action, repo, error: String(err) });
	}
}

/**
 * Log multiple actions atomically (single SQLite transaction), still WITHOUT
 * the file lock. Intended for callers that emit several rows at once.
 */
export function logActions(db: SQLiteStore, entries: ActionLogEntry[]): void {
	if (entries.length === 0) return;
	try {
		db.db.transaction((rows: ActionLogEntry[]) => {
			for (const entry of rows) {
				db.actions.logAction(entry.action, entry.owner, entry.repo, entry.options);
			}
		})(entries);
	} catch (err) {
		logger.error("Failed to log actions (batch)", { count: entries.length, error: String(err) });
	}
}

import { logger } from "../utils/logger";
import { KnowledgeGraphEntity } from "../entities/knowledge-graph";
import { TABLE_MEMORIES, TABLE_ACTION_LOG, TTL_MS_PER_DAY } from "../utils/constants";
import { MEMORY_STATUS_ACTIVE, MEMORY_STATUS_ARCHIVED } from "../types";

export interface PruneActionLogResult {
	/** Number of action_log rows deleted */
	deleted: number;
}

export interface PruneObservationsResult {
	/** Number of observations rows deleted */
	deleted: number;
}

export interface SoulMaintenanceOptions {
	/** Immunity tags — memories with these tags won't decay */
	immunizedTags?: string[];
	/** Days of inactivity before decay starts (default: 7) */
	decayAfterDays?: number;
	/** How much importance drops per decay cycle (default: 0.5) */
	decayRate?: number;
	/** Minimum importance before archiving (default: 1) */
	archiveThreshold?: number;
}

export interface DecayResult {
	/** Number of memories that had importance reduced */
	decayed: number;
	/** Number of memories archived due to dropping below archiveThreshold */
	archived: number;
	/** Number of memories skipped due to immunized tags */
	immunizedSkipped: number;
}

/**
 * Apply biological-style memory decay to active memories.
 *
 * 1. Queries active memories unused for >decayAfterDays
 * 2. Skips memories with immunized tags
 * 3. Decreases importance by decayRate (floored, min 1)
 * 4. Archives memories with importance below archiveThreshold
 *
 * Uses parameterised SQL throughout for safety.
 *
 * @param db - The SQLite store's raw database handle (db.db from SQLiteStore)
 * @param options - Tuning parameters for the decay process
 * @returns Counts of decayed, archived, and immunized-skipped memories
 */
export function applyDecay(
	db: { prepare: (sql: string) => import("better-sqlite3").Statement },
	options?: SoulMaintenanceOptions
): DecayResult {
	const { immunizedTags = [], decayAfterDays = 7, decayRate = 0.5, archiveThreshold = 1 } = options ?? {};

	const now = new Date().toISOString();
	const cutoff = new Date(Date.now() - decayAfterDays * TTL_MS_PER_DAY).toISOString();

	// Step 1: Find active memories that haven't been used recently
	const rows = db
		.prepare(
			`SELECT id, importance, tags FROM ${TABLE_MEMORIES}
       WHERE status = '${MEMORY_STATUS_ACTIVE}'
         AND (last_used_at IS NULL OR last_used_at < ?)`
		)
		.all(cutoff) as Array<{ id: string; importance: number; tags: string | null }>;

	if (rows.length === 0) {
		logger.debug("[SoulMaintenance] No memories eligible for decay");
		return { decayed: 0, archived: 0, immunizedSkipped: 0 };
	}

	let decayed = 0;
	let archivedCount = 0;
	let immunizedSkipped = 0;

	const toDecay: Array<{ id: string; newImportance: number }> = [];
	const toArchive: string[] = [];

	for (const row of rows) {
		let tags: string[] = [];
		if (row.tags) {
			try {
				tags = JSON.parse(row.tags);
			} catch {
				tags = [];
			}
		}

		// Step 2: Skip immunized memories
		if (immunizedTags.length > 0 && tags.some((t) => immunizedTags.includes(t))) {
			immunizedSkipped++;
			continue;
		}

		// Step 3: Decrease importance by decayRate (floored, min 1)
		const newImportance = Math.max(1, Math.floor(row.importance - decayRate));
		toDecay.push({ id: row.id, newImportance });

		// Step 4: Flag for archiving if below threshold
		if (newImportance < archiveThreshold) {
			toArchive.push(row.id);
		}
	}

	// Batch-decay by importance
	if (toDecay.length > 0) {
		const updateStmt = db.prepare(`UPDATE ${TABLE_MEMORIES} SET importance = ?, updated_at = ? WHERE id = ?`);
		for (const item of toDecay) {
			updateStmt.run(item.newImportance, now, item.id);
		}
		decayed = toDecay.length;
	}

	// Archive memories below threshold
	if (toArchive.length > 0) {
		const placeholders = toArchive.map(() => "?").join(",");
		const archiveResult = db
			.prepare(
				`UPDATE ${TABLE_MEMORIES} SET status = '${MEMORY_STATUS_ARCHIVED}', updated_at = ? WHERE id IN (${placeholders})`
			)
			.run(now, ...toArchive);
		archivedCount = archiveResult.changes;
	}

	if (decayed > 0 || archivedCount > 0 || immunizedSkipped > 0) {
		logger.info("[SoulMaintenance] Decay cycle complete", {
			decayed,
			archived: archivedCount,
			immunizedSkipped
		});
	}

	return { decayed, archived: archivedCount, immunizedSkipped };
}

/**
 * Delete action_log entries older than a specified number of days.
 *
 * Action logs accumulate rapidly (one row per MCP call) and serve no purpose
 * beyond recent diagnostics. Stale entries waste disk space and slow down queries.
 *
 * @param db - The SQLite store's raw database handle (db.db from SQLiteStore)
 * @param retentionDays - Entries older than this many days are deleted (default: 30)
 * @returns Number of rows deleted
 */
export function pruneActionLog(
	db: { prepare: (sql: string) => import("better-sqlite3").Statement },
	retentionDays = 30
): PruneActionLogResult {
	const cutoff = new Date(Date.now() - retentionDays * TTL_MS_PER_DAY).toISOString();

	const result = db.prepare(`DELETE FROM ${TABLE_ACTION_LOG} WHERE created_at < ?`).run(cutoff);

	if (result.changes > 0) {
		logger.info("[SoulMaintenance] Pruned stale action_log entries", {
			deleted: result.changes,
			cutoff
		});
	}

	return { deleted: result.changes };
}

/**
 * Delete observations older than a specified number of days.
 *
 * Observations are transient knowledge graph annotations that lose relevance
 * quickly. Stale observations bloat the KG and degrade query performance.
 *
 * @param knowledgeGraph - The KnowledgeGraphEntity (sole encapsulation point
 *   for raw SQL against the KG tables)
 * @param retentionDays - Entries older than this many days are deleted (default: 7)
 * @returns Number of rows deleted
 */
export function pruneObservations(knowledgeGraph: KnowledgeGraphEntity, retentionDays = 7): PruneObservationsResult {
	const cutoff = new Date(Date.now() - retentionDays * TTL_MS_PER_DAY).toISOString();

	const deleted = knowledgeGraph.deleteObservationsOlderThan(cutoff);

	if (deleted > 0) {
		logger.info("[SoulMaintenance] Pruned stale observations", {
			deleted,
			cutoff
		});
	}

	return { deleted };
}

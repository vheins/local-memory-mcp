import { logger } from "../utils/logger";

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
	const cutoff = new Date(Date.now() - decayAfterDays * 24 * 60 * 60 * 1000).toISOString();

	// Step 1: Find active memories that haven't been used recently
	const rows = db
		.prepare(
			`SELECT id, importance, tags FROM memories
       WHERE status = 'active'
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
		const updateStmt = db.prepare("UPDATE memories SET importance = ?, updated_at = ? WHERE id = ?");
		for (const item of toDecay) {
			updateStmt.run(item.newImportance, now, item.id);
		}
		decayed = toDecay.length;
	}

	// Archive memories below threshold
	if (toArchive.length > 0) {
		const placeholders = toArchive.map(() => "?").join(",");
		const archiveResult = db
			.prepare(`UPDATE memories SET status = 'archived', updated_at = ? WHERE id IN (${placeholders})`)
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

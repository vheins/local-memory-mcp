import { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";
import {
	applyDecay,
	pruneActionLog,
	pruneObservations,
	type SoulMaintenanceOptions,
	type DecayResult
} from "./soul-maintenance";

export interface MaintenanceResult {
	decay: DecayResult;
	expiredArchived: number;
	lowScoreArchived: number;
	skipped: boolean;
	prunedActionLogRows: number;
	prunedObservationsRows: number;
}

const MAINTENANCE_OWNER = "__soul__";
const MAINTENANCE_REPO = "__maintenance__";
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check whether maintenance has already run within the configured interval.
 * Stores last-run timestamp in the `memory_summary` table using a sentinel key.
 */
function wasMaintenanceRunRecent(db: SQLiteStore): boolean {
	try {
		const row = db.db
			.prepare("SELECT updated_at FROM memory_summary WHERE owner = ? AND repo = ?")
			.get(MAINTENANCE_OWNER, MAINTENANCE_REPO) as { updated_at: string } | undefined;

		if (!row?.updated_at) return false;

		const lastRun = new Date(row.updated_at).getTime();
		return Date.now() - lastRun < MAINTENANCE_INTERVAL_MS;
	} catch (err) {
		logger.warn("[MaintenanceJob] Failed to check last maintenance time", { error: String(err) });
		return false;
	}
}

/**
 * Record the current timestamp as the last maintenance run time.
 */
function recordMaintenanceRun(db: SQLiteStore): void {
	const now = new Date().toISOString();
	try {
		db.db
			.prepare(
				`INSERT INTO memory_summary (owner, repo, summary, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner, repo) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`
			)
			.run(MAINTENANCE_OWNER, MAINTENANCE_REPO, now, now);
	} catch (err) {
		logger.warn("[MaintenanceJob] Failed to record maintenance run time", { error: String(err) });
	}
}

/**
 * Run startup maintenance: memory decay, expired archiving, and low-score archiving.
 *
 * On subsequent startups, checks if maintenance ran in the last 24 hours.
 * If it did, the job is skipped to avoid redundant work.
 *
 * @param db - The SQLiteStore instance
 * @param decayOptions - Optional decay tuning parameters
 * @returns Results of all maintenance operations
 */
export async function runStartupMaintenance(
	db: SQLiteStore,
	decayOptions?: SoulMaintenanceOptions
): Promise<MaintenanceResult> {
	// Check if maintenance already ran recently
	if (wasMaintenanceRunRecent(db)) {
		logger.info("[MaintenanceJob] Skipping — maintenance already ran within the last 24 hours");
		return {
			decay: { decayed: 0, archived: 0, immunizedSkipped: 0 },
			expiredArchived: 0,
			lowScoreArchived: 0,
			skipped: true,
			prunedActionLogRows: 0,
			prunedObservationsRows: 0
		};
	}

	logger.info("[MaintenanceJob] Starting startup maintenance sweep");

	// 1. Apply biological decay
	const decay = applyDecay(db.db, decayOptions);

	// 2. Archive expired memories (force=true since this is explicitly triggered)
	const expiredArchived = db.memoryArchives.archiveExpiredMemories(true);

	// 3. Archive low-score memories (force=true)
	const lowScoreArchived = db.memoryArchives.archiveLowScoreMemories(true);

	// 4. Prune stale action log entries (30-day retention)
	const prunedActionLogResult = pruneActionLog(db.db, 30);

	// 5. Prune stale observations (7-day retention)
	const prunedObservationsResult = pruneObservations(db.db, 7);

	// Record the maintenance run
	recordMaintenanceRun(db);

	const totalArchived = (expiredArchived || 0) + (lowScoreArchived || 0) + (decay.archived || 0);

	logger.info("[MaintenanceJob] Startup maintenance complete", {
		decayed: decay.decayed,
		immunizedSkipped: decay.immunizedSkipped,
		expiredArchived,
		lowScoreArchived,
		decayArchived: decay.archived,
		totalArchived,
		prunedActionLogRows: prunedActionLogResult.deleted,
		prunedObservationsRows: prunedObservationsResult.deleted
	});

	return {
		decay,
		expiredArchived: expiredArchived || 0,
		lowScoreArchived: lowScoreArchived || 0,
		skipped: false,
		prunedActionLogRows: prunedActionLogResult.deleted,
		prunedObservationsRows: prunedObservationsResult.deleted
	};
}

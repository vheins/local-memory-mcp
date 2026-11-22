import type Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";
import { readPragmaNumber } from "./domain-sql";

/**
 * Pre-flight disk guard for the domain split (ADR-012 / TASK-003).
 *
 * The copy writes new files while `main` still holds every source page, so the
 * volume briefly needs room for both. The guard refuses to start when it cannot
 * find that room, BEFORE the first write: `main` stays untouched and the next
 * startup retries.
 */

/** `:memory:` stores never touch disk, so the space guard is skipped for them. */
export const IN_MEMORY = ":memory:";

/**
 * Free-disk margin on top of the estimated copy size. A fixed safety floor, not a
 * tuning knob: the copy writes new files while `main` still holds every source
 * page, and a volume driven to zero would break the live store too.
 */
const DISK_HEADROOM_MARGIN_BYTES = 16 * 1024 * 1024;

/** Free bytes on the filesystem that holds `dirPath`; degrades OPEN on probe failure. */
function availableDiskBytes(dirPath: string): number {
	try {
		const stats = fs.statfsSync(dirPath);
		return stats.bavail * stats.bsize;
	} catch (err) {
		logger.debug("[DomainMigration] statfs unavailable; assuming ample free disk", {
			dirPath,
			error: String(err)
		});
		return Number.MAX_SAFE_INTEGER;
	}
}

/**
 * Upper bound of the bytes the copy will write, from three O(1) PRAGMAs.
 *
 * `(page_count - freelist_count) * page_size` is the USED size of `main`, which
 * over-estimates the moved tables (the core group stays behind). An exact
 * per-table `dbstat` sum would walk every page of a multi-GB file at startup —
 * not worth it for a pre-flight guard.
 */
function estimateMoveBytes(db: Database.Database): number {
	const pageCount = readPragmaNumber(db, "page_count");
	const pageSize = readPragmaNumber(db, "page_size");
	const freelist = readPragmaNumber(db, "freelist_count");
	return Math.max(0, pageCount - freelist) * pageSize;
}

/**
 * Refuse to start the copy when the target volume cannot hold it.
 *
 * Throws BEFORE any write, so `main` is untouched and the next startup retries.
 * Skipping is not an option: production SQL is schema-qualified, so serving with
 * the move unfinished would read the empty domain tables instead of the complete
 * `main` ones. Failing fast is the only data-safe outcome.
 */
export function assertEnoughDiskSpace(db: Database.Database, memoryDbPath: string, tableCount: number): void {
	if (memoryDbPath === IN_MEMORY) return;

	const estimatedBytes = estimateMoveBytes(db);
	const requiredBytes = estimatedBytes + DISK_HEADROOM_MARGIN_BYTES;
	const dirPath = path.dirname(memoryDbPath);
	const freeBytes = availableDiskBytes(dirPath);

	if (freeBytes < requiredBytes) {
		throw new Error(
			`[DomainMigration] insufficient disk space to split memory.db: need ~${requiredBytes} bytes ` +
				`(copy estimate ${estimatedBytes} + ${DISK_HEADROOM_MARGIN_BYTES} margin) but only ${freeBytes} bytes ` +
				`are free on ${dirPath}. Free space (or point MEMORY_DB_PATH at a larger volume) and restart. ` +
				"Nothing was copied or dropped; the move retries on the next startup."
		);
	}

	logger.info("[DomainMigration] disk headroom for the split is sufficient", {
		dirPath,
		freeBytes,
		requiredBytes,
		estimatedCopyBytes: estimatedBytes,
		tableCount
	});
}

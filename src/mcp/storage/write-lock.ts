/**
 * File-based write lock for SQLite concurrent access protection.
 *
 * Uses proper-lockfile to ensure only one process writes to the DB at a time.
 * Reads are never locked — only writes acquire the lock.
 */
import lockfile from "proper-lockfile";
import path from "path";
import fs from "fs";

const LOCK_STALE_MS = 30_000; // consider lock stale after 30s (handles crashed processes)
const LOCK_RETRY_DELAY_MS = 200;
const LOCK_RETRY_COUNT = 250; // 250 * 200ms = 50s max wait

export class WriteLock {
	private lockTarget: string;
	private locked = false;

	constructor(dbPath: string) {
		// Lock file is placed next to the DB
		this.lockTarget = dbPath;
		// proper-lockfile requires the target file to exist
		if (!fs.existsSync(dbPath)) {
			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
			fs.writeFileSync(dbPath, "");
		}
	}

	/**
	 * Acquire the write lock. Waits up to 15s for other processes to release.
	 */
	async acquire(): Promise<void> {
		await lockfile.lock(this.lockTarget, {
			stale: LOCK_STALE_MS,
			retries: {
				retries: LOCK_RETRY_COUNT,
				minTimeout: LOCK_RETRY_DELAY_MS,
				maxTimeout: LOCK_RETRY_DELAY_MS,
			},
			realpath: false,
		});
		this.locked = true;
	}

	/**
	 * Release the write lock.
	 */
	async release(): Promise<void> {
		if (!this.locked) return;
		try {
			await lockfile.unlock(this.lockTarget, { realpath: false });
		} catch {
			// Ignore unlock errors (lock may have already expired)
		}
		this.locked = false;
	}

	/**
	 * Run a synchronous write function under the lock.
	 * Guarantees lock is always released, even on error.
	 */
	async withLock<T>(fn: () => T): Promise<T> {
		await this.acquire();
		try {
			return fn();
		} finally {
			await this.release();
		}
	}

	/**
	 * Check if a lock file exists (another process may be writing).
	 */
	isLocked(): boolean {
		return lockfile.checkSync(this.lockTarget, { realpath: false });
	}
}

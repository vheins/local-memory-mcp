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
	/**
	 * Intra-process acquisition queue: resolves when the previous withLock
	 * section (acquire → fn → release) fully completes. Serializes concurrent
	 * non-reentrant acquisitions so only one holder proceeds (TASK-064).
	 */
	private tail: Promise<unknown> = Promise.resolve();

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
				maxTimeout: LOCK_RETRY_DELAY_MS
			},
			realpath: false
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
	 *
	 * Reentrant: if this process already holds the lock (e.g., the router wraps
	 * the whole tool call in withWrite and a handler also wraps its archival in
	 * withWrite), the inner call runs directly — the outer withLock keeps the
	 * lock held until it resolves, so there is exactly one acquire/release pair
	 * per outermost call. proper-lockfile is NOT reentrant, so without this
	 * guard a nested withWrite would self-deadlock until the stale timeout.
	 *
	 * Concurrent-safe (TASK-064 / MEM-475): two withLock calls racing before the
	 * first acquire resolves both used to see `locked === false` and each start
	 * their own proper-lockfile acquisition — one would win and the other would
	 * burn the full 50s retry window and throw ELOCKED. All non-inline
	 * acquisitions are therefore serialized through a promise chain (`tail`):
	 * each caller waits for the previous acquire→fn→release section to fully
	 * finish before it starts its own, so exactly one holder proceeds.
	 */
	async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
		if (this.locked) {
			// We already hold the lock — run inline under the outer acquisition.
			return await fn();
		}

		const run = async (): Promise<T> => {
			await this.acquire();
			try {
				return await fn();
			} finally {
				await this.release();
			}
		};

		const result = this.tail.then(run);
		// Keep the chain alive on errors so a failed section never wedges
		// subsequent callers; the caller still observes the rejection via
		// `result`.
		this.tail = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}

	/**
	 * Check if a lock file exists (another process may be writing).
	 */
	isLocked(): boolean {
		return lockfile.checkSync(this.lockTarget, { realpath: false });
	}
}

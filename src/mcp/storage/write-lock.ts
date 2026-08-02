/**
 * Write mutual exclusion for the SQLite store.
 *
 * OPT-PERF-09: SQLite already provides single-writer mutual exclusion via
 * BEGIN IMMEDIATE transactions (base.ts) + busy_timeout (sqlite.ts). A
 * full proper-lockfile acquire/release (fs ops) per write call — serialized
 * through an intra-process promise chain — was redundant overhead on every
 * write path.
 *
 * Mutual exclusion is now split in two:
 *
 *   - `withLock()`  → FAST path. Runs the body inline with NO proper-lockfile
 *     and NO promise chain. Every individual mutation is an atomic BEGIN
 *     IMMEDIATE transaction; better-sqlite3 is synchronous, so a transaction
 *     can never span an await and concurrent calls cannot interleave
 *     mid-transaction. SQLite's own single-writer protocol + busy_timeout
 *     excludes concurrent writers (same process or cross-process).
 *
 *   - `withExclusiveLock()` → PROPER-LOCKFILE path. Kept for genuinely
 *     cross-process COMPOUND mutations: multi-transaction sequences (a body
 *     of several `db.transaction(...).immediate()` calls) that must not
 *     interleave with another process's sequence. Examples: the maintenance
 *     sweep, codebase indexing writer, and task→memory archival.
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
	 * Intra-process acquisition queue for the EXCLUSIVE path: resolves when
	 * the previous withExclusiveLock section (acquire → fn → release) fully
	 * completes. Serializes concurrent non-reentrant acquisitions so only one
	 * holder proceeds (TASK-064). proper-lockfile is not reentrant and two
	 * racing acquisitions would otherwise burn the full 50s retry window and
	 * throw ELOCKED.
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
	 * Run a write synchronously WITHOUT acquiring a proper-lockfile.
	 *
	 * This is the default write path (SQLiteStore.withWrite / tool router /
	 * dashboard services). Mutual exclusion is provided by SQLite's BEGIN
	 * IMMEDIATE + busy_timeout (base.ts / sqlite.ts) — every mutation is an
	 * atomic synchronous transaction, so there is nothing for a file lock to
	 * add on a single-transaction write.
	 *
	 * Reentrant by construction: there is no lock state to re-enter; nested
	 * withWrite calls just run their bodies inline.
	 */
	async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
		return await fn();
	}

	/**
	 * Run a COMPOUND write sequence under the proper-lockfile.
	 *
	 * Reserves this for genuinely cross-process compound mutations — a body
	 * that performs MULTIPLE BEGIN IMMEDIATE transactions which must not
	 * interleave with another process's same-class sequence (maintenance
	 * sweep, indexing writer batches, task→memory archival). Each such
	 * section pays one acquire/release pair.
	 *
	 * Reentrant: if this process already holds the exclusive lock, the inner
	 * call runs directly — the outer withExclusiveLock keeps it held until it
	 * resolves (proper-lockfile is NOT reentrant).
	 *
	 * Concurrent-safe (TASK-064 / MEM-475): racing acquisitions are serialized
	 * through the `tail` promise chain so exactly one proceeds.
	 */
	async withExclusiveLock<T>(fn: () => Promise<T> | T): Promise<T> {
		if (this.locked) {
			// We already hold the exclusive lock — run inline.
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
	 * Acquire the exclusive proper-lockfile. Waits up to 50s for other
	 * processes to release.
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
	 * Release the exclusive proper-lockfile.
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
	 * Check if a lock file exists (another process may be writing).
	 */
	isLocked(): boolean {
		return lockfile.checkSync(this.lockTarget, { realpath: false });
	}
}

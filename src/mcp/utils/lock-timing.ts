/**
 * Staleness contract for the cross-process write lock (`<db>.lock`).
 *
 * Two sides must agree on this number or the probe lies:
 *
 *   - the HOLDER (`WriteLock.acquire`, `src/mcp/storage/write-lock.ts`) hands it
 *     to proper-lockfile, which refreshes the lock mtime every `stale / 2`
 *     (15s here) and treats an older mtime as abandoned by a crashed process;
 *   - the PROBE (`isDbWriteLockHeld`, `src/mcp/cli/dashboard-takeover.ts`) asks
 *     `checkSync` whether the lock is held, and `checkSync` answers "held" only
 *     when the mtime is within the SAME threshold (`!isLockStale`).
 *
 * Probing with a smaller value reports a LIVE lock as free for most of the
 * refresh window (a 2s threshold misses 13 of every 15 seconds), which silently
 * turns every pre-kill fail-fast back into the second-writer stall.
 *
 * Leaf module on purpose: no imports, so the dashboard entry point can load the
 * probe before any store exists.
 */
export const LOCK_STALE_MS = 30_000;

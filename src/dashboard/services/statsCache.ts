/**
 * OPT-PERF-06 (TASK-202): TTL cache for repo-scoped dashboard stats.
 *
 * GET /api/stats?repo=… recomputes `SystemEntity.getDashboardStats` on every
 * repo select/refresh — 16+ aggregate queries per call, even though those
 * aggregates are invariant between mutations. This module adds a short
 * server-side TTL (default 30 s, configurable via `DASHBOARD_STATS_TTL_MS`) so
 * repeated selects within the window are served from memory instead of
 * re-aggregating.
 *
 * STALENESS: stats may be up to `ttlMs` stale after a mutation — accepted
 * trade-off for a dashboard overview. Write mutations span many MCP tools, so
 * TTL expiry (not per-mutation invalidation) is the safe low-risk strategy.
 *
 * The TTL is read lazily from the environment so tests can shrink it per case;
 * production sets `DASHBOARD_STATS_TTL_MS` once at process start.
 */

interface CacheEntry {
	data: unknown;
	expiresAt: number;
}

/** Keyed by `${owner}/${repo}` — one entry per repo the dashboard has selected. */
const cache = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 30_000;

/** Upper bound on cached repos — a dashboard holds a handful; this only guards
 * against unbounded growth from arbitrary `repo` query params. */
const MAX_ENTRIES = 200;

function ttlMs(): number {
	const raw = Number(process.env.DASHBOARD_STATS_TTL_MS);
	return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS;
}

function keyFor(owner: string, repo: string): string {
	return `${owner}/${repo}`;
}

/** Returns the cached payload for `owner/repo`, or `undefined` on miss/expiry. */
export function getCachedRepoStats<T>(owner: string, repo: string): T | undefined {
	const entry = cache.get(keyFor(owner, repo));
	if (!entry) return undefined;
	if (Date.now() >= entry.expiresAt) {
		cache.delete(keyFor(owner, repo));
		return undefined;
	}
	return entry.data as T;
}

/** Stores `data` under `owner/repo` with a fresh TTL and returns it. */
export function setCachedRepoStats<T>(owner: string, repo: string, data: T): T {
	// Guard against unbounded growth: drop expired entries first, then the
	// oldest entries (Map preserves insertion order) if still over the cap.
	if (cache.size >= MAX_ENTRIES) {
		for (const [key, entry] of cache) {
			if (Date.now() >= entry.expiresAt) cache.delete(key);
		}
		while (cache.size >= MAX_ENTRIES) {
			const oldest = cache.keys().next().value;
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
	}
	cache.set(keyFor(owner, repo), { data, expiresAt: Date.now() + ttlMs() });
	return data;
}

/** Test hook: drop all cached entries so the next read recomputes. */
export function clearRepoStatsCache(): void {
	cache.clear();
}

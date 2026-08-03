/**
 * Shared chunking utility (OPT-PERF-11).
 *
 * Every bulk SQL path that binds an `IN (...)` list chunks its inputs at
 * BULK_UPDATE_CHUNK_SIZE (500) — a single un-chunked statement would exceed
 * SQLite's bound-variable limit (~999 default, 32766 with
 * SQLITE_MAX_VARIABLE_NUMBER) and abort with "too many SQL variables"
 * (TASK-139). This helper is the single home of that iteration shape so the
 * 500-chunk invariant lives in one place instead of being re-implemented in
 * every entity loop.
 */

export function chunksOf<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

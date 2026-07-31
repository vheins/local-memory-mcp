/**
 * indexing-staleness — staleness check and index status helpers.
 *
 * Contains:
 *   - checkStaleness() — compare file mtimes against last_indexed_at
 *   - getIndexStatus()  — current index status (file/symbol counts, staleness)
 *   - IndexStatus interface
 *
 * Does NOT import from indexing-service.ts (no circular dependency).
 */

import type { SQLiteStore } from "../../storage/sqlite.js";

// Re-export types and functions from cache layer
import { indexingRepos, checkRepoStaleness, getLastIndexedAt, type StalenessResult } from "./indexing-cache.js";

// Re-export for consumers (also re-exported by indexing-service)
export type { StalenessResult } from "./indexing-cache.js";

// ── IndexStatus interface ──────────────────────────────────────────────

export interface IndexStatus {
	repo: string;
	isIndexed: boolean;
	isIndexing: boolean;
	lastIndexedAt: string | null;
	totalFiles: number;
	totalSymbols: number;
	progress: IndexProgress | null;
	/** Whether the index has become stale (>= 5% of files changed since last index). Only set when repoPath is provided. */
	stale?: boolean;
	/** Ratio of stale files to total indexed files (0-1). Only set when repoPath is provided. */
	staleRatio?: number;
}

export interface IndexProgress {
	stage: "discovering" | "parsing" | "storing" | "cleaning";
	current: number;
	total: number;
	message: string;
}

// ── Staleness helpers ──────────────────────────────────────────────────

/**
 * Check whether a repo's index is stale by comparing file mtimes against
 * their last_indexed_at timestamps. Delegates to indexing-cache.
 *
 * Live (uncached) on purpose (FIX-14): `checkStaleness` is the pre-index
 * decision — a stale=false served from the 30s TTL cache after a file
 * change would suppress re-indexing. Caching is reserved for the
 * user-facing `getIndexStatus` path only (TASK-018).
 */
export async function checkStaleness(db: SQLiteStore, repo: string, repoPath: string): Promise<StalenessResult> {
	return checkRepoStaleness(db, repo, repoPath);
}

/**
 * Get the current index status for a repo, optionally computing staleness.
 */
export async function getIndexStatus(db: SQLiteStore, repo: string, repoPath?: string): Promise<IndexStatus> {
	const totalFiles = db.codebaseFiles.getFileCountByRepo(repo);

	const totalSymbols = db.codebaseSymbols.getSymbolCountByRepo(repo);

	const lastIndexedAt = getLastIndexedAt(db, repo);

	const base: IndexStatus = {
		repo,
		isIndexed: totalFiles > 0,
		isIndexing: indexingRepos.has(repo),
		lastIndexedAt,
		totalFiles,
		totalSymbols,
		progress: null
	};

	// Only compute staleness if repoPath is provided AND the repo has been indexed
	if (repoPath && totalFiles > 0) {
		// User-facing index_status — TTL-cached within INDEX_STALENESS_TTL_MS
		// (TASK-018). The live path is `checkStaleness` (FIX-14).
		const staleness = await checkRepoStaleness(db, repo, repoPath, { useCache: true });
		base.stale = staleness.stale;
		base.staleRatio = staleness.staleRatio;
	}

	return base;
}

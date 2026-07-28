/**
 * Indexing cache — progress tracking, staleness checking, and utility helpers.
 *
 * Manages the module-level indexing guard Set, provides standalone staleness
 * and freshness checking functions, and holds shared helper utilities
 * (SHA-256 checksums, error classification, retry logic).
 *
 * This module has no dependency on the indexing orchestrator, making it
 * safe to import from indexing-service.ts without circular deps.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { CodebaseFile } from "../../types/codebase-file.js";
import { logger } from "../../utils/logger.js";

// ── Module-level indexing guard ───────────────────────────────────────

/**
 * Tracks repos currently being indexed.
 * Shared across auto-index and manual `indexRepository` calls so they
 * can detect each other and prevent concurrent indexing of the same repo.
 */
export const indexingRepos = new Set<string>();

/**
 * Clear the module-level indexing guard.
 * Primarily used in test teardown to release locks between test runs.
 */
export function clearIndexingRepos(): void {
	indexingRepos.clear();
}

// ── SHA-256 helpers ───────────────────────────────────────────────────

export function computeChecksum(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/** Count lines in a string (LF-normalized, non-empty final line counts). */
export function countLines(content: string): number {
	if (!content) return 0;
	return content.split("\n").length;
}

// ── Error classification helpers ───────────────────────────────────────

/**
 * Detect permission-denied errors from Node.js `ErrnoException` codes
 * or message patterns. Matches EACCES, EPERM, and their Windows equivalents.
 */
export function isPermissionError(err: unknown): boolean {
	if (typeof err === "object" && err !== null && "code" in err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EACCES" || code === "EPERM") return true;
	}
	const message = err instanceof Error ? err.message : String(err);
	return /permission denied|access denied|EACCES|EPERM/i.test(message);
}

/**
 * Detect parser timeout errors. Tree-sitter timeouts are raised via
 * Promise.race in ParserPool with a "Parse timeout after" message.
 */
export function isTimeoutError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /timeout/i.test(message);
}

/**
 * Retry a database write operation with lock-aware backoff.
 *
 * - Lock-related errors (file already held by another process):
 *   3 retries with exponential backoff (1s, 2s, 4s). proper-lockfile already
 *   retries internally for ~50s before surfacing, so these additional retries
 *   act as a safety net for edge cases.
 * - Other errors (e.g. SQL constraints): single retry at 100ms (current behavior).
 */
export async function retryDbWrite<T>(fn: () => Promise<T>, context: string): Promise<T> {
	const MAX_LOCK_RETRIES = 3;
	const INITIAL_LOCK_BACKOFF_MS = 1000;

	try {
		return await fn();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const isLockRelated = /lock/i.test(message) || /already being held/i.test(message) || /EBUSY/i.test(message);

		if (isLockRelated) {
			logger.warn("[IndexingService] Lock contention detected — retrying with backoff", {
				context,
				error: message
			});
			let lastError = err;
			for (let attempt = 1; attempt <= MAX_LOCK_RETRIES; attempt++) {
				const delay = INITIAL_LOCK_BACKOFF_MS * Math.pow(2, attempt - 1);
				await new Promise((resolve) => setTimeout(resolve, delay));
				try {
					return await fn();
				} catch (retryErr) {
					lastError = retryErr;
					const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
					logger.warn("[IndexingService] Lock retry attempt failed", {
						context,
						attempt,
						maxRetries: MAX_LOCK_RETRIES,
						delayMs: delay,
						error: retryMsg
					});
				}
			}
			logger.error("[IndexingService] All lock retries exhausted", {
				context,
				attempts: MAX_LOCK_RETRIES,
				error: message
			});
			throw lastError;
		}

		// Non-lock errors: single simple retry (preserves existing behavior)
		logger.warn("[IndexingService] DB write failed — retrying once", {
			context,
			error: message
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		try {
			return await fn();
		} catch (retryErr) {
			const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
			logger.error("[IndexingService] DB write retry failed", {
				context,
				error: retryMessage
			});
			throw retryErr;
		}
	}
}

// ── Constants ─────────────────────────────────────────────────────────

export const DEFAULT_BATCH_SIZE = 100;

// ── Private type for file categorization ──────────────────────────────

export type FilePlan =
	| { action: "skip"; filePath: string }
	| {
			action: "parse";
			filePath: string;
			absolutePath: string;
			language: string;
			sizeBytes: number;
	  };

// ── Staleness checking ────────────────────────────────────────────────

export interface StalenessResult {
	stale: boolean;
	staleFiles: number;
	totalFiles: number;
	staleRatio: number;
	lastIndexedAt: string | null;
}

/**
 * Check whether a repo's index is stale by comparing file mtimes against
 * their last_indexed_at timestamps.
 *
 * A file is considered stale if:
 *   - Its mtime is newer than its last_indexed_at, OR
 *   - The file no longer exists on disk (was deleted)
 *
 * The repo is marked stale only if >= 5% of indexed files have changed.
 */
export async function checkRepoStaleness(db: SQLiteStore, repo: string, repoPath: string): Promise<StalenessResult> {
	const existingFiles = db.codebaseFiles.getFilesByRepo(repo);
	const totalFiles = existingFiles.length;

	// Nothing indexed yet — no basis for staleness comparison
	if (totalFiles === 0) {
		return {
			stale: false,
			staleFiles: 0,
			totalFiles: 0,
			staleRatio: 0,
			lastIndexedAt: null
		};
	}

	const resolvedPath = path.resolve(repoPath);
	let staleCount = 0;
	let maxLastIndexedAt: Date | null = null;

	for (const f of existingFiles) {
		// Track max last_indexed_at across all files
		const fileTime = f.last_indexed_at ? new Date(f.last_indexed_at) : null;
		if (fileTime && (!maxLastIndexedAt || fileTime > maxLastIndexedAt)) {
			maxLastIndexedAt = fileTime;
		}

		const fullPath = path.join(resolvedPath, f.file_path);
		try {
			const stat = fs.statSync(fullPath);
			const indexedTime = fileTime ? fileTime.getTime() : 0;
			// File mtime newer than when it was last indexed → stale
			if (stat.mtimeMs > indexedTime) {
				staleCount++;
			}
		} catch {
			// File no longer exists on disk → stale
			staleCount++;
		}
	}

	const staleRatio = Math.round((staleCount / totalFiles) * 1000) / 1000;
	const lastIndexedAt = maxLastIndexedAt?.toISOString() ?? null;

	return {
		// Mark repo stale only if >= 5% of indexed files have changed
		stale: staleRatio >= 0.05,
		staleFiles: staleCount,
		totalFiles,
		staleRatio,
		lastIndexedAt
	};
}

// ── Freshness check (extracted from autoIndexIfStale) ──────────────────

export interface FreshnessResult {
	stale: boolean;
	maxIndexedAt: Date | null;
	elapsedMs: number;
	ttlMs: number;
}

/**
 * Determine whether an existing index is still "fresh" based on the most
 * recent last_indexed_at timestamp and the configured TTL.
 *
 * @returns FreshnessResult with stale=true if the index TTL has expired
 *   or there is no index (existingFiles is empty).
 */
export function getIndexFreshness(existingFiles: CodebaseFile[], ttlMs: number): FreshnessResult {
	if (existingFiles.length === 0) {
		return {
			stale: true,
			maxIndexedAt: null,
			elapsedMs: 0,
			ttlMs
		};
	}

	// Find the most recent last_indexed_at across all files
	let maxIndexedAt: Date | null = null;
	for (const f of existingFiles) {
		const t = f.last_indexed_at ? new Date(f.last_indexed_at) : null;
		if (t && (!maxIndexedAt || t > maxIndexedAt)) {
			maxIndexedAt = t;
		}
	}

	if (!maxIndexedAt) {
		return {
			stale: true,
			maxIndexedAt: null,
			elapsedMs: 0,
			ttlMs
		};
	}

	const elapsedMs = Date.now() - maxIndexedAt.getTime();
	return {
		stale: elapsedMs >= ttlMs,
		maxIndexedAt,
		elapsedMs,
		ttlMs
	};
}

/**
 * Bounded, process-shared caches for the DUPLICATES analysis (FEAT-001,
 * FIX-022). Split from `duplicates.ts` (file-size limit).
 *
 * Cache identity rules — the analysis reads symbol bodies FROM DISK, so a key
 * must pin everything the body depends on:
 *
 * - the resolved repo ROOT (one repo name can be registered against different
 *   roots, and their file contents differ),
 * - the thresholds and the `limit`,
 * - a digest over every candidate's `id:source_fingerprint` (the index's
 *   SHA-256 of the symbol's raw source range).
 *
 * A candidate set with any NULL `source_fingerprint` cannot prove freshness
 * (the digest would carry only its id), so it is never cached and never served
 * from cache.
 */

import { createHash } from "node:crypto";
import type { DuplicateCandidateRow } from "../../types/codebase-symbol";
import type { NormalizedSymbolBody } from "./duplicates-normalize";
import type { DuplicateAnalysisResult } from "./duplicates";

/** One symbol's normalized body plus the row it came from. */
export interface DerivedSymbol extends NormalizedSymbolBody {
	symbol: DuplicateCandidateRow;
	language: string | null;
	lines: number;
}

/** Derived-body cache entry: keyed by repo root + symbol id + fingerprint + language. */
export const derivedCache = new Map<string, DerivedSymbol>();
/** Whole-analysis result cache entry, keyed by repo + root + thresholds + fingerprint digest. */
export const analysisCache = new Map<string, DuplicateAnalysisResult>();

/** Cache key for one symbol's derived body. */
export function derivedCacheKey(symbol: DuplicateCandidateRow, language: string | null, repoRoot: string): string {
	// Root first: a derived body is a function of the file content AT that root,
	// so the same symbol id + fingerprint under a different root is a different
	// entry (FIX-022).
	return `${repoRoot}\u0000${symbol.id}\u0000${symbol.source_fingerprint ?? ""}\u0000${language ?? ""}`;
}

/** Insert into a bounded LRU map, evicting the oldest entry past `cap`. */
export function lruSet<V>(map: Map<string, V>, key: string, value: V, cap: number): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > cap) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

/**
 * Digest over every candidate's `id:source_fingerprint` (sorted by id), so an
 * analysis cache key changes exactly when the indexed source of a candidate
 * changes. Only meaningful when every candidate HAS a fingerprint — see
 * {@link canProveFreshness}.
 */
export function fingerprintDigest(symbols: DuplicateCandidateRow[]): string {
	const hash = createHash("sha256");
	const rows = [...symbols].sort((a, b) => a.id.localeCompare(b.id));
	for (const row of rows) hash.update(`${row.id}:${row.source_fingerprint ?? ""}\n`);
	return hash.digest("hex");
}

/**
 * A fingerprint digest can only prove freshness when every candidate carries
 * one. A NULL `source_fingerprint` (the column is nullable) would contribute
 * only its id, so file content could change without changing the key — such a
 * candidate set must never reuse OR store a cached analysis.
 */
export function canProveFreshness(symbols: DuplicateCandidateRow[]): boolean {
	return symbols.every(
		(symbol) => typeof symbol.source_fingerprint === "string" && symbol.source_fingerprint.length > 0
	);
}

/**
 * Build the whole-analysis cache key. Includes the resolved repo root because
 * the analysis reads bodies from disk at that root: one repo name can be
 * registered against different roots, and their file contents differ.
 */
export function buildAnalysisCacheKey(
	repo: string,
	repoRoot: string,
	symbols: DuplicateCandidateRow[],
	minSimilarity: number,
	minLines: number,
	limit: number
): string {
	return `${repo}|${repoRoot}|${minSimilarity}|${minLines}|${limit}|${fingerprintDigest(symbols)}`;
}

/** Clear both caches (tests / operations). */
export function clearDuplicatesCaches(): void {
	derivedCache.clear();
	analysisCache.clear();
}

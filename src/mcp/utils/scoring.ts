/**
 * Shared hybrid scoring utilities (SPEC-001) used by the memory-read,
 * task-read, and standard-read search engines.
 *
 * Single scorer: final = similarity·w_sim + keyword·w_kw + recency·w_rec + domain·w_dom
 * with per-entity weights configurable via {@link HybridWeights}.
 *
 * NOTE (intentional divergence): agent-context deliberately does NOT use this
 * scorer — it ranks context memories by vector + importance (see
 * AGENT_CONTEXT_BLEND in tools/agent-context.ts).
 */

import { HYBRID_WEIGHTS, RECENCY_HALF_LIFE_MS } from "./constants";

export { HYBRID_WEIGHTS, RECENCY_HALF_LIFE_MS };

export interface HybridWeights {
	readonly similarity: number;
	readonly keyword: number;
	readonly recency: number;
	readonly domain: number;
}

export interface HybridScores {
	similarity: number;
	keyword: number;
	recency: number;
	domain: number;
}

/**
 * Weighted blend of the four hybrid signals. All three search engines compute
 * their final score through this function with the SPEC-001 weights.
 */
export function scoreHybrid<T extends HybridScores>(scores: T, weights: HybridWeights = HYBRID_WEIGHTS): number {
	return (
		scores.similarity * weights.similarity +
		scores.keyword * weights.keyword +
		scores.recency * weights.recency +
		scores.domain * weights.domain
	);
}

/**
 * Exponential recency decay: 1 for brand-new entries, halving every
 * `halfLifeMs` (default 30 days). Shared by memory-read and task-read.
 */
export function computeRecencyScore(createdAt: string, halfLifeMs: number = RECENCY_HALF_LIFE_MS): number {
	const ageMs = Date.now() - new Date(createdAt).getTime();
	if (ageMs <= 0) return 1;
	return Math.max(0, Math.min(1, Math.pow(2, -ageMs / halfLifeMs)));
}

/**
 * Term-overlap count between normalized query terms and a list of searchable
 * tokens (e.g. memory tags). Used as the base of domain scoring.
 */
export function countTermOverlap(queryTerms: string[], searchable: string[]): number {
	if (queryTerms.length === 0 || searchable.length === 0) return 0;
	const querySet = new Set(queryTerms.map((t: string) => t.toLowerCase()));
	return searchable.filter((t: string) => querySet.has(t.toLowerCase())).length;
}

/**
 * Domain score as a ratio of matching searchable items (e.g. tags) over the
 * total searchable items. Returns 0 when there is nothing to match against.
 */
export function computeDomainScore(queryTerms: string[], searchable: string[]): number {
	if (queryTerms.length === 0 || searchable.length === 0) return 0;
	return countTermOverlap(queryTerms, searchable) / Math.max(searchable.length, 1);
}

/**
 * Adaptive threshold filter (SPEC-001): small candidate sets use the lenient
 * threshold so sparse corpora still return results; larger sets use the
 * stricter one. Returns whether the score clears the threshold.
 */
export function applyThreshold(
	score: number,
	candidateCount: number,
	thresholds: { smallSet: number; largeSet: number }
): boolean {
	const threshold = candidateCount <= 5 ? thresholds.smallSet : thresholds.largeSet;
	return score >= threshold;
}

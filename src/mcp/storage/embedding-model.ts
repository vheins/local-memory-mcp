/**
 * Embedding-model identity (PERF-003).
 *
 * The startup backfill must re-embed a vector when the embedding MODEL
 * changed, not only when the entity content changed. This module is the single
 * source of truth for the model name AND a stable integer `model_version`
 * stamped onto every `*_vectors` row, so the backfill can compare a vector's
 * stored version against the current one.
 *
 * `RealVectorStore` embeds with `EMBEDDING_MODEL_NAME` (Xenova/all-MiniLM-L6-v2,
 * 384-dim). The version is a deterministic 32-bit FNV-1a hash of that name, so
 * it is:
 *   - STABLE across restarts (same name → same integer), and
 *   - automatically bumped when the model name changes, which is exactly the
 *     signal that forces a full re-embed.
 *
 * PERF-004: promote `EMBEDDING_MODEL_NAME` / `currentEmbeddingModelVersion()`
 * to a shared, versioned constant and define the explicit model-upgrade
 * procedure (e.g. bump on any weight/tokenizer change even at an unchanged
 * name). Until then this derived value is the canonical version.
 */

/** Canonical embedding-model name (matches `RealVectorStore`'s pipeline id). */
export const EMBEDDING_MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

/**
 * Deterministic 32-bit FNV-1a hash of a string, coerced to a positive int.
 * Pure + allocation-free; collisions are irrelevant here (a collision only
 * means a model swap with an identical 32-bit hash would be missed, which is
 * astronomically unlikely and corrected by PERF-004's explicit constant).
 */
function fnv1a32(value: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		// 32-bit FNV prime multiply via shifts to stay in int32 range.
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Stable integer version of the current embedding model. Persisted as
 * `model_version` on every vector row; the backfill re-embeds when a stored
 * value differs.
 */
export function currentEmbeddingModelVersion(): number {
	return fnv1a32(EMBEDDING_MODEL_NAME);
}

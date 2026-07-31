// Vector computation & similarity utilities shared across entities and stores.
// Single source of truth for TF frequency vectors, cosine similarity, and the
// in-memory TF vector cache used by similarity searches.

import { tokenize } from "./normalize";

/**
 * Build a term-frequency vector from raw text.
 *
 * Tokenizes via the shared normalizer (lowercase; keeps alphanumeric plus
 * underscore/hyphen/dot; strips stopwords) and counts token occurrences.
 * Returns a sparse Record keyed by token.
 */
export function computeVector(text: string): Record<string, number> {
	const tokens = tokenize(text);
	const vector: Record<string, number> = {};
	tokens.forEach((token) => {
		vector[token] = (vector[token] || 0) + 1;
	});
	return vector;
}

/**
 * Cosine similarity between two sparse term-frequency vectors.
 * Returns 0 when either vector is empty.
 */
export function cosineSimilarity(v1: Record<string, number>, v2: Record<string, number>): number {
	const keys1 = Object.keys(v1);
	const keys2 = Object.keys(v2);
	if (!keys1.length || !keys2.length) return 0;

	let dotProduct = 0;
	for (const key of keys1) {
		if (v2[key]) dotProduct += v1[key] * v2[key];
	}

	let mag1 = 0;
	for (const key of keys1) mag1 += v1[key] * v1[key];

	let mag2 = 0;
	for (const key of keys2) mag2 += v2[key] * v2[key];

	const mag = Math.sqrt(mag1) * Math.sqrt(mag2);
	return mag === 0 ? 0 : dotProduct / mag;
}

/**
 * Cosine similarity between two dense equal-length vectors (e.g. fixed-dim
 * model embeddings). Returns 0 when lengths differ or either vector has zero
 * norm. Identical math to {@link cosineSimilarity} but for positional arrays.
 */
export function cosineSimilarityArrays(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	const dot = a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
	const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
	const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
	if (magA === 0 || magB === 0) return 0;
	return dot / (magA * magB);
}

export interface TfVectorCache {
	/**
	 * Return the cached term-frequency vector for `id`, recomputing from
	 * `text` when the entry is absent or `updatedAt` differs.
	 */
	get(id: string, text: string, updatedAt: string | null): Record<string, number>;
}

/**
 * Create an in-memory TF vector cache keyed by entity id and validated
 * against the row's `updated_at`. Because freshness is checked against the
 * DB value on every read, the cache self-invalidates on writes without any
 * write-path hooks. When the entry cap is reached the cache is cleared to
 * bound memory usage.
 */
export function createTfVectorCache(maxEntries = 1024): TfVectorCache {
	const cache = new Map<string, { vector: Record<string, number>; updatedAt: string | null }>();
	return {
		get(id, text, updatedAt) {
			const cached = cache.get(id);
			if (cached && cached.updatedAt === updatedAt) return cached.vector;
			const vector = computeVector(text);
			if (cache.size >= maxEntries) cache.clear();
			cache.set(id, { vector, updatedAt });
			return vector;
		}
	};
}

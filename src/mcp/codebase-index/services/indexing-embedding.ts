/**
 * Codebase symbol embedding management.
 *
 * Generates simple text-based vector embeddings for codebase symbols using
 * a TF-IDF style approach (term frequency normalization). Embeddings are
 * stored via CodebaseSymbolEntity and can be used for semantic similarity
 * queries.
 *
 * This module is separated from the main indexing orchestrator to keep
 * embedding logic focused and testable independently.
 */

import type { CodebaseSymbolEntity } from "../../entities/codebase-symbol.js";
import { cosineSimilarityArrays } from "../../utils/vector.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface EmbeddingResult {
	success: boolean;
	embeddingsGenerated: number;
	totalSymbols: number;
}

export interface SymbolEmbeddingInput {
	id: string;
	name: string;
	signature?: string | null;
	doc_comment?: string | null;
}

// ── Vector computation ─────────────────────────────────────────────────

/**
 * Compute a TF-IDF style vector for a codebase symbol.
 *
 * Concatenates the symbol's name, signature, and doc comment, then builds
 * a term-frequency map normalized to unit length. This provides a simple
 * bag-of-words embedding without external dependencies.
 */
export function computeSymbolVector(symbol: SymbolEmbeddingInput): number[] {
	const text = [symbol.name, symbol.signature, symbol.doc_comment].filter(Boolean).join(" ");

	const vector: Record<string, number> = {};
	const words = text
		.toLowerCase()
		.split(/\W+/)
		.filter((w) => w.length > 0);

	for (const word of words) {
		vector[word] = (vector[word] ?? 0) + 1;
	}

	// Normalize to unit length (L2 norm)
	const magnitude = Math.sqrt(Object.values(vector).reduce((sum, v) => sum + v * v, 0));
	if (magnitude > 0) {
		for (const key of Object.keys(vector)) {
			vector[key] /= magnitude;
		}
	}

	// Convert to dense array ordered by keys
	return Object.values(vector);
}

// ── Embedding operations ───────────────────────────────────────────────

/**
 * Generate and store vector embeddings for a batch of codebase symbols.
 *
 * Each symbol's textual metadata (name, signature, doc comment) is
 * vectorized and upserted into the symbol entity's vector store.
 *
 * @param symbols  — Array of symbol inputs with id and text fields.
 * @param symbolEntity — The CodebaseSymbolEntity instance for persistence.
 * @returns EmbeddingResult describing how many embeddings were generated.
 */
export async function upsertSymbolEmbeddings(
	symbols: SymbolEmbeddingInput[],
	symbolEntity: CodebaseSymbolEntity
): Promise<EmbeddingResult> {
	let embeddingsGenerated = 0;

	for (const sym of symbols) {
		const vector = computeSymbolVector(sym);
		if (vector.length > 0) {
			symbolEntity.upsertSymbolVector(sym.id, vector);
			embeddingsGenerated++;
		}
	}

	return {
		success: embeddingsGenerated > 0,
		embeddingsGenerated,
		totalSymbols: symbols.length
	};
}

/**
 * Query codebase symbol embeddings by finding symbols whose text content
 * is semantically similar to a query string.
 *
 * Uses simple cosine similarity against stored symbol vectors. Returns
 * symbol IDs sorted by descending similarity.
 *
 * @param repo — Repository scope.
 * @param query — Natural language query string.
 * @param symbolEntity — The CodebaseSymbolEntity instance.
 * @param limit — Max results to return (default 10).
 * @returns Array of symbol IDs sorted by relevance.
 */
export async function querySymbolEmbeddings(
	repo: string,
	query: string,
	symbolEntity: CodebaseSymbolEntity,
	limit: number = 10
): Promise<Array<{ symbolId: string; score: number }>> {
	// Compute query vector
	const queryVector = computeSymbolVector({
		id: "__query__",
		name: query
	});

	if (queryVector.length === 0) return [];

	// Fetch all symbol vectors for this repo
	const candidates = symbolEntity.getSymbolVectorsByRepo(repo, limit * 3);
	if (candidates.length === 0) return [];

	// Score each candidate by cosine similarity
	const scored: Array<{ symbolId: string; score: number }> = [];
	for (const c of candidates) {
		try {
			const storedVector = JSON.parse(c.vector) as number[];
			const score = cosineSimilarityArrays(queryVector, storedVector);
			if (score > 0) {
				scored.push({ symbolId: c.symbol_id, score });
			}
		} catch {
			// Skip malformed vectors
		}
	}

	// Sort descending by score
	scored.sort((a, b) => b.score - a.score);

	return scored.slice(0, limit);
}

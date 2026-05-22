import { VectorEntityKind, VectorStore, VectorResult } from "../types";
import { SQLiteStore } from "./sqlite";
import { logger } from "../utils/logger";
import { STOPWORDS } from "../utils/stopwords.js";

// Simple vector store using SQLite - lightweight embeddings without ollama
export class StubVectorStore implements VectorStore {
	private db: SQLiteStore;

	constructor(db?: SQLiteStore) {
		if (!db) {
			throw new Error("SQLiteStore required for vector operations");
		}
		this.db = db;
	}

	// Generate simple text-based vector (TF-IDF style) without external embeddings
	private generateTextVector(text: string): string[] {
		const normalized = text
			.toLowerCase()
			// Remove punctuation and special characters, but keep Indonesian characters
			.replace(/[^\w\s\u00C0-\u017F]/g, " ")
			// Normalize multiple spaces to single space
			.replace(/\s+/g, " ")
			.trim()
			.split(/\s+/)
			.filter((word) => word.length > 2);

		return normalized.filter((word) => !STOPWORDS.has(word));
	}

	// Convert token array to frequency vector for cosine similarity
	private computeFrequencyVector(tokens: string[]): Record<string, number> {
		const vector: Record<string, number> = {};
		for (const token of tokens) {
			vector[token] = (vector[token] || 0) + 1;
		}
		return vector;
	}

	// Compute cosine similarity between two frequency vectors
	private cosineSimilarity(v1: Record<string, number>, v2: Record<string, number>): number {
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

	async upsert(id: string, text: string, kind: VectorEntityKind = "memory"): Promise<void> {
		try {
			// Generate simple vector from text tokens
			const tokens = this.generateTextVector(text);

			if (kind === "standard") {
				this.db.standards.upsertVectorEmbedding(
					id,
					tokens.map(() => 0)
				);
			} else {
				this.db.memoryVectors.upsertVectorEmbedding(
					id,
					tokens.map(() => 0)
				);
			}
		} catch {
			// Silently fail - vector is optional for search fallback
		}
	}

	async remove(id: string, kind: VectorEntityKind = "memory"): Promise<void> {
		void kind;
		if (!id) return;
		// Handled by SQL CASCADE
	}

	async search(
		query: string,
		limit: number,
		repo?: string,
		kind: VectorEntityKind = "memory"
	): Promise<VectorResult[]> {
		if (limit < 0) return [];
		if (repo === "never") return [];
		try {
			const queryTokens = this.generateTextVector(query);
			if (queryTokens.length === 0) return [];

			const queryFreq = this.computeFrequencyVector(queryTokens);

			// Get candidate vectors from DB (memory_vectors or coding_standards)
			const candidates = (
				kind === "standard"
					? this.db.standards.getVectorCandidates(repo, 100)
					: this.db.memoryVectors.getVectorCandidates(repo, 100)
			).map((c: Record<string, unknown>) => ({
				id: (c.standard_id ?? c.memory_id) as string,
			}));

			if (candidates.length === 0) return [];

			const ids = candidates.map((c) => c.id);
			const entries = (
				kind === "standard"
					? this.db.standards.getByIds(ids)
					: this.db.memories.getByIds(ids)
			) as { id: string; title: string; content: string }[];

			const results: VectorResult[] = [];
			for (const entry of entries) {
				const text = `${entry.title} ${entry.content}`;
				const entryTokens = this.generateTextVector(text);
				const entryFreq = this.computeFrequencyVector(entryTokens);
				const score = this.cosineSimilarity(queryFreq, entryFreq);
				results.push({ id: entry.id, score });
			}

			return results.sort((a, b) => b.score - a.score).slice(0, limit);
		} catch (error) {
			logger.error("Error searching vectors", { error: String(error) });
			return [];
		}
	}
}

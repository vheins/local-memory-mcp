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

	// Calculate similarity between two token sets
	private calculateSimilarity(tokens1: string[], tokens2: string[]): number {
		if (tokens1.length === 0 || tokens2.length === 0) return 0;

		const set1 = new Set(tokens1);
		const set2 = new Set(tokens2);

		// Jaccard similarity: intersection / union
		const intersection = new Set([...set1].filter((x) => set2.has(x)));
		const union = new Set([...set1, ...set2]);

		return union.size > 0 ? intersection.size / union.size : 0;
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
				this.db.memories.upsertVectorEmbedding(
					id,
					tokens.map(() => 0)
				);
			}
		} catch {
			// Silently fail - vector is optional for search fallback
		}
	}

	async remove(id: string, _kind: VectorEntityKind = "memory"): Promise<void> {
		if (!id) return;
		// Handled by SQL CASCADE
	}

	async search(query: string, limit: number, repo?: string, _kind: VectorEntityKind = "memory"): Promise<VectorResult[]> {
		if (limit < 0) return [];
		if (repo === "never") return [];
		try {
			// Get all memories and compute similarity to query
			const queryTokens = this.generateTextVector(query);

			if (queryTokens.length === 0) {
				return [];
			}

			// For now, return empty - we'll use similarity search in SQLite instead
			// In production, you could implement approximate nearest neighbor search here
			return [];
		} catch (error) {
			logger.error("Error searching vectors", { error: String(error) });
			return [];
		}
	}
}

import { VectorEntityKind, VectorStore, VectorResult } from "../types";
import { SQLiteStore } from "./sqlite";
import { logger } from "../utils/logger";
import { STOPWORDS } from "../utils/stopwords";
import { cosineSimilarity } from "../utils/vector";

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

	async upsert(id: string, text: string, kind: VectorEntityKind = "memory"): Promise<void> {
		try {
			const tokens = this.generateTextVector(text);
			const freqVector = this.computeFrequencyVector(tokens);
			if (kind === "standard") {
				this.db.standards.upsertVectorEmbedding(id, freqVector);
			} else if (kind === "task") {
				this.db.tasks.upsertTaskVectorEmbedding(id, freqVector);
			} else {
				this.db.memoryVectors.upsertVectorEmbedding(id, freqVector);
			}
		} catch (err) {
			logger.debug("StubVectorStore.upsert failed", { id, kind, error: String(err) });
		}
	}

	async remove(id: string, kind: VectorEntityKind = "memory"): Promise<void> {
		if (!id) return;
		if (kind === "memory") {
			// Handled by SQL CASCADE on memories(id)
		} else if (kind === "standard") {
			// Handled by SQL CASCADE on coding_standards(id)
		} else if (kind === "task") {
			this.db.tasks.removeTaskVector(id);
		}
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

			let rawCandidates: Record<string, unknown>[];
			if (kind === "standard") {
				rawCandidates = this.db.standards.getVectorCandidates(repo, 100) as unknown as Record<string, unknown>[];
			} else if (kind === "task") {
				rawCandidates = this.db.tasks.getTaskVectorCandidates(repo, 100) as unknown as Record<string, unknown>[];
			} else {
				rawCandidates = this.db.memoryVectors.getVectorCandidates("", repo, 100) as unknown as Record<
					string,
					unknown
				>[];
			}

			const candidates = rawCandidates.map((c) => ({
				id: (c.task_id ?? c.standard_id ?? c.memory_id ?? "") as string,
				vector: c.vector as string
			}));

			if (candidates.length === 0) return [];

			const results: VectorResult[] = [];
			for (const candidate of candidates) {
				try {
					const storedVector = JSON.parse(candidate.vector) as Record<string, number>;
					const score = cosineSimilarity(queryFreq, storedVector);
					results.push({ id: candidate.id, score });
				} catch {
					continue;
				}
			}

			return results.sort((a, b) => b.score - a.score).slice(0, limit);
		} catch (error) {
			logger.error("Error searching vectors", { error: String(error) });
			return [];
		}
	}
}

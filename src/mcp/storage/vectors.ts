import { pipeline, FeatureExtractionPipeline, env } from "@xenova/transformers";
import { VectorEntityKind, VectorStore, VectorResult } from "../types";
import { SQLiteStore } from "./sqlite";
import { logger } from "../utils/logger";

// Suppress transformers.js stdout progress output — stdout is reserved for JSON-RPC in MCP mode
if (process.env.MCP_SERVER === "true") {
	env.backends.onnx.logLevel = "error";
}

export class RealVectorStore implements VectorStore {
	private db: SQLiteStore;
	private extractor: FeatureExtractionPipeline | null = null;
	private modelName = "Xenova/all-MiniLM-L6-v2";

	constructor(db: SQLiteStore) {
		this.db = db;
	}

	/**
	 * Triggers background loading of the vector model.
	 * Useful for avoiding timeouts on the first search/upsert request.
	 */
	async initialize(): Promise<void> {
		await this.getExtractor();
	}

	private async getExtractor(): Promise<FeatureExtractionPipeline> {
		if (!this.extractor) {
			this.extractor = await pipeline("feature-extraction", this.modelName);
		}
		return this.extractor;
	}

	private cosineSimilarity(v1: number[], v2: number[]): number {
		let dotProduct = 0;
		let mag1 = 0;
		let mag2 = 0;
		for (let i = 0; i < v1.length; i++) {
			dotProduct += v1[i] * v2[i];
			mag1 += v1[i] * v1[i];
			mag2 += v2[i] * v2[i];
		}
		const mag = Math.sqrt(mag1) * Math.sqrt(mag2);
		return mag === 0 ? 0 : dotProduct / mag;
	}

	async upsert(id: string, text: string, kind: VectorEntityKind = "memory"): Promise<void> {
		try {
			const extractor = await this.getExtractor();
			const output = await extractor(text, { pooling: "mean", normalize: true });
			const vector = Array.from(output.data as Float32Array);

			if (kind === "standard") {
				this.db.standards.upsertVectorEmbedding(id, vector);
			} else {
				this.db.memories.upsertVectorEmbedding(id, vector);
			}
		} catch (error) {
			logger.error("[Vectors] Error during upsert", { id, kind, error: String(error) });
			throw error;
		}
	}

	async remove(id: string, _kind: VectorEntityKind = "memory"): Promise<void> {
		if (!id) return;
		// Handled by SQL CASCADE
	}

	async search(query: string, limit: number, repo?: string, kind: VectorEntityKind = "memory"): Promise<VectorResult[]> {
		try {
			const extractor = await this.getExtractor();
			const output = await extractor(query, { pooling: "mean", normalize: true });
			const queryVector = Array.from(output.data as Float32Array);

			const rows =
				kind === "standard"
					? this.db.standards.getVectorCandidates(repo, 100).map((row) => ({ id: row.standard_id, vector: row.vector }))
					: this.db.memories.getVectorCandidates(repo, 100).map((row) => ({ id: row.memory_id, vector: row.vector }));

			const results: VectorResult[] = rows.map((row) => {
				const memoryVector = JSON.parse(row.vector) as number[];
				return {
					id: row.id,
					score: this.cosineSimilarity(queryVector, memoryVector)
				};
			});

			return results.sort((a, b) => b.score - a.score).slice(0, limit);
		} catch (error) {
			logger.error("[Vectors] Error during search", { kind, error: String(error) });
			return [];
		}
	}
}

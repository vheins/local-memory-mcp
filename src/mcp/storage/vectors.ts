import { VectorEntityKind, VectorStore, VectorResult } from "../types";
import { SQLiteStore } from "./sqlite";
import { logger } from "../utils/logger";
import { cosineSimilarityArrays } from "../utils/vector";

type FeatureExtractionPipeline = import("@xenova/transformers").FeatureExtractionPipeline;

export class RealVectorStore implements VectorStore {
	private db: SQLiteStore;
	private extractor: FeatureExtractionPipeline | null = null;
	private modelName = "Xenova/all-MiniLM-L6-v2";
	private transformersModule: typeof import("@xenova/transformers") | null = null;

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

	private async getTransformers(): Promise<typeof import("@xenova/transformers")> {
		if (!this.transformersModule) {
			this.transformersModule = await import("@xenova/transformers");
			if (process.env.MCP_SERVER === "true") {
				this.transformersModule.env.backends.onnx.logLevel = "error";
			}
		}
		return this.transformersModule;
	}

	private async getExtractor(): Promise<FeatureExtractionPipeline> {
		if (!this.extractor) {
			const tf = await this.getTransformers();
			this.extractor = await tf.pipeline("feature-extraction", this.modelName);
		}
		return this.extractor;
	}

	/**
	 * Batched embedding for the outbox worker (TASK-013). Runs a single ONNX
	 * inference pass over all texts, sharing the process-wide extractor with
	 * `upsert`/`search` so the model is loaded exactly once per process.
	 */
	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		const extractor = await this.getExtractor();
		const output = await extractor(texts, { pooling: "mean", normalize: true });
		const data = output.data as Float32Array;
		const dims = output.dims;
		const perRow =
			Array.isArray(dims) && dims.length > 1 && typeof dims[1] === "number"
				? dims[1]
				: Math.floor(data.length / texts.length);
		const result: number[][] = [];
		for (let i = 0; i < texts.length; i++) {
			const start = i * perRow;
			result.push(Array.from(data.subarray(start, start + perRow)));
		}
		return result;
	}

	async upsert(id: string, text: string, kind: VectorEntityKind = "memory"): Promise<void> {
		try {
			const extractor = await this.getExtractor();
			const output = await extractor(text, { pooling: "mean", normalize: true });
			const vector = Array.from(output.data as Float32Array);

			if (kind === "standard") {
				this.db.standards.upsertVectorEmbedding(id, vector);
			} else if (kind === "task") {
				this.db.tasks.upsertTaskVectorEmbedding(id, vector);
			} else {
				this.db.memoryVectors.upsertVectorEmbedding(id, vector);
			}
		} catch (error) {
			logger.error("[Vectors] Error during upsert", { id, kind, error: String(error) });
			throw error;
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
		try {
			// Gate the codebase_symbol vector stage on the populated-vector row
			// count: codebase_symbol_vectors is never populated (upsertSymbolEmbeddings
			// has zero callers), so running a full ONNX query inference per
			// codebase-read search is pure waste. When the table is empty we skip
			// inference entirely and blendVectorRanking falls back to text-only
			// ranking. The probe is a LIMIT 1 query (never loads candidate rows).
			if (kind === "codebase_symbol") {
				const vectorRows = this.db.codebaseSymbols.getSymbolVectorsByRepo(repo || "", 1);
				if (vectorRows.length === 0) {
					logger.debug("[Vectors] Skipping codebase_symbol search — no symbol vectors populated", { repo });
					return [];
				}
			}

			const extractor = await this.getExtractor();
			const output = await extractor(query, { pooling: "mean", normalize: true });
			const queryVector = Array.from(output.data as Float32Array);

			let rows: { id: string; vector: string }[];
			if (kind === "standard") {
				rows = this.db.standards
					.getVectorCandidates(repo, 100)
					.map((row) => ({ id: row.standard_id, vector: row.vector }));
			} else if (kind === "task") {
				rows = this.db.tasks.getTaskVectorCandidates(repo, 100).map((row) => ({ id: row.task_id, vector: row.vector }));
			} else if (kind === "codebase_symbol") {
				rows = this.db.codebaseSymbols
					.getSymbolVectorsByRepo(repo || "", 100)
					.map((row) => ({ id: row.symbol_id, vector: row.vector }));
			} else {
				// Owner is deliberately omitted (audit F7): memories carry a real
				// owner, so passing the hardcoded empty string here produced
				// `WHERE m.owner = ''` and excluded 46% of vectorized memories on
				// a real database. `getVectorCandidates` now treats a falsy owner
				// as "any owner", matching the standard/task stores which take no
				// owner argument at all.
				rows = this.db.memoryVectors
					.getVectorCandidates(undefined, repo, 100)
					.map((row) => ({ id: row.memory_id, vector: row.vector }));
			}

			const results: VectorResult[] = rows.map((row) => {
				const memoryVector = JSON.parse(row.vector) as number[];
				return {
					id: row.id,
					score: cosineSimilarityArrays(queryVector, memoryVector)
				};
			});

			return results.sort((a, b) => b.score - a.score).slice(0, limit);
		} catch (error) {
			logger.error("[Vectors] Error during search", { kind, error: String(error) });
			return [];
		}
	}
}

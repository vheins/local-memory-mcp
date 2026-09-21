import { VectorEntityKind, VectorStore, VectorResult } from "../types";
import { SQLiteStore } from "./sqlite";
import { logger } from "../utils/logger";
import { cosineSimilarityArrays, decodeVector } from "../utils/vector";
import { EMBEDDING_ONNX_THREADS } from "../utils/constants";
import { currentEmbeddingModelVersion, EMBEDDING_MODEL_NAME } from "./embedding-model";

type FeatureExtractionPipeline = import("@xenova/transformers").FeatureExtractionPipeline;

/**
 * Minimal structural view of the ONNX `env` object needed to cap its thread
 * pools (PERF-002). `@xenova/transformers` exposes it as
 * `env.backends.onnx` (typed as onnxruntime-common's `Env`), which carries
 * `wasm.numThreads` for the wasm backend and the native-session
 * `intraOpNumThreads` / `interOpNumThreads` knobs. The index signature keeps
 * the helper tolerant of the native runtime, where `intraOpNumThreads` /
 * `interOpNumThreads` are read straight off the env object (not declared on
 * `Env`) — we touch only the fields that are actually present.
 */
export interface OnnxThreadEnv {
	wasm?: { numThreads?: number };
	intraOpNumThreads?: number;
	interOpNumThreads?: number;
	[name: string]: unknown;
}

/**
 * Apply the ONNX thread cap to a transformers `env.backends.onnx` object.
 *
 * Thread count affects only ORT's scheduling, never embedding values, so this
 * is output-neutral. Defensive by construction: it sets `wasm.numThreads` only
 * when a `wasm` object is present and only touches `interOpNumThreads` when the
 * native runtime already exposes that field, so it never throws on an env shape
 * that lacks either. Exported (pure) so it is directly unit-testable without
 * loading ONNX (see tests/vectors.threads.test.ts).
 */
export function applyOnnxThreadConfig(env: OnnxThreadEnv, threads: number): void {
	const n = Math.max(1, Math.floor(threads));
	if (env.wasm && typeof env.wasm === "object") {
		env.wasm.numThreads = n;
	}
	env.intraOpNumThreads = n;
	if ("interOpNumThreads" in env) {
		env.interOpNumThreads = 1;
	}
}

export class RealVectorStore implements VectorStore {
	private db: SQLiteStore;
	private extractor: FeatureExtractionPipeline | null = null;
	private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
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
			// PERF-002: cap the native ONNX thread pool BEFORE the module is
			// imported. onnxruntime-node loads its native binding (and reads
			// OMP_NUM_THREADS) at import time, so setting it after the dynamic
			// import below would be too late. Respect an operator-provided value.
			if (!process.env.OMP_NUM_THREADS) {
				process.env.OMP_NUM_THREADS = String(EMBEDDING_ONNX_THREADS);
			}
			this.transformersModule = await import("@xenova/transformers");
			if (process.env.MCP_SERVER === "true") {
				this.transformersModule.env.backends.onnx.logLevel = "error";
			}
			// Cover the wasm backend and the native session options too (the
			// env var above only reaches the native OpenMP pool).
			applyOnnxThreadConfig(this.transformersModule.env.backends.onnx, EMBEDDING_ONNX_THREADS);
		}
		return this.transformersModule;
	}

	private async getExtractor(): Promise<FeatureExtractionPipeline> {
		if (this.extractor) return this.extractor;
		if (this.extractorPromise) return this.extractorPromise;

		// PERF-004: load the pipeline from the shared model constant — this file
		// no longer carries its own copy of the model name.
		this.extractorPromise = this.getTransformers()
			.then((tf) => tf.pipeline("feature-extraction", EMBEDDING_MODEL_NAME))
			.then((extractor) => {
				this.extractor = extractor;
				return extractor;
			})
			.finally(() => {
				this.extractorPromise = null;
			});
		return this.extractorPromise;
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

			// PERF-003: stamp the embedding-model identity so the startup backfill
			// re-embeds when the model changes. `content_hash` is deliberately NOT
			// written here: this method only receives the embed `text`, while the
			// enqueue-time hash covers the whole payload (title/content/parentId/
			// decisionRefs/context/stack) — a text-only hash would NOT be
			// comparable and would wrongly suppress a needed re-embed. The
			// authoritative producer of BOTH columns is the worker path
			// (`writeVector` in embedding-queue/worker-jobs.ts), which has the
			// payload. A row written here keeps `content_hash` NULL, so the next
			// backfill re-embeds it ONCE through the worker and stamps the hash.
			const meta = { modelVersion: currentEmbeddingModelVersion() };
			if (kind === "standard") {
				this.db.standards.upsertVectorEmbedding(id, vector, meta);
			} else if (kind === "task") {
				this.db.tasks.upsertTaskVectorEmbedding(id, vector, meta);
			} else {
				this.db.memoryVectors.upsertVectorEmbedding(id, vector, meta);
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
			// codebase_symbol vectors are not persisted by any production path:
			// the write is an intentional NO-OP (TASK-293) and the dead
			// `codebase_symbol_vectors` table was dropped in migration v35. There
			// is therefore no candidate source — return no vector results so
			// blendVectorRanking falls back to text-only ranking. The explicit
			// early return also keeps codebase_symbol from falling through to the
			// memory branch below.
			if (kind === "codebase_symbol") return [];

			const extractor = await this.getExtractor();
			const output = await extractor(query, { pooling: "mean", normalize: true });
			const queryVector = Array.from(output.data as Float32Array);

			let rows: { id: string; vector: string | Uint8Array }[];
			if (kind === "standard") {
				rows = this.db.standards
					.getVectorCandidates(repo, 100)
					.map((row) => ({ id: row.standard_id, vector: row.vector }));
			} else if (kind === "task") {
				rows = this.db.tasks.getTaskVectorCandidates(repo, 100).map((row) => ({ id: row.task_id, vector: row.vector }));
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
				// Dual-format read (TASK-038): decodeVector accepts both the new
				// float32 BLOB and the legacy JSON TEXT so a partially-migrated
				// database never crashes mid-rollout.
				const memoryVector = decodeVector(row.vector);
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

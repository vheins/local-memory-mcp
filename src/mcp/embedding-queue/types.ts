/**
 * Embedding/KG outbox queue types (TASK-013 / MEM-368).
 *
 * The queue is a SQLite-backed outbox (`queue_jobs`) consumed by an
 * in-process lease-based worker in BOTH the MCP server and the dashboard.
 * Writes enqueue a snapshot (payload) synchronously inside the write
 * transaction (~µs); ONNX embedding + compromise KG extraction run later,
 * outside the proper-lockfile write lock.
 */

/** Entity kinds the queue can enrich. Mirrors VectorEntityKind minus codebase_symbol. */
export type QueueJobKind = "memory" | "standard" | "task";

export type QueueJobStatus = "pending" | "claimed" | "done" | "poison";

/** Raw row shape of the `queue_jobs` table. */
export interface QueueJobRow {
	id: string;
	entity_kind: QueueJobKind;
	entity_id: string;
	entity_repo: string;
	payload: string;
	status: QueueJobStatus;
	attempts: number;
	lease_until: string | null;
	locked_by: string | null;
	backoff_until: string | null;
	last_error: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * Enqueue-time snapshot of the entity. The worker embeds/KG-extracts this
 * snapshot — it never re-reads the entity row — so LWW coalescing (upsert on
 * (entity_kind, entity_id)) always converges on the newest committed write.
 */
export interface EmbeddingJobPayload {
	/** Payload schema version. */
	v: 1;
	/** Text fed to the ONNX embedding model. */
	text: string;
	/** Content fed to KG extraction (falls back to `text`). */
	content?: string;
	/** Title used in KG observation text. */
	title?: string;
	owner: string;
	repo: string;
	/** Entity updated_at at enqueue time (observability only). */
	updatedAt: string;
	/** Standard: parent standard id. Task: parent task id (KG relations). */
	parentId?: string | null;
	/** Task decision refs → `inspired_by` KG relations. */
	decisionRefs?: string[];
	/** Standard context slug (KG relations). */
	context?: string;
	/** Standard stack (KG relations). */
	stack?: string[];
}

/** Input for a synchronous enqueue. */
export interface EmbeddingJobInput {
	kind: QueueJobKind;
	id: string;
	repo?: string;
	owner?: string;
	payload: EmbeddingJobPayload;
}

/** Queue depth by status (from the DB). */
export interface QueueCounts {
	pending: number;
	claimed: number;
	done: number;
	poison: number;
	total: number;
}

/** Worker + queue observability snapshot. */
export interface EmbeddingWorkerStats extends QueueCounts {
	processed: number;
	failed: number;
	poisoned: number;
	lastBatchSize: number;
	lastRunAt: string | null;
	running: boolean;
	started: boolean;
	modelReady: boolean;
	pollIntervalMs: number;
	batchSize: number;
	leaseMs: number;
}

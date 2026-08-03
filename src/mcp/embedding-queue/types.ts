/**
 * Embedding/KG outbox queue types (TASK-013 / MEM-368).
 *
 * The queue is a SQLite-backed outbox (`queue_jobs`) consumed by an
 * in-process lease-based worker in BOTH the MCP server and the dashboard.
 * Writes enqueue a snapshot (payload) synchronously inside the write
 * transaction (~µs); ONNX embedding + compromise KG extraction run later,
 * outside the proper-lockfile write lock.
 */

import type { VectorEntityKind } from "../types";

/**
 * Entity kinds the queue can enrich.
 *
 * Derived from the single shared `VectorEntityKind` (src/mcp/types/vector.ts)
 * minus `codebase_symbol` (TASK-097): adding a new entity kind to
 * `VectorEntityKind` automatically extends the queue instead of silently
 * drifting from a duplicated literal union. Runtime values are unchanged —
 * `"memory" | "standard" | "task"`.
 */
export type QueueJobKind = Exclude<VectorEntityKind, "codebase_symbol">;

/**
 * Compile-time lock (enforced by `tsc --noEmit`): QueueJobKind must equal
 * VectorEntityKind minus exactly `codebase_symbol`. If the derivation above
 * is replaced with a literal union that drifts, or a new kind is excluded
 * beyond `codebase_symbol`, this assignment fails type-checking.
 */
type _QueueJobKindInvariant =
	// Every queue kind must be a valid vector kind...
	[QueueJobKind] extends [VectorEntityKind]
		? // ...and codebase_symbol must be the ONLY kind excluded from the queue.
			Exclude<VectorEntityKind, QueueJobKind> extends "codebase_symbol"
			? true
			: false
		: false;

// `satisfies`-style assertion — never read at runtime.
export const _queueJobKindInvariant: _QueueJobKindInvariant = true;

export type QueueJobStatus = "pending" | "claimed" | "done" | "poison";

/** Raw row shape of the `queue_jobs` table. */
export interface QueueJobRow {
	id: string;
	entity_kind: QueueJobKind;
	entity_id: string;
	entity_repo: string;
	payload: string;
	/**
	 * sha256 of the embed/KG-relevant payload fields (OPT-FLOW-03). NULL for
	 * rows enqueued before migration v16; the next enqueue computes and stores
	 * it. `enqueueEmbeddingJob` skips the LWW reset when the incoming hash
	 * matches an existing row's hash (identical content → no redundant ONNX +
	 * KG work).
	 */
	content_hash: string | null;
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

/** Embedding batch latency distribution (worker.ts, OPT-OBS-01). */
export interface EmbeddingLatencyStats {
	/** Number of embedded batches sampled. */
	count: number;
	/** Average batch latency (ms). */
	avgMs: number;
	/** Median batch latency (ms). */
	p50Ms: number;
	/** 95th-percentile batch latency (ms). */
	p95Ms: number;
	/** Slowest batch (ms) — the worker-backlog / hot-DB-query signal. */
	maxMs: number;
}

/** Worker + queue observability snapshot. */
export interface EmbeddingWorkerStats extends QueueCounts {
	processed: number;
	failed: number;
	poisoned: number;
	lastBatchSize: number;
	lastRunAt: string | null;
	/** Embedding batch latency (OPT-OBS-01). */
	embedLatency: EmbeddingLatencyStats;
	running: boolean;
	started: boolean;
	modelReady: boolean;
	pollIntervalMs: number;
	batchSize: number;
	leaseMs: number;
}

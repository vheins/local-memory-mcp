/**
 * Embedding/KG outbox queue — SQLite-backed job queue + in-process lease
 * worker (TASK-013 / MEM-368).
 *
 * - `enqueue*` helpers are synchronous (~µs) and safe inside the write lock.
 * - `EmbeddingWorker` drains the queue in the background (batched ONNX +
 *   compromise KG), never holding the proper-lockfile write lock.
 * - Both the MCP server and the dashboard run their own worker against the
 *   shared `queue_jobs` table; atomic claims serialize across processes.
 */
export { Outbox, outboxFor, enqueueEmbeddingJob, enqueueMemory, enqueueStandard, enqueueTask } from "./outbox";
export type { Outbox as OutboxInstance } from "./outbox";
export { EmbeddingWorker } from "./worker";
export type { EmbeddingWorkerOptions } from "./worker";
export type {
	EmbeddingJobInput,
	EmbeddingJobPayload,
	EmbeddingWorkerStats,
	QueueCounts,
	QueueJobKind,
	QueueJobRow,
	QueueJobStatus
} from "./types";

/**
 * Centralized numeric constants for scoring, candidate caps, thresholds,
 * TTLs, and batch sizes — single source of truth across the codebase.
 * Do not inline these values in call sites.
 *
 * Batch sizes and candidate caps are env-overridable where sensible
 * (e.g. `VECTOR_CANDIDATE_CAP=250`). Scoring weights and similarity
 * thresholds are deliberately NOT env-overridable: silently changing them
 * between environments would alter search/conflict semantics.
 */

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Hybrid scoring weights (SPEC-001) ────────────────────────────────────
// 0.40 similarity + 0.30 keyword + 0.15 recency + 0.15 domain.
// Shared by memory-read, task-read, and standard-read search engines.
export const HYBRID_WEIGHTS = {
	similarity: 0.4,
	keyword: 0.3,
	recency: 0.15,
	domain: 0.15
} as const;

// ── Recency decay ────────────────────────────────────────────────────────
// Exponential half-life used by computeRecencyScore (default, 30 days).
export const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

// ── Adaptive search thresholds ───────────────────────────────────────────
// Small result sets (<= 5 candidates) use the lenient threshold so sparse
// corpora still return results; larger sets use the stricter threshold.
export const SEARCH_THRESHOLDS = {
	memory: { smallSet: 0.1, largeSet: 0.4 },
	task: { smallSet: 0.08, largeSet: 0.2 },
	standard: { smallSet: 0.08, largeSet: 0.2 }
} as const;

// ── Vector candidate caps ────────────────────────────────────────────────
export const VECTOR_CANDIDATE_CAP = envInt("VECTOR_CANDIDATE_CAP", 100);
// Floor for the candidate pool fetched by similarity searches so conflict
// checks and small fetches still evaluate O(10) rows.
export const MIN_CANDIDATES = envInt("VECTOR_MIN_CANDIDATES", 10);
// Cold-start fallback: how many recent rows are re-fetched when the primary
// candidate pool is nearly empty.
export const COLD_START_RECENT_LIMIT = 10;
// Default candidate pool for standard similarity searches (searchBySimilarity).
export const STANDARD_CANDIDATE_CAP = 60;
// Candidate pool used by standard-write conflict checks.
export const STANDARD_CONFLICT_CANDIDATES = 80;

// ── Similarity fallbacks / boosts ────────────────────────────────────────
// Score assigned when cosine similarity is 0 (term-less query or no overlap).
export const SIMILARITY_ZERO_FALLBACK = 0.16;
// Bonus added to a memory's similarity score when its repo matches the query
// repo (memory.vector searchBySimilarity).
export const REPO_MATCH_BOOST = 0.1;

// ── Conflict thresholds ──────────────────────────────────────────────────
// memory-write rejects creates whose content overlaps an existing memory
// above this cosine threshold.
export const MEMORY_CONFLICT_THRESHOLD = 0.85;
// Default threshold used by MemoryVectorEntity.checkConflicts when the caller
// does not pass one explicitly.
export const MEMORY_CHECK_CONFLICTS_THRESHOLD = 0.55;
// standard-write conflict cutoff — stricter than memory.
export const STANDARD_CONFLICT_THRESHOLD = 0.82;

// ── Batch sizes ──────────────────────────────────────────────────────────
export const DEFAULT_BATCH_SIZE = envInt("DEFAULT_BATCH_SIZE", 100);
// Chunk size for bulk UPDATE ... WHERE id IN (...) statements.
export const BULK_UPDATE_CHUNK_SIZE = 500;

// ── Time (ms) ────────────────────────────────────────────────────────────
export const TTL_MS_PER_DAY = 24 * 60 * 60 * 1000;

// Minimum interval between WAL checkpoints triggered by dashboard reads
// (TASK-017). Checkpoint cost scales with WAL size, so per-request
// checkpoints were throttled to this window. WAL readers see committed data
// without a checkpoint, so this is purely a WAL-shrink frequency cap.
export const WAL_CHECKPOINT_INTERVAL_MS = envInt("WAL_CHECKPOINT_INTERVAL_MS", 10_000);

// TTL for cached per-repo index-staleness results (TASK-018). Staleness
// checking costs N filesystem stats per repo; within this window repeated
// index_status / staleness calls reuse the previous result.
export const INDEX_STALENESS_TTL_MS = envInt("INDEX_STALENESS_TTL_MS", 30_000);

// ── Embedding/KG outbox queue (TASK-013) ─────────────────────────────────
// Batch inference size K — jobs are claimed and embedded in batches of this
// many rows (design per MEM-368).
export const EMBEDDING_QUEUE_BATCH_SIZE = envInt("EMBEDDING_QUEUE_BATCH_SIZE", 32);
// Idle poll interval for the in-process lease worker.
export const EMBEDDING_QUEUE_POLL_INTERVAL_MS = envInt("EMBEDDING_QUEUE_POLL_INTERVAL_MS", 500);
// Idle backoff ceiling: when the queue is empty the poll interval grows
// exponentially (with jitter) up to this cap, so two workers never busy-spin
// or thundering-herd the same poll times (TASK-064 / MEM-475).
export const EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS = envInt("EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS", 10_000);
// Lease length for claimed jobs — a crash mid-batch is recovered after this
// window via lease expiry + reconcile (crash-safe per MEM-368).
export const EMBEDDING_QUEUE_LEASE_MS = envInt("EMBEDDING_QUEUE_LEASE_MS", 60_000);
// A job is poisoned (no further retries) after this many failed attempts.
export const EMBEDDING_QUEUE_POISON_THRESHOLD = 5;
// Exponential retry backoff base / ceiling (base * 2^(attempt-1)).
export const EMBEDDING_QUEUE_BACKOFF_BASE_MS = 1_000;
export const EMBEDDING_QUEUE_BACKOFF_MAX_MS = 60_000;
// Startup backfill cap: rows with missing/stale vectors enqueued per process
// start (bounds first-boot CPU; new writes are unaffected — they enqueue
// synchronously and drain within seconds).
export const EMBEDDING_QUEUE_BACKFILL_CAP = envInt("EMBEDDING_QUEUE_BACKFILL_CAP", 2_000);
// Backfill backpressure gate (TASK-068 S1 / TASK-069): startup backfill is
// skipped entirely when pending + claimed jobs already exceed this many —
// with a deep backlog a restart must NOT double-refill the queue. The queue
// drains the backlog it already has; backfill only runs when it is shallow.
export const EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE = envInt("EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE", 500);
// Size-driven drain cadence (TASK-068 S1 / TASK-069): after this many
// CONSECUTIVE non-empty batches the worker backs off to `pollIntervalMs`
// instead of the fast max(50, poll/2) — the queue is deep, so it keeps
// draining at a bounded rate instead of polling between batches at the
// half-interval. When the queue empties, the existing exponential idle
// backoff applies.
export const EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK = envInt("EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK", 5);
// Purge TTLs: completed jobs are swept after 6h (TASK-071 — done rows are
// pure history; 24h retention let queue_jobs scans grow needlessly), poisoned
// after 7d (kept longer for diagnostics).
export const EMBEDDING_QUEUE_DONE_TTL_MS = 6 * 60 * 60 * 1000;
export const EMBEDDING_QUEUE_POISON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Frequency of the purge sweep.
export const EMBEDDING_QUEUE_PURGE_INTERVAL_MS = 15 * 60 * 1000;

// ── KG graph (dashboard) ─────────────────────────────────────────────────
// Server-side edge cap for the KG graph endpoints (TASK-068 S2 / TASK-070):
// listGraphEdges returns the top-N highest-value edges (ranked by endpoint
// degree) instead of serializing the whole relations table (~22k edges ≈ 2MB
// JSON per request). listRelationsForGraph filters to the capped node subset
// and is bounded by the same limit, so payloads scale with the node cap.
export const KG_MAX_GRAPH_EDGES = envInt("KG_MAX_GRAPH_EDGES", 4_000);

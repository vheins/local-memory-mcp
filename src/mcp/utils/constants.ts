/**
 * Centralized constants — single source of truth across the codebase.
 * Do not inline these values in call sites.
 *
 * Batch sizes and candidate caps are env-overridable where sensible
 * (e.g. `VECTOR_CANDIDATE_CAP=250`). Scoring weights and similarity
 * thresholds are deliberately NOT env-overridable: silently changing them
 * between environments would alter search/conflict semantics.
 *
 * ────────────────────────────────────────────────────────────────────────
 * NAMING CONVENTIONS (TASK-119) — documented rule for this codebase:
 *
 *   1. Scalar constants            → UPPER_SNAKE (default; e.g. TTL_MS_PER_DAY)
 *   2. Zod schemas / types         → PascalCase (e.g. MemoryScopeSchema)
 *   3. Process singletons          → camelCase — THE documented exception:
 *      module-level live instances (logger, indexingRepos, db, mcpClient,
 *      vectors, embeddingWorker, startTime). These are NOT exported consts
 *      of a value category; they are DI. Do NOT rename them (breaking).
 *
 * ENUM VALUE CASING (TASK-119) — chosen convention for NEW code:
 *   UPPER_SNAKE (e.g. ErrorSeverity). Existing enums are NOT migrated
 *   (behavior/API risk): SymbolKind uses slug values, RankTier uses
 *   numeric values — both remain as-is, documented here as legacy.
 * ────────────────────────────────────────────────────────────────────────
 */

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Table names (single source of truth for SQL) ────────────────────────
// Canonical SQLite table names. Use these in ALL SQL strings (entities,
// migrations, services, tools) — never inline the literal. Virtual/aux
// tables (memories_fts, task_vectors, …) and migration-internal temp tables
// (memories__migrated, memory_summary_v3, …) are intentionally NOT included.
export const TABLE_MEMORIES = "memories";
export const TABLE_TASKS = "tasks";
export const TABLE_HANDOFFS = "handoffs";
export const TABLE_CLAIMS = "claims";
export const TABLE_ACTION_LOG = "action_log";
export const TABLE_MEMORY_SUMMARY = "memory_summary";

// ── Time (ms) — TTL building blocks (single source) ─────────────────────
// Declared before RECENCY_HALF_LIFE_MS so derived constants can reference
// them. Replace inline `60*60*1000` / `24*60*60*1000` math with these.
export const TTL_MS_PER_HOUR = 60 * 60 * 1000;
export const TTL_MS_PER_DAY = 24 * TTL_MS_PER_HOUR;

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
export const RECENCY_HALF_LIFE_MS = 30 * TTL_MS_PER_DAY;
// Standard recency half-life (e^(-age/180d) — standards age slower than
// memories/tasks; used by STANDARD_SCORING in utils/scoring.ts).
export const STANDARD_RECENCY_HALF_LIFE_MS = 180 * TTL_MS_PER_DAY;

// ── Confidence buckets (per-entity-kind) ────────────────────────────────
// Final-score thresholds that map a blended hybrid score to a confidence
// label (high/medium/low). Memory and task share the default bucket;
// standard adds keyword-relevance OR conditions (see STANDARD_SCORING in
// utils/scoring.ts).
export const DEFAULT_CONFIDENCE_THRESHOLDS = { high: 0.7, medium: 0.4 } as const;
export const STANDARD_CONFIDENCE_THRESHOLDS = { high: 0.72, medium: 0.42 } as const;
export const STANDARD_KEYWORD_CONFIDENCE_THRESHOLDS = { high: 0.85, medium: 0.45 } as const;

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
// TTL building blocks (TTL_MS_PER_HOUR / TTL_MS_PER_DAY) are declared at the
// top of this file so derived constants can reference them.

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
export const EMBEDDING_QUEUE_DONE_TTL_MS = 6 * TTL_MS_PER_HOUR;
export const EMBEDDING_QUEUE_POISON_TTL_MS = 7 * TTL_MS_PER_DAY;
// Frequency of the purge sweep.
export const EMBEDDING_QUEUE_PURGE_INTERVAL_MS = 15 * 60 * 1000;

// ── Codebase file watcher (TASK-322 / US-08) ─────────────────────────────
// Polling sweep over autoIndexIfStale — deliberately NO fs.watch/chokidar
// (zero usage in src today; polling avoids per-process watcher lifecycle,
// cross-platform leaks, and double-index races). Hosted by the MCP server
// process ONLY (dashboard excluded — avoids cross-process double index).
// Sweep cadence: how often the watcher checks registered repos. Every tick
// costs one cheap MAX(last_indexed_at) query (never-indexed guard) + math per
// repo; the TTL below gates whether a full (incremental) index run is
// triggered.
export const FILE_WATCH_INTERVAL_MS = envInt("FILE_WATCH_INTERVAL_MS", 30_000);
// Floor for the sweep cadence: a zero/misconfigured interval would create a
// busy loop (review NIT, TASK-354). Applied in the FileWatcher constructor to
// both env- and option-provided intervals, so it is not itself env-tunable.
export const FILE_WATCH_INTERVAL_MIN_MS = 1_000;
// Per-repo re-entry cap (debounce): minimum period between trigger dispatches
// for the same repo — detection latency is ≤ this TTL (tunable). Deliberately
// > FILE_WATCH_INTERVAL_MS (default 5 min vs 30 s) so the cap meaningfully
// throttles. Keyed on the watcher's IN-MEMORY lastTriggeredAt, NOT DB
// last_indexed_at: a zero-parse run (untouched repo — the incremental planner
// marks every file "skip") never advances last_indexed_at, so a DB-keyed cap
// would re-trigger a full discovery walk every tick forever (TASK-354).
// Passed through to autoIndexIfStale as options.ttlMs so its internal
// DB-freshness check — the correctness backstop — agrees with the sweep's
// (deliberately SHORT vs the 24h CODEBASE_AUTO_INDEX_TTL default). Gate flag
// ENABLE_FILE_WATCHER (default enabled; "false" disables) lives in
// file-watcher.ts, mirroring the CODEBASE_AUTO_INDEX convention.
export const FILE_WATCH_TTL_MS = envInt("FILE_WATCH_TTL_MS", 300_000);

// ── KG graph (dashboard) ─────────────────────────────────────────────────
// Server-side edge cap for the KG graph endpoints (TASK-068 S2 / TASK-070):
// listGraphEdges returns the top-N highest-value edges (ranked by endpoint
// degree) instead of serializing the whole relations table (~22k edges ≈ 2MB
// JSON per request). listRelationsForGraph filters to the capped node subset
// and is bounded by the same limit, so payloads scale with the node cap.
export const KG_MAX_GRAPH_EDGES = envInt("KG_MAX_GRAPH_EDGES", 4_000);

// ── KG-context enrichment bounds (OPT-PERF-04) ───────────────────────────
// Maximum entity names fed into kgQuery's IN() scans on entities/relations
// from ANY context fetcher (memory/task/standard read paths). The fetchers
// resolve entity names first (observation text match or the v15 FTS token
// index over entities.name), then kgQuery slices the deduped set to this cap
// before issuing the entity + relation IN() lookups, so KG-context enrichment
// cost is bounded even when the resolved name set is large. Env-overridable
// so operators can widen the enrichment window without code changes.
export const KG_MAX_CONTEXT_ENTITIES = envInt("KG_MAX_CONTEXT_ENTITIES", 50);
// Maximum distinct tokens from the search text used to build the
// entity_names_fts MATCH query (v15). Bounds the OR-term count per read —
// entity names are short identifiers, so the first N tokens are a
// representative sample; the FTS query itself is LIMIT-capped downstream.
export const KG_CONTEXT_TEXT_TOKENS = envInt("KG_CONTEXT_TEXT_TOKENS", 40);

// ── Action log retention (OPT-PERF-05) ───────────────────────────────────
// Row-count cap for action_log: the periodic soul-maintenance prune keeps at
// most this many NEWEST rows, deleting the oldest tail beyond the cap (the
// existing age-based 30-day prune also runs). Bounds the table even when the
// remaining rows are all recent. Env-overridable so operators can raise or
// lower the audit window without code changes.
export const ACTION_LOG_MAX_ROWS = envInt("ACTION_LOG_MAX_ROWS", 10_000);

// ── Codebase ARCHITECTURE bounds (OPT-PERF-08) ───────────────────────────
// Max number of top-level exports (exported symbols with no parent) returned
// by an ARCHITECTURE read. The handler fetches them with a SQL LIMIT instead
// of filtering the full symbol set, so the payload never scales with the
// repo's total symbol count. Single source for the tool LIMIT and the
// buildArchitecture() default — keep them in sync.
export const ARCHITECTURE_TOP_LEVEL_EXPORTS_LIMIT = 50;

// ── Dead-code + hotspots bounds (TASK-319, phase dead-code) ───────────────
// Max entries in the ARCHITECTURE `deadCode.unreferenced` array (dead-code
// candidates — truly-dead first, entry-point-excluded after) and `deadCode.
// hotspots` array (top in-degree symbols by reference count). Both are
// output caps only — the text summary still reports FULL counts (dead vs
// entry-excluded) so a capped list never misleads about scale.
export const DEAD_CODE_UNREFERENCED_MAX = 20;
export const DEAD_CODE_HOTSPOTS_MAX = 10;
// Bounded candidate-universe cap for the dead-code scan: only top-level
// symbols (parent_symbol_id IS NULL — exported OR internal) are considered,
// fetched with a SQL LIMIT. Top-level symbols are a small fraction of the
// repo's members, and the architecture read already hydrates the full file
// list — this keeps the dead-code pass O(top-level symbols) instead of
// O(all symbols), mirroring the OPT-PERF-08 aggregate discipline. When the
// cap is hit, `totals.truncated` is set and surfaced in the coverage note.
export const DEAD_CODE_SCAN_LIMIT = 500;

// ── Codebase-read default result limits ───────────────────────────────────
// SEARCH mode default page size (was the schema default of 50 before the
// per-mode defaults were introduced by TASK-316; behavior preserved). CODE
// mode greps file CONTENTS, so a match line is far cheaper to consume than a
// symbol record — 10 matches is a tight default, offset paginates for more.
export const CODEBASE_SEARCH_DEFAULT_LIMIT = 50;
export const CODE_SEARCH_DEFAULT_LIMIT = 10;

// ── Codebase CODE mode (content grep) bounds (TASK-316) ───────────────────
// Snippet width around a match: ~40 chars on each side of the matched
// substring (~80 chars total), ellipsis-padded at line boundaries.
export const CODE_SEARCH_SNIPPET_CHARS = 80;
// Process-shared content cache (multi-agent): bounded by BOTH max entries and
// max bytes, LRU-evicted. Keyed by repo+file_path, validity keyed to the
// codebase_files row checksum (row changed ⇒ content reloaded on next access).
export const CODE_SEARCH_CACHE_MAX_FILES = envInt("CODE_SEARCH_CACHE_MAX_FILES", 256);
export const CODE_SEARCH_CACHE_MAX_BYTES = envInt("CODE_SEARCH_CACHE_MAX_BYTES", 16 * 1024 * 1024);
// Bounded read concurrency while grepping indexed files (mirrors the
// staleness-check STAT_CONCURRENCY pattern — never N parallel reads).
export const CODE_SEARCH_READ_CONCURRENCY = 16;
// ReDoS guard (TASK-344): maximum length of a caller-supplied regex needle.
// V8 has no RegExp timeout and the compiled regex runs per line against
// indexed files (10-100KB minified lines) on the PROCESS-SHARED server, so an
// over-long pattern multiplies the exponential-backtracking surface. Patterns
// longer than this are rejected with the INVALID_REGEX envelope — substring
// mode (the default) is unaffected and remains the safe path. Env-overridable
// (e.g. `CODE_SEARCH_MAX_REGEX_LENGTH=500`) so operators can widen the window
// without code changes.
export const CODE_SEARCH_MAX_REGEX_LENGTH = envInt("CODE_SEARCH_MAX_REGEX_LENGTH", 200);

// ── Codebase graph + file-content bounds (TASK-324, phase codebase-graph-ui) ──
// Dashboard graph endpoints (GET /api/codebase/graph, /symbol/callers,
// /file/content). Edge cap for the code-graph payload: the graph is assembled
// server-side (degree-ranked nodes, edges between the selected subset), so the
// payload stays bounded regardless of repo size. The 400 default sits inside
// the spec's 200-500 window; env-overridable so tests and operators can shrink
// it without code changes (mirrors CODE_SEARCH_CACHE_MAX_BYTES).
export const CODE_GRAPH_MAX_EDGES = envInt("CODE_GRAPH_MAX_EDGES", 400);
// Node (symbol) limits for the graph: default when `limit` is absent, and the
// hard clamp for a caller-supplied `limit`. Degree ranking selects the top-N
// symbols by reference count; edges whose both endpoints are selected are
// shipped, then trimmed to CODE_GRAPH_MAX_EDGES by combined-degree priority.
export const CODE_GRAPH_DEFAULT_NODE_LIMIT = 120;
export const CODE_GRAPH_MAX_NODES = 240;
// File-content line cap: GET/POST /api/codebase/file/content returns at most
// this many lines; `truncated` flags when the file was longer. Env-overridable
// so the truncation test can use a tiny cap.
export const FILE_CONTENT_MAX_LINES = envInt("FILE_CONTENT_MAX_LINES", 2000);

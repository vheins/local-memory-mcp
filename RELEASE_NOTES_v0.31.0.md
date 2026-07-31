# v0.31.0 — FTS5 Memories Search & Async Enrichment

## Key Features

- **FTS5 memories search**: Memories are now indexed in a full-text `memories_fts` table, and a normalized `bm25()` score feeds the hybrid keyword weight of `memory-search`/`memory-read`. Keyword relevance is now a real lexical signal instead of an ONNX vector placeholder — faster and more precise retrieval for exact-term queries.
- **Embedding/KG outbox queue**: Embedding (ONNX) and knowledge-graph (compromise NLP) enrichment for memory/standard/task writes is enqueued transactionally into a SQLite outbox (`queue_jobs`) and drained by an in-process lease worker. Write responses no longer block on inference — p50 write-lock time drops from hundreds of milliseconds to well under 20ms.
- **KnowledgeGraphEntity encapsulation**: All KG SQL is now behind a single entity with transactional cascades — deleting a memory/standard/task atomically cleans up its entities, relations, and observations.
- **Faster SQLite writes**: `synchronous = NORMAL` under WAL, throttled checkpoints, and a staleness cache for index status.
- **Lock-free action logging**: Audit-log writes no longer acquire the file lock; task archival is awaited inline before the tool response.
- **Codebase index no longer blocks on the file lock**: The full index scan runs outside the write lock; the writer acquires the lock per DB batch instead.

## Upgrade Notes

- **Schema migration 9 → 10** (`SCHEMA_VERSION` is now **10**). Two additive migrations apply automatically at startup:
  - **v9 `embedding-queue-jobs`** — creates `queue_jobs` (outbox) with a coalescing index for the embedding/KG worker.
  - **v10 `memories-fts`** — creates the `memories_fts` virtual table and backfills it from existing memories.
  - Both are purely additive; no data is rewritten. Rollback for v9 (if ever needed): `DROP TABLE queue_jobs; DELETE FROM _schema_version WHERE version = 9;` — v10 is kept as-is (additive FTS table).
- **New env vars** (all optional, sensible defaults):
  - `EMBEDDING_QUEUE_BATCH_SIZE` (default 32) — jobs processed per worker cycle
  - `EMBEDDING_QUEUE_POLL_INTERVAL_MS` (default 500) — idle poll interval for the in-process worker
  - `EMBEDDING_QUEUE_LEASE_MS` (default 60000) — job lease window (crash-safe reclaim)
  - `EMBEDDING_QUEUE_BACKFILL_CAP` (default 2000) — rows re-enqueued by the boot-time reconcile
  - `WAL_CHECKPOINT_INTERVAL_MS` (default 10000) — throttle for WAL checkpoint/refresh
- **Deferred enrichment is now eventual**: after a write, the embedding/KG entry appears in the DB immediately (row + outbox job commit atomically), but the embedding vector and KG extraction land within ~5s via the worker. Reads and conflict detection behave identically — the queue only moves enrichment off the write path.
- **Behavior change — awaited archival**: Completed/canceled task archival to memory is now awaited inline (no longer fire-and-forget), so the `task_archive` entry is guaranteed present when the tool response returns.
- **Behavior change — codebase-index lock**: `index_repository` no longer holds the file lock for the full scan; concurrent dashboard/MCP requests to the same DB are far less likely to hit lock conflicts.
- 849 automated tests passing across the full suite.

## Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for the complete per-commit history.

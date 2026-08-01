# v0.31.2 — Locking Hardening & KG Scale

## Key Features

- **Multi-process write locking hardened**: All write transactions now run as `BEGIN IMMEDIATE`, so read-then-write transactions can never hit `SQLITE_BUSY_SNAPSHOT` — the busy_timeout-immune failure behind intermittent "database is locked" errors when MCP servers, the dashboard, the CLI, and the outbox worker share one database. The write lock's acquire race is closed with a promise-chain mutex (exactly one holder proceeds), and `busy_timeout`/`wal_autocheckpoint` were retuned for fail-fast, low-thrash operation.
- **Embedding worker CPU drain fixed**: The worker's 10ms busy-poll loop became exponential backoff with jitter — the idle delay grows up to `EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS` (default 10s) instead of spinning the CPU at 100% on an empty queue.
- **Knowledge Graph relation integrity**: Every relation write (`depends_on`/`extends`/`related_to`) now upserts both endpoint entities before inserting, eliminating `FOREIGN KEY constraint failed` floods from orphan-swept entities. Canceled parents are skipped, and canceling a parent clears its children's `parent_id` so stale snapshots can't re-derive relations from swept documents.
- **Dashboard KG renders at 1358 nodes / 22559 edges**: The canvas renderer caps non-active edges at 2000 with batch drawing, culls off-screen nodes/edges (frustum culling), caches the background gradient and hub-edge lookups, and adds AABB pre-filtering to hit tests — the same data, same interactions, at the current graph scale.

## Upgrade Notes

- **No schema migration** — `SCHEMA_VERSION` remains **10**; no additive migrations apply.
- **No new dependencies** — this is a behavior/tuning release only.
- **New env var** — `EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS` (default `10000`): upper bound of the embedding worker's idle backoff. Leave unset for the default.
- **Behavior notes**: `busy_timeout` is now 5s (was 30s) — writes fail fast instead of blocking the event loop for 30 seconds; correctness comes from `BEGIN IMMEDIATE` transactions. `wal_autocheckpoint` is now 1000 (was 100). KG-Archivist relation writes self-heal by re-upserting swept endpoint entities. The dashboard KG renderer caps rendered non-active edges at 2000 with viewport culling; the data contract and interactions are unchanged.
- Scoped test suites green: 213 real-DB tests across storage/embedding-queue/KG-archivist/memory/standard/task suites, dashboard API suites 22/22, plus 2 new KG FK regression tests.

## Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for the complete per-commit history.

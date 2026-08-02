# TASK-074 — Embedding-queue refactor: split enqueue/backfill out of outbox + review nits

Status: completed · owner: vheins/local-memory-mcp · priority: 3 · phase: refactor

## Description

Pre-existing refactor flagged in the TASK-069-072 review: `src/mcp/embedding-queue/outbox.ts` was 554
lines (violates the 500-line rule). Extract the enqueue helpers + startup backfill into a dedicated
module and apply three review nits. Tracked here (file-based fallback) because MCP task tools were
unavailable to this session.

## Scope

Files (all within allowed scope; TASK-073 in flight on kg-archivist/ — no overlap):

- `src/mcp/embedding-queue/enqueue.ts` — NEW module: payload builders, enqueue helpers, countByStatus, backfill.
- `src/mcp/embedding-queue/outbox.ts` — slimmed to the `Outbox` lifecycle, delegating enqueue/backfill.
- `src/mcp/embedding-queue/worker.ts` — nit 1 (nonEmptyBackoffStreak option) + stale doc ref fix.
- `src/mcp/embedding-queue/index.ts` — barrel re-exports from `./enqueue`.
- `src/dashboard/controllers/KGController.ts` — nit 2 (truncated boundary).
- `src/mcp/tests/embedding-queue.test.ts` — cadence tests.

## Changes

1. **Extraction (500-line rule)**: moved `memoryJobPayload`/`standardJobPayload`/`taskJobPayload`,
   `ENQUEUE_SQL` + `enqueueEmbeddingJob`, `enqueueIfAbsent`, `enqueueMemory`/`enqueueStandard`/
   `enqueueTask`, `countByStatus`, and `backfillMissingVectors` (with `parseStringArray`/`safeJson`)
   into `enqueue.ts`. `Outbox` keeps `enqueue()`, `countByStatus()`, `backfillMissingVectors()` as thin
   delegates; enqueue helpers re-exported from `outbox.ts` for backward compat (tests import
   `enqueueTask` from `../embedding-queue/outbox`). `outbox.ts`: 554 → **207 lines**.
2. **Nit 1 (worker.ts)**: `EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK` is now read once as the
   `nonEmptyBackoffStreak` default in the constructor (`options.nonEmptyBackoffStreak ?? CONST`); the
   `nextDelay()` cadence reads `this.opts.nonEmptyBackoffStreak`. Option documented on
   `EmbeddingWorkerOptions`; `nextDelay` made public (tests/observability, mirrors `runOnce`).
3. **Nit 2 (KGController.ts)**: `truncated = edges.length > KG_MAX_GRAPH_EDGES` (was `>=`) — exact-cap
   accuracy (a graph with exactly KG_MAX_GRAPH_EDGES edges is NOT clipped). Note: `listGraphEdges`
   LIMITs at the cap, so this is a conservative flag per the review instruction.
4. **Nit 3 (backfill tx)**: verified `.transaction(...).immediate()` was already in effect and executes
   the body with BEGIN IMMEDIATE (better-sqlite3 returns the default function from `transaction()` and
   `.immediate()` returns the immediate-mode wrapper which the trailing `()` invokes — confirmed with a
   runtime probe). Preserved as-is in `enqueue.ts`; only migrations.ts:1162 stays deferred.
5. **Tests**: added cadence tests — non-empty backoff after `nonEmptyBackoffStreak` consecutive batches,
   and default env-constant (5) behavior when the option is omitted.

## Verification

- `npx tsc --noEmit` → clean.
- `npx eslint` on all changed files → clean.
- `npx vitest run src/mcp/tests/embedding-queue.test.ts` → 12 passed (incl. 2 new cadence tests).
- `npx vitest run src/dashboard/tests/controllers.integration.test.ts` → 40 passed (KG API + Unified
  Graph API + Queue API + write-lock scope).
- Full suite NOT run (per instruction).

## Notes

- `src/mcp/embedding-queue/types.ts` shows as modified in the working tree but was NOT touched by this
  task — it is a pre-existing TASK-117 import-sweep change (`../types/vector` → `../types`).
- MCP task tools were down; tracking via file fallback per instruction.

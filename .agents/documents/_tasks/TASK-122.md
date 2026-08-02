# TASK-122 — Align MemoryEntity.bulkUpdateMemories structuredData handling with update()

Status: completed · owner: vheins/local-memory-mcp · priority: 2 · phase: implementation

## Summary

Closed the pre-existing asymmetry between the single and bulk memory update paths:
`update()` merged `structuredData` into each row's stored `metadata` JSON blob
(`{ ...existingMeta, structuredData }` via a per-row DB read), while
`bulkUpdateMemories()` silently DROPPED `structuredData` (no per-row merge target).
The bulk path now mirrors single-update semantics exactly.

## Semantics aligned (from source)

- `structuredData` is NOT a set of top-level metadata keys — it is stored as a single
  key `structuredData` INSIDE the `metadata` JSON blob
  (`validation.ts` `mergeStructuredData`: `{ ...metadata, structuredData: structuredData ?? {} }`).
- Single `update()` (`entity.ts` `buildUpdateMap` with `mergeStructuredData=true, id`): reads the
  row's stored metadata, then `result.metadata = { ...existingMeta, structuredData: value }` —
  metadata siblings preserved, `structuredData` key REPLACED (not deep-merged).
- Read path (`base.ts` `rowToMemoryEntry`) splits `metadata.structuredData` back out.

## Changes

- `src/mcp/entities/memory/entity.ts` — `bulkUpdateMemories()`:
  - When `updates.structuredData !== undefined`: per-row path inside the same transaction —
    for each id, `buildUpdateMap(updates, true, id)` (same code as `update()`) reads that row's
    stored metadata and merges the `structuredData` key, then runs a single-id UPDATE with the
    shared `updated_at` timestamp. Non-existent ids contribute 0 changes (same as `update()`).
  - When `updates.structuredData === undefined`: the original single-clause batched
    `UPDATE ... WHERE id IN (...)` path is preserved byte-for-byte (no per-row reads).
  - Param shape `(ids, updates)` and return shape `number` unchanged. `last_used_at`
    NULL-on-create semantics (TASK-129) untouched.
  - Updated the `buildUpdateMap` doc comment that previously claimed bulk "drops it".
- `src/mcp/tests/memory.bulk.test.ts` — 3 regression tests under
  "Memory bulk update structuredData merge (TASK-122)":
  1. bulk WITH structuredData persists as merged per row and matches the single `update()` shape
     (also asserted raw stored metadata JSON).
  2. bulk WITHOUT structuredData leaves `structuredData`/`metadata` unchanged (only target column
     applied).
  3. structuredData-only bulk update preserves existing metadata siblings and REPLACES the
     `structuredData` key (not deep-merge), matching `update()`.

## Decision

Bulk-with-structuredData must degrade from the batched `IN` clause to a per-row loop because the
merge target is row-specific (each row's stored metadata differs). This mirrors the single path's
per-row DB read and is wrapped in the same transaction, so atomicity is preserved. The no-op
`fields.length === 0` guard is kept per path. Absent structuredData, no per-row reads occur —
zero regression risk to existing bulk callers (`memory-delete` archive, dashboard
`MemoriesController`), which never pass structuredData.

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint src/mcp/entities/memory/entity.ts src/mcp/tests/memory.bulk.test.ts` — clean.
- `npx vitest run memory.bulk.test.ts memory.write.test.ts memory.read.test.ts` → 3 files,
  44/44 passed (incl. 3 new TASK-122 tests).
- Working tree: only the two files above changed (157 insertions, 5 deletions); clean base.
- Not pushed; code review + commit come downstream.

## Notes

- Tracked here (file-based fallback) because MCP task tools were unavailable to this session.
- Memory-write-style durable note (MCP down): `structuredData` lives as a key inside the
  `metadata` JSON blob; single `update()` and now `bulkUpdateMemories()` both merge it per row as
  `{ ...storedMeta, structuredData }` (replace, not deep-merge). Any future entity-level bulk
  update with row-dependent JSON must keep the per-row merge pattern.

# TASK-129 — Investigate MemoryEntity.buildInsert hardcoding last_used_at = NULL

Status: completed · owner: vheins/local-memory-mcp · priority: 2 · phase: investigation

## Summary

**Verdict: INTENTIONAL, not a bug.** Documented the rationale in `buildInsert` and pinned the
preserved behavior with a round-trip test.

## Evidence

1. `src/mcp/entities/memory/entity.ts` `buildInsert` (line ~34) hardcodes `last_used_at = NULL` on
   INSERT (shared by `insert()` and `bulkInsertMemories()`).
2. `last_used_at` IS updated after insert by explicit usage paths only:
   - `incrementRecallCount(id)` → sets `recall_count + 1, last_used_at = now` — called by
     `memory-write/update.ts:158` (acknowledge "used") and `memory-write/bulk.ts:61`.
   - `incrementHitCount(s)(id)` → sets `hit_count + 1, last_used_at = now`.
3. The read/search path deliberately NEVER touches `last_used_at`:
   - `memory.read.ts` header: "No hit_count increments on read."
   - `memory.read.ts` search mode: "CRITICAL: No hit_count increment on search."
     Reads are side-effect-free and write-lock-free by design.
4. Downstream consumers already handle NULL correctly:
   - `soul-maintenance.ts:64` decay query: `last_used_at IS NULL OR last_used_at < cutoff`
     (NULL = never explicitly used → decays after `decayAfterDays`).
   - `memory.archive.ts:35` expiry: `COALESCE(last_used_at, created_at)`.
5. Existing test comment documents intent: `soul-maintenance.test.ts:136` — "MemoryEntity.insert
   hardcodes last_used_at = NULL (memories are only timestamped by usage paths such as
   acknowledge/recall)".

Semantics: creation does NOT count as "used"; a memory is marked used only when it is
acknowledged("used")/recalled. Changing `buildInsert` to stamp `last_used_at = now` would break
`soul-maintenance.test.ts` ("treats memories with NULL last_used_at as stale and decays them"),
so the behavior is preserved.

## Changes

- `src/mcp/entities/memory/entity.ts` — added explanatory comment to `buildInsert` (MEM-586 /
  TASK-129): NULL-on-insert is intentional; timestamped only by acknowledge/recall usage paths;
  reads never touch it; NULL handled by decay/archive consumers.
- `src/mcp/tests/memory.write.test.ts` — added round-trip test
  "should CREATE with last_used_at = NULL and only stamp it via the acknowledge usage path":
  asserts `last_used_at === null` after CREATE and non-null + `recall_count === 1` after
  acknowledge("used").

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint src/mcp/entities/memory/entity.ts src/mcp/tests/memory.write.test.ts` — clean.
- `npx vitest run src/mcp/tests/memory.read.test.ts src/mcp/tests/memory.write.test.ts` → 2 files,
  39/39 passed (includes new test; isolated run of the new test: 1 passed).
- Regression: `npx vitest run src/mcp/tests/soul-maintenance.test.ts src/mcp/tests/sqlite.test.ts`
  → 2 files, 34/34 passed.

## Notes

- Tracked here (file-based fallback) because MCP task tools were unavailable to this session.

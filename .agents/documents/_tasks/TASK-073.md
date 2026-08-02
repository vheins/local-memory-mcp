# TASK-073 — KG relation/observation writers: ensureRelation + atomic entity+observation pairs

Status: completed (backend) · owner: vheins/local-memory-mcp

## Problem

Invariant "KG relation writers MUST use ensureRelation" (MEM-482) was violated at HEAD: three
write paths still issued relations/observations as separate autocommit statements, so a concurrent
orphan-sweep (`deleteOrphanEntities`, dashboard worker) could delete an endpoint between the
upsert and the insert → FK warn `Failed to save inspired_by relation` (relations.ts:148) or silent
drop (extract.ts:419), plus a latent `observations.entity_name → entities(name)` FK race.

## Changes

### src/mcp/entities/knowledge-graph.ts

- New `ensureObservation(params)` — analogue of `ensureRelation` for the observations FK: upserts
  the entity AND inserts the observation in a single `BEGIN IMMEDIATE` transaction
  (base.ts `transaction()` is immediate per TASK-064/MEM-475), so the sweep cannot interleave.
  Added a NOTE on `insertObservation` pointing pair-writers at `ensureObservation`.

### src/mcp/tools/kg-archivist/extract.ts

- `saveExtractions` entity+observation pair (was `upsertEntity` + `insertObservation` autocommit)
  → `ensureObservation`.
- `co_mentioned` insert (was bare `upsertRelation`) → `ensureRelation` with known types
  (`entities[i].type` / `entities[j].type`) — idempotent (all INSERT OR IGNORE).

### src/mcp/tools/kg-archivist/relations.ts

- `inspired_by` branch (was `upsertEntity(decision)` + `upsertRelation` autocommit) →
  `ensureRelation` with `from_type: entityTypeByName.get(...) ?? "concept"`, `to_type: "decision"`.
  The standalone decision `upsertEntity` was removed — ensureRelation upserts both endpoints.
- `saveStandardRelations` entity+observation pair (was `upsertEntity` + `insertObservation`
  autocommit) → `ensureObservation`.
- Unchanged: depends_on/extends/related_to already used ensureRelation; their trailing
  `insertObservation` is safe because the edge (committed) protects both endpoints from the sweep.

## Invariant verification (grep across tools/kg-archivist/)

- `upsertRelation` in tools: **0** (only inside the entity).
- `upsertEntity` in tools: **0** (only inside entity methods).
- `ensureRelation`: 4 sites (co_mentioned, inspired_by, depends_on, extends, related_to).
- `ensureObservation`: 2 sites (extract + standard entity loops).
- `insertObservation` in tools: 4 sites, each immediately following a committed `ensureRelation`.

## Regression tests (src/mcp/tests/kg-archivist.test.ts)

New block `KG Archivist — entity+observation pair atomicity (TASK-073)`:

1. **Atomic rollback**: observation insert throws → the entity upsert rolls back (no orphaned
   entity survives) — mirrors the TASK-072 ensureRelation rollback contract.
2. **Simulated orphan sweep (2 connections)**: file-backed store + second better-sqlite3
   connection attempts the real orphan-sweep DELETE between the entity upsert and observation
   insert; the BEGIN IMMEDIATE write lock blocks it (SQLITE_BUSY) → no FK failure, no warn, and
   entity + observation both persist. Regression would have autocommitted the upsert, let the
   sweep delete the orphan, and failed the observation FK.
3. **inspired_by** → decision entity created with type "decision"; edges point at it, endpoints exist.
4. **co_mentioned** → every edge endpoint exists.

## Verification results

- `npx tsc --noEmit`: **PASS**
- `eslint` on the 4 changed files: **PASS**
- vitest `kg-archivist.test.ts`: **55 passed** (was 51; +4 new)
- vitest related suites (embedding-queue, standard, standard.delete, tasks.entities,
  memory.delete): **58 passed**

## Files changed

- src/mcp/entities/knowledge-graph.ts
- src/mcp/tools/kg-archivist/extract.ts
- src/mcp/tools/kg-archivist/relations.ts
- src/mcp/tests/kg-archivist.test.ts

Note: repo tree had many pre-existing uncommitted changes from other in-flight batches
(embedding-queue refactor, import-sweep) — untouched per task scope.

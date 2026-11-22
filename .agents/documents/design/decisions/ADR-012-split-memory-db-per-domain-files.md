# ADR-012 — Split `memory.db` Per Domain Into Five Files

**Date:** 2026-11-22
**Status:** Accepted
**Supersedes:** [ADR-011 — Split `memory.db` Per Domain](ADR-011-split-memory-db-per-domain.md)
**Deciders:** Project owner (decision recorded as `[stated]`)
**Tags:** `storage`, `sqlite`, `wal`, `domain-isolation`, `attach`, `migration`

> **DECISION: split the hot store physically into five SQLite files** attached to one connection — `core.db`, `tasks.db`, `standards.db`, `kg.db`, `observability.db`. `codebase.db` (attached as schema `derived`) and `cold-archive.db` (separate connection) are unchanged. Cross-file work becomes deliberately non-atomic, so every table that is written inside the same transaction as `memories` stays in `core.db`. ADR-011 is superseded. The ADR-009 storage port is **not** a prerequisite for this work.

## Context

### What was decided before

[ADR-011](ADR-011-split-memory-db-per-domain.md) (Accepted 2026-09-19) rejected a per-domain split of `memory.db`. Its grounds were measured, not stylistic: the concurrent-workload benchmark reported **0.0% contention, 0 busy errors, 0 timeouts** across `readers_only`, `writers_only`, `mixed`, and `multi_client`; SQLite WAL serializes all writers regardless of domain, so a file split buys nothing unless distinct domains are written concurrently and one file's writer is the bottleneck. It also recorded three costs of splitting: loss of cross-domain transaction atomicity, impossibility of cross-database foreign keys, and the FTS5 same-file constraint.

### Why it is reopened

**`[stated]`** The owner was shown that the tables are already separated logically per domain, then chose the "split `memory.db` per domain" option, chose `ADR-012` superseding `ADR-011` (rather than amending it), and chose the more granular **five-file** scope.

The re-open is a **decision, not a new finding**. ADR-011's contention measurement is not contradicted by anything in this ADR, and none of ADR-011's three re-open conditions fired:

1. No benchmark at materially higher concurrency showing per-domain `busy`/`timeout`/`lockWait`. The 0.0% result stands unrefuted.
2. No single domain's write volume shown to dominate WAL growth or checkpoint time for the whole store.
3. The ADR-009 storage-port abstraction is **not** implemented. ADR-009 §Neutral states no port is implemented, and §Implementation Notes item 3 is still a roadmap step.

Recording this honestly matters: a future reader must not conclude that contention evidence changed. The decision rests on the owner's preference for physical domain separation (independent files per domain, per-domain backup/restore, smaller hot files) weighed against a technical cost that ADR-011 measured as real. The cost is not eliminated here; it is accepted.

ADR-011's staged-migration plan made the storage port its **first prerequisite** (`ADR-011` §Staged Migration Plan, item 1) and listed port implementation as a re-open trigger (`ADR-011` §Re-open conditions, item 3). **`[stated]`** The owner chose to proceed without it. Trade-Offs Accepted (d) records what that costs.

### What exists today

- One `better-sqlite3` connection opened in the `SQLiteStore` constructor, WAL + `synchronous=NORMAL` + `busy_timeout` on the single file (`src/mcp/storage/sqlite.ts:103-127`), shared by every `BaseEntity` subclass (`src/mcp/storage/sqlite.ts:164-181`).
- `codebase.db` attached as schema `derived` on that same connection (`src/mcp/storage/derived-db.ts:96-119`), holding the codebase family and every `*_vectors` table.
- `cold-archive.db` opened as a separate connection (`src/mcp/storage/cold-archive.ts`).
- `SCHEMA_VERSION = 40` (`src/mcp/storage/migrations/index.ts:45`), 40 raw-SQL migrations applied on that one connection by `MigrationManager.migrate()` at `src/mcp/storage/migrations/index.ts:154-192`.

## Decision

Five physical files, each attached on the existing single connection. One connection, five schemas plus `main`, plus the existing `derived` and cold-archive boundaries.

### File groups

`core.db`

- `memories`
- `memories_fts` (FTS5, external-content)
- `memory_tags`
- `memory_summary`
- `memories_archive`
- `queue_jobs`
- `action_log`
- `reuse_telemetry_hourly`
- `bug_reports`

`tasks.db`

- `tasks`
- `task_comments`
- `claims`
- `handoffs` (see note below)

`standards.db`

- `coding_standards`
- `coding_standards_fts` (FTS5)
- `standard_tags`
- `standard_stack` (see note below)

`kg.db`

- `entities`
- `relations`
- `observations`
- `kg_degrees`
- `entity_names_fts` (FTS5)
- the `kg_degrees` maintenance triggers (`src/mcp/storage/migrations/v22-kg-degree-cache.ts:41-56`)

`observability.db`

- `exploration_observations`
- `exploration_evidence`

### Two tables the five-group list omits

`handoffs` and `standard_stack` appear in ADR-011's inventory but not in the five-group list this decision was scoped with. They cannot live alone, and the constraint decides where they go:

- `handoffs.task_id` carries `FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL` (`src/mcp/storage/migrations/v01-initial-schema.ts:199-213`). Cross-database FKs are impossible (Trade-Offs b), so `handoffs` follows `tasks` into `tasks.db`.
- `standard_stack.standard_id` carries `FOREIGN KEY (standard_id) REFERENCES coding_standards(id) ON DELETE CASCADE` (`src/mcp/storage/migrations/v14-normalized-tag-indexes.ts:62-67`, FK at `:66`) and is populated by triggers on `coding_standards` (`:91-99`), so it follows `coding_standards` into `standards.db`.

Recorded explicitly so the storage-layer task has no ambiguity to resolve.

### Unchanged boundaries

`codebase.db` (`derived`: `codebase_files`, `codebase_symbols`, `codebase_symbols_fts`, `codebase_references`, `memory_vectors`, `task_vectors`, `standard_vectors`), `cold-archive.db` (`cold_memories`), and the `_schema_version` ledger stay where they are.

## Why `queue_jobs`, `action_log`, and `memory_summary` stay in `core.db`

These three are not memories by name, but each is bound to `memories` by a transaction or a JOIN that would break across files.

**`queue_jobs` — one transaction with the memory/task/standard deletes.** `purgeEntityAndCleanup()` runs one `BEGIN IMMEDIATE` transaction that soft-archives memories, hard-deletes standards, cancels tasks, releases claims, expires handoffs, and then deletes `queue_jobs` rows for the purged entities (`src/mcp/utils/purge-entity-cleanup.ts:120-164`, `DELETE FROM queue_jobs` at `:157-162`). Moving `queue_jobs` to another file turns that delete into a second, separately-failable write: a crash between the two leaves a job that re-embeds a deleted entity or re-runs KG extraction for it — exactly the failure the single transaction exists to prevent.

**`memory_summary` — the run marker for a memories sweep.** The maintenance sweep takes one `withExclusiveWrite` and, inside it, decays and archives memories, prunes `action_log`, prunes observations and relations, runs incremental vacuum, and writes the maintenance run marker into `memory_summary` (`src/mcp/services/maintenance-job.ts:132-196`; marker read at `:57-71`, write at `:76-89`). The marker guards the whole sweep's idempotency (`:106-122`). Keeping it in `core.db` keeps it atomic with the memories mutations it guards — the largest, least recoverable part of the sweep. Splitting it out would allow a committed marker in front of an uncommitted memories mutation, which is the one ordering that loses work silently.

**`action_log` — a JOIN to `memories` on three read paths.** `getActionsAfter`, `getRecentActions`, and `getActionById` all `LEFT JOIN memories m ON a.memory_id = m.id` (`src/mcp/entities/action.ts:57`, `:71`, `:119`). `ATTACH` makes that JOIN technically resolvable across files, but ADR-011's read contract requires per-domain reads merged in process, not cross-file JOINs (`ADR-011` §Cross-Domain Reads Without Cross-File JOINs). Keeping `action_log` in `core.db` keeps the existing queries valid with no rewrite and no cross-file read skew; `action_log` is also pruned inside the same maintenance sweep (`src/mcp/services/maintenance-job.ts:156`).

## Trade-Offs Accepted

### (a) Cross-file transactions are not atomic

SQLite has no two-phase commit across attached databases; the repository already documents this for the derived move: the one-time cross-file copy is deliberately **not** wrapped in a transaction because "WAL makes cross-file transactions non-atomic" (`src/mcp/storage/derived-db.ts:396-398`). After this split the following become cross-file:

- **Task→memory archival** reads `tasks` + `task_comments` (in `tasks.db`) and writes `memories` (in `core.db`) under one `withExclusiveWrite` (`src/mcp/tools/task.helpers.ts:190-281`, called from `src/mcp/tools/task-write/update-status.ts:126`). A crash can now land the memory row without the task status advance, or the reverse. Accepted: the operation is retry-driven and the archive path is re-entered on the next status write; T04 adds a reconciliation check rather than claiming atomicity.
- **The maintenance sweep** spans `core.db` (memories, `action_log`, `memory_summary`), `kg.db` (observations, relations, entities), and `observability.db` is read-only there. Formerly one exclusive-write unit; now three files. Accepted: each prune step is independently idempotent and bounded per run (`src/mcp/services/maintenance-job.ts:158-175`), so convergence across cycles is the recovery mechanism.
- **Purge KG cleanup** already runs as a separate best-effort step after the main transaction (`src/mcp/utils/purge-entity-cleanup.ts:174-189`) and stays that way; it now also crosses into `kg.db`. No new failure mode, one more file.

### (b) Foreign keys cannot cross databases

SQLite rejects an FK whose target lives in another database; the derived move omits such FKs for that reason (`src/mcp/storage/derived-db.ts:16-24`). Preserved FKs: `memory_tags`→`memories` (both core, `src/mcp/storage/migrations/v14-normalized-tag-indexes.ts:46-51`), `task_comments`→`tasks` and `claims`→`tasks` and `handoffs`→`tasks` (all `tasks.db`, `src/mcp/storage/migrations/v01-initial-schema.ts:119`, `:232`, `:212`), `standard_tags`/`standard_stack`→`coding_standards` (all standards, `src/mcp/storage/migrations/v14-normalized-tag-indexes.ts:58`, `:66`), `exploration_evidence`→`exploration_observations` (both observability, `src/mcp/storage/migrations/v30-exploration-observations.ts:9`, `:24-26`).

Re-homed: every FK above keeps its target inside the same file, so the grouping is FK-closed by construction. Any future table added across groups must not assume cascade.

### (c) FTS5 stays with its content table

An external-content FTS5 table's shadow tables and its `content=` target must live in the same database (`src/mcp/storage/derived-db.ts:16-19`). Consequence: `memories_fts` in `core.db`, `coding_standards_fts` in `standards.db`, `entity_names_fts` in `kg.db`, `codebase_symbols_fts` already in `codebase.db`. Three FTS indexes now need their own rebuild-and-verify path after the copy, where today one startup path covers `memory.db`.

### (d) The ADR-009 storage port is not a prerequisite

**`[stated]`** Persisted with the decision. ADR-011 required the port first (`ADR-011` §Staged Migration Plan, item 1) and named it a re-open trigger (`ADR-011` §Re-open conditions, item 3); this ADR proceeds without it. Cost: the split is built on the existing single-connection `better-sqlite3` model with hard-coded schema prefixes in entity SQL, constants, and the dashboard services. When the port lands it must absorb that coupling, so this ADR adds debt to ADR-009 rather than discharging it. That debt is accepted as the price of doing the split now.

### (e) Five WALs, five checkpoints, no single snapshot

Each file gets its own WAL and checkpoint policy, and a reader can observe different files at different points in time. Today there is one startup `wal_checkpoint(PASSIVE)` and one throttled checkpoint per `WAL_CHECKPOINT_INTERVAL_MS` (`src/mcp/storage/sqlite.ts:138-144`, `:256-263`). Mitigation already exists in the codebase: `agent-context` does separate per-domain reads and merges them in memory (`src/mcp/tools/agent-context.ts:176-248`, `src/mcp/tools/agent-context-compiler.ts:131-197`), so it degrades to read skew across a few milliseconds, not to a new correctness bug. Backup/restore for a domain is now possible per file, which is the upside.

## Data-Preserving Migration Strategy

Mirror `runDerivedMigration` (`src/mcp/storage/derived-db.ts:400-436`) line for line:

1. **Attach** each target file as its schema, creating the directory and file on first run; idempotent when already attached (`src/mcp/storage/derived-db.ts:96-119`).
2. **Create schema** in every attached file with `CREATE TABLE/INDEX IF NOT EXISTS`, so a retry is safe.
3. **Copy** each table with an explicit column list — the intersection of source and target columns — and `INSERT OR REPLACE` keyed on the primary key (`src/mcp/storage/derived-db.ts:360-369`). A source column missing in the target is a schema-drift error that aborts before any drop (`:361-366`).
4. **Verify** every source row is present in the target by primary key; throw on any missing row (`src/mcp/storage/derived-db.ts:371-382`).
5. **Drop** the `main`-side tables only after **all** tables in the group are copied and verified (`src/mcp/storage/derived-db.ts:421-432`). No partial cutover.
6. **Rebuild FTS** from the content table after the copy (`src/mcp/storage/derived-db.ts:324-326`, called at `:466-472`).
7. **Never wrap the cross-file work in a transaction** (`src/mcp/storage/derived-db.ts:396-398`). Suspend FK enforcement for the copy window and restore it afterwards (`:409-419`), because rows may be inserted child-before-parent.
8. **Rollback = delete the five new files** and keep serving `main`. The copy is additive (`INSERT OR REPLACE`), the `main` tables survive any failure, and the migration retries on the next startup (`src/mcp/storage/derived-db.ts:386-394`).
9. **Idempotent entry:** skip any table already absent from `main` (`src/mcp/storage/derived-db.ts:401-402`), so a database already in the `derived` state, or one partially migrated by a crashed run, converges rather than failing.

**Space reclamation.** Dropping the `main` tables frees pages into the SQLite freelist, not back to the filesystem; `auto_vacuum` is deliberately never set, so it keeps SQLite's default of `NONE` unless an operator converts it (`src/mcp/storage/sqlite.ts:129-135`). Reclaiming that space is a separate, guarded maintenance operation (`AGENTS.md` § Database space reclamation: `VACUUM_ON_STARTUP` or a manual `VACUUM` with every process stopped). This ADR does not authorize an automatic `VACUUM`.

## Risks and Mitigations

| Risk                                                       | Mitigation                                                                                                                                  |
| :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| Data loss if a copy fails partway                          | Verify-by-PK before any drop; additive copy; `main` tables intact until full verification; rollback = delete new files (Strategy 3-8)       |
| Orphan `queue_jobs` re-embedding a dead entity             | `queue_jobs` stays in `core.db` with `memories`; the purge transaction remains single-file                                                  |
| Half-archived task across the task-to-memory boundary      | `withExclusiveWrite` retained; retry-safe re-entry; T04 adds a reconciliation check                                                         |
| Search regression after moving three FTS indexes           | Per-file FTS rebuild after copy, row-count verification, scoped memory/standard/KG search tests                                             |
| Read skew across five files                                | Accepted; `agent-context` already merges per-domain reads in process                                                                        |
| Migration interleaving with a second process or the daemon | Run at startup before entity construction on the exclusive-write path, mirroring `ensureDerivedReady` (`src/mcp/storage/sqlite.ts:146-153`) |
| Migration surface multiplies                               | Schema creation is idempotent per file; copy is table-driven from one table-to-file map; version ledger stays in `main`                     |
| Storage-port debt grows                                    | Accepted explicitly (Trade-Off d); recorded so ADR-009's future work absorbs it                                                             |
| `:memory:` tests break                                     | Explicit choice required: real temp files via `fs.mkdtemp`, or one in-memory DB plus schema-prefix indirection                              |

### `:memory:` test mode needs its own handling

`createTestStore()` constructs `SQLiteStore(":memory:")` (`src/mcp/storage/sqlite.ts:343-345`) and 112 test files use it. A real file per domain cannot be derived from `":memory:"`; `resolveDerivedDbPath()` handles the analogous case by mapping `":memory:"` to `":memory:"` so tests attach a distinct in-memory database and never touch disk (`src/mcp/storage/derived-db.ts:69-78`).

The storage-layer task therefore has two viable options and must pick one deliberately: allocate real temporary files via `fs.mkdtemp` per test store, or keep a single in-memory database with no attach. The second option is only viable if the schema-qualified SQL remains resolvable, which means prefix indirection rather than a hard-coded `core.`/`tasks.` prefix. Either choice must keep the 112-file test contract intact — tests may not silently exercise a different storage layout than production.

## Consequences

**Positive:**

- Each domain owns a file: independent backup/restore, smaller hot files, explicit physical boundaries between memory, task, standard, knowledge-graph, and observability data.
- The split follows an existing, proven mechanism (`ATTACH` + copy + verify) rather than inventing a new one.
- Migration is additive and reversible at the file level, so the blast radius of a failed run is a retried startup, not data loss.

**Negative:**

- Cross-file transactions are non-atomic (Trade-Offs a): archival and the maintenance sweep lose single-transaction guarantees.
- No cross-database foreign keys (Trade-Offs b); every future cross-group table must be validated by hand.
- Five WALs and five checkpoint policies, no single consistent snapshot (Trade-Offs e).
- Three FTS indexes need independent rebuild/verify paths (Trade-Offs c).
- Migration and backup surface multiplies, and the storage-port debt from ADR-009 grows (Trade-Offs d).

**Neutral:**

- `codebase.db` and `cold-archive.db` are unchanged.
- Ownership and scoping are unchanged: every table keeps its current `owner`/`repo`/`is_global` predicates (ADR-008).
- The transport model is unchanged: one process, one connection, one daemon (ADR-010).

## Relationship to Other ADRs

- **ADR-011** — superseded by this ADR. Its evaluation, inventory, and measured 0.0% contention result remain valid as history and are the reason this decision is recorded as an owner choice rather than a technical necessity.
- **ADR-009** — the storage port stays deferred and is **not** a prerequisite here. This ADR does not implement the port; it adds schema-prefix coupling that a future port must absorb.
- **ADR-008** — unaffected. A physical file split does not change `owner`/`repo` scoping.
- **ADR-010** — unaffected, and still the contention mitigation. This split is not justified by contention.

## Implementation Note

Not part of the decision. Follow-up work is tracked as:

1. Storage layer: extend the derived-db mechanism (or a sibling `domain-db.ts`) with the five-group DDL, attach, copy, and verify; qualify entity and dashboard SQL with the new schema prefixes.
2. Data migration: the copy/verify/drop sequence in §Data-Preserving Migration Strategy, tested against a copy of a real database, never the production file.
3. Verification: scoped type-check and lint, the cross-domain atomicity test, maintenance and archival tests, and a row-count comparison before and after against a real data copy.

## References

- `src/mcp/storage/derived-db.ts` — `ATTACH` as `derived`, FTS5 same-file constraint, cross-database FK omission, `copyTable`, `runDerivedMigration`, non-atomic cross-file note
- `src/mcp/storage/sqlite.ts` — single connection, WAL/busy_timeout setup, migration run, `ensureDerivedReady`, `createTestStore`
- `src/mcp/storage/migrations/index.ts` — `SCHEMA_VERSION = 40`, migration runner
- `src/mcp/utils/purge-entity-cleanup.ts` — one transaction across entity cleanup and `queue_jobs`
- `src/mcp/services/maintenance-job.ts` — single-`withExclusiveWrite` sweep and the `memory_summary` run marker
- `src/mcp/entities/action.ts` — `action_log` LEFT JOIN to `memories`
- `src/mcp/tools/task.helpers.ts`, `src/mcp/tools/task-write/update-status.ts` — cross-domain task→memory archival
- `src/mcp/tools/agent-context.ts`, `src/mcp/tools/agent-context-compiler.ts` — per-domain reads merged in process
- `src/mcp/storage/migrations/v14-normalized-tag-indexes.ts`, `v22-kg-degree-cache.ts`, `v30-exploration-observations.ts` — tag, KG degree, and observation tables
- [ADR-011 — Split `memory.db` Per Domain](ADR-011-split-memory-db-per-domain.md) — superseded evaluation, table inventory, contention evidence
- [ADR-009 — Optional Multi-Database Support](ADR-009-optional-multi-database-support.md) — deferred storage port
- [ADR-008 — Global vs Scoped Ownership](ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md) — ownership/scoping
- [ADR-010 — Streamable HTTP Transport](ADR-010-streamable-http-transport.md) — one-daemon/many-client contention mitigation

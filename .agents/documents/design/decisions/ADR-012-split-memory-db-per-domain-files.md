# ADR-012 — Split `memory.db` Per Domain Across Five Files

**Date:** 2026-11-22
**Status:** Accepted
**Supersedes:** [ADR-011 — Split `memory.db` Per Domain](ADR-011-split-memory-db-per-domain.md)
**Deciders:** Project owner (decision recorded as `[stated]`)
**Tags:** `storage`, `sqlite`, `wal`, `domain-isolation`, `attach`, `migration`

> **DECISION: split the hot store physically per domain, across five SQLite files** attached to one connection — the existing `memory.db` keeps the core group as schema `main`, and **four new files** (`tasks.db`, `standards.db`, `kg.db`, `observability.db`) are attached beside it. `codebase.db` (attached as schema `derived`) and `cold-archive.db` (separate connection) are unchanged. Cross-file work becomes deliberately non-atomic, so every table that is written inside the same transaction as `memories` stays in `memory.db`. ADR-011 is superseded. The ADR-009 storage port is **not** a prerequisite for this work.

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

- One `better-sqlite3` connection opened in the `SQLiteStore` constructor, WAL + `synchronous=NORMAL` + `busy_timeout` on the single file (`src/mcp/storage/sqlite.ts:100-135`), shared by every `BaseEntity` subclass.
- `codebase.db` attached as schema `derived` on that same connection (`src/mcp/storage/derived-db.ts:96-119`), holding the codebase family and every `*_vectors` table.
- `cold-archive.db` opened as a separate connection (`src/mcp/storage/cold-archive.ts`).
- `SCHEMA_VERSION = 40` (`src/mcp/storage/migrations/index.ts:45`), 40 raw-SQL migrations applied on that one connection by `MigrationManager.migrate()` at `src/mcp/storage/migrations/index.ts:154-192`.

## Decision

Five physical files in total, one logical hot store: `memory.db` (schema `main`, the core group) plus four files attached on the same connection. One connection, five schemas plus the existing `derived` and cold-archive boundaries. Only four files are new — the split adds `tasks.db`, `standards.db`, `kg.db`, and `observability.db` beside the `memory.db` that already exists.

### File groups

`memory.db` (schema `main`, core)

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
- the `kg_degrees` maintenance triggers (`src/mcp/storage/domain-schema.ts:367-383`, mirroring `src/mcp/storage/migrations/v22-kg-degree-cache.ts:41-56`; recreated per schema by `createDomainTriggers`)

`observability.db`

- `exploration_observations`
- `exploration_evidence`

### Two tables the five-group list omits

`handoffs` and `standard_stack` appear in ADR-011's inventory but not in the five-group list this decision was scoped with. They cannot live alone, and the constraint decides where they go:

- `handoffs.task_id` carries `FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL` (`src/mcp/storage/migrations/v01-initial-schema.ts:199-213`). Cross-database FKs are impossible (Trade-Offs b), so `handoffs` follows `tasks` into `tasks.db`.
- `standard_stack.standard_id` carries `FOREIGN KEY (standard_id) REFERENCES coding_standards(id) ON DELETE CASCADE` (`src/mcp/storage/migrations/v14-normalized-tag-indexes.ts:62-67`, FK at `:66`) and is populated by triggers on `coding_standards` (`:86-114`), so it follows `coding_standards` into `standards.db`.

Recorded explicitly so the storage-layer task has no ambiguity to resolve.

### Unchanged boundaries

`codebase.db` (`derived`: `codebase_files`, `codebase_symbols`, `codebase_symbols_fts`, `codebase_references`, `memory_vectors`, `task_vectors`, `standard_vectors`), `cold-archive.db` (`cold_memories`), and the `_schema_version` ledger stay where they are.

## Why `queue_jobs`, `action_log`, and `memory_summary` stay in `memory.db`

These three are not memories by name, but each is bound to `memories` by a transaction or a JOIN that would break across files.

**`queue_jobs` — one transaction with the memory/task/standard deletes.** `purgeEntityAndCleanup()` runs one `BEGIN IMMEDIATE` transaction that soft-archives memories, hard-deletes standards, cancels tasks, releases claims, expires handoffs, and then deletes `queue_jobs` rows for the purged entities (`src/mcp/utils/purge-entity-cleanup.ts:108-164`, `DELETE FROM queue_jobs` at `:160`). Moving `queue_jobs` to another file turns that delete into a second, separately-failable write: a crash between the two leaves a job that re-embeds a deleted entity or re-runs KG extraction for it — exactly the failure the single transaction exists to prevent.

**`memory_summary` — the run marker for a memories sweep.** The maintenance sweep takes one `withExclusiveWrite` and, inside it, decays and archives memories, prunes `action_log`, prunes observations and relations, runs incremental vacuum, and writes the maintenance run marker into `memory_summary` (`src/mcp/services/maintenance-job.ts:132-196`; marker read at `:57-71`, write at `:76-89`, called at `:178`). The marker guards the whole sweep's idempotency (`:106-122`). Keeping it in `memory.db` keeps it atomic with the memories mutations it guards — the largest, least recoverable part of the sweep. Splitting it out would allow a committed marker in front of an uncommitted memories mutation, which is the one ordering that loses work silently.

**`action_log` — a JOIN to `memories` on three read paths.** `getActionsAfter`, `getRecentActions`, and `getActionById` all `LEFT JOIN memories m ON a.memory_id = m.id` (`src/mcp/entities/action.ts:57`, `:71`, `:119`). `ATTACH` makes that JOIN technically resolvable across files, but ADR-011's read contract requires per-domain reads merged in process, not cross-file JOINs (`ADR-011` §Cross-Domain Reads Without Cross-File JOINs). Keeping `action_log` in `memory.db` keeps the existing queries valid with no rewrite and no cross-file read skew; `action_log` is also pruned inside the same maintenance sweep (`src/mcp/services/maintenance-job.ts:156`).

## Trade-Offs Accepted

### (a) Cross-file transactions are not atomic

SQLite has no two-phase commit across attached databases; the repository already documents this for the derived move: the one-time cross-file copy is deliberately **not** wrapped in a transaction because "WAL makes cross-file transactions non-atomic" (`src/mcp/storage/derived-db.ts:396-398`). After this split the following become cross-file:

- **Task→memory archival** reads `tasks` + `task_comments` (in `tasks.db`) and writes `memories` (in `memory.db`) under one `withExclusiveWrite` (`src/mcp/tools/task.helpers.ts`, called from `src/mcp/tools/task-write/update-status.ts`). A crash can leave either side committed without the other: the lock serializes the compound operation but DOES NOT provide cross-file atomicity. FIX-002 chooses both caller-visible failure state and durable recovery: failed archive attempts set `metadata.archive_pending` on the completed task row and task-write surfaces `archiveStatus: {status:"pending"}`; startup reconciliation re-archives only marked tasks with no existing archive, using `metadata.task_id` / `metadata.task_ids` as the idempotency key. No schema change or migration is required; the bounded pass examines at most `TASK_ARCHIVE_RECONCILE_MAX_TASKS` tasks finished within `TASK_ARCHIVE_RECONCILE_WINDOW_DAYS` (see `src/mcp/services/task-archive-reconcile.ts`).
- **The maintenance sweep** spans `memory.db` (memories, `action_log`, `memory_summary`), `kg.db` (observations, relations, entities), and `observability.db` is read-only there. Formerly one exclusive-write unit; now three files. Accepted: each prune step is independently idempotent and bounded per run (`src/mcp/services/maintenance-job.ts:158-175`), so convergence across cycles is the recovery mechanism.
- **Purge KG cleanup** already runs as a separate best-effort step after the main transaction (`src/mcp/utils/purge-entity-cleanup.ts:174-191`) and stays that way; it now also crosses into `kg.db`. No new failure mode, one more file.

### (b) Foreign keys cannot cross databases

SQLite rejects an FK whose target lives in another database; the derived move omits such FKs for that reason (`src/mcp/storage/derived-db.ts:16-24`). Preserved FKs: `memory_tags`→`memories` (both core, `src/mcp/storage/migrations/v14-normalized-tag-indexes.ts:46-51`), `task_comments`→`tasks` and `claims`→`tasks` and `handoffs`→`tasks` (all `tasks.db`, `src/mcp/storage/migrations/v01-initial-schema.ts:119`, `:232`, `:212`), `standard_tags`/`standard_stack`→`coding_standards` (all standards, `src/mcp/storage/migrations/v14-normalized-tag-indexes.ts:58`, `:66`), `exploration_evidence`→`exploration_observations` (both observability, `src/mcp/storage/migrations/v30-exploration-observations.ts:9`, `:24-26`).

Re-homed: every FK above keeps its target inside the same file, so the grouping is FK-closed by construction. Any future table added across groups must not assume cascade.

### (c) FTS5 stays with its content table

An external-content FTS5 table's shadow tables and its `content=` target must live in the same database (`src/mcp/storage/derived-db.ts:16-19`). Consequence: `memories_fts` stays in `memory.db` with `memories`, `coding_standards_fts` moves to `standards.db` with `coding_standards`, `entity_names_fts` moves to `kg.db` (repopulated from `entities`, a standalone index), and `codebase_symbols_fts` was already in `codebase.db` (`src/mcp/storage/domain-fts.ts:44-53`). The two indexes that change file each need their own rebuild-and-verify path after the copy.

### (d) The ADR-009 storage port is not a prerequisite

**`[stated]`** Persisted with the decision. ADR-011 required the port first (`ADR-011` §Staged Migration Plan, item 1) and named it a re-open trigger (`ADR-011` §Re-open conditions, item 3); this ADR proceeds without it. Cost: the split is built on the existing single-connection `better-sqlite3` model with hard-coded schema prefixes in entity SQL, constants, and the dashboard services. When the port lands it must absorb that coupling, so this ADR adds debt to ADR-009 rather than discharging it. That debt is accepted as the price of doing the split now.

### (e) Five WALs, five checkpoints, no single snapshot

Each file gets its own WAL and checkpoint policy, and a reader can observe different files at different points in time. Today there is one startup `wal_checkpoint(PASSIVE)` and one throttled checkpoint per `WAL_CHECKPOINT_INTERVAL_MS` (`src/mcp/storage/sqlite.ts:146-150`, `:313-322`), and the domain files add `checkpointDomainDbs` (`src/mcp/storage/domain-db.ts:192-197`). Mitigation already exists in the codebase: `agent-context` reads each source separately and merges the candidates in memory (`src/mcp/tools/agent-context.ts:160-205`, ranked by `src/mcp/tools/agent-context-compiler.ts:131-197`), so it degrades to read skew across a few milliseconds, not to a new correctness bug. Backup/restore for a domain is now possible per file, which is the upside.

## Data-Preserving Migration Strategy

Same shape as `runDerivedMigration` (`src/mcp/storage/derived-db.ts:400-436`) — attach, create, copy, verify, drop — with a stricter copy contract and a disk guard. The shipped sequence is `runDomainMigration` in `src/mcp/storage/domain-migration.ts:393-478`, orchestrated by `ensureDomainReady` in `src/mcp/storage/domain-db.ts:226-234`:

1. **Attach** each of the four target files as its schema, creating the directory on first run; idempotent when already attached, checked via `PRAGMA database_list` (`src/mcp/storage/domain-db.ts:120-155`).
2. **Create schema** in every attached file with `CREATE TABLE/INDEX IF NOT EXISTS`, so a retry is safe (`src/mcp/storage/domain-db.ts:164-166`, DDL in `domain-schema.ts`).
3. **Copy** each table with an explicit column list — the intersection of source and target columns. A source column missing in the target is a schema-drift error that aborts before any drop (`src/mcp/storage/domain-migration.ts:242-251`). `INSERT OR IGNORE`, never `INSERT OR REPLACE`, in two passes:
   - `INSERT OR IGNORE INTO <schema>.<table> (rowid, …) SELECT rowid, … FROM main.<table>` preserves each source row's `rowid` so an external-content FTS index stays docid-aligned (`:256-261`; skipped for `WITHOUT ROWID` targets);
   - `INSERT OR IGNORE INTO <schema>.<table> (…) SELECT … FROM main.<table> m WHERE NOT EXISTS (SELECT 1 FROM <schema>.<table> t WHERE <pk match>)` fills rows the first pass skipped because the target `rowid` was already taken by a different row (`:263-268`).

   `OR IGNORE` is deliberate: an existing target row is the post-split version and must win over the `main` snapshot, so a partially migrated store is never overwritten (`:229-230`).

4. **Verify** the target holds at least as many rows as the source, then every source row is present in the target by primary key; throw on any missing row, before any drop (`src/mcp/storage/domain-migration.ts:270-288`).
5. **Drop** the `main`-side objects only after **all** tables are copied and verified: triggers first, then `main`-side FTS indexes, then tables children-before-parents, every statement `DROP … IF EXISTS` and guarded so a concurrent peer's drop cannot fail the run (`src/mcp/storage/domain-migration.ts:340-368`, called at `:455-458`). No partial cutover.
6. **Rebuild and audit FTS** before the drop: `verifyDomainFtsAfterCopy` rebuilds every domain-owned index and requires one document per content row, with one rebuild+audit retry (`src/mcp/storage/domain-fts.ts:194-210`). `memories_fts` is excluded — its content table never leaves `main`.
7. **Never wrap the cross-file work in a transaction** (`src/mcp/storage/domain-migration.ts:376-379`). FK enforcement is suspended for the copy window and restored afterwards (`:430-448`), because rows may be inserted child-before-parent.
8. **Rollback = delete the four new files** and keep serving `main` (`src/mcp/storage/domain-db.ts:219-221`). The copy is additive (`INSERT OR IGNORE`), `main` keeps every source table until the drop phase, and the migration retries on the next startup. This rollback is safe only while `main` still holds the source tables: once the drop phase has run, deleting the files discards the moved data.
9. **Idempotent entry:** skip any table already absent from `main` (`src/mcp/storage/domain-migration.ts:396-401`). When nothing is left to move, the already-split path audits every FTS index and repairs drift instead of trusting it (`:403-422`), so a database already split, or one left behind by a crashed run, converges rather than failing.

**Disk guard.** Before the first write, `assertEnoughDiskSpace` estimates the copy as `(page_count - freelist_count) * page_size` of `main` plus a fixed 16 MiB margin and throws when the volume cannot hold it (`src/mcp/storage/domain-migration.ts:162-201`). Nothing is copied or dropped in that case; the move retries on the next startup. `:memory:` stores skip the guard (`:178`).

**Space reclamation.** Dropping the `main` tables frees pages into the SQLite freelist, not back to the filesystem; `auto_vacuum` is deliberately never set in the constructor, so it keeps SQLite's default of `NONE` unless an operator converts it (`src/mcp/storage/sqlite.ts:137-143`). Reclaiming that space is a separate, guarded maintenance operation (`AGENTS.md` § Database space reclamation: `VACUUM_ON_STARTUP` or a manual `VACUUM` with every process stopped). This ADR does not authorize an automatic `VACUUM`.

### Note — 2026-11-22: this section was corrected after implementation

As originally written, this section prescribed `INSERT OR REPLACE` for the copy (mirroring `copyTable` in `derived-db.ts:360-369`) and described rollback as deleting five new files. The shipped migration does neither, deliberately:

- **Copy** uses two-pass `INSERT OR IGNORE` (`domain-migration.ts:238-297`) instead of `INSERT OR REPLACE`. `OR REPLACE` would overwrite a post-split target row with the stale `main` snapshot when the copy is re-run after a partial failure, and would drop the rowid-preserving first pass that keeps external-content FTS docids aligned.
- **File count** is four new files, not five: the core group stayed in the existing `memory.db` rather than moving to a new `core.db`, so `_schema_version` and the core tables never leave `main`.
- **Disk guard** (step above) is present in the implementation and was absent from the original text.

Two further stale statements were corrected in the same pass and are recorded here rather than silently: §Trade-Offs (c) said **three** FTS indexes need an independent rebuild path when only `coding_standards_fts` and `entity_names_fts` change file (`memories_fts` stays in `main` with `memories`), and the `:memory:` subsection presented two open options for the storage layer when `resolveDomainDbPaths` had already settled it (four distinct in-memory databases, same five-schema layout). Code references throughout were repointed from `derived-db.ts` to the shipped `domain-db.ts` / `domain-migration.ts` / `domain-fts.ts`.

The rest of the contract (verify-by-PK before drop, FTS rebuild before drop, no cross-file transaction, additive/idempotent re-entry, four-file rollback) was written as shipped. This note records the deviation rather than rewriting the section as if it had always described the implementation.

**Implemented 2026-11-22 (FIX-002 / TASK-003).** The §Risks and Mitigations row for the task-to-memory archive once said this work would add a reconciliation check; at the time FIX-002 was filed no such check existed. It now does:

- **Failure is detectable, never swallowed.** `archiveTaskToMemory` / `archiveTasksToMemory` persist `metadata.archive_pending` on every affected task row (same file as the completed status — no schema change, no migration) and re-throw; `archiveCompletedTasks` converts that into a `TaskArchiveOutcome` and the task-write response carries `archiveStatus: {status: "pending", task_ids, recovery: "startup_reconciliation"}` plus a warning sentence. The completion is NOT rolled back — the status was already committed, and re-running the status change would be a no-op that never re-archives.
- **Startup reconciliation is idempotent and bounded.** `reconcileTaskArchives` (`src/mcp/services/task-archive-reconcile.ts`) runs as a deferred startup pass under one `withExclusiveWrite`. It examines at most `TASK_ARCHIVE_RECONCILE_MAX_TASKS` (default 50) marked tasks finished within `TASK_ARCHIVE_RECONCILE_WINDOW_DAYS` (default 30). A task that already has an archive memory — matched on `metadata.task_id` (single) or `metadata.task_ids` (TASK-039 aggregate) — is never archived again; its marker is simply cleared (this is the crash-between-INSERT-and-clear repair). A backlog larger than the cap converges across startups.
- **No atomicity claim.** The pair remains cross-file and non-atomic; the mechanism is detect + `withExclusiveWrite`-serialized, idempotent repair.

## Risks and Mitigations

| Risk                                                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                        |
| :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data loss if a copy fails partway                          | Verify-by-PK before any drop; additive `INSERT OR IGNORE` copy; `main` tables intact until full verification; rollback = delete the four new files (Strategy 3-9)                                                                                                                                                                                                                                 |
| Orphan `queue_jobs` re-embedding a dead entity             | `queue_jobs` stays in `memory.db` with `memories`; the purge transaction remains single-file                                                                                                                                                                                                                                                                                                      |
| Half-archived task across the task-to-memory boundary      | `withExclusiveWrite` retained (serializes the attempt; NOT cross-file atomicity). Failure is surfaced (`archiveStatus` on the task-write response) and marked durably on the task row (`metadata.archive_pending`); the bounded idempotent startup pass `reconcileTaskArchives` re-archives marked tasks that have no archive memory, keyed on `metadata.task_id` / `metadata.task_ids` (FIX-002) |
| Search regression after moving two FTS indexes             | Per-file FTS rebuild after copy, docsize-vs-content-row verification, scoped memory/standard/KG search tests                                                                                                                                                                                                                                                                                      |
| Read skew across five files                                | Accepted; `agent-context` already merges per-domain reads in process                                                                                                                                                                                                                                                                                                                              |
| Migration interleaving with a second process or the daemon | Run at startup before entity construction on the exclusive-write path (`src/mcp/storage/sqlite.ts:161`, `:179`)                                                                                                                                                                                                                                                                                   |
| Migration surface multiplies                               | Schema creation is idempotent per file; copy is table-driven from one table-to-file map; version ledger stays in `main`                                                                                                                                                                                                                                                                           |
| Storage-port debt grows                                    | Accepted explicitly (Trade-Off d); recorded so ADR-009's future work absorbs it                                                                                                                                                                                                                                                                                                                   |
| `:memory:` tests break                                     | Resolved: `resolveDomainDbPaths` maps every domain to `:memory:`, so tests attach four distinct in-memory DBs and keep the same five-schema layout                                                                                                                                                                                                                                                |

### `:memory:` test mode keeps the same layout

`createTestStore()` constructs `SQLiteStore(":memory:")` (`src/mcp/storage/sqlite.ts:417-419`) and 112 test files use it. A real file per domain cannot be derived from `":memory:"`, so `resolveDomainDbPaths()` maps every domain to `":memory:"` (`src/mcp/storage/domain-db.ts:111-118`) and `attachDomainDbs` attaches four distinct in-memory databases (`ATTACH ':memory:' AS tasks`, …) (`:138-155`).

The layout is therefore identical in tests and production — same five schemas, same qualified SQL — and only the backing storage differs; no test touches disk. What keeps the unqualified SQL in the 112 `createTestStore`-using test files working is SQLite resolving an unqualified table name against every attached schema when exactly one database holds it, so `SELECT … FROM relations` still finds `kg.relations` after the `main` copy is dropped. The one thing that does not follow: `sqlite_master` is per-database, so a test that introspects `main.sqlite_master` for a moved table must query the owning schema (`src/mcp/storage/domain-db.ts:57-68`).

## Consequences

**Positive:**

- Each domain owns a file: independent backup/restore, smaller hot files, explicit physical boundaries between memory, task, standard, knowledge-graph, and observability data.
- The split follows an existing, proven mechanism (`ATTACH` + copy + verify) rather than inventing a new one.
- Migration is additive and reversible at the file level, so the blast radius of a failed run is a retried startup, not data loss.

**Negative:**

- Cross-file transactions are non-atomic (Trade-Offs a): archival and the maintenance sweep lose single-transaction guarantees.
- No cross-database foreign keys (Trade-Offs b); every future cross-group table must be validated by hand.
- Five WALs and five checkpoint policies, no single consistent snapshot (Trade-Offs e).
- Two FTS indexes change file and need independent rebuild/verify paths (Trade-Offs c).
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

Not part of the decision. Shipped as:

1. Storage layer: `src/mcp/storage/domain-db.ts` (attach, idempotent schema init, triggers, checkpoints, `ensureDomainReady`) with the static per-group DDL in `src/mcp/storage/domain-schema.ts`, and `Q_TABLE_*` schema-qualified constants in `src/mcp/utils/constants.ts` used by production SQL. Migrations (`MIGRATIONS`) still run against `main` with unqualified `TABLE_*` names; a future migration that alters a moved table must edit the static domain DDL instead.
2. Data migration: the copy/verify/FTS/drop sequence in §Data-Preserving Migration Strategy, in `src/mcp/storage/domain-migration.ts` with FTS handling in `src/mcp/storage/domain-fts.ts`, tested against a copy of a real database.
3. Verification: scoped type-check and lint, the cross-domain atomicity test, maintenance and archival tests, and a row-count plus per-row digest comparison before and after against a real data copy. `src/mcp/tests/domain-placement.test.ts` asserts each domain table lives in its ADR-012 file.

## References

- `src/mcp/storage/derived-db.ts` — `ATTACH` as `derived`, FTS5 same-file constraint, cross-database FK omission, `copyTable`, `runDerivedMigration`, non-atomic cross-file note
- `src/mcp/storage/sqlite.ts` — single connection, WAL/busy_timeout setup, migration run, `ensureDerivedReady`, `createTestStore`
- `src/mcp/storage/domain-db.ts`, `src/mcp/storage/domain-schema.ts` — the shipped attach/schema/trigger/checkpoint layer and the static per-group DDL
- `src/mcp/storage/domain-migration.ts`, `src/mcp/storage/domain-fts.ts` — the copy/verify/drop move and the FTS rebuild/audit paths
- `src/mcp/tests/domain-placement.test.ts` — asserts every domain table lives in its ADR-012 file
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

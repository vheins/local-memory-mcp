# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.41.0] — 2026-08-18

Codebase-index docblock release — symbols are now discoverable by their purpose:
`codebase-read` text output surfaces each symbol's docblock, docblock extraction
is canonicalized across all tree-sitter visitors, and the `.agents/**`
developer/contributor docs tree is indexed so it is searchable like source code.

### Added

- **`.agents/**` dot-directory indexing** (TASK-459) — the codebase indexer now
  discovers files under `.agents` (dev/contributor/AI documentation) via an
  explicit allowlist second stream; every other dot-directory (`.git`, `.github`,
  `.opencode`, `.cache`, …) stays excluded. Covers all entry points (MCP tool,
  dashboard, CLI, startup auto-index, file watcher) since they all funnel through
  `discoverFiles`.
- **`doc_comment` surfaced in all 5 `codebase-read` text formatters** (TASK-460) —
  TRACE (new `Doc:` line), FILE, SEARCH, ARCHITECTURE (new `Top Exports` doc
  block, ~120 chars), and CODE/content modes (enclosing-symbol doc hint via
  `EnclosingSymbol.docComment`) now show each symbol's purpose as a compact
  truncated summary (`src/mcp/utils/doc-comment-format.ts`: `formatDocComment` /
  `docSuffix`); structuredContent JSON unchanged.

### Fixed

- **Docblock normalization across 12 tree-sitter visitors** (TASK-461,
  FIX-462/464-467) — `serializeDocBlock` is now the single canonical path:
  C/C++/Java/Kotlin `/**` blocks, Go `//` runs (incl. `type_spec` via parent
  `type_declaration`), Dart `///` + `/**` runs (`documentation_comment` node
  type), Ruby `#` runs (incl. first-member-of-class-body docs), Rust `///`/`//!`
  runs, Swift `///` runs, and Python triple-quoted docstrings all emit the
  `[DEPRECATED]` + `@tag` contract; `//!`/`#` line markers normalized in
  `serializeDocBlock`; generic-visitor handles `/**` blocks.
- **Vue doc-comment extraction rewrite** (TASK-473) — `extractDocComment` no
  longer appends a stray trailing `/` from the closing `*/` line, the sibling
  scan stops at non-doc content, and the `*/`-branch decrement fix removes the
  infinite-loop regression; single-line `/** */` and `//` docs canonicalized too.

### Tests

- **TASK-460**: doc_comment presence/absence in all 5 formatter suites plus
  `EnclosingSymbol.docComment` (code-search.primitives/repo, get-file-symbols,
  search-symbols, trace-symbol.mode, architecture, mcp-tools.integration.code).
- **TASK-461 + FIX-462/464-467**: docblock-extraction assertions for
  c/cpp/dart/go/java/kotlin/python/ruby/rust/swift visitors — `[DEPRECATED]`,
  `@param`/`@return`, no neighbour-comment bleed; TEST_BUG fixture fixes
  (TASK-468/469/470: dart/go/vue).
- Full suite: 233 files / 2385 tests, all green; type-check + lint clean.

## [0.40.0] — 2026-08-16

Embedding-worker concurrency & MCP resource discovery release — the worker stops
treating transient SQLite `database is locked` as a fatal cycle failure, and
OpenCode/MCP SDK clients can finally enumerate and read the server's resources.

### Added

- **Concrete MCP resources** (TASK-442) — `list_mcp_resources` /
  `read_mcp_resource` / `list_mcp_resource_templates` now return real content
  instead of an empty list: `repository://index` and `session://roots` concrete
  resources, plus collection templates for memories/tasks/summary/actions in
  plain, single-param, and full-query forms, and `memory://{id}` / `task://{id}` /
  `action://{id}` detail templates.
  - Fixed SDK v2 UriTemplate `{?a,b,c}` all-or-nothing matching: sibling
    per-param templates are registered, so realistic reads
    (`repository://x/memories?search=foo`, `?limit=`/`?offset=`) resolve instead
    of returning `ResourceNotFound (-32002)`.
  - Shared `readResource(uri, db, session)` dispatcher with exact-match, repo
    parsing, UUID detail, codebase symbols/files, and unknown-URI rejection.
  - Completion matching generalized to family regexes so every listed URI
    completes without `-32602`.
  - New SDK regression suite `src/mcp/tests/sdk-resources.test.ts` (11 tests)
    driving the real server over `InMemoryTransport` (capability gate, concrete +
    template listing, plain/partial-query reads, completion, unknown-URI).

### Fixed

- **Embedding worker treats SQLite BUSY as transient** (TASK-457) — per-cycle
  `claim`/`complete`/`fail` writes no longer log fatal `[EmbeddingWorker] cycle
failed` when the database is temporarily locked by another process; `isBusyError()`
  classifies `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` / `SQLITE_BUSY_RECOVERY` and
  applies a jittered backoff instead. Transient lock contention no longer counts
  toward a job's attempts/poison limit, and a BUSY-failed job's claim is released
  (token-guarded `Outbox.release()`) so the lease self-heals.
- **Backfill lock-hold shrunk** — startup backfill split from one giant
  deferred transaction into bounded ≤200-row immediate transactions
  (`BACKFILL_TXN_CHUNK`), so a competing writer never outwaits `busy_timeout`.
- **Codebase-index cleanup chunked** — `cleanStaleFiles` writes in ≤200-path
  immediate transactions (`CLEANUP_TXN_CHUNK`).
- **Single-owner backfill by default** — dashboard worker honors
  `EMBEDDING_QUEUE_BACKFILL_CAP` (default 2000, env-tunable; `0` restores
  MCP-server-only), eliminating cross-process startup backfill contention while
  keeping dashboard-only deployments functional.
- **Worker startup logs captured** — file log sink is registered before
  `embeddingWorker.start()`, so startup maintenance/busy errors are no longer
  lost.

### Tests

- **TASK-457**: isBusyError matrix (3 busy codes + negatives), per-job BUSY
  no-poison path, `Outbox.release()` token guard, multi-chunk backfill
  (>200 rows), `cleanStaleFiles` >200 paths — 157 tests across 10 scoped suites
  green; 109/109 for the TASK-442 resource surface.

## [0.39.0] — 2026-08-14

### Added

- **Tolerant `key:value` tag extraction from query fields** (TASK-443) for `standard-read`, `memory-read`, and `codebase-read`. Inline tags such as `language:php stack:laravel tag:a,b` are auto-extracted into structured filters, then stripped from the residual query before FTS — so AI models that ignore structured params still get correct scoping.
  - Arrays union + dedupe; inline scalar wins on conflict; `owner`/`repo` scope is protected from override.
  - Multi-value via comma: `tag:a,b,c` → `["a","b","c"]`. Unknown keys (e.g. `label:`) are left as plain text.
  - `standard-read` keys: `language`/`lang`, `framework`/`stack`, `tag`/`tags`, `context`, `version`, `is_global`.
  - `memory-read` keys: `tag`/`tags` → `current_tags`; `lang`/`language` → `scope.language`; `branch`; `folder`; `path` → `current_file_path`.
  - `codebase-read` keys: `language`/`lang` (CODE/grep mode); `kind` (symbol mode, now OR via `cs.kind IN (...)`); `file`/`path` → `filePath`.
  - New module `src/mcp/utils/query-tags.ts` (`parseTaggedQuery`) + tests `src/mcp/tests/query-tags.test.ts` and `query-tags.integration.test.ts`.
  - Docs: `query` field `.describe()` updated; `AGENTS.md` and `tools-reference.md` (en/id) note inline tagging is supported.

### Fixed

- `memory-read`: inline `lang:`/`folder:` tags now influence affinity ranking (were silent no-ops) — TASK-444.
- `codebase-read`: `kind:function,class` now returns both kinds instead of truncating to the first — TASK-445.
- Added per-tag integration tests for `memory-read` to prevent regressions — TASK-446.

## [0.38.0] — 2026-08-13

Smarter tool output, sidebar navigation, and large-file hygiene release.

### Added

- **task-read / memory-read output (MCP tools)**
  - **All status groups rendered (TASK-421)** — task-read text output no longer hides tasks in non-completed statuses; every status group with matches is shown with per-group counts and a consistent "5 + N more" truncation convention.
  - **Issue-linked filtering (TASK-422)** — new `issue_ref` filter distinguishes tasks truly linked to a GitHub issue (`#NNN`) from fuzzy keyword matches; response rows gain `issue_refs` and `match_reason` (`issue`|`text`); the text summary breaks down linked vs text matches.
  - **Acknowledged-state surfacing (TASK-423)** — memory-read shows `[acked]`/`[unacked]` markers and an `acknowledged` field; unacknowledged (knowledge-debt) memories are boosted in ranking; `task_archive` entries are de-prioritized for work-oriented queries.
  - **Consistent metadata & truncation (TASK-424)** — `[N]` semantics documented per tool (task-read = relevance 0.00–1.00, memory-read = importance 1–5); `(showing N)` and per-group cap conventions unified via a shared legend helper.
- **Dashboard — sidebar navigation (TASK-425)** — Arena, Dashboard, Queue, Standards, and Reference moved out of content-area horizontal tabs into the left sidebar nav: single-source nav model, accessible tablist/`aria-selected` (WCAG), lazy-load preserved, mobile menu closes on navigation.

### Performance

- **File-size hygiene (no behavior change)** — 44 oversized files (>500 lines) split into ~200 focused modules across test suites, dashboard UI, MCP tools/services, parser visitors, entities, and the fts-trigram benchmark. All public APIs, wire contracts, and behavior preserved (verified by test-parity reviews); 37 unused-import lint errors cleared.

### Tests

- **2,326 tests green** (229 files) · type-check clean (tsc + svelte-check) · ESLint clean.

## [0.37.0] — 2026-08-11

Dashboard accessibility & developer-experience release — the result of a full UI/UX audit of every Agent Arena view (TASK-393/394) against the STD-002 dashboard baseline (one h1 per tab, scoped aria-live, focus trap, WCAG AA, real labels), plus a global-mode Queue view and a 50-150x standards-list speedup.

### Added

- Queue tab now works **without a selected repository** — the shell gate is relaxed so the server-wide embedding/KG outbox (by design, all repos) is directly inspectable; the global queue banner explains the scope ("Global queue — jobs from all repos") (TASK-411, TASK-418)
- Unified 11-tab navigation: all views (Arena, Dashboard, Activity, Memories, Tasks, Codebase, Handoffs, Queue, Knowledge Graph, Standards, Reference) are reachable from a single visible top tab-nav with an accessible name (`aria-label="Dashboard sections"`) (TASK-405)
- Scoped `aria-live` regions on async views — Dashboard stats, Memories table, Tasks kanban, Codebase index, Queue jobs — announcing loads/status moves without wrapping the shell (TASK-400)
- Real labels on interactive controls: aria-labels on placeholder-only search inputs (Memories, Reference), unnamed type/importance/page-size selects, and title-only icon buttons (TASK-401)
- Startup observability: embedding-worker backfill logs its global scope (`startup backfill scope: GLOBAL across all repos`) so cross-repo outbox fills are explainable in logs (TASK-412)

### Fixed

- A11y hardening (STD-002) across all views: exactly one h1 in the Codebase empty state; focus trap now restores to the trigger element (root cause: `.focus()` on a detached node silently no-ops, which also caused the post-drawer Tab-freeze — fixed once in the shared trap instead of per-drawer) (TASK-397, TASK-398, TASK-399)
- Arena canvas no longer burns ~26fps while idle — settle-detection + freeze + O(1) wake-check (KG TASK-277 pattern), with wake on viewport/hover/selection/filter/reduced-motion changes including in-place-mutated filter state (TASK-402, TASK-409)
- `sceneSignature` fingerprint upgraded to a 32-bit-safe FNV-1a hash — distinct scene states can no longer collide per-field (TASK-413)
- KGGraphCanvas `ResizeObserver` loop warning eliminated via an idempotent resize guard (ArenaViewportCanvas pattern) (TASK-415)
- MemoryList live-region dedup seeded from the store value — no spurious "Loaded N memories" announcement (TASK-414)
- Tap targets: Memories row actions 28→32px, KG zoom controls ≥32px at 390px (TASK-403)
- Sidebar repo-count contrast 2.77:1 → ~5.9:1 (`#0369a1`, WCAG AA) with dark-theme override (TASK-404)

### Performance

- Standards list first-load **2288ms → 180-315ms** (~50-150x SQL reduction): `total` now uses `COUNT(*)` instead of materializing all matching rows, and migration v25 adds composite `(repo, created_at)` / `(is_global, created_at)` indexes (TASK-406)

### Documentation

- New UI/UX + a11y audit report: `.agents/documents/audits/dashboard-audit-2026-08-11.md` (per-view scores, STD-002 status, priority fixes) (TASK-394)
- Queue server-wide behavior documented in the [Dashboard Guide](https://github.com/vheins/local-memory-mcp/wiki/en/Dashboard-Guide) (TASK-416)

### Tests

- Focus-trap regression tests: post-close Tab freedom + detached-node restore (TASK-399)
- Standard count parity tests: `count()` == `search()` total for plain + FTS paths (TASK-406)
- App shell gate tests: queue renders in global mode, per-repo tabs stay gated (TASK-419)
- `api.queueJobs` repo-optional param tests (TASK-419)

## [0.36.0] — 2026-08-10

### Added

- Codebase index Phase 1.1: schema v23 edge targets — `codebase_references` gains `import`/`extends`/`implements`/`embedding` reference kinds plus the emitter contract (migration v23), and symbols gain the `parent_symbol_id` hierarchy for nested-symbol ownership (TASK-299, TASK-300)
- Multi-language reference edges: 13 visitors / 14 configs — TypeScript/TSX, PHP, Java, Kotlin, Python, Go, Rust, C/C++, Swift, Dart, Vue, Ruby — with the markdown and generic visitors as declaration-only no-ops (TASK-301-313, Wave-1)
- `codebase-read` CODE mode: content grep over indexed files with symbol enrichment and a shared LRU cache (TASK-316)
- Dead-code and hotspots blocks in ARCHITECTURE mode with layered entry-point exclusion (TASK-319, TASK-367, TASK-372)
- Polling file watcher: `ENABLE_FILE_WATCHER` gate, `autoIndexIfStale` integration, mtime/checksum short-circuit, and a per-repo re-entry gate (TASK-322, TASK-354)
- `codebase://` MCP resources: symbols list, symbol detail, and file content with `search`/`kind`/`limit` params (TASK-323, TASK-368-371)
- KG auto-population from the codebase index (TASK-293)
- KG relations confidence (TASK-325): per-kind heuristic writers emit graded edge confidence (1.0 explicit / 0.9 codebase / 0.8 semantic / 0.55 extraction) — migration v24 adds the `relations.confidence` column (REAL, default 1.0, INSERT OR IGNORE first-write-wins backfills existing rows); `codebase_references` extension unchanged (SCHEMA_VERSION 23→24)
- Queue admin API: list, retry, clear, and retry-all operations with optional repo scoping (TASK-296, TASK-360)
- Code-graph backend: file content, callers, and code-graph endpoints (TASK-324, TASK-373, TASK-374)
- Dashboard: Agent Arena 12-column layout engine + minimap + workflow arrows (TASK-249-259, TASK-269-281)
- Dashboard: KG edge confidence labels + opacity buckets (TASK-330); reference kind labels + hierarchy block (TASK-314, TASK-361)
- Dashboard: Codebase FileViewer + CallGraph DAG + IndexStats, with the code-graph force panel via KGGraphCanvas (TASK-328, TASK-329, TASK-385-389); Symbols/Code search toggle (TASK-317, TASK-364-365); dead-code/hotspots sections (TASK-320); Queue tab (TASK-297, TASK-362-363); aggregate overview endpoint + polling backoff (TASK-269, TASK-276)

### Changed

- Testing standardization: project partitioned into unit/integration/e2e/perf — 45+ suites, 158 files / 2288 tests (REFACTOR-TST-001..014)
- CI gate on PR + main: type-check → lint → test (blocking); coverage non-blocking until 70/70/70/60 (TASK-013)

### Performance

- KG degree cache + window-bounded edges: graph load 190s→2s (TASK-268)
- Render budget + settle-freeze wake (TASK-271, TASK-277)
- Neural-renderer draw-pass extraction with a zero-allocation frame path (TASK-383, TASK-384)

### Fixed

- vector/chunk/stub null-prototype + guard fixes (TASK-377, TASK-378, TASK-381); coverage positive-only include partition (FIX-381)
- statsCache KG graph clear repo-prefix (TASK-379); deleteComment 404 asymmetry (TASK-380)
- Dashboard a11y/responsive: mobile hamburger, light-theme contrast, Escape/focus trap, kanban scroll (TASK-270, TASK-272, TASK-278, TASK-279)
- Flaky-test hardening: `waitFor` polling over fixed sleeps (TASK-391); stats TTL boundary (TASK-392)

### Security

- js-yaml CVE pin; dompurify/nanoid bumps (TASK-260, TASK-261)

### Refactored

- Visitor/resource/file splits (TASK-267, TASK-346, TASK-348, TASK-357, TASK-366, TASK-371)

### Documentation

- Full docs sync to shipped state (en+id): Phase 11, CODE mode, dead-code, watcher, resources, KG v24, code-graph UI (TASK-315, TASK-318, TASK-321, TASK-326, TASK-327, TASK-331, TASK-333)
- Doc accuracy sweep + attribution corrections (TASK-282-292)

## [0.35.0] — 2026-08-07

> **Corrected (2026-08-09):** the `trace_symbol` name used below is the legacy alias — the canonical tool is `codebase-read` (`name` → TRACE mode, per ADR-005). Behavior described is accurate; only the tool name is legacy.

### Added

- Codebase search: cross-repo symbol search — `codebase_read` SEARCH mode accepts `repos: string[]` (each value normalized like `repo`; a single `repo` still works, backward compatible). Unscoped queries (neither `repo` nor `repos`) are rejected with a `REPO_REQUIRED` error to prevent cross-tenant leakage — `codebase_symbols` has no owner column, so an unscoped read would span every indexed repo. Results already carry `repo` (#67)
- Codebase index: call-site indexing — new `codebase_references` table (migration v21: `repo`, `symbol_name`, `caller_file`, `caller_line`, `caller_name`, `kind`; indexes on `(repo, symbol_name)` and `(repo, caller_file)`); the TypeScript visitor emits references for `call_expression`/`new_expression`/`import_statement` and the PHP visitor for method calls (`member_call_expression`/`scoped_call_expression`), `function_call_expression`, and `object_creation_expression`; the parse pipeline persists references per file inside the batch transaction (including clean-stale deletion and rename transfer); `trace_symbol` now returns `references[]` from the table merged with the in-memory scan fallback, deduped by call-site file/line (#64)
- Codebase search: FTS5 index now covers the symbol `signature` column (content-backed FTS rebuild migration v18) — signature-aware search for typed languages (#79)
- Codebase search: `searchByPrefix()` symbol lookup backed by a `LOWER(name)` expression index (migration v20) for fast case-insensitive prefix queries (#63)
- Codebase index: `CODEBASE_INDEX_WORKERS` env alias for parse concurrency (0 = auto; precedence: explicit override > `CODEBASE_INDEX_WORKERS` > `CODEBASE_INDEX_PARSE_CONCURRENCY` > default 4) (#65)
- Parser coverage: Rust `const`/`static` items and `pub use` re-exports (alias and `crate::` paths) (#76); Ruby `attr_accessor`/`attr_reader`/`attr_writer` generated methods and `extend`/`include` module mixins (#74); Python `async def`, decorated definitions (decorators prefixed in the signature), and `__all__` exports (#73); Go struct fields (incl. embedded), interface method signatures, method receivers in signatures, and const blocks (incl. iota) (#68); TypeScript interfaces with property/method signatures, type alias RHS previews, enum members, generics in signatures, class properties with visibility + type, decorators, and abstract classes/members (#59); PHP `abstract`/`final`/`readonly` modifiers and PHP 8 attributes (`#[Route(...)]`) in signatures (#62); structured PHPDoc/JSDoc extraction — summary + `@param`/`@return`/`@throws`/`@deprecated` doc-tags, `[DEPRECATED]` marker, searchable via the `doc_comment` FTS column (#66)

### Changed

- Codebase file storage: `upsertFile` collapsed the SELECT + INSERT/UPDATE pair into a single `INSERT ... ON CONFLICT ... RETURNING *` — halves DB round-trips and removes the TOCTOU between check and write (#71)
- Codebase index: `autoIndexIfStale` replaced the full file-row staleness load with a scalar `SELECT MAX(last_indexed_at)` — O(1) memory freshness check (#77)
- Codebase index: `getIndexStatus` collapsed its per-field COUNT/MAX queries into a single scalar-subquery aggregation (#70)

### Performance

- Codebase index: `countLines` uses a character scan instead of `String.split` — no per-file array allocation (#80)
- Codebase index: `getFilesByRepo` gained a slim projection (only `file_path`/`checksum`/`last_indexed_at`) for staleness/planning callers (#72)
- Codebase index: symbol re-index batches delete + insert into a single transaction per parse batch — SAVEPOINT atomicity, no partial writes on failure (#69)
- Codebase search: single-pass `COUNT(*) OVER ()` window for unpaged FTS5 totals, plus a `file_path` index (migration v19) (#75)
- Codebase search: composite index `(repo, exported, parent_symbol_id)` (migration v17) for top-level-export queries (#78)

### Tests

- FTS5-primary regression test pinning BM25 rank ordering over the LIKE fallback (#61)
- Re-index of an unchanged repo completes under 1s (performance regression) (#60)
- Worker-pool `resolveConcurrency` env precedence tests (#65)
- Migration tests for v17–v21
- Parser fixtures for all 6 languages touched this release (Rust, Ruby, Python, Go, TypeScript, PHP)
- Trace references: 1 definition + 2 call sites → definition and exactly the two stored call-site references (#64)

## [0.34.1] — 2026-08-06

> **Entry restored from git history (2026-08-09):** this release was tagged (`v0.34.1`) but never documented in the changelog. The two commits it contained are recorded here.

### Added

- Codebase index: enhanced PHP visitor — properties, constants, `use` statements, enum members, and structured function/method signatures are now indexed (previously only functions/methods/classes)

### Documentation

- Codebase index: index performance optimization options documented (`.agents/documents/operations/codebase-index.md` — e.g. `CODEBASE_AUTO_INDEX=false` to disable auto-index on startup)

## [0.34.0] — 2026-08-04

### Added

- KG dashboard: `graphLimit` query param on `GET /api/kg/graph` — a top-N-by-degree window (positive integer, clamped to `[100, 1000]`, `400` on non-positive/non-integer values) that returns the N highest-degree nodes in a single request, bypassing the pageSize clamp; response meta includes `graphLimit` and omits `page`/`pageSize` in graphLimit mode; when `graphLimit` is absent the legacy `page`/`pageSize` paginated behavior is unchanged (backward compat) (TASK-212, TASK-216)
- KG dashboard: 'Show more' control replaces page navigation — grows the top-N window by `+300` (cap `min(1000, totalItems)`), debounced 150ms, re-fetching only the (bigger) node subset with `includeEdges=false` so the cached repo-wide edge set is reused (TASK-213)

### Changed

- KG dashboard: the graph no longer renders 50-node paginated pages — the default top-N window is the 300 highest-degree nodes rendered as a dense single graph, with a "Top N of M nodes" readout and progressive 'Show more' button; switching repos resets the window to the default (TASK-213)
- KG renderer: the layout render cap now follows the fetched top-N window (`min(graphLimit, 1000)`) instead of the hard 300-node `MAX_FORCE_NODES` cap, so each 'Show more' growth (300 → 600 → 900 → 1000) lays out the full superset; a "Laying out N nodes…" note appears above the default window (TASK-214)

### Fixed

- KG renderer: 'Show more' would have re-rendered the same first 300 nodes regardless of the grown fetch window — the layout cap now follows `graphLimit`, so a grown window (600/900/1000) renders the full superset of nodes (TASK-214)

### Refactored

- KG dashboard: dead `kgPage`/`kgPageSize`/`kgTotalPages` pagination wiring removed from the graph store, loader, and `KGGraph` component (replaced by the `kgGraphLimit` top-N store) (TASK-213)

### Tests

- Integration: `graphLimit` top-N window (top-250 of 260 nodes with `graphLimit` meta), clamping into `[100, 1000]`, and `400` on non-positive-integer values (TASK-212)
- `graphLoader` unit tests migrated to the show-more flow — `graphLimit` sent instead of `page`/`pageSize`, 150ms debounce of rapid clicks, cap at `min(1000, totalItems)`, and no-op once at the cap (TASK-213)

## [0.33.0] — 2026-08-04

### Added

- Dashboard: `includeEdges` query param on `GET /api/kg/graph` — consumers that only need the node set can skip the edge fetch and truncation probe entirely (avoiding a payload of up to `KG_MAX_GRAPH_EDGES`, 4000 edges, per request). Any value other than the exact string `"false"` keeps the current behavior (default `true`) (TASK-197)
- Dashboard: soft-delete read scoping — archived memories are hidden from list and detail reads (`404`) unless `?includeArchived=true`, and canceled tasks are hidden from list reads when no explicit `?status` filter is passed (an explicit `?status=canceled` still returns them) (TASK-209)

### Changed

- Dashboard: single-item deletes for memories/standards/tasks now route through the shared purge + cleanup contract — soft archive/cancel with `queue_jobs` purge, vector removal, and repo-scoped KG cleanup — instead of hard-deleting in place, closing the single-vs-bulk divergence where single deletes removed rows outright while bulk/tool paths soft-deleted (TASK-207)

### Fixed

- Dashboard: HandoffsPanel — explicit parameter type for the handoffs query (TASK-193)

### Refactored

- MCP: memory entity split into a `src/mcp/entities/memory/` directory — `queries.ts` and `search.ts` extracted out of `entity.ts`, which drops from ~770 to ~343 lines (TASK-206, TASK-210)
- Dashboard: System/KG/UnifiedGraph controllers reduced to thin adapters with their business logic extracted into a services layer (`services/system.service.ts`, `services/kg.service.ts`, `services/unified-graph.service.ts`) (OPT-STR-01, TASK-205)

### Performance

- KG graph: extracted a dedicated `graphLoader` (aborts stale fetches on page navigation) and off-screen neural animation now pauses via RAF gating (TASK-189, TASK-190, TASK-191, TASK-192, TASK-194, TASK-195, TASK-196)
- KG graph: on cache-hit page navigation the edge payload is skipped via `includeEdges=false` — the cached edge set is reused and the response's empty edge array never overwrites it (TASK-197, TASK-198)
- KG renderer: five cheap canvas wins — rotation trig precomputed once per frame and shared across projections, per-color fill strings precomputed at module load (zero per-frame allocation), cached signal-halo radial gradients drawn via translate/scale, overlapping particle circles batched into a single path fill, and the dark-mode check hoisted out of the per-edge draw path (TASK-208)
- Kanban: column loads staggered, with the active column fetched before terminal columns (TASK-199)
- Agent Arena: polling interval tightened to 2500ms and paused when the tab is hidden (TASK-201)
- Stats: TTL cache for repo-scoped `GET /api/stats` (OPT-PERF-06, TASK-202)

### Tests

- KG `graphLoader` unit tests (TASK-200)
- Stats TTL cache + KG pagination/truncated integration tests (TASK-202, TASK-203)
- `useKanban` unit tests (TASK-204)
- KG renderer performance/regression tests (TASK-208)
- Single-delete 404 + `includeArchived` regression tests (TASK-209)

### Documentation

- Optimization roadmap findings marked "verified complete" in `.agents/documents/optimization/optimization-roadmap.md` and `.agents/documents/optimization/id/optimization-roadmap.md`

## [0.32.0] — 2026-08-04

### Added

- Dashboard: bulk actions for Tasks & Standards — multi-select, bulk status move, bulk delete with confirmation — mirroring the Memories bulk action (OPT-FEAT-04)
- Dashboard: pagination for KG entity/relation/graph lists with `totalItems`/`totalPages` meta; graph node pages ordered by edge degree (OPT-FEAT-02)
- Dashboard: accurate `truncated` flag on the KG graph via a LIMIT+1 probe, with an "edges truncated" indicator (OPT-FEAT-03)
- Dashboard: `GET /api/metrics` — per-tool dispatch durations, write-handler latency, and embedding latency (p50/p95) via a bounded-reservoir metrics registry (OPT-OBS-01)
- Dashboard: Agent Arena polling gated on tab visibility with an 8s interval via a shared `createVisibilityPoller` (OPT-PERF-02)
- Dashboard: coordination REST endpoints — `GET /api/coordination/handoffs`, `POST /api/coordination/handoffs/status`, `POST /api/coordination/handoffs`, `POST /api/coordination/claims/release` — replacing the legacy tool-name shim (OPT-FEAT-01)
- MCP: content-hash dedup in the embedding queue — no-op/touch updates no longer re-embed or re-extract KG (migration v16, OPT-FLOW-03)
- MCP: FTS5 `entity_names` index bounds KG-context enrichment on read paths (migration v15, OPT-PERF-04)
- MCP: child tables with triggers index tag/stack filters, removing unindexed `LIKE '%…%'` scans (migration v14, OPT-PERF-07)
- MCP: `memory-synthesize` now samples through registered tool names (`memory-read`/`task-read`) and the normalized-args path, seeding its first iteration (OPT-FLOW-02)
- Tests: scoring strategy contracts, visibility poller (jsdom), KG entity-name ranking/cap/fallback, dashboard bulk API, content-hash dedup, `onResourcesMutated` emission, recent-actions feed, metrics registry (TASK-182, TASK-184, TASK-187)

### Changed

- MCP: unified error envelope `toErrorResponse` + `parseArgs` across both transports; handlers keep fail-loud throws, transports convert (OPT-CODE-01)
- MCP: reads never write to `action_log` (POLICY 2) — read tools and dashboard GET endpoints no longer emit audit rows; `claim-manage` LIST also skipped (OPT-PERF-05, TASK-186)
- MCP: delete not-found semantics unified — single-target throws, bulk skips and reports partial success (OPT-CODE-04)
- MCP: id-or-code detail reads resolve in a single lookup by UUID shape (OPT-FLOW-01)
- Dashboard: recent-actions feed is now mutation-only; detail reads vanish from it by design
- Dashboard: services layer extracted under `src/dashboard/services/`; controllers are thin adapters with status-aware `ServiceError` handling (OPT-STR-01)

### Refactored

- DRY: `HybridSearchEngine` unifying 3 search pipelines (OPT-DRY-01); per-kind scoring strategy objects (OPT-DRY-04); shared auto-infer dispatch + `collectEntityIds` (OPT-DRY-06); `buildTableResult` envelope (OPT-DRY-07); `purgeEntityAndCleanup` delete contract (OPT-DRY-03); coordination claim-lifecycle helpers (OPT-DRY-02); `extractActionLog` with entity-aware id routing (OPT-DRY-05); `z.infer` typed tool inputs, no sentinel ids or post-parse casts (OPT-CODE-03)
- Structure: entity dir splits for standard/knowledge-graph/system + extracted KG queries module (OPT-STR-03); migrations registry split into per-version modules v01–v16 (OPT-STR-04); schema barrel consolidation (OPT-STR-05); route filename normalization (OPT-STR-02); dead `handoff.manage.ts` deleted (OPT-CODE-02)
- Performance: KG extractions batched into one transaction per document (OPT-PERF-01); worker existence checks batched per entity kind (OPT-PERF-03); codebase ARCHITECTURE aggregated in SQL with capped exports (OPT-PERF-08); write-lock fast path with `withExclusiveWrite` for compound/read-modify-write bodies (OPT-PERF-09); cold-start fallback folded into a single vector query (OPT-PERF-10); prepared-statement cache + `chunksOf` single 500-chunk bound (OPT-PERF-11, TASK-185); TTL-cached global dashboard stats (OPT-PERF-06); resource-URI derivation reads `structuredContent` (OPT-DRY-08)

## [0.31.3] — 2026-08-01

### Fixed

- **ensureRelation now transactional (TASK-072)**: The 2 endpoint upserts + relation insert in `ensureRelation` are wrapped in a `BEGIN IMMEDIATE` transaction — closing the residual FK window where a concurrent orphan-sweep from a second process could delete an endpoint between upsert and insert, and with it the last remaining path behind the reported "Failed to save depends_on relation" on multi-process setups. Behavior otherwise identical (all `INSERT OR IGNORE`, idempotent; nested-transaction safe via better-sqlite3 savepoints).
- **Embedding queue backpressure (TASK-069)**: Backfill is now gated on queue depth — skipped when `pending + claimed >= EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE` (default 500, env-overridable) so a deep queue is no longer double-refilled at every restart, and the backfill inserts ONLY rows absent from `queue_jobs` (`INSERT ... ON CONFLICT DO NOTHING`) so live rows keep their `attempts`/`backoff_until` — FK-poisoned jobs now respect exponential backoff to poison instead of retrying immediately. The worker's drain cadence is size-driven: after `EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK` (default 5) consecutive non-empty batches it backs off to `pollIntervalMs`, and the maintenance log now includes queue depth (pending/claimed/done/poison/total).

### Performance

- **KG graph payload bounded server-side (TASK-070)**: `listGraphEdges` returns top-N edges by endpoint degree (capped at `KG_MAX_GRAPH_EDGES`, default 4000, env-overridable) via a degree CTE instead of a 3-way join + sort over ALL relations, and `listRelationsForGraph` filters edges to those whose both endpoints are in the selected node subset (empty subset → `[]`) — the dashboard payload now scales with the node cap, not total edge count. `/api/kg/graph` adds a `truncated` flag when edges are clipped; migration v12 adds the composite index `idx_relations_repo_from_to` on `relations(repo, from_entity, to_entity)` to serve the filtered joins.
- **queue_jobs index + shorter done retention (TASK-071)**: Migration v11 adds `idx_queue_jobs_status_updated` on `queue_jobs(status, updated_at)` covering the `countByStatus` GROUP BY and the purge DELETE on `(status, updated_at)` — no more full scans; done-row retention shortened 24h → 6h (`EMBEDDING_QUEUE_DONE_TTL_MS`), poison rows stay at 7d.

### Tests

- **TASK-069**: 2 new backpressure regression tests (deep-queue gate prevents double-refill; backfill preserves live backoff and inserts absent rows only) — embedding-queue 10/10.
- **TASK-070**: 5 new graph-cap tests (degree top-N cap, below-cap passthrough, node-subset filter, empty subset, legacy behavior) — kg-archivist 49/49; controllers.integration 26/26 (graph endpoints return 200 with `edges` + `truncated` field).
- **Verification**: `tsc --noEmit` and eslint clean across all four fixes; full suite green.

## [0.31.2] — 2026-08-01

### Fixed

- **SQLite write locking (TASK-064)**: All write transactions now use `BEGIN IMMEDIATE` (`db.transaction(fn).immediate()`) — read-then-write transactions can no longer fail with `SQLITE_BUSY_SNAPSHOT`, the busy_timeout-immune error behind the intermittent "database is locked" under multi-process writes (MCP servers, dashboard, CLI, outbox worker).
- **WriteLock acquire race (TASK-064)**: `withLock` now serializes concurrent acquisitions through a promise-chain mutex — two callers can no longer both pass the `locked` check and burn minutes of `proper-lockfile` retries; exactly one holder proceeds.
- **Embedding worker CPU spin (TASK-064)**: The 10ms tight drain loop was replaced with exponential backoff + jitter — idle delay grows `poll * 2^streak` up to `EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS` (new env var, default 10s) with 0.5–1.0 jitter, eliminating the 100% CPU spin on an empty queue.
- **SQLite tuning (TASK-064)**: `busy_timeout` 30000 → 5000 (fail fast; correctness comes from IMMEDIATE transactions, not a long busy wait) and `wal_autocheckpoint` 100 → 1000 (~4MB checkpoints instead of ~400KB thrash).
- **KG-Archivist FK constraint failures (TASK-065)**: `depends_on`/`extends`/`related_to` relations now route through `KnowledgeGraphEntity.ensureRelation`, which upserts BOTH endpoint entities (global name PK) before inserting the relation — relations can no longer reference orphan-swept entities and flood `FOREIGN KEY constraint failed`.
- **Canceled-parent relation leak (TASK-065)**: `saveTaskRelations` skips parents with status `canceled` (mirroring the worker's status check), and canceling a parent now clears its children's `parent_id` (`TaskEntity.clearChildrenParent`) so reprocessed child snapshots can't re-derive relations from swept documents.

### Performance

- **KG graph render at 1358 nodes / 22559 edges (TASK-063)**: Non-active edges are capped at `MAX_RENDERED_EDGES = 2000` and batch-drawn in a single canvas path (1 draw call vs N); viewport frustum culling skips off-screen nodes and edges (100px margin); the background radial gradient is cached while dimensions/theme are unchanged; hub-edge lookups are pre-computed into a map (O(1) per signal spawn instead of an O(E) filter); click/move hit-testing applies an AABB rejection before distance checks.

### Documentation

- **docs/id ↔ docs/en sync (TASK-060)**: All 13 Indonesian docs re-synced to the English source of truth (fixing stray CJK characters and a stale Knowledge Graph section), the 2 missing optimization docs translated (FTS5 + offload-embeddings), and `README.id.md` rewritten to mirror `README.md`.

### Tests

- **TASK-064**: 213 real-DB tests green across storage (79/79), embedding-queue (8/8), KG-archivist, memory/standard/task suites; `router.test.ts` mock updated to expose the `transaction(fn).immediate()` API (FIX-16) matching better-sqlite3 v12.
- **TASK-065**: 2 new KG regression tests — sweep-parents repro (endpoint + edge recreated, zero "Failed to save depends_on relation" warns) and canceled-parent skip; `tasks.entities` 11/11 covering `clearChildrenParent`.
- **TASK-063**: Dashboard API suites 22/22; `eslint prefer-const` fix in `signals.ts` (FIX-17).

## [0.31.1] — 2026-08-01

### Fixed

- **Incremental reindex — parse only changed files**: `createIndexPlan` now emits `action: "skip"` for files whose mtime falls inside the pre-filter window, and every parse candidate must pass an SHA-256 checksum confirmation before the parser is invoked. An unchanged repository run now parses ZERO files instead of re-parsing the whole tree.
- **mtime ambiguity false-skip (FIX-15)**: The mtime pre-filter now uses a 2000ms ambiguity margin (`MTIME_AMBIGUITY_MARGIN_MS`) to cover coarse-granularity filesystems (ext3 1s, FAT 2s); ambiguous mtimes fall through to read + checksum instead of being skipped, so a quick edit no longer leaves stale symbols.
- **Staleness checksum confirmation**: `checkStaleness` confirms ambiguous mtimes with a checksum inside the window instead of trusting mtime alone (TASK-055).
- **WASM resource leak**: `try/finally` now guarantees `tree.delete()`/`parser.delete()` run even when `extractSymbols` throws, hoisted to parser creation (TASK-053).
- **Grammar load dedup**: Concurrent `Language.load` calls for the same grammar are deduplicated via an in-flight map, eliminating redundant WASM initializations.
- **Crash containment at startup**: `server.ts` registers `unhandledRejection`/`uncaughtException` handlers; a failure before `serverStarted` flips true exits with code 1 instead of hanging on a half-initialized process (TASK-051).

### Performance

- **Incremental parse pipeline**: The 3-phase batch loop (read + checksum without parse → checksum-skip and rename detection → parse only changed/new candidates) keeps unchanged repositories at zero parse work while steady-state re-indexes touch only what actually changed.
- **Bounded memory**: File and symbol inserts are flushed per batch via `writeParseBatch`, with the batch capped to the parser semaphore concurrency — the repository is no longer accumulated in memory before write.

### Refactored

- **parse-pipeline.ts extraction**: The 3-phase parse loop moved out of `indexing-repository.ts` into a dedicated `parse-pipeline.ts` module (`runParsePipeline`); `indexing-repository.ts` dropped from 599 to 323 lines and is now a thin orchestrator (discover → compare → skip-count → pipeline → renames → stale cleanup).

### Tests

- **New coverage**: Grammar in-flight dedup and startup `exit(1)` on pre-start failure (TASK-054), plus staleness ambiguity-window checksum confirmation. Full suite green: 853 tests.

## [0.31.0] — 2026-08-01

### Added

- **FTS5 memories search**: New `memories_fts` virtual table (schema migration v10) feeding a normalized `bm25()` score into the hybrid keyword weight of `memory-search`/`memory-read` — lexical hits now contribute a real keyword signal instead of an ONNX vector placeholder, matching the SPEC-001 hybrid blend used by standards search.
- **Embedding/KG outbox queue**: Memory, standard, and task writes now enqueue embedding + compromise KG enrichment into a SQLite outbox (`queue_jobs`, schema migration v9) transactionally with the row write. A new in-process lease worker (`EmbeddingQueueWorker`) drains the queue off the write-lock path, so expensive ONNX inference no longer blocks the write response.

### Fixed

- **Cross-repo tag-affinity recall**: `memory-search` tag filtering now honors tag affinity across repositories and respects configured fetch limits instead of dropping or over-fetching matches.

### Refactored

- **KnowledgeGraphEntity**: All KG SQL encapsulated in a single entity with transactional cascades — entity/relation/observation deletes now cascade atomically from memory/standard/task deletion paths.
- **Shared search utils**: Scoring, summary, vector, and constants logic extracted into shared `utils/` modules (`scoring.ts`, `summary.ts`, `vector.ts`, `constants.ts`) with bulk read methods added.
- **Single dispatch core**: `buildExecutors` is now the one tool-dispatch core shared by the MCP-protocol adapter and the native SDK transport; `codebase.index.ts` renamed to `codebase-index-sdk.ts`. Backward-compat aliases (`claim-release`, `task-update`) resolve to canonical executor keys.
- **Zod-derived tool contracts**: Tool `inputSchema` JSON Schema now derives from the Zod schemas via `inputSchemaFromSchema` — edit the Zod schema, never the derived schema. Removes ~700 lines of duplicated, drift-prone schema definitions.

### Performance

- **SQLite**: `synchronous = NORMAL` (SQLite's documented recommendation under WAL), throttled WAL checkpoints (10s interval), staleness cache for index status, and async codebase-index IO.
- **Locking**: Reentrant write lock (`WriteLock.withLock`), lock-free action logging (append-only `action_log` INSERTs never acquire the file lock), and task archival now awaited inline before the tool response.
- **codebase-index dispatch**: The full index run is no longer a WRITE_TOOL — heavy CPU scan work no longer holds the file lock; the indexing writer acquires the lock per DB batch instead.

### Removed

- **Dead code**: ~600 lines removed across 55 files — unused helpers (`memory.helpers`, `task.manage` remnants, `git-scope`, `test-path.js`, `test.mjs`), stale references to deleted codebase-index handlers, and lint/type-check findings.

### Tests

- **Embedding-queue coverage**: New `embedding-queue.test.ts` covering the outbox enqueue/lease worker lifecycle, plus mock updates for the dispatch refactor. Full suite green: 849 tests.

## [0.26.0] — 2026-07-26

### Added

- Knowledge Graph zoom in/out via mouse wheel, pinch gesture, and toolbar buttons
- Knowledge Graph drag to rotate camera angle
- Zoom level indicator with reset button in toolbar
- Auto-rotation pauses on user interaction, resumes after 3s idle

## [0.25.9] — 2026-07-26

### Fixed

- Trace endpoint 500 error — `includeReferences` now uses `z.coerce.boolean()` to handle string "true"/"false" from URL query parameters

## [0.25.8] — 2026-07-26

### Fixed

- Dashboard JS crash "not iterable" on file tree click — API returns `{ file, symbols, total }` object but frontend expected flat array; now properly extracts `.symbols` array from response

## [0.25.7] — 2026-07-26

### Fixed

- Dashboard JS crash "not iterable" — added `?? []` fallback guards to all `{#each}` blocks to handle Svelte 5 `$derived.by` momentary undefined state

## [0.25.6] — 2026-07-26

### Fixed

- Vue grammar WASM now properly bundled in npm package via tree-sitter-vue-wasm dependency

## [0.25.5] — 2026-07-26

### Fixed

- Dashboard JS crash "n is not a function or its return value is not iterable" — fixed $derived → $derived.by in CodebaseSymbolList

## [0.25.4] — 2026-07-26

### Added

- Vue (.vue) file parser support — Vue SFC components now properly indexed with script, template, and style extraction

## [0.25.3] — 2026-07-26

### Fixed (P0)

- Search dropdown now visible — fixed CSS overflow clipping the absolute-positioned dropdown
- File tree click now shows symbol list — wired CodebaseSymbolList into CodebasePage
- Nested directories now expandable — architecture depth increased from 3 to 5

### Added (P1)

- Language breakdown in overview — badge row with icon, count, percentage bar
- Top-level exports section — clickable chips for exported symbols
- Symbol references/trace in detail panel — grouped by file with line numbers
- Per-kind symbol counts in file tree badges — compact f12 c3 i5 format
- Stale index indicator — warning badge with progress bar and prominent re-index button

## [0.25.2] — 2026-07-26

### Fixed

- Dashboard REST API handlers now auto-inject `owner` from repo string or git remote before calling codebase-index MCP tool schemas. Fixes dashboard "Failed to load codebase" for index_status, index_repository, and other codebase tools.

## [0.25.1] — 2026-07-26

### Fixed

- query_graph tool now accepts optional `owner` parameter, defaulting to query without owner filter when not provided. Fixes dashboard "Failed to load codebase" error.

## [0.25.0] — 2026-07-26

### Added

- **query_graph tool** — fusion memory KG + codebase index into a single unified graph for neural animation. Queries entities/relations from KG tables and symbols/files from codebase index, without duplicating any data. Supports `type_filter` parameter.

## [0.24.0] — 2026-07-26

### Fixed

- **Lock conflict on concurrent index requests** — shared `indexingRepos` Set prevents auto-index and manual index from competing for the same DB lock
- **retryDbWrite now uses exponential backoff** for lock-related errors (3 retries: 1s, 2s, 4s) instead of a single 100ms retry

### Added

- **Line numbers in codebase index tools** — `search_symbols`, `codebase_search`, `get_file_symbols`, and `trace_symbol` now display `start_line` and `end_line` in output, showing symbol positions within files

### Changed

- **Consistent schema across codebase-index tools** — all tools now accept explicit `owner` parameter and `repo` is normalized via `normalizeRepo` transform, matching task/memory/standard conventions

## [0.23.0] — 2026-07-25

### Added

- **KG edge animation**: Flowing dash animation (`setLineDash([4, 4]`) with time-based `lineDashOffset` on edges connected to hovered or selected nodes — creates a cinematic signal-flow effect.
- **KG edge clarity**: Non-active edges now render at 0.08 opacity (was full opacity) to reduce visual clutter in dense knowledge graphs. Hovered/selected node edges highlight at full opacity.

### Fixed

- **KG double-centering**: `project3D()` was adding `(cx,cy)` on top of force-layout centering, pushing all nodes bottom-right. Now subtracts center offset before projection.
- **KG neural rendering**: Additive blending (`globalCompositeOperation='lighter'`) applied to node glows, hub flashes, hub outer glows, and hub edges — creating neural web glow effect.
- **KG node visibility**: Increased `BASE_NODE_RADIUS` (5→9) and `HUB_NODE_RADIUS` (8→13). Lowered label threshold (0.3→0.15) so labels appear sooner.
- **KG node softness**: Radial gradients changed to 3-stop fade (bright center → color → transparent edge) for point-sprite-style soft dots.
- **Entity quality filter**: Added `isValidEntityName()` in `kg-archivist.ts` — rejects garbage NLP fragments (punctuation, code snippets, size refs, pure-symbol names).
- **Graph edge sparsity**: Co-occurrence `co_mentioned` relations now created between entities extracted from the same memory content, increasing edge count.

## [0.22.1] — 2026-07-25

### Added

- **3D Neural KG visualization**: Knowledge Graph canvas now renders nodes as glowing neural dots with perspective projection, signal pulses, and hover/selection label pills.
- **Generic text visitor**: `GenericTextVisitor` supports 80+ file extensions for codebase indexing — any text-based file with a registered extension gets parsed for symbol extraction.
- **Markdown visitor**: New visitor extracts headings from `.md`/`.mdx` files as indexable symbols.
- **Extended language support**: `.svelte`, `.vue`, and `.astro` files now parsed via the TypeScript parser.
- **`trace_symbol` dual input**: Now accepts either `name` or `symbol` parameter (previously `name` only).
- **`index_status` markdown output**: Status report now includes a rich markdown summary table.
- **`search_symbols` NL fallback**: Falls back to natural language fuzzy matching when exact/camelCase/prefix searches find no results.

### Fixed

- **KG neural dot rendering**: Nodes reduced from 18/26px to 5/8px radii for a cleaner neural aesthetic. Labels hidden by default, shown only on hover or selection.

## [0.21.0] — 2026-07-25

### Added

- **`codebase_search` MCP tool**: Natural language FTS5 full-text search across indexed codebase. Accepts natural language prompts — no exact symbol name required. Supports filtering by repo, kind, and file path. Complements `search_symbols` (5-tier name ranking) with semantic content search.
- **`codebase_search` symbol vectors**: Symbol-level TF-IDF vector embeddings enable ranked relevance search alongside name-based matching.
- **Knowledge graph API endpoint**: New unified `/api/graph` endpoint for structured entity-relationship visualization in the dashboard.
- **FTS5 full-text search for `coding_standards`**: Standards registry now indexed via FTS5, enabling full-text search across stored coding standards.

### Fixed

- **Stub vector TF-IDF storage**: `memory-stub-vector` now stores actual TF-IDF vectors instead of zeroed placeholders, enabling meaningful similarity search.
- **Logger local timezone**: Log timestamps now use local timezone offset (`+07:00`) instead of UTC `Z`, matching local environment expectations.
- **Tree-sitter-dart WASM ABI**: Rebuilt from source for ABI compatibility with current tree-sitter grammar API.
- **`memory_summary` PK migration**: Schema version 2→3 migration rebuilds `memory_summary` primary key to fix `ON CONFLICT` errors.

### Performance

- **Dashboard export streaming**: Paginated queries with owner scoping for large dataset exports — reduces memory pressure.
- **Nested gitignore discovery**: Recursive `.gitignore` resolution with symlink-safe `stat()` calls and dynamic concurrency throttling for indexing.
- **Lazy-load tree-sitter grammars**: WASM grammars loaded on first use instead of at startup — reduces initial memory footprint by ~80%.
- **MCP startup timeout**: Vector model initialization now awaited with 30s timeout — prevents silent startup failures.

### Refactored

- **`normalizeToolArguments` deduplication**: Shared utility replaces duplicated normalization logic across tool handlers.

### Dependencies

- **Tree-sitter-dart grammar**: Compiled WASM grammar added for Dart language parsing support.

## [0.20.4] — 2026-07-23

### Added

- **Multi-language parsing (codebase-index)**: Full tree-sitter AST parsing for 11 new languages — Go, Python, PHP, Rust, Java, Dart, Kotlin, Ruby, Swift, C, and C++. Each language has a dedicated visitor that extracts functions, classes, interfaces, enums, methods, and type aliases from source code.
- **Registry-based parser architecture**: `TreeSitterParserPool` now uses a `LanguageConfig` registry pattern — adding a new language requires one entry in `createRegistry()` and one visitor file. Extension-to-config and grammar-to-visitor maps are built at construction for O(1) lookup.
- **30 visitor tests**: New `visitors.test.ts` with positive-extraction tests covering all 11 new languages (functions, structs/classes, interfaces, methods).
- **`getSymbolCountByRepo` aggregate method**: Single `COUNT(*)` query replaces N+1 per-file symbol counting in `getIndexStatus()`.
- **Parallel WASM loading**: All grammar WASM files loaded concurrently via `Promise.allSettled`, reducing startup latency.
- **`parser.setTimeoutMicros()`**: Native tree-sitter cancellation replaces non-functional `Promise.race` timeout mechanism.
- **10MB file size guard**: Files exceeding 10MB are skipped before `readFileSync` to prevent OOM.
- **Atomic stale cleanup**: Stale file deletion (symbols + files) now wrapped in a single `withWrite` transaction.
- **File discovery extensions**: Added `.dart`, `.kts`, `.cc`, `.cxx`, `.hh`, `.hxx` to the extension-to-language map.

### Changed

- `LanguageVisitor` interface: replaced `parse()` with `extractSymbols(tree, sourceCode)` — visitors receive pre-parsed tree-sitter AST trees instead of raw source. `supportedExtensions()` removed from interface (registry is the single source of truth for extension mapping).
- `CONCURRENT_PARSE_BATCH` reduced from 20 to 4 to match the semaphore concurrency limit, eliminating uncontrolled queuing pressure.

## [0.20.3] — 2026-07-22

### Fixed

- **Dashboard file tree**: Replaced static placeholder with live `CodebaseFileTree` component wired to `/api/codebase/architecture` endpoint.
- **Zod schema coercion**: `includeSymbolCounts` query param now correctly coerces string to boolean (`z.coerce.boolean()`) — was causing HTTP 500.
- **Symbol count badges**: Fixed property name mismatch (`symbolCount` → `symbolCounts` dict with summed values) so file counts display correctly in tree.
- **isIndexed gate**: Corrected field name from `isIndexed` to `indexed` in `CodebaseIndexStatus` check — was preventing tree render on first load.

### Added

- **`codebaseArchitecture` API method**: New method in dashboard API client for typed access to `/api/codebase/architecture`.
- **Typed `ArchitectureData` interface**: Replaces opaque `Record<string, unknown>` casts with a properly typed state interface.
- **Separate file/symbol selection**: File tree selection and search bar selection now use independent state (`selectedFile` vs `selectedSymbol`).

## [0.20.1] — 2026-07-22

### Fixed

- **Dashboard "Index Now" button**: Was a no-op placeholder; now calls `codebaseReindex` API and reloads index status after triggering.
- **search_symbols registration**: MCP tool `search_symbols` was missing proper tool definition in server registration — added with correct schema.
- **repoPath auto-resolution**: `repoPath` no longer required from the UI. Server resolves it automatically from `CODEBASE_REPOS_DIR`, CWD parent, or candidate directory checks.

## [0.20.2] — 2026-07-22

### Fixed

- **Codebase tab**: Now correctly shows indexed data (was calling wrong API method).
- **Dashboard index-status check**: Now uses correct gate (was checking truthy object instead of `isIndexed` flag).

## [0.20.0] — 2026-07-22

### Added

- **Codebase Index**: tree-sitter WASM parser for TypeScript/JavaScript/TSX/JSX with language-specific visitors extracting functions, methods, classes, interfaces, types, enums, and variables.
- **Codebase Index**: file discovery with gitignore and glob support — `fast-glob` stream mode, custom include/exclude patterns, default exclusions for build artifacts.
- **Codebase Index**: SQLite-backed symbol storage with FTS5 full-text search — two new tables (`codebase_files`, `codebase_symbols`) with auto-synchronized FTS5 virtual table via database triggers.
- **MCP Tools**: 6 new tools — `index_repository` (incremental with SHA-256 checksums), `search_symbols` (5-tier ranked search), `get_file_symbols` (per-file declarations), `get_architecture` (directory tree + language breakdown), `trace_symbol` (definition + references), `index_status` (index state check).
- **Dashboard**: Codebase tab with file tree, symbol explorer, search bar, and index status.
- **CLI**: `--index` flag for server startup indexing with progress output.
- **Docs**: API reference, feature guide, and operations guide for Codebase Index.

## [0.19.24] - 2026-07-20

### Fixed

- **Bulk task-create NULL id**: Fixed bug where `resolveEntityCode()` deduplication of task codes (e.g., `FIX-1` → `FIX-1-0e14`) caused `localCodeMap` lookup to return `undefined`, inserting NULL primary keys. Tasks with NULL `id` then caused `NOT NULL constraint failed: claims.task_id` on claim attempts. Fix uses `randomUUID()` fallback and maps resolved code back into `localCodeMap`.

## [0.19.17] - 2026-07-12

### Fixed

- **memory-acknowledge tool description**: Added explicit usage example (`{ code: "MEM-123", status: "used" }`) to tool description and Zod schema `.describe()` to prevent agents from inventing incorrect parameter names like `relevant=false`.

### Changed

- **Tool definitions type-check**: Minor.

## [0.19.16] - 2026-07-12

### Fixed

- **Zod schema type coercion**: All number fields (`importance`, `priority`, `limit`, `offset`, `est_tokens`, `minImportance`, `ttlDays`, `max_iterations`, `max_tokens`) now use `z.coerce.number()` to accept both string and number inputs. Fixes `"expected number, received string"` errors when MCP frameworks serialize numeric params as strings.

## [0.19.2] - 2026-07-06

### Added

- **kg-backfill tool**: Batch scan all existing memories/standards and extract KG entities via compromise NLP. Supports per-repo or full-database operation. Run once to populate the Knowledge Graph from historical data. Backfilled 425K+ entities across 45 repos.

### Fixed

- **Handoff owner validation**: Handoff tools (`handoff-create`, `handoff-list`, `task-claim`, `claim-list`, `claim-release`) now gracefully handle missing `owner` parameter when MCP clients connect without workspace roots. Zod schemas fall back to empty string instead of throwing `invalid_type`.

## [0.19.1] - 2026-07-06

### Refactored

- **Icon.svelte**: Extracted SVG icon data to `lib/icons/iconData.ts`. Reduced from 1739 to 33 lines.
- **KGGraph.svelte**: Decomposed into `KGForceLayout.ts`, `KGCanvasRenderer.ts`, `KGModal.svelte`. Reduced from 1076 to 527 lines. Force layout uses `Map` lookup (O(1) vs O(n²)).
- **ExportToolbar**: Shared component extracted from duplicate export buttons in KanbanBoard and MemoryList.
- **RepoItem**: Shared component extracted from duplicate pinned/unpinned repo item templates in RepoSidebar.
- **Chat logic**: Duplicate `sendChat` code in App.svelte and FloatingChat.svelte unified via `createChatTask()` utility.
- **DetailDrawer**: Replaced fragile `$$props` introspection with explicit `drawerMode` prop (Svelte 5 readiness).

### Fixed

- **Inline SVGs**: Replaced 5 locations with centralized `<Icon>` component (KanbanBoard, TaskDetailPanel, DetailDrawer, MemoryList).
- **Magic numbers**: Named constants for timeouts (`TAB_SWITCH_DEBOUNCE_MS`, `DRAWER_CLOSE_TRANSITION_MS`, `ARENA_INIT_DELAY_MS`).
- **Error states**: Added error banners to MemoryList and StatsWidget.
- **Cryptic names**: Renamed `raStore`/`raPage` → `actionsStore`/`actionsPage` in FloatingChat.
- **Duplicate icon**: `memory` icon now unique (chip design) instead of subset of `brain`.
- **Accessibility**: Added `role="tablist"`, `role="tab"`, `aria-selected`, and `aria-live="polite"` to tab navigation.

## [0.19.0] - 2026-07-06

### Added

- **SDK Migration**: Migrated from custom JSON-RPC to `@modelcontextprotocol/server` v2 beta. All 27+ tools registered via `registerTool()`, resources/prompts via SDK. Replaced custom `MCPClient` with SDK `Client` + `StdioClientTransport`.
- **Agentic Tools**: 3 new agentic productivity tools — `agent-context` (session context recall), `decision-log` (structured decision persistence), `session-summarize` (session archive).
- **Upstream Inspiration**: The Knowledge Graph feature reimplements the entity/relation concept of `Beledarian/mcp-local-memory`; the alias names `remember_fact`, `remember_facts`, `recall`, `forget` were design intent only and never shipped (corrected 2026-08-08).
- **Knowledge Graph**: 3 new database tables (`entities`, `relations`, `observations`) with cascading FK constraints. 5 CRUD tools (`create-entity`, `delete-entity`, `create-relation`, `delete-relation`, `delete-observation`) with SQLite transactions and FK validation.
- **NLP Archivist**: Automatic entity extraction via `compromise` library (people, places, organizations, concepts) on every memory-store — zero-dependency, local-only.
- **Time Tunnel**: Relative date filtering in `memory-search` — supports "today", "yesterday", "last week", "last month", "last N days", "last hour".
- **Soul Maintenance**: Biological-style memory decay engine with tag-based immunization. Startup maintenance job sweeps decayed memories (24h dedup).
- **Dashboard Knowledge Graph**: Interactive force-directed canvas graph (custom Canvas 2D renderer) with type-colored nodes, edge labels, tooltip inspection, and Add/Delete Entity/Relation modals.

### Changed

- **Protocol Layer**: `server.ts` reduced from 398 lines to 91 lines using SDK's `serveStdio()`. Session, progress, cancellation, completion, and log notifications wired to SDK.
- **Tool Registration**: All tool handlers moved from `router.ts` switch-case to `tools/index.ts` via `registerTool()`. Write-lock, action logging, and resource mutation notifications handled centrally.

### Fixed

- **Lint Hygiene**: 22 unused-variable and dead-code issues resolved across 9 files.
- **Test Client**: `MCPClient` now uses SDK `Client` + `InMemoryTransport` — removed 236 lines of custom JSON-RPC client code.

## [0.18.1] - 2026-06-23

### Fixed

- **Required `owner` Parameter**: Fixed 5 MCP tool schemas where `owner` was optional with `default("")`, causing SQL queries to silently return no results. `task-detail`, `task-update`, `task-delete`, `claim-release`, and `standard-store` now require a non-empty `owner` string. MCP input schemas updated to expose the `owner` parameter.
- **Argument Order Bug**: Fixed `isTaskCodeDuplicate` call in `task.manage.ts` that was passing `repo` in the `owner` parameter position, silently disabling duplicate task code detection.
- **Wrong Owner Attribution**: Fixed `handoff.manage.ts` that was storing the repo name (`owner: repo`) instead of the actual owner (`owner: owner`) in task comments during claim operations.

## [0.18.7] - 2026-06-23

### Fixed

- **Memory Entity Owner Fallback**: Added conditional owner filtering in `searchByRepo()`, `getRecentMemories()`, `getTotalCount()`, and `getAllMemoriesWithStats()` — same fix pattern as task entity. Methods now skip the `owner = ?` clause when owner is empty, preventing cross-owner invisibility.

### Changed

- **Memory Entity**: All 4 list/query methods now handle empty owner consistently, matching the task entity pattern.

## [0.18.6] - 2026-06-23

### Changed

- **Owner Field Descriptions**: Updated all 20 `owner` field descriptions in MCP tool definitions to explicitly warn agents NOT to use their agent name as the owner. Added "Owner Rule (CRITICAL)" section to server instructions with examples and violation consequences. Added warning log when owner is inferred from session.

## [0.18.5] - 2026-06-23

### Fixed

- **getTaskByCode Fallback**: When querying by task_code with a specific owner fails, automatically retry without the owner filter. This ensures tasks created via the Dashboard (with empty owner) can be found by MCP API calls (which pass non-empty owner), and vice versa.

## [0.18.4] - 2026-06-23

### Fixed

- **Migration Dedup SQLite Syntax**: Fixed `OFFSET 1` without `LIMIT` in deduplication query, which caused `SQLITE_ERROR` on databases with existing duplicate task codes.

## [0.18.3] - 2026-06-23

### Fixed

- **Migration Auto-Deduplication**: Fixed migration to automatically deduplicate existing (owner, repo, task_code) rows before creating the UNIQUE INDEX, instead of throwing an error and blocking startup.

## [0.18.2] - 2026-06-23

### Fixed

- **Task Code Duplication**: Added database-level UNIQUE constraint on `(owner, repo, task_code)` to prevent duplicate task codes. Added clear error handling for constraint violations.
- **Owner Consistency**: Fixed `getTaskByCode`, `isTaskCodeDuplicate`, and `getExistingTaskCodes` to handle empty owner strings consistently, resolving "Task not found" errors for tasks created via the dashboard with empty owner.
- **Search Consistency**: Fixed `task-search` to produce identical results in text and structured modes by using explicit all-status enumeration.
- **task-list Status Filter**: Added `"all"` option to `status` parameter documentation, allowing listing all task statuses in a single call.

## [0.17.0] - 2026-06-23

### Added

- **Multi-Owner Support**: Added `owner` field across all entities — memories, tasks, standards, handoffs, claims, comments, and summaries. All tools now accept an `owner` parameter. Repo names can optionally be specified as `owner/repo` format, which auto-parses via `parseRepoInput`.
- **Owner-Scoped Code Generation**: Sequential codes (`TASK-001`, `MEM-001`, `STD-001`) are now scoped per-owner per-repository instead of per-repository only, preventing code collisions across different users/organizations sharing the same repo name.
- **Improved Schema Validation**: `required_skills` and `fsm_gates` metadata validation now produce clearer, multi-line error messages for better debugging.

### Changed

- **Database Schema**: Added `owner TEXT NOT NULL DEFAULT ''` column to all tables (`memories`, `tasks`, `standards`, `handoffs`, `claims`, `task_comments`, `memory_summary`, `memories_archive`, `action_logs`). `memory_summary` primary key changed from `repo` to `(owner, repo)` composite key.
- **Code Generator**: `generateNextCode()` now requires an `owner` parameter; SQL queries filter by both owner and repo.
- **Tool Schemas**: All tool input schemas updated with optional/default `owner` field (store, search, recap, detail, delete, summarize, synthesize, acknowledge, manage).
- **Tests**: All test suites updated to include `owner` in mock data and assertions. 283 tests passing across 34 test files.
- **Dashboard Controllers**: API endpoints updated to pass `owner` through to entity operations.

## [0.17.0] - 2026-06-23

### Added

- **Auto-Promote on Claim**: `task-claim` now automatically transitions the task status to `in_progress` when the current status is not `completed`, and records a comment with the claiming agent and status transition metadata.

## [0.16.0] - 2026-06-09

### Added

- **6 Software Engineering Analyst Roles**: New slash command prompt definitions for structured SDLC workflows:
  - **Scrum Master** — Sprint planning, retrospectives, backlog grooming, and impediment resolution.
  - **Business Analyst** — Stakeholder requirement extraction, user story mapping, and acceptance criteria writing.
  - **System Analyst** — Architecture design, database schema planning, and API contract design.
  - **QA Analyst** — Test scenario design (positive/negative/monkey/security), QA execution, and regression testing.
  - **Data Analyst** — Data modeling, query optimization, schema planning, and migration testing.
  - **Security Analyst** — Security triage, vulnerability assessment, penetration test planning, and threat modeling.
- **Agent Labels**: Server instructions now display an `agent:` label next to each prompt, enabling clients to display role badges.

### Changed

- **Prompt Pagination**: Increased default limit from 25 to 50 to accommodate the growing prompt library.

## [0.15.0] - 2026-06-07

### Added

- **Sequential Auto-Generated Codes**: Task, memory, and standard codes are now auto-generated when omitted. Patterns: `TASK-001`, `MEM-001`, `STD-001` (sequential per repository).
- **Optional `task_code`**: No longer required during task creation. Omit to get a sequential `TASK-xxx` code, or provide a custom code as before.
- **`suggested_skills` Field**: Tasks can now carry a `suggested_skills` array. The task-memory-executor prompt reads this field and loads each skill via the `skill()` tool before execution.
- **Cross-Reference Resolution**: `depends_on` and `parent_id` now auto-resolve task codes within the same batch creation request, eliminating ordering constraints.

### Changed

- **Memory Codes**: Replaced random 6-char codes with sequential `MEM-001` format.
- **Standard Codes**: Replaced random 6-char codes with sequential `STD-001` format.
- **Prompt Tests**: Updated assertions to match current FSM prompt formatting.
- **Documentation**: Updated `tools-reference.md` (EN/ID) and workflow prompts to reflect optional `task_code`, sequential codes, and `suggested_skills`.

## [0.14.10] - 2026-06-03

### Fixed

- **Cross-Reference Resolution**: `depends_on` and `parent_id` in bulk task creation now auto-resolve task codes within the same request batch.

## [0.14.7] - 2026-06-03

### Changed

- **Delete Confirmations**: Replaced all native browser `confirm()`/`alert()` with SweetAlert2 modals across the dashboard UI. Delete confirmations now use styled, theme-aware dialogs.

## [0.14.6] - 2026-06-03

### Fixed

- **Dashboard Icons**: Resolved 13 broken icon references across the Svelte UI. Added 10 missing SVG icon definitions to `Icon.svelte`. Replaced nonexistent icon names (`x-circle`, `trash-2`, `edit-2`, `pencil`, `circle-alert`, `save`, `loader`, `check-check`) with valid equivalents. svelte-check: 0 errors.

## [0.14.5] - 2026-06-03

### Added

- **Bulk CRUD**: Bulk create, read, update, delete for memories and coding standards.
- **N+1 Elimination**: Optimized query patterns to eliminate N+1 in bulk operations.
- **Parent Code Resolution**: `parent_id` now accepts task codes and standard codes, resolved to UUIDs before storage.

## [0.14.4] - 2026-05-24

### Changed

- **Prompt Definitions**: Aligned all 25 prompt definitions with skill files from vibe-coding-premium. Arguments made required where appropriate, added context resolution removal, FSM pipeline format for technical-planning, blueprint orchestration and sprint plan import sections for create-task, standardized commit format with keyword-based issue references.

## [0.14.3] - 2026-05-22

### Security

- **protobufjs**: Updated to v7.5.8 via override to fix 8 advisories (code injection, DoS, prototype pollution, etc.).
- **brace-expansion**: Updated to v5.0.6 via override to fix DoS vulnerability.
- **svelte**: Updated to v5.55.9 to fix 4 XSS/ReDoS advisories.

## [0.14.2] - 2026-05-22

### Fixed

- **DocuBook Branding**: Corrected display name from "Docubook" to "DocuBook" in Reference tab ecosystem section.

## [0.14.1] - 2026-05-22

### Fixed

- **Brand Name**: Corrected "Docubook" to "DocuBook" in changelog.

## [0.14.0] - 2026-05-22

### Added

- **Ecosystem Section**: Added "Ecosystem" as a Reference category filter with TopBar navigation and dedicated section showing partner tools (DocuBook).
- **FloatingChat**: Replaced QuickCreateFAB with a WhatsApp-style floating chat popup (380x560px) for quick backlog task creation.
- **Chat Input**: Added send panel to Activity tab for creating backlog tasks directly from chat input.
- **Donation Link**: Added coffee/donation link (teer.id) to TopBar external links group.
- **Handoffs Redesign**: Redesigned handoffs as a table (From, To, Task, Summary, Status, Created, Expires) with slide-over DetailDrawer, matching Standards/Memory pattern.
- **Security & Entity Refactoring**: Security fixes, entity refactoring, WriteLock improvements, StubVectorStore fallback, task-search tool, ttlDays fix.

### Changed

- **Sidebar Navigation**: Moved global nav (Agent Arena, Dashboard, Standards, Reference) to sidebar above Repositories; tab bar stays visible regardless of active sidebar nav tab.

### Fixed

- **Chat Flow**: Chat input now stores message in description while title is auto-generated (Chat · HH:mm); full refresh triggered after send.
- **Reference Tab**: Fixed not loading when clicked from sidebar nav by watching `$app.tab` reactively.
- **Standards Drawer**: Fixed not opening due to null `selectedStandard` — using sentinel object for mode detection.
- **Table Background**: Added solid background to tables to prevent transparency issues.
- **Svelte 5**: Replaced `bind:value` with `value + on:input` for Svelte 5 compatibility.
- **Sidebar Scroll**: Fixed scroll visibility and handoff loading stuck issue.
- **Misc**: Changed "Donasi" to "Donate" in TopBar; added taskStats/taskComments mocks to router tests.

## [0.13.2] - 2026-05-20

### Added

- **Code-based Lookup**: Added optional `code` param to `memory-update`, `memory-delete`, `memory-acknowledge`, `standard-update`, `standard-delete` tools.
- **Task Code Lookup**: Added optional `task_code` param to `task-delete` tool.

### Fixed

- Fixed pre-existing bug in `TasksController` passing null `commit_id` to Zod schema.

## [0.13.1] - 2026-05-14

### Changed

- **Task Executor**: Replaced weak `Repeat` step with `Loop → CONTINUOUS EXECUTION MODE` — agent now loops through pending/backlog/stale/handoff until queue is truly empty.

## [0.13.0] - 2026-05-11

### Added

- **Task Git Traceability**: Added `commit_id` and `changed_files` columns to tasks table for git commit traceability.
- **task-update**: Schema now accepts optional `commit_id` (string) and `changed_files` (string array) when marking tasks as completed.
- **Task Archive**: Archived memory now includes commit hash and changed files list.

## [0.12.1] - 2026-05-10

### Changed

- **task-list**: Added `phase` column to non-structured summary output for better task discovery.

## [0.12.0] - 2026-05-05

### Added

- **Dashboard Theme**: Added automatic light/dark switching based on time of day while preserving manual override.

### Changed

- **Dashboard UX**: Clarified Standards and Handoffs tabs with better labels, summaries, and status context.
- **Theme Toggle**: Kept the existing manual toggle and added `Shift+click` to return to auto mode.

## [0.10.11] - 2026-04-30

### Changed

- **Task Executor**: Updated runner identity resolution to support multiple terminal sessions by using provided `agent_identity` or auto-generated `<runner>-<randomName>` identity from active CLI/IDE with session token.
- **Task Executor**: Explicitly requires the same runner identity to be written into claim/update/handoff metadata for better cross-session attribution.
- **Prompts**: Preserved dependency-aware execution checks while making runner identity configurable and session-aware.

## [0.10.10] - 2026-04-30

### Changed

- **Task Executor**: Enforced dependency-aware execution order in `task-memory-executor` by requiring `depends_on` and `parent_id` prerequisites before execution and adding blocked-task skipping logic.
- **Task Executor**: Added readiness re-check after hydration so unresolved dependencies are re-evaluated before claim.
- **Prompts**: Added prompt-level regression test coverage for dependency-aware execution and readiness checks.

## [0.10.8] - 2026-04-28

### Changed

- **Prompts**: Reduced sub-agent spawn limit from 4 to 2 in `task-memory-executor` prompt to improve focus and reduce overhead.

## [0.10.7] - 2026-04-28

### Changed

- **Agent Arena**: Made in-progress agents visibly busy with typing arm movement, body motion, head bobbing, and key-tap effects.

## [0.10.6] - 2026-04-28

### Added

- **Agent Arena**: Added status-aware animated monitor screens for workstations, including active coding, pending docs, blocked terminal, and idle displays.

## [0.10.5] - 2026-04-28

### Fixed

- **Agent Arena**: Kept Therapy Room handoff animations and beds inside room bounds by sharing clamped slot positioning between scene layout and rendering.

## [0.10.4] - 2026-04-28

### Fixed

- **Agent Arena**: Prevented active claimed tasks from being marked stale and sending agents to the Therapy Room while work is still in progress.

## [0.10.1] - 2026-04-27

### Changed

- **Agent Standards Gate**: Strengthened server, tool, and prompt instructions so `standard-search` is mandatory before code edits, test edits, refactors, migrations, or implementation decisions.

## [0.10.0] - 2026-04-27

### Added

- **Dashboard Standards**: Added JSON export and import flows for coding standards so standards can be moved between devices.
- **Dashboard API**: Added standards export/import endpoints with upsert semantics and large import support for thousands of standards.

### Changed

- **Dashboard**: Increased JSON payload capacity and skips vector refresh automatically for large standards imports to avoid migration timeouts.

## [0.9.17] - 2026-04-27

### Changed

- **Prompts**: Made `standard-search` mandatory for every `task-memory-executor` task loop iteration before implementation, including decomposed and sub-agent tasks.

## [0.9.15] - 2026-04-25

### Fixed

- **Agent Arena**: Fixed handoff animation stuck on pickup phase due to time base mismatch (Date.now vs performance.now).
- **Agent Arena**: Ensured agents remain in a 'resting' visual state in the therapy room after arrival instead of resetting to normal sprites.

## [0.9.14] - 2026-04-25

### Added

- **Agent Arena**: RPG-style characters with detailed sprites (shoes, pants with walk swing, shirt, swinging arms, head with gradients).
- **Agent Arena**: Realistic room environments with 6 distinct floor textures and room-specific furniture (sofa, reception desk, clock, whiteboard, hazard sign).
- **Agent Arena**: Animated workstations with monitors and typing animation.
- **Agent Arena**: Ambient lighting overlays per zone.

### Changed

- **Agent Arena**: Implemented biome logic for arena floor rendering.
- **Agent Arena**: Increased Vite chunk size limit for complex dashboard UI.

## [0.9.13] - 2026-04-25

### Added

- **Agent Arena**: gather.town-style 2D world with walking agents and specialized rooms.
- **Agent Arena**: Organic wander behavior for idle agents in the Lobby.
- **Agent Arena**: Handoff beams with animated particles.

## [0.9.12] - 2026-04-25

### Added

- **Dashboard**: Added "Agent Arena" tab for real-time agent activity visualization using high-performance canvas rendering.

## [0.9.11] - 2026-04-25

### Added

- **MCP**: Injected server instructions into MCP initialize response to improve agent behavior alignment.

## [0.9.10] - 2026-04-25

### Changed

- **Prompts**: Clarified task priority semantics across all agent prompts.

## [0.9.9] - 2026-04-25

### Added

- **Dashboard**: Added coordinated dashboard orchestration flow.

## [0.9.8] - 2026-04-25

### Added

- **Coding Standards Search**: Added `matched_terms` to `standard-search` results and text summaries so agents can see exactly which query terms matched each standard.

## [0.9.7] - 2026-04-25

### Changed

- **Coding Standards Search**: Improved `standard-search` ranking so exact keyword matches rank ahead of generic matches using a stronger keyword relevance signal.

### Added

- **Coding Standards Search**: Added `confidence` and numeric `score` fields to `standard-search` results to help agents judge match quality faster.

## [0.9.6] - 2026-04-25

### Fixed

- **Coding Standards Search**: Updated `standard-search` text summaries to show short standard codes instead of UUIDs so follow-up `standard-detail` calls consume fewer tokens.
- **Tests**: Added regression coverage for the `standard-search` text output contract.

## [0.8.43] - 2026-04-24

### Added

- **Dashboard**: Added first-class Standards and Handoffs tabs for coding standard search/create, handoff creation/listing, and task claims.
- **Coding Standards**: Added `standard-store` and `standard-search` MCP tool routing with SQLite-backed coding standard storage.

## [0.8.42] - 2026-04-23

### Changed

- **Prompts**: Updated `task-memory-executor` so final commit messages must include the task code, and must also include `#<issue_number>` when task metadata references a GitHub Issue.

## [0.8.41] - 2026-04-23

### Fixed

- **Dashboard UI**: Added stable keyed list rendering across modal, drawer, board, stats, and reference components to satisfy Svelte lint requirements and avoid unkeyed list warnings.
- **Reference Experience**: Cleaned up reference drawer/tab state handling and typing to remove lint/type-check issues while preserving existing behavior.
- **Recent Activity**: Fixed scroll listener registration and cleanup in the activity feed to avoid mismatched event handlers.
- **Developer Tooling**: Removed unused variables and replaced loose `any` types in dashboard helpers and seed scripts to restore a fully green lint pipeline.

## [0.8.37] - 2026-04-20

### Changed

- **Prompts**: Added mandatory browser verification step to `task-memory-executor` for UI/UX changes.

## [0.8.36] - 2026-04-20

### Added

- **Dashboard**: Task hierarchy and dependency visualization in Kanban and detail drawer.

## [0.8.35] - 2026-04-19

### Changed

- **Prompts**: Updated `task-memory-executor` to include task decomposition rules and a 4 sub-agent limit.

## [0.8.4] - 2026-04-13

### Fixed

- **Dashboard**: Added 404 and unhandled error handling to the dashboard server.

## [0.8.3] - 2026-04-13

### Changed

- **Documentation**: Updated CHANGELOG.md with missing version history for 0.8.x series.

## [0.8.2] - 2026-04-13

### Fixed

- **Database**: Implemented `proper-lockfile` based `WriteLock` for exclusive write serialization across concurrent processes.
- **Database**: Added `wal_checkpoint(PASSIVE)` on refresh to ensure dashboard sees latest data.
- **Database**: Added startup `wal_checkpoint(TRUNCATE)` and integrity checks with auto-recovery.
- **Database**: Improved responsiveness with 30s `busy_timeout` and lowered `wal_autocheckpoint` (100 pages).

## [0.8.1] - 2026-04-13

### Fixed

- **Database**: Enhanced multi-agent safety with `synchronous=FULL` and WAL autocheckpointing.
- **Database**: Wrapped bulk operations (insert/update/delete) in transactions for consistency.
- **Dashboard**: Added singleton guard to prevent multiple instances on the same port.

## [0.8.0] - 2026-04-13

### Added

- **Linting**: Upgraded ESLint to v10 and updated configuration to the new flat config format.

### Changed

- **Database Engine**: Migrated from `sql.js` (WASM) back to `better-sqlite3` (native) for improved performance.
- **Task Management**: Added column whitelisting in `updateTask()` for SQL injection prevention.
- **Memory Recap**: `contentSummary` is now always generated (no longer gated on structured flag).
- **Search**: Improved recap determinism by sorting by importance DESC and created_at ASC.

### Fixed

- **Tests**: Fixed all failing tests after migration to better-sqlite3.

## [0.7.2] - 2026-04-12

### Fixed

- **Dashboard**: Fixed an issue where running the dashboard script would incorrectly spawn another instance of the dashboard instead of the MCP server, causing a JSON parse error and an endless restart loop.

## [0.7.1] - 2026-04-12

### Fixed

- **Dashboard Reference Tab**: Fixed JSON:API extraction logic to correctly expose tool and resource names to the UI.
- **Prompts**: Fixed an issue where prompts failed to load in production builds because of chunking-related path resolution.

## [0.6.3] - 2026-04-12

### Fixed

- **Dashboard Reference Tab**: Fixed "Unknown Tool" issue after hard refresh by adding JSON:API response handling in frontend API deserializer
- **Reference Drawer**: Fixed console errors when accessing undefined properties using optional chaining (`resource?.data?.uri`)
- **MCP Test Suite**: Fixed 191 tests that were failing due to async SQLiteStore initialization after sql.js migration

### Changed

- **Test Descriptions**: Converted all test descriptions from Indonesian to English
- **API Response Format**: Capabilities endpoint now returns proper JSON:API compliant format with `type`, `id`, and `attributes` for tools, prompts, and resources

## [0.6.2] - 2026-04-12

### Changed

- **Database Migration**: Replaced `better-sqlite3` with `sql.js` (WASM-based) to eliminate native binary compilation issues
- **MCP Logging Fix**: Disabled stderr logging when running as MCP server to prevent connection issues (stdin/stdout reserved for JSON-RPC)
- **Search Fallback**: Removed FTS5 dependency (not supported in sql.js), using LIKE-based search with bag-of-words similarity

### Fixed

- Runtime errors caused by Node.js version mismatch with native SQLite bindings
- MCP server connection drops due to stderr pollution

## [0.6.0] - 2026-04-12

### Added

- **Hybrid Search Strategy**: Implemented 70% Vector and 30% FTS5 weighting for repository-wide context research.
- **Similarity Conflict Detection**: Enforced a 0.55 similarity threshold for `memory-store` to prevent redundant knowledge entries.
- **Task Lifecycle Safety**: Mandatory transition requirement for tasks to pass through `in_progress` status before reaching `completed`.
- **Automatic Task Archiving**: Automatic creation of `task_archive` memory entries upon task completion, including full history and token metrics.

### Changed

- **Behavioral Rule Alignment**: Updated global `GEMINI.md` rules and `.agents` workflow source files to strictly follow the new technical constants (70/30 weighting, 0.55 threshold).
- **Prompt Synchronization**: Refactored `task-memory-executor`, `create-task`, and audit prompts to align with the core PRD/TDD implementation logic.

## [0.5.33] - 2026-04-11

- Initial public release of stable memory toolset.

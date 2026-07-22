# Sprint 10: Polish & Performance 🚧

**Sprint Goal:** Optimize the Codebase Index feature for production use — incremental re-index, performance for large repositories, comprehensive error handling, full test coverage, and release preparation.

**Duration:** 2 weeks (10 working days)

**Dependencies:** Sprint 9 (all features merged and functional). This is a hardening sprint with no new user-facing features.

---

## Backlog Items

### CI-24: Incremental Re-Index (Checksum-Based) (Effort: 2 days)

**Owner:** backend

**Description:** Optimize the indexing pipeline to detect file changes via SHA-256 checksum comparison. Only re-parse files whose content has changed since the last index. This is flagged as an optimization — the basic checksum logic was introduced in Sprint 7; this task hardens it for correctness and performance.

**Acceptance Criteria:**

- [ ] File discovery computes SHA-256 checksum for each file as it walks the directory
- [ ] Checksum compared against stored value in `codebase_files.checksum`
- [ ] Matched checksum → file skipped (no parsing, no DB write)
- [ ] Mismatched or missing checksum → file parsed and symbol table updated
- [ ] Files not found on disk → removed from `codebase_files`; their symbols cascade-deleted via FK
- [ ] Transaction batching: files are processed in batches of 50 within single transactions to minimize WAL checkpoint overhead
- [ ] Skipped files are counted in the summary: `{ skippedFiles: 950, parsedFiles: 50, totalFiles: 1000 }`
- [ ] Verification test: index 1000 files (first run parses all), touch 10 files, re-index (only 10 parsed, 990 skipped)
- [ ] Edge case: file renamed — detected as new file (new path) + missing old file (cleaned up)
- [ ] Edge case: file content changed but checksum collision — computationally infeasible, documented as accepted risk

**Technical Notes:**

- Core logic already in `CodebaseIndexService` — this task hardens it
- Ensure `crypto.subtle` (Web Crypto) or `crypto.createHash` (Node.js) is used for performance

---

### CI-25: Index Staleness Detection (Effort: 1 day)

**Owner:** backend

**Description:** Implement staleness detection that compares file system mtime against `last_indexed_at`. Alert agents and dashboard when the index may be out of date.

**Acceptance Criteria:**

- [ ] `CodebaseIndexService.checkStaleness(repo)` compares each file's mtime against `last_indexed_at`
- [ ] Returns: `{ stale: boolean, staleFiles: number, totalFiles: number, staleRatio: number, lastIndexedAt: string }`
- [ ] Staleness threshold: `staleRatio >= 0.05` (5% of files changed) triggers "STALE" status
- [ ] `index_status` endpoint includes `stale` and `staleRatio` fields
- [ ] Dashboard IndexStatus widget shows yellow warning for stale indices
- [ ] Staleness check is fast: mtime comparison only (no checksum recomputation)
- [ ] Staleness check runs in <100ms for 10K files (single SQL query + file stat calls)

**Technical Notes:**

- Service method: `CodebaseIndexService.checkStaleness(repo)`
- Compare: `fs.stat(filePath).mtime > new Date(lastIndexedAt)` — if any file's mtime is newer, it's stale

---

### CI-26: Performance Optimization for Large Repositories (Effort: 3 days)

**Owner:** backend

**Description:** Profile and optimize the indexing pipeline for repositories with 10K-100K files. Focus on memory usage, parse speed, and database write throughput.

**Acceptance Criteria:**

- [ ] Profile indexing pipeline with a 10K-file test repo — identify top 3 bottlenecks
- [ ] Memory optimization: streaming file walker does not keep all file paths in memory at once
- [ ] Batch symbol inserts: `INSERT` in batches of 100 (not one-by-one) within single transactions
- [ ] Parallel parsing: use `Promise.all` with configurable concurrency (default: 4 parallel parses)
- [ ] WASM parser is reused across parses (initialized once, not per-file)
- [ ] Parse a 10K-file repo in <60 seconds (target: 30s)
- [ ] Dashboard `get_architecture` response for 10K files returns in <500ms
- [ ] `search_symbols` for a 10K-symbol table returns in <200ms
- [ ] Memory usage during indexing stays below 500MB RSS for 10K files
- [ ] Document performance characteristics in `docs/operations/codebase-index.md`

**Technical Notes:**

- Use Node.js's `worker_threads` pool if single-threaded parsing is the bottleneck
- Profile with `node --cpu-prof` and `--heap-prof` flags
- SQLite `PRAGMA journal_mode=WAL` and `PRAGMA synchronous=NORMAL` for write performance

---

### CI-27: Error Handling and Recovery (Effort: 2 days)

**Owner:** backend

**Description:** Build robust error handling and recovery mechanisms for all indexing and search operations. Ensure partial failures don't corrupt the index and recovery is automatic.

**Acceptance Criteria:**

- [ ] Parser timeout (configurable, default 10s per file) — files exceeding timeout are logged and skipped
- [ ] Parser crash/exception — individual file parse failure does not abort the entire index
- [ ] Database write failure — if a batch insert fails, the transaction is rolled back and retried once
- [ ] Disk full / ENOSPC — detected and reported with a clear error message
- [ ] Permission denied on file read — file is logged and skipped
- [ ] WASM initialization failure — clear error with installation instructions
- [ ] Recovery: if indexing fails mid-way, the next index run starts fresh (no partial state)
- [ ] Dashboard shows indexing errors in the IndexStatus widget
- [ ] All errors are logged with structured logging (log level, context, stack trace)
- [ ] Error classification: `RECOVERABLE` (file parse fail, permission denied) vs `FATAL` (WASM init fail, DB corruption)

**Technical Notes:**

- Error types at `src/mcp/codebase-index/types.ts`: `IndexingError`, `ParserError`, `DiscoveryError`, `StorageError`

---

### CI-28: Full Test Coverage (Effort: 3 days)

**Owner:** backend

**Description:** Achieve ≥90% line coverage on all Codebase Index code. Cover edge cases for all services, tools, entities, and dashboard API endpoints.

**Acceptance Criteria:**

- [ ] Unit test coverage ≥90% across:
  - `FileDiscoveryService` (all glob/gitignore edge cases)
  - Tree-sitter parser (all AST node types, error recovery)
  - `CodebaseIndexService` (full run, incremental, empty repo, error recovery)
  - `SymbolRankingService` (all ranking tiers, tiebreakers)
  - `CodebaseArchitectureService` (tree depth, summarization)
  - `TraceService` (found, not found, ambiguous)
  - MCP tool handlers (schema validation, success, error paths)
  - Dashboard API endpoints (HTTP status codes, response shapes)
- [ ] Edge cases covered:
  - Empty repository (no source files)
  - Repository with only unsupported languages
  - Symbol with special characters in name (`$`, `_`, unicode)
  - File with 10K+ lines (very large file)
  - Concurrent index requests for the same repo
  - Index while server is shutting down
  - Null/invalid/malformed input to all tools
- [ ] Property-based tests (via `fast-check`) for:
  - Symbol name ranking (ranking is transitive)
  - File discovery paths are always unique
  - Index summary counters are consistent
- [ ] All tests run in <30s total
- [ ] `vitest run --coverage` reports ≥90% for the codebase-index module

**Technical Notes:**

- Test files: `src/mcp/tests/codebase-index/*.test.ts`
- Use `fast-check` for property-based tests (already in project dependencies)

---

### CI-29: Documentation Finalization (Effort: 2 days)

**Owner:** documentation

**Description:** Finalize all documentation for the Codebase Index feature — user docs, API reference, operational runbook, and developer guide.

**Acceptance Criteria:**

- [ ] `docs/features/codebase-index.md` — comprehensive feature documentation:
  - What it does (value proposition)
  - How to trigger indexing (MCP tool, CLI, auto-index)
  - How to search symbols
  - Known limitations (name-based references, single language)
  - Roadmap for future phases
- [ ] `docs/api/codebase-index.md` — API reference (update from Sprint 8 draft):
  - Every MCP tool with input/output schemas, error codes, examples
  - Every dashboard API endpoint with request/response examples
- [ ] `docs/operations/codebase-index.md` — operational guide:
  - Performance characteristics (indexing 10K files takes ~30s, DB size ~150MB)
  - Configuration (env vars: `CODEBASE_AUTO_INDEX`, `CODEBASE_AUTO_INDEX_TTL`, `CODEBASE_PARSER_TIMEOUT`)
  - Troubleshooting common issues (WASM init failure, disk full, parse errors)
  - Backup and restore implications (codebase tables in memory.db)
- [ ] `CHANGELOG.md` entry for the release (see CI-30)
- [ ] `README.md` update: add Codebase Index to feature list
- [ ] Inline code documentation: JSDoc on all public methods in the codebase-index module
- [ ] Sprint documentation review: all acceptance criteria in Sprints 7-10 are verified against implementation

**Technical Notes:**

- Reference existing docs structure in `docs/` directory

---

### CI-30: Release Preparation (Effort: 1 day)

**Owner:** documentation

**Description:** Prepare the v0.20.0 release with the Codebase Index feature. Bump version, generate changelog, create release notes, and tag.

**Acceptance Criteria:**

- [ ] Version bumped from `0.19.24` to `0.20.0` in `package.json`
- [ ] `CHANGELOG.md` updated with all changes in Sprints 7-10
- [ ] Release notes drafted with:
  - Title: "v0.20.0 — Codebase Index"
  - Key features: `index_repository`, `search_symbols`, `get_file_symbols`, `get_architecture`, `trace_symbol`
  - Dashboard: new Codebase tab with file tree, symbol explorer, search
  - Performance: incremental indexing, batch processing
  - Upgrade notes: `CODEBASE_AUTO_INDEX` env var, new npm dependencies (`web-tree-sitter`, grammar packages)
- [ ] Git tag `v0.20.0` created and pushed
- [ ] All tests pass before tagging (`npm test`)
- [ ] Production build succeeds (`npm run build`)

**Technical Notes:**

- Release follows existing pattern (see previous releases in CHANGELOG.md)

---

## Dependencies

| Item  | Depends On    | Description                                                       |
| :---- | :------------ | :---------------------------------------------------------------- |
| CI-24 | CI-05         | Incremental re-index builds on indexing service                   |
| CI-25 | CI-20, CI-24  | Staleness detection needs incremental index logic + status widget |
| CI-26 | CI-24         | Performance optimization builds on verified incremental logic     |
| CI-27 | CI-05, CI-06  | Error handling needs indexing service + tool infrastructure       |
| CI-28 | CI-24 — CI-27 | Full test coverage needs all components implemented               |
| CI-29 | CI-28         | Documentation finalization needs completed, tested feature        |
| CI-30 | CI-29         | Release needs finalized docs                                      |

## Risk Register

| Risk                                                     | Likelihood | Impact | Mitigation                                                           |
| :------------------------------------------------------- | :--------- | :----- | :------------------------------------------------------------------- |
| Performance targets not met for 10K+ file repos          | Medium     | Medium | Document known limits; optimize in post-MVP Phase 8                  |
| WASM initialization flaky in CI environment              | Low        | High   | Graceful fallback with clear error; mock WASM in unit tests          |
| Test coverage requirement delays release                 | Medium     | Low    | Start tests mid-sprint, not end-sprint                               |
| Breaking schema changes needed after Sprint 7-9 feedback | Low        | Medium | Schema established in Sprint 7; changes via additive migrations only |

**Status: NOT STARTED**

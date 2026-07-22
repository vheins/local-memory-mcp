# Codebase Index — Operations Guide

> **Architecture decision context:** See [ADR-002: Codebase Index Architecture](../../.agents/documents/design/decisions/adr-002-codebase-index.md) for design rationale.
> **Feature overview:** [Codebase Index Feature Guide](../features/codebase-index.md)
> **API Reference:** [Codebase Index API](../api/codebase-index.md)

---

## Overview

The Codebase Index subsystem discovers source files, parses them with tree-sitter WASM, and stores extracted symbols in SQLite. It supports TypeScript, JavaScript (ES6/JSX), and is designed for multi-language extensibility.

All codebase data lives in the same `memory.db` database as other application data. See [Backup & Recovery](#6-backup--recovery) for details.

---

## 1. Performance Characteristics

### Benchmarks

| Workload                         | Observed | Target  | Notes                                                           |
| :------------------------------- | :------- | :------ | :-------------------------------------------------------------- |
| **First-time index (1K files)**  | ~1.4s    | <10s    | Synthetic benchmark with mock parser (isolated pipeline).       |
| **First-time index (10K files)** | ~30-60s  | <60s    | End-to-end: discover → parse → store → clean.                   |
| **Incremental re-index**         | ~1-5s    | <10s    | Only changed files are re-parsed (SHA-256 checksum comparison). |
| **Query response (read tools)**  | <100ms   | <200ms  | For projects up to 20K files.                                   |
| **`search_symbols`**             | <100ms   | <200ms  | FTS5-backed with LIKE fallback.                                 |
| **`get_architecture`**           | <200ms   | <500ms  | Symbol aggregation via GROUP BY.                                |
| **Peak RSS (10K files)**         | ~160 MB  | <500 MB | See memory budget below.                                        |

### Pipeline Throughput

| Phase    | Typical Time (10K files) | Scaling Factor                      |
| :------- | :----------------------- | :---------------------------------- |
| DISCOVER | ~2-5s                    | O(n) filesystem walk                |
| COMPARE  | ~1-3s                    | O(n) DB checksum lookups            |
| PARSE    | ~20-40s                  | O(n) per file; 4 concurrent parsers |
| STORE    | ~5-10s                   | O(n) bulk inserts in batches of 100 |
| CLEAN    | ~0.5-1s                  | O(n) stale record deletion          |

### Key Constants

| Constant                   | Value            | File                           | Role                            |
| :------------------------- | :--------------- | :----------------------------- | :------------------------------ |
| `DEFAULT_PARSE_TIMEOUT_MS` | 10,000 (10s)     | `parser/parser-pool.ts`        | Max time per file parse         |
| `DEFAULT_CONCURRENCY`      | 4                | `parser/parser-pool.ts`        | Concurrent WASM parser slots    |
| `DEFAULT_BATCH_SIZE`       | 100              | `services/indexing-service.ts` | Rows per DB transaction         |
| `CONCURRENT_PARSE_BATCH`   | 20               | `services/indexing-service.ts` | Files per Promise.all window    |
| `AUTO_INDEX_TTL`           | 86,400,000 (24h) | `services/indexing-service.ts` | Stale index refresh interval    |
| `DB_RETRY_DELAY_MS`        | 100              | `services/indexing-service.ts` | Retry delay on DB write failure |
| `STALE_THRESHOLD`          | 0.05 (5%)        | `services/indexing-service.ts` | Auto-index staleness ratio      |

### Memory Budget (approximate, ~10K files)

| Component                               | Size        |
| :-------------------------------------- | :---------- |
| File path strings                       | ~2 MB       |
| File content buffers (concurrent batch) | ~20 MB      |
| WASM parser heap (4 instances)          | ~80 MB      |
| SQLite page cache                       | ~50 MB      |
| Symbol inserts (buffered)               | ~10 MB      |
| **Total peak**                          | **~160 MB** |

---

## 2. Configuration

### Environment Variables

| Variable                           | Type     | Default                            | Description                                                                                                                                                          |
| :--------------------------------- | :------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEBASE_AUTO_INDEX`              | `string` | `"true"` (any non-`"false"` value) | Master kill-switch for automatic background indexing on server startup. Set to `"false"` to disable.                                                                 |
| `CODEBASE_AUTO_INDEX_TTL`          | `number` | `86400000` (24h)                   | Time-to-live in milliseconds for fresh-index detection. If the last index was more than this many ms ago, the index is considered stale and a re-index is triggered. |
| `CODEBASE_INDEX_PARSE_CONCURRENCY` | `number` | `4`                                | Number of concurrent tree-sitter WASM parser slots. Increase for faster indexing on high-CPU machines; decrease to reduce memory pressure.                           |
| `CODEBASE_INDEX_PARSE_TIMEOUT_MS`  | `number` | `10000` (10s)                      | Maximum wall-clock time in milliseconds per single file parse. Files exceeding this are marked as failed and the pipeline continues.                                 |

**Override priority** (applies to all vars): explicit `options` parameter > environment variable > hardcoded default.

### CLI Flag: `--index`

The `--index` flag triggers a one-time indexing operation without starting the MCP server:

```bash
local-memory-mcp --index --repo owner/repo --path /absolute/path/to/repo
```

See the [Feature Guide](../features/codebase-index.md#cli---index-flag) for complete CLI documentation.

---

## 3. Database Schema

All codebase tables are in the same `memory.db` database as other application data. They are created by the migration system on first run.

### `codebase_files`

Stores one row per discovered file.

| Column            | Type      | Description                                            |
| :---------------- | :-------- | :----------------------------------------------------- |
| `id`              | `TEXT`    | UUID primary key.                                      |
| `repo`            | `TEXT`    | Repository identifier (`owner/repo`).                  |
| `file_path`       | `TEXT`    | Relative path from repository root.                    |
| `language`        | `TEXT`    | Detected language (nullable).                          |
| `checksum`        | `TEXT`    | SHA-256 hex digest of file content (nullable).         |
| `lines`           | `INTEGER` | Total line count.                                      |
| `size_bytes`      | `INTEGER` | File size in bytes.                                    |
| `last_indexed_at` | `TEXT`    | ISO 8601 timestamp of last index operation (nullable). |
| `created_at`      | `TEXT`    | Row creation timestamp.                                |
| `updated_at`      | `TEXT`    | Row last-updated timestamp.                            |

**Indexes:**

- `idx_codebase_files_repo_path` — UNIQUE on `(repo, file_path)`
- `idx_codebase_files_repo_indexed` — on `(repo, last_indexed_at)`

### `codebase_symbols`

Stores one row per extracted symbol (function, class, interface, etc.).

| Column             | Type      | Description                                                                           |
| :----------------- | :-------- | :------------------------------------------------------------------------------------ |
| `id`               | `TEXT`    | UUID primary key.                                                                     |
| `repo`             | `TEXT`    | Repository identifier.                                                                |
| `file_path`        | `TEXT`    | File where the symbol is declared.                                                    |
| `name`             | `TEXT`    | Symbol name.                                                                          |
| `kind`             | `TEXT`    | Symbol kind (`function`, `class`, `interface`, `type`, `enum`, `method`, `variable`). |
| `exported`         | `INTEGER` | 1 if exported (ESM), 0 otherwise.                                                     |
| `default_export`   | `INTEGER` | 1 if default export, 0 otherwise.                                                     |
| `start_line`       | `INTEGER` | Start line (1-indexed, nullable).                                                     |
| `start_col`        | `INTEGER` | Start column (0-indexed, nullable).                                                   |
| `end_line`         | `INTEGER` | End line (1-indexed, nullable).                                                       |
| `end_col`          | `INTEGER` | End column (0-indexed, nullable).                                                     |
| `signature`        | `TEXT`    | Type/function signature string (nullable).                                            |
| `doc_comment`      | `TEXT`    | JSDoc comment text (nullable).                                                        |
| `parent_symbol_id` | `TEXT`    | Parent symbol UUID (e.g., method → class). FK to `codebase_symbols(id)`.              |
| `created_at`       | `TEXT`    | Row creation timestamp.                                                               |
| `updated_at`       | `TEXT`    | Row last-updated timestamp.                                                           |

**Indexes:**

- `idx_cs_repo_name` — on `(repo, name)`
- `idx_cs_repo_file` — on `(repo, file_path)`
- `idx_cs_repo_kind` — on `(repo, kind)`
- `idx_cs_name` — on `(name)`
- `idx_cs_parent` — on `(parent_symbol_id)`

### FTS5 Virtual Table: `codebase_symbols_fts`

Full-text search index on `name` and `doc_comment` columns:

```sql
CREATE VIRTUAL TABLE codebase_symbols_fts USING fts5(
    name,
    doc_comment,
    content='codebase_symbols',
    content_rowid='rowid'
);
```

Three database triggers keep `codebase_symbols_fts` automatically synchronized with the `codebase_symbols` table:

- **AFTER INSERT** (`codebase_symbols_ai`): Inserts the new row's `name` and `doc_comment` into the FTS index.
- **AFTER DELETE** (`codebase_symbols_ad`): Removes the deleted row from the FTS index.
- **AFTER UPDATE** (`codebase_symbols_au`): Removes the old values, then inserts the new values — effectively a delete+insert.

This trigger-based approach ensures the FTS index is never stale, without requiring application-level synchronization.

---

## 4. WASM Parser Lifecycle

### Initialization

The tree-sitter WASM runtime and language grammars are loaded lazily — on the first `parseFile` call, not at import time:

1. **WASM runtime** — `web-tree-sitter.wasm` loaded via `Parser.init()`
2. **TypeScript grammar** — `tree-sitter-typescript.wasm` loaded via `Language.load()`
3. **TSX grammar** — `tree-sitter-tsx.wasm` loaded via `Language.load()`

A `this.initPromise` guard prevents duplicate initialization attempts from concurrent calls.

**WASM file resolution** (searched upward from module location):

- `node_modules/web-tree-sitter/web-tree-sitter.wasm`
- `node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm`
- `node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm`

### Per-File Parse

Each file parse creates a fresh `Parser` instance because tree-sitter parsers hold mutable state and are not reentrant:

```
new Parser() → parser.setLanguage(language) → parse(source) → parser.delete()
```

Each parse has a configurable timeout (default 10s, via `CODEBASE_INDEX_PARSE_TIMEOUT_MS`). Timeouts are handled gracefully — the file is marked as failed and the pipeline continues.

### Error Classification

| Error Type                 | Class              | Impact                                         |
| :------------------------- | :----------------- | :--------------------------------------------- |
| WASM init failure          | `FatalError`       | Pipeline aborts; infractructure-level failure. |
| Per-file parse timeout     | `RecoverableError` | File skipped; pipeline continues.              |
| Per-file permission denied | `RecoverableError` | File skipped; pipeline continues.              |
| DB write failure           | `FatalError`       | Pipeline aborts (with one automatic retry).    |

---

## 5. Troubleshooting

### WASM Initialization Failure

**Symptom:** Server logs show `FatalError: operation=Parser.init` or `FatalError: operation=Language.load` during startup or first index call.

**Causes:**

1. Missing `node_modules` — tree-sitter WASM files are shipped with the package but may be missing if the install was corrupted.
2. Incompatible Node.js version — `web-tree-sitter` requires Node.js ≥ 18. Check with `node --version`.
3. Filesystem permissions — WASM files must be readable by the Node.js process.

**Resolution:**

```bash
# Reinstall dependencies to restore WASM files
npm install @vheins/local-memory-mcp

# Verify WASM files exist
ls node_modules/web-tree-sitter/web-tree-sitter.wasm
ls node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm
ls node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm
```

If the issue persists, check `stderr` for detailed error messages from tree-sitter. The error object includes the WASM path that failed.

### Large Repositories (>50K files)

**Symptoms:** High memory usage (>500MB RSS), slow indexing, or timeout errors.

**Tuning options:**

1. **Reduce concurrency** — Set `CODEBASE_INDEX_PARSE_CONCURRENCY=2` to lower WASM heap overhead.
2. **Use `includeGlobs`** — Index only relevant subdirectories:
   ```json
   { "includeGlobs": ["src/**/*.ts", "src/**/*.tsx"] }
   ```
3. **Increase batch size** — Set `DEFAULT_BATCH_SIZE` to 200 for fewer transaction commits (trade-off: higher memory during write).
4. **Extend parse timeout** — For very large files (e.g., generated code), increase `CODEBASE_INDEX_PARSE_TIMEOUT_MS=30000`.

**Memory constraints:**

- WASM parser heap: ~20MB per concurrent slot (4 slots = ~80MB)
- File content buffers: ~2MB per file at 20 files/batch = ~40MB
- Total peak: ~160MB for 10K files, ~400-500MB for 50K files
- If memory is constrained (e.g., CI, low-resource VPS), set concurrency to 2 or 1.

### Database Growth

**Symptom:** `memory.db` grows significantly after indexing.

**Expected growth:**

| Repository Size | Additional DB Size |
| :-------------- | :----------------- |
| 1,000 files     | ~1-5 MB            |
| 10,000 files    | ~10-50 MB          |
| 50,000 files    | ~50-250 MB         |

The FTS5 virtual table adds approximately 1-2x the raw symbol data size.

**Management:**

- Growth is proportional to symbol count, not file count. Files with many symbols (e.g., large declaration files) contribute more.
- The `codebase_files` table is compact (~200 bytes per row).
- Growth is additive with each re-index (symbols are deleted and re-inserted per file, not appended).
- To reclaim space after heavy churn: run `VACUUM;` on `memory.db`.

### Disk Space

**Minimum requirements:**

- Database storage: 500 MB free for typical workloads
- WASM files: ~15 MB (web-tree-sitter + 2 grammars)
- Temporary index batch buffers: ~50 MB

For production deployments, ensure at least 1 GB free to accommodate growth and WAL files.

### Concurrent Indexing Conflicts

**Symptom:** `IndexInProgressError` when calling `index_repository`.

**Cause:** A per-repo in-memory `Set` prevents concurrent indexing of the same repository. This is intentional — running two index operations on the same repo would produce inconsistent results.

**Resolution:** Wait for the in-progress index to complete (check via `index_status`) before retrying.

### Stale Index

**Symptom:** `search_symbols` or `get_file_symbols` returns outdated results.

**Assessment:**

- Check `index_status` for the repository — `lastIndexedAt` shows when the index was last refreshed.
- Run `index_repository` to trigger an incremental update (only changed files are re-parsed).
- To force a full re-index: call `index_repository` with `force: true`.

### Auto-Index Not Triggering

**Symptom:** New repositories are not automatically indexed on server startup.

**Verification:**

1. Check `CODEBASE_AUTO_INDEX` — if set to `"false"`, auto-index is disabled.
2. Check `CODEBASE_AUTO_INDEX_TTL` — if set too high, the existing index may appear fresh.
3. Check server logs for `[CodebaseIndex]` messages showing auto-index decisions, recalculated staleness counts, and which repos were scheduled.

### Query Performance Degradation

**Symptom:** `search_symbols` queries become slow (>1s) on large indexes.

**Causes and fixes:**

| Cause                               | Fix                                                                                                         |
| :---------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| Missing FTS5 index on large dataset | Ensure FTS5 triggers are active (verify `SELECT count(*) FROM codebase_symbols_fts;` matches symbol count). |
| High `limit` with FTS5 fallback     | FTS5 queries with `limit=200` are slower. Reduce to `limit=50` for typical searches.                        |
| No SQLite indexes                   | Run `ANALYZE;` to update SQLite query planner statistics.                                                   |

---

## 6. Backup & Recovery

### Database Location

All codebase tables (`codebase_files`, `codebase_symbols`, `codebase_symbols_fts`) are stored in the same `memory.db` database as memories, tasks, standards, and other application data. The database location follows this resolution order:

1. `MEMORY_DB_PATH` environment variable (explicit override)
2. `~/.config/local-memory-mcp/memory.db` (Linux)
3. `~/Library/Application Support/local-memory-mcp/memory.db` (macOS)
4. `%USERPROFILE%\.local-memory-mcp\memory.db` (Windows)
5. `./storage/memory.db` (current working directory, legacy fallback)

### Automatic Backup

After every successful write operation, the system creates a backup by atomically copying `memory.db` to `memory.db.backup` in the same directory.

### Corruption Recovery

The database uses WAL journaling with automatic checkpointing, backed by nightly backup
(see "Automatic Backup" below). If corruption is suspected, run the recovery procedure
manually:

1. Stop the server.
2. Run `sqlite3 memory.db "PRAGMA integrity_check;"` to verify corruption.
3. If corruption is found, restore from `memory.db.backup`:
   ```bash
   cp memory.db.backup memory.db
   ```

### Manual Backup

To manually back up codebase index data:

```bash
# Backup the entire database (includes all entities)
cp ~/.config/local-memory-mcp/memory.db ~/backups/memory-$(date +%Y%m%d).db

# Or use SQLite's backup API for a live backup
sqlite3 ~/.config/local-memory-mcp/memory.db ".backup ~/backups/memory-$(date +%Y%m%d).db"
```

### Restore

```bash
# Stop the server
# Replace with backup
cp ~/backups/memory-20260722.db ~/.config/local-memory-mcp/memory.db
# Restart the server
# Run index_repository to ensure index integrity
```

> **Note:** Restoring `memory.db` restores all entities (memories, tasks, standards, handoffs, and codebase data). There is no separate backup granularity for codebase tables — they share the same SQLite database.

---

## 7. Monitoring

### Logging

The codebase index subsystem logs structured messages with a `[CodebaseIndex]` prefix:

| Event               | Level   | Fields                                                                           |
| :------------------ | :------ | :------------------------------------------------------------------------------- |
| Index started       | `info`  | `repo`, `mode` (full/incremental)                                                |
| File parsed         | `debug` | `filePath`, `durationMs`, `symbols`                                              |
| File skipped        | `debug` | `filePath`, `reason` (checksum match)                                            |
| File failed         | `warn`  | `filePath`, `error`, `durationMs`                                                |
| Index completed     | `info`  | `repo`, `totalFiles`, `parsedFiles`, `failedFiles`, `totalSymbols`, `durationMs` |
| Auto-index decision | `info`  | `repo`, `reason`, `staleCount`                                                   |
| WASM init failure   | `error` | `operation`, `wasmPath`, `error`                                                 |
| DB write retry      | `warn`  | `error`, `attempt`                                                               |

### Hooks

- `onProgress` callback emits stage progress (discovering → parsing → storing → cleaning).
- `IndexResult.durationMs` captures wall-clock time per index operation.
- `IndexResult.errorSummary` classifies failures (timeout, permission, DB write).

---

## 8. Scaling Guidelines

### Repository Size → Configuration

| Repository Size | Recommended `CODEBASE_INDEX_PARSE_CONCURRENCY` | Recommended Memory |
| :-------------- | :--------------------------------------------- | :----------------- |
| < 10K files     | 4 (default)                                    | 256 MB             |
| 10K-50K files   | 2-4                                            | 512 MB             |
| 50K-100K files  | 2                                              | 1 GB               |
| > 100K files    | 1                                              | 2 GB               |

For very large repositories, use `includeGlobs` to index only the most relevant directories rather than the entire tree.

### Concurrent Repositories

The server can index multiple repositories concurrently (separate repos do not contend for the concurrency guard). Each repository indexes with its own parser pool and DB transactions. WASM parser memory is per-pool, so indexing 3 repos concurrently with `concurrency=4` each could require ~240 MB for parser heaps alone.

---

## Related Documentation

- [Feature Guide: Codebase Index](../features/codebase-index.md) — How it works and how to use it
- [API Reference: Codebase Index](../api/codebase-index.md) — Complete MCP tool documentation
- [ADR-002: Codebase Index Architecture](../../.agents/documents/design/decisions/adr-002-codebase-index.md) — Design rationale and phased delivery plan

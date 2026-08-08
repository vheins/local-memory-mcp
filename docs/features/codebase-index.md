# Codebase Index

The Codebase Index feature allows AI agents to search for functions, classes, interfaces, types, enums, and other structural entities within project source code. Instead of reading files sequentially to understand a codebase, agents can query a pre-built index that provides structured symbol information on demand.

> **Architecture decisions:** See [ADR-002: Codebase Index Architecture](../../.agents/documents/design/decisions/adr-002-codebase-index.md) for the full design rationale.

---

## What is Codebase Index?

Codebase Index is a source code analysis pipeline integrated into the MCP server. It:

1. **Discovers** source files in a repository directory
2. **Parses** them using tree-sitter (WASM) to extract structural symbols
3. **Stores** the results in SQLite tables alongside existing memory data
4. **Queries** them through 2 unified MCP tools (`codebase-index`, `codebase-read`) that agents can call at any time

The result is a searchable, structured view of your codebase that persists across sessions and updates incrementally.

---

## How It Works

The indexing pipeline operates in 5 phases:

```
Discover → Compare → Parse → Store → Clean
```

### Phase 1: DISCOVER

Walks the repository directory tree using `fast-glob`. Automatically respects `.gitignore` rules and detects language by file extension. Default exclusions prevent indexing of build artifacts and dependency directories:

- `node_modules`, `.git`, `dist`, `.next`, `build`, `coverage`
- `__pycache__`, `.venv`, `vendor`, `target`, `.DS_Store`

Custom include/exclude glob patterns can be provided per indexing run.

### Phase 2: COMPARE

For each discovered file, the system compares its mtime against the stored `last_indexed_at`. Files whose mtime is more than 2000ms (`MTIME_AMBIGUITY_MARGIN_MS`) before their last index are skipped **without being read** — this mtime pre-filter is the incremental indexing mechanism. The 2000ms margin covers coarse filesystem timestamp granularity (ext3 = 1s, FAT = 2s). Files that are new, or whose mtime falls inside the ambiguity window, are **not** skipped here — they fall through to read + checksum confirmation in the parse phase, so a quick edit is never falsely skipped.

### Phase 3: PARSE

Changed/new candidates run through a 3-phase batch loop (`runParsePipeline`), with each batch capped at the parser concurrency (`CONCURRENT_PARSE_BATCH`, 4 by default):

1. **Read + checksum** — file content is read and its SHA-256 checksum computed, **without parsing**. Files larger than 10MB (`MAX_FILE_SIZE_BYTES`) are rejected here and marked as failed — there is no timeout fallback for oversized files.
2. **Sequential decision** — touch-only files (checksum unchanged) are skipped, renames are detected by matching checksums against now-stale paths, and only genuinely changed/new files move on.
3. **Parse only changed files** — each surviving file is parsed with tree-sitter WASM (10-50ms per file) and traversed by a language-specific visitor to extract:
   - **Function** declarations (named functions, async functions, generators)
   - **Method** declarations (class/object methods)
   - **Class** declarations
   - **Interface** declarations
   - **Type** alias declarations
   - **Enum** declarations
   - **Variable** declarations (const/let/var at module scope)

Each parse has a 10-second timeout — files exceeding this are marked as failed. File and symbol inserts are flushed to the database after every batch (`writeParseBatch`), so memory stays bounded regardless of repository size.

### Phase 4: STORE

Under a write lock:

- File records are upserted (metadata: path, language, checksum, line count, size)
- Old symbol records for re-indexed files are deleted
- New symbol records are bulk-inserted

The FTS5 virtual table (`codebase_symbols_fts`) is automatically kept in sync via INSERT/UPDATE/DELETE triggers on `codebase_symbols`.

### Phase 5: CLEAN

Database records for files that no longer exist on disk are removed, keeping the index consistent with the actual filesystem state.

---

## Supported Languages

| Language   | File Extensions                                    | Status   |
| :--------- | :------------------------------------------------- | :------- |
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts`, `.svelte`, `.astro` | ✅ Full  |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs`                      | ✅ Full  |
| Vue        | `.vue`                                             | ✅ Full  |
| Go         | `.go`                                              | ✅ Full  |
| Python     | `.py`                                              | ✅ Full  |
| PHP        | `.php`                                             | ✅ Full  |
| Rust       | `.rs`                                              | ✅ Full  |
| Java       | `.java`                                            | ✅ Full  |
| Dart       | `.dart`                                            | ✅ Full* |
| Kotlin     | `.kt`, `.kts`                                      | ✅ Full  |
| Ruby       | `.rb`                                              | ✅ Full  |
| Swift      | `.swift`                                           | ✅ Full  |
| C          | `.c`, `.h`                                         | ✅ Full  |
| C++        | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`       | ✅ Full  |
| Markdown   | `.md`, `.mdx`                                      | ✅ Full  |

> _\* Dart requires a compatible tree-sitter grammar WASM — see ABI compatibility notes in operational guide._

15 languages are registered in `createRegistry()` (`parser/language-routing.ts`): 14 are parsed through tree-sitter grammars and Markdown uses a dedicated visitor without WASM. They are implemented by **14 visitor classes** — the TypeScript visitor handles TypeScript/TSX/JSX (`.svelte` and `.astro` route to TS too), and a generic text visitor covers every other extension (JSON, YAML, CSS, shell scripts, etc.).

The parser architecture uses a registry pattern. Each language is defined by a `LanguageConfig` entry in `createRegistry()` (`parser/language-routing.ts`), which maps file extensions to a tree-sitter grammar WASM and a `LanguageVisitor` implementation. Adding a new language requires:

1. Installing the tree-sitter grammar npm package (must include or support WASM build)
2. Adding a `LanguageConfig` entry to `createRegistry()` in `parser/language-routing.ts`
3. Implementing the `LanguageVisitor` interface in a new visitor file under `parser/visitors/`

See [ADR-002 §Decision 4](../../.agents/documents/design/decisions/adr-002-codebase-index.md) for architecture details.

---

## How to Use

### CLI: `--index` Flag

The server can be invoked with the `--index` flag to perform a one-time indexing operation without starting the MCP server:

```bash
local-memory-mcp --index --repo owner/repo --path /absolute/path/to/repo
```

With glob filters:

```bash
local-memory-mcp --index \
  --repo owner/repo \
  --path /home/user/projects/my-app \
  --include "src/**/*.ts" \
  --exclude "**/*.test.ts" \
  --exclude "**/*.spec.ts"
```

Progress is printed to stderr with timestamps. Exit code is `0` on success, `1` on failure.

**CLI flags:**

| Flag        | Required | Repeatable | Description                                    |
| :---------- | :------- | :--------- | :--------------------------------------------- |
| `--repo`    | Yes      | No         | Repository identifier (`owner/repo`).          |
| `--path`    | Yes      | No         | Absolute filesystem path to the repository.    |
| `--include` | No       | Yes        | Glob pattern to include (e.g., `src/**/*.ts`). |
| `--exclude` | No       | Yes        | Glob pattern to exclude.                       |

### MCP Tools

The Codebase Index exposes **2 unified MCP tools** via `tools/call` (mode auto-inferred from parameters per ADR-005):

| Tool             | Modes (auto-inferred)                     | Description                                       |
| :--------------- | :---------------------------------------- | :------------------------------------------------ |
| `codebase-index` | `INDEX`, `STATUS`                         | Index/re-index a repository, or check its status. |
| `codebase-read`  | `TRACE`, `FILE`, `SEARCH`, `ARCHITECTURE` | Read-only queries of the index.                   |

> **Legacy aliases:** the pre-unification tools (`index_repository`, `index_status`, `search_symbols`, `get_file_symbols`, `get_architecture`, `trace_symbol`, `codebase_search`) still route to the unified handlers for backward compatibility.

See the [API Reference](../api/codebase-index.md) for complete input/output schemas and examples.

### Dashboard

The Glassy Dashboard provides a visual overview of indexed repositories. Navigate to the **Codebase Index** tab to see:

- Which repositories have been indexed
- File and symbol counts per repository
- Language breakdown

> The Dashboard integration is read-only for now. Indexing can be triggered via CLI, MCP tools, or the startup auto-index.

---

## Performance Characteristics

| Metric                       | Typical Value                                                                                                            |
| :--------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| First-time index (10K files) | ~30-60 seconds                                                                                                           |
| Incremental re-index         | ~1-5 seconds (only changed files parsed; an unchanged repo parses **0** files — the mtime pre-filter skips without read) |
| File parsing (per file)      | 10-50ms (tree-sitter WASM)                                                                                               |
| Query response (read)        | <100ms for projects up to 20K files                                                                                      |
| WASM initialization          | ~500ms-1s (loaded once, cached)                                                                                          |
| Database growth (10K files)  | ~10-50MB additional                                                                                                      |

`codebase-index` (INDEX mode) does **not** hold the write lock during the heavy scan/parse work — the indexing writer acquires the lock per database batch. `codebase-read` is read-only and runs without blocking.

---

## Database Schema

The Codebase Index uses three tables in the existing `memory.db` (plus the FTS5 virtual table):

### `codebase_files`

| Column            | Type      | Description                    |
| :---------------- | :-------- | :----------------------------- |
| `id`              | `TEXT`    | UUID primary key.              |
| `repo`            | `TEXT`    | Repository identifier.         |
| `file_path`       | `TEXT`    | Relative path from repo root.  |
| `language`        | `TEXT`    | Detected language (nullable).  |
| `checksum`        | `TEXT`    | SHA-256 hex digest (nullable). |
| `lines`           | `INTEGER` | Total line count.              |
| `size_bytes`      | `INTEGER` | File size in bytes.            |
| `last_indexed_at` | `TEXT`    | ISO 8601 timestamp (nullable). |

**Indexes:** `idx_codebase_files_repo_path` (UNIQUE on `repo`, `file_path`), `idx_codebase_files_repo_indexed` (on `repo`, `last_indexed_at`).

### `codebase_symbols`

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
| `parent_symbol_id` | `TEXT`    | Parent symbol UUID (e.g., method → class).                                            |

**Indexes:** `idx_cs_repo_name`, `idx_cs_repo_file`, `idx_cs_repo_kind`, `idx_cs_name`, `idx_cs_parent`.

### FTS5 Virtual Table: `codebase_symbols_fts`

Full-text search index on `name`, `doc_comment`, and `signature` (the `signature` column was added by migration **v18**, which rebuilt the table), auto-synchronized via database triggers (INSERT/UPDATE/DELETE).

### `codebase_references` (migration v21)

One row per call-site edge discovered during parsing:

| Column        | Type      | Description                                    |
| :------------ | :-------- | :--------------------------------------------- |
| `id`          | `TEXT`    | UUID primary key.                              |
| `repo`        | `TEXT`    | Repository identifier.                         |
| `symbol_name` | `TEXT`    | Symbol being referenced (the callee).          |
| `caller_file` | `TEXT`    | File holding the call site.                    |
| `caller_line` | `INTEGER` | Line of the call site.                         |
| `caller_name` | `TEXT`    | Name of the enclosing symbol at the call site. |
| `kind`        | `TEXT`    | Reference kind.                                |
| `created_at`  | `TEXT`    | Row creation timestamp.                        |

**Indexes:** `idx_refs_repo_symbol` — on `(repo, symbol_name)`; `idx_refs_repo_file` — on `(repo, caller_file)`.

---

## Known Limitations

### Name-Based Resolution Only

Symbol tracing and reference detection work by exact name string matching across files. There is no type-graph resolution — tree-sitter provides syntactic trees, not semantic type information. If two symbols share the same name but are in different scopes, the trace may produce false positives or require disambiguation.

See [ADR-002 §Consequences](../../.agents/documents/design/decisions/adr-002-codebase-index.md) for the full discussion of name-based vs type-based resolution.

### Reference Storage (call-site edges, since migration v21)

Call-site edges ARE persisted since migration **v21** (`codebase_references`): each reference records `symbol_name`, `caller_file`, `caller_line`, `caller_name`, and `kind`, with indexes on `(repo, symbol_name)` and `(repo, caller_file)`. TRACE mode reads these edges to list where a symbol is used.

What is still **not** built is a type-graph: import graphs and inheritance chains are not resolved (only name-matched call-site edges are stored). That remains Phase 1.1 — see [ADR-002 §Consequences](../../.agents/documents/design/decisions/adr-002-codebase-index.md).

### Incremental Refresh, No File Watching

The index is refreshed by an **incremental re-index** — only changed files are parsed. Indexing is triggered by:

- The `codebase-index` tool (INDEX mode) or the CLI `--index` flag — for an explicit, immediate re-index
- **Startup auto-index** (`autoIndexIfStale`) — enabled by default (`CODEBASE_AUTO_INDEX`), it re-indexes the current working directory when the last index is older than 24h (`CODEBASE_AUTO_INDEX_TTL`)

There is **no file watching** — after code changes, the index may be stale until the next re-index (TTL expiry, startup, or an explicit call). The `lastIndexedAt` field in `index_status`, and the `FILE` mode of `codebase-read`, help agents assess staleness.

### Database Growth

Indexing large projects adds to `memory.db` size. A project with 10,000 TypeScript files may add 10-50MB. The database uses WAL mode, so reads are not blocked during writes.

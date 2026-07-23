# Codebase Index

The Codebase Index feature allows AI agents to search for functions, classes, interfaces, types, enums, and other structural entities within project source code. Instead of reading files sequentially to understand a codebase, agents can query a pre-built index that provides structured symbol information on demand.

> **Architecture decisions:** See [ADR-002: Codebase Index Architecture](../../.agents/documents/design/decisions/adr-002-codebase-index.md) for the full design rationale.

---

## What is Codebase Index?

Codebase Index is a source code analysis pipeline integrated into the MCP server. It:

1. **Discovers** source files in a repository directory
2. **Parses** them using tree-sitter (WASM) to extract structural symbols
3. **Stores** the results in SQLite tables alongside existing memory data
4. **Queries** them through 6 MCP tools that agents can call at any time

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

For each discovered file, the system checks whether it already exists in the database and whether its stored SHA-256 checksum matches the current file content. Files with matching checksums are skipped — this is the incremental indexing mechanism.

### Phase 3: PARSE

Each changed or new file is:

1. Read from disk and its SHA-256 checksum computed (~1-2ms per file)
2. Parsed with tree-sitter WASM to produce an AST (10-50ms per file)
3. Traversed by a language-specific visitor to extract:
   - **Function** declarations (named functions, async functions, generators)
   - **Method** declarations (class/object methods)
   - **Class** declarations
   - **Interface** declarations
   - **Type** alias declarations
   - **Enum** declarations
   - **Variable** declarations (const/let/var at module scope)
4. Each parse has a 10-second timeout — files exceeding this are marked as failed

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

| Language   | File Extensions                              | Status   |
| :--------- | :------------------------------------------- | :------- |
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts`                | ✅ Full  |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs`                | ✅ Full  |
| Go         | `.go`                                        | ✅ Full  |
| Python     | `.py`                                        | ✅ Full  |
| PHP        | `.php`                                       | ✅ Full  |
| Rust       | `.rs`                                        | ✅ Full  |
| Java       | `.java`                                      | ✅ Full  |
| Dart       | `.dart`                                      | ✅ Full* |
| Kotlin     | `.kt`, `.kts`                                | ✅ Full  |
| Ruby       | `.rb`                                        | ✅ Full  |
| Swift      | `.swift`                                     | ✅ Full  |
| C          | `.c`, `.h`                                   | ✅ Full  |
| C++        | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` | ✅ Full  |

> _\* Dart requires a compatible tree-sitter grammar WASM — see ABI compatibility notes in operational guide._

The parser architecture uses a registry pattern. Each language is defined by a `LanguageConfig` entry in the parser pool's `createRegistry()` method, which maps file extensions to a tree-sitter grammar WASM and a `LanguageVisitor` implementation. Adding a new language requires:

1. Installing the tree-sitter grammar npm package (must include or support WASM build)
2. Adding a `LanguageConfig` entry to `createRegistry()` in `parser-pool.ts`
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

The 6 Codebase Index tools are available via `tools/call`:

| Tool               | Category | Description                                          |
| :----------------- | :------- | :--------------------------------------------------- |
| `index_repository` | Write    | Index or re-index a repository.                      |
| `index_status`     | Read     | Check indexing status for a repository.              |
| `search_symbols`   | Read     | Search symbols with ranked results.                  |
| `get_file_symbols` | Read     | Get all symbols in a specific file.                  |
| `get_architecture` | Read     | Get directory tree, language breakdown, and exports. |
| `trace_symbol`     | Read     | Trace a symbol's definition and references.          |

See the [API Reference](../api/codebase-index.md) for complete input/output schemas and examples.

### Dashboard

The Glassy Dashboard provides a visual overview of indexed repositories. Navigate to the **Codebase Index** tab to see:

- Which repositories have been indexed
- File and symbol counts per repository
- Language breakdown

> The Dashboard integration is read-only for now. Indexing must be triggered via CLI or MCP tools.

---

## Performance Characteristics

| Metric                       | Typical Value                       |
| :--------------------------- | :---------------------------------- |
| First-time index (10K files) | ~30-60 seconds                      |
| Incremental re-index         | ~1-5 seconds (only changed files)   |
| File parsing (per file)      | 10-50ms (tree-sitter WASM)          |
| Query response (read)        | <100ms for projects up to 20K files |
| WASM initialization          | ~500ms-1s (loaded once, cached)     |
| Database growth (10K files)  | ~10-50MB additional                 |

`index_repository` is a **write tool** — it runs under a write lock. All other tools are read-only and run without blocking.

---

## Database Schema

The Codebase Index uses two tables in the existing `memory.db`:

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

Full-text search index on `name` and `doc_comment` columns, auto-synchronized via database triggers (INSERT/UPDATE/DELETE).

---

## Known Limitations (Phase 1.0)

### Name-Based Resolution Only

Symbol tracing and reference detection work by exact name string matching across files. There is no type-graph resolution — tree-sitter provides syntactic trees, not semantic type information. If two symbols share the same name but are in different scopes, the trace may produce false positives or require disambiguation.

See [ADR-002 §Consequences](../../.agents/documents/design/decisions/adr-002-codebase-index.md) for the full discussion of name-based vs type-based resolution.

### Single Language (MVP)

Only TypeScript, JavaScript, TSX, and JSX are supported. The parser architecture is designed for multi-language support — the `LanguageVisitor` interface abstracts language-specific AST traversal — but only the TypeScript visitor is implemented.

### No Relation Storage

Call graphs, import graphs, and inheritance chains are not stored. The `codebase_relations` table is documented in ADR-002 but not created. Relation resolution is deferred to Phase 1.1.

### Explicit Indexing Required

Agents must call `index_repository` explicitly. There is no auto-index-on-start or file watching. This means:

- First use requires a manual index step
- After code changes, the index may be stale until the next explicit re-index
- The `lastIndexedAt` field in `get_file_symbols` and `index_status` helps agents assess staleness

### Database Growth

Indexing large projects adds to `memory.db` size. A project with 10,000 TypeScript files may add 10-50MB. The database uses WAL mode, so reads are not blocked during writes.

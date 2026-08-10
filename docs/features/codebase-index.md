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

| Language   | File Extensions                                    | Status   | Reference edges (Phase 1.1)                          |
| :--------- | :------------------------------------------------- | :------- | :--------------------------------------------------- |
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts`, `.svelte`, `.astro` | ✅ Full  | call · instantiation · import · extends · implements |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs`                      | ✅ Full  | call · instantiation · import · extends · implements |
| Vue        | `.vue`                                             | ✅ Full  | import · instantiation (template component tags)     |
| Go         | `.go`                                              | ✅ Full  | call · import · extends                              |
| Python     | `.py`                                              | ✅ Full  | call · import · extends                              |
| PHP        | `.php`                                             | ✅ Full  | call · instantiation · import · extends · implements |
| Rust       | `.rs`                                              | ✅ Full  | call · import · extends · implements                 |
| Java       | `.java`                                            | ✅ Full  | call · import · extends · implements                 |
| Dart       | `.dart`                                            | ✅ Full* | call · import · extends · implements                 |
| Kotlin     | `.kt`, `.kts`                                      | ✅ Full  | call · import · extends · implements                 |
| Ruby       | `.rb`                                              | ✅ Full  | call · import · extends                              |
| Swift      | `.swift`                                           | ✅ Full  | call · import · extends · implements                 |
| C          | `.c`, `.h`                                         | ✅ Full  | call · import                                        |
| C++        | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`       | ✅ Full  | call · import · extends · implements                 |
| Markdown   | `.md`, `.mdx`                                      | ✅ Full  | — (declarations only)                                |

> _\* Dart requires a compatible tree-sitter grammar WASM — see ABI compatibility notes in operational guide._

15 languages are registered in `createRegistry()` (`parser/language-routing.ts`) plus a generic catch-all config — **16 configs total**. Of these, 14 are parsed through tree-sitter grammars, Markdown uses a dedicated visitor without WASM, and the generic text visitor covers every other extension (JSON, YAML, CSS, shell scripts, etc.). They are implemented by **15 visitor classes** — the TypeScript visitor handles TypeScript/TSX/JS/JSX (`.svelte` and `.astro` route to TS too).

Since Phase 1.1 (migration **v23**, edge targets), **14 of the 16 configs emit reference edges** via 13 visitor classes (`extractReferences`): all tree-sitter languages except Markdown and the generic catch-all, which are declarations-only by design (see [MD-Generic decision](../../.agents/documents/design/codebase-index/reference-edge-markdown-generic.md)). The edge kinds above are the actual per-language emission surface — verified against visitor code (`parser/visitors/` + `parser/ts-reference-emission.ts`); languages without `instantiation`/`implements` simply do not detect those constructs (name-based, no true type resolution — see [Known Limitations](#known-limitations)).

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

| Tool             | Modes (auto-inferred)                             | Description                                             |
| :--------------- | :------------------------------------------------ | :------------------------------------------------------ |
| `codebase-index` | `INDEX`, `STATUS`                                 | Index/re-index a repository, or check its status.       |
| `codebase-read`  | `TRACE`, `FILE`, `SEARCH`, `ARCHITECTURE`, `CODE` | Read-only queries of the index, including content grep. |

> **Legacy aliases:** the pre-unification tools (`index_repository`, `index_status`, `search_symbols`, `get_file_symbols`, `get_architecture`, `trace_symbol`, `codebase_search`) still route to the unified handlers for backward compatibility. `search_code` (content grep with symbol context) was **design intent only** — it never shipped as a tool; the feature landed directly as the `CODE` mode of `codebase-read`.

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

### `codebase_references` (migrations v21 + v23)

One row per reference edge discovered during parsing — since Phase 1.1 (migration **v23**) this is a generalized **edge table** holding both call-site edges (v21) and heritage edges:

| Column             | Type      | Description                                                                      |
| :----------------- | :-------- | :------------------------------------------------------------------------------- |
| `id`               | `TEXT`    | UUID primary key.                                                                |
| `repo`             | `TEXT`    | Repository identifier.                                                           |
| `symbol_name`      | `TEXT`    | Symbol being referenced (the callee / base class / implemented interface).       |
| `caller_file`      | `TEXT`    | File holding the call / heritage site.                                           |
| `caller_line`      | `INTEGER` | Line of the call site (or the derived type's declaration line).                  |
| `caller_name`      | `TEXT`    | Name of the enclosing symbol at the call site (`null` for heritage edges).       |
| `kind`             | `TEXT`    | Edge kind: `call` \| `instantiation` \| `import` \| `extends` \| `implements`.   |
| `target_file`      | `TEXT`    | File path of the referenced symbol when resolvable (v23, nullable).              |
| `target_symbol_id` | `TEXT`    | `codebase_symbols(id)` of the referenced symbol when resolvable (v23, nullable). |
| `created_at`       | `TEXT`    | Row creation timestamp.                                                          |

**Indexes:** `idx_refs_repo_symbol` — on `(repo, symbol_name)`; `idx_refs_repo_file` — on `(repo, caller_file)`.

Resolution remains **name-based** (ADR-002): `target_file` / `target_symbol_id` are populated when the referenced name resolves at parse time; unresolved names keep them `NULL` and resolution falls back to query-time name matching.

---

## Known Limitations

### Name-Based Resolution Only

Symbol tracing and reference detection work by exact name string matching across files. There is no type-graph resolution — tree-sitter provides syntactic trees, not semantic type information. If two symbols share the same name but are in different scopes, the trace may produce false positives or require disambiguation.

See [ADR-002 §Consequences](../../.agents/documents/design/decisions/adr-002-codebase-index.md) for the full discussion of name-based vs type-based resolution.

### Reference Storage (call-site + heritage edges, since migrations v21 + v23)

Reference edges ARE persisted: call-site edges (call / instantiation / import) since migration **v21**, and **heritage edges (extends / implements) plus edge targets (`target_file` / `target_symbol_id`) since migration v23 (Phase 1.1)**. Each edge records `symbol_name`, `caller_file`, `caller_line`, `caller_name`, and `kind`, with indexes on `(repo, symbol_name)` and `(repo, caller_file)`. TRACE mode reads these edges to list where a symbol is used.

Phase 1.1 closed the import-graph and inheritance-chain gap: **import, extends, and implements edges are now resolved name-based** for the 14 ref-emitting language configs (see the [Supported Languages](#supported-languages) matrix — per-language coverage differs, e.g. Go/Python/Ruby emit `extends` but not `implements`; Vue emits `import` + `instantiation` only; Markdown and the generic catch-all are declarations-only by design).

What is still **not** built is a true **type-graph**: edges are name-matched (ADR-002), not semantically resolved — two same-name symbols may conflate, and LSP-based type resolution remains future work. See [ADR-002 §Consequences](../../.agents/documents/design/decisions/adr-002-codebase-index.md).

### Content Search (CODE mode) — Disk Grep, Not FTS

Content search IS shipped as the `CODE` mode of `codebase-read` (since the SC-3 wave): it greps the **indexed** files on disk (`codebase_files` scope only — `node_modules`/`.git`/untracked files are excluded by construction), enriched with each match's enclosing symbol span. It is **not** a database FTS query: content is read from the caller-supplied `repoPath` through a process-shared LRU cache whose validity is keyed to the `codebase_files` row checksum (a re-index invalidates cached content; an edit without re-index keeps serving the indexed content). Honest limits: per-query disk I/O (amortized by the cache), no type resolution, and `regex: true` is guarded against ReDoS-style patterns (length cap + nested-quantifier rejection → `INVALID_REGEX`). See the [API Reference](../api/codebase-index.md#code-mode) for the full contract.

### Dead-Code & Hotspots (ARCHITECTURE mode)

The `ARCHITECTURE` mode of `codebase-read` appends a `deadCode` block (dead-code candidates + hotspots) when `includeSymbolCounts` is true: `unreferenced[]` (zero-reference top-level symbols, per-kind breakdown), `hotspots[]` (top in-degree symbols), and `languageCoverage` (which repo languages have observed reference emission). Only top-level symbols are scanned (bounded by `DEAD_CODE_SCAN_LIMIT`), and entry-point exclusion is layered — `package.json` `bin`/`main`/`exports`/`browser`, `#!` shebang, and exported top-level symbols (public API). Honest limits: name-based aggregation (ADR-002), candidates only for languages with observed reference rows in the index, and Markdown/generic languages are reported as declaration-only. See [ADR-002](../../.agents/documents/design/decisions/adr-002-codebase-index.md) and the [API Reference](../api/codebase-index.md#architecture-mode).

### Incremental Refresh + Polling File Watcher

The index is refreshed by an **incremental re-index** — only changed files are parsed. Indexing is triggered by:

- The `codebase-index` tool (INDEX mode) or the CLI `--index` flag — for an explicit, immediate re-index
- **Startup auto-index** (`autoIndexIfStale`) — enabled by default (`CODEBASE_AUTO_INDEX`), it re-indexes the current working directory when the last index is older than 24h (`CODEBASE_AUTO_INDEX_TTL`)
- **Polling file watcher** (`ENABLE_FILE_WATCHER`, default on) — a light polling sweep over all registered repos on a fixed interval (`FILE_WATCH_INTERVAL_MS`, default 30s). Per-repo re-entry is capped by `FILE_WATCH_TTL_MS` (default 5 min). The sweep delegates change detection to the incremental planner's mtime pre-filter + SHA-256 checksum confirmation — an untouched repo re-runs with zero parses (negligible cost). The watcher is hosted by the MCP server process only; the dashboard does NOT host it (would double-index). Single-process caveat: repos indexed only through the dashboard process are picked up from the next MCP-process index or tool call.

The watcher is a **bounded-delay polling sweep**, not a real-time filesystem notification (`fs.watch`). Detection latency is up to the configured interval. `fs.watch` / chokidar remain a recommendation for a future phase — the polling approach avoids per-process watcher lifecycle, cross-platform leaks, and double-index races. The `lastIndexedAt` field in `index_status`, and the `FILE` mode of `codebase-read`, help agents assess staleness.

### Dashboard Codebase Tab (UI)

The dashboard's **Codebase tab** (`CodebasePage.svelte`, second tab after Tasks in the tab bar) is a full browsing surface over the index (verified 2026-08-10, components in `src/dashboard/ui/src/components/`):

- **Search & tree** — `CodebaseSearchBar.svelte` (symbol search), `CodebaseFileTree.svelte` + `FileTreeNode.svelte` (recursive file browsing)
- **File viewing** — `CodebaseFileViewer.svelte` renders indexed file content when a file is selected
- **Symbol detail** — `CodebaseSymbolDetail.svelte` + `CodebaseSymbolTrace.svelte` (definition, references, parent/children); each symbol's **call graph** renders as a canvas DAG in `CodebaseCallGraph.svelte` (callers/callees via `lib/callGraphLayout.ts`, mounted inside the detail view)
- **Index stats** — `CodebaseIndexStatus.svelte` (`IndexProgress.svelte`/`IndexStatusBadge.svelte`) plus `CodebaseLanguageBreakdown.svelte` (kind/file breakdown); dead-code candidates surface in `CodebaseDeadCode.svelte` (ARCHITECTURE mode)
- **Code-graph force panel** — `CodebaseGraphPanel.svelte` visualizes the repo as a force-directed graph by reusing the KG canvas (`KGGraphCanvas`), fed by `GET /api/codebase/graph`: kind filter (All/Calls/Imports/Co-defined), zoom/refresh, node click → symbol detail, and explicit index-required / error / empty overlays; `CodebaseGraphLegend.svelte` is the legend footer (node-kind color dots + six edge kinds + `N nodes · M edges` stats). Shared color mapping: `PALETTE`/`TYPE_COLOR_INDEX` in `lib/kg/kg-neural-renderer/layout.ts`, legend vocabulary in `lib/codebaseGraph.ts`.

Because of the polling watcher above, the Codebase tab may show fresh results by default — edits to an indexed repo are picked up within the sweep interval (default 30s) without an explicit re-index.

### Database Growth

Indexing large projects adds to `memory.db` size. A project with 10,000 TypeScript files may add 10-50MB. The database uses WAL mode, so reads are not blocked during writes.

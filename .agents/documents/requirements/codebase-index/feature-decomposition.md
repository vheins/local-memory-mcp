# Feature Decomposition — Codebase Index

> **Scope**: All phases (MVP, Phase 1.1, Phase 1.2).
> **Effort Scale**: S = <1 day, M = 1-3 days, L = 3-5 days, XL = 1-2 weeks.

---

## Layer Architecture

```mermaid
flowchart TD
    subgraph MCP[MCP Tool Layer]
        SS[search_symbols]
        GFS[get_file_symbols]
        IP[index_project]
        TP[trace_path]
        GA[get_architecture]
        SC[search_code]
    end

    subgraph Service[Service Layer]
        FS[File Discovery Service]
        PS[Parse Service]
        IS[Index Orchestrator]
        CR[Call Resolver]
        SI[Symbol Indexer]
    end

    subgraph Storage[Storage Layer]
        SQL[SQLite — codebase_nodes]
        SQE[SQLite — codebase_edges]
        SQF[SQLite — codebase_files]
    end

    subgraph Integration[Integration Layer]
        TS[tree-sitter WASM]
        FW[File Watcher]
        AH[Auto-Index Hook]
    end

    MCP --> Service
    Service --> Storage
    Service --> Integration
```

---

## MVP Tasks (P0)

### T1: File Discovery Service

> **Effort**: S | **Depends on**: Nothing

| Aspect          | Detail                                                                                                                                                                                                                                                                                      |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description** | Walk the project directory tree, respect `.gitignore`, apply include/exclude patterns, return a list of file paths.                                                                                                                                                                         |
| **Sub-tasks**   | 1. Implement recursive directory walker<br>2. Integrate `.gitignore` parsing (`ignore` package)<br>3. Implement include/exclude pattern matching<br>4. Detect and handle symlinks (resolve, cycle detection)<br>5. Detect and skip binary files<br>6. Detect and skip files over size limit |
| **Tests**       | Unit: directory walk with mock filesystem<br>Integration: walk real project, verify `.gitignore` respected<br>Edge: empty dir, symlink cycle, permission denied                                                                                                                             |
| **Files**       | `src/codebase-index/file-discovery.ts`<br>`src/codebase-index/__tests__/file-discovery.test.ts`                                                                                                                                                                                             |

---

### T2: SQLite Storage Schema & Migrations

> **Effort**: M | **Depends on**: Nothing (can parallel with T1)

| Aspect          | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description** | Define and migrate the `codebase_files`, `codebase_nodes`, and `codebase_edges` tables in the existing `memory.db`.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Sub-tasks**   | 1. Design schema: `codebase_files` (id, path, project_root, size, lines, indexed_at, parse_error)<br>2. Design schema: `codebase_nodes` (id, file_id, name, kind, signature, doc_comment, line_start, line_end, col_start, col_end, is_exported, parent_node_id)<br>3. Design schema: `codebase_edges` (id, source_node_id, target_node_id, edge_kind, file_id)<br>4. Create indexes on name, file_id, edge_kind<br>5. Write migration function (idempotent — `CREATE TABLE IF NOT EXISTS`)<br>6. Add foreign key relationships with CASCADE deletes |
| **Tests**       | Unit: schema creation, index verification<br>Integration: insert and query sample symbols, verify FK constraints                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Files**       | `src/codebase-index/schema.ts`<br>`src/codebase-index/__tests__/schema.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

### T3: tree-sitter Parser Integration

> **Effort**: L | **Depends on**: T1 (file paths), T2 (storage)

| Aspect          | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description** | Integrate `web-tree-sitter` with TypeScript/JavaScript grammar WASM. Parse files and extract declaration symbols.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Sub-tasks**   | 1. Install `web-tree-sitter` + `@tree-sitter-grammars/tree-sitter-typescript`<br>2. Initialize tree-sitter WASM at module load<br>3. Implement file parsing with error recovery<br>4. Write AST visitor for function declarations<br>5. Write AST visitor for class declarations + methods<br>6. Write AST visitor for interface / type / enum declarations<br>7. Write AST visitor for exported variable declarations<br>8. Extract signatures (params with names/types, return type)<br>9. Extract JSDoc/TSDoc comments<br>10. Handle files with syntax errors — extract partial symbols<br>11. Handle large files — AST depth limiting<br>12. Batch-write parsed symbols to SQLite |
| **Tests**       | Unit: parse single-file fixtures for each declaration kind<br>Integration: parse real project, verify all declarations captured<br>Edge: syntax errors, comments-only, BOM, shebang                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Files**       | `src/codebase-index/parser.ts`<br>`src/codebase-index/ast-visitors.ts`<br>`src/codebase-index/__tests__/fixtures/*.ts`<br>`src/codebase-index/__tests__/parser.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

---

### T4: Index Orchestrator

> **Effort**: M | **Depends on**: T1, T2, T3

| Aspect          | Detail                                                                                                                                                                                                                                                                                                                                                                           |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description** | Coordinate file discovery → parsing → storage. Handle progress reporting, concurrency guards, and error aggregation.                                                                                                                                                                                                                                                             |
| **Sub-tasks**   | 1. Implement `index_project` orchestration function<br>2. Add concurrency guard (mutex, reject duplicate requests)<br>3. Add progress callback (files processed, errors, duration)<br>4. Handle partial failures (some files fail, index what succeeded)<br>5. Implement full re-index (truncate + rebuild)<br>6. Report summary: files indexed, symbols stored, errors, skipped |
| **Tests**       | Integration: full index pipeline on test fixture project<br>Edge: concurrent index request, partial parse failures                                                                                                                                                                                                                                                               |
| **Files**       | `src/codebase-index/indexer.ts`<br>`src/codebase-index/__tests__/indexer.test.ts`                                                                                                                                                                                                                                                                                                |

---

### T5: MCP Tools — `search_symbols` and `get_file_symbols`

> **Effort**: M | **Depends on**: T4

| Aspect          | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description** | Register MCP tools that query the code graph. `search_symbols` for fuzzy/precision name search, `get_file_symbols` for file-level listing.                                                                                                                                                                                                                                                                                                                    |
| **Sub-tasks**   | 1. Register `codebase_index` tool — triggers full or incremental index<br>2. Implement `search_symbols` MCP tool with exact + prefix + fuzzy (SQL `LIKE` / FTS5)<br>3. Implement `get_file_symbols` MCP tool — query by file path<br>4. Handle missing-index error gracefully<br>5. Add input validation (empty query, invalid file path)<br>6. Return structured results with all metadata fields<br>7. Support filtering by symbol kind in `search_symbols` |
| **Tests**       | Integration: call tools via MCP protocol, verify responses<br>Unit: query logic, edge cases (no index, no results)                                                                                                                                                                                                                                                                                                                                            |
| **Files**       | `src/codebase-index/mcp-tools.ts`<br>`src/codebase-index/__tests__/mcp-tools.test.ts`                                                                                                                                                                                                                                                                                                                                                                         |

---

## Phase 1.1 Tasks (P1)

### T6: Cross-File Call Resolution

> **Effort**: L | **Depends on**: T3

| Aspect          | Detail                                                                                                                                                                                                                                                                                     |
| :-------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description** | Resolve function/method call expressions across files. Build `CALLS` edges in `codebase_edges`.                                                                                                                                                                                            |
| **Sub-tasks**   | 1. Extract call expressions from AST (`call_expression` nodes)<br>2. Resolve call target name to indexed symbol<br>3. Handle ambiguous names (multiple symbols with same name — best-effort)<br>4. Build `CALLS` edges with call site file/line metadata<br>5. Batch-write edges to SQLite |

---

### T7: `trace_path` MCP Tool

> **Effort**: M | **Depends on**: T6

| Aspect          | Detail                                                                                                                                                                                                                                                                                                  |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description** | Given a symbol name, trace inbound (callers) or outbound (callees) call chains.                                                                                                                                                                                                                         |
| **Sub-tasks**   | 1. Implement inbound query — find all symbols that CALL the target<br>2. Implement outbound query — find all symbols CALLED by the target<br>3. Support `maxDepth` parameter for multi-level traversal<br>4. Return ordered list of call chains<br>5. Handle symbols with no callers/callees gracefully |

---

### T8: `get_architecture` MCP Tool

> **Effort**: S | **Depends on**: T4

| Aspect          | Detail                                                                                                                                                                                                                                  |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description** | Return aggregate statistics about the indexed codebase.                                                                                                                                                                                 |
| **Sub-tasks**   | 1. Implement file count and symbol count aggregation queries<br>2. Implement per-kind symbol counts<br>3. Identify entry points (files with exports)<br>4. Compute directory depth and breadth<br>5. Return top-N files by symbol count |

---

### T9: Incremental Re-Indexing

> **Effort**: M | **Depends on**: T4

| Aspect          | Detail                                                                                                                                                                                                                                                                                                                  |
| :-------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description** | On subsequent index runs, only re-parse files whose mtime has changed. Handle deleted files.                                                                                                                                                                                                                            |
| **Sub-tasks**   | 1. Store `indexed_at` timestamp per file in `codebase_files`<br>2. On re-index, compare current mtime vs `indexed_at`<br>3. Re-parse only stale files (update existing symbol records)<br>4. Detect and remove deleted files' symbols<br>5. Detect and add new files<br>6. Fall back to full re-index if schema changed |

---

### T10: Auto-Index on Session Start

> **Effort**: S | **Depends on**: T4

| Aspect          | Detail                                                                                                                                                                                                                                                                                                                     |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description** | When MCP server initializes, automatically trigger indexing (full or incremental) with a file count guard.                                                                                                                                                                                                                 |
| **Sub-tasks**   | 1. Hook into MCP server initialization lifecycle<br>2. Check for existing index in `codebase_files` table<br>3. If no index, trigger full `index_project`<br>4. If index stale (>24h), trigger incremental re-index<br>5. If index fresh, skip<br>6. Enforce file count guard (default 50,000) to prevent runaway indexing |

---

## Phase 1.2 Tasks (P2)

### T11: Dashboard Codebase Tab

> **Effort**: M | **Depends on**: T4, existing Svelte dashboard

| Aspect          | Detail                                                                                                                                                                                                                                              |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description** | Add a "Codebase" tab to the existing Svelte dashboard showing indexed files, symbols, and search.                                                                                                                                                   |
| **Sub-tasks**   | 1. Add "Codebase" navigation tab<br>2. Build file tree browser (collapsible, respect project root)<br>3. Build symbol list view (filterable by kind)<br>4. Build search UI with real-time results<br>5. Wire to MCP tool endpoints via existing API |

---

### T12: `search_code` MCP Tool

> **Effort**: M | **Depends on**: T4

| Aspect          | Detail                                                                                                                                                          |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description** | Content search over indexed files, returning results enriched with surrounding symbol context.                                                                  |
| **Sub-tasks**   | 1. Implement content search over file text<br>2. Enrich results with nearby symbol definitions<br>3. Return file, line, context snippet, and associated symbols |

---

### T13: Multi-Language Support

> **Effort**: XL per language | **Depends on**: T3

| Aspect          | Detail                                                                                                                                                        |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description** | Extend tree-sitter parsing to additional languages (priority: Python → Rust → Go → PHP).                                                                      |
| **Sub-tasks**   | 1. Load language grammar WASM<br>2. Implement language-specific AST visitors<br>3. Add language-specific include patterns<br>4. Test against real-world repos |

---

## Dependency Graph

```mermaid
flowchart TD
    T1[T1: File Discovery S] --> T4[T4: Index Orchestrator M]
    T2[T2: SQLite Schema M] --> T4
    T3[T3: tree-sitter Parser L] --> T4
    T4 --> T5[T5: MCP Tools M]
    T3 --> T6[T6: Call Resolution L]
    T6 --> T7[T7: trace_path M]
    T4 --> T8[T8: get_architecture S]
    T4 --> T9[T9: Incremental Re-index M]
    T4 --> T10[T10: Auto-Index S]
    T4 --> T11[T11: Dashboard Tab M]
    T4 --> T12[T12: search_code M]
    T3 --> T13[T13: Multi-language XL]
```

## Effort Summary

| Phase | Task                            | Effort |   Cumulative   |
| :---- | :------------------------------ | :----: | :------------: |
| MVP   | T1 — File Discovery             |   S    |    0.5 day     |
| MVP   | T2 — SQLite Storage             |   M    |     2 days     |
| MVP   | T3 — tree-sitter Parser         |   L    |     4 days     |
| MVP   | T4 — Index Orchestrator         |   M    |     2 days     |
| MVP   | T5 — MCP Tools                  |   M    |     2 days     |
|       | **MVP Total**                   |        | **~10.5 days** |
| P1.1  | T6 — Call Resolution            |   L    |     4 days     |
| P1.1  | T7 — trace_path                 |   M    |     2 days     |
| P1.1  | T8 — get_architecture           |   S    |    0.5 day     |
| P1.1  | T9 — Incremental Re-index       |   M    |     2 days     |
| P1.1  | T10 — Auto-Index                |   S    |    0.5 day     |
|       | **Phase 1.1 Total**             |        |  **~9 days**   |
| P1.2  | T11 — Dashboard Tab             |   M    |     3 days     |
| P1.2  | T12 — search_code               |   M    |     2 days     |
| P1.2  | T13 — Multi-language (per lang) |   XL   |    5-7 days    |
|       | **Phase 1.2 Total**             |        | **~5-10 days** |
|       | **Grand Total (MVP + P1)**      |        | **~19.5 days** |

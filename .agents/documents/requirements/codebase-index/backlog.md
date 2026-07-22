# Backlog — Codebase Index

> **Priority levels**: P0 = MVP gate, P1 = Should-have (Phase 1.1), P2 = Could-have (Phase 1.2).
> Each item links to the relevant task in `feature-decomposition.md` (T#) and user story (US-#).

---

## P0 — Must-Have (MVP Gate)

|  #  | Priority | Task                                                                                                                                                                         | Effort | Feature (mvp-scope) | User Story          | Depends On |
| :-: | :------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :------------------ | :------------------ | :--------: |
|  1  |    P0    | **File Discovery Service** — Recursive directory walker respecting `.gitignore`, include/exclude patterns, symlink handling, binary detection                                |   S    | M1                  | US-02               |     —      |
|  2  |    P0    | **SQLite Schema & Migrations** — `codebase_files`, `codebase_nodes`, `codebase_edges` tables with indexes and FK constraints                                                 |   M    | M3                  | US-01               |     —      |
|  3  |    P0    | **tree-sitter WASM Parser Integration** — Initialize WASM, parse TS/JS files, extract functions, classes, interfaces, types, enums, exports with signatures and doc comments |   L    | M2                  | US-01, US-05, US-06 |   #1, #2   |
|  4  |    P0    | **Index Orchestrator** — Coordinate discovery → parse → store pipeline with concurrency guard, progress reporting, error aggregation                                         |   M    | M1, M2, M3          | US-01               | #1, #2, #3 |
|  5  |    P0    | **`index_project` MCP Tool** — Trigger full or incremental index from MCP client                                                                                             |   M    | M1–M5               | US-01               |     #4     |
|  6  |    P0    | **`search_symbols` MCP Tool** — Exact, prefix, fuzzy search by symbol name; filter by kind; structured results                                                               |   M    | M4                  | US-03               |     #4     |
|  7  |    P0    | **`get_file_symbols` MCP Tool** — List all symbols in a given file ordered by declaration                                                                                    |   S    | M5                  | US-04               |     #4     |

### P0 Total Effort: ~10.5 days

---

## P1 — Should-Have (Phase 1.1)

|  #  | Priority | Task                                                                                                                              | Effort | Feature (mvp-scope) | User Story | Depends On |
| :-: | :------: | :-------------------------------------------------------------------------------------------------------------------------------- | :----: | :------------------ | :--------- | :--------: |
|  8  |    P1    | **Cross-File Call Resolution** — Extract `call_expression` nodes, resolve target symbols, build `CALLS` edges in `codebase_edges` |   L    | S1                  | US-07      |     #3     |
|  9  |    P1    | **`trace_path` MCP Tool** — Inbound/outbound call chain traversal with configurable max depth                                     |   M    | S2                  | US-07      |     #8     |
| 10  |    P1    | **`get_architecture` MCP Tool** — Aggregate stats: file/symbol counts, per-kind breakdown, entry points, directory depth          |   S    | S3                  | US-09      |     #4     |
| 11  |    P1    | **Incremental Re-Indexing** — Compare mtime vs stored `indexed_at`; re-parse only stale/new files; remove deleted files           |   M    | S4                  | US-08      |     #4     |
| 12  |    P1    | **Auto-Index on Session Start** — Hook into MCP init; check index freshness; trigger index with file count guard                  |   S    | S5                  | US-10      |     #4     |
| 13  |    P1    | **Index Staleness Warning** — Surface staleness in tool responses when index is older than threshold                              |   S    | S4                  | US-08      |    #11     |

### P1 Total Effort: ~10 days

---

## P2 — Could-Have (Phase 1.2)

|  #  | Priority | Task                                                                                                  | Effort | Feature (mvp-scope) | User Story | Depends On |
| :-: | :------: | :---------------------------------------------------------------------------------------------------- | :----: | :------------------ | :--------- | :--------: |
| 14  |    P2    | **Dashboard Codebase Tab** — Svelte 5 tab for browsing files, symbols, and search in the browser      |   M    | C1                  | US-12      |     #4     |
| 15  |    P2    | **`search_code` MCP Tool** — Graph-augmented content search with symbol context enrichment            |   M    | C3                  | US-11      |     #4     |
| 16  |    P2    | **Dead Code Detection** — Find functions with zero callers (excluding exports and known entry points) |   M    | C5                  | —          |     #8     |
| 17  |    P2    | **Multi-Language: Python** — Add tree-sitter Python grammar + AST visitor                             |   XL   | C4                  | —          |     #3     |
| 18  |    P2    | **Multi-Language: Rust** — Add tree-sitter Rust grammar + AST visitor                                 |   XL   | C4                  | —          |     #3     |
| 19  |    P2    | **Multi-Language: Go** — Add tree-sitter Go grammar + AST visitor                                     |   XL   | C4                  | —          |     #3     |
| 20  |    P2    | **Multi-Language: PHP** — Add tree-sitter PHP grammar + AST visitor                                   |   XL   | C4                  | —          |     #3     |
| 21  |    P2    | **3D Graph Visualization** — Interactive knowledge graph in Dashboard using D3.js force layout        |   XL   | C2                  | —          |    #14     |
| 22  |    P2    | **Symbol Usage Statistics** — Track most-queried symbols, popular files, search analytics             |   S    | —                   | —          |     #6     |

### P2 Total Effort: ~15-25 days (varies with number of languages)

---

## Phase 2 (Explicitly Out of MVP — Won't Have)

|  #  | Priority | Task                            | Effort | Rationale                                                                 |
| :-: | :------: | :------------------------------ | :----: | :------------------------------------------------------------------------ |
| 23  |    —     | **Cross-Repository Indexing**   |   XL   | Adds multi-root workspace complexity; rare need for single-project agents |
| 24  |    —     | **LSP Integration**             |   XL   | Requires spawning language servers; high complexity for marginal MVP gain |
| 25  |    —     | **Team-Shared Graph Artifacts** |   L    | Committing compressed graph DB to repo; needs git integration             |
| 26  |    —     | **Semantic / Vector Search**    |   XL   | ONNX model loading and embedding inference; high infra cost               |
| 27  |    —     | **ADR Management**              |   M    | Architecture Decision Record creation/linking; niche workflow             |

---

## Sprint Allocation

### Sprint 1 (2 weeks): MVP Foundation

```
Week 1: #1  File Discovery Service     [S]
         #2  SQLite Schema & Migrations [M]
         #3  tree-sitter Parser         [L] (start)
Week 2: #3  tree-sitter Parser          [L] (finish)
         #4  Index Orchestrator         [M]
         #5  index_project tool         [M]
         #6  search_symbols tool        [M]
         #7  get_file_symbols tool      [S]
```

### Sprint 2 (2 weeks): Call Graph & Agent Tools

```
Week 1: #8  Cross-File Call Resolution [L]
         #9  trace_path tool            [M]
         #11 Incremental Re-Indexing    [M]
Week 2: #10 get_architecture tool       [S]
         #12 Auto-Index                 [S]
         #13 Staleness Warning          [S]
         Buffer / bug fixes
```

### Sprint 3 (2 weeks): Dashboard & Extras

```
Week 1: #14 Dashboard Codebase Tab     [M]
         #15 search_code tool           [M]
         #11 Incremental Re-Indexing    [M] (if not done)
Week 2: #17 Multi-Language: Python     [XL] (start)
         Bug fixes, polish, performance
```

---

## Capacity Assumptions

| Factor                        | Value                                                                     |
| :---------------------------- | :------------------------------------------------------------------------ |
| Sprint length                 | 2 weeks (10 working days)                                                 |
| Team size                     | 1-2 engineers                                                             |
| Available capacity per sprint | ~12-16 effective person-days (accounting for meetings, reviews, overhead) |
| MVP timeline                  | 1 sprint (Sprint 1)                                                       |
| Phase 1.1 timeline            | 1 sprint (Sprint 2)                                                       |
| Phase 1.2 timeline            | 1-2 sprints (Sprint 3 onward)                                             |
| Total MVP+Phase1              | ~3 sprints (6 weeks)                                                      |

---

## Prioritization Rationale

### Why P0 for file discovery and SQLite (over tree-sitter)?

File discovery and storage are **foundational** — without them, no symbol can be ingested or stored. tree-sitter parsing is the most effort-intensive but depends on both. Build order: file system first, data model second, parser third.

### Why `search_symbols` is P0 but `trace_path` is P1?

Name-based search covers 80% of agent queries (finding a function, checking parameters). Call chain tracing is valuable but requires cross-file resolution, which doubles parser complexity. MVP delivers 80% of value at ~50% of the effort.

### Why Auto-Index is P1, not P0?

Manual `index_project` call works fine for MVP. Auto-index is convenience. Delaying it to Phase 1.1 lets us validate the core pipeline before adding lifecycle hooks.

### Why Dashboard is P2?

The MCP tools provide full functionality for agent consumers. The Dashboard is a developer-facing convenience that can ship later without breaking any agent workflows.

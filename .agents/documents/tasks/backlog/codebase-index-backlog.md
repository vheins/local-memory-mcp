# Codebase Index — Prioritized Backlog

**Last Updated:** 2026-07-22

**Prioritization Framework:** MoSCoW (Must-have, Should-have, Could-have, Won't-have) with P0-P4 mapping.

| Priority | MoSCoW                  | Definition                                      |
| :------- | :---------------------- | :---------------------------------------------- |
| **P0**   | Must-have               | Critical for MVP — blocks the sprint if missing |
| **P1**   | Should-have             | Important but not critical — workaround exists  |
| **P2**   | Could-have              | Nice to have — included if capacity permits     |
| **P3**   | Won't-have (this phase) | Deferred to Phase 8 (Post-MVP)                  |
| **P4**   | Won't-have (future)     | No current plan — parked for community/roadmap  |

**Effort Scale:** Small (S, ≤1 day), Medium (M, 2-3 days), Large (L, 4-5 days), XL (>5 days)

---

## MVP Items (Sprints 7-10)

| ID    | Title                                  | Priority | MoSCoW | Sprint    | Effort | Dependencies               |
| :---- | :------------------------------------- | :------- | :----- | :-------- | :----- | :------------------------- |
| CI-01 | File Discovery Service                 | **P0**   | Must   | Sprint 7  | 3 days | —                          |
| CI-02 | Tree-Sitter WASM Parser Integration    | **P0**   | Must   | Sprint 7  | 4 days | —                          |
| CI-03 | CodebaseFile Entity & SQLite Table     | **P0**   | Must   | Sprint 7  | 1 day  | —                          |
| CI-04 | CodebaseSymbol Entity & SQLite Table   | **P0**   | Must   | Sprint 7  | 1 day  | —                          |
| CI-05 | CodebaseIndex Orchestration Service    | **P0**   | Must   | Sprint 7  | 3 days | CI-01, CI-02, CI-03, CI-04 |
| CI-06 | `index_repository` MCP Tool            | **P0**   | Must   | Sprint 7  | 2 days | CI-05                      |
| CI-07 | CLI Trigger for Indexing               | **P1**   | Should | Sprint 7  | 1 day  | CI-05                      |
| CI-08 | Unit Tests for Core Indexing           | **P0**   | Must   | Sprint 7  | 2 days | CI-01 — CI-05              |
| CI-09 | `search_symbols` MCP Tool              | **P0**   | Must   | Sprint 8  | 2 days | CI-05, CI-13               |
| CI-10 | `get_file_symbols` MCP Tool            | **P0**   | Must   | Sprint 8  | 1 day  | CI-05                      |
| CI-11 | `get_architecture` MCP Tool            | **P1**   | Should | Sprint 8  | 3 days | CI-05                      |
| CI-12 | `trace_symbol` MCP Tool                | **P1**   | Should | Sprint 8  | 2 days | CI-05, CI-09               |
| CI-13 | Symbol Search Ranking & Filtering      | **P0**   | Must   | Sprint 8  | 2 days | CI-04                      |
| CI-14 | Integration Tests for MCP Tools        | **P0**   | Must   | Sprint 8  | 2 days | CI-09 — CI-12              |
| CI-15 | API Documentation Update               | **P1**   | Should | Sprint 8  | 1 day  | CI-09 — CI-12              |
| CI-16 | Codebase Tab UI Shell & Routing        | **P0**   | Must   | Sprint 9  | 2 days | —                          |
| CI-17 | FileTree Component                     | **P0**   | Must   | Sprint 9  | 3 days | CI-16, CI-11               |
| CI-18 | SymbolList & SymbolDetail Components   | **P0**   | Must   | Sprint 9  | 3 days | CI-16, CI-10, CI-12        |
| CI-19 | SearchBar with Autocomplete            | **P1**   | Should | Sprint 9  | 2 days | CI-09, CI-18               |
| CI-20 | IndexStatus Widget                     | **P1**   | Should | Sprint 9  | 1 day  | CI-05                      |
| CI-21 | Auto-Index on Project Open             | **P2**   | Could  | Sprint 9  | 2 days | CI-05, CI-20               |
| CI-22 | Dashboard Backend API Endpoints        | **P0**   | Must   | Sprint 9  | 2 days | CI-09 — CI-12, CI-20       |
| CI-23 | Dashboard Integration Tests            | **P0**   | Must   | Sprint 9  | 2 days | CI-22                      |
| CI-24 | Incremental Re-Index (Checksum-Based)  | **P0**   | Must   | Sprint 10 | 2 days | CI-05                      |
| CI-25 | Index Staleness Detection              | **P1**   | Should | Sprint 10 | 1 day  | CI-20, CI-24               |
| CI-26 | Performance Optimization (Large Repos) | **P1**   | Should | Sprint 10 | 3 days | CI-24                      |
| CI-27 | Error Handling & Recovery              | **P0**   | Must   | Sprint 10 | 2 days | CI-05, CI-06               |
| CI-28 | Full Test Coverage                     | **P0**   | Must   | Sprint 10 | 3 days | CI-24 — CI-27              |
| CI-29 | Documentation Finalization             | **P1**   | Should | Sprint 10 | 2 days | CI-28                      |
| CI-30 | Release Preparation                    | **P1**   | Should | Sprint 10 | 1 day  | CI-29                      |

---

## Post-MVP Items (Phase 8 — Future)

### Multi-Language Expansion

| ID    | Title                                     | Priority | MoSCoW          | Effort | Notes                                                    |
| :---- | :---------------------------------------- | :------- | :-------------- | :----- | :------------------------------------------------------- |
| CI-31 | Python Grammar Integration                | P3       | Won't (Phase 8) | 2 days | `@tree-sitter-grammars/tree-sitter-python`               |
| CI-32 | Python Visitor Implementation             | P3       | Won't (Phase 8) | 3 days | `PythonVisitor` implementing `LanguageVisitor` interface |
| CI-33 | Rust Grammar Integration                  | P3       | Won't (Phase 8) | 2 days | `@tree-sitter-grammars/tree-sitter-rust`                 |
| CI-34 | Rust Visitor Implementation               | P3       | Won't (Phase 8) | 3 days | `RustVisitor` implementing `LanguageVisitor` interface   |
| CI-35 | Go Grammar Integration                    | P3       | Won't (Phase 8) | 2 days | `@tree-sitter-grammars/tree-sitter-go`                   |
| CI-36 | Go Visitor Implementation                 | P3       | Won't (Phase 8) | 3 days | `GoVisitor` implementing `LanguageVisitor` interface     |
| CI-37 | PHP Grammar Integration                   | P3       | Won't (Phase 8) | 2 days | `@tree-sitter-grammars/tree-sitter-php`                  |
| CI-38 | PHP Visitor Implementation                | P3       | Won't (Phase 8) | 3 days | `PHPVisitor` implementing `LanguageVisitor` interface    |
| CI-39 | Language auto-detection by file extension | P3       | Won't (Phase 8) | 1 day  | Map `.py` → Python, `.rs` → Rust, etc.                   |
| CI-40 | Multi-language cross-reference resolution | P3       | Won't (Phase 8) | 4 days | Symbol references across language boundaries             |

### Cross-File Relation Resolution

| ID    | Title                                   | Priority | MoSCoW          | Effort | Notes                                                 |
| :---- | :-------------------------------------- | :------- | :-------------- | :----- | :---------------------------------------------------- |
| CI-41 | Second parser pass for call expressions | P3       | Won't (Phase 8) | 4 days | Extract `CALLS` relations between files               |
| CI-42 | Import/export relation extraction       | P3       | Won't (Phase 8) | 3 days | Extract `IMPORTS` relations                           |
| CI-43 | Extends/implements relation extraction  | P3       | Won't (Phase 8) | 3 days | Extract `EXTENDS`, `IMPLEMENTS` relations             |
| CI-44 | `codebase_relations` table and entity   | P3       | Won't (Phase 8) | 1 day  | New SQLite table for relations                        |
| CI-45 | Relation-aware `trace_symbol` v2        | P3       | Won't (Phase 8) | 3 days | Use relations for accurate reference tracing          |
| CI-46 | Dependency graph visualization          | P3       | Won't (Phase 8) | 4 days | Force-directed graph in dashboard (reuse KG renderer) |
| CI-47 | Relation export (DOT/JSON)              | P3       | Won't (Phase 8) | 1 day  | Export dependency graph for external tools            |

### LSP Integration

| ID    | Title                                      | Priority | MoSCoW          | Effort | Notes                                                       |
| :---- | :----------------------------------------- | :------- | :-------------- | :----- | :---------------------------------------------------------- |
| CI-48 | LSP client integration for type resolution | P3       | Won't (Phase 8) | 5 days | Use `vscode-languageserver-protocol` for type-aware queries |
| CI-49 | Go-to-definition via LSP                   | P3       | Won't (Phase 8) | 2 days | Enhanced `trace_symbol` resolution accuracy                 |
| CI-50 | Find-all-references via LSP                | P3       | Won't (Phase 8) | 2 days | Enhanced reference resolution accuracy                      |
| CI-51 | Hover information via LSP                  | P3       | Won't (Phase 8) | 2 days | Type information on hover in dashboard                      |

### Performance & Scale

| ID    | Title                                         | Priority | MoSCoW          | Effort | Notes                                                     |
| :---- | :-------------------------------------------- | :------- | :-------------- | :----- | :-------------------------------------------------------- |
| CI-52 | File watcher (fs.watch) for real-time updates | P2       | Could           | 4 days | Real-time index updates on file save                      |
| CI-53 | Streaming index progress via SSE              | P2       | Could           | 2 days | Real-time progress in dashboard without polling           |
| CI-54 | Index compression for storage savings         | P3       | Won't (Phase 8) | 2 days | Compress doc_comments; store in separate compressed table |
| CI-55 | Index pruning (old/non-existent symbols)      | P2       | Could           | 2 days | Automatic cleanup of stale index entries                  |

### Agent Intelligence

| ID    | Title                                   | Priority | MoSCoW          | Effort | Notes                                                            |
| :---- | :-------------------------------------- | :------- | :-------------- | :----- | :--------------------------------------------------------------- |
| CI-56 | Auto-suggest related symbols on search  | P2       | Could           | 2 days | "Did you mean?" — Levenshtein-based fuzzy matching               |
| CI-57 | Symbol usage frequency tracking         | P3       | Won't (Phase 8) | 2 days | Track hit_count per symbol for smarter ranking                   |
| CI-58 | Embedding-based semantic symbol search  | P3       | Won't (Phase 8) | 3 days | Use existing `@xenova/transformers` for vector search on symbols |
| CI-59 | Automatic index on task context loading | P2       | Could           | 1 day  | Index repo when `agent-context` detects a new repo reference     |

### Technical Debt & Quality

| ID    | Title                                         | Priority | MoSCoW          | Effort | Notes                                                             |
| :---- | :-------------------------------------------- | :------- | :-------------- | :----- | :---------------------------------------------------------------- |
| CI-60 | End-to-end test with real node_modules        | P2       | Could           | 2 days | Test indexing against a real project with dependencies            |
| CI-61 | Benchmark suite for indexing performance      | P2       | Could           | 2 days | Track indexing times across releases                              |
| CI-62 | CI integration: auto-index on demo repo       | P2       | Could           | 1 day  | Verify indexing works in CI environment                           |
| CI-63 | Fuzz testing for parser edge cases            | P3       | Won't (Phase 8) | 3 days | Random AST mutation for parser robustness                         |
| CI-64 | Symbol deduplication across monorepo packages | P3       | Won't (Phase 8) | 2 days | Handle same symbol defined in multiple packages within a monorepo |

---

## Summary

| Category                                  | Count    |
| :---------------------------------------- | :------- |
| **MVP (Sprints 7-10) — P0**               | 16 items |
| **MVP (Sprints 7-10) — P1**               | 10 items |
| **MVP (Sprints 7-10) — P2**               | 4 items  |
| **Post-MVP (Phase 8) — P3**               | 22 items |
| **Post-MVP (Phase 8) — P2 (Could defer)** | 8 items  |
| **Total Backlog**                         | 64 items |

### MVP Effort Summary

| Sprint                           | P0-Must | P1-Should | P2-Could | Total Effort | Calendar    |
| :------------------------------- | :------ | :-------- | :------- | :----------- | :---------- |
| Sprint 7: Core Indexing          | 6       | 2         | 0        | 17 days      | 2 weeks     |
| Sprint 8: MCP Tools & Search     | 3       | 4         | 0        | 13 days      | 2 weeks     |
| Sprint 9: Dashboard & Auto-Index | 5       | 3         | 2        | 15 days      | 2 weeks     |
| Sprint 10: Polish & Performance  | 2       | 3         | 0        | 14 days      | 2 weeks     |
| **Total**                        | **16**  | **12**    | **2**    | **59 days**  | **8 weeks** |

> **Note:** Effort estimates are in ideal developer-days. Real calendar duration assumes 5-day sprints with 1 buffer day per sprint for meetings, reviews, and unplanned work. Parallelization across backend and frontend reduces calendar time for Sprints 8-9.

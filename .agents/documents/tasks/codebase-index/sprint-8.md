# Sprint 8: MCP Tools & Search 🚧

**Sprint Goal:** Expose indexed codebase data through MCP tools — search symbols by name, inspect file contents, trace symbol relationships, and get architecture overviews. Deliver a comprehensive query interface for AI agents.

**Duration:** 2 weeks (10 working days)

**Dependencies:** Sprint 7 (SQLite schema, parsing pipeline, and `CodebaseIndexService` must be complete and tested).

---

## Backlog Items

### CI-09: `search_symbols` MCP Tool (Effort: 2 days)

**Owner:** backend

**Description:** Implement the `search_symbols` MCP tool that allows agents to search indexed symbols by name, kind, file path, or a combination. Supports fuzzy matching and returns ranked results.

**Acceptance Criteria:**

- [ ] Tool name: `search_symbols` with clear description
- [ ] Input schema (Zod):
  - `query` (string, required) — symbol name or partial name to search
  - `repo` (string, optional) — scope search to a specific `owner/repo`
  - `kind` (string, optional) — filter by symbol kind: `function`, `class`, `interface`, `type`, `enum`, `variable`
  - `filePath` (string, optional) — filter by file path (glob pattern supported)
  - `exportedOnly` (boolean, optional, default: false) — only exported symbols
  - `limit` (number, optional, default: 50, max: 200)
  - `offset` (number, optional, default: 0)
- [ ] Output: `{ symbols: CodebaseSymbol[], total: number, hasMore: boolean }`
- [ ] Search ranking:
  1. Exact name match (highest priority)
  2. Prefix match (name starts with query)
  3. Substring match (name contains query)
  4. FTS5 match in doc_comment (lowest priority)
- [ ] Within same rank tier, sort by: exported > non-exported, then by file path alphabetically
- [ ] FTS5 full-text search on symbol name and doc_comment as fallback
- [ ] Empty query returns nothing (require at least 2 characters, except for kind-only searches)
- [ ] Proper error responses for invalid kind values, invalid repo format

**Technical Notes:**

- Uses FTS5 on `codebase_symbols_fts` for full-text fallback
- Primary query: `SELECT ... FROM codebase_symbols WHERE name LIKE ? ORDER BY ...`
- Tool paths: `src/mcp/tools/definitions/codebase-index.ts` (add to existing), handler in `src/mcp/tools/codebase-index.ts`

---

### CI-10: `get_file_symbols` MCP Tool (Effort: 1 day)

**Owner:** backend

**Description:** Implement `get_file_symbols` MCP tool that returns all symbols declared in a given file, organized by file metadata and symbol listing.

**Acceptance Criteria:**

- [ ] Tool name: `get_file_symbols`
- [ ] Input schema: `repo` (string, required), `filePath` (string, required)
- [ ] Output: `{ file: { path, language, checksum, lines, lastIndexedAt }, symbols: CodebaseSymbol[], total: number }`
- [ ] Symbols returned in declaration order (by `start_line` ascending)
- [ ] Nested symbols (class methods, properties) included with `parentSymbolId` populated
- [ ] Returns 404-style error if file is not in the index: `{ error: "File not indexed. Run index_repository first.", code: "FILE_NOT_INDEXED" }`
- [ ] File path matching is exact (not glob) — document this in the tool description

**Technical Notes:**

- Query: `SELECT * FROM codebase_symbols WHERE repo = ? AND file_path = ? ORDER BY start_line ASC`

---

### CI-11: `get_architecture` MCP Tool (Effort: 3 days)

**Owner:** backend

**Description:** Implement `get_architecture` MCP tool that returns a high-level overview of the codebase structure: directory tree, top-level symbols, and module boundaries. Helps agents understand the project layout without reading every file.

**Acceptance Criteria:**

- [ ] Tool name: `get_architecture`
- [ ] Input schema:
  - `repo` (string, required)
  - `depth` (number, optional, default: 2, max: 5) — directory tree depth
  - `includeSymbolCounts` (boolean, optional, default: true)
- [ ] Output: `{ repo, root: DirectoryNode, summary: ArchitectureSummary }`
- [ ] `DirectoryNode`: `{ path, name, type: 'file'|'directory', children?: DirectoryNode[], symbolCounts?: { function: number, class: number, interface: number, type: number, enum: number } }`
- [ ] `ArchitectureSummary`: `{ totalFiles, totalSymbols, languageBreakdown: { [language]: number }, topLevelExports: CodebaseSymbol[] (sorted by export count) }`
- [ ] Directory tree respects the requested `depth` (deep nodes are summarized with `{ hasMoreFiles: true, symbolCounts: { ... } }`)
- [ ] `languageBreakdown` shows distribution: `{ TypeScript: 45, JavaScript: 3, TypeScriptReact: 12 }`
- [ ] `topLevelExports` returns the 20 most exported symbols across the codebase
- [ ] Response time < 1s for repos with 10K+ files (aggregate queries, no full-table scans)

**Technical Notes:**

- Implementation: `CodebaseArchitectureService` at `src/mcp/codebase-index/services/architecture-service.ts`
- Builds directory tree by aggregating file paths from `codebase_files`
- Symbol counts per directory via `GROUP BY` SQL queries
- Top-level exports: query `codebase_symbols WHERE exported = 1 AND parent_symbol_id IS NULL ORDER BY ... LIMIT 20`

---

### CI-12: `trace_symbol` MCP Tool (Effort: 2 days)

**Owner:** backend

**Description:** Implement `trace_symbol` MCP tool that traces a symbol's definition, references, and import/export chain. Helps agents understand how a symbol is used across the codebase.

**Acceptance Criteria:**

- [ ] Tool name: `trace_symbol`
- [ ] Input schema:
  - `name` (string, required) — full symbol name
  - `repo` (string, optional) — scope to a specific repo
  - `includeReferences` (boolean, optional, default: true) — include files that import/use the symbol
- [ ] Output: `{ symbol: CodebaseSymbol, definition: { file, line, column }, references: { file, startLine, endLine, context: string }[], exportChain: { exported: boolean, defaultExport: boolean, reExports: string[] }, relatedSymbols: CodebaseSymbol[] }`
- [ ] Symbol resolution strategy (Phase 1.0 — name-based, pattern matching):
  1. Find symbols with exact name match in `codebase_symbols`
  2. If `includeReferences` is true, search FTS5 doc_comment and file contents for the name
  3. Return `references` as list of locations where the name appears (line-level granularity)
- [ ] If symbol is not found, return clear error: `{ error: "Symbol 'Foo' not found in index. Try a partial search with search_symbols first.", code: "SYMBOL_NOT_FOUND" }`
- [ ] For ambiguous symbols (multiple definitions with same name in different files), return all definitions with a `disambiguation` hint

**Technical Notes:**

- Reference resolution in MVP is syntactic (name-based), not semantic — document this limitation
- Phase 1.1 will add true cross-file relation resolution (calls, imports, extends) via a second parser pass
- Service path: `src/mcp/codebase-index/services/trace-service.ts`

---

### CI-13: Symbol Search Ranking & Filtering (Effort: 2 days)

**Owner:** backend

**Description:** Implement the ranking algorithm and filter infrastructure used by `search_symbols`. This is a library/service that can be reused by the dashboard search (Sprint 9) and extended for future features (relation search, fuzzy search).

**Acceptance Criteria:**

- [ ] `SymbolRankingService` with pluggable ranking strategy
- [ ] Ranking tiers:
  - Tier 1: Exact match (case-sensitive, then case-insensitive)
  - Tier 2: CamelCase / PascalCase match (query `FooBar` matches `FooBar`, `getFooBar`)
  - Tier 3: Prefix match (`foo` matches `fooBar`, `fooToggle`)
  - Tier 4: Substring match (`bar` matches `fooBar`, `barBaz`)
  - Tier 5: FTS5 full-text match in name or doc_comment
- [ ] Tiebreaker within tiers: exported > non-exported, then file depth (shallow > deep), then alphabetically
- [ ] Filter pipeline: kind → repo → filePath → exportedOnly (applied before ranking)
- [ ] `SymbolRankingService` is a standalone class, testable without SQLite (accepts in-memory arrays)
- [ ] Well-documented ranking logic in source comments

**Technical Notes:**

- Service path: `src/mcp/codebase-index/services/symbol-ranking.ts`

---

### CI-14: Integration Tests for All MCP Tools (Effort: 2 days)

**Owner:** backend

**Description:** End-to-end integration tests for all four MCP tools (`search_symbols`, `get_file_symbols`, `get_architecture`, `trace_symbol`), testing against a fixture repository.

**Acceptance Criteria:**

- [ ] Test fixture: a small TypeScript project (`src/mcp/tests/fixtures/codebase-index/search-test-fixture/`) with:
  - Multiple `.ts` and `.tsx` files
  - Exported and non-exported symbols
  - Classes with methods, interfaces, types, enums
  - Default exports
- [ ] `search_symbols` tests:
  - Searches by exact name and returns the correct symbol
  - Searches by prefix and returns multiple ranked results
  - Kind filter works
  - Repo scope works
  - Returns empty result for non-existent symbol
- [ ] `get_file_symbols` tests:
  - Returns all symbols in a known file
  - Returns symbols in declaration order
  - Returns error for non-indexed file
- [ ] `get_architecture` tests:
  - Returns directory tree with correct depth
  - Symbol counts are accurate
  - Language breakdown is correct
  - Top-level exports list is non-empty for fixture
- [ ] `trace_symbol` tests:
  - Returns definition for a known exported function
  - Returns references for a commonly used symbol
  - Returns disambiguation for ambiguous names
  - Returns error for non-existent symbol
- [ ] All tests use the same fixture, indexed once in `beforeAll`

**Technical Notes:**

- Use `CodebaseIndexService` to index the fixture in `beforeAll`
- Test file: `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`

---

### CI-15: API Documentation Update (Effort: 1 day)

**Owner:** documentation

**Description:** Update the project's API documentation to cover the four new MCP tools — their purpose, input schemas, output schemas, error codes, and usage examples.

**Acceptance Criteria:**

- [ ] Each tool documented with: purpose, input fields (name, type, required/optional, description), output shape, error codes, and at least one usage example
- [ ] Cross-reference with ADR-002 for architecture decisions
- [ ] Include notes on known limitations (name-based reference resolution, single language at MVP)
- [ ] Update `README.md` "Available Tools" section if it lists tools
- [ ] Add/update `docs/api/codebase-index.md` with full API reference

**Technical Notes:**

- Docs path: `docs/api/codebase-index.md`

---

## Dependencies

| Item  | Depends On    | Description                                  |
| :---- | :------------ | :------------------------------------------- |
| CI-09 | CI-05, CI-13  | Search tool needs indexing service + ranking |
| CI-10 | CI-05         | File symbol tool needs indexed files         |
| CI-11 | CI-05         | Architecture tool needs indexed files        |
| CI-12 | CI-05, CI-09  | Trace tool needs search + indexing           |
| CI-13 | CI-04         | Ranking needs symbol entity                  |
| CI-14 | CI-09 — CI-12 | Integration tests need all tools implemented |
| CI-15 | CI-09 — CI-12 | Documentation needs final tool interfaces    |

## Risk Register

| Risk                                                                | Likelihood | Impact | Mitigation                                                            |
| :------------------------------------------------------------------ | :--------- | :----- | :-------------------------------------------------------------------- |
| FTS5 query performance degrades with large symbol tables            | Low        | Medium | Limit default result size; add pagination; index `name` column        |
| Name-based reference resolution produces false positives            | High       | Low    | Document as known limitation; Phase 1.1 adds true relation resolution |
| Tool input schemas change during sprint, breaking integration tests | Medium     | Medium | Define schemas first, implement handlers second, write tests last     |
| `get_architecture` response too large for very deep repos           | Low        | Medium | Depth limit with `hasMoreFiles` summarization                         |

**Status: NOT STARTED**

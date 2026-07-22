# Sprint 7: Core Indexing 🚧

**Sprint Goal:** Build the file discovery engine, tree-sitter parser integration, SQLite schema, and end-to-end indexing pipeline. After this sprint, the system must be able to index a TypeScript/JavaScript repository from file discovery through symbol storage.

**Duration:** 2 weeks (10 working days)

**Dependencies:** None — this is a standalone new module that does not modify existing features.

---

## Backlog Items

### CI-01: File Discovery Service (Effort: 3 days)

**Owner:** backend

**Description:** Implement `FileDiscoveryService` that walks a directory tree, discovers source files, and filters according to `.gitignore` rules and glob include/exclude patterns. Must handle hidden directories, symlinks (skip), and large directory trees efficiently.

**Acceptance Criteria:**

- [ ] Walks directory tree recursively, returning relative file paths
- [ ] Respects `.gitignore` patterns — files matching gitignore rules are excluded
- [ ] Supports custom include glob patterns (e.g., `**/*.ts`, `**/*.tsx`)
- [ ] Supports custom exclude glob patterns (e.g., `**/node_modules/**`, `**/dist/**`)
- [ ] Falls back to sensible defaults when no `.gitignore` is present (skip `node_modules`, `.git`, `dist`, `.next`, `build`)
- [ ] Handles 10,000+ files without excessive memory usage (streaming iteration)
- [ ] Returns sorted, deterministic results
- [ ] Symlinks are skipped, not followed

**Technical Notes:**

- Use `fast-glob` or `micromatch` for glob matching
- Use `ignore` npm package for `.gitignore` parsing
- Module path: `src/mcp/codebase-index/services/file-discovery.ts`

---

### CI-02: Tree-Sitter WASM Parser Integration (Effort: 4 days)

**Owner:** backend

**Description:** Integrate `web-tree-sitter` WASM bindings for parsing TypeScript/JavaScript files. Implement an abstract `LanguageVisitor` interface and a `TypeScriptVisitor` that extracts declarations from parsed AST trees. Support TypeScript (`.ts`), TypeScript JSX (`.tsx`), JavaScript (`.js`), and JavaScript JSX (`.jsx`) files.

**Acceptance Criteria:**

- [ ] `web-tree-sitter` WASM initializes successfully on first parse (not at server startup)
- [ ] Lazy initialization — WASM is loaded on first `index_repository` call, not at server boot
- [ ] `TypeScriptVisitor` extracts: `function` declarations (named + arrow), `class` declarations, `interface` declarations, `type` alias declarations, `enum` declarations, exported `const`/`let`/`var` declarations
- [ ] Each extracted symbol includes: name, kind, file path, start line/column, end line/column, doc comment (if present)
- [ ] `LanguageVisitor` abstract interface defined for future language expansion
- [ ] Parser handles parse errors gracefully (logs warning, continues to next file)
- [ ] Parser timeout per file (configurable, default 10s) — kills hung parses
- [ ] Visitor correctly handles:
  - Default exports: `export default class Foo {}`
  - Named exports: `export function bar() {}`
  - Re-exports: `export { Foo } from './foo'`
  - Type-only exports: `export type { Foo }`
  - Generic types: `type Foo<T> = ...`

**Technical Notes:**

- npm packages: `web-tree-sitter`, `@tree-sitter-grammars/tree-sitter-typescript`, `@tree-sitter-grammars/tree-sitter-javascript`
- WASM files loaded from `node_modules/` or bundled into `dist/`
- Module path: `src/mcp/codebase-index/parser/`

---

### CI-03: CodebaseFile Entity & SQLite Table (Effort: 1 day)

**Owner:** backend

**Description:** Create the `CodebaseFile` entity class and corresponding SQLite table via `MigrationManager`. Store file metadata discovered during indexing.

**Acceptance Criteria:**

- [ ] `codebase_files` table created via `MigrationManager` migration (version v3)
- [ ] Table columns: `id` (UUID PK), `repo` (TEXT NOT NULL), `file_path` (TEXT NOT NULL), `language` (TEXT), `checksum` (TEXT — SHA-256 hex), `lines` (INTEGER), `size_bytes` (INTEGER), `last_indexed_at` (TEXT — ISO 8601), `created_at` (TEXT), `updated_at` (TEXT)
- [ ] Unique index on `(repo, file_path)`
- [ ] Index on `(repo, last_indexed_at)` for staleness queries
- [ ] `CodebaseFileEntity` class with methods: `upsertFile`, `getFile`, `getFilesByRepo`, `deleteFile`, `deleteFilesByRepo`
- [ ] Soft delete not required (this is transient index data, can be rebuilt)
- [ ] Includes TypeScript interface `CodebaseFile`

**Technical Notes:**

- Entity path: `src/mcp/entities/codebase-file.ts`
- Follows the same pattern as `MemoryEntity`, `TaskEntity`, etc.

---

### CI-04: CodebaseSymbol Entity & SQLite Table (Effort: 1 day)

**Owner:** backend

**Description:** Create the `CodebaseSymbol` entity class and SQLite table to store parsed symbol declarations with precise location data.

**Acceptance Criteria:**

- [ ] `codebase_symbols` table created via `MigrationManager` migration (version v3, same migration as CI-03)
- [ ] Table columns: `id` (UUID PK), `repo` (TEXT NOT NULL), `file_path` (TEXT NOT NULL), `name` (TEXT NOT NULL), `kind` (TEXT NOT NULL — one of: `function`, `class`, `interface`, `type`, `enum`, `variable`, `method`, `property`), `exported` (INTEGER — boolean), `default_export` (INTEGER — boolean), `start_line` (INTEGER), `start_col` (INTEGER), `end_line` (INTEGER), `end_col` (INTEGER), `signature` (TEXT — compact string representation like `foo(arg: string): void`), `doc_comment` (TEXT), `parent_symbol_id` (TEXT UUID — nullable, for nested symbols), `created_at` (TEXT), `updated_at` (TEXT)
- [ ] Indexes: `(repo, name)`, `(repo, file_path)`, `(repo, kind)`, `(name)` for global search
- [ ] Full-text search (FTS5) virtual table for symbol name and doc_comment search
- [ ] `CodebaseSymbolEntity` class with methods: `upsertSymbol`, `bulkUpsertSymbols` (for batch insert within a transaction), `getSymbolsByFile`, `getSymbolByName`, `searchSymbols`, `deleteSymbolsByFile`, `deleteSymbolsByRepo`
- [ ] Foreign key from `parent_symbol_id` to `codebase_symbols.id` (nullable — only for nested symbols like class methods)

**Technical Notes:**

- Entity path: `src/mcp/entities/codebase-symbol.ts`
- FTS5 table: `codebase_symbols_fts` on `(name, doc_comment)`
- Batch inserts use transactions for performance (wrap within `IndexingService`)

---

### CI-05: CodebaseIndex Orchestration Service (Effort: 3 days)

**Owner:** backend

**Description:** Implement the `CodebaseIndexService` that orchestrates the full indexing pipeline: file discovery → parsing → storage. Manages transactions, error recovery, and progress reporting. Integrates the incremental index optimization (checksum-based skip) for subsequent runs.

**Acceptance Criteria:**

- [ ] `CodebaseIndexService.indexRepository(repoPath)` performs: discover files → compute checksums → compare with stored → parse changed/new files → upsert symbols → delete symbols for removed files
- [ ] Runs entire pipeline within a single SQLite transaction (or batch of transactions for large repos)
- [ ] Reports progress via callback/event emitter: `{ type: 'file_discovered' | 'file_parsed' | 'symbols_stored', current: number, total: number }`
- [ ] On first run, parses all discovered files
- [ ] On subsequent runs, only parses files whose checksum changed or new files
- [ ] Files no longer on disk are deleted from `codebase_files` and their symbols cascade-deleted
- [ ] Handles partial failures — if file X fails to parse, logs error and continues with file Y
- [ ] Returns summary: `{ totalFiles, parsedFiles, skippedFiles, failedFiles, totalSymbols, durationMs }`
- [ ] Timeout-safe — respects per-file parser timeout

**Technical Notes:**

- Service path: `src/mcp/codebase-index/services/indexing-service.ts`
- Checksum comparison is the gate — `sha256(fileContent)` vs `codebase_files.checksum`

---

### CI-06: `index_repository` MCP Tool (Effort: 2 days)

**Owner:** backend

**Description:** Register the `index_repository` MCP tool following the existing tool pattern (definition → schema → handler → registration in `tools/index.ts`).

**Acceptance Criteria:**

- [ ] Tool definition with name `index_repository` and description
- [ ] Input schema (Zod) with fields: `repo` (string, required — owner/repo), `repoPath` (string, required — absolute file system path), `force` (boolean, optional — force full re-index ignoring checksums), `includeGlobs` (string[], optional), `excludeGlobs` (string[], optional)
- [ ] Output schema: `{ success: boolean, summary: { totalFiles, parsedFiles, skippedFiles, failedFiles, totalSymbols, durationMs }, error?: string }`
- [ ] Handler validates `repoPath` exists and is a directory
- [ ] Handler invokes `CodebaseIndexService.indexRepository()`
- [ ] Handler respects write-lock (added to `WRITE_TOOLS` set)
- [ ] Tool registered in `tools/index.ts` following existing pattern
- [ ] Proper error responses for: invalid path, permission denied, parser initialization failure

**Technical Notes:**

- Follows the pattern in `src/mcp/tools/memory.store.ts` (definition → schema → handler)
- Tool definition: `src/mcp/tools/definitions/codebase-index.ts`
- Tool schema: `src/mcp/tools/schemas/codebase-index.ts`
- Tool handler: `src/mcp/tools/codebase-index.ts`
- Registration: add to `tools/index.ts` `buildExecutors()` map and `TOOL_DEFINITIONS` array

---

### CI-07: CLI Trigger for Indexing (Effort: 1 day)

**Owner:** backend

**Description:** Add a `--index` flag to the MCP server CLI that triggers indexing on startup without requiring an MCP client to call the tool.

**Acceptance Criteria:**

- [ ] `mcp-memory-server.js --index --repo owner/repo --path /path/to/repo` triggers indexing on startup
- [ ] Indexing runs before the MCP server starts listening
- [ ] Progress is logged to stdout with timestamps
- [ ] Summary printed on completion: `Indexed <N> symbols across <M> files in <D>ms`
- [ ] Non-zero exit code if indexing fails catastrophically
- [ ] CLI respects `--include` and `--exclude` flags for glob overrides

**Technical Notes:**

- Modify `src/mcp/server.ts` to parse CLI args and run indexing before `main()`

---

### CI-08: Unit Tests for Core Indexing (Effort: 2 days)

**Owner:** backend

**Description:** Comprehensive unit tests for each component of the indexing pipeline.

**Acceptance Criteria:**

- [ ] `FileDiscoveryService` tests:
  - Discovers `.ts` files in a temp directory
  - Respects `.gitignore` patterns
  - Respects custom include/exclude globs
  - Skips `node_modules` by default
  - Handles empty directories
  - Returns sorted results
- [ ] Tree-sitter parser tests:
  - Parses a valid `.ts` file and extracts expected symbols
  - Parses a `.tsx` file with JSX syntax
  - Handles parse errors gracefully (malformed syntax)
  - Extracts `export default` correctly
  - Extracts generics correctly
- [ ] `CodebaseIndexService` tests:
  - Full end-to-end index on a small test fixture
  - Incremental index skips unchanged files (verifies checksum comparison)
  - Incremental index re-parses modified files (touch + re-index)
  - Removed files are cleaned up on re-index
- [ ] `index_repository` tool tests:
  - Validates input schema
  - Returns correct summary format
  - Errors on non-existent path

**Technical Notes:**

- Test directory: `src/mcp/tests/codebase-index/`
- Test fixtures: `src/mcp/tests/fixtures/codebase-index/` with small mock repos
- Use `mkdirp` + `writeFileSync` in `beforeEach` for temp test fixtures

---

## Dependencies

| Item  | Depends On                 | Description                             |
| :---- | :------------------------- | :-------------------------------------- |
| CI-05 | CI-01, CI-02, CI-03, CI-04 | Orchestration needs all primitives      |
| CI-06 | CI-05                      | Tool needs orchestration service        |
| CI-07 | CI-05                      | CLI trigger needs orchestration service |
| CI-08 | CI-01 — CI-05              | Tests need implemented components       |

## Risk Register

| Risk                                                                  | Likelihood | Impact | Mitigation                                                           |
| :-------------------------------------------------------------------- | :--------- | :----- | :------------------------------------------------------------------- |
| tree-sitter WASM fails to load in certain Node.js environments        | Low        | High   | Fallback error message; test on Node 18/20/22; document known issues |
| Large repo (50K+ files) causes OOM during indexing                    | Medium     | Medium | Streaming file discovery; batch processing; configurable max files   |
| Parse errors in third-party code abort the index                      | Low        | Medium | Graceful per-file error handling; parser timeout                     |
| `.gitignore` parsing edge cases (nested gitignore, negation patterns) | Medium     | Low    | Use well-tested `ignore` npm package; test known edge cases          |

**Status: NOT STARTED**

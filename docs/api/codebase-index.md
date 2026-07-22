# Codebase Index API Reference

> **Architecture decision context:** See [ADR-002: Codebase Index Architecture](../../.agents/documents/design/decisions/adr-002-codebase-index.md) for design rationale, including the choice of `web-tree-sitter` WASM bindings, SQLite storage strategy, incremental indexing with SHA-256 checksums, and single-pass parsing for Phase 1.0.

The Codebase Index provides 6 MCP tools for indexing and querying source code structure. All tools conform to the [MCP 2025-11-25 Structured Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) specification.

---

## 1. `index_repository`

### 1.1 Purpose

Scans a repository directory, discovers source files, parses them with tree-sitter, and stores extracted symbols (functions, classes, interfaces, types, enums, variables) in the SQLite database. Supports incremental indexing via SHA-256 checksum comparison — only changed files are re-parsed on subsequent runs.

### 1.2 Input Schema

| Parameter      | Type            | Required | Default | Description                                      |
| :------------- | :-------------- | :------- | :------ | :----------------------------------------------- |
| `repo`         | `string`        | Yes      | —       | Repository identifier (`owner/repo`).            |
| `repoPath`     | `string`        | Yes      | —       | Absolute filesystem path to the repository.      |
| `force`        | `boolean`       | No       | `false` | Force full re-index, ignoring stored checksums.  |
| `includeGlobs` | `array<string>` | No       | —       | Include only files matching these glob patterns. |
| `excludeGlobs` | `array<string>` | No       | —       | Exclude files matching these glob patterns.      |

**Default exclusions (always applied):** `node_modules`, `.git`, `dist`, `.next`, `build`, `coverage`, `__pycache__`, `.venv`, `vendor`, `target`, `.DS_Store`.

### 1.3 Handler Behavior

The indexing pipeline executes in 5 phases:

1. **DISCOVER** — Walks the directory tree with `fast-glob`, respects `.gitignore`, detects language by file extension.
2. **COMPARE** — Checks each discovered file against the database. Files with matching SHA-256 checksums are skipped.
3. **PARSE** — For each changed or new file: reads content, computes checksum, parses with tree-sitter (10s timeout per file).
4. **STORE** — Upserts file records under a write lock: deletes old symbols for re-indexed files, bulk-inserts new symbols.
5. **CLEAN** — Removes database records for files that no longer exist on disk.

**Concurrency guard:** A per-repo in-memory `Set` prevents concurrent indexing of the same repo. A second call while indexing is in progress throws `IndexInProgressError`.

### 1.4 Output Schema

```typescript
{
	success: boolean; // false if failedFiles > 0
	totalFiles: number; // total discovered files
	parsedFiles: number; // files actually parsed (new or changed)
	skippedFiles: number; // files with matching checksums
	failedFiles: number; // files that failed to parse
	totalSymbols: number; // total symbols extracted
	durationMs: number; // total indexing duration
	errors: Array<{
		filePath: string;
		error: string;
	}>;
}
```

### 1.5 Error Codes

| Scenario                 | Code                   | Behavior                                                |
| :----------------------- | :--------------------- | :------------------------------------------------------ |
| Path does not exist      | `PATH_NOT_FOUND`       | `{ success: false, error: "PATH_NOT_FOUND", message }`  |
| Path is not a directory  | `NOT_A_DIRECTORY`      | `{ success: false, error: "NOT_A_DIRECTORY", message }` |
| Index in progress        | `IndexInProgressError` | Thrown as exception; propagates as `isError: true`      |
| Unexpected runtime error | `INDEX_FAILED`         | `{ success: false, error: "INDEX_FAILED", message }`    |

### 1.6 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 100,
	"method": "tools/call",
	"params": {
		"name": "index_repository",
		"arguments": {
			"repo": "my-org/my-project",
			"repoPath": "/home/user/projects/my-app",
			"includeGlobs": ["src/**/*.ts"],
			"excludeGlobs": ["**/*.test.ts"]
		}
	}
}
```

**Expected response:**

```json
{
	"content": [{ "type": "text", "text": "Indexed 2341 symbols across 156 files in 3200ms" }],
	"isError": false,
	"structuredContent": {
		"data": {
			"success": true,
			"totalFiles": 156,
			"parsedFiles": 156,
			"skippedFiles": 0,
			"failedFiles": 0,
			"totalSymbols": 2341,
			"durationMs": 3200,
			"errors": []
		},
		"repo": "my-org/my-project"
	}
}
```

---

## 2. `index_status`

### 2.1 Purpose

Returns the current indexing status for a repository: whether it has been indexed, when it was last indexed, file/symbol counts, and whether indexing is currently in progress.

### 2.2 Input Schema

| Parameter | Type     | Required | Description                           |
| :-------- | :------- | :------- | :------------------------------------ |
| `repo`    | `string` | Yes      | Repository identifier (`owner/repo`). |

### 2.3 Output Schema

```typescript
{
	repo: string;
	isIndexed: boolean; // true if at least one file has been indexed
	isIndexing: boolean; // true if an index_repository call is in progress for this repo
	lastIndexedAt: string | null; // ISO 8601 timestamp of most recent file index
	totalFiles: number;
	totalSymbols: number;
	progress: null; // reserved for future use (Phase 1.1)
}
```

### 2.4 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 101,
	"method": "tools/call",
	"params": {
		"name": "index_status",
		"arguments": {
			"repo": "my-org/my-project"
		}
	}
}
```

**Expected response:**

```json
{
	"content": [{ "type": "text", "text": "Status for my-org/my-project: 156 files, 2341 symbols" }],
	"isError": false,
	"structuredContent": {
		"data": {
			"repo": "my-org/my-project",
			"isIndexed": true,
			"isIndexing": false,
			"lastIndexedAt": "2026-07-22T10:01:23.000Z",
			"totalFiles": 156,
			"totalSymbols": 2341,
			"progress": null
		},
		"repo": "my-org/my-project"
	}
}
```

---

## 3. `search_symbols`

### 3.1 Purpose

Searches indexed symbols by name using a multi-strategy ranking approach: exact match, camel-case match, prefix match, substring match, then FTS5 full-text fallback. Results are ranked by match quality and support pagination.

### 3.2 Input Schema

| Parameter      | Type      | Required | Default | Description                                                 |
| :------------- | :-------- | :------- | :------ | :---------------------------------------------------------- |
| `query`        | `string`  | No       | `""`    | Search query (minimum 2 characters for meaningful results). |
| `repo`         | `string`  | No       | —       | Repository identifier to scope the search.                  |
| `kind`         | `string`  | No       | —       | Filter by symbol kind. Valid values: see below.             |
| `filePath`     | `string`  | No       | —       | Filter to symbols in a specific file (relative path).       |
| `exportedOnly` | `boolean` | No       | —       | When `true`, only return exported symbols.                  |
| `limit`        | `number`  | No       | `50`    | Maximum results to return (1–200).                          |
| `offset`       | `number`  | No       | `0`     | Pagination offset.                                          |

**Valid `kind` values:** Any symbol kind stored in the index — typically `function`, `method`, `class`, `interface`, `type`, `enum`, `variable`.

### 3.3 Search Strategy (Ranking Tiers)

| Tier | Strategy         | Description                                                              |
| :--- | :--------------- | :----------------------------------------------------------------------- |
| 1    | Exact match      | Symbol name equals the query exactly (case-insensitive).                 |
| 2    | Camel-case match | Query matches camel-case boundaries (e.g., `formatOrd` → `formatOrder`). |
| 3    | Prefix match     | Symbol name starts with the query.                                       |
| 4    | Substring match  | Query appears anywhere in the symbol name.                               |
| 5    | FTS5 fallback    | Full-text search on name and `doc_comment` fields.                       |

Within each tier, results are scored 0.0–1.0 and sorted descending. Results retain `rankTier` and `score` fields for transparency.

### 3.4 Output Schema

```typescript
{
	symbols: Array<{
		// All CodebaseSymbol fields:
		id: string;
		repo: string;
		file_path: string;
		name: string;
		kind: string;
		exported: boolean;
		default_export: boolean;
		start_line: number | null;
		start_col: number | null;
		end_line: number | null;
		end_col: number | null;
		signature: string | null;
		doc_comment: string | null;
		parent_symbol_id: string | null;
		created_at: string;
		updated_at: string;
		// Ranking enrichment:
		rankTier: number; // 1–5 (Exact → FTS5)
		score: number; // 0.0–1.0 normalized within tier
	}>;
	total: number; // pre-pagination total matching symbols
	hasMore: boolean; // true if more results are available
	offset: number;
	limit: number;
}
```

### 3.5 Error / Empty Results

| Scenario                      | Behavior                                                            |
| :---------------------------- | :------------------------------------------------------------------ |
| `query` is empty or < 2 chars | Returns `{ symbols: [], total: 0, hasMore: false }` (not an error). |
| No matching symbols           | Returns `{ symbols: [], total: 0, hasMore: false }`.                |
| No index exists               | Same as no matching symbols (DB returns empty).                     |

### 3.6 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 300,
	"method": "tools/call",
	"params": {
		"name": "search_symbols",
		"arguments": {
			"query": "formatOrder",
			"kind": "function",
			"repo": "my-org/my-project",
			"limit": 10
		}
	}
}
```

**Expected response:**

```json
{
	"content": [{ "type": "text", "text": "Found 3 matching symbols for \"formatOrder\" (returning 3)" }],
	"isError": false,
	"structuredContent": {
		"data": {
			"symbols": [
				{
					"id": "uuid-symbol-1",
					"repo": "my-org/my-project",
					"file_path": "src/services/order.ts",
					"name": "formatOrder",
					"kind": "function",
					"exported": true,
					"default_export": false,
					"start_line": 42,
					"start_col": 0,
					"end_line": 60,
					"end_col": 1,
					"signature": "formatOrder(order: Order): string",
					"doc_comment": "Formats an order into a human-readable string representation.",
					"parent_symbol_id": null,
					"created_at": "2026-07-22T10:01:23.000Z",
					"updated_at": "2026-07-22T10:01:23.000Z",
					"rankTier": 1,
					"score": 1.0
				}
			],
			"total": 3,
			"hasMore": false,
			"offset": 0,
			"limit": 10
		},
		"repo": "my-org/my-project"
	}
}
```

---

## 4. `get_file_symbols`

### 4.1 Purpose

Returns all indexed symbols declared in a specific file. Symbols are returned in declaration order with their locations, signatures, and doc comments.

### 4.2 Input Schema

| Parameter  | Type     | Required | Description                              |
| :--------- | :------- | :------- | :--------------------------------------- |
| `repo`     | `string` | Yes      | Repository identifier (`owner/repo`).    |
| `filePath` | `string` | Yes      | Relative file path from repository root. |

### 4.3 Output Schema

```typescript
{
  file: {
    path: string;              // file_path
    language: string | null;   // detected language
    checksum: string | null;   // SHA-256 checksum
    lines: number;             // total line count
    sizeBytes: number;         // file size in bytes
    lastIndexedAt: string | null; // ISO timestamp of last index
  };
  symbols: CodebaseSymbol[];    // all symbols in the file
  total: number;                // number of symbols
}
```

Each `CodebaseSymbol` includes: `id`, `repo`, `file_path`, `name`, `kind`, `exported`, `default_export`, `start_line`, `start_col`, `end_line`, `end_col`, `signature`, `doc_comment`, `parent_symbol_id`, `created_at`, `updated_at`.

### 4.4 Error Codes

| Scenario            | Code               | Behavior                                                                |
| :------------------ | :----------------- | :---------------------------------------------------------------------- |
| `filePath` is empty | Schema validation  | Zod validation error; returned as `isError: true`.                      |
| File not in index   | `FILE_NOT_INDEXED` | `{ error: "File not indexed. Run index_repository first.", code: ... }` |
| No index exists     | `FILE_NOT_INDEXED` | Same as file not found (no files exist in DB).                          |

### 4.5 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 301,
	"method": "tools/call",
	"params": {
		"name": "get_file_symbols",
		"arguments": {
			"repo": "my-org/my-project",
			"filePath": "src/services/order.ts"
		}
	}
}
```

**Expected response:**

```json
{
	"content": [{ "type": "text", "text": "Found 3 symbols in src/services/order.ts" }],
	"isError": false,
	"structuredContent": {
		"data": {
			"file": {
				"path": "src/services/order.ts",
				"language": "typescript",
				"checksum": "abc123def456",
				"lines": 85,
				"sizeBytes": 2048,
				"lastIndexedAt": "2026-07-22T10:01:23.000Z"
			},
			"symbols": [
				{
					"id": "uuid-symbol-1",
					"repo": "my-org/my-project",
					"file_path": "src/services/order.ts",
					"name": "OrderService",
					"kind": "class",
					"exported": true,
					"default_export": false,
					"start_line": 10,
					"start_col": 0,
					"end_line": 82,
					"end_col": 1,
					"signature": null,
					"doc_comment": "Manages order lifecycle operations.",
					"parent_symbol_id": null,
					"created_at": "2026-07-22T10:01:23.000Z",
					"updated_at": "2026-07-22T10:01:23.000Z"
				}
			],
			"total": 3
		},
		"repo": "my-org/my-project"
	}
}
```

---

## 5. `get_architecture`

### 5.1 Purpose

Returns a high-level structural overview of the indexed codebase: directory tree, language breakdown, file counts, top-level exports, and optional per-file symbol counts. All data is aggregated from the existing index — no parsing is performed.

### 5.2 Input Schema

| Parameter             | Type      | Required | Default | Description                                                |
| :-------------------- | :-------- | :------- | :------ | :--------------------------------------------------------- |
| `repo`                | `string`  | Yes      | —       | Repository identifier (`owner/repo`).                      |
| `depth`               | `number`  | No       | `2`     | Directory tree depth limit (1–5).                          |
| `includeSymbolCounts` | `boolean` | No       | `true`  | When `true`, includes per-file symbol kind counts in tree. |

### 5.3 Output Schema

```typescript
{
	root: DirectoryNode; // nested directory tree
	summary: ArchitectureSummary;
}
```

**DirectoryNode structure:**

```typescript
{
  path: string;
  name: string;
  type: "file" | "directory";
  children?: DirectoryNode[];             // only present for directories
  symbolCounts?: Record<string, number>;  // e.g. { function: 5, class: 2 }
  hasMoreFiles?: boolean;                 // true if children truncated at depth limit
}
```

**ArchitectureSummary structure:**

```typescript
{
  totalFiles: number;
  totalSymbols: number;
  languageBreakdown: Record<string, number>;  // e.g. { typescript: 42, javascript: 5 }
  topLevelExports: CodebaseSymbol[];           // exported symbols with no parent (up to 50)
}
```

Subdirectories beyond the configured `depth` are collapsed into summary nodes with a `hasMoreFiles: true` flag.

### 5.4 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 302,
	"method": "tools/call",
	"params": {
		"name": "get_architecture",
		"arguments": {
			"repo": "my-org/my-project",
			"depth": 3,
			"includeSymbolCounts": true
		}
	}
}
```

**Expected response:**

```json
{
	"content": [{ "type": "text", "text": "Architecture: 156 files, 2341 symbols across 2 languages" }],
	"isError": false,
	"structuredContent": {
		"data": {
			"root": {
				"path": ".",
				"name": ".",
				"type": "directory",
				"children": [
					{
						"path": "src",
						"name": "src",
						"type": "directory",
						"children": [
							{
								"path": "src/services",
								"name": "services",
								"type": "directory",
								"children": [
									{
										"path": "src/services/order.ts",
										"name": "order.ts",
										"type": "file",
										"symbolCounts": { "class": 1, "method": 2 }
									}
								]
							}
						]
					}
				]
			},
			"summary": {
				"totalFiles": 156,
				"totalSymbols": 2341,
				"languageBreakdown": { "typescript": 140, "javascript": 16 },
				"topLevelExports": [{ "name": "App", "kind": "class", "file_path": "src/app.ts", "start_line": 10 }]
			}
		},
		"repo": "my-org/my-project"
	}
}
```

---

## 6. `trace_symbol`

### 6.1 Purpose

Traces a symbol's definition and usage across the codebase. Returns the definition location, export status, and optionally references from other symbols' documentation and signatures.

**Phase 1.0 limitation:** Tracing is name-based exact matching only. Cross-file relation resolution (call graphs, import tracing, multi-level traversal) is planned for Phase 1.1. See [ADR-002 §Decision 4](../../.agents/documents/design/decisions/adr-002-codebase-index.md).

### 6.2 Input Schema

| Parameter           | Type      | Required | Default | Description                                                   |
| :------------------ | :-------- | :------- | :------ | :------------------------------------------------------------ |
| `name`              | `string`  | Yes      | —       | Symbol name to trace (exact match).                           |
| `repo`              | `string`  | No       | —       | Repository identifier to scope the search.                    |
| `includeReferences` | `boolean` | No       | `true`  | When `true`, searches other symbols' doc_comments/signatures. |

### 6.3 Handler Behavior

1. Fetches all symbols for the repo (or all symbols if no repo specified).
2. Filters to exact name matches (`s.name === name`).
3. If 0 matches: throws `SymbolNotFoundError`.
4. If >1 match: throws `AmbiguousSymbolError` with disambiguation candidates.
5. If 1 match: returns definition location and export chain.
6. If `includeReferences` is true: searches other symbols' `doc_comment` and `signature` fields for the name string (text inclusion, excluding self).

### 6.4 Output Schema

```typescript
{
	symbol: CodebaseSymbol; // the matched symbol (full record)
	definition: {
		file: string; // file_path
		line: number; // start_line (0 if null)
		column: number; // start_col (0 if null)
	}
	references: Array<{
		filePath: string;
		startLine: number;
		startCol: number;
		context: string; // matching line from doc_comment or full signature
	}>;
	exportChain: {
		exported: boolean;
		defaultExport: boolean;
	}
}
```

### 6.5 Error Codes

| Scenario         | Code               | Behavior                                                                             |
| :--------------- | :----------------- | :----------------------------------------------------------------------------------- |
| `name` is empty  | Schema validation  | Zod validation error; returned as `isError: true`.                                   |
| Symbol not found | `SYMBOL_NOT_FOUND` | `{ error: "Symbol "X" not found...", code: "SYMBOL_NOT_FOUND" }`                     |
| Multiple matches | `AMBIGUOUS_SYMBOL` | `{ error: "Ambiguous symbol "X"...", code: "AMBIGUOUS_SYMBOL", disambiguation: [] }` |
| Unexpected error | `TRACE_FAILED`     | `{ error: "<message>", code: "TRACE_FAILED" }`                                       |

The `disambiguation` array includes: `name`, `kind`, `file`, `line`, `exported` for each candidate.

### 6.6 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 303,
	"method": "tools/call",
	"params": {
		"name": "trace_symbol",
		"arguments": {
			"name": "formatOrder",
			"repo": "my-org/my-project",
			"includeReferences": true
		}
	}
}
```

**Expected response (success):**

```json
{
	"content": [
		{ "type": "text", "text": "Symbol \"formatOrder\": defined in src/services/order.ts:42, 2 references found" }
	],
	"isError": false,
	"structuredContent": {
		"data": {
			"symbol": {
				"id": "uuid-symbol-1",
				"repo": "my-org/my-project",
				"file_path": "src/services/order.ts",
				"name": "formatOrder",
				"kind": "function",
				"exported": true,
				"default_export": false,
				"start_line": 42,
				"start_col": 0,
				"end_line": 60,
				"end_col": 1,
				"signature": "formatOrder(order: Order): string",
				"doc_comment": "Formats an order into a human-readable string representation.",
				"parent_symbol_id": null,
				"created_at": "2026-07-22T10:01:23.000Z",
				"updated_at": "2026-07-22T10:01:23.000Z"
			},
			"definition": {
				"file": "src/services/order.ts",
				"line": 42,
				"column": 0
			},
			"references": [
				{
					"filePath": "src/controllers/order.ts",
					"startLine": 30,
					"startCol": 0,
					"context": "Formats order data using the shared formatOrder utility."
				}
			],
			"exportChain": {
				"exported": true,
				"defaultExport": false
			}
		},
		"repo": "my-org/my-project"
	}
}
```

**Expected response (ambiguous):**

```json
{
	"content": [
		{ "type": "text", "text": "Ambiguous symbol \"formatOrder\" — 2 matches found in repo \"my-org/my-project\"" }
	],
	"isError": false,
	"structuredContent": {
		"data": {
			"error": "Ambiguous symbol \"formatOrder\" — 2 matches found in repo \"my-org/my-project\"",
			"code": "AMBIGUOUS_SYMBOL",
			"disambiguation": [
				{ "name": "formatOrder", "kind": "function", "file": "src/services/order.ts", "line": 42, "exported": true },
				{ "name": "formatOrder", "kind": "variable", "file": "src/utils/format.ts", "line": 5, "exported": false }
			]
		},
		"repo": "my-org/my-project"
	}
}
```

---

## Known Limitations (Phase 1.0)

| Limitation                          | Detail                                                                                                                                       | Planned For |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :---------- |
| **Name-based reference resolution** | Symbol tracing and relation detection are name-matched only. No type-graph or semantic resolution.                                           | Phase 1.1   |
| **Single language parsing**         | Only TypeScript, JavaScript, TSX, and JSX are supported. Other languages require grammar WASM loading and visitor implementation.            | Phase 2.0   |
| **No relation storage**             | The `codebase_relations` table is defined in ADR-002 but not yet created. Call graphs, import graphs, and inheritance chains are not stored. | Phase 1.1   |
| **Explicit indexing required**      | No auto-index on start or file watching. Agents must call `index_repository` explicitly.                                                     | Phase 1.1   |
| **No progress reporting**           | `index_status.progress` returns `null`. During long indexing operations, no granular progress is available.                                  | Phase 1.2   |
| **Database growth**                 | Indexing large projects may add up to ~150MB to `memory.db`. WAL mode prevents write contention.                                             | N/A         |

---

## Performance Characteristics

| Tool               | Query Complexity                | Index Strategy                                                |
| :----------------- | :------------------------------ | :------------------------------------------------------------ |
| `index_repository` | O(n) per file; O(1) per skipped | Checksum comparison; tree-sitter WASM per file (10s timeout). |
| `index_status`     | 3 COUNT queries                 | `idx_codebase_files_repo_path`, `idx_cs_repo_name`.           |
| `search_symbols`   | FTS5 + LIKE + in-memory ranking | FTS5 virtual table; indexes on `name`, `kind`, `file_path`.   |
| `get_file_symbols` | 2 SELECT queries                | `idx_codebase_files_repo_path`, `idx_cs_repo_file`.           |
| `get_architecture` | 2-3 queries + tree construction | All symbols counted via `GROUP BY`.                           |
| `trace_symbol`     | 1-2 full scans (in-memory)      | No DB-level index needed; operates on fetched symbol array.   |

All read operations run without blocking writes (WAL mode). For projects up to 20,000 files, typical query times are <100ms for read tools.

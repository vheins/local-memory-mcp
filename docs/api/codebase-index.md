# Codebase Index API Reference

> **Architecture decision context:** See [ADR-002: Codebase Index Architecture](../../.agents/documents/design/decisions/adr-002-codebase-index.md) for design rationale, including the choice of `web-tree-sitter` WASM bindings, SQLite storage strategy, incremental indexing with SHA-256 checksums, and single-pass parsing for Phase 1.0.
>
> **REFACTOR-CI-003:** Six individual tools were consolidated into two unified tools per ADR-005 ("Zero oneOf — auto-infer"). The old tool names (`index_repository`, `index_status`, `search_symbols`, `get_file_symbols`, `get_architecture`, `trace_symbol`, `codebase_search`) still route to the unified handlers for backward compatibility.

The Codebase Index provides **2 MCP tools** for indexing and querying source code structure. All tools conform to the [MCP 2025-11-25 Structured Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) specification.

---

## 1. `codebase-index`

**Handler:** `handleCodebaseIndex` in `src/mcp/tools/codebase.index.ts` → delegates to `handleCodebaseIndexRepository` / `handleCodebaseIndexStatus` in `src/mcp/tools/codebase-index.ts`

### 1.1 Purpose

Unified write + status tool. Mode auto-inferred from parameters per ADR-005:

- **`repoPath` + `repo` → INDEX** — scans the repository directory, discovers source files, parses with tree-sitter, and stores extracted symbols in the SQLite database. Supports incremental indexing via SHA-256 checksum comparison.
- **`repo` only → STATUS** — returns the current indexing status for a repository (is it indexed? when? how many files/symbols? stale?).

### 1.2 Input Schema

| Parameter      | Type            | Required | Default | Mode  | Description                                      |
| :------------- | :-------------- | :------- | :------ | :---- | :----------------------------------------------- |
| `repo`         | `string`        | Yes      | —       | both  | Repository identifier (`owner/repo`).            |
| `repoPath`     | `string`        | No       | —       | INDEX | Absolute filesystem path to the repository.      |
| `force`        | `boolean`       | No       | `false` | INDEX | Force full re-index, ignoring stored checksums.  |
| `includeGlobs` | `array<string>` | No       | —       | INDEX | Include only files matching these glob patterns. |
| `excludeGlobs` | `array<string>` | No       | —       | INDEX | Exclude files matching these glob patterns.      |

**Default exclusions (always applied):** `node_modules`, `.git`, `dist`, `.next`, `build`, `coverage`, `__pycache__`, `.venv`, `vendor`, `target`, `.DS_Store`.

### 1.3 INDEX Output

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
	skippedByChecksum: number;
	skippedByExtension: number;
	skippedByGitignore: number;
	renamedFiles: number;
	errorSummary: ErrorSummary;
}
```

### 1.4 STATUS Output

```typescript
{
	repo: string;
	isIndexed: boolean; // true if at least one file has been indexed
	isIndexing: boolean; // true if an index call is in progress for this repo
	lastIndexedAt: string | null; // ISO 8601 timestamp of most recent file index
	totalFiles: number;
	totalSymbols: number;
	progress: IndexProgress | null;
	stale?: boolean;
	staleRatio?: number;
}
```

### 1.5 INDEX Error Codes

| Scenario                 | Code                   | Behavior                                                |
| :----------------------- | :--------------------- | :------------------------------------------------------ |
| Path does not exist      | `PATH_NOT_FOUND`       | `{ success: false, error: "PATH_NOT_FOUND", message }`  |
| Path is not a directory  | `NOT_A_DIRECTORY`      | `{ success: false, error: "NOT_A_DIRECTORY", message }` |
| Index in progress        | `IndexInProgressError` | Thrown as exception; propagates as `isError: true`      |
| Unexpected runtime error | `INDEX_FAILED`         | `{ success: false, error: "INDEX_FAILED", message }`    |

### 1.6 Runnable Examples

**INDEX:**

```json
{
	"jsonrpc": "2.0",
	"id": 100,
	"method": "tools/call",
	"params": {
		"name": "codebase-index",
		"arguments": {
			"repo": "my-org/my-project",
			"repoPath": "/home/user/projects/my-app",
			"force": false,
			"includeGlobs": ["src/**/*.ts"],
			"excludeGlobs": ["**/*.test.ts"]
		}
	}
}
```

**STATUS:**

```json
{
	"jsonrpc": "2.0",
	"id": 101,
	"method": "tools/call",
	"params": {
		"name": "codebase-index",
		"arguments": {
			"repo": "my-org/my-project"
		}
	}
}
```

---

## 2. `codebase-read`

**Handler:** `handleCodebaseRead` in `src/mcp/tools/codebase.read.ts` (L430-L453)

### 2.1 Purpose

Unified read-only access to the codebase index. Mode auto-inferred from parameters per ADR-005:

- **`name` → TRACE** (was `trace_symbol`) — traces a symbol's definition and references across the codebase
- **`filePath` → FILE** (was `get_file_symbols`) — returns all indexed symbols declared in a specific file
- **`query` → SEARCH** (was `search_symbols` + `codebase_search`) — searches indexed symbols by name with multi-strategy ranking + vector blending
- **(nothing) → ARCHITECTURE** (was `get_architecture`) — directory tree overview, language breakdown, top-level exports

### 2.2 Input Schema

| Parameter             | Type                 | Required | Default | Mode         | Description                                                |
| :-------------------- | :------------------- | :------- | :------ | :----------- | :--------------------------------------------------------- |
| `repo`                | `string`             | Yes      | —       | all          | Repository identifier (`owner/repo`).                      |
| `name`                | `string`             | No       | —       | TRACE        | Symbol name to trace (exact match with fallback variants). |
| `filePath`            | `string`             | No       | —       | FILE         | Relative file path from repository root.                   |
| `query`               | `string`             | No       | —       | SEARCH       | Search query (minimum 2 characters).                       |
| `depth`               | `number`             | No       | `2`     | ARCHITECTURE | Directory tree depth limit (1–5).                          |
| `includeSymbolCounts` | `boolean`            | No       | `true`  | ARCHITECTURE | Include per-file symbol kind counts in tree.               |
| `includeReferences`   | `boolean`            | No       | `true`  | TRACE        | Search other symbols' doc_comments/signatures for name.    |
| `kind`                | `string \| string[]` | No       | —       | SEARCH       | Filter by symbol kind.                                     |
| `filePath`            | `string`             | No       | —       | SEARCH       | Filter to symbols in a specific file.                      |
| `exportedOnly`        | `boolean`            | No       | —       | SEARCH       | When `true`, only return exported symbols.                 |
| `limit`               | `number`             | No       | `50`    | SEARCH       | Maximum results to return (1–200).                         |
| `offset`              | `number`             | No       | `0`     | SEARCH       | Pagination offset.                                         |

### 2.3 SEARCH Strategy (Ranking Tiers)

| Tier | Strategy         | Description                                                              |
| :--- | :--------------- | :----------------------------------------------------------------------- |
| 1    | Exact match      | Symbol name equals the query exactly (case-insensitive).                 |
| 2    | Camel-case match | Query matches camel-case boundaries (e.g., `formatOrd` → `formatOrder`). |
| 3    | Prefix match     | Symbol name starts with the query.                                       |
| 4    | Substring match  | Query appears anywhere in the symbol name.                               |
| 5    | FTS5 fallback    | Full-text search on name and `doc_comment` fields.                       |

Results are further refined by **vector similarity blending** within each tier (cosine similarity × 0.30 + tier score × 0.70).

### 2.4 Output Schemas

**TRACE:**

```typescript
{
	mode: "trace";
	symbol: CodebaseSymbol;
	definition: { file: string; line: number; column: number; endLine: number; };
	references: Array<{ filePath: string; startLine: number; startCol: number; context: string; }>;
	exportChain: { exported: boolean; defaultExport: boolean; };
	originalName?: string; // present when trace fell back to a variant name
}
```

**FILE:**

```typescript
{
	mode: "file";
	file: { path: string; language: string | null; checksum: string | null; lines: number; sizeBytes: number; lastIndexedAt: string | null; };
	symbols: CodebaseSymbol[];
	total: number;
}
```

**ARCHITECTURE:**

```typescript
{
	mode: "architecture";
	root: DirectoryNode;
	summary: { totalFiles: number; totalSymbols: number; languageBreakdown: Record<string, number>; topLevelExports: CodebaseSymbol[]; };
}
```

**SEARCH:**

```typescript
{
	mode: "search";
	symbols: Array<CodebaseSymbol & { rankTier: number; score: number }>;
	total: number;
	hasMore: boolean;
	offset: number;
	limit: number;
	query: string;
}
```

### 2.5 Error Codes

| Scenario         | Code               | Behavior                                                                            |
| :--------------- | :----------------- | :---------------------------------------------------------------------------------- |
| Symbol not found | `SYMBOL_NOT_FOUND` | `{ error: "Symbol \"X\" not found", code: "SYMBOL_NOT_FOUND" }`                     |
| Multiple matches | `AMBIGUOUS_SYMBOL` | `{ error: "Ambiguous symbol \"X\"", code: "AMBIGUOUS_SYMBOL", disambiguation: [] }` |
| File not indexed | `FILE_NOT_INDEXED` | `{ error: "File not indexed...", code: "FILE_NOT_INDEXED" }`                        |

### 2.6 Runnable Examples

**ARCHITECTURE:**

```json
{
	"jsonrpc": "2.0",
	"id": 302,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": {
			"repo": "my-org/my-project",
			"depth": 3,
			"includeSymbolCounts": true
		}
	}
}
```

**FILE:**

```json
{
	"jsonrpc": "2.0",
	"id": 301,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": {
			"repo": "my-org/my-project",
			"filePath": "src/services/order.ts"
		}
	}
}
```

**SEARCH:**

```json
{
	"jsonrpc": "2.0",
	"id": 300,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": {
			"query": "formatOrder",
			"kind": "function",
			"repo": "my-org/my-project",
			"limit": 10
		}
	}
}
```

**TRACE:**

```json
{
	"jsonrpc": "2.0",
	"id": 303,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": {
			"name": "formatOrder",
			"repo": "my-org/my-project",
			"includeReferences": true
		}
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
| **Explicit indexing required**      | No auto-index on start or file watching. Agents must call `codebase-index` explicitly.                                                       | Phase 1.1   |
| **No progress reporting**           | `index_status.progress` returns `null`. During long indexing operations, no granular progress is available.                                  | Phase 1.2   |
| **Database growth**                 | Indexing large projects may add up to ~150MB to `memory.db`. WAL mode prevents write contention.                                             | N/A         |

---

## Performance Characteristics

| Tool             | Operation    | Query Complexity                | Index Strategy                                                |
| :--------------- | :----------- | :------------------------------ | :------------------------------------------------------------ |
| `codebase-index` | INDEX        | O(n) per file; O(1) per skipped | Checksum comparison; tree-sitter WASM per file (10s timeout). |
| `codebase-index` | STATUS       | 3 COUNT queries                 | `idx_codebase_files_repo_path`, `idx_cs_repo_name`.           |
| `codebase-read`  | ARCHITECTURE | 2-3 queries + tree construction | All symbols counted via `GROUP BY`.                           |
| `codebase-read`  | FILE         | 2 SELECT queries                | `idx_codebase_files_repo_path`, `idx_cs_repo_file`.           |
| `codebase-read`  | SEARCH       | FTS5 + LIKE + in-memory ranking | FTS5 virtual table; indexes on `name`, `kind`, `file_path`.   |
| `codebase-read`  | TRACE        | 1-2 full scans (in-memory)      | No DB-level index needed; operates on fetched symbol array.   |

All read operations run without blocking writes (WAL mode). For projects up to 20,000 files, typical query times are <100ms for read operations.

# Codebase Index — API Contracts

This document specifies the MCP tool signatures, input/output schemas, and resource URIs for the Codebase Index feature. All tools follow the existing MCP server patterns: Zod schemas for validation, `McpResponse` return types, and session-scoped owner/repo injection.

## 1. MCP Tools

### 1.1 `index_repository`

Triggers indexing of a project's source code. If called on an already-indexed project, performs an incremental update.

**Input Schema:**

```typescript
{
  projectPath?: string;  // Absolute path to project root. Defaults to first MCP root.
}
```

**Output Schema:**

```typescript
{
	status: "completed" | "in_progress" | "no_files" | "error";
	filesDiscovered: number; // Total files found
	filesIndexed: number; // Successfully parsed files
	filesFailed: number; // Files with parse errors
	filesSkipped: number; // Intentionally skipped files
	filesDeleted: number; // Deleted files detected (incremental only)
	symbolsExtracted: number; // Total symbols stored
	relationsResolved: number; // Total relations stored (Phase 1.1)
	duration: number; // Indexing time in milliseconds
	errors: Array<{
		filePath: string;
		message: string;
	}>;
}
```

**Zod Schema (src/codebase-index/schemas.ts):**

```typescript
import { z } from "zod";

export const IndexRepositoryInput = z.object({
	projectPath: z.string().optional()
});

export const IndexRepositoryOutput = z.object({
	status: z.enum(["completed", "in_progress", "no_files", "error"]),
	filesDiscovered: z.number(),
	filesIndexed: z.number(),
	filesFailed: z.number(),
	filesSkipped: z.number(),
	filesDeleted: z.number().optional(),
	symbolsExtracted: z.number(),
	relationsResolved: z.number().optional(),
	duration: z.number(),
	errors: z.array(
		z.object({
			filePath: z.string(),
			message: z.string()
		})
	)
});
```

**Error Cases:**

| Scenario                   | HTTP Analogue | Behavior                                     |
| :------------------------- | :------------ | :------------------------------------------- |
| Already indexing           | 409           | Return current progress stats                |
| tree-sitter init failed    | 500           | Return error with message                    |
| Project path not in roots  | 403           | Return error with message                    |
| Project path doesn't exist | 404           | Return error with message                    |
| Cancelled (abort signal)   | 499           | Return partial results with cancelled status |

**Registration:**

- Tool name: `index_repository`
- Category: Write (under `store.withWrite()`)
- Added to `WRITE_TOOLS` set
- Emits `notifications/progress` via `extra.onProgress(processed, total)`
- Logged to `action_log` as action type `index`

---

### 1.2 `get_file_symbols`

Returns all symbols declared in a specific file, optionally with their relations.

**Input Schema:**

```typescript
{
  filePath: string;            // Relative file path from project root (required)
  includeRelations?: boolean;  // Default: false. If true, include symbol relations.
}
```

**Output Schema:**

```typescript
{
  file: {
    filePath: string;
    language: string;
    status: string;
    size: number;
    lineCount: number;
    lastIndexedAt: string | null;
  };
  symbols: Array<{
    id: string;
    name: string;
    kind: "function" | "method" | "class" | "interface" | "type" | "enum" | "variable";
    qualifiedName: string | null;
    signature: string | null;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
    docComment: string | null;
    isExported: boolean;
    metadata: Record<string, unknown> | null;
  }>;
  relations?: Array<{              // Only if includeRelations = true
    id: string;
    sourceSymbolId: string;
    targetSymbolId: string;
    relationType: "calls" | "imports" | "extends" | "implements" | "member_of" | "throws" | "returns" | "parameter";
    sourceLine: number | null;
    metadata: Record<string, unknown> | null;
  }>;
}
```

**Error Cases:**

| Scenario            | Behavior                                                    |
| :------------------ | :---------------------------------------------------------- |
| File not indexed    | Return `{ file: null, symbols: [] }`                        |
| File path not found | Return error with message                                   |
| No index exists     | Return error: "No index found. Run index_repository first." |

---

### 1.3 `search_symbols`

Searches indexed symbols by name with optional filters.

**Input Schema:**

```typescript
{
  query: string;               // Search query (exact, prefix, or substring)
  kind?: string;               // Filter by symbol kind (e.g., "function", "class")
  filePath?: string;           // Filter to specific file
  isExported?: boolean;        // Filter to exported symbols only
  limit?: number;              // Max results (default: 50, max: 500)
  offset?: number;             // Pagination offset (default: 0)
}
```

**Output Schema:**

```typescript
{
	symbols: Array<{
		id: string;
		name: string;
		kind: string;
		qualifiedName: string | null;
		signature: string | null;
		filePath: string;
		startLine: number;
		endLine: number;
		docComment: string | null;
		isExported: boolean;
	}>;
	total: number; // Total matching results (for pagination)
	limit: number;
	offset: number;
}
```

**Search Behavior:**

| Query Type   | SQL Pattern                     | Example                         |
| :----------- | :------------------------------ | :------------------------------ |
| Exact match  | `WHERE name = ? COLLATE NOCASE` | `search_symbols("formatOrder")` |
| Prefix match | `WHERE name LIKE 'query%'`      | `search_symbols("format")`      |
| Substring    | `WHERE name LIKE '%query%'`     | `search_symbols("Order")`       |

Search is case-insensitive (`COLLATE NOCASE`) for all query types. The search strategy is determined by query characteristics — exact matches are attempted first, then prefix, then substring as fallback. All three strategies are unioned, deduplicated, and returned ordered by match quality (exact > prefix > substring).

**Error Cases:**

| Scenario                   | Behavior                        |
| :------------------------- | :------------------------------ |
| Empty query                | Return validation error         |
| No index exists            | Return error: "No index found." |
| Query too short (<2 chars) | Return validation error         |

---

### 1.4 `get_architecture`

Returns a high-level structural overview of the indexed codebase.

**Input Schema:**

```typescript
{
  projectPath?: string;  // Defaults to first MCP root
}
```

**Output Schema:**

```typescript
{
  languages: Array<{
    language: string;
    fileCount: number;
    symbolCount: number;
  }>;
  totalFiles: number;
  totalSymbols: number;
  totalRelations: number;                  // Phase 1.1
  symbolCounts: Record<string, number>;    // kind → count
  relationCounts?: Record<string, number>; // relationType → count (Phase 1.1)
  entryPoints: Array<{
    name: string;
    kind: string;
    filePath: string;
    line: number;
  }>;
  topFiles: Array<{                       // Top files by symbol count
    filePath: string;
    symbolCount: number;
  }>;
  hotspots: Array<{                       // Phase 1.1
    name: string;
    kind: string;
    filePath: string;
    referenceCount: number;               // Inbound + outbound references
  }>;
}
```

**Error Cases:**

| Scenario        | Behavior                                                       |
| :-------------- | :------------------------------------------------------------- |
| No index exists | Return `{ totalFiles: 0, totalSymbols: 0, ... }`— not an error |

---

### 1.5 `trace_symbol`

Traces inbound and/or outbound relationships from a symbol.

**Input Schema:**

```typescript
{
  symbolName: string;                                    // Name of the symbol to trace
  direction?: "inbound" | "outbound" | "both";          // Default: "both"
  maxDepth?: number;                                     // Default: 3, max: 10
  projectPath?: string;                                  // Defaults to first MCP root
}
```

**Output Schema:**

```typescript
{
	symbol: {
		name: string;
		kind: string;
		filePath: string;
		line: number;
	}
	inbound: Array<{
		symbol: {
			name: string;
			kind: string;
			filePath: string;
			line: number;
		};
		relationType: string;
		depth: number; // Distance from root symbol
	}>;
	outbound: Array<{
		symbol: {
			name: string;
			kind: string;
			filePath: string;
			line: number;
		};
		relationType: string;
		depth: number;
	}>;
}
```

**Error Cases:**

| Scenario               | Behavior                                         |
| :--------------------- | :----------------------------------------------- |
| Symbol not found       | Return error: "Symbol 'X' not found in index."   |
| No relations available | Return symbol with empty inbound/outbound arrays |
| No index exists        | Return error: "No index found."                  |

---

### 1.6 `index_status`

Returns the current indexing status and progress for a project.

**Input Schema:**

```typescript
{
  projectPath?: string;  // Defaults to first MCP root
}
```

**Output Schema:**

```typescript
{
  indexed: boolean;                        // Whether any index exists
  status: "idle" | "indexing" | "completed" | "failed";
  progress?: {                             // Only present if status = "indexing"
    filesProcessed: number;
    filesTotal: number;
    percentComplete: number;
  };
  lastIndexedAt: string | null;            // ISO-8601 timestamp of last completion
  fileCount: number;
  symbolCount: number;
  relationCount?: number;                  // Phase 1.1
  lastError: string | null;
}
```

---

## 2. MCP Resource URIs

Resource URIs are registered via `server.registerResource()`. Each returns a JSON or text representation.

### 2.1 `codebase://{project}/summary`

Returns a JSON summary of the indexed project.

```
URI Template: codebase://{projectPath}/summary
Method: GET (read)
Response: JSON (same shape as get_architecture output)
Error: 404 if no index exists for the project
```

### 2.2 `codebase://{project}/files/{filePath}`

Returns all symbols for a specific file.

```
URI Template: codebase://{projectPath}/files/{filePath}
Method: GET (read)
Response: JSON (same shape as get_file_symbols output)
Error: 404 if file not in index
```

### 2.3 `codebase://{project}/symbols/{symbolId}`

Returns a specific symbol with its relations.

```
URI Template: codebase://{projectPath}/symbols/{symbolId}
Method: GET (read)
Response: JSON { symbol: CodeSymbol, relations: CodeRelation[] }
Error: 404 if symbol not found
```

### 2.4 `codebase://{project}/search`

Parameterized search resource.

```
URI: codebase://{projectPath}/search?q={query}&kind={kind}&limit={limit}
Method: GET (read)
Response: JSON (same shape as search_symbols output)
```

---

## 3. Tool Registration Pattern

All Codebase Index tools are integrated into the existing `registerAllTools()` function in `src/mcp/tools/index.ts`:

```typescript
// In buildExecutors():
"index_repository": (args, db, _vectors, extra) =>
    handleIndexRepository(args, db, extra?.onProgress, extra?.signal),
"get_file_symbols": (args, db, _vectors, _extra) =>
    handleGetFileSymbols(args, db),
"search_symbols": (args, db, _vectors, _extra) =>
    handleSearchSymbols(args, db),
"get_architecture": (args, db, _vectors, _extra) =>
    handleGetArchitecture(args, db),
"trace_symbol": (args, db, _vectors, _extra) =>
    handleTraceSymbol(args, db),
"index_status": (args, db, _vectors, _extra) =>
    handleIndexStatus(args, db),
```

Added to `WRITE_TOOLS`:

```typescript
const WRITE_TOOLS = new Set([
	// ... existing tools
	"index_repository"
]);
```

Tool definitions added to the `TOOL_DEFINITIONS` array with descriptions and input schemas.

---

## 4. Response Format Consistency

All tools return results in the project's standard `McpResponse` format:

```typescript
{
  content: [{ type: "text", text: string }],
  structuredContent: {
    data: T,    // Tool-specific output payload
    repo: string
  }
}
```

Errors follow the same format with `isError: true`:

```typescript
{
  content: [{ type: "text", text: "Error: ..." }],
  isError: true
}
```

## 5. Dashboard API Routes (Phase 1.2)

Additional Express routes for the Svelte dashboard:

```
GET  /api/codebase/summary?projectPath=...       → get_architecture
GET  /api/codebase/files?projectPath=...          → list indexed files
GET  /api/codebase/symbols?search=...&kind=...     → search_symbols
GET  /api/codebase/files/:filePath/symbols         → get_file_symbols
GET  /api/codebase/index/status?projectPath=...    → index_status
POST /api/codebase/index?projectPath=...           → trigger index_repository
```

These routes follow the existing controller pattern in `src/dashboard/routes/` (e.g., `codebase.routes.ts`).

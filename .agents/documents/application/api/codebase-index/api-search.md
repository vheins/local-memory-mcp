# API Specification: Codebase Search & Trace

## Header & Navigation

- [Module Overview](./README.md)
- [Design — API Contracts](../../../design/codebase-index/api-contracts.md)
- [Design — Domain Model](../../../design/codebase-index/domain.md)
- [Testing — Tools](../../testing/codebase-index/test-tools.md)

This document specifies the MCP tools for querying indexed codebase symbols and tracing their relationships. All tools are read-only and comply with the [MCP 2025-11-25 Structured Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) specification.

## 1. `search_symbols`

### 1.1 Overview

- **Method:** `tools/call`
- **Category:** Read
- **Description:** Searches indexed symbols by name using a multi-strategy approach: exact match, prefix match, then substring fallback. All searches are case-insensitive (`COLLATE NOCASE`). Results are unioned, deduplicated, and ordered by match quality (exact > prefix > substring). Supports optional filtering by symbol kind, file path, and export status.

### 1.2 Arguments

| Parameter    | Type      | Required | Default | Description                                                |
| :----------- | :-------- | :------- | :------ | :--------------------------------------------------------- |
| `query`      | `string`  | Yes      | —       | Search query (minimum 2 characters).                       |
| `kind`       | `string`  | No       | —       | Filter by symbol kind. Must be a valid `SymbolKind` value. |
| `filePath`   | `string`  | No       | —       | Filter to symbols in a specific file (relative path).      |
| `isExported` | `boolean` | No       | —       | Filter to exported symbols only when `true`.               |
| `limit`      | `number`  | No       | `50`    | Maximum results to return (1–500).                         |
| `offset`     | `number`  | No       | `0`     | Pagination offset.                                         |

**Valid `SymbolKind` values:** `function`, `method`, `class`, `interface`, `type`, `enum`, `variable`.

### 1.3 Search Strategies

| Strategy     | SQL Pattern                     | Trigger                 |
| :----------- | :------------------------------ | :---------------------- |
| Exact match  | `WHERE name = ? COLLATE NOCASE` | Always attempted first. |
| Prefix match | `WHERE name LIKE ?              |                         | '%' COLLATE NOCASE` | Always attempted (union). |
| Substring    | `WHERE name LIKE '%'            |                         | ?                   |                           | '%' COLLATE NOCASE` | Fallback, always attempted (union). |

### 1.4 Response

**Success:**

```json
{
	"content": [
		{ "type": "text", "text": "Found 3 symbols matching 'formatOrder' in repo \"my-project\". See structuredContent." }
	],
	"isError": false,
	"structuredContent": {
		"data": {
			"symbols": [
				{
					"id": "uuid-symbol-1",
					"name": "formatOrder",
					"kind": "function",
					"qualifiedName": "OrderService.formatOrder",
					"signature": "formatOrder(order: Order): string",
					"filePath": "src/services/order.ts",
					"startLine": 42,
					"endLine": 60,
					"docComment": "Formats an order into a human-readable string representation.",
					"isExported": true
				},
				{
					"id": "uuid-symbol-2",
					"name": "formatOrderLine",
					"kind": "function",
					"qualifiedName": null,
					"signature": "formatOrderLine(line: OrderLine): string",
					"filePath": "src/utils/format.ts",
					"startLine": 15,
					"endLine": 22,
					"docComment": null,
					"isExported": true
				},
				{
					"id": "uuid-symbol-3",
					"name": "FormatOrderOptions",
					"kind": "interface",
					"qualifiedName": null,
					"signature": null,
					"filePath": "src/types/order.ts",
					"startLine": 5,
					"endLine": 12,
					"docComment": "Configuration options for order formatting.",
					"isExported": true
				}
			],
			"total": 3,
			"limit": 50,
			"offset": 0
		},
		"repo": "my-project"
	}
}
```

**Empty results:**

```json
{
	"structuredContent": {
		"data": {
			"symbols": [],
			"total": 0,
			"limit": 50,
			"offset": 0
		},
		"repo": "my-project"
	}
}
```

### 1.5 Error Codes

| Scenario                   | Code              | Behavior                                                                                                                   |
| :------------------------- | :---------------- | :------------------------------------------------------------------------------------------------------------------------- |
| `query` is empty           | `INVALID_PARAMS`  | JSON-RPC `-32602`: "Query must not be empty."                                                                              |
| `query` < 2 characters     | `QUERY_TOO_SHORT` | JSON-RPC `-32602`: "Query must be at least 2 characters."                                                                  |
| `kind` not in `SymbolKind` | `INVALID_KIND`    | JSON-RPC `-32602`: "Invalid symbol kind 'widget'. Valid values: function, method, class, interface, type, enum, variable." |
| No index exists            | —                 | `structuredContent.data` with `symbols: [], total: 0`                                                                      |

### 1.6 Runnable Example

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
			"limit": 10
		}
	}
}
```

**Expected response:** (see §1.4 above).

---

## 2. `get_file_symbols`

### 2.1 Overview

- **Method:** `tools/call`
- **Category:** Read
- **Description:** Returns all symbols declared in a specific file, with optional relation data. Symbols are ordered by their line number in the source file.

### 2.2 Arguments

| Parameter          | Type      | Required | Default | Description                                        |
| :----------------- | :-------- | :------- | :------ | :------------------------------------------------- |
| `filePath`         | `string`  | Yes      | —       | Relative file path from project root.              |
| `includeRelations` | `boolean` | No       | `false` | When `true`, includes `relations` in the response. |

### 2.3 Response

**Success with relations:**

```json
{
	"content": [{ "type": "text", "text": "File src/services/order.ts: 3 symbols, 4 relations." }],
	"isError": false,
	"structuredContent": {
		"data": {
			"file": {
				"filePath": "src/services/order.ts",
				"language": "typescript",
				"status": "indexed",
				"size": 2048,
				"lineCount": 85,
				"lastIndexedAt": "2026-07-22T10:01:23.000Z"
			},
			"symbols": [
				{
					"id": "uuid-symbol-1",
					"name": "OrderService",
					"kind": "class",
					"qualifiedName": "OrderService",
					"signature": null,
					"startLine": 10,
					"endLine": 82,
					"startColumn": 6,
					"endColumn": 1,
					"docComment": "Manages order lifecycle operations.",
					"isExported": true,
					"metadata": { "isAbstract": false }
				},
				{
					"id": "uuid-symbol-2",
					"name": "formatOrder",
					"kind": "method",
					"qualifiedName": "OrderService.formatOrder",
					"signature": "formatOrder(order: Order): string",
					"startLine": 42,
					"endLine": 60,
					"startColumn": 2,
					"endColumn": 3,
					"docComment": "Formats an order into a human-readable string.",
					"isExported": false,
					"metadata": { "isStatic": false, "isAsync": false }
				},
				{
					"id": "uuid-symbol-3",
					"name": "createOrder",
					"kind": "method",
					"qualifiedName": "OrderService.createOrder",
					"signature": "createOrder(data: CreateOrderDTO): Promise<Order>",
					"startLine": 65,
					"endLine": 81,
					"startColumn": 2,
					"endColumn": 3,
					"docComment": null,
					"isExported": false,
					"metadata": { "isStatic": false, "isAsync": true }
				}
			],
			"relations": [
				{
					"id": "uuid-rel-1",
					"sourceSymbolId": "uuid-symbol-2",
					"targetSymbolId": "uuid-symbol-other",
					"relationType": "calls",
					"sourceLine": 48,
					"metadata": null
				},
				{
					"id": "uuid-rel-2",
					"sourceSymbolId": "uuid-symbol-2",
					"targetSymbolId": "uuid-symbol-3",
					"relationType": "member_of",
					"sourceLine": null,
					"metadata": null
				},
				{
					"id": "uuid-rel-3",
					"sourceSymbolId": "uuid-symbol-3",
					"targetSymbolId": "uuid-symbol-other",
					"relationType": "imports",
					"sourceLine": 66,
					"metadata": { "namedImport": "CreateOrderDTO" }
				},
				{
					"id": "uuid-rel-4",
					"sourceSymbolId": "uuid-symbol-3",
					"targetSymbolId": "uuid-symbol-other",
					"relationType": "returns",
					"sourceLine": 65,
					"metadata": null
				}
			]
		},
		"repo": "my-project"
	}
}
```

**File not indexed:**

```json
{
	"structuredContent": {
		"data": {
			"file": null,
			"symbols": [],
			"relations": []
		},
		"repo": "my-project"
	}
}
```

### 2.4 Error Codes

| Scenario            | Code               | Behavior                                         |
| :------------------ | :----------------- | :----------------------------------------------- |
| `filePath` is empty | `INVALID_PARAMS`   | JSON-RPC `-32602`: "filePath must not be empty." |
| File not found      | `FILE_NOT_FOUND`   | "File 'src/missing.ts' not found in index."      |
| No index exists     | `FILE_NOT_INDEXED` | "No index found. Run index_repository first."    |

### 2.5 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 301,
	"method": "tools/call",
	"params": {
		"name": "get_file_symbols",
		"arguments": {
			"filePath": "src/services/order.ts",
			"includeRelations": true
		}
	}
}
```

**Expected response:** (see §2.3 above).

---

## 3. `get_architecture`

### 3.1 Overview

- **Method:** `tools/call`
- **Category:** Read
- **Description:** Returns a high-level structural overview of the indexed codebase: language breakdown, symbol counts by kind, entry points (exported symbols), top files by symbol density, and optionally code hotspots (highly-referenced symbols in Phase 1.1).

### 3.2 Arguments

| Parameter     | Type     | Required | Default                | Description                        |
| :------------ | :------- | :------- | :--------------------- | :--------------------------------- |
| `projectPath` | `string` | No       | First MCP `roots/list` | Absolute path to the project root. |

### 3.3 Response

**Success:**

```json
{
	"content": [{ "type": "text", "text": "Architecture overview: 2 languages, 156 files, 2341 symbols." }],
	"isError": false,
	"structuredContent": {
		"data": {
			"languages": [
				{ "language": "typescript", "fileCount": 140, "symbolCount": 2200 },
				{ "language": "javascript", "fileCount": 16, "symbolCount": 141 }
			],
			"totalFiles": 156,
			"totalSymbols": 2341,
			"totalRelations": 4520,
			"symbolCounts": {
				"function": 512,
				"method": 689,
				"class": 87,
				"interface": 123,
				"type": 211,
				"enum": 34,
				"variable": 685
			},
			"relationCounts": {
				"calls": 2100,
				"imports": 1500,
				"extends": 45,
				"implements": 89,
				"member_of": 689,
				"returns": 640,
				"parameter": 312
			},
			"entryPoints": [
				{ "name": "App", "kind": "class", "filePath": "src/app.ts", "line": 10 },
				{ "name": "main", "kind": "function", "filePath": "src/index.ts", "line": 1 },
				{ "name": "createServer", "kind": "function", "filePath": "src/server.ts", "line": 25 }
			],
			"topFiles": [
				{ "filePath": "src/services/order.ts", "symbolCount": 45 },
				{ "filePath": "src/utils/format.ts", "symbolCount": 38 },
				{ "filePath": "src/types/domain.ts", "symbolCount": 35 }
			],
			"hotspots": [
				{ "name": "formatOrder", "kind": "function", "filePath": "src/services/order.ts", "referenceCount": 142 },
				{ "name": "User", "kind": "interface", "filePath": "src/types/user.ts", "referenceCount": 98 },
				{ "name": "validateInput", "kind": "function", "filePath": "src/utils/validate.ts", "referenceCount": 87 }
			]
		},
		"repo": "my-project"
	}
}
```

**No index exists:**

```json
{
	"structuredContent": {
		"data": {
			"languages": [],
			"totalFiles": 0,
			"totalSymbols": 0,
			"symbolCounts": {},
			"entryPoints": [],
			"topFiles": []
		},
		"repo": "my-project"
	}
}
```

> This is NOT an error — an empty architecture is a valid state before indexing.

### 3.4 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 302,
	"method": "tools/call",
	"params": {
		"name": "get_architecture",
		"arguments": {
			"projectPath": "/home/user/projects/my-app"
		}
	}
}
```

**Expected response:** (see §3.3 above).

---

## 4. `trace_symbol`

### 4.1 Overview

- **Method:** `tools/call`
- **Category:** Read
- **Description:** Traces inbound (who calls/references this symbol?) and/or outbound (what does this symbol call/reference?) relationships from a symbol. Supports multi-level traversal up to `maxDepth` using a recursive CTE.

### 4.2 Arguments

| Parameter     | Type     | Required | Default    | Description                                              |
| :------------ | :------- | :------- | :--------- | :------------------------------------------------------- |
| `symbolName`  | `string` | Yes      | —          | Name of the symbol to trace.                             |
| `direction`   | `string` | No       | `"both"`   | Trace direction: `"inbound"`, `"outbound"`, or `"both"`. |
| `maxDepth`    | `number` | No       | `3`        | Maximum traversal depth (1–10).                          |
| `projectPath` | `string` | No       | First root | Absolute path to the project root.                       |

### 4.3 Validations

| Validation                     | Rule                                                                          |
| :----------------------------- | :---------------------------------------------------------------------------- |
| `symbolName` empty             | Rejected: "symbolName must not be empty." (`-32602`)                          |
| `direction` invalid            | Rejected: "Invalid direction 'X'. Valid: inbound, outbound, both." (`-32602`) |
| `maxDepth` out of range (1–10) | Rejected: "maxDepth must be between 1 and 10." (`-32602`)                     |

### 4.4 Response

**Success:**

```json
{
	"content": [{ "type": "text", "text": "Trace for 'formatOrder': 3 inbound, 5 outbound (depth 3)." }],
	"isError": false,
	"structuredContent": {
		"data": {
			"symbol": {
				"name": "formatOrder",
				"kind": "function",
				"filePath": "src/services/order.ts",
				"line": 42
			},
			"inbound": [
				{
					"symbol": { "name": "handleRequest", "kind": "function", "filePath": "src/controllers/order.ts", "line": 30 },
					"relationType": "calls",
					"depth": 1
				},
				{
					"symbol": { "name": "renderPage", "kind": "function", "filePath": "src/views/order.tsx", "line": 15 },
					"relationType": "calls",
					"depth": 1
				},
				{
					"symbol": { "name": "App", "kind": "class", "filePath": "src/app.ts", "line": 10 },
					"relationType": "calls",
					"depth": 2
				}
			],
			"outbound": [
				{
					"symbol": { "name": "toUpperCase", "kind": "method", "filePath": "-", "line": 0 },
					"relationType": "calls",
					"depth": 1
				},
				{
					"symbol": { "name": "formatDate", "kind": "function", "filePath": "src/utils/date.ts", "line": 8 },
					"relationType": "calls",
					"depth": 1
				},
				{
					"symbol": { "name": "formatCurrency", "kind": "function", "filePath": "src/utils/money.ts", "line": 12 },
					"relationType": "calls",
					"depth": 2
				},
				{
					"symbol": { "name": "parseNumber", "kind": "function", "filePath": "src/utils/money.ts", "line": 5 },
					"relationType": "calls",
					"depth": 3
				},
				{
					"symbol": { "name": "Order", "kind": "interface", "filePath": "src/types/order.ts", "line": 3 },
					"relationType": "parameter",
					"depth": 1
				}
			]
		},
		"repo": "my-project"
	}
}
```

**No relations:**

```json
{
	"structuredContent": {
		"data": {
			"symbol": { "name": "unusedFn", "kind": "function", "filePath": "src/dead.ts", "line": 5 },
			"inbound": [],
			"outbound": []
		},
		"repo": "my-project"
	}
}
```

### 4.5 Error Codes

| Scenario                | Code               | Behavior                                                |
| :---------------------- | :----------------- | :------------------------------------------------------ |
| Symbol not found        | `SYMBOL_NOT_FOUND` | "Symbol 'unknownFn' not found in index."                |
| No index exists         | `NO_INDEX`         | "No index found. Run index_repository first."           |
| `symbolName` empty      | `INVALID_PARAMS`   | JSON-RPC `-32602`: "symbolName must not be empty."      |
| `direction` invalid     | `INVALID_PARAMS`   | JSON-RPC `-32602`: "Invalid direction 'sideways'."      |
| `maxDepth` out of range | `INVALID_PARAMS`   | JSON-RPC `-32602`: "maxDepth must be between 1 and 10." |

### 4.6 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 303,
	"method": "tools/call",
	"params": {
		"name": "trace_symbol",
		"arguments": {
			"symbolName": "formatOrder",
			"direction": "both",
			"maxDepth": 2
		}
	}
}
```

**Expected response:** (see §4.4 above).

---

## 5. Performance Characteristics

| Tool               | Query Complexity            | Index Strategy                                                    |
| :----------------- | :-------------------------- | :---------------------------------------------------------------- |
| `search_symbols`   | 3 unioned `SELECT` + dedup  | `idx_codebase_symbols_name`, `idx_codebase_symbols_name_kind`     |
| `get_file_symbols` | 2 `SELECT` (file + symbols) | `idx_codebase_files_project_file`, `idx_codebase_symbols_file_id` |
| `get_architecture` | 5 `SELECT` + aggregations   | All symbols counted via `GROUP BY kind`                           |
| `trace_symbol`     | Recursive CTE per direction | `idx_codebase_relations_source`, `idx_codebase_relations_target`  |

All read operations run without blocking writes (WAL mode). For projects up to 20,000 files, typical query times are <100ms.

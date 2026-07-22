# API Specification: Codebase Index Resources

## Header & Navigation

- [Module Overview](./README.md)
- [Design — API Contracts](../../../design/codebase-index/api-contracts.md)
- [Design — Domain Model](../../../design/codebase-index/domain.md)

This document specifies the MCP resource URIs exposed by the Codebase Index feature. Resources provide direct URI-based access to indexed codebase data, complementing the tool-based interface. All resources follow the standard MCP resource protocol and return JSON representations.

## 1. Resource URI Scheme

All Codebase Index resources use the `codebase://` URI scheme with a project path as the authority component. The `projectPath` parameter is URL-encoded and must match a known indexed project.

## 2. `codebase://{project}/summary`

### 2.1 Overview

Returns a JSON summary of the indexed project — identical in shape to the `get_architecture` tool output.

- **URI Template:** `codebase://{projectPath}/summary`
- **Method:** `GET` (read)
- **MIME Type:** `application/json`

### 2.2 Response

**200 OK:**

```json
{
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
	"entryPoints": [{ "name": "App", "kind": "class", "filePath": "src/app.ts", "line": 10 }],
	"topFiles": [{ "filePath": "src/services/order.ts", "symbolCount": 45 }],
	"hotspots": [
		{ "name": "formatOrder", "kind": "function", "filePath": "src/services/order.ts", "referenceCount": 142 }
	]
}
```

### 2.3 Error Codes

| Code | Scenario                    | Body                                                        |
| :--- | :-------------------------- | :---------------------------------------------------------- |
| 404  | No index exists for project | `{ "error": "No index found for project '/path/to/proj'" }` |

### 2.4 MCP Resource Registration

```typescript
server.registerResource(
	"codebase_summary",
	new ResourceTemplate("codebase://{projectPath}/summary", { list: undefined }),
	async (uri, { projectPath }) => {
		const data = await handleGetArchitecture({ projectPath }, db);
		return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }] };
	}
);
```

---

## 3. `codebase://{project}/files/{filePath}`

### 3.1 Overview

Returns all symbols for a specific file, with file metadata.

- **URI Template:** `codebase://{projectPath}/files/{filePath}`
- **Method:** `GET` (read)
- **MIME Type:** `application/json`

> **Note:** `{filePath}` may contain path separators (e.g., `/src/services/order.ts`). The `{filePath}` variable captures the remainder of the URI after `/files/`. Implementations must preserve slashes in the file path variable.

### 3.2 Response

**200 OK:**

```json
{
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
		}
	]
}
```

### 3.3 Error Codes

| Code | Scenario                    | Body                                                        |
| :--- | :-------------------------- | :---------------------------------------------------------- |
| 404  | File not in index           | `{ "error": "File 'src/missing.ts' not found in index." }`  |
| 404  | No index exists for project | `{ "error": "No index found for project '/path/to/proj'" }` |

### 3.4 MCP Resource Registration

```typescript
server.registerResource(
	"codebase_file_symbols",
	new ResourceTemplate("codebase://{projectPath}/files/{filePath*}", { list: undefined }),
	async (uri, { projectPath, filePath }) => {
		const data = await handleGetFileSymbols({ filePath }, db);
		return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }] };
	}
);
```

---

## 4. `codebase://{project}/symbols/{symbolId}`

### 4.1 Overview

Returns a specific symbol with all its relations (inbound and outbound).

- **URI Template:** `codebase://{projectPath}/symbols/{symbolId}`
- **Method:** `GET` (read)
- **MIME Type:** `application/json`

### 4.2 Response

**200 OK:**

```json
{
	"symbol": {
		"id": "uuid-symbol-1",
		"name": "formatOrder",
		"kind": "function",
		"qualifiedName": "OrderService.formatOrder",
		"signature": "formatOrder(order: Order): string",
		"filePath": "src/services/order.ts",
		"startLine": 42,
		"endLine": 60,
		"startColumn": 2,
		"endColumn": 3,
		"docComment": "Formats an order into a human-readable string representation.",
		"isExported": false,
		"metadata": { "isStatic": false, "isAsync": false }
	},
	"relations": [
		{
			"id": "uuid-rel-1",
			"sourceSymbolId": "uuid-symbol-other",
			"targetSymbolId": "uuid-symbol-1",
			"relationType": "calls",
			"sourceLine": 30,
			"metadata": null,
			"sourceSymbol": { "name": "handleRequest", "kind": "function", "filePath": "src/controllers/order.ts" }
		},
		{
			"id": "uuid-rel-3",
			"sourceSymbolId": "uuid-symbol-1",
			"targetSymbolId": "uuid-symbol-other2",
			"relationType": "calls",
			"sourceLine": 48,
			"metadata": null,
			"targetSymbol": { "name": "formatDate", "kind": "function", "filePath": "src/utils/date.ts" }
		}
	]
}
```

> Relations are enriched with the resolved symbol name/kind/filePath for both source and target to avoid requiring follow-up lookups.

### 4.3 Error Codes

| Code | Scenario                    | Body                                                        |
| :--- | :-------------------------- | :---------------------------------------------------------- |
| 404  | Symbol not found            | `{ "error": "Symbol 'uuid-unknown' not found." }`           |
| 404  | No index exists for project | `{ "error": "No index found for project '/path/to/proj'" }` |

### 4.4 MCP Resource Registration

```typescript
server.registerResource(
	"codebase_symbol_detail",
	new ResourceTemplate("codebase://{projectPath}/symbols/{symbolId}", { list: undefined }),
	async (uri, { projectPath, symbolId }) => {
		const data = await getSymbolWithRelations(symbolId, db);
		return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }] };
	}
);
```

---

## 5. Resource Discovery

### 5.1 `resources/list`

Resources are listed when connected and indexed. The server advertises available codebase resources via the standard MCP `resources/list` method:

```json
{
	"jsonrpc": "2.0",
	"id": 400,
	"result": {
		"resources": [
			{
				"uri": "codebase:///home/user/projects/my-app/summary",
				"name": "Codebase Summary: /home/user/projects/my-app",
				"mimeType": "application/json",
				"description": "High-level structural overview of the indexed codebase"
			}
		]
	}
}
```

### 5.2 `resources/read`

Clients read resources directly via `resources/read` with the target URI:

```json
{
	"jsonrpc": "2.0",
	"id": 401,
	"method": "resources/read",
	"params": {
		"uri": "codebase:///home/user/projects/my-app/summary"
	}
}
```

---

## 6. URI Encoding Rules

| Component     | Encoding    | Example                                  |
| :------------ | :---------- | :--------------------------------------- |
| `projectPath` | URL-encoded | `/home/user/projects/my%2Dapp`           |
| `filePath`    | Preserved   | `src/services/order.ts` (slashes intact) |
| `symbolId`    | Raw UUID    | `550e8400-e29b-41d4-a716-446655440000`   |

> Project paths containing special characters (spaces, `#`, `?`, `&`) must be percent-encoded per RFC 3986 when used in resource URIs.

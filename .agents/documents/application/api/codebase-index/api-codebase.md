# Codebase Index API

> Module: `codebase-index` · Tools: `codebase-index`, `codebase-read` · Transport: MCP `tools/call` over stdio

## 1. Overview

Tree-sitter + WASM index for codebase exploration. Mandatory first tool for ALL codebase context discovery.

| Tool             | Kind  | Auto-infer Mode                                                                          | Description                            |
| :--------------- | :---- | :--------------------------------------------------------------------------------------- | :------------------------------------- |
| `codebase-index` | write | `repo` alone→status, `repoPath`+`repo`→index, `warmup:true`→warmup                       | Freshness/count + tree-sitter scan     |
| `codebase-read`  | read  | `query`→search, `name`→trace, `filePath`→file symbols, `content`→grep, none→architecture | Symbol/NL search, trace, file, content |

`codebase-read` modes (auto-infer from params):

| Mode           | Trigger                   | Description                          |
| :------------- | :------------------------ | :----------------------------------- |
| `search`       | `query` with spaces or NL | Symbol + NL search (hybrid)          |
| `symbol`       | `query` single term       | Symbol name search                   |
| `trace`        | `name` without `query`    | Definition + cross-file usages       |
| `file`         | `filePath`                | Symbols in file                      |
| `content`      | `content` (regex)         | Grep indexed file contents           |
| `architecture` | none of above             | Repo tree + stats; `depth` only here |

`depth` param applies ONLY inside architecture mode (1–5, default 1).

Priority (STRICT): `codebase-index` status check → if stale trigger index → `codebase-read`. Forbidden as first resort: `rg`/`grep`/`glob`/`cat` brute-force — only via `explore` sub-agent after index cannot answer.

## 2. Authentication

| Surface                     | Auth                       | Details                                                          |
| :-------------------------- | :------------------------- | :--------------------------------------------------------------- |
| MCP stdio                   | None                       | Session `repo` from basename; `owner` not used (repo-keyed only) |
| Dashboard `/api/codebase/*` | Optional `DASHBOARD_TOKEN` | `Authorization: Bearer <token>`                                  |

Codebase index is repo-keyed only (no `owner` column) — per ADR-008 out-of-scope for owner isolation. Env: `CODEBASE_AUTO_INDEX`, `CODEBASE_INDEX_WORKERS=4`, `CODEBASE_INDEX_PARSE_TIMEOUT_MS=10000`.

## 3. Parameters

### codebase-index

| Name           | Type       | Required | Default | Description                         |
| :------------- | :--------- | :------- | :------ | :---------------------------------- |
| `repo`         | `string`   | Yes      | —       | Repo name (e.g. `local-memory-mcp`) |
| `repoPath`     | `string`   | No       | —       | Absolute path → triggers index scan |
| `owner`        | `string`   | No       | —       | Ignored (repo-keyed)                |
| `force`        | `boolean`  | No       | `false` | Force re-index even if fresh        |
| `warmup`       | `boolean`  | No       | `false` | Warm engine without scan            |
| `includeGlobs` | `string[]` | No       | —       | Include patterns                    |
| `excludeGlobs` | `string[]` | No       | —       | Exclude patterns                    |

Auto-infer: `repo` alone → status; `repoPath`+`repo` → index; `warmup:true` → warmup.

### codebase-read

| Name             | Type                  | Required | Default | Description                                                                                |
| :--------------- | :-------------------- | :------- | :------ | :----------------------------------------------------------------------------------------- |
| `query`          | `string`              | No       | —       | Search query. Inline `key:value` tags (`kind:function`, `language:php`, `file:src/foo.ts`) |
| `name`           | `string`              | No       | —       | Symbol trace (definition + usages)                                                         |
| `filePath`       | `string`              | No       | —       | File symbols                                                                               |
| `content`        | `string`              | No       | —       | Regex grep over indexed contents (max 200 chars, ReDoS guard)                              |
| `depth`          | `integer` 1–5         | No       | `1`     | Architecture depth (only in architecture mode)                                             |
| `repo` / `repos` | `string` / `string[]` | No       | session | Scope (repo-keyed)                                                                         |
| `owner`          | `string`              | No       | `""`    | Ignored                                                                                    |
| `kind`           | `string`/`string[]`   | No       | —       | Filter: `function`, `class`, `interface`, etc.                                             |
| `language`       | `string`              | No       | —       | Language filter                                                                            |
| `limit`          | `integer` 1–200       | No       | `20`    | Max results                                                                                |
| `offset`         | `integer` ≥0          | No       | `0`     | Offset                                                                                     |
| `regex`          | `boolean`             | No       | `false` | Regex mode for query                                                                       |
| `json`           | `boolean`             | No       | `false` | Structured flag                                                                            |

## 4. Request Body

Content-Type: `application/json` via `tools/call`.

| Field      | Type      | Required             | Schema            |
| :--------- | :-------- | :------------------- | :---------------- |
| `repo`     | `string`  | `codebase-index`:Yes | `minLength:1`     |
| `repoPath` | `string`  | No                   | Absolute path     |
| `query`    | `string`  | No                   | Search text       |
| `name`     | `string`  | No                   | Symbol name       |
| `filePath` | `string`  | No                   | Relative path     |
| `content`  | `string`  | No                   | Regex ≤200 chars  |
| `depth`    | `integer` | No                   | `1–5` (arch only) |

Architecture mode: no `query`/`name`/`filePath`/`content` present.

## 5. Responses

### 200 — codebase-index status

```json
{
	"content": [{ "type": "text", "text": "Index fresh (2h ago), 1243 files, 8420 symbols." }],
	"structuredContent": {
		"schema": "codebase-index",
		"mode": "status",
		"data": {
			"repo": "local-memory-mcp",
			"fresh": true,
			"file_count": 1243,
			"symbol_count": 8420,
			"indexed_at": "2026-05-12T08:00:00Z",
			"capability": "ready"
		}
	}
}
```

### 200 — codebase-read search

```json
{
	"content": [{ "type": "text", "text": "Found 5 symbols for \"memory search\"." }],
	"structuredContent": {
		"schema": "codebase-read",
		"mode": "search",
		"total": 5,
		"data": [
			{
				"name": "MemoryService",
				"kind": "class",
				"filePath": "src/mcp/services/memory.service.ts",
				"language": "typescript",
				"line": 42
			}
		]
	}
}
```

### 200 — codebase-read trace

```json
{
	"content": [
		{ "type": "text", "text": "Symbol MemoryService defined at src/mcp/services/memory.service.ts:42, 3 references." }
	],
	"structuredContent": {
		"schema": "codebase-read",
		"mode": "trace",
		"data": {
			"definition": { "name": "MemoryService", "filePath": "src/mcp/services/memory.service.ts", "line": 42 },
			"references": [{ "filePath": "src/mcp/tools/memory.read.ts", "line": 18 }]
		}
	}
}
```

### 400 / 404

```json
{
	"schema": "tool-error",
	"code": "VALIDATION_ERROR",
	"message": "Error: repo is required",
	"retryable": false,
	"error": "Error: repo is required"
}
```

Codes: `VALIDATION_ERROR` | `NOT_FOUND` | `CAPABILITY_UNAVAILABLE` | `INTERNAL_ERROR`.

## 6. Usage Example

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "tools/call",
	"params": { "name": "codebase-index", "arguments": { "repo": "local-memory-mcp", "json": true } }
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 2,
	"method": "tools/call",
	"params": {
		"name": "codebase-index",
		"arguments": { "repo": "local-memory-mcp", "repoPath": "/home/vheins/workspace/local-memory-mcp", "json": true }
	}
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 3,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": { "query": "memory search kind:class", "repo": "local-memory-mcp", "limit": 10, "json": true }
	}
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 4,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": { "name": "MemoryService", "repo": "local-memory-mcp", "json": true }
	}
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 5,
	"method": "tools/call",
	"params": { "name": "codebase-read", "arguments": { "repo": "local-memory-mcp", "depth": 2, "json": true } }
}
```

## 7. OpenAPI 3.0 YAML

```yaml
openapi: 3.0.0
info:
  title: Codebase Index API (local-memory-mcp)
  version: 1.0.0
  description: codebase-index / codebase-read via MCP stdio (tree-sitter WASM)
servers:
  - url: stdio://local-memory-mcp
    description: MCP stdio transport
paths:
  /mcp/tools/call:
    post:
      summary: Invoke codebase tools
      operationId: callCodebaseTool
      requestBody:
        required: true
        content:
          application/json:
            schema:
              oneOf:
                - $ref: "#/components/schemas/CodebaseIndexRequest"
                - $ref: "#/components/schemas/CodebaseReadRequest"
      responses:
        "200":
          {
            description: Success,
            content: { application/json: { schema: { $ref: "#/components/schemas/CodebaseResponse" } } }
          }
        "400":
          {
            description: Validation error,
            content: { application/json: { schema: { $ref: "#/components/schemas/ToolError" } } }
          }
        "404":
          {
            description: Not found,
            content: { application/json: { schema: { $ref: "#/components/schemas/ToolError" } } }
          }
components:
  schemas:
    CodebaseIndexRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [codebase-index] }
        arguments:
          type: object
          required: [repo]
          properties:
            repo: { type: string, minLength: 1 }
            repoPath: { type: string }
            force: { type: boolean, default: false }
            json: { type: boolean, default: false }
    CodebaseReadRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [codebase-read] }
        arguments:
          type: object
          properties:
            query: { type: string }
            name: { type: string }
            filePath: { type: string }
            content: { type: string, maxLength: 200 }
            depth: { type: integer, minimum: 1, maximum: 5, default: 1 }
            repo: { type: string }
            limit: { type: integer, minimum: 1, maximum: 200, default: 20 }
            offset: { type: integer, minimum: 0, default: 0 }
            json: { type: boolean, default: false }
    CodebaseResponse:
      type: object
      properties:
        content: { type: array, items: { type: object } }
        structuredContent: { type: object }
    ToolError:
      type: object
      required: [schema, code, message, retryable, error]
      properties:
        schema: { type: string, enum: [tool-error] }
        code: { type: string, enum: [VALIDATION_ERROR, NOT_FOUND, CAPABILITY_UNAVAILABLE, INTERNAL_ERROR] }
        message: { type: string }
        retryable: { type: boolean }
        error: { type: string }
        details: { type: object }
```

## 8. Cross-References

| Link                                                        | Description                          |
| :---------------------------------------------------------- | :----------------------------------- |
| `../../modules/codebase-index/overview.md`                  | Codebase module overview             |
| `../../../src/mcp/prompts/server/instructions.md`           | Canonical contract (strict priority) |
| `../../../src/mcp/tools/schemas/codebase.ts`                | Zod schemas                          |
| `../../../src/mcp/types/tool-definitions/codebase-index.ts` | Derived definitions                  |
| `../../../src/mcp/codebase-index/`                          | Indexer implementation               |
| `../../operations/codebase-index.md`                        | Operations runbook                   |

# API Specification: Codebase Indexing

## Header & Navigation

- [Module Overview](./README.md)
- [Design — API Contracts](../../../design/codebase-index/api-contracts.md)
- [Design — Domain Model](../../../design/codebase-index/domain.md)
- [Testing — Tools](../../testing/codebase-index/test-tools.md)

This document specifies the MCP tools for initiating and monitoring codebase indexing. Both tools comply with the [MCP 2025-11-25 Structured Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) specification.

## 1. `index_repository`

### 1.1 Overview

- **Method:** `tools/call`
- **Category:** Write (uses `store.withWrite()` for concurrency control)
- **Description:** Triggers indexing of a project's source code. If called on an already-indexed project, performs an incremental update — only files with changed checksums are re-parsed. The tool emits `notifications/progress` via `extra.onProgress(processed, total)` during execution.
- **Idempotency:** Running twice with no file changes produces identical results (checksum-based change detection).

### 1.2 Arguments

| Parameter     | Type     | Required | Default                | Description                                 |
| :------------ | :------- | :------- | :--------------------- | :------------------------------------------ |
| `projectPath` | `string` | No       | First MCP `roots/list` | Absolute path to the project root to index. |

### 1.3 Access Control

| Rule                       | Behavior                                                                                      |
| :------------------------- | :-------------------------------------------------------------------------------------------- |
| Path within session roots  | Allowed.                                                                                      |
| Path outside session roots | Error: `PATH_OUTSIDE_WORKSPACE` — "Project path is not within any configured workspace root." |
| Path does not exist        | Error: `PATH_NOT_FOUND` — "Project path does not exist or is not accessible."                 |
| Index already in progress  | Error: `INDEX_IN_PROGRESS` — Returns current progress stats via `structuredContent`.          |

### 1.4 Response

**Success (`status: "completed"`):**

```json
{
	"content": [{ "type": "text", "text": "Indexed project at /path/to/project: 156 files, 2341 symbols, 0 errors." }],
	"isError": false,
	"structuredContent": {
		"data": {
			"status": "completed",
			"filesDiscovered": 156,
			"filesIndexed": 156,
			"filesFailed": 0,
			"filesSkipped": 12,
			"filesDeleted": 0,
			"symbolsExtracted": 2341,
			"relationsResolved": 4520,
			"duration": 3841
		},
		"repo": "my-project"
	}
}
```

**Partial Failure (`status: "completed"` with errors):**

```json
{
	"structuredContent": {
		"data": {
			"status": "completed",
			"filesDiscovered": 156,
			"filesIndexed": 153,
			"filesFailed": 3,
			"filesSkipped": 12,
			"filesDeleted": 0,
			"symbolsExtracted": 2310,
			"relationsResolved": 4490,
			"duration": 3902,
			"errors": [
				{ "filePath": "src/broken.ts", "message": "Unexpected token at line 42" },
				{ "filePath": "src/minified.js", "message": "File exceeds max size limit" },
				{ "filePath": "assets/icon.svg", "message": "Unsupported file type" }
			]
		},
		"repo": "my-project"
	}
}
```

**Error (`PATH_NOT_FOUND`):**

```json
{
	"content": [{ "type": "text", "text": "Error: PATH_NOT_FOUND — Project path '/nonexistent' does not exist." }],
	"isError": true
}
```

**Error (`INDEX_IN_PROGRESS`):**

```json
{
	"content": [{ "type": "text", "text": "Error: INDEX_IN_PROGRESS — Indexing is already running for this project." }],
	"isError": false,
	"structuredContent": {
		"data": {
			"status": "in_progress",
			"progress": {
				"filesProcessed": 78,
				"filesTotal": 156,
				"percentComplete": 50
			},
			"startedAt": "2026-07-22T10:00:00.000Z"
		},
		"repo": "my-project"
	}
}
```

### 1.5 Response Schema

| Field               | Type                                                    | Description                                     |
| :------------------ | :------------------------------------------------------ | :---------------------------------------------- |
| `status`            | `"completed" \| "in_progress" \| "no_files" \| "error"` | Outcome of the index operation                  |
| `filesDiscovered`   | `number`                                                | Total files found during discovery              |
| `filesIndexed`      | `number`                                                | Files successfully parsed                       |
| `filesFailed`       | `number`                                                | Files with parse errors                         |
| `filesSkipped`      | `number`                                                | Intentionally skipped (binary, too large, etc.) |
| `filesDeleted`      | `number` (optional, incremental)                        | Files deleted since last index                  |
| `symbolsExtracted`  | `number`                                                | Total symbols stored                            |
| `relationsResolved` | `number` (optional, Phase 1.1)                          | Total relations stored                          |
| `duration`          | `number`                                                | Indexing time in milliseconds                   |
| `errors`            | `{ filePath, message }[]`                               | Per-file error records (empty array if none)    |

### 1.6 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 200,
	"method": "tools/call",
	"params": {
		"name": "index_repository",
		"arguments": {
			"projectPath": "/home/user/projects/my-app"
		}
	}
}
```

**Expected response for incremental (no changes):**

```json
{
	"jsonrpc": "2.0",
	"id": 200,
	"result": {
		"content": [{ "type": "text", "text": "No changes detected. Index is up to date." }],
		"isError": false,
		"structuredContent": {
			"data": {
				"status": "completed",
				"filesDiscovered": 156,
				"filesIndexed": 0,
				"filesFailed": 0,
				"filesSkipped": 0,
				"filesDeleted": 0,
				"symbolsExtracted": 0,
				"duration": 42
			},
			"repo": "my-app"
		}
	}
}
```

---

## 2. `index_status`

### 2.1 Overview

- **Method:** `tools/call`
- **Category:** Read
- **Description:** Returns the current indexing status and progress for a project. Useful for polling during long-running index operations.

### 2.2 Arguments

| Parameter     | Type     | Required | Default                | Description                        |
| :------------ | :------- | :------- | :--------------------- | :--------------------------------- |
| `projectPath` | `string` | No       | First MCP `roots/list` | Absolute path to the project root. |

### 2.3 Response

**Index exists and is complete:**

```json
{
	"content": [{ "type": "text", "text": "Index status for /path/to/project: completed (156 files, 2341 symbols)." }],
	"isError": false,
	"structuredContent": {
		"data": {
			"indexed": true,
			"status": "completed",
			"lastIndexedAt": "2026-07-22T10:01:23.000Z",
			"fileCount": 156,
			"symbolCount": 2341,
			"relationCount": 4520,
			"lastError": null
		},
		"repo": "my-project"
	}
}
```

**Index in progress:**

```json
{
	"structuredContent": {
		"data": {
			"indexed": true,
			"status": "indexing",
			"progress": {
				"filesProcessed": 78,
				"filesTotal": 156,
				"percentComplete": 50
			},
			"lastIndexedAt": "2026-07-21T18:30:00.000Z",
			"fileCount": 78,
			"symbolCount": 1170,
			"relationCount": 2250,
			"lastError": null
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
			"indexed": false,
			"status": "idle",
			"lastIndexedAt": null,
			"fileCount": 0,
			"symbolCount": 0,
			"relationCount": 0,
			"lastError": null
		},
		"repo": "my-project"
	}
}
```

**Failed last index:**

```json
{
	"structuredContent": {
		"data": {
			"indexed": true,
			"status": "failed",
			"lastIndexedAt": "2026-07-22T09:58:00.000Z",
			"fileCount": 120,
			"symbolCount": 1800,
			"relationCount": 3500,
			"lastError": "tree-sitter wasm initialization failed for language 'typescript'"
		},
		"repo": "my-project"
	}
}
```

### 2.4 Response Schema

| Field           | Type                                              | Description                                             |
| :-------------- | :------------------------------------------------ | :------------------------------------------------------ |
| `indexed`       | `boolean`                                         | Whether any index data exists for this project          |
| `status`        | `"idle" \| "indexing" \| "completed" \| "failed"` | Current indexing operational state                      |
| `progress`      | `{ filesProcessed, filesTotal, percentComplete }` | Only present when `status === "indexing"`               |
| `lastIndexedAt` | `string \| null` (ISO-8601)                       | Timestamp of last successful or failed index completion |
| `fileCount`     | `number`                                          | Number of files in the index                            |
| `symbolCount`   | `number`                                          | Number of symbols in the index                          |
| `relationCount` | `number` (optional, Phase 1.1)                    | Number of relations in the index                        |
| `lastError`     | `string \| null`                                  | Error message from the last failed index (if any)       |

### 2.5 Error Codes

| Scenario                | Code             | Behavior                                            |
| :---------------------- | :--------------- | :-------------------------------------------------- |
| `projectPath` invalid   | `PATH_NOT_FOUND` | "Project path does not exist or is not accessible." |
| No MCP roots configured | —                | Response with `indexed: false, status: "idle"`      |

### 2.6 Runnable Example

```json
{
	"jsonrpc": "2.0",
	"id": 201,
	"method": "tools/call",
	"params": {
		"name": "index_status",
		"arguments": {
			"projectPath": "/home/user/projects/my-app"
		}
	}
}
```

**Expected response:**

```json
{
	"jsonrpc": "2.0",
	"id": 201,
	"result": {
		"content": [{ "type": "text", "text": "Index status for /home/user/projects/my-app: completed." }],
		"isError": false,
		"structuredContent": {
			"data": {
				"indexed": true,
				"status": "completed",
				"lastIndexedAt": "2026-07-22T10:01:23.000Z",
				"fileCount": 156,
				"symbolCount": 2341,
				"relationCount": 4520,
				"lastError": null
			},
			"repo": "my-app"
		}
	}
}
```

# API Specification: Dashboard System & Utilities

## Header & Navigation

- [Dashboard Module Overview](../../modules/dashboard/overview.md)
- [Memories API](api-memories.md)
- [Tasks API](api-tasks.md)
- [Dashboard Tests](../../testing/dashboard/test-dashboard.md)

This document describes technical and administrative endpoints for monitoring the local memory system and interacting with MCP capabilities.

## 1. Monitoring & Stats

### 1.1 `GET /api/`

Returns the operational health and environment configuration of the dashboard server.

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": {
		"type": "health",
		"id": "system",
		"attributes": {
			"connected": true,
			"uptime": 12345,
			"version": "0.19.24",
			"memoryCount": 250,
			"pendingRequests": 0,
			"dbPath": "/absolute/path/to/storage/memory.db"
		}
	}
}
```

### 1.2 `GET /api/stats`

Retrieves a high-level data summary for a specific repository or the entire system.

**Query Parameters**

| Parameter | Type   | Required | Description                           |
| :-------- | :----- | :------- | :------------------------------------ |
| `repo`    | string | No       | Filter statistics by repository name. |

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": {
		"type": "repository-stats",
		"id": "system",
		"attributes": {
			"totalMemories": 250,
			"activeTasks": 12,
			"completedTasks": 85,
			"totalActivity": 1500
		}
	}
}
```

### 1.3 `GET /api/version`

Returns the current server version.

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": {
		"type": "version",
		"id": "system",
		"attributes": { "version": "0.19.24" }
	}
}
```

### 1.4 `GET /api/recent-actions`

Retrieves a historical timeline of interactions (memory reads/writes, task updates, tool calls).

**Query Parameters**

| Parameter  | Type   | Required | Default | Description                |
| :--------- | :----- | :------- | :------ | :------------------------- |
| `repo`     | string | No       | -       | Filter by repository name. |
| `page`     | number | No       | `1`     | Current page number.       |
| `pageSize` | number | No       | `10`    | Items per page (max 50).   |

**Special Logic: Burst Condensation**
Identical actions (same tool and repo) within a **10-minute window** are automatically condensed into a single list item with an incremented `burstCount`.

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": [
		{
			"type": "recent-action",
			"id": "1",
			"attributes": {
				"action": "memory-store",
				"memory_title": "Baseline Schema",
				"burstCount": 3,
				"created_at": "2024-01-01T12:00:00Z"
			}
		}
	],
	"meta": { "page": 1, "pageSize": 10, "totalItems": 150 }
}
```

## 2. Infrastructure

### 2.1 `GET /api/repos`

Lists all unique repository names found in the database.

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": [{ "type": "repository", "id": "project-name", "attributes": { "name": "project-name" } }]
}
```

### 2.2 `GET /api/capabilities`

Aggregates and returns all registered MCP tools, resources, and prompt templates from the MCP server.

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": {
		"type": "capability",
		"id": "system",
		"attributes": {
			"tools": [
				{ "name": "memory-store", "description": "...", "inputSchema": {} },
				{ "name": "task-create", "description": "...", "inputSchema": {} },
				{ "name": "standard-store", "description": "...", "inputSchema": {} }
			],
			"resources": [{ "uri": "repository://{owner}/{name}/memories", "name": "Memories" }],
			"prompts": [{ "name": "memory-agent-core", "arguments": [] }]
		}
	}
}
```

### 2.3 `GET /api/export`

Provides a complete data dump of a repository, including memories and tasks with embedded audit trails.

**Query Parameters**

| Parameter | Type   | Required | Description                    |
| :-------- | :----- | :------- | :----------------------------- |
| `repo`    | string | Yes      | The repository name to export. |

## 3. MCP Operations

### 3.1 `POST /api/tools/:name/call`

Synchronously executes an internal MCP tool and returns the JSON-RPC result.

**Path Parameters**

| Parameter | Type   | Description                                  |
| :-------- | :----- | :------------------------------------------- |
| `name`    | string | The tool identifier (e.g., `memory-search`). |

**Request Body**

```json
{
	"data": {
		"attributes": {
			"arguments": {
				"repo": "my-project",
				"query": "synthesis"
			}
		}
	}
}
```

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": {
		"type": "tool-result",
		"id": "system",
		"attributes": {
			"content": [{ "type": "text", "text": "Execution result..." }],
			"isError": false
		}
	}
}
```

## 4. Coordination Endpoints

### 4.1 `GET /api/coordination/handoffs`

Lists handoffs with optional status and agent filters.

**Query Parameters**: `repo`, `status`, `from_agent`, `to_agent`, `page`, `pageSize`

### 4.2 `GET /api/coordination/claims`

Lists active task claims.

**Query Parameters**: `repo`, `agent`, `page`, `pageSize`

### 4.3 `POST /api/coordination/release-stale`

Releases all expired/stale claims in a repository.

**Request Body**: `{ "data": { "attributes": { "repo": "my-project" } } }`

## 5. Standards Endpoints

### 5.1 `GET /api/standards`

Lists coding standards with optional filters.

**Query Parameters**: `repo`, `search`, `language`, `stack`, `page`, `pageSize`

### 5.2 `POST /api/standards`

Creates a new coding standard entry.

### 5.3 `GET /api/standards/:id`

Fetches a specific standard entry.

## 6. Knowledge Graph Endpoints

### 6.1 `GET /api/graph`

Returns structured graph data (entities, relations) for visualization.

**Query Parameters**: `repo` (required)

### 6.2 `GET /api/entities`

Lists knowledge graph entities.

### 6.3 `GET /api/relations`

Lists knowledge graph relations.

## 7. Error Codes

| Code      | HTTP Status | Description                                                       |
| :-------- | :---------: | :---------------------------------------------------------------- |
| `ERR-001` |     400     | Validation Error — request body failed JSON:API schema validation |
| `ERR-002` |     404     | Not Found — resource with specified ID does not exist             |
| `ERR-003` |     401     | Unauthorized — missing or invalid `DASHBOARD_TOKEN`               |
| `ERR-004` |     500     | Internal Server Error — unexpected database or MCP client error   |

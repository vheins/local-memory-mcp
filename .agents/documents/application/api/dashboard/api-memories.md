# API Specification: Dashboard Memories

## Header & Navigation

- [Dashboard Module Overview](../../modules/dashboard/overview.md)
- [Dashboard UI Feature](../../modules/dashboard/dashboard-ui.md)
- [System API](api-system.md)
- [Dashboard Tests](../../testing/dashboard/test-dashboard.md)

This document outlines the REST interfaces for interacting with the semantic memory store through the dashboard backend.

## 1. Collection Management

### 1.1 `GET /api/memories`

Retrieves a paginated list of memories with advanced filtering and sorting.

**Query Parameters**

| Parameter       | Type   | Required | Default      | Description                                      |
| :-------------- | :----- | :------- | :----------- | :----------------------------------------------- |
| `repo`          | string | Yes      | -            | Target repository name.                          |
| `type`          | enum   | No       | -            | Memory category (e.g., `decision`, `code_fact`). |
| `search`        | string | No       | -            | Full-text search string.                         |
| `minImportance` | number | No       | -            | Minimum importance score (1-5).                  |
| `maxImportance` | number | No       | -            | Maximum importance score (1-5).                  |
| `sortBy`        | string | No       | `created_at` | Field to sort by (e.g., `importance`).           |
| `sortOrder`     | enum   | No       | `desc`       | `asc` or `desc`.                                 |
| `page`          | number | No       | `1`          | Current page number.                             |
| `pageSize`      | number | No       | `25`         | Items per page (max 100).                        |

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": [
		{
			"type": "memory",
			"id": "uuid-123",
			"attributes": {
				"type": "decision",
				"title": "Architecture Baseline",
				"content": "Using SQLite for local persistence...",
				"importance": 4,
				"hit_count": 5,
				"recall_count": 2,
				"recall_rate": 0.4,
				"created_at": "2024-01-01T10:00:00Z",
				"updated_at": "2024-01-01T10:00:00Z"
			}
		}
	],
	"meta": {
		"page": 1,
		"pageSize": 25,
		"totalItems": 42,
		"totalPages": 2
	}
}
```

### 1.2 `POST /api/memories`

Creates one or more memory records. Supports single object or bulk import.

**Request Body (Single)**

```json
{
	"data": {
		"type": "memory",
		"attributes": {
			"repo": "my-project",
			"type": "code_fact",
			"title": "Auth Helper",
			"content": "Use the validateToken function for JWTs.",
			"importance": 3
		}
	}
}
```

**Request Body (Bulk)**

```json
{
	"data": {
		"type": "bulk-import",
		"attributes": {
			"repo": "my-project",
			"items": [
				{ "type": "decision", "title": "Decision 1", "content": "..." },
				{ "type": "mistake", "title": "Mistake 1", "content": "..." }
			]
		}
	}
}
```

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": {
		"type": "status",
		"id": "system",
		"attributes": { "count": 1 }
	}
}
```

### 1.3 `PATCH /api/memories`

Updates one or more memory records.

**URL Pattern**: `/api/memories` (for bulk) or `/api/memories/:id` (for single).

**Request Body (Bulk)**

```json
{
	"data": {
		"type": "bulk-update",
		"attributes": {
			"ids": ["uuid-1", "uuid-2"],
			"importance": 5,
			"is_global": true
		}
	}
}
```

### 1.4 `DELETE /api/memories/:id`

Soft-deletes a single memory record from the database.

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": {
		"type": "status",
		"id": "system",
		"attributes": { "message": "Deleted" }
	}
}
```

## 2. Bulk Operations

### 2.1 `POST /api/memories/delete`

Deletes multiple memories identified by their IDs.

**Request Body**

```json
{
	"data": {
		"attributes": { "ids": ["uuid-1", "uuid-2"] }
	}
}
```

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": {
		"type": "status",
		"id": "system",
		"attributes": { "deletedCount": 2 }
	}
}
```

## 3. Resource Operations

### 3.1 `GET /api/memories/:id`

Fetch a single memory entry with detailed statistics including hit_count, recall_count, and recall_rate.

**Response**

```json
{
	"jsonapi": { "version": "1.1" },
	"data": {
		"type": "memory",
		"id": "uuid-123",
		"attributes": {
			"type": "decision",
			"title": "...",
			"content": "...",
			"importance": 5,
			"hit_count": 10,
			"recall_count": 5,
			"recall_rate": 0.5,
			"created_at": "..."
		}
	}
}
```

## 4. Error Codes

| Code      | HTTP Status | Description                                                       |
| :-------- | :---------: | :---------------------------------------------------------------- |
| `ERR-001` |     400     | Validation Error — request body failed JSON:API schema validation |
| `ERR-002` |     404     | Not Found — memory with specified ID does not exist               |
| `ERR-003` |     409     | Conflict — memory with similar content already exists             |
| `ERR-004` |     500     | Internal Server Error — unexpected database or embedding error    |

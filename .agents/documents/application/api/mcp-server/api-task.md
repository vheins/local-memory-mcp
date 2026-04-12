# API Specification: Task Management

This document outlines the MCP Tool interfaces for Task management. Responses comply with the [MCP 2025-11-25 Structured Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) specification.

## 1. Endpoints (Tools)

### 1.1 `task-create`
- **Method:** `tools/call`
- **Arguments:**
  - `repo` (string, required)
  - `task_code`, `phase`, `title`, `description` (Required for single task)
  - `status` (enum: `backlog`, `pending`, optional)
  - `priority` (number, optional)
  - `tasks` (array of objects, optional): Bulk creation support.
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Created task [TASK-001] Fix Auth Flow in repo \"my-repo\". See structuredContent.id." }
    ],
    "isError": false,
    "structuredContent": {
      "success": true,
      "id": "uuid-v4-string",
      "repo": "my-repo",
      "task_code": "TASK-001",
      "title": "Fix Auth Flow",
      "status": "pending",
      "createdCount": 1
    }
  }
  ```

### 1.2 `task-update`
- **Method:** `tools/call`
- **Arguments:**
  - `repo` (string, required)
  - `id` (UUID, optional)
  - `ids` (array of UUIDs, optional)
  - `status`, `comment`, `est_tokens`, `force` (optional)
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Updated task(s) in repo \"my-repo\". See structuredContent." }
    ],
    "isError": false,
    "structuredContent": {
      "success": true,
      "id": "uuid-1",
      "repo": "my-repo",
      "status": "completed",
      "archivedToMemory": true,
      "updatedCount": 1,
      "updatedFields": ["status", "comment"]
    }
  }
  ```

### 1.3 `task-delete`
- **Method:** `tools/call`
- **Arguments:**
  - `repo` (string, required)
  - `id` (UUID, optional)
  - `ids` (array of UUIDs, optional)
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Deleted 3 task(s) from repo \"my-repo\"." }
    ],
    "isError": false,
    "structuredContent": {
      "success": true,
      "repo": "my-repo",
      "deletedCount": 3,
      "ids": ["uuid-1", "uuid-2", "uuid-3"]
    }
  }
  ```

### 1.4 `task-list`
- **Method:** `tools/call`
- **Arguments:**
  - `repo` (string, required)
  - `status`, `phase`, `query`, `limit`, `offset` (optional)
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Found 5 active tasks in repo \"my-repo\". See structuredContent.tasks." },
      { "type": "text", "text": "[JSON string of tasks...]", "annotations": { "audience": ["assistant"], "priority": 0.2 } }
    ],
    "isError": false,
    "structuredContent": {
      "schema": "task-list",
      "tasks": {
        "columns": ["id", "task_code", "title", "status", "priority", "comments_count"],
        "rows": [["uuid", "TASK-001", "Fix Auth", "in_progress", 3, 2]]
      },
      "count": 5,
      "offset": 0
    }
  }
  ```

### 1.5 `task-detail`
- **Method:** `tools/call`
- **Arguments:**
  - `repo` (string, required)
  - `id` (UUID, optional)
  - `task_code` (string, optional)
- **Response:** 
  - `content`: Text summary and resource link.
  - `structuredContent`: Full task object with comments.

### 1.6 `task-create-interactive`
- **Method:** `tools/call`
- **Description:** Triggers elicitation for missing fields.
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Interactively created task. See structuredContent." }
    ],
    "isError": false,
    "structuredContent": { "success": true, "id": "uuid", "repo": "..." }
  }
  ```

## 2. Resources (URIs)

### `repository://{name}/tasks`
- **Visibility:** Paginated list of tasks for a repository.
- **Auto-Update:** Supports `resources/subscribe`.

### `task://{id}`
- Detailed view of a specific task record including comments.

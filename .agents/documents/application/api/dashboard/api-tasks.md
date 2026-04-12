# API Specification: Dashboard Tasks

This document describes the task management and Kanban synchronization interfaces for the dashboard.

## 1. Task Lifecycle

### 1.1 `GET /api/tasks`
Lists tasks for a specific repository with optional status filtering.

**Query Parameters**
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `repo` | string | Yes | - | Repository scope. |
| `status` | string | No | - | Single status OR comma-separated statuses (e.g., `in_progress,completed`). |
| `search` | string | No | - | Search tasks by title or task code. |
| `page` | number | No | `1` | Current page number. |
| `pageSize` | number | No | `20` | Items per page (max 100). |

**Response**
```json
{
  "jsonapi": { "version": "1.1" },
  "data": [
    {
      "type": "task",
      "id": "uuid-123",
      "attributes": {
        "task_code": "TASK-001",
        "title": "Fix Auth Flow",
        "status": "in_progress",
        "repo": "my-project"
      }
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "totalItems": 5 }
}
```

### 1.2 `POST /api/tasks`
Adds one or more tasks to the repository's kanban. Supports single task or bulk import.

**Request Body (Single)**
```json
{
  "data": {
    "type": "task",
    "attributes": {
      "repo": "my-project",
      "task_code": "UI-001",
      "title": "Design Sidebar",
      "description": "Create a responsive sidebar component."
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
        { "task_code": "T1", "title": "...", "description": "..." },
        { "task_code": "T2", "title": "...", "description": "..." }
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

### 1.3 `PATCH /api/tasks`
Updates one or more tasks.

**URL Pattern**: `/api/tasks` (for bulk) or `/api/tasks/:id` (for single).

**Special Logic**: 
- If `status` changes and a `comment` is provided, it is used for the audit trail.
- If `status` changes via UI drag-and-drop (where `comment` is omitted), an automatic comment is generated (e.g., "Status updated via dashboard").
- For all other manual or programmatic updates, a `comment` SHOULD be provided to ensure traceability.

**Request Body (Bulk)**
```json
{
  "data": {
    "type": "bulk-update",
    "attributes": {
      "ids": ["uuid-1", "uuid-2"],
      "status": "completed",
      "comment": "Completed all verified tests.",
      "force": true
    }
  }
}
```

**Request Body (Single - via `:id`)**
```json
{
  "data": {
    "type": "task",
    "id": "uuid-123",
    "attributes": {
      "status": "completed",
      "comment": "Implementation verified and merged.",
      "est_tokens": 1200
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
    "attributes": { "message": "Updated", "count": 1 }
  }
}
```

### 1.4 `DELETE /api/tasks/:id`
Hard deletes a single task and all its associated comments.

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

---

## 2. Bulk Operations

### 2.1 `POST /api/tasks/delete`
Deletes multiple tasks by their IDs.

**Request Body**
```json
{
  "data": {
    "attributes": {
      "ids": ["uuid-1", "uuid-2"]
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
    "attributes": { "deletedCount": 2 }
  }
}
```

---

## 3. Relationships: Comments

### 3.1 `GET /api/tasks/:taskId/comments`
Retrieves all comments associated with a specific task.

### 3.2 `POST /api/tasks/:taskId/comments`
Adds a new manual comment to a task.

**Request Body**
```json
{
  "data": {
    "type": "task-comment",
    "attributes": {
      "comment": "New progress update."
    }
  }
}
```

### 3.3 `PATCH /api/tasks/:taskId/comments/:id`
Edits an existing comment entry.

**Request Body**
```json
{
  "data": {
    "type": "task-comment",
    "id": "uuid-comment",
    "attributes": {
      "comment": "Revised progress update."
    }
  }
}
```

**Response**
```json
{
  "jsonapi": { "version": "1.1" },
  "data": {
    "type": "task-comment",
    "id": "uuid-comment",
    "attributes": { "comment": "Revised progress update." }
  }
}
```

### 3.4 `DELETE /api/tasks/:taskId/comments/:id`
Deletes a specific comment from the task's history.

---

## 4. Analytics

### 4.1 `GET /api/tasks/stats/time`
Returns performance metrics for task completion across different time intervals.

**Query Parameters**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `repo` | string | Yes | Repository scope. |

**Response**
```json
{
  "jsonapi": { "version": "1.1" },
  "data": {
    "type": "performance-stats",
    "id": "system",
    "attributes": {
      "daily": { "avg": 120, "history": [] },
      "weekly": { "avg": 850, "history": [] },
      "monthly": { "avg": 3400, "history": [] },
      "overall": { "avg": 5000, "history": [] }
    }
  }
}
```

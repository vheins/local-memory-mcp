# API Specification: Dashboard Tasks

This document describes the task management and Kanban synchronization interfaces for the dashboard.

## 1. Task Lifecycle

### 1.1 `GET /api/tasks`
Lists tasks for a specific repository with optional status filtering.
- **Query Parameters**:
  - `repo` (string, required): Repository scope.
  - `status` (string, optional): A single status OR a comma-separated list of statuses (e.g., `in_progress,completed`).
  - `search` (string, optional): Search tasks by title or task code.
  - `page` (number, default: 1): Current page.
  - `pageSize` (number, default: 20): Items per page (max 100).
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": [
      {
        "type": "task",
        "id": "uuid-123",
        "attributes": {
          "task_code": "TASK-001",
          "title": "...",
          "status": "in_progress",
          "repo": "..."
        }
      }
    ],
    "meta": { "page": 1, "pageSize": 20 }
  }
  ```

### 1.2 `POST /api/tasks`
Adds a new task to the repository's kanban. 
- **Request Body**:
  - `repo` (string, required)
  - `task_code` (string, required): Unique identifier (e.g. `DOCS-001`).
  - `title` (string, required): Task headline.
  - `description` (string, optional): Detailed task text.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "task",
      "id": "uuid-999",
      "attributes": {}
    }
  }
  ```

### 1.3 `PUT /api/tasks/:id`
Updates task attributes or changes status. 
- **Special Logic**: If `status` changes, an automatic task comment is inserted into the audit trail.
- **Request Body**:
  - `status` (enum, optional): New status string.
  - `comment` (string, optional): Context for the status change or general note.
  - `est_tokens` (number, optional): Token usage report for completion.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "status",
      "id": "system",
      "attributes": { "message": "Updated" }
    }
  }
  ```

### 1.4 `DELETE /api/tasks/:id`
Hard deletes a task and all its associated comments.
- **Response**:
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

## 2. Comments & Activity

### 2.1 `PUT /api/task-comments/:id`
Edits an existing comment entry.
- **Request Body**:
  - `comment` (string, required): The updated text.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "status",
      "id": "system",
      "attributes": { "message": "Updated" }
    }
  }
  ```

### 2.2 `DELETE /api/task-comments/:id`
Deletes a specific comment from the task's history.
- **Response**:
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

## 3. Analytics & Bulk

### 3.1 `GET /api/tasks/stats/time`
Returns performance metrics for task completion across different time intervals.
- **Query Parameters**:
  - `repo` (string, required)
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "performance-stats",
      "id": "system",
      "attributes": {
        "daily": { "avg": 0, "history": [] },
        "weekly": { "avg": 0, "history": [] },
        "monthly": { "avg": 0, "history": [] },
        "overall": { "avg": 0, "history": [] }
      }
    }
  }
  ```

### 3.2 `POST /api/tasks/bulk-import`
Imports a list of task objects into a repository.
- **Request Body**:
  - `repo` (string, required)
  - `items` (array, required): Task objects.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "status",
      "id": "system",
      "attributes": { "count": 10 }
    }
  }
  ```

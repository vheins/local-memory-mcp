# API Specification: Task Management (MCP Tools & Resources)

## 1. Endpoints (Tools)

### 1.1 `task.create`
- **Arguments:**
  - `task_code` (string, required, unique)
  - `title` (string, required)
  - `description` (string, required)
  - `phase` (string, required)
  - `status` (enum: backlog, pending, required)
  - `priority` (number, optional)
- **Response:**
  ```json
  { "structuredData": { "id": "uuid", "task_code": "TASK-001" } }
  ```

### 1.2 `task.manage` (Update)
- **Status Lifecycle:** `backlog`, `pending`, `in_progress`, `completed`, `canceled`, `blocked`.
- **Logic Rules:**
  - `completed` requires `est_tokens`.
  - Transitions from `pending` -> `completed` are **FORBIDDEN**. Must go through `in_progress`.
  - Transitions require a `comment`.

### 1.3 `task.active`
- **Method:** `tools/call`
- **Arguments:**
  - `repo` (string, required)
- **Response:** Returns the current `in_progress` tasks for the repository.

### 1.4 `task.list` / `task.search`
- **Arguments:**
  - `repo` (string, required)
  - `status` (string, comma-separated enums, optional)
  - `query` (string, search only)

### 1.5 `task.bulk-manage`
- **Arguments:**
  - `action` (enum: bulk_create, bulk_delete, bulk_update)
  - `tasks` | `ids` | `updates` (dependent on action)

## 2. Resources

### `tasks://current?repo={repo}`
- **Visibility:** Exposes the status and details of active (`in_progress`, `pending`, `blocked`) tasks.
- **Auto-Update:** Supports `resources/subscribe`. Clients are notified on every status transition in the repo.

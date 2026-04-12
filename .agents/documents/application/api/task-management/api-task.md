# API Specification: Task Management (MCP Tools & Resources)

## 1. Endpoints (Tools)

### 1.1 `task-create`
- **Method:** `tools/call`
- **Validation Table:**
  - `title` (string, required)
  - `description` (string, required)
  - `status` (string, enum: pending, active, completed, failed, archived, optional - default: pending)
  - `repo` (string, optional)
- **JSON Example:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-create",
      "arguments": { "title": "Setup CI", "description": "Configure GitHub Actions" }
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Missing title or description.

### 1.2 `task-create-interactive`
- **Method:** `tools/call`
- **Validation Table:**
  - No required inputs upfront (elicited via client).
- **Error Dictionary:**
  - `-32603`: Client lacks `elicitation` capability.

### 1.3 `task-update`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
  - `title` (string, optional)
  - `status` (string, optional)
- **Error Dictionary:**
  - `-32602`: Invalid ID or unknown status.

### 1.4 `task-active`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Error Dictionary:**
  - `-32602`: Invalid UUID or ID not found.

### 1.5 `task-list`
- **Method:** `tools/call`
- **Validation Table:**
  - `repo` (string, optional)
- **Error Dictionary:**
  - `-32602`: Malformed parameters.

### 1.6 `task-search`
- **Method:** `tools/call`
- **Validation Table:**
  - `query` (string, required)
  - `repo` (string, optional)
- **Error Dictionary:**
  - `-32602`: Missing query.

### 1.7 `task-detail`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Error Dictionary:**
  - `-32602`: Invalid UUID or ID not found.

### 1.8 `task-delete`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Error Dictionary:**
  - `-32602`: Invalid UUID or ID not found.

### 1.9 `task-bulk-manage`
- **Method:** `tools/call`
- **Validation Table:**
  - `operations` (array of operation objects: create/update/delete, required)
- **Error Dictionary:**
  - `-32602`: Missing operations or malformed operation items.

## 2. Resources

### `tasks://current?repo={repo}`
- **Protocol Method:** `resources/read`
- **Response Format:** JSON representing the currently active task.
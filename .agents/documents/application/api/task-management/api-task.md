# API Specification: Task Management (MCP Tools & Resources)

## 1. Tools

### `task-create`
- **Method:** `tools/call`
- **Validation Table:**
  - `title` (string, required)
  - `description` (string, required)
  - `status` (string, required)
- **JSON Example:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-create",
      "arguments": { "title": "Setup CI", "description": "Configure GitHub Actions", "status": "pending" }
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Missing title or description.

### `task-active`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string, required) - Must be a valid UUID.
- **JSON Example:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-active",
      "arguments": { "id": "123e4567-e89b-12d3-a456-426614174000" }
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Task ID not found or malformed UUID.

## 2. Resources

### `tasks://current?repo={repo}`
- **Protocol Method:** `resources/read`
- **Returns:**
  ```json
  {
    "id": "123e...",
    "title": "Setup CI",
    "description": "Configure GitHub Actions",
    "status": "active"
  }
  ```
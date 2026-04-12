# API Specification: Task Management (MCP Tools & Resources)

## 1. Endpoints (Tools)

### 1.1 `task-create`
- **Method:** `tools/call`
- **Validation Table:**
  - `title` (string, required)
  - `description` (string, required)
  - `status` (string, enum: pending, active, completed, failed, archived, optional - default: pending)
  - `repo` (string, optional)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-create",
      "arguments": { 
        "title": "Setup CI", 
        "description": "Configure GitHub Actions for automated testing.",
        "status": "pending",
        "repo": "vheins/local-memory-mcp"
      }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Task created successfully."
      }
    ],
    "structuredData": {
      "id": "task-1234-abcd"
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Missing title or description.

### 1.2 `task-create-interactive`
- **Method:** `tools/call`
- **Validation Table:**
  - No required inputs upfront (elicited via client).
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-create-interactive",
      "arguments": {}
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Interactive task created after user input."
      }
    ],
    "structuredData": {
      "id": "task-5678-efgh"
    }
  }
  ```
- **Error Dictionary:**
  - `-32603`: Client lacks `elicitation` capability.

### 1.3 `task-update`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
  - `title` (string, optional)
  - `status` (string, optional)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-update",
      "arguments": {
        "id": "task-1234-abcd",
        "status": "completed"
      }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Task updated to 'completed'."
      }
    ],
    "structuredData": {
      "id": "task-1234-abcd",
      "updated": true
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Invalid ID or unknown status.

### 1.4 `task-active`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-active",
      "arguments": {
        "id": "task-1234-abcd" 
      }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Task set as active."
      }
    ],
    "structuredData": {
      "success": true
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Invalid UUID or ID not found.

### 1.5 `task-list`
- **Method:** `tools/call`
- **Validation Table:**
  - `repo` (string, optional)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-list",
      "arguments": {
        "repo": "vheins/local-memory-mcp"
      }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Found 2 active/pending tasks."
      }
    ],
    "structuredData": {
      "results": [
        { "id": "task-1234-abcd", "title": "Setup CI", "status": "completed" },
        { "id": "task-5678-efgh", "title": "Setup Docker", "status": "pending" }
      ]
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Malformed parameters.

### 1.6 `task-search`
- **Method:** `tools/call`
- **Validation Table:**
  - `query` (string, required)
  - `repo` (string, optional)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-search",
      "arguments": {
        "query": "GitHub"
      }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Found 1 matching tasks."
      }
    ],
    "structuredData": {
      "results": [
        { "id": "task-1234-abcd", "title": "Setup CI", "status": "completed" }
      ]
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Missing query.

### 1.7 `task-detail`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-detail",
      "arguments": {
        "id": "task-1234-abcd"
      }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Task retrieved."
      }
    ],
    "structuredData": {
      "id": "task-1234-abcd",
      "title": "Setup CI",
      "description": "Configure GitHub Actions",
      "status": "completed",
      "created_at": 1713000000
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Invalid UUID or ID not found.

### 1.8 `task-delete`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-delete",
      "arguments": {
        "id": "task-1234-abcd"
      }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Task deleted."
      }
    ],
    "structuredData": {
      "success": true
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Invalid UUID or ID not found.

### 1.9 `task-bulk-manage`
- **Method:** `tools/call`
- **Validation Table:**
  - `operations` (array of operation objects: create/update/delete, required)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "task-bulk-manage",
      "arguments": {
        "operations": [
          { "action": "create", "title": "Write Tests", "description": "Add Vitest specs" },
          { "action": "delete", "id": "task-5678-efgh" }
        ]
      }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Bulk operation complete."
      }
    ],
    "structuredData": {
      "created": ["task-9999-ijkl"],
      "updated": [],
      "deleted": ["task-5678-efgh"]
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Missing operations or malformed operation items.

## 2. Resources

### `tasks://current?repo={repo}`
- **Protocol Method:** `resources/read`
- **Example Request:**
  ```json
  {
    "method": "resources/read",
    "params": { "uri": "tasks://current?repo=vheins/local-memory-mcp" }
  }
  ```
- **Example Response:**
  ```json
  {
    "contents": [
      {
        "uri": "tasks://current?repo=vheins/local-memory-mcp",
        "mimeType": "application/json",
        "text": "{\"id\":\"task-1234-abcd\",\"title\":\"Setup CI\",\"status\":\"active\"}"
      }
    ]
  }
  ```

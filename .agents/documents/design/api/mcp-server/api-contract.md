# API Contracts (MCP Protocol Interface)

Since this is an MCP Server, the "API" is the set of JSON-RPC tools and resources exposed to the client.

## 1. Tools

### `memory-store`
- **Input:**
  ```json
  {
    "type": "object",
    "properties": {
      "type": {"type": "string"},
      "title": {"type": "string"},
      "content": {"type": "string"},
      "importance": {"type": "number"},
      "tags": {"type": "array", "items": {"type": "string"}},
      "repo": {"type": "string"}
    },
    "required": ["type", "title", "content", "importance"]
  }
  ```
- **Output:** `{ id: string }`

### `memory-search`
- **Input:**
  ```json
  {
    "type": "object",
    "properties": {
      "query": {"type": "string"},
      "repo": {"type": "string"},
      "limit": {"type": "number"}
    },
    "required": ["query"]
  }
  ```
- **Output:** Array of Memory objects with a `relevance` score.

### `task-create`
- **Input:**
  ```json
  {
    "type": "object",
    "properties": {
      "title": {"type": "string"},
      "description": {"type": "string"},
      "status": {"type": "string", "enum": ["pending", "active"]},
      "repo": {"type": "string"}
    },
    "required": ["title", "description", "status"]
  }
  ```
- **Output:** `{ id: string }`

### `task-active`
- **Input:** `{ "id": "<UUID>" }`
- **Output:** Success boolean and active status.

## 2. Resources

### `memory://index?repo={repo}`
- **Protocol Method:** `resources/read`
- **Response Format:** JSON serialized list of all active memories for the repository.

### `tasks://current?repo={repo}`
- **Protocol Method:** `resources/read`
- **Response Format:** JSON representation of the currently active task.
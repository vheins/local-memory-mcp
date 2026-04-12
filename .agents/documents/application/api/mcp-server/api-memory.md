# API Specification: Memory (MCP Tools & Resources)

## 1. Endpoints (Tools)

### 1.1 `memory-store`
- **Method:** `tools/call`
- **Validation Table:**
  - `type` (string, enum: doc, decision, rule, summary, required)
  - `title` (string, required)
  - `content` (string, required)
  - `importance` (number 1-5, required)
  - `tags` (array of strings, optional)
  - `repo` (string, optional)
- **JSON Example:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-store",
      "arguments": { "type": "doc", "title": "DB Schema", "content": "Uses SQLite", "importance": 5 }
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Invalid params (Missing title/content).

### 1.2 `memory-search`
- **Method:** `tools/call`
- **Validation Table:**
  - `query` (string, required)
  - `repo` (string, optional)
  - `limit` (number, optional)
- **Error Dictionary:**
  - `-32602`: Missing `query`.

### 1.3 `memory-update`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
  - `content` (string, optional)
  - `title` (string, optional)
  - `importance` (number, optional)
- **Error Dictionary:**
  - `-32602`: Invalid ID format or no update fields provided.

### 1.4 `memory-delete`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Error Dictionary:**
  - `-32602`: Missing `id` or record not found.

### 1.5 `memory-bulk-delete`
- **Method:** `tools/call`
- **Validation Table:**
  - `ids` (array of strings/UUIDs, required)
- **Error Dictionary:**
  - `-32602`: Missing `ids` or array is empty.

### 1.6 `memory-detail`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Error Dictionary:**
  - `-32602`: Missing `id` or record not found.

### 1.7 `memory-acknowledge`
- **Method:** `tools/call`
- **Validation Table:**
  - `memory_id` (string/UUID, required)
  - `status` (string, enum: used, irrelevant, contradictory, required)
- **Error Dictionary:**
  - `-32602`: Invalid status or ID.

### 1.8 `memory-recap`
- **Method:** `tools/call`
- **Validation Table:**
  - `repo` (string, optional)
  - `limit` (number, optional)
- **Error Dictionary:**
  - `-32602`: Invalid limit type.

### 1.9 `memory-summarize`
- **Method:** `tools/call`
- **Validation Table:**
  - `repo` (string, optional)
- **Error Dictionary:**
  - None specific beyond standard validation.

### 1.10 `memory-synthesize`
- **Method:** `tools/call`
- **Validation Table:**
  - `repo` (string, optional)
- **Error Dictionary:**
  - `-32603`: Client does not support the sampling capability.

## 2. Resources

### `memory://index?repo={repo}`
- **Protocol Method:** `resources/read`
- **Response Format:** JSON serialized list of memories.

### `memory://tags/{tag}`
- **Protocol Method:** `resources/read`
- **Response Format:** JSON list.

### `memory://summary/{repo}`
- **Protocol Method:** `resources/read`
- **Response Format:** JSON text block summary.

### `memory://{id}`
- **Protocol Method:** `resources/read`
- **Response Format:** Full detail JSON object of a single memory.
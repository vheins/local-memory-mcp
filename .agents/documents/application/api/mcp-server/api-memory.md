# API Specification: Memory (MCP Tools)

## Endpoints

### 1. `memory-store`
- **Method:** `tools/call`
- **Validation Table:**
  - `title` (string, required)
  - `content` (string, required)
  - `importance` (number 1-5, required)
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

### 2. `memory-search`
- **Method:** `tools/call`
- **Validation Table:**
  - `query` (string, required)
- **JSON Example:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-search",
      "arguments": { "query": "How is database setup?" }
    }
  }
  ```
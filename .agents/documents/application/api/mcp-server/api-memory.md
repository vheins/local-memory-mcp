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
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-store",
      "arguments": {
        "type": "doc",
        "title": "Database Architecture",
        "content": "The application uses SQLite with FTS5 and vector search for memory persistence.",
        "importance": 5,
        "tags": ["architecture", "database"],
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
        "text": "Memory stored successfully."
      }
    ],
    "structuredData": {
      "id": "123e4567-e89b-12d3-a456-426614174000"
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
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-search",
      "arguments": {
        "query": "How is the database setup?",
        "limit": 3
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
        "text": "Found 1 relevant memories."
      }
    ],
    "structuredData": {
      "results": [
        {
          "id": "123e4567-e89b-12d3-a456-426614174000",
          "title": "Database Architecture",
          "content": "The application uses SQLite with FTS5 and vector search for memory persistence.",
          "type": "doc",
          "relevance": 0.89,
          "tags": ["architecture", "database"]
        }
      ]
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Missing `query`.

### 1.3 `memory-update`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
  - `content` (string, optional)
  - `title` (string, optional)
  - `importance` (number, optional)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-update",
      "arguments": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "importance": 4
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
        "text": "Memory updated successfully."
      }
    ],
    "structuredData": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "updated": true
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Invalid ID format or no update fields provided.

### 1.4 `memory-delete`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-delete",
      "arguments": { "id": "123e4567-e89b-12d3-a456-426614174000" }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Memory deleted successfully."
      }
    ],
    "structuredData": {
      "success": true
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Missing `id` or record not found.

### 1.5 `memory-bulk-delete`
- **Method:** `tools/call`
- **Validation Table:**
  - `ids` (array of strings/UUIDs, required)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-bulk-delete",
      "arguments": {
        "ids": [
          "123e4567-e89b-12d3-a456-426614174000",
          "987e6543-e21b-12d3-a456-426614174111"
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
        "text": "Deleted 2 memories."
      }
    ],
    "structuredData": {
      "deletedCount": 2
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Missing `ids` or array is empty.

### 1.6 `memory-detail`
- **Method:** `tools/call`
- **Validation Table:**
  - `id` (string/UUID, required)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-detail",
      "arguments": { "id": "123e4567-e89b-12d3-a456-426614174000" }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Memory retrieved."
      }
    ],
    "structuredData": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "title": "Database Architecture",
      "content": "The application uses SQLite with FTS5 and vector search for memory persistence.",
      "type": "doc",
      "importance": 5,
      "tags": ["architecture", "database"],
      "created_at": 1713000000,
      "usage_stats": {
        "used": 1,
        "irrelevant": 0
      }
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Missing `id` or record not found.

### 1.7 `memory-acknowledge`
- **Method:** `tools/call`
- **Validation Table:**
  - `memory_id` (string/UUID, required)
  - `status` (string, enum: used, irrelevant, contradictory, required)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-acknowledge",
      "arguments": { "memory_id": "123e4567-e89b-12d3-a456-426614174000", "status": "used" }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Telemetry logged."
      }
    ],
    "structuredData": {
      "success": true
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Invalid status or ID.

### 1.8 `memory-recap`
- **Method:** `tools/call`
- **Validation Table:**
  - `repo` (string, optional)
  - `limit` (number, optional)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-recap",
      "arguments": { "limit": 2 }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Here are the most recent 2 memories..."
      }
    ],
    "structuredData": {
      "results": [
         { "id": "...", "title": "...", "content": "..." },
         { "id": "...", "title": "...", "content": "..." }
      ]
    }
  }
  ```
- **Error Dictionary:**
  - `-32602`: Invalid limit type.

### 1.9 `memory-summarize`
- **Method:** `tools/call`
- **Validation Table:**
  - `repo` (string, optional)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-summarize",
      "arguments": { "repo": "vheins/local-memory-mcp" }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "The repository focuses on an MCP server storing local memories using SQLite..."
      }
    ]
  }
  ```

### 1.10 `memory-synthesize`
- **Method:** `tools/call`
- **Validation Table:**
  - `repo` (string, optional)
- **Example Request:**
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "memory-synthesize",
      "arguments": { "repo": "vheins/local-memory-mcp" }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Synthesis completed using client sampling. New summary memory stored with ID 555e4567-e89b-12d3-a456-426614174555."
      }
    ],
    "structuredData": {
      "id": "555e4567-e89b-12d3-a456-426614174555"
    }
  }
  ```
- **Error Dictionary:**
  - `-32603`: Client does not support the sampling capability.

## 2. Resources (Application Control)

The server implements the Model Context Protocol `resources` feature to expose memory context directly to the client.

### Supported Protocol Methods

#### `resources/list`
Discovers available static resources.
- **Example Request:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "resources/list"
  }
  ```
- **Example Response:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "resources": [
        {
          "uri": "memory://index",
          "name": "Active Memory Index",
          "title": "Active Memory Index",
          "description": "List of all active memory entries across projects",
          "mimeType": "application/json",
          "annotations": {
            "audience": ["assistant"],
            "priority": 0.85
          }
        },
        {
          "uri": "session://roots",
          "name": "Session Roots",
          "title": "Session Roots",
          "description": "Active workspace roots provided by the MCP client",
          "mimeType": "application/json"
        }
      ]
    }
  }
  ```

#### `resources/templates/list`
Discovers parameterized resource templates.
- **Example Request:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 2,
    "method": "resources/templates/list"
  }
  ```
- **Example Response:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 2,
    "result": {
      "resourceTemplates": [
        {
          "uriTemplate": "memory://index?repo={repo}",
          "name": "Project Memory Index",
          "title": "Project Memory Index",
          "description": "Metadata for all active memories in a specific project",
          "mimeType": "application/json"
        },
        {
          "uriTemplate": "memory://tags/{tag}",
          "name": "Memories by Tech Stack",
          "title": "Memories by Tech Stack",
          "description": "Retrieve best practices and decisions by technology tag",
          "mimeType": "application/json"
        },
        {
          "uriTemplate": "memory://summary/{repo}",
          "name": "Project Summary",
          "title": "Project Summary",
          "description": "High-level summary of architectural decisions for a repository",
          "mimeType": "text/plain"
        },
        {
          "uriTemplate": "memory://search/{base64_query}?repo={repo}",
          "name": "Semantic Memory Search",
          "title": "Semantic Memory Search",
          "description": "Run a semantic search over memories using a base64-encoded query",
          "mimeType": "application/json"
        }
      ]
    }
  }
  ```

#### `resources/read`
Reads the contents of a resolved resource URI.
- **Example Request:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 3,
    "method": "resources/read",
    "params": {
      "uri": "memory://index?repo=vheins/local-memory-mcp"
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 3,
    "result": {
      "contents": [
        {
          "uri": "memory://index?repo=vheins/local-memory-mcp",
          "mimeType": "application/json",
          "text": "[\n  {\n    \"id\": \"123e4567...\",\n    \"title\": \"DB Schema\"\n  }\n]"
        }
      ]
    }
  }
  ```

#### `resources/subscribe` & `resources/unsubscribe`
Allows the client to be notified (via `notifications/resources/updated`) when a resource changes.
- **Example Request:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 4,
    "method": "resources/subscribe",
    "params": {
      "uri": "memory://index?repo=vheins/local-memory-mcp"
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 4,
    "result": {}
  }
  ```

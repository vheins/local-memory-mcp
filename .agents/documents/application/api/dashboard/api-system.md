# API Specification: Dashboard System & Utilities

This document describes technical and administrative endpoints for monitoring the local memory system and interacting with MCP capabilities.

## 1. Monitoring & Stats

### 1.1 `GET /api/health`
Returns the operational health and environment configuration of the dashboard server.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "health",
      "id": "system",
      "attributes": {
        "connected": true,
        "uptime": 12345,
        "version": "1.0.0",
        "memoryCount": 250,
        "pendingRequests": 0,
        "dbPath": "/absolute/path/to/sqlite.db"
      }
    }
  }
  ```

### 1.2 `GET /api/stats`
Retrieves a high-level data summary for a specific repository or the entire system.
- **Query Parameters**:
  - `repo` (string, optional): Filter statistics by repository name.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "repository-stats",
      "id": "system",
      "attributes": {
        "totalMemories": 250,
        "activeTasks": 12,
        "completedTasks": 85,
        "totalActivity": 1500
      }
    }
  }
  ```

### 1.3 `GET /api/recent-actions`
Retrieves a historical timeline of interactions (memory reads/writes, task updates, tool calls).
- **Query Parameters**:
  - `repo` (string, optional)
  - `page` (number, default: 1)
  - `pageSize` (number, default: 10, max: 50)
- **Special Logic**: Identical actions within a 10-minute window are "burst-condensed" into a single list item.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": [
      {
        "type": "recent-action",
        "id": "1",
        "attributes": {
          "action": "write",
          "memory_title": "...",
          "burstCount": 3,
          "created_at": "..."
        }
      }
    ],
    "meta": { "page": 1, "pageSize": 10, "totalItems": 150 }
  }
  ```

## 2. Infrastructure

### 2.1 `GET /api/repos`
Lists all unique repository names found in the memory database. 
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": [
      {
        "type": "repository",
        "id": "project-name",
        "attributes": { "name": "project-name" }
      }
    ]
  }
  ```

### 2.2 `GET /api/capabilities`
Aggregates and returns all registered MCP tools, resources, and prompt templates.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "capability",
      "id": "system",
      "attributes": {
        "tools": [ { "name": "...", "description": "...", "inputSchema": {} } ],
        "resources": [ { "uri": "...", "name": "..." } ],
        "prompts": [ { "name": "...", "arguments": [] } ]
      }
    }
  }
  ```

### 2.3 `GET /api/export`
Provides a complete data dump of a repository, including memories and tasks with embedded audit trails.
- **Query Parameters**:
  - `repo` (string, required)
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
        "type": "export",
        "id": "system",
        "attributes": {
            "repo": "...",
            "exported_at": "...",
            "memories": [],
            "tasks": [
                { "id": "...", "comments": [] }
            ]
        }
    }
  }
  ```

## 3. MCP Operations

### 3.1 `POST /api/tools/:name/call`
Synchronously executes an internal MCP tool and returns the JSON-RPC result.
- **Path Parameters**:
  - `name` (string, required): The tool identifier.
- **Request Body**: JSON mapping to the tool's defined `inputSchema`.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "tool-result",
      "id": "system",
      "attributes": {
        "content": [ { "type": "text", "text": "Execution result..." } ],
        "isError": false
      }
    }
  }
  ```

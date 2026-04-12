# API Specification: Knowledge Management (Memory)

This document outlines the MCP Tool interfaces. All responses comply with the [MCP 2025-11-25 Structured Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) specification, providing a `content` array for the LLM and a `structuredContent` object for machine-readable integration.

## 1. Endpoints (Tools)

### 1.1 `memory-store`
- **Method:** `tools/call`
- **Special Logic: Collision Detection**: Before storing, the system performs a semantic search. If a memory with similarity **> 0.55** already exists in the repo, the operation may flag a conflict or return the existing ID to prevent redundancy.
- **Arguments:**
  - `type` (enum: `code_fact`, `decision`, `mistake`, `pattern`, `agent_handoff`, `agent_registered`, `file_claim`, `task_archive`)
  - `title` (string, required)
  - `content` (string, required)
  - `importance` (number 1-5, required)
  - `agent` (string, required)
  - `role` (string, optional)
  - `model` (string, required)
  - `scope` (object { repo: string, branch?: string, folder?: string, language?: string }, required)
  - `tags` (array of strings, optional)
  - `metadata` (object, optional)
  - `is_global` (boolean, optional)
  - `ttlDays` (number, optional)
  - `supersedes` (UUID, optional)
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Stored memory [code_fact] Auth Helper in repo \"my-repo\". See structuredContent.id." }
    ],
    "isError": false,
    "structuredContent": {
      "success": true,
      "id": "uuid-v4-string",
      "repo": "my-repo",
      "type": "code_fact",
      "title": "Auth Helper",
      "message": "Memory stored successfully."
    }
  }
  ```

### 1.2 `memory-search`
- **Method:** `tools/call`
- **Arguments:**
  - `query` (string, required)
  - `repo` (string, required)
  - `types` (array of enums, optional)
  - `minImportance` (number, optional)
  - `limit` (number, default: 5)
  - `offset` (number, default: 0)
  - `current_file_path` (string, optional)
  - `include_archived` (boolean, optional)
  - `includeRecap` (boolean, optional)
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Found 2 matching memories in repo \"my-repo\". See structuredContent.results." },
      { "type": "text", "text": "[JSON string of results...]", "annotations": { "audience": ["assistant"], "priority": 0.2 } }
    ],
    "isError": false,
    "structuredContent": {
      "schema": "memory-search",
      "query": "synthesis",
      "count": 2,
      "total": 2,
      "offset": 0,
      "limit": 5,
      "results": {
        "columns": ["id", "title", "type", "importance"],
        "rows": [
          ["uuid-1", "Baseline Architecture", "decision", 5],
          ["uuid-2", "Storage Strategy", "decision", 4]
        ]
      }
    }
  }
  ```

### 1.3 `memory-synthesize`
- **Method:** `tools/call`
- **Arguments:**
  - `objective` (string, required)
  - `repo` (string, optional)
  - `current_file_path` (string, optional)
  - `include_summary` (boolean, default: true)
  - `include_tasks` (boolean, default: true)
  - `use_tools` (boolean, default: true)
  - `max_iterations` (number, default: 3)
  - `max_tokens` (number, default: 1200)
- **Response:**
  ```json
  {
    "structuredData": {
      "repo": "my-repo",
      "objective": "Summarize auth flow",
      "answer": "The authentication flow uses JWT with validToken helper...",
      "model": "claude-3-5-sonnet",
      "stopReason": "endTurn",
      "iterations": 2,
      "toolCalls": 3
    }
  }
  ```

### 1.4 `memory-acknowledge`
- **Method:** `tools/call`
- **Arguments:**
  - `memory_id` (UUID, required)
  - `status` (enum: `used`, `irrelevant`, `contradictory`)
  - `application_context` (string, optional)
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Acknowledged memory uuid as used." }
    ],
    "isError": false,
    "structuredContent": {
      "success": true,
      "id": "uuid",
      "status": "used"
    }
  }
  ```

### 1.5 `memory-detail`
- **Method:** `tools/call`
- **Arguments:**
  - `id` (UUID, required)
- **Response:** 
  - `content`: Text summary and serialized JSON.
  - `structuredContent`: Full memory object including **Usage Statistics**:
    - `hit_count`: Total times this memory was retrieved.
    - `recall_count`: Total times an agent explicitly acknowledged using this memory.
    - `recall_rate`: The ratio of `recall_count / hit_count`, representing the memory's practical utility.
    - `last_used_at`: Timestamp of the most recent retrieval or acknowledgment.

### 1.6 `memory-update`
- **Method:** `tools/call`
- **Arguments:**
  - `id` (UUID, required)
  - `title`, `content`, `importance`, `status`, `metadata`, etc. (optional)
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Updated memory uuid fields: title, content. See structuredContent." }
    ],
    "isError": false,
    "structuredContent": {
      "success": true,
      "id": "uuid",
      "repo": "my-repo",
      "updatedFields": ["title", "content"]
    }
  }
  ```

### 1.7 `memory-delete`
- **Method:** `tools/call`
- **Arguments:**
  - `id` (UUID, optional)
  - `ids` (array of UUIDs, optional)
  - `repo` (string, optional)
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Deleted 2 memory entry(ies) from repo \"my-repo\"." }
    ],
    "isError": false,
    "structuredContent": {
      "success": true,
      "repo": "my-repo",
      "deletedCount": 2,
      "ids": ["uuid-1", "uuid-2"]
    }
  }
  ```

### 1.8 `memory-recap`
- **Method:** `tools/call`
- **Arguments:**
  - `repo` (string, required)
  - `limit` (number, default: 20)
- **Response:**
  ```json
  {
    "content": [
      { "type": "text", "text": "Recap for repo \"my-repo\": 10 active memories. See structuredContent.top." }
    ],
    "isError": false,
    "structuredContent": {
      "schema": "memory-recap",
      "repo": "my-repo",
      "count": 10,
      "total": 10,
      "stats": { "by_type": { "decision": 2, "code_fact": 8 } },
      "top": {
        "columns": ["id", "title", "type", "importance"],
        "rows": [["uuid", "Title", "type", 5]]
      }
    }
  }
  ```

## 2. Resources (URIs)

### `repository://index`
- List of all known repositories with metadata.

### `repository://{name}/memories`
- Paginated list of memories for a specific repository.

### `memory://{id}`
- Detailed view of a specific memory record.

### `repository://{name}/summary`
- High-level architectural summary generated via `memory-summarize`.

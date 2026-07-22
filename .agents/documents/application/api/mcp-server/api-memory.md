# API Specification: Knowledge Management (Memory)

## Header & Navigation

- [MCP Server Module Overview](../../modules/mcp-server/overview.md)
- [Memory Feature](../../modules/mcp-server/memory.md)
- [Memory Tests](../../testing/mcp-server/test-memory.md)

This document outlines the MCP Tool interfaces for memory management. All responses comply with the [MCP 2025-11-25 Structured Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) specification, providing a `content` array for the LLM and a `structuredContent` object for machine-readable integration.

## 1. Memory Tools

### 1.1 `memory-store`

- **Method:** `tools/call`
- **Description:** Store a new durable knowledge entry. Do not store coordination state here (task claims, handoffs). Keep `title` concise; put auxiliary context into `metadata`.
- **Special Logic:**
  - **Collision Detection**: Before storing, performs semantic search. If similarity > 0.55 exists, flags a potential conflict.
  - **Supersedes**: If `supersedes` parameter is provided, the old memory is archived.
  - **Scoping**: `owner` and `repo` are auto-injected from session context (roots).
- **Arguments:**
  - `type` (enum: `code_fact`, `decision`, `mistake`, `pattern`, `task_archive`, required)
  - `title` (string, 3-255 chars, required)
  - `content` (string, min 10 chars, required)
  - `importance` (number 1-5, required)
  - `agent` (string, required)
  - `model` (string, required)
  - `role` (string, optional)
  - `tags` (array of strings, optional)
  - `metadata` (object, optional)
  - `is_global` (boolean, optional)
  - `ttlDays` (number, optional)
  - `supersedes` (UUID, optional)
  - `scope` (object `{ owner, repo, branch?, folder?, language? }`, auto-injected)
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
- **Description:** NAVIGATION LAYER: Returns a pointer table of matching memory IDs. Returns columns [id, code, title, type, importance] — NO content. Retrieve full memory via `memory-detail`.
- **Arguments:**
  - `query` (string, required)
  - `types` (array of enum values, optional)
  - `minImportance` (number, optional)
  - `limit` (number, default: 10)
  - `offset` (number, default: 0)
  - `current_file_path` (string, optional)
  - `include_archived` (boolean, optional)
  - `includeRecap` (boolean, optional)
  - `scope_injection`: owner, repo from session context
- **Response:**
  ```json
  {
  	"content": [
  		{
  			"type": "text",
  			"text": "Found 2 matching memories in repo \"my-repo\". Read structuredContent.results for details."
  		}
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

### 1.3 `memory-detail`

- **Method:** `tools/call`
- **Description:** Fetch full details of a specific memory by ID or short code. Use after `memory-search` when a pointer row is relevant.
- **Arguments:**
  - `id` (UUID or string code, optional)
  - `code` (string, optional)
- **Response:**
  - `content`: Text summary and serialized JSON.
  - `structuredContent`: Full memory object including **Usage Statistics**:
    - `hit_count`: Total times this memory was retrieved.
    - `recall_count`: Times an agent explicitly acknowledged using this memory.
    - `recall_rate`: Ratio of `recall_count / hit_count`.
    - `last_used_at`: Timestamp of most recent retrieval or acknowledgment.

### 1.4 `memory-acknowledge`

- **Method:** `tools/call`
- **Description:** Acknowledge the use of a memory or report its irrelevance/contradiction. Mandatory after using memory to generate code.
- **Arguments:**
  - `memory_id` (UUID, required)
  - `status` (enum: `used`, `irrelevant`, `contradictory`, required)
  - `application_context` (string, optional)
- **Response:**
  ```json
  {
  	"content": [{ "type": "text", "text": "Acknowledged memory uuid as used." }],
  	"structuredContent": { "success": true, "id": "uuid", "status": "used" }
  }
  ```

### 1.5 `memory-update`

- **Method:** `tools/call`
- **Description:** Update an existing memory entry. Keep `title` concise; move agent/role/date or claim context into `metadata`.
- **Arguments:**
  - `id` (UUID or string, required) — accepts UUID or code for flexible lookup
  - Any mutable field: `title`, `content`, `importance`, `status`, `metadata`, `tags`, `is_global` (optional)
- **Response:**
  ```json
  {
  	"content": [{ "type": "text", "text": "Updated memory uuid fields: title, content." }],
  	"structuredContent": { "success": true, "id": "uuid", "repo": "my-repo", "updatedFields": ["title", "content"] }
  }
  ```

### 1.6 `memory-delete`

- **Method:** `tools/call`
- **Description:** Soft-delete one or more memory entries. Supports single `id` or bulk `ids`.
- **Arguments:**
  - `id` (UUID, optional)
  - `ids` (array of UUIDs, optional)
  - `repo` (string, optional)
- **Response:**
  ```json
  {
  	"content": [{ "type": "text", "text": "Deleted 2 memory entry(ies) from repo \"my-repo\"." }],
  	"structuredContent": { "success": true, "repo": "my-repo", "deletedCount": 2, "ids": ["uuid-1", "uuid-2"] }
  }
  ```

### 1.7 `memory-recap`

- **Method:** `tools/call`
- **Description:** AGGREGATED OVERVIEW LAYER: Returns stats (counts by type) and a pointer table of top memories. NO content. Use for orientation only.
- **Arguments:**
  - `repo` (string, required)
  - `limit` (number, default: 20)
- **Response:**
  ```json
  {
  	"content": [{ "type": "text", "text": "Recap for repo \"my-repo\": 10 active memories." }],
  	"structuredContent": {
  		"schema": "memory-recap",
  		"repo": "my-repo",
  		"count": 10,
  		"stats": { "by_type": { "decision": 2, "code_fact": 8 } },
  		"top": { "columns": ["id", "title", "type", "importance"], "rows": [] }
  	}
  }
  ```

### 1.8 `memory-summarize`

- **Method:** `tools/call`
- **Description:** Update the summary for a repository.
- **Arguments:**
  - `repo` (string, required)
  - `summary` (string, required)
- **Response:**
  - `structuredContent`: Success confirmation with repo name.

### 1.9 `memory-synthesize`

- **Method:** `tools/call`
- **Description:** Synthesize memory + standards into coherent context. Uses client sampling (LLM) to produce a grounded answer.
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
  		"answer": "The authentication flow uses JWT...",
  		"model": "claude-3-5-sonnet",
  		"stopReason": "endTurn",
  		"iterations": 2,
  		"toolCalls": 3
  	}
  }
  ```

## 2. Upstream Compatibility Aliases

The following upstream tool names are registered as aliases:

| Upstream Name    | Maps To               | Description            |
| :--------------- | :-------------------- | :--------------------- |
| `remember_fact`  | `memory-store`        | Single fact storage    |
| `remember_facts` | `memory-store` (bulk) | Multiple facts storage |
| `recall`         | `memory-search`       | Semantic search        |
| `forget`         | `memory-delete`       | Delete memory          |

## 3. Resources (URIs)

| URI                                    | Description                                  |
| :------------------------------------- | :------------------------------------------- |
| `repository://index`                   | List of all known repositories with metadata |
| `repository://{owner}/{name}/memories` | Paginated list of memories for a repo        |
| `repository://{owner}/{name}/summary`  | High-level architectural summary             |
| `memory://{id}`                        | Detailed view of a specific memory record    |

## 4. Coordination Tools

### 4.1 `handoff-create`

- **Description:** Create a pending handoff for unfinished work context transfer.
- **Arguments:** `repo`, `from_agent`, `to_agent` (optional), `task_id`/`task_code` (optional), `summary`, `context`.

### 4.2 `handoff-list`

- **Description:** List repository handoffs with optional `status` and `agent` filters.

### 4.3 `handoff-update`

- **Description:** Close or reclassify a handoff. Statuses: `accepted`, `rejected`, `expired`.

### 4.4 `task-claim`

- **Description:** Claim task ownership for an agent. Uses dedicated claims table.

### 4.5 `claim-list`

- **Description:** List active claims in a repository, optionally filtered by agent.

### 4.6 `claim-release`

- **Description:** Release an active claim for a task.

## 5. Error Codes

All memory tools return MCP protocol errors via JSON-RPC:

| Code                                                                                          | Name           | Description                                                 |
| :-------------------------------------------------------------------------------------------- | :------------- | :---------------------------------------------------------- |
| `-32602`                                                                                      | Invalid Params | Required argument missing or type mismatch (Zod validation) |
| `-32603`                                                                                      | Internal Error | Embedding generation or database write failure              |
| Memory-specific errors are returned in `structuredContent.isError` with descriptive messages. |                |                                                             |

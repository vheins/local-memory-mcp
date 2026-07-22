# API Specification: Core Protocol Capabilities

## Header & Navigation

- [MCP Server Module Overview](../../modules/mcp-server/overview.md)
- [Memory Feature](../../modules/mcp-server/memory.md)
- [Task Feature](../../modules/mcp-server/task.md)

This document outlines the JSON-RPC interfaces for the foundational MCP server and client capabilities. Responses comply with the [MCP 2025-11-25 Structured Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) specification.

## 1. Tools Lifecycle

### 1.1 `tools/list`

Discovers available executable tools. Supports pagination via `limit` and `cursor`.

- **Example Request:**
  ```json
  {
  	"jsonrpc": "2.0",
  	"id": 100,
  	"method": "tools/list",
  	"params": {
  		"cursor": "optional-next-page-token",
  		"limit": 10
  	}
  }
  ```
- **Example Response:**
  ```json
  {
  	"jsonrpc": "2.0",
  	"id": 100,
  	"result": {
  		"tools": [
  			{
  				"name": "memory-store",
  				"description": "Store a new memory entry...",
  				"inputSchema": {
  					"type": "object",
  					"properties": {
  						"type": { "type": "string" },
  						"title": { "type": "string" },
  						"content": { "type": "string" }
  					},
  					"required": ["type", "title", "content"]
  				}
  			}
  		],
  		"nextCursor": "page-2-token"
  	}
  }
  ```

### 1.2 `tools/call` (Response Structure)

All tool calls return a `CallToolResult` within the JSON-RPC `result` field.

- **Example Result:**
  ```json
  {
  	"content": [
  		{ "type": "text", "text": "Operation summary. Read structuredContent for machine-readable results." },
  		{ "type": "resource_link", "uri": "memory://uuid", "name": "Memory: Title" }
  	],
  	"isError": false,
  	"structuredContent": { "id": "uuid-123", "success": true }
  }
  ```

### Registered Tool Categories

| Category            | Tools                                                                                                                                                             |
| :------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Memory**          | `memory-store`, `memory-search`, `memory-update`, `memory-delete`, `memory-acknowledge`, `memory-summarize`, `memory-synthesize`, `memory-recap`, `memory-detail` |
| **Task**            | `task-create`, `task-create-interactive`, `task-update`, `task-delete`, `task-list`, `task-detail`, `task-search`                                                 |
| **Standard**        | `standard-store`, `standard-search`, `standard-update`, `standard-delete`, `standard-detail`                                                                      |
| **Handoff/Claim**   | `handoff-create`, `handoff-list`, `handoff-update`, `task-claim`, `claim-list`, `claim-release`                                                                   |
| **Knowledge Graph** | `create-entity`, `delete-entity`, `create-relation`, `delete-relation`, `delete-observation`, `kg-backfill`                                                       |
| **Agent**           | `agent-context`, `decision-log`, `session-summarize`                                                                                                              |
| **Upstream Alias**  | `remember_fact`, `remember_facts`, `recall`, `forget`                                                                                                             |

## 2. Prompts

### 2.1 `prompts/list`

Discovers available predefined prompt templates. The server provides 31 role-specific prompts.

- **Example Response:**
  ```json
  {
  	"jsonrpc": "2.0",
  	"id": 101,
  	"result": {
  		"prompts": [
  			{
  				"name": "memory-agent-core",
  				"description": "Essential behavioral contract for memory-aware agents",
  				"arguments": []
  			},
  			{
  				"name": "project-briefing",
  				"description": "Contextual onboarding to current repository",
  				"arguments": [{ "name": "repo", "required": false }]
  			},
  			{ "name": "senior-code-review", "description": "Full code review against stored standards", "arguments": [] }
  		]
  	}
  }
  ```

### 2.2 `prompts/get`

Retrieves a specific prompt by name and executes it with the provided arguments.

- **Example Request:**
  ```json
  {
  	"jsonrpc": "2.0",
  	"id": 102,
  	"method": "prompts/get",
  	"params": {
  		"name": "project-briefing",
  		"arguments": { "repo": "my-repo" }
  	}
  }
  ```

## 3. Utilities

### 3.1 `completion/complete`

Provides auto-completion suggestions for prompts or resource arguments.

- **Example Request:**
  ```json
  {
  	"jsonrpc": "2.0",
  	"id": 103,
  	"method": "completion/complete",
  	"params": {
  		"ref": { "type": "ref/resource", "name": "repository://{name}/memories" },
  		"argument": { "name": "name", "value": "vheins/loc" }
  	}
  }
  ```
- **Capabilities:**
  - `repo` completion: Lists active repositories
  - `tags` completion: Suggests existing tags
  - `task_code` completion: Active tasks with pending/in_progress status
  - `file_path` completion: Scoped path suggestions from workspace roots

### 3.2 `logging/setLevel` & `notifications/message`

Configures log level threshold and emits log notifications. Levels: `debug`, `info`, `warn`, `error`.

## 4. Client Capabilities (Requests from Server to Client)

### 4.1 `sampling/createMessage`

The server requests the client to sample from an LLM. Used by `memory-synthesize` to generate grounded answers from memory context.

### 4.2 `elicitation/create`

The server requests structured input from the user via the client's UI. Used by `task-create-interactive` for guided task creation with two modes:

- **Form mode**: Structured data collection (text, number, boolean) using JSON Schema
- **URL mode**: Redirects user to external URL for sensitive interactions

## 5. Resources

The server exposes resources via standard MCP resource URIs:

| URI Pattern                             | Description                      |
| :-------------------------------------- | :------------------------------- |
| `repository://index`                    | List of all known repositories   |
| `repository://{owner}/{name}/memories`  | Paginated memories for a repo    |
| `repository://{owner}/{name}/tasks`     | Paginated tasks for a repo       |
| `repository://{owner}/{name}/summary`   | Repo global summary              |
| `repository://{owner}/{name}/actions`   | Audit stream of tool actions     |
| `repository://{owner}/{name}/standards` | Coding standards for a repo      |
| `memory://{id}`                         | Single memory detail             |
| `task://{id}`                           | Single task detail with comments |
| `action://{id}`                         | Single action log entry          |

## 6. Session & Scope Management

- **Roots:** The MCP client exposes workspace directories via `roots/list`. The server uses these to infer `owner`, `repo`, and `folder` for scope injection.
- **Scope Injection:** Tool arguments automatically receive `owner`, `repo`, `folder` from session context. Agents don't need to specify them manually.
- **Write Locking:** All mutation tools run under `WriteLock.withLock()` using `proper-lockfile` to prevent concurrent write conflicts.

## 7. Error Codes

MCP protocol errors follow JSON-RPC 2.0 standard codes:

| Code     | Name               | Description                                     |
| :------- | :----------------- | :---------------------------------------------- |
| `-32700` | Parse Error        | Invalid JSON was received by the server         |
| `-32600` | Invalid Request    | The JSON sent is not a valid Request object     |
| `-32601` | Method Not Found   | The tool/method does not exist                  |
| `-32602` | Invalid Params     | Tool arguments failed Zod schema validation     |
| `-32603` | Internal Error     | Unexpected server error during tool execution   |
| `-32000` | Write Lock Timeout | Tool execution timed out waiting for write lock |

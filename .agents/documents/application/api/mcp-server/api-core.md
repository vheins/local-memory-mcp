# API Specification: Core Protocol Capabilities

This document outlines the JSON-RPC interfaces for the foundational MCP server and client capabilities. Responses comply with the [MCP 2025-11-25 Structured Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) specification.

## 1. Tools Lifecycle

### 1.1 `tools/list`

Discovers available executable tools. Supports pagination.

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

## 2. Prompts

### 2.1 `prompts/list`

Discovers available predefined prompt templates.

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
  			}
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
  		"arguments": {
  			"repo": "my-repo"
  		}
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
  		"ref": {
  			"type": "ref/resource",
  			"name": "repository://{name}/memories"
  		},
  		"argument": {
  			"name": "name",
  			"value": "vheins/loc"
  		}
  	}
  }
  ```
- **Example Response:**
  ```json
  {
  	"jsonrpc": "2.0",
  	"id": 103,
  	"result": {
  		"completion": {
  			"values": ["vheins/local-memory-mcp"],
  			"total": 1,
  			"hasMore": false
  		}
  	}
  }
  ```

### 3.2 `logging/setLevel` & `notifications/message`

Configures the log level threshold and emits log notifications.

## 4. Client Capabilities (Requests from Server to Client)

### 4.1 `sampling/createMessage`

The server requests the client to sample from an LLM. Used by `memory-synthesize`.

### 4.2 `elicitation/create`

The server requests structured input from the user via the client's UI. Used by `task-create-interactive`.

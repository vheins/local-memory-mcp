# API Specification: Core Protocol Capabilities

This document outlines the JSON-RPC interfaces for the foundational MCP server and client capabilities that are agnostic to specific modules like Memory or Tasks. It strictly conforms to the [MCP 2025-11-25 Specification](https://modelcontextprotocol.io/specification/2025-11-25).

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
      "cursor": "optional-next-page-token"
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
          "name": "memory.store",
          "description": "Stores a new memory",
          "inputSchema": {
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "content": { "type": "string" }
            },
            "required": ["title", "content"]
          }
        }
      ]
    }
  }
  ```

## 2. Prompts

### 2.1 `prompts/list`
Discovers available predefined prompt templates.
- **Example Request:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 101,
    "method": "prompts/list"
  }
  ```
- **Example Response:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 101,
    "result": {
      "prompts": [
        {
          "name": "create-task",
          "description": "Template for creating comprehensive tasks",
          "arguments": [
            {
              "name": "title",
              "description": "Title of the task",
              "required": true
            }
          ]
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
      "name": "create-task",
      "arguments": {
        "title": "Fix Auth"
      }
    }
  }
  ```
- **Example Response:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 102,
    "result": {
      "description": "Prompt returned.",
      "messages": [
        {
          "role": "user",
          "content": {
            "type": "text",
            "text": "Please create a task titled: Fix Auth"
          }
        }
      ]
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
        "name": "memory://index?repo={repo}"
      },
      "argument": {
        "name": "repo",
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
- **Example Request (`logging/setLevel`):**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 104,
    "method": "logging/setLevel",
    "params": { "level": "info" }
  }
  ```
- **Example Notification (`notifications/message`):**
  ```json
  {
    "jsonrpc": "2.0",
    "method": "notifications/message",
    "params": {
      "level": "info",
      "logger": "mcp-server",
      "data": { "message": "Server started successfully" }
    }
  }
  ```

## 4. Client Capabilities (Requests from Server to Client)

### 4.1 `sampling/createMessage`
The server requests the client to sample from an LLM.
- **Example Request (Server -> Client):**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 200,
    "method": "sampling/createMessage",
    "params": {
      "messages": [
        { "role": "user", "content": { "type": "text", "text": "Summarize these logs." } }
      ],
      "maxTokens": 1000
    }
  }
  ```
- **Example Response (Client -> Server):**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 200,
    "result": {
      "role": "assistant",
      "content": { "type": "text", "text": "The logs indicate..." },
      "model": "claude-3-5-sonnet",
      "stopReason": "endTurn"
    }
  }
  ```

### 4.2 `elicitation/create`
The server requests structured input from the user via the client's UI.
- **Example Request (Server -> Client):**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 201,
    "method": "elicitation/create",
    "params": {
      "mode": "form",
      "message": "Provide new task details",
      "requestedSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" }
        },
        "required": ["title"]
      }
    }
  }
  ```
- **Example Response (Client -> Server):**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 201,
    "result": {
      "action": "accept",
      "content": {
        "title": "Fix Authentication Flow"
      }
    }
  }
  ```
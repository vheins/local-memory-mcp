# MCP Protocol Reference (v2025-11-25)

This document details the technical interface exposed by the `local-memory-mcp` server for AI Agents, fully compliant with the [Model Context Protocol (MCP) Specification v2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server).

## Server Lifecycle & Capabilities

- **Protocol Version**: `2025-11-25`
- **Transport**: JSON-RPC 2.0 over standard input/output (stdio).
- **Supported Capabilities**:
  - `tools` (list, call)
  - `resources` (list, read, subscribe, listChanged notifications)
  - `prompts` (list, get, listChanged notifications)
  - `logging` (setLevel, message notifications)
  - `completions` (complete)

## Basic Protocol Requirements (JSON-RPC 2.0)

In compliance with the [MCP Basic Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic), all communication with this server must adhere strictly to JSON-RPC 2.0:
- **Requests & Responses:** All requests MUST include a valid, non-null `id` (string or integer) which MUST NOT have been used previously by the requestor in the active session. All responses MUST include the matching `id`.
- **Notifications:** Oneway messages MUST NOT include an `id` field. The receiver must not send a response.
- **Schema Validation:** All input schemas and tools use JSON Schema draft **2020-12** by default. Clients must validate the schema dialect accordingly.
- **Metadata (`_meta`):** Both requests and notifications may optionally include a `_meta` object for tracking progress or attaching out-of-band metadata.
- **Authorization:** Since this server is designed for **local-first execution** over the **stdio transport**, the MCP Authorization specification (OAuth 2.1) is **not applicable**. Security is managed via local filesystem permissions and environment-level access.

## Lifecycle Management

In compliance with the [MCP Lifecycle Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), the server enforces a strict initialization handshake and lifecycle process:
- **Initialization Handshake:** The connection begins with the client sending an `initialize` request. The server MUST respond with its capabilities. The client MUST then send a `notifications/initialized` notification. No other requests (except `ping`) are permitted before this handshake is complete.
- **Liveness (Ping):** Both client and server support the `ping` method to verify connection liveness. Pings can be sent at any time, including during initialization.
- **Disconnection:** On stdio transports, disconnection is handled via process streams. The client gracefully exits by closing the input stream to the server, and the server shuts down gracefully.
- **Error Handling:** If the protocol version negotiation fails during initialization, the server returns an explicit `-32602` error containing the `supported` and `requested` versions.

## Utilities: Ping

In compliance with the [MCP Ping Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping), the server and client may verify connection liveness:
- **Request Format:** A standard JSON-RPC request with the method `"ping"` and no parameters.
- **Response Format:** The receiver MUST promptly return a JSON-RPC response with an empty result object (`"result": {}`).
- **Timeout & Error Handling:** If a response is not received within a reasonable timeout period, the sender MAY consider the connection stale, log the failure, or reset the connection. Frequent but lightweight pinging is recommended to prevent hung processes without causing excessive network/processing overhead.

## Utilities: Progress

In compliance with the [MCP Progress Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress), the server supports out-of-band progress notifications for long-running requests:
- **Progress Token:** Requests may include a `_meta.progressToken` (string or integer) supplied by the client.
- **Progress Notification:** While processing the request, the server MAY emit `notifications/progress` messages. These notifications MUST include the matching `progressToken`, a strictly increasing `progress` value (number), and MAY optionally include a `total` (number) or a human-readable `message`.
- **Completion:** Progress tracking ends implicitly when the server returns the final JSON-RPC response (result or error) for the corresponding request.

## Utilities: Cancellation

In compliance with the [MCP Cancellation Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation), the server supports aborting in-flight requests:
- **Notification Method:** Clients may send a `notifications/cancelled` notification containing a `requestId` and an optional `reason`.
- **Behavior:** Upon receiving this notification, the server triggers an internal `AbortController` for the corresponding active request.
- **Response:** If the request has not yet completed, the server aborts the underlying processing (e.g., SQLite query, vector embeddings, tool execution) and drops the response. The client MUST NOT expect a JSON-RPC `result` or `error` response for a successfully cancelled request.

## STDIO Transport Requirements

In compliance with the [MCP STDIO Transport Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), the server adheres to the following strict boundaries:
- **Encoding & Formatting:** All JSON-RPC messages MUST be encoded in **UTF-8**.
- **Delimiters:** Messages MUST be delimited by a single newline character. Messages MUST NOT contain any embedded newlines within their payload.
- **I/O Channels:** The server reads requests/notifications from `stdin` and writes its responses/notifications exclusively to `stdout`. The server MUST NOT write anything to `stdout` that is not a valid MCP JSON-RPC message.
- **Diagnostics & Logging:** The server MAY write UTF-8 encoded strings to `stderr` for informational, debugging, or error logging. Clients SHOULD NOT assume that output on `stderr` inherently indicates a protocol error or critical failure.

## Client Features: Roots

In compliance with the [MCP Roots Specification](https://modelcontextprotocol.io/specification/2025-11-25/client/roots), the server supports understanding client-defined filesystem boundaries:
- **Capability:** The client MUST declare the `roots` capability during the initialization handshake.
- **List Request (`roots/list`):** The server MAY issue a `roots/list` request to the client to retrieve the current active workspaces. The client returns an array of `Root` objects, each containing a mandatory `uri` (which MUST use the `file://` scheme) and an optional `name`.
- **Notifications (`notifications/roots/list_changed`):** If the client declared `roots: { listChanged: true }`, it MUST emit a `notifications/roots/list_changed` notification whenever its workspace boundaries change, prompting the server to refresh its context.

---

## 1. Tools (Model Control)

Tools are executable functions exposed to the LLM to perform actions, interact with the local SQLite database, or retrieve dynamic data.

### Knowledge Management (Memory)
- **`memory-store`**: Store a new human-auditable knowledge entry (e.g., `code_fact`, `decision`, `mistake`).
- **`memory-search`**: NAVIGATION LAYER: Returns a pointer table of matching memory IDs.
- **`memory-synthesize`**: Advanced reasoning tool that synthesizes grounded answers using the client's LLM.
- **`memory-detail`**: Fetch full content and metadata for a specific memory by its ID.
- **`memory-acknowledge`**: (MANDATORY) Acknowledge the use of a memory or report its irrelevance.
- **`memory-update`**: Update an existing memory entry (e.g., status, importance, or metadata).
- **`memory-delete`**: Soft-delete one or more memory entries. Supports single `id` or bulk deletion via `ids`.
- **`memory-summarize`**: Update the high-level global summary for a repository.
- **`memory-recap`**: AGGREGATED OVERVIEW: Returns stats and top memories in a repo.

### Task Management
- **`task-list`**: PRIMARY navigation and search tool. Returns a tabular list of tasks.
- **`task-create`**: Register one or more new tasks. Supports single task or bulk creation. Supports MCP elicitation fallbacks for missing fields.
- **`task-create-interactive`**: Interactively creates a task by requesting user input via elicitation.
- **`task-detail`**: Fetch full description, phase, priority, and all comments for a specific task.
- **`task-update`**: Progress one or more tasks through their lifecycle (Backlog → Pending → In Progress → Completed). Supports bulk updates via `ids`.
- **`task-delete`**: Hard deletion of task records. Supports single `id` or bulk deletion via `ids`.

---

## 2. Resources (Application Control)

Resources provide read-only access to specialized data views and global knowledge using a repository-scoped URI scheme. The server supports real-time updates via `resources/subscribe`.

### Global Resources
- **`repository://index`**: List of all available repositories in the system.
- **`session://roots`**: List of active workspace roots provided by the current client session.

### Repository Resources (Templates)
- **`repository://{name}/memories`**: Paginated list of all active memories for a specific repository.
- **`repository://{name}/memories?search={search}&type={type}&tag={tag}`**: Filtered list of memories scoped to a repository.
- **`memory://{id}`**: Direct access to a specific memory entry (full details and statistics) by its UUID.
- **`repository://{name}/summary`**: Retrieves the high-level global summary/signal for a repository.
- **`repository://{name}/tasks`**: Paginated list of all tasks for a specific repository.
- **`repository://{name}/tasks?status={status}&priority={priority}`**: Scoped task list for a repository with filtering.
- **`task://{id}`**: Direct access to a specific task (full description and comments) by its UUID.
- **`repository://{name}/actions`**: Paginated stream of all agent tool actions logged within a repository.
- **`action://{id}`**: Direct access to a specific action audit log entry by its integer ID.

---

## 3. Prompts (User Control)

Prompts are predefined instruction templates that guide model interactions.

### Core Lifecycle Prompts
- **`memory-agent-core`**: Essential behavioral contract for any memory-aware agent.
- **`project-briefing`**: Onboarding template for starting a new session in a repository.

### Specialized Workflow Prompts
- **`task-orchestrator`**: Specialized for managing complex multi-task initiatives.
- **`senior-code-review`**: High-standard review template focused on project-specific patterns.
- **`root-cause-analysis`**: Debugging template for tracing bugs back to their origin.

---

## 4. Advanced Capabilities Support

The following features conform to the standard MCP specification.

- **Completions**: Supported via `completion/complete` to provide autocompletion for prompt arguments or tool inputs.
- **Logging**: The server supports dynamic log level adjustment via `logging/setLevel` and emits structured logs through `notifications/message`.
- **Sampling**: Utilizes the `sampling/createMessage` client capability to generate synthesized memory summaries.
- **Elicitation**: Utilizes the `elicitation/create` client capability for interactive task creation forms.

---

## ⚠️ No Warranty
The MCP interface and responses are provided **"AS IS"** without any warranty.

# MCP Protocol Reference (v2025-03-26)

This document details the technical interface exposed by the `local-memory-mcp` server for AI Agents, fully compliant with the [Model Context Protocol (MCP) Specification v2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/server).

> **Protocol version source:** the server advertises `2025-03-26` — see `MCP_PROTOCOL_VERSION` in `src/mcp/capabilities.ts`. Spec links below point to that version.

## Server Lifecycle & Capabilities

- **Protocol Version**: `2025-03-26`
- **Transport**: JSON-RPC 2.0 over standard input/output (stdio).
- **Supported Capabilities**:
  - `tools` (list, call)
  - `resources` (list, read, subscribe, listChanged notifications)
  - `prompts` (list, get, listChanged notifications)
  - `logging` (setLevel, message notifications)
  - `completions` (complete)

## Basic Protocol Requirements (JSON-RPC 2.0)

In compliance with the [MCP Basic Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic), all communication with this server must adhere strictly to JSON-RPC 2.0:

- **Requests & Responses:** All requests MUST include a valid, non-null `id` (string or integer) which MUST NOT have been used previously by the requestor in the active session. All responses MUST include the matching `id`.
- **Notifications:** Oneway messages MUST NOT include an `id` field. The receiver must not send a response.
- **Schema Validation:** All input schemas and tools use JSON Schema draft **2020-12** by default. Clients must validate the schema dialect accordingly.
- **Metadata (`_meta`):** Both requests and notifications may optionally include a `_meta` object for tracking progress or attaching out-of-band metadata.
- **Authorization:** Since this server is designed for **local-first execution** over the **stdio transport**, the MCP Authorization specification (OAuth 2.1) is **not applicable**. Security is managed via local filesystem permissions and environment-level access.

## Lifecycle Management

In compliance with the [MCP Lifecycle Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle), the server enforces a strict initialization handshake and lifecycle process:

- **Initialization Handshake:** The connection begins with the client sending an `initialize` request. The server MUST respond with its capabilities. The client MUST then send a `notifications/initialized` notification. No other requests (except `ping`) are permitted before this handshake is complete.
- **Liveness (Ping):** Both client and server support the `ping` method to verify connection liveness. Pings can be sent at any time, including during initialization.
- **Disconnection:** On stdio transports, disconnection is handled via process streams. The client gracefully exits by closing the input stream to the server, and the server shuts down gracefully.
- **Error Handling:** If the protocol version negotiation fails during initialization, the server returns an explicit `-32602` error containing the `supported` and `requested` versions.

## Utilities: Ping

In compliance with the [MCP Ping Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/ping), the server and client may verify connection liveness:

- **Request Format:** A standard JSON-RPC request with the method `"ping"` and no parameters.
- **Response Format:** The receiver MUST promptly return a JSON-RPC response with an empty result object (`"result": {}`).
- **Timeout & Error Handling:** If a response is not received within a reasonable timeout period, the sender MAY consider the connection stale, log the failure, or reset the connection. Frequent but lightweight pinging is recommended to prevent hung processes without causing excessive network/processing overhead.

## Utilities: Progress

In compliance with the [MCP Progress Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/progress), the server supports out-of-band progress notifications for long-running requests:

- **Progress Token:** Requests may include a `_meta.progressToken` (string or integer) supplied by the client.
- **Progress Notification:** While processing the request, the server MAY emit `notifications/progress` messages. These notifications MUST include the matching `progressToken`, a strictly increasing `progress` value (number), and MAY optionally include a `total` (number) or a human-readable `message`.
- **Completion:** Progress tracking ends implicitly when the server returns the final JSON-RPC response (result or error) for the corresponding request.

## Utilities: Cancellation

In compliance with the [MCP Cancellation Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/cancellation), the server supports aborting in-flight requests:

- **Notification Method:** Clients may send a `notifications/cancelled` notification containing a `requestId` and an optional `reason`.
- **Behavior:** Upon receiving this notification, the server triggers an internal `AbortController` for the corresponding active request.
- **Response:** If the request has not yet completed, the server aborts the underlying processing (e.g., SQLite query, vector embeddings, tool execution) and drops the response. The client MUST NOT expect a JSON-RPC `result` or `error` response for a successfully cancelled request.

## STDIO Transport Requirements

In compliance with the [MCP STDIO Transport Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), the server adheres to the following strict boundaries:

- **Encoding & Formatting:** All JSON-RPC messages MUST be encoded in **UTF-8**.
- **Delimiters:** Messages MUST be delimited by a single newline character. Messages MUST NOT contain any embedded newlines within their payload.
- **I/O Channels:** The server reads requests/notifications from `stdin` and writes its responses/notifications exclusively to `stdout`. The server MUST NOT write anything to `stdout` that is not a valid MCP JSON-RPC message.
- **Diagnostics & Logging:** The server MAY write UTF-8 encoded strings to `stderr` for informational, debugging, or error logging. Clients SHOULD NOT assume that output on `stderr` inherently indicates a protocol error or critical failure.

## Client Features: Roots

In compliance with the [MCP Roots Specification](https://modelcontextprotocol.io/specification/2025-03-26/client/roots), the server supports understanding client-defined filesystem boundaries:

- **Capability:** The client MUST declare the `roots` capability during the initialization handshake.
- **List Request (`roots/list`):** The server MAY issue a `roots/list` request to the client to retrieve the current active workspaces. The client returns an array of `Root` objects, each containing a mandatory `uri` (which MUST use the `file://` scheme) and an optional `name`.
- **Notifications (`notifications/roots/list_changed`):** If the client declared `roots: { listChanged: true }`, it MUST emit a `notifications/roots/list_changed` notification whenever its workspace boundaries change, prompting the server to refresh its context.

---

## 1. Tools (Model Control)

Tools are executable functions exposed to the LLM to perform actions, interact with the local SQLite database, or retrieve dynamic data.

### Knowledge Management (Memory)

> **Tool names:** the server registers **17 canonical tools** (see `buildExecutors` in `src/mcp/tools/index.ts`). Legacy dotted names (`memory-store`, `task-create`, …) are **not** registered; their functionality is folded into the unified tools below under auto-inferred modes. "Formerly" notes give the legacy mapping.

- **`memory-write`**: Unified write tool — store a new human-auditable entry (`content` + `type` + `title`; formerly `memory-store`), update an entry (`id`/`code` + fields; formerly `memory-update`), or acknowledge usage (`acknowledge: "used" | "irrelevant" | "contradictory"`; formerly `memory-acknowledge`). Convenience modes: `type: "decision"` with `context`/`rationale`/`alternatives` auto-formats an importance-4 decision entry; `type: "task_archive"` with `key_decisions`/`next_steps` auto-formats an importance-3 archive.
- **`memory-read`**: Unified read tool — search (`query`; formerly `memory-search`), detail by `id`/`code`/`ids`/`codes` (formerly `memory-detail`), or recap with stats + top memories (no params; formerly `memory-recap`).
- **`memory-delete`**: Soft-delete one or more memory entries. Supports single `id` or bulk deletion via `ids`.
- **`synthesize`**: Advanced reasoning tool that synthesizes grounded answers using the client's LLM (formerly `memory-synthesize`). Only registered when the client declares the `sampling` capability.
- **`repo-summarize`**: Update the high-level summary for a repository (formerly `memory-summarize`).

### Task Management

- **`task-read`**: Unified read tool — list (no params; formerly `task-list`), detail by `id`/`task_code` (formerly `task-detail`), or search (`query`).
- **`task-write`**: Unified write tool — create one or more tasks (`phase` + `title` + `description`; formerly `task-create`), interactive create via elicitation (`interactive: true`; formerly `task-create-interactive`), update (`id`/`code`; formerly `task-update`), or bulk (`tasks[]`). Progresses tasks through `backlog → pending → in_progress → completed/canceled/blocked`; a `comment` is required on status changes, and `completed` gates on children being completed first.
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
- **`repository://{name}/tasks?status={status}&priority={priority}`**: Scoped task list for a repository with filtering. Priority filter (`priority` 1–5) uses local-memory-mcp task semantics: `1=Low`, `2=Normal`, `3=Medium`, `4=High`, `5=Critical` — same labels as the dashboard (`getPriorityLabel` in `src/dashboard/ui/src/lib/utils.ts`); it is not an MCP-specified field.
- **`task://{id}`**: Direct access to a specific task (full description and comments) by its UUID.
- **`repository://{name}/actions`**: Paginated stream of all agent tool actions logged within a repository.
- **`action://{id}`**: Direct access to a specific action audit log entry by its integer ID.

### Codebase Resources (Templates)

Read-only views over a repo's codebase index (shipped with RS-1/TASK-323; templates registered in `src/mcp/resources/sdk-index.ts:183-279`, URIs listed in `src/mcp/resources/codebase.ts:246-260`). The `{repo}` argument is auto-completed from the indexed repositories. Every read requires the repo to be indexed — otherwise the server returns a `RecoverableError` ("Repo … not indexed. Run codebase-index on repo.").

- **`codebase://{repo}/symbols`**: Symbol records for a repo (name, kind, file_path, start/end line, signature, exported, defaultExport). Optional query params (`search`, `kind`, `limit`, `offset`) filter and paginate; the payload mirrors the SEARCH mode of `codebase-read`.
- **`codebase://{repo}/symbols?search={search}&kind={kind}&limit={limit}`** (plus single-param forms `?search=`, `?kind=`, `?limit=`, `?offset=`): the filtered/paginated forms are registered as separate templates because the MCP SDK's `{?...}` operator matches all listed params or none.
- **`codebase://{repo}/symbols/{name}`**: Full trace payload for one symbol — definition, references (stored + in-memory merged), export chain, and parent/children — the same shape as the TRACE mode of `codebase-read`. Ambiguous names return a disambiguation payload; a missing symbol returns the `-32002` resource-not-found error.
- **`codebase://{repo}/files/{file_path}`**: File **landmark** — indexed file metadata (path, language, checksum, line count, size, last indexed) plus its symbols. Raw file content is **not** served: it is disk-only and never stored — the payload carries an explicit `content: null`. Use the `CODE` mode of `codebase-read` (with `repoPath`) to grep file contents.

All codebase:// reads are strictly read-only and DB-flat: the payloads contain **symbols and spans only**, never raw content. Query params on the `symbols` templates are optional in the dispatcher; over production SDK transport, use the exact template forms listed above.

---

## 3. Prompts (User Control)

Prompts are predefined instruction templates that guide model interactions.

### Known Limitation: MCP Prompt Support by Agent

Not all coding agents support MCP **prompts** (the capability to list/get prompt templates). Below is the compatibility matrix:

| Agent                    | MCP Prompts          | Notes                                      |
| ------------------------ | -------------------- | ------------------------------------------ |
| Claude Desktop           | ✅ Supported         | Prompts appear as slash commands           |
| Claude Code              | ✅ Supported         | Invoked as `/mcp__servername__promptname`  |
| Cursor                   | ✅ Supported         | Prompts supported, Resources NOT supported |
| Windsurf                 | ✅ Supported         | All three: Tools, Prompts, Resources       |
| GitHub Copilot (VS Code) | ✅ Supported         | Use `/<server>.<prompt>` in chat           |
| Continue.dev             | ✅ Supported         | Surfaces as slash commands in agent mode   |
| Zed                      | ✅ Supported         | As slash commands                          |
| Gemini CLI               | ✅ Supported         |                                            |
| **Codex CLI (OpenAI)**   | ❌ **Not Supported** | Only Tools + Resources                     |
| Cline                    | ❌ Not Supported     | Only Tools + Resources                     |

If your agent doesn't support prompts, you can still invoke the equivalent behavior via **Tools** (e.g., `memory-agent-core` instructions can be manually prompted), or trigger prompts through the **Dashboard** UI.

### Core Lifecycle Prompts

- **`memory-agent-core`**: Essential behavioral contract for any memory-aware agent.
- **`project-briefing`**: Onboarding template for starting a new session in a repository.

### Specialized Workflow Prompts

- **`task-management-guidelines`**: Task lifecycle and coordination contract for managing complex multi-task initiatives (replaces the legacy `task-orchestrator` prompt, which is not registered).
- **`senior-code-review`**: High-standard review template focused on project-specific patterns.
- **`root-cause-analysis`**: Debugging template for tracing bugs back to their origin.

> The full registered prompt set is loaded from `src/mcp/prompts/definitions/` (e.g., `session-planner`, `create-task`, `memory-agent-core`, `project-briefing`) and served via `prompts/list` + `prompts/get`.

---

## 4. Advanced Capabilities Support

The following features conform to the standard MCP specification.

- **Completions**: Supported via `completion/complete` to provide autocompletion for **prompt arguments** (`ref/prompt`) and **resource arguments** (`ref/resource`) — not tool inputs (`src/mcp/completion.ts`).
- **Logging**: The server supports dynamic log level adjustment via `logging/setLevel` and emits structured logs through `notifications/message`.
- **Sampling**: Utilizes the `sampling/createMessage` client capability to generate synthesized memory summaries (the `synthesize` tool).
- **Elicitation**: Utilizes the `elicitation/create` client capability (`form` or `url` mode) for interactive task creation forms.

---

## ⚠️ No Warranty

The MCP interface and responses are provided **"AS IS"** without any warranty.

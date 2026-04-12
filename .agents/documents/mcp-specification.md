# Summary of Model Context Protocol (MCP) Specification 2025-11-25

This document is the result of learning and synthesizing the official MCP specification version 2025-11-25, covering server features, client features, as well as security and transport aspects.

## 1. Server Features

### A. Prompts (Instruction Templates)
- **Function:** Standardizes how servers expose message/instruction templates to clients.
- **Technical Requirements:**
  - The server must declare `prompts` capabilities during initialization.
  - Supports `prompts/list` (with pagination) and `prompts/get` methods.
  - Message content types include: text, image, audio (base64-encoded), and embedded resources.
- **Key Constraints:**
  - **Validation:** The server must validate prompt arguments before processing.
  - **Security:** Implementations must be wary of injection attacks through prompt inputs.

### B. Resources (Data Sources)
- **Function:** Shares data (files, DB schemas, etc.) as context for the LLM through unique URIs.
- **Technical Requirements:**
  - Supports `resources/list`, `resources/read`, and `resources/templates/list` methods.
  - Optional features: `subscribe` (change subscription) and `listChanged` (list change notification).
  - Resource annotations: `audience` (user/assistant), `priority` (0.0 - 1.0), and `lastModified`.
- **Key Constraints:**
  - **URI Schemes:** The `https://` scheme is only used if the client can fetch the data themselves. For internal data, use custom schemes or `file://`.
  - **Security:** The server must validate all resource URIs and apply access controls.

### C. Tools (Execution Tools)
- **Function:** Functions that can be called by the LLM to interact with external systems (APIs, DBs).
- **Technical Requirements:**
  - Supports `tools/list` and `tools/call` methods.
  - Inputs use JSON Schema (default version 2020-12).
  - Tool results can be structured or unstructured content.
- **Key Constraints:**
  - **Human-in-the-loop:** Human confirmation is highly recommended before a tool is executed (especially sensitive operations).
  - **Naming:** Tool names must be 1-128 characters, case-sensitive, and only use specific ASCII characters (A-Z, a-z, 0-9, `_`, `-`, `.`).
  - **Error Handling:** Distinguish between *Protocol Error* (JSON-RPC issues) and *Tool Execution Error* (business logic issues).

### D. Utilities: Completion (Autocomplete)
- **Function:** Provides autocomplete suggestions for prompt arguments and resource templates.
- **Technical Requirements:**
  - Method: `completion/complete`.
  - Supports `ref/prompt` and `ref/resource` type references.
- **Key Constraints:**
  - **Limitations:** Maximum 100 suggestions per response.
  - **Performance:** Clients should debounce rapid requests, and servers should sort suggestions by relevance.

---

## 2. Client Features

### A. Roots (Filesystem Boundaries)
- **Function:** The client exposes and defines workspace directory boundaries (*workspace roots*) that the server can access.
- **Capability Declaration:** The client must declare `roots` capability during the initialization handshake phase.
- **Main Method:** `roots/list`. The server can send this request to the client to fetch the list of active directories. The client must return an array of `Root` objects.
- **Root Object:** Each `Root` object contains:
  - `uri` (Required): URI pointing to the directory location (must use `file://` scheme).
  - `name` (Optional): Reference name of the directory.
- **Change Notification:** If the client supports `roots: { listChanged: true }`, the client must send a one-way `notifications/roots/list_changed` notification to the server whenever the workspace root structure or list changes.
- **Key Constraints:**
  - **URI:** Currently only supports the `file://` scheme.
  - **Security:** The client must validate URIs to prevent path traversal attacks. The server must respect the provided root boundaries.

### B. Sampling (LLM Access)
- **Function:** The server requests the client to perform text/media generation from the LLM without needing an API key on the server side.
- **Technical Requirements:**
  - Method: `sampling/createMessage`.
  - Supports model preferences through *hints* (model name suggestions) and priorities (cost, speed, intelligence).
  - Supports *multi-turn tool loop* (LLM calling tools within the sampling process).
- **Key Constraints:**
  - **Message Integrity:** Messages with `tool_result` type **must not** be mixed with other content types (text/image) within the same message.
  - **Security:** There must be user approval control for every sampling request.

### C. Elicitation (User Information Requests)
- **Function:** The server requests additional information from the user through the client.
- **Operating Modes:**
  1. **Form Mode:** Structured data collection (text, number, boolean) using a restricted subset of JSON Schema (flat objects only).
  2. **URL Mode:** Directs the user to an external URL for sensitive interactions (OAuth, payments).
- **Key Constraints:**
  - **Sensitive Data Prohibition:** It is **strictly forbidden** to use *Form Mode* to request passwords, API keys, or credit card data. Use *URL Mode* for this.
  - **URL Security:** Clients are forbidden from auto-prefetching URLs and must display the full URL before the user provides approval.
  - **Phishing:** The server must verify that the user opening the URL is the same user who triggered the request (e.g., via session cookie).

---

## 3. Lifecycle Management

### A. Initialization
- **Function:** Mandatory three-step handshake before any operation runs.
- **Stages:**
  1. Client sends `initialize` request with capabilities and version.
  2. Server responds with capabilities and protocol version confirmation.
  3. Client must respond back with `notifications/initialized` notification.
- **Key Constraints:** No requests other than `ping` may be sent before this process is successfully exchanged. If there is a version mismatch, the server replies with a *Protocol Error* (`-32602`) and then disconnects.

### B. Liveness (Ping)
- **Function:** Bidirectional connection status check (sent by either client or server at any time) without interrupting the handshake or main requests.
- **Message Format:** Standard JSON-RPC request with `"ping"` method and no parameters (`"params"` is empty/omitted).
- **Response Format:** The party receiving the `ping` message MUST respond as soon as possible with a standard JSON-RPC object containing an empty result (`"result": {}`).
- **Key Constraints:** If a response is not received within a reasonable timeout, the sender IS ENTITLED to decide that the connection has gone stale and may disconnect or attempt to reconnect. Routine pings are recommended but should not be too frequent to avoid network overhead.

### C. Disconnection
- **STDIO Transport:** The client should close the input stream (stdin) and wait for the server to exit gracefully before using forced shutdown instructions (like SIGTERM/SIGKILL).
- **HTTP Transport:** Direct disconnection is done by closing the web/socket connection.

---

## 4. Transport Specification (STDIO)

### Format & Channel Rules (I/O)
- **Message Format:** The protocol uses JSON-RPC which must be encoded using **UTF-8**.
- **Newline Delimitation:** Each JSON message must be separated by a single newline character (`\n`). Messages must not contain any newlines within the payload or data (embedded newlines).
- **Main Channel:** The server reads all instructions from `stdin` and sends back responses/notifications only through `stdout`. The server must not send anything to `stdout` other than valid MCP JSON-RPC messages.

### Stderr Usage
- **Logging/Error:** The server can use the `stderr` channel to print UTF-8 strings containing diagnostic logs, information, or errors.
- **Client Assumption:** The client must not assume that output on the `stderr` channel indicates a crash or absolute protocol failure.

---

## 5. Utilities Specification (Progress & Cancellation)

### A. Progress Reporting (`notifications/progress`)
- **Function:** Provides status updates or progress metrics out-of-band for requests requiring long computation time (e.g., embedding generation or bulk data extraction).
- **Client Mechanism:** The client must attach a `progressToken` attribute (can be string or number) to the `_meta` object in the original request.
- **Server Mechanism:** Periodically, the server sends a one-way notification (`notifications/progress`) back to the client.
- **Message Format:** Mandatory parameters include the same `progressToken` and a `progress` number (which must always increase). Optional parameters include a `total` limit estimate (number) and `message` (human-readable text). Progress notification is considered automatically ended when the server finally provides a final `result` or `error` response for the original request.

### B. Request Cancellation (`notifications/cancelled`)
- **Function:** Allows the client to cancel in-flight request processes on the server side, saving system resources (e.g., cancelling a long-running vector embedding or database query).
- **Client Mechanism:** The client sends a one-way notification with method name `notifications/cancelled`. Required parameters are `requestId` (pointing to the ID of the original request to be cancelled), and the client can include a `reason` as an optional parameter.
- **Server Mechanism:** Upon receiving this notification, the server will trigger the `AbortController` associated with that `requestId`.
- **Response:** Processes interrupted by this cancellation will be terminated prematurely, and the server **will not** send a `result` or message reply to the client.

---

## 6. Authorization Specification

### Status: Not Applicable (Local-First)
- **Context:** Because this server operates **local-first** using **STDIO** transport (as an IDE subprocess like Cursor or VSCode), the OAuth 2.1-based MCP Authorization specification **is not applied**.
- **Security:** Access security is fully managed by local filesystem permissions and environment variables where the server is run. According to the MCP specification, STDIO transport is not required (and even suggested not) to implement formal authorization protocols.

---

## 7. Summary of Global Technical & Security Constraints

1. **Strict Validation:** All inputs (URIs, arguments, JSON schemas) must be validated by both parties to prevent exploitation (such as path traversal and command injection).
2. **Capability Negotiation:** Client and server must respect the capabilities declared during initialization. Do not send requests for features that were not declared.
3. **Privacy & Consent:** The protocol heavily emphasizes user control (human-in-the-loop), especially for tool execution, LLM sampling, and sensitive data collection.
4. **Pagination:** For large lists (prompts, resources, tools), implementations should support pagination cursors for memory and transport efficiency.
5. **Transport:** MCP is designed to run entirely on top of JSON-RPC 2.0 (stdio, SSE, etc.), so every request/response must comply with that format, and separate protocol errors from domain errors.

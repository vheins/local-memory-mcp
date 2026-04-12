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

---

## 1. Tools (Model Control)

Tools are executable functions exposed to the LLM to perform actions, interact with the local SQLite database, or retrieve dynamic data. 

### Memory Management Tools
- **`memory-store`**: Stores a new memory. Performs automatic conflict detection before saving.
- **`memory-search`**: Searches for relevant memories using semantic similarity (vector search) and workspace proximity.
- **`memory-update`**: Updates an existing memory.
- **`memory-delete`**: Deletes a specific memory.
- **`memory-bulk-delete`**: Deletes multiple memories in a single operation.
- **`memory-detail`**: Retrieves full details and usage statistics of a specific memory entry.
- **`memory-acknowledge`**: Logs the usage of a memory (Mandatory for the agent after using a memory to write code).
- **`memory-recap`**: Recaps recent memories for context.
- **`memory-summarize`**: Generates a high-level summary of memories.
- **`memory-synthesize`**: Synthesizes memories using client-side sampling (requires client support for `sampling`).

### Task Management Tools
- **`task-list`**: Lists current tasks for the active repository.
- **`task-create`**: Creates a new task.
- **`task-create-interactive`**: Interactively creates a task by requesting user input (requires client support for `elicitation`).
- **`task-update`**: Updates an existing task's status or details.
- **`task-delete`**: Deletes a task.
- **`task-active`**: Marks a specific task as currently active.
- **`task-search`**: Searches for tasks semantically.
- **`task-detail`**: Retrieves full details of a specific task.
- **`task-bulk-manage`**: Manages multiple tasks (create/update/delete) in a single operation.

---

## 2. Resources (Application Control)

Resources expose structured data and context for the LLM to read. The server allows clients to subscribe to resources for real-time updates (`resources/subscribe`).

### Available Resource URIs
- **`memory://index?repo={repo}`**: Lists all active memory entries in JSON format for a specific repository.
- **`memory://tags/{tag}`**: Displays memories filtered by a specific technology tag across all projects.
- **`memory://summary/{repo}`**: A concise, high-level snapshot of all major architectural decisions for a project.
- **`memory://{id}`**: Full details of a single memory entry.
- **`tasks://current?repo={repo}`**: Exposes the current active tasks for a specific repository.

---

## 3. Prompts (User Control)

Prompts are predefined instruction templates that guide model interactions. The server provides various templates to enforce discipline, plan sessions, and perform standardized reviews.

### Available Prompts
- **`architecture-design`**: Guidelines for architectural design.
- **`create-task`**: Template for creating comprehensive tasks.
- **`documentation-sync`**: Instructions for synchronizing documentation with code.
- **`fix-suggestion`**: Template for suggesting and implementing bug fixes.
- **`import-github-issues`**: Instructions to import and map issues from GitHub.
- **`learning-retrospective`**: Template for documenting learnings after a session.
- **`memory-agent-core`**: Basic behavioral contract for memory-aware agents.
- **`memory-guided-review`**: Memory-guided code review instructions.
- **`memory-index-policy`**: Policy on what knowledge should and should not be stored.
- **`project-briefing`**: Project briefing template to set up initial context.
- **`review-and-audit`**: Instructions for reviewing and auditing code.
- **`review-and-post-issue`**: Reviewing and posting a new issue to tracking systems.
- **`root-cause-analysis`**: Guidelines for conducting Root Cause Analysis (RCA).
- **`security-triage`**: Security vulnerability triage instructions.
- **`senior-code-review`**: Senior-level code review checklist.
- **`session-planner`**: Session planning template to structure the upcoming work.
- **`task-management-guidelines`**: Guidelines for managing the task lifecycle.
- **`task-memory-executor`**: Template for executing tasks while relying on stored memory.
- **`tech-affinity-scout`**: Tech affinity scouting template.
- **`technical-planning`**: Technical planning guidelines.
- **`tool-usage-guidelines`**: Technical guidelines for using MCP tools effectively.

---

## 4. Advanced Capabilities Support

- **Completions**: Supported via `completion/complete` to provide autocompletion for prompt arguments or tool inputs.
- **Logging**: The server supports dynamic log level adjustment via `logging/setLevel` and emits structured logs through `notifications/message`.
- **Sampling**: Utilizes the `sampling/createMessage` client capability to generate synthesized memory summaries.
- **Elicitation**: Utilizes the `elicitation/create` client capability for interactive task creation forms.

---

## ⚠️ No Warranty
The MCP interface and responses are provided **"AS IS"** without any warranty.

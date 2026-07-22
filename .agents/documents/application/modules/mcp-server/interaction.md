# Module Documentation: Interaction Layer

## Header & Navigation

- [Module Overview](overview.md)
- [Core API](../../api/mcp-server/api-core.md)

## Responsibility

The Interaction Layer handles the dynamic exchange of information between the agent and the MCP server. It focuses on reducing friction through intelligent suggestions (Completions) and context discovery (Elicitation).

## 1. Smart Completions

The server provides localized completion suggestions for tool parameters:

- **`repo` completion**: Lists active repositories based on the SQLite database contents.
- **`tags` completion**: Suggests existing tags from the global and repo-local namespaces.
- **`file_path` completion**: Scoped path suggestions based on the current workspace root (MCP roots).
- **`task_code` completion**: Active tasks from the `tasks` table with `pending` or `in_progress` status.

## 2. Elicitation Logic (Interactive Feedback)

When an agent provides incomplete data for a mandatory tool call, the server triggers an `elicitation` flow:

- **Missing Repo/Title**: If a tool is called without scope information, the server attempts to infer it from the current MCP roots context. If inference fails, it returns a structured prompt for user input.
- **Validation Gates**: The interaction layer enforces field validation by verifying that required metadata fields are present before committing to the DB.

### Modes

- **Form Mode**: Structured data collection (text, number, boolean) using a restricted subset of JSON Schema (flat objects only). Used by `task-create-interactive`.
- **URL Mode**: Directs the user to an external URL for sensitive interactions (OAuth, payments).

## 3. Session Intelligence

- **Connection Persistence**: The server tracks the lifecycle of the `MCPClient` to ensure shared resources are released on disconnect.
- **Project Discovery**: Automatically identifies the active repository by comparing MCP roots (workspace directories) against registered repository paths.
- **Scope Injection**: Automatically injects `owner`, `repo`, and `folder` from session context into all tool calls, so agents don't need to specify them manually.

## 4. Sampling (Agent-to-Client)

- **Use case**: `memory-synthesize`.
- **Flow**: The server asks the client (IDE) to generate a high-level message or summary using its LLM.
- **Requires**: `capabilities.sampling` to be enabled on the client side.
- **Supports**: Model preferences through hints (model name suggestions) and priorities (cost, speed, intelligence).

## Business Invariants

| Rule                             | Description                                                                                                                         |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| **No-Retry Rule**                | Long-running operations (like `memory-synthesize`) return "Processing" status and prevent duplicate triggers from the same session. |
| **Structured Content Awareness** | Tool results MUST use `structuredContent` for machine data. `content` array contains concise text summary + pointer message.        |
| **Pointer Pattern**              | The `createMcpResponse` utility auto-appends a pointer suffix guiding agents to `structuredContent`.                                |
| **Validation**                   | All inputs are validated via Zod schemas before processing. Invalid inputs return Protocol Error `-32602`.                          |

## 5. Logging Service

The server implements a runtime-configurable logging service.

- **Methods**: `logging/setLevel`.
- **Levels**: `debug`, `info`, `warn`, `error`.
- **Persistence**: All tool calls (including inputs, outputs, and timestamps) are persisted to `action_log` for full auditability.

# Module Documentation: Interaction Layer

## Responsibility
The Interaction Layer handles the dynamic exchange of information between the agent and the MCP server. It focuses on reducing friction through intelligent suggestions (Completions) and context discovery (Elicitation).

## 1. Smart Completions
The server provides localized completion suggestions for tool parameters:
- **`repo` completion**: Lists active repositories based on the established SQLite directory.
- **`tags` completion**: Suggests existing tags from the global and repo-local namespaces.
- **`file_path` completion**: Scoped path suggestions based on the current workspace root.
- **`task_code` completion**: Active tasks from the `tasks` table with a `pending` or `in_progress` status.

## 2. Elicitation Logic (Interactive Feedback)
When an agent provides incomplete data for a mandatory tool call, the server triggers an `elicitation` flow:
- **Missing Repo/Title**: If `task-create` is called without a repo name, the server attempts to infer it from the current directory context. If inference fails, it returns a structured prompt for user input.
- **Validation Gates**: The interaction layer enforces "Definition of Done (DoD)" by verifying that required metadata fields (like `role` and `agent`) are present before committing to the DB.

## 3. Session Intelligence
- **Connection Persistence**: The server tracks the lifecycle of the `MCPClient` to ensure shared resources are released on disconnect.
- **Project Discovery**: Automatically identifies the "Active Project" by comparing the current working directory (CWD) against registered repository paths.
- **Instruction Context**: Injects the repository's `Project Overview` into every prompt call to ensure the agent is permanently aware of global architectural rules.

## Business Invariants
- **No-Retry Rule**: For long-running operations like `memory.synthesize`, the interaction layer returns a "Processing" status and prevents duplicate triggers from the same session ID.
- **Structured Content Awareness**: To minimize token waste and ensure precision, tool results MUST NOT redundantly embed large JSON strings in the `content` array. Instead:
    - The `content` array contains a concise text summary and a explicit **Pointer Message** (e.g., "See `structuredContent` for details").
    - The `structuredContent` extension field carries the full, machine-readable data payload.
    - Agents are expected to parse `structuredContent` for all subsequent reasoning steps.

### Invariant Logic
- **Pointer Pattern**: The `createMcpResponse` utility automatically appends a pointer suffix to the text content, guiding the agent to the specific path in the structured response.
## 3. Sampling & Elicitation
Advanced patterns for multi-turn or human-in-the-loop interactions.

### Sampling (Agent-to-Client)
- Use case: `memory-synthesize`.
- The server asks the client (IDE) to generate a high-level message or summary using its more powerful LLM context.
- Requires `capabilities.sampling` to be enabled on the client side.

### Elicitation (Server-to-Human)
- Use case: `task-create-interactive`.
- The server pauses tool execution and requests structured input from the human user through the client UI.
- **Modes**:
    - `form`: Requests specific JSON-schema-validated fields.
    - `url`: Redirects the user to a specific URI for complex configuration or confirmation.

## 4. Logging Service
The server implements a runtime-configurable logging service.
- **Methods**: `logging/setLevel`.
- **Levels**: `debug`, `info`, `warn`, `error`.
- **Persistence**: Errors and audit-critical logs are persisted to the `action_log` via the `Activity Service`.

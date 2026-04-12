# Module Documentation: Intelligent Interaction Layer

## Responsibility
The Interaction Layer manages the sophisticated communication patterns between the AI Agent and the MCP Client. It provides "Smart Context" by inferring environment details and provides "Self-Correcting UI" through completions and elicitations.

## 1. Smart Completions
The server provides real-time suggestions for tool and resource arguments to reduce agent hallucination and improve input accuracy.

### Completion Sources
- **Repos**: Suggestions extracted from active filesystem roots and the `repositories` table.
- **Tags**: Unique technology tags (e.g., `react`, `typescript`) found in existing memories.
- **File Paths**: Scoped file path suggestions (limited to 300 results) based on the active MCP session roots.
- **Tasks**: Active `task_code` suggestions filtered by the inferred or provided repository.

## 2. Session Intelligence
The server maintains a stateless (but context-aware) session for every connection.

### Invariant Logic
- **Root Detection**: Automatically identifies the "active" project root by searching for `.git` or `.gemini` markers upward from the `current_file_path`.
- **Repo Inference**: If no `repo` is provided in tool arguments, the server infers it from the `basename` of the detected project root.
- **Path Guarding**: All absolute paths provided to the server are validated against the active MCP roots. The server will reject any path outside these bounds to prevent directory traversal.

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

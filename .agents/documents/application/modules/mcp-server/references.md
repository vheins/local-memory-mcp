# Module Documentation: Reference Catalog (Resources & Prompts)

## Responsibility
The Reference Catalog exposes the internal knowledge and templates of the system through standard MCP primitives. This allows agents to "self-discover" project status and follow established behavioral patterns.

## 1. Resources
Resources provide read-only access to specialized data views and global knowledge.

### Knowledge Resources
- **URI**: `memory://index`
    - **Description**: Provides a paginated list of all active memories in the current system context.
- **URI**: `memory://index?repo=[repo]`
    - **Description**: Scoped memory index for a specific repository.
- **URI**: `memory://summary/[repo]`
    - **Description**: Retrieves the high-level global summary/signal for the specified repository (updated via `memory.summarize`).
- **URI**: `memory://[id]`
    - **Description**: Direct access to a specific memory entry by its UUID.

### Task Resources
- **URI**: `tasks://current?repo=[repo]`
    - **Description**: Displays the active Kanban board for a repository, including pointer tables for each status.

## 2. Prompts
Prompts provide reusable templates that guide agent behavior for specific workflows.

### Agent Lifecycle Prompts
- **Name**: `memory-agent-core`
    - **Role**: Standard initialization for any agent integrating with the Local Memory MCP.
    - **Arguments**:
        - `repo` (required): The target repository name.
    - **Behavior**: Instructs the agent on how to use `task-active` to sync status and `memory-search` to hydrate context.

- **Name**: `task-orchestrator`
    - **Role**: Specialized for managing complex multi-task initiatives.
    - **Behavior**: Provides instructions on using `parent_id` for hierarchical task decomposition.

## 3. Subscription & Observability
The server supports the `resources/subscribe` capability.
- When an agent calls a mutating tool (e.g., `memory-store` or `task-update`), the server automatically emits `notifications/resources/list_changed` or `notifications/resources/updated` for the affected URIs.
- This allows real-time UI updates in the client (IDE) when the background knowledge base changes.

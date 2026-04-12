# Module Documentation: Reference Catalog (Resources & Prompts)

## Responsibility
The Reference Catalog exposes the internal knowledge and templates of the system through standard MCP primitives. This allows agents to "self-discover" project status and follow established behavioral patterns.

## 1. Resources
Resources provide read-only access to specialized data views and global knowledge.

### Knowledge Resources
- **URI**: `memory://memories`
    - **Description**: Paginated list of all active memories in the system context.
- **URI**: `memory://memories?repo={repo}&type={type}&tag={tag}`
    - **Description**: Filtered list of memories by repository, entry type, or technology tag.
- **URI**: `memory://memories/{id}`
    - **Description**: Direct access to a specific memory entry (full details and statistics) by UUID.
- **URI**: `memory://memories/search/{base64_query}?repo={repo}`
    - **Description**: Scoped semantic search results for a repository.
- **URI**: `memory://repositories/{repo}/summary`
    - **Description**: Retrieves the high-level global summary/signal for the specified repository (updated via `memory.summarize`).

### Task Resources
- **URI**: `task://tasks`
    - **Description**: Paginated list of all tasks in the system context.
- **URI**: `task://tasks?repo={repo}&status={status}&priority={priority}`
    - **Description**: Scoped task list with filtering by repository, Kanban status, or priority.
- **URI**: `task://tasks/{id}`
    - **Description**: Direct access to a specific task (full description and comments) by UUID.

### Audit Resources
- **URI**: `action://actions`
    - **Description**: Paginated stream of all agent tool actions.
- **URI**: `action://actions?repo={repo}&action={action}`
    - **Description**: Filtered audit logs by repository or specific action type.

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

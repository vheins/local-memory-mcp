# Module Documentation: Reference Catalog (Resources & Prompts)

## Responsibility
The Reference Catalog exposes the internal knowledge and templates of the system through standard MCP primitives. This allows agents to "self-discover" project status and follow established behavioral patterns.

## 1. Resources
Resources provide read-only access to specialized data views and global knowledge using a repository-scoped URI scheme.

### Global Resources
- **URI**: `repository://index`
    - **Description**: List of all available repositories in the system, including memory counts, task counts, and last activity timestamps.
- **URI**: `session://roots`
    - **Description**: List of active workspace roots provided by the current client session.

### Knowledge Resources
- **URI**: `repository://{name}/memories`
    - **Description**: Paginated list of all active memories for the specified repository.
- **URI**: `repository://{name}/memories?search={search}&type={type}&tag={tag}`
    - **Description**: Filtered list of memories scoped to a repository, filterable by text search, entry type, or technology tag.
- **URI**: `memory://{id}`
    - **Description**: Direct access to a specific memory entry (full details and statistics) by its UUID.
- **URI**: `repository://{name}/summary`
    - **Description**: Retrieves the high-level global summary/signal for the specified repository (updated via `memory.summarize`).

### Task Resources
- **URI**: `repository://{name}/tasks`
    - **Description**: Paginated list of all tasks for the specified repository.
- **URI**: `repository://{name}/tasks?status={status}&priority={priority}`
    - **Description**: Scoped task list for a repository with filtering by Kanban status or priority level.
- **URI**: `task://{id}`
    - **Description**: Direct access to a specific task (full description and comments) by its UUID.

### Audit Resources
- **URI**: `repository://{name}/actions`
    - **Description**: Paginated stream of all agent tool actions logged within the specified repository.
- **URI**: `action://{id}`
    - **Description**: Direct access to a specific action audit log entry by its integer ID.

## 2. Prompts
Prompts provide reusable templates that guide agent behavior for specific workflows, integrating tightly with the memory and task systems.

### Core Lifecycle Prompts
- **Name**: `memory-agent-core`
    - **Role**: Essential behavioral contract for any memory-aware agent.
    - **Behavior**: Instructs the agent on how to use `memory-search` with `current_file_path`, when to call `memory-acknowledge`, and how to handle knowledge conflicts via `supersedes`.

- **Name**: `project-briefing`
    - **Role**: Onboarding template for starting a new session in a repository.
    - **Behavior**: Guides the agent to discover recent knowledge, pending tasks, and key architectural decisions to establish rapid situational awareness.

### Specialized Workflow Prompts
- **Name**: `task-orchestrator`
    - **Role**: Specialized for managing complex multi-task initiatives.
    - **Behavior**: Provides instructions on using `parent_id` for hierarchical task decomposition and status tracking.

- **Name**: `senior-code-review`
    - **Role**: High-standard review template focused on project-specific patterns.
    - **Behavior**: Ensures reviews align with stored decisions and avoid previously documented mistakes.

- **Name**: `root-cause-analysis`
    - **Role**: Debugging template for tracing bugs back to their origin.
    - **Behavior**: Uses memory of past mistakes and patterns to accelerate the identification of causal chains.

## 3. Subscription & Observability
The server supports the `resources/subscribe` capability.
- When an agent calls a mutating tool (e.g., `memory-store` or `task-update`), the server automatically emits `notifications/resources/list_changed` or `notifications/resources/updated` for the affected URIs.
- This allows real-time UI updates in the client (IDE) when the background knowledge base changes.

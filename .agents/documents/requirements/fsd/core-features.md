# Functional Specification Document (FSD)

This document specifies the functional behavior of the `local-memory-mcp` application.

## 1. Knowledge Management (Memory)
- **Description**: Provides storage, retrieval, and synthesis of semantic context snippets and behavioral patterns.
- **Key Tools**:
  - `memory-store`: Store a new human-auditable knowledge entry (e.g., `code_fact`, `decision`, `mistake`).
  - `memory-search`: NAVIGATION LAYER: Returns a pointer table of matching memory IDs.
  - `memory-synthesize`: Advanced reasoning tool that synthesizes grounded answers using the client's LLM.
  - `memory-detail`: Fetch full content and metadata for a specific memory by its ID.
  - `memory-acknowledge`: (MANDATORY) Acknowledge the use of a memory or report its irrelevance.
  - `memory-update`: Update an existing memory entry (e.g., status, importance, or metadata).
  - `memory-delete` / `memory-bulk-delete`: Soft-delete or remove multiple memory entries.
  - `memory-summarize`: Update the high-level global summary for a repository.
  - `memory-recap`: AGGREGATED OVERVIEW: Returns stats and top memories in a repo.
- **Rules**:
  - Titles must be unique within a repository scope.
  - Importance must be between 1 (low) and 5 (critical).
  - Normalization: The system automatically maps dot-notation names (e.g., `memory.store`) to internal hyphenated IDs (`memory-store`).

## 2. Task Management
- **Description**: Tracks agent progress and prevents developmental amnesia through a structured Kanban lifecycle.
- **Key Tools**:
  - `task-list`: PRIMARY navigation and search tool. Returns a tabular list of tasks.
  - `task-create`: Register a new task. Supports MCP elicitation fallbacks for missing fields.
  - `task-detail`: Fetch full description, phase, priority, and all comments for a specific task.
  - `task-update`: Progress a task through its lifecycle (Backlog → Pending → In Progress → Completed).
  - `task-bulk-manage`: Batch management for bulk creation, deletion, or status updates.
  - `task-delete`: Hard deletion of a task record.
- **Statuses**: `backlog`, `pending`, `in_progress`, `completed`, `canceled`, `blocked`.
- **Logic Rules**:
  - **Single Active Focus**: Ideally only one task per repo should be `in_progress` at any time.
  - **Transition Gate**: Tasks CANNOT move to `completed` from `pending`. They MUST move through `in_progress`.
  - **Token Transparency**: Actual token usage must be logged upon task completion.

## 3. Reference Catalog (Resources & Prompts)
- **Description**: Exposes internal knowledge, templates, and audit logs through standard MCP primitives.
- **Resources**:
  - `repository://{name}/memories`: Paginated list of memories.
  - `repository://{name}/tasks`: Paginated list of tasks.
  - `repository://{name}/summary`: Global summary for a repository.
  - `repository://{name}/actions`: Audit stream of agent tool actions.
- **Prompts**:
  - `memory-agent-core`: Essential behavioral contract for memory-aware agents.
  - `project-briefing`: Onboarding template for starting a new session.
  - `task-orchestrator`: Specialized for managing complex multi-task initiatives.

## 4. Dashboard UI
- **Tabs**: Dashboard (Stats), Activity (Audit), Memories (Search), Tasks (Kanban), Reference (Capability).
- **Functionality**: Real-time data fetching without full-page reloads using Svelte 5 logic.

## 5. Activity Audit
- **Requirement**: Every call to the `local-memory-mcp` tools must generate an entry in the `activity` table.
- **Content**: Input parameters, execution timestamp, and results summary.
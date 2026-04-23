# Domain Model

This document specifies the core entities and business logic of the MCP Local Memory system.

## Core Entities

### 1. Memory
Represents a distilled unit of knowledge or a project artifact captured by an AI agent.

- **Attributes:**
  - `id`: UUID Primary Key.
  - `type`: `code_fact`, `decision`, `mistake`, `pattern`, `task_archive`.
  - `scope`: Geographic constraints (`repo`, `branch`, `folder`, `language`).
  - `agent`, `role`, `model`: Attribution metadata for the creator.
  - `importance`: 1 (Low) to 5 (Critical) rating.
  - `hit_count`, `recall_count`: Utility metrics (automatic tracking).
  - `status`: Lifecycle state (`active`, `archived`).
  - `is_global`: 1 if shared across all repositories.

### 2. Task
Represents an atomic unit of work tracked for multi-agent coordination.

- **Attributes:**
  - `id`: UUID Primary Key.
  - `task_code`: Human-readable identifier (e.g., `TASK-123`).
  - `status`: `backlog`, `pending`, `in_progress`, `completed`, `canceled`, `blocked`.
  - `priority`: 1 to 5.
  - `hierarchy`: `parent_id` and `depends_on` (sequencing).
  - `est_tokens`: Estimated resource consumption (recorded on completion).

### 3. Task Comment
A chronological audit log for tasks, capturing discussions and status transitions.

- **Attributes:**
  - `comment`: Text content.
  - `transition`: Captures `previous_status` and `next_status` for auditability.
  - `attribution`: Linked to a specific agent and role.

### 4. Action Log
High-fidelity telemetry capturing every system operation (tool call).

- **Attributes:**
  - `action`: Name of the tool invoked.
  - `query`: The primary search or input term.
  - `result_count`: Quantifiable impact of the action.

### 5. Handoff
Represents transient coordination state passed between agents.

- **Attributes:**
  - `from_agent` / `to_agent`: Source and optional destination agent.
  - `task_id`: Optional associated task.
  - `summary`: Short handoff objective.
  - `context`: Structured transfer payload.
  - `status`: `pending`, `accepted`, `rejected`, `expired`.

### 6. Claim
Represents task ownership in the dedicated coordination layer.

- **Attributes:**
  - `task_id`: Claimed task.
  - `agent`, `role`: Current owner attribution.
  - `claimed_at`, `released_at`: Claim lifecycle timestamps.
  - `metadata`: Structured operational context.

---

## Business Rules & Invariants

### 1. Task Workflow
- **Gradual Promotion**: A task cannot transition directly from `backlog`, `pending`, or `blocked` to `completed`. It must be moved to `in_progress` first to ensure transparency.
- **Auto-Archiving**: When a `task` status is set to `completed`, the system automatically generates a `task_archive` memory entry containing the task's full history and comments for future lookup.

### 2. Capacity Constraints
- **Pending Throttle**: A single repository can have at most **10 tasks** in the `pending` state. New tasks exceeding this limit must be placed in the `backlog`.

### 3. Attribution Requirement
- All mutations (storing memories, creating tasks, adding comments) must include `agent` and `role` metadata to maintain a clear chain of responsibility in multi-agent environments.

### 4. Scope Isolation
- Memories and tasks are strictly isolated by `repo` unless explicitly marked as `is_global`.
- Vector search automatically honors repo-scoping during retrieval unless a global search is requested.

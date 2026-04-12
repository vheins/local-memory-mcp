# Database Schema

This document specifies the database schema used in the MCP Local Memory system. The implementation logic for these tables is modularly distributed across specialized entities in `src/mcp/entities/` (inheriting from `src/mcp/storage/base.ts`).

## Tables

### `memories`
The primary storage for knowledge items. Knowledge is scoped by repository and supports semantic tracking and expiration.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT | Primary Key (UUID). |
| `repo` | TEXT | Repository identifier for scoping. |
| `type` | TEXT | Memory type (e.g., code_fact, decision, pattern). |
| `title` | TEXT | Human-readable title. |
| `content` | TEXT | The main body of the memory. |
| `importance` | INTEGER | Rating from 1 (Low) to 5 (Critical). |
| `folder` | TEXT | Optional folder path scoping. |
| `language` | TEXT | Optional programming language scoping. |
| `created_at` | TEXT | ISO-8601 creation timestamp. |
| `updated_at` | TEXT | ISO-8601 update timestamp. |
| `hit_count` | INTEGER | Number of times the memory was retrieved. |
| `recall_count` | INTEGER | Number of times the memory was successfully recalled in code generation. |
| `last_used_at` | TEXT | ISO-8601 timestamp of last retrieval. |
| `expires_at` | TEXT | Optional ISO-8601 timestamp for automatic expiration. |
| `supersedes` | TEXT | ID of the memory this entry replaces. |
| `status` | TEXT | Current status (`active`, `archived`). |
| `is_global` | INTEGER | 1 if shared across all repositories, 0 otherwise. |
| `tags` | TEXT | JSON array of strings. |
| `metadata` | TEXT | JSON object for arbitrary task/agent context. |
| `agent` | TEXT | Name of the agent that created the memory. |
| `role` | TEXT | Role of the creator (e.g., Composite Senior Authority). |
| `model` | TEXT | AI model used at time of creation. |
| `completed_at` | TEXT | Finalized timestamp for task-related facts. |

### `tasks`
Manages project execution and coordination between agents.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT | Primary Key (UUID). |
| `repo` | TEXT | Repository identifier. |
| `task_code` | TEXT | Short human-readable code (e.g., TASK-001). |
| `phase` | TEXT | Project phase (e.g., Research, Implementation). |
| `title` | TEXT | Task objective. |
| `description` | TEXT | Detailed task instructions. |
| `status` | TEXT | `backlog`, `pending`, `in_progress`, `completed`, `canceled`, `blocked`. |
| `priority` | INTEGER | 1 (Low) to 5 (High). |
| `agent` | TEXT | Current agent assigned to the task. |
| `role` | TEXT | Role of the assigned agent. |
| `doc_path` | TEXT | Path to relevant documentation. |
| `created_at` | TEXT | ISO-8601 timestamp. |
| `updated_at` | TEXT | ISO-8601 timestamp. |
| `finished_at` | TEXT | Completion timestamp. |
| `canceled_at` | TEXT | Cancellation timestamp. |
| `tags` | TEXT | JSON array of strings. |
| `metadata` | TEXT | JSON blob for custom state. |
| `parent_id` | TEXT | Foreign Key to `tasks(id)` for hierarchy. |
| `depends_on` | TEXT | Foreign Key to `tasks(id)` for sequencing. |
| `est_tokens` | INTEGER | Estimated total tokens used for task execution. |
| `in_progress_at` | TEXT | Timestamp when task moved to `in_progress`. |

### `task_comments`
Audit trail and discussion history for tasks.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT | Primary Key (UUID). |
| `task_id` | TEXT | Foreign Key to `tasks(id)`. |
| `repo` | TEXT | Scoping identifier. |
| `comment` | TEXT | The comment content. |
| `agent` | TEXT | Author name. |
| `role` | TEXT | Author role. |
| `model` | TEXT | AI model used. |
| `previous_status` | TEXT | Task status before this comment. |
| `next_status` | TEXT | Task status after this comment. |
| `created_at` | TEXT | ISO-8601 timestamp. |

### `memory_vectors`
Storage for semantic embeddings used in vector search.

| Column | Type | Description |
| :--- | :--- | :--- |
| `memory_id` | TEXT | Primary Key / Foreign Key to `memories(id)`. |
| `vector` | TEXT | JSON serialized Float32Array. |
| `vector_version` | INTEGER| Version of the embedding model used. |
| `updated_at` | TEXT | ISO-8601 timestamp. |

### `memory_summary`
Condensed repository-level context.

| Column | Type | Description |
| :--- | :--- | :--- |
| `repo` | TEXT | Primary Key (Repository Name). |
| `summary` | TEXT | Markdown summary of project state. |
| `updated_at` | TEXT | ISO-8601 timestamp. |

### `action_log`
Chronological record of system usage for performance and audit analysis.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER | Primary Key (Autoincrement). |
| `action` | TEXT | Tool or operation name. |
| `query` | TEXT | Input parameters or search query. |
| `response` | TEXT | Summary or full raw response. |
| `memory_id` | TEXT | Optional link to associated memory. |
| `task_id` | TEXT | Optional link to associated task. |
| `repo` | TEXT | Repository scope. |
| `result_count` | INTEGER | Number of items returned. |
| `created_at` | TEXT | ISO-8601 timestamp. |

### `memories_archive`
Historical storage for evicted memories. Mirrors the `memories` table with an additional `archived_at` timestamp.

## Indexes
- `idx_memories_repo_created_at`: Efficient retrieval of recent project knowledge.
- `idx_memories_repo_hit_count`: Performance-based ranking.
- `idx_tasks_repo_status`: Optimized task board rendering.
- `idx_action_log_repo_created_at`: Efficient history pagination.
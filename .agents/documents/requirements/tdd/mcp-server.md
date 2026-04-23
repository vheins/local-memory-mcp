# Technical Design Document (TDD)

## Architecture Overview
The system implements a local-first Model Context Protocol (MCP) server designed for semantic memory management and task lifecycle tracking.

## Core Components
- **Persistence Engine**: SQLite (via `better-sqlite3`) with FTS5 enabled for full-text indexing.
- **Embedding Engine**: Local ONNX execution via `@xenova/transformers`. Uses `Xenova/all-MiniLM-L6-v2` by default.
- **State Management**: ACID-compliant transactions for atomic task updates and bulk operations.
- **Communication Layer**: MCP Standard (STDIO/JSON-RPC 2.0).

## Database Schema (Production)

### `memories` Table
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | PK |
| type | TEXT | code_fact, decision, mistake, pattern, task_archive |
| title | TEXT | Short descriptor (Indexed FTS5) |
| content | TEXT | Body (Indexed FTS5) |
| embedding | BLOB | 384-dim Float32 vector |
| importance | INTEGER | 1-5 Ranking |
| is_global | BOOLEAN | Cross-repo visibility |
| metadata | TEXT (JSON) | Role, Agent, Tags |

### `tasks` Table
- **Columns**: `id`, `task_code` (Unique), `title`, `description`, `status`, `phase`, `priority`, `agent`, `role`, `est_tokens`, `parent_id`, `comments` (JSON).

### `handoffs` / `claims` Tables
- **Purpose**: Store transient agent coordination state outside the durable memory index.
- **Access Pattern**: Exposed through `handoff-create`, `handoff-list`, and `task-claim`.

## Reference Catalog (MCP Primitives)

### Prompts (Templates)
- `memory-agent-core`: Behavioral contract for memory usage and conflict resolution.
- `project-briefing`: Rapid situational awareness for new sessions.
- `task-orchestrator`: Management logic for multi-task initiatives.
- **Auto-Injection**: The system automatically replaces `{{current_repo}}` in all prompt templates with the active repository name from the session context.

## Logic Implementation
- **Hybrid Search**: Score = (Cosine_Similarity * 0.7) + (BM25_Score * 0.3).
- **Collision Detection**: `memory-store` performs semantic conflict checking (threshold 0.55) to prevent duplicate knowledge entries.
- **Task Lifecycle**: Enforced via `TaskService` middleware ensuring `in_progress` transition before `completed`.
- **Automatic Archiving**: Completing a task automatically triggers `archiveTaskToMemory`, generating a `task_archive` memory entry containing the full description and comment history.
- **Bulk Constraints**: All bulk operations use a transaction chunk size of **500** records to respect SQLite variable limits.
- **Normalization**: Automatically maps dot-notation names (e.g., `memory.store`) to internal hyphenated IDs (`memory-store`).

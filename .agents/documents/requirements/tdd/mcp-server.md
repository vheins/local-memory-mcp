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
| type | TEXT | code_fact, decision, mistake, pattern, agent_handoff |
| title | TEXT | Short descriptor (Indexed FTS5) |
| content | TEXT | Body (Indexed FTS5) |
| embedding | BLOB | 384-dim Float32 vector |
| importance | INTEGER | 1-5 Ranking |
| is_global | BOOLEAN | Cross-repo visibility |
| metadata | TEXT (JSON) | Role, Agent, Tags |

### `tasks` Table
- **Columns**: `id`, `task_code` (Unique), `title`, `description`, `status`, `phase`, `priority`, `agent`, `role`, `est_tokens`, `parent_id`.

### `activity` Table
- **Columns**: `id`, `tool`, `input`, `output_summary`, `timestamp`.

## Logic Implementation
- **Hybrid Search**: Score = (Cosine_Similarity * 0.7) + (BM25_Score * 0.3).
- **Task Lifecycle**: Enforced via `TaskService` middleware ensuring `in_progress` transition before `completed`.
- **Privacy Policy**: All data is stored in the user's `@appDataDir` (e.g., `~/.gemini/antigravity`).
# Database Schema Plan

## Tables

### `memories`
- `id` (TEXT, PRIMARY KEY) - UUID.
- `type` (TEXT, NOT NULL) - Enum (decision, doc, rule, summary).
- `title` (TEXT, NOT NULL).
- `content` (TEXT, NOT NULL).
- `embedding` (BLOB) - Byte array for the Xenova Float32Array embedding.
- `importance` (INTEGER, DEFAULT 1) - Value 1 to 5.
- `tags` (TEXT) - JSON Array of tags.
- `repo` (TEXT) - The repository identifier to scope context.
- `created_at` (INTEGER) - Timestamp.
- `updated_at` (INTEGER) - Timestamp.
- `deleted_at` (INTEGER) - Soft delete indicator.

### `tasks`
- `id` (TEXT, PRIMARY KEY) - UUID.
- `title` (TEXT, NOT NULL).
- `description` (TEXT).
- `status` (TEXT, NOT NULL) - Enum (pending, active, completed, failed, archived).
- `repo` (TEXT) - Scoping identifier.
- `created_at` (INTEGER).
- `updated_at` (INTEGER).

### `usage_logs`
- `id` (TEXT, PRIMARY KEY).
- `memory_id` (TEXT, FOREIGN KEY references `memories(id)`).
- `action` (TEXT, NOT NULL).
- `timestamp` (INTEGER).

## Indexes
- B-Tree index on `repo` for `memories` and `tasks`.
- Full-text search (FTS5) table mapping for `memories.content` and `memories.title` to support hybrid search with vectors.
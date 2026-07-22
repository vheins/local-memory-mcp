# Test Scenarios: Task Management

## Header & Navigation

- [MCP Server Module Overview](../../modules/mcp-server/overview.md)
- [Task Feature](../../modules/mcp-server/task.md)
- [Task API](../../api/mcp-server/api-task.md)

Verification of the stateful task orchestration framework and transition safety.

## 1. `task-create`

- **Positive:** Create single task with valid fields. Verify UUID, task_code, and default status returned.
- **Positive:** Bulk create 10 tasks via `tasks` array. Verify all visible in `task-list`.
- **Negative:** Duplicate `task_code` in same repo. Expected: Constraint Error.
- **Negative:** Missing `title`. Expected: Validation Error (Zod).

## 2. `task-update` (Lifecycle Transitions)

- **State Machine Integrity:**
  - `backlog` -> `pending` (Allowed)
  - `pending` -> `in_progress` (Allowed)
  - `pending` -> `completed` (Blocked — must be `in_progress` first)
  - `blocked` -> `completed` (Blocked — must be `in_progress` first)
  - `in_progress` -> `completed` (Allowed IF `est_tokens` provided)
  - `in_progress` -> `completed` (Blocked IF `est_tokens` missing)
- **Positive:** Update status with `comment`. Verify comment stored in `task_comments`.

## 3. `task-delete`

- **Positive:** Delete single task by `id`. Verify task removed from `task-list`.
- **Positive:** Bulk delete by `ids` array. Verify all removed.
- **Positive:** Verify associated `task_comments` also removed (CASCADE).

## 4. `task-list`

- **Positive:** List tasks with no status filter. Verify defaults to `backlog,pending,in_progress,blocked`.
- **Positive:** Filter by `status: "completed"`. Verify only completed tasks returned.
- **Positive:** Filter by `query` keyword. Verify matching tasks returned by title or task_code.

## 5. `task-detail`

- **Positive:** Fetch by UUID. Verify full attributes including task_code, status, comments.
- **Positive:** Fetch by `task_code`. Verify same result as UUID lookup.
- **Negative:** Non-existent ID. Expected: Not Found.

## 6. `task-search`

- **Positive:** Search by `task_code` (unique match). Verify exact task returned.
- **Positive:** Search by `title` keyword. Verify semantic match ranking.

## 7. `task-create-interactive`

- **Positive:** Trigger elicitation for missing fields. Verify structured prompt returned.
- **Negative:** Client without elicitation capability. Expected: Fallback to standard error.

## 8. Transactional Integrity (Bulk Operations)

- **Positive:** Bulk create + update in single call. Verify all operations committed atomically.
- **Positive:** If one item in bulk fails validation, verify entire operation rolled back.

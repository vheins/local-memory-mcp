# Test Scenarios: Task Management

Verification of the stateful task orchestration framework and transition safety.

## 1. `task.manage` (Lifecycle Transitions)
- **State Machine Integrity:**
  - `backlog` -> `pending` (Allowed)
  - `pending` -> `in_progress` (Allowed)
  - `pending` -> `completed` (Blocked - must be `in_progress` first)
  - `blocked` -> `completed` (Blocked - must be `in_progress` first)
  - `in_progress` -> `completed` (Allowed IF `est_tokens` provided)
  - `in_progress` -> `completed` (Blocked IF `est_tokens` missing)

## 2. `task.manage` (Safety Hooks)
- **Uniqueness:** Attempt to create task with existing `task_code`. Expected: Constraint Error.
- **Mandatory Logic:** Moving to `completed` requires a `comment`. Verify rejection if comment is empty.
- **Agent Context:** Verify `agent` and `role` metadata are successfully persisted per update.

## 3. `task.bulk-manage`
- **Transactional Integrity:** Provide 1 valid creation and 1 invalid update. Verify that the creation is ROLLED BACK and not visible in storage.
- **Volume:** Bulk create 10 tasks. Verify all visible in `task.list`.

## 4. `task.search`
- **Hybrid Matching:** Search by `task_code` (unique match) vs search by `description` (semantic match). Verify ranking.
- **Priority Filter:** Search with `priority >= 4`.

## 5. `task.get`
- **Positive:** Provide `task_code`. Verify full model returned.
- **Negative:** Non-existent ID. Expected: Not Found.

## 6. Resources (`tasks://current`)
- **Positive:** Change active task. Verify that the MCP server emits a resource update notification to subscribed clients.
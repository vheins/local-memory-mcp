---
name: export-task-to-github
description: Export local tasks to GitHub Issues
arguments:
  - name: task_id
    description: Local task ID. Optional — if omitted, all tasks in the active repo are exported.
    required: false
agent: Integration Architect
---

## 1. IDENTIFY ACTIVE PROJECT
1.  **Detect**: Get repo name and owner from git remote (e.g. `git remote get-url origin`) or active workspace context. Parse `owner` and `repo` from the remote URL automatically.
2.  **Verify**: Confirm the detected `owner`/`repo` before proceeding.

## 2. RETRIEVE
1.  **Scope**: If `task_id` provided — fetch that single task via `task-detail`. If omitted — call `task-list` (status: `pending,in_progress,completed`) to get all tasks in the active repo, then process each.
2.  **Verify**: Ensure title/description exist per task. Use `memory-search` for gaps.

## 3. SYNC CHECK
1.  **Search**: Use `search_issues` for `task_code` scoped to detected `owner`/`repo`.
2.  **De-duplicate**: If issue exists, update local task `metadata` with URL. DO NOT re-create.

## 4. CREATE ISSUE
If new:
-   **Write**: Use `issue_write` (method: 'create') with detected `owner`/`repo`.
-   **Content**: Match local title/body exactly.
-   **Traceability**: Append `task_code` and `task_id` to body.
-   **Comments**: Post local comments via `add_issue_comment`.

## 5. LINK
-   **Update**: Call `task-update`.
-   **Metadata**: Add GitHub URL.
-   **Comment**: "Exported to GitHub Issue #X".

## ✅ OUTPUT: MCP ONLY
ONLY call: `task-detail`, `task-update`, `search_issues`, `issue_write`, `add_issue_comment`.
No prose. No modifications to original content.

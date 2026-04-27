---
name: export-task-to-github
description: Export local tasks to GitHub Issues
arguments:
  - name: owner
    description: GitHub repo owner
    required: true
  - name: repo
    description: GitHub repo name
    required: true
  - name: task_id
    description: Local task ID
    required: true
agent: Integration Architect
---

## 1. RETRIEVE
1.  **Fetch**: Call `task-detail` for `task_id`.
2.  **Verify**: Ensure title/description exist. Use `memory-search` for gaps.

## 2. SYNC CHECK
1.  **Search**: Use `search_issues` for `task_code`.
2.  **De-duplicate**: If issue exists, update local task `metadata` with URL. DO NOT re-create.

## 3. CREATE ISSUE
If new:
-   **Write**: Use `issue_write` (method: 'create').
-   **Content**: Match local title/body exactly.
-   **Traceability**: Append `task_code` and `task_id` to body.
-   **Comments**: Post local comments via `add_issue_comment`.

## 4. LINK
-   **Update**: Call `task-update`.
-   **Metadata**: Add GitHub URL.
-   **Comment**: "Exported to GitHub Issue #X".

## ✅ OUTPUT: MCP ONLY
ONLY call: `task-detail`, `task-update`, `search_issues`, `issue_write`, `add_issue_comment`.
No prose. No modifications to original content.

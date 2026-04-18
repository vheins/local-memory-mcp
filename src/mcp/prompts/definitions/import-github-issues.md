---
name: import-github-issues
description: Import GitHub Issues as local tasks.
arguments: []
agent: Integration Scout
---
# Skill: import-github-issues

## 1. FETCH
-   **Primary**: Use `github-mcp-server` to list open issues.
-   **Fallback**: Terminal `gh issue list --json number,title,body,labels,url`.

## 2. DE-DUPLICATE
-   **Scan**: Call `task-list`. Skip issues already existing as `GH-{{number}}` task codes.

## 3. MAP & CREATE
For each new issue, use `task-create`:
-   **`task_code`**: `GH-{{number}}`.
-   **`title` / `description`**: EXACT match from GitHub. DO NOT summarize.
-   **`tags`**: GitHub labels.
-   **`phase`**: `backlog` or `triage`.
-   **`metadata`**: include GitHub URL.

## 4. COMMENTS
-   **Fetch**: Use `issue_read` (method='get_comments').
-   **Import**: Add comments to local task via `task-update`.

## 5. SUMMARY
Report count of tasks created.

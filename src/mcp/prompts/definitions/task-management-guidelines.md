---
name: task-management-guidelines
description: Task tracking & progress management standards.
arguments: []
agent: Project Manager
---
# Task Management Standards

## 1. NAVIGATION (`task-list`)
-   **Sync**: Call `task-list` at every session start (default: `in_progress,pending`).
-   **Format**: Compact table (IDs only). Use `query` for keyword search.
-   **Retrieve**: Fetch full context via `task-detail` AFTER selecting a task.
-   **Coordination**: NEVER work on `in_progress` tasks assigned to others. Focus on ONE task at a time.

## 2. DETAIL TOOLS
-   **Tasks**: Call `task-detail` for history/comments (ID or `task_code`).
-   **Memory**: Call `memory-detail` for full entry content.

## 3. WORKFLOW
-   **Planning**: Create tasks for full lifecycle (Research → Strategy → Execution → Validation).
-   **Transition Safety**: MUST move from `backlog/pending` → `in_progress` → `completed`. Skipping `in_progress` is forbidden.
-   **Validation**: Only `complete` after passing tests.
-   **Archiving**: Completion triggers auto-archive to `task_archive` memory with token reporting.

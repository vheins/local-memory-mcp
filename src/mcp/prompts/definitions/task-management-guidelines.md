---
name: task-management-guidelines
description: Task tracking & progress management standards.
arguments: []
agent: Project Manager
---
# Task Management Standards

## 1. NAVIGATION (`task-list`)
-   **Sync**: Call `task-list` at every session start (default: `in_progress,pending`).
-   **Format**: Compact pointer table: `id`, `task_code`, `title`, `status`, `priority`, `updated_at`, `comments_count`. Use `query` for keyword search.
-   **Retrieve**: Fetch full context via `task-detail` AFTER selecting a task.
-   **Coordination**: Check active ownership with task metadata and `task-claim`. NEVER work on tasks claimed by others. Focus on ONE task at a time.

## 2. DETAIL TOOLS
-   **Tasks**: Call `task-detail` for history/comments (ID or `task_code`).
-   **Memory**: Call `memory-detail` for full entry content.
-   **Standards**: Call `standard-search` before implementation when coding standards may apply.
-   **Handoffs**: Call `handoff-list` to discover pending context transfers before starting a task.

## 3. WORKFLOW
-   **Planning**: Create tasks for full lifecycle (Research → Strategy → Execution → Validation).
-   **Transition Safety**: MUST move from `backlog/pending` → `in_progress` → `completed`. Skipping `in_progress` is forbidden.
-   **Claiming**: Use `task-claim` when taking ownership of a task, with `task_code` when working from human-visible queues.
-   **Handoff**: Use `handoff-create` when pausing, transferring ownership, or leaving structured context for another agent.
-   **Validation**: Only mark `completed` after passing tests or explicitly documenting why verification could not run.
-   **Archiving**: Completion triggers auto-archive to `task_archive` memory with token reporting.

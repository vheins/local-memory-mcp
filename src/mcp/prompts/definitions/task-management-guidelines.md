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
-   **Retrieve**: Fetch full context via `task-detail` AFTER selecting a task. The hydrated task includes current coordination state such as active claims and pending handoffs.
-   **Coordination**: Check active ownership with task coordination metadata, `task-claim`, and `claim-list`. NEVER work on tasks claimed by others. Focus on ONE task at a time.

## 2. DETAIL TOOLS
-   **Tasks**: Call `task-detail` for history/comments (ID or `task_code`).
-   **Memory**: Call `memory-detail` for full entry content.
-   **Standards**: Call `standard-search` before implementation when coding standards may apply.
-   **Handoffs**: Call `handoff-list` to discover pending context transfers before starting a task. Close stale handoffs with `handoff-update` when no concrete next owner, unfinished task, or blocker remains.

## 3. WORKFLOW
-   **Planning**: Create tasks for full lifecycle (Research → Strategy → Execution → Validation).
-   **Transition Safety**: MUST move from `backlog/pending` → `in_progress` → `completed`. Skipping `in_progress` is forbidden.
-   **Automatic Cleanup**: `task-update` to `completed` or `canceled` automatically releases active claims and expires pending handoffs linked to that task.
-   **Claiming**: Use `task-claim` when taking ownership of a task, with `task_code` when working from human-visible queues.
-   **Claim Inspection**: Use `claim-list` when ownership is unclear or when triaging stale work.
-   **Claim Release**: Use `claim-release` to clear stale ownership explicitly when a task is being handed back or reassigned.
-   **Handoff**: Use `handoff-create` only when pausing or transferring unfinished work. Do not use pending handoffs for completion summaries; close consumed/stale handoffs with `handoff-update`.
-   **Validation**: Only mark `completed` after passing tests or explicitly documenting why verification could not run.
-   **Archiving**: Completion triggers auto-archive to `task_archive` memory with token reporting.

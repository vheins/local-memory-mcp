---
name: task-management-guidelines
description: Best practices for task tracking and progress management
arguments: []
agent: Project Manager
---
Guidelines for Task Management:

1. task-active (PRIMARY NAVIGATION — USE FIRST):
   - MANDATORY: Always call `local-memory-mcp` MCP tools `task-active` at the very start of a new session.
   - Returns a compact table: columns = [id, title, status, priority]. Rows are pointers — NOT full tasks.
   - Default behavior: returns `in_progress` tasks; auto-falls back to `pending` if none exist.
   - Filter by status via the `status` param: `"in_progress"` or `"pending"` only.
   - After selecting a task from the table, fetch its full context via `task://<id>`.
   - DO NOT call task-active in a loop. Call it ONCE per session to navigate.
   - DO NOT work on multiple tasks simultaneously.

2. task-list (SECONDARY — USE ONLY WHEN NEEDED):
   - Use `local-memory-mcp` MCP tools `task-list` ONLY for broader queries (completed, backlog, search, pagination).
   - Do NOT use task-list as a replacement for task-active at session start.
   - Coordinate: If a task is already 'in_progress', do not attempt to work on it unless specifically asked to collaborate.

3. Resource:
   - You can also read `tasks://current` for a filtered view of active tasks for the current repository.

4. Workflow Integration:
   - Plan first: Create tasks for the entire lifecycle (Research → Strategy → Execution → Validation).
   - Atomic Updates: Update the task status to 'in_progress' EXACTLY ONCE when you begin working on a task.
   - Finalize: Only mark a task as 'completed' after successful validation (tests passed). If validation fails, iterate and fix while keeping the task 'in_progress'. Only mark as 'blocked' if there is a hard dependency issue.

---
name: task-management-guidelines
description: Best practices for task tracking and progress management
arguments: []
agent: Project Manager
---
Guidelines for Task Management:

1. task-list (PRIMARY NAVIGATION & SEARCH):
   - MANDATORY: Always call `local-memory-mcp` MCP tools `task-list` (with no status specified to get active tasks) at the very start of a new session.
   - Returns a compact table: columns = [id, task_code, title, status, priority, comments_count]. Rows are pointers — NOT full tasks.
   - Default behavior: returns `in_progress` and `pending` tasks if `status` is omitted.
   - Filter by status via the `status` param (comma-separated, e.g., `"in_progress,pending"`).
   - Search by keyword matching task_code, title, or description via the `query` param.
   - After selecting a task from the table, fetch its full context via `task-detail` tool.
   - Coordinate: If a task is already 'in_progress', do not attempt to work on it unless specifically asked to collaborate.
   - DO NOT work on multiple tasks simultaneously.

3. Detail Tools:
   - Use `local-memory-mcp` MCP tools `task-detail` to fetch full task details (including comments and history) by ID or task_code.
   - Use `local-memory-mcp` MCP tools `memory-detail` to fetch full memory content by ID.

4. Workflow Integration:
   - Plan first: Create tasks for the entire lifecycle (Research → Strategy → Execution → Validation).
   - Atomic Updates: Update the task status to 'in_progress' EXACTLY ONCE when you begin working on a task.
   - Finalize: Only mark a task as 'completed' after successful validation (tests passed). If validation fails, iterate and fix while keeping the task 'in_progress'. Only mark as 'blocked' if there is a hard dependency issue.

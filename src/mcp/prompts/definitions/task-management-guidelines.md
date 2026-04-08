---
name: task-management-guidelines
description: Best practices for task tracking and progress management
arguments: []
agent: Project Manager
---
Guidelines for Task Management:

1. task-manage:
   - Use 'create' to break down complex user requests into actionable steps at the start of a session.
   - Use 'phase' to group tasks (e.g., 'research', 'implementation', 'testing').
   - Use 'priority' (1-5) to highlight critical path items.
   - Use 'update' to mark progress (in_progress, completed, blocked).
   - Use 'metadata' to store technical debt notes or implementation details.

2. Resource & Tool Usage:
   - MANDATORY: Always call '@vheins/local-memory-mcp tools task-list' at the very start of a new session to understand current progress and avoid duplicating work.
   - Resource: You can also read 'tasks://current' for a filtered view of active tasks for the current repository.
   - Coordinate: If a task is already 'in_progress', do not attempt to work on it unless specifically asked to collaborate.

3. Workflow Integration:
   - Plan first: Create tasks for the entire lifecycle (Research -> Strategy -> Execution -> Validation).
   - Atomic Updates: Update the task status to 'in_progress' EXACTLY ONCE when you begin working on a task. Do NOT repeatedly update it to 'in_progress' before every tool call.
   - Finalize: Only mark a task as 'completed' after successful validation (tests passed). If validation fails, do NOT immediately mark it as 'blocked' or 'pending'. You MUST iterate and fix the issues while keeping the task 'in_progress'. Only mark as 'blocked' if there is a hard dependency issue that completely prevents further progress.

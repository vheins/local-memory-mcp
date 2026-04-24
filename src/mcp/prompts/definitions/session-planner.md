---
name: session-planner
description: Break objective into atomic tasks.
arguments:
  - name: objective
    description: High-level session goal.
    required: true
agent: Strategy Lead
---
Plan execution for: '{{objective}}'.

Steps:
1. **Orient**: Call `task-list` to avoid duplicate active/backlog work.
2. **Standards**: Call `standard-search` if the objective touches implementation conventions.
3. **Handoffs**: Call `handoff-list` for pending context that may affect sequencing.
4. **Analyze**: Break into 3-7 atomic, verifiable tasks.
5. **Phase**: Group into `research`, `implementation`, and `validation`.
6. **Hierarchy**: Use `parent_id` / `depends_on` for sequencing.
7. **Create**: Use `task-create` in current repo with stable `task_code`, tags, and acceptance criteria.

Display final plan to user.

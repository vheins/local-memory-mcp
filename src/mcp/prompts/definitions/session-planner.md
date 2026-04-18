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
1. **Analyze**: Break into 3-7 atomic, verifiable tasks.
2. **Phase**: Group into 'research', 'implementation', 'validation'.
3. **Hierarchy**: Use `parent_id` / `depends_on` for sequencing.
4. **Create**: Use `task-create` in current repo.

Display final plan to user.

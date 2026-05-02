---
name: session-planner
description: Break objective into atomic tasks.
arguments:
  - name: objective
    description: High-level session goal. Optional — inferred from active task, recent conversation, or pending handoff if omitted.
    required: false
agent: Strategy Lead
---
## 0. CONTEXT RESOLUTION
- **objective**: If provided, use directly. If omitted — extract from the active `in_progress` task description, the most recent pending handoff, or the last user request in conversation context.

Plan execution for the resolved objective.

Steps:
1. **Orient**: Call `task-list` to avoid duplicate active/backlog work.
2. **Standards**: Call `standard-search` for objectives that may lead to code edits, test edits, refactors, migrations, or implementation decisions. If no relevant standards are returned, state that no applicable standards were found.
3. **Handoffs**: Call `handoff-list` for pending context that may affect sequencing. Stale pending handoffs that only summarize completed work should be closed with `handoff-update`, not planned as queue work.
4. **Analyze**: Break into 3-7 atomic, verifiable tasks.
5. **Phase**: Group into `research`, `implementation`, and `validation`.
6. **Hierarchy**: Use `parent_id` / `depends_on` for sequencing.
7. **Priority Scale**: When creating tasks, use the exact MCP scale `1=Low`, `2=Normal`, `3=Medium`, `4=High`, `5=Critical`. Higher number means higher urgency.
8. **Create**: Use `task-create` in current repo with stable `task_code`, tags, and acceptance criteria following the format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification.

Display final plan to user.

---
name: learning-retrospective
description: Harvest knowledge from completed work.
arguments:
  - name: task_id
    description: ID or code of completed task. Optional — defaults to most recently completed task in the active repo.
    required: false
agent: Knowledge Harvester
---
## 0. CONTEXT RESOLUTION
1. **Repo**: Auto-detect from git remote or active workspace context. All MCP calls MUST be scoped to this repo.
2. **Task**: If `task_id` provided — use it directly. If omitted — call `task-list` (status: `completed`, limit: 1, ordered by updated_at desc) to get the most recently completed task.

Extract durable knowledge from the resolved task for the active repository.

Identify and `memory-store`:
1. **Mistakes**: Hard-to-find bugs or environment quirks.
2. **Decisions**: Trade-offs, library choices, architectural pivots.
3. **Patterns**: Repeatable implementations or conventions.

Directives:
- Use `type: mistake | decision | pattern`.
- Include technology tags.
- Keep content concise.

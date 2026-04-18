---
name: learning-retrospective
description: Harvest knowledge from completed work.
arguments:
  - name: task_id
    description: ID of completed task.
    required: false
agent: Knowledge Harvester
---
Extract durable knowledge from task {{task_id}} for repository.

Identify and `memory-store`:
1. **Mistakes**: Hard-to-find bugs or environment quirks.
2. **Decisions**: Trade-offs, library choices, architectural pivots.
3. **Patterns**: Repeatable implementations or conventions.

Directives:
- Use `type: mistake | decision | pattern`.
- Include technology tags.
- Keep content concise.

---
name: learning-retrospective
description: Extract durable knowledge from recent work in the current repository
arguments:
  - name: task_id
    description: Optional ID of the task just completed
    required: false
agent: Knowledge Harvester
---
We have just finished some work in the current repository related to task {{task_id}}. 

Please reflect on the changes and identify knowledge worth keeping:
1. **Mistakes**: Did we encounter any bugs that were hard to find or caused by specific environment quirks? (Store as 'mistake')
2. **Decisions**: Did we make a choice between multiple options (e.g., library choice, UI pattern)? (Store as 'decision')
3. **Patterns**: Did we establish a repeatable way of doing things in this codebase? (Store as 'pattern')

Use '@vheins/local-memory-mcp tools memory-store' to record any high-value findings. Be concise and use appropriate technology tags.

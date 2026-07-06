---
name: learning-retrospective
description: Harvest knowledge from completed work.
arguments:
  - name: task_id
    description: ID of completed task.
    required: false
agent: Knowledge Harvester
category: workflows
version: "1.0.0"
tags: [workflow, retrospective, memory, knowledge-management]
---

## Learning Retrospective

Entry=S0 → S1 → S2 Exit=stored
Guard: S(N) req S(N-1)✅

S0 | identify: mistakes (bugs/quirks), decisions (trade-offs/pivots), patterns (conventions) | task_id? | knowledge items | —
S1 | store via memory-store (type+title+content+importance+agent+model+scope, type=mistake|decision|pattern, include tech tags, concise) or decision-log(structured decision recording) | S0✅ | durable memories | —
S2 | verify: confirm stored count matches identified items, check type correctness | S1✅ | verified | —

## Directives

- Use type: mistake | decision | pattern.
- Include technology tags.
- Keep content concise.

Task: {{task_id}}

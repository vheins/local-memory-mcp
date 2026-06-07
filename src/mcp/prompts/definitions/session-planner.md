---
name: session-planner
description: Break objective into atomic tasks.
arguments:
  - name: objective
    description: High-level session goal.
    required: true
agent: Strategy Lead
category: workflows
version: "1.0.0"
tags: [workflow, planning, task-breakdown]
---

## FSM

Entry=S0 → S1 → S2 → S3 → S4 → S5 Exit=planned
Guard: S(N) req S(N-1)✅

S0 | orient: task-list (avoid dupes) + standard-search (if code edits) + handoff-list (close stale) | objective provided? | existing state | —
S1 | analyze: break into 3-7 atomic verifiable tasks | S0✅ | task breakdown | —
S2 | phase: group into research / implementation / validation | S1✅ | phased tasks | —
S3 | hierarchy: parent_id + depends_on for sequencing; priority 1-5 scale | S2✅ | structured plan | —
S4 | create via task-create (stable task_code or omit for auto-generated TASK-xxx, tags, suggested_skills if relevant, acceptance criteria) | S3✅ | MCP tasks | —
S5 | display final plan to user | S4✅ | user output | —

Objective: {{objective}}

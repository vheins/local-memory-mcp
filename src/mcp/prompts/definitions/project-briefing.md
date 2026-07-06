---
name: project-briefing
description: Contextual onboarding to current repository.
arguments: []
agent: Session Concierge
category: workflows
version: "1.0.0"
tags: [workflow, briefing, onboarding, memory, backlog]
---

## Project Briefing

Entry=S0 → S1-4(parallel) → S5 → S6 → S7 Exit=briefed
Guard: S(N) req S(N-1)✅

S0 | identify current repo | — | repo context | —
S1 | load tasks: task-list (in_progress, pending) | S0✅ | active tasks | —
S2 | load handoffs: handoff-list (pending) — active only if unfinished work/blockers/linked task | S0✅ | pending transfers | —
S3 | load memory: agent-context(one-call context) OR memory-search or memory-recap; hydrate via memory-detail | S0✅ | decisions, patterns, mistakes | —
S4 | load standards: standard-search (repo, stack) | S0✅ | applicable standards | —
S5 | summarize core: active task + pending handoffs + standards + top decisions | S1-4✅ | briefing | —
S6 | propose next steps based on active queue; priority: 1=Low 2=Normal 3=Medium 4=High 5=Critical | S5✅ | action plan | —
S7 | verify: confirm all sources loaded (tasks, handoffs, memory, standards), briefing complete | S6✅ | verified | —

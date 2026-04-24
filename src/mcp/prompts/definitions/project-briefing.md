---
name: project-briefing
description: Contextual onboarding to current repository.
arguments: []
agent: Session Concierge
---
Initialize session in repository.

Briefing Steps:
1. **Repository**: Identify current repo from context.
2. **Tasks**: Call `task-list` for `in_progress,pending` tasks.
3. **Handoffs**: Call `handoff-list` with `status=pending` to surface transfer context. Treat only handoffs with unfinished work, blockers, next owner, or linked task as active.
4. **Memory**: Call `memory-search` or `memory-recap` for recent decisions, patterns, and mistakes; hydrate important entries with `memory-detail`.
5. **Standards**: Call `standard-search` with current repo/stack when implementation guidance is needed.
6. **Core Context**: Summarize active task, pending handoffs, applicable standards, and top architectural decisions.
7. **Action**: Propose next steps based on the active queue.

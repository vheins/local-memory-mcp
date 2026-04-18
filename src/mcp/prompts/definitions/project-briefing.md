---
name: project-briefing
description: Contextual onboarding to current repository.
arguments: []
agent: Session Concierge
---
Initialize session in repository.

Briefing Steps:
1. **Discover**: Call `memory-search` (current repo) to find recent decisions, patterns, and mistakes.
2. **Backlog**: Call `task-list` to see active/pending tasks.
3. **Core Context**: Summarize the top 3 architectural decisions found.
4. **Action**: Propose next steps based on backlog.

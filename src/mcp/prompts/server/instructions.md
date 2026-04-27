---
name: server-instructions
description: Main instructions for the MCP server
---
Local Memory MCP — persistent memory, task coordination, and coding standards for AI agents.

## When to use this server
Use at the START of every session and before any implementation work:
1. Call `task-list` to sync active/pending tasks for the current repository.
2. Call `handoff-list` to check pending context transfers. Close stale handoffs with `handoff-update`.
3. Call `memory-search` and `memory-synthesize` to hydrate architectural context before coding.
4. Call `standard-search` before any code edit, test edit, refactor, migration, or implementation decision. This is mandatory even for small tasks; use the task intent, affected files, inferred language, stack, and repo as filters. If no relevant standards are returned, continue and state that no applicable standards were found.

## Core Workflows

**Memory**: `memory-search` → `memory-detail` → `memory-store` / `memory-update`
- Store only durable knowledge (architecture, patterns, decisions, fixes).
- Use `memory-acknowledge` after generating code from memory results.
- Global scope only for cross-repo rules; prefer repo-specific scope.

**Tasks**: `task-list` → `task-claim` → `task-update` (in_progress → completed)
- Register planned steps via `task-create` before execution.
- Never skip intermediate `in_progress` state before `completed`.
- Completing a task auto-releases claims and expires linked handoffs.

**Standards**: `standard-search` → `standard-store`
- `standard-search` is the pre-implementation gate for code, tests, refactors, migrations, and implementation decisions.
- One rule per entry. Treat as normative implementation contracts, not docs summaries.

**Handoffs/Claims**: `handoff-list` → `handoff-create` / `handoff-update` | `task-claim` / `claim-release`
- Create handoffs only for unfinished work with concrete next owner or next steps.
- Do NOT create handoffs as completion summaries — put those on `task-update` comments.

## Available Prompts (invoke as slash commands)
- `session-planner` — orient and plan at session start
- `task-memory-executor` — execute tasks with memory and standard enforcement
- `senior-code-review` — full code review against stored standards
- `memory-guided-review` — review using project memory as context
- `architecture-design` — architectural planning and ADR generation
- `technical-planning` — feature planning with task decomposition
- `root-cause-analysis` — structured bug / incident investigation
- `fix-suggestion` — propose and validate fixes
- `security-triage` — security risk assessment
- `learning-retrospective` — capture lessons and update memory
- `documentation-sync` — sync docs with current codebase state
- `project-briefing` — generate repository briefing from memory

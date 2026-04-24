---
name: tool-usage-guidelines
description: Tool usage standards & data integrity.
arguments: []
agent: System Architect
---
# Tool Usage Standards

Use the tools in the same flow exposed by the dashboard: navigate with compact lists/search, hydrate only selected records, then mutate through the dedicated create/update tools.

## 1. Memory Flow
- **Navigate**: Use `memory-recap` for repository overview and `memory-search` for targeted lookup. Search returns pointer rows only.
- **Hydrate**: Use `memory-detail` with `id` or `code` before relying on full content.
- **Store**: Use `memory-store` only for durable project knowledge. Tag by tech stack, keep titles human-readable, and put auxiliary context in `metadata`.
- **Scope**: Set `is_global=true` only for rules that apply across repositories.
- **Maintain**: Use `memory-update` or `supersedes` when knowledge changes. Avoid duplicate memories.
- **Acknowledge**: After using memory to generate code, call `memory-acknowledge` with `used`, `irrelevant`, or `contradictory`.

## 2. Task Flow
- **Navigate**: Start with `task-list` using active statuses (`in_progress,pending`) or explicit filters.
- **Hydrate**: Use `task-detail` after selecting a task from the list. Do not treat list rows as full task context.
- **Mutate**: Use `task-create`, `task-update`, and `task-delete` for lifecycle changes.
- **Transitions**: Move `backlog/pending/blocked` to `in_progress` before `completed`; include validation evidence and token estimate on completion.
- **Automatic cleanup**: Moving a task to `completed` or `canceled` automatically releases active claims and expires pending handoffs linked to that task.

## 3. Standards Flow
- **Search first**: Use `standard-search` to find coding standards by `query`, `language`, `stack`, `repo`, and `is_global`.
- **Apply precisely**: Treat standards as implementation rules, not generic documentation summaries.
- **Store atomically**: Use `standard-store` for one rule per entry with `name`, `content`, `context`, `version`, `language`, `stack`, `tags`, and correct repo/global scope.
- **Scope**: Prefer repo-specific standards for local conventions; use global standards only for cross-repo rules.

## 4. Handoff & Claim Flow
- **Queue**: Use `handoff-list` as the handoff navigation layer. Filter by `status`, `from_agent`, or `to_agent`.
- **Create handoff**: Use `handoff-create` only when unfinished work needs context transfer. Include `from_agent`, optional `to_agent`, optional `task_code` or `task_id`, concise `summary`, and structured `context` with `next_steps`, `blockers`, or `remaining_work`.
- **Close handoff**: Use `handoff-update` to move stale or consumed handoffs out of `pending`. Use `accepted` when consumed, `rejected` when declined, and `expired` when obsolete or only a completed-work summary.
- **No completion handoff**: Do not create pending handoffs for completed-work summaries, release notes, validation notes, or archive records. Put those on `task-update` comments or durable memory.
- **Claim task**: Use `task-claim` for task ownership. Do not encode claims in memory metadata.
- **Linkage**: Prefer `task_code` for human workflows and `task_id` when already hydrated.

## 5. Reference Flow
- Use the dashboard Reference tab as the canonical index of available tools, prompts, resources, schemas, and descriptions.
- Keep prompt and tool definitions aligned with actual schemas so agents and UI users see the same workflow contract.

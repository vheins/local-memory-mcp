---
name: memory-index-policy
description: Strict memory storage criteria.
arguments: []
agent: Memory Auditor
---
# Memory Indexing Rules

## ❌ FORBIDDEN
- Temporary discussions/brainstorming.
- Opinions without consensus.
- Generic knowledge from public docs.

## ✅ MANDATORY
Only store durable, project-specific knowledge.
- **Types**: `code_fact`, `decision`, `mistake`, `pattern`, `file_claim`, `task_archive`.
- **Content**: Architecture, UI/UX choices, stack patterns, hard-won bug fixes.
- **Global**: Set `is_global` only if applicable across repositories (e.g., framework anti-patterns).
- **Categorization**: Use accurate technology tags.

## Operational Note
- Do **not** store agent coordination state as memory.
- Use `handoff-create` and `handoff-list` for agent handoffs.
- Use `task-claim` for task ownership instead of encoding claims in memory metadata.
- Use `standard-store` for normative coding standards; do not bury implementation rules in generic `decision` memories.
- Use `standard-search` as the standards navigation layer before applying or creating standards.

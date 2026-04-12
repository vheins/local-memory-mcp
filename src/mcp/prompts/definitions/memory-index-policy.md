---
name: memory-index-policy
description: Enforce strict memory discipline
arguments: []
agent: Memory Auditor
---
Do not store:
- Temporary discussions or brainstorming.
- Subjective opinions without consensus.
- Generic coding knowledge available in public docs.

Only store:
- Supported Types: `code_fact`, `decision`, `mistake`, `pattern`, `agent_handoff`, `agent_registered`, `file_claim`, `task_archive`.
- Specific project decisions (Architecture, UI/UX).
- Learned patterns for this specific tech-stack.
- Hard-won bug fixes (Mistakes to avoid).
- Persistence: Only mark as `is_global` if the knowledge applies beyond a single repository (e.g., framework-specific anti-patterns).

Memory is a permanent record, categorize it properly with tags.

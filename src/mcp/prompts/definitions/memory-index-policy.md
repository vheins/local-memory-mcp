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
- **Types**: `code_fact`, `decision`, `mistake`, `pattern`, `agent_handoff`, `agent_registered`, `file_claim`, `task_archive`.
- **Content**: Architecture, UI/UX choices, stack patterns, hard-won bug fixes.
- **Global**: Set `is_global` only if applicable across repositories (e.g., framework anti-patterns).
- **Categorization**: Use accurate technology tags.

# Product Requirements Document (PRD)

## Target Audience
Senior software engineers managing complex repositories who require persistent, semantic context across their development sessions.

## Prioritized Features (MoSCoW)
- **Must Have:**
  - Hybrid persistence: SQLite for structure, FTS5 for text, and local vector embeddings for semantics.
  - CRUD operations for Memory (store, fetch, search).
  - Multi-stage Task Lifecycle (`backlog` to `completed`) with mandatory transition safety.
  - Automated Activity Logging for every tool interaction.
- **Should Have:**
  - Real-time Dashboard UI for knowledge curation.
  - Knowledge Synthesis using sampling to consolidate disparate facts.
  - Token Budgeting: Enforced reporting of actual token usage on task completion.
- **Could Have:**
  - Capability Reference UI: Auto-generated documentation for all available MCP tools.
  - Priority-based task sorting and filtering.

## Non-Functional Requirements (NFRs)
- **Privacy:** 100% Local. No telemetry or PII ever leaves the machine.
- **Safety:** Transactional integrity for all database writes.
- **Efficiency:** Low-latency vector generation using offline `@xenova/transformers`.
- **Traceability:** Every system state change must be attributable to an agent/role.
# Product Requirements Document (PRD)

> **VERIFIED vs IMPLEMENTATION (2026-08-08):** "Must/Should/Could All Implemented" claims hold with these notes — (1) "Knowledge Graph with CRUD tools": **no MCP KG CRUD tools**; KG is dashboard/API-only + embedded `kg` context in read tools (ADR-006); (2) "Agent Tools: `agent-context`, `decision-log`, `session-summarize`": `decision-log` and `session-summarize` no longer exist as tools — absorbed into `memory-write` (type=decision / type=task_archive); `agent-context` remains canonical. Time-tunnel temporal parsing ("yesterday"/"last week") is implemented inside `memory-read` (src/mcp/tools/time-tunnel.ts). Upstream alias item below already marked LEGACY by TASK-283 ✓.

## Target Audience

Senior software engineers managing complex repositories who require persistent, semantic context across their development sessions.

## Prioritized Features (MoSCoW)

### Must Have (All Implemented)

- Hybrid persistence: SQLite for structure, TF-IDF for text search, and ONNX vector embeddings for semantics.
- CRUD operations for Memory (store, fetch, search, update, delete, acknowledge, recap, detail).
- Multi-stage Task Lifecycle (`backlog` to `completed`) with mandatory transition safety and token budgeting.
- Automated Activity Logging for every tool interaction.
- Multi-agent coordination (handoffs, claims).
- Coding Standards management with vector search.
- Soul Maintenance (memory decay and archival).

### Should Have (All Implemented)

- Real-time Dashboard UI for knowledge curation (Svelte 5).
- Knowledge Synthesis using client sampling to consolidate disparate facts.
- Token Budgeting: Enforced `est_tokens` on task completion.
- Knowledge Graph with CRUD tools and NLP auto-extraction.
- Temporal query parsing ("yesterday", "last week") in memory-search.

### Could Have (All Implemented)

- Capability Reference UI: Auto-generated documentation for all MCP tools.
- Priority-based task sorting and filtering.
- Agent Tools: `agent-context`, `decision-log`, `session-summarize`.
- Upstream alias compatibility (`remember_fact`, `recall`, `forget`) — **LEGACY DESIGN INTENT, NOT IMPLEMENTED**: no alias tools were ever shipped (verified 2026-08-08), so the "All Implemented" label does not apply to this item.

### Won't Have (Rejected)

- Ollama LLM integration (violates zero-dependency local-first contract).
- Dynamic extension framework (`EXTENSIONS_PATH` - security risk).

## Non-Functional Requirements (NFRs)

- **Privacy:** 100% Local. No telemetry or PII ever leaves the machine. All embeddings generated locally via ONNX.
- **Safety:** Transactional integrity for all database writes. Cross-process write locking via `proper-lockfile`.
- **Efficiency:** Low-latency vector generation using offline `@xenova/transformers`. Query latency < 50ms for thousands of entries.
- **Traceability:** Every system state change must be attributable to an agent/role via `action_log`.

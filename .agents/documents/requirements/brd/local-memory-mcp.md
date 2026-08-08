# Business Requirements Document (BRD)

> **VERIFIED vs IMPLEMENTATION (2026-08-08):** BRD goals/features align with the shipped system. Tool names referenced below are legacy → canonical 17-tool set (`memory-store` → `memory-write`, `memory-search` → `memory-read`, `task-create` → `task-write`, `task-claim`/`claim-list`/`claim-release` → `claim-manage`, `handoff-create`/`handoff-list`/`handoff-update` → `handoff-write`/`handoff-read`, `standard-store` → `standard-write`, `decision-log`/`session-summarize` → `memory-write` modes). KG tools (`create-entity` etc.) are **dashboard/API-only** — no MCP KG CRUD (ADR-006). Soul maintenance, 6-state task lifecycle, `est_tokens` on completion, and 0.85 conflict threshold are implemented.

## Project Overview

`@vheins/local-memory-mcp` solves the problem of "context amnesia" in AI coding assistants by providing a local, high-performance semantic memory and task orchestration server with multi-agent coordination, coding standards, knowledge graphs, and a visualization dashboard.

## Business Objectives

- **Context Retention**: Increase agent efficiency by reducing redundant information gathering across sessions.
- **Agent Safety**: Prevent developmental hallucination by enforcing a structured task state machine and providing conflict detection on memory stores.
- **Auditability**: Provide human-readable activity trails for all agent interactions via `action_log`.
- **Multi-Agent Coordination**: Enable structured handoffs and task claims between multiple AI agents working on the same repository.
- **Privacy Assurance**: 100% local processing compliance with high-security environments — no data ever leaves the machine.
- **Knowledge Management**: Store, retrieve, synthesize, and decay project knowledge automatically.

## Stakeholders

- **AI Agents**: Primary consumers of the memory, task, standard, and coordination tools.
- **Software Engineers**: Owners of the local context and primary users of the Dashboard UI.
- **System Auditors**: Individuals or systems needing to verify the chain of reasoning via the Activity Log and action_log table.
- **Project Managers**: Users tracking task completion metrics and token usage analytics.

## Scope of Work

- Implementation of a persistent MCP-compliant server with SQLite persistence.
- Web-based Dashboard (Svelte 5) for visual inspection and management.
- Hybrid search engine (TF-IDF + ONNX vector embeddings).
- 6-state task lifecycle management with transition safety and token budgeting.
- Coding standards management with vector search.
- Knowledge Graph with NLP-based auto-extraction.
- Multi-agent coordination (handoffs, claims).
- Automated knowledge synthesis protocols via client sampling.
- Soul Maintenance (automatic memory decay and archival).

## Key Metrics

- **Memory Recall Rate**: Ratio of acknowledged uses to retrievals.
- **Task Completion Rate**: Tasks completed vs. tasks created per time period.
- **Token Efficiency**: Actual tokens used per task (via `est_tokens`).
- **Query Latency**: < 50ms for databases with thousands of entries.

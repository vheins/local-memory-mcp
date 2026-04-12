# Product Requirements Document (PRD)

## Target Audience
Senior software engineers managing complex codebases who rely on stateless AI coding assistants.

## Prioritized Features (MoSCoW)
- **Must Have:**
  - SQLite persistent storage.
  - CRUD operations for Memory (store, update, delete, detail).
  - Semantic/Hybrid Search (`memory-search`).
  - CRUD operations for Tasks (create, active, list, update).
- **Should Have:**
  - UI Dashboard for manual context curation and inspection.
  - Telemetry to acknowledge memory usage.
- **Could Have:**
  - Automated summary and synthesis using client-side sampling.
  - Interactive forms via MCP elicitation for task creation.

## Non-Functional Requirements (NFRs)
- **Latency:** Vector search FTS integration should return results in < 200ms.
- **Privacy:** 100% of data (including embeddings) must stay on the local machine.
- **Portability:** Self-contained configuration without extensive setup.
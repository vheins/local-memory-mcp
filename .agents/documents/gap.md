# COMPARATIVE ANALYSIS REPORT: LOCAL VS. UPSTREAM MCP LOCAL MEMORY

## 1. Upstream Repository Overview

- **Repository**: [Beledarian/mcp-local-memory](https://github.com/Beledarian/mcp-local-memory)
- **Status**: Active, lightweight, local-first Model Context Protocol (MCP) server for long-term memory.
- **Core Design**: Focused on natural language entity/observation extraction, knowledge graph relations, and biological-like memory lifecycle decay.

---

## 2. Local Codebase Overview

- **Project**: `@vheins/local-memory-mcp` (v0.19.24+)
- **Core Design**: Extends the local memory concept into a complete software engineering project lifecycle tool. It adds multi-owner repository scoping, a task-tracking/issue system, a multi-agent handoff/claim model, local coding standards, a Knowledge Graph, NLP Archivist, Soul Maintenance, and a Svelte 5 + Vite-powered visualization dashboard.

---

## 3. Feature Comparison (Implemented vs. Upstream)

| Feature                           | Upstream (`Beledarian`)                               | Local (`@vheins`)   | Notes                                                                                                                                    |
| :-------------------------------- | :---------------------------------------------------- | :------------------ | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **SQLite Persistence**            | Full support                                          | Full support        | Both use better-sqlite3                                                                                                                  |
| **FTS5 Full-Text Search**         | Full support                                          | Full support        | Enhanced with hybrid ranking                                                                                                             |
| **Vector Embeddings (ONNX)**      | Full support                                          | Full support        | Same all-MiniLM-L6-v2 model                                                                                                              |
| **Knowledge Graph**               | Full support (entities, relations, observations)      | **Implemented**     | Entities, Relations, Observations tables with CASCADE deletes. Exposed via KG CRUD tools + dashboard visualization                       |
| **NLP Archivist**                 | Automatic entity extraction via `compromise`          | **Implemented**     | `kg-archivist.ts` auto-extracts entities from memory content using `compromise`. Runs on every `memory-store`                            |
| **Time Tunnel (Temporal Recall)** | Natural language date filtering                       | **Implemented**     | `compromise-dates` integration for relative date parsing ("yesterday", "last week")                                                      |
| **Soul Maintenance**              | Biological decay model with tag immunization          | **Implemented**     | `memory.archive.ts` with configurable decay rate (0.5), min importance (1), inactivity period (7 days). Tag-based immunization supported |
| **Upstream Tool Aliases**         | `remember_fact`, `remember_facts`, `recall`, `forget` | **Implemented**     | SDK alias layer maps upstream tool names to local handlers                                                                               |
| **Task Management**               | None                                                  | Full support        | 6-state lifecycle, claims, handoffs, token budgeting                                                                                     |
| **Coding Standards**              | None                                                  | Full support        | Dedicated `coding_standards` table with vector search                                                                                    |
| **Dashboard UI**                  | None                                                  | Full support        | Svelte 5 + Vite with KG visualization                                                                                                    |
| **Multi-Agent Coordination**      | None                                                  | Full support        | Claims table, handoff system                                                                                                             |
| **Action Audit Trail**            | Implicit                                              | Full support        | Dedicated `action_log` table                                                                                                             |
| **Extension Framework**           | `EXTENSIONS_PATH`                                     | **Not implemented** | Rejected for security reasons                                                                                                            |
| **Ollama LLM Archivist**          | Optional                                              | **Not implemented** | Rejected (violates zero-dependency principle)                                                                                            |

---

## 4. Implementation Status Summary

### Implemented (Gaps Closed)

1. ✅ **Upstream Tool Schema Compatibility (Alias Layer)**: `remember_fact`, `remember_facts`, `recall`, `forget` aliases registered via SDK `registerTool()`.
2. ✅ **Knowledge Graph System**: `entities`, `relations`, `observations` tables with CRUD tools (`create-entity`, `delete-entity`, `create-relation`, `delete-relation`, `delete-observation`, `kg-backfill`).
3. ✅ **NLP Archivist Strategy**: `compromise` library integrated in `kg-archivist.ts` for automated entity extraction from memory content.
4. ✅ **Time Tunnel Temporal Recall**: Natural language date parsing in `memory-search` using `compromise-dates`.
5. ✅ **Soul Maintenance**: Memory decay algorithm with tag immunization, runs at startup and periodically.

### Not Implemented (Intentional)

1. ❌ **Ollama LLM Archivist Strategy**: Requires running Ollama server, violates zero-dependency local-first contract.
2. ❌ **Dynamic Extension Framework (`EXTENSIONS_PATH`)**: Security risk and dashboard desynchronization concern.

---

## 5. Local Differentiators (Not in Upstream)

1. **Task Management**: Full 6-state lifecycle (`backlog` → `pending` → `in_progress` → `completed`, with `blocked`/`canceled`), hierarchical via `parent_id`, token budgeting via `est_tokens`.
2. **Coding Standards**: Dedicated `coding_standards` table with vector similarity search and language/stack scoping.
3. **Multi-Agent Coordination**: Dedicated `claims` table for task ownership, `handoffs` for context transfer between agents.
4. **Action Audit Trail**: Every tool invocation logged to `action_log` with full query/response tracking.
5. **Svelte 5 Dashboard**: Rich web UI with KG force-directed graph, Kanban board, stats widgets, and reference catalog.
6. **Write Locking**: Cross-process cooperative locking via `proper-lockfile` for safe concurrent access.
7. **Scope Injection**: Automatic `owner`/`repo`/`folder` injection from MCP session context (roots).
8. **Decision Log**: Dedicated `decision-log` tool for structured architectural decision capture.
9. **Session Summarization**: `session-summarize` tool archives session context as searchable memory.

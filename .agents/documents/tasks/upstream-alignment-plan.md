# Upstream Alignment Master Plan

## 1. Context & Objectives

This document establishes the execution and architectural blueprint for aligning our local `@vheins/local-memory-mcp` codebase with the upstream [Beledarian/mcp-local-memory](https://github.com/Beledarian/mcp-local-memory) repository. The alignment brings drop-in client compatibility, entity relationship mapping (Knowledge Graph), offline natural language auto-ingestion, and organic decay lifecycles while maintaining our core features (multi-owner task tracking, multi-agent handoffs, and Svelte dashboard).

---

## 2. Technical Architecture & Component Mapping

### A. Upstream Tool Compatibility Layer

We will register alias tool names via the SDK `registerTool()` method in `src/mcp/tools/index.ts` to seamlessly translate upstream commands into our database schemas. Each alias wraps the existing handler function:

- `remember_fact` ➔ `handleMemoryStore` (via `registerTool` alias)
- `remember_facts` ➔ bulk `handleMemoryStore` (via `registerTool` alias)
- `recall` ➔ `handleMemorySearch` (via `registerTool` alias)
- `forget` ➔ `handleMemoryDelete` (via `registerTool` alias)

### B. Knowledge Graph Database Schema

The database schema will be updated to include the following tables:

```sql
CREATE TABLE IF NOT EXISTS entities (
    name TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS relations (
    from_entity TEXT NOT NULL,
    to_entity TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    PRIMARY KEY (from_entity, to_entity, relation_type),
    FOREIGN KEY (from_entity) REFERENCES entities(name) ON DELETE CASCADE,
    FOREIGN KEY (to_entity) REFERENCES entities(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    entity_name TEXT NOT NULL,
    observation TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entity_name) REFERENCES entities(name) ON DELETE CASCADE
);
```

### C. Offline NLP Archivist Engine

We reject LLM/Ollama dependency in favor of the lightweight, zero-dependency, local-first `compromise` library.

- Ingestion Flow: When a new memory is saved, the content is parsed by `compromise`.
- Entities extracted are automatically stored in the `entities` table.
- Actions/Observations are attached via `observations`.
- Co-occurrence patterns identify candidate relationships for `relations`.

### D. Time Tunnel (Chronological Parsing)

The `memory-search` query handler will parse relative dates using a lightweight regex helper mapping common phrases:

- `"today"` ➔ date range limit
- `"yesterday"` ➔ date range limit
- `"last week"` ➔ date range limit
- Results will be filtered or sorted based on their `created_at` timestamp.

---

## 3. Sprint Execution Roadmap

The implementation is structured into 3 sequential sprints:

1. **Sprint 3: Compatibility & Knowledge Graph Schema**
   - _Deliverables:_ Alias router, Knowledge Graph tables migrations, KG CRUD tools (`create_entity`, `create_relation`, etc.).
   - _Status:_ Planned. Refer to [sprint-3.md](file:///home/vheins/Projects/local-memory-mcp/.agents/documents/tasks/sprints/sprint-3.md).

2. **Sprint 4: NLP Archivist & Chronological Querying**
   - _Deliverables:_ `compromise` integration, NLP extractor engine, relative date query parser in `memory-search`.
   - _Status:_ Planned. Refer to [sprint-4.md](file:///home/vheins/Projects/local-memory-mcp/.agents/documents/tasks/sprints/sprint-4.md).

3. **Sprint 5: Soul Maintenance & Dashboard Graph**
   - _Deliverables:_ Decay scheduler, immunization filter, Svelte 5 graph render (d3-force/vis.js).
   - _Status:_ Planned. Refer to [sprint-5.md](file:///home/vheins/Projects/local-memory-mcp/.agents/documents/tasks/sprints/sprint-5.md).

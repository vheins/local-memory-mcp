# Upstream Alignment Master Plan ✅

## 1. Context & Objectives

This document established the execution and architectural blueprint for aligning our local `@vheins/local-memory-mcp` codebase with the upstream [Beledarian/mcp-local-memory](https://github.com/Beledarian/mcp-local-memory) repository.

**Status: COMPLETED** — All alignment objectives have been implemented.

---

## 2. Implemented Components

### A. Upstream Tool Compatibility Layer ✅

Alias tools registered via SDK `registerTool()`:

- `remember_fact` → `handleMemoryStore`
- `remember_facts` → bulk `handleMemoryStore`
- `recall` → `handleMemorySearch`
- `forget` → `handleMemoryDelete`

### B. Knowledge Graph Database Schema ✅

Tables created: `entities` (name PK), `relations` (composite PK), `observations` (UUID PK) with CASCADE deletes.
CRUD tools: `create-entity`, `delete-entity`, `create-relation`, `delete-relation`, `delete-observation`, `kg-backfill`.

### C. Offline NLP Archivist Engine ✅

- Library: `compromise` (lightweight, zero-dependency, local-first).
- Integration: `kg-archivist.ts` runs on every `memory-store`.
- Flow: Content parsed → entities extracted → stored in `entities` table → co-occurrence patterns → candidate relations.

### D. Time Tunnel (Chronological Parsing) ✅

- Library: `compromise-dates`.
- Support: `"today"`, `"yesterday"`, `"last week"`, relative date ranges.
- Results filtered/sorted by `created_at` timestamp.

### E. Soul Maintenance ✅

- Memory decay scheduler with configurable decay rate (0.5), inactivity period (7 days), min importance (1).
- Tag-based immunization support.
- Runs at startup and periodically.

---

## 3. Sprint Execution Summary

1. **Sprint 3: Compatibility & Knowledge Graph Schema** ✅
   - Deliverables: Alias router, KG table migrations, KG CRUD tools.
   - Status: **Done**

2. **Sprint 4: NLP Archivist & Chronological Querying** ✅
   - Deliverables: `compromise` integration, NLP extractor engine, relative date parser in `memory-search`.
   - Status: **Done**

3. **Sprint 5: Soul Maintenance & Dashboard Graph** ✅
   - Deliverables: Decay scheduler, immunization filter, Svelte 5 force-directed graph renderer.
   - Status: **Done**

---

## 4. Rejected Features (Will Not Implement)

- **Ollama LLM Archivist Strategy**: Requires running Ollama server, violates zero-dependency contract.
- **Dynamic Extension Framework (`EXTENSIONS_PATH`)**: Security and dashboard desync concerns.

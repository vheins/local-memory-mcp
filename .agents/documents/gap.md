# COMPARATIVE ANALYSIS REPORT: LOCAL VS. UPSTREAM MCP LOCAL MEMORY

## 1. Upstream Repository Overview
* **Repository**: [Beledarian/mcp-local-memory](https://github.com/Beledarian/mcp-local-memory)
* **Status**: Highly active, lightweight, local-first Model Context Protocol (MCP) server for long-term memory.
* **Core Design**: Focused on natural language entity/observation extraction, knowledge graph relations, and biological-like memory lifecycle decay.

---

## 2. Local Codebase Overview
* **Project**: `@vheins/local-memory-mcp` (v0.18.9)
* **Core Design**: Extends the local memory concept into a complete software engineering project lifecycle tool. It adds multi-owner repository scoping, a task-tracking/issue system, a multi-agent handoff/claim model, local coding standards, and a Svelte 5 + Vite-powered visualization dashboard.

---

## 3. Detailed Gaps & Missing Features

| Feature | Upstream (`Beledarian`) | Local (`@vheins`) | Gap / Impact |
| :--- | :--- | :--- | :--- |
| **Knowledge Graph** | Full support with cascading entity deletion and relations (`create_entity`, `delete_observation`, `create_relation`, `delete_relation`, `delete_entity`). | None (flat memories only). | Agents cannot map complex structured context or cross-entity relationships locally. |
| **Archivist Auto-Ingestion** | `ARCHIVIST_STRATEGY` configuration with `nlp` (fast, offline entity extraction via `compromise` library) and `llm` (Ollama/Llama 3 deep relation extraction & importance scoring). | Passive manual ingestion only (requires explicit tool calls to `memory-store`). | Higher agent overhead as agents must explicitly structure and save facts instead of automated, non-blocking ingestion. |
| **Time Tunnel (Temporal Recall)** | Supports natural language date filtering (e.g., "last week", "yesterday") in queries. | Vector + Tag similarity search only; no natural language temporal parsing. | Search cannot easily filter by chronological context or relative date queries. |
| **Soul Maintenance** | Bundled extension (`soul_maintenance.ts`) implementing a biological decay model where memories decay unless used or immunized. | Hardcoded startup database archiving for expired/low-utility memories. | Memory lifecycle is rigid, non-modular, and lacks tag immunization. |
| **Extension Framework** | Modular extensions architecture using the `EXTENSIONS_PATH` environment variable. | No runtime extension framework. | Custom logic cannot be injected without modifying the core server code. |
| **Tool Interface** | Standardized routes: `remember_fact`, `remember_facts`, `recall`, `forget`. | Highly customized schemas: `memory-store`, `memory-update`, `memory-delete`, `memory-search`, etc. | Loss of drop-in compatibility with generic MCP clients expecting the upstream schema. |

---

## 4. Recommendations & Feasibility Analysis

We recommend a hybrid adoption strategy to reconcile the upstream features with our local codebase's focus on software engineering agent workflows:

### High Priority (Adopt)
1. **Implement Upstream Tool Schema Compatibility (Alias Layer)**:
   Add alias routes mapping upstream tools (`remember_fact`, `remember_facts`, `recall`, `forget`) directly to our corresponding database operations (`memory-store`, `memory-search`, `memory-delete`). This preserves drop-in client compatibility.
2. **Adopt Knowledge Graph System**:
   Integrate the `create_entity`, `delete_observation`, `create_relation`, `delete_relation`, and `delete_entity` database tables and tools. We will expose these structured relationships on the Svelte dashboard.
3. **Adopt NLP Archivist Strategy**:
   Add the lightweight, offline `compromise` library and implement the `nlp` strategy. This enables automated, zero-dependency, local-first entity extraction.
4. **Implement Time Tunnel Temporal Recall**:
   Add natural language date parsing to `memory-search` (using a lightweight helper) to filter results chronologically based on `created_at`.

### Rejected (Do Not Adopt)
1. **Ollama LLM Archivist Strategy**:
   Requires a running Ollama server, violating the zero-dependency, local-first startup reliability contract.
2. **Dynamic Extension Framework (`EXTENSIONS_PATH`)**:
   Avoid loading dynamic runtime extensions to prevent security vulnerabilities and dashboard desynchronization. Instead, port the "Soul Maintenance" memory decay and tag immunization features directly into the core engine.
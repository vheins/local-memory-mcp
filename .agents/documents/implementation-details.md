# System Architecture: Built for Reliability

The **MCP Local Memory Service** is engineered to be a lightweight yet powerful foundation for AI-assisted development. It prioritizes data integrity, privacy, and speed.

## Core Pillars

### 1. Local-First Persistence (SQLite)

Your data never leaves your machine. We use **SQLite** as the source of truth because it is:

- **Zero-Config:** Works out of the box without complex database servers.
- **Robust:** Atomic transactions ensure your memories are never corrupted.
- **Portable:** Your knowledge base is a single `.db` file that you can back up or move easily.

### 2. Modular Entity Architecture

The storage logic is decoupled into specialized entities in `src/mcp/entities/`.

- **Encapsulation:** Logic for Memories, Tasks, Standards, Handoffs, Claims, Knowledge Graph, and Action Logging is separated, preventing a "God Object" anti-pattern in the database layer.
- **Shared Standards:** All entities inherit from a common `BaseEntity` (in `src/mcp/storage/base.ts`), ensuring consistent error handling, SQL preparation, and row mapping.
- **Extensibility:** New features can be added by creating a new entity without risking regressions in existing core storage logic.

### 3. Semantic Intelligence (Transformers.js)

We use **ONNX Runtime** locally to generate vector embeddings.

- **Privacy:** Semantic understanding happens on your CPU, not in the cloud.
- **Offline Ready:** Once initialized, the system requires no internet connection.
- **Efficiency:** The `all-MiniLM-L6-v2` model is optimized for high-speed search on consumer hardware.

### 4. Smart Knowledge Lifecycle

Memories aren't just stored; they are managed:

- **Supersedes:** A built-in versioning system that archives old decisions when new ones are made.
- **Decay & Archive:** Automatically hides low-signal information after 7 days of inactivity (configurable). Uses importance decay rate of 0.5 and minimum importance threshold of 1.
- **Soul Maintenance:** Biological-inspired memory decay system with tag-based immunization. Runs at startup and periodically (checks if <24h since last run).
- **Conflict Detection:** Acts as a gatekeeper to prevent the Agent from storing contradicting rules (semantic similarity threshold > 0.55 triggers conflict flag).

### 5. Multi-Agent Coordination

- **Claims:** Task ownership tracking with agent/role attribution and lifecycle timestamps.
- **Handoffs:** Structured context transfer between agents with expiry and status tracking.
- **Knowledge Graph:** Entity-relationship-observation storage with NLP-based auto-extraction via `compromise`.

### 6. Knowledge Graph

- **Schema:** Entities, Relations, and Observations in dedicated SQLite tables with CASCADE deletes.
- **Auto-Extraction:** NLP Archivist extracts entities and relationships from memory content using the `compromise` library.
- **Visualization:** Force-directed graph renderer in the Svelte dashboard (`KGForceLayout.ts`, `KGCanvasRenderer.ts`).

## Security & Isolation

- **Repo Scoping:** Memories and tasks are automatically isolated by repository using MCP session context (roots).
- **Scope Injection:** Owner, repo, and folder are automatically injected from session context into tool arguments.
- **Write Locking:** File-based cross-process locking via `proper-lockfile` prevents concurrent write conflicts.
- **Audit Trails:** Every tool call is logged to `action_log`, allowing you to trace why an Agent made a specific decision.

## Performance

- **Query Latency:** Typically < 50ms for databases with thousands of entries.
- **Minimal Footprint:** Uses less than 100MB of RAM during typical usage.
- **Hybrid Search:** Combines TF-IDF cosine similarity with neural vector embeddings (ONNX) for optimal ranking.

## Disclaimer

**THE ARCHITECTURE IS PROVIDED "AS IS"**, without warranty of any kind. Reliability depends on the local environment and hardware performance.

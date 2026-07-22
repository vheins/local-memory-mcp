# Product Roadmap: Local Memory MCP

## Phase 1: Core Foundation ✅ (Completed)

- Objective: Establish basic SQLite storage, logging, and MCP Server setup.
- Key Deliverables: DB Setup, `memory-store`, `memory-delete`, `memory-detail`, basic CLI startup scripts.
- Status: **Done**

## Phase 2: Semantic Capabilities ✅ (Completed)

- Objective: Integrate embeddings, vector similarity search, and hybrid query capabilities.
- Key Deliverables: `@xenova/transformers` ONNX model initialization, `memory-search`, FTS5 optimizations.
- Status: **Done**

## Phase 3: Task Management & UI Dashboard ✅ (Completed)

- Objective: Build out lifecycle management tools and provide a GUI for developers.
- Key Deliverables: `task-create`, `task-list`, `task-detail`, `mcp-memory-dashboard.js` server, Svelte frontend.
- Status: **Done**

## Phase 4: Advanced MCP Client Integrations ✅ (Completed)

- Objective: Tap into advanced MCP features like form elicitation, completions, and server-driven prompts.
- Key Deliverables: `memory-synthesize` (Sampling), `task-create-interactive` (Elicitation), auto-completion API.
- Status: **Done**

## Phase 5: Agentic Auto-Features & Upstream Alignment ✅ (Completed)

- Objective: Context recall, decision logging, session summarization, upstream alias layer, Knowledge Graph, NLP Archivist, Time Tunnel, Soul Maintenance.
- Key Deliverables:
  - Sprint A (Agentic): `agent-context`, `decision-log`, `session-summarize`, upstream alias layer — **Done**
  - Sprint B (Infrastructure): Knowledge Graph, NLP Archivist, Time Tunnel, Soul Maintenance — **Done**
- Status: **Done**

## Phase 6: Codebase Index — Feature Planning ✅ (Completed)

- Objective: Complete product and technical planning for the Codebase Index feature.
- Key Deliverables:
  - Feature prioritization (MoSCoW) and MVP scope definition — **Done**
  - Feature decomposition into implementable tasks — **Done**
  - Deliverable planning (Sprints 7-10 with effort estimates) — **Done**
  - Architecture Decision Record (ADR-002) — **Done**
- Status: **Done**

## Phase 7: Codebase Index — MVP Implementation 🚧 (Active)

- Objective: Deliver the core indexing pipeline — file discovery, tree-sitter WASM parsing, SQLite storage, and a CLI trigger.
- Success Criteria:
  - Can index a TypeScript/JavaScript repository from end to end
  - Discovered files respect `.gitignore` patterns
  - Symbols (functions, classes, interfaces, types, enums, exported variables) stored in SQLite with precise location data
  - Full test coverage for all components
- Status: **In Progress** (Sprint 7)

### Sprint 7: Core Indexing

- **Goal**: Build the file discovery engine, tree-sitter parser integration, SQLite schema, and basic indexing pipeline.
- **Dependencies**: None (standalone new module).
- **Key Tasks**:
  - FileDiscoveryService (respect .gitignore, glob patterns)
  - Tree-sitter WASM parser integration (web-tree-sitter + TS grammar)
  - CodebaseFile entity + SQLite table
  - CodebaseSymbol entity + SQLite table
  - `index_repository` MCP tool
  - CLI trigger for indexing
  - Unit tests for each component
- **Duration**: 2 weeks
- **Status**: **Not Started**

### Sprint 8: MCP Tools & Search

- **Goal**: Expose indexed data through MCP tools — search by symbol name, inspect file symbols, trace symbol relationships, and get architecture overviews.
- **Dependencies**: Sprint 7 (SQLite schema + parser must exist).
- **Key Tasks**:
  - `search_symbols` MCP tool
  - `get_file_symbols` MCP tool
  - `get_architecture` MCP tool
  - `trace_symbol` MCP tool
  - Symbol search ranking and filtering
  - Integration tests for all MCP tools
  - API documentation update
- **Duration**: 2 weeks
- **Status**: **Not Started**

### Sprint 9: Dashboard & Auto-Index

- **Goal**: Surface codebase index data in the Svelte dashboard and add automatic indexing on project open.
- **Dependencies**: Sprint 8 (MCP tools must be stable).
- **Key Tasks**:
  - Codebase tab UI shell and routing
  - FileTree component
  - SymbolList and SymbolDetail components
  - SearchBar with autocomplete
  - IndexStatus widget
  - Auto-index on project open
  - Dashboard integration tests
- **Duration**: 2 weeks
- **Status**: **Not Started**

### Sprint 10: Polish & Performance

- **Goal**: Optimize for production use — incremental re-index, performance, test coverage, and release.
- **Dependencies**: Sprint 9 (all features merged).
- **Key Tasks**:
  - Incremental re-index (checksum-based)
  - Index staleness detection
  - Performance optimization for large repos
  - Error handling and recovery
  - Full test coverage
  - Documentation finalization
  - Release preparation
- **Duration**: 2 weeks
- **Status**: **Not Started**

---

## Phase 8: Codebase Index — Post-MVP 🔮 (Future)

- **Objective**: Multi-language expansion, cross-file relation resolution, LSP integration, real-time file watching.
- **Target**: 8-12 weeks after Phase 7 completion.
- **Status**: **Planned**

## Phase 9: Future Considerations 🔮 (Planned)

- Performance optimizations for large-scale deployments.
- Additional MCP protocol feature support.
- Community contributions and plugin ecosystem.

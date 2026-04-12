# Product Roadmap: Local Memory MCP

## Phase 1: Core Foundation
- Objective: Establish basic SQLite storage, logging, and MCP Server setup.
- Key Deliverables: DB Setup, `memory-store`, `memory-delete`, `memory-detail`, basic CLI startup scripts.
- Timeline: Week 1-2

## Phase 2: Semantic Capabilities
- Objective: Integrate embeddings, vector similarity search, and hybrid query capabilities.
- Key Deliverables: `@xenova/transformers` ONNX model initialization, `memory-search`, FTS5 optimizations.
- Timeline: Week 3-4

## Phase 3: Task Management & UI Dashboard
- Objective: Build out lifecycle management tools for context boundaries and provide a GUI for developers.
- Key Deliverables: `task-create`, `task-active`, `task-list`, `mcp-memory-dashboard.js` server, Svelte frontend.
- Timeline: Week 5-6

## Phase 4: Advanced MCP Client Integrations
- Objective: Tap into advanced MCP features like form elicitation, completions, and server-driven prompts.
- Key Deliverables: `memory-synthesize` (Sampling), `task-create-interactive` (Elicitation), auto-completion API.
- Timeline: Week 7-8
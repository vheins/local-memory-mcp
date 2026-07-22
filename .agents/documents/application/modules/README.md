# Module Catalog

Index of all application modules with links to their documentation.

## MCP Server

The core protocol server implementing MCP 2025-11-25. Provides memory, task, standard, knowledge graph, coordination, and reference services over JSON-RPC STDIO.

| Document                                         | Description                                         |
| :----------------------------------------------- | :-------------------------------------------------- |
| [Overview](mcp-server/overview.md)               | Architecture, core services, dependencies, patterns |
| [Memory Feature](mcp-server/memory.md)           | Semantic indexing, hybrid search, soul maintenance  |
| [Task Feature](mcp-server/task.md)               | Task lifecycle, state machine, transitions          |
| [Interaction Feature](mcp-server/interaction.md) | Completions, sessions, elicitation                  |
| [References Feature](mcp-server/references.md)   | Self-inspection of tools, prompts, resources        |

## Dashboard

Svelte 5 web dashboard providing a visual interface for the MCP system. Runs as an Express server with direct SQLite access.

| Document                                  | Description                                      |
| :---------------------------------------- | :----------------------------------------------- |
| [Overview](dashboard/overview.md)         | Architecture, core services, security invariants |
| [Dashboard UI](dashboard/dashboard-ui.md) | UI components, views, and aesthetics             |

## Codebase Index

Code intelligence module using tree-sitter AST parsing. Enables agents to index, search, and trace source code symbols without reading every file.

| Document                                                      | Description                                               |
| :------------------------------------------------------------ | :-------------------------------------------------------- |
| [Overview](codebase-index/overview.md)                        | Architecture, services, dependencies, performance targets |
| [Indexing Pipeline](codebase-index/indexing.md)               | File discovery, parsing, storage flow                     |
| [Symbol Search](codebase-index/search.md)                     | Symbol query, search modes, retrieval                     |
| [Architecture Query](codebase-index/architecture-overview.md) | Structural overview, call tracing, hotspots               |
| [README](codebase-index/README.md)                            | Brief module summary with key capabilities                |

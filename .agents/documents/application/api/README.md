# API Documentation Catalog

Index of all API specification documents across the application modules.

## MCP Server

Documents covering the JSON-RPC tools, resources, prompts, and error codes exposed by the core MCP server.

| Document                               | Description                                                                                                                                                                                             |
| :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Core API](mcp-server/api-core.md)     | `tools/list`, `tools/call`, `prompts/list`, `prompts/get`, `completion/complete`, `logging/setLevel`, resource URIs, JSON-RPC error codes                                                               |
| [Memory API](mcp-server/api-memory.md) | `memory-store`, `memory-search`, `memory-detail`, `memory-acknowledge`, `memory-update`, `memory-delete`, `memory-recap`, `memory-summarize`, `memory-synthesize`, upstream aliases, coordination tools |
| [Task API](mcp-server/api-task.md)     | `task-create`, `task-create-interactive`, `task-update`, `task-delete`, `task-list`, `task-detail`, `task-search`, state machine, transition rules                                                      |

## Dashboard

Documents covering the HTTP REST API exposed by the Express-based Dashboard server.

| Document                                  | Description                                                                         |
| :---------------------------------------- | :---------------------------------------------------------------------------------- |
| [Memories API](dashboard/api-memories.md) | `GET/POST/PATCH/DELETE /api/memories`, bulk operations, JSON:API format             |
| [System API](dashboard/api-system.md)     | Health, stats, version, export, capabilities, coordination, standards, KG endpoints |
| [Tasks API](dashboard/api-tasks.md)       | `GET/POST/PATCH/DELETE /api/tasks`, comments, analytics, state machine compliance   |

## Codebase Index

Documents covering the MCP tools and resource URIs for codebase indexing and symbol querying.

| Document                                         | Description                                                                                             |
| :----------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| [Indexing API](codebase-index/api-indexing.md)   | `index_repository`, `index_status` — trigger and monitor codebase indexing                              |
| [Search API](codebase-index/api-search.md)       | `search_symbols`, `get_file_symbols`, `get_architecture`, `trace_symbol` — symbol and structure queries |
| [Resources API](codebase-index/api-resources.md) | MCP resource URIs for codebase data (`codebase://` scheme)                                              |

## Conventions

- **MCP Server**: JSON-RPC 2.0 over STDIO, structured content arrays, scope injection for `owner/repo`.
- **Dashboard**: HTTP REST, JSON:API v1.1 format, stateless Express handlers, direct SQLite reads.
- **Codebase Index**: Follows existing MCP tool patterns (Zod validation, action logging, scope injection).

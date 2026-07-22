# API Module: Codebase Index

## Header & Navigation

- [Design — API Contracts](../../../design/codebase-index/api-contracts.md)
- [Design — Domain Model](../../../design/codebase-index/domain.md)
- [Design — Database Schema](../../../design/codebase-index/schema.md)
- [Testing Module](../../testing/codebase-index/README.md)

The Codebase Index feature provides MCP tools and resources for indexing, searching, and tracing source code symbols across a project. It uses tree-sitter AST parsing to extract structural declarations (functions, classes, interfaces, enums, type aliases, variables) and their relationships (calls, imports, inheritance).

## API Spec Documents

| Document                               | Scope                                                                      |
| :------------------------------------- | :------------------------------------------------------------------------- |
| [api-indexing.md](./api-indexing.md)   | `index_repository`, `index_status` — trigger and monitor codebase indexing |
| [api-search.md](./api-search.md)       | `search_symbols`, `get_file_symbols`, `get_architecture`, `trace_symbol`   |
| [api-resources.md](./api-resources.md) | MCP resource URIs for codebase data (`codebase://` scheme)                 |

## Tool Category Registration

| Category           | Tools                                                                                                        |
| :----------------- | :----------------------------------------------------------------------------------------------------------- |
| **Codebase Index** | `index_repository`, `index_status`, `search_symbols`, `get_file_symbols`, `get_architecture`, `trace_symbol` |

`index_repository` is the sole write tool in this category; it uses `store.withWrite()` for concurrency control. All other tools are read-only.

## Shared Conventions

- **Protocol**: All tools follow the MCP 2025-11-25 Structured Content specification (`content` array + `structuredContent` object).
- **Response format**: `McpResponse<T>` with `{ content: [...], structuredContent: { data: T, repo: string } }`.
- **Scope injection**: `projectPath` default resolves to the first MCP `roots/list` entry. Direct paths must fall within session roots.
- **Error format**: JSON-RPC 2.0 error codes (`-32602` for validation, `-32603` for internal errors) with descriptive text in `content`.
- **Database**: All data stored in the existing `memory.db` via SQLite tables: `codebase_files`, `codebase_symbols`, `codebase_relations`, `codebase_index_queue`.
- **WAL mode**: Writers don't block readers — `search_symbols` can execute concurrently with `index_repository`.

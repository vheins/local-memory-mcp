# Testing Documentation Catalog

Index of all testing documents across application modules. Tests follow the project's 4-layer concern model: **Database** → **Service** → **State** → **Integration**.

## MCP Server

| Document                                  | Description                                                               |
| :---------------------------------------- | :------------------------------------------------------------------------ |
| [Memory Tests](mcp-server/test-memory.md) | Test scenarios for memory CRUD, search, and acknowledge operations        |
| [Task Tests](mcp-server/test-task.md)     | Test scenarios for task lifecycle, state transitions, and token budgeting |

## Dashboard

| Document                                       | Description                                                   |
| :--------------------------------------------- | :------------------------------------------------------------ |
| [Dashboard Tests](dashboard/test-dashboard.md) | Test scenarios for dashboard API endpoints and UI integration |

## Codebase Index

| Document                                               | Description                                                     |
| :----------------------------------------------------- | :-------------------------------------------------------------- |
| [README](codebase-index/README.md)                     | Testing strategy, 4-layer model, execution order, test data     |
| [Test Tools](codebase-index/test-tools.md)             | Positive, negative, and edge case scenarios for all 6 MCP tools |
| [Test Indexing](codebase-index/test-indexing.md)       | Index pipeline verification: file discovery, parsing, storage   |
| [Test Search](codebase-index/test-search.md)           | Symbol search correctness: exact, prefix, substring modes       |
| [Test Performance](codebase-index/test-performance.md) | Performance benchmarks: index time, query latency, memory usage |
| [Strategy](codebase-index/strategy.md)                 | Overall testing strategy for the codebase index module          |

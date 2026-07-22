# Testing Module: Codebase Index

## Header & Navigation

- [Design — API Contracts](../../../design/codebase-index/api-contracts.md)
- [Design — Domain Model](../../../design/codebase-index/domain.md)
- [API Module](../api/codebase-index/README.md)

Verification scenarios for the Codebase Index feature. Tests validate MCP tool behaviors, data integrity, and error handling. All tools must maintain correct symbol extraction, relation resolution, and idempotent indexing.

## Test Spec Documents

| Document                         | Scope                                                               |
| :------------------------------- | :------------------------------------------------------------------ |
| [test-tools.md](./test-tools.md) | Test scenarios for all 6 MCP tools (positive, negative, edge cases) |

## Testing Architecture

Tests follow the project's 4-layer concern model:

| Layer       | Responsibility                                                       |
| :---------- | :------------------------------------------------------------------- |
| Database    | FK constraints, unique indexes, cascade deletes, checksum integrity  |
| Service     | Symbol extraction accuracy, relation resolution, search correctness  |
| State       | Indexing status transitions, progress reporting, single active index |
| Integration | MCP tool call → response contract compliance, scope injection        |

## Test Data

- **Fixture project**: A small TypeScript/JavaScript project under a temporary directory, containing known symbols and relationships.
- **Golden files**: Pre-computed expected symbol lists and relation maps for regression comparison.
- **Isolation**: Each test transaction wipes its project-path data on teardown via `DELETE FROM codebase_files WHERE project_path = ?`.

## Execution Order

1. **Database** — Verify schema creation, indexes, cascades.
2. **Service** — Parse known files, verify symbol/relation output.
3. **State** — Indexing lifecycle transitions, abort handling.
4. **Integration** — MCP tool invocations with full request/response cycle.

# Technical Design Document (TDD)

## Architecture
- **MCP Server:** Runs as a Node.js stdio process. Exposes JSON-RPC endpoints compliant with MCP 2025-11-25.
- **Dashboard Server:** Express.js + Vite/Svelte, running on a dedicated local port, interfacing with the same database via Read/Write connections.

## Database Schema
- **`memories`**: `id` (PK), `type`, `title`, `content`, `embedding` (BLOB), `importance`, `repo`.
- **`tasks`**: `id` (PK), `title`, `description`, `status`, `repo`.
- **`usage_logs`**: `id`, `memory_id` (FK), `action`, `timestamp`.

## API Contracts (MCP Tools)
- `memory-store(type, title, content, importance, repo)`
- `memory-search(query, repo, limit)`
- `task-create(title, description, status, repo)`
- `task-active(id)`
*(Refer to `.agents/documents/design/api/mcp-server/api-contract.md` for full JSON schemas).*
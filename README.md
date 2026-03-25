# MCP Local Memory Service

An MCP (Model Context Protocol) service that provides long-term memory for AI coding agents, with a web-based dashboard for visualization and management.

## Overview

This project implements a local memory service using Node.js and SQLite with vector similarity search capabilities. It solves the context loss problem in coding assistants by storing code facts, decisions, mistakes, and patterns.

## Features

- **Long-term Memory Storage**: Store decisions, code facts, mistakes, and patterns
- **Semantic Search**: Vector-based similarity search (with keyword fallback)
- **Git Scope Isolation**: Memories are scoped per repository to prevent cross-project contamination
- **Antigravity Summaries**: High-level project summaries to guide agent behavior
- **MCP Protocol**: Full implementation of MCP resources, tools, and prompts
- **Web Dashboard**: Browser-based UI for visualizing and managing memories

## Quick Start (npx)

The easiest way to use this MCP server is via npx - no installation required:

```bash
npx @vheins/local-memory-mcp
```

## Installation

### Local Development

```bash
npm install
npm run build
```

### Global Install

```bash
npm install -g @vheins/local-memory-mcp
mcp-memory-local
```

## MCP Client Configuration

This server works with any MCP-compatible client. Add it to your configuration:

### OpenCode

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["@vheins/local-memory-mcp"]
    }
  }
}
```

### Claude Desktop (claude.ai)

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["@vheins/local-memory-mcp"]
    }
  }
}
```

### Cursor

Settings → Features → Models → "Edit JSON"

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["@vheins/local-memory-mcp"]
    }
  }
}
```

### Kiro Antigravity

Add to your MCP configuration file:

```json
{
  "servers": {
    "local-memory": {
      "command": "npx",
      "args": ["@vheins/local-memory-mcp"]
    }
  }
}
```

### Trae

Settings → Integrations → MCP → Add Server

```json
{
  "command": "npx",
  "args": ["@vheins/local-memory-mcp"]
}
```

### Gemini CLI

```bash
gemini mcp add local-memory -- npx @vheins/local-memory-mcp
```

### Codex

```json
{
  "mcp_servers": {
    "local-memory": {
      "command": "npx",
      "args": ["@vheins/local-memory-mcp"]
    }
  }
}
```

### VS Code (with MCP extension)

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["@vheins/local-memory-mcp"]
    }
  }
}
```

### Other MCP Clients

For any other MCP-compatible client, use:

- **Command**: `npx`
- **Args**: `["@vheins/local-memory-mcp"]`

Or build from source:

- **Command**: `node`
- **Args**: `["/path/to/dist/server.js"]`

## Usage

### MCP Server

The server runs as an MCP JSON-RPC server over stdin/stdout:

```bash
node dist/server.js
```

### Web Dashboard

Start the web dashboard for managing memories:

```bash
npm run dashboard
```

Then open your browser to `http://localhost:3456`

The dashboard provides:
- Live memory visualization by repository
- Summary statistics and charts
- Memory browsing with sorting and filtering
- Edit and delete operations with confirmation
- Real-time MCP connection status

See [DASHBOARD.md](DASHBOARD.md) for detailed dashboard documentation.

### MCP Tools

#### memory.store
Store a new memory entry that affects future behavior.

```json
{
  "type": "decision",
  "content": "Do not use ORM; use raw SQL only for database access",
  "importance": 5,
  "scope": {
    "repo": "backend-api",
    "language": "typescript"
  }
}
```

#### memory.search
Search for relevant memories in the current repository.

```json
{
  "query": "database orm",
  "repo": "backend-api",
  "limit": 5
}
```

#### memory.update
Update an existing memory entry.

```json
{
  "id": "uuid",
  "content": "Updated content",
  "importance": 4
}
```

#### memory.summarize
Update the antigravity summary for a repository.

```json
{
  "repo": "backend-api",
  "signals": [
    "Uses raw SQL (no ORM)",
    "Explicit DTO validation required"
  ]
}
```

#### memory.delete
Delete a memory entry (soft delete - removes from active use).

```json
{
  "id": "uuid"
}
```

### MCP Resources

- `memory://index` - Recent memory entries (metadata only)
- `memory://{id}` - Read individual memory entry
- `memory://summary/{repo}` - Project summary

### MCP Prompts

- `memory-agent-core` - Core behavioral contract for memory-aware agents
- `memory-index-policy` - Enforce strict memory discipline
- `tool-usage-guidelines` - Prevent tool abuse

## Testing

Run the test suite:

```bash
./test.sh
```

## Architecture

The implementation follows the documented specifications in the `docs/` folder:

- **MCP Server Loop**: JSON-RPC protocol handler
- **Git Scope Resolver**: Determines active repository
- **SQLite Storage**: Primary data store with indexes
- **Vector Search Stub**: Semantic similarity (ready for embedding integration)
- **Tool Validation**: Strict schema validation with Zod

## Storage

Memory is stored in `storage/memory.db` using SQLite with the following schema:

- `memories` table: All memory entries with repo scoping
- `memory_summary` table: Antigravity summaries per repo
- Indexes on repo, type, and importance for fast queries

## Memory Types

1. **code_fact**: Stable facts about the codebase
2. **decision**: Design or architectural decisions
3. **mistake**: Errors that should not be repeated
4. **pattern**: Recurring implementation patterns

## Documentation

- [Product Requirements Document (PRD)](docs/PRD.md)
- [Auto-Memory Heuristics & Scoping](docs/SPEC-heuristics.md)
- [Server Skeleton & Contract](docs/SPEC-server.md)
- [Implementation Skeleton (Node.js)](docs/SPEC-skeleton.md)
- [Git / Project Scope Resolver](docs/SPEC-git-scope.md)
- [MCP Tool Schema & Validation](docs/SPEC-tool-schema.md)
- [SQLite Schema & Migration](docs/SPEC-sqlite-schema.md)
- [Vector Search Stub & Similarity Layer](docs/SPEC-vector-search.md)
- [Test Scenarios (Behavioral Contract)](docs/TEST-scenarios.md)
- [Agent System Prompt](docs/PROMPT-agent.md)

## License

MIT

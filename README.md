# @vheins/local-memory-mcp

[![npm version](https://img.shields.io/npm/v/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that provides **persistent, long-term memory** for AI coding agents. It helps agents remember architectural decisions, project-specific patterns, past mistakes, and codebase facts across different chat sessions.

Includes a **Web Dashboard** for easy management and visualization of stored memories.

## 🚀 Key Features

- **Project-Specific Memory**: Automatic isolation of memories per Git repository.
- **Durable Knowledge**: Store decisions, facts, mistakes, and patterns that survive context window resets.
- **Hybrid Search**: Combines semantic similarity scoring with keyword fallback.
- **Antigravity Summaries**: High-level project-wide "rules of engagement" for agents.
- **Web Dashboard**: Interactive UI to browse, edit, and delete memories (default: `http://localhost:3456`).
- **SQLite Backend**: Fast, local, and file-based storage.

## 📦 Installation

### Via npx (Recommended for most clients)
No manual installation needed. Configure your MCP client to run:
```bash
npx @vheins/local-memory-mcp
```

### Global Install
```bash
npm install -g @vheins/local-memory-mcp
```

## 🛠 Configuration

Add the server to your favorite MCP-compatible client (Cursor, Claude Desktop, Gemini CLI, etc.):

### Claude Desktop / Cursor / OpenCode
Add this to your `mcpServers` configuration:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"]
    }
  }
}
```

### Gemini CLI
```bash
gemini mcp add local-memory -- npx -y @vheins/local-memory-mcp
```

## 🧠 Instructions for AI Agents (The "Rules")

To make this memory effective, agents should be instructed (via System Prompt or Custom Instructions) to follow these rules:

### 1. The "Start of Session" Rule
At the beginning of every new session or when entering a new repository, the agent **MUST**:
- Call `memory-recap` to see the most recent project context.
- Call `memory-search` with a query like "architectural rules" or "project patterns".

### 2. The "Decision Logging" Rule
Whenever a significant technical decision is made (e.g., choosing a library, defining a folder structure, or setting a coding standard), the agent **MUST** call `memory-store` with `type: "decision"`.

### 3. The "Mistake Prevention" Rule
If an agent makes a mistake that takes time to debug, it **MUST** log it using `memory-store` with `type: "mistake"` to ensure it (or future agents) doesn't repeat it.

### 4. The "Fact Update" Rule
If a fundamental fact about the codebase changes, the agent should search for the old memory and use `memory-update` or `memory-delete`.

## 🔧 Tools Provided

### `memory-store`
Stores a new memory.
- **Parameters**: `type` (code_fact, decision, mistake, pattern), `title`, `content`, `importance` (1-5), `scope` (object with `repo`).

### `memory-search`
Searches for memories using semantic similarity.
- **Parameters**: `query`, `repo`, `limit`, `includeRecap` (boolean).

### `memory-recap`
Quickly gets the latest memories for a repository.
- **Parameters**: `repo`, `limit`.

### `memory-summarize`
Updates the "Antigravity Summary" (High-level project rules).
- **Parameters**: `repo`, `signals` (array of strings).

### `memory-update` / `memory-delete`
Manage existing memory entries by ID.

## 📊 Web Dashboard

The service includes a built-in dashboard to help you manage your memories visually.

1. Run the dashboard:
   ```bash
   npx @vheins/local-memory-mcp dashboard
   ```
2. Open `http://localhost:3456` in your browser.

Features:
- Filter memories by repository.
- Visualize memory distribution (Types & Importance).
- Quick search and edit functionality.

## ⚙️ Environment Variables

- `MEMORY_DB_PATH`: Custom path for the SQLite database file (default: `./storage/memory.db`).
- `PORT`: Port for the Web Dashboard (default: `3456`).

## 📄 License

MIT © Muhammad Rheza Alfin

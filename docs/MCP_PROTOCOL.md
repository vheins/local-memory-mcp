# MCP Protocol Reference

This document details the technical interface exposed by this server for AI Agents.

## Tools (Agent Functions)

### `memory-store`
Stores a new memory.
- **Input:** `type`, `title`, `content`, `importance` (1-5), `scope`, `tags`, `is_global`, `supersedes` (optional).
- **Behavior:** Performs automatic conflict detection before saving.

### `memory-search`
Searches for relevant memories.
- **Input:** `query`, `repo`, `current_file_path`, `current_tags`, `include_archived`.
- **Output:** Results sorted by semantic relevance and workspace proximity.

### `memory-acknowledge`
Logs the usage of a memory. **MANDATORY** for the agent after using a memory to write code.
- **Input:** `memory_id`, `status` (`used` | `irrelevant` | `contradictory`).

### `memory-update` / `memory-delete`
Memory lifecycle management tools.

---

## Resources (Introspection Data)

### `memory://index?repo={repo}`
Lists all active memory entries in JSON format for a specific repository.

### `memory://tags/{tag}`
Displays memories filtered by a specific technology tag across all projects.

### `memory://summary/{repo}`
A concise, high-level snapshot of all major architectural decisions for a project.

### `memory://{id}`
Full details of a single memory entry, including its usage statistics.

---

## Prompts (Agent Instructions)

The server provides instruction templates to ensure the Agent maintains memory discipline:
- **`memory-agent-core`:** Basic behavioral contract for memory-aware agents.
- **`memory-index-policy`:** Policy on what knowledge should and should not be stored.
- **`tool-usage-guidelines`:** Technical guidelines for using MCP tools effectively.

---

## ⚠️ No Warranty
The MCP interface and responses are provided **"AS IS"** without any warranty.

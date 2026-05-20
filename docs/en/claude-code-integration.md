# Integration with Claude Code

Complete guide for connecting **MCP Local Memory Service** to [Claude Code](https://code.claude.com) — Anthropic's CLI AI agent.

---

## Prerequisites

- **Node.js 18+** installed
- **Claude Code** installed (`npm install -g @anthropic-ai/claude-code`)
- Internet access for first-time setup (embedding model downloads once)

---

## Installation

### Option 1: Quick Start (npx — no permanent install)

Suitable for first try. Each time Claude Code starts, `npx` will run the package from npm:

```bash
claude mcp add --transport stdio --scope project local-memory -- npx -y @vheins/local-memory-mcp
```

### Option 2: Global Install (recommended)

Install the package permanently — faster startup, no re-download:

```bash
npm install -g @vheins/local-memory-mcp
claude mcp add --transport stdio --scope project local-memory -- local-memory-mcp
```

### Option 3: Local Install (via project package.json)

If your project already has a `package.json`:

```bash
npm install --save-dev @vheins/local-memory-mcp
claude mcp add --transport stdio --scope project local-memory -- npx @vheins/local-memory-mcp
```

---

## Configuration Scope

Use `--scope` as needed:

| Scope | File | Shared? | Best for |
|-------|------|---------|----------|
| `project` | `.mcp.json` in project root | Yes (via git) | All team members share the same memory |
| `local` | `~/.claude.json` | No | Just for you |
| `user` | `~/.claude.json` (global) | No | You across all projects |

Example:
```bash
# Just for you, in this project
claude mcp add --transport stdio --scope local local-memory -- npx -y @vheins/local-memory-mcp

# All team members
claude mcp add --transport stdio --scope project local-memory -- npx -y @vheins/local-memory-mcp
```

---

## Verification

### Check MCP server list
```bash
claude mcp list
```
Output:
```
local-memory (project) — running
  Tools: memory-store, memory-search, memory-detail, memory-update, ...
```

### Check status inside Claude Code
```
/mcp
```
The `/mcp` panel will show the `local-memory` server with a list of available tools.

### Test connection
Inside Claude Code, ask:
> *"Check local memory for this project"*

If Claude responds with "No memory found" (not an error), the connection is successful.

---

## Manual Configuration (.mcp.json)

If you prefer to edit the `.mcp.json` file directly (e.g., for version control), create the file in the project root:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "type": "stdio"
    }
  }
}
```

Or for global install:
```json
{
  "mcpServers": {
    "local-memory": {
      "command": "local-memory-mcp",
      "type": "stdio"
    }
  }
}
```

---

## Environment Variables

Claude Code automatically sets `CLAUDE_PROJECT_DIR` to the project root. The MCP Local Memory Server reads this environment variable to detect the active repository.

You can add env vars during registration:
```bash
claude mcp add --transport stdio --scope project \
  --env STORAGE_PATH=/custom/path \
  local-memory -- npx -y @vheins/local-memory-mcp
```

Or in `.mcp.json`:
```json
{
  "mcpServers": {
    "local-memory": {
      "command": "local-memory-mcp",
      "args": [],
      "env": {
        "PORT": "3456"
      }
    }
  }
}
```

---

## Daily Workflow with Claude Code

### Starting a new session
```
Claude, check pending tasks for this project.
```
Claude will call `task-list` and display the tasks to work on.

### Storing knowledge
```
Note that we decided to use Prisma ORM because it's more mature.
```
Claude will call `memory-store` with type `decision`.

### Searching old memories
```
What do we know about authentication in this project?
```
Claude will call `memory-search` and `memory-synthesize` to provide an answer.

### Completing a task
```
Task LOGIN-001 is done, commit is at abc123.
```
Claude will call `task-update` with status `completed`.

---

## Running the Dashboard

Claude Code can also run the web dashboard:

```bash
# From CLI (separate from Claude Code)
npx @vheins/local-memory-mcp dashboard
# Open http://localhost:3456
```

Or ask Claude to run it:
> *"Run the memory dashboard"* — but keep in mind, Claude Code must remain running in a separate terminal.

---

## Troubleshooting for Claude Code

### "local-memory" not found in `/mcp`
```bash
claude mcp list   # check if registered
claude mcp remove local-memory
# re-register
claude mcp add --transport stdio --scope project local-memory -- npx -y @vheins/local-memory-mcp
```

### Server crashes / disconnected
```bash
# Check error log
claude mcp get local-memory

# Try running directly to see errors
npx -y @vheins/local-memory-mcp
```

### Tools not showing even though server is running
Claude Code supports `list_changed` notifications, so new tools should appear automatically. If not:
```
/mcp   # refresh panel
```
Or restart Claude Code.

### Slow startup
If using `npx`, each startup can be slow due to download/cache check. Solution: **global install** (Option 2).

---

## Disabling / Removing

```bash
claude mcp remove local-memory
```

To temporarily disable, use the `/mcp` panel inside Claude Code.

---

## References

- [Claude Code MCP Documentation](https://code.claude.com/docs/id/mcp)
- [MCP Local Memory — Getting Started](getting-started.md)
- [Tool Reference & Usage Guide](tools-reference.md)
- [Troubleshooting Guide](troubleshooting.md)

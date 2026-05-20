# Integration with Codex (OpenAI)

Complete guide for connecting **MCP Local Memory Service** to [Codex](https://developers.openai.com/codex) — OpenAI's AI coding agent.

---

## Prerequisites

- **Node.js 18+** installed
- **Codex CLI** installed ([download](https://developers.openai.com/codex))
- Internet access for first-time setup

---

## Installation

### Option 1: Quick Start (npx)

Suitable for first try:

```bash
npm install -g @vheins/local-memory-mcp
```

Then configure the MCP server in Codex (see configuration section below).

### Option 2: Global Install (recommended)

Faster startup, no re-download:

```bash
npm install -g @vheins/local-memory-mcp
```

---

## MCP Server Configuration

Codex stores MCP configuration in **`config.toml`** (TOML format, not JSON). There are two levels:

### User Level (all projects)

Open `~/.codex/config.toml` and add:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
```

If already globally installed:

```toml
[mcp_servers.local-memory]
command = "local-memory-mcp"
args = []
```

### Project Level (per project, trusted projects only)

Create `.codex/config.toml` in the project root:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
```

---

## Setup via CLI

Codex can also be configured directly from the CLI:

```bash
# Add MCP server
codex mcp add local-memory -- npx -y @vheins/local-memory-mcp
```

```bash
# List servers
codex mcp list
```

```bash
# Remove server
codex mcp remove local-memory
```

---

## Setup via TUI (Terminal UI)

Inside a Codex session, use:

```
/mcp
```

The `/mcp` panel will display all active MCP servers including `local-memory`.

---

## Environment Variables

Codex uses TOML for env vars:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]

[mcp_servers.local-memory.env]
PORT = "3456"
STORAGE_PATH = "/custom/path"
```

### Forwarding env vars from the system

Use `env_vars` to inherit variables from the Codex environment:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
env_vars = ["HOME", "USER"]
```

Or with a specific source:

```toml
env_vars = [
  "LOCAL_TOKEN",
  { name = "REMOTE_TOKEN", source = "remote" }
]
```

---

## Tool Approval Mode

Control whether Codex needs to ask permission before calling a tool:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
default_tools_approval_mode = "prompt"
```

| Mode | Behavior |
|------|----------|
| `auto` | Auto-approve all tools |
| `prompt` | Ask the user each time (default) |
| `approve` | Always approve without prompt |

### Per-tool approval

Set approval mode for specific tools:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
default_tools_approval_mode = "prompt"

[mcp_servers.local-memory.tools.memory-search]
approval_mode = "auto"

[mcp_servers.local-memory.tools.memory-store]
approval_mode = "prompt"

[mcp_servers.local-memory.tools.task-delete]
approval_mode = "approve"
```

---

## Tool Filter (Allow/Deny List)

Restrict which tools are available:

```toml
# Only these tools may be used
enabled_tools = ["memory-search", "memory-detail", "memory-recap", "task-list", "task-detail"]

# Disallowed tools (applied after enabled_tools)
disabled_tools = ["memory-delete", "task-delete"]
```

---

## Temporarily Disable

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
enabled = false
```

---

## Timeout Configuration

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

---

## Verification

```bash
# Check server list
codex mcp list
```

Output:
```
local-memory — running
  Tools: memory-store, memory-search, memory-detail, ...
```

Inside the Codex TUI, open `/mcp` to check server status.

Test the connection by asking Codex:

> *"Check local memory for this project"*

If Codex responds with "No memory" (not an error), the connection is successful.

---

## Running the Dashboard

```bash
npx @vheins/local-memory-mcp dashboard
# Open http://localhost:3456
```

---

## Complete Configuration Example

Here is a complete configuration example for `~/.codex/config.toml` or `.codex/config.toml`:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
enabled = true
startup_timeout_sec = 20
tool_timeout_sec = 45
default_tools_approval_mode = "prompt"
enabled_tools = [
  "memory-store", "memory-search", "memory-detail",
  "memory-update", "memory-acknowledge", "memory-recap",
  "task-list", "task-detail", "task-update",
  "standard-search", "standard-detail"
]
disabled_tools = ["memory-delete", "task-delete"]

# Tool-specific approval overrides
[mcp_servers.local-memory.tools.memory-search]
approval_mode = "auto"

[mcp_servers.local-memory.tools.memory-detail]
approval_mode = "auto"

[mcp_servers.local-memory.tools.task-list]
approval_mode = "auto"

[mcp_servers.local-memory.tools.task-detail]
approval_mode = "auto"

[mcp_servers.local-memory.tools.memory-store]
approval_mode = "prompt"

[mcp_servers.local-memory.tools.task-update]
approval_mode = "prompt"
```

---

## Troubleshooting for Codex

### Server not found

```bash
# Check if server is registered
codex mcp list

# Check PATH
which npx
which local-memory-mcp

# Re-add
codex mcp add local-memory -- npx -y @vheins/local-memory-mcp
```

### Server error / disconnect

Run directly to see errors:
```bash
npx -y @vheins/local-memory-mcp
```

### Configuration not taking effect

Codex reads `config.toml` — make sure the TOML format is valid (not JSON).

### Slow startup

Global install is faster than `npx`. Codex also supports `startup_timeout_sec` — increase it if the server needs more time.

---

## References

- [Codex MCP Documentation](https://developers.openai.com/codex/mcp)
- [Codex Config Reference](https://developers.openai.com/codex/config-reference)
- [MCP Local Memory — Getting Started](getting-started.md)
- [Tool Reference & Usage Guide](tools-reference.md)
- [Troubleshooting Guide](troubleshooting.md)

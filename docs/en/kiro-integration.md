# Integration with Kiro

Complete guide for connecting **MCP Local Memory Service** to [Kiro](https://kiro.dev) — AI-powered IDE.

---

## Prerequisites

- **Node.js 18+** installed
- **Kiro** installed ([download](https://kiro.dev/downloads))
- Internet access for first-time setup

---

## Installation

### Option 1: Quick Start (npx)

Suitable for first try. `npx` automatically downloads and runs the package:

```bash
npm install -g @vheins/local-memory-mcp
```

Then configure the MCP server in Kiro (see configuration section below).

### Option 2: Global Install (recommended)

Faster startup, no re-download every time Kiro restarts:

```bash
npm install -g @vheins/local-memory-mcp
```

---

## MCP Server Configuration

Kiro reads MCP configuration from a JSON file. There are two levels:

### Workspace Level (per project)

Create a `.kiro/settings/mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "disabled": false
    }
  }
}
```

Or if already globally installed:
```json
{
  "mcpServers": {
    "local-memory": {
      "command": "local-memory-mcp",
      "args": [],
      "disabled": false
    }
  }
}
```

### User Level (all projects)

Create a `~/.kiro/settings/mcp.json` file:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "disabled": false
    }
  }
}
```

> **Priority**: Workspace level overrides user level. If both files exist, the workspace configuration takes precedence.

---

## Setup via Command Palette

1. Open Kiro
2. Open the command palette:
   - Mac: `Cmd + Shift + P`
   - Windows/Linux: `Ctrl + Shift + P`
3. Search for **"MCP"**
4. Choose one of:
   - **Kiro: Open workspace MCP config (JSON)** — for this project only
   - **Kiro: Open user MCP config (JSON)** — for all projects
5. Add the `local-memory` configuration as shown above
6. **Save the file** — Kiro automatically reconnects to the server

---

## Setup via Kiro Panel

1. Open **Kiro Panel** (sidebar)
2. Click the **Open MCP Config** icon
3. Add the `local-memory` configuration
4. Save the file

---

## Auto-Approve Tools (Optional)

To prevent Kiro from asking for confirmation every time the agent calls a memory tool, you can auto-approve:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "autoApprove": [
        "memory-search",
        "memory-detail",
        "memory-recap",
        "task-list",
        "task-detail",
        "standard-search",
        "standard-detail"
      ]
    }
  }
}
```

Read-only tools are safe to auto-approve. Write tools (`memory-store`, `task-update`, etc.) should still require confirmation.

To auto-approve all tools (not recommended):
```json
"autoApprove": ["*"]
```

---

## Disable Specific Tools

If there are tools you don't want to use:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "disabledTools": ["memory-delete", "task-delete"]
    }
  }
}
```

---

## Environment Variables

You can add environment variables for the server:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "env": {
        "PORT": "3456"
      }
    }
  }
}
```

Or use variable expansion from the system:
```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "env": {
        "STORAGE_PATH": "${HOME}/my-custom-path/memory"
      }
    }
  }
}
```

---

## Temporarily Disable

To turn off the server without removing the configuration:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "disabled": true
    }
  }
}
```

---

## Verification

1. Save the MCP configuration file
2. Open **Kiro Panel**
3. Check whether the `local-memory` server appears with status **running**
4. Try asking the Kiro agent:
   > *"What do you know about this project?"*

If the agent responds with a list of memories or "No memories yet" (not an error), the connection is successful.

---

## Running the Dashboard

Kiro can run the memory web dashboard:

```bash
npx @vheins/local-memory-mcp dashboard
# Open http://localhost:3456
```

Or ask the Kiro agent to run it — but the dashboard will run in a separate terminal.

---

## Troubleshooting for Kiro

### Server not showing in the panel

**Check JSON syntax:**
```bash
# Validate JSON file
cat .kiro/settings/mcp.json | python3 -m json.tool
```

**Check PATH:**
```bash
which npx
which local-memory-mcp   # if global install
```

Make sure the command can be run from the terminal.

### Server error / disconnect

Try running directly to see errors:
```bash
npx -y @vheins/local-memory-mcp
```

### Configuration changes not taking effect

Kiro auto-reconnects when the file is saved. If not:
1. Open the command palette
2. Search for **"Kiro: Reload Window"**
3. Or restart Kiro

### Slow startup

If using `npx`, every Kiro restart may re-download the package. Solution: **global install**.

---

## References

- [Kiro MCP Configuration Docs](https://kiro.dev/docs/mcp/configuration)
- [Kiro MCP Security](https://kiro.dev/docs/mcp/security)
- [MCP Local Memory — Getting Started](getting-started.md)
- [Tool Reference & Usage Guide](tools-reference.md)
- [Troubleshooting Guide](troubleshooting.md)

# Getting Started

This guide will help you install and configure the MCP Local Memory Service on your local machine.

## Prerequisites
- **Node.js:** Version 18 or higher.
- **MCP Client:** One or more MCP-compatible clients installed (e.g., Claude Desktop, Cursor, Windsurf).

## Installation

### Using NPM (Recommended)
You can install the package globally for easier command-line access:
```bash
npm install -g @vheins/local-memory-mcp
```

Or run it directly using `npx` without permanent installation:
```bash
npx @vheins/local-memory-mcp
```

## Client Configuration

### Claude Desktop
Add the following entry to your configuration file (usually located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

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

### Cursor / VS Code Extensions
If using an MCP extension in Cursor or VS Code, add the server with these settings:
- **Command:** `npx`
- **Arguments:** `-y @vheins/local-memory-mcp`

## Data Location
By default, your memory database is stored at:
- **Linux/macOS:** `~/.config/local-memory-mcp/memory.db`
- **Windows:** `%USERPROFILE%\.config\local-memory-mcp\memory.db`

You can customize this location by setting the `MEMORY_DB_PATH` environment variable.

## Running the Web Dashboard
The memory server includes a visual dashboard to manage your agent's memories.
```bash
# Start the dashboard (default port 3456)
npx @vheins/local-memory-mcp-dashboard
```
Open your browser and navigate to `http://localhost:3456`.

## ⚠️ No Warranty
This software is provided "as is" and without any warranty. Use at your own risk.

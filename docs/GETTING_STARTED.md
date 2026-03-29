# Getting Started & Setup

This guide provides step-by-step instructions to install and configure the MCP Local Memory Service globally on your machine for various AI Agents and IDEs.

## 1. Installation

Install the package globally using NPM to make it available to all your MCP clients:

```bash
npm install -g @vheins/local-memory-mcp
```

*Verification:* Run `npx @vheins/local-memory-mcp --help` to ensure the server is accessible.

---

## 2. Global Configuration (User Level)

To enable the memory service in your favorite tools, add it to their respective global configuration files.

### 🏠 Claude Desktop
Claude Desktop uses a central JSON file to manage MCP servers.

- **File Path:**
  - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
  - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

- **Configuration:**
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

### 🛸 Cursor
Cursor looks for a global MCP configuration in your home directory.

- **File Path:** `~/.cursor/mcp.json` (Create it if it doesn't exist)

- **Configuration:**
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

### 🌊 Windsurf (Codeium)
Windsurf stores its configuration within the Codeium folder.

- **File Path:** `~/.codeium/windsurf/mcp_config.json`

- **Configuration:**
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

### 📝 VS Code (via Roo Code / Cline)
Extensions like **Roo Code** or **Cline** allow you to configure MCP servers.

- **Setup:** Open the extension settings or Command Palette and find "Open User Configuration".
- **Configuration Key:** Use `mcpServers` or `servers` depending on the extension.
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

### 🪿 Goose (Block)
Goose uses a YAML configuration file for its extensions.

- **File Path:** `~/.config/goose/config.yaml`

- **Configuration:**
```yaml
extensions:
  local-memory:
    name: local-memory
    cmd: npx
    args:
      - -y
      - "@vheins/local-memory-mcp"
    enabled: true
    type: stdio
```

---

## 3. Environment Variables (Optional)

You can customize the server behavior by setting these variables in your OS or within the `env` section of your JSON config:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `MEMORY_DB_PATH` | Custom path for the SQLite database | `~/.config/local-memory-mcp/memory.db` |
| `ENABLE_AUTO_ARCHIVE` | Enable automatic decay of old memories | `false` |
| `LOG_LEVEL` | Logging verbosity (`info`, `debug`, `warn`, `error`) | `info` |

---

## 4. Troubleshooting

1. **Server not found:** Ensure `npx` is in your system PATH.
2. **Permission denied:** On Linux/macOS, ensure the configuration folder is writable by your user.
3. **Logs:** Check the Agent's output console or the server logs for detailed error messages.

## ⚠️ Disclaimer
**THE SOFTWARE IS PROVIDED "AS IS"**, without warranty of any kind. Installation and configuration are performed at the user's own risk.

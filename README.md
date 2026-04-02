# @vheins/local-memory-mcp

[![npm version](https://img.shields.io/npm/v/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![npm total downloads](https://img.shields.io/npm/dt/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MCP Local Memory Service** is a high-performance [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides long-term, high-signal memory for AI Agents (such as Claude Desktop, Cursor, or Windsurf).

Built with a **Local-First** philosophy, this service stores architectural decisions, code patterns, and critical facts locally on your machine using SQLite and AI-powered Semantic Search.

## 🚀 Key Features

- 🧠 **Semantic Search (V2):** Find memories based on meaning, not just keywords, using the `all-MiniLM-L6-v2` model locally.
- 🔄 **Tech-Stack Affinity:** Share knowledge across repositories intelligently based on technology tags (e.g., Filament memories in Repo A are accessible in Repo B).
- 🛡️ **Anti-Hallucination Guard:** Prevents Agents from hallucinating with strict similarity thresholds and decision conflict detection.
- 📉 **Automatic Memory Decay:** Automatically archives obsolete memories to keep the context clean and relevant.
- 📊 **Glassy Dashboard:** Visualize memories, usage statistics, and audit interaction logs through a modern web interface.

## 🔌 MCP Usage & Configuration

Add this service to your AI Agent (Claude Desktop, Cursor, Windsurf, etc.) using one of the methods below.

> 💡 **Recommendation:** If your MCP runs frequently (agents, CI, automation), avoid `npx` and use a global or local install instead. It reduces unnecessary NPM downloads and speeds up Agent startup.

### 🚀 Quick Start (Zero Setup)
Best for **first-time users** or **quick testing**. This uses `npx` to run the server without any permanent setup.

```json
"local-memory": {
  "command": "npx",
  "args": ["-y", "@vheins/local-memory-mcp"],
  "type": "stdio"
}
```
* **Uses `npx`**: Automatically handles the execution.
* **Tradeoff**: May re-download the package in some environments and is not optimal for frequent execution.

### ⚡ Recommended for Production / Frequent Usage
This method ensures the fastest startup times and maximum reliability for daily use.

1. **Install globally:**
   ```bash
   npm install -g @vheins/local-memory-mcp
   ```

2. **Add to your configuration:**
   ```json
   "local-memory": {
     "command": "local-memory-mcp",
     "type": "stdio"
   }
   ```
* **Faster startup**: No network checks required on every start.
* **No repeated downloads**: Saves bandwidth and avoids NPM registry dependency.
* **Better for automation**: More stable for heavy-duty Agent workflows.

### 🧠 How It Works (Important Insight)
* **npx usage**: When you use `npx`, it often performs a network request to check for the latest version or re-downloads the package if it's not in the cache. Since MCP clients start and stop tools frequently, this can lead to hundreds of unnecessary downloads.
* **Installed binary**: By installing the package, you keep a permanent copy on your disk. The Agent reuses this local version instantly, providing a much smoother experience.

## 📊 Glassy Dashboard

Visualize and manage your Agent's memory through a modern web interface.

````carousel
![Dashboard Overview](docs/screenshots/dashboard.png)
<!-- slide -->
![Memories Management](docs/screenshots/memories.png)
<!-- slide -->
![Task Tracking](docs/screenshots/tasks.png)
<!-- slide -->
![Available Tools & Reference](docs/screenshots/reference.png)
````

### How to Run
```bash
local-memory-mcp dashboard
```
*If not installed globally, use:* `npx @vheins/local-memory-mcp dashboard`

### Auto-launch in VS Code
Add this to your `.vscode/tasks.json` to have the dashboard start automatically:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Launch Memory Dashboard",
      "type": "shell",
      "command": "npx -y @vheins/local-memory-mcp dashboard",
      "isBackground": true,
      "runOptions": { "runOn": "folderOpen" }
    }
  ]
}
```

## 📖 Documentation

- [Getting Started & Setup](docs/GETTING_STARTED.md)
- [Perspectives: Why use Local Memory?](docs/PERSPECTIVES.md)
- [Features & How it Works](docs/FEATURES.md)
- [MCP Protocol Reference (Tools & Resources)](docs/MCP_PROTOCOL.md)
- [Dashboard & Debugging](docs/DASHBOARD_DEBUGGING.md)
- [Contribution Guidelines](docs/CONTRIBUTING.md)

## ⚠️ Disclaimer

**THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND**, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.

## ⚖️ License

MIT © Muhammad Rheza Alfin

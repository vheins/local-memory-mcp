# @vheins/local-memory-mcp

[![npm version](https://img.shields.io/npm/v/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MCP Local Memory Service** is a high-performance [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides long-term, high-signal memory for AI Agents (such as Claude Desktop, Cursor, or Windsurf).

Built with a **Local-First** philosophy, this service stores architectural decisions, code patterns, and critical facts locally on your machine using SQLite and AI-powered Semantic Search.

## 🚀 Key Features

- 🧠 **Semantic Search (V2):** Find memories based on meaning, not just keywords, using the `all-MiniLM-L6-v2` model locally.
- 🔄 **Tech-Stack Affinity:** Share knowledge across repositories intelligently based on technology tags (e.g., Filament memories in Repo A are accessible in Repo B).
- 🛡️ **Anti-Hallucination Guard:** Prevents Agents from hallucinating with strict similarity thresholds and decision conflict detection.
- 📉 **Automatic Memory Decay:** Automatically archives obsolete memories to keep the context clean and relevant.
- 📊 **Glassy Dashboard:** Visualize memories, usage statistics, and audit interaction logs through a modern web interface.

## 🛠️ Quick Start

### Installation
```bash
npm install -g @vheins/local-memory-mcp
```

### MCP Client Configuration (e.g., Claude Desktop)
Add the following to your MCP settings file:

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

## 📖 Documentation

- [Getting Started & Setup](docs/GETTING_STARTED.md)
- [Features & How it Works](docs/FEATURES.md)
- [MCP Protocol Reference (Tools & Resources)](docs/MCP_PROTOCOL.md)
- [Dashboard & Debugging](docs/DASHBOARD_DEBUGGING.md)
- [Contribution Guidelines](docs/CONTRIBUTING.md)

## ⚠️ Disclaimer

**THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND**, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.

## ⚖️ License

MIT © Muhammad Rheza Alfin

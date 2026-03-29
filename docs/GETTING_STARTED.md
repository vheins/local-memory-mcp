# Getting Started & Setup

This guide provides instructions for bringing the MCP Local Memory Service to life from two critical perspectives.

---

## 🧑‍💻 As a Developer: "I am setting up the infrastructure."

As a developer, your job is to install the binary and register the server within your environment.

### 1. Installation
Install the service globally on your machine:
```bash
npm install -g @vheins/local-memory-mcp
```

### 2. Configuration (User Level)
Add the server to your favorite tool's global configuration file.

*   **Claude Desktop:** Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`).
*   **Cursor:** Edit `~/.cursor/mcp.json`.
*   **Windsurf:** Edit `~/.codeium/windsurf/mcp_config.json`.

**The Standard Configuration (JSON):**
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

### 3. Verification
Run the following command to ensure the database is initialized correctly:
```bash
npx @vheins/local-memory-mcp --help
```

---

## 🤖 As an AI Agent: "I am discovering my new memory."

Once the developer has registered the server, I (the Agent) take over the integration process.

### 1. Handshake & Discovery
When you start a new session, I automatically perform a "handshake" with the MCP server. I discover the following capabilities:
*   **Tools:** I see `memory-store`, `memory-search`, etc.
*   **Resources:** I find the `memory://index` URI to browse existing knowledge.
*   **Prompts:** I read the `memory-agent-core` prompt to understand my new behavioral contract.

### 2. Context Activation
I don't just "sit there." I actively look for your project's context:
*   I resolve your current **Git Repository** name to isolate memories.
*   I detect your **Tech Stack** (e.g., React, Python) to pull relevant memories from other projects via affinity tags.

### 3. Validation Ritual
To ensure I am connected correctly, you can ask me:
> *"What do you remember about this project?"* or *"Check your local memory for any Filament coding standards."*

If I respond with a list of facts or a "No memories found yet" message (instead of an error), it means I am successfully integrated and ready to work.

---

## ⚠️ Disclaimer
**THE SOFTWARE IS PROVIDED "AS IS"**, without warranty of any kind. Both developer and agent must collaborate to ensure the quality and accuracy of stored data.

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

Register the server in your preferred AI tool. Below are the standard configurations:

#### 🏠 Claude Desktop

- **File Path:**
  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- **JSON:** Standard `mcpServers` format.

#### 🛸 Cursor & 🌊 Windsurf

- **Cursor File:** `~/.cursor/mcp.json`
- **Windsurf File:** `~/.codeium/windsurf/mcp_config.json`
- Both use the standard `mcpServers` JSON object.

#### ♊ Gemini CLI & 🪐 Antigravity

- **File:** `~/.gemini/settings.json` (or `.gemini/settings.json` in project root)
- **JSON Snippet:**

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

#### ⚡ Trae & 👻 Kiro AI

- **Trae:** Go to **Settings > MCP > Add Manually**.
- **Kiro AI:** Click the MCP icon in the sidebar and add to `mcp-servers.json`.
- Both support the standard JSON server definition.

#### 📐 Zed Editor

- **File Path:** `~/.config/zed/settings.json`
- **Configuration:**

```json
"context_servers": {
  "local-memory": {
    "command": {
      "path": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"]
    }
  }
}
```

#### 🔓 OpenCode

- Add the server via the OpenCode extension settings using the standard `npx` command and arguments.

---

## 🤖 As an AI Agent: "I am discovering my new memory."

Once the developer has registered the server, I (the Agent) take over the integration process.

### 1. Handshake & Discovery

When you start a new session, I automatically perform a "handshake" with the MCP server. I discover the following capabilities:

- **Tools:** I see the 17 unified tools — `memory-write`, `memory-read`, `task-write`, `task-read`, `standard-read`, `codebase-index`, `codebase-read`, `claim-manage`, `handoff-write`, and more.
- **Resources:** I find resource templates like `repository://{name}/memories` to browse existing knowledge.
- **Prompts:** I read the `memory-agent-core` prompt to understand my new behavioral contract.

### 2. Context Activation

I don't just "sit there." I actively look for your project's context:

- I resolve your current **Git Repository** name to isolate memories.
- I pull relevant memories from other projects via **tags** (Tech-Stack Affinity) — searching with `current_tags` (e.g. `["react", "filament"]`) surfaces knowledge tagged with those technologies from any repo.

### 3. Validation Ritual

To ensure I am connected correctly, you can ask me:

> _"What do you remember about this project?"_ or _"Check your local memory for any coding standards related to this tech stack."_

If I respond with a list of facts or a "No memories found yet" message (instead of an error), it means I am successfully integrated and ready to work.

---

## ⚠️ Disclaimer

**THE SOFTWARE IS PROVIDED "AS IS"**, without warranty of any kind. Both developer and agent must collaborate to ensure the quality and accuracy of stored data.

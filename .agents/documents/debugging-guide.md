# Dashboard & Debugging

The MCP Local Memory Service provides visual tools to ensure you have full control over what your AI Agent remembers.

## Web Dashboard

The dashboard can be accessed for manual inspection:

- **Memory Visualization:** View, edit, and delete memories per repository.
- **Audit Log:** View Agent search history (queries, results found, and similarity scores).
- **Statistics:** See which memories are helping your Agent most often (Recall Rate).
- **Task Kanban:** Visual task management with 4 swimlanes (Backlog, Pending, In Progress, Completed).
- **Knowledge Graph:** Interactive force-directed graph of entities and relations.
- **Coding Standards:** Browse and manage stored coding standard entries.
- **Agent Arena:** Multi-agent coordination overview with handoff and claim management.

### How to Run

```bash
# Start the dashboard (default: http://127.0.0.1:3456)
npx @vheins/local-memory-mcp dashboard

# Or using the bundled binary
mcp-memory-dashboard

# With custom port and auth
PORT=3456 DASHBOARD_TOKEN=your-token mcp-memory-dashboard
```

### Configuration

| Env Variable      | Default               | Description               |
| :---------------- | :-------------------- | :------------------------ |
| `PORT`            | `3456`                | Dashboard server port     |
| `DASHBOARD_HOST`  | `127.0.0.1`           | Bind address              |
| `DASHBOARD_TOKEN` | (none)                | Bearer token for API auth |
| `MEMORY_DB_PATH`  | `./storage/memory.db` | SQLite database path      |

### Auto-launch in VS Code

To automatically start the dashboard when opening a project in VS Code, add a task to `.vscode/tasks.json`:

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

## Debugging the MCP Server

If your Agent is not finding the expected memories:

1.  **Check Logs:** The server logs every action to `stderr` (JSON-RPC) and internal logs. Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to view interactions in real-time.
2.  **Verify Threshold:** If a memory's semantic similarity score is below `0.50`, the server will return empty results. You can adjust this threshold in the configuration if it feels too strict (though the risk of hallucination increases).
3.  **Tags & Repo:** Ensure the Agent is sending the correct `repo` and `current_tags` if you want to pull memories from other tech stacks.
4.  **Scope Injection:** The server auto-injects `owner`, `repo`, and `folder` from MCP session context (roots). If this fails, tools may not scope correctly.

## Database Troubleshooting

If the `memory.db` file is corrupted or you want to reset it:

1. Default file location: `./storage/memory.db` (relative to CWD). Override via `MEMORY_DB_PATH` env var.
2. You can open this file with any SQLite tool (e.g., DB Browser for SQLite) for manual repair.
3. The database uses WAL mode for better concurrent read performance.

## Warning

All diagnostic tools and the dashboard are provided **"AS IS"** without any warranty of any kind.

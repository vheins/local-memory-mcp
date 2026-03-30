# Dashboard & Debugging

The MCP Local Memory Service provides visual tools to ensure you have full control over what your AI Agent remembers.

## Web Dashboard
The dashboard can be accessed for manual inspection:
- **Memory Visualization:** View, edit, and delete memories per repository.
- **Audit Log:** View Agent search history (queries, results found, and similarity scores).
- **Statistics:** See which memories are helping your Agent most often (Recall Rate).

### How to Run
```bash
npx @vheins/local-memory-mcp-dashboard
```

## Debugging the MCP Server
If your Agent is not finding the expected memories:

1.  **Check Logs:** The server logs every action to `stdout` (JSON-RPC) and internal logs. Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to view interactions in real-time.
2.  **Verify Threshold:** If a memory's semantic similarity score is below `0.50`, the server will return empty results. You can adjust this threshold in the configuration if it feels too strict (though the risk of hallucination increases).
3.  **Tags & Repo:** Ensure the Agent is sending the correct `repo` and `current_tags` if you want to pull memories from other tech stacks.

## Database Troubleshooting
If the `memory.db` file is corrupted or you want to reset it:
1. Default file location: `~/.config/local-memory-mcp/memory.db`.
2. You can open this file with any SQLite tool (e.g., DB Browser for SQLite) for manual repair.

## ⚠️ No Warranty
All diagnostic tools and the dashboard are provided **"AS IS"** without any warranty of any kind.

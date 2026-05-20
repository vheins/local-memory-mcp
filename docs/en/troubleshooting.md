# Troubleshooting Guide

Common issues when installing or running the MCP Local Memory Service.

---

## Server Won't Start / MCP Handshake Fails

### Symptom
Your AI client shows an error like `MCP server disconnected` or `Failed to initialize`.

### Check 1: Node.js Version
```bash
node --version   # requires >= 18
```
This server uses `fetch`, `AbortController`, and other modern APIs. Node 18+ is required.

### Check 2: Installation is Corrupt
```bash
npm uninstall -g @vheins/local-memory-mcp
npm install -g @vheins/local-memory-mcp
```

### Check 3: npx Cache Issues
If using `npx`, clear the cache:
```bash
npx clear-npx-cache 2>/dev/null || rm -rf ~/.npm/_npx
```
Then try again. The first run downloads the package and can take 10-30 seconds.

### Check 4: Binary Not Found After Global Install
```bash
which local-memory-mcp   # should show a path
```
If empty, your npm global bin may not be in `$PATH`:
```bash
npm bin -g   # shows the directory
# Add it to your shell profile:
export PATH="$(npm bin -g):$PATH"
```

---

## Dashboard Won't Load

### Symptom
`localhost:3456` shows connection refused or blank page.

### Check 1: Is the Server Running?
```bash
npx @vheins/local-memory-mcp dashboard
```
You should see:
```
MCP Memory Dashboard running on http://localhost:3456
```

### Check 2: Port Conflict
```bash
lsof -i :3456   # macOS/Linux
netstat -ano | findstr :3456   # Windows
```
If something else is using port 3456, kill it or use a different port via the `PORT` env:
```bash
PORT=3457 npx @vheins/local-memory-mcp dashboard
```

### Check 3: Dashboard Opens But Shows No Data
The dashboard loads data from the same SQLite database the MCP server uses. If the MCP server never ran, there's no data yet. Create some activity first, or run the seed script:

```bash
node seed-data.mjs
```

---

## "Transformers.js" / ONNX Model Errors

### Symptom
Errors mentioning `Transformers.js`, `ONNX`, or `all-MiniLM-L6-v2` during search.

### Cause
The first time you search, the server downloads the embedding model (~23MB) to Hugging Face's cache directory (`~/.cache/huggingface/`). This requires an internet connection and can take 30-60 seconds.

### Fix
Ensure internet access on first run. The model is cached locally afterward — subsequent searches are offline and fast.

If the download keeps failing, manually download:
```bash
# The model will be downloaded to:
# ~/.cache/huggingface/hub/models--Xenova--all-MiniLM-L6-v2/
```
Then restart the server.

---

## Database Locked / SQLite Errors

### Symptom
```
SQLITE_BUSY: database is locked
```
or
```
SQLITE_ERROR: no such table: memories
```

### Cause
- **Locked:** Two processes are accessing the same SQLite file simultaneously (e.g., MCP server + dashboard pointing to the same DB).
- **Missing tables:** The database wasn't migrated (shouldn't happen in normal flow, but can occur if the DB file is manually corrupted or deleted mid-operation).

### Fix
1. Kill all running `local-memory-mcp` processes:
   ```bash
   pkill -f local-memory-mcp   # macOS/Linux
   ```
2. Delete the database to start fresh (your data will be lost):
   ```bash
   rm -f storage/memory.db
   ```
3. Restart the server — tables are auto-created on startup.

---

## "Memory not found" / Search Returns Nothing

### Check 1: Are You Using the Correct Repo?
Memories are scoped to a repository. If your current project is `my-app`, search for memories in `my-app`:
```json
{
  "repo": "my-app",
  "query": "your search"
}
```

### Check 2: Low Similarity Threshold
The system filters results below 0.50 similarity. If your memories are very different from your query, try rephrasing. Keyword matching still works for exact terms.

### Check 3: Agent Didn't Store Anything Yet
Ask your agent: *"What do you remember about this project?"* If it says "No memories found," the database is empty — this is normal for a fresh setup.

---

## npm/npx Permission Errors

### Symptom
```
Error: EACCES: permission denied
```

### Fix (macOS/Linux)
Avoid `sudo`. Instead, fix npm's permissions:
```bash
npm config set prefix ~/.npm-global
mkdir -p ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
npm install -g @vheins/local-memory-mcp
```

Or use a Node version manager like `nvm` or `fnm` which avoids permission issues entirely.

---

## Agent Says "Tool not found"

### Symptom
The AI agent responds with *"I don't have a tool called memory-store"* or similar.

### Cause
The MCP server isn't registered in your client's configuration, or the client didn't restart after configuration was added.

### Fix
1. Double-check your `mcpServers` JSON matches the README examples exactly.
2. Restart your AI client completely (not just the conversation).
3. Verify the server appears in the client's MCP server list:
   - Claude Desktop: Click the plug icon → should show "local-memory"
   - Cursor: Settings → MCP → should show "local-memory"
   - Windsurf: MCP configuration panel

---

## "EPIPE" or Broken Pipe Errors

### Symptom
The server crashes with `Error: write EPIPE` or `stdout is not a TTY`.

### Cause
The parent process (your AI client) closed the stdio connection unexpectedly.

This is usually harmless — the server shuts down when the client disconnects. If it happens repeatedly, the client may be restarting the server too aggressively. Check your client's MCP server keepalive settings.

---

## Still Stuck?

- Open a [GitHub Issue](https://github.com/vheins/local-memory-mcp/issues) with:
  - Your OS and Node.js version
  - The exact error message
  - Your MCP client and configuration JSON
- Include logs from stderr (they're usually visible in the client's MCP output panel).

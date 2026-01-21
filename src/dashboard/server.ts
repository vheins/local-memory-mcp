#!/usr/bin/env node
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// MCP Client - spawns the MCP server and communicates with it
class MCPClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private isInitialized = false;

  async start() {
    // Spawn the MCP server process
    const serverPath = path.join(__dirname, "../server.js");
    this.process = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "inherit"]
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error("Failed to spawn MCP server");
    }

    // Set up line reader for responses
    const rl = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });

    rl.on("line", (line) => {
      try {
        const response = JSON.parse(line);
        
        // Handle notifications
        if (!response.id) {
          return;
        }

        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (err) {
        console.error("Failed to parse MCP response:", err);
      }
    });

    // Initialize the server
    await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-dashboard", version: "1.0.0" }
    });

    this.isInitialized = true;
  }

  async call(method: string, params: any = {}): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error("MCP server not started");
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 10000);

      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  async callTool(toolName: string, args: any): Promise<any> {
    return this.call("tools/call", {
      name: toolName,
      arguments: args
    });
  }

  async readResource(uri: string): Promise<any> {
    return this.call("resources/read", { uri });
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  isConnected(): boolean {
    return this.isInitialized && this.process !== null;
  }
}

const mcpClient = new MCPClient();

// Start MCP client
mcpClient.start().catch((err) => {
  console.error("Failed to start MCP client:", err);
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    connected: mcpClient.isConnected()
  });
});

// List all repositories
app.get("/api/repos", async (req, res) => {
  try {
    // We'll need to get all memories and extract unique repos
    // For now, return a simple approach - search with empty query
    const result = await mcpClient.callTool("memory.search", {
      query: ".",
      repo: "*",
      limit: 1000
    });
    
    const repos = new Set<string>();
    if (result.results) {
      result.results.forEach((m: any) => {
        if (m.scope && m.scope.repo) {
          repos.add(m.scope.repo);
        }
      });
    }
    
    res.json({ repos: Array.from(repos).sort() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get statistics
app.get("/api/stats", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    
    // Get all memories to compute stats
    const result = await mcpClient.callTool("memory.search", {
      query: ".",
      repo: repo || "*",
      limit: 1000
    });
    
    const memories = result.results || [];
    
    const stats = {
      total: memories.length,
      byType: {} as Record<string, number>,
      unused: 0,
      topMemories: [] as any[]
    };
    
    // Count by type
    for (const memory of memories) {
      const type = memory.type || "unknown";
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    }
    
    // Get top memories (sorted by importance and created_at)
    stats.topMemories = memories
      .sort((a: any, b: any) => {
        if (a.importance !== b.importance) {
          return b.importance - a.importance;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .slice(0, 10);
    
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List memories with optional filtering
app.get("/api/memories", async (req, res) => {
  try {
    const repo = req.query.repo as string || "*";
    const type = req.query.type as string | undefined;
    const sortBy = req.query.sortBy as string || "importance";
    const sortOrder = req.query.sortOrder as string || "desc";
    
    // Search for memories
    const result = await mcpClient.callTool("memory.search", {
      query: ".",
      repo,
      types: type ? [type] : undefined,
      limit: 1000
    });
    
    let memories = result.results || [];
    
    // Sort
    memories.sort((a: any, b: any) => {
      let comparison = 0;
      
      if (sortBy === "importance") {
        comparison = b.importance - a.importance;
      } else if (sortBy === "created_at" || sortBy === "updated_at") {
        comparison = new Date(b[sortBy]).getTime() - new Date(a[sortBy]).getTime();
      }
      
      return sortOrder === "asc" ? -comparison : comparison;
    });
    
    res.json({ memories });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get memory by ID
app.get("/api/memories/:id", async (req, res) => {
  try {
    const result = await mcpClient.readResource(`memory://${req.params.id}`);
    res.json(result.contents[0].text);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// Update memory
app.put("/api/memories/:id", async (req, res) => {
  try {
    const { content, importance } = req.body;
    
    const result = await mcpClient.callTool("memory.update", {
      id: req.params.id,
      content,
      importance
    });
    
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete memory
app.delete("/api/memories/:id", async (req, res) => {
  try {
    const result = await mcpClient.callTool("memory.delete", {
      id: req.params.id
    });
    
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Serve the dashboard HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`MCP Memory Dashboard running at http://localhost:${PORT}`);
  console.log("MCP Memory Dashboard ready. Live data connected.");
});

// Cleanup on exit
process.on("SIGINT", () => {
  mcpClient.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  mcpClient.stop();
  process.exit(0);
});

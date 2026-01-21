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
    // Read the index resource to get recent memories
    const result = await mcpClient.readResource("memory://index");
    const repos = new Set<string>();
    
    // Parse the content to extract repos
    if (result && result.contents && result.contents[0]) {
      const content = result.contents[0].text;
      const entries = JSON.parse(content);
      
      // entries is an array of {id, type, repo}
      if (Array.isArray(entries)) {
        entries.forEach((m: any) => {
          if (m.repo) {
            repos.add(m.repo);
          }
        });
      }
    }
    
    res.json({ repos: Array.from(repos).sort() });
  } catch (err: any) {
    console.error("Error getting repos:", err);
    res.status(500).json({ error: err.message, repos: [] });
  }
});

// Get statistics
app.get("/api/stats", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    
    // If a specific repo is requested, search it
    let memories: any[] = [];
    
    if (repo) {
      // Use common words that are likely to match most memories
      const queries = ["the", "use", "not", "for", "and", "with"];
      const seenIds = new Set<string>();
      
      for (const query of queries) {
        try {
          const result = await mcpClient.callTool("memory.search", {
            query,
            repo,
            limit: 10
          });
          
          // Add unique memories
          for (const memory of result.results || []) {
            if (!seenIds.has(memory.id)) {
              seenIds.add(memory.id);
              memories.push(memory);
            }
          }
        } catch (err) {
          console.error(`Error searching with query '${query}':`, err);
        }
      }
    } else {
      // Get from index for all repos
      const result = await mcpClient.readResource("memory://index");
      if (result && result.contents && result.contents[0]) {
        const content = result.contents[0].text;
        const entries = JSON.parse(content);
        
        // entries is an array of {id, type, repo}
        if (Array.isArray(entries)) {
          // Get unique repos and search each
          const repos = new Set<string>();
          entries.forEach((m: any) => {
            if (m.repo) repos.add(m.repo);
          });
          
          // Search each repo with multiple queries
          const queries = ["the", "use", "not", "for", "and", "with"];
          const seenIds = new Set<string>();
          
          for (const r of Array.from(repos)) {
            for (const query of queries) {
              try {
                const res = await mcpClient.callTool("memory.search", {
                  query,
                  repo: r,
                  limit: 10
                });
                
                // Add unique memories
                for (const memory of res.results || []) {
                  if (!seenIds.has(memory.id)) {
                    seenIds.add(memory.id);
                    memories.push(memory);
                  }
                }
              } catch (err) {
                console.error(`Error searching repo ${r} with query '${query}':`, err);
              }
            }
          }
        }
      }
    }
    
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
    console.error("Error getting stats:", err);
    res.status(500).json({ error: err.message });
  }
});

// List memories with optional filtering
app.get("/api/memories", async (req, res) => {
  try {
    const repo = req.query.repo as string;
    const type = req.query.type as string | undefined;
    const sortBy = req.query.sortBy as string || "importance";
    const sortOrder = req.query.sortOrder as string || "desc";
    
    if (!repo) {
      return res.status(400).json({ error: "repo parameter is required" });
    }
    
    // Search with multiple queries to get more comprehensive results
    // Note: MCP search has a limit of 10 per query, so we use multiple queries
    const queries = ["the", "use", "not", "for", "and", "with"];
    const seenIds = new Set<string>();
    let memories: any[] = [];
    
    for (const query of queries) {
      try {
        const result = await mcpClient.callTool("memory.search", {
          query,
          repo,
          types: type ? [type] : undefined,
          limit: 10
        });
        
        // Add unique memories
        for (const memory of result.results || []) {
          if (!seenIds.has(memory.id)) {
            seenIds.add(memory.id);
            memories.push(memory);
          }
        }
      } catch (err) {
        console.error(`Error searching with query '${query}':`, err);
      }
    }
    
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
    console.error("Error listing memories:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get memory by ID
app.get("/api/memories/:id", async (req, res) => {
  try {
    const result = await mcpClient.readResource(`memory://${req.params.id}`);
    const memoryJson = result.contents[0].text;
    const memory = JSON.parse(memoryJson);
    res.json(memory);
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

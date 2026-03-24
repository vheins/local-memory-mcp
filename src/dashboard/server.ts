#!/usr/bin/env node
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { MCPClient } from "../mcp/client.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;
const startTime = Date.now();

const db = new SQLiteStore();

app.use(express.json());

// Timing middleware - must be before routes
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn("Slow request", { method: req.method, path: req.path, duration });
    }
  });
  next();
});

// Serve static assets. Prefer built `public` next to this file (dist/dashboard/public),
// but fall back to the source `src/dashboard/public` when running from the repo.
const builtPublic = path.join(__dirname, "public");
const srcPublic = path.join(process.cwd(), "src", "dashboard", "public");
const staticRoot = fs.existsSync(builtPublic) ? builtPublic : srcPublic;

if (!fs.existsSync(staticRoot)) {
  logger.warn("Dashboard static directory not found", { builtPublic, srcPublic });
}

app.use(express.static(staticRoot));

const mcpClient = new MCPClient();

// Start MCP client
mcpClient.start().catch((err) => {
  logger.error("Failed to start MCP client", { error: err.message });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  const stats = db.getStats();
  res.json({
    connected: mcpClient.isConnected(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memoryCount: stats.total,
    pendingRequests: mcpClient.getPendingCount()
  });
});

// List all repositories
app.get("/api/repos", async (req, res) => {
  try {
    const repos = db.listRepos();
    res.json({ repos });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error getting repos", { error: message });
    res.status(500).json({ error: message, repos: [] });
  }
});

// Get recent actions
app.get("/api/recent-actions", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    const actions = db.getRecentActions(repo, limit);
    res.json({ actions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error getting recent actions", { error: message });
    res.status(500).json({ error: message, actions: [] });
  }
});

// Get statistics
app.get("/api/stats", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;

    const stats = db.getStats(repo);

    const allMemories = db.getAllMemoriesWithStats(repo);
    const topMemories = allMemories
      .sort((a, b) => {
        if (a.importance !== b.importance) {
          return b.importance - a.importance;
        }
        return b.hit_count - a.hit_count;
      })
      .slice(0, 10);

    const totalHitCount = allMemories.reduce((sum, m) => sum + (m.hit_count || 0), 0);
    
    const avgImportance = allMemories.length > 0
      ? allMemories.reduce((sum, m) => sum + m.importance, 0) / allMemories.length
      : 0;

    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const expiringSoon = allMemories.filter(m => 
      m.expires_at && new Date(m.expires_at) <= sevenDaysFromNow
    ).length;

    let mostActiveRepo: string | null = null;
    if (!repo) {
      const repoCounts: Record<string, number> = {};
      for (const memory of allMemories) {
        const r = memory.scope.repo;
        repoCounts[r] = (repoCounts[r] || 0) + (memory.hit_count || 0);
      }
      let maxHits = 0;
      for (const [r, count] of Object.entries(repoCounts)) {
        if (count > maxHits) {
          maxHits = count;
          mostActiveRepo = r;
        }
      }
    }

    // Importance distribution (histogram 1-5)
    const importanceDist: number[] = [0, 0, 0, 0, 0];
    for (const m of allMemories) {
      if (m.importance >= 1 && m.importance <= 5) {
        importanceDist[m.importance - 1]++;
      }
    }

    // Time series - memories per day for last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const timeSeries: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const date = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = date.toISOString().split('T')[0];
      timeSeries[key] = 0;
    }
    for (const m of allMemories) {
      const created = new Date(m.created_at);
      if (created >= thirtyDaysAgo) {
        const key = created.toISOString().split('T')[0];
        if (timeSeries[key] !== undefined) {
          timeSeries[key]++;
        }
      }
    }

    // Scatter data: importance vs hit_count
    const scatterData = allMemories.map(m => ({
      x: m.importance,
      y: m.hit_count || 0
    }));

    res.json({
      ...stats,
      topMemories,
      totalHitCount: Math.round(totalHitCount),
      avgImportance: Math.round(avgImportance * 10) / 10,
      mostActiveRepo,
      expiringSoon,
      importanceDist,
      timeSeries,
      scatterData
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error getting stats", { error: message });
    res.status(500).json({ error: message });
  }
});

// List memories with optional filtering
app.get("/api/memories", async (req, res) => {
  try {
    const repo = req.query.repo as string;
    const type = req.query.type as string | undefined;
    const sortBy = req.query.sortBy as string || "hit_count";
    const sortOrder = req.query.sortOrder as string || "desc";

    if (!repo) {
      return res.status(400).json({ error: "repo parameter is required" });
    }

    let memories = db.getAllMemoriesWithStats(repo);

    if (type) {
      memories = memories.filter(m => m.type === type);
    }

    memories.sort((a: any, b: any) => {
      let comparison = 0;

      if (sortBy === "importance") {
        comparison = b.importance - a.importance;
      } else if (sortBy === "hit_count") {
        comparison = b.hit_count - a.hit_count;
      } else if (sortBy === "recall_rate") {
        comparison = b.recall_rate - a.recall_rate;
      } else if (sortBy === "created_at" || sortBy === "updated_at") {
        comparison = new Date(b[sortBy]).getTime() - new Date(a[sortBy]).getTime();
      }

      return sortOrder === "asc" ? -comparison : comparison;
    });

    res.json({ memories });
  } catch (err: any) {
    logger.error("Error listing memories", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Get memory by ID
app.get("/api/memories/:id", async (req, res) => {
  try {
    const result = await mcpClient.readResource(`memory://${req.params.id}`) as { contents?: { text: string }[] };
    const memoryJson = result.contents?.[0]?.text;
    if (!memoryJson) {
      throw new Error("Memory not found");
    }
    const memory = JSON.parse(memoryJson);
    res.json(memory);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: message });
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

// Archive expired memories
app.post("/api/memories/archive", async (req, res) => {
  try {
    const archived = db.archiveExpiredMemories();
    res.json({ archived });
  } catch (err: any) {
    logger.error("Error archiving memories", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Serve the dashboard HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  logger.info("MCP Memory Dashboard started", { port: PORT });
});

// Cleanup on exit
process.on("SIGINT", () => {
  mcpClient.stop();
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  mcpClient.stop();
  db.close();
  process.exit(0);
});

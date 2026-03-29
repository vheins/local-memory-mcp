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

type RecentAction = {
  action: string;
  query?: string;
  memory_id?: string;
  result_count?: number;
  created_at: string;
};

type CondensedRecentAction = RecentAction & {
  burstCount: number;
};

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
    pendingRequests: mcpClient.getPendingCount(),
    dbPath: db.getDbPath()
  });
});

// List all repositories
app.get("/api/repos", async (req, res) => {
  try {
    const repos = db.listRepoNavigation();
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
    const rawActions = db.getRecentActions(repo, Math.max(limit * 4, 50));
    const actions = condenseRecentActions(rawActions, limit);
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
    const search = req.query.search as string | undefined;
    const minImportance = req.query.minImportance ? parseInt(req.query.minImportance as string, 10) : undefined;
    const maxImportance = req.query.maxImportance ? parseInt(req.query.maxImportance as string, 10) : undefined;
    const sortBy = req.query.sortBy as string || "hit_count";
    const sortOrder = req.query.sortOrder as string || "desc";
    const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string || "25", 10)));

    if (!repo) {
      return res.status(400).json({ error: "repo parameter is required" });
    }

    const offset = (page - 1) * pageSize;
    const result = db.listMemoriesForDashboard({
      repo,
      type,
      search,
      minImportance,
      maxImportance,
      sortBy,
      sortOrder: sortOrder === "asc" ? "asc" : "desc",
      limit: pageSize,
      offset,
    });

    res.json({
      memories: result.items,
      pagination: {
        page,
        pageSize,
        totalItems: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
      }
    });
  } catch (err: any) {
    logger.error("Error listing memories", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Get memory by ID
app.get("/api/memories/:id", async (req, res) => {
  try {
    const memory = db.getByIdWithStats(req.params.id);
    if (!memory) {
      throw new Error("Memory not found");
    }

    db.logAction("read", memory.scope.repo, { memoryId: memory.id, resultCount: 1 });
    res.json(memory);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: message });
  }
});

// Update memory
app.put("/api/memories/:id", async (req, res) => {
  try {
    const { title, content, importance } = req.body;

    const result = await mcpClient.callTool("memory.update", {
      id: req.params.id,
      title,
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
  console.log("DASHBOARD_STARTING");
  logger.info("MCP Memory Dashboard started", { port: PORT });
});

function condenseRecentActions(actions: RecentAction[], limit: number): CondensedRecentAction[] {
  const condensed: CondensedRecentAction[] = [];

  for (const action of actions) {
    const previous = condensed[condensed.length - 1];
    const sameKind = previous
      && previous.action === action.action
      && previous.query === action.query
      && previous.memory_id === action.memory_id;

    const currentTime = new Date(action.created_at).getTime();
    const previousTime = previous ? new Date(previous.created_at).getTime() : 0;
    const withinBurstWindow = previous && Math.abs(previousTime - currentTime) <= 10 * 60 * 1000;

    if (sameKind && withinBurstWindow) {
      previous.burstCount += 1;
      previous.created_at = action.created_at;
      continue;
    }

    condensed.push({
      ...action,
      burstCount: 1,
    });
  }

  return condensed.slice(0, limit);
}

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

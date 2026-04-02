#!/usr/bin/env node
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { randomUUID } from "crypto";
import os from "os";
import { MCPClient } from "../mcp/client.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { logger } from "../utils/logger.js";
import { TOOL_DEFINITIONS } from "../tools/schemas.js";
import { PROMPTS } from "../prompts/registry.js";
import { listResources } from "../resources/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
const app = express();
const PORT = process.env.PORT || 3456;
const startTime = Date.now();

const db = new SQLiteStore();

type RecentAction = {
  action: string;
  query?: string;
  memory_id?: string;
  memory_title?: string;
  memory_type?: string;
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

// Watch action_log for new entries from any MCP process and print to terminal
let lastSeenActionId = db.getLastActionId();
const ACTION_ICONS: Record<string, string> = {
  search: "🔍",
  read:   "📖",
  write:  "💾",
  update: "🔄",
  delete: "🗑️ ",
};
setInterval(() => {
  try {
    const newActions = db.getActionsAfter(lastSeenActionId);
    for (const action of newActions) {
      const icon = ACTION_ICONS[action.action] ?? "•";
      const detail = action.query
        ? `query="${action.query}"`
        : action.memory_id
        ? `id=${action.memory_id.substring(0, 8)}`
        : "";
      const hits = action.result_count != null ? ` hits=${action.result_count}` : "";
      console.log(`${new Date().toISOString()} ${icon} [MCP] ${action.action.padEnd(6)} repo=${action.repo}${detail ? " " + detail : ""}${hits}`);
      lastSeenActionId = action.id;
    }
  } catch {
    // DB may be briefly locked — skip this tick
  }
}, 1000);

// Health check endpoint
app.get("/api/health", (req, res) => {
  const stats = db.getStats();
  
  // Read version from package.json
  let version = "0.0.0";
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    version = pkg.version;
  } catch (e) {
    logger.warn("Could not read version from package.json");
  }

  res.json({
    connected: mcpClient.isConnected(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version,
    memoryCount: stats.total,
    pendingRequests: mcpClient.getPendingCount(),
    dbPath: db.getDbPath()
  });
});

// Download DB file
app.get("/api/download-db", (req, res) => {
  try {
    const dbPath = db.getDbPath();
    if (fs.existsSync(dbPath)) {
      res.download(dbPath, "memory.db");
    } else {
      res.status(404).json({ error: "Database file not found" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 10));
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    // Fetch enough raw rows to condense into pageSize items per page
    const fetchLimit = Math.max(pageSize * page * 4, 100);
    const rawActions = db.getRecentActions(repo, fetchLimit);
    const allCondensed = condenseRecentActions(rawActions, fetchLimit);
    const totalItems = allCondensed.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const offset = (page - 1) * pageSize;
    const actions = allCondensed.slice(offset, offset + pageSize);
    res.json({
      actions,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error getting recent actions", { error: message });
    res.status(500).json({ error: message, actions: [] });
  }
});
// Add memory manually
app.post("/api/memories", async (req, res) => {
  try {
    const { repo, type, title, content, importance, tags, is_global, agent, role, model } = req.body;
    if (!repo || !type || !content) {
      return res.status(400).json({ error: "repo, type, and content are required" });
    }
    const entry = {
      id: randomUUID(),
      repo,
      type,
      title: title || "",
      content,
      importance: parseInt(importance) || 3,
      agent: agent || 'manual-user',
      role: role || 'user',
      model: model || 'human',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map((t: string) => t.trim()) : []),
      is_global: !!is_global,
      scope: { repo } 
    };
    db.insert(entry as any);
    db.logAction("write", repo, { memoryId: entry.id });
    res.json({ success: true, id: entry.id });
  } catch (err: any) {
    logger.error("Error creating memory", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Add task manually
app.post("/api/tasks", async (req, res) => {
  try {
    const { repo, task_code, phase, title, description, status, priority, agent, role, doc_path, depends_on } = req.body;
    if (!repo || !task_code || !title) {
      return res.status(400).json({ error: "repo, task_code, and title are required" });
    }
    const task = {
      id: randomUUID(),
      repo,
      task_code,
      phase: phase || "manual",
      title,
      description: description || "",
      status: status || "pending",
      priority: parseInt(priority) || 3,
      agent: agent || 'manual-user',
      role: role || 'user',
      doc_path: doc_path || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      depends_on: depends_on || null
    };
    db.insertTask(task);
    db.logAction("write", repo, { taskId: task.id });
    res.json({ success: true, id: task.id });
  } catch (err: any) {
    logger.error("Error creating task", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Get statistics
app.get("/api/stats", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const getMemoryRepo = (memory: any): string | null => memory?.scope?.repo ?? memory?.repo ?? null;

    const stats = db.getStats(repo);

    const allMemories = db.getAllMemoriesWithStats(repo);
    const topMemories = allMemories
      .sort((a: any, b: any) => {
        if (a.importance !== b.importance) {
          return b.importance - a.importance;
        }
        return b.hit_count - a.hit_count;
      })
      .slice(0, 10);

    const totalHitCount = allMemories.reduce((sum: number, m: any) => sum + (m.hit_count || 0), 0);
    
    const avgImportance = allMemories.length > 0
      ? allMemories.reduce((sum: number, m: any) => sum + m.importance, 0) / allMemories.length
      : 0;

    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const expiringSoon = allMemories.filter((m: any) => 
      m.expires_at && new Date(m.expires_at) <= sevenDaysFromNow
    ).length;

    // Task statistics
    const allTasks = db.getTasksByRepo(repo || "");
    const taskStats = {
      total: allTasks.length,
      todo: allTasks.filter((t: any) => t.status === 'pending').length,
      blocked: allTasks.filter((t: any) => t.status === 'blocked').length,
      inProgress: allTasks.filter((t: any) => t.status === 'in_progress').length,
      completed: allTasks.filter((t: any) => t.status === 'completed').length,
    };

    let mostActiveRepo: string | null = null;
    if (!repo) {
      const repoCounts: Record<string, number> = {};
      for (const memory of allMemories) {
        const r = getMemoryRepo(memory);
        if (!r) {
          continue;
        }
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

    // Time series - actions per day for last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const timeSeries: Record<string, any> = {};
    for (let i = 0; i < 30; i++) {
      const date = new Date(thirtyDaysAgo.getTime() + (i + 1) * 24 * 60 * 60 * 1000);
      const key = date.toISOString().split('T')[0];
      timeSeries[key] = { write: 0, read: 0, search: 0 };
    }

    const actionStats = db.getActionStatsByDate(repo, 30);
    for (const row of actionStats) {
      if (timeSeries[row.date]) {
        if (row.action === 'write') timeSeries[row.date].write = row.count;
        if (row.action === 'read') timeSeries[row.date].read = row.count;
        if (row.action === 'search') timeSeries[row.date].search = row.count;
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
      taskStats,
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
  console.log(`${new Date().toISOString()} DASHBOARD_STARTING v${pkg.version}`);
  logger.info("MCP Memory Dashboard started", { port: PORT, version: pkg.version });
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

// List tasks for a repo
app.get("/api/tasks", async (req, res) => {
  try {
    const repo = req.query.repo as string;
    const statusQuery = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string || "20", 10)));

    if (!repo) {
      return res.status(400).json({ error: "repo parameter is required" });
    }

    const offset = (page - 1) * pageSize;
    
    // Support multiple statuses separated by comma
    let tasks;
    if (statusQuery && statusQuery.includes(',')) {
      const statuses = statusQuery.split(',').map(s => s.trim());
      tasks = db.getTasksByMultipleStatuses(repo, statuses, pageSize, offset);
    } else {
      tasks = db.getTasksByRepo(repo, statusQuery, pageSize, offset);
    }
    
    res.json({ tasks, page, pageSize });
  } catch (err: any) {
    logger.error("Error listing tasks", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Get MCP Capabilities (Tools, Resources, Prompts)
app.get("/api/capabilities", (req, res) => {
  try {
    const resources = listResources();
    res.json({
      tools: TOOL_DEFINITIONS || [],
      resources: resources.resources || [],
      prompts: Object.values(PROMPTS) || []
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Import tasks from CSV
app.post("/api/tasks/import-csv", async (req, res) => {
  try {
    const { repo, csvData } = req.body;
    if (!repo || !csvData) {
      return res.status(400).json({ error: "repo and csvData are required" });
    }

    const lines = csvData.split('\n');
    if (lines.length < 2) return res.json({ success: true, count: 0 });

    const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
    const tasks = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      // Simple CSV split (doesn't handle quotes with commas, but good enough for this)
      const values = lines[i].split(',').map((v: string) => v.trim());
      const task: any = {
        id: randomUUID(),
        repo,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'pending',
        priority: 3,
        agent: 'csv-import',
        role: 'system'
      };

      headers.forEach((header: string, index: number) => {
        if (values[index] === undefined) return;
        if (header === 'task_code') task.task_code = values[index];
        if (header === 'phase') task.phase = values[index];
        if (header === 'title') task.title = values[index];
        if (header === 'description') task.description = values[index];
        if (header === 'priority') task.priority = parseInt(values[index]) || 3;
        if (header === 'status') task.status = values[index] || 'pending';
        if (header === 'agent') task.agent = values[index] || 'csv-import';
        if (header === 'role') task.role = values[index] || 'system';
        if (header === 'doc_path') task.doc_path = values[index] || null;
      });

      if (task.title && task.task_code) {
        db.insertTask(task);
        tasks.push(task);
      }
    }

    db.logAction("write", repo, { resultCount: tasks.length, query: "CSV Import" });
    res.json({ success: true, count: tasks.length });
  } catch (err: any) {
    logger.error("Error importing tasks", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Export project handbook as Markdown
app.get("/api/export/handbook/:repo", (req, res) => {
  try {
    const repo = req.params.repo;
    const memories = db.searchByRepo(repo, { includeArchived: false });
    
    let markdown = `# Project Handbook: ${repo}\n\n`;
    markdown += `*Generated by MCP Local Memory on ${new Date().toLocaleDateString()}*\n\n`;
    
    const types = ["decision", "code_fact", "pattern", "mistake"];
    for (const type of types) {
      const filtered = memories.filter(m => m.type === type);
      if (filtered.length === 0) continue;
      
      markdown += `## ${type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}s\n\n`;
      filtered.sort((a, b) => b.importance - a.importance).forEach(m => {
        markdown += `### ${m.title || 'Untitled'}\n`;
        markdown += `**Priority:** ${m.importance}/5 | **Tags:** ${m.tags?.join(', ') || 'none'}\n\n`;
        markdown += `${m.content}\n\n`;
        if (m.scope.folder) markdown += `*Context: ${m.scope.folder}*\n\n`;
        markdown += `---\n\n`;
      });
    }

    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${repo}-handbook.md"`);
    res.send(markdown);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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

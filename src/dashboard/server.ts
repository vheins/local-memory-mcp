#!/usr/bin/env node
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { randomUUID } from "crypto";
import os from "os";
import { MCPClient } from "../mcp/client.js";
import { SQLiteStore } from "../mcp/storage/sqlite.js";
import { logger } from "../mcp/utils/logger.js";
import { TOOL_DEFINITIONS } from "../mcp/tools/schemas.js";
import { PROMPTS } from "../mcp/prompts/registry.js";
import { listResources } from "../mcp/resources/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pkg = { version: "0.0.0" };
try {
  const pkgPath = path.join(__dirname, "../../package.json");
  if (fs.existsSync(pkgPath)) {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  }
} catch (e) {
  // Silent fallback
}

const app = express();
const PORT = process.env.PORT || 3456;
const startTime = Date.now();
const db = new SQLiteStore();
const mcpClient = new MCPClient();

type RecentAction = {
  id: number;
  action: string;
  query?: string;
  response?: string;
  memory_id?: string;
  memory_title?: string;
  memory_type?: string;
  task_id?: string;
  task_title?: string;
  task_code?: string;
  result_count?: number;
  created_at: string;
};

type CondensedRecentAction = RecentAction & {
  burstCount: number;
};

// --- Middleware ---
app.use(express.json());

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

// --- API Routes ---

// Health check
app.get("/api/health", (req, res) => {
  const stats = db.getStats();
  res.json({
    connected: mcpClient.isConnected(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: pkg.version,
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get global or repo stats
app.get("/api/stats", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const stats = db.getDashboardStats(repo);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent actions
app.get("/api/recent-actions", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 10));
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const rawActions = db.getRecentActions(repo, 100);
    const allCondensed = condenseRecentActions(rawActions, 100);
    const offset = (page - 1) * pageSize;
    res.json({
      actions: allCondensed.slice(offset, offset + pageSize),
      pagination: { page, pageSize, totalItems: allCondensed.length }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Memory endpoints
app.get("/api/memories", async (req, res) => {
  try {
    const { repo, type, search, minImportance, maxImportance, sortBy, sortOrder } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string || "25", 10)));

    if (!repo) return res.status(400).json({ error: "repo is required" });

    const result = db.listMemoriesForDashboard({
      repo: repo as string,
      type: type as string,
      search: search as string,
      minImportance: minImportance ? parseInt(minImportance as string) : undefined,
      maxImportance: maxImportance ? parseInt(maxImportance as string) : undefined,
      sortBy: sortBy as string,
      sortOrder: sortOrder === "asc" ? "asc" : "desc",
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.json({
      memories: result.items,
      pagination: {
        page,
        pageSize,
        totalItems: result.total,
        totalPages: Math.ceil(result.total / pageSize)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memories/:id", async (req, res) => {
  try {
    const memory = db.getByIdWithStats(req.params.id);
    if (!memory) throw new Error("Memory not found");
    db.logAction("read", memory.scope.repo, { memoryId: memory.id, resultCount: 1 });
    res.json(memory);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.post("/api/memories", async (req, res) => {
  try {
    const { repo, type, content } = req.body;
    if (!repo || !type || !content) return res.status(400).json({ error: "Required fields missing" });
    const id = randomUUID();
    db.insert({ ...req.body, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), scope: { repo } });
    db.logAction("write", repo, { memoryId: id });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Task endpoints
app.get("/api/tasks", async (req, res) => {
  try {
    const { repo, status, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string || "20", 10)));

    if (!repo) return res.status(400).json({ error: "repo is required" });

    let tasks;
    if (status && (status as string).includes(',')) {
      tasks = db.getTasksByMultipleStatuses(repo as string, (status as string).split(','), pageSize, (page - 1) * pageSize, search as string);
    } else {
      tasks = db.getTasksByRepo(repo as string, status as string, pageSize, (page - 1) * pageSize, search as string);
    }
    res.json({ tasks, page, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id", async (req, res) => {
  try {
    const task = db.getTaskById(req.params.id);
    if (!task) throw new Error("Task not found");
    db.logAction("read", task.repo, { taskId: task.id });
    res.json(task);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const existingTask = db.getTaskById(id);
    if (!existingTask) return res.status(404).json({ error: "Task not found" });

    db.updateTask(id, updates);

    if (updates.status && updates.status !== existingTask.status) {
      db.logAction("update", existingTask.repo, { taskId: id, query: `Status changed to ${updates.status}` });
      db.insertTaskComment({
        id: randomUUID(),
        task_id: id,
        repo: existingTask.repo,
        comment: updates.comment || `Status updated via dashboard`,
        agent: "dashboard",
        role: "user",
        model: "web-ui",
        previous_status: existingTask.status,
        next_status: updates.status,
        created_at: new Date().toISOString()
      });
    } else if (updates.comment) {
        db.insertTaskComment({
            id: randomUUID(),
            task_id: id,
            repo: existingTask.repo,
            comment: updates.comment,
            agent: "dashboard",
            role: "user",
            model: "web-ui",
            created_at: new Date().toISOString()
        });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const task = db.getTaskById(id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    
    db.deleteTask(id);
    db.logAction("delete", task.repo, { taskId: id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/task-comments/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { comment } = req.body;
        const existingComment = db.getTaskCommentById(id);
        if (!existingComment) return res.status(404).json({ error: "Comment not found" });
        
        db.updateTaskComment(id, { comment });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/task-comments/:id", async (req, res) => {
    try {
        const { id } = req.params;
        db.deleteTaskComment(id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const { repo, task_code, title } = req.body;
    if (!repo || !task_code || !title) return res.status(400).json({ error: "Required fields missing" });
    if (db.isTaskCodeDuplicate(repo, task_code)) return res.status(400).json({ error: "Duplicate task_code" });
    const id = randomUUID();
    db.insertTask({ ...req.body, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    db.logAction("write", repo, { taskId: id });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/stats/time", async (req, res) => {
    try {
        const { repo } = req.query;
        if (!repo) return res.status(400).json({ error: "repo is required" });
        
        const stats = {
            daily: db.getTaskTimeStats(repo as string, 'daily'),
            weekly: db.getTaskTimeStats(repo as string, 'weekly'),
            monthly: db.getTaskTimeStats(repo as string, 'monthly'),
            overall: db.getTaskTimeStats(repo as string, 'overall')
        };
        
        res.json(stats);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/capabilities", (req, res) => {
  res.json({ tools: TOOL_DEFINITIONS || [], resources: listResources().resources || [], prompts: Object.values(PROMPTS) || [] });
});

app.get("/api/export", async (req, res) => {
    try {
        const { repo } = req.query;
        if (!repo) return res.status(400).json({ error: "repo is required" });
        
        const memories = db.getAllMemoriesWithStats(repo as string);
        const tasks = db.getTasksByRepo(repo as string);
        
        const tasksWithComments = tasks.map(t => ({
            ...t,
            comments: db.getTaskCommentsByTaskId(t.id)
        }));
        
        res.json({
            repo,
            exported_at: new Date().toISOString(),
            memories,
            tasks: tasksWithComments
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// --- Static Serving & Final Routes ---
const staticRoot = fs.existsSync(path.join(__dirname, "public")) ? path.join(__dirname, "public") : path.join(process.cwd(), "src", "dashboard", "public");
app.use(express.static(staticRoot));

app.get("/", (req, res) => {
  res.sendFile(path.join(staticRoot, "index.html"));
});

// --- Utilities ---
function condenseRecentActions(actions: RecentAction[], limit: number): CondensedRecentAction[] {
  const condensed: CondensedRecentAction[] = [];
  for (const action of actions) {
    const prev = condensed[condensed.length - 1];
    const same = prev && prev.action === action.action && prev.query === action.query && prev.memory_id === action.memory_id;
    const within = prev && Math.abs(new Date(prev.created_at).getTime() - new Date(action.created_at).getTime()) <= 600000;
    if (same && within) { prev.burstCount++; prev.created_at = action.created_at; }
    else { condensed.push({ ...action, burstCount: 1 }); }
  }
  return condensed.slice(0, limit);
}

// --- Start Server ---
// The dashboard reads directly from SQLite for its own views, so it should stay
// usable even when the MCP child process is unavailable.
if (process.env.DASHBOARD_ENABLE_MCP === "true") {
  mcpClient.start().catch(e => logger.error("MCP Client failed", { error: e.message }));
}

app.listen(PORT, () => {
  console.log(`${new Date().toISOString()} DASHBOARD_STARTING v${pkg.version} on port ${PORT}`);
});

process.on("SIGINT", () => { mcpClient.stop(); db.close(); process.exit(0); });
process.on("SIGTERM", () => { mcpClient.stop(); db.close(); process.exit(0); });

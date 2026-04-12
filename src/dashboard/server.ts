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
  const health = {
    connected: mcpClient.isConnected(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: pkg.version,
    memoryCount: stats.total,
    pendingRequests: mcpClient.getPendingCount(),
    dbPath: db.getDbPath()
  };
  res.json(jsonApiRes(health, "health"));
});

// List all repositories
app.get("/api/repos", async (req, res) => {
  try {
    const repos = db.listRepoNavigation();
    res.json(jsonApiRes(repos.map(r => ({ id: r.repo, name: r.repo, ...r })), "repository"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

// Get global or repo stats
app.get("/api/stats", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const stats = db.getDashboardStats(repo);
    res.json(jsonApiRes(stats, "system-stats"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
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
    const items = allCondensed.slice(offset, offset + pageSize);
    res.json(jsonApiRes(items, "recent-action", {
      meta: { page, pageSize, totalItems: allCondensed.length }
    }));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

// Memory endpoints
app.get("/api/memories", async (req, res) => {
  try {
    const { repo, type, search, minImportance, maxImportance, sortBy, sortOrder } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string || "25", 10)));

    if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

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

    res.json(jsonApiRes(result.items, "memory", {
      meta: {
        page,
        pageSize,
        totalItems: result.total,
        totalPages: Math.ceil(result.total / pageSize)
      }
    }));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.get("/api/memories/:id", async (req, res) => {
  try {
    const memory = db.getByIdWithStats(req.params.id);
    if (!memory) throw new Error("Memory not found");
    db.logAction("read", memory.scope.repo, { memoryId: memory.id, resultCount: 1 });
    res.json(jsonApiRes(memory, "memory"));
  } catch (err: any) {
    res.status(404).json(jsonApiError(err.message, 404));
  }
});

app.post("/api/memories", async (req, res) => {
  try {
    const attributes = getAttributes(req);
    const { repo, type, content } = attributes;
    if (!repo || !type || !content) return res.status(400).json(jsonApiError("Required fields missing", 400));
    const id = randomUUID();
    db.insert({ ...attributes, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), scope: { repo } });
    db.logAction("write", repo, { memoryId: id });
    res.json(jsonApiRes({ id }, "memory"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.put("/api/memories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.getByIdWithStats ? db.getByIdWithStats(id) : db.getById(id);
    if (!existing) return res.status(404).json(jsonApiError("Memory not found", 404));
    const attributes = getAttributes(req);
    const { title, content, type, importance, tags, agent, model, repo } = attributes;
    const updates = { title, content, type, importance, tags, agent, model, repo, updated_at: new Date().toISOString() };
    db.update(id, updates);
    db.logAction("update", existing.repo || attributes.repo || "", { memoryId: id });
    res.json(jsonApiRes({ message: "Updated" }, "status"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.delete("/api/memories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.getByIdWithStats ? db.getByIdWithStats(id) : db.getById(id);
    if (!existing) return res.status(404).json(jsonApiError("Memory not found", 404));
    db.delete(id);
    db.logAction("delete", existing.repo || "", { memoryId: id });
    res.json(jsonApiRes({ message: "Deleted" }, "status"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.post("/api/memories/bulk-import", async (req, res) => {
  try {
    const { items, repo } = getAttributes(req);
    if (!Array.isArray(items) || !repo) return res.status(400).json(jsonApiError("Invalid payload: requires 'items' array and 'repo'", 400));
    
    const entries = items.map(item => ({
      ...item,
      id: item.id || randomUUID(),
      scope: { ...item.scope, repo },
      created_at: item.created_at || new Date().toISOString(),
      updated_at: item.updated_at || new Date().toISOString()
    }));
    
    const count = db.bulkInsertMemories(entries);
    db.logAction("write", repo, { query: `Bulk imported ${count} memories` });
    res.json(jsonApiRes({ count }, "status"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.post("/api/memories/bulk-action", async (req, res) => {
  try {
    const { action, ids, updates } = getAttributes(req);
    if (!Array.isArray(ids) || !action) return res.status(400).json(jsonApiError("Invalid payload: requires 'ids' array and 'action'", 400));
    
    let count = 0;
    if (action === "delete") {
      count = db.bulkDeleteMemories(ids);
    } else if (action === "update" || action === "archive") {
      count = db.bulkUpdateMemories(ids, updates || { status: action === 'archive' ? 'archived' : 'active' });
    } else {
      return res.status(400).json(jsonApiError("Invalid action", 400));
    }
    
    if (ids.length > 0) {
       const mem = db.getById(ids[0]);
       db.logAction(action, mem?.scope?.repo || "unknown", { query: `Bulk ${action} applied to ${count} memories` });
    }
    
    res.json(jsonApiRes({ count }, "status"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

// Task endpoints
app.get("/api/tasks", async (req, res) => {
  try {
    const { repo, status, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string || "20", 10)));

    if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

    let tasks;
    if (status && (status as string).includes(',')) {
      tasks = db.getTasksByMultipleStatuses(repo as string, (status as string).split(','), pageSize, (page - 1) * pageSize, search as string);
    } else {
      tasks = db.getTasksByRepo(repo as string, status as string, pageSize, (page - 1) * pageSize, search as string);
    }
    res.json(jsonApiRes(tasks, "task", { meta: { page, pageSize } }));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.get("/api/tasks/:id", async (req, res) => {
  try {
    const task = db.getTaskById(req.params.id);
    if (!task) throw new Error("Task not found");
    db.logAction("read", task.repo, { taskId: task.id });
    res.json(jsonApiRes(task, "task"));
  } catch (err: any) {
    res.status(404).json(jsonApiError(err.message, 404));
  }
});

app.put("/api/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const attributes = getAttributes(req);
    const existingTask = db.getTaskById(id);
    if (!existingTask) return res.status(404).json(jsonApiError("Task not found", 404));

    db.updateTask(id, attributes);

    if (attributes.status && attributes.status !== existingTask.status) {
      db.logAction("update", existingTask.repo, { taskId: id, query: `Status changed to ${attributes.status}` });
      db.insertTaskComment({
        id: randomUUID(),
        task_id: id,
        repo: existingTask.repo,
        comment: attributes.comment || `Status updated via dashboard`,
        agent: "dashboard",
        role: "user",
        model: "web-ui",
        previous_status: existingTask.status,
        next_status: attributes.status,
        created_at: new Date().toISOString()
      });
    } else if (attributes.comment) {
        db.insertTaskComment({
            id: randomUUID(),
            task_id: id,
            repo: existingTask.repo,
            comment: attributes.comment,
            agent: "dashboard",
            role: "user",
            model: "web-ui",
            created_at: new Date().toISOString()
        });
    }

    res.json(jsonApiRes({ message: "Updated" }, "status"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const task = db.getTaskById(id);
    if (!task) return res.status(404).json(jsonApiError("Task not found", 404));
    
    db.deleteTask(id);
    db.logAction("delete", task.repo, { taskId: id });
    res.json(jsonApiRes({ message: "Deleted" }, "status"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.post("/api/tasks/bulk-import", async (req, res) => {
  try {
    const { items, repo } = getAttributes(req);
    if (!Array.isArray(items) || !repo) return res.status(400).json(jsonApiError("Invalid payload: requires 'items' array and 'repo'", 400));
    
    const tasks = items.map(t => ({
      ...t,
      id: t.id || randomUUID(),
      repo,
      task_code: t.task_code || randomUUID().substring(0,8),
      created_at: t.created_at || new Date().toISOString(),
      updated_at: t.updated_at || new Date().toISOString()
    }));
    
    const count = db.bulkInsertTasks(tasks);
    db.logAction("write", repo, { query: `Bulk imported ${count} tasks` });
    res.json(jsonApiRes({ count }, "status"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.put("/api/task-comments/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { comment } = getAttributes(req);
        const existingComment = db.getTaskCommentById(id);
        if (!existingComment) return res.status(404).json(jsonApiError("Comment not found", 404));
        
        db.updateTaskComment(id, { comment });
        res.json(jsonApiRes({ message: "Updated" }, "status"));
    } catch (err: any) {
        res.status(500).json(jsonApiError(err.message));
    }
});

app.delete("/api/task-comments/:id", async (req, res) => {
    try {
        const { id } = req.params;
        db.deleteTaskComment(id);
        res.json(jsonApiRes({ message: "Deleted" }, "status"));
    } catch (err: any) {
        res.status(500).json(jsonApiError(err.message));
    }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const attributes = getAttributes(req);
    const { repo, task_code, title } = attributes;
    if (!repo || !task_code || !title) return res.status(400).json(jsonApiError("Required fields missing", 400));
    if (db.isTaskCodeDuplicate(repo, task_code)) return res.status(400).json(jsonApiError("Duplicate task_code", 400));
    const id = randomUUID();
    db.insertTask({ ...attributes, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    db.logAction("write", repo, { taskId: id });
    res.json(jsonApiRes({ id }, "task"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

app.get("/api/tasks/stats/time", async (req, res) => {
    try {
        const { repo } = req.query;
        if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));
        
        const stats = {
            daily: { 
                ...db.getTaskTimeStats(repo as string, 'daily'),
                history: db.getTaskComparisonSeries(repo as string, 'daily')
            },
            weekly: { 
                ...db.getTaskTimeStats(repo as string, 'weekly'),
                history: db.getTaskComparisonSeries(repo as string, 'weekly')
            },
            monthly: { 
                ...db.getTaskTimeStats(repo as string, 'monthly'),
                history: db.getTaskComparisonSeries(repo as string, 'monthly')
            },
            overall: { 
                ...db.getTaskTimeStats(repo as string, 'overall'),
                history: db.getTaskComparisonSeries(repo as string, 'overall')
            }
        };
        
        res.json(jsonApiRes(stats, "performance-stats"));
    } catch (err: any) {
        res.status(500).json(jsonApiError(err.message));
    }
});

app.get("/api/capabilities", (req, res) => {
  const caps = { tools: TOOL_DEFINITIONS || [], resources: listResources().resources || [], prompts: Object.values(PROMPTS) || [] };
  res.json(jsonApiRes(caps, "capability"));
});

app.get("/api/export", async (req, res) => {
    try {
        const { repo } = req.query;
        if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));
        
        const memories = db.getAllMemoriesWithStats(repo as string);
        const tasks = db.getTasksByRepo(repo as string);
        
        const allComments = db.getAllTaskCommentsByRepo(repo as string);
        const commentsByTaskId = allComments.reduce((acc, comment) => {
            if (!acc[comment.task_id]) {
                acc[comment.task_id] = [];
            }
            acc[comment.task_id].push(comment);
            return acc;
        }, {} as Record<string, any[]>);

        const tasksWithComments = tasks.map(t => ({
            ...t,
            comments: commentsByTaskId[t.id] || []
        }));
        
        const exportData = {
            repo,
            exported_at: new Date().toISOString(),
            memories,
            tasks: tasksWithComments
        };
        res.json(jsonApiRes(exportData, "export"));
    } catch (err: any) {
        res.status(500).json(jsonApiError(err.message));
    }
});

app.post("/api/tools/:name/call", async (req, res) => {
  try {
    if (!mcpClient.isConnected()) {
      await mcpClient.start();
    }
    const { name } = req.params;
    const args = getAttributes(req);
    const result = await mcpClient.callTool(name, args);
    res.json(jsonApiRes(result, "tool-result"));
  } catch (err: any) {
    res.status(500).json(jsonApiError(err.message));
  }
});

// --- Static Serving & Final Routes ---
const staticRoot = fs.existsSync(path.join(__dirname, "public")) ? path.join(__dirname, "public") : path.join(process.cwd(), "src", "dashboard", "public");
app.use(express.static(staticRoot));

app.get("/", (req, res) => {
  res.sendFile(path.join(staticRoot, "index.html"));
});

// --- Utilities ---
function jsonApiRes(data: any, type: string, extra: { meta?: any; links?: any } = {}) {
  const isArray = Array.isArray(data);
  const dataLayer = isArray 
    ? data.map((item: any) => {
        const { id, ...attributes } = item;
        return { type, id: String(id || 'system'), attributes };
      })
    : (() => {
        const { id, ...attributes } = data;
        return { type, id: String(id || attributes.id || 'system'), attributes };
      })();
  
  return {
    jsonapi: { version: "1.1" },
    data: dataLayer,
    ...extra
  };
}

function jsonApiError(message: string, status: number = 500) {
  return {
    jsonapi: { version: "1.1" },
    errors: [{ status: String(status), detail: message }]
  };
}

function getAttributes(req: express.Request) {
  return req.body.data?.attributes || req.body;
}

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

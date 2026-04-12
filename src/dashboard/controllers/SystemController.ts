import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, mcpClient, startTime } from "../lib/context.js";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi.js";
import { condenseRecentActions } from "../lib/helpers.js";
import { TOOL_DEFINITIONS } from "../../mcp/tools/schemas.js";
import { listResources } from "../../mcp/resources/index.js";
import { PROMPTS } from "../../mcp/prompts/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pkg = { version: "0.0.0" };
try {
  const pkgPath = path.join(__dirname, "../../../package.json");
  if (fs.existsSync(pkgPath)) {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  }
} catch (e) {}

export class SystemController {
  static getHealth(req: express.Request, res: express.Response) {
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
  }

  static getRepos(req: express.Request, res: express.Response) {
    try {
      const repos = db.listRepoNavigation();
      res.json(jsonApiRes(repos.map(r => ({ id: r.repo, name: r.repo, ...r })), "repository"));
    } catch (err: any) {
      res.status(500).json(jsonApiError(err.message));
    }
  }

  static getStats(req: express.Request, res: express.Response) {
    try {
      const repo = req.query.repo as string | undefined;
      const stats = db.getDashboardStats(repo);
      res.json(jsonApiRes(stats, "system-stats"));
    } catch (err: any) {
      res.status(500).json(jsonApiError(err.message));
    }
  }

  static getRecentActions(req: express.Request, res: express.Response) {
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
  }

  static getCapabilities(req: express.Request, res: express.Response) {
    const caps = {
      tools: TOOL_DEFINITIONS || [],
      resources: listResources().resources || [],
      prompts: Object.values(PROMPTS) || []
    };
    res.json(jsonApiRes(caps, "capability"));
  }

  static getExport(req: express.Request, res: express.Response) {
    try {
      const { repo } = req.query;
      if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));
      
      const memories = db.getAllMemoriesWithStats(repo as string);
      const tasks = db.getTasksByRepo(repo as string);
      
      const allComments = db.getAllTaskCommentsByRepo(repo as string);
      const commentsByTaskId = allComments.reduce((acc, comment) => {
        if (!acc[comment.task_id]) acc[comment.task_id] = [];
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
  }

  static async callTool(req: express.Request, res: express.Response) {
    try {
      if (!mcpClient.isConnected()) await mcpClient.start();
      const { name } = req.params as { name: string };
      const args = getAttributes(req);
      const result = await mcpClient.callTool(name, args);
      res.json(jsonApiRes(result, "tool-result"));
    } catch (err: any) {
      res.status(500).json(jsonApiError(err.message));
    }
  }
}

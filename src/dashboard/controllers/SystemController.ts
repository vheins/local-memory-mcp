import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, mcpClient, startTime } from "../lib/context";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi";
import { condenseRecentActions } from "../lib/helpers";
import { TOOL_DEFINITIONS } from "../../mcp/tools/schemas";
import { listResources } from "../../mcp/resources/index";
import { PROMPTS } from "../../mcp/prompts/registry";
import type { RecentAction } from "../ui/src/lib/interfaces/common";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pkg = { version: "0.0.0" };

try {
	// Robustly find package.json by looking up from __dirname
	let currentDir = __dirname;
	let pkgPath = "";
	while (currentDir !== path.parse(currentDir).root) {
		const checkPath = path.join(currentDir, "package.json");
		if (fs.existsSync(checkPath)) {
			pkgPath = checkPath;
			break;
		}
		currentDir = path.dirname(currentDir);
	}

	if (pkgPath) {
		const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
		if (data.version) pkg.version = data.version;
	}
} catch {
	// Intentionally empty: package.json might not exist in dev or some environments
}

export class SystemController {
	static async getHealth(req: express.Request, res: express.Response) {
		await db.refresh();
		const stats = db.system.getGlobalStats();
		const health = {
			connected: mcpClient.isConnected(),
			uptime: Math.floor((Date.now() - startTime) / 1000),
			version: pkg.version,
			memoryCount: stats.totalMemories,
			repoCount: stats.totalRepos,
			pendingRequests: mcpClient.getPendingCount(),
			dbPath: db.getDbPath()
		};
		res.json(jsonApiRes(health, "health"));
	}

	static async getRepos(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const repos = db.system.listRepoNavigation();
			res.json(
				jsonApiRes(
					repos.map((r) => ({ id: r.repo, name: r.repo, ...r })),
					"repository"
				)
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async getStats(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const repo = req.query.repo as string | undefined;
			const stats = repo ? db.system.getDashboardStats(repo) : db.system.getGlobalDashboardStats();
			res.json(jsonApiRes(stats, "system-stats"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async getRecentActions(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const repo = req.query.repo as string | undefined;
			const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 10));
			const page = Math.max(1, parseInt(req.query.page as string) || 1);
			const rawActions = db.actions.getRecentActions(repo, 100);
			// Map ActionLogRow to RecentAction (fixing query null vs undefined)
			const actions: RecentAction[] = rawActions.map((a) => ({
				...a,
				query: a.query || undefined,
				response: a.response || undefined,
				memory_id: a.memory_id || undefined,
				task_id: a.task_id || undefined,
				memory_title: a.memory_title || undefined,
				memory_type: a.memory_type || undefined
			}));
			const allCondensed = condenseRecentActions(actions, 100);
			const offset = (page - 1) * pageSize;
			const items = allCondensed.slice(offset, offset + pageSize);
			res.json(
				jsonApiRes(items, "recent-action", {
					meta: { page, pageSize, totalItems: allCondensed.length }
				})
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static getCapabilities(req: express.Request, res: express.Response) {
		const tools = (TOOL_DEFINITIONS || []).map((tool) => ({
			type: "tool",
			id: tool.name,
			attributes: tool
		}));
		const resourceList = listResources();
		const resources = ((resourceList.resources as Record<string, unknown>[]) || []).map((resource) => ({
			type: "resource",
			id: resource.uri as string,
			attributes: resource
		}));
		const prompts = (Object.values(PROMPTS) || []).map((prompt) => ({
			type: "prompt",
			id: prompt.name,
			attributes: prompt
		}));
		const caps = { tools, resources, prompts };
		res.json(jsonApiRes(caps, "capability"));
	}

	static async getExport(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { repo } = req.query;
			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			const memories = db.memories.getAllMemoriesWithStats(repo as string);
			const tasks = db.tasks.getTasksByRepo(repo as string);

			const allComments = db.tasks.getAllTaskCommentsByRepo(repo as string);
			const commentsByTaskId = allComments.reduce(
				(acc, comment) => {
					if (!acc[comment.task_id]) acc[comment.task_id] = [];
					acc[comment.task_id].push(comment);
					return acc;
				},
				{} as Record<string, unknown[]>
			);

			const tasksWithComments = tasks.map((t) => ({
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
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async callTool(req: express.Request, res: express.Response) {
		try {
			if (!mcpClient.isConnected()) await mcpClient.start();
			const { name } = req.params as { name: string };
			const args = getAttributes(req) as Record<string, unknown>;
			const result = await mcpClient.callTool(name, args);
			res.json(jsonApiRes(result, "tool-result"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}
}

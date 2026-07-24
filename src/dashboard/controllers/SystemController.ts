import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, mcpClient, startTime } from "../lib/context";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi";
import { condenseRecentActions } from "../lib/helpers";
import { parseRepoInput } from "../../mcp/utils/normalize";
import { TOOL_DEFINITIONS } from "../../mcp/tools/tool-definitions";
import { listResources } from "../../mcp/resources/index";
import { PROMPTS } from "../../mcp/prompts/registry";
import type { RecentAction } from "../ui/src/lib/interfaces/common";
import {
	handleHandoffList,
	handleHandoffCreate,
	handleHandoffUpdate,
	handleTaskClaim,
	handleClaimList,
	handleClaimRelease
} from "../../mcp/tools/handoff.manage";

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
			let owner = req.query.owner as string | undefined;
			if (!owner && repo && repo.includes("/")) {
				const parsed = parseRepoInput(repo, undefined);
				owner = parsed.owner;
			}
			const stats = repo ? db.system.getDashboardStats(owner || "", repo) : db.system.getGlobalDashboardStats();
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
			const rawActions = db.actions.getRecentActions("", repo, 100);
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
			const repo = req.query.repo as string;
			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			let owner = req.query.owner as string | undefined;
			if (!owner && repo.includes("/")) {
				const parsed = parseRepoInput(repo, undefined);
				owner = parsed.owner;
			}
			if (!owner)
				return res.status(400).json(jsonApiError("owner is required when repo is not in owner/repo format", 400));

			const PAGE_SIZE = 500;

			res.setHeader("Content-Type", "application/json");
			res.write(
				`{\n  "data": {\n    "type": "export",\n    "id": "export-${repo}",\n    "attributes": {\n      "repo": ${JSON.stringify(repo)},\n      "exported_at": ${JSON.stringify(new Date().toISOString())},\n      "memories": [\n`
			);

			let offset = 0;
			let first = true;

			while (true) {
				const page = db.memories.getAllMemoriesWithStats(owner, repo, PAGE_SIZE, offset);
				if (page.length === 0) break;
				for (const mem of page) {
					if (!first) res.write(",\n");
					res.write(JSON.stringify(mem));
					first = false;
				}
				offset += PAGE_SIZE;
				await new Promise((r) => setImmediate(r));
			}

			res.write(`\n      ],\n      "tasks": [\n`);
			offset = 0;
			first = true;

			while (true) {
				const page = db.tasks.getTasksByRepo(owner, repo, undefined, PAGE_SIZE, offset);
				if (page.length === 0) break;
				for (const task of page) {
					if (!first) res.write(",\n");
					res.write(JSON.stringify(task));
					first = false;
				}
				offset += PAGE_SIZE;
				await new Promise((r) => setImmediate(r));
			}

			res.write(`\n      ],\n      "comments": [\n`);
			offset = 0;
			first = true;

			while (true) {
				const page = db.taskComments.getAllTaskCommentsByRepo(owner, repo, PAGE_SIZE, offset);
				if (page.length === 0) break;
				for (const comment of page) {
					if (!first) res.write(",\n");
					res.write(JSON.stringify(comment));
					first = false;
				}
				offset += PAGE_SIZE;
				await new Promise((r) => setImmediate(r));
			}

			res.write(`\n      ]\n    }\n  }\n}\n`);
			res.end();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			if (!res.headersSent) {
				res.status(500).json(jsonApiError(message));
			}
			res.end();
		}
	}

	static async callTool(req: express.Request, res: express.Response) {
		try {
			const { name } = req.params as { name: string };
			const args = getAttributes(req) as Record<string, unknown>;

			const COORDINATION_TOOLS: Record<string, (args: unknown, storage: typeof db) => Promise<unknown>> = {
				"handoff-list": handleHandoffList,
				"handoff-create": handleHandoffCreate,
				"handoff-update": handleHandoffUpdate,
				"task-claim": handleTaskClaim,
				"claim-list": handleClaimList,
				"claim-release": handleClaimRelease
			};

			if (name in COORDINATION_TOOLS) {
				const result = await COORDINATION_TOOLS[name](args, db);
				res.json(jsonApiRes(result, "tool-result"));
				return;
			}

			if (!mcpClient.isConnected()) await mcpClient.start();
			const result = await mcpClient.callTool(name, args);
			res.json(jsonApiRes(result, "tool-result"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}
}

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, mcpClient, startTime } from "../lib/context";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi";
import { condenseRecentActions } from "../lib/helpers";
import type { RecentAction } from "../lib/interfaces";
import { parseRepoInput } from "../../mcp/utils/normalize";
import { TOOL_DEFINITIONS } from "../../mcp/types/tool-definitions";
import { listResources } from "../../mcp/resources/index";
import { PROMPTS } from "../../mcp/prompts/registry";
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
		await handleController(req, res, () => {
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
			return jsonApiRes(health, "health");
		});
	}

	static async getRepos(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repos = db.system.listRepoNavigation();
			return jsonApiRes(
				repos.map((r) => ({ id: r.repo, name: r.repo, ...r })),
				"repository"
			);
		});
	}

	static async getStats(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string | undefined;
			let owner = req.query.owner as string | undefined;
			if (!owner && repo && repo.includes("/")) {
				const parsed = parseRepoInput(repo, undefined);
				owner = parsed.owner;
			}
			const stats = repo ? db.system.getDashboardStats(owner || "", repo) : db.system.getGlobalDashboardStats();
			return jsonApiRes(stats, "system-stats");
		});
	}

	static async getRecentActions(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string | undefined;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 10 });
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
			const items = allCondensed.slice(offset, offset + pageSize);
			return jsonApiRes(items, "recent-action", {
				meta: { page, pageSize, totalItems: allCondensed.length }
			});
		});
	}

	static getCapabilities(req: express.Request, res: express.Response) {
		const canonical = (tool: { title?: string; description?: string }) =>
			!tool.title?.includes("(Deprecated)") && !tool.description?.startsWith("DEPRECATED");
		const tools = (TOOL_DEFINITIONS || []).filter(canonical).map((tool) => ({
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
		await handleController(req, res, async () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			let owner = req.query.owner as string | undefined;
			if (!owner && repo.includes("/")) {
				const parsed = parseRepoInput(repo, undefined);
				owner = parsed.owner;
			}
			if (!owner) throw new HttpError(400, "owner is required when repo is not in owner/repo format");

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
		});
	}

	static async callTool(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
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

			// Write-lock invariant (TASK-102 / TASK-125): the four mutation
			// handlers mutate storage.handoffs directly and MUST serialize with
			// MCP write tools through db.withWrite — the same file-lock boundary
			// router.ts applies to handoff-write / claim-manage (WRITE_TOOLS).
			// The read handlers (handoff-list, claim-list) stay outside the lock.
			const COORDINATION_WRITE_TOOLS = new Set(["handoff-create", "handoff-update", "task-claim", "claim-release"]);

			if (name in COORDINATION_TOOLS) {
				const handler = COORDINATION_TOOLS[name];
				const result = COORDINATION_WRITE_TOOLS.has(name)
					? await db.withWrite(() => handler(args, db))
					: await handler(args, db);
				return jsonApiRes(result, "tool-result");
			}

			if (!mcpClient.isConnected()) await mcpClient.start();
			const result = await mcpClient.callTool(name, args);
			return jsonApiRes(result, "tool-result");
		});
	}
}

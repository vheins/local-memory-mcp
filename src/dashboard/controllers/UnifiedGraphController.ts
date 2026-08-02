import express from "express";
import { db } from "../lib/context";
import { jsonApiRes, handleController, HttpError } from "../lib/jsonApi";
import { parseRepoInput } from "../../mcp/utils/normalize";

export class UnifiedGraphController {
	static async getGraph(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const rawRepo = req.query.repo as string | undefined;
			const owner = req.query.owner as string | undefined;
			const domains = ((req.query.domains as string) || "memory,codebase,task,entity").split(",");
			const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
			const minImportance = parseInt(req.query.minImportance as string) || 1;

			let resolvedOwner = owner;
			if (!resolvedOwner && rawRepo && rawRepo.includes("/")) {
				const parsed = parseRepoInput(rawRepo, undefined);
				resolvedOwner = parsed.owner;
			}
			if (!resolvedOwner) {
				throw new HttpError(400, "owner query parameter is required");
			}

			const repo = rawRepo?.includes("/") ? rawRepo.split("/")[1] : rawRepo;

			const nodes: Record<string, unknown>[] = [];
			const edges: Record<string, unknown>[] = [];

			if (domains.includes("memory")) {
				const memResult = db.memories.listMemoriesForDashboard({
					owner: resolvedOwner,
					repo,
					minImportance,
					limit,
					sortBy: "importance"
				});

				for (const mem of memResult.items) {
					nodes.push({
						id: `mem-${mem.id}`,
						name: mem.title,
						domain: "memory",
						type: mem.type,
						description: (mem.content || "").substring(0, 200),
						size: (mem.importance || 1) * 6,
						importance: mem.importance
					});
				}
			}

			if (domains.includes("codebase")) {
				const symbols = repo
					? db.codebaseSymbols.getSymbolsByRepo(repo, limit)
					: db.codebaseSymbols.getAllSymbols(limit);

				for (const sym of symbols) {
					nodes.push({
						id: `sym-${sym.id}`,
						name: sym.name,
						domain: "codebase",
						type: sym.kind,
						filePath: sym.file_path,
						size: 16
					});
				}

				const fileGroups: Record<string, string[]> = {};
				for (const sym of symbols) {
					if (!fileGroups[sym.file_path]) fileGroups[sym.file_path] = [];
					fileGroups[sym.file_path].push(sym.id);
				}
				for (const filePath of Object.keys(fileGroups)) {
					const ids = fileGroups[filePath];
					for (let i = 1; i < ids.length; i++) {
						edges.push({
							source: `sym-${ids[i - 1]}`,
							target: `sym-${ids[i]}`,
							relation: "co_defined",
							weight: 0.5
						});
					}
				}
			}

			if (domains.includes("task")) {
				const tasks = repo
					? db.tasks.getTasksByRepo(resolvedOwner, repo, undefined, limit)
					: db.tasks.listRecentTasks(limit);

				for (const task of tasks) {
					nodes.push({
						id: `task-${task.id}`,
						name: task.title,
						domain: "task",
						type: "feature",
						status: task.status,
						description: (task.description || "").substring(0, 200),
						size: 18
					});
				}
			}

			if (domains.includes("entity")) {
				const entities = db.knowledgeGraph.listEntitiesForGraph(repo, limit);
				// Node subset for the edge filter (TASK-070): only edges whose
				// BOTH endpoints are among the capped entity nodes are shipped,
				// so the payload scales with the node cap, not total edges.
				const entityNames = entities.map((ent) => ent.name);

				for (const ent of entities) {
					nodes.push({
						id: `ent-${ent.name}`,
						name: ent.name,
						domain: "entity",
						type: ent.type,
						description: ent.description,
						size: 14
					});
				}

				const relations = db.knowledgeGraph.listRelationsForGraph(repo, entityNames);

				for (const rel of relations) {
					edges.push({
						source: `ent-${rel.from_entity}`,
						target: `ent-${rel.to_entity}`,
						relation: rel.relation_type,
						weight: 1.0
					});
				}
			}

			const stats = {
				totalNodes: nodes.length,
				totalEdges: edges.length,
				domains: {
					memory: nodes.filter((n) => n.domain === "memory").length,
					codebase: nodes.filter((n) => n.domain === "codebase").length,
					task: nodes.filter((n) => n.domain === "task").length,
					entity: nodes.filter((n) => n.domain === "entity").length
				}
			};

			return jsonApiRes({ id: `unified-graph-${rawRepo || "all"}`, nodes, edges, stats }, "unified-graph");
		});
	}
}

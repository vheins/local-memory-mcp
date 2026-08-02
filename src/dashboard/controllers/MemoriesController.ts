import express from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/context.js";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi.js";
import type { MemoryType, MemoryEntry } from "../../mcp/types/index.js";
import type { IdParams, MemoryListQuery } from "../../mcp/interfaces/index.js";

export class MemoriesController {
	static async list(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const query = req.query as unknown as MemoryListQuery;
			const { repo, type, search, minImportance, maxImportance, sortBy, sortOrder } = query;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 25 });

			if (!repo) throw new HttpError(400, "repo is required");

			const result = db.memories.listMemoriesForDashboard({
				repo: repo as string,
				type: type as MemoryType,
				search: search as string,
				minImportance: minImportance ? parseInt(minImportance as string) : undefined,
				maxImportance: maxImportance ? parseInt(maxImportance as string) : undefined,
				sortBy: sortBy as string,
				sortOrder: (sortOrder as string)?.toUpperCase() === "ASC" ? "ASC" : "DESC",
				limit: pageSize,
				offset
			});

			return jsonApiRes(result.items, "memory", {
				meta: {
					page,
					pageSize,
					totalItems: result.total,
					totalPages: Math.ceil(result.total / pageSize)
				}
			});
		});
	}

	static async get(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const memory = db.memories.getByIdWithStats(req.params.id as string);
			if (!memory) throw new HttpError(404, "Memory not found");
			db.actions.logAction("read", memory.scope.owner, memory.scope.repo, { memoryId: memory.id, resultCount: 1 });
			return jsonApiRes(memory, "memory");
		});
	}

	static async create(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { repo, type, content } = attributes;
			if (!repo || !type || !content) throw new HttpError(400, "Required fields missing");
			const id = randomUUID();
			await db.withWrite(() => {
				db.memories.insert({
					...attributes,
					id,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					scope: { repo }
				});
				db.actions.logAction("write", "", repo, { memoryId: id });
			});
			return jsonApiRes({ id }, "memory");
		});
	}

	static async update(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			const existing = db.memories.getByIdWithStats ? db.memories.getByIdWithStats(id) : db.memories.getById(id);
			if (!existing) throw new HttpError(404, "Memory not found");
			const attributes = getAttributes(req);
			const { title, content, type, importance, tags, agent, model, repo } = attributes;
			const updates = {
				title,
				content,
				type,
				importance,
				tags,
				agent,
				model,
				repo,
				updated_at: new Date().toISOString()
			};
			await db.withWrite(() => {
				db.memories.update(id, updates as Partial<MemoryEntry>);
				db.actions.logAction(
					"update",
					(existing as MemoryEntry).scope?.owner || "",
					(existing as MemoryEntry).scope?.repo || attributes.repo || "",
					{
						memoryId: id
					}
				);
			});
			return jsonApiRes({ message: "Updated" }, "status");
		});
	}

	static async delete(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			const existing = db.memories.getByIdWithStats ? db.memories.getByIdWithStats(id) : db.memories.getById(id);
			if (!existing) throw new HttpError(404, "Memory not found");
			await db.withWrite(() => {
				db.memories.delete(id);
				db.actions.logAction(
					"delete",
					(existing as MemoryEntry).scope?.owner || "",
					(existing as MemoryEntry).scope?.repo || "",
					{ memoryId: id }
				);
			});
			return jsonApiRes({ message: "Deleted" }, "status");
		});
	}

	static async bulkCreate(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { items, repo } = getAttributes(req);
			if (!Array.isArray(items) || !repo)
				throw new HttpError(400, "Invalid payload: requires 'items' array and 'repo'");

			const entries = items.map((item: Record<string, unknown>) => ({
				...item,
				id: (item.id as string) || randomUUID(),
				scope: { ...(item.scope as Record<string, unknown>), repo },
				created_at: (item.created_at as string) || new Date().toISOString(),
				updated_at: (item.updated_at as string) || new Date().toISOString()
			}));

			const count = await db.withWrite(() => {
				const insertedCount = db.memories.bulkInsertMemories(entries as MemoryEntry[]);
				db.actions.logAction("write", "", repo, { query: `Bulk imported ${insertedCount} memories` });
				return insertedCount;
			});
			return jsonApiRes({ count }, "status");
		});
	}

	static async bulkAction(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { action, ids, updates } = getAttributes(req);
			if (!Array.isArray(ids) || !action)
				throw new HttpError(400, "Invalid payload: requires 'ids' array and 'action'");

			const count = await db.withWrite(() => {
				let n: number;
				if (action === "delete") {
					n = db.memoryArchives.bulkDeleteMemories(ids);
				} else if (action === "update" || action === "archive") {
					n = db.memories.bulkUpdateMemories(ids, updates || { status: action === "archive" ? "archived" : "active" });
				} else {
					throw new Error("Invalid action");
				}

				if (ids.length > 0) {
					const mem = db.memories.getById(ids[0]);
					db.actions.logAction(action, mem?.scope?.owner || "", mem?.scope?.repo || "unknown", {
						query: `Bulk ${action} applied to ${n} memories`
					});
				}
				return n;
			});

			return jsonApiRes({ count }, "status");
		});
	}
}

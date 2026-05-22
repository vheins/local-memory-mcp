import express from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/context";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi";
import type { MemoryType, MemoryEntry } from "../../mcp/types/index";
import type { IdParams, MemoryListQuery } from "../../mcp/interfaces/index";

export class MemoriesController {
	static async list(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const query = req.query as unknown as MemoryListQuery;
			const { repo, type, search, minImportance, maxImportance, sortBy, sortOrder } = query;
			const page = Math.max(1, parseInt(query.page || "1", 10));
			const pageSize = Math.min(100, Math.max(1, parseInt((query.limit as string) || "25", 10)));

			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			const result = db.memories.listMemoriesForDashboard({
				repo: repo as string,
				type: type as MemoryType,
				search: search as string,
				minImportance: minImportance ? parseInt(minImportance as string) : undefined,
				maxImportance: maxImportance ? parseInt(maxImportance as string) : undefined,
				sortBy: sortBy as string,
				sortOrder: (sortOrder as string)?.toUpperCase() === "ASC" ? "ASC" : "DESC",
				limit: pageSize,
				offset: (page - 1) * pageSize
			});

			res.json(
				jsonApiRes(result.items, "memory", {
					meta: {
						page,
						pageSize,
						totalItems: result.total,
						totalPages: Math.ceil(result.total / pageSize)
					}
				})
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async get(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const memory = db.memories.getByIdWithStats(req.params.id as string);
			if (!memory) throw new Error("Memory not found");
			db.actions.logAction("read", memory.scope.repo, { memoryId: memory.id, resultCount: 1 });
			res.json(jsonApiRes(memory, "memory"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Memory not found";
			res.status(404).json(jsonApiError(message, 404));
		}
	}

	static async create(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const attributes = getAttributes(req);
			const { repo, type, content } = attributes;
			if (!repo || !type || !content) return res.status(400).json(jsonApiError("Required fields missing", 400));
			const id = randomUUID();
			await db.withWrite(() => {
				db.memories.insert({
					...attributes,
					id,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					scope: { repo }
				});
				db.actions.logAction("write", repo, { memoryId: id });
			});
			res.json(jsonApiRes({ id }, "memory"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async update(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { id } = req.params as unknown as IdParams;
			const existing = db.memories.getByIdWithStats ? db.memories.getByIdWithStats(id) : db.memories.getById(id);
			if (!existing) return res.status(404).json(jsonApiError("Memory not found", 404));
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
				db.actions.logAction("update", (existing as MemoryEntry).scope?.repo || attributes.repo || "", {
					memoryId: id
				});
			});
			res.json(jsonApiRes({ message: "Updated" }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async delete(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { id } = req.params as unknown as IdParams;
			const existing = db.memories.getByIdWithStats ? db.memories.getByIdWithStats(id) : db.memories.getById(id);
			if (!existing) return res.status(404).json(jsonApiError("Memory not found", 404));
			await db.withWrite(() => {
				db.memories.delete(id);
				db.actions.logAction("delete", (existing as MemoryEntry).scope?.repo || "", { memoryId: id });
			});
			res.json(jsonApiRes({ message: "Deleted" }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async bulkCreate(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { items, repo } = getAttributes(req);
			if (!Array.isArray(items) || !repo)
				return res.status(400).json(jsonApiError("Invalid payload: requires 'items' array and 'repo'", 400));

			const entries = items.map((item: Record<string, unknown>) => ({
				...item,
				id: (item.id as string) || randomUUID(),
				scope: { ...(item.scope as Record<string, unknown>), repo },
				created_at: (item.created_at as string) || new Date().toISOString(),
				updated_at: (item.updated_at as string) || new Date().toISOString()
			}));

			const count = await db.withWrite(() => {
				const insertedCount = db.memories.bulkInsertMemories(entries as MemoryEntry[]);
				db.actions.logAction("write", repo, { query: `Bulk imported ${insertedCount} memories` });
				return insertedCount;
			});
			res.json(jsonApiRes({ count }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async bulkAction(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { action, ids, updates } = getAttributes(req);
			if (!Array.isArray(ids) || !action)
				return res.status(400).json(jsonApiError("Invalid payload: requires 'ids' array and 'action'", 400));

			const count = await db.withWrite(() => {
				let n: number;
				if (action === "delete") {
					n = db.memories.bulkDeleteMemories(ids);
				} else if (action === "update" || action === "archive") {
					n = db.memories.bulkUpdateMemories(ids, updates || { status: action === "archive" ? "archived" : "active" });
				} else {
					throw new Error("Invalid action");
				}

				if (ids.length > 0) {
					const mem = db.memories.getById(ids[0]);
					db.actions.logAction(action, mem?.scope?.repo || "unknown", {
						query: `Bulk ${action} applied to ${n} memories`
					});
				}
				return n;
			});

			res.json(jsonApiRes({ count }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}
}

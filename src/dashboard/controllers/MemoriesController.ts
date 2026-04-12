import express from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/context.js";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi.js";

export class MemoriesController {
	static list(req: express.Request, res: express.Response) {
		try {
			const { repo, type, search, minImportance, maxImportance, sortBy, sortOrder } = req.query;
			const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
			const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "25", 10)));

			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			const result = db.memories.listMemoriesForDashboard({
				repo: repo as string,
				type: type as string,
				search: search as string,
				minImportance: minImportance ? parseInt(minImportance as string) : undefined,
				maxImportance: maxImportance ? parseInt(maxImportance as string) : undefined,
				sortBy: sortBy as string,
				sortOrder: sortOrder === "asc" ? "asc" : "desc",
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
		} catch (err: any) {
			res.status(500).json(jsonApiError(err.message));
		}
	}

	static get(req: express.Request, res: express.Response) {
		try {
			const memory = db.memories.getByIdWithStats(req.params.id as string);
			if (!memory) throw new Error("Memory not found");
			db.actions.logAction("read", memory.scope.repo, { memoryId: memory.id, resultCount: 1 });
			res.json(jsonApiRes(memory, "memory"));
		} catch (err: any) {
			res.status(404).json(jsonApiError(err.message, 404));
		}
	}

	static create(req: express.Request, res: express.Response) {
		try {
			const attributes = getAttributes(req);
			const { repo, type, content } = attributes;
			if (!repo || !type || !content) return res.status(400).json(jsonApiError("Required fields missing", 400));
			const id = randomUUID();
			db.memories.insert({
				...attributes,
				id,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				scope: { repo }
			});
			db.actions.logAction("write", repo, { memoryId: id });
			res.json(jsonApiRes({ id }, "memory"));
		} catch (err: any) {
			res.status(500).json(jsonApiError(err.message));
		}
	}

	static update(req: express.Request, res: express.Response) {
		try {
			const { id } = req.params as { id: string };
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
			db.memories.update(id, updates);
			db.actions.logAction("update", (existing as any).scope?.repo || attributes.repo || "", { memoryId: id });
			res.json(jsonApiRes({ message: "Updated" }, "status"));
		} catch (err: any) {
			res.status(500).json(jsonApiError(err.message));
		}
	}

	static delete(req: express.Request, res: express.Response) {
		try {
			const { id } = req.params as { id: string };
			const existing = db.memories.getByIdWithStats ? db.memories.getByIdWithStats(id) : db.memories.getById(id);
			if (!existing) return res.status(404).json(jsonApiError("Memory not found", 404));
			db.memories.delete(id);
			db.actions.logAction("delete", (existing as any).scope?.repo || "", { memoryId: id });
			res.json(jsonApiRes({ message: "Deleted" }, "status"));
		} catch (err: any) {
			res.status(500).json(jsonApiError(err.message));
		}
	}

	static bulkCreate(req: express.Request, res: express.Response) {
		try {
			const { items, repo } = getAttributes(req);
			if (!Array.isArray(items) || !repo)
				return res.status(400).json(jsonApiError("Invalid payload: requires 'items' array and 'repo'", 400));

			const entries = items.map((item: any) => ({
				...item,
				id: item.id || randomUUID(),
				scope: { ...item.scope, repo },
				created_at: item.created_at || new Date().toISOString(),
				updated_at: item.updated_at || new Date().toISOString()
			}));

			const count = db.memories.bulkInsertMemories(entries);
			db.system.logAction("write", repo, { query: `Bulk imported ${count} memories` });
			res.json(jsonApiRes({ count }, "status"));
		} catch (err: any) {
			res.status(500).json(jsonApiError(err.message));
		}
	}

	static bulkAction(req: express.Request, res: express.Response) {
		try {
			const { action, ids, updates } = getAttributes(req);
			if (!Array.isArray(ids) || !action)
				return res.status(400).json(jsonApiError("Invalid payload: requires 'ids' array and 'action'", 400));

			let count = 0;
			if (action === "delete") {
				count = db.memories.bulkDeleteMemories(ids);
			} else if (action === "update" || action === "archive") {
				count = db.memories.bulkUpdateMemories(ids, updates || { status: action === "archive" ? "archived" : "active" });
			} else {
				return res.status(400).json(jsonApiError("Invalid action", 400));
			}

			if (ids.length > 0) {
				const mem = db.memories.getById(ids[0]);
				db.actions.logAction(action, mem?.scope?.repo || "unknown", { query: `Bulk ${action} applied to ${count} memories` });
			}

			res.json(jsonApiRes({ count }, "status"));
		} catch (err: any) {
			res.status(500).json(jsonApiError(err.message));
		}
	}
}

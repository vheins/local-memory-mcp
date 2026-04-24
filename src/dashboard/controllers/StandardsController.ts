import express from "express";
import { randomUUID } from "crypto";
import { db, vectors } from "../lib/context";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi";
import type { CodingStandardEntry } from "../../mcp/types";
import { buildStandardVectorText } from "../../mcp/tools/standard.shared";

export class StandardsController {
	static async list(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { repo, query, language, stack, tags, is_global } = req.query;
			const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
			const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "100", 10)));
			const stackList = typeof stack === "string" ? stack.split(",").map((item) => item.trim()).filter(Boolean) : [];
			const tagList = typeof tags === "string" ? tags.split(",").map((item) => item.trim()).filter(Boolean) : [];

			const items = db.standards.search({
				query: query as string | undefined,
				language: language as string | undefined,
				stack: stackList[0],
				tag: tagList[0],
				repo: repo as string | undefined,
				is_global: is_global === undefined ? undefined : String(is_global) === "true",
				limit: pageSize,
				offset: (page - 1) * pageSize
			});

			const total = db.standards.search({
				query: query as string | undefined,
				language: language as string | undefined,
				stack: stackList[0],
				tag: tagList[0],
				repo: repo as string | undefined,
				is_global: is_global === undefined ? undefined : String(is_global) === "true",
				limit: 100000,
				offset: 0
			}).length;

			res.json(
				jsonApiRes(items, "standard", {
					meta: {
						page,
						pageSize,
						totalItems: total,
						totalPages: Math.ceil(total / pageSize)
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
			const standard = db.standards.getById(req.params.id as string);
			if (!standard) throw new Error("Coding standard not found");
			db.standards.incrementHitCounts([standard.id]);
			db.actions.logAction("read", standard.repo || "global", { query: standard.title, resultCount: 1 });
			res.json(jsonApiRes(standard, "standard"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Coding standard not found";
			res.status(404).json(jsonApiError(message, 404));
		}
	}

	static async create(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const attributes = getAttributes(req);
			const { title, content, tags, metadata } = attributes;
			if (!title || !content || !Array.isArray(tags) || tags.length === 0 || !metadata) {
				return res.status(400).json(jsonApiError("Required fields missing", 400));
			}

			const now = new Date().toISOString();
			const entry: CodingStandardEntry = {
				id: randomUUID(),
				title: String(title),
				content: String(content),
				parent_id: (attributes.parent_id as string) || null,
				context: String(attributes.context || "general"),
				version: String(attributes.version || "1.0.0"),
				language: (attributes.language as string) || null,
				stack: Array.isArray(attributes.stack) ? (attributes.stack as string[]) : [],
				is_global: attributes.is_global !== false,
				repo: (attributes.repo as string) || null,
				tags: tags as string[],
				metadata: metadata as Record<string, unknown>,
				created_at: now,
				updated_at: now,
				hit_count: 0,
				last_used_at: null,
				agent: String(attributes.agent || "dashboard"),
				model: String(attributes.model || "web-ui")
			};

			await db.withWrite(async () => {
				db.standards.insert(entry);
				await vectors.upsert(entry.id, buildStandardVectorText(entry), "standard");
				db.actions.logAction("write", entry.repo || "global", { query: entry.title, resultCount: 1 });
			});

			res.json(jsonApiRes(entry, "standard"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async update(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const existing = db.standards.getById(req.params.id as string);
			if (!existing) return res.status(404).json(jsonApiError("Coding standard not found", 404));

			const attributes = getAttributes(req);
			const updates: Partial<CodingStandardEntry> = {};
			if (attributes.title !== undefined) updates.title = attributes.title as string;
			if (attributes.content !== undefined) updates.content = attributes.content as string;
			if (attributes.parent_id !== undefined) updates.parent_id = attributes.parent_id === null ? null : (attributes.parent_id as string);
			if (attributes.context !== undefined) updates.context = attributes.context as string;
			if (attributes.version !== undefined) updates.version = attributes.version as string;
			if (attributes.language !== undefined) updates.language = (attributes.language as string) || null;
			if (Array.isArray(attributes.stack)) updates.stack = attributes.stack as string[];
			if (typeof attributes.is_global === "boolean") updates.is_global = attributes.is_global as boolean;
			if (attributes.repo !== undefined) updates.repo = attributes.repo as string;
			if (Array.isArray(attributes.tags)) updates.tags = attributes.tags as string[];
			if (attributes.metadata !== undefined) updates.metadata = attributes.metadata as Record<string, unknown>;
			if (attributes.agent !== undefined) updates.agent = attributes.agent as string;
			if (attributes.model !== undefined) updates.model = attributes.model as string;

			await db.withWrite(async () => {
				db.standards.update(existing.id, updates);
				const merged: CodingStandardEntry = {
					...existing,
					...updates,
					updated_at: new Date().toISOString()
				};
				await vectors.upsert(existing.id, buildStandardVectorText(merged), "standard");
				db.actions.logAction("update", existing.repo || "global", { query: existing.title, resultCount: 1 });
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
			const existing = db.standards.getById(req.params.id as string);
			if (!existing) return res.status(404).json(jsonApiError("Coding standard not found", 404));

			await db.withWrite(async () => {
				db.standards.delete(existing.id);
				await vectors.remove(existing.id, "standard");
				db.actions.logAction("delete", existing.repo || "global", { query: existing.title, resultCount: 1 });
			});

			res.json(jsonApiRes({ message: "Deleted" }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}
}

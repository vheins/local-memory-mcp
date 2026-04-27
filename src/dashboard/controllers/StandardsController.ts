import express from "express";
import { randomUUID } from "crypto";
import { db, vectors } from "../lib/context";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi";
import type { CodingStandardEntry } from "../../mcp/types";
import { buildStandardVectorText } from "../../mcp/tools/standard.shared";

const STANDARDS_EXPORT_SCHEMA = "local-memory-mcp.standards.v1";

type StandardsExportPayload = {
	schema: typeof STANDARDS_EXPORT_SCHEMA;
	exported_at: string;
	repo: string | null;
	scope: "repo" | "global" | "all";
	standards: CodingStandardEntry[];
};

function normalizeStandardForImport(value: unknown): CodingStandardEntry | null {
	if (!value || typeof value !== "object") return null;
	const item = value as Partial<CodingStandardEntry>;
	if (!item.title || !item.content) return null;
	const now = new Date().toISOString();
	return {
		id: typeof item.id === "string" && item.id ? item.id : randomUUID(),
		code: typeof item.code === "string" && item.code ? item.code : undefined,
		title: String(item.title),
		content: String(item.content),
		parent_id: typeof item.parent_id === "string" && item.parent_id ? item.parent_id : null,
		context: String(item.context || "general"),
		version: String(item.version || "1.0.0"),
		language: typeof item.language === "string" && item.language ? item.language : null,
		stack: Array.isArray(item.stack) ? item.stack.map(String).filter(Boolean) : [],
		is_global: item.is_global !== false,
		repo: typeof item.repo === "string" && item.repo ? item.repo : null,
		tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
		metadata:
			item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
				? (item.metadata as Record<string, unknown>)
				: { source: "standards-import" },
		created_at: typeof item.created_at === "string" && item.created_at ? item.created_at : now,
		updated_at: typeof item.updated_at === "string" && item.updated_at ? item.updated_at : now,
		hit_count: typeof item.hit_count === "number" ? item.hit_count : 0,
		last_used_at: typeof item.last_used_at === "string" ? item.last_used_at : null,
		agent: String(item.agent || "dashboard-import"),
		model: String(item.model || "web-ui")
	};
}

function standardsFromImportPayload(body: unknown): unknown[] {
	if (Array.isArray(body)) return body;
	if (!body || typeof body !== "object") return [];
	const payload = body as { standards?: unknown; data?: { attributes?: { standards?: unknown } } };
	if (Array.isArray(payload.standards)) return payload.standards;
	if (Array.isArray(payload.data?.attributes?.standards)) return payload.data.attributes.standards;
	return [];
}

function shouldRefreshVectors(body: unknown, count: number): boolean {
	if (body && typeof body === "object" && "refresh_vectors" in body) {
		return (body as { refresh_vectors?: unknown }).refresh_vectors === true;
	}
	return count <= 500;
}

export class StandardsController {
	static async list(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { repo, query, language, stack, tags, is_global } = req.query;
			const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
			const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "100", 10)));
			const stackList =
				typeof stack === "string"
					? stack
							.split(",")
							.map((item) => item.trim())
							.filter(Boolean)
					: [];
			const tagList =
				typeof tags === "string"
					? tags
							.split(",")
							.map((item) => item.trim())
							.filter(Boolean)
					: [];

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

	static async export(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { repo, scope = "repo" } = req.query;
			const scopeValue = scope === "global" || scope === "all" ? scope : "repo";
			const items = db.standards.search({
				repo: scopeValue === "repo" ? (repo as string | undefined) : undefined,
				is_global: scopeValue === "global" ? true : undefined,
				limit: 100000,
				offset: 0
			});

			const payload: StandardsExportPayload = {
				schema: STANDARDS_EXPORT_SCHEMA,
				exported_at: new Date().toISOString(),
				repo: typeof repo === "string" && repo ? repo : null,
				scope: scopeValue,
				standards: items
			};

			res.json(jsonApiRes(payload, "standard-export"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async import(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const rawStandards = standardsFromImportPayload(req.body);
			if (rawStandards.length === 0) {
				return res.status(400).json(jsonApiError("No standards found in import payload", 400));
			}

			const standards = rawStandards.map(normalizeStandardForImport).filter((item): item is CodingStandardEntry => !!item);
			if (standards.length === 0) {
				return res.status(400).json(jsonApiError("Import payload does not contain valid standards", 400));
			}
			const refreshVectors = shouldRefreshVectors(req.body, standards.length);

			const imported: string[] = [];
			const updated: string[] = [];
			let vectorFailures = 0;

			await db.withWrite(async () => {
				for (const standard of standards) {
					const existing = db.standards.getById(standard.id) || (standard.code ? db.standards.getByCode(standard.code) : null);
					if (existing) {
						db.standards.update(existing.id, {
							code: standard.code,
							title: standard.title,
							content: standard.content,
							parent_id: standard.parent_id,
							context: standard.context,
							version: standard.version,
							language: standard.language,
							stack: standard.stack,
							is_global: standard.is_global,
							repo: standard.repo,
							tags: standard.tags,
							metadata: standard.metadata,
							hit_count: standard.hit_count,
							last_used_at: standard.last_used_at,
							agent: standard.agent,
							model: standard.model
						});
						if (refreshVectors) {
							const refreshed = db.standards.getById(existing.id) || { ...standard, id: existing.id };
							try {
								await vectors.upsert(existing.id, buildStandardVectorText(refreshed), "standard");
							} catch {
								vectorFailures += 1;
							}
						}
						updated.push(existing.id);
					} else {
						db.standards.insert(standard);
						if (refreshVectors) {
							try {
								await vectors.upsert(standard.id, buildStandardVectorText(standard), "standard");
							} catch {
								vectorFailures += 1;
							}
						}
						imported.push(standard.id);
					}
				}
				db.actions.logAction("write", "standards-import", {
					query: "standards-import",
					resultCount: imported.length + updated.length
				});
			});

			res.json(
				jsonApiRes(
					{
						imported: imported.length,
						updated: updated.length,
						total: imported.length + updated.length,
						vectors_refreshed: refreshVectors,
						vector_failures: vectorFailures,
						ids: [...imported, ...updated]
					},
					"standard-import"
				)
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
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
			if (attributes.parent_id !== undefined)
				updates.parent_id = attributes.parent_id === null ? null : (attributes.parent_id as string);
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

import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { StandardDeleteSchema } from "./schemas";

export async function handleStandardDelete(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardDeleteSchema.parse(params);
	const { id, ids, code, codes, owner, repo, structured } = validated;

	// Resolve code(s) to id(s)
	const resolvedIds: string[] = [];
	if (ids) resolvedIds.push(...ids);
	if (id) resolvedIds.push(id);
	if (code) {
		const entry = db.standards.getByCode(code, owner, repo);
		if (!entry) throw new Error(`Coding standard not found: ${code}`);
		resolvedIds.push(entry.id);
	}
	if (codes) {
		for (const c of codes) {
			const entry = db.standards.getByCode(c, owner, repo);
			if (!entry) throw new Error(`Coding standard not found: ${c}`);
			resolvedIds.push(entry.id);
		}
	}

	if (resolvedIds.length === 0) {
		throw new Error("Either 'id', 'ids', 'code', or 'codes' must be provided for deletion");
	}

	const targetIds = resolvedIds;

	let deletedCount = 0;
	const deletedTitles: string[] = [];
	let lastRepo = repo || "unknown";

	for (const targetId of targetIds) {
		const existing = db.standards.getById(targetId);
		if (existing) {
			lastRepo = existing.repo || (existing.is_global ? "global" : lastRepo);
			deletedTitles.push(existing.title);
			db.standards.delete(targetId);
			await vectors.remove(targetId, "standard");
			deletedCount++;
		} else if (id) {
			throw new Error(`Coding standard not found: ${targetId}`);
		}
	}

	logger.info("[Tool] standard.delete", { repo: lastRepo, count: deletedCount });

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			ids: ids || undefined,
			repo: lastRepo,
			deletedCount,
			deletedTitles: deletedTitles.length > 10 ? [...deletedTitles.slice(0, 10), "..."] : deletedTitles
		},
		`Deleted ${deletedCount} coding standard(s) from "${lastRepo}".`,
		{
			structuredContentPathHint: "deletedCount",
			includeSerializedStructuredContent: structured
		}
	);
}

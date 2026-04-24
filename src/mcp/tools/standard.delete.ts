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
	const { id, ids, repo, structured } = validated;
	const targetIds = ids || (id ? [id] : []);

	if (targetIds.length === 0) {
		throw new Error("Either 'id' or 'ids' must be provided for deletion");
	}

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

import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { MemoryDeleteSchema } from "./schemas";

export async function handleMemoryDelete(
	params: Record<string, unknown>, 
	db: SQLiteStore, 
	vectors: VectorStore,
	onProgress?: (progress: number, total?: number) => void
): Promise<McpResponse> {
	// Validate input
	const validated = MemoryDeleteSchema.parse(params);
	const { id, ids, repo, structured } = validated;
    const targetIds = ids || (id ? [id] : []);

    if (targetIds.length === 0) {
        throw new Error("Either 'id' or 'ids' must be provided for deletion");
    }

    let deletedCount = 0;
    const deletedCodes: string[] = [];
    let lastRepo = repo || "unknown";

    const total = targetIds.length;
    let progress = 0;

    for (const targetId of targetIds) {
        if (onProgress) {
            onProgress(progress, total);
        }

        const existing = db.memories.getById(targetId);
        if (existing) {
            lastRepo = existing.scope.repo;
            deletedCodes.push(existing.code || existing.id);
            db.memories.delete(targetId);
            await vectors.remove(targetId);
            deletedCount++;
        } else if (id) {
            throw new Error(`Memory not found: ${targetId}`);
        }
        progress++;
    }

    if (onProgress) {
        onProgress(progress, total);
    }

	logger.info("[Tool] memory.delete", { repo: lastRepo, count: deletedCount });

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
            ids: ids || undefined,
			repo: lastRepo,
            deletedCount,
            deletedCodes: deletedCount > 10 ? [...deletedCodes.slice(0, 10), "..."] : deletedCodes
		},
		`Deleted ${deletedCount} memory entry(ies) from repo "${lastRepo}".`,
		{
			structuredContentPathHint: "deletedCount",
			includeSerializedStructuredContent: structured
		}
	);
}

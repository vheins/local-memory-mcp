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
	const { id, ids, repo } = MemoryDeleteSchema.parse(params);
    const targetIds = ids || (id ? [id] : []);

    if (targetIds.length === 0) {
        throw new Error("Either 'id' or 'ids' must be provided for deletion");
    }

    let deletedCount = 0;
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

	logger.info("[MCP] memory.delete", { repo: lastRepo, count: deletedCount });

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
            ids: ids || undefined,
			repo: lastRepo,
            deletedCount
		},
		`Deleted ${deletedCount} memory entry(ies) from repo "${lastRepo}".`,
		{
			structuredContentPathHint: "deletedCount",
			includeSerializedStructuredContent: (params as any).structured || false,
			resourceLinks: [
				{
					uri: `repository://${encodeURIComponent(lastRepo)}/memories`,
					name: `Memory Index (${lastRepo})`,
					description: "Repository memory index after deletion",
					mimeType: "application/json",
					annotations: {
						audience: ["assistant"],
						priority: 0.5
					}
				}
			]
		}
	);
}

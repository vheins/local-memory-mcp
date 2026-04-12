import { z } from "zod";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";

export const MemoryDeleteSchema = z.object({
	id: z.string().uuid()
});

export async function handleMemoryDelete(params: Record<string, unknown>, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	// Validate input
	const validated = MemoryDeleteSchema.parse(params);

	// Check if memory exists
	const existing = db.memories.getById(validated.id);
	if (!existing) {
		throw new Error(`Memory not found: ${validated.id}`);
	}

	// Delete from SQLite
	db.memories.delete(validated.id);

	// Delete from vector store
	await vectors.remove(validated.id);

	logger.info("[MCP] memory.delete", { repo: existing.scope.repo, id: validated.id, title: existing.title });

	return createMcpResponse(
		{
			success: true,
			id: validated.id,
			repo: existing.scope.repo
		},
		`Deleted memory ${validated.id} from repo "${existing.scope.repo}".`,
		{
			structuredContentPathHint: "id",
			resourceLinks: [
				{
					uri: `repository://${encodeURIComponent(existing.scope.repo)}/memories`,
					name: `Memory Index (${existing.scope.repo})`,
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

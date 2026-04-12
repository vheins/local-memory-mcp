import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { MemoryDetailSchema } from "./schemas";

export async function handleMemoryDetail(args: Record<string, unknown>, storage: SQLiteStore) {
	const { id } = MemoryDetailSchema.parse(args);
	const memory = storage.memories.getById(id);

	if (!memory) {
		throw new Error(`Memory not found: ${id}`);
	}

	// Increment hit count when explicitly fetched
	storage.memories.incrementHitCount(id);

	const summary = `Memory [${memory.type}] ${memory.title}: ${memory.content.substring(0, 100)}${memory.content.length > 100 ? "..." : ""}`;

	return createMcpResponse(memory, summary, {
		contentSummary: summary,
		includeSerializedStructuredContent: true,
		resourceLinks: [
			{
				uri: `memory://${id}`,
				name: `Memory: ${memory.title}`,
				mimeType: "application/json"
			}
		]
	});
}

import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { MemoryDetailSchema } from "./schemas";

export async function handleMemoryDetail(args: Record<string, unknown>, storage: SQLiteStore) {
	const { id, code } = MemoryDetailSchema.parse(args);

	let memory;
	if (id) {
		memory = storage.memories.getById(id);
	} else if (code) {
		memory = storage.memories.getByCode(code);
	}

	if (!memory) {
		throw new Error(`Memory not found: ${id || code}`);
	}

	storage.memories.incrementHitCount(memory.id);

	const lines: string[] = [
		`Code: ${memory.code || "-"}`,
		`ID: ${memory.id}`,
		`Title: ${memory.title}`,
		`Type: ${memory.type}`,
		`Importance: ${memory.importance}`,
		`Created: ${memory.created_at}`
	];

	if (memory.scope?.repo) lines.push(`Repo: ${memory.scope.repo}`);
	if (memory.scope?.folder) lines.push(`Folder: ${memory.scope.folder}`);
	if (memory.content) {
		lines.push("", "--- Content ---", memory.content);
	}

	const content = lines.join("\n");

	return createMcpResponse(memory, content, {
		contentSummary: content,
		includeSerializedStructuredContent: false
	});
}

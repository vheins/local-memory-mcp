import { MemoryAcknowledgeSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";
import { UUID_REGEX } from "../utils/uuid";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";

export async function handleMemoryAcknowledge(params: unknown, db: SQLiteStore): Promise<McpResponse> {
	// Validate input
	const validated = MemoryAcknowledgeSchema.parse(params);

	// Resolve code to id
	let memoryId = validated.memory_id;
	if (memoryId && !UUID_REGEX.test(memoryId)) {
		const byCode = db.memories.getByCode(memoryId, validated.owner, validated.repo);
		if (!byCode) throw new Error(`Memory not found: ${memoryId}`);
		memoryId = byCode.id;
	}
	if (!memoryId && validated.code) {
		const byCode = db.memories.getByCode(validated.code, validated.owner, validated.repo);
		if (!byCode) throw new Error(`Memory not found: ${validated.code}`);
		memoryId = byCode.id;
	} else if (!memoryId) {
		throw new Error("Either memory_id or code must be provided");
	}

	// Check if memory exists
	const memory = db.memories.getById(memoryId);
	if (!memory) {
		throw new Error(`Memory with ID ${memoryId} not found.`);
	}

	// Update statistics based on status
	if (validated.status === "used") {
		db.memories.incrementRecallCount(memory.id);
		logger.info("[Tool] memory.acknowledge - used", { id: memory.id, context: validated.application_context });
	} else if (validated.status === "contradictory") {
		// Flag for potential manual audit later
		logger.warn("[Tool] memory.acknowledge - contradiction reported", {
			id: memory.id,
			context: validated.application_context
		});
	} else {
		logger.info("[Tool] memory.acknowledge - irrelevant", { id: memory.id, context: validated.application_context });
	}

	return createMcpResponse(
		{
			success: true,
			id: memory.id,
			status: validated.status
		},
		`Acknowledged memory [${memory.code}] as "${validated.status}".`,
		{
			structuredContentPathHint: "status",
			includeSerializedStructuredContent: validated.structured
		}
	);
}

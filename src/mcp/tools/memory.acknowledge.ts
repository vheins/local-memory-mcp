import { MemoryAcknowledgeSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { logger } from "../utils/logger.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";

export async function handleMemoryAcknowledge(
  params: any,
  db: SQLiteStore
): Promise<McpResponse> {
  // Validate input
  const validated = MemoryAcknowledgeSchema.parse(params);

  // Check if memory exists
  const memory = db.memories.getById(validated.memory_id);
  if (!memory) {
    throw new Error(`Memory with ID ${validated.memory_id} not found.`);
  }

  // Update statistics based on status
  if (validated.status === "used") {
    db.memories.incrementRecallCount(memory.id);
    logger.info("[MCP] memory.acknowledge - used", { id: memory.id, context: validated.application_context });
  } else if (validated.status === "contradictory") {
    // Flag for potential manual audit later
    logger.warn("[MCP] memory.acknowledge - contradiction reported", { id: memory.id, context: validated.application_context });
  } else {
    logger.info("[MCP] memory.acknowledge - irrelevant", { id: memory.id, context: validated.application_context });
  }

  return createMcpResponse(
    { 
      success: true, 
      id: memory.id, 
      status: validated.status 
    },
    `Acknowledged memory ${memory.id} as "${validated.status}".`,
    {
      structuredContentPathHint: "status",
    }
  );
}

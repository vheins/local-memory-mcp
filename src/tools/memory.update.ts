import { MemoryUpdateSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore } from "../types.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";
import { logger } from "../utils/logger.js";

export async function handleMemoryUpdate(
  params: any,
  db: SQLiteStore,
  vectors: VectorStore
): Promise<McpResponse> {
  // Validate input
  const validated = MemoryUpdateSchema.parse(params);

  // Check if memory exists
  const existing = db.getById(validated.id);
  if (!existing) {
    throw new Error(`Memory not found: ${validated.id}`);
  }

  // Update in SQLite
  const updates: { title?: string; content?: string; importance?: number } = {};
  if (validated.title !== undefined) {
    updates.title = validated.title;
  }
  if (validated.content !== undefined) {
    updates.content = validated.content;
  }
  if (validated.importance !== undefined) {
    updates.importance = validated.importance;
  }

  db.update(validated.id, updates);

  // Update vector if content changed
  if (validated.content !== undefined) {
    await vectors.upsert(validated.id, validated.content);
  }

  // Log the update action
  db.logAction('update', existing.scope.repo, { memoryId: validated.id, resultCount: 1 });
  logger.info("[MCP] memory.update", { repo: existing.scope.repo, id: validated.id, fields: Object.keys(updates) });

  return createMcpResponse(
    { success: true },
    `Updated memory ${validated.id.slice(0, 8)}...`
  );
}

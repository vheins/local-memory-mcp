import { z } from "zod";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore } from "../types.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";

export const MemoryDeleteSchema = z.object({
  id: z.string().uuid()
});

export async function handleMemoryDelete(
  params: any,
  db: SQLiteStore,
  vectors: VectorStore
): Promise<McpResponse> {
  // Validate input
  const validated = MemoryDeleteSchema.parse(params);

  // Check if memory exists
  const existing = db.getById(validated.id);
  if (!existing) {
    throw new Error(`Memory not found: ${validated.id}`);
  }

  // Delete from SQLite
  db.delete(validated.id);

  // Delete from vector store
  await vectors.remove(validated.id);

  // Log the delete action
  db.logAction('delete', existing.scope.repo, { memoryId: validated.id, resultCount: 1 });

  return createMcpResponse(
    { success: true },
    `Deleted memory ${validated.id.slice(0, 8)}...`
  );
}

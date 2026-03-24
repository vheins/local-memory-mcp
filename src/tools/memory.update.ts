import { MemoryUpdateSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore } from "../types.js";

export async function handleMemoryUpdate(
  params: any,
  db: SQLiteStore,
  vectors: VectorStore
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input
  const validated = MemoryUpdateSchema.parse(params);

  // Check if memory exists
  const existing = db.getById(validated.id);
  if (!existing) {
    throw new Error(`Memory not found: ${validated.id}`);
  }

  // Update in SQLite
  const updates: { content?: string; importance?: number } = {};
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

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: true })
      }
    ]
  };
}

import { MemoryUpdateSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { StubVectorStore } from "../storage/vectors.stub.js";

export async function handleMemoryUpdate(
  params: any,
  db: SQLiteStore,
  vectors: StubVectorStore
): Promise<{ success: boolean }> {
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

  return { success: true };
}

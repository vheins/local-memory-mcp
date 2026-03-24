import { z } from "zod";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore } from "../types.js";

export const MemoryDeleteSchema = z.object({
  id: z.string().uuid()
});

export async function handleMemoryDelete(
  params: any,
  db: SQLiteStore,
  vectors: VectorStore
): Promise<{ content: Array<{ type: string; text: string }> }> {
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

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: true })
      }
    ]
  };
}

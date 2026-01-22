import { randomUUID } from "crypto";
import { MemoryStoreSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { StubVectorStore } from "../storage/vectors.stub.js";
import { MemoryEntry } from "../types.js";

export async function handleMemoryStore(
  params: any,
  db: SQLiteStore,
  vectors: StubVectorStore
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input
  const validated = MemoryStoreSchema.parse(params);

  // Create memory entry
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: randomUUID(),
    type: validated.type,
    content: validated.content,
    importance: validated.importance,
    scope: validated.scope,
    created_at: now,
    updated_at: now
  };

  // Store in SQLite
  db.insert(entry);

  // Automatically generate and store vector embedding
  try {
    await vectors.upsert(entry.id, entry.content);
  } catch (error) {
    console.error("Warning: Failed to generate vector embedding:", error);
    // Continue anyway - vectors are optional for search fallback
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: true, id: entry.id })
      }
    ]
  };
}

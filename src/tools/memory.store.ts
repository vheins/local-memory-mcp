import { randomUUID } from "crypto";
import { MemoryStoreSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { StubVectorStore } from "../storage/vectors.stub.js";
import { MemoryEntry } from "../types.js";

export async function handleMemoryStore(
  params: any,
  db: SQLiteStore,
  vectors: StubVectorStore
): Promise<{ success: boolean; id: string }> {
  // Validate input
  const validated = MemoryStoreSchema.parse(params);

  // Enforce repo scope requirement
  if (!validated.scope.repo) {
    throw new Error("Memory must be scoped to a repo");
  }

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

  // Store in vector index (stub for now)
  await vectors.upsert(entry.id, entry.content);

  return {
    success: true,
    id: entry.id
  };
}

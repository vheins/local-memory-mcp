import { randomUUID } from "crypto";
import { MemoryStoreSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore, MemoryEntry } from "../types.js";
import { logger } from "../utils/logger.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";

export async function handleMemoryStore(
  params: any,
  db: SQLiteStore,
  vectors: VectorStore
): Promise<McpResponse> {
  // Validate input
  const validated = MemoryStoreSchema.parse(params);

  // Create memory entry
  const now = new Date().toISOString();

  // Compute expires_at if ttlDays is provided
  const expires_at = validated.ttlDays != null
    ? new Date(Date.now() + validated.ttlDays * 86400000).toISOString()
    : null;

  const entry: MemoryEntry = {
    id: randomUUID(),
    type: validated.type,
    title: validated.title,
    content: validated.content,
    importance: validated.importance,
    scope: validated.scope,
    created_at: now,
    updated_at: now,
    hit_count: 0,
    recall_count: 0,
    last_used_at: null,
    expires_at,
  };

  // Store in SQLite
  db.insert(entry);

  // Automatically generate and store vector embedding
  try {
    await vectors.upsert(entry.id, entry.content);
  } catch (error) {
    logger.warn("Failed to generate vector embedding", { error: String(error) });
    // Continue anyway - vectors are optional for search fallback
  }

  // Log the write action
  db.logAction('write', validated.scope.repo, { memoryId: entry.id, resultCount: 1 });
  logger.info("[MCP] memory.store", { repo: validated.scope.repo, id: entry.id, title: entry.title, type: entry.type, importance: entry.importance });

  return createMcpResponse(
    { success: true, id: entry.id },
    `Stored memory ${entry.id.slice(0, 8)}...`
  );
}

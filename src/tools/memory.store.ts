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

  // Check for semantic conflicts before storing (threshold: 0.55)
  if (!validated.supersedes) {
    const conflict = await db.checkConflicts(validated.content, validated.scope.repo, validated.type, vectors, 0.55);
    
    if (conflict) {
      return createMcpResponse(
        { 
          success: false, 
          error: "MEMORY_CONFLICT", 
          message: `This memory content overlaps significantly (>85%) with an existing memory (ID: ${conflict.id}).`,
          conflicting_memory: {
            id: conflict.id,
            title: conflict.title,
            content: conflict.content
          },
          instruction: "You must use 'memory-update' on the existing ID, or provide 'supersedes' if this new memory replaces it."
        },
        `Rejected due to conflict with ${conflict.id}`
      );
    }
  }

  // If this memory supersedes an old one, archive the old one
  if (validated.supersedes) {
    const oldMemory = db.getById(validated.supersedes);
    if (oldMemory) {
      db.update(oldMemory.id, { status: "archived" });
      logger.info("[MCP] memory.store - archived superseded memory", { oldId: oldMemory.id, newId: validated.supersedes });
    }
  }

  // Auto-tagging based on language scope
  const tags = validated.tags ?? [];
  if (validated.scope.language && !tags.includes(validated.scope.language.toLowerCase())) {
    tags.push(validated.scope.language.toLowerCase());
  }

  const entry: MemoryEntry = {
    id: randomUUID(),
    type: validated.type,
    title: validated.title,
    content: validated.content,
    importance: validated.importance,
    agent: validated.agent,
    model: validated.model,
    scope: validated.scope,
    created_at: now,
    updated_at: now,
    hit_count: 0,
    recall_count: 0,
    last_used_at: null,
    expires_at,
    supersedes: validated.supersedes ?? null,
    status: "active",
    tags,
    is_global: validated.is_global
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

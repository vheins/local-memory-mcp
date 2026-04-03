import { MemoryUpdateSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore } from "../types.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";
import { logger } from "../utils/logger.js";

function hasMetadataLikeTitle(title: string): boolean {
  const normalized = title.trim();
  return /^\[[^\]]{0,200}(agent:|role:|model:|\d{4}-\d{2}-\d{2}|source_)[^\]]*\]/i.test(normalized);
}

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

  if (validated.title !== undefined && hasMetadataLikeTitle(validated.title)) {
    throw new Error("Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields.");
  }

  // Update in SQLite
  const updates: any = {};
  if (validated.type !== undefined) updates.type = validated.type;
  if (validated.title !== undefined) updates.title = validated.title;
  if (validated.content !== undefined) updates.content = validated.content;
  if (validated.importance !== undefined) updates.importance = validated.importance;
  if (validated.agent !== undefined) updates.agent = validated.agent;
  if (validated.role !== undefined) updates.role = validated.role;
  if (validated.status !== undefined) updates.status = validated.status;
  if (validated.supersedes !== undefined) updates.supersedes = validated.supersedes;
  if (validated.tags !== undefined) updates.tags = validated.tags;
  if (validated.metadata !== undefined) updates.metadata = validated.metadata;
  if (validated.is_global !== undefined) updates.is_global = validated.is_global;
  if (validated.completed_at !== undefined) updates.completed_at = validated.completed_at;

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

import { MemoryRecapSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";
import { logger } from "../utils/logger.js";

export async function handleMemoryRecap(
  params: any,
  db: SQLiteStore
): Promise<McpResponse> {
  const validated = MemoryRecapSchema.parse(params);

  logger.info("[MCP] memory.recap", { repo: validated.repo, limit: validated.limit, offset: validated.offset });

  // Fetch aggregate stats (counts by type, total)
  const stats = db.memories.getStats(validated.repo);

  // Total active memories (excluding task_archive)
  const total = db.memories.getTotalCount(validated.repo, false, ["task_archive"]);

  // Fetch top memories ordered by importance DESC, created_at DESC
  const rows = db.memories.getRecentMemories(validated.repo, validated.limit, validated.offset, false, ["task_archive"]);

  // Build pointer table — columns: [id, title, type, importance]
  const COLUMNS = ["id", "title", "type", "importance"] as const;
  const topRows = rows.map(row => [
    row.id,
    row.title ?? "Untitled",
    row.type,
    row.importance,
  ]);

  // Build by_type stats, excluding task_archive
  const byType: Record<string, number> = {};
  for (const [type, count] of Object.entries(stats.byType)) {
    if (type !== "task_archive") {
      byType[type] = count;
    }
  }

  const structuredContent = {
    schema: "memory-recap" as const,
    repo: validated.repo,
    count: rows.length,
    total,
    offset: validated.offset,
    limit: validated.limit,
    stats: {
      by_type: byType,
    },
    top: {
      columns: [...COLUMNS],
      rows: topRows,
    },
  };

  const memoryList = rows.map(row => `"${row.title}" (ID: ${row.id})`).join(", ");
  const contentSummary = total > 0
    ? `Repo "${validated.repo}" has ${total} active memories. Showing ${rows.length} at offset ${validated.offset}: ${memoryList}. Use memory-detail to read full content.`
    : `No memories found for repo "${validated.repo}".`;

  return createMcpResponse(
    structuredContent,
    contentSummary,
    {
      contentSummary,
      includeSerializedStructuredContent: false,
    }
  );
}

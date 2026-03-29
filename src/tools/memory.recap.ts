import { MemoryRecapSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";
import { logger } from "../utils/logger.js";

export async function handleMemoryRecap(
  params: any,
  db: SQLiteStore
): Promise<McpResponse> {
  // Validate input
  const validated = MemoryRecapSchema.parse(params);

  logger.info("[MCP] memory.recap", { repo: validated.repo, limit: validated.limit, offset: validated.offset });

  // Get total count for pagination metadata
  const total = db.getTotalCount(validated.repo);

  // Get recent memories using public API (no type-unsafe cast)
  const rows = db.getRecentMemories(validated.repo, validated.limit, validated.offset);

  if (rows.length === 0) {
    return createMcpResponse(
      {
        repo: validated.repo,
        count: 0,
        total,
        offset: validated.offset,
        memories: [],
        message: `No memories found for repo: ${validated.repo}`
      },
      `No memories for repo "${validated.repo}"`
    );
  }

  // Format memories for recap
  const formattedMemories = rows.map((row, index) => ({
    number: validated.offset + index + 1,
    id: row.id,
    type: row.type,
    importance: row.importance,
    preview: row.content.substring(0, 100) + (row.content.length > 100 ? "..." : ""),
    created_at: row.created_at
  }));

  // Create summary text
  const summary = formattedMemories
    .map(
      (m) =>
        `${m.number}. [${m.type.toUpperCase()}] (importance: ${m.importance}) ${m.preview}`
    )
    .join("\n");

  return createMcpResponse(
    {
      repo: validated.repo,
      count: rows.length,
      total,
      offset: validated.offset,
      memories: formattedMemories,
      summary: `Recent ${rows.length} memories:\n\n${summary}`
    },
    `Retrieved ${rows.length} memories for repo "${validated.repo}"`
  );
}

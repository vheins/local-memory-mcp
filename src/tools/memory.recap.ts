import { z } from "zod";
import { SQLiteStore } from "../storage/sqlite.js";

export const MemoryRecapSchema = z.object({
  repo: z.string().min(1),
  limit: z.number().min(1).max(50).default(20)
});

export async function handleMemoryRecap(
  params: any,
  db: SQLiteStore
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input
  const validated = MemoryRecapSchema.parse(params);

  // Get recent memories from the specified repo
  let query = `
    SELECT id, type, content, importance, created_at, updated_at
    FROM memories
    WHERE repo = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;

  const stmt = (db as any).db.prepare(query);
  const rows = stmt.all(validated.repo, validated.limit) as any[];

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            repo: validated.repo,
            count: 0,
            memories: [],
            message: `No memories found for repo: ${validated.repo}`
          })
        }
      ]
    };
  }

  // Format memories for recap
  const formattedMemories = rows.map((row, index) => ({
    number: index + 1,
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

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          repo: validated.repo,
          count: rows.length,
          memories: formattedMemories,
          summary: `Recent ${rows.length} memories:\n\n${summary}`
        })
      }
    ]
  };
}

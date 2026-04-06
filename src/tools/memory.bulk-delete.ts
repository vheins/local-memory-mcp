import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore } from "../types.js";
import { createMcpResponse } from "../utils/mcp-response.js";
import { MemoryBulkDeleteSchema } from "./schemas.js";

export async function handleMemoryBulkDelete(
  args: any,
  storage: SQLiteStore,
  vectors: VectorStore,
  onProgress?: (progress: number, total?: number) => void
) {
  const { repo, ids } = MemoryBulkDeleteSchema.parse(args);

  const total = ids.length;
  let progress = 0;

  for (const id of ids) {
    if (onProgress) {
      onProgress(progress, total);
    }
    storage.delete(id);
    await vectors.remove(id);
    progress++;
  }
  
  if (onProgress) {
    onProgress(progress, total);
  }

  storage.logAction("delete", repo, { resultCount: ids.length, query: "Bulk Delete" });

  return createMcpResponse(
    {
      success: true,
      repo,
      deletedCount: ids.length,
      ids,
    },
    `Successfully deleted ${ids.length} memories.`,
    {
      resourceLinks: [
        {
          uri: `memory://index?repo=${encodeURIComponent(repo)}`,
          name: `Memory Index (${repo})`,
          description: "Repository memory index after bulk deletion",
          mimeType: "application/json",
          annotations: {
            audience: ["assistant"],
            priority: 0.5,
          },
        },
      ],
    }
  );
}

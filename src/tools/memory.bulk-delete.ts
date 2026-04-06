import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore } from "../types.js";
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

  return { 
    content: [{ 
      type: "text", 
      text: `Successfully deleted ${ids.length} memories.` 
    }],
    isError: false
  };
}

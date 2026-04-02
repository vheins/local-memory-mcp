import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore } from "../types.js";
import { MemoryBulkDeleteSchema } from "./schemas.js";

export async function handleMemoryBulkDelete(
  args: any,
  storage: SQLiteStore,
  vectors: VectorStore
) {
  const { repo, ids } = MemoryBulkDeleteSchema.parse(args);

  for (const id of ids) {
    storage.delete(id);
    await vectors.remove(id);
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

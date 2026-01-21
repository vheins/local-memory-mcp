import { MemorySearchSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { StubVectorStore } from "../storage/vectors.stub.js";
import { MemoryEntry } from "../types.js";
import { normalize } from "../utils/normalize.js";

export async function handleMemorySearch(
  params: any,
  db: SQLiteStore,
  vectors: StubVectorStore
): Promise<{ results: MemoryEntry[] }> {
  // Validate input
  const validated = MemorySearchSchema.parse(params);

  // Try vector search first
  const vectorResults = await vectors.search(validated.query, validated.limit);

  let results: MemoryEntry[];

  if (vectorResults.length > 0) {
    // Use vector results - get full entries from SQLite
    const ids = vectorResults.map((r) => r.id);
    results = ids
      .map((id) => db.getById(id))
      .filter((entry): entry is MemoryEntry => entry !== null && entry.scope.repo === validated.repo);
  } else {
    // Fallback: keyword search in SQLite
    const allResults = db.searchByRepo(validated.repo, {
      types: validated.types,
      minImportance: validated.minImportance,
      limit: validated.limit * 3 // Get more for keyword filtering
    });

    // Simple keyword matching - split query into words
    const normalized = normalize(validated.query);
    const queryWords = normalized.split(/\s+/).filter(w => w.length > 2);
    
    results = allResults.filter((entry) => {
      const normalizedContent = normalize(entry.content);
      // Match if any query word appears in content
      return queryWords.some(word => normalizedContent.includes(word));
    });

    // If no matches, return all results (fallback to importance-based)
    if (results.length === 0) {
      results = allResults;
    }

    // Re-apply limit after filtering
    results = results.slice(0, validated.limit);
  }

  // Rank by importance and recency
  results.sort((a, b) => {
    // Primary sort: importance
    if (a.importance !== b.importance) {
      return b.importance - a.importance;
    }
    // Secondary sort: recency
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return { results };
}

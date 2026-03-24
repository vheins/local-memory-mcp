import { MemorySearchSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore, MemoryEntry } from "../types.js";
import { normalize } from "../utils/normalize.js";
import { handleMemoryRecap } from "./memory.recap.js";
import { logger } from "../utils/logger.js";

// Hybrid search configuration — weights when vector store is active
const HYBRID_WEIGHTS_VECTOR = {
  similarity: 0.6,
  vector: 0.3,
  importance: 0.1
};

// Weights when vector store returns no results (normalized to sum = 1.0)
const HYBRID_WEIGHTS_NO_VECTOR = {
  similarity: 0.85,
  importance: 0.15
};

interface ScoredMemory {
  memory: MemoryEntry;
  similarityScore: number;
  vectorScore: number;
  importanceBoost: number;
  finalScore: number;
}

export async function handleMemorySearch(
  params: any,
  db: SQLiteStore,
  vectors: VectorStore
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input
  const validated = MemorySearchSchema.parse(params);

  // STEP 0: Pre-search recap — only if includeRecap === true
  let recapContext = "";
  if (validated.includeRecap) {
    try {
      const recapResult = await handleMemoryRecap(
        { repo: validated.repo, limit: 20 },
        db
      );

      const recapContent = recapResult.content[0]?.text;
      if (recapContent) {
        const recapData = JSON.parse(recapContent);
        if (recapData.summary) {
          recapContext = recapData.summary;
        }
      }
    } catch (error) {
      logger.error("Failed to get recap context", { error: String(error) });
      // Continue anyway - recap is optional
    }
  }

  // STEP 1: Repo filter (HARD) + Lightweight similarity scoring
  const similarityResults = db.searchBySimilarity(
    validated.query,
    validated.repo,
    validated.limit * 3 // Get more candidates for vector re-ranking
  );

  let candidates: Array<{ memory: MemoryEntry; similarityScore: number }>;

  if (similarityResults.length > 0 && similarityResults[0].similarity > 0.1) {
    // Use similarity results as candidates
    candidates = similarityResults.map((result) => ({
      memory: {
        id: result.id,
        type: result.type,
        content: result.content,
        importance: result.importance,
        scope: result.scope,
        created_at: result.created_at,
        updated_at: result.updated_at,
        hit_count: result.hit_count,
        recall_count: result.recall_count,
        last_used_at: result.last_used_at,
        expires_at: result.expires_at,
      },
      similarityScore: result.similarity
    }));
  } else {
    // Fallback: keyword search as candidates
    const allResults = db.searchByRepo(validated.repo, {
      types: validated.types,
      minImportance: validated.minImportance,
      limit: validated.limit * 3
    });

    const normalized = normalize(validated.query);
    const queryWords = normalized.split(/\s+/).filter(w => w.length > 2);

    const filtered = allResults.filter((entry) => {
      const normalizedContent = normalize(entry.content);
      return queryWords.some(word => normalizedContent.includes(word));
    });

    const memoriesToUse = filtered.length > 0 ? filtered : allResults;

    candidates = memoriesToUse.map(memory => ({
      memory,
      similarityScore: 0.5 // Default similarity for keyword matches
    }));
  }

  // STEP 2: OPTIONAL vector similarity re-rank (only on top candidates)
  let scoredMemories: ScoredMemory[];

  try {
    // Attempt vector search on candidates (if available)
    const vectorResults = await vectors.search(validated.query, candidates.length);

    if (vectorResults.length > 0) {
      // Create a map of memory ID to vector score
      const vectorScoreMap = new Map<string, number>();
      for (const vr of vectorResults) {
        vectorScoreMap.set(vr.id, vr.score);
      }

      // Combine scores using hybrid formula (vector active: 0.6 + 0.3 + 0.1 = 1.0)
      scoredMemories = candidates.map(({ memory, similarityScore }) => {
        const vectorScore = vectorScoreMap.get(memory.id) || 0;
        const importanceBoost = memory.importance / 5;

        const finalScore =
          (similarityScore * HYBRID_WEIGHTS_VECTOR.similarity) +
          (vectorScore * HYBRID_WEIGHTS_VECTOR.vector) +
          (importanceBoost * HYBRID_WEIGHTS_VECTOR.importance);

        return {
          memory,
          similarityScore,
          vectorScore,
          importanceBoost,
          finalScore
        };
      });
    } else {
      // No vector results — use similarity-only ranking (0.85 + 0.15 = 1.0)
      scoredMemories = candidates.map(({ memory, similarityScore }) => {
        const importanceBoost = memory.importance / 5;

        const finalScore =
          (similarityScore * HYBRID_WEIGHTS_NO_VECTOR.similarity) +
          (importanceBoost * HYBRID_WEIGHTS_NO_VECTOR.importance);

        return {
          memory,
          similarityScore,
          vectorScore: 0,
          importanceBoost,
          finalScore
        };
      });
    }
  } catch (error) {
    // Vector search failed — gracefully degrade to similarity-only
    logger.warn("Vector search failed, using similarity-only", { error: String(error) });

    scoredMemories = candidates.map(({ memory, similarityScore }) => {
      const importanceBoost = memory.importance / 5;

      const finalScore =
        (similarityScore * HYBRID_WEIGHTS_NO_VECTOR.similarity) +
        (importanceBoost * HYBRID_WEIGHTS_NO_VECTOR.importance);

      return {
        memory,
        similarityScore,
        vectorScore: 0,
        importanceBoost,
        finalScore
      };
    });
  }

  // STEP 3: Sort by final score and take top results
  scoredMemories.sort((a, b) => b.finalScore - a.finalScore);

  const results = scoredMemories
    .slice(0, validated.limit)
    .map(sm => sm.memory);

  // STEP 4: Increment hit_count for returned memories
  for (const memory of results) {
    db.incrementHitCount(memory.id);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          results,
          recapContext: recapContext ? `Recent memories context:\n${recapContext}` : undefined
        }, null, 2)
      }
    ]
  };
}

import { MemorySearchSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore, MemoryEntry } from "../types.js";
import { normalize } from "../utils/normalize.js";
import { handleMemoryRecap } from "./memory.recap.js";
import { logger } from "../utils/logger.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";
import { expandQuery } from "../utils/query-expander.js";

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
): Promise<McpResponse> {
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

      // Find text content that contains JSON data
      const textContent = recapResult.content.find((c) => c.type === "text" && c.text);
      if (textContent && textContent.type === "text") {
        try {
          const recapData = JSON.parse(textContent.text) as { summary?: string };
          if (recapData.summary) {
            recapContext = recapData.summary;
          }
        } catch {
          // Not JSON, might be plain text summary
          recapContext = textContent.text;
        }
      }
    } catch (error) {
      logger.error("Failed to get recap context", { error: String(error) });
      // Continue anyway - recap is optional
    }
  }

  // Expand query using prompt intent
  const searchQuery = expandQuery(validated.query, validated.prompt);

  // STEP 1: Repo filter (HARD) + Lightweight similarity scoring
  const similarityResults = db.searchBySimilarity(
    searchQuery,
    validated.repo,
    validated.limit * 3, // Get more candidates for vector re-ranking
    validated.include_archived
  );

  let candidates: Array<{ memory: MemoryEntry; similarityScore: number }>;

  if (similarityResults.length > 0) {
    // Filter by strict threshold (0.50) or take all if very few results (help new projects)
    const filteredResults = similarityResults.length <= 3 
      ? similarityResults 
      : similarityResults.filter(r => r.similarity >= 0.50);
    
    candidates = filteredResults.map((result) => ({
      memory: result,
      similarityScore: result.similarity
    }));
  } else {
    // Fallback: keyword search as candidates
    const allResults = db.searchByRepo(validated.repo, {
      types: validated.types,
      minImportance: validated.minImportance,
      limit: validated.limit * 3,
      includeArchived: validated.include_archived
    });

    const normalized = normalize(searchQuery);
    const queryWords = normalized.split(/\s+/).filter(w => w.length > 2);

    const filtered = allResults.filter((entry) => {
      const normalizedContent = normalize(entry.content);
      return queryWords.some(word => normalizedContent.includes(word));
    });

    // For keyword results, we don't have a semantic score, so we use a safe mid-range
    // But keyword search is inherently less "strict", so we only use it if similarity fails
    candidates = filtered.map(memory => ({
      memory,
      similarityScore: 0.75 // Just above threshold to be included
    }));
  }

  // STEP 2: Workspace Context Boost
  if (validated.current_file_path) {
    const currentPath = validated.current_file_path.toLowerCase();
    candidates = candidates.map(c => {
      let boost = 0;
      
      // Folder boost (+0.15)
      if (c.memory.scope.folder && currentPath.includes(c.memory.scope.folder.toLowerCase())) {
        boost += 0.15;
      }
      
      // Language boost (+0.1)
      const extension = currentPath.split('.').pop();
      if (extension && c.memory.scope.language && extension.includes(c.memory.scope.language.toLowerCase())) {
        boost += 0.1;
      }

      return {
        ...c,
        similarityScore: Math.min(1.0, c.similarityScore + boost)
      };
    });
  }

  // STEP 3: OPTIONAL vector similarity re-rank (only on top candidates)
  let scoredMemories: ScoredMemory[];

  try {
    // Attempt vector search on candidates (if available)
    const vectorResults = await vectors.search(searchQuery, candidates.length, validated.repo);

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

  // STEP 4: Sort by final score and take top results
  scoredMemories.sort((a, b) => b.finalScore - a.finalScore);

  // Apply dynamic threshold: 
  // - If very few candidates, be more lenient (0.30)
  // - If many candidates, be strict (0.50)
  const threshold = scoredMemories.length <= 3 ? 0.30 : 0.50;

  const finalCandidates = scoredMemories
    .filter(sm => sm.finalScore >= threshold)
    .slice(0, validated.limit)
    .map(sm => sm.memory);

  const results = finalCandidates;

  // STEP 5: Increment hit_count for returned memories
  for (const memory of results) {
    db.incrementHitCount(memory.id);
  }

  // STEP 5: Log the query for recent queries feature
  db.logAction('search', validated.repo, { query: validated.query, resultCount: results.length });
  logger.info("[MCP] memory.search", { repo: validated.repo, query: validated.query, results: results.length });

  const resultData = {
    query: validated.query,
    prompt: validated.prompt || null,
    results,
    matchReason: validated.prompt 
      ? `Results ranked by relevance to "${validated.query}" with context: ${validated.prompt}`
      : `Results ranked by relevance to "${validated.query}"`,
    recapContext: recapContext ? `Recent memories context:\n${recapContext}` : undefined
  };

  const firstResult = results[0];
  const topResultInfo = firstResult 
    ? `\n\nTop Match: [${firstResult.type}] ${firstResult.title || firstResult.content.substring(0, 50) + "..."}`
    : "";
    
  return createMcpResponse(
    resultData,
    `Found ${results.length} memories matching "${validated.query}"${topResultInfo}`,
    { 
      query: validated.query,
      results: results.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        content: r.content,
        importance: r.importance,
        scope: r.scope,
        created_at: r.created_at,
        updated_at: r.updated_at,
        hit_count: r.hit_count,
        recall_count: r.recall_count,
        last_used_at: r.last_used_at,
        expires_at: r.expires_at
      }))
    }
  );
}

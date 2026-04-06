import { MemorySearchSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore, MemoryEntry } from "../types.js";
import { normalize } from "../utils/normalize.js";
import { handleMemoryRecap } from "./memory.recap.js";
import { logger } from "../utils/logger.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";
import { expandQuery } from "../utils/query-expander.js";

const HYBRID_WEIGHTS_VECTOR = {
  similarity: 0.4,
  vector: 0.4,
  importance: 0.2,
};

const HYBRID_WEIGHTS_NO_VECTOR = {
  similarity: 0.8,
  importance: 0.2,
};

export async function handleMemorySearch(
  params: any,
  db: SQLiteStore,
  vectors: VectorStore
): Promise<McpResponse> {
  const validated = MemorySearchSchema.parse(params);
  
  let recapContext: string | undefined;
  if (validated.includeRecap) {
    try {
      const recapRes = await handleMemoryRecap({ repo: validated.repo, limit: 10 }, db);
      recapContext = recapRes.content[0].type === "text" ? recapRes.content[0].text : undefined;
    } catch (error) {
      logger.error("Failed to get recap context", { error: String(error) });
    }
  }

  const searchQuery = expandQuery(validated.query, validated.prompt);

  // 1. Get Candidates from SQLite
  const similarityResults = db.searchBySimilarity(
    searchQuery,
    validated.repo,
    validated.limit * 3,
    validated.include_archived,
    validated.current_tags ?? []
  );

  let candidates = similarityResults.map(r => ({
    memory: r as MemoryEntry,
    similarityScore: (r as any).similarity as number
  }));

  // 2. Workspace & Tag Affinity Boost
  if (candidates.length > 0) {
    const currentPath = validated.current_file_path?.toLowerCase();
    const currentTags = (validated.current_tags || []).map(t => t.toLowerCase());
    
    // Attempt to resolve current branch if not provided (optional)
    const currentBranch = validated.scope?.branch;

    candidates = candidates.map(c => {
      let boost = 0;
      
      // Branch boost (+0.1) - High relevance if on same branch
      if (currentBranch && c.memory.scope.branch === currentBranch) {
        boost += 0.1;
      }
      
      // Folder boost (+0.15)
      if (currentPath && c.memory.scope.folder && currentPath.includes(c.memory.scope.folder.toLowerCase())) {
        boost += 0.15;
      }
      
      // Language boost (+0.1)
      if (currentPath && c.memory.scope.language) {
        const ext = currentPath.split('.').pop();
        if (ext && ext.includes(c.memory.scope.language.toLowerCase())) boost += 0.1;
      }

      // TAG AFFINITY BOOST (+0.2)
      // If the memory has tags that match the current workspace tech-stack
      if (currentTags.length > 0 && c.memory.tags.some(t => currentTags.includes(t.toLowerCase()))) {
        boost += 0.2;
      }

      return { ...c, similarityScore: Math.min(1.0, c.similarityScore + boost) };
    });
  }

  // 3. Vector Re-ranking
  let scoredMemories: any[] = [];
  try {
    const vectorResults = await vectors.search(searchQuery, candidates.length || 10, validated.repo);
    const vectorScoreMap = new Map(vectorResults.map(vr => [vr.id, vr.score]));

    if (candidates.length > 0) {
      scoredMemories = candidates.map(c => {
        const vScore = vectorScoreMap.get(c.memory.id) ?? 0;
        const impBoost = c.memory.importance / 5;
        const finalScore = (c.similarityScore * HYBRID_WEIGHTS_VECTOR.similarity) +
                           (vScore * HYBRID_WEIGHTS_VECTOR.vector) +
                           (impBoost * HYBRID_WEIGHTS_VECTOR.importance);
        return { ...c, vectorScore: vScore, finalScore };
      });
    } else if (vectorResults.length > 0) {
      // If SQLite found nothing but vectors did (rare due to our fallback)
      for (const vr of vectorResults) {
        const mem = db.getById(vr.id);
        if (mem) {
          const impBoost = mem.importance / 5;
          scoredMemories.push({
            memory: mem,
            similarityScore: 0,
            vectorScore: vr.score,
            finalScore: (vr.score * 0.8) + (impBoost * 0.2) 
          });
        }
      }
    }
  } catch (error) {
    logger.warn("Vector search failed, using similarity only", { error: String(error) });
    scoredMemories = candidates.map(c => ({
      ...c,
      vectorScore: 0,
      finalScore: (c.similarityScore * 0.8) + ((c.memory.importance / 5) * 0.2)
    }));
  }

  // 4. Threshold & Final Selection
  scoredMemories.sort((a, b) => b.finalScore - a.finalScore);
  
  const threshold = scoredMemories.length <= 5 ? 0.10 : 0.40;
  let results = scoredMemories.filter(sm => sm.finalScore >= threshold).map(sm => sm.memory);

  // Absolute fallback: if repo has data but search failed threshold, return top 1
  if (results.length === 0 && scoredMemories.length > 0) {
    results = [scoredMemories[0].memory];
  }

  results = results.slice(0, validated.limit);

  // 5. Post-processing
  for (const m of results) db.incrementHitCount(m.id);
  logger.info("[MCP] memory.search", { repo: validated.repo, query: validated.query, results: results.length });

  const topMatch = results[0] ? `\n\nTop Match: [${results[0].type}] ${results[0].title || results[0].content.substring(0, 50)}` : "";

  return createMcpResponse(
    { query: validated.query, results, recapContext },
    `Found ${results.length} memories matching "${validated.query}"${topMatch}`,
    {
      query: validated.query,
      results: results as any,
      resourceLinks: [
        {
          uri: `memory://index?repo=${encodeURIComponent(validated.repo)}`,
          name: `Memory Index (${validated.repo})`,
          description: "Repository memory index",
          mimeType: "application/json",
          annotations: {
            audience: ["assistant"],
            priority: 0.7,
          },
        },
      ],
    }
  );
}

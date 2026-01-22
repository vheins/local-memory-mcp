# Hybrid Similarity + Vector Search

## Overview

The MCP Local Memory system implements a **hybrid search strategy** that combines:

1. **Lightweight text similarity** (primary, mandatory)
2. **Vector/semantic search** (secondary, optional boost)

This approach provides precision through deterministic similarity while improving recall with semantic understanding.

## Architecture

### Search Pipeline

```
memory.search(query, repo)
  ↓
1. Repo filter (HARD)
  ↓
2. Lightweight similarity scoring (MANDATORY)
  ↓
3. Candidate pruning (top K × 3)
  ↓
4. OPTIONAL vector similarity re-rank
  ↓
5. Final ranking & threshold
  ↓
6. Return memory IDs
```

**Key Principle:** Vector search is NEVER step 1. It only re-ranks candidates identified by similarity.

## Scoring Formula

### Hybrid Mode (with vector search)
```
FinalScore = (SimilarityScore × 0.6) + (VectorScore × 0.3) + (ImportanceBoost × 0.1)
```

Where:
- `SimilarityScore` ∈ [0.0 – 1.0] from text-based cosine similarity
- `VectorScore` ∈ [0.0 – 1.0] from semantic embedding similarity
- `ImportanceBoost` = importance / 5

### Fallback Mode (similarity-only)
```
FinalScore = (SimilarityScore × 0.85) + (ImportanceBoost × 0.15)
```

When vector search is unavailable or fails, weights are redistributed to maintain ranking quality.

## Implementation Details

### Text-Based Similarity (Tier 1)

**Always computed**, provides:
- Fast filtering
- Typo tolerance
- Deterministic results

Algorithm:
1. Normalize text (lowercase, strip punctuation)
2. Remove stopwords
3. Build term frequency (TF) vector
4. Compute cosine similarity

### Vector Search (Tier 2)

**Optional boost**, provides:
- Paraphrase matching
- Semantic recall
- Abstract concept linking

Rules:
- Runs ONLY on top-K candidates from similarity
- NEVER expands search universe
- NEVER overrides similarity completely
- Gracefully degrades if unavailable

## Failsafe Behavior

```typescript
try {
  const vectorResults = await vectors.search(query, candidates.length);
  // Use hybrid ranking
} catch (error) {
  console.error("Vector search failed, using similarity-only");
  // Automatically fall back to similarity-only ranking
}
```

The system behaves identically from the caller's perspective - no errors propagate.

## Storage

### Similarity Vectors
- Computed on-the-fly
- No storage required
- Cached in memory (optional)

### Vector Embeddings (Optional)
```sql
CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id TEXT PRIMARY KEY,
  vector TEXT NOT NULL,         -- JSON array of floats
  updated_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
```

Methods:
- `upsertVectorEmbedding(memoryId, vector)` - Store embedding
- `getVectorEmbedding(memoryId)` - Retrieve embedding

## Dashboard Observability

### Debug View (Future Enhancement)
When search results are displayed, the dashboard can show:
- **SimilarityScore**: Text-based match quality
- **VectorScore**: Semantic match quality (if used)
- **FinalScore**: Combined ranking score

### Aggregate Metrics
- Recall rate per search mode
- Percentage of searches using vector boost
- Performance comparison: similarity vs hybrid

## Configuration

### Weight Tuning
```typescript
const HYBRID_WEIGHTS = {
  similarity: 0.6,  // Primary signal
  vector: 0.3,      // Secondary boost
  importance: 0.1   // Tiebreaker
};
```

Weights must sum to 1.0. Adjust based on:
- Recall rate metrics
- Query patterns
- Memory content characteristics

### Quality Rules
If recall_rate decreases after enabling vector boost:
1. Reduce vector weight
2. Or disable vector for that repo
3. Monitor and iterate

**Vector is an assistant, not an authority.**

## Performance Expectations

- **Similarity Search**: <20ms for <1k memories
- **Vector Search**: Depends on implementation (embeddings, model)
- **Hybrid Overhead**: Negligible if vector is fast
- **Startup Cost**: ~0 (no model loading required for similarity)

## Example Usage

### With Vector Search Available
```typescript
// Returns memories ranked by hybrid score
const results = await handleMemorySearch({
  query: "authentication middleware",
  repo: "backend-api",
  limit: 10
}, db, vectors);

// Results use: 60% similarity + 30% vector + 10% importance
```

### With Vector Search Unavailable
```typescript
// Automatically falls back to similarity-only
const results = await handleMemorySearch({
  query: "authentication middleware",
  repo: "backend-api",
  limit: 10
}, db, stubVectors); // Stub returns empty []

// Results use: 85% similarity + 15% importance
```

## Philosophy

This hybrid strategy:
- ✅ Preserves precision (similarity as filter)
- ✅ Improves recall (vector as booster)
- ✅ Avoids overfitting to ML (deterministic-first)
- ✅ Gracefully degrades (no hard dependencies)

It is the correct balance for MCP Local Memory: **boring, predictable, fast** with optional semantic enhancement.

## Activation Message

When the system is running with hybrid search enabled:

**"Hybrid similarity + vector search active. Deterministic-first strategy enabled."**

When vector search is not available:

**"Similarity-only search active. Vector search unavailable (graceful degradation)."**

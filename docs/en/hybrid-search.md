# Hybrid Search: How the System "Thinks"

The MCP Local Memory Service uses a **Hybrid Search Engine** to ensure your AI Agent always finds the right information, even if you use different words or make typos.

## 🔍 How it Works

Every search result is the weighted blend of four signals:

1. **Semantic similarity (40%)** — meaning-based relevance using the `all-MiniLM-L6-v2` model locally via Transformers.js. This lets the Agent understand that "database schema" is related to "migrations", even when the words don't match.
2. **Keyword match (30%)** — exact tokens and phrases found in stored text. A query for "auth" immediately finds content containing that exact term.
3. **Recency (15%)** — newer entries score higher; the signal halves every ~30 days.
4. **Domain / workspace affinity (15%)** — a boost when the memory's repository or folder matches your current working context (e.g. working in `src/auth/` boosts memories scoped to the `auth` folder or repo).

The blend is computed as: `finalScore = similarity·0.40 + keyword·0.30 + recency·0.15 + domain·0.15`.

## 🧠 Smart Features

- **Adaptive Thresholding:** the strictness adapts to the size of the result set — lenient for small sets (0.10 for memories) so a fresh project still returns results, stricter for larger sets (0.40) to cut noise. If every candidate falls below the threshold, the single best match is still returned, so a cold start is never empty.
- **Tech-Stack Affinity:** pass `current_tags` (e.g. `["react", "laravel"]`) to include memories tagged with those technologies from other projects. Your Agent's experience with a library in Project A follows to Project B.
- **Conflict Prevention:** storing a memory that contradicts an existing one (cosine similarity ≥ 0.85) is rejected with a `MEMORY_CONFLICT` error, keeping your knowledge base a single source of truth.

## ⚠️ Disclaimer

Semantic search performance depends on local CPU capabilities and the quality of the stored text. **THE SOFTWARE IS PROVIDED "AS IS"**, without warranty of accuracy.

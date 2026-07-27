# SPEC-001: Unified NL Query — Hybrid Vector + FTS5

**Date:** 2026-07-27
**Status:** Proposed

## Goal

Semua read tool yang mengelola **knowledge** (memory, task, standard, codebase, agent-context) menggunakan formula hybrid scoring yang seragam. Write tools otomatis generate vector embeddings untuk data baru.

## Formula Hybrid (SERAGAM)

```
score = (vector_similarity × 0.40)
      + (keyword_score      × 0.30)
      + (recency_boost      × 0.15)
      + (domain_boost       × 0.15)
```

### Komponen

| Komponen              | Bobot | Cara Hitung                                                         |
| --------------------- | ----- | ------------------------------------------------------------------- |
| **vector_similarity** | 0.40  | Cosine similarity dari vector embedding (all-MiniLM-L6-v2, 384-dim) |
| **keyword_score**     | 0.30  | FTS5 match score / LIKE relevance / code ranking tier               |
| **recency_boost**     | 0.15  | `min(1, days_since_update / 30)` — makin baru makin tinggi          |
| **domain_boost**      | 0.15  | Tags match, language match, workspace affinity (file path, branch)  |

### Adaptive Threshold

| Kondisi        | Threshold       |
| -------------- | --------------- |
| Hasil ≤ 5      | 0.08 (longgar)  |
| Hasil > 5      | 0.20 (ketat)    |
| Minimal return | 1 hasil teratas |

### Parameter Seragam

```jsonc
{
	"query": "string", // NL query (semantic + keyword)
	"limit": "number (default 5)",
	"offset": "number (default 0)",
	"include_archived": "boolean",

	"repo": "string",
	"owner": "string (auto)",
	"json": "boolean"
}
```

## Vector Embedding — Per Domain

| Write Tool       | Embed Content                         | Trigger         | Status          |
| ---------------- | ------------------------------------- | --------------- | --------------- |
| `memory-write`   | content (full)                        | Create & update | ✅ Ada          |
| `standard-write` | name + content + context + stack      | Create & update | ✅ Ada          |
| `task-write`     | title + description                   | Create & update | ❌ Belum        |
| `codebase-index` | symbol name + signature + doc_comment | Index/re-index  | ✅ Ada          |
| `agent-context`  | —                                     | —               | N/A (read-only) |

## Perubahan Per Domain

### 1. task-write → generate vector embedding

**Di handler `task.write.ts`:**

```typescript
// Setelah insert/update sukses
if (content || title) {
	await vectors
		.upsert(taskId, `${title}\n${description}`, "task")
		.catch((e) => logger.warn("Vector upsert failed for task", e));
}
```

### 2. task-read → hybrid search upgrade

**Di handler `task.read.ts`:**

```
Current:        FTS5 → LIKE → pagination
Upgrade:        Vector search → hybrid score → FTS5 fallback → same output
```

Pattern sama dengan yang sudah ada di `memory-read`:

1. `searchBySimilarity(query, filters)` → vector candidates
2. Jika hasil < threshold → FTS5 fallback
3. Hybrid scoring 4 komponen
4. Adaptive threshold

### 3. codebase-read → vector tier

**Di handler `codebase.read.ts`:**

```
Current:        FTS5 → 5-tier ranking (exact/camelCase/prefix/substring/FTS5)
Upgrade:        Vector → [existing 5-tier] → hybrid score
```

Vector jadi tier tambahan di `rankSymbols()`:

- Vector score = cosine similarity (0-1)
- Final score = (vector × 0.30) + (existing_tier_score × 0.70)

### 4. agent-context → query + vector

**Di handler `agent-context.ts`:**

- Rename parameter `objective` → `query`
- Jika `query` ada → vector search (ganti dari keyword `searchByRepo`)
- Jika `query` tidak ada → `getRecentMemories` (sama seperti sekarang)
- Hybrid scoring sama

### 5. Standardisasi formula di memory-read & standard-read

Kedua domain sudah punya hybrid scoring, tapi formulanya perlu diseragamkan:

| Komponen          | Existing memory-read | Existing standard-read | Unified  |
| ----------------- | -------------------: | ---------------------: | :------: |
| vector_similarity |                 0.40 |                   0.40 | **0.40** |
| keyword_score     |                    — |                   0.30 | **0.30** |
| recency_boost     |                    — |                      — | **0.15** |
| usage_boost       |                    — |                   0.05 |    —     |
| domain_boost      |                    — |         0.25 (keyword) | **0.15** |
| importance        |                 0.20 |                      — |    —     |

## Output Seragam

```jsonc
{
	"schema": "{domain}-search",
	"query": "string",
	"count": 5,
	"total": 12,
	"offset": 0,
	"limit": 5,
	"results": {
		"columns": ["id", "code", "title", "type", "score", "confidence"],
		"rows": [["...", "...", "...", "...", 0.85, "high"]]
	},
	// Tambahan: KG context
	"kg": {
		"entities": [{ "name": "...", "type": "...", "source_domain": "..." }],
		"relations": [{ "from": "...", "to": "...", "type": "..." }]
	}
}
```

**Confidence tiers**: high (≥0.70), medium (≥0.40), low (<0.40)

## Task List

### Task Domain (REFACTOR-TASK)

- **TASK-007:** Generate vector embedding di task-write (title + description → vectors.upsert)
- **TASK-008:** Upgrade task-read ke hybrid search (vector + FTS5 + formula unified)

### Codebase Index Domain (REFACTOR-CI)

- **CI-005:** Add vector tier to codebase-read ranking (5-tier existing + vector)

### Agent Context Domain (REFACTOR-AC)

- **AC-005:** Rename objective→query, upgrade ke vector search hybrid

### Memory & Standard (REFACTOR-MEM, REFACTOR-STD)

- **MEM-009:** Standarisasi formula hybrid memory-read ke unified formula
- **STD-006:** Standarisasi formula hybrid standard-read ke unified formula

### Testing

- **INTEGRATION-001:** Test hybrid search di semua domain — konsistensi formula

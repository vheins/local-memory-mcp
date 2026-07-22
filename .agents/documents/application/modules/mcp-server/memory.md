# Module Documentation: Memory Partition

## Header & Navigation

- [Module Overview](overview.md)
- [Task Feature](task.md)
- [Interaction Feature](interaction.md)
- [References Feature](references.md)
- [Memory API](../../api/mcp-server/api-memory.md)
- [Memory Tests](../../testing/mcp-server/test-memory.md)

## Responsibility

The Memory Partition handles the persistence, retrieval, and structural integrity of semantic knowledge and task state. It is built on a "Local-First" principle, ensuring high performance without external dependencies.

## Data Schema (SQLite)

The system uses the following core tables to maintain state:

### 1. `memories`

The primary store for semantic knowledge.

- **`id`**: UUID v4 (Primary Key).
- **`type`**: Enum (`code_fact`, `decision`, `mistake`, `pattern`, `task_archive`).
- **`title`**: Human-readable title for UI display (3-255 chars).
- **`content`**: The actual knowledge payload (min 10 chars).
- **`importance`**: Integer (1 to 5) used for ranking.
- **`scope_owner`, `scope_repo`**: Repository scoping via MCP roots.
- **`is_global`**: Boolean (0/1) for cross-repository visibility.
- **`tags`**: JSON array of tech-stack or logic markers.
- **`metadata`**: JSON object for arbitrary context.
- **`hit_count` / `recall_count`**: Used to calculate "recall rate" and decay.
- **`supersedes`**: UUID of memory this entry replaces (versioning).
- **`expires_at`**: Optional TTL-based expiration.
- **`agent`, `role`, `model`**: Attribution metadata.

### 2. `memory_vectors`

Stores semantic embeddings (384-dim Float32Array) for vector search.

### 3. `memories_archive`

Archived/decayed memories with an additional `archived_at` timestamp.

### 4. `memory_summary`

Per-repo (owner+repo PK) high-level architectural summaries.

## Search Ranking Algorithm

Memory search utilizes a hybrid ranking strategy:

1. **TF-IDF Similarity**: Client-side cosine similarity computed from token frequency vectors (fast, no model needed).
2. **Neural Vector Similarity**: ONNX-based embeddings via `@xenova/transformers` (all-MiniLM-L6-v2), compared via cosine similarity.
3. **Combined Score**: Weighted hybrid of both scores for final ranking.
4. **Ranking Bias**:
   - `repo_match`: Scope affinity boost.
   - `importance`: Higher importance values act as tie-breakers.

## Memory Lifecycle & Maintenance

The system performs automated curation and decay:

### Soul Maintenance

- **Decay**: Unused memories lose importance over time. Default: 7 days inactivity triggers decay cycle.
- **Decay Rate**: 0.5 (importance multiplied per cycle).
- **Minimum Threshold**: Memories below importance 1 are archived.
- **Immunization**: Memories with certain tags can be excluded from decay.
- **Schedule**: Runs at server startup and periodically (checks if <24h since last run).

### Expiry & Archiving

- **TTL**: Memories with `expires_at` timestamp are auto-archived when expired.
- **Supersedes**: When a new memory supersedes an old one, the old memory is archived.
- **Auto-Archiving**: Low-importance, unused memories are moved to `memories_archive`.

## Memory Tools Summary

| Tool                 | Description                                              |
| :------------------- | :------------------------------------------------------- |
| `memory-store`       | Store a new memory entry with collision detection        |
| `memory-search`      | NAVIGATION: Returns pointer table of matching IDs        |
| `memory-detail`      | Fetch full content for a specific memory by ID/code      |
| `memory-acknowledge` | (MANDATORY) Mark memory as used/irrelevant/contradictory |
| `memory-update`      | Update an existing memory entry                          |
| `memory-delete`      | Soft-delete one or more memory entries                   |
| `memory-recap`       | AGGREGATED OVERVIEW: Stats + top memories pointer table  |
| `memory-summarize`   | Update per-repo summary                                  |
| `memory-synthesize`  | Advanced reasoning via client sampling                   |

## Upstream Compatibility Aliases

| Alias            | Maps To                 |
| :--------------- | :---------------------- |
| `remember_fact`  | `memory-store` (single) |
| `remember_facts` | `memory-store` (bulk)   |
| `recall`         | `memory-search`         |
| `forget`         | `memory-delete`         |

## Business Rules

| Rule                      | Description                                            |
| :------------------------ | :----------------------------------------------------- |
| **Hybrid Ranking**        | Results ranked using TF-IDF + Vector cosine similarity |
| **Conflict Detection**    | Similarity > 0.55 flags potential duplicates           |
| **Supersedes Versioning** | Old memory archived when superseded                    |
| **Importance Bias**       | Search results filterable by `minImportance` (1-5)     |
| **Global Scope**          | `is_global` memories searchable across all repos       |
| **Scope Isolation**       | Memories isolated by `owner`/`repo` unless global      |

## Agent Coordination

- Handoffs and task claims are **not** stored as memories.
- Use the dedicated `handoffs` and `claims` tables via `handoff-create`, `handoff-list`, and `task-claim` MCP tools.
- This keeps durable semantic memory separate from transient coordination state.

## Implementation Note

The persistence logic is encapsulated in the following entities:

- **[MemoryEntity](../../../../../src/mcp/entities/memory.ts)**: Core CRUD, stats, search, bulk ops.
- **[MemoryVectorEntity](../../../../../src/mcp/entities/memory.vector.ts)**: Vector similarity search, conflict detection.
- **[MemoryArchiveEntity](../../../../../src/mcp/entities/memory.archive.ts)**: Expiration and decay archiving.

## Compliance

- **Local Privacy**: All embeddings generated locally. No data transmitted over network.
- **Protocol Strictness**: All responses follow MCP result schema with `content` arrays and `structuredContent` for machine parsing.

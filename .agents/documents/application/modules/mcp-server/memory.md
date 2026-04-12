# Feature Documentation: Memory Management

## Responsibility
The Memory Management module provides the system's "Long-Term Persistence". It allows agents to store architectural decisions, patterns, and facts that persist across sessions.

## Hybrid Search & Ranking
The system implements a multi-stage ranking algorithm to ensure high recall and precision:
1.  **Vector Store (L2 Distance)**: Uses `@xenova/transformers` to provide semantic matching.
2.  **SQLite FTS5 (BM25)**: Provides exact keyword and token-based matching.
3.  **Recency & Importance Bias**: Results are weighted towards higher `importance` and more recent `created_at` timestamps.

## Context Sharing (Affinity Tagging)
The server can automatically pull relevant memories from *different* repositories using **Affinity Tags**.
- When an agent provides `current_tags` (e.g., `["react", "filament"]`), the server searches for memories with matching tags in the `global` scope or other projects.
- This allows for "Global Coding Standards" or "Cross-Project Mistakes" to be shared without manual duplication.

## Core Tools
- `memory.store`: Saves a new memory with automatic vectorization.
- `memory.search`: Performs hybrid Vector + FTS5 search (ranked by similarity).
- `memory.synthesize`: Consolidates multiple memories into a high-level architectural insight.
- `memory.summarize`: Updates the repository's global summary signal.
- `memory.recap`: Provides a pointer table of the most important recent memories.
- `memory.acknowledge`: Mandatory confirmation after an agent uses a memory to generate logic.

## Business Rules
| Rule Name | Description |
|-----------|-------------|
| **Hybrid Ranking** | Results are ranked using a combination of Cosine Similarity (Vector) and BM25 (Full-Text Search). |
| **Deduplication** | Identical content within the same repository scope is rejected to prevent noise. |
| **Importance Bias** | Search results can be prioritized using `minImportance` (1-5). |
| **Global Scope** | Memories marked as `is_global` are searchable across all repository contexts. |
| **Bound Validation** | Absolute paths in `current_file_path` must remain within the active MCP roots. |

## Data Model (memories table)
- `id` (UUID, PK)
- `type` (decision, code_fact, mistake, pattern, agent_handoff)
- `title` (TEXT)
- `content` (TEXT)
- `repo` (TEXT)
- `importance` (INTEGER, 1-5)
- `is_global` (BOOLEAN)
- `metadata` (JSON)
- `embedding` (F32 Vector)
- `created_at` (TIMESTAMP)

## Business Flow: Storage & Retrieval
```mermaid
sequenceDiagram
    participant A as Agent
    participant M as Memory Service
    participant V as Vector Provider
    participant D as SQLite
    
    A->>M: memory.store(content)
    M->>V: getEmbedding(content)
    V-->>M: float32[]
    M->>D: INSERT INTO memories
    D-->>M: success
    M-->>A: Created (ID)
```

## Compliance
- **Local Privacy**: All embeddings are generated locally. No plain text or vectors are transmitted over the network.
- **Protocol Strictness**: All responses follow the MCP result schema with `content` arrays.

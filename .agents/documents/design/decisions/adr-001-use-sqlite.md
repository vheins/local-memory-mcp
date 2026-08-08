# ADR-001 — Use SQLite

## Title

Use SQLite and ONNX Transformers for Local Storage & Search

## Context

The system requires a persistent storage layer that supports complex full-text queries, combined with semantic vector search capabilities. The data must remain entirely local to ensure user privacy for proprietary codebases.

## Decision

We will use `better-sqlite3` as our core datastore, taking advantage of its synchronous performance and WAL mode for concurrent reads. We will embed `@xenova/transformers` utilizing the ONNX runtime directly in Node.js to generate vector embeddings entirely offline using the `all-MiniLM-L6-v2` model (384-dim vectors).

## Status

**Adopted** — This decision has been implemented and is the foundation of the data layer.

> **VERIFIED vs IMPLEMENTATION (2026-08-08):** decision is in force. Corrections: `_schema_version` is **v22** (not v2); default DB path is OS-specific (Linux `~/.config/local-memory-mcp/`, macOS `~/Library/Application Support/local-memory-mcp/`, Windows `~/.local-memory-mcp/`), not `./storage/memory.db`; hybrid search keyword leg is FTS5-based (v04/v10/v18), not raw TF-IDF.

## Consequences

- **Pros:** Zero-configuration deployment for users; 100% privacy; fast read/write speeds (< 50ms queries); single-file portability; WAL mode for concurrent dashboard + MCP server access; FTS5 for full-text search.
- **Cons:** First-time run requires downloading the embedding model (~20-50MB) which may block initial requests if not handled via background workers. Scaling to millions of records might slow down brute-force cosine similarity compared to a dedicated vector DB.

## Implementation Notes

- Database schema versioning via `_schema_version` table (current: v2).
- Cross-process write locking via `proper-lockfile` (`WriteLock.withLock()`).
- Default path: `./storage/memory.db` (configurable via `MEMORY_DB_PATH` env var).
- Migrations managed by `src/mcp/storage/migrations/` (versioned index — `index.ts` + `vNN-*.ts`).

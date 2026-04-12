# Architecture Decision Record (ADR-001)

## Title
Use SQLite and ONNX Transformers for Local Storage & Search

## Context
The system requires a persistent storage layer that supports complex FTS queries, combined with semantic vector search capabilities. The data must remain entirely local to ensure user privacy for proprietary codebases.

## Decision
We will use `better-sqlite3` as our core datastore, taking advantage of its synchronous performance and `FTS5` extension. We will embed `@xenova/transformers` utilizing the ONNX runtime directly in Node.js to generate vector embeddings entirely offline.

## Consequences
- **Pros:** Zero-configuration deployment for users; 100% privacy; fast read/write speeds; single-file portability.
- **Cons:** First-time run requires downloading the embedding model (~20-50MB) which may block initial requests if not handled via background workers. Scaling to millions of records might slow down brute-force cosine similarity over SQLite compared to a dedicated vector DB.
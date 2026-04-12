# Feature Documentation: Memory

## User Stories
- **Given** an agent with new context, **When** it calls `memory-store`, **Then** the context is persisted.
- **Given** a query, **When** an agent calls `memory-search`, **Then** relevant vector similarities are returned.

## Data Model
- `memories(id, type, title, content, embedding, importance, tags, repo)`

## Compliance
- **Privacy:** 100% of data processing occurs on the localhost. No external cloud dependencies required for embeddings.

## Task List
- [x] Integrate SQLite
- [x] Load F32 ONNX model
- [x] Create `memory-store` RPC
- [x] Create `memory-search` FTS + Vector logic
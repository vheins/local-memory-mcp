# Acceptance Criteria: Knowledge Management (Memory)

All features must satisfy the following criteria to be considered production-ready.

## 1. Storage (`memory-store`)
- **Given** the repository state is open,
- **When** a valid title and content are provided,
- **Then** the system MUST generate a local vector embedding using ONNX transformers and persist the record in SQLite.

## 2. Hybrid Search (`memory-search`)
- **Given** the memories table contains indexed data,
- **When** a semantic query is processed,
- **Then** the internal ranking algorithm MUST prioritize results using a weighted hybrid of Cosine Similarity and BM25 (FTS5).

## 3. Knowledge Synthesis (`memory-synthesize`)
- **Given** the client session has `sampling` capability,
- **When** multiple related context snippets are identified,
- **Then** the tool MUST request a synthesis from the client LLM and create a new memory of type `decision`.

## 4. Usage Acknowledgement (`memory-acknowledge`)
- **Given** an agent has successfully implemented logic based on a retrieved memory,
- **When** the agent calls `memory-acknowledge` with status `used`,
- **Then** the system MUST increment the relevance score for that memory ID.

## 5. Global Search
- **Given** multiple repositories are registered,
- **When** `is_global` is set on a memory,
- **Then** that record MUST be visible and searchable from any repository context.
# Functional Specification Document (FSD)

This document specifies the functional behavior of the `local-memory-mcp` application.

## 1. Memory Management
- **Description:** Provides storage and retrieval of semantic context snippets.
- **Key Tools:**
  - `memory.store`: Logic for persisting text with vector generation.
  - `memory.search`: Hybrid ranking algorithm (Cosine Similarity + BM25).
  - `memory.synthesize`: Collaborative consolidation of context using the client's LLM.
- **Rules:**
  - Titles must be unique within a repository scope.
  - Importance must be between 1 (low) and 5 (critical).

## 2. Task Management
- **Description:** Tracks agent progress and prevents developmental amnesia.
- **Statuses:** `backlog`, `pending`, `in_progress`, `completed`, `canceled`, `blocked`.
- **Logic Rules:**
  - **Single Active Focus:** Ideally only one task per repo should be `in_progress` at any time.
  - **Transition Gate:** Tasks CANNOT move to `completed` from `pending`. They MUST move through `in_progress`.
  - **Token Transparency:** Actual token usage must be logged upon task completion.

## 3. Dashboard UI
- **Tabs:** Dashboard (Stats), Activity (Audit), Memories (Search), Tasks (Kanban), Reference (Capability).
- **Functionality:** Real-time data fetching without full-page reloads using Svelte 5 logic.

## 4. Activity Audit
- **Requirement:** Every call to the `local-memory-mcp` tools must generate an entry in the `activity` table.
- **Content:** Input parameters, execution timestamp, and results summary.
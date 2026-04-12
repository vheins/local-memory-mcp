# Functional Specification Document (FSD)

This document encompasses the functional behavior, user stories, acceptance criteria, and edge cases for the core features of `local-memory-mcp`.

## Feature 1: Memory Management
- **Stories:** As an AI agent, I want to store, search, update, and delete memories to manage context.
- **Acceptance Criteria:**
  - `memory-store` saves data and returns an ID.
  - `memory-search` returns items ordered by semantic relevance.
  - `memory-synthesize` samples the client LLM and stores the summary.
- **Edge Cases:**
  - Conflict on title collision.
  - Extreme token lengths on FTS5 lookup.
  - Model load timeouts for vector generation.

## Feature 2: Task Management
- **Stories:** As an AI agent, I want to create and track task states to maintain boundary limits for my memory queries.
- **Acceptance Criteria:**
  - `task-create` successfully logs a new task ID.
  - `task-active` unsets the previous active task and marks the new one.
- **Edge Cases:**
  - Race conditions when toggling active state.
  - Attempting to close a task with incomplete subtasks.
# Acceptance Criteria: Memory Management

## 1. Store Memory (`memory-store`)
- **Happy Path:** When a valid title, content, and importance score are provided, the system saves the entry to the SQLite database and returns the memory ID.
- **Conflict Handling:** When storing a memory that conflicts with an active one, the system identifies the conflict and optionally allows superseding the old memory.

## 2. Search Memory (`memory-search`)
- **Happy Path:** When an agent provides a search query, the system generates an embedding via transformers, performs a hybrid (vector + keyword) search in SQLite, and returns the top relevant results sorted by proximity to the current context.

## 3. Update Memory (`memory-update`)
- **Happy Path:** When an agent specifies a valid ID and provides updated content or tags, the system applies the changes and regenerates the embedding if the content changed.

## 4. Acknowledge Memory Usage (`memory-acknowledge`)
- **Happy Path:** When an agent calls this tool with a memory ID and a status (used, irrelevant, contradictory), the system logs the usage telemetry.
- **Validation:** If the ID does not exist, the system returns a 404/not found error response.

## 5. Memory Synthesize (`memory-synthesize`)
- **Happy Path:** When invoked, the system samples a response from the client's LLM using the current context, and then stores the synthesized output as a new high-level memory.
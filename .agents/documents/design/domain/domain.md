# Domain Model

## Core Entities

1. **Memory**
   - Represents a contextual artifact stored by the agent.
   - **Attributes:** `id` (UUID), `type` (decision, doc, rule, summary), `title`, `content`, `importance` (1-5), `embedding` (Vector array), `tags`, `repo`, `created_at`, `updated_at`.
   - **Relations:** 1-to-many with Telemetry (usage logs).

2. **Task**
   - Represents a piece of work actively tracked by the agent.
   - **Attributes:** `id` (UUID), `title`, `description`, `status` (pending, active, completed, failed, archived), `repo`, `created_at`, `updated_at`.
   - **Invariants:** Only one Task per `repo` can have `status = 'active'` at any given time.

3. **Telemetry (Usage Log)**
   - Tracks the lifecycle and utility of memories.
   - **Attributes:** `id` (UUID), `memory_id` (UUID), `action` (used, irrelevant, contradictory), `timestamp`.
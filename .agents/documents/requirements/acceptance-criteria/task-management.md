# Acceptance Criteria: Task Management

State management for work-in-progress goals.

## 1. Lifecycle Integrity (`task-update`)
- **Given** a task is in state `pending` or `backlog`,
- **When** an agent attempts to change status to `completed`,
- **Then** the system MUST throw a Validation Error (Must be `in_progress` first).

## 2. Active Focus Enforcement (`task-update`)
- **Given** another task is already `in_progress` in the current repo,
- **When** a new task is moved to `in_progress`,
- **Then** the system SHOULD ideally warn or allow context grouping (based on client configuration).

## 3. Transparency & Token Usage (`task-update`)
- **Given** a task is moved to `completed`,
- **When** the update call is processed,
- **Then** the system MUST REQUIRE `est_tokens` to be provided in the request body.

## 4. Bulk Transactability
- **Given** a list of multiple creation/deletion/update operations provided to `task-create`, `task-delete`, or `task-update`,
- **When** any single operation within the list fails validation,
- **Then** the ENTIRE set of operations MUST be rolled back to maintain database consistency.

## 5. Audit Logging
- **Given** any task state change (Transition),
- **When** the operation finishes,
- **Then** an entry MUST be automatically created in the `activity` log containing the comment and the agent ID.
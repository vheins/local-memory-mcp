# Feature Documentation: Task Management

## User Stories
- **Given** I am starting new work, **When** I call `task-create` with a description, **Then** a new task is stored in the database as `pending` (or `active`).
- **Given** there is a pending task, **When** I call `task-active`, **Then** the previous active task is demoted and the new task is marked as `active`.
- **Given** I am in an interactive IDE, **When** I call `task-create-interactive`, **Then** an elicitation form prompts the human user for details.
- **Given** I want to view my current active task context, **When** I read the `tasks://current` resource, **Then** I receive the JSON of the currently active task.

## Data Model
- `tasks(id UUID, title TEXT, description TEXT, status TEXT, repo TEXT, created_at INTEGER, updated_at INTEGER)`

## Business Rules
| Rule Name | Description | Consequence if violated |
|-----------|-------------|-------------------------|
| Unique Active | Only 1 task per repo can have `status='active'`. | If a new task is set to active, the old one is automatically set back to `pending`. |
| Valid Status | Status must be an enum (pending, active, completed, failed, archived). | API rejects request with `-32602` error. |

## Task List (Backend)
- [x] Define SQLite `tasks` schema
- [x] Create `task-create` and `task-update` tool logic
- [x] Create singleton logic for `task-active`
- [x] Integrate elicitation protocol for `task-create-interactive`
- [x] Map `tasks://current` to a readable Resource URI
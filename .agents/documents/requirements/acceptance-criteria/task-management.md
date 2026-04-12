# Acceptance Criteria: Task Management

## 1. Create Task (`task-create`)
- **Happy Path:** When the agent provides a task description, title, and initial status, the system saves it to the SQLite database and returns a generated task ID.
- **Required Fields:** If the title or description is missing, the tool returns a validation error.

## 2. Update Task Status (`task-update`)
- **Happy Path:** When an agent provides a task ID and changes the status to "completed", the system updates the record and logs the state transition.
- **Dependencies Check:** If the task depends on incomplete subtasks, the system either flags it or updates it, depending on the workflow policy.

## 3. List Tasks (`task-list`)
- **Happy Path:** When requested, the system retrieves tasks filtered by the current repository scope, ordered by priority or creation date.
- **Archived Tasks:** The system correctly excludes deleted or fully archived tasks unless explicitly requested.

## 4. Mark Task Active (`task-active`)
- **Happy Path:** When a specific task ID is provided, the system marks this task as active and removes the active flag from the previously active task (ensuring only one task is active at a time for a given session/repo).
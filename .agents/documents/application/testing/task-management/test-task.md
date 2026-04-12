# Test Scenarios: Task Management

## 1. `task-create`
- **Positive (Happy Path):** Call with valid title and description. Expected: Task is created and ID returned.
- **Negative (Validation):** Omit `title`. Expected: System returns Protocol Error `-32602`.

## 2. `task-active` (Business Logic)
- **Positive (State Transition):**
  - Given Task A is `active`.
  - When `task-active` is called with Task B's ID.
  - Expected: Task B becomes `active`. Task A is demoted to `pending`.
- **Negative:** Pass non-existent UUID. Expected: Returns `-32602` Not Found.

## 3. `task-create-interactive` (Advanced Protocol)
- **Positive:** Client supports `elicitation`. Tool triggers `elicitation/create` and successfully waits for human input, then stores the task.
- **Negative:** Client does NOT support `elicitation`. Expected: Tool is not available in the `tools/list` or returns an error stating client unsupported capability.
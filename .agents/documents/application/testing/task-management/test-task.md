# Test Scenarios: Task Management

Every API endpoint must have at least one positive and one negative scenario.

## 1. `task-create`
- **Positive:** Provide valid `title` and `description`. Expected: UUID returned, DB row created.
- **Negative:** Omit `title`. Expected: Protocol Error `-32602`.

## 2. `task-create-interactive`
- **Positive:** Client has `elicitation` capability. Expected: Triggers client form, saves task upon submission.
- **Negative:** Client lacks `elicitation` capability. Expected: Protocol Error `-32603`.

## 3. `task-update`
- **Positive:** Provide valid `id` and change `status` to `completed`. Expected: DB is updated.
- **Negative:** Provide non-existent `id`. Expected: Protocol Error `-32602` (Not Found).

## 4. `task-active`
- **Positive:** Provide valid `id` of a pending task. Expected: Task becomes active, previous active task becomes pending.
- **Negative:** Pass invalid UUID format for `id`. Expected: Protocol Error `-32602`.

## 5. `task-list`
- **Positive:** Call with no arguments. Expected: Returns list of non-archived tasks.
- **Negative:** DB access issue. Expected: Protocol Error `-32603`.

## 6. `task-search`
- **Positive:** Provide valid `query`. Expected: Returns semantically matched tasks.
- **Negative:** Omit `query`. Expected: Protocol Error `-32602`.

## 7. `task-detail`
- **Positive:** Provide valid `id`. Expected: Full task JSON returned.
- **Negative:** Provide unknown `id`. Expected: Protocol Error `-32602` (Not Found).

## 8. `task-delete`
- **Positive:** Provide valid `id`. Expected: Task deleted from DB.
- **Negative:** Provide empty `id`. Expected: Protocol Error `-32602`.

## 9. `task-bulk-manage`
- **Positive:** Provide valid list of 1 create and 1 delete operation. Expected: Both executed inside a transaction.
- **Negative:** Pass a create operation without `title`. Expected: Transaction aborts, Error `-32602` returned.
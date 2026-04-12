# Test Scenarios: Memory Management

Every API endpoint must have at least one positive and one negative scenario.

## 1. `memory-store`
- **Positive (Happy Path):** Call with `type`, `title`, `content`, `importance`. Returns UUID.
- **Negative (Validation):** Omit `content`. Expected: Protocol Error `-32602`.

## 2. `memory-search`
- **Positive:** Provide valid string `query`. Expected: Returns relevant results array.
- **Negative:** Provide empty `query` string. Expected: Protocol Error `-32602`.

## 3. `memory-update`
- **Positive:** Provide valid `id` and new `content`. Expected: Memory is updated and embedding is recalculated.
- **Negative:** Provide non-existent `id`. Expected: Protocol Error `-32602` (Not Found).

## 4. `memory-delete`
- **Positive:** Provide valid existing `id`. Expected: Memory deleted from SQLite.
- **Negative:** Provide malformed UUID `id`. Expected: Protocol Error `-32602`.

## 5. `memory-bulk-delete`
- **Positive:** Provide array of valid `ids`. Expected: Returns count of deleted memories.
- **Negative:** Provide empty array `[]`. Expected: Protocol Error `-32602`.

## 6. `memory-detail`
- **Positive:** Provide valid `id`. Expected: Full data model returned including telemetry.
- **Negative:** Provide non-existent `id`. Expected: Protocol Error `-32602` (Not Found).

## 7. `memory-acknowledge`
- **Positive:** Provide valid `memory_id` and status `used`. Expected: Telemetry logged.
- **Negative:** Provide invalid status `invalid_status`. Expected: Protocol Error `-32602`.

## 8. `memory-recap`
- **Positive:** Call with `limit: 5`. Expected: Returns up to 5 latest memories.
- **Negative:** Call with `limit: "ten"`. Expected: Protocol Error `-32602` (Type mismatch).

## 9. `memory-summarize`
- **Positive:** Call for an existing repo. Expected: Summary text returned.
- **Negative:** Database read lock error. Expected: Server Error `-32603`.

## 10. `memory-synthesize`
- **Positive:** Client has `sampling` capability. Expected: Triggers client LLM generation and saves new memory.
- **Negative:** Client lacks `sampling` capability. Expected: Protocol Error `-32603`.
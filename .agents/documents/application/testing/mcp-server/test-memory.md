# Test Scenarios: Memory Management

Verification scenarios for the semantic knowledge base. All tools must maintain local-first processing integrity.

## 1. `memory.store`
- **Positive:** Provide `type`, `title`, `content`, and `importance: 5`. Verify UUID returned and FTS5 index populated.
- **Negative (Type Mismatch):** Provide `importance: "high"`. Expected: Protocol Error `-32602`.
- **Negative (Validation):** Provide empty `content`. Expected: Validation Error (Zod).

## 2. `memory.search`
- **Positive:** Natural language query. Verify results contain both keyword and semantic matches.
- **Filtering:** Use `minImportance: 4`. Verify results with importance < 4 are excluded.
- **Negative:** Empty query string. Expected: Validation Error.

## 3. `memory.synthesize`
- **Requirement:** Agent must have `sampling` capability enabled in the session.
- **Positive:** Triggers client-side LLM call. Verify new memory of type `decision` is created from the result.
- **Negative:** sampling disabled. Expected: Protocol Error `-32603`.

## 4. `memory.recap`
- **Positive:** Request with `limit: 3`. Verify a tabular list of the top 3 high-importance memories is returned.
- **Negative:** Invalid `limit`. Expected: Type error validation.

## 5. `memory.acknowledge`
- **Positive:** Valid `memory_id` and `status: "used"`. Verify telemetry increments "hit" count for the memory.
- **Negative:** Non-existent `memory_id`. Expected: Not Found.

## 6. `memory.summarize`
- **Positive:** Provide high-level signals for a repo. Verify the `global_summary` resource is updated.
- **Negative:** Malformed signals array. Expected: Validation Error.
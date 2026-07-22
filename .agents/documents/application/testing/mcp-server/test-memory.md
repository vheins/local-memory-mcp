# Test Scenarios: Memory Management

## Header & Navigation

- [MCP Server Module Overview](../../modules/mcp-server/overview.md)
- [Memory Feature](../../modules/mcp-server/memory.md)
- [Memory API](../../api/mcp-server/api-memory.md)

Verification scenarios for the semantic knowledge base. All tools must maintain local-first processing integrity.

## 1. `memory-store`

- **Positive:** Provide `type`, `title`, `content`, and `importance: 5`. Verify UUID returned and vector embedding generated.
- **Negative (Type Mismatch):** Provide `importance: "high"`. Expected: Protocol Error `-32602` (Zod validation).
- **Negative (Validation):** Provide empty `content`. Expected: Validation Error (Zod).
- **Conflict Detection:** Store memory with content similar (>0.55) to existing memory. Verify conflict flag returned.

## 2. `memory-search`

- **Positive:** Natural language query. Verify results contain both keyword and semantic matches (hybrid search).
- **Filtering:** Use `minImportance: 4`. Verify results with importance < 4 are excluded.
- **Type Filtering:** Use `types: ["decision"]`. Verify only decision-type memories returned.
- **Negative:** Empty query string. Expected: Validation Error.

## 3. `memory-synthesize`

- **Requirement:** Agent must have `sampling` capability enabled in the session.
- **Positive:** Triggers client-side LLM call. Verify new memory of type `decision` is created.
- **Negative:** Sampling disabled. Expected: Protocol Error `-32603`.

## 4. `memory-recap`

- **Positive:** Request with `limit: 3`. Verify pointer table of top 3 high-importance memories returned.
- **Negative:** Invalid `limit`. Expected: Type error validation.

## 5. `memory-acknowledge`

- **Positive:** Valid `memory_id` and `status: "used"`. Verify telemetry increments hit and recall counts.
- **Negative:** Non-existent `memory_id`. Expected: Not Found.

## 6. `memory-summarize`

- **Positive:** Provide high-level signals for a repo. Verify the `memory_summary` resource is updated.
- **Negative:** Malformed signals. Expected: Validation Error.

## 7. `memory-update`

- **Positive:** Update `title` and `importance`. Verify changes persisted and vector re-indexed.
- **Negative:** Non-existent ID. Expected: Not Found.

## 8. `memory-delete`

- **Positive:** Delete by single `id`. Verify soft-delete (status = archived).
- **Positive:** Bulk delete by `ids` array. Verify all specified memories archived.

## 9. `memory-detail`

- **Positive:** Fetch by UUID. Verify full attributes including hit_count, recall_count, recall_rate.
- **Positive:** Fetch by short code. Verify same result as UUID lookup.
- **Negative:** Non-existent ID. Expected: Not Found.

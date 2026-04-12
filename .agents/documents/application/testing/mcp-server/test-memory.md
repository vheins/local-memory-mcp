# Test Scenarios: Memory

## 1. `memory-store`
- **Positive (Happy Path):** Call with complete valid payload -> returns UUID and saves to SQLite.
- **Negative (Validation):** Omit `content` argument -> returns Protocol Error (-32602).
- **Edge Cases:** Exceptionally large strings in `content` -> embeds correctly, truncates safely.

## 2. `memory-search`
- **Positive:** Query "database" -> returns previously stored memory regarding SQLite.
- **Edge Case:** Query with no exact keyword matches -> semantic vector search successfully finds conceptually similar content.
- **Negative:** Database locked -> returns clear Tool Execution Error message.
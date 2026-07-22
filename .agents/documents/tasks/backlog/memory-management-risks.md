# Risk Register: Memory Management

| Risk                                                         | Likelihood | Impact | Mitigation Strategy                                                           | Status       |
| :----------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------- | ------------ |
| Vector search performance degrades as memory scale increases | Medium     | High   | Hybrid TF-IDF + Vector search with tunable weights. SQLite indexes optimized. | ✅ Mitigated |
| Embedding model initial download blocks the server           | Low        | Medium | Background ONNX model loading via `RealVectorStore`, first-use retry logic.   | ✅ Mitigated |
| LLM hallucinates non-existent memory IDs                     | Medium     | Medium | UUID format validation, code fallback lookup, 404 error on not found.         | ✅ Mitigated |
| Context overflow when synthesizing too many memories         | High       | High   | Chunking and dynamic token limitation (max_tokens config) during retrieval.   | ✅ Mitigated |
| Concurrent write conflicts with multi-process access         | Medium     | High   | Cross-process write locking via `proper-lockfile` (`WriteLock.withLock()`).   | ✅ Mitigated |

All risks have been addressed.

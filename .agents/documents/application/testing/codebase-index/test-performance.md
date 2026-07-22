# Test Scenarios: Codebase Index Performance

## Header & Navigation

- [Test Strategy](strategy.md)
- [Indexing Test Scenarios](test-indexing.md)
- [Search Test Scenarios](test-search.md)

Performance benchmarks, resource usage limits, and concurrency guarantees for the Codebase Index feature.

## 1. Index 1000-File TypeScript Project

- **Setup:** Generate 1000 `.ts` files (each 50–200 lines, realistic code patterns) in a temp directory, total ~150K LoC.
- **Action:** Call `codebase-index` with the directory.
- **Measurement:** `process.hrtime.bigint()` before and after; `process.memoryUsage().rss` after GC.
- **Thresholds:**
  - Wall clock: <30 seconds.
  - RSS memory: <512 MB.
  - CPU: Single-core utilization acceptable; no runaway process.

## 2. Search Across 10K Symbols

- **Setup:** Populate `kg_entities` with 10,000 symbols across 500 files. Symbols include varied names, kinds, and file paths.
- **Action:** Execute 100 search queries (mix of exact name, partial name, kind filter, file filter, combined filters).
- **Measurement:** p50, p95, p99 latency across all queries.
- **Thresholds:**
  - p95 latency: <500 ms per query.
  - p99 latency: <1000 ms per query.

## 3. Concurrent Index Requests

- **Setup:** Large indexing operation (simulate ~5s duration using a controllable delay fixture).
- **Action:** Fire 3 simultaneous `codebase-index` calls.
- **Assert:**
  - Exactly 1 call proceeds to `in_progress`.
  - The other 2 return `status: "queued"` immediately (no blocking).
  - After first completes, the next queued call begins automatically.
  - No duplicate symbols or data races in `kg_entities`.

## 4. Memory Usage During Large File Indexing

- **Setup:** Single very large file (10K lines, ~500KB).
- **Action:** Index a directory containing only that large file.
- **Measurement:** `process.memoryUsage().heapUsed` peak during parsing.
- **Threshold:** Peak heap < 256 MB above baseline.
- **Assert:** Tree-sitter AST is garbage-collected after symbol extraction (no reference retention).

## 5. Delta Index on Single Changed File

- **Setup:** Index 500 files. Then modify 1 file (add a function). Record baseline time.
- **Action:** Call `codebase-index` again.
- **Measurement:** Wall clock, files parsed count.
- **Thresholds:**
  - <2 seconds total.
  - Exactly 1 file re-parsed (detected via content hash or mtime).

## 6. Delta Index on Deleted File

- **Setup:** Index 500 files. Delete 1 file.
- **Action:** Call `codebase-index` again.
- **Assert:**
  - <2 seconds total.
  - Symbols from deleted file removed from `kg_entities`.
  - Other 499 files untouched.

## 7. Index Empty Directory — Overhead Test

- **Setup:** Empty temp directory.
- **Action:** Call `codebase-index`.
- **Measurement:** Wall clock.
- **Threshold:** <100 ms overhead (no parsing work, just discovery + response).

## 8. Search Pagination — Large Result Set

- **Setup:** 10K symbols with widely overlapping names so a single query matches 5000 results.
- **Action:** Search page by page (50 per page) until all results consumed.
- **Measurement:** Total time to consume all pages.
- **Threshold:** <2 seconds for full pagination scan (100 requests).

## 9. Cold Start — First Index After Process Start

- **Setup:** Fresh node process, no cached WASM binaries, warm filesystem cache.
- **Action:** Index a 100-file project.
- **Measurement:** Wall clock from process start to response.
- **Threshold:** <10 seconds (includes loading tree-sitter WASM, compiling language grammars).

## 10. SQLite Write Throughput

- **Setup:** 10K symbols from a single index run.
- **Action:** Bulk insert all symbols in one transaction.
- **Measurement:** Time to complete transaction.
- **Threshold:** <5 seconds for 10K rows (single `INSERT` batch or prepared statement loop).
- **Assert:** WAL mode enabled; no `SQLITE_BUSY` errors under single-writer.

## 11. Concurrent Read (Search) During Write (Index)

- **Setup:** In-process index running on a 500-file project (takes ~5s).
- **Action:** Fire 10 concurrent `codebase-search` queries while index is in progress.
- **Thresholds:**
  - All 10 search queries return <1s.
  - No search returns stale or inconsistent state (index uses WAL with snapshots).

## 12. Resource Cleanup After Index Abort

- **Setup:** Start indexing a 1000-file project, then abort (process kill or timeout).
- **Action:** Simulate crash mid-index. Restart and index again.
- **Assert:**
  - No orphaned temporary files remain.
  - `kg_entities` is in a consistent state (previous partial transaction was rolled back).
  - Subsequent index completes normally.

## 13. Index Speed by Language

| Language          | Files | Threshold |
| :---------------- | :---- | :-------- |
| TypeScript        | 500   | <15s      |
| JavaScript        | 500   | <15s      |
| Python            | 500   | <20s      |
| Rust              | 500   | <20s      |
| Go                | 500   | <15s      |
| Mixed (all above) | 2500  | <90s      |

- **Setup:** Per-language fixture with 500 files of realistic complexity.
- **Measurement:** Wall clock per language.
- **Note:** Thresholds assume single-threaded parsing. Multi-threaded parsing may reduce times by 2–4x.

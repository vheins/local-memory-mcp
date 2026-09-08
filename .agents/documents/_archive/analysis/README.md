# Analysis — Bench Results

Bench results: `*.md` + `*.json` pairs (codebase-index, concurrent-workload, embedding-queue, fts5-trigram, memory-write-search, midword-fallback). Raw `*.json` are git-tracked bench outputs; see `optimization/` for shipped designs.

- `codebase-index-bench.md` + `.json` — indexing throughput and incremental re-index
- `concurrent-workload-bench.md` + `.json` — concurrent write/search contention
- `embedding-queue-availability-bench.md` + `.json` — embedding queue availability
- `fts5-trigram-eval.md` + `.json` — FTS5 vs trigram evaluation
- `memory-write-search-bench.md` + `.json` — memory write → search latency
- `midword-fallback-bench.md` + `.json` — mid-word fallback search
- `context-reuse-telemetry.md` — context-reuse telemetry analysis
- `testing-gap-analysis.md` — testing coverage gaps

Also see `../optimization/` for optimization designs derived from these benches.

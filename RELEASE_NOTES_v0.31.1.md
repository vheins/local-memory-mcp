# v0.31.1 — Incremental Reindex

## Key Features

- **Incremental indexing**: Index runs now parse only changed files. A fast mtime pre-filter (with a 2000ms ambiguity margin for coarse-granularity filesystems) marks candidates, and every parse is confirmed by SHA-256 checksum before the parser is invoked. An unchanged repository run parses **zero** files — no more full-tree re-parse on every index.
- **Crash containment**: `unhandledRejection`/`uncaughtException` handlers keep runtime failures from taking down the process, and a startup failure before the server is ready now exits with code 1 instead of hanging on a half-initialized process.
- **Memory safety**: File and symbol inserts are flushed to SQLite per batch (capped to the parser semaphore concurrency) instead of accumulating the whole repository in memory, and WASM tree/parser cleanup is guaranteed via `try/finally`.
- **Staleness accuracy**: The mtime pre-filter uses a 2000ms ambiguity margin (`MTIME_AMBIGUITY_MARGIN_MS`) covering ext3 (1s) and FAT (2s) granularity; ambiguous mtimes are confirmed by checksum in both the planner and `checkStaleness`, so quick edits can no longer be falsely skipped.

## Upgrade Notes

- **No schema migration** — `SCHEMA_VERSION` remains **10**; no additive migrations apply.
- **No new dependencies** and **no configuration changes** — no new env vars, no behavior toggles.
- **Behavior note — incremental reindex**: after upgrading, index runs are incremental. Steady-state runs on an unchanged repository parse zero files; changed/new files are detected by mtime + checksum and parsed normally. No user action required.
- **Startup safety**: if the server fails to initialize (e.g., DB create lock or corruption) it now terminates non-zero instead of hanging — clearer failure signals for supervisors and service managers.
- 853 automated tests passing across the full suite.

## Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for the complete per-commit history.

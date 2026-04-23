# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.42] - 2026-04-23

### Changed

- **Prompts**: Updated `task-memory-executor` so final commit messages must include the task code, and must also include `#<issue_number>` when task metadata references a GitHub Issue.

## [0.8.41] - 2026-04-23

### Fixed

- **Dashboard UI**: Added stable keyed list rendering across modal, drawer, board, stats, and reference components to satisfy Svelte lint requirements and avoid unkeyed list warnings.
- **Reference Experience**: Cleaned up reference drawer/tab state handling and typing to remove lint/type-check issues while preserving existing behavior.
- **Recent Activity**: Fixed scroll listener registration and cleanup in the activity feed to avoid mismatched event handlers.
- **Developer Tooling**: Removed unused variables and replaced loose `any` types in dashboard helpers and seed scripts to restore a fully green lint pipeline.

## [0.8.37] - 2026-04-20

### Changed

- **Prompts**: Added mandatory browser verification step to `task-memory-executor` for UI/UX changes.

## [0.8.36] - 2026-04-20

### Added

- **Dashboard**: Task hierarchy and dependency visualization in Kanban and detail drawer.

## [0.8.35] - 2026-04-19

### Changed

- **Prompts**: Updated `task-memory-executor` to include task decomposition rules and a 4 sub-agent limit.

## [0.8.4] - 2026-04-13

### Fixed

- **Dashboard**: Added 404 and unhandled error handling to the dashboard server.

## [0.8.3] - 2026-04-13

### Changed

- **Documentation**: Updated CHANGELOG.md with missing version history for 0.8.x series.

## [0.8.2] - 2026-04-13

### Fixed

- **Database**: Implemented `proper-lockfile` based `WriteLock` for exclusive write serialization across concurrent processes.
- **Database**: Added `wal_checkpoint(PASSIVE)` on refresh to ensure dashboard sees latest data.
- **Database**: Added startup `wal_checkpoint(TRUNCATE)` and integrity checks with auto-recovery.
- **Database**: Improved responsiveness with 30s `busy_timeout` and lowered `wal_autocheckpoint` (100 pages).

## [0.8.1] - 2026-04-13

### Fixed

- **Database**: Enhanced multi-agent safety with `synchronous=FULL` and WAL autocheckpointing.
- **Database**: Wrapped bulk operations (insert/update/delete) in transactions for consistency.
- **Dashboard**: Added singleton guard to prevent multiple instances on the same port.

## [0.8.0] - 2026-04-13

### Added

- **Linting**: Upgraded ESLint to v10 and updated configuration to the new flat config format.

### Changed

- **Database Engine**: Migrated from `sql.js` (WASM) back to `better-sqlite3` (native) for improved performance.
- **Task Management**: Added column whitelisting in `updateTask()` for SQL injection prevention.
- **Memory Recap**: `contentSummary` is now always generated (no longer gated on structured flag).
- **Search**: Improved recap determinism by sorting by importance DESC and created_at ASC.

### Fixed

- **Tests**: Fixed all failing tests after migration to better-sqlite3.

## [0.7.2] - 2026-04-12

### Fixed

- **Dashboard**: Fixed an issue where running the dashboard script would incorrectly spawn another instance of the dashboard instead of the MCP server, causing a JSON parse error and an endless restart loop.

## [0.7.1] - 2026-04-12

### Fixed

- **Dashboard Reference Tab**: Fixed JSON:API extraction logic to correctly expose tool and resource names to the UI.
- **Prompts**: Fixed an issue where prompts failed to load in production builds because of chunking-related path resolution.

## [0.6.3] - 2026-04-12

### Fixed

- **Dashboard Reference Tab**: Fixed "Unknown Tool" issue after hard refresh by adding JSON:API response handling in frontend API deserializer
- **Reference Drawer**: Fixed console errors when accessing undefined properties using optional chaining (`resource?.data?.uri`)
- **MCP Test Suite**: Fixed 191 tests that were failing due to async SQLiteStore initialization after sql.js migration

### Changed

- **Test Descriptions**: Converted all test descriptions from Indonesian to English
- **API Response Format**: Capabilities endpoint now returns proper JSON:API compliant format with `type`, `id`, and `attributes` for tools, prompts, and resources

## [0.6.2] - 2026-04-12

### Changed

- **Database Migration**: Replaced `better-sqlite3` with `sql.js` (WASM-based) to eliminate native binary compilation issues
- **MCP Logging Fix**: Disabled stderr logging when running as MCP server to prevent connection issues (stdin/stdout reserved for JSON-RPC)
- **Search Fallback**: Removed FTS5 dependency (not supported in sql.js), using LIKE-based search with bag-of-words similarity

### Fixed

- Runtime errors caused by Node.js version mismatch with native SQLite bindings
- MCP server connection drops due to stderr pollution

## [0.6.0] - 2026-04-12

### Added

- **Hybrid Search Strategy**: Implemented 70% Vector and 30% FTS5 weighting for repository-wide context research.
- **Similarity Conflict Detection**: Enforced a 0.55 similarity threshold for `memory-store` to prevent redundant knowledge entries.
- **Task Lifecycle Safety**: Mandatory transition requirement for tasks to pass through `in_progress` status before reaching `completed`.
- **Automatic Task Archiving**: Automatic creation of `task_archive` memory entries upon task completion, including full history and token metrics.

### Changed

- **Behavioral Rule Alignment**: Updated global `GEMINI.md` rules and `.agents` workflow source files to strictly follow the new technical constants (70/30 weighting, 0.55 threshold).
- **Prompt Synchronization**: Refactored `task-memory-executor`, `create-task`, and audit prompts to align with the core PRD/TDD implementation logic.

## [0.5.33] - 2026-04-11

- Initial public release of stable memory toolset.

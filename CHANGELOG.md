# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.14.7] - 2026-06-03

### Changed

- **Delete Confirmations**: Replaced all native browser `confirm()`/`alert()` with SweetAlert2 modals across the dashboard UI. Delete confirmations now use styled, theme-aware dialogs.

## [0.14.6] - 2026-06-03

### Fixed

- **Dashboard Icons**: Resolved 13 broken icon references across the Svelte UI. Added 10 missing SVG icon definitions to `Icon.svelte`. Replaced nonexistent icon names (`x-circle`, `trash-2`, `edit-2`, `pencil`, `circle-alert`, `save`, `loader`, `check-check`) with valid equivalents. svelte-check: 0 errors.

## [0.14.5] - 2026-06-03

### Added

- **Bulk CRUD**: Bulk create, read, update, delete for memories and coding standards.
- **N+1 Elimination**: Optimized query patterns to eliminate N+1 in bulk operations.
- **Parent Code Resolution**: `parent_id` now accepts task codes and standard codes, resolved to UUIDs before storage.

## [0.14.4] - 2026-05-24

### Changed

- **Prompt Definitions**: Aligned all 25 prompt definitions with skill files from vibe-coding-premium. Arguments made required where appropriate, added context resolution removal, FSM pipeline format for technical-planning, blueprint orchestration and sprint plan import sections for create-task, standardized commit format with keyword-based issue references.

## [0.14.3] - 2026-05-22

### Security

- **protobufjs**: Updated to v7.5.8 via override to fix 8 advisories (code injection, DoS, prototype pollution, etc.).
- **brace-expansion**: Updated to v5.0.6 via override to fix DoS vulnerability.
- **svelte**: Updated to v5.55.9 to fix 4 XSS/ReDoS advisories.

## [0.14.2] - 2026-05-22

### Fixed

- **DocuBook Branding**: Corrected display name from "Docubook" to "DocuBook" in Reference tab ecosystem section.

## [0.14.1] - 2026-05-22

### Fixed

- **Brand Name**: Corrected "Docubook" to "DocuBook" in changelog.

## [0.14.0] - 2026-05-22

### Added

- **Ecosystem Section**: Added "Ecosystem" as a Reference category filter with TopBar navigation and dedicated section showing partner tools (DocuBook).
- **FloatingChat**: Replaced QuickCreateFAB with a WhatsApp-style floating chat popup (380x560px) for quick backlog task creation.
- **Chat Input**: Added send panel to Activity tab for creating backlog tasks directly from chat input.
- **Donation Link**: Added coffee/donation link (teer.id) to TopBar external links group.
- **Handoffs Redesign**: Redesigned handoffs as a table (From, To, Task, Summary, Status, Created, Expires) with slide-over DetailDrawer, matching Standards/Memory pattern.
- **Security & Entity Refactoring**: Security fixes, entity refactoring, WriteLock improvements, StubVectorStore fallback, task-search tool, ttlDays fix.

### Changed

- **Sidebar Navigation**: Moved global nav (Agent Arena, Dashboard, Standards, Reference) to sidebar above Repositories; tab bar stays visible regardless of active sidebar nav tab.

### Fixed

- **Chat Flow**: Chat input now stores message in description while title is auto-generated (Chat · HH:mm); full refresh triggered after send.
- **Reference Tab**: Fixed not loading when clicked from sidebar nav by watching `$app.tab` reactively.
- **Standards Drawer**: Fixed not opening due to null `selectedStandard` — using sentinel object for mode detection.
- **Table Background**: Added solid background to tables to prevent transparency issues.
- **Svelte 5**: Replaced `bind:value` with `value + on:input` for Svelte 5 compatibility.
- **Sidebar Scroll**: Fixed scroll visibility and handoff loading stuck issue.
- **Misc**: Changed "Donasi" to "Donate" in TopBar; added taskStats/taskComments mocks to router tests.

## [0.13.2] - 2026-05-20

### Added

- **Code-based Lookup**: Added optional `code` param to `memory-update`, `memory-delete`, `memory-acknowledge`, `standard-update`, `standard-delete` tools.
- **Task Code Lookup**: Added optional `task_code` param to `task-delete` tool.

### Fixed

- Fixed pre-existing bug in `TasksController` passing null `commit_id` to Zod schema.

## [0.13.1] - 2026-05-14

### Changed

- **Task Executor**: Replaced weak `Repeat` step with `Loop → CONTINUOUS EXECUTION MODE` — agent now loops through pending/backlog/stale/handoff until queue is truly empty.

## [0.13.0] - 2026-05-11

### Added

- **Task Git Traceability**: Added `commit_id` and `changed_files` columns to tasks table for git commit traceability.
- **task-update**: Schema now accepts optional `commit_id` (string) and `changed_files` (string array) when marking tasks as completed.
- **Task Archive**: Archived memory now includes commit hash and changed files list.

## [0.12.1] - 2026-05-10

### Changed

- **task-list**: Added `phase` column to non-structured summary output for better task discovery.

## [0.12.0] - 2026-05-05

### Added

- **Dashboard Theme**: Added automatic light/dark switching based on time of day while preserving manual override.

### Changed

- **Dashboard UX**: Clarified Standards and Handoffs tabs with better labels, summaries, and status context.
- **Theme Toggle**: Kept the existing manual toggle and added `Shift+click` to return to auto mode.

## [0.10.11] - 2026-04-30

### Changed

- **Task Executor**: Updated runner identity resolution to support multiple terminal sessions by using provided `agent_identity` or auto-generated `<runner>-<randomName>` identity from active CLI/IDE with session token.
- **Task Executor**: Explicitly requires the same runner identity to be written into claim/update/handoff metadata for better cross-session attribution.
- **Prompts**: Preserved dependency-aware execution checks while making runner identity configurable and session-aware.

## [0.10.10] - 2026-04-30

### Changed

- **Task Executor**: Enforced dependency-aware execution order in `task-memory-executor` by requiring `depends_on` and `parent_id` prerequisites before execution and adding blocked-task skipping logic.
- **Task Executor**: Added readiness re-check after hydration so unresolved dependencies are re-evaluated before claim.
- **Prompts**: Added prompt-level regression test coverage for dependency-aware execution and readiness checks.

## [0.10.8] - 2026-04-28

### Changed

- **Prompts**: Reduced sub-agent spawn limit from 4 to 2 in `task-memory-executor` prompt to improve focus and reduce overhead.

## [0.10.7] - 2026-04-28

### Changed

- **Agent Arena**: Made in-progress agents visibly busy with typing arm movement, body motion, head bobbing, and key-tap effects.

## [0.10.6] - 2026-04-28

### Added

- **Agent Arena**: Added status-aware animated monitor screens for workstations, including active coding, pending docs, blocked terminal, and idle displays.

## [0.10.5] - 2026-04-28

### Fixed

- **Agent Arena**: Kept Therapy Room handoff animations and beds inside room bounds by sharing clamped slot positioning between scene layout and rendering.

## [0.10.4] - 2026-04-28

### Fixed

- **Agent Arena**: Prevented active claimed tasks from being marked stale and sending agents to the Therapy Room while work is still in progress.

## [0.10.1] - 2026-04-27

### Changed

- **Agent Standards Gate**: Strengthened server, tool, and prompt instructions so `standard-search` is mandatory before code edits, test edits, refactors, migrations, or implementation decisions.

## [0.10.0] - 2026-04-27

### Added

- **Dashboard Standards**: Added JSON export and import flows for coding standards so standards can be moved between devices.
- **Dashboard API**: Added standards export/import endpoints with upsert semantics and large import support for thousands of standards.

### Changed

- **Dashboard**: Increased JSON payload capacity and skips vector refresh automatically for large standards imports to avoid migration timeouts.

## [0.9.17] - 2026-04-27

### Changed

- **Prompts**: Made `standard-search` mandatory for every `task-memory-executor` task loop iteration before implementation, including decomposed and sub-agent tasks.

## [0.9.15] - 2026-04-25

### Fixed

- **Agent Arena**: Fixed handoff animation stuck on pickup phase due to time base mismatch (Date.now vs performance.now).
- **Agent Arena**: Ensured agents remain in a 'resting' visual state in the therapy room after arrival instead of resetting to normal sprites.

## [0.9.14] - 2026-04-25

### Added

- **Agent Arena**: RPG-style characters with detailed sprites (shoes, pants with walk swing, shirt, swinging arms, head with gradients).
- **Agent Arena**: Realistic room environments with 6 distinct floor textures and room-specific furniture (sofa, reception desk, clock, whiteboard, hazard sign).
- **Agent Arena**: Animated workstations with monitors and typing animation.
- **Agent Arena**: Ambient lighting overlays per zone.

### Changed

- **Agent Arena**: Implemented biome logic for arena floor rendering.
- **Agent Arena**: Increased Vite chunk size limit for complex dashboard UI.

## [0.9.13] - 2026-04-25

### Added

- **Agent Arena**: gather.town-style 2D world with walking agents and specialized rooms.
- **Agent Arena**: Organic wander behavior for idle agents in the Lobby.
- **Agent Arena**: Handoff beams with animated particles.

## [0.9.12] - 2026-04-25

### Added

- **Dashboard**: Added "Agent Arena" tab for real-time agent activity visualization using high-performance canvas rendering.

## [0.9.11] - 2026-04-25

### Added

- **MCP**: Injected server instructions into MCP initialize response to improve agent behavior alignment.

## [0.9.10] - 2026-04-25

### Changed

- **Prompts**: Clarified task priority semantics across all agent prompts.

## [0.9.9] - 2026-04-25

### Added

- **Dashboard**: Added coordinated dashboard orchestration flow.

## [0.9.8] - 2026-04-25

### Added

- **Coding Standards Search**: Added `matched_terms` to `standard-search` results and text summaries so agents can see exactly which query terms matched each standard.

## [0.9.7] - 2026-04-25

### Changed

- **Coding Standards Search**: Improved `standard-search` ranking so exact keyword matches rank ahead of generic matches using a stronger keyword relevance signal.

### Added

- **Coding Standards Search**: Added `confidence` and numeric `score` fields to `standard-search` results to help agents judge match quality faster.

## [0.9.6] - 2026-04-25

### Fixed

- **Coding Standards Search**: Updated `standard-search` text summaries to show short standard codes instead of UUIDs so follow-up `standard-detail` calls consume fewer tokens.
- **Tests**: Added regression coverage for the `standard-search` text output contract.

## [0.8.43] - 2026-04-24

### Added

- **Dashboard**: Added first-class Standards and Handoffs tabs for coding standard search/create, handoff creation/listing, and task claims.
- **Coding Standards**: Added `standard-store` and `standard-search` MCP tool routing with SQLite-backed coding standard storage.

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

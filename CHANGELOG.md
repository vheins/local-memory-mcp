# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.20.1] — 2026-07-22

### Fixed

- **Dashboard "Index Now" button**: Was a no-op placeholder; now calls `codebaseReindex` API and reloads index status after triggering.
- **search_symbols registration**: MCP tool `search_symbols` was missing proper tool definition in server registration — added with correct schema.
- **repoPath auto-resolution**: `repoPath` no longer required from the UI. Server resolves it automatically from `CODEBASE_REPOS_DIR`, CWD parent, or candidate directory checks.

## [0.20.0] — 2026-07-22

### Added

- **Codebase Index**: tree-sitter WASM parser for TypeScript/JavaScript/TSX/JSX with language-specific visitors extracting functions, methods, classes, interfaces, types, enums, and variables.
- **Codebase Index**: file discovery with gitignore and glob support — `fast-glob` stream mode, custom include/exclude patterns, default exclusions for build artifacts.
- **Codebase Index**: SQLite-backed symbol storage with FTS5 full-text search — two new tables (`codebase_files`, `codebase_symbols`) with auto-synchronized FTS5 virtual table via database triggers.
- **MCP Tools**: 6 new tools — `index_repository` (incremental with SHA-256 checksums), `search_symbols` (5-tier ranked search), `get_file_symbols` (per-file declarations), `get_architecture` (directory tree + language breakdown), `trace_symbol` (definition + references), `index_status` (index state check).
- **Dashboard**: Codebase tab with file tree, symbol explorer, search bar, and index status.
- **CLI**: `--index` flag for server startup indexing with progress output.
- **Docs**: API reference, feature guide, and operations guide for Codebase Index.

## [0.19.24] - 2026-07-20

### Fixed

- **Bulk task-create NULL id**: Fixed bug where `resolveEntityCode()` deduplication of task codes (e.g., `FIX-1` → `FIX-1-0e14`) caused `localCodeMap` lookup to return `undefined`, inserting NULL primary keys. Tasks with NULL `id` then caused `NOT NULL constraint failed: claims.task_id` on claim attempts. Fix uses `randomUUID()` fallback and maps resolved code back into `localCodeMap`.

## [0.19.17] - 2026-07-12

### Fixed

- **memory-acknowledge tool description**: Added explicit usage example (`{ code: "MEM-123", status: "used" }`) to tool description and Zod schema `.describe()` to prevent agents from inventing incorrect parameter names like `relevant=false`.

### Changed

- **Tool definitions type-check**: Minor.

## [0.19.16] - 2026-07-12

### Fixed

- **Zod schema type coercion**: All number fields (`importance`, `priority`, `limit`, `offset`, `est_tokens`, `minImportance`, `ttlDays`, `max_iterations`, `max_tokens`) now use `z.coerce.number()` to accept both string and number inputs. Fixes `"expected number, received string"` errors when MCP frameworks serialize numeric params as strings.

## [0.19.2] - 2026-07-06

### Added

- **kg-backfill tool**: Batch scan all existing memories/standards and extract KG entities via compromise NLP. Supports per-repo or full-database operation. Run once to populate the Knowledge Graph from historical data. Backfilled 425K+ entities across 45 repos.

### Fixed

- **Handoff owner validation**: Handoff tools (`handoff-create`, `handoff-list`, `task-claim`, `claim-list`, `claim-release`) now gracefully handle missing `owner` parameter when MCP clients connect without workspace roots. Zod schemas fall back to empty string instead of throwing `invalid_type`.

## [0.19.1] - 2026-07-06

### Refactored

- **Icon.svelte**: Extracted SVG icon data to `lib/icons/iconData.ts`. Reduced from 1739 to 33 lines.
- **KGGraph.svelte**: Decomposed into `KGForceLayout.ts`, `KGCanvasRenderer.ts`, `KGModal.svelte`. Reduced from 1076 to 527 lines. Force layout uses `Map` lookup (O(1) vs O(n²)).
- **ExportToolbar**: Shared component extracted from duplicate export buttons in KanbanBoard and MemoryList.
- **RepoItem**: Shared component extracted from duplicate pinned/unpinned repo item templates in RepoSidebar.
- **Chat logic**: Duplicate `sendChat` code in App.svelte and FloatingChat.svelte unified via `createChatTask()` utility.
- **DetailDrawer**: Replaced fragile `$$props` introspection with explicit `drawerMode` prop (Svelte 5 readiness).

### Fixed

- **Inline SVGs**: Replaced 5 locations with centralized `<Icon>` component (KanbanBoard, TaskDetailPanel, DetailDrawer, MemoryList).
- **Magic numbers**: Named constants for timeouts (`TAB_SWITCH_DEBOUNCE_MS`, `DRAWER_CLOSE_TRANSITION_MS`, `ARENA_INIT_DELAY_MS`).
- **Error states**: Added error banners to MemoryList and StatsWidget.
- **Cryptic names**: Renamed `raStore`/`raPage` → `actionsStore`/`actionsPage` in FloatingChat.
- **Duplicate icon**: `memory` icon now unique (chip design) instead of subset of `brain`.
- **Accessibility**: Added `role="tablist"`, `role="tab"`, `aria-selected`, and `aria-live="polite"` to tab navigation.

## [0.19.0] - 2026-07-06

### Added

- **SDK Migration**: Migrated from custom JSON-RPC to `@modelcontextprotocol/server` v2 beta. All 27+ tools registered via `registerTool()`, resources/prompts via SDK. Replaced custom `MCPClient` with SDK `Client` + `StdioClientTransport`.
- **Agentic Tools**: 3 new agentic productivity tools — `agent-context` (session context recall), `decision-log` (structured decision persistence), `session-summarize` (session archive).
- **Upstream Aliases**: `remember_fact`, `remember_facts`, `recall`, `forget` — drop-in compatibility with `Beledarian/mcp-local-memory` clients.
- **Knowledge Graph**: 3 new database tables (`entities`, `relations`, `observations`) with cascading FK constraints. 5 CRUD tools (`create-entity`, `delete-entity`, `create-relation`, `delete-relation`, `delete-observation`) with SQLite transactions and FK validation.
- **NLP Archivist**: Automatic entity extraction via `compromise` library (people, places, organizations, concepts) on every memory-store — zero-dependency, local-only.
- **Time Tunnel**: Relative date filtering in `memory-search` — supports "today", "yesterday", "last week", "last month", "last N days", "last hour".
- **Soul Maintenance**: Biological-style memory decay engine with tag-based immunization. Startup maintenance job sweeps decayed memories (24h dedup).
- **Dashboard Knowledge Graph**: Interactive force-directed canvas graph (custom Canvas 2D renderer) with type-colored nodes, edge labels, tooltip inspection, and Add/Delete Entity/Relation modals.

### Changed

- **Protocol Layer**: `server.ts` reduced from 398 lines to 91 lines using SDK's `serveStdio()`. Session, progress, cancellation, completion, and log notifications wired to SDK.
- **Tool Registration**: All tool handlers moved from `router.ts` switch-case to `tools/index.ts` via `registerTool()`. Write-lock, action logging, and resource mutation notifications handled centrally.

### Fixed

- **Lint Hygiene**: 22 unused-variable and dead-code issues resolved across 9 files.
- **Test Client**: `MCPClient` now uses SDK `Client` + `InMemoryTransport` — removed 236 lines of custom JSON-RPC client code.

## [0.18.1] - 2026-06-23

### Fixed

- **Required `owner` Parameter**: Fixed 5 MCP tool schemas where `owner` was optional with `default("")`, causing SQL queries to silently return no results. `task-detail`, `task-update`, `task-delete`, `claim-release`, and `standard-store` now require a non-empty `owner` string. MCP input schemas updated to expose the `owner` parameter.
- **Argument Order Bug**: Fixed `isTaskCodeDuplicate` call in `task.manage.ts` that was passing `repo` in the `owner` parameter position, silently disabling duplicate task code detection.
- **Wrong Owner Attribution**: Fixed `handoff.manage.ts` that was storing the repo name (`owner: repo`) instead of the actual owner (`owner: owner`) in task comments during claim operations.

## [0.18.7] - 2026-06-23

### Fixed

- **Memory Entity Owner Fallback**: Added conditional owner filtering in `searchByRepo()`, `getRecentMemories()`, `getTotalCount()`, and `getAllMemoriesWithStats()` — same fix pattern as task entity. Methods now skip the `owner = ?` clause when owner is empty, preventing cross-owner invisibility.

### Changed

- **Memory Entity**: All 4 list/query methods now handle empty owner consistently, matching the task entity pattern.

## [0.18.6] - 2026-06-23

### Changed

- **Owner Field Descriptions**: Updated all 20 `owner` field descriptions in MCP tool definitions to explicitly warn agents NOT to use their agent name as the owner. Added "Owner Rule (CRITICAL)" section to server instructions with examples and violation consequences. Added warning log when owner is inferred from session.

## [0.18.5] - 2026-06-23

### Fixed

- **getTaskByCode Fallback**: When querying by task_code with a specific owner fails, automatically retry without the owner filter. This ensures tasks created via the Dashboard (with empty owner) can be found by MCP API calls (which pass non-empty owner), and vice versa.

## [0.18.4] - 2026-06-23

### Fixed

- **Migration Dedup SQLite Syntax**: Fixed `OFFSET 1` without `LIMIT` in deduplication query, which caused `SQLITE_ERROR` on databases with existing duplicate task codes.

## [0.18.3] - 2026-06-23

### Fixed

- **Migration Auto-Deduplication**: Fixed migration to automatically deduplicate existing (owner, repo, task_code) rows before creating the UNIQUE INDEX, instead of throwing an error and blocking startup.

## [0.18.2] - 2026-06-23

### Fixed

- **Task Code Duplication**: Added database-level UNIQUE constraint on `(owner, repo, task_code)` to prevent duplicate task codes. Added clear error handling for constraint violations.
- **Owner Consistency**: Fixed `getTaskByCode`, `isTaskCodeDuplicate`, and `getExistingTaskCodes` to handle empty owner strings consistently, resolving "Task not found" errors for tasks created via the dashboard with empty owner.
- **Search Consistency**: Fixed `task-search` to produce identical results in text and structured modes by using explicit all-status enumeration.
- **task-list Status Filter**: Added `"all"` option to `status` parameter documentation, allowing listing all task statuses in a single call.

## [0.17.0] - 2026-06-23

### Added

- **Multi-Owner Support**: Added `owner` field across all entities — memories, tasks, standards, handoffs, claims, comments, and summaries. All tools now accept an `owner` parameter. Repo names can optionally be specified as `owner/repo` format, which auto-parses via `parseRepoInput`.
- **Owner-Scoped Code Generation**: Sequential codes (`TASK-001`, `MEM-001`, `STD-001`) are now scoped per-owner per-repository instead of per-repository only, preventing code collisions across different users/organizations sharing the same repo name.
- **Improved Schema Validation**: `required_skills` and `fsm_gates` metadata validation now produce clearer, multi-line error messages for better debugging.

### Changed

- **Database Schema**: Added `owner TEXT NOT NULL DEFAULT ''` column to all tables (`memories`, `tasks`, `standards`, `handoffs`, `claims`, `task_comments`, `memory_summary`, `memories_archive`, `action_logs`). `memory_summary` primary key changed from `repo` to `(owner, repo)` composite key.
- **Code Generator**: `generateNextCode()` now requires an `owner` parameter; SQL queries filter by both owner and repo.
- **Tool Schemas**: All tool input schemas updated with optional/default `owner` field (store, search, recap, detail, delete, summarize, synthesize, acknowledge, manage).
- **Tests**: All test suites updated to include `owner` in mock data and assertions. 283 tests passing across 34 test files.
- **Dashboard Controllers**: API endpoints updated to pass `owner` through to entity operations.

## [0.17.0] - 2026-06-23

### Added

- **Auto-Promote on Claim**: `task-claim` now automatically transitions the task status to `in_progress` when the current status is not `completed`, and records a comment with the claiming agent and status transition metadata.

## [0.16.0] - 2026-06-09

### Added

- **6 Software Engineering Analyst Roles**: New slash command prompt definitions for structured SDLC workflows:
  - **Scrum Master** — Sprint planning, retrospectives, backlog grooming, and impediment resolution.
  - **Business Analyst** — Stakeholder requirement extraction, user story mapping, and acceptance criteria writing.
  - **System Analyst** — Architecture design, database schema planning, and API contract design.
  - **QA Analyst** — Test scenario design (positive/negative/monkey/security), QA execution, and regression testing.
  - **Data Analyst** — Data modeling, query optimization, schema planning, and migration testing.
  - **Security Analyst** — Security triage, vulnerability assessment, penetration test planning, and threat modeling.
- **Agent Labels**: Server instructions now display an `agent:` label next to each prompt, enabling clients to display role badges.

### Changed

- **Prompt Pagination**: Increased default limit from 25 to 50 to accommodate the growing prompt library.

## [0.15.0] - 2026-06-07

### Added

- **Sequential Auto-Generated Codes**: Task, memory, and standard codes are now auto-generated when omitted. Patterns: `TASK-001`, `MEM-001`, `STD-001` (sequential per repository).
- **Optional `task_code`**: No longer required during task creation. Omit to get a sequential `TASK-xxx` code, or provide a custom code as before.
- **`suggested_skills` Field**: Tasks can now carry a `suggested_skills` array. The task-memory-executor prompt reads this field and loads each skill via the `skill()` tool before execution.
- **Cross-Reference Resolution**: `depends_on` and `parent_id` now auto-resolve task codes within the same batch creation request, eliminating ordering constraints.

### Changed

- **Memory Codes**: Replaced random 6-char codes with sequential `MEM-001` format.
- **Standard Codes**: Replaced random 6-char codes with sequential `STD-001` format.
- **Prompt Tests**: Updated assertions to match current FSM prompt formatting.
- **Documentation**: Updated `tools-reference.md` (EN/ID) and workflow prompts to reflect optional `task_code`, sequential codes, and `suggested_skills`.

## [0.14.10] - 2026-06-03

### Fixed

- **Cross-Reference Resolution**: `depends_on` and `parent_id` in bulk task creation now auto-resolve task codes within the same request batch.

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

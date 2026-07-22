# Sprint 9: Dashboard & Auto-Index 🚧

**Sprint Goal:** Surface codebase index data in the Svelte 5 dashboard — add a dedicated "Codebase" tab with file tree, symbol list, detail panel, and search bar. Implement automatic indexing when a project is opened via the dashboard.

**Duration:** 2 weeks (10 working days)

**Dependencies:** Sprint 8 (MCP tools `search_symbols`, `get_file_symbols`, `get_architecture` must be stable and tested). The dashboard Express API layer must be able to call these tools internally.

---

## Backlog Items

### CI-16: Codebase Tab UI Shell & Routing (Effort: 2 days)

**Owner:** frontend

**Description:** Add a "Codebase" tab to the dashboard's top navigation bar. Implement the routing shell that switches between the existing Memory/Tasks/Standards tabs and the new Codebase tab.

**Acceptance Criteria:**

- [ ] "Codebase" tab visible in the top navigation bar alongside existing tabs (Home, Memory, Tasks, Standards, etc.)
- [ ] Clicking the tab navigates to `/codebase` route without page reload
- [ ] Tab is highlighted when active
- [ ] URL updates correctly on navigation (`/codebase`)
- [ ] Tab order: Home, Memory, Tasks, Standards, **Codebase**, Handoffs
- [ ] If no repository is selected, show a prompt: "Select a repository to view its codebase index."
- [ ] If the selected repository has no index, show an "Index Now" button that triggers indexing
- [ ] Layout shell for the codebase page: left sidebar (file tree) + right content area (symbol list or detail) — consistent with existing dashboard layout patterns
- [ ] Responsive: on narrow screens, sidebar becomes a collapsible drawer

**Technical Notes:**

- Follow existing routing pattern in `src/dashboard/ui/src/App.svelte` or router config
- New component: `src/dashboard/ui/src/components/CodebasePage.svelte` (root page component)
- New route: `/codebase`
- See existing `MemoryList.svelte`, `KanbanBoard.svelte` for layout reference

---

### CI-17: FileTree Component (Effort: 3 days)

**Owner:** frontend

**Description:** Build a `FileTree` Svelte component that renders the codebase file structure as a collapsible tree view. Fetches architecture data from `get_architecture` MCP tool via the dashboard API.

**Acceptance Criteria:**

- [ ] Tree view renders directories and files in hierarchical structure
- [ ] Directories are collapsible/expandable with click
- [ ] Directories show file/symbol count badge (e.g., `src/ (12 files, 45 symbols)`)
- [ ] File icons or suffix labels indicate file type (`.ts`, `.tsx`, `.js`, `.jsx`)
- [ ] Clicking a file selects it and triggers symbol list load in the content area
- [ ] Active/selected file is highlighted
- [ ] Virtual scrolling for large trees (>1000 files) — only visible nodes rendered
- [ ] Search/filter input at the top of the tree to filter files by name
- [ ] Loading state: skeleton placeholder while architecture data loads
- [ ] Empty state: "No files indexed. Run index to populate."
- [ ] Error state: retry button if architecture fetch fails
- [ ] Deeply nested directories (depth >5) show a "show more" expand prompt

**Technical Notes:**

- Component path: `src/dashboard/ui/src/components/CodebaseFileTree.svelte`
- Fetches from `get_architecture` tool via dashboard API proxy
- Uses Svelte 5 runes (`$state`, `$derived`, `$effect`) for state management, consistent with existing composables
- Reference existing `KGForceLayout.ts` for complex component pattern

---

### CI-18: SymbolList & SymbolDetail Components (Effort: 3 days)

**Owner:** frontend

**Description:** Build `SymbolList` and `SymbolDetail` Svelte components that display symbols for a selected file, and allow drilling into a symbol's definition, signature, doc comments, and references.

**Acceptance Criteria:**

- [ ] `SymbolList` component:
  - Shows all symbols in the selected file, grouped by kind (Functions, Classes, Interfaces, Types, Enums, Variables)
  - Each symbol row shows: icon (by kind), name, signature (truncated), export badge if exported
  - Clicking a symbol opens the detail panel
  - Sort order: declaration order within each group
  - Empty state: "No symbols found in this file."
- [ ] `SymbolDetail` component:
  - Full symbol name with kind icon and export badge
  - Signature: full function/type signature in monospaced font
  - Doc comment: rendered markdown (if present), or "No documentation" placeholder
  - Location: file path, line:column range, with a "Jump to line" button (future: opens in editor)
  - References section: list of files that reference this symbol (from `trace_symbol`), each with file path and line number
  - Related symbols: other symbols in the same file or that share the same prefix
  - Loading state per section (references load asynchronously)
- [ ] Both components load data from dashboard API proxy (which calls MCP tools)
- [ ] Both components handle errors gracefully with retry options

**Technical Notes:**

- Component paths:
  - `src/dashboard/ui/src/components/CodebaseSymbolList.svelte`
  - `src/dashboard/ui/src/components/CodebaseSymbolDetail.svelte`
- API calls: `get_file_symbols` for list, `trace_symbol` for detail
- Reference `MemoryDetailPanel.svelte` for detail panel patterns

---

### CI-19: SearchBar with Autocomplete (Effort: 2 days)

**Owner:** frontend

**Description:** Build a global `CodebaseSearchBar` component with autocomplete dropdown that searches symbols across the current repository. Provides quick navigation to symbol definitions.

**Acceptance Criteria:**

- [ ] Search bar positioned at the top of the codebase tab (prominent, full-width)
- [ ] Placeholder text: "Search symbols in this repository..."
- [ ] Minimum 2 characters to trigger search
- [ ] Debounced input (300ms) — no request on every keystroke
- [ ] Autocomplete dropdown shows top 10 results grouped by kind
- [ ] Each autocomplete item shows: icon (by kind), name, file path (truncated), line number
- [ ] Results ranked by relevance (exact > prefix > substring — uses `search_symbols` tool)
- [ ] Keyboard navigation: arrow keys to select, Enter to open detail, Escape to close
- [ ] Click outside dropdown closes it
- [ ] Loading state: spinner in the search bar while fetching
- [ ] Empty state: "No symbols found for '<query>'"
- [ ] Error state: "Search failed. Try again." with retry
- [ ] Selecting a result navigates to the symbol detail view for that symbol
- [ ] Search bar persists across navigation within the codebase tab

**Technical Notes:**

- Component path: `src/dashboard/ui/src/components/CodebaseSearchBar.svelte`
- Uses `search_symbols` tool with `limit: 10`
- Debounce via `$effect` with timeout, following existing patterns in composables

---

### CI-20: IndexStatus Widget (Effort: 1 day)

**Owner:** frontend

**Description:** Build a small `IndexStatus` widget that shows the current index state for the active repository: last indexed time, file/symbol counts, and re-index actions.

**Acceptance Criteria:**

- [ ] Widget shows below the search bar or in a sidebar section
- [ ] Displays: "Indexed <N> symbols across <M> files" with a timestamp
- [ ] "Last indexed: 2 hours ago" (human-readable relative time)
- [ ] "Re-index" button that triggers `index_repository`
- [ ] Progress indicator during indexing: "Indexing... 45/120 files parsed"
- [ ] Status colors: green (indexed < 1hr ago), yellow (indexed > 24hrs ago), red (never indexed)
- [ ] Error state if index fetch fails
- [ ] Auto-refreshes status every 60 seconds
- [ ] Polls for indexing progress if a re-index is in progress

**Technical Notes:**

- Component path: `src/dashboard/ui/src/components/CodebaseIndexStatus.svelte`
- Uses dedicated dashboard API endpoint `/api/codebase/index-status`
- Relative time formatting via existing utility or `Intl.RelativeTimeFormat`

---

### CI-21: Auto-Index on Project Open (Effort: 2 days)

**Owner:** backend

**Description:** Implement auto-indexing triggered when the dashboard opens a project or when the MCP server detects a new repo context. Adds `autoIndex` configuration option.

**Acceptance Criteria:**

- [ ] Server-side: `CodebaseIndexService.autoIndexIfStale(repoPath)` checks `last_indexed_at` — if never indexed or index is >24 hours stale, triggers indexing
- [ ] Dashboard API endpoint: `POST /api/codebase/auto-index` — called when a repository is selected in the dashboard
- [ ] Backend respects `autoIndex` config flag in server settings (opt-in by default)
- [ ] If indexing is already in progress for the same repo, skip (no duplicate)
- [ ] Indexing runs asynchronously — does not block the dashboard API response
- [ ] Dashboard polls `/api/codebase/index-status` to show progress
- [ ] Configurable staleness threshold (default: 24 hours, override via `CODEBASE_AUTO_INDEX_TTL` env var)
- [ ] `autoIndex` can be disabled entirely via `CODEBASE_AUTO_INDEX=false`
- [ ] Logs: "Auto-index started for repo/repo-name" and "Auto-index complete: 45 files, 230 symbols"

**Technical Notes:**

- Dashboard API controller: `src/dashboard/controllers/codebase-controller.ts`
- Indexing runs in a background promise (fire-and-forget with progress storage)
- Progress state stored in-memory (`Map<repo, IndexProgress>`) — not persisted across restarts

---

### CI-22: Dashboard Backend API Endpoints (Effort: 2 days)

**Owner:** backend

**Description:** Implement the Express API endpoints that proxy MCP tool calls to the dashboard frontend. These translate HTTP requests into internal tool handler invocations.

**Acceptance Criteria:**

- [ ] `GET /api/codebase/architecture?repo=owner/repo&depth=2` — calls `get_architecture`
- [ ] `GET /api/codebase/symbols?repo=owner/repo&filePath=src/index.ts` — calls `get_file_symbols`
- [ ] `GET /api/codebase/search?repo=owner/repo&query=foo&kind=function&limit=10` — calls `search_symbols`
- [ ] `GET /api/codebase/trace?repo=owner/repo&name=Foo` — calls `trace_symbol`
- [ ] `GET /api/codebase/index-status?repo=owner/repo` — returns `{ indexed: boolean, lastIndexedAt, totalFiles, totalSymbols, isIndexing, progress? }`
- [ ] `POST /api/codebase/index` — triggers `index_repository`, returns `{ jobId, status: 'started' }`
- [ ] `POST /api/codebase/auto-index` — triggers `autoIndexIfStale`, returns `{ status: 'skipped' | 'started', reason? }`
- [ ] All endpoints standardize on `repo` query parameter using `owner/repo` format
- [ ] All endpoints return JSON with proper HTTP status codes (200, 400, 404, 500)
- [ ] Error responses follow the pattern: `{ error: string, code: string, details?: any }`
- [ ] Endpoints registered in `src/dashboard/routes/index.ts`

**Technical Notes:**

- Controller path: `src/dashboard/controllers/codebase-controller.ts`
- Internal tool invocation: call tool handlers directly (not via MCP transport) — import and call `handleSearchSymbols(params, db, vectors)`

---

### CI-23: Dashboard Integration Tests (Effort: 2 days)

**Owner:** backend

**Description:** Integration tests for the dashboard API endpoints covering happy path, error handling, and edge cases.

**Acceptance Criteria:**

- [ ] Test fixture: indexed test repository (same as Sprint 8 fixture)
- [ ] `GET /api/codebase/architecture` returns correct structure for the fixture
- [ ] `GET /api/codebase/symbols` returns all symbols for a given file
- [ ] `GET /api/codebase/search` returns ranked results for various queries
- [ ] `GET /api/codebase/trace` returns definition and references
- [ ] `GET /api/codebase/index-status` returns correct status after indexing
- [ ] `POST /api/codebase/index` starts indexing and returns job ID
- [ ] Error responses: 400 for missing params, 404 for unknown repo
- [ ] Test with unindexed repo returns appropriate error states

**Technical Notes:**

- Test file: `src/dashboard/tests/codebase-api.integration.test.ts`
- Use `supertest` or direct Express app instance for HTTP-less testing

---

## Dependencies

| Item  | Depends On           | Description                                       |
| :---- | :------------------- | :------------------------------------------------ |
| CI-16 | —                    | UI shell is the entry point                       |
| CI-17 | CI-16, CI-11         | File tree needs architecture data                 |
| CI-18 | CI-16, CI-10, CI-12  | Symbol list/detail need file symbols + trace      |
| CI-19 | CI-09, CI-18         | Search bar needs search tool + detail navigation  |
| CI-20 | CI-05                | Index status needs indexing service               |
| CI-21 | CI-05, CI-20         | Auto-index needs indexing service + status widget |
| CI-22 | CI-09 — CI-12, CI-20 | API endpoints proxy MCP tools                     |
| CI-23 | CI-22                | Integration tests need stable API                 |

## Risk Register

| Risk                                                        | Likelihood | Impact | Mitigation                                                   |
| :---------------------------------------------------------- | :--------- | :----- | :----------------------------------------------------------- |
| Dashboard API endpoint design changes during implementation | Medium     | Medium | Define all endpoints in CI-22 spec first; implement after    |
| Svelte 5 runes API learning curve                           | Medium     | Low    | Reference existing components; patterns are well-established |
| Large file tree (10K+ directories) causes slow rendering    | Medium     | High   | Virtual scrolling; lazy-load children on expand              |
| Auto-index on project open slows down dashboard load        | Medium     | Medium | Async indexing with progress polling; configurable opt-out   |

**Status: NOT STARTED**

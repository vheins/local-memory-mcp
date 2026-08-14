# AGENTS.md — @vheins/local-memory-mcp

MCP server (stdio) giving AI agents long-term local memory (SQLite + semantic
vectors) plus a Svelte dashboard and a tree-sitter codebase index. TypeScript,
Node 22 (CI pin; no `engines`/`.nvmrc` enforces it — Node 24 also works).

The repo **dogfoods its own memory**: its long-term memory lives in the server's
SQLite DB (`~/.config/local-memory-mcp/memory.db` on Linux; `./storage/memory.db`
is gitignored and starts empty). See `CONTRIBUTING.md`, `GEMINI.md`, and
`.agents/documents/testing.md` for the authoritative rules this file summarizes.

## Build artifacts are generated — never hand-edit them

`npm run build` does more than `tsc`:

1. `vite build` → `dist/dashboard/public/`
2. `tsup` bundles `src/mcp/server.ts` + `src/dashboard/server.ts` to ESM
3. `bash scripts/copy-grammar-wasm.sh` → copies/compiles **`dist/grammars/*.wasm`**
   (tree-sitter grammars; dart/kotlin/swift need network to compile, vue needs `npm pack`)
4. `node scripts/gen-bins.mjs` → **regenerates `bin/mcp-memory-server.js` and
   `bin/mcp-memory-dashboard.js`** (these are build outputs, not source)
5. `gen-bins` + chmod for the 4 entry points

So: don't edit `bin/*.js` or expect `dist/` to exist after a clean checkout —
run `npm run build` (or at least `bash scripts/copy-grammar-wasm.sh`) first.

### Dashboard bin self-rebuild trap

`bin/mcp-memory-dashboard.js` (and `bin/mcp-memory-server.js dashboard`) call
`ensureDashboardBuild()`, which rebuilds `dist/dashboard/public` if any UI source
is newer than the built assets. In a fresh checkout this is a no-op; in an
**installed** package (no `src/`) it's skipped. If the UI bundle is stale but
can't build, the bin **throws on launch** — rebuild first with
`npm run dashboard:build`.

## Install

```bash
npm install --legacy-peer-deps
```

Peer-dep conflicts exist and native modules (`better-sqlite3`, `tree-sitter`) need
their postinstall scripts. CI uses `--legacy-peer-deps`. The `allowScripts`
allowlist in `package.json` is **load-bearing** — do not strip it or native builds
won't run.

## Verification order (local pre-push gate = CI gate)

```bash
npm run type-check   # tsc --noEmit && tsc -p tsconfig.test.json && svelte-check
npm run lint         # eslint . --ext .ts,.svelte
bash scripts/copy-grammar-wasm.sh   # builds dist/grammars WASM (needed by tests)
npm run test
```

`npm run test -- --coverage` currently **exits 1 by design** (suite is below the
configured floor; coverage is non-blocking until `REFACTOR-TST-013`). Don't treat
that exit as a real failure — the coverage artifacts are still written.

## Tests (Vitest 4)

- Pool is `forks` (required for `better-sqlite3` ESM). Default env `node`.
- Single file/dir: `npx vitest run src/mcp/tests/memory.write.test.ts` (or a dir).
- Partitioned projects: `npm run test:unit | :integration | :e2e | :perf`
  (`--project <name>`). Partition is positive-only `include`+`exclude` — **never put
  `!` negations in a project `include`** (silently breaks v8 coverage, FIX-381).
- DOM tests must declare `// @vitest-environment jsdom` as the **first line**;
  pure-TS tests must NOT. `@testing-library/svelte` is wired via
  `server.deps.inline` in `vitest.config.ts` — no per-test setup needed.
- In-memory DB via `createTestStore()` (from `src/mcp/storage/sqlite.ts`); tests
  **never** touch the real `storage/` dir. Fixtures shared across tests live in
  `src/mcp/tests/fixtures/`; never write into the repo tree (use `fs.mkdtemp`).
- After splitting a large test file, run `tsc -p tsconfig.test.json` (not just
  `vitest`) — green tests ≠ type-correct.
- Known flaky test: `src/mcp/tests/codebase-index/indexing-service.test.ts`
  `autoIndexIfStale` timing (pre-existing, not a real failure).

### Test layout & naming (authoritative: `.agents/documents/testing.md`)

- **Server / non-UI** → centralized `src/**/tests/` mirroring the module path
  (`src/mcp/tools/memory.write.ts` → `src/mcp/tests/memory.write.test.ts`).
- **Dashboard UI** → colocated `src/dashboard/ui/src/**/__tests__/` beside subject.
- Markers (filename = scope, no `snake_case`): `*.test.ts` · `*.integration.test.ts`
  · `*.e2e.test.ts` · `*.perf.test.ts`. No other suffix is valid.
- Every change ships its tests in the **same commit** (review-blocking otherwise).

## Structure / boundaries

- npm **workspaces** with one nested workspace: `src/dashboard/ui` (Svelte 5 + Vite;
  own `node_modules`, builds to `dist/dashboard/public/`).
- `src/mcp/` — MCP server. Entry: `src/mcp/server.ts` → `dist/mcp/server.js`.
- `src/dashboard/` — Express API. Entry: `src/dashboard/server.ts` → port `3456`.
- `bin/` — generated CLI bins; `mcp-memory-server dashboard` launches the dashboard.
- `storage/` — runtime SQLite DB (gitignored except `.gitkeep`).

## MCP server & tool surface

- Transport is **stdio**; `src/mcp/server.ts` constructs the `McpServer` and
  registers tools/resources/prompts. Startup also: auto-indexes its **own CWD**
  (`CODEBASE_AUTO_INDEX`), starts the file-watcher sweep (`ENABLE_FILE_WATCHER`),
  preloads the vector model (30s timeout), and starts the offloaded embedding worker.
- **17 canonical tools** (consolidated, auto-inferring modes):
  - Memory: `memory-write`, `memory-read`, `memory-delete`
  - Task: `task-write`, `task-read`, `task-delete`
  - Handoff/Claims: `handoff-write`, `handoff-read`, `claim-manage`
  - Standard: `standard-write`, `standard-read`, `standard-delete`
  - Agent: `agent-context`, `synthesize`, `repo-summarize`
  - Codebase: `codebase-index`, `codebase-read`
  - **Only 2 real router aliases exist** in `src/mcp/router.ts` (`TOOL_ALIASES`):
    `claim-release` → `claim-manage` and `task-update` → `task-write`, plus
    **dot→hyphen normalization** (e.g. `memory.store` → `memory-store`). Other
    legacy names (`index_repository`, `trace_symbol`, `get_file_symbols`,
    `search_symbols`, `codebase_search`, `get_architecture`, `index_status`,
    `task-claim`, `handoff-list`, …) appear **only inside tool descriptions as
    historical notes** — they are NOT resolvable aliases. Always call the
    canonical names above. (`mcp-server.ts` still says "27 tools"; that comment
    is stale post-consolidation.)
- `codebase-read` is ONE tool with auto-detected modes (first match wins, per
  `src/mcp/tools/codebase.read.ts` `inferMode`): `name`→trace definition/call
  sites, `filePath`→file symbols, `content`→grep indexed file contents (CODE
  mode), `query`→ranked symbol search, **no discriminator (empty)→architecture
  tree**. `depth` is ONLY a parameter inside architecture mode, NOT a separate
  mode. Index status is a `codebase-index` mode (no `repoPath` → status), not
  `codebase-read`. `codebase-index` builds/refreshes the index (with `repoPath`).
- **Inline `key:value` tags in `query`** (standard-read / memory-read / codebase-read):
  these are auto-extracted into structured filters, so both structured params AND
  inline tags work. Examples now VALID: `query:"language:php framework:filament"`,
  `query:"auth tag:a,b lang:php"`, `query:"foo kind:function"`. Unknown keys
  (e.g. `label:ddd`) stay as plain free-text. Tags are stripped from the residual
  query so FTS won't mis-tokenize `language:php` (see `src/mcp/utils/query-tags.ts`).
- **`CODEBASE_REPOS_DIR` is DASHBOARD-ONLY** (read by `src/dashboard/services/
codebase.service.ts`). The MCP server ignores it and indexes only its CWD.

## Persistence, search & env

- **SQLite only** (project rule). DB path resolves: `MEMORY_DB_PATH` → platform config
  dir → legacy → `./storage/memory.db` → config dir (created, WAL mode). Migrations
  run **automatically** in the `SQLiteStore` constructor — there is **no `migrate`
  script** (ignore any stale `npm run migrate` mention in comments). The codebase
  index lives **inside the same DB** (tables `codebase_*`), not a separate file.
- No `.env.example` exists. Key vars: `MEMORY_DB_PATH`, `PORT` (dashboard, default
  3456), `DASHBOARD_HOST` (default 127.0.0.1), `DASHBOARD_TOKEN` (auth gate — **none
  = open**), `CODEBASE_AUTO_INDEX` (`"false"` disables startup index),
  `CODEBASE_AUTO_INDEX_TTL` (default 24h), `ENABLE_FILE_WATCHER` (`"false"` disables
  the re-index sweep), `MCP_MODEL`, `CODEBASE_REPOS_DIR` (dashboard only),
  `EMBEDDING_QUEUE_BATCH_SIZE`, `FILE_WATCH_INTERVAL_MS`. **No `GH_TOKEN`** is used
  by this repo. **Embeddings are OFFLOADED to an async queue** (migration v9); no
  explicit env var gate exists — the queue worker starts inline on server startup.
- **Semantic model** `Xenova/all-MiniLM-L6-v2` is downloaded at runtime via
  `@xenova/transformers` on first search/upsert — **needs network on first use**
  unless cached.
- **Embeddings are OFFLOADED to an async queue** (migration v9): after a
  `memory-write`/`standard-write`/`task-write`, the vector is **not instant** — there
  is a brief searchability window (typically <1s) before the semantic score converges.
  No explicit env var gate exists — the queue worker starts inline on server startup.
- **Memory search uses FTS5** (migration v10) with the `unicode61` tokenizer and `*`
  prefix matching — mid-word substring matches are **not** guaranteed (trigram deferred).

## Environment Variables

No `.env.example` exists. All variables are read from `process.env` (or via the
`envInt`/`envStr` helpers in `src/mcp/utils/constants.ts`). Defaults shown below
are taken from `constants.ts` / `server.ts` / `dashboard/server.ts`. **`ENABLE_QUEUE_WORKER`
does not exist** — embeddings offload via an async queue with no env var gate (the
worker starts inline at startup).

### MCP core

| Variable              | Default                          | Purpose                                                              |
| :-------------------- | :------------------------------- | :------------------------------------------------------------------- |
| `MEMORY_DB_PATH`      | — (platform config dir fallback) | Explicit SQLite DB path override.                                    |
| `MCP_SERVER`          | set to `"true"` by `server.ts`   | Marks the running process as the MCP server (affects logging/sinks). |
| `LOG_LEVEL`           | `info`                           | Log level (`trace`/`debug`/`info`/`warn`/`error`), lowercased.       |
| `MCP_CLIENT_NAME`     | — (session fallback)             | Default agent name when a tool call omits `agent`.                   |
| `MCP_MODEL`           | — (session fallback)             | Default model when a tool call omits `model`.                        |
| `ENABLE_AUTO_ARCHIVE` | `"false"` (disabled)             | Set to `"true"` to enable automatic memory archiving on startup.     |

### Dashboard

| Variable                 | Default             | Purpose                                                                    |
| :----------------------- | :------------------ | :------------------------------------------------------------------------- |
| `PORT`                   | `3456`              | Dashboard HTTP port.                                                       |
| `DASHBOARD_HOST`         | `127.0.0.1`         | Dashboard bind host (use `127.0.0.1` to stay loopback-only).               |
| `DASHBOARD_TOKEN`        | — (**none = open**) | Bearer auth gate; unset = unauthenticated.                                 |
| `DASHBOARD_JSON_LIMIT`   | `50mb`              | Express JSON body size limit.                                              |
| `DASHBOARD_ENABLE_MCP`   | `"false"`           | Set to `"true"` to start the embedded MCP client in the dashboard process. |
| `DASHBOARD_OWNER`        | `""`                | Default owner for dashboard task writes when none is supplied.             |
| `DASHBOARD_STATS_TTL_MS` | `30000` (30s)       | TTL for the repo-stats cache.                                              |
| `DASHBOARD_KG_TTL_MS`    | `30000` (30s)       | TTL for the KG graph payload cache.                                        |
| `ARENA_OVERVIEW_TTL_MS`  | `5000` (5s)         | TTL for the Agent Arena overview cache.                                    |

### Embedding / KG outbox queue

| Variable                                   | Default | Purpose                                                |
| :----------------------------------------- | :------ | :----------------------------------------------------- |
| `EMBEDDING_QUEUE_BATCH_SIZE`               | `32`    | Rows embedded per worker batch.                        |
| `EMBEDDING_QUEUE_POLL_INTERVAL_MS`         | `500`   | Idle poll interval for the lease worker.               |
| `EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS`     | `10000` | Idle backoff ceiling (exponential up to this).         |
| `EMBEDDING_QUEUE_LEASE_MS`                 | `60000` | Lease length for claimed embedding jobs.               |
| `EMBEDDING_QUEUE_BACKFILL_CAP`             | `2000`  | Max rows backfilled per process start.                 |
| `EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE`       | `500`   | Skip backfill when pending+claimed exceeds this.       |
| `EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK` | `5`     | Consecutive non-empty batches before draining backoff. |

### Codebase index & file watcher

| Variable                           | Default                  | Purpose                                                  |
| :--------------------------------- | :----------------------- | :------------------------------------------------------- |
| `CODEBASE_AUTO_INDEX`              | `"true"` (`"false"` off) | Startup auto-index of the server's CWD.                  |
| `CODEBASE_AUTO_INDEX_TTL`          | `86400000` (24h)         | Stale-index refresh interval.                            |
| `CODEBASE_REPOS_DIR`               | `..` (parent dir)        | **Dashboard-only** base dir for dashboard-indexed repos. |
| `CODEBASE_INDEX_PARSE_TIMEOUT_MS`  | `10000` (10s)            | Max wall-clock time per single file parse.               |
| `CODEBASE_INDEX_WORKERS`           | `4` (`0` = auto)         | Concurrent tree-sitter WASM parser slots.                |
| `CODEBASE_INDEX_PARSE_CONCURRENCY` | `4`                      | Legacy alias for `CODEBASE_INDEX_WORKERS`.               |
| `ENABLE_FILE_WATCHER`              | `"true"` (`"false"` off) | Polling re-index sweep over registered repos.            |
| `FILE_WATCH_INTERVAL_MS`           | `30000` (30s)            | Sweep cadence for the file watcher.                      |
| `FILE_WATCH_TTL_MS`                | `300000` (5 min)         | Per-repo re-entry cap (debounce) for the watcher.        |
| `INDEX_STALENESS_TTL_MS`           | `30000` (30s)            | Cache TTL for `index_status` staleness results.          |

### Search, cache & retention bounds

| Variable                     | Default | Purpose                                           |
| :--------------------------- | :------ | :------------------------------------------------ |
| `VECTOR_CANDIDATE_CAP`       | `100`   | Max similarity candidates fetched per search.     |
| `VECTOR_MIN_CANDIDATES`      | `10`    | Floor for the candidate pool (small/sparse sets). |
| `ACTION_LOG_MAX_ROWS`        | `10000` | Row-count cap for the audit `action_log` table.   |
| `WAL_CHECKPOINT_INTERVAL_MS` | `10000` | Min interval between WAL checkpoints.             |
| `DEFAULT_BATCH_SIZE`         | `100`   | Rows per DB transaction (file/symbol writes).     |

### Codebase-read / graph bounds

| Variable                       | Default           | Purpose                                             |
| :----------------------------- | :---------------- | :-------------------------------------------------- |
| `CODE_GRAPH_MAX_EDGES`         | `400`             | Dashboard code-graph edge cap.                      |
| `CODE_SEARCH_CACHE_MAX_BYTES`  | `16777216` (16MB) | Process-shared content-grep cache (bytes).          |
| `CODE_SEARCH_CACHE_MAX_FILES`  | `256`             | Process-shared content-grep cache (file count).     |
| `CODE_SEARCH_MAX_REGEX_LENGTH` | `200`             | Max length of a `content` grep regex (ReDoS guard). |
| `FILE_CONTENT_MAX_LINES`       | `2000`            | Max lines returned by the file-content endpoint.    |
| `KG_MAX_GRAPH_EDGES`           | `4000`            | Server-side KG graph edge cap.                      |
| `KG_MAX_CONTEXT_ENTITIES`      | `50`              | Max entities fed into KG-context enrichment.        |
| `KG_CONTEXT_TEXT_TOKENS`       | `40`              | Max search-text tokens for KG entity FTS.           |

## Formatting

- Prettier: **tabs**, **double quotes**, `printWidth: 120`, `trailingComma: none`,
  semicolons on; Svelte via `prettier-plugin-svelte`.
- ESLint: `@typescript-eslint/no-explicit-any` is **error**, relaxed to off inside
  `*.test.ts`/`*.spec.ts`; unused vars/args allowed if `_`-prefixed. `dist/`, `bin/`,
  `storage/`, `.cache/`, `coverage/` are ignored.

## Dashboard dev gotcha

`npm run dashboard` serves the **built** bundle — run `npm run build` (or
`npm run dashboard:build`) first. For live UI work: `npm run dashboard:dev`
(:5173, proxies `/api` → :3456) alongside `npm run dashboard`.

## Commits, branches, PRs

- Conventional Commits `type(scope): description`, with the active task as
  `[TASK-xxx]` in subject/body (see `GEMINI.md`, `CONTRIBUTING.md`). `keyword #N`
  footer when closing a GitHub issue.
- Branch `feat/feature-name` or `fix/bug-description`; PR → `main`.
- Strict quality rules: **Local-First** (no cloud/external APIs without discussion),
  **SQLite only** for persistence, **never lower the semantic-search similarity
  thresholds** (anti-hallucination guard).

## Where to look

- `CONTRIBUTING.md` — workflow, commit & quality rules.
- `.agents/documents/testing.md` — single authoritative testing standard (above is a summary).
- Published consumer docs: the **GitHub Wiki** — Home (`https://github.com/vheins/local-memory-mcp/wiki/Home`). MCP tool/API usage from the consuming agent's perspective lives at `en/Tools-Reference` (`https://github.com/vheins/local-memory-mcp/wiki/en/Tools-Reference`) and `en/MCP-Concepts` (`https://github.com/vheins/local-memory-mcp/wiki/en/MCP-Concepts`).
- `GEMINI.md` — commit-message rules.
- Repo coding standards stored in MCP: `STD-001` (Arena layout manager-driven),
  `STD-002` (Dashboard UI a11y/focus/polling baseline).

## Documentation Map

The repository carries documentation for **two distinct audiences** plus
**cross-project global standards**. Knowing which bucket a doc lives in tells you
who it is written for.

- **GitHub Wiki = MCP consumer documentation** — for **end users / AI agents that
  consume this MCP server**. The repo's user docs live **OUTSIDE this repo** at the
  GitHub Wiki (`https://github.com/vheins/local-memory-mcp/wiki/Home`); in-repo
  `docs/` no longer holds consumer docs (the wiki covers `en/` and `id/` language
  versions, per-feature overviews, and screenshots).
- **`.agents/` = developer, contributor & AI-agent documentation** — internal
  engineering docs for people and agents building on this repo:
  `.agents/documents/testing.md` (the authoritative testing standard),
  `.agents/documents/api/` (MCP tool API reference, e.g.
  `.agents/documents/api/codebase-index.md`), `.agents/documents/operations/`
  (ops runbooks, e.g. `.agents/documents/operations/codebase-index.md`),
  `.agents/documents/optimization/` (design/optimization docs, `en/` + `id/`),
  `.agents/documents/audits/` (UI audits), `.agents/documents/decisions/` &
  `.agents/documents/requirements/` (ADRs, BRD/PRD/FSD/TDD, acceptance criteria),
  and `.agents/documents/_tasks/` (internal task tracking).
- **`~/.agents/` = cross-project global standards** — rules and skills shared
  across repositories (the senior-authority baseline that applies everywhere).

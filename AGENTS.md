# AGENTS.md — @vheins/local-memory-mcp

MCP server (stdio) giving AI agents long-term local memory (SQLite + semantic
vectors) plus a Svelte dashboard and a tree-sitter codebase index. TypeScript,
Node 22 (CI pin; no `engines`/`.nvmrc` enforces it — Node 24 also works).

The repo **dogfoods its own memory**: its long-term memory lives in the server's
SQLite DB (`~/.config/local-memory-mcp/memory.db` on Linux; `./storage/memory.db`
is gitignored and starts empty). See `docs/testing.md`, `CONTRIBUTING.md`,
`GEMINI.md` for the authoritative rules this file summarizes.

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

### Test layout & naming (authoritative: `docs/testing.md`)

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
  - Legacy kebab/dotted names (`memory-store`, `index_repository`, `trace_symbol`,
    `get_file_symbols`, `search_symbols`, `codebase_search`, `get_architecture`,
    `index_status`, `claim-release`, `task-claim`, `handoff-list`, …) are
    **router-normalized aliases**, not separate tools — use the canonical names.
    (`mcp-server.ts` still says "27 tools"; that comment is stale post-consolidation.)
- `codebase-read` is ONE tool with auto-detected modes: `query`→ranked symbol
  search, `name`→trace definition/call sites, `filePath`→file symbols, `depth`→
  architecture tree, empty→index status. `codebase-index` builds/refreshes the index.
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
  the re-index sweep), `ENABLE_QUEUE_WORKER` (dashboard-side embedding worker gate),
  `MCP_MODEL`, `CODEBASE_REPOS_DIR` (dashboard only), `EMBEDDING_QUEUE_BATCH_SIZE`,
  `FILE_WATCH_INTERVAL_MS`. **No `GH_TOKEN`** is used by this repo.
- **Semantic model** `Xenova/all-MiniLM-L6-v2` is downloaded at runtime via
  `@xenova/transformers` on first search/upsert — **needs network on first use**
  unless cached.
- **Embeddings are OFFLOADED to an async queue** (migration v9): after a
  `memory-write`/`standard-write`/`task-write`, the vector is **not instant** — there
  is a brief searchability window (typically <1s) before the semantic score converges.
- **Memory search uses FTS5** (migration v10) with the `unicode61` tokenizer and `*`
  prefix matching — mid-word substring matches are **not** guaranteed (trigram deferred).

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
- `docs/testing.md` — single authoritative testing standard (above is a summary).
- `docs/en/tools-reference.md`, `docs/en/mcp-concepts.md` — MCP tool/API internals.
- `GEMINI.md` — commit-message rules.
- Repo coding standards stored in MCP: `STD-001` (Arena layout manager-driven),
  `STD-002` (Dashboard UI a11y/focus/polling baseline).

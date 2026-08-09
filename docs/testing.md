# Testing Standard

**Scope:** repository-wide (`src/`). Applies to every test file, new or existing.
**Status:** single authoritative standard (REFACTOR-TST-001). Supersedes all
per-feature conventions (centralized `tests/` vs colocated `*.test.ts` vs
`__tests__/`; plain/integration/e2e/perf markers).
**Enforcement:** code review + CI gate (REFACTOR-TST-013). Sibling tasks
(REFACTOR-TST-003…011) migrate the existing tree to this standard.

This document is the **rule**; test files are the **evidence**. A test file that
violates this standard fails review. It reflects, and does not duplicate, the
global rules in `~/.agents/rules/test-architecture.md` (4-concern rule,
domain-entity naming) and `~/.agents/rules/development-quality.md` (minimum
1 positive + 1 negative test per function/route) — see
[Relationships](#9-relationships) for the wiring.

---

## 1. Tooling & Configuration

| Item                     | Value                                                                                                        |
| :----------------------- | :----------------------------------------------------------------------------------------------------------- |
| Runner                   | **Vitest** `^4.1.7`                                                                                          |
| Coverage                 | `@vitest/coverage-v8` `^4.1.7` (installed; thresholds not yet enforced — see [Coverage](#7-coverage-policy)) |
| Property-based           | `@fast-check/vitest` `^0.3.0` + `fast-check` `^4.6.0`                                                        |
| UI DOM                   | `jsdom` `^30.0.0`                                                                                            |
| Type-check (tests incl.) | `npm run type-check` (`tsc --noEmit && tsc -p tsconfig.test.json && svelte-check`)                           |

### 1.1 Root config — `vitest.config.ts`

Fixed facts (do not change without an ADR):

- `pool: "forks"` — REQUIRED for `better-sqlite3` ESM compatibility.
- `environment: "node"` default for the whole suite. DOM-dependent tests opt in
  per file (see 1.2).
- `testTimeout: 30_000` / `hookTimeout: 30_000`. Heavy suites override per file
  via `vi.setConfig({ testTimeout })` — `src/mcp/tests/e2e.e2e.test.ts` sets
  `90_000` (REQUIRED for its full-toolchain flows).
- Excludes: `dist/**`, `node_modules/**`, `src/dashboard/ui/node_modules/**`.
- Suite groups: `test.projects` (Vitest 4) defines four named projects —
  `unit` / `integration` / `e2e` / `perf` — each `extends: true` (inherits
  pool/environment/excludes/timeouts) with `include` patterns that PARTITION
  the taxonomy (no file runs twice). The root config is NOT a project itself;
  only global options (`reporters`, `coverage`) apply at root. Run one group
  with `--project <name>` (see §6).
- Coverage: `provider: "v8"` with `reporter: text / text-summary / json / html`,
  `include: ["src/**/*.{ts,tsx}"]`, global floors `lines/statements/functions
70, branches 60`. Flag-gated (`--coverage`) until the suite reaches the floor
  (see §7) — `coverage.enabled` stays `false` until REFACTOR-TST-013.
- Svelte plugin + `resolve.conditions: ["browser"]` are present so UI
  components can be mounted under the root runner.

### 1.2 Environment selection

- Default environment is `node`.
- A test that touches DOM MUST declare `// @vitest-environment jsdom` as its
  FIRST line (verified pattern: 13 of the 17 UI test files).
- Pure-TypeScript tests (no DOM) MUST NOT declare jsdom — e.g.
  `src/dashboard/ui/src/lib/arena/__tests__/arenaTransformLayout.test.ts` runs
  under `node`.
- The app workspace `src/dashboard/ui/vitest.config.ts` exists SOLELY for runs
  launched from inside the UI workspace (jsdom default, `globals: true`,
  `$lib` alias). Contributors MUST NOT rely on it for repo-root runs.

---

## 2. Location Policy

Exactly two allowed patterns. There is NO third pattern.

### 2.1 Server / dashboard non-UI → centralized `src/**/tests/`

Every non-UI test file lives in a `tests/` directory that **mirrors the module
path** of the subject under test:

| Subject module                         | Test location                                      |
| :------------------------------------- | :------------------------------------------------- |
| `src/mcp/tools/memory.write.ts`        | `src/mcp/tests/memory.write.test.ts`               |
| `src/mcp/codebase-index/services/*.ts` | `src/mcp/tests/codebase-index/services/*.test.ts`  |
| `src/dashboard/controllers/*.ts`       | `src/dashboard/tests/*.integration.test.ts`        |
| (new) `src/dashboard/routes/*.ts`      | `src/dashboard/tests/routes/*.integration.test.ts` |
| (new) `src/mcp/utils/sql-builder.ts`   | `src/mcp/tests/utils/sql-builder.test.ts`          |

Real, verified examples: `src/mcp/tests/memory.write.test.ts`,
`src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`,
`src/dashboard/tests/controllers.integration.test.ts`.

Shared fixtures for the server scope live in `src/mcp/tests/fixtures/`
(see §5).

### 2.2 Dashboard UI → colocated `__tests__/` beside the subject

Every UI test file sits in an `__tests__/` directory that is a direct child of
the directory containing its subject:

| Subject file                                           | Test path                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `src/dashboard/ui/src/components/ArenaLegend.svelte`   | `src/dashboard/ui/src/components/__tests__/ArenaLegend.test.ts`       |
| `src/dashboard/ui/src/lib/focusTrap.ts`                | `src/dashboard/ui/src/lib/__tests__/focusTrap.test.ts`                |
| `src/dashboard/ui/src/lib/arena/ArenaLayoutManager.ts` | `src/dashboard/ui/src/lib/arena/__tests__/ArenaLayoutManager.test.ts` |

### 2.3 Banned locations

- FORBIDDEN: a `*.test.ts` file colocated beside server/non-UI source.
  ✅ Migrated by REFACTOR-TST-004a: `src/dashboard/lib/helpers.test.ts`
  → `src/dashboard/tests/helpers.test.ts` (verified 2026-08-10).
- FORBIDDEN: a UI test file directly beside its subject (no `__tests__/`).
  ✅ Migrated by REFACTOR-TST-004b: `src/dashboard/ui/src/lib/kg/KGForceLayout.test.ts`
  → `src/dashboard/ui/src/lib/kg/__tests__/KGForceLayout.test.ts`;
  `src/dashboard/ui/src/lib/kg/graphLoader.test.ts`
  → `src/dashboard/ui/src/lib/kg/__tests__/graphLoader.test.ts`;
  `src/dashboard/ui/src/lib/kg/KGNeuralRenderer.perf.test.ts`
  → `src/dashboard/ui/src/lib/kg/__tests__/KGNeuralRenderer.perf.test.ts`;
  `src/dashboard/ui/src/lib/composables/useKanban.test.ts`
  → `src/dashboard/ui/src/lib/composables/__tests__/useKanban.test.ts`
  (verified 2026-08-10).
- FORBIDDEN: tests under `dist/`, `bin/`, `storage/`, `node_modules/` (lint
  ignores already enforce this).

---

## 3. Naming Taxonomy

Exactly four file suffixes exist. The suffix IS the scope declaration — a
reader MUST be able to infer what the file does from the name alone.

| Marker      | Suffix                  | Scope                                                                                                  | Verified examples                                                                                |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Unit        | `*.test.ts`             | One module, one layer, no live server, no network                                                      | `src/mcp/tests/memory.write.test.ts`, `src/dashboard/ui/src/components/__tests__/TopBar.test.ts` |
| Integration | `*.integration.test.ts` | Crosses component boundaries (router → DB, express → store); uses in-memory SQLite (`createTestStore`) | `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`                                     |
| E2E         | `*.e2e.test.ts`         | Full toolchain / high-complexity flows                                                                 | `src/mcp/tests/tasks.e2e.test.ts`                                                                |
| Perf        | `*.perf.test.ts`        | Performance characteristics (frame-constant reuse, allocation, timing bounds)                          | `src/dashboard/ui/src/lib/kg/__tests__/KGNeuralRenderer.perf.test.ts`                            |

### 3.1 Hard rules

Subject name: `kebab-case` words joined by `.`/`-`, mirroring the module name —
`mcp-tools.integration.test.ts`, `tasks.e2e.test.ts`,
`KGNeuralRenderer.perf.test.ts` (PascalCase follows the class subject name).

- BANNED: `snake_case` in any test filename (last server-scope violation
  migrated by REFACTOR-TST-005: `src/mcp/tests/spec_compliance.test.ts` →
  `spec-compliance.test.ts`). `snake_case` test names fail review.
- BANNED: `_test.ts` / `_spec.ts` surrogate markers.
- BANNED: out-of-taxonomy suffixes (`*.spec.test.ts`, `*.test.integration.ts`,
  `*.e2e.ts`). If a test belongs to a marker, the marker MUST be
  `<subject>.integration.test.ts` / `<subject>.e2e.test.ts` /
  `<subject>.perf.test.ts` — never elsewhere in the name.
- The legacy `src/mcp/tests/e2e.test.ts` was renamed by REFACTOR-TST-005 to
  `e2e.e2e.test.ts` — the `e2e` project include (`**/*.e2e.test.ts`) captures
  it, and it no longer runs in the `unit` project. New E2E suites MUST use
  `*.e2e.test.ts`, never a bare `e2e` prefix.
- One subject → one test file, unless split by marker (unit + integration are
  separate files). Do NOT bundle unit inside an `integration` file.

---

## 4. Scope & Layer Rules (4-Concern)

Reflects the global 4-concern rule (`~/.agents/rules/test-architecture.md`)
with repo-specific binding below. Every assertion is placed in **exactly ONE**
layer. There is no duplication permission — a rule asserted at the Service
layer MUST NOT repeat in the State layer.

| Layer   | Where it lives in this repo                                           | MUST assert                                        | MUST NOT assert                            |
| ------- | --------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| DB      | `src/mcp/tests/*.test.ts` (sqlite, migrations, FTS)                   | Integrity, FKs, unique indexes, cascades, defaults | Business rules, UI logic                   |
| Service | `src/mcp/tests/` + `src/dashboard/tests/services/`                    | Domain calcs, business rules, action outcomes      | DB constraints, UI validation              |
| State   | `src/mcp/tests/tasks-transition.test.ts` (status transitions, guards) | Status transitions, guards, workflow rules         | DB integrity, UI rendering                 |
| UI      | `src/dashboard/ui/src/**/__tests__/`                                  | Rendering, events, a11y, focus/modal behaviour     | Business calcs, DB logic, domain decisions |

### 4.1 Hard rules

- A UI test MUST NOT assert business logic (scoring math, TTL expiry, status
  rules). UI tests assert **presentation** only — e.g. `ArenaLegend.test.ts`
  asserts label/colour rendering, not arena-ranking math.
- A Service test MUST NOT open a real HTTP server or drive the express app.
- A State test MUST NOT install DB constraints to pass; guards are code rules.
- Tests that cross DB: Service/Integration. Tests that cross modules:
  Integration. Everything else: Unit.

### 4.2 Minimum per function/route (global rule, enforced)

Every test target (function, handler, route, component behaviour) MUST have:

1. ≥ 1 **positive** case — happy path, expected success.
2. ≥ 1 **negative** case — error, validation failure, forbidden state.

These land in the SAME file; empty it or drop either → review fail.

---

## 5. Fixture Conventions

- All SHARED fixtures MUST live under
  `src/mcp/tests/fixtures/` — real tree:
  `src/mcp/tests/fixtures/codebase-index/search-test-fixture/`.
  Subject mirror sub-paths (e.g. `fixtures/codebase-index/`) NOT flat piles.
- A fixture is a checked-in file set used by ≥ 2 tests. Single-test fixtures
  sit next to the test (same dir) or are generated inline.
- FORBIDDEN: writing files into the repo working tree
  (`src/`, `docs/`, root). Any test that must write to disk creates a
  directory via `fs.mkdtemp(os.tmpdir())` and cleans it AFTER `afterAll`.
  Verified pattern: `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`.
- FORBIDDEN: committing fixture files written by tests (they are temp).
- For in-memory DB state, use `createTestStore()` — an in-memory SQLite factory
  exported from `src/mcp/storage/sqlite.ts` (production module), used by
  `src/mcp/tests/e2e.e2e.test.ts` and
  `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`. Tests NEVER
  touch the real `storage/` directory.

---

## 6. Running Tests

| Command                        | Effect                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `npm run test`                 | Full suite (all projects), run once (`vitest --run`)                             |
| `npm run test:watch`           | Watch mode (`vitest`)                                                            |
| `npm run test:unit`            | `vitest --run --project unit` — only `*.test.ts` (non-integration/e2e/perf)      |
| `npm run test:integration`     | `vitest --run --project integration` — only `*.integration.test.ts`              |
| `npm run test:e2e`             | `vitest --run --project e2e` — only `*.e2e.test.ts`                              |
| `npm run test:perf`            | `vitest --run --project perf` — only `*.perf.test.ts`                            |
| `npx vitest run <file-or-dir>` | Scoped run (any path from §2)                                                    |
| `npm run test -- --coverage`   | Full suite with V8 coverage report (reporter: text / text-summary / json / html) |
| `npm run type-check`           | `tsc` (src + `tsconfig.test.json` incl. `src/**/*.test.ts`) + `svelte-check`     |

### 6.1 Scoped-run recipes (all verified to resolve)

```bash
npm run test                                        # whole suite
npm run test:watch                                # watch
npx vitest run src/mcp/tests/memory.write.test.ts # one file
npx vitest run src/mcp/tests/codebase-index       # one dir (21 files)
npx vitest run src/dashboard/tests                # dashboard integration
npx vitest run src/dashboard/ui                    # all 17 UI files
npm run test -- --coverage                        # +V8 coverage
```

E2E / perf are part of the full suite — run them deliberately:
`npx vitest run src/mcp/tests/tasks.e2e.test.ts`,
`npx vitest run src/dashboard/tests/controllers.integration.test.ts`,
`npx vitest run src/dashboard/ui/src/lib/kg/__tests__/KGNeuralRenderer.perf.test.ts`.

### 6.2 Project-scoped runs (live since REFACTOR-TST-003)

`test.projects` partitions the suite into `unit` / `integration` / `e2e` /
`perf`; the scripts in §6 run one group each. Partitioning is exhaustive and
disjoint — 105 unit / 3 integration / 2 e2e / 1 perf files today (the legacy
`e2e.test.ts` moved to the `e2e` project as `e2e.e2e.test.ts` by
REFACTOR-TST-005), no file runs twice. One caveat:

- Coverage is NOT included in project-scoped runs (flag-gated, see §7);
  thresholds are evaluated only under `--coverage`, after the full suite runs.

## 7. Coverage Policy

`@vitest/coverage-v8` is installed; `npm run test -- --coverage` reports today.
The config (REFACTOR-TST-003, live) is:

- provider `v8`, coverage `reporter`: `text` + `text-summary` + `json` + `html`,
  `include: ["src/**/*.{ts,tsx}"]`, exclude `dist`/`node_modules`/
  `src/dashboard/ui/node_modules`.
- Global floors: `lines: 70`, `statements: 70`, `functions: 70`, `branches: 60`.
  NOTE: `thresholds.all` is a jest/nyc option with NO Vitest equivalent (Vitest
  would parse `all` as a file-glob key). The all-files semantics come from
  `coverage.include` — including the pattern pulls untested files into the
  report, and the global floors apply to every matched file.
- Non-blocking today: `coverage.enabled` is `false`, so thresholds are only
  evaluated when coverage runs (`--coverage`). The v8 provider has no warn-only
  mode — a missed threshold fails the run (exit 1).
- Thresholds become BLOCKING in CI (REFACTOR-TST-013: `npm run test -- --coverage`
  gate on PR + before publish, `enabled: true`); until the suite reaches the
  floor, coverage failures are non-blocking (REFACTOR-TST-012 is the green gate).

### 7.1 Per-module `priority` (where coverage must be before anything else)

These modules have NO direct suites today. New tests for them MUST land via
REFACTOR-TST-006…011 — they are the top coverage priorities:

| Module                                                                        | Why                                           |
| ----------------------------------------------------------------------------- | --------------------------------------------- |
| `src/mcp/utils/` (16 files: `uuid`, `sql-builder`, `pagination`, `vector`, …) | Core, used everywhere; 0 direct               |
| `src/dashboard/routes/` (10 files)                                            | Behavior transparently tested                 |
| `src/dashboard/services/` (10 files)                                          | Business logic — must assert at Service layer |
| `src/mcp/interfaces/` (`express`, `index`, `prompt`)                          | contracts                                     |
| `src/dashboard/lib/` (`context.ts`, `jsonApi.ts`)                             | DI wiring + response shaping                  |

### 7.2 Same-commit with new code

Every change ships its tests in the same commit. Adding a function or
route WITHOUT a matching `*.test.ts` / `*.integration.test.ts` diff is a
REVIEW-BLOCKING defect (enforced at code review), not a follow-up.

---

## 8. Environment & CI (REFACTOR-TST-013)

- No GitHub workflow currently runs tests (`release.yml` publishes on tag
  without `npm test`); this is a known risk (F-7). A `ci.yml` will run
  `type-check → lint → npm run test -- --coverage` on every PR; `release.yml`
  will require CI success before publish.
- While CI is absent, `npm run type-check && npm run test` is the LOCAL
  pre-push gate.
- Server-scope test names are conformant since REFACTOR-TST-005 (legacy
  `spec_compliance.test.ts` → `spec-compliance.test.ts` and
  `e2e.test.ts` → `e2e.e2e.test.ts`); UI colocation was completed by
  REFACTOR-TST-004b (all UI tests now sit in `__tests__/` beside their
  subjects) — the tree is fully conformant.

---

## 9. Relationships

- Global rules reflected (not duplicated): `~/.agents/rules/test-architecture.md`
  (4-concern rule, domain-entity naming) and
  `~/.agents/rules/development-quality.md` (min 1 positive + 1 negative test).
- Repo standard for dashboard UI baseline (a11y/focus/polling) enforced in UI
  tests: MCP standard **STD-002** (repository-level).
- Parent initiative: `REFACTOR-TST-000` (13-task standardization); this doc is
  the input to TST-002..TST-014.

---

_Repository-level standard. Last reviewed 2026-08-09 (REFACTOR-TST-001)._

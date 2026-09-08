# Sprint 04 — Coverage & Polish

> **PLANNED — not yet executed.** Closes remaining P1–P6 `Partial` gaps + per-module coverage + perf follow-ups. Bridge style — link, don't duplicate.

## Goals

- Close remaining `Partial` gaps in P1–P6 (memory/tasks/standards/handoffs/index/dashboard).
- Per-module coverage — `utils` / `routes` / `services` / `lib` / `prompts` suites (TST-006..011 gate TST-012).
- Perf follow-ups from optimization roadmap (embedding queue batch/backoff, FTS5, vector caps, `WAL_CHECKPOINT`).
- Final `application/` + `design/` + `tasks/` polish pass (spelling, link, mermaid checks).

## Deliverables

| #   | Artifact            | Detail                                                                           | Canonical                                                                                                                      |
| :-- | :------------------ | :------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1–P6 gap closure   | Remaining `Partial` → `DONE` per `backlog.md` P-01..P-04 gap table               | [`../backlog.md`](../backlog.md) P-01..P-04 · [`../../application/modules/manifest.md`](../../application/modules/manifest.md) |
| 2   | Coverage suites     | `utils`/`routes`/`services`/`lib`/`prompts` + per-module floors (TST-006..011)   | [`../../_tasks/testing-standardization.md`](../../_tasks/testing-standardization.md) TST-006..012                              |
| 3   | Coverage gate green | `npm run test -- --coverage --run` meets `70/70/70/60` without exit 1 (TST-012)  | [`../../testing.md`](../../testing.md) §7.1 · `vitest.config.ts`                                                               |
| 4   | Perf follow-ups     | Queue batch/backoff, `VECTOR_CANDIDATE_CAP`, `KG_MAX_*`, `WAL_CHECKPOINT` tuning | [`../../requirements/optimization/roadmap.md`](../../requirements/optimization/roadmap.md) · `src/mcp/utils/constants.ts`                                |
| 5   | Docs polish         | Final `application/` + `design/` + `tasks/` link + spelling pass                 | [`manifest.md`](manifest.md) · [`../roadmap.md`](../roadmap.md)                                                                |
| 6   | Quality gates       | `markdownlint` + balanced fences + relative-link + spell-check on all docs       | `AGENTS.md` quality gates · [`../../testing.md`](../../testing.md)                                                             |

## Planned acceptance criteria

- [ ] No `Partial` rows remain in P1–P6 gap table (`backlog.md`)
- [ ] `vitest --coverage` meets `70/70/70/60` floor on CI (`ci.yml` from S03) — job green
- [ ] Optimization roadmap items linked or deferred with ADR + owner

## Risks & notes

- Large `utils`/`services` suites are the coverage bottleneck — prioritize `src/mcp/utils/` + `src/mcp/services/` first (highest LOC).
- Perf tuning is measurement-gated — no speculative caps; see `optimization/` benchmarks.
- Docs polish includes `markdownlint` + balanced fences + relative-link check per quality gates.
- Depends on S03 (`ci.yml` blocking) — cannot verify floors without CI gate.

## Links

- Prior: [S03](sprint-03.md) (PLANNED) · Manifest: [`manifest.md`](manifest.md)
- Roadmap: [`../roadmap.md`](../roadmap.md) · Backlog: [`../backlog.md`](../backlog.md)
- Optimization: [`../../requirements/optimization/README.md`](../../requirements/optimization/README.md) · Testing: [`../../testing.md`](../../testing.md)

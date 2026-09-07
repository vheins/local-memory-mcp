# Roadmap — Phase 1 Timeline

> **Bridge style — link, don't duplicate.** Timeline only; sprint detail lives in [`sprints/manifest.md`](sprints/manifest.md) + [`sprints/sprint-01.md`](sprints/sprint-01.md). Canonical sources linked per row.

## Timeline P0–P8A

| Phase     | Scope                                                                                               | Status             | Canonical                                                                                                                                                |
| :-------- | :-------------------------------------------------------------------------------------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**    | Bootstrap — repo, SQLite `memory.db`, MCP stdio scaffold                                            | **DONE**           | [`AGENTS.md`](../../AGENTS.md) · `src/mcp/server.ts`                                                                                                     |
| **P1–P6** | Memory / Tasks / Standards / Handoffs / Codebase Index / Dashboard (20 tools, 32 prompts, Svelte 5) | **Partial**        | [`../brief.md`](../brief.md) · [`../application/modules/manifest.md`](../application/modules/manifest.md) · [`../design/README.md`](../design/README.md) |
| **P7–P8** | Hardening — perf, coverage, CI gate                                                                 | **Missing**        | [`../_tasks/testing-standardization.md`](../_tasks/testing-standardization.md) (REFACTOR-TST-003..014)                                                   |
| **P8A**   | Presentation cut — `application/` + `design/flows/` bridges (11 files)                              | **DONE** `ce708d1` | [`../application/README.md`](../application/README.md) · [`../design/flows/README.md`](../design/flows/README.md)                                        |

## Sprints

| Sprint  | Scope                                                   | Status              | Detail                                                                                      |
| :------ | :------------------------------------------------------ | :------------------ | :------------------------------------------------------------------------------------------ |
| **S01** | Docs Retrofit 2026-09-07 — close `tasks/` gap + G3 gate | **DONE 2026-09-07** | [`sprints/sprint-01.md`](sprints/sprint-01.md)                                              |
| **S02** | Doc-sync sweep — orphan/missing refs, stale test paths  | Next                | [`sprints/manifest.md`](sprints/manifest.md) · [`backlog.md`](backlog.md) P-05              |
| **S03** | CI gate — `ci.yml` + coverage blocking                  | Next                | [`sprints/manifest.md`](sprints/manifest.md)                                                |
| **S04** | Coverage — utils/routes/services/lib/prompts            | Next                | [`../_tasks/testing-standardization.md`](../_tasks/testing-standardization.md) TST-006..011 |

## Reading order

1. [`../brief.md`](../brief.md) → [`../application/presentation-brief.md`](../application/presentation-brief.md) (G3 gate)
2. [`backlog.md`](backlog.md) (P-01..P-05 gaps) → this roadmap (timeline)
3. [`sprints/manifest.md`](sprints/manifest.md) → [`sprints/sprint-01.md`](sprints/sprint-01.md)
4. [`../design/README.md`](../design/README.md) → [`../testing.md`](../testing.md) for execution context

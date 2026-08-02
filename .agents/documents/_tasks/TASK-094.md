# TASK-094 — tools/ naming convention: decide + document

Status: completed · owner: vheins/local-memory-mcp · priority: 2 · phase: documentation

## Summary

Decided the `src/mcp/tools/` naming convention and documented it. **Decision: accept-and-document**
(no codemod, no mass rename).

## Evidence

`src/mcp/tools/` mixes two styles:

1. **Kebab-case subdirectories (canonical)**: `memory-write/`, `standard-read/`, `standard-write/`,
   `task-read/`, `task-write/`, `kg-archivist/`, `schemas/`.
2. **Dotted legacy files**: `memory.read.ts`, `task.read.ts`, `claim.manage.ts`, `standard.delete.ts`,
   `handoff.read.ts`, `codebase.read.ts`, etc. These are either thin backward-compat re-exporters
   (e.g. `task.read.ts` → `./task-read`, `standard.read.ts` → `./standard-read`,
   `memory.write.ts` → `./memory-write`) or the original single-file implementation for domains
   not yet split (`memory.read.ts` = 561-line primary handler imported by `index.ts`).

Why renaming is rejected:

- The dotted file names mirror the legacy dotted tool names (`memory.read` ↔ `memory-read`); the
  router normalizes tool names dots→hyphens (`router.ts`: `String(name).replace(/\./g, "-")`),
  so the dotted-name→file mapping is load-bearing.
- Existing tests/imports reference the dotted paths directly (kg-archivist.test.ts, hybrid-search.test.ts,
  sqlite.test.ts, v2-features.test.ts, tasks-transition.test.ts, memory.synthesize.ts, etc.).
- No tools/README exists → convention documented as a header comment in `src/mcp/tools/index.ts`.

## Change

- `src/mcp/tools/index.ts` — added header comment documenting the mixed convention, why dotted
  files stay, and the migration path for future domain splits (kebab-case dir + thin re-exporter).

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint src/mcp/tools/index.ts ...` — clean.

## Notes

- Tracked here (file-based fallback) because MCP task tools were unavailable to this session.

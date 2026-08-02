# TASK-117 — Repo-wide import-style normalization

Status: completed (backend) · owner: vheins/local-memory-mcp

## Decision (module resolution rule)

- `module` = **ESNext**
- `moduleResolution` = **Bundler**
- `import_rule` = **suffix-free relative imports** (NO `.js` extension) + **barrel-first for cross-module imports**

Bundler resolution treats `.js` suffixes as optional. tsup (esbuild) and vitest (vite) both resolve
suffix-free imports under this mode today, so the suffix-free majority is correct and the previous
122 `.js`-suffixed imports in codebase-index/** were the defect. Normalization direction = **remove `.js`**.

### Barrels

- Cross-module imports go through the module barrel: `../types`, `./schemas`, `../interfaces`, `./resources`, `./tools`, `./memory-write`.
- Deep submodule paths are allowed only for within-module local types.
- `index` is dropped where the target is a pure directory index with no sibling `.ts` file of the same name.

### `/index` REQUIRED (kept) — sibling file-barrel collision (dropping would self-reference / be circular)

- `src/mcp/types.ts` → `./types/index` (types.ts is the barrel)
- `src/mcp/entities/task.ts` → `./task/index`
- `src/mcp/entities/memory.ts` → `./memory/index`
- `src/mcp/tools/schemas.ts` → `./schemas/index`
- `src/mcp/tools/kg-archivist.ts` → `./kg-archivist/index` (importing file is kg-archivist.ts)
- `src/mcp/resources/sdk-index.ts` → `./index` (module's own barrel)

> The `file-barrel re-exporting its own directory index` pattern above is the canonical, consistent form — not fragmentation.

## Cleanup inventory (final)

- `.js` suffix import sites: **0** remaining
- `types` deep imports: **0** (all via `../types` barrel)
- `schemas` deep imports: **0** (all via `./schemas` barrel)
- `interfaces` mixed specifiers: **0**
- Remaining `/index`: only the 6 required disambiguation cases above

## Files changed

77 files under src/mcp + src/dashboard (production code only; no ui/, no test edits).

Note: tree was NOT clean at start — 70 uncommitted normalization files were inherited; this pass added the
final site edits (router.ts, completion.ts, mcp-server.ts, indexing-planner.ts, file-discovery.ts,
task.helpers.ts, memory.write.ts, SystemController.ts, dashboard/server.ts).

## Out-of-scope finding (pre-existing, NOT caused by this task)

`src/mcp/tests/codebase-index/visitors.test.ts` — 2 Swift-visitor failures (protocol parsed as `class`
instead of `interface`). Reproduced identical on clean HEAD `3b01c59`. Unrelated to import
normalization; needs a separate bug task.

## Verification results

- `npx tsc --noEmit`: **PASS**
- `npx tsc -p tsconfig.test.json`: **PASS**
- `eslint src/mcp src/dashboard --ext .ts`: **PASS**
- vitest sample (router, memory.read, codebase-index, tasks.e2e, controllers.integration): 385 pass /
  2 fail (both pre-existing Swift visitor, confirmed at HEAD)

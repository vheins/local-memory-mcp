# TASK-131 — Fix codebase-index visitors: Kotlin interfaces + Swift protocols parsed as class

Status: completed · owner: vheins/local-memory-mcp · priority: 3 · phase: debugging

## Summary (2026-08-02)

Root cause was NOT in the tree-sitter visitor kind-switching alone — the Kotlin and Swift
grammar WASMs (`tree-sitter-kotlin.wasm`, `tree-sitter-swift.wasm`) are absent from
`node_modules` in this environment, so `getGrammarPath()` returns `null` and both language
configs are skipped. `.kt` / `.swift` files therefore fall through to the **GenericTextVisitor**
catch-all, whose shared `typeMatch` regex classified `interface`/`protocol`/`trait` as
`SymbolKind.Class`. That single misclassification produced both deterministic failures.

Fixes:

- `src/mcp/codebase-index/parser/generic-visitor.ts` — split the type regex so
  `interface`/`protocol`/`trait` report `SymbolKind.Interface` (class-like branch keeps
  class/struct/object/enum/module/etc. as `Class`). This is what makes the failing runtime
  tests pass.
- `src/mcp/codebase-index/parser/visitors/kotlin-visitor.ts` — replaced the fragile
  `node.text.startsWith("interface")` with a `node.children` scan for the raw `interface`
  token (tree-sitter-kotlin emits `interface` as an unnamed token child of
  `class_declaration`). Robust against preceding modifiers/annotations (e.g. `internal
interface Foo`, `@Ann interface Foo`). This fixes the tree-sitter code path used when
  grammars are bundled (published `dist/grammars`).
- `src/mcp/codebase-index/parser/visitors/swift-visitor.ts` — verified `protocol_declaration`
  already returns `SymbolKind.Interface` (no change needed; only the preserved TASK-117
  import hunk remains).
- TASK-117 uncommitted import-only hunks in kotlin-visitor/swift-visitor/generic-visitor
  are preserved.

Verification:

- `visitors.test.ts` → 30/30 pass (was 28/30). Tests :475 (Kotlin interface) and :528
  (Swift protocol) now pass; assertions were already pinned, no test edits needed.
- Regression: full `src/mcp/tests/codebase-index/` suite (15 files, incl. parser,
  search-symbols, get-file-symbols) → 0 failures.
- `tsc --noEmit` and `tsc -p tsconfig.test.json` → clean; `eslint` on changed files → clean.

## Description

Pre-existing parser bug (found concurrently by multiple test gates on 2026-08-02, reproduced
identically at clean HEAD 3b01c59 — NOT caused by any audit batch).

`src/mcp/tests/codebase-index/visitors.test.ts`:

- :475 — "KotlinVisitor extracts interfaces": `expected 'class' to be 'interface'` — kotlin-visitor
  incorrectly reports interfaces as `class` (likely the `isInterface` node.text check is wrong).
- :528 — "SwiftVisitor extracts protocols (interfaces)": `protocol_declaration` match is wrong —
  parsed as `class`.

Both are deterministic (reproducible in isolation, fails on clean HEAD + same node_modules).

## Scope

Files: `src/mcp/codebase-index/parser/kotlin-visitor.ts`, `src/mcp/codebase-index/parser/swift-visitor.ts`, and the
appropriate tree-sitter grammar/query in `src/mcp/codebase-index/parser/` (generic-visitor / language-routing).

## Fix

- Correct the Kotlin `isInterface` node.text check (Kotlin grammar marks interfaces via
  `interface_declaration` vs `class_declaration`) so visitor returns `interface` for interfaces.
- Correct the Swift `protocol_declaration` handling in swift-visitor so it reports an `interface`
  SymbolKind instead of `class`.
- Add/extend visitors.test.ts assertions to pin both.

## Acceptance

- `npx vitest run src/mcp/tests/codebase-index/visitors.test.ts` → all pass (currently 28 pass / 2 fail).
- No regression in other codebase-index suites (parser, search-symbols, get-file-symbols).
- Forks of the two earlier PRE_EXISTING failures disappear from every future test gate.

## Notes

- Tracked here (file-based fallback) because MCP task tools were unavailable to this session.

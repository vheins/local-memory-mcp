# Design Decisions — Bridge

This folder holds **design-stage ADR drafts** for the codebase-index and storage
areas currently under active design. Canonical, adopted decisions live at
[`decisions/`](../../decisions/) (`ADR-001`–`ADR-008` + `SPEC-001`).

## Ownership split

| Location                          | Purpose                                                                                                  | Lifecycle                       | Numbering                                     |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------- | :------------------------------ | :-------------------------------------------- |
| `design/decisions/` (this folder) | Draft ADRs tied to a design iteration. Allowed to be superseded or withdrawn without a migration record. | Draft → adopted or withdrawn    | `adr-00N-*` (lowercase, hyphenated)           |
| `decisions/`                      | Canonical, adopted ADRs and cross-cutting specs. Source of truth for implemented constraints.            | Proposed → Adopted → Superseded | `ADR-00N-*` / `SPEC-00N-*` (uppercase prefix) |

## When to put an ADR where

- **Use `design/decisions/`** when the decision is scoped to a design deliverable
  that has not shipped (e.g. a new index pipeline, a storage migration design).
  Promote to `decisions/` on adoption.
- **Use `decisions/`** when the decision constrains shipped code or cross-cutting
  behaviour (domain simplification, ownership model, KG infrastructure, unified
  query spec). Every entry there must have an implementation note or verification
  stamp.

## Current inventory

- `design/decisions/adr-001-use-sqlite.md` — SQLite + ONNX foundation. Canonical
  counterpart: none (foundation pre-dates the `decisions/` series; see
  `ADR-001`–`ADR-003` for domain simplifications that build on it).
- `design/decisions/adr-002-codebase-index.md` — Codebase index architecture.
  Canonical counterpart: `decisions/ADR-005-codebase-index-simplification.md`
  (tool consolidation) and `decisions/SPEC-001-unified-nl-query.md` (inline
  `key:value` tag syntax shared with the index query path).

## Links

- Canonical ADRs: [`../../decisions/`](../../decisions/)
- Codebase index architecture: [`../codebase-index/architecture.md`](../codebase-index/architecture.md)
- Operations runbook: [`../../operations/codebase-index.md`](../../operations/codebase-index.md)

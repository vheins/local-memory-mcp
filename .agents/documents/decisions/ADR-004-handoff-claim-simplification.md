# ADR-004: Handoff & Claim Domain Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

## Context

Domain Handoff & Claim saat ini memiliki **6 tools** untuk agent coordination:

- `handoff-create` (931 chars), `handoff-update` (280 chars), `handoff-list` (561 chars)
- `task-claim` (706 chars), `claim-list` (559 chars), `claim-release` (576 chars)
- **Total: ~3,613 chars**

Padahal domain ini melayani 2 konsep berbeda:

- **Handoff**: transfer pekerjaan antar agent
- **Claim**: kepemilikan task oleh agent

Keduanya perlu disagregasi menjadi sub-domain yang jelas dengan pola write/read yang konsisten.

Masalah yang ditemukan:

- `claim-list` tidak konsisten — owner/repo optional (beda dengan tool lain)
- `task-claim` punya side effect auto-promote task ke in_progress — perlu eksplisit
- Masih ada `oneOf` di beberapa schema (handoff-create punya task_id vs task_code)

## Decision Drivers

- **Sub-domain jelas**: handoff dan claim dipisah, bukan digabung
- **Pola write/read**: konsisten dengan memory, task, standard
- **Weak agent friendly**: nama tool obvious, auto-infer intent
- **Zero oneOf**: semua parameter optional

## Decision Outcome

**Chosen option:** 4 tools — handoff-write, handoff-read, claim-manage, + decision_refs di task

### Tools Baru

| Tool            | Mencakup                                | Estimasi Schema         |
| --------------- | --------------------------------------- | ----------------------- |
| `handoff-write` | handoff-create + handoff-update         | ~700 chars              |
| `handoff-read`  | handoff-list                            | ~400 chars              |
| `claim-manage`  | task-claim + claim-release + claim-list | ~1,000 chars            |
| **Total**       | **dari 6 tools / 3,613 chars**          | **~2,100 chars (-42%)** |

### Auto-infer Rules

#### `handoff-write`

| Input                    | Detect              | Aksi                                     |
| ------------------------ | ------------------- | ---------------------------------------- |
| `from_agent` + `summary` | Create fields       | **Create handoff**                       |
| `id` + `status`          | Identifier + status | **Update status** (accept/reject/expire) |

#### `handoff-read`

| Input     | Detect              | Aksi                                |
| --------- | ------------------- | ----------------------------------- |
| (filters) | Status/agent filter | **List handoffs** — paginated, DESC |

#### `claim-manage`

| Input                                        | Detect       | Aksi                                         |
| -------------------------------------------- | ------------ | -------------------------------------------- |
| `agent` + `task_id`/`code` (tanpa `release`) | Agent + task | **Claim task** — auto-promote ke in_progress |
| `agent` + `task_id`/`code` + `release: true` | Release flag | **Release claim**                            |
| `agent` saja (tanpa task_id)                 | Agent filter | **List claims by agent**                     |
| (nothing)                                    | Fallback     | **List all active claims**                   |

### Cross-Cutting: `decision_refs` di task-write

Semua task bisa referensi ke decision memories. Cukup tambah field `decision_refs: string[]` di task-write schema. Di handler, otomatis masuk ke `metadata`.

```jsonc
{ "decision_refs": ["MEM-192", "ADR-002"] }
// → metadata: { decision_refs: ["MEM-192", "ADR-002"] }
```

**Kenapa tidak pakai DB column:** Zero migration. Metadata sudah support free-form object. Agent tetap lihat field di schema.

## Consequences

**Positive:**

- Tool count turun 6 → 3 (sebenarnya 4 dengan claim-manage, tapi claim-manage = 3 old tool)
- Schema size turun ~42% (3,613 → ~2,100 chars)
- Sub-domain jelas: handoff untuk transfer, claim untuk kepemilikan
- `claim-list` fix: owner/repo required seperti tool lain
- `decision_refs` di task memudahkan traceability

**Negative:**

- `claim-manage` menggabungkan 3 operasi (claim, release, list) — auto-infer perlu jelas prioritasnya
- Auto-promote task di claim adalah side effect — agent perlu sadar ini terjadi

## Related ADRs

- ADR-001: Memory Domain Tools Simplification
- ADR-002: Task Domain Tools Simplification
- ADR-003: Standard Domain Tools Simplification

## Implementation Plan

1. **REFACTOR-HC-001:** Implement `handoff-write` handler — create + update status, auto-infer
2. **REFACTOR-HC-002:** Implement `handoff-read` handler — list with filters
3. **REFACTOR-HC-003:** Implement `claim-manage` handler — claim + release + list, fix owner/repo required
4. **REFACTOR-HC-004:** Register 3 tools + remove old 6 definitions + update router + cleanup
5. **REFACTOR-HC-005:** Update integration tests
6. **TASK-006:** Add `decision_refs` field to task-write schema + handler

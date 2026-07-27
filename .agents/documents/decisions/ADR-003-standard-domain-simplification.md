# ADR-003: Standard Domain Tools Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

## Context

Mengikuti pola ADR-001 (Memory) dan ADR-002 (Task), domain Standard perlu disederhanakan.

Domain Standard saat ini memiliki 5 tools:

- `standard-store` (1,774 chars), `standard-update` (925 chars)
- `standard-delete` (912 chars) — sudah support id/ids/code/codes
- `standard-detail` (531 chars), `standard-search` (799 chars)
- **Total: ~4,941 chars / 5 tools**

Masalah yang ditemukan:

- **Conflict detection hanya di store**, update tidak ngecek konflik (bisa duplicate content)
- **Bulk mode bug**: `repo` hardcoded `null` di bulk insert `standards[]`
- **`is_global` default terbalik**: default `true` padahal standard biasanya repo-specific
- Schema masih pakai `oneOf` untuk single vs bulk, dan `id` vs `code`

## Decision Drivers

- **Konsistensi dengan Memory & Task**: pola `write` + `read` + `delete` identik
- **Zero oneOf**: semua parameter optional, auto-infer intent
- **Identifier seragam**: `id`/`code`/`ids`/`codes` (konsisten lintas domain)
- **Fix bugs yang ditemukan**: bulk repo, conflict detection di update, is_global default

## Decision Outcome

**Chosen option:** 3 tools + auto-infer

### Auto-infer Rules

#### `standard-write`

| Input                                  | Detect                | Aksi                                                                                       |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `standards: [...]`                     | Array ada             | **Bulk** — tiap item infer sendiri (create jika ada name+content, update jika ada id/code) |
| `name` + `content` (tanpa `id`/`code`) | Fields create lengkap | **Single create** — conflict check threshold 0.82                                          |
| `id` / `code`                          | Identifier            | **Single update** — juga conflict check                                                    |

**Fix applied:**

- Conflict detection juga di mode update (tidak hanya create)
- Bulk `repo` bug di-fix — `repo` di propagate ke tiap item
- `is_global` default `false` (bukan `true`)

#### `standard-read`

| Input           | Detect            | Aksi                                         |
| --------------- | ----------------- | -------------------------------------------- |
| `id` / `code`   | Single identifier | **Detail single** — full CodingStandardEntry |
| `ids` / `codes` | Array identifier  | **Detail bulk** — array of entries           |
| `query`         | Query string      | **Search** — hybrid scoring (4 komponen)     |
| (nothing)       | Fallback          | **List all** — default limit 20              |

#### `standard-delete`

| Input   | Detect     | Aksi           |
| ------- | ---------- | -------------- |
| `id`    | UUID       | Single by UUID |
| `code`  | Code       | Single by code |
| `ids`   | Array UUID | Bulk by UUID   |
| `codes` | Array code | Bulk by codes  |

### Schema Size Estimation

| Tool Baru         | Mencakup                             | Estimasi Schema  |
| ----------------- | ------------------------------------ | ---------------- |
| `standard-write`  | store + update + bulk                | ~1,800 chars     |
| `standard-read`   | search + detail single + detail bulk | ~1,000 chars     |
| `standard-delete` | single + bulk by id/code/ids/codes   | ~600 chars       |
| **Total**         |                                      | **~3,400 chars** |

## Consequences

**Positive:**

- Tool count turun 5 → 3
- Schema size turun ~31% (4,941 → ~3,400 chars)
- Pola identik dengan Memory & Task — write/read/delete
- Bugs di-fix: bulk repo, conflict update, is_global default
- Zero oneOf — semua optional

**Negative:**

- Search handler (298 lines, hybrid scoring) harus di-refactor jadi bagian dari read
- Breaking change — client harus migrasi

## Related ADRs

- ADR-001: Memory Domain Tools Simplification
- ADR-002: Task Domain Tools Simplification

## Implementation Plan

1. **REFACTOR-STD-001:** Implement `standard-write` handler — store + update + bulk, fix conflict detection, fix bulk repo bug, fix is_global default
2. **REFACTOR-STD-002:** Implement `standard-read` handler — search + detail single + detail bulk via ids/codes
3. **REFACTOR-STD-003:** Refactor `standard-delete` — flatten schema, hapus oneOf
4. **REFACTOR-STD-004:** Register 3 tools + remove old 5 definitions + update router + cleanup
5. **REFACTOR-STD-005:** Update integration tests

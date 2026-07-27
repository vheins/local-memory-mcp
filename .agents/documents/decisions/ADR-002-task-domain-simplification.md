# ADR-002: Task Domain Tools Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

## Context

Mengikuti pola yang sama seperti ADR-001 (Memory Domain), domain Task perlu disederhanakan dari **7 tools** menjadi **3 tools** dengan auto-infer intent dan zero `oneOf`/`mode` parameter.

Domain Task saat ini memiliki 7 tools:

- `task-create` (2,963 chars), `task-create-interactive` (774 chars), `task-update` (2,082 chars)
- `task-delete` (896 chars)
- `task-detail` (735 chars), `task-list` (766 chars), `task-search` (739 chars)
- **Total: ~9,945 chars**

Problematik:

- `task-list` dan `task-search` tumpang tindih — sama-sama query tasks
- `task-create-interactive` adalah varian create dengan elicitation — bukan tool independen
- `task-update` memiliki state machine complex, tapi bisa diakomodasi dalam 1 tool write dengan auto-infer

## Decision Drivers

- **Konsistensi dengan Memory Domain**: pola `write` + `read` + `delete` harus identik
- **Identifier seragam**: semua domain pakai `id`/`code` (tidak ada `task_code`, `memory_id`, dll)
- **Weak agent friendly**: 3 nama tool, semua field optional, infer dari kombinasi field
- **Hemat token**: total schema harus turun signifikan
- **No backward compat**: tool lama dihapus total, tidak ada alias

## Considered Options

1. **7 tools terpisah** — status quo, ~9,945 chars
2. **4 tools** — pisah task-write (create) dan task-update (update) karena state machine complex
3. **3 tools** — task-write (create+update+interactive), task-read (list+search+detail), task-delete — identik dengan memory pattern

## Decision Outcome

**Chosen option:** 3 tools (option 3) — identik dengan ADR-001

### Auto-infer Rules

#### `task-write`

| Input                             | Detect                | Aksi                                                                                              |
| --------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| `tasks: [...]`                    | Array ada             | **Bulk** — tiap item di-infer sendiri (create jika ada phase+title+desc, update jika ada id/code) |
| `interactive: true`               | Flag ada              | **Elicitation** — form tanya user via sampling                                                    |
| `phase` + `title` + `description` | Create fields lengkap | **Single create**                                                                                 |
| `code` + `phase`+`title`+`desc`   | Code + create fields  | **Create with custom code**                                                                       |
| `id` (tanpa phase/title/desc)     | UUID                  | **Update by UUID**                                                                                |
| `code` (tanpa phase/title/desc)   | Code                  | **Update by code**                                                                                |

#### `task-read`

| Input           | Detect            | Aksi                                                            |
| --------------- | ----------------- | --------------------------------------------------------------- |
| `id` / `code`   | Single identifier | **Detail single** — full task + comments + children             |
| `ids` / `codes` | Array identifier  | **Detail bulk** — array of full tasks                           |
| `query`         | Query string      | **Search** — cari by title/description/code                     |
| (sisanya)       | Fallback          | **List** — filter by status/phase, default: backlog+in_progress |

#### `task-delete`

| Input   | Detect     | Aksi               |
| ------- | ---------- | ------------------ |
| `id`    | UUID       | **Single by UUID** |
| `code`  | Code       | **Single by code** |
| `ids`   | Array UUID | **Bulk by UUID**   |
| `codes` | Array code | **Bulk by codes**  |

### Schema Size Estimation

| Tool Baru     | Mencakup                             | Estimasi Schema  |
| ------------- | ------------------------------------ | ---------------- |
| `task-write`  | create + update + interactive        | ~3,000 chars     |
| `task-read`   | list + search + detail + detail bulk | ~1,100 chars     |
| `task-delete` | single + bulk by id/code             | ~600 chars       |
| **Total**     |                                      | **~4,700 chars** |

## Consequences

**Positive:**

- Tool count turun 7 → 3 (hemat 4 nama + deskripsi dari context)
- Schema size turun ~53% (9,945 → ~4,700 chars)
- Pola identik dengan Memory Domain — write/read/delete
- Identifier konsisten: semua domain pakai `id`/`code`/`ids`/`codes`
- Weak agent cukup tahu 3 tool + 3 domain = 9 total tool

**Negative:**

- `task-update` state machine complex (status transitions, claims, handoffs, archive) harus diakomodasi dalam `task-write`
- Breaking change total — client lama harus migrasi
- Tidak ada backward compat (keputusan sengaja)

## Alternatives Considered

### 4 tools (option 2)

Memisahkan `task-update` karena status state machine.

- **Pros:** Update logic lebih terisolasi, schema per tool lebih kecil
- **Cons:** Tidak konsisten dengan memory pattern; weak agent harus bedain kapan pake write vs update

### Status quo — 7 tools (option 1)

- **Pros:** Familiar
- **Cons:** ~9,945 chars; 7 nama tool; identifier tidak konsisten (`task_code` vs `code`)

## Related ADRs

- ADR-001: Memory Domain Tools Simplification (parent pattern)

## Implementation Plan

1. **REFACTOR-TASK-001:** Implement `task-write` handler — create single + bulk + interactive + update single + bulk, auto-infer intent, status state machine, claims/handoffs cleanup, archive to memory
2. **REFACTOR-TASK-002:** Implement `task-read` handler — list + search + detail single + bulk, auto-infer mode
3. **REFACTOR-TASK-003:** Refactor `task-delete` handler — tambah code/codes, rename task_code→code
4. **REFACTOR-TASK-004:** Register 3 task tools + hapus semua old definitions — update router, definitions, schemas, exports
5. **REFACTOR-TASK-005:** Update integration tests

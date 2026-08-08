# ADR-005 — Codebase Index Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfín

> **IMPLEMENTED (verified 2026-08-08):** shipped as `codebase-index` (index via `repoPath`+`repo`; status via `repo` only) and `codebase-read` (name→trace, filePath→file symbols, query→search, none→architecture). Search unifies symbol + NL semantic ranking (5-tier `rankSymbols` + vector blend 0.30/0.70). The 6 legacy read tools (`index_repository`, `index_status`, `search_symbols`, `codebase_search`, `trace_symbol`, `get_file_symbols`, `get_architecture`) no longer exist in the 17 canonical tool set.

## Context

Domain Codebase Index saat ini memiliki **7 tools**:

- `index_repository` (495 chars), `index_status` (242 chars)
- `get_architecture` (331 chars), `get_file_symbols` (234 chars)
- `search_symbols` (583 chars), `codebase_search` (519 chars)
- `trace_symbol` (385 chars)
- **Total: ~2,789 chars / 7 tools**

Domain ini didominasi read operations (6 dari 7 tools). Hanya `index_repository` yang write. `search_symbols` dan `codebase_search` tumpang tindih — bedanya hanya di jumlah filter.

## Decision Drivers

- **Sederhana untuk weak agent**: cukup 3 parameter mutual-exclusive: `name` / `query` / `filePath`
- **Pola konsisten**: `codebase-index` untuk management, `codebase-read` untuk exploration
- **Zero oneOf**: auto-infer dari parameter mana yang diisi

## Decision Outcome

**Chosen option:** 2 tools — codebase-index, codebase-read

### Tools Baru

| Tool             | Mencakup                                                                              | Estimasi Schema         |
| ---------------- | ------------------------------------------------------------------------------------- | ----------------------- |
| `codebase-index` | index_repository + index_status                                                       | ~450 chars              |
| `codebase-read`  | search_symbols + codebase_search + trace_symbol + get_file_symbols + get_architecture | ~1,100 chars            |
| **Total**        | **dari 7 tools / 2,789 chars**                                                        | **~1,550 chars (-44%)** |

### Auto-infer Rules

#### `codebase-index`

| Input                        | Detect         | Aksi                                 |
| ---------------------------- | -------------- | ------------------------------------ |
| `repoPath` + `repo`          | Path diberikan | **Index** — trigger tree-sitter scan |
| `repo` saja (tanpa repoPath) | Hanya repo     | **Status** — cek freshness + count   |

#### `codebase-read`

| Input                        | Mental Model Agent                 | Aksi                                                  |
| ---------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `name: "UserService"`        | "Saya tahu nama symbol-nya"        | **Trace** — definisi + references + export chain      |
| `query: "cari fungsi login"` | "Saya mau cari sesuatu"            | **Search** — unified ranking + NL search              |
| `filePath: "src/auth.ts"`    | "Saya mau lihat isi file"          | **File symbols** — semua symbol dalam file            |
| (nothing)                    | "Project ini struktur-nya gimana?" | **Architecture** — tree overview + language breakdown |

### Schema `codebase-read`

```jsonc
{
	// 3 param mutual-exclusive — agent isi 1 aja
	"name": "string", // → trace
	"query": "string", // → search
	"filePath": "string", // → file symbols

	// Filter opsional
	"kind": "string", // function | class | variable | ...
	"exportedOnly": "boolean",
	"depth": "number (2)", // untuk architecture mode
	"limit": "number (50)",

	"repo": "string",
	"owner": "string (auto)",
	"json": "boolean"
}
```

## Consequences

**Positive:**

- Tool count turun 7 → 2
- Schema size turun ~44% (2,789 → ~1,550 chars)
- 3 parameter mutual-exclusive: agent cukup isi 1 dari 3
- Tidak ada mode/oneOf — auto-infer dari field yang ada
- `search_symbols` dan `codebase_search` digabung — tidak perlu bedain

**Negative:**

- Search internal perlu unified: jika query mengandung code-like terms → symbol ranking, jika NL → semantic
- Backward compat — client lama perlu migrasi

## Related ADRs

- ADR-001 sampai ADR-004

## Implementation Plan

1. **REFACTOR-CI-001:** Implement `codebase-index` handler — index + status, infer dari ada/tidaknya repoPath
2. **REFACTOR-CI-002:** Implement `codebase-read` handler — trace/search/fileSymbols/architecture, infer dari name/query/filePath
3. **REFACTOR-CI-003:** Register 2 tools + remove old 7 definitions + update router + cleanup
4. **REFACTOR-CI-004:** Update integration tests

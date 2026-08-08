# ADR-001 — Memory Domain Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

## Context

Domain Memory saat ini memiliki **9 MCP tools** yang masing-masing memiliki JSON Schema inputSchema sendiri:
`memory-store`, `memory-update`, `memory-search`, `memory-delete`, `memory-detail`, `memory-recap`, `memory-summarize`, `memory-synthesize`, `memory-acknowledge`.

Total schema size mencapai **~8,658 chars** yang dikirim ke agent (LLM) setiap kali `tools/list` dipanggil. Ini memberatkan konteks, terutama untuk agent dengan intelegensi lebih rendah yang kesulitan memilih tool dari banyak opsi.

Analisis menunjukkan:

- `memory-summarize` bukan operasi memory — menulis ke tabel `summaries` (entity terpisah)
- `memory-synthesize` adalah composite orchestration yang memanggil LLM sampling — bukan operasi memory murni
- `memory-detail` dan `memory-recap` adalah varian read dari `memory-search`
- `memory-acknowledge` adalah specialized update
- Beberapa tool memiliki `oneOf`, `enum`, dan parameter `required` yang menyulitkan weak agent

## Decision Drivers

- **Agent lemah harus bisa pakai**: nama tool obvious, semua parameter optional, tool infer intent otomatis
- **Hemat token**: total schema size harus turun drastis
- **Zero oneOf/mode**: tidak boleh ada parameter `mode` atau discriminated union — agent cukup kasih field yang relevan
- **Bulk support**: write dan delete harus support bulk operation (create + update + acknowledge dalam satu array `memories[]`)
- **Partial execution**: bulk error handling bersifat partial — item gagal di-skip, error di-return sebagai list

## Considered Options

1. **9 tools terpisah** (status quo) — masing-masing punya schema kecil, tapi banyak tool overhead
2. **5 tools** — konsolidasi parsial (merge detail+search, ack+update, rename summarize)
3. **3 tools + auto-infer** — `memory-write`, `memory-read`, `memory-delete` dengan intent inference dari field yang ada

## Decision Outcome

**Chosen option:** 3 tools + auto-infer (option 3)

**Rationale:**

- Paling hemat token: ~2,850 chars vs 8,658 (hemat **67%**)
- Zero `oneOf`/`mode` — tool infer intent dari kombinasi field yang diberikan
- Weak agent cukup tahu 3 tool name: write, read, delete
- `memories[]` unified array handle bulk create, bulk update, bulk acknowledge dalam satu struktur
- Partial execution membuat bulk lebih resilient

### Mapping Detail

| Tool Baru       | Mencakup                                              | Cara Infer                                                                                     |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `memory-write`  | `memory-store`, `memory-update`, `memory-acknowledge` | `content` → create; `id`+`acknowledge` → acknowledge; `id`+field → update; `memories[]` → bulk |
| `memory-read`   | `memory-search`, `memory-detail`, `memory-recap`      | `query` → search; `id`/`code` → get detail single; `ids`/`codes` → detail bulk; kosong → recap |
| `memory-delete` | `memory-delete` (existing)                            | `id`/`code` → single; `ids`/`codes` → bulk                                                     |

### Tools yang Dipindahkan

| Tool                                  | Domain Baru   | Alasan                                        |
| ------------------------------------- | ------------- | --------------------------------------------- |
| `memory-synthesize` → `synthesize`    | Agent Context | Composite orchestration, require LLM sampling |
| `memory-summarize` → `repo-summarize` | Agent Context | Operasi di tabel summaries, bukan memory      |

## Consequences

**Positive:**

- Tool overhead turun dari 9 → 3 (hemat 6 nama + deskripsi dari context)
- Schema size turun ~67% (8,658 → ~2,850 chars)
- Weak agent cukup hafal 3 tool name
- Tidak ada parameter `required` — semua opsional, tool infer sendiri
- Bulk unified (`memories[]`) mengurangi cognitive load: 1 struktur untuk create + update + ack

**Negative:**

- Schema `memory-write` lebih besar dari schema `memory-store` sebelumnya (~1,400 vs ~2,406 chars, tapi ini karena dia mencakup 3 tool)
- Auto-infer menambah kompleksitas internal handler (logic untuk bedakan create vs update)
- Breaking change: client yang panggil `memory-store`, `memory-update`, dll harus migrasi ke `memory-write`
- Legacy router perlu maintain backward compat aliases

**Neutral:**

- `synthesize` dan `repo-summarize` tetap ada sebagai tool terpisah di domain Agent Context — tidak dihapus

## Alternatives Considered

### 5 tools (option 2)

Mempertahankan `memory-search` standalone, `memory-store` standalone, dan merge sisanya.

- **Pros:** Transisi lebih gradual, schema per tool lebih kecil
- **Cons:** Masih 5 tool name yang harus dipelajari weak agent; tidak sehemat 3 tools

### Status quo — 9 tools (option 1)

- **Pros:** Familiar, backward compat penuh
- **Cons:** 8,658 chars di context; 9 nama tool; weak agent sering salah pilih tool; banyak parameter `required`

## Implementation Plan

1. **memory-write:** Handler baru yang menggabungkan store + update + acknowledge. Support single via field inference, support bulk via `memories[]`. Partial execution untuk bulk errors.
2. **memory-read:** Handler baru yang menggabungkan search + detail + recap. Infer dari ada/tidaknya `query` atau `id`.
3. **memory-delete:** Refactor minimal — tambahin support `code` params dan bulk codes.
4. **Register & router:** Update `registerAllTools` dan legacy router. Maintain backward compat aliases.
5. **Remove old definitions:** Hapus 6 tool definitions yang sudah di-merge dari `MEMORY_TOOL_DEFINITIONS`.
6. **Move synthesize & summarize:** Pindahkan ke domain Agent Context.
7. **Test:** Update integration tests sesuai tool baru.

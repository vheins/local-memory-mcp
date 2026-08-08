# ADR-007 — Agent Context Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

> **IMPLEMENTED (verified 2026-08-08):** `agent-context` is the sole Agent Context tool; `decision-log` and `session-summarize` were absorbed into `memory-write` as convenience modes (`type:"decision"` with context/rationale/alternatives; `type:"task_archive"` with key_decisions/next_steps — auto-formats content, src/mcp/tools/memory-write/helpers.ts). Neither legacy tool is in the 17 canonical set.

## Context

Domain Agent Context saat ini memiliki **3 tools**:

- `agent-context` (515 chars) — aggregasi memories + tasks + decisions
- `decision-log` (743 chars) — convenience wrapper untuk memory-write type=decision
- `session-summarize` (676 chars) — convenience wrapper untuk memory-write type=task_archive
- **Total: ~1,934 chars / 3 tools**

`decision-log` dan `session-summarize` sebenarnya adalah convenience wrapper yang cuma format data lalu panggil `handleMemoryStore` (sekarang `memory-write`). Keduanya bisa dieliminasi dengan menambahkan structured fields ke memory-write.

## Decision Drivers

- **Konsisten dengan pola domain lain**: write/read/delete pattern
- **Minimal tool count**: cukup 1 tool
- **Memory-write sebagai satu-satunya write path**: semua write via memory-write

## Decision Outcome

**Chosen option:** 1 tool — `agent-context` saja. `decision-log` dan `session-summarize` di-absorb ke memory-write.

### Perubahan

| Old Tool            | Nasib    | Cara Baru                                                              |
| ------------------- | -------- | ---------------------------------------------------------------------- |
| `agent-context`     | ✅ Tetap | Standalone read aggregation                                            |
| `decision-log`      | ❌ Hapus | `memory-write({ type: "decision", context, rationale, alternatives })` |
| `session-summarize` | ❌ Hapus | `memory-write({ type: "task_archive", key_decisions, next_steps })`    |

### Field Tambahan di memory-write

Untuk akomodasi structured formatting yang sebelumnya ada di decision-log dan session-summarize:

```jsonc
// Di memory-write schema — new optional fields
{
	// ── Decision fields (untuk type: "decision") ──
	"context": "string", // "Kenapa keputusan ini diambil"
	"rationale": "string", // "Alasan memilih opsi ini"
	"alternatives": "string[]", // "Opsi lain yang dipertimbangkan"

	// ── Session fields (untuk type: "task_archive") ──
	"key_decisions": "string[]", // "Keputusan penting di sesi ini"
	"next_steps": "string[]" // "Langkah selanjutnya"
}
```

**Cara kerja di handler:**

- Jika `type === "decision"` dan `context`/`rationale` ada → auto-format ke content dengan struktur:
  ```
  ## Context
  {context}
  ## Rationale
  {rationale}
  ## Alternatives
  - {alternatives}
  ```
- Jika `type === "task_archive"` dan `key_decisions`/`next_steps` ada → auto-format ke content dengan struktur:
  ```
  ## Key Decisions
  - {key_decisions}
  ## Next Steps
  - {next_steps}
  ```
- Jika tidak ada structured fields → content seperti biasa

### `agent-context` — Tidak Berubah

```jsonc
{
	"objective": "string", // NL query untuk context
	"type_filter": "enum", // Filter memory type
	"limit": "number (5)",

	"repo": "string",
	"owner": "string (auto)",
	"json": "boolean"
}
```

## Consequences

**Positive:**

- Tool count turun: 3 → 1
- Schema size turun: 1,934 → ~515 chars (-73%)
- Satu-satunya write path: memory-write (tidak ada shortcut terpisah)
- Agent cukup tahu 1 tool untuk context

**Negative:**

- Schema memory-write bertambah 5 field (tapi semua optional)
- Agent harus ingat type="decision" untuk decision-log, type="task_archive" untuk session summary

## Related ADRs

- ADR-001 (Memory) — memory-write adalah write path utama
- ADR-002 sampai ADR-006

## Implementation Plan

1. **REFACTOR-AC-001:** Add decision-log fields (context, rationale, alternatives) to memory-write handler + auto-format logic
2. **REFACTOR-AC-002:** Add session-summarize fields (key_decisions, next_steps) to memory-write handler + auto-format logic
3. **REFACTOR-AC-003:** Remove decision-log and session-summarize from definitions + cleanup
4. **REFACTOR-AC-004:** Update integration tests

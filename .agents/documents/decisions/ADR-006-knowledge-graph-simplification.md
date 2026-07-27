# ADR-006: Knowledge Graph Domain Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

## Context

Domain Knowledge Graph saat ini memiliki **7 tools**:

- `create_entity`, `delete_entity`, `create_relation`, `delete_relation`, `delete_observation`
- `query_graph`, `kg-backfill`
- **Total: 7 tools**

Padahal KG adalah **neural query engine** untuk memory, task, dan standard — bukan CRUD entity standalone. Entity dan relations seharusnya **auto-populated** oleh write tools (memory-write, task-write, standard-write), bukan dikelola manual via tool terpisah.

## Decision Drivers

- **KG = query engine**: tool satu-satunya adalah untuk neural query, bukan CRUD
- **Auto-populate**: entity/relations dibuat otomatis oleh write tools via NLP extraction
- **Minimal tool count**: dari 7 → 1 tool user-facing
- **CLI untuk admin**: backfill dan admin operations via CLI, bukan MCP tool

## Decision Outcome

**Chosen option:** 1 tool — `kg-query`. Backfill sebagai internal CLI command.

### Tools

| Tool       | Fungsi                | Mencakup              |
| ---------- | --------------------- | --------------------- |
| `kg-query` | Neural query explorer | query_graph + explore |

**Removed (internal/CLI):**

| Old Tool             | Nasib                                            |
| -------------------- | ------------------------------------------------ |
| `create_entity`      | Internal — auto dari memory/task/standard write  |
| `delete_entity`      | Cascade — otomatis saat data sumber dihapus      |
| `create_relation`    | Internal — auto dari NLP extraction + similarity |
| `delete_relation`    | Cascade                                          |
| `delete_observation` | Cascade                                          |
| `kg-backfill`        | CLI command (`npx ... kg backfill`)              |

### Auto-Populate di Write Tools

| Write Tool       | Extraction                                                                       | Status          |
| ---------------- | -------------------------------------------------------------------------------- | --------------- |
| `memory-write`   | Entities + observations dari content via `saveExtractions()`                     | ✅ Sudah ada    |
| `task-write`     | Entities dari title/description + relations dari parent/depends_on/decision_refs | ➕ Perlu tambah |
| `standard-write` | Entities dari name/context/stack + relations dari parent_id/similarity           | ➕ Perlu tambah |

### `kg-query` — Neural Explorer

```jsonc
{
	"query": "string", // Neural search: "JWT authentication flow"
	"entity": "string", // Fokus ke entity: "AuthService"
	"type": "memory|task|standard|all", // Filter domain
	"depth": "number (2)", // Graph traversal depth
	"limit": "number (20)",

	"repo": "string",
	"owner": "string (auto)",
	"json": "boolean"
}
```

## Consequences

**Positive:**

- Tool count turun drastis: 7 → 1
- Schema size dari ~3,500 ke ~500 chars (-86%)
- Konsep jelas: KG adalah query engine, bukan CRUD manual
- Auto-populate mengurangi beban agent — tidak perlu create entity manual
- Cascade delete menjaga konsistensi — entity KG hilang saat sumber dihapus

**Negative:**

- Perlu tambah logic auto-populate di task-write dan standard-write handler
- Cascade delete perlu diimplementasikan di memory/task/standard delete handlers
- Client yang currently menggunakan CRUD tools (create_entity, dll) harus migrasi

## Related ADRs

- ADR-001 sampai ADR-005

## Implementation Plan

1. **REFACTOR-KG-001:** Implement `kg-query` handler — neural search + graph traversal + cross-domain merge
2. **REFACTOR-KG-002:** Add auto-populate logic to task-write — NLP extraction dari title/description, relations dari parent/depends_on/decision_refs
3. **REFACTOR-KG-003:** Add auto-populate logic to standard-write — NLP extraction dari name/context/stack, relations dari parent_id/similarity
4. **REFACTOR-KG-004:** Add cascade delete di memory/task/standard delete — hapus entity/relations terkait saat sumber dihapus
5. **REFACTOR-KG-005:** Register 1 tool + remove old 7 definitions + update router + CLI untuk backfill
6. **REFACTOR-KG-006:** Update integration tests

# ADR-006 — Knowledge Graph Infrastructure

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

## Context

Knowledge Graph saat ini memiliki **7 MCP tools** yang berdiri sendiri:

- `create_entity`, `delete_entity`, `create_relation`, `delete_relation`, `delete_observation`
- `query_graph`, `kg-backfill`

Setelah analisis, KG sebenarnya adalah **infrastructure neural layer** yang harusnya embedded di memory-read, task-read, dan standard-read — bukan domain tool terpisah.

Konsep:

```
memory-read({ query: "neural network" })
  ├── result: memories        ← search seperti biasa
  └── kg: { entities, relations }  ← auto dari KG layer

task-read({ query: "auth" })
  ├── result: tasks
  └── kg: { entities, relations }

standard-read({ query: "laravel controller" })
  ├── result: standards
  └── kg: { entities, relations }
```

## Decision Drivers

- **Zero KG tools**: KG adalah infrastructure, bukan user-facing domain
- **Embedded di read tools**: memory-read/task-read/standard-read otomatis return KG context
- **Auto-populate**: entity/relations dibuat oleh write tools
- **Cascade delete**: entity KG ikut terhapus saat sumber dihapus

## Decision Outcome

**Chosen option:** 0 KG tools — fully embedded.

Semua 7 tools dihapus. KG entities/relations:

- **Auto-populated** oleh memory-write (✅ existing), task-write (➕), standard-write (➕)
- **Auto-returned** oleh memory-read, task-read, standard-read sebagai `kg` field tambahan
- **Auto-deleted** oleh cascade saat memory/task/standard dihapus

### Perubahan di Read Tools

Setiap read tool menambahkan field `kg` di response:

```jsonc
{
  // hasil search biasa
  "results": [...],

  // tambahan KG neural context
  "kg": {
    "entities": [
      { "name": "JWT", "type": "concept", "source_domain": "memory" },
      { "name": "AuthService", "type": "symbol", "source_domain": "codebase" }
    ],
    "relations": [
      { "from": "JWT", "to": "AuthService", "type": "implemented_by" },
      { "from": "JWT", "to": "TASK-042", "type": "referenced_in" }
    ]
  }
}
```

## Consequences

**Positive:**

- Tool count turun: 7 → 0
- Konsep bersih: KG adalah infrastructure, bukan tool
- Agent cukup panggil read tools biasa — dapat neural context otomatis
- Tidak ada tool tambahan yang perlu dipelajari weak agent

**Negative:**

- Read tools response jadi lebih besar (ada field kg tambahan)
- Query performance: perlu join dengan KG tables di setiap read

## Related ADRs

- ADR-001 sampai ADR-005

## Implementation Plan

1. **REFACTOR-KG-001:** Add auto-populate KG logic to task-write handler
2. **REFACTOR-KG-002:** Add auto-populate KG logic to standard-write handler
3. **REFACTOR-KG-003:** Embed KG entities/relations in memory-read response
4. **REFACTOR-KG-004:** Embed KG entities/relations in task-read response
5. **REFACTOR-KG-005:** Embed KG entities/relations in standard-read response
6. **REFACTOR-KG-006:** Add cascade delete KG entities on memory/task/standard delete
7. **REFACTOR-KG-007:** Remove all 7 old KG tool definitions + cleanup
8. **REFACTOR-KG-008:** Update integration tests

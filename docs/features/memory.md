# Long-Term Semantic Memory

The Memory feature is the core of the server: a persistent, searchable store of knowledge that survives across AI sessions. Agents write what they learn (`memory-write`), retrieve it later with hybrid semantic+keyword search (`memory-read`), and retire stale entries (`memory-delete`) — so context is never lost and never rebuilt from scratch.

Memory lives in a local SQLite database (no cloud), with embeddings computed locally via `Xenova/all-MiniLM-L6-v2` (ONNX Runtime).

---

## What Is Memory & Why It Matters

Memory entries ("memories") are small, structured knowledge records scoped to an `owner` and `repo` (or marked global). Each memory has:

| Field               | Purpose                                                           |
| :------------------ | :---------------------------------------------------------------- |
| `type`              | One of five types (below).                                        |
| `title` + `content` | The knowledge itself (`content` ≥ 10 chars).                      |
| `importance`        | 1–5 priority scale.                                               |
| `code`              | Optional short human-readable identifier (`≤ 20` chars).          |
| `tags`              | Free-form labels used for tech-stack affinity and filtering.      |
| `ttlDays`           | Optional time-to-live — the memory is archived when it expires.   |
| `supersedes`        | UUID/code of a memory this one replaces (see Conflict rejection). |
| `scope`             | `branch` / `folder` / `language` for workspace grounding.         |

### The five memory types

| Type           | Use for                                                               |
| :------------- | :-------------------------------------------------------------------- |
| `code_fact`    | Verified facts about code (APIs, file layout, behavior).              |
| `decision`     | Architectural/product decisions with rationale (see Auto-formatting). |
| `mistake`      | Past errors and their fixes — so agents avoid repeating them.         |
| `pattern`      | Reusable approaches and best practices.                               |
| `task_archive` | Session/completed-task summaries (see Auto-formatting).               |

> Note: there is **no** `task` or `bug` memory type — mistakes are recorded as `mistake`, and completed-work summaries as `task_archive`. Tasks themselves are tracked by the [Task feature](task.md).

---

## How It Works

### Writing (`memory-write`)

`memory-write` auto-infers the operation from the parameters you pass:

- `content` (no `id`/`code`) → **CREATE** a single memory
- `id`/`code` + fields → **UPDATE** an existing memory
- `id`/`code` + `acknowledge` → **ACKNOWLEDGE** (feedback on usefulness)
- `memories[]` → **BULK** (mixed create/update/acknowledge items)

Two conveniences build well-structured content for you:

- `type: "decision"` + `context`/`rationale`/`alternatives` — auto-formats the content and sets `importance: 4`.
- `type: "task_archive"` + `key_decisions`/`next_steps` — auto-formats a session summary and sets `importance: 3`.

**Conflict rejection (anti-hallucination).** When you CREATE a memory whose content is more than **0.85** cosine-similar to an existing memory, the write is rejected with a conflict error. The response tells you to pass `id`/`code` to update the existing entry, `acknowledge` it, or provide `supersedes` if the new entry replaces the old one. This prevents duplicate, contradictory knowledge.

**Asynchronous embedding.** After a write, the vector is computed by a background queue — the semantic score converges within about a second. Until then the entry is still findable by keyword (FTS5).

### Searching (`memory-read`)

`memory-read` also auto-infers its mode:

- `query` → **SEARCH** (hybrid scoring)
- `id`/`code`/`ids`/`codes` → **DETAIL** (full entries)
- none → **RECAP** (stats + most recent entries by date)

Search blends four signals (**40% semantic similarity + 30% FTS5 keyword + 15% recency + 15% domain affinity**). The similarity threshold is **adaptive**: small candidate sets (≤ 5) use a lenient 0.10 cutoff so young projects still return results; larger sets use a stricter **0.40** cutoff. If everything falls below the cutoff, the single best match is still returned ("guarantee-at-least-1") — the thresholds are the anti-hallucination guard against returning noise, and they are deliberately **not** env-overridable.

Search supports:

- **Inline key:value tags** in the query — e.g. `query: "language:php framework:filament"`, `query: "auth tag:a,b lang:php"` — which are auto-extracted into structured filters (unknown keys remain free text).
- **Scope/affinity boosts** via `current_tags`, `current_file_path`, and a `scope` object (`branch`, `folder`, `language`) — memories from your current folder/stack rank higher.
- **Time Tunnel** — natural-language date phrases in the query: `today`, `yesterday`, `this week`, `last week`, `last month`, `last N days` / `past N days`, `last N weeks` / `past N weeks`, `last_hour` / `past_hour`. The phrase is stripped from the text and applied as a date window (local time).

Every result shows an `[acked]` / `[unacked]` marker, and result lists include a `kg` block with related Knowledge Graph context when available.

### Acknowledging (`memory-write` + `acknowledge`)

Agents report how useful a memory was:

- `acknowledge: "used"` — memory was genuinely helpful (increments the recall count).
- `acknowledge: "irrelevant"` / `"contradictory"` — logged for diagnostics (not persisted as a counter).

Recall tracking powers the "knowledge debt" ranking signal — unacknowledged memories get a small boost on work-related searches so they surface for review, and memories with many hits but zero recalls are auto-archived (below).

### Deleting (`memory-delete`)

Soft-deletes (archives) memories, single or bulk (`id`/`code`/`ids`/`codes`). Deleting also purges the entry's queued embedding job and its Knowledge Graph observations/entities. Archived memories stay searchable if you pass `include_archived: true`.

### Soul Maintenance (natural forgetting)

The server runs a **Soul Maintenance** sweep on startup (skipped if it already ran within the last 24h):

1. **Decay** — active memories unused for 7+ days lose importance by 0.5 per cycle (floored, minimum 1).
2. **Immunization** — memories carrying configured immune tags never decay.
3. **Expired archiving** — memories whose `expires_at` (from `ttlDays`) has passed are archived.
4. **Low-score archiving** — memories unused for **90+ days** with `importance < 3`, and memories with `hit_count > 10` but `recall_count = 0`, are archived.
5. **Pruning** — action-log rows older than 30 days (plus a row-count cap) and Knowledge Graph observations older than 7 days are pruned.

---

## MCP Usage

Create a decision memory:

```json
{
	"tool": "memory-write",
	"arguments": {
		"owner": "vheins",
		"repo": "local-memory-mcp",
		"type": "decision",
		"title": "Hybrid search over vector-only",
		"context": "Choosing the memory search engine",
		"rationale": "Vector + FTS5 keyword + recency + domain beats any single signal",
		"alternatives": ["FTS5 only", "Vector only"],
		"importance": 4,
		"tags": ["search", "architecture"]
	}
}
```

Search with a time window and inline tag:

```json
{
	"tool": "memory-read",
	"arguments": {
		"owner": "vheins",
		"repo": "local-memory-mcp",
		"query": "embedding queue last week",
		"limit": 5
	}
}
```

Acknowledge a memory as used:

```json
{
	"tool": "memory-write",
	"arguments": {
		"owner": "vheins",
		"repo": "local-memory-mcp",
		"code": "MEM-001",
		"acknowledge": "used"
	}
}
```

---

## Dashboard Usage

The **Memories** tab (sidebar → Memories) opens the **Memory Explorer**: list/search memories, view details, create new entries, and bulk-import from CSV. Memory and task overview stats also appear in the **Dashboard** tab ("Memory Overview" widget).

---

## Tips & Limitations

- Pass `current_tags` (or inline `tag:`) to reuse learned patterns across projects that share a stack.
- Use `code` for stable short identifiers so other agents can reference entries without long UUIDs.
- Don't re-store a memory you already have — update it (`id`/`code`) or mark it `supersedes` instead of hitting the 0.85 conflict rejection.
- Semantic recall needs the vector model: first use after a fresh install downloads `Xenova/all-MiniLM-L6-v2` (network required once).
- Mid-word substring matches are **not** guaranteed — FTS uses prefix matching; exact-token recall is reliable.
- Archived (`include_archived`) and recent-window searches behave differently: the Time Tunnel filter applies after scoring, so a phrase outside all result candidates will return nothing.

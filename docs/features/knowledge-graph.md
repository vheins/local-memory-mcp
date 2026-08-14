# Knowledge Graph

The Knowledge Graph (KG) is a structured entity-relationship layer that sits on top of the memory store. Whenever content is written — memories, standards, tasks, or codebase indexes — an offline NLP extractor identifies named entities (people, places, organizations, concepts) and the relationships between them, and links them back to the source content. The result is a browsable web of project knowledge, not just a list of rows.

> **Why it matters:** Search tells you _what_ is relevant; the graph tells you _how things connect_. "Which decisions mention the embedding queue?" or "what does this file relate to?" are graph questions — answered by traversing relationships instead of reading every record.

---

## What Is It?

The KG consists of three primitives:

- **Entities** — typed nodes: `person`, `place`, `organization`, `concept`.
- **Relations** — typed edges between entities (e.g. `co_mentioned`), each with a **confidence** 0–1.
- **Observations** — links from an entity to the content that mentioned it ("Mentioned in memory: …", "Mentioned in codebase: src/foo.ts").

It is **auto-populated infrastructure**: there are **no KG MCP tools** — entities/relations/observations are written automatically by the embedding pipeline whenever memories, standards, or tasks are stored, and when the codebase index runs (codebase entities derive from indexed symbols/references). You _read_ the graph through the embedded `kg` payload that `memory-read`, `task-read`, and `standard-read` attach to their results, and you _manage_ it in the dashboard.

---

## How It Works

### Auto-extraction (offline NLP)

When content is written, an offline extractor (the `compromise` NLP library) scans the text and:

1. Detects **people**, **places**, and **organizations** via named-entity patterns.
2. Extracts **concept** entities from noun phrases (after filtering stopwords, pronouns, and generic words like "time", "company", "software").
3. Creates **`co_mentioned` relations** between every pair of entities found in the same document.
4. Writes one **observation** per entity linking it to the source title/files.

Extraction is best-effort: failures are logged and never block the write; content longer than 5000 chars is truncated for performance.

### Confidence labels

Every relation carries a confidence score that shows how trustworthy the edge is — the dashboard labels edges as `relation_type · NN%`:

| Source                                   | Default confidence |
| :--------------------------------------- | :----------------- |
| Auto-extracted co-mentions (NLP guesses) | 0.55               |
| Semantic metadata                        | 0.8                |
| Codebase parser edges (indexed symbols)  | 0.9                |
| Manually created relations (dashboard)   | 1.0                |

### Reading the graph

Read tools attach an aggregated `kg` block to their structured results (search/list modes of `memory-read`, `task-read`, `standard-read`) listing the entities + relations behind the returned titles — so an agent gets graph context in the same response.

### Dashboard is the manual editing surface

The dashboard's **Knowledge Graph** tab is the only place to manually add, edit, or delete entities, relations, and observations (via API CRUD). It renders an interactive force-directed graph: click an entity for its details (type, description, relations), inspect observation text, and see confidence labels per edge.

---

## MCP Usage

There are no KG tools to call directly. You read the graph as part of existing reads:

```json
{
	"method": "tools/call",
	"params": {
		"name": "memory-read",
		"arguments": { "query": "embedding queue", "owner": "vheins", "repo": "local-memory-mcp", "limit": 5 }
	}
}
```

The structured response includes an embedded `kg` field (when entities exist for the returned titles), e.g.:

```json
{
	"kg": {
		"entities": [{ "name": "Transformers.js", "type": "organization" }],
		"relations": [{ "type": "co_mentioned", "confidence": 0.55 }]
	}
}
```

---

## Dashboard Usage

Open the **Knowledge Graph** tab. You get:

- An interactive **force-directed graph** of entities and relations for the selected repo (canvas-rendered, zoom/pan, click entity → detail panel).
- **Confidence-labeled edges** (`relation_type · NN%`, dimmed by confidence bucket) so you can tell NLP guesses from verified edges.
- **Add / edit / delete** — the only manual CRUD surface for graph data.

The graph is populated automatically; if it looks empty, write some memories/standards or index the repo and the entities appear.

---

## Tips & Limitations

- **No KG MCP tools by design (ADR-006).** There is no `kg-write` / `kg-read` tool — graph data flows from content writes, and manual edits happen in the dashboard.
- **Auto-extraction is NLP, not magic.** Co-mentioned edges are guesses (0.55 confidence) — an edge between "Filament" and "Rheza" may be coincidence. Trust dashboard-marked manual (1.0) and codebase (0.9) edges more.
- **Observations are transient.** The soul-maintenance sweep prunes observations older than 7 days (entities/relations persist); stale observation links disappear on their own.
- **Codebase entities only cover indexed data.** Graph entities from code come from the tree-sitter index — index the repo first (see [Codebase Index](codebase-index.md)).
- **Global vs per-repo.** Graph data is repo-scoped like the rest of the store; switch repos in the dashboard to see that project's graph.

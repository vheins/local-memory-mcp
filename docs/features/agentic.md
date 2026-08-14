# Agentic Session Tools

The Agentic Session Tools are high-level "productivity" tools that package the raw memory/task data into session-ready context and answers. Where `memory-read` returns one list of rows, `agent-context` returns a coherent briefing, `synthesize` answers a question grounded in your memories, and `repo-summarize` maintains a standing per-repo summary.

> **Why it matters:** These tools exist to cut down the number of round-trips and to fight hallucination. Instead of stitching together five tool calls, an agent makes one call and gets a curated, grounded context block — or a full answer produced by its own LLM, constrained to local evidence.

---

## What Is It?

Three MCP tools:

- **`agent-context`** — one-call session briefing: relevant memories + active tasks + recent decisions.
- **`synthesize`** — ask a question and get an LLM answer grounded in local memories/tasks (uses the client's MCP **sampling** capability).
- **`repo-summarize`** — maintain a short, standing per-repo project summary from a set of signals.

Two related conveniences ride on `memory-write` (flat fields):

- `type: "decision"` + `context`/`rationale`/`alternatives` — structured decision persistence.
- `type: "task_archive"` + `key_decisions`/`next_steps` — searchable session summaries.

---

## How It Works

### `agent-context` — the session briefing

Give it `owner` / `repo` (and optionally a `query` and `type_filter`) and it returns a single context block with three sections:

1. **Relevant memories** — ranked by `vector score × 0.3 + importance/5 × 0.7` (a deliberate divergence from search's hybrid weights: context favors importance).
2. **Active tasks** — up to 10 tasks with status `in_progress`, `pending`, `backlog`, or `blocked`.
3. **Recent decisions** — decision-type memories (deduplicated against the memory list).

This is designed as the one thing an agent loads at the start of a session to "remember where it was."

### `synthesize` — grounded Q&A

`synthesize` (requires the client to advertise MCP **sampling** support; the tool is hidden otherwise) works in iterations:

1. Seeds grounding context: a memory recap (8 latest), the repo summary (if `include_summary`), and a task snapshot (`backlog,pending,in_progress,blocked`, up to 15).
2. Sends your `objective` plus that context to the client's LLM via MCP sampling.
3. Lets the model call read-only MCP tools (`memory-read`, `task-read`, …) to gather more evidence, up to `max_iterations` (default 3).
4. Returns a text answer whose explicit directive is to **answer strictly from grounded context** and say so when evidence is insufficient — not to invent details.

Bounds: `max_iterations` 1–5, `max_tokens` 128–4000 (default 1200).

### `repo-summarize` — the standing summary

Pass `signals` (a list of summary lines); the server persists a small per-repo summary (one per `owner`/`repo`). The summary is then included automatically the next time `synthesize` runs in that repo, so the agent's briefing stays current without re-reading every memory.

---

## MCP Usage

Load session context at the start of a task:

```json
{
	"method": "tools/call",
	"params": {
		"name": "agent-context",
		"arguments": { "query": "embedding queue", "owner": "vheins", "repo": "local-memory-mcp", "limit": 5 }
	}
}
```

Ask a grounded question:

```json
{
	"method": "tools/call",
	"params": {
		"name": "synthesize",
		"arguments": {
			"objective": "Why did we switch from direct vector writes to an async embedding queue?",
			"owner": "vheins",
			"repo": "local-memory-mcp"
		}
	}
}
```

Persist a repo summary:

```json
{
	"method": "tools/call",
	"params": {
		"name": "repo-summarize",
		"arguments": {
			"signals": ["MCP server with local SQLite memory", "Embeddings offloaded to an async queue"],
			"owner": "vheins",
			"repo": "local-memory-mcp"
		}
	}
}
```

---

## Dashboard Usage

These are session/MCP-facing tools and have **no dedicated dashboard tab** — there is nothing to browse. Their effects are visible elsewhere: `repo-summarize` output is consumed by `synthesize`, and the memories/tasks they package are browsable in their own tabs. Logs of these calls appear in the dashboard activity feed.

---

## Tips & Limitations

- **`synthesize` needs client sampling.** If your client doesn't advertise MCP sampling, the tool is not registered — no sampling, no tool.
- **`agent-context` ranks by importance, not search relevance.** It's a briefing, not a search; for precise lookups keep using `memory-read`.
- **`synthesize` is only as grounded as the store.** Its prompt forbids inventing facts, but if the memory store is sparse the answer will say "insufficient evidence" — add memories first.
- **Keep `repo-summarize` signals short and factual.** The summary is replayed into every later `synthesize` session in that repo; stale or wrong signals will mislead the answers.
- **Decision/task_archive conveniences require the matching type.** Passing `context` without `type: "decision"` (or `key_decisions` without `type: "task_archive"`) is rejected.

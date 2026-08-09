# Core Features

This project is more than just text storage; it is a "brain" system for AI agents designed for long-term stability and project consistency.

## 🧠 Hybrid Semantic Search

The system blends four signals to find the most relevant memories:

1. **Semantic similarity (40%)** — `all-MiniLM-L6-v2` embeddings computed locally via Transformers.js.
2. **Keyword match (30%)** — exact token matches via SQLite FTS.
3. **Recency (15%)** — newer entries rank higher (exponential decay, ~30-day half-life).
4. **Domain / workspace affinity (15%)** — a boost when the memory's repository or folder matches your current working context.

The threshold is **adaptive**: small result sets use a lenient cutoff (0.10 for memories) so a fresh project still returns results; larger sets use a stricter one (0.40). If every candidate falls below the threshold, the single best match is still returned (guarantee-at-least-1). Full detail: [Hybrid Search Logic](hybrid-search.md).

## 🔄 Tech-Stack Affinity

**Case:** You have knowledge about **Filament** in Project A. When you start Project B (also using Filament), your Agent can automatically pull those best practices by passing `current_tags: ["filament"]` when searching — or because the memory is tagged `filament`.

- Memories can be scoped **per-repo**, shared across **tags** (affinity), or **Global** (`is_global: true`).

## 🛡️ Anti-Hallucination Guard

One of the main issues with AI Agents is "matching" irrelevant information.

- **Conflict Rejection:** storing a memory that semantically overlaps an existing one by more than **0.85** cosine similarity is rejected with a `MEMORY_CONFLICT` error. The response tells the Agent to pass `id`/`code` to update, `acknowledge` it, or `supersedes` if the new entry replaces the old one.
- **Adaptive Relevance Threshold:** search filters weak matches (small-set threshold 0.10, large-set 0.40) instead of returning noise.

## 📈 Memory Recall Tracking

Every time an Agent uses a memory, it reports feedback via `memory-write` with `acknowledge` (e.g. `"acknowledge": "used"`).

- We track the **Utility Rate** (how often a memory was actually helpful).
- Memories with zero recalls despite many hits (`hit_count > 10` and `recall_count = 0`) are archived as low-value.

## 📉 Automatic Archiving (Natural Forgetting)

Just like humans, not everything needs to be remembered forever.

- **Expired Memories:** Memories with a TTL (`ttlDays`) are automatically archived once `expires_at` passes.
- **Low-Score Memories:** Memories unused for **90 days** with `importance < 3` are moved to the archive to keep the Agent's context clean.

## 🧩 Knowledge Graph

Structured entity-relationship storage that maps complex domain knowledge:

- **Entities** with types (person, place, organization, concept) and descriptions
- **Relations** with typed connections between entities
- **Observations** linking context to entities
- **Auto-extraction**: offline NLP (compromise.js) extracts named entities when memories, standards, and tasks are stored and when the codebase index runs
- **Auto-populated** from the **memory | standard | task | codebase** domains — codebase KG entities derive from the indexed symbol/reference data (no separate symbol API)
- **Dashboard**: interactive force-directed graph visualization with add/edit/delete — the only manual editing surface (see [Dashboard Guide](dashboard-guide.md))

> **Decision (2026-08-09): NO KG MCP tools.** KG is auto-populated infrastructure (ADR-006): entities/relations are written by the embedding outbox from memory/standard/task writes and codebase index runs, and read via the embedded `kg` field in memory-read/task-read/standard-read. There are no MCP tools for direct graph CRUD; graph management happens in the dashboard's Knowledge Graph tab (API CRUD).

## 🕰️ Time Tunnel (Temporal Search)

Filter memory searches by natural-language time phrases — just add one to your query:

- `today`, `yesterday`
- `this week`, `last week`
- `last month`
- `last N days` / `past N days`, `last N weeks` / `past N weeks`
- `last_hour` / `past_hour`

Seamlessly integrates with existing search — the temporal phrase is stripped from the query and applied as a date window.

## 🧬 Soul Maintenance (Decay Engine)

Biological-style memory lifecycle management:

- **Decay:** memories unused for 7+ days (default `decayAfterDays`) lose importance at a fixed rate per cycle (floored, minimum 1).
- **Immunization:** memories tagged with immune tags never decay.
- **Archiving:** memories whose decayed importance drops below the threshold are archived.
- **Startup sweep:** runs on server start with a 24-hour dedup guard (expired + low-score + decayed).

## 🤖 Agentic Productivity Tools

- `agent-context` — one-call session context (relevant memories + active tasks + recent decisions)
- `memory-write` (`type: "decision"`) — structured decision persistence with context/rationale/alternatives
- `memory-write` (`type: "task_archive"`) — searchable session summaries via `key_decisions`/`next_steps`
- `synthesize` — ask questions grounded in local memories using your own LLM
- `repo-summarize` — keep a short per-repo project summary

## ⚠️ Disclaimer

All features are provided **"AS IS"** without any warranty of performance or accuracy.

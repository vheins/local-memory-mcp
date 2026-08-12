# Tool Reference & Usage Guide

A practical guide to the tools this MCP server exposes to AI agents. Each tool is grouped by domain with usage patterns and examples.

> **`owner` & `repo` — critical requirement:** Most tools accept `owner` (GitHub org/username) and `repo` (project name). If omitted, the server tries to infer them from the workspace roots / working directory — but this is unreliable. **Always pass both explicitly** to avoid failures. As a shortcut, you can use `"owner/repo-name"` format for `repo` and the server will auto-extract `owner`. You can also pass `scope: { owner, repo }`.

> **One tool, many modes:** The server exposes **17 unified tools**. Each tool auto-detects what you want from the parameters you pass (see per-tool "Auto-infer" notes below). Older dotted names such as `memory-store`, `memory-search`, or `task-create` are **not** separate tools — they are described here as _modes_ of the unified tools.

---

## Memory Tools (Durable Knowledge)

These tools manage your project's long-term memory: architectural decisions, code facts, patterns, and mistakes.

### `memory-write` — Store / Update / Acknowledge a Memory

Three modes, auto-inferred:

| Mode            | What triggers it               | Use for                                                       |
| --------------- | ------------------------------ | ------------------------------------------------------------- |
| **Create**      | `content` present              | Storing a new memory (formerly `memory-store`)                |
| **Update**      | `id` or `code` + fields        | Editing an existing memory (formerly `memory-update`)         |
| **Acknowledge** | `id` or `code` + `acknowledge` | Reporting a memory was useful (formerly `memory-acknowledge`) |
| **Bulk**        | `memories: [...]`              | Mixed create/update/acknowledge in one call                   |

**Create example:**

```json
{
	"type": "decision",
	"title": "Use SQLite for local persistence",
	"content": "We chose SQLite over JSON files because...",
	"importance": 4,
	"scope": { "owner": "my-org", "repo": "my-project" },
	"tags": ["database", "architecture"]
}
```

**Create fields:**

- `type` — `code_fact`, `decision`, `mistake`, `pattern`, or `task_archive`
- `title` — short human-readable title (3-255 chars)
- `content` — the memory content (min 10 chars)
- `importance` — number 1-5; how critical this is (higher = slower decay)
- `scope` — **object** with `owner` and `repo` (or pass `owner`/`repo` top-level)
- `tags` (optional) — technology labels for cross-project discoverability
- `code` (optional) — auto-generated as `MEM-001`, `MEM-002`, etc. if omitted (sequential per repo)
- `agent` / `model` (optional) — auto-captured from the session if omitted
- `role` (optional, default `"unknown"`) — role of the agent creating this memory
- `metadata` (optional) — structured auxiliary context
- `ttlDays` (optional) — time-to-live in days; after this the memory expires
- `supersedes` (optional) — memory code or UUID this entry replaces
- `is_global` (optional, default `false`) — if true, shared across all repositories
- `status` (optional) — `active` (default) or `archived`

**Decision convenience (formerly `decision-log`):** add `type: "decision"` with `context` + `rationale` + `alternatives` and the content is auto-formatted (importance defaults to 4):

```json
{
	"type": "decision",
	"title": "Use SQLite over PostgreSQL",
	"context": "We need local-first storage without server setup",
	"rationale": "SQLite is embedded, zero-config, and sufficient for single-user agent workflows",
	"alternatives": ["PostgreSQL", "JSON files"],
	"scope": { "owner": "my-org", "repo": "my-project" }
}
```

**Session archive (formerly `session-summarize`):** add `type: "task_archive"` with `key_decisions` + `next_steps` and the content is auto-formatted (importance defaults to 3):

```json
{
	"type": "task_archive",
	"title": "Session: authentication flow",
	"key_decisions": ["Use JWT with 24h expiry"],
	"next_steps": ["Add refresh token rotation"],
	"scope": { "owner": "my-org", "repo": "my-project" }
}
```

**Update example:**

```json
{
	"code": "MEM-001",
	"importance": 5,
	"status": "archived"
}
```

**Acknowledge example** — mandatory after using a memory to generate code. Helps the decay system know what's useful:

```json
{
	"code": "MEM-001",
	"acknowledge": "used",
	"application_context": "Used this pattern when implementing the auth middleware"
}
```

**Conflict rejection (Anti-Hallucination Guard):** creating a memory whose content overlaps an existing one above the conflict threshold is rejected with a `MEMORY_CONFLICT` error. The hint tells you to pass `id`/`code` for an update, `acknowledge`, or `supersedes` if the new entry replaces the old one.

### `memory-read` — Search / Detail / Recap

Three modes, auto-inferred:

| Mode       | What triggers it                   | Use case                                                        |
| ---------- | ---------------------------------- | --------------------------------------------------------------- |
| **Search** | `query`                            | Find relevant memories (formerly `memory-search`)               |
| **Detail** | `id` / `code` (or `ids` / `codes`) | Full content of one or more memories (formerly `memory-detail`) |
| **Recap**  | nothing else                       | Overview stats + top memories (formerly `memory-recap`)         |

**Search example:**

```json
{
	"query": "authentication flow",
	"repo": "my-project",
	"limit": 5
}
```

**Pro tips:**

- Use `current_tags: ["react", "typescript"]` to pull tech-stack relevant memories from other projects (Tech-Stack Affinity).
- Use `type` filter (e.g. `"decision"`, `"pattern"`), importance range (`min`/`max`), and `include_archived: true` to include archived/decayed memories.
- Natural-language dates work in the query: `"yesterday"`, `"last week"`, `"last 3 days"` (Time Tunnel).

**Detail example** — lookup by `id` (UUID) or `code` (e.g. `MEM-001`):

```json
{ "code": "MEM-001" }
```

**Recap example:**

```json
{ "repo": "my-project" }
```

### `memory-delete` — Remove Memories

Single or bulk:

```json
{ "code": "MEM-001" }
```

```json
{ "codes": ["MEM-001", "MEM-002"] }
```

**Not-found semantics:** a single-target delete (`id`/`code`) throws when the target is missing; a bulk delete (`ids`/`codes`) skips missing targets, deletes the rest, and reports them in `errors`/`skippedCount` (partial execution). Applies uniformly to `memory-delete`, `standard-delete`, and `task-delete`.

### `repo-summarize` — Update Repo Summary (formerly `memory-summarize`)

Keeps a high-level project summary that agents can quickly reference:

```json
{
	"repo": "my-project",
	"signals": ["Microservices migration in progress", "PostgreSQL chosen as primary DB"]
}
```

### `synthesize` — Ask Questions About Your Knowledge (formerly `memory-synthesize`)

Uses your AI client's own LLM (sampling) to answer questions grounded in local memories:

```json
{
	"repo": "my-project",
	"objective": "What do we know about authentication?"
}
```

> Note: `synthesize` is only registered when the client advertises sampling support.

---

## Task Tools (Work Management)

### `task-write` — Create / Update Tasks (formerly `task-create` & `task-update`)

Modes, auto-inferred in this order:

1. `tasks: [...]` → **Bulk** — each item infers create vs update independently
2. `interactive: true` → **Interactive** — elicits missing fields from the user
3. `phase` + `title` + `description` → **Create**
4. `id` or `code`/`task_code` present → **Update**

**Create example** (`task_code` optional — auto-generated as `TASK-001`, `TASK-002`, etc. sequential per repo):

```json
{
	"repo": "my-project",
	"phase": "implementation",
	"title": "Implement JWT middleware",
	"description": "1. Create middleware class\n2. Add token validation\n3. Write tests",
	"priority": 4,
	"status": "pending",
	"suggested_skills": ["fix-bug", "implement-feature"]
}
```

**Bulk create example:**

```json
{
	"repo": "my-project",
	"tasks": [
		{ "task_code": "AUTH-001", "phase": "impl", "title": "...", "description": "..." },
		{ "task_code": "AUTH-002", "phase": "impl", "title": "...", "description": "..." }
	]
}
```

**Update / progress example:**

```json
{
	"repo": "my-project",
	"task_code": "AUTH-001",
	"status": "in_progress",
	"comment": "Starting implementation"
}
```

**When completing:**

```json
{
	"repo": "my-project",
	"task_code": "AUTH-001",
	"status": "completed",
	"est_tokens": 1500,
	"commit_id": "abc123",
	"changed_files": ["src/middleware/auth.ts", "tests/auth.test.ts"],
	"comment": "All tests passing"
}
```

**Status rules:**

- New tasks must start as `backlog` or `pending`.
- Any status change **requires a `comment`** unless `force: true` is passed.
- You cannot jump straight to `completed` from `backlog`/`pending`/`blocked` — the task must pass through `in_progress` first.
- `completed` / `canceled` are terminal: claims are auto-released, linked pending handoffs are expired, and completed tasks are archived to memory.

### `task-read` — Search / Detail / List (formerly `task-list` & `task-detail`)

Modes, auto-inferred:

| Mode       | What triggers it               | Example                                                                 |
| ---------- | ------------------------------ | ----------------------------------------------------------------------- |
| **Search** | `query` and/or `issue_ref`     | keyword + semantic search across tasks, with optional issue-link filter |
| **Detail** | `task_code` / `id` (or arrays) | full task incl. comments + coordination state (claims, handoffs)        |
| **List**   | nothing else                   | paginated list, filtered by `status`                                    |

**List example:**

```json
{ "repo": "my-project" }
```

Filters by default to `in_progress` and `pending`. Use `status` for custom filters:

```json
{ "repo": "my-project", "status": "backlog", "limit": 20 }
```

**Search examples** — results distinguish _text matches_ from tasks _structurally linked to a GitHub issue_ (`#NNN` in title/description/comments):

```json
{ "repo": "my-project", "query": "issue 544" }
```

Every result row exposes `issue_refs` (detected `#NNN` refs) and `match_reason` (`issue` when the task references an issue the query is about, `text` otherwise); the text summary adds a `- N linked to issue #544 · M text matches` breakdown so counts are not misread.

> **Note (TASK-436):** comment content is scanned for `#NNN` refs only on issue-scoped searches (an explicit `issue_ref` or a query carrying issue tokens like `issue 544` / `#544`). On generic keyword queries, `issue_refs` is filled from title/description alone — a ref that exists only in a comment is still displayed on issue-scoped searches, where the link analysis runs.

Filter to tasks that really link issue #544 (also works without `query` — lists every task linked to the issue):

```json
{ "repo": "my-project", "query": "issue 544", "issue_ref": "544" }
```

**Detail example** — returns full description, comments, coordination state (claims, handoffs), and status history:

```json
{ "repo": "my-project", "task_code": "AUTH-001" }
```

### `task-delete` — Remove Tasks

```json
{ "repo": "my-project", "task_code": "AUTH-001" }
```

**Not-found semantics:** same partial-execution contract as described under `memory-delete` (single reference throws, bulk skips + reports).

---

## Standard Tools (Coding Standards Library)

### `standard-write` — Save / Update Standards (formerly `standard-store` & `standard-update`)

**Create** (requires `name` + `content` + `tags` + `metadata`):

```json
{
	"name": "React Component Naming",
	"content": "Use PascalCase for component filenames matching the export name.",
	"tags": ["naming", "react"],
	"metadata": { "source": "team-agreement" },
	"stack": ["react"],
	"language": "typescript",
	"is_global": true
}
```

**Update** (`code` + fields):

```json
{
	"code": "STD-001",
	"name": "React Component Naming (Updated)",
	"version": "2.0.0"
}
```

Codes are auto-generated as `STD-001`, `STD-002`, etc. (sequential per repo or global scope).

### `standard-read` — Search / Detail / List (formerly `standard-search` & `standard-detail`)

Modes, auto-inferred:

| Mode       | What triggers it          | Example                                                   |
| ---------- | ------------------------- | --------------------------------------------------------- |
| **Search** | `query` / `stack` present | MANDATORY before implementing — find applicable standards |
| **Detail** | `id` / `code` (or arrays) | full standard content                                     |
| **List**   | nothing else              | paginated list                                            |

**Search example:**

```json
{ "stack": ["react", "typescript"] }
```

**Detail example:**

```json
{ "code": "STD-001" }
```

### `standard-delete` — Remove Standards

```json
{ "code": "STD-001" }
```

**Not-found semantics:** same partial-delete contract as `memory-delete`.

---

## Coordination Tools (Multi-Agent Handoff)

### `handoff-write` — Create or Update Handoffs (formerly `handoff-create` & `handoff-update`)

**Create** (requires `summary` + `from_agent`, scoped by owner/repo):

```json
{
	"repo": "my-project",
	"from_agent": "agent-a",
	"to_agent": "agent-b",
	"task_code": "AUTH-001",
	"summary": "Auth middleware needs review",
	"context": {
		"next_steps": ["Review the JWT validation logic", "Add refresh token endpoint"],
		"blockers": ["Awaiting secrets manager access"]
	}
}
```

**Update** (`id` + `status`):

```json
{ "id": "handoff-uuid", "status": "accepted" }
```

### `handoff-read` — Inspect Handoff Queue (formerly `handoff-list`)

Modes, auto-inferred:

| Mode            | What triggers it         | Example                                                    |
| --------------- | ------------------------ | ---------------------------------------------------------- |
| **Detail**      | `id` present             | one handoff                                                |
| **List claims** | `claim: true` or `agent` | active claims                                              |
| **Search**      | `query` present          | filtered handoff search                                    |
| **List**        | nothing else             | all handoffs, filter with `status`/`to_agent`/`from_agent` |

```json
{ "repo": "my-project", "status": "pending" }
```

### `claim-manage` — Take / Release / Inspect Ownership (formerly `task-claim`, `claim-list`, `claim-release`)

Modes, auto-inferred:

| Mode              | What triggers it                | Example                  |
| ----------------- | ------------------------------- | ------------------------ |
| **Claim**         | `task_id`/`task_code` + `agent` | take ownership of a task |
| **Release**       | `release: true` + reference     | clear stale ownership    |
| **List by agent** | `agent` only                    | claims for one agent     |
| **List all**      | nothing else                    | all active claims        |

**Claim example:**

```json
{
	"repo": "my-project",
	"task_code": "AUTH-001",
	"agent": "agent-b",
	"role": "maintainer"
}
```

**Release example:**

```json
{ "repo": "my-project", "task_code": "AUTH-001", "release": true }
```

**List example:**

```json
{ "repo": "my-project" }
```

---

## Common Agent Workflows

### Starting a New Session

```
1. task-read (repo: my-project, status: pending)
2. Pick ONE task from the list
3. claim-manage (task_code: ..., agent: ..., role: ...)
4. task-read (task_code: ...) — full detail
5. standard-read (stack: [relevant tech])
6. Work on the technical task
7. task-write (task_code: ..., status: completed, est_tokens: N, comment: ...)
```

### Debugging a Bug

```
1. memory-read (query: error description, repo: ...)
2. memory-read (code: <result code>) — full content
3. Fix the issue
4. memory-write (type: mistake, about what went wrong)
5. task-write (if a task was tracking the fix)
```

### Knowledge Transfer Between Agents

```
1. task-read / memory-read to gather context
2. handoff-write with next_steps and blockers
3. The receiving agent sees handoff-read (status: pending) and picks it up
4. Receiving agent calls handoff-write (id: ..., status: accepted)
```

### Onboarding to a New Project

```
1. synthesize (objective: "What is this project about?")
2. memory-read (repo: ...) — recap of top memories
3. task-read (repo: ...) — what's pending
4. standard-read (stack: [...]) — coding rules
5. Start working
```

---

## Tool Groups Summary

| Group        | Tools                                                                          | Purpose                     |
| ------------ | ------------------------------------------------------------------------------ | --------------------------- |
| Memory       | `memory-read`, `memory-write`, `memory-delete`, `repo-summarize`, `synthesize` | Durable long-term knowledge |
| Task         | `task-read`, `task-write`, `task-delete`                                       | Work item lifecycle         |
| Standard     | `standard-read`, `standard-write`, `standard-delete`                           | Reusable coding rules       |
| Coordination | `handoff-read`, `handoff-write`, `claim-manage`                                | Multi-agent orchestration   |

| Tool              | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `memory-read`     | Search / detail / recap memories                                   |
| `memory-write`    | Create / update / acknowledge memories                             |
| `memory-delete`   | Remove memories (single or bulk)                                   |
| `repo-summarize`  | Update a repo's short project summary                              |
| `synthesize`      | LLM-grounded Q&A over local memories                               |
| `task-read`       | Search / detail / list tasks                                       |
| `task-write`      | Create / update / bulk task operations                             |
| `task-delete`     | Delete tasks (single or bulk)                                      |
| `standard-read`   | Search / detail / list coding standards                            |
| `standard-write`  | Create / update standards                                          |
| `standard-delete` | Delete standards (single or bulk)                                  |
| `handoff-read`    | Inspect handoffs or active claims                                  |
| `handoff-write`   | Create / update handoffs                                           |
| `claim-manage`    | Claim, release, or list task ownership                             |
| `agent-context`   | One-call session context                                           |
| `codebase-index`  | Build / refresh / status of the codebase index                     |
| `codebase-read`   | Search / trace / file symbols / architecture / content grep (CODE) |

> **`codebase-read` modes** (auto-inferred per ADR-005): `name` → TRACE, `filePath` → FILE, `content` → CODE (grep indexed file contents on disk, matches enriched with their enclosing symbol), `query` → SEARCH, nothing → ARCHITECTURE (tree + language breakdown + top-level exports + dead-code candidates/hotspots). The legacy name `search_code` (content search with symbol context) was **design intent only** — it never shipped as a tool; the feature exists as the `CODE` mode of `codebase-read`.

---

## Agentic Tools

### `agent-context` — One-Call Session Context

Returns relevant memories, active tasks, and recent decisions for the current session:

```json
{ "owner": "my-org", "repo": "my-project", "objective": "implement auth", "limit": 5 }
```

### Structured Decision Logging

Not a separate tool — use `memory-write` with `type: "decision"` plus `context`, `rationale`, and `alternatives` (see [Memory Tools](#memory-write--store--update--acknowledge-memories)).

### Session Summaries

Use `memory-write` with `type: "task_archive"` plus `key_decisions` and `next_steps`, or `repo-summarize` for the persistent per-repo project summary.

---

## Knowledge Graph (Dashboard-managed)

The Knowledge Graph stores entities, typed relations, and observations, with automatic entity extraction when memories, standards, and tasks are stored and when the codebase index runs (offline NLP, via the embedding outbox worker).

- **Create / edit / delete** entities, relations, and observations happen in the **Web Dashboard → Knowledge Graph tab** (and via the dashboard API) — the only manual editing surface.
- The graph is **auto-populated from the memory, standard, task, and codebase domains** — entities/relations are written by the embedding outbox from memory/standard/task writes and codebase index runs. Codebase KG entities derive from the indexed symbol/reference data (not from a separate symbol API).

> **Edge confidence labels (verified 2026-08-10, migration v24 / TASK-325 + TASK-330):** every `relations` row carries a **`confidence`** value (`REAL NOT NULL DEFAULT 1.0`), and the KG tab renders it — edges are labeled `relation_type · NN%` at the midpoint and dimmed by confidence bucket (≥0.85 solid, 0.6–0.85 amber, <0.6 dimmed red; edges at 1.0 or with no value show the relation type without a `%`). The value reflects **first-write confidence** (insert-time constant per writer — `INSERT OR IGNORE` means the first writer wins): **0.55** default for all-auto NLP extraction (`co_mentioned`), **0.8** for semantic metadata (task `depends_on`/`inspired_by`, standard `extends`/`related_to`), **0.9** for parser-deterministic codebase edges, and **1.0** for manual/explicit relations (and any pre-v24 edge). The dashboard list API exposes it as `GET /api/kg/graph` → edge `{source, target, relation_type, confidence}`.

> **Decision (2026-08-09): NO KG MCP tools.** KG is auto-populated infrastructure (ADR-006): entities/relations are written by the embedding outbox from memory/standard/task writes and codebase index runs; reading happens via the embedded `kg` field in memory-read/task-read/standard-read. The dashboard KG tab remains the only manual editing surface (API CRUD).
>
> The tool names `create_entity`, `delete_entity`, `create_relation`, `delete_relation`, and `delete_observation` were **legacy design intent only** — never shipped as canonical MCP tools (matching ADR-006's "zero KG tools" outcome; no formerly-style mapping applies).
>
> **Note (verified 2026-08-09):** `source_domain` in the embedded `kg` context is caller-decorated — it reflects the querying domain (`memory` / `task` / `standard`), not stored provenance. Codebase entities are reachable by name-matching and can surface under the caller's domain label on name overlap; there is no separate codebase KG API.

---

## Upstream Inspiration

The **Knowledge Graph** feature is **inspired by [Beledarian/mcp-local-memory](https://github.com/Beledarian/mcp-local-memory)** — the structured entity/relation graph concept is reimplemented with this project's own schema and offline NLP extraction.

It is **not** drop-in compatible: the upstream names `remember_fact`, `remember_facts`, `recall`, and `forget` are not provided as tools or aliases. Use the canonical tool names documented above (`memory-write`, `memory-read`, `memory-delete`, etc.).

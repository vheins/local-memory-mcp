---
name: server-instructions
description: Main instructions for the MCP server
---

Local Memory MCP — persistent memory, task coordination, and coding standards for AI agents.

## Contract Ownership

This file is the CANONICAL tool contract for `local-memory-mcp`. It is the SINGLE SOURCE OF TRUTH for:

- data scoping rules
- registered (canonical) tool names — no legacy/unregistered names
- required/optional fields and auto-infer semantics
- who may call each operation and when (who/when) — see Who / When matrix
- micro-flows for every multi-step operation

Process/orchestration (macro workflow S0→Synthesize→S1→S2→Execute→Close, gates, pipeline, fallback, git safety) lives in `AGENTS.md`. Do NOT redefine the tool contract in `AGENTS.md`, and do NOT duplicate this contract anywhere else.

> **Workflow note**: These MCP tools are the mechanism. The macro workflow (S0→Synthesize→S1→S2→Execute→Close) is the orchestration, defined in `AGENTS.md`.

## Data Scoping

All data (memories, tasks, handoffs, claims) is scoped by **owner/repo**:

- **owner** = organization/namespace (e.g., GitHub org, username)
- **repo** = project/repository name

Pass both `owner` and `repo` whenever a tool requires them. The `owner/repo` pair forms the unique data boundary.

### Owner Rule (CRITICAL)

The `owner` field MUST be the GitHub username or organization that OWNS the repository. For example:

- Repo `vheins/local-memory-mcp` → owner=`vheins`
- Repo `my-org/my-project` → owner=`my-org`

NEVER use the agent's name (e.g., `sentinel`, `test-executor`, `claude`) as the owner.
NEVER guess the owner from the working directory path.

If unsure, run `git remote -v` in the project directory — the remote URL (e.g., `git@github.com:vheins/local-memory-mcp.git`) gives you both `owner` and `repo`.

**Two ways to provide owner/repo:**

1. **Explicit** (preferred — most reliable):

   ```json
   { "owner": "vheins", "repo": "local-memory-mcp" }
   ```

2. **Shorthand** — use `owner/repo` format for `repo`; the server auto-extracts `owner`:

   ```json
   { "repo": "vheins/local-memory-mcp" }
   ```

**Session-wide defaults (can be omitted):** `owner`, `repo`, `agent`, and `model` are auto-populated from the session context and environment when not explicitly provided:

| Field   | Fallback chain                                                                                |
| :------ | :-------------------------------------------------------------------------------------------- |
| `owner` | tool arg → `session.owner` (git remote) → `inferOwnerFromSession`                             |
| `repo`  | tool arg → `session.repo` (directory basename) → `inferRepoFromSession`                       |
| `agent` | tool arg → `session.lastSeenAgent` → `session.clientName` (handshake) → `MCP_CLIENT_NAME` env |
| `model` | tool arg → `session.lastSeenModel` → `MCP_MODEL` env                                          |

Setting these explicitly in the tool call always takes priority over session defaults.

Violation: tasks created with a wrong owner will be invisible to other agents querying with the correct owner.

### Dashboard repo-only view is intentional (ADR-008)

The dashboard aggregates by **short `repo` only** (`owner = ""` reads like `MemoryService.list({ repo })` / `TaskService.getTasksByRepo("", repo)` in `src/dashboard/services/`). A `GET /api/memories?repo=my-app` or tasks/stats equivalent therefore **intentionally merges** `alice/my-app` and `bob/my-app` into one operational view of the single-host SQLite DB. This is not a bug — document a per-owner filter instead if you need isolation. Dashboard rows SHOULD render an **owner badge** (the stored `owner` string) so mixed-owner views are self-explanatory.

### Global vs scoped tables (ADR-008)

| Tables                                                                                                                                | `is_global` | Representation                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | :---------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memories`, `coding_standards`                                                                                                        |   **Yes**   | `repo NOT NULL` + `is_global` recommended; `coding_standards.repo` is still nullable for backward compat — new writes SHOULD set `repo` and use `is_global = 1` for globals |
| `tasks`, `task_comments`, KG (`entities`/`relations`/`observations`), `exploration_observations`, telemetry/audit/queue/vector tables |   **No**    | `repo NOT NULL`, no `is_global`; strict `(owner, repo)` scope                                                                                                               |
| `codebase_*`                                                                                                                          |     N/A     | Repo-keyed only (no `owner` column) — see below                                                                                                                             |

Reads that support globals use `((owner = ? AND repo = ?) OR is_global = 1)` when `owner` is present; dashboard repo-only reads use strict `repo = ?` (and therefore see all owners). See ADR-008 for the full table policy.

### Codebase owner isolation — out of scope

The codebase index (`codebase_files` / `codebase_symbols` / `codebase_references` plus `codebase_symbols_fts`) is partitioned by `repo` string only; no `owner` column and no per-owner isolation is planned. See ADR-008.

> Full rationale and consequences: `.agents/documents/decisions/ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md`.

## Core Workflows

**Memory**: `memory-read` (search/detail/recap) → `memory-write` (create/update/acknowledge/bulk) → `memory-delete`

- Auto-infer: `content` → create; `id`/`code` → update or acknowledge; `memories[]` → bulk
- Durable only (arch, patterns, decisions, fixes)
- `memory-write` with `acknowledge` after code gen from memory
- Global scope = cross-repo only; prefer repo-specific
- `memory-write` with `type=decision` = shortcut for decision memories (auto-sets type=decision, importance=4, agent=current, model=current, scope=current)
- `repo-summarize` = archive session signals as task_archive summary (type=task_archive, importance=3)
- `agent-context` = recall memories + tasks for the current agent
- `synthesize` = composite contextual synthesis via MCP sampling (requires client sampling support)

### memory-write required fields (create)

Every create `memory-write` call MUST include these fields:

| Field        | Type                                                                | Description                                   |
| :----------- | :------------------------------------------------------------------ | :-------------------------------------------- |
| `type`       | enum: `code_fact`, `decision`, `mistake`, `pattern`, `task_archive` | Memory category                               |
| `title`      | string (3-255 chars)                                                | Concise title, no metadata                    |
| `content`    | string (min 10 chars)                                               | Body of the memory                            |
| `importance` | number (1-5)                                                        | 1=low, 5=critical                             |
| `scope`      | object `{ owner, repo }`                                            | `owner`=GitHub org/username, `repo`=repo name |

`agent` and `model` are optional — auto-populated from session context when omitted:

```json
{
	"type": "code_fact",
	"title": "Auth uses JWT",
	"content": "Authentication system uses JWT tokens with 1h expiry.",
	"importance": 3,
	"scope": { "owner": "vheins", "repo": "local-memory-mcp" }
}
```

### memory-write update fields

A `memory-write` update accepts the same fields as create but all are optional (only provide the fields to change). Either `id` (UUID) or `code` (string) is required to identify the target memory.

**Tasks**: `task-read` (list/search/detail) → `claim-manage` (claim → in_progress) → `task-write` (update / status=completed); cleanup via `task-delete`

- Register via `task-write` before execution
- NEVER skip in_progress
- Commit: `type(scope): [task-code] message` + `- [Title]` + `[Summary]`
- Complete auto-releases claims + expires linked handoffs

**Standards**: `standard-read` → `standard-write`; cleanup via `standard-delete`

- MANDATORY pre-implementation gate
- 1 rule/entry, normative contract

**Handoffs/Claims**: `handoff-read` → `handoff-write` | `claim-manage`

- Create ONLY for unfinished work (concrete next owner/steps)
- NO handoff for completion summaries → use task comments (`task-write` with `comment`)

**Codebase Index**: `codebase-index` → `codebase-read` — **MANDATORY FIRST for ALL codebase exploration (STRICT)**

- `codebase-index(repo)` = status (freshness + count + runtime capability state); `codebase-index(repoPath + repo)` = index (tree-sitter scan); `warmup:true` explicitly initializes the index engine.
- Always check status first. If stale, trigger index before querying.
- `codebase-read`: `query` → search, `name` → symbol trace, `filePath` → file symbols, `content` → grep indexed file contents, none → architecture. `depth` only applies inside architecture mode.
- **STRICT PRIORITY**: ALL agents (orchestrator + sub-agents) MUST start every codebase context search with `codebase-index`/`codebase-read` — symbols, files, architecture, trace, and content grep.
- **FORBIDDEN as first resort**: `rg` / `grep` / `glob` / `seed` / `cat` / `bash cat` / `find` / `ls` / brute-force filesystem search — NEVER use before `codebase-read`. Allowed ONLY as fallback after index returns empty/stale or cannot answer, and ONLY via `explore` sub-agent (which itself tries index first before `glob`/`grep`/`cat`). Direct `rg`/`grep`/`cat` without prior `codebase-read` is a violation. `cat` is for reading a **known** file only — never for blind exploration.

**Exploration Observations**: `observation-write` → `observation-read`

- `observation-write`: create / update / bulk / refresh high-signal exploration observations with source fingerprints. Auto-infer: `subject`+`fact`+`confidence`+`evidence[]` → create; `id` + fields → update; `observations[]` (1–100) → bulk create; `refresh_ids[]` (1–100) → refresh fingerprints. Repeated normalized facts + evidence are idempotent (deduplicated). Evidence items require `file_path` and optionally `symbol_id`, `start_line`/`end_line`, `commit_sha`.
- `observation-read`: list / detail evidence-backed observations by `owner`/`repo` scope with filters `subject`, `task_id`, `file_path`, `symbol_id`, `min_confidence` (0–1). Detail via `id` (UUID). Stale and unverifiable findings are excluded by default (`include_stale:false`); set `include_stale:true` to include them. `hydrate_evidence:false` by default (set true to inline evidence). Paginated via `limit` (1–100, default 20) + `offset`.

**Agent Context (budgeted)**: `agent-context`

- Compiles deterministic, token-budgeted context from 7 sources: `memories`, `decisions`, `tasks`, `handoffs`, `standards`, `observations`, `code`.
- Key params: `objective` (or legacy `query`) ranks candidates from every source; `task_code` pins a task as critical; `current_file_path` retrieves compact code pointers; `sources[]` selects the source set (default all 7); `type_filter` filters memory type.
- Budget: `budget.tokens` (256–20_000, default 2_000) + `budget.max_items` (1–100, default 20) + `budget.code_depth` (0–5, default 1, graph expansion from `current_file_path`). Candidates are ranked by priority + lexical overlap with `objective`, packed until either budget is hit; overflow is reported in `exclusions` with reason `token_budget` or `item_budget`.
- `include_stale:false` by default (fresh observations only); `limit` (1–100, default 5) caps legacy memory/task projections. `context_pack_id` / `session_id` enable cache-hit correlation (opaque, never prompt text).

**Synthesis**: `synthesize` (requires client sampling support) + `repo-summarize`

- `synthesize`: composite contextual synthesis via MCP sampling over local memories + tasks; filtered from tool definitions when the client lacks sampling capability.
- `repo-summarize`: archive session signals as `task_archive` summary (importance=3).

## Who / When

| Operation                         | When                                                                   | Who                                    |
| :-------------------------------- | :--------------------------------------------------------------------- | :------------------------------------- |
| `memory-read(query)`              | Start of task, during work — find past decisions, patterns, code facts | All agents (orchestrator + sub-agents) |
| `memory-write`                    | After completing work — persist decisions, patterns, code facts        | All agents (orchestrator + sub-agents) |
| `memory-read(id/code)`            | When task prompt includes a memory code — retrieve full context        | Sub-agents only                        |
| `memory-write` (acknowledge)      | After consuming a memory — mark it as used/reviewed                    | Sub-agents only                        |
| `memory-read` (recap)             | At macro-workflow start (S0) — summary of recent memory activity       | Orchestrator                           |
| `memory-write` (`type=decision`)  | Log a structured architectural decision (importance=4)                 | All agents                             |
| `task-read`                       | Sync — list/search/detail of pending, backlog, in_progress             | Orchestrator + sub-agents              |
| `claim-manage`                    | Claim task start (`task_code` + `agent`) → `in_progress`               | Agent executing the task               |
| `task-write(status=completed)`    | Mark task done — auto-releases claim, expires linked handoffs          | Agent executing the task               |
| `handoff-read`                    | Check incoming handoffs (S0); search/list pending                      | Orchestrator                           |
| `handoff-write`                   | Create handoff ONLY for unfinished work (concrete next owner + steps)  | Agent leaving work behind              |
| `standard-read(query)`            | Hydrate (S1) — load applicable coding standards                        | All agents                             |
| `standard-write`                  | Persist a new standards entry                                          | All agents                             |
| `standard-delete`                 | Delete coding standards (single/bulk, UUID or code)                    | All agents                             |
| `memory-delete`                   | Soft-delete memories (single/bulk, UUID or code)                       | All agents                             |
| `task-delete`                     | Soft-delete tasks → canceled, release claims, expire handoffs          | All agents                             |
| `repo-summarize`                  | Archive session signals as task_archive summary                        | All agents                             |
| `synthesize`                      | Composite synthesis via sampling (requires client sampling)            | All agents                             |
| `agent-context`                   | Compile token-budgeted cross-source context for an objective           | All agents                             |
| `observation-write`               | Create/update/bulk/refresh exploration observations with fingerprints  | All agents                             |
| `observation-read`                | Read observations by scope, subject, task, file, symbol, confidence    | All agents                             |
| `codebase-index(repo)`            | Check index freshness/status before querying                           | Orchestrator                           |
| `codebase-index(repoPath + repo)` | Refresh a stale index                                                  | Orchestrator                           |
| `codebase-index(warmup:true)`     | Explicitly warm the index engine                                       | Orchestrator                           |
| `codebase-read(query)`            | Primary codebase exploration (symbol/NL search)                        | Orchestrator                           |
| `codebase-read(name)`             | Trace definition & usage cross-file                                    | Orchestrator                           |

## Registered Tools (19 canonical)

All 19 tools are registered via `src/mcp/tools/index.ts` (`buildExecutors` + `TOOL_DEFINITIONS`) and `src/mcp/mcp-server.ts:registerAllTools`. No legacy dotted aliases are registered — the router normalizes `'.'` → `'-'` only for backward-compatible dispatch.

| #   | Tool                | Kind   | Description                                                        |
| --- | ------------------- | ------ | ------------------------------------------------------------------ |
| 1   | `memory-write`      | write  | Create / update / acknowledge / bulk memories (auto-infer)         |
| 2   | `memory-read`       | read   | Search / detail / recap memories (auto-infer)                      |
| 3   | `memory-delete`     | write  | Soft-delete memories (single/bulk)                                 |
| 4   | `task-write`        | write  | Create / update / bulk / interactive tasks                         |
| 5   | `task-read`         | read   | Search / detail / list tasks                                       |
| 6   | `task-delete`       | write  | Soft-delete tasks → canceled                                       |
| 7   | `handoff-write`     | write  | Create / update handoff                                            |
| 8   | `handoff-read`      | read   | Detail / list / search handoffs (incl. claims list)                |
| 9   | `claim-manage`      | write† | Claim / release / list task claims (auto-infer; list is read-only) |
| 10  | `standard-write`    | write  | Create / update / bulk coding standards                            |
| 11  | `standard-read`     | read   | Search / detail / list standards                                   |
| 12  | `standard-delete`   | write  | Delete standards (single/bulk)                                     |
| 13  | `agent-context`     | read   | Budgeted cross-source context compiler                             |
| 14  | `synthesize`        | read   | Context synthesis via MCP sampling (gated on client capability)    |
| 15  | `repo-summarize`    | write  | Repository summary from signals                                    |
| 16  | `observation-write` | write  | Create / update / bulk / refresh exploration observations          |
| 17  | `observation-read`  | read   | Read exploration observations                                      |
| 18  | `codebase-index`    | write  | Index or status (incl. warmup)                                     |
| 19  | `codebase-read`     | read   | Trace / file / search / architecture / content grep                |

† `claim-manage` list modes are read-only and do not emit an `action_log` row; claim/release modes do.

## Tool Error Envelope

Every tool failure is returned as a canonical `ToolError` envelope via `src/mcp/utils/mcp-error.ts:toErrorResponse` (shared by both SDK and router transports):

```json
{
	"schema": "tool-error",
	"code": "VALIDATION_ERROR",
	"message": "Error: ...",
	"retryable": false,
	"error": "Error: ...",
	"details": {}
}
```

- `schema` is always `"tool-error"`.
- `code` is one of `VALIDATION_ERROR` | `NOT_FOUND` | `CONFLICT` | `UNSUPPORTED_OPERATION` | `CAPABILITY_UNAVAILABLE` | `INTERNAL_ERROR` (open string for forward-compat).
- `message` and `error` carry the same human-readable text; `error` is a backward-compatible alias.
- `retryable` is `false` for all currently classified errors; `true` only for explicitly retryable tool errors.
- `details` is present only when the handler supplies structured details.
- Successful structured results use `withEnvelope(schema, mode, data)` and `createMcpResponse(..., { includeJson })` — `structuredContent` is populated only when `json:true` or the handler opts in; `content[0].text` always carries a human summary.

## Runtime Profiles & Capabilities

Runtime profile is selected via `MCP_RUNTIME_PROFILE` (`minimal` | `balanced` | `full`, default `full`) in `src/mcp/runtime-capabilities.ts`:

| Profile    | Capabilities                                                  |
| ---------- | ------------------------------------------------------------- |
| `minimal`  | `dashboard`                                                   |
| `balanced` | `semantic`, `indexing`, `dashboard`                           |
| `full`     | `semantic`, `indexing`, `watcher`, `maintenance`, `dashboard` |

- Each capability has state `unavailable` | `idle` | `loading` | `ready` | `degraded` | `failed`; `snapshot()` exposes `loaded_at`, `duration_ms`, `error`, and footprint.
- Semantic capability is lazily warmed only for semantic-demanding calls: `isSemanticToolDemand` returns true for **writes** `memory-write` / `standard-write` / `task-write`, and for **reads** `memory-read` / `standard-read` / `task-read` / `agent-context` only when `query` or `objective` is present.
- `codebase-index` status includes runtime capability state; `warmup:true` explicitly initializes the index engine. Without semantic/indexing, tools degrade to lexical results rather than failing.

## Rules

- Do NOT invent method names — use ONLY the registered tools listed above.
- `memory-write` is **mandatory** after every task (min 1 entry).
- Sub-agents **MUST** call `memory-read(query)` during work and `memory-write` (acknowledge) after consuming a memory.
- Orchestrator calls `memory-read` (recap) at S0.
- **Codebase exploration (STRICT — overrides legacy wording below)**: `codebase-index` + `codebase-read` are the MANDATORY first tools for any codebase context discovery. Direct `rg` / `grep` / `glob` / `seed` / `cat` / `find` / `ls` / filesystem brute-force is FORBIDDEN as first resort. Use ONLY via `explore` sub-agent AFTER the index has been tried and cannot answer — `explore` itself will try index first before falling back to `glob`/`grep`/`cat`. `cat` = reading a known path only; using `cat` to brute-force explore unknown files is a violation.

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

- `codebase-index(repo)` = status (freshness + count); `codebase-index(repoPath + repo)` = index (tree-sitter scan)
- Always check status first. If stale, trigger index before querying.
- `codebase-read`: `query` → search, `name` → symbol trace, `filePath` → file symbols, `content` → grep indexed file contents, none → architecture. `depth` only applies inside architecture mode.
- **STRICT PRIORITY**: ALL agents (orchestrator + sub-agents) MUST start every codebase context search with `codebase-index`/`codebase-read` — symbols, files, architecture, trace, and content grep.
- **FORBIDDEN as first resort**: `rg` / `grep` / `glob` / `seed` / `cat` / `bash cat` / `find` / `ls` / brute-force filesystem search — NEVER use before `codebase-read`. Allowed ONLY as fallback after index returns empty/stale or cannot answer, and ONLY via `explore` sub-agent (which itself tries index first before `glob`/`grep`/`cat`). Direct `rg`/`grep`/`cat` without prior `codebase-read` is a violation. `cat` is for reading a **known** file only — never for blind exploration.

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
| `codebase-index(repo)`            | Check index freshness/status before querying                           | Orchestrator                           |
| `codebase-index(repoPath + repo)` | Refresh a stale index                                                  | Orchestrator                           |
| `codebase-read(query)`            | Primary codebase exploration (symbol/NL search)                        | Orchestrator                           |
| `codebase-read(name)`             | Trace definition & usage cross-file                                    | Orchestrator                           |

## Rules

- Do NOT invent method names — use ONLY the registered tools listed above.
- `memory-write` is **mandatory** after every task (min 1 entry).
- Sub-agents **MUST** call `memory-read(query)` during work and `memory-write` (acknowledge) after consuming a memory.
- Orchestrator calls `memory-read` (recap) at S0.
- **Codebase exploration (STRICT — overrides legacy wording below)**: `codebase-index` + `codebase-read` are the MANDATORY first tools for any codebase context discovery. Direct `rg` / `grep` / `glob` / `seed` / `cat` / `find` / `ls` / filesystem brute-force is FORBIDDEN as first resort. Use ONLY via `explore` sub-agent AFTER the index has been tried and cannot answer — `explore` itself will try index first before falling back to `glob`/`grep`/`cat`. `cat` = reading a known path only; using `cat` to brute-force explore unknown files is a violation.

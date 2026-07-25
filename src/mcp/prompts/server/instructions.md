---
name: server-instructions
description: Main instructions for the MCP server
---

Local Memory MCP — persistent memory, task coordination, and coding standards for AI agents.

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

> **Workflow**: This server provides tools for memory, tasks, standards, and handoffs. The canonical workflow is defined in `AGENTS.md` (WORKFLOW section: S0→Synthesize→S1→S2→Execute→Close). These MCP tools are the mechanism — the AGENTS.md workflow is the orchestration.

## Core Workflows

**Memory**: memory-search → memory-detail → memory-store | memory-update | memory-synthesize

- Durable only (arch, patterns, decisions, fixes)
- memory-acknowledge after code gen from memory
- Global scope = cross-repo only; prefer repo-specific
- decision-log = shortcut for storing decision-type memories (auto-sets type=decision, importance=4, agent=current, model=current, scope=current)
- session-summarize = archive session as task_archive memory (type=task_archive, importance=3)

### memory-store required fields

Every `memory-store` call MUST include these fields:

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

### memory-update optional fields

`memory-update` accepts the same fields as `memory-store` but all are optional (only provide the fields to change). Either `id` (UUID) or `code` (string) is required to identify the target memory.

**Tasks**: task-list → task-claim(auto → in_progress) → task-update(completed)

- Register via task-create before execution
- NEVER skip in_progress
- Commit: `type(scope): [task-code] message` + `- [Title]` + `[Summary]`
- Complete auto-releases claims + expires linked handoffs

**Standards**: standard-search → standard-store

- MANDATORY pre-implementation gate
- 1 rule/entry, normative contract

**Handoffs/Claims**: handoff-list → handoff-create | handoff-update | task-claim | claim-release

- Create ONLY for unfinished work (concrete next owner/steps)
- NO handoff for completion summaries → use task-update comments

**Codebase Index**: index_status → index_repository → search_symbols / codebase_search / trace_symbol / get_architecture / get_file_symbols

- Always check index_status first. If stale, trigger index_repository before querying.
- Agents: use codebase index tools FIRST, fall back to explore sub-agent only when index can't answer.

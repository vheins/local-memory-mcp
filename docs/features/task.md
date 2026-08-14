# Task & Project Tracking

The Task feature gives AI agents a durable, structured backlog that survives across sessions: create tasks, move them through a lifecycle state machine, attach comments that double as an audit trail, link subtasks and GitHub-style issue references, and coordinate work through claims and handoffs (see the [Handoff & Claim Coordination](handoff.md) guide).

Tasks are scoped to an `owner`/`repo` pair and stored in the same local SQLite database as memories and standards.

---

## What Is Task Tracking & Why It Matters

A task is a unit of work with a lifecycle. Each task records:

| Field                          | Purpose                                                                       |
| :----------------------------- | :---------------------------------------------------------------------------- |
| `task_code`                    | Short stable identifier (e.g. `T01`) used across tools.                       |
| `phase`                        | Free-form workflow phase (e.g. `planning`, `implementation`) — no fixed enum. |
| `title` / `description`        | What needs to be done.                                                        |
| `status`                       | One of six lifecycle states (below).                                          |
| `priority`                     | 1–5 (1 = highest … 5 = lowest).                                               |
| `agent` / `role` / `model`     | Who is working on it and how.                                                 |
| `tags`, `metadata`, `doc_path` | Categorization and context.                                                   |
| `parent_id`, `depends_on`      | Subtask and dependency links.                                                 |
| `decision_refs`                | Links to decision memories that shaped the task.                              |
| `est_tokens`                   | Estimated effort.                                                             |
| `commit_id`, `changed_files`   | Optional delivery evidence.                                                   |
| `comments`                     | Threaded notes — every status change is captured here.                        |

### Lifecycle statuses

```
backlog → pending → in_progress → completed
                    ↓        ↓
                 blocked  canceled
```

- `backlog`, `pending`, `in_progress`, `completed`, `blocked`, and `canceled` are the six canonical statuses (note US spelling: **canceled**, one _l_).
- Status transitions that need a guard are enforced by the server: moving to `completed` requires all child tasks to be completed first, and a **comment is required on status changes**.

---

## How It Works

### Writing (`task-write`)

`task-write` auto-infers the operation from the parameters:

- `tasks[]` → **BULK** (each item infers create vs. update independently)
- `interactive: true` → **INTERACTIVE** (elicit missing fields from the user via a form — requires an MCP client that supports elicitation)
- `id`/`code` → **UPDATE** (single task)
- `phase` + `title` + `description` → **CREATE**

The handler enforces the state machine:

- **`backlog ↔ pending ↔ in_progress ↔ completed/canceled/blocked`** transitions are the supported paths; a comment is written on every status change (the comment stores `previous_status` → `next_status`).
- **Completing** auto-releases the task's claims, expires its pending handoffs, and — under the write lock — archives a `task_archive` memory of the completed work (visible with `memory-read`).
- **Canceling** also auto-releases claims and expires linked handoffs (with a comment explaining why).

### Reading (`task-read`)

`task-read` auto-infers its mode:

- `query` → **SEARCH** (hybrid keyword+semantic search over tasks, with `status`/`phase`/`priority` filters and inline `key:value` tag support)
- `id`/`code`/`ids`/`codes` → **DETAIL** (full task + comments + children + `depended_by` + coordination info)
- none → **LIST** (paginated by `status` — comma-separated or `"all"` — and `phase`)

`issue_ref` accepts `"#544"` or `"544"` and lists every task structurally linked to that GitHub-style issue number. Detail views include live coordination: active claim holder, pending handoff summary, child tasks, and dependents.

### Deleting (`task-delete`)

Soft-delete: sets the task's status to `canceled`, and cleans up its vector, claims, and handoffs. Single or bulk (by `id`/`code`/`task_code`/…).

### Scoping

Every task lives under an `owner`/`repo` (both required by the schemas, though they are auto-injected from the MCP session when not passed — configure workspace roots in your client). Repo names are normalized (a leading `owner/` prefix is stripped) so `vheins/repo` and `repo` resolve to the same scope.

---

## MCP Usage

Create a task:

```json
{
	"tool": "task-write",
	"arguments": {
		"owner": "vheins",
		"repo": "local-memory-mcp",
		"phase": "implementation",
		"title": "Add eager KG extraction",
		"description": "Extract entities during memory-write so search results are instant.",
		"priority": 2
	}
}
```

Mark it in progress with a comment (comment required on status change):

```json
{
	"tool": "task-write",
	"arguments": {
		"owner": "vheins",
		"repo": "local-memory-mcp",
		"task_code": "REFACTOR-TST-013",
		"status": "in_progress",
		"comment": "Starting — claim follows"
	}
}
```

List pending tasks:

```json
{
	"tool": "task-read",
	"arguments": {
		"owner": "vheins",
		"repo": "local-memory-mcp",
		"status": "pending",
		"limit": 20
	}
}
```

---

## Dashboard Usage

The **Tasks** tab shows a **Kanban board** grouped by status column — drag tasks between columns (each move writes the audited status comment), click a task for its detail drawer, add new tasks, and bulk-import from CSV. Aggregate task stats (created/completed per period, per-status counters) appear in the **Dashboard** tab ("Task Overview" widget) and the **Activity** tab shows the recent tool-call/action feed. The **Agent Arena** view visualizes active claims and tasks per agent.

---

## Tips & Limitations

- Link real GitHub issues with `issue_ref` (or reference `#NNN` in a comment) so `task-read` can list every task tied to an issue.
- Use `parent_id` / `depends_on` to encode subtask & dependency graphs; you cannot complete a parent before its children.
- Textual phase names are free-form — define and reuse a small set (e.g. `planning` → `implementation` → `review`) so LIST/SEARCH filters stay useful.
- The status machine is enforced server-side: arbitrary transitions outside the canonical paths are rejected.
- `interactive: true` requires a client with MCP elicitation support; plain clients should supply all fields directly.
- Completed/canceled tasks release their claims and expire their handoffs automatically — no cleanup needed.

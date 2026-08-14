# Handoff & Claim Coordination

Handoff & Claim Coordination is the multi-agent traffic control for this MCP server. **Handoffs** pass context from one agent to the next (the "baton"); **claims** record which agent currently owns a task. Together they prevent two agents from working the same task and let a finishing agent brief the next one without losing state.

> **Why it matters:** In a multi-agent pipeline, the biggest risk is silent collision — two agents both "start" the same task, or a completed task's context is lost because nobody told the next agent what to do. Handoffs + claims make ownership explicit.

---

## What Is It?

Three MCP tools manage coordination:

- **`handoff-write`** — create a handoff (pass context) or update its status.
- **`handoff-read`** — fetch a handoff, list handoffs, or list claims.
- **`claim-manage`** — claim a task, release a claim, or list claims (unified; legacy aliases `task-claim` / `claim-release`).

### Handoff record

A handoff links a `from_agent` to a `to_agent`, optionally tied to a `task_id` / `task_code`, with a `summary` and a `context` object (use `next_steps`, `blockers`, `remaining_work`). Its lifecycle status is one of: `pending`, `accepted`, `rejected`, `expired`. An optional `expires_at` auto-expires stale handoffs.

---

## How It Works

### Creating a handoff

`handoff-write` CREATE requires `owner`, `repo`, `from_agent`, and `summary`. It stores the handoff as `pending` and auto-posts a comment on the linked task for traceability. A **transfer-context validation** rejects "completed-work" handoffs that name no target agent, no linked task, and no `next_steps` / `blockers` / `remaining_work` — you must say what the next agent should do.

### Updating a handoff

`handoff-write` UPDATE takes `id` + `status` (e.g. `accepted` / `rejected` / `expired`). Accepting a handoff pulls its `next_steps` into a comment on the linked task. When a task is completed or canceled, its linked handoffs are auto-expired.

### Reading

`handoff-read` auto-infers the mode:

- `id` present → **DETAIL** (one handoff).
- `claim: true` or `agent` present → **LIST CLAIMS** (who holds what).
- `query` present → **SEARCH** handoffs by filters (`status`, `from_agent`, `to_agent`).
- nothing → **LIST HANDOFFS** (all in the repo).

### Claims

`claim-manage` auto-infers (ADR-004):

- `release: true` + `task_id` / `task_code` → **RELEASE** the active claim.
- `task_id` / `task_code` + `agent` → **CLAIM** (assigns the agent, auto-comments, and can auto-promote task status).
- `agent` only → **LIST claims by that agent**.
- nothing → **LIST all active claims**.

A task can have at most one active claim; claiming again replaces the prior owner. Completing/canceling a task auto-releases its claim.

---

## MCP Usage

Pass context from one agent to the next:

```json
{
	"method": "tools/call",
	"params": {
		"name": "handoff-write",
		"arguments": {
			"from_agent": "backend",
			"to_agent": "frontend",
			"task_code": "T042",
			"summary": "API ready; wire the dashboard UI to GET /api/tasks.",
			"context": {
				"next_steps": ["Render the kanban board from /api/tasks"],
				"remaining_work": "Pagination not yet implemented"
			},
			"owner": "vheins",
			"repo": "local-memory-mcp"
		}
	}
}
```

Claim a task, then release it when done:

```json
{
	"method": "tools/call",
	"params": {
		"name": "claim-manage",
		"arguments": { "task_code": "T042", "agent": "frontend", "owner": "vheins", "repo": "local-memory-mcp" }
	}
}
```

```json
{
	"method": "tools/call",
	"params": {
		"name": "claim-manage",
		"arguments": { "release": true, "task_code": "T042", "owner": "vheins", "repo": "local-memory-mcp" }
	}
}
```

---

## Dashboard Usage

Open the **Handoffs** tab to see pending/accepted/rejected/expired handoffs and their linked tasks. The **Global Command Center** (top of the dashboard) shows live coordination signals — Active Claims, Pending Handoffs, Unassigned Handoffs, Blocked Tasks, Stale Claims, and Stale Handoffs — so you can see collisions at a glance. Claiming and handoff status are driven by the MCP tools; the dashboard reflects them and lets you inspect.

---

## Tips & Limitations

- **Always give the next agent something to do.** A handoff with only a "done" summary and no `next_steps` / target / linked task is rejected — say what remains.
- **One active claim per task.** Claiming again reassigns ownership; release explicitly when you finish so another agent can pick it up.
- **Handoffs auto-expire on task completion.** You usually don't need a manual `expired` update when the linked task is completed/canceled.
- **Claims need an agent.** `claim-manage` with only a task and no `agent` errors — pair the task with the agent you want to assign.
- **Expiry is optional but useful.** Set `expires_at` on a handoff so stale briefs don't linger if the target agent never responds.
